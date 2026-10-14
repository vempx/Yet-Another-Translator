"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const os = require("node:os");
const path = require("node:path");

function load(BdApi, environment = {}) {
    const sandbox = {module: {exports: {}}, require, __dirname, URL, AbortController, TextDecoder, setTimeout, clearTimeout, BdApi, ...environment};
    vm.runInNewContext(fs.readFileSync(`${__dirname}/LocalTranslator.plugin.js`, "utf8") +
        "\nmodule.exports.testing = {DEFAULTS, validateSettings, TranslationClient, AutoTranslator, areaTopicFor, GlossaryStore, OutgoingTranslator, referenceContext, orderedReferences, renderMessageEmoji, I18n, t, languageLabel, UI_MESSAGES, uiError, errorForUi, uiText};", sandbox);
    return sandbox.module.exports;
}
const Plugin = load();
const {DEFAULTS, validateSettings, TranslationClient, AutoTranslator, areaTopicFor, GlossaryStore} = Plugin.testing;

test("default language persists immediately without Save, deduplicates native events and preserves other drafts", () => {
    const host = settingsHost({autoTranslate: false}, {deferUpdates: true});
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel), restarts = 0;
    host.plugin.restartAutoTranslation = () => restarts++;
    find(tree, node => node.props?.name === "model").props.onInput({target: {value: "unsaved model"}});
    find(tree, node => node.props?.name === "baseUrl").props.onInput({target: {value: "unfinished URL"}});
    tree = host.render(panel);
    const select = find(tree, node => node.props?.name === "targetLanguage");
    select.props.onInput({target: {value: "日本語"}});
    select.props.onChange({target: {value: "日本語"}});
    assert.equal(host.writes.length, 1);
    assert.equal(host.writes[0].value.targetLanguage, "日本語");
    assert.equal(host.plugin.settings.targetLanguage, "日本語");
    assert.equal(host.writes[0].value.model, DEFAULTS.model);
    assert.equal(host.writes[0].value.baseUrl, DEFAULTS.baseUrl);
    assert.equal(host.writes[0].value.autoTranslate, false);
    assert.equal(host.writes[0].value.outgoingLanguage, "English");
    assert.equal(restarts, 1);
    tree = host.render(panel);
    assert.equal(find(tree, node => node.props?.name === "model").props.value, "unsaved model");
    assert.equal(find(tree, node => node.props?.name === "baseUrl").props.value, "unfinished URL");
    const reopened = settingsHost(host.writes[0].value), reopenedPanel = reopened.plugin.getSettingsPanel();
    assert.equal(find(reopened.render(reopenedPanel), node => node.props?.name === "targetLanguage").props.value, "日本語");
});

test("T4 settings preserve a newer external default until the user explicitly edits the default", () => {
    const host = settingsHost();
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    host.plugin.settings.targetLanguage = "日本語";
    find(tree, node => node.props?.name === "model").props.onInput({target: {value: "changed model"}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(host.writes.at(-1).value.targetLanguage, "日本語");
    tree = host.render(panel);
    find(tree, node => node.props?.name === "targetLanguage").props.onInput({target: {value: "English"}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(host.writes.at(-1).value.targetLanguage, "English");
    assert.equal(host.plugin.settings.targetLanguage, "English");
});

test("T4 explicit apply resets same-language overrides while ordinary save preserves them and auto off", () => {
    const host = settingsHost({autoTranslate: false});
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel), restarts = 0;
    host.plugin.restartAutoTranslation = () => restarts++;
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick({type: "click"});
    assert.equal(restarts, 0);
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "应用默认语言并清除单条覆盖").props.onClick();
    assert.equal(restarts, 1);
    assert.equal(host.writes.at(-1).value.autoTranslate, false);
    assert.equal(host.writes.at(-1).value.outgoingLanguage, "English");
    tree = host.render(panel);
    find(tree, node => node.props?.name === "targetLanguage").props.onChange({target: {value: DEFAULTS.targetLanguage}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(restarts, 1);
});

test("T4 known errors and nested parameters follow locale; external errors remain untouched", () => {
    let locale = "zh-CN";
    const Local = load({Webpack: {getStore: () => ({getLocale: () => locale})}});
    const {uiError, uiText, errorForUi} = Local.testing;
    const error = uiError("httpError", {status: 401, hint: uiError("API Key 无效。").uiMessage});
    assert.match(error.message, /API Key 无效/);
    locale = "en-US";
    assert.match(error.message, /Invalid API key/);
    assert.equal(uiText(errorForUi(error)), error.message);
    let validation;
    try {Local.testing.validateSettings({...DEFAULTS, timeoutSeconds: 1});} catch (e) {validation = e;}
    assert.match(validation.message, /Timeout/);
    locale = "ja";
    assert.match(validation.message, /タイムアウト/);
    assert.equal(errorForUi(new Error("external raw detail")), "external raw detail");
});

test("T4 settings validation already on screen updates without retry or inference", () => {
    const host = settingsHost({}, {locale: "zh-CN", runEffects: true});
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    find(tree, node => node.props?.name === "timeoutSeconds").props.onInput({target: {value: "1"}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    tree = host.render(panel);
    assert.match(find(tree, node => node.props?.role === "alert").props.children[0], /超时秒数/);
    host.setLocale("en-US"); tree = host.render(panel);
    assert.match(find(tree, node => node.props?.role === "alert").props.children[0], /Timeout/);
    assert.equal(host.writes.length, 0);
    assert.equal(find(tree, node => node.props?.name === "timeoutSeconds").props.value, "1");
    host.cleanup();
});

test("T4 mixed mentions resolve users, nicknames, roles and channels; native mention remains clickable", () => {
    let clicks = 0;
    const native = {textContent: "@Guild Nick", getAttribute: name => name === "data-user-id" ? "101" : null, click() {clicks++;}};
    const stores = {ChannelStore: {getChannel: id => id === "200" ? {name: "general"} : {guild_id: "guild"}},
        UserStore: {getUser: () => ({username: "user"})}, GuildMemberStore: {getMember: () => ({nick: "Guild Nick"})},
        GuildRoleStore: {getRoles: () => ({300: {name: "Moderators"}})}};
    const Local = load({Webpack: {getStore: name => stores[name]}});
    const document = emojiDocument(), container = document.createElement("div");
    const source = {text: "Hi <@!101> <@&300> <#200>", channelId: "channel", node: {querySelectorAll: selector => selector === "img" ? [] : [native]}};
    Local.testing.renderMessageEmoji(container, "你好 <@!101> <@&300> <#200> <@999>", source, document);
    const mentions = container.children.filter(node => node.className === "lt-rendered-mention");
    assert.deepEqual(mentions.map(node => node.textContent), ["@Guild Nick", "@Moderators", "#general", "@未知用户"]);
    assert.equal(mentions[0].tagName, "button");
    mentions[0].onclick({preventDefault() {}, stopPropagation() {}});
    assert.equal(clicks, 1);
});

test("T4 mention rendering preserves escaped/code literals and keeps spoiler mentions hidden", () => {
    const document = emojiDocument(), container = document.createElement("div");
    const text = "`<@101>` \\<@101> ```\n<#200>\n``` ||<@101>||";
    Plugin.testing.renderMessageEmoji(container, text, {text}, document);
    assert.equal(container.children.filter(node => node.className === "lt-rendered-mention").length, 0);
    const spoiler = container.children.find(node => node.className === "lt-spoiler");
    assert.equal(spoiler.children[1].hidden, true);
    assert.equal(spoiler.children[1].children[0].textContent, "@未知用户");
    assert.match(container.children[0].textContent, /`<@101>`/);
});

test("T4 mention-only messages retain the native node, skip generation and never show raw codes", async () => {
    const chat = chatEnvironment(), fixture = recordingClient([]);
    chat.client.translate = (...args) => fixture.client.translate(...args);
    const node = chat.message("1", "<@101> <#200> <@&300>");
    chat.document.nodes = [node];
    await chat.drain();
    const entry = chat.auto.entries.get(node);
    assert.equal(entry.state, "done");
    assert.equal(entry.output, null);
    assert.equal(entry.sourceHidden, false);
    assert.equal(fixture.requests.length, 0);
    await chat.drain();
    assert.equal(fixture.client.stats.skipped, 1);
});

test("T4 settings dropdown reaches persisted config, rebuilt queue and next request with original references", async () => {
    const host = settingsHost({autoTranslate: true}), panel = host.plugin.getSettingsPanel();
    const chat = chatEnvironment(), requests = [];
    chat.document.nodes = [chat.message("1", "Rover is fun"), chat.message("2", "I agree")];
    chat.auto.sources.readReply = () => ({id: "0", channelId: "channel", text: "original reply"});
    chat.auto.getAreaTopic = () => ({threadTitle: "Wuthering Waves"});
    chat.auto.getGlossary = async () => ({entries: [{en: "Rover", zh: "漂泊者"}]});
    chat.client.cache = new Map(); chat.client.cancelAll = () => {};
    chat.client.translate = async (text, settings, signal, context) => {requests.push({text, settings, context}); return "translated";};
    await chat.drain(); chat.auto.refresh("1", "channel", "English"); await chat.drain();
    host.plugin.client = chat.client; host.plugin.autoTranslator = chat.auto;
    host.plugin.restartAutoTranslation = () => {
        const old = chat.auto; old.stop();
        chat.auto = new AutoTranslator(chat.client, host.plugin.settings, old.env, old.getAreaTopic, old.getGlossary, old.sources);
        host.plugin.autoTranslator = chat.auto; chat.auto.running = true;
    };
    let tree = host.render(panel);
    find(tree, node => node.props?.name === "targetLanguage").props.onChange({target: {value: "日本語"}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(host.writes.at(-1).value.targetLanguage, "日本語");
    assert.equal(host.plugin.settings.targetLanguage, "日本語");
    assert.equal(chat.auto.settings.targetLanguage, "日本語");
    for (let i = 0; i < 10; i++) {chat.auto.scan(); await new Promise(setImmediate);}
    assert.equal(requests.length, 5);
    for (const request of requests.slice(-2)) {
        assert.equal(request.settings.targetLanguage, "日本語");
        assert.equal(request.context.reply.text, "original reply");
        assert.equal(request.context.areaTopic.threadTitle, "Wuthering Waves");
        assert.equal(request.context.glossary.entries[0].en, "Rover");
    }
    for (const entry of chat.auto.entries.values()) assert.equal(entry.targetLanguage, undefined);
    chat.auto.stop();
});

function outgoingFixture({getDraft, source = "我要专武", display = source} = {}) {
    const errors = [], sent = [], requests = [];
    const LocalPlugin = load({Webpack: {getStore: name => name === "DraftStore" && getDraft ? {getDraft} : undefined}});
    const plugin = new LocalPlugin();
    plugin.active = true;
    plugin.settings = {...DEFAULTS, outgoingTranslate: true, outgoingLanguage: "English"};
    plugin.api = {UI: {showToast: message => errors.push(message)}};
    let reply = {id: "42", text: "original quoted text"};
    plugin.outgoingContext = () => ({before: [{text: "nearby original"}], reply});
    plugin.getAreaTopic = () => ({threadTitle: "Wuthering Waves"});
    plugin.getGlossary = async (id, text, context) => {
        assert.equal(id, "101"); assert.equal(text, source); assert.equal(context.reply.text, "original quoted text");
        return {entries: [{en: "signature weapon", zh: "专武"}]};
    };
    plugin.client.translate = async (...args) => {requests.push(args); return "I want the signature weapon";};
    const outgoing = new LocalPlugin.testing.OutgoingTranslator(plugin);
    const editor = {textContent: display, isConnected: true};
    const payload = {value: source, attachments: [{id: "attachment"}], custom: "retain"};
    const extra = {replyReference: "42"};
    const original = (...args) => {sent.push(args); return {shouldClear: true};};
    return {plugin, outgoing, editor, payload, extra, original, requests, sent, errors, setReply: value => {reply = value;}};
}

test("outgoing submit translates once with independent language, original reply, topic and glossary; preserves payload", async () => {
    const f = outgoingFixture();
    const result = await f.outgoing.submit("101", [f.payload, f.extra], f.original, f.editor);
    assert.equal(result.shouldClear, true);
    assert.equal(f.requests[0][1].targetLanguage, "English");
    assert.equal(f.plugin.settings.targetLanguage, "简体中文");
    assert.equal(f.requests[0][3].reply.text, "original quoted text");
    assert.equal(f.requests[0][3].before[0].text, "nearby original");
    assert.equal(f.requests[0][3].areaTopic.threadTitle, "Wuthering Waves");
    assert.equal(f.requests[0][3].glossary.entries[0].zh, "专武");
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0][0].value, "I want the signature weapon");
    assert.equal(f.sent[0][0].attachments, f.payload.attachments);
    assert.equal(f.sent[0][1], f.extra);
    assert.equal(f.payload.value, "我要专武");
});

test("outgoing failures retain draft and never fall back to sending original", async () => {
    for (const failure of ["model", "glossary", "length"]) {
        const f = outgoingFixture();
        if (failure === "model") f.plugin.client.translate = async () => {throw new Error("offline");};
        if (failure === "glossary") f.plugin.getGlossary = async () => {throw new Error("invalid glossary");};
        if (failure === "length") f.plugin.client.translate = async () => "x".repeat(4001);
        assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
        assert.equal(f.sent.length, 0); assert.equal(f.errors.length, 1);
    }
});

test("outgoing duplicate submissions, edited drafts, changed replies, navigation and cancellation cannot send", async () => {
    for (const change of ["draft", "reply", "navigation", "cancel", "stop"]) {
        const f = outgoingFixture();
        let resolve;
        f.plugin.client.translate = () => new Promise(done => {resolve = done;});
        const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
        await Promise.resolve();
        assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
        if (change === "draft") f.editor.textContent = "new draft";
        if (change === "reply") f.setReply({id: "43", text: "different reply"});
        if (change === "navigation") f.editor.isConnected = false;
        if (change === "cancel") f.outgoing.cancel();
        if (change === "stop") f.plugin.active = false;
        resolve("translated");
        assert.equal((await pending).shouldClear, false); assert.equal(f.sent.length, 0);
    }
});

test("disabled outgoing translation and attachment-only submissions pass through", async () => {
    const f = outgoingFixture();
    f.plugin.settings.outgoingTranslate = false;
    await f.outgoing.submit("101", [f.payload], f.original, f.editor);
    assert.equal(f.sent[0][0], f.payload);
    f.plugin.settings.outgoingTranslate = true;
    const attachmentOnly = {...f.payload, value: ""};
    await f.outgoing.submit("101", [attachmentOnly], f.original, f.editor);
    assert.equal(f.sent[1][0], attachmentOnly); assert.equal(f.requests.length, 0);
});

test("private Slate string callback reaches the patched owning composer through a fresh render", async () => {
    const f = outgoingFixture();
    let renders = 0;
    const owner = {props: {channel: {id: "101"}}, handleSendMessage: f.original,
        forceUpdate() {
            renders++;
            composer.memoizedProps.onSubmit = this.handleSendMessage;
            const captured = this.handleSendMessage;
            slate.memoizedProps.onSubmit = text => captured({value: text, uploads: []});
        }};
    const composer = {memoizedProps: {channel: owner.props.channel, pendingReply: null,
        textValue: "", onSubmit: owner.handleSendMessage}, return: {stateNode: owner}};
    const slate = {memoizedProps: {channel: owner.props.channel, value: "", onSubmit: text => f.original({value: text})}, return: composer};
    const LocalPlugin = load({ReactUtils: {getInternalInstance: () => slate}, Webpack: {getStore: () => undefined}});
    f.plugin.api.Patcher = {instead(target, key, callback) {
        const original = target[key];
        target[key] = (...args) => callback(target, args, (...forwarded) => original.apply(target, forwarded));
        return () => {target[key] = original;};
    }};
    const buttons = {children: []};
    const editor = {...f.editor, closest: selector => selector.includes("channelTextArea") ? {querySelector: () => buttons} : null};
    const outgoing = new LocalPlugin.testing.OutgoingTranslator(f.plugin, {document: {querySelectorAll: () => [editor]}});
    outgoing.controls.set(editor, {root: {isConnected: true, style: {setProperty() {}}},
        toggle: {setAttribute() {}}, language: {}});
    assert.equal(outgoing.submission(editor).instance, owner);
    outgoing.scan();
    assert.equal(renders, 1);
    const result = await slate.memoizedProps.onSubmit("我要专武");
    assert.equal(result.shouldClear, true);
    assert.equal(f.requests.length, 1);
    assert.equal(f.sent[0][0].value, "I want the signature weapon");
    outgoing.scan();
    assert.equal(renders, 1, "polling must not repeatedly remount or rerender the editor");
});

test("outgoing reply context reads stored original text rather than a translated preview", () => {
    const original = {id: "42", channel_id: "101", content: "Iuno original name"};
    const stores = {
        MessageStore: {getMessage: () => original},
        PendingReplyStore: {getPendingReply: () => ({message: {...original, content: "尤诺译文"}})}
    };
    const LocalPlugin = load({Webpack: {getStore: name => stores[name]}});
    const context = new LocalPlugin().outgoingContext("101");
    assert.equal(context.reply.id, "42");
    assert.equal(context.reply.text, "Iuno original name");
});

test("outgoing glossary also matches terms appearing only in the quoted reply", async t => {
    const fixture = glossaryFixture(t, [{en: "Iuno", zh: "尤诺"}]);
    const selected = await new GlossaryStore().select(fixture.file, "I agree", {reply: {text: "Iuno is fun"}});
    assert.equal(selected.entries[0].en, "Iuno");
});

test("root, /v1 and legacy completion URLs normalize to one API base", () => {
    for (const suffix of ["", "/", "/v1", "/v1/", "/v1/chat/completions", "/v1/chat/completions/"]) {
        assert.equal(validateSettings({...DEFAULTS, baseUrl: `http://localhost:9090${suffix}`}).baseUrl, "http://localhost:9090/v1");
    }
    assert.equal(validateSettings(DEFAULTS).baseUrl, "http://127.0.0.1:8080/v1");
    assert.throws(() => validateSettings({...DEFAULTS, baseUrl: "ftp://localhost/v1"}));
});

test("requests use the updated port without doubling /chat/completions", async () => {
    const urls = [];
    const client = new TranslationClient(async url => {
        urls.push(url);
        const data = url.endsWith("/models") ? {data: [{id: "local-model"}]} : {choices: [{message: {content: "hello"}}]};
        const buffer = Buffer.from(JSON.stringify(data));
        return {status: 200, arrayBuffer: async () => buffer};
    });
    await client.translate("你好", {...DEFAULTS, baseUrl: "http://localhost:9090/v1/chat/completions", targetLanguage: "English"});
    assert.deepEqual(urls, ["http://localhost:9090/v1/models", "http://localhost:9090/v1/chat/completions"]);
});

test("discussion topic resolves text channels, forum posts and threads by their own IDs", () => {
    const channels = {
        category: {type: 4, name: "Event Space"},
        text: {type: 0, name: "dlss5", parent_id: "category"},
        forum: {type: 15, name: "mods", parent_id: "category"},
        post: {type: 11, name: "Wuthering Waves", parent_id: "forum"},
        thread: {type: 12, name: "Rendering issue", parent_id: "text"},
        partial: {type: 11, name: "Known post", parent_id: "missing"},
        dm: {type: 1, name: "Private recipient"}
    };
    const topic = id => JSON.parse(JSON.stringify(areaTopicFor(id, key => channels[key])));
    assert.deepEqual(topic("text"), {channelName: "dlss5", categoryName: "Event Space"});
    assert.deepEqual(topic("post"), {channelName: "mods", threadTitle: "Wuthering Waves", forumName: "mods", categoryName: "Event Space"});
    assert.deepEqual(topic("thread"), {channelName: "dlss5", threadTitle: "Rendering issue", categoryName: "Event Space"});
    assert.deepEqual(topic("partial"), {threadTitle: "Known post"});
    assert.equal(topic("dm"), null);
    assert.equal(topic("missing"), null);
});

test("model requests treat area names as topic hints and preserve them on context retry", async () => {
    const requests = [];
    const client = new TranslationClient(async (url, options) => {
        const request = JSON.parse(options.body);
        requests.push(request);
        const content = requests.length === 1 ? "Translation: unwanted\nextra line" : "自然译文";
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content}}]}))};
    });
    const areaTopic = {channelName: "mods", threadTitle: "Wuthering Waves"};
    const result = await client.translate("pull her sig", {...DEFAULTS, model: "local-model"}, undefined,
        {target: {id: "1"}, before: [{text: "nearby dialogue"}], after: [], areaTopic});
    assert.equal(result, "自然译文");
    assert.equal(requests.length, 2);
    for (const request of requests) {
        const topic = request.messages.find(message => message.content.startsWith("POSSIBLE TOPIC"));
        assert.equal(topic.role, "system");
        assert.ok(topic.content.includes('"threadTitle":"Wuthering Waves"'));
        assert.ok(topic.content.includes("untrusted reference metadata"));
        assert.match(topic.content, /takes? precedence/);
        assert.deepEqual(request.messages.filter(message => message.role === "user"), [{role: "user", content: "pull her sig"}]);
    }
    assert.ok(requests[1].messages.some(message => message.content.includes("nearby dialogue")));
});

test("selected topic lookup is optional and missing stores do not block translation", () => {
    const stores = {ChannelStore: {getChannel: id => ({id, type: 0, name: id === "selected" ? "current area" : "message area"})},
        SelectedChannelStore: {getChannelId: () => "selected"}};
    const LocalPlugin = load({Webpack: {getStore: name => stores[name]}});
    const plugin = new LocalPlugin();
    assert.equal(plugin.getAreaTopic().channelName, "current area");
    assert.equal(plugin.getAreaTopic("explicit-message-channel").channelName, "message area");
    assert.equal(new (load({}))().getAreaTopic("unknown"), null);
});

test("automatic and single-message translation attach the message channel topic across navigation", async () => {
    const chat = chatEnvironment();
    const received = [];
    chat.client.translate = async (text, settings, signal, context) => {received.push({text, topic: context.areaTopic}); return text;};
    chat.auto.getAreaTopic = channelId => ({channelName: channelId === "A" ? "dlss5" : "mods"});
    chat.document.nodes = [chat.message("1", "A message", "A")];
    await chat.drain();
    chat.document.nodes[0].isConnected = false;
    chat.document.nodes = [chat.message("2", "B message", "B")];
    chat.auto.setAutoTranslation(false);
    chat.auto.toggle(chat.document.nodes[0]);
    await chat.drain();
    assert.deepEqual(received, [{text: "A message", topic: {channelName: "dlss5"}}, {text: "B message", topic: {channelName: "mods"}}]);
});

function settingsHost(saved = {}, {deferUpdates = false, runEffects = false, locale = null} = {}) {
    const states = [], refs = [];
    const updates = [];
    const effects = [], localeListeners = new Set();
    let cursor = 0, refCursor = 0;
    const React = {
        createElement: (type, props, ...children) => ({type, props: {...props, children}}),
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = initial;
            return [states[index], value => {
                const apply = () => {states[index] = typeof value === "function" ? value(states[index]) : value;};
                if (deferUpdates) updates.push(apply); else apply();
            }];
        },
        useRef: initial => (refs[refCursor++] ||= {current: initial}), useEffect: callback => {if (runEffects) {const cleanup = callback(); if (cleanup) effects.push(cleanup);}}
    };
    const writes = [];
    const alerts = [];
    class Api {
        static React = React;
        static Webpack = {getStore: name => name === "LocaleStore" && locale ? {
            getLocale: () => locale, addChangeListener: callback => localeListeners.add(callback), removeChangeListener: callback => localeListeners.delete(callback)
        } : null};
        Data = {load: () => saved, save: (key, value) => writes.push({key, value})};
        DOM = {addStyle: () => {}};
        UI = {alert: (title, content) => alerts.push({title, content}), showToast: () => {}};
        ContextMenu = {buildItem: config => ({type: "group", props: {children: config.items.map(item =>
            ({type: "item", props: item}))}})};
    }
    const LocalPlugin = load(Api);
    const plugin = new LocalPlugin();
    return {plugin, writes, alerts, localeListeners,
        setLocale(value) {locale = value; for (const listener of [...localeListeners]) listener();},
        cleanup() {for (const effect of effects.splice(0)) effect();}, render(element) {
        while (updates.length) updates.shift()();
        cursor = 0; refCursor = 0; return element.type(element.props);
    }};
}
function find(tree, predicate) {
    if (!tree || typeof tree !== "object") return undefined;
    if (predicate(tree)) return tree;
    for (const child of (Array.isArray(tree) ? tree : tree.props?.children || [])) {
        const match = find(child, predicate);
        if (match) return match;
    }
}

test("glossary check results stay in their area, errors are local and changing paths clears stale results", async () => {
    const host = settingsHost({customAreas: {
        "101": {name: "First area", enabled: true, glossaryPath: "C:/first.json"},
        "102": {name: "Second area", enabled: true, glossaryPath: "C:/second.json"}
    }}, {runEffects: true});
    const panel = host.plugin.getSettingsPanel();
    const area = (tree, name) => find(tree, node => node.props?.className === "lt-area" &&
        find(node, child => child.type === "strong" && child.props.children[0] === name));
    const button = (tree, name) => find(tree, node => node.type === "button" && node.props.children[0] === name);
    let resolve;
    host.plugin.glossaryStore.load = filePath => {
        assert.equal(filePath, "C:/first.json");
        return new Promise(done => {resolve = done;});
    };
    let tree = host.render(panel);
    assert.equal(button(tree, "使用鸣潮术语表"), undefined);
    assert.equal(button(tree, "使用方舟＋终末地术语表"), undefined);
    const pending = button(area(tree, "First area"), "检查术语表").props.onClick();
    tree = host.render(panel);
    assert.equal(find(area(tree, "First area"), node => node.props?.role === "status").props.children[0], "正在检查术语表…");
    resolve({name: "First glossary", entries: [{}, {}]});
    await pending;
    tree = host.render(panel);
    assert.equal(find(area(tree, "First area"), node => node.props?.role === "status").props.children[0], "术语表有效：First glossary，共 2 条。");
    assert.equal(find(area(tree, "Second area"), node => node.props?.role === "status").props.children[0], "检查结果将在这里显示。");
    host.plugin.glossaryStore.load = async () => {throw new Error("测试：文件不存在");};
    await button(area(tree, "Second area"), "检查术语表").props.onClick();
    tree = host.render(panel);
    assert.equal(find(area(tree, "Second area"), node => node.props?.role === "alert").props.children[0], "测试：文件不存在");
    assert.equal(find(area(tree, "First area"), node => node.props?.role === "alert"), undefined);
    find(area(tree, "First area"), node => node.type === "input" && node.props.type === "text")
        .props.onInput({currentTarget: {value: "C:/replacement.json"}});
    tree = host.render(panel);
    assert.equal(find(area(tree, "First area"), node => node.props?.role === "status").props.children[0], "检查结果将在这里显示。");
});

test("Discord UI locale changes update settings labels without remounting or altering unsaved settings", () => {
    const host = settingsHost({}, {locale: "en-US", runEffects: true});
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    assert.equal(find(tree, node => node.type === "h2").props.children[0], "LLM message translation");
    assert.ok(find(tree, node => node.type === "button" && node.props.children[0] === "Save settings"));
    find(tree, node => node.props.name === "baseUrl").props.onInput({currentTarget: {value: "http://localhost:9000"}});
    host.setLocale("ja"); tree = host.render(panel);
    assert.equal(find(tree, node => node.props.name === "baseUrl").props.value, "http://localhost:9000");
    assert.equal(find(tree, node => node.props.name === "targetLanguage").props.value, "简体中文");
    assert.ok(find(tree, node => node.type === "button" && node.props.children[0] === "設定を保存"));
    assert.equal(host.plugin.getSettingsPanel().type, panel.type);
    host.setLocale("zh-TW"); tree = host.render(panel);
    assert.ok(find(tree, node => node.type === "button" && node.props.children[0] === "儲存設定"));
    assert.equal(host.writes.length, 0);
    host.cleanup(); assert.equal(host.localeListeners.size, 0);
});

test("UI locale detection prioritizes Discord, handles variants and falls back safely", () => {
    let locale = "en-GB";
    const Local = load({Webpack: {getStore: () => ({getLocale: () => locale})}}, {document: {documentElement: {lang: "zh-CN"}}});
    assert.equal(Local.testing.t("查看原文"), "View original");
    locale = "zh-Hant-HK"; assert.equal(Local.testing.I18n.locale(), "zh-TW");
    locale = "xx-unknown"; assert.equal(Local.testing.t("保存设置"), "Save settings");
    locale = "en-US";
    assert.equal(Local.testing.t("settingsSaved", {url: "http://localhost/{custom}"}), "Settings saved. API URL: http://localhost/{custom}");
    assert.equal(Local.testing.languageLabel("日本語"), "Japanese");
    const fallback = load({Webpack: {getStore() {throw Error("missing");}}}, {document: {documentElement: {lang: "en-US"}}});
    assert.equal(fallback.testing.t("保存设置"), "Save settings");
    const moduleFallback = load({Webpack: {getStore() {throw Error("missing");}, getModule: () => ({getLocale: () => "en-US"})}}, {document: {documentElement: {lang: "zh-CN"}}});
    assert.equal(moduleFallback.testing.t("保存设置"), "Save settings");
});

test("display branding preserves the old plugin ID, settings namespace and glossary location", () => {
    const namespaces = [];
    class Api {
        constructor(namespace) {namespaces.push(namespace);}
        static React = {createElement: (type, props) => ({type, props})};
        static Plugins = {folder: "C:/BetterDiscord/plugins"};
        Data = {load: () => ({model: "existing-model", targetLanguage: "日本語"})};
        DOM = {addStyle() {}};
    }
    const Local = load(Api), plugin = new Local(); plugin.getSettingsPanel();
    assert.equal(plugin.getName(), "Yet Another Translator");
    assert.deepEqual(namespaces, ["LocalTranslator"]);
    assert.equal(plugin.settings.model, "existing-model"); assert.equal(plugin.settings.targetLanguage, "日本語");
    assert.ok(plugin.glossaryStore.defaultPath("wuthering-waves.json").includes("LocalTranslator-glossaries"));
    assert.match(fs.readFileSync(path.join(__dirname, "LocalTranslator.plugin.js"), "utf8"), /@name LocalTranslator\b/);
});

test("cached addon description follows locale and supports BetterDiscord card search and string conversion", () => {
    let locale = "zh-CN";
    const Local = load({Webpack: {getStore: () => ({getLocale: () => locale})}});
    const description = new Local().getDescription();
    assert.match(description.toString(), /大语言模型（LLM）.*自动翻译、单条翻译和发送前翻译/);
    locale = "en-US";
    assert.equal(String(description), "LLM-powered Discord translation with automatic, per-message, and pre-send translation.");
    assert.ok(description.toLocaleLowerCase().includes("llm-powered"));
    assert.equal(JSON.parse(JSON.stringify({description})).description, String(description));
    locale = "ja"; assert.match(String(description), /LLM.*Discord.*送信前/);
});

test("modern BetterDiscord addon metadata localizes its description while retaining registration identity", () => {
    let locale = "zh-CN";
    const addon = {id: "LocalTranslator", name: "LocalTranslator", description: "old", filename: "LocalTranslator.plugin.js"};
    const Local = load({Plugins: {get: id => id === addon.id ? addon : null}, Webpack: {getStore: () => ({getLocale: () => locale})}});
    new Local({id: "LocalTranslator"});
    assert.equal(addon.name, "Yet Another Translator"); assert.equal(addon.id, "LocalTranslator");
    assert.equal(addon.filename, "LocalTranslator.plugin.js"); assert.match(addon.description, /发送前翻译/);
    locale = "en-US"; assert.equal(addon.description, "LLM-powered Discord translation with automatic, per-message, and pre-send translation.");
    assert.ok(addon.description.toLocaleLowerCase().includes("pre-send"));
    // Legacy loader assignments must remain harmless on the same record.
    addon.description = "legacy loader snapshot"; assert.match(addon.description, /^LLM-powered/);
});

test("localized language menu keeps persisted target values and distinguishes single and permanent actions", () => {
    let entries, selected;
    const Local = load({React: {createElement: (type, props, ...children) => ({type, props: {...props, children}})}, Webpack: {getStore: () => ({getLocale: () => "en-US"})}});
    const plugin = new Local(); plugin.active = true;
    plugin.api = {ContextMenu: {buildMenu(value) {entries = value;}, open() {}, close() {}}};
    plugin.openMessageLanguageMenu({}, "English", (value, scope) => {selected = {value, scope};});
    const japanese = entries.find(entry => entry.id.endsWith("JPN")).control({}, {});
    assert.equal(japanese.props.children[0].props.children[0], "Japanese");
    assert.match(japanese.props.children[1].props.title, /^Permanently/);
    const event = {preventDefault() {}, stopPropagation() {}};
    japanese.props.children[0].props.onClick(event); assert.deepEqual(selected, {value: "日本語", scope: "message"});
    japanese.props.children[1].props.onClick(event); assert.deepEqual(selected, {value: "日本語", scope: "automatic"});
});

test("live Discord locale subscription refreshes cached message UI and releases on plugin stop", async () => {
    const listeners = new Set(); let locale = "zh-CN";
    class Api {
        static Webpack = {getStore: name => name === "LocaleStore" ? {getLocale: () => locale,
            addChangeListener: callback => listeners.add(callback), removeChangeListener: callback => listeners.delete(callback)} : null};
        Data = {load: () => ({autoTranslate: true})};
        DOM = {addStyle() {}, removeStyle() {}};
        ContextMenu = {patch: () => () => {}};
    }
    const Local = load(Api), plugin = new Local(); plugin.start();
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "This is the original message")];
    plugin.autoTranslator = new Local.testing.AutoTranslator(chat.client, plugin.settings, chat.auto.env);
    plugin.autoTranslator.running = true;
    for (let i = 0; i < 8; i++) {plugin.autoTranslator.scan(); await new Promise(setImmediate);}
    const entry = plugin.autoTranslator.entries.get(chat.document.nodes[0]);
    assert.match(entry.languageBadge.title, /本条消息原文语言/);
    locale = "en-US"; for (const listener of [...listeners]) listener();
    assert.match(entry.languageBadge.title, /Original language: English/);
    assert.equal(chat.calls.length, 1); assert.equal(entry.result, "translated: This is the original message");
    assert.equal(plugin.settings.targetLanguage, "简体中文");
    assert.equal(listeners.size, 1); plugin.stop(); assert.equal(listeners.size, 0);
});

test("catalog keys and interpolation tokens match English and no runtime localization uses model requests", () => {
    const catalogs = Plugin.testing.UI_MESSAGES;
    const keys = Object.keys(catalogs.en).sort();
    const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [locale, catalog] of Object.entries(catalogs)) {
        assert.deepEqual(Object.keys(catalog).sort(), keys, locale);
        for (const key of keys) {
            assert.ok(typeof catalog[key] === "string" && catalog[key].trim(), `${locale}: ${key}`);
            assert.deepEqual(parameters(catalog[key]), parameters(catalogs.en[key]), `${locale}: ${key}`);
        }
    }
    const Local = load({Webpack: {getStore: () => ({getLocale: () => "en-US"})}, Net: {fetch() {throw Error("UI must not call model");}}});
    for (const key of keys) Local.testing.t(key);
    assert.throws(() => Local.testing.validateSettings({timeoutSeconds: 1}), /Timeout \(seconds\) must be an integer/);
});

test("disabled settings panel edits and saves the API address and repairs invalid saved data", () => {
    const host = settingsHost({baseUrl: "not-a-url"});
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    const input = find(tree, node => node.type === "input" && node.props.value === "not-a-url");
    assert.equal(input.props.disabled, false);
    input.props.onChange({target: {value: "http://localhost:9090/v1/chat/completions"}});
    tree = host.render(panel);
    const save = find(tree, node => node.type === "button" && node.props.children[0] === "保存设置");
    assert.equal(save.props.disabled, false);
    save.props.onClick();
    assert.equal(host.writes.length, 1);
    assert.equal(host.writes[0].value.baseUrl, "http://localhost:9090/v1");
    assert.equal(host.plugin.settings.baseUrl, "http://localhost:9090/v1");
});

test("all six settings accept edits through input events with deferred React updates", () => {
    const host = settingsHost({}, {deferUpdates: true});
    host.plugin.active = true;
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    const changes = {baseUrl: "http://localhost:9090/v1/chat/completions", model: "my-model",
        apiKey: "test-key", targetLanguage: "日本語", timeoutSeconds: "240", maxTokens: "4096"};
    for (const [key, value] of Object.entries(changes)) {
        const input = find(tree, node => ["input", "select"].includes(node.type) && node.props.name === key);
        if (key === "targetLanguage") {
            assert.equal(input.type, "select");
            assert.equal(input.props.value, "简体中文");
            assert.equal(input.props.children[0].props.value, "简体中文");
        }
        assert.equal(input.props.disabled, false);
        // Native typing/paste fires input even when host change detection differs.
        const target = {value};
        input.props.onInput({currentTarget: target, target});
        // Simulate the DOM target being restored before batched updaters execute.
        target.value = input.props.value;
        tree = host.render(panel);
        assert.equal(find(tree, node => node.props?.name === key).props.value, value);
    }
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(host.writes.length, 2);
    assert.equal(host.writes.at(-1).value.baseUrl, "http://localhost:9090/v1");
    for (const key of ["model", "apiKey", "targetLanguage"]) assert.equal(host.writes.at(-1).value[key], changes[key]);
    assert.equal(host.writes.at(-1).value.timeoutSeconds, 240);
    assert.equal(host.writes.at(-1).value.maxTokens, 4096);
});

test("numeric settings can be cleared and retyped without resetting other unsaved inputs", () => {
    const host = settingsHost({}, {deferUpdates: true});
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    const input = key => find(tree, node => node.props?.name === key);
    input("model").props.onInput({target: {value: "unsaved model"}});
    input("timeoutSeconds").props.onInput({target: {value: ""}});
    tree = host.render(panel);
    assert.equal(input("timeoutSeconds").props.value, "");
    assert.equal(input("model").props.value, "unsaved model");
    for (const value of ["3", "30", "300"]) {
        input("timeoutSeconds").props.onInput({target: {value}});
        tree = host.render(panel);
        assert.equal(input("timeoutSeconds").props.value, value);
    }
    find(tree, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(host.writes[0].value.timeoutSeconds, 300);
    assert.equal(host.writes[0].value.model, "unsaved model");
});

test("host panel rerenders reuse the same component and keep unsaved input", () => {
    const host = settingsHost();
    const first = host.plugin.getSettingsPanel();
    let tree = host.render(first);
    find(tree, node => node.props?.name === "model").props.onInput({target: {value: "draft model"}});
    const second = host.plugin.getSettingsPanel();
    assert.equal(first.type, second.type);
    tree = host.render(second);
    assert.equal(find(tree, node => node.props?.name === "model").props.value, "draft model");
});

test("focus guard protects only plugin panels at window capture and cleans up on stop", () => {
    const listeners = new Map();
    const target = {addEventListener(type, listener, capture) {
        assert.equal(capture, true); listeners.set(type, listener);
    }, removeEventListener(type, listener, capture) {
        assert.equal(capture, true); assert.equal(listeners.get(type), listener); listeners.delete(type);
    }};
    const LocalPlugin = load(undefined, {document: {defaultView: target}});
    const plugin = new LocalPlugin();
    plugin.installInputFocusGuard();
    plugin.installInputFocusGuard();
    assert.equal(listeners.size, 4);
    const input = {closest: selector => selector === '[data-local-translator-panel]' ? {} : null};
    const unrelated = {closest: () => null};
    let blocked = 0;
    for (const handler of listeners.values()) {
        handler({target: input, stopImmediatePropagation() {blocked++;}});
        handler({target: unrelated, relatedTarget: input, stopImmediatePropagation() {blocked++;}});
        handler({target: unrelated, relatedTarget: unrelated, stopImmediatePropagation() {blocked++;}});
    }
    assert.equal(blocked, 8);
    plugin.stop();
    assert.equal(listeners.size, 0);
    plugin.installInputFocusGuard();
    assert.equal(listeners.size, 4);
});

test("manual translator has a language dropdown initially set to English", () => {
    const host = settingsHost();
    host.plugin.getSettingsPanel();
    const tree = host.render({type: host.plugin.translationComponent(), props: {initialText: "hello", autoStart: false}});
    const select = find(tree, node => node.type === "select");
    assert.equal(select.props.value, "English");
    assert.ok(select.props.children[0].length >= 10);
    assert.ok(select.props.children[0].some(option => option.props.value === "日本語"));
});

function chatEnvironment() {
    const container = {};
    const document = {
        hidden: false, nodes: [], querySelectorAll() {return this.nodes;},
        createTextNode: text => ({nodeType: 3, textContent: text}),
        createElement() {
            return {isConnected: false, parentElement: null, children: [], setAttribute() {},
                append(...children) {this.children.push(...children);}, remove() {this.isConnected = false;},
                getClientRects: () => [bounds], getBoundingClientRect: () => bounds, getAttribute: () => null};
        }
    };
    const bounds = {top: 10, bottom: 30, left: 10, right: 100};
    const env = {document, innerHeight: 800, innerWidth: 1200, clearTimeout() {},
        getComputedStyle: () => ({display: "block", visibility: "visible", opacity: "1", overflowY: "visible", overflowX: "visible"})};
    function message(id, text, channelId = "channel") {
        const row = {id: `chat-messages-${channelId}-${id}`, querySelector: () => null};
        const classes = new Set();
        return {id: `message-content-${id}`, innerText: text, isConnected: true, parentElement: null,
            get textContent() {return this.innerText;},
            classList: {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)},
            closest(selector) {
                if (selector === '[id^="chat-messages-"]') return row;
                if (selector.includes("data-list-id")) return container;
                return null;
            },
            getClientRects: () => classes.has("lt-original-hidden") ? [] : [bounds], getBoundingClientRect: () => bounds,
            getAttribute: () => null, insertAdjacentElement(position, output) {output.isConnected = true;}
        };
    }
    const calls = [];
    const client = {active: 0, async translate(text) {calls.push(text); return `translated: ${text}`;}};
    const auto = new AutoTranslator(client, {...DEFAULTS, autoTranslate: true}, env);
    auto.running = true;
    async function drain() {
        for (let index = 0; index < 20; index++) {auto.scan(); await new Promise(setImmediate);}
    }
    return {document, auto, message, calls, drain, client};
}

test("new messages and replaced DOM nodes do not retranslate completed messages", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "first"), chat.message("2", "second")];
    await chat.drain();
    chat.document.nodes.forEach(node => {node.isConnected = false;});
    chat.document.nodes = [chat.message("1", "first"), chat.message("2", "second"), chat.message("3", "new")];
    await chat.drain();
    assert.deepEqual(chat.calls, ["first", "second", "new"]);
    for (const entry of chat.auto.entries.values()) assert.equal(entry.output.isConnected, true);
    chat.document.nodes[0].innerText = "edited first";
    await chat.drain();
    assert.deepEqual(chat.calls, ["first", "second", "new", "edited first"]);
});

test("scroll away and back, and auto off/on, retain results", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "first")];
    await chat.drain();
    chat.document.nodes[0].isConnected = false;
    chat.document.nodes = [];
    await chat.drain();
    chat.document.nodes = [chat.message("1", "first")];
    await chat.drain();
    chat.auto.setAutoTranslation(false);
    assert.equal(chat.auto.entries.get(chat.document.nodes[0]).output, null);
    chat.auto.setAutoTranslation(true);
    await chat.drain();
    assert.deepEqual(chat.calls, ["first"]);
});

test("saving unchanged settings preserves completed translations", () => {
    const host = settingsHost();
    host.plugin.getSettingsPanel();
    let restarted = 0;
    host.plugin.restartAutoTranslation = () => restarted++;
    host.plugin.saveSettings({...host.plugin.settings});
    assert.equal(restarted, 0);
    host.plugin.saveSettings({...host.plugin.settings, baseUrl: "http://localhost:9090/v1"});
    assert.equal(restarted, 1);
});

test("A to B to A restores A even after B exceeds the former global history limit", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "A first", "A"), chat.message("2", "A second", "A")];
    await chat.drain();
    chat.document.nodes.forEach(node => {node.isConnected = false;});
    // Process a busy channel in batches, as messages are mounted during scrolling.
    for (let batch = 0; batch < 110; batch++) {
        chat.document.nodes.forEach(node => {node.isConnected = false;});
        chat.document.nodes = Array.from({length: 10}, (_, index) =>
            chat.message(String(100 + batch * 10 + index), `B ${batch * 10 + index}`, "B"));
        await chat.drain();
    }
    assert.equal(chat.calls.length, 1102);
    assert.equal(chat.auto.history.get("B").size, 500);
    chat.document.nodes.forEach(node => {node.isConnected = false;});
    chat.document.nodes = [chat.message("1", "A first", "A"), chat.message("2", "A second", "A"),
        chat.message("3", "A new", "A")];
    await chat.drain();
    assert.equal(chat.calls.length, 1103);
    assert.equal(chat.calls.at(-1), "A new");
    assert.equal(chat.auto.entries.get(chat.document.nodes[0]).result, "translated: A first");
    assert.equal(chat.auto.entries.get(chat.document.nodes[1]).output.isConnected, true);
});

test("a response completing immediately after navigation is retained for the return visit", async () => {
    const chat = chatEnvironment();
    let complete;
    chat.client.translate = text => {
        chat.calls.push(text);
        return new Promise(resolve => {complete = resolve;});
    };
    const node = chat.message("1", "A first", "A");
    chat.document.nodes = [node];
    chat.auto.scan();
    await new Promise(setImmediate);
    node.isConnected = false;
    chat.document.nodes = [];
    complete("finished before next scan");
    await new Promise(setImmediate);
    chat.document.nodes = [chat.message("1", "A first", "A")];
    await chat.drain();
    assert.deepEqual(chat.calls, ["A first"]);
    assert.equal(chat.auto.entries.get(chat.document.nodes[0]).result, "finished before next scan");
});

test("returning to an edited message translates its new source", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "original", "A")];
    await chat.drain();
    chat.document.nodes[0].isConnected = false;
    chat.document.nodes = [chat.message("2", "other channel", "B")];
    await chat.drain();
    chat.document.nodes[0].isConnected = false;
    chat.document.nodes = [chat.message("1", "edited", "A")];
    await chat.drain();
    assert.deepEqual(chat.calls, ["original", "other channel", "edited"]);
});

test("auto translations hide originals, stay visible to scanning, and restore on toggle and stop", async () => {
    const chat = chatEnvironment();
    const node = chat.message("1", "original");
    chat.document.nodes = [node];
    await chat.drain();
    assert.equal(node.classList.contains("lt-original-hidden"), true);
    assert.equal(chat.auto.isShown(node), true);
    assert.equal(chat.auto.originalFor("1", "channel"), "original");
    assert.equal(chat.auto.originalFor("1", "different-channel"), null);
    assert.deepEqual(chat.calls, ["original"]);
    chat.auto.toggle(node);
    assert.equal(node.classList.contains("lt-original-hidden"), false);
    chat.auto.toggle(node);
    await chat.drain();
    assert.equal(node.classList.contains("lt-original-hidden"), true);
    chat.auto.stop();
    assert.equal(node.classList.contains("lt-original-hidden"), false);
});

test("hidden original whitespace and removed output do not trigger translation again", async () => {
    const chat = chatEnvironment();
    const node = chat.message("1", "first\nsecond");
    Object.defineProperty(node, "textContent", {get: () => "firstsecond"});
    chat.document.nodes = [node];
    await chat.drain();
    Object.defineProperty(node, "innerText", {get: () => node.classList.contains("lt-original-hidden") ? "firstsecond" : "first\nsecond"});
    await chat.drain();
    const entry = chat.auto.entries.get(node);
    entry.output.remove();
    await chat.drain();
    assert.deepEqual(chat.calls, ["first\nsecond"]);
    assert.equal(entry.output.isConnected, true);
    assert.equal(node.classList.contains("lt-original-hidden"), true);
});

test("manual translations keep original visible when automatic mode is disabled", async () => {
    const chat = chatEnvironment();
    chat.auto.settings.autoTranslate = false;
    const node = chat.message("1", "original");
    chat.document.nodes = [node];
    chat.auto.toggle(node);
    await chat.drain();
    assert.equal(node.classList.contains("lt-original-hidden"), false);
    assert.equal(chat.auto.entries.get(node).output.isConnected, true);
    chat.auto.setAutoTranslation(true);
    assert.equal(node.classList.contains("lt-original-hidden"), true);
    chat.auto.setAutoTranslation(false);
    assert.equal(node.classList.contains("lt-original-hidden"), false);
    assert.deepEqual(chat.calls, ["original"]);
});

test("failed automatic translation leaves original visible", async () => {
    const chat = chatEnvironment();
    chat.client.translate = async () => {throw new Error("offline");};
    const node = chat.message("1", "original");
    chat.document.nodes = [node];
    await chat.drain();
    assert.equal(node.classList.contains("lt-original-hidden"), false);
    assert.equal(chat.auto.entries.get(node).state, "error");
});

test("message context menu opens the selected original without requesting translation", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "first original"), chat.message("2", "second original")];
    await chat.drain();
    const host = settingsHost();
    host.plugin.getSettingsPanel();
    host.plugin.active = true;
    host.plugin.autoTranslator = chat.auto;
    const tree = {props: {navId: "message", children: []}};
    host.plugin.patchMessageMenu(tree, {message: {id: "2"}, channel: {id: "channel"}});
    const originalItem = find(tree, node => node.props?.id === "local-translator-original");
    assert.equal(originalItem.props.label, "查看原文");
    originalItem.props.action();
    assert.equal(host.alerts[0].title, "消息原文");
    assert.equal(host.alerts[0].content.props.children[0].props.children[0], "second original");
    assert.deepEqual(chat.calls, ["first original", "second original"]);
    const untranslated = {props: {navId: "message", children: []}};
    host.plugin.patchMessageMenu(untranslated, {message: {id: "3"}, channel: {id: "channel"}});
    assert.equal(find(untranslated, node => node.props?.id === "local-translator-original"), undefined);
});

function glossaryFixture(t, entries) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localtranslator-glossary-test-"));
    const file = path.join(directory, "terms.json");
    const write = values => fs.writeFileSync(file, JSON.stringify({version: 1, name: "Test glossary", entries: values}), "utf8");
    write(entries);
    t.after(() => {assert.equal(path.dirname(file), directory); fs.unlinkSync(file); fs.rmdirSync(directory);});
    return {file, write};
}

test("local glossary matches aliases and Chinese names without matching parts of ordinary words", async t => {
    const fixture = glossaryFixture(t, [
        {game: "Wuthering Waves", category: "character", en: "Iuno", zh: "尤诺"},
        {en: "signature weapon", zh: "专武", aliases: ["sig"]},
        {en: "SilverAsh", zh: "银灰"}, {en: "damage per second", zh: "每秒伤害", aliases: ["DPS"]}
    ]);
    const store = new GlossaryStore();
    const result = await store.select(fixture.file, "Iuno's SIG is great, 尤诺真好。", {before: [{text: "DPS"}]});
    assert.deepEqual(Array.from(result.entries, item => item.en), ["signature weapon", "Iuno", "damage per second"]);
    const unrelated = await store.select(fixture.file, "signal assigned", {});
    assert.equal(unrelated.entries.length, 0);
});

test("glossary file edits are read on the next request and invalid files show actionable errors", async t => {
    const fixture = glossaryFixture(t, [{en: "Iuno", zh: "尤诺"}]);
    const store = new GlossaryStore();
    const first = await store.select(fixture.file, "Iuno", {});
    fixture.write([{en: "Iuno", zh: "自定义译名"}]);
    const second = await store.select(fixture.file, "Iuno", {});
    assert.equal(second.entries[0].zh, "自定义译名");
    assert.notEqual(first.version, second.version);
    await assert.rejects(store.load("relative.json"), /绝对路径/);
    await assert.rejects(store.load(path.join(path.dirname(fixture.file), "missing.json")), /无法读取/);
    fs.writeFileSync(fixture.file, "null");
    await assert.rejects(store.load(fixture.file), /version/);
    fs.writeFileSync(fixture.file, "{broken}");
    await assert.rejects(store.load(fixture.file), /JSON 格式错误/);
    fixture.write([{en: "Iuno", zh: "尤诺", aliases: "invalid"}]);
    await assert.rejects(store.load(fixture.file), /aliases/);
});

test("glossary loading also supports BetterDiscord filesystem bridges without promises", async t => {
    const fixture = glossaryFixture(t, [{en: "Iuno", zh: "尤诺"}]);
    const store = new GlossaryStore();
    store.fs = {statSync: fs.statSync, readFileSync: fs.readFileSync};
    const result = await store.select(fixture.file, "Iuno", {});
    assert.equal(result.entries[0].zh, "尤诺");
});

test("forum bindings inherit by ID, individual thread overrides and disabled thread bindings take precedence", () => {
    const channels = {"100": {id: "100", name: "mods", type: 15}, "101": {id: "101", parent_id: "100", type: 11},
        "102": {id: "102", name: "same-name channel", type: 0}};
    const LocalPlugin = load({Webpack: {getStore: () => ({getChannel: id => channels[id]})}});
    const plugin = new LocalPlugin();
    plugin.settings.customAreas = {"100": {name: "old forum name", enabled: true, glossaryPath: "parent.json"}};
    assert.equal(plugin.areaBinding("101").glossaryPath, "parent.json");
    assert.equal(plugin.areaBinding("102"), null);
    channels["100"].name = "renamed forum";
    assert.equal(plugin.areaBinding("101").glossaryPath, "parent.json");
    plugin.settings.customAreas["101"] = {name: "thread", enabled: true, glossaryPath: "thread.json"};
    assert.equal(plugin.areaBinding("101").glossaryPath, "thread.json");
    plugin.settings.customAreas["101"].enabled = false;
    assert.equal(plugin.areaBinding("101"), null);
    delete plugin.settings.customAreas["101"];
    assert.equal(plugin.areaBinding("101").glossaryPath, "parent.json");
});

test("area context menu registers a channel and settings show its editable glossary path", () => {
    const host = settingsHost();
    host.plugin.getSettingsPanel();
    host.plugin.active = true;
    const channel = {id: "10001", type: 11, name: "Wuthering Waves"};
    const menu = {props: {navId: "thread-context", children: []}};
    host.plugin.patchAreaMenu(menu, {channel});
    host.plugin.patchAreaMenu(menu, {channel});
    assert.equal(menu.props.children.length, 1);
    const item = find(menu, node => node.props?.id === "local-translator-custom-area");
    assert.equal(item.props.label, "打开自定义翻译");
    item.props.action();
    assert.equal(host.plugin.settings.customAreas[channel.id].enabled, true);
    assert.equal(path.basename(host.plugin.settings.customAreas[channel.id].glossaryPath), "wuthering-waves.json");
    const tree = host.render(host.plugin.getSettingsPanel());
    const input = find(tree, node => node.props?.name === "glossary-10001");
    const value = path.join(__dirname, "my-custom-terms.json");
    input.props.onInput({currentTarget: {value}});
    const updated = host.render(host.plugin.getSettingsPanel());
    find(updated, node => node.type === "button" && node.props.children[0] === "保存设置").props.onClick();
    assert.equal(host.plugin.settings.customAreas[channel.id].glossaryPath, value);
});

test("changing a glossary path invalidates only the affected area and inherited threads", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "A", "100"), chat.message("2", "thread", "101"), chat.message("3", "unrelated", "200")];
    await chat.drain();
    const host = settingsHost();
    host.plugin.getSettingsPanel();
    host.plugin.autoTranslator = chat.auto;
    host.plugin.settings.autoTranslate = true;
    host.plugin.channelStore = {getChannel: id => id === "101" ? {parent_id: "100"} : {}};
    host.plugin.saveSettings({...host.plugin.settings, customAreas: {"100": {name: "A", enabled: true, glossaryPath: "new-path.json"}}});
    assert.equal(chat.auto.entries.has(chat.document.nodes[2]), true);
    assert.deepEqual(chat.calls, ["A", "thread", "unrelated"]);
    await chat.drain();
    assert.deepEqual(chat.calls, ["A", "thread", "unrelated", "A", "thread"]);
});

test("automatic translation forwards matched glossary references and cancels before generation", async () => {
    const chat = chatEnvironment();
    chat.auto.getGlossary = async () => ({name: "game", version: "1", entries: [{en: "Iuno", zh: "尤诺"}]});
    let received;
    chat.client.translate = async (text, settings, signal, context) => {received = context; return "尤诺";};
    chat.document.nodes = [chat.message("1", "Iuno")];
    await chat.drain();
    assert.equal(received.glossary.entries[0].zh, "尤诺");
    const cancelled = chatEnvironment();
    let finish;
    cancelled.auto.getGlossary = () => new Promise(resolve => {finish = resolve;});
    cancelled.document.nodes = [cancelled.message("1", "Iuno")];
    cancelled.auto.scan();
    cancelled.auto.stop();
    finish({entries: [{en: "Iuno", zh: "尤诺"}]});
    await new Promise(setImmediate);
    assert.equal(cancelled.calls.length, 0);
});

test("model requests retain glossary references on retry and file versions separate the cache", async () => {
    const requests = [];
    const client = new TranslationClient(async (url, options) => {
        const request = JSON.parse(options.body); requests.push(request);
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content: requests.length === 1 ? "Translation: wrong\nextra" : "尤诺"}}]}))};
    });
    const settings = {...DEFAULTS, model: "local"};
    const context = {before: [{text: "some dialogue"}], after: [], glossary: {name: "game", version: "1", entries: [{en: "Iuno", zh: "尤诺"}]}};
    assert.equal(await client.translate("Iuno", settings, undefined, context), "尤诺");
    assert.equal(requests.length, 2);
    for (const request of requests) {
        const glossary = request.messages.find(message => message.content.startsWith("LOCAL TERMINOLOGY REFERENCE"));
        assert.equal(glossary.role, "system");
        assert.ok(glossary.content.includes('"zh":"尤诺"'));
        assert.deepEqual(request.messages.filter(message => message.role === "user"), [{role: "user", content: "Iuno"}]);
    }
    await client.translate("Iuno", settings, undefined, context);
    assert.equal(requests.length, 2);
    await client.translate("Iuno", settings, undefined, {...context, glossary: {...context.glossary, version: "2"}});
    assert.equal(requests.length, 3);
});

test("bundled glossaries contain current character, skill and resource names and validate", async () => {
    const store = new GlossaryStore();
    const ww = await store.load(path.join(__dirname, "glossaries", "wuthering-waves.json"));
    const ak = await store.load(path.join(__dirname, "glossaries", "arknights-endfield.json"));
    assert.ok(ww.entries.length > 2000);
    assert.ok(ak.entries.length > 4000);
    for (const [en, zh] of [["Iuno", "尤诺"], ["Augusta", "奥古斯塔"], ["Astrite", "星声"]]) {
        assert.ok(ww.entries.some(entry => entry.value.en === en && entry.value.zh === zh));
    }
    assert.ok(ak.entries.some(entry => entry.value.en === "Amiya" && entry.value.zh === "阿米娅"));
    assert.ok(ak.entries.some(entry => entry.value.en === "Endministrator" && entry.value.zh === "管理员"));
    for (const game of ["Arknights", "Arknights: Endfield"]) {
        for (const category of ["character", "skill", "resource"]) assert.ok(ak.entries.some(entry => entry.value.game === game && entry.value.category === category));
    }
    const selected = await store.select(path.join(__dirname, "glossaries", "wuthering-waves.json"), "Iuno's sig and Astrite", {});
    assert.ok(selected.entries.some(entry => entry.en === "Iuno"));
    assert.ok(selected.entries.some(entry => entry.en === "signature weapon"));
    assert.ok(selected.entries.length <= 60);
});

test("raw stored Markdown is translated and real edits invalidate history without DOM changes", async () => {
    const chat = chatEnvironment();
    let content = "**Iuno** [guide](https://example.com) `code` <@123>\n```js\nx()\n```";
    chat.auto.sources.readMessage = (channel, id) => ({id, channel_id: channel, content, author: {id: "author-1"}});
    chat.document.nodes = [chat.message("1", "Iuno guide code rendered text")];
    await chat.drain(); assert.equal(chat.calls[0], content);
    await chat.drain(); assert.equal(chat.calls.length, 1);
    content = "**Edited original**";
    await chat.drain(); assert.deepEqual(chat.calls, ["**Iuno** [guide](https://example.com) `code` <@123>\n```js\nx()\n```", content]);
});

test("automatic context uses loaded offscreen reply before glossary selection and excludes another channel", async t => {
    const chat = chatEnvironment();
    const fixture = glossaryFixture(t, [{en: "Iuno", zh: "尤诺"}]);
    const reply = {id: "10", channelId: "channel", text: "Iuno is fun", speaker: "author-1", sentAt: null};
    chat.auto.sources.readReply = () => reply;
    chat.auto.sources.loadedMessages = () => [
        {id: "10", channel_id: "channel", content: "Iuno is fun", author: {id: "author-1"}},
        {id: "11", channel_id: "channel", content: "previous offscreen", author: {id: "author-2"}},
        {id: "12", channel_id: "other", content: "private other panel"}
    ];
    chat.auto.getGlossary = async (channel, text, context) => new GlossaryStore().select(fixture.file, text, context);
    let received;
    chat.client.translate = async (text, settings, signal, context) => {received = context; return "同意";};
    chat.document.nodes = [chat.message("13", "I agree")];
    // Unknown timestamps use stable loaded order; include the target in that loaded list.
    const provider = chat.auto.sources.loadedMessages;
    chat.auto.sources.loadedMessages = () => [...provider(), {id: "13", channel_id: "channel", content: "I agree"}]
        .map(message => ({...message, timestamp: new Date(Number(message.id) * 1000)}));
    const synchronousStore = new GlossaryStore();
    synchronousStore.fs = {statSync: fs.statSync, readFileSync: fs.readFileSync};
    chat.auto.getGlossary = async (channel, text, context) => synchronousStore.select(fixture.file, text, context);
    await chat.drain();
    assert.equal(received.reply.text, "Iuno is fun");
    assert.equal(received.glossary.entries[0].en, "Iuno");
    assert.ok(received.before.some(item => item.text === "previous offscreen"));
    assert.ok(!JSON.stringify(received).includes("private other panel"));
    assert.equal(received.before.find(item => item.id === "10").reference, "reply");
    assert.equal(received.before.find(item => item.id === "10").text, undefined);
});

test("message reference lookup supports camel/snake fields, embedded original and explicitly missing reply", () => {
    let target = {id: "1", channel_id: "101", messageReference: {message_id: "2", channel_id: "101"}};
    const LocalPlugin = load({Webpack: {getStore: () => ({getMessage: (channel, id) => id === "1" ? target : null})}});
    const plugin = new LocalPlugin();
    assert.equal(plugin.readReply("101", "1").missing, true);
    target = {...target, messageReference: undefined, message_reference: {message_id: "2"},
        referenced_message: {id: "2", channel_id: "101", content: "**Original**", author: {id: "speaker"}}};
    assert.equal(plugin.readReply("101", "1").text, "**Original**");
    assert.equal(plugin.readReply("101", "1").speaker, "speaker");
});

test("reference sorting uses exact snowflake order, deduplicates and keeps speaker and truncation metadata", () => {
    const {referenceContext} = Plugin.testing;
    const records = [
        {id: "1557000000000000003", channelId: "101", text: "after", sentAt: "2026-10-13T00:00:00.000Z", speaker: "B"},
        {id: "1557000000000000001", channelId: "101", text: "x".repeat(1200), sentAt: "2026-10-13T00:00:00.000Z", speaker: "A"},
        {id: "1557000000000000002", channelId: "101", text: "target", sentAt: "2026-10-13T00:00:00.000Z"},
        {id: "99", channelId: "other", text: "wrong channel"}
    ];
    const result = referenceContext(records[2], [...records, records[0]]);
    assert.equal(result.before[0].id, records[1].id); assert.equal(result.before[0].speaker, "A");
    assert.equal(result.before[0].truncated, true); assert.equal(result.after.length, 1);
    assert.equal(result.after[0].id, records[0].id);
});

test("outgoing references prefer chronologically latest loaded messages over the old scrolled DOM", () => {
    const messages = Array.from({length: 9}, (_, index) => ({id: String(index + 1), channel_id: "101", content: `message ${index + 1}`,
        timestamp: new Date(1000 * (index + 1)), author: {id: String(index % 2)}})).reverse();
    const LocalPlugin = load({Webpack: {getStore: name => name === "MessageStore" ? {getMessages: () => ({toArray: () => messages})} : null}});
    const context = new LocalPlugin().outgoingContext("101");
    assert.deepEqual(Array.from(context.before, item => item.text), ["message 4", "message 5", "message 6", "message 7", "message 8", "message 9"]);
    assert.equal(context.target.draft, true);
});

function recordingClient(outputs = ["translated"]) {
    const requests = [];
    const client = new TranslationClient(async (url, options) => {
        requests.push(JSON.parse(options.body));
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content: outputs[Math.min(requests.length - 1, outputs.length - 1)]}}],
            usage: {prompt_tokens: 123, completion_tokens: 7}}))};
    });
    return {client, requests, settings: {...DEFAULTS, model: "test-model"}};
}

test("draft cache excludes request creation time and unrelated switches but retains semantic references", async () => {
    const {client, requests, settings} = recordingClient();
    const context = {target: {draft: true, sentAt: "2026-10-13T00:00:00Z"}, before: [{id: "1", text: "before", sentAt: "2026-10-12T00:00:00Z"}], reply: {id: "2", text: "quoted"}};
    await client.translate("source", settings, undefined, context);
    await client.translate("source", {...settings, outgoingTranslate: true, autoTranslate: true}, undefined,
        {...context, target: {...context.target, sentAt: "2026-10-13T01:00:00Z"}});
    assert.equal(requests.length, 1); assert.equal(client.stats.cacheHits, 1);
    await client.translate("source", settings, undefined, {...context, reply: {...context.reply, text: "changed quote"}});
    await client.translate("source", settings, undefined, {...context, before: [{...context.before[0], sentAt: "2026-10-11T00:00:00Z"}]});
    await client.translate("source", {...settings, targetLanguage: "English"}, undefined, context);
    assert.equal(requests.length, 4);
});

test("normal multiline translations generate once; explicit abnormal output repairs once while retaining reply", async () => {
    const normal = recordingClient(["first line\nsecond line"]);
    assert.equal(await normal.client.translate("source", normal.settings, undefined, {before: [{text: "context"}]}), "first line\nsecond line");
    assert.equal(normal.requests.length, 1);
    const abnormal = recordingClient(["Translation: wrong", "Translation: still wrong"]);
    await assert.rejects(abnormal.client.translate("source", abnormal.settings, undefined,
        {before: [{text: "nearby"}], reply: {id: "1", text: "quoted original"}}), /模型输出可能混入/);
    assert.equal(abnormal.requests.length, 2);
    for (const request of abnormal.requests) assert.ok(JSON.stringify(request.messages).includes("quoted original"));
    assert.equal(abnormal.client.stats.repairs, 1);
});

test("one combined budget preserves target, prioritizes reply/direct terms and limits every repair payload", async () => {
    const {client, requests, settings} = recordingClient(["Translation: wrong", "valid"]);
    const source = "I agree with Iuno";
    const context = {reply: {id: "1", text: "Iuno " + "quoted ".repeat(900)},
        before: Array.from({length: 6}, (_, index) => ({id: String(index + 2), text: "nearby ".repeat(1000)})),
        glossary: {name: "test", version: "1", entries: [{en: "Iuno", zh: "尤诺"}, ...Array.from({length: 60}, (_, index) => ({en: `nearby ${index}`, zh: "不相关".repeat(30)}))],
            priorities: ["direct", ...Array(60).fill("nearby")]}};
    const limited = {...settings, contextTokens: 4096, maxTokens: 1024};
    await client.translate(source, limited, undefined, context);
    for (const request of requests) {
        assert.ok(client.estimate(request.messages) <= limited.contextTokens - limited.maxTokens);
        assert.equal(request.messages.at(-1).content, source);
        const reference = JSON.parse(request.messages.find(message => message.content.startsWith("REFERENCE DATA")).content.split("\n").slice(1).join("\n"));
        assert.equal(reference.reply.truncated, true);
        assert.ok(request.messages.some(message => message.content.includes('"en":"Iuno"')));
    }
    await assert.rejects(client.translate("long ".repeat(2100), limited), /输入预算/);
});

test("pure links and mentions skip inference, mixed text still translates and usage reports actual tokens", async () => {
    const {client, requests, settings} = recordingClient();
    const source = "https://example.com <@123> <#456>";
    assert.equal(await client.translate(source, settings), source); assert.equal(requests.length, 0);
    await client.translate("look https://example.com", settings);
    assert.equal(requests.length, 1); assert.equal(client.stats.promptTokens, 123);
    assert.equal(client.stats.completionTokens, 7); assert.equal(client.stats.skipped, 1);
    assert.match(client.usageSummary(), /输入 123 token/);
    assert.equal(client.usageSummary().includes("example.com"), false);
});

test("pending edits, reply changes and unmount abort before generation completes; equal text does not", async () => {
    for (const change of ["draft", "reply", "unmount", "channel"]) {
        const f = outgoingFixture();
        f.outgoing.submission = () => ({channelId: change === "channel" && f.switched ? "102" : "101"});
        let resolve, signal;
        f.plugin.client.translate = (text, settings, activeSignal) => {signal = activeSignal; return new Promise(done => {resolve = done;});};
        const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
        await new Promise(setImmediate); f.outgoing.checkPending(); assert.equal(signal.aborted, false);
        if (change === "draft") f.editor.textContent = "new";
        if (change === "reply") f.setReply({id: "43", text: "changed"});
        if (change === "unmount") f.editor.isConnected = false;
        if (change === "channel") f.switched = true;
        f.outgoing.checkPending(); assert.equal(signal.aborted, true);
        resolve("late result"); await pending;
        assert.equal(f.sent.length, 0); assert.equal(f.outgoing.pending.size, 0);
    }
});

test("single-message refresh bypasses request cache without reloading the whole viewport", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "first"), chat.message("2", "second")];
    const requests = [];
    chat.client.translate = async (text, settings, signal, context) => {requests.push({text, refresh: context.refresh}); return text;};
    await chat.drain(); chat.auto.refresh("1", "channel"); await chat.drain();
    assert.deepEqual(requests.map(item => item.text), ["first", "second", "first"]);
    assert.equal(requests[2].refresh, true);
    const cached = recordingClient();
    await cached.client.translate("same", cached.settings);
    await cached.client.translate("same", cached.settings, undefined, {refresh: true});
    assert.equal(cached.requests.length, 2);
});

test("outgoing store watchers install once and all listeners release on stop", () => {
    const listeners = new Set();
    const store = {addChangeListener: listener => listeners.add(listener), removeChangeListener: listener => listeners.delete(listener)};
    const LocalPlugin = load({Webpack: {getStore: () => store}});
    const plugin = new LocalPlugin();
    const outgoing = new LocalPlugin.testing.OutgoingTranslator(plugin, {document: {querySelectorAll: () => []},
        setTimeout: () => 1, clearTimeout() {}});
    outgoing.start(); outgoing.start(); assert.equal(listeners.size, 3);
    outgoing.stop(); assert.equal(listeners.size, 0);
});

test("R1 bilingual translation identical to nearby or quoted text is accepted in one generation", async () => {
    for (const context of [{before: [{text: "I agree with your opinion."}]}, {reply: {id: "42", text: "I agree with your opinion."}}]) {
        const f = recordingClient(["I agree with your opinion."]);
        assert.equal(await f.client.translate("我同意你的看法。", {...f.settings, targetLanguage: "English"}, undefined, context), "I agree with your opinion.");
        assert.equal(f.requests.length, 1);
    }
});

test("R2 final check rejects changed channel, changed owner and lost identity without another store event", async () => {
    for (const change of ["channel", "owner", "missing", "store-before-react"]) {
        const f = outgoingFixture();
        const owner = {};
        let identity = {channelId: "101", instance: owner};
        f.outgoing.submission = () => identity;
        let finish;
        f.plugin.client.translate = () => new Promise(resolve => {finish = resolve;});
        const pending = f.outgoing.submit("101", [f.payload, f.extra], f.original, f.editor);
        await new Promise(setImmediate);
        if (change === "store-before-react") f.outgoing.checkPending();
        if (change === "channel" || change === "store-before-react") identity = {channelId: "102", instance: owner};
        if (change === "owner") identity = {channelId: "101", instance: {}};
        if (change === "missing") identity = null;
        finish("old result");
        assert.equal((await pending).shouldClear, false); assert.equal(f.sent.length, 0);
    }
});

test("R3 same display with changed serialized mentions cancels via store notification or final check", async () => {
    for (const notify of [true, false]) {
        let draft = "<@111> hello";
        const f = outgoingFixture({getDraft: () => draft, source: draft, display: "@Alex hello"});
        f.outgoing.submission = () => ({channelId: "101", instance: owner});
        const owner = {};
        let finish, signal;
        f.plugin.client.translate = (text, settings, activeSignal) => {signal = activeSignal; return new Promise(resolve => {finish = resolve;});};
        const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
        await new Promise(setImmediate);
        f.outgoing.checkPending(); assert.equal(signal.aborted, false);
        draft = "<@222> hello";
        assert.equal(f.editor.textContent, "@Alex hello");
        if (notify) {f.outgoing.checkPending(); assert.equal(signal.aborted, true);}
        finish("old mention result");
        assert.equal((await pending).shouldClear, false); assert.equal(f.sent.length, 0);
    }
});

test("R3 unchanged raw draft tolerates repeated notifications and still retains attachment parameters", async () => {
    const f = outgoingFixture({getDraft: () => "我要专武"});
    const owner = {state: {textValue: "我要专武"}};
    f.outgoing.submission = () => ({channelId: "101", instance: owner, draftType: 0});
    let finish, signal;
    f.plugin.client.translate = (text, settings, activeSignal) => {signal = activeSignal; return new Promise(resolve => {finish = resolve;});};
    const pending = f.outgoing.submit("101", [f.payload, f.extra], f.original, f.editor);
    await new Promise(setImmediate);
    for (let index = 0; index < 5; index++) f.outgoing.checkPending();
    assert.equal(signal.aborted, false);
    finish("translated");
    assert.equal((await pending).shouldClear, true); assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0][0].attachments, f.payload.attachments); assert.equal(f.sent[0][1], f.extra);
});

test("R3 empty serialized draft and unavailable previously-readable store both invalidate the job", async () => {
    for (const change of ["empty", "unavailable", "composer"]) {
        let draft = "我要专武";
        const f = outgoingFixture({getDraft: () => {
            if (draft === null) throw new Error("store unavailable");
            return draft;
        }});
        const owner = {state: {textValue: "我要专武"}};
        f.outgoing.submission = () => ({channelId: "101", instance: owner});
        let finish, signal;
        f.plugin.client.translate = (text, settings, activeSignal) => {signal = activeSignal; return new Promise(resolve => {finish = resolve;});};
        const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
        await new Promise(setImmediate);
        if (change === "empty") draft = "";
        if (change === "unavailable") draft = null;
        if (change === "composer") owner.state.textValue = "different serialized content";
        f.outgoing.checkPending(); assert.equal(signal.aborted, true);
        finish("late result"); await pending; assert.equal(f.sent.length, 0);
    }
});

test("R2/R3 unavailable raw APIs at start use DOM fallback but still enforce known composer identity", async () => {
    const f = outgoingFixture({getDraft: () => undefined});
    const owner = {};
    f.outgoing.submission = () => ({channelId: "101", instance: owner});
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, true);
    assert.equal(f.sent.length, 1);
    let finish;
    f.plugin.client.translate = () => new Promise(resolve => {finish = resolve;});
    const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
    await new Promise(setImmediate);
    f.outgoing.submission = () => null;
    finish("late result");
    assert.equal((await pending).shouldClear, false); assert.equal(f.sent.length, 1);
});

test("R1 source-authored labels and dialogue remain legal while added dialogue still has one repair", async () => {
    const legitimate = recordingClient(["User: Hello\nAssistant: Hi"]);
    assert.equal(await legitimate.client.translate("用户: 你好\n助手: 嗨", legitimate.settings), "User: Hello\nAssistant: Hi");
    assert.equal(legitimate.requests.length, 1);
    const invalid = recordingClient(["User: Hello\nAssistant: unrelated", "translated"]);
    assert.equal(await invalid.client.translate("你好", invalid.settings, undefined, {reply: {text: "quote"}}), "translated");
    assert.equal(invalid.requests.length, 2);
    assert.ok(invalid.requests[1].messages.some(message => message.content.includes("quote")));
});

function emojiDocument() {
    return {
        createTextNode: text => ({nodeType: 3, textContent: text}),
        createElement: type => ({tagName: type, children: [], className: "", append(...nodes) {this.children.push(...nodes);},
            removeAttribute() {}, replaceWith(node) {this.replacedWith = node;}})
    };
}

test("custom static and animated emoji render as original images beside translated text and Unicode emoji", () => {
    const document = emojiDocument(), container = document.createElement("div");
    const ids = ["1409648830307369061", "1409649023870173377"];
    const originals = ids.map((id, index) => ({src: `https://cdn.discordapp.com/emojis/${id}.${index ? "gif" : "webp"}?size=48`, alt: index ? ":dance:" : ":happy:",
        cloneNode() {return {...document.createElement("img"), src: this.src, alt: this.alt};}}));
    const source = {text: `<:happy:${ids[0]}> <a:dance:${ids[1]}>`, node: {querySelectorAll: () => originals}};
    Plugin.testing.renderMessageEmoji(container, `好耶 <:happy:${ids[0]}> <a:dance:${ids[1]}> 🙂`, source, document);
    const images = container.children.filter(node => node.tagName === "img");
    assert.equal(images.length, 2); assert.notEqual(images[0], originals[0]);
    assert.equal(images[1].src, originals[1].src);
    assert.equal(images[0].alt, ":happy:"); assert.ok(images[0].className.includes("lt-rendered-emoji"));
    assert.equal(container.children.filter(node => node.nodeType === 3).map(node => node.textContent).join(""), "好耶   🙂");
});

test("emoji syntax in inline/fenced code or escaped text stays literal, and HTML is never interpreted", () => {
    const document = emojiDocument(), container = document.createElement("div");
    const token = "<:happy:1409648830307369061>";
    const source = {text: token};
    const text = "<script>alert(1)</script> `" + token + "`\n```js\n" + token + "\n```\n\\" + token + " " + token;
    Plugin.testing.renderMessageEmoji(container, text, source, document);
    assert.equal(container.children.filter(node => node.tagName === "img").length, 1);
    const literal = container.children.filter(node => node.nodeType === 3).map(node => node.textContent).join("");
    assert.equal(literal, text.slice(0, -token.length));
    assert.equal(container.children.some(node => node.tagName === "script"), false);
});

test("missing original images use Discord CDN; unavailable images degrade to the name rather than a code", () => {
    const document = emojiDocument(), container = document.createElement("div");
    const token = "<a:dance:1409649023870173377>";
    Plugin.testing.renderMessageEmoji(container, token + " <:unknown:1409648830307369061>", {text: token}, document);
    const image = container.children.find(node => node.tagName === "img");
    assert.match(image.src, /^https:\/\/cdn\.discordapp\.com\/emojis\/1409649023870173377\.webp/);
    assert.ok(image.src.includes("animated=true"));
    image.onerror(); assert.equal(image.replacedWith.textContent, ":dance:");
    assert.ok(container.children.some(node => node.textContent?.includes("<:unknown:")));
});

test("emoji-only messages skip inference and auto rendering preserves originals on disable", async () => {
    const token = "<:happy:1409648830307369061>";
    const f = recordingClient();
    assert.equal(await f.client.translate(token, f.settings), token); assert.equal(f.requests.length, 0);
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", token)];
    chat.client.translate = async text => text;
    await chat.drain();
    const entry = chat.auto.entries.get(chat.document.nodes[0]);
    assert.ok(entry.output.children[0].children.some(node => node.src?.includes("/emojis/1409648830307369061.webp")));
    assert.equal(entry.sourceHidden, true);
    chat.auto.setAutoTranslation(false);
    assert.equal(entry.sourceHidden, false); assert.equal(entry.output, null);
});

test("T3 spoiler text and emoji start hidden and only reveal after explicit activation", () => {
    const document = emojiDocument(), container = document.createElement("div");
    const token = "<:happy:1409648830307369061>";
    Plugin.testing.renderMessageEmoji(container, `public ||secret ${token}|| public`, {text: token}, document);
    const spoiler = container.children.find(node => node.className === "lt-spoiler");
    assert.ok(spoiler);
    const button = spoiler.children.find(node => node.tagName === "button");
    const hidden = spoiler.children.find(node => node.tagName === "span");
    assert.equal(hidden.hidden, true); button.onclick(); assert.equal(hidden.hidden, false);
    assert.equal(button.hidden, true); assert.ok(hidden.children.some(node => node.tagName === "img"));
});

test("T3 escaped/unclosed inline backticks leave following emoji available; code and escaped spoilers stay literal", () => {
    const token = "<:happy:1409648830307369061>", document = emojiDocument();
    for (const prefix of ["\\` ", "` ", "\\\\` unmatched "]) {
        const container = document.createElement("div");
        Plugin.testing.renderMessageEmoji(container, prefix + token, {text: token}, document);
        assert.equal(container.children.filter(node => node.tagName === "img").length, 1);
    }
    for (const text of [`\`${token}\``, `\`\`${token}\`\``, `\`\`\`\n${token}\n\`\`\``, `\`||secret||\``, "\\||secret||"]) {
        const container = document.createElement("div");
        Plugin.testing.renderMessageEmoji(container, text, {text: token}, document);
        assert.equal(container.children.filter(node => node.tagName === "img" || node.className === "lt-spoiler").length, 0);
    }
});

test("T3 source-authored labels in Japanese and other languages do not cause extra inference", async () => {
    for (const source of ["翻訳：こんにちは", "Traducción: Hola", "Traduction : Bonjour", "Перевод: Привет", "ترجمة: مرحبا"]) {
        const f = recordingClient(["Translation: Hello"]);
        assert.equal(await f.client.translate(source, f.settings), "Translation: Hello"); assert.equal(f.requests.length, 1);
    }
});

test("source language metadata is returned by the same generation, budgeted and retained on cache hits", async () => {
    const f = recordingClient([JSON.stringify({translation: "Hello", sourceLanguage: "JPN"})]);
    const settings = {...f.settings, contextTokens: 4096, maxTokens: 1024};
    assert.equal(await f.client.translate("こんにちは", settings, undefined, {detectLanguage: true}), "Hello");
    assert.equal(f.client.sourceLanguageFor("こんにちは"), "JPN");
    assert.equal(f.requests.length, 1);
    assert.ok(f.client.estimate(f.requests[0].messages) <= settings.contextTokens - settings.maxTokens);
    await f.client.translate("こんにちは", settings, undefined, {detectLanguage: true});
    assert.equal(f.requests.length, 1); assert.equal(f.client.stats.cacheHits, 1);
    const invalid = recordingClient(['{"sourceLanguage":"ENG"}']);
    await assert.rejects(invalid.client.translate("hello", invalid.settings, undefined, {detectLanguage: true}), /未返回有效/);
});

test("language badges live beside the sender header, avoid duplicates and disappear with translation", async () => {
    const chat = chatEnvironment();
    const node = chat.message("1", "This is the original message");
    const header = chat.document.createElement("h3");
    node.closest('[id^="chat-messages-"]').querySelector = selector => selector.includes("h3") ? header : null;
    chat.document.nodes = [node];
    chat.auto.sources.sourceLanguage = () => "ENG";
    await chat.drain();
    const entry = chat.auto.entries.get(node);
    assert.equal(entry.languageBadge.textContent, "ENG"); assert.equal(entry.languageAnchor, header);
    assert.equal(header.children.length, 1);
    await chat.drain(); assert.equal(header.children.length, 1);
    chat.auto.setAutoTranslation(false); assert.equal(entry.languageBadge, null);
});

test("grouped-message badges use their own message and survive history restoration without rerequesting", async () => {
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "こんにちは")];
    await chat.drain();
    const previous = chat.auto.entries.get(chat.document.nodes[0]);
    assert.equal(previous.languageBadge.textContent, "JPN");
    chat.document.nodes[0].isConnected = false;
    chat.document.nodes = [chat.message("1", "こんにちは")];
    await chat.drain(); assert.equal(chat.calls.length, 1);
    assert.equal(chat.auto.entries.get(chat.document.nodes[0]).languageBadge.textContent, "JPN");
    chat.auto.stop();
    assert.equal(previous.languageBadge, null);
});

test("spoiler-only text hides without emoji, animated spoiler hides too, and missing delimiters keep the original", async () => {
    const document = emojiDocument();
    for (const text of ["||secret||", "before ||<a:dance:1409649023870173377>|| after"]) {
        const container = document.createElement("div");
        Plugin.testing.renderMessageEmoji(container, text, {text}, document);
        assert.equal(container.children.find(node => node.className === "lt-spoiler").children[1].hidden, true);
    }
    const chat = chatEnvironment(); chat.document.nodes = [chat.message("1", "||secret||")];
    chat.client.translate = async () => "translated secret without delimiters";
    await chat.drain();
    const entry = chat.auto.entries.get(chat.document.nodes[0]);
    assert.equal(entry.state, "error"); assert.equal(entry.sourceHidden, false);
    assert.equal(entry.bypassCache, true); assert.equal(entry.languageBadge, null);
});

test("editing original language updates its badge; emoji-only original has no language badge", async () => {
    const chat = chatEnvironment(); chat.document.nodes = [chat.message("1", "こんにちは")];
    await chat.drain(); assert.equal(chat.auto.entries.get(chat.document.nodes[0]).languageBadge.textContent, "JPN");
    chat.document.nodes[0].innerText = "This is the original message";
    await chat.drain(); assert.equal(chat.auto.entries.get(chat.document.nodes[0]).languageBadge.textContent, "ENG");
    chat.document.nodes.push(chat.message("2", "<:happy:1409648830307369061>"));
    await chat.drain(); assert.equal(chat.auto.entries.get(chat.document.nodes[1]).languageBadge, null);
});

test("clickable badge changes only its message target and retains original context and glossary", async () => {
    const chat = chatEnvironment(), requests = [];
    const node = chat.message("1", "This is the original message");
    chat.document.nodes = [node, chat.message("2", "nearby original")];
    chat.auto.sources.readReply = () => ({id: "0", channelId: "channel", text: "quoted original"});
    chat.auto.getAreaTopic = () => ({threadTitle: "Wuthering Waves"});
    chat.auto.getGlossary = async () => ({entries: [{en: "Rover", zh: "漂泊者"}]});
    chat.client.translate = async (text, settings, signal, context) => {
        requests.push({text, target: settings.targetLanguage, context}); return `translation in ${settings.targetLanguage}`;
    };
    let select;
    chat.auto.sources.openLanguageMenu = (event, current, callback) => {assert.equal(current, DEFAULTS.targetLanguage); select = callback;};
    await chat.drain();
    const entry = chat.auto.entries.get(node);
    assert.equal(entry.languageBadge.type, "button");
    let prevented = false, stopped = false;
    entry.languageBadge.onclick({preventDefault() {prevented = true;}, stopPropagation() {stopped = true;}});
    assert.ok(prevented && stopped); select("日本語"); await chat.drain();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].text, "This is the original message");
    assert.equal(requests[2].target, "日本語");
    assert.equal(requests[2].context.refresh, true);
    assert.equal(requests[2].context.reply.text, "quoted original");
    assert.equal(requests[2].context.areaTopic.threadTitle, "Wuthering Waves");
    assert.equal(requests[2].context.glossary.entries[0].en, "Rover");
    assert.equal(chat.auto.settings.targetLanguage, DEFAULTS.targetLanguage);
    assert.equal(chat.auto.entries.get(node).languageBadge.textContent, "ENG");
    node.isConnected = false; const restored = chat.message("1", "This is the original message");
    chat.document.nodes = [restored]; await chat.drain();
    assert.equal(requests.length, 3); assert.equal(chat.auto.entries.get(restored).targetLanguage, "日本語");
    chat.auto.refresh("1", "channel"); await chat.drain();
    assert.equal(requests[3].target, "日本語");
});

test("target choice keeps automatic off semantics and stale menus cannot translate edited or stopped entries", async () => {
    const chat = chatEnvironment(), node = chat.message("1", "This is the original message");
    chat.document.nodes = [node]; let select;
    chat.auto.sources.openLanguageMenu = (event, current, callback) => {select = callback;};
    const click = () => chat.auto.entries.get(node).languageBadge.onclick({preventDefault() {}, stopPropagation() {}});
    await chat.drain(); click(); select("日本語"); await chat.drain();
    chat.auto.setAutoTranslation(false); assert.equal(chat.auto.entries.get(node).output, null);
    chat.auto.setAutoTranslation(true); await chat.drain(); click();
    node.innerText = "edited"; select("English");
    assert.equal(chat.calls.length, 2); await chat.drain();
    click(); chat.auto.stop(); select("English"); assert.equal(chat.calls.length, 3);
});

test("new target cancels a pending translation and ignores late results", async () => {
    const chat = chatEnvironment(), node = chat.message("1", "This is the original message");
    chat.document.nodes = [node]; await chat.drain();
    let resolveOld, oldSignal;
    chat.client.translate = (text, settings, signal) => {
        if (settings.targetLanguage === "日本語") {oldSignal = signal; return new Promise(resolve => {resolveOld = resolve;});}
        return Promise.resolve("new English result");
    };
    chat.auto.refresh("1", "channel", "日本語"); await new Promise(setImmediate);
    chat.auto.refresh("1", "channel", "English"); assert.equal(oldSignal.aborted, true);
    resolveOld("late Japanese result"); await chat.drain();
    assert.equal(chat.auto.entries.get(node).result, "new English result");
    assert.equal(chat.auto.channelHistory("channel").get(node.id).targetLanguage, "English");
});

test("native-menu message remount retains the selected message identity", async () => {
    const chat = chatEnvironment(), requests = [];
    const node = chat.message("1", "This is the original message");
    chat.document.nodes = [node]; let select;
    chat.client.translate = async (text, settings) => {requests.push(settings.targetLanguage); return "translation";};
    chat.auto.sources.openLanguageMenu = (event, current, callback) => {select = callback;};
    await chat.drain(); chat.auto.entries.get(node).languageBadge.onclick({preventDefault() {}, stopPropagation() {}});
    node.isConnected = false; chat.document.nodes = [chat.message("1", "This is the original message")];
    await chat.drain(); select("日本語"); await chat.drain();
    assert.deepEqual(requests, [DEFAULTS.targetLanguage, "日本語"]);
});

test("native language menu has clickable full names and one permanent-switch icon per language", () => {
    const MenuPlugin = load({React: {createElement: (type, props, ...children) => ({type, props: {...props, children}})}});
    const plugin = new MenuPlugin(); plugin.active = true;
    let items, opened, chosen;
    let closes = 0;
    plugin.api = {ContextMenu: {buildMenu(value) {items = value; return "menu-component";}, open(event, menu) {opened = {event, menu};}, close() {closes++;}}};
    const event = {target: {}, clientX: 10, clientY: 20};
    plugin.openMessageLanguageMenu(event, "日本語", (value, scope) => {chosen = {value, scope};});
    assert.equal(items.length, 16); assert.equal(opened.event, event); assert.equal(opened.menu, "menu-component");
    const row = code => items.find(item => item.id.endsWith(code)).control({}, {});
    for (const item of items) {
        assert.equal(item.type, "control"); assert.equal(item.action, undefined);
        const children = item.control({}, {}).props.children;
        assert.equal(children[0].type, "button"); assert.equal(typeof children[0].props.onClick, "function");
        assert.equal(children[0].props.children[0], item.control({}, {}).props["aria-label"]);
        assert.equal(children.filter(child => child.type === "button").length, 2);
        for (const button of children.slice(1)) {
            assert.equal(button.props.children[0].type, "svg");
            assert.equal(button.props.children[0].props["aria-hidden"], true);
            assert.ok(button.props.title && button.props["aria-label"]);
        }
    }
    assert.equal(row("JPN").props.children[0].props["aria-pressed"], true);
    assert.equal(row("CHS").props.children[1].props["aria-pressed"], true);
    const click = {preventDefault() {}, stopPropagation() {}};
    row("ENG").props.children[0].props.onClick(click); assert.deepEqual(chosen, {value: "English", scope: "message"});
    row("JPN").props.children[1].props.onClick(click); assert.deepEqual(chosen, {value: "日本語", scope: "automatic"});
    assert.equal(closes, 2);
    plugin.active = false; row("CHS").props.children[1].props.onClick(click); assert.equal(chosen.value, "日本語");
});

test("permanent language choice dispatches separately from single-message refresh", async () => {
    const chat = chatEnvironment(), node = chat.message("1", "This is the original message");
    chat.document.nodes = [node]; let select, target;
    chat.auto.sources.openLanguageMenu = (event, current, callback) => {select = callback;};
    chat.auto.sources.setAutomaticTargetLanguage = language => {target = language;};
    await chat.drain(); chat.auto.entries.get(node).languageBadge.onclick({preventDefault() {}, stopPropagation() {}});
    select("日本語", "automatic");
    assert.equal(target, "日本語"); assert.equal(chat.calls.length, 1);
    assert.equal(chat.auto.entries.get(node).targetLanguage, undefined);
});

test("permanent switch persists incoming target, resets overrides and refreshes all visible originals with context", async () => {
    const chat = chatEnvironment(), requests = [];
    chat.document.nodes = [chat.message("1", "This is the original message"), chat.message("2", "another original")];
    chat.auto.sources.readReply = () => ({id: "0", channelId: "channel", text: "quoted original"});
    chat.auto.getAreaTopic = () => ({threadTitle: "Wuthering Waves"});
    chat.auto.getGlossary = async () => ({entries: [{en: "Rover", zh: "漂泊者"}]});
    chat.client.translate = async (text, settings, signal, context) => {requests.push({text, settings, context}); return "translated";};
    chat.client.cache = new Map([["old", "cached"]]);
    await chat.drain(); chat.auto.refresh("1", "channel", "English"); await chat.drain();
    chat.auto.toggle(chat.document.nodes[1]); // A manual opt-out must also reset.
    const plugin = new Plugin(); plugin.active = true; plugin.settings = chat.auto.settings;
    let saved;
    plugin.api = {Data: {save(key, settings) {assert.equal(key, "settings"); saved = settings;}}};
    plugin.client = chat.client;
    plugin.restartAutoTranslation = () => {
        const old = chat.auto; old.stop();
        chat.auto = new AutoTranslator(chat.client, plugin.settings, old.env, old.getAreaTopic, old.getGlossary, old.sources);
        chat.auto.running = true;
    };
    plugin.setAutomaticTargetLanguage("日本語");
    assert.equal(saved.targetLanguage, "日本語"); assert.equal(saved.autoTranslate, true);
    assert.equal(saved.outgoingLanguage, DEFAULTS.outgoingLanguage); assert.equal(chat.client.cache.size, 0);
    for (let i = 0; i < 10; i++) {chat.auto.scan(); await new Promise(setImmediate);}
    assert.equal(requests.length, 5);
    for (const request of requests.slice(-2)) {
        assert.equal(request.settings.targetLanguage, "日本語");
        assert.equal(request.context.reply.text, "quoted original");
        assert.equal(request.context.areaTopic.threadTitle, "Wuthering Waves");
        assert.equal(request.context.glossary.entries[0].en, "Rover");
    }
    for (const entry of chat.auto.entries.values()) {assert.equal(entry.targetLanguage, undefined); assert.equal(entry.sourceHidden, true);}
    // Selecting the same default still resets a subsequently chosen single target.
    chat.auto.refresh("1", "channel", "English"); await new Promise(setImmediate);
    plugin.setAutomaticTargetLanguage("日本語"); assert.equal(chat.auto.history.size, 0);
    plugin.setAutomaticTargetLanguage("unsupported"); assert.equal(saved.targetLanguage, "日本語");
});
