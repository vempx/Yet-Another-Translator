"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const os = require("node:os");
const path = require("node:path");

function load(BdApi, environment = {}) {
    const sandbox = {module: {exports: {}}, require, __dirname, URL, AbortController, TextDecoder, setTimeout, clearTimeout, BdApi, ...environment};
    vm.runInNewContext(fs.readFileSync(`${__dirname}/YetAnotherTranslator.plugin.js`, "utf8") +
        "\nmodule.exports.testing = {DEFAULTS, validateSettings, TranslationClient, AutoTranslator, areaTopicFor, GlossaryStore, DebugLogger, ImageTranslator, rememberProviderSettings, switchProviderSettings, discordImageUrl, imageIdentity, imageMime, inspectImage, imageDimensions, IMAGE_MAX_BYTES, OutgoingTranslator, referenceContext, orderedReferences, renderMessageEmoji, I18n, t, languageLabel, UI_MESSAGES, uiError, errorForUi, uiText, outgoingMessageText, hasOutgoingText, LANGUAGES, bindSettingsFooter, renderTranslatedMessage};", sandbox);
    return sandbox.module.exports;
}
const Plugin = load();
const {DEFAULTS, validateSettings, TranslationClient, AutoTranslator, areaTopicFor, GlossaryStore} = Plugin.testing;

function debugFixture(t) {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"yat-debug-test-"));
    t.after(()=>{for(const file of fs.readdirSync(directory)){const target=path.join(directory,file);if(fs.statSync(target).isDirectory())fs.rmdirSync(target);else fs.unlinkSync(target);}fs.rmdirSync(directory);});
    const file=path.join(directory,"debug.log");
    const settings={...DEFAULTS,model:"test-model",debugEnabled:true,debugLogPath:file};
    const read=()=>fs.existsSync(file)?fs.readFileSync(file,"utf8"):"";
    const records=()=>[...read().matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm)].map(match=>JSON.parse(match[2]));
    return {directory,file,settings,read,records};
}

test("debug is off by default, validates an absolute log filename and creates no file when disabled", async t => {
    const f=debugFixture(t);assert.equal(DEFAULTS.debugEnabled,false);
    for(const value of ["","relative.log",path.join(f.directory,"config.json")])assert.throws(()=>validateSettings({...f.settings,debugLogPath:value}));
    const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:"ok"}}]}))}));
    await client.translate("hello",{...f.settings,debugEnabled:false});await client.debugLogger.flush();assert.equal(fs.existsSync(f.file),false);
});

test("debug records readable exact prompts, resolved models, caller kind, response usage and correlation IDs", async t => {
    const f=debugFixture(t),requests=[];
    const client=new TranslationClient(async(url,options)=>{
        if(url.endsWith("/models"))return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({data:[{id:"resolved-model"}]}))};
        requests.push(JSON.parse(options.body));return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"hello",reasoning_content:"NEVER_LOG_REASONING"}}],usage:{prompt_tokens:11,completion_tokens:5,total_tokens:16}}))};
    });
    await client.translate("你好\n```literal```",{...f.settings,model:""},undefined,{areaTopic:{channelName:"test area"}},null,{kind:"automatic",channelId:"101",messageId:"202"});
    await client.debugLogger.flush();const records=f.records(),request=records.find(record=>record.event==="api_request"&&record.route==="/chat/completions");
    assert.deepEqual(request.requestBody,requests[0]);assert.equal(request.model,"resolved-model");assert.equal(request.translationType,"automatic");
    assert.equal(request.channelId,"101");assert.equal(request.messageId,"202");assert.equal(records[0].originalText,"你好\n```literal```");assert.equal(request.originalText,undefined);
    assert.ok(Number.isFinite(Date.parse(request.timestamp)));assert.ok(request.localTime);assert.equal(new Set(records.map(record=>record.operationId)).size,1);
    assert.equal(records.at(-1).event,"operation_complete");assert.equal(records.at(-1).translation,"hello");
    assert.ok(!f.read().includes("### 提示词 / Prompt"));assert.ok(!f.read().includes("### 原文 / Original"));assert.ok(!f.read().includes("NEVER_LOG_REASONING"));
    assert.equal(records.find(record=>record.event==="api_response"&&record.usage).usage.prompt_tokens,11);
});

test("debug redacts API keys in text, prompts, results and errors without storing authorization", async t => {
    const f=debugFixture(t),secret='secret-"\\-value';let fail=false;
    const client=new TranslationClient(async()=>{if(fail)throw Error("network "+secret);return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:"result "+secret}}]}))};});
    const settings={...f.settings,apiKey:secret};await client.translate("input "+secret,settings);fail=true;
    await assert.rejects(client.translate("other "+secret,settings));await client.debugLogger.flush();
    assert.ok(f.read().includes("[REDACTED]"));for(const record of f.records())assert.ok(!JSON.stringify(record).includes(secret));
    assert.ok(!f.read().includes(JSON.stringify(secret)));assert.ok(!f.read().includes("Bearer "));
    assert.equal(f.records().at(-1).event,"operation_error");
});

test("debug distinguishes repairs, cache hits and skips without changing model requests or cache keys", async t => {
    const f=debugFixture(t);let calls=0;
    const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>{calls++;return Buffer.from(JSON.stringify({choices:[{message:{content:calls===1?"Translation: wrong":"hello"}}]}));}}));
    await client.translate("你好",f.settings);await client.translate("你好",{...f.settings,debugEnabled:false});
    await client.translate("你好",f.settings);await client.translate("https://example.com",f.settings);await client.debugLogger.flush();
    assert.equal(calls,2);const records=f.records();assert.equal(records.filter(record=>record.event==="api_request").length,2);
    assert.ok(records.some(record=>record.phase==="repair"&&record.requestBody?.messages[0].content.includes("REPAIR")));
    assert.ok(records.some(record=>record.event==="cache_hit"&&record.modelInvoked===false));assert.ok(records.some(record=>record.event==="skipped"));
});

test("debug path changes and disabling suppress writes for old operations and support a new destination", async t => {
    const f=debugFixture(t);let current={...f.settings};const logger=new Plugin.testing.DebugLogger(()=>current);
    const old=logger.operation(f.settings,{kind:"manual",originalText:"old"});await logger.flush();const before=f.read();
    current={...current,debugEnabled:false};old.emit("not_logged",{originalText:"DO_NOT_WRITE"});await logger.flush();assert.equal(f.read(),before);
    current={...current,debugEnabled:true,debugLogPath:path.join(f.directory,"second.log")};old.emit("old_destination");
    const next=logger.operation(current,{kind:"outgoing",originalText:"new"});next.emit("operation_complete");await logger.flush();
    assert.equal(f.read(),before);assert.ok(fs.readFileSync(current.debugLogPath,"utf8").includes('"translationType": "outgoing"'));
});

test("debug file errors are isolated and log rotation keeps only the configured file plus three backups", async t => {
    const f=debugFixture(t),errors=[];fs.mkdirSync(f.file);
    const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:"ok"}}]}))}),null,code=>errors.push(code));
    assert.equal(await client.translate("hello",f.settings),"ok");await client.debugLogger.flush();assert.ok(errors.includes("INVALID_LOG_FILE"));fs.rmdirSync(f.file);
    const logger=new Plugin.testing.DebugLogger(null,null,400);const op=logger.operation(f.settings,{kind:"manual",originalText:"keep whole prompts"});
    for(let i=0;i<8;i++)op.emit("sample",{index:i});await logger.flush();
    assert.equal(logger.lastError,null);assert.equal(logger.pending,0);assert.equal(fs.readdirSync(f.directory).filter(name=>name.startsWith("debug.log")).length,4);
    assert.ok(f.read().includes('"index": 7'));
});

test("debug logs cancellation and connection-test budgets independently of translation results", async t => {
    const f=debugFixture(t);let finish;
    const client=new TranslationClient(()=>new Promise(resolve=>finish=resolve));const controller=new AbortController();
    const pending=client.translate("cancel me",f.settings,controller.signal,null,null,{kind:"outgoing",channelId:"101"});controller.abort();
    await assert.rejects(pending,error=>error.name==="AbortError");finish({status:200,arrayBuffer:async()=>Buffer.from("{}")});await client.debugLogger.flush();
    assert.ok(f.records().some(record=>record.event==="operation_cancelled"&&record.translationType==="outgoing"));
    const testing=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{finish_reason:"length",message:{content:"",reasoning_content:"hidden thoughts"}}],usage:{prompt_tokens:10,completion_tokens:128}}))}));
    await assert.rejects(testing.testConnection({...f.settings,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",deepseekThinking:true,maxTokens:128}));await testing.debugLogger.flush();
    assert.ok(f.records().some(record=>record.translationType==="connection_test"&&record.requestBody?.max_tokens===128));assert.ok(!f.read().includes("hidden thoughts"));
});

test("debug settings are transactional and do not clear translation caches or cancel pending sends", () => {
    const host=settingsHost(),plugin=host.plugin,panel=plugin.getSettingsPanel();let tree=host.render(panel),cancelled=0,restarted=0;
    plugin.outgoingTranslator={cancel(){cancelled++;},scan(){}};plugin.restartAutoTranslation=()=>restarted++;
    plugin.client.cache.set("retained",{text:"cached"});
    find(tree,node=>node.props?.name==="debugEnabled").props.onChange({target:{checked:true}});tree=host.render(panel);
    assert.ok(find(tree,node=>node.props?.name==="debugLogPath"));assert.equal(host.writes.length,0);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();assert.equal(plugin.settings.debugEnabled,false);
    tree=host.render(panel);find(tree,node=>node.props?.name==="debugEnabled").props.onChange({target:{checked:true}});tree=host.render(panel);
    find(tree,node=>node.props?.name==="debugLogPath").props.onInput({target:{value:path.join(os.tmpdir(),"yat-config-test.log")}});tree=host.render(panel);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.equal(plugin.settings.debugEnabled,true);assert.equal(cancelled,0);assert.equal(restarted,0);assert.equal(plugin.client.cache.has("retained"),true);
});


test("native settings footer saves before closing, blocks invalid saves and cancels while testing without saving", async () => {
    let closes=0,saves=0,cancels=0,valid=false;
    function group(){return {children:[],append(...nodes){for(const node of nodes){node.remove?.();this.children.push(node);node.parentElement=this;node.parentNode=this;}},insertBefore(node,anchor){node.remove?.();this.children.splice(this.children.indexOf(anchor),0,node);node.parentElement=this;node.parentNode=this;},remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);}};}
    const parent=group();
    function button(){return {type:"submit",textContent:"完成",disabled:false,style:{},isConnected:true,attributes:{},listeners:new Set(),
        setAttribute(key,value){this.attributes[key]=value;},getAttribute(key){return this.attributes[key];},removeAttribute(key){delete this.attributes[key];},
        addEventListener(type,handler){this.listeners.add(handler);},removeEventListener(type,handler){this.listeners.delete(handler);},cloneNode(){return button();},
        remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);},click(){
            if(this.disabled||this.clicking)return;this.clicking=true;let blocked=false;
            const event={preventDefault(){},stopPropagation(){},stopImmediatePropagation(){blocked=true;}};
            for(const listener of this.listeners)listener(event);
            if(!blocked){if(this.onclick)this.onclick(event);else closes++;}this.clicking=false;
        }};}
    const confirm=button();parent.append(confirm);
    const modal={querySelectorAll:()=>[confirm]},panel={ownerDocument:{createElement:type=>type==="div"?group():button()},contains:()=>false,closest:()=>modal,setAttribute(){},removeAttribute(){}};
    const actions={current:{busy:false,save:()=>{saves++;return valid;},cancel:()=>cancels++}};
    let binding=Plugin.testing.bindSettingsFooter(panel,actions);
    assert.equal(confirm.textContent,"保存并关闭");confirm.click();await Promise.resolve();assert.equal(saves,1);assert.equal(closes,0);
    valid=true;confirm.click();confirm.click();assert.equal(saves,2);await Promise.resolve();assert.equal(closes,1);
    binding.cleanup();assert.equal(confirm.textContent,"完成");assert.equal(parent.children.length,1);
    binding=Plugin.testing.bindSettingsFooter(panel,actions);actions.current.busy=true;binding.refresh();
    assert.equal(confirm.disabled,true);parent.children[0].children[0].click();assert.equal(cancels,1);assert.equal(saves,2);assert.equal(closes,2);
    binding.cleanup();assert.equal(confirm.listeners.size,0);
});

test("connection testing uses edited configuration without persisting it and cancellation discards it", async () => {
    const host=settingsHost({}, {runEffects:true}),panel=host.plugin.getSettingsPanel();let tree=host.render(panel),tested;
    find(tree,node=>node.props?.name==="baseUrl").props.onInput({target:{value:"http://localhost:12345/v1"}});
    host.plugin.client.testConnection=async settings=>{tested=settings;return {models:["test-model"],generated:false};};
    tree=host.render(panel);await find(tree,node=>node.type==="button"&&node.props.children[0]==="测试连接").props.onClick();
    assert.equal(tested.baseUrl,"http://localhost:12345/v1");assert.equal(host.writes.length,0);assert.equal(host.plugin.settings.baseUrl,DEFAULTS.baseUrl);
    tree=host.render(panel);find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();
    assert.equal(host.writes.length,0);host.cleanup();
});

test("Markdown renderer delegates formatting, protects emoji/mentions/spoilers and filters unsafe links and HTML", () => {
    const h=(type,props,...children)=>({type,props:{...props,children}});let rendered,prepared,unmounts=0;
    const markdown={defaultBlockParse(text){prepared=text;return text;},defaultReactOutput(text){return h("div",null,h("strong",null,text),h("a",{href:"javascript:alert(1)"},"bad"),h("img",{src:"https://example.com/pixel",alt:"image"}),h("div",{dangerouslySetInnerHTML:{__html:"bad"}},"safe"));}};
    const React={createElement:h,cloneElement:(value,props,...children)=>h(value.type,{...value.props,...props},...children)};
    const Local=load({React,ReactDOM:{createRoot:()=>({render:value=>rendered=value,unmount:()=>unmounts++})},Webpack:{getByKeys:key=>key==="defaultReactOutput"?markdown:null}});
    const text="**bold** <:smile:1409648830307369061> <@101> ||**secret**|| (AI translation)";
    const cleanup=Local.testing.renderTranslatedMessage({},text,{text},{});
    assert.ok(prepared.includes("**bold**"));assert.ok(!prepared.includes("<@101>"));assert.ok(!prepared.includes("||**secret**||"));
    assert.ok(find(rendered,node=>node.type==="strong"));assert.ok(find(rendered,node=>node.props?.className==="lt-ai-label"));
    assert.equal(find(rendered,node=>node.type==="img"),undefined);assert.equal(find(rendered,node=>node.props?.href?.startsWith("javascript:")),undefined);
    assert.equal(find(rendered,node=>node.props?.dangerouslySetInnerHTML),undefined);cleanup();cleanup();assert.equal(unmounts,1);
});

test("T8 Discord message parser wins over generic Markdown and generic wrappers", () => {
    const h=(type,props,...children)=>({type,props:{...props,children}});
    const React={createElement:h,cloneElement:(value,props,...children)=>h(value.type,{...value.props,...props},...children)};
    let nativeCalls=0,genericCalls=0,wrapperCalls=0,rendered,argumentsSeen;
    const markdown={defaultBlockParse(){genericCalls++;return [];},defaultReactOutput:()=>[]};
    const parser={parseTopic(){},parse(...args){nativeCalls++;argumentsSeen=args;return h("h1",null,args[0]);}};
    const Local=load({React,ReactDOM:{createRoot:()=>({render:value=>rendered=value,unmount(){}})},Webpack:{getByKeys:(...keys)=>
        keys.includes("parseTopic")?parser:keys.includes("reactParserFor")?{parse(){wrapperCalls++;}}:keys.includes("defaultReactOutput")?markdown:null}});
    for(const text of ["# Heading\nbody","-# subtext",">>> first\nsecond\n\nthird"]) {
        const cleanup=Local.testing.renderTranslatedMessage({},text,{channelId:"123"},{});
        assert.equal(argumentsSeen[0],text);assert.equal(argumentsSeen[1],true);assert.equal(argumentsSeen[2].channelId,"123");
        assert.equal(argumentsSeen[2].allowHeading,true);assert.equal(argumentsSeen[2].allowList,true);
        assert.ok(find(rendered,node=>node.type==="h1"));cleanup();
    }
    assert.equal(nativeCalls,3);assert.equal(genericCalls,0);assert.equal(wrapperCalls,0);
});

test("T8 a throwing Discord parser falls back without losing the translation", () => {
    const h=(type,props,...children)=>({type,props:{...props,children}});
    const React={createElement:h,cloneElement:(value,props,...children)=>h(value.type,{...value.props,...props},...children)};
    let calls=0,rendered;
    const markdown={parserFor:()=>text=>{calls++;return text;},reactFor:()=>text=>h("p",null,text),ruleOutput:()=>({}),
        defaultBlockParse:()=>[],defaultReactOutput:()=>[],defaultRules:{heading:{order:1},blockQuote:{order:2},paragraph:{match:()=>null},strong:{order:3}}};
    const Local=load({React,ReactDOM:{createRoot:()=>({render:value=>rendered=value,unmount(){}})},Webpack:{getByKeys:(...keys)=>
        keys.includes("parseTopic")?{parse(){throw Error("host changed");},parseTopic(){}}:markdown}});
    const cleanup=Local.testing.renderTranslatedMessage({},"translation",{},{});
    assert.equal(calls,1);assert.ok(find(rendered,node=>node.type==="p"));cleanup();
});

test("settings cancellation discards every field and save-and-close commits the current batched draft", () => {
    const host=settingsHost({}, {deferUpdates:true}), panel=host.plugin.getSettingsPanel(); let tree=host.render(panel);
    const field=name=>find(tree,node=>node.props?.name===name);
    field("baseUrl").props.onInput({target:{value:"unfinished URL"}});
    field("model").props.onInput({target:{value:"unsaved"}});
    field("targetLanguage").props.onChange({target:{value:"日本語"}});
    field("outgoingIncludeOriginal").props.onChange({target:{checked:true}});
    assert.equal(host.writes.length,0); assert.equal(host.plugin.settings.targetLanguage,"简体中文");
    find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();
    tree=host.render(panel); assert.equal(field("baseUrl").props.value,DEFAULTS.baseUrl);
    assert.equal(field("targetLanguage").props.value,"简体中文"); assert.equal(host.writes.length,0);
    field("baseUrl").props.onInput({target:{value:"http://localhost:12345"}});
    field("model").props.onInput({target:{value:"saved-model"}});
    field("targetLanguage").props.onChange({target:{value:"日本語"}});
    field("outgoingIncludeOriginal").props.onChange({target:{checked:true}});
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.equal(host.writes.length,1);const saved=host.writes[0].value;
    assert.equal(saved.baseUrl,"http://localhost:12345/v1");assert.equal(saved.model,"saved-model");
    assert.equal(saved.targetLanguage,"日本語");assert.equal(saved.outgoingIncludeOriginal,true);
});

test("T4 settings preserve a newer external default until the user explicitly edits the default", () => {
    const host = settingsHost();
    const panel = host.plugin.getSettingsPanel();
    let tree = host.render(panel);
    host.plugin.settings.targetLanguage = "日本語";
    find(tree, node => node.props?.name === "model").props.onInput({target: {value: "changed model"}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
    assert.equal(host.writes.at(-1).value.targetLanguage, "日本語");
    tree = host.render(panel);
    find(tree, node => node.props?.name === "targetLanguage").props.onInput({target: {value: "English"}});
    tree = host.render(panel);
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
    assert.equal(host.writes.at(-1).value.targetLanguage, "English");
    assert.equal(host.plugin.settings.targetLanguage, "English");
});

test("explicit default-language reset is deferred until save-and-close and keeps auto off", () => {
    const host=settingsHost({autoTranslate:false}),panel=host.plugin.getSettingsPanel();let tree=host.render(panel), restarts=0;
    host.plugin.restartAutoTranslation=()=>restarts++;
    find(tree,node=>node.type==="button"&&node.props.children[0]==="应用默认语言并清除单条覆盖").props.onClick();
    assert.equal(restarts,0);assert.equal(host.writes.length,0);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.equal(restarts,1);assert.equal(host.writes[0].value.autoTranslate,false);
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
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
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
    const host = settingsHost({autoTranslateAreas:{"101":{name:"test",enabled:true}}}), panel = host.plugin.getSettingsPanel();
    const chat = chatEnvironment(), requests = [];
    chat.auto.sources.isAutoTranslationEnabled=()=>host.plugin.isAreaAutoEnabled("101");
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
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
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

function outgoingFixture({getDraft, source = "我要专武", display = source, premiumType = null} = {}) {
    const errors = [], sent = [], requests = [];
    const LocalPlugin = load({Webpack: {getStore: name => name === "DraftStore" && getDraft ? {getDraft} : name === "UserStore" ? {getCurrentUser: () => ({premiumType})} : undefined}});
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

test("bilingual sending preserves raw original, payload and reply, using the target language for the AI marker", async () => {
    for (const [language, translation, marker] of [["English", "hello", "(AI translation)"], ["日本語", "こんにちは", "（AI翻訳）"],
        ["简体中文", "你好", "（AI翻译）"], ["Deutsch", "Hallo", "(KI-Übersetzung)"]]) {
        const source = "**原文** <@101>\n第二行 <:smile:1409648830307369061>";
        const f = outgoingFixture({source});
        f.plugin.settings.outgoingIncludeOriginal = true; f.plugin.settings.outgoingLanguage = language;
        let requests = 0;
        f.plugin.client.translate = async (text, settings, signal, context) => {
            requests++; assert.equal(text, source); assert.equal(settings.targetLanguage, language);
            assert.equal(context.reply.text, "original quoted text");
            assert.equal(context.glossary.entries[0].zh, "专武"); return translation;
        };
        await f.outgoing.submit("101", [f.payload, f.extra], f.original, f.editor);
        assert.equal(f.sent[0][0].value, source + "\n" + translation + " " + marker);
        assert.equal(f.sent[0][0].attachments, f.payload.attachments); assert.equal(f.sent[0][1], f.extra);
        assert.equal(f.payload.value, source); assert.equal(requests, 1);
    }
});

test("AI translation markers cover all preset targets and follow target language rather than UI locale", () => {
    const Local = load({Webpack: {getStore: () => ({getLocale: () => "en-US"})}});
    for (const [language] of Local.testing.LANGUAGES) {
        const text = Local.testing.outgoingMessageText("source", "translated", language, true);
        assert.ok(text.startsWith("source\ntranslated ")); assert.match(text, /[）)]$/);
    }
    assert.equal(Local.testing.outgoingMessageText("source", "translated", "日本語", true), "source\ntranslated （AI翻訳）");
    assert.equal(Local.testing.outgoingMessageText("source", "translated", "日本語", false), "translated");
    assert.throws(() => Local.testing.outgoingMessageText("source", "translated", "custom unknown language", true), /supported/);
});

test("bilingual send checks complete length and keeps the draft when original plus translation exceeds the limit", async () => {
    const f = outgoingFixture({source: "原".repeat(1800)});
    f.plugin.settings.outgoingIncludeOriginal = true;
    f.plugin.client.translate = async () => "x".repeat(300);
    const result = await f.outgoing.submit("101", [f.payload], f.original, f.editor);
    assert.equal(result.shouldClear, false); assert.equal(f.sent.length, 0); assert.equal(f.errors.length, 1);
    assert.equal(f.editor.textContent, "原".repeat(1800));
});

test("T5 Markdown sections and the AI marker remain separate from closed code, quotes, lists and spoilers", () => {
    const format = Plugin.testing.outgoingMessageText;
    for (const text of ["plain", "```js\nconsole.log('hello')\n```", "> quoted", "- first\n- second", "||secret||", "`code`", "\\`literal", "```\n>>> literal ||\n```", "````js\n```\n````"]) {
        const separator = /`{3,}|^[ \t]*(?:>|[-*+]\s|\d+[.)]\s)/m.test(text) ? "\n\n" : " ";
        assert.equal(format(text, text, "English", true), `${text}\n${text}${separator}(AI translation)`);
        assert.equal(format(text, text, "English", false), text);
    }
});

test("T5 unsafe Markdown sections are rejected without rewriting them; translation-only output is unchanged", () => {
    const format = Plugin.testing.outgoingMessageText;
    for (const text of ["```js\ncode", "hello ||secret", ">>> multiline quote", "`unclosed", "````js\ncode\n```", "`line\nnext`", "> >>> nested quote"]) {
        assert.throws(() => format(text, "translated", "English", true));
        assert.throws(() => format("source", text, "English", true));
        assert.equal(format("source", text, "English", false), text);
    }
});

test("T5 impossible bilingual length and unsupported language reject before glossary lookup and inference", async () => {
    for (const options of [{source: "x".repeat(1990)}, {source: "x".repeat(3990), premiumType: 2}, {source: "short", language: "unsupported custom"}, {source: "```js\ncode"}]) {
        const f = outgoingFixture(options); let glossary = 0, inference = 0;
        f.plugin.settings.outgoingIncludeOriginal = true;
        if (options.language) f.plugin.settings.outgoingLanguage = options.language;
        f.plugin.getGlossary = async () => {glossary++; return null;};
        f.plugin.client.translate = async () => {inference++; return "x";};
        assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
        assert.equal(glossary, 0); assert.equal(inference, 0); assert.equal(f.sent.length, 0);
        assert.equal(f.editor.textContent, options.source); assert.equal(f.payload.value, options.source);
    }
});

test("T5 minimum-length calculation matches final format for every preset and both account limits", async () => {
    for (const [language] of Plugin.testing.LANGUAGES) for (const premiumType of [null, 2]) {
        const limit = premiumType === 2 ? 4000 : 2000;
        const overhead = Plugin.testing.outgoingMessageText("", "x", language, true).length;
        for (const excess of [0, 1]) {
            const source = "x".repeat(limit - overhead + excess), f = outgoingFixture({source, premiumType});
            f.plugin.settings.outgoingIncludeOriginal = true; f.plugin.settings.outgoingLanguage = language;
            let inference = 0; f.plugin.client.translate = async () => {inference++; return "x";};
            const result = await f.outgoing.submit("101", [f.payload], f.original, f.editor);
            assert.equal(inference, excess ? 0 : 1); assert.equal(f.sent.length, excess ? 0 : 1);
            assert.equal(result.shouldClear, !excess);
            if (!excess) assert.equal(f.sent[0][0].value.length, limit);
        }
    }
});

test("T5 unsafe translated Markdown keeps the draft after one inference; no fallback sends the original", async () => {
    const f = outgoingFixture(); let inference = 0;
    f.plugin.settings.outgoingIncludeOriginal = true;
    f.plugin.client.translate = async () => {inference++; return "||unclosed secret";};
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
    assert.equal(inference, 1); assert.equal(f.sent.length, 0); assert.equal(f.editor.textContent, f.payload.value);
});

test("T5 a translation losing original spoiler delimiters cannot expose hidden content", async () => {
    const f = outgoingFixture({source: "||秘密||"}); let inference = 0;
    f.plugin.settings.outgoingIncludeOriginal = true;
    f.plugin.client.translate = async () => {inference++; return "secret";};
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
    assert.equal(inference, 1); assert.equal(f.sent.length, 0); assert.equal(f.editor.textContent, "||秘密||");
});

test("T6 rejected model outputs regenerate on explicit retry, send once and retain unrelated valid caches", async () => {
    for (const [source, invalid, valid] of [["||秘密||", "secret", "||secret||"], ["||秘密||", "||secret", "||secret||"],
        ["你好", "```js\nunfinished", "hello"], ["hello source", "x".repeat(2100), "short"]]) {
        const f = outgoingFixture({source}), r = recordingClient(["unrelated translation", invalid, valid]);
        f.plugin.client = r.client; f.plugin.settings.model = "test-model"; f.plugin.settings.outgoingIncludeOriginal = true;
        await r.client.translate("unrelated source", r.settings);
        const unrelated = [...r.client.cache.entries()][0];
        const send = () => f.outgoing.submit("101", [f.payload, f.extra], f.original, f.editor);
        assert.equal((await send()).shouldClear, false); assert.equal(f.sent.length, 0); assert.equal(r.requests.length, 2);
        assert.equal(f.editor.textContent, source); assert.equal(r.client.cache.get(unrelated[0]), unrelated[1]);
        assert.equal((await send()).shouldClear, true); assert.equal(r.requests.length, 3); assert.equal(f.sent.length, 1);
        assert.equal(f.sent[0][0].value, Plugin.testing.outgoingMessageText(source, valid, "English", true));
        assert.equal(f.sent[0][0].attachments, f.payload.attachments); assert.equal(f.sent[0][1], f.extra);
        await send(); assert.equal(r.requests.length, 3); assert.equal(r.client.stats.cacheHits, 1);
        await r.client.translate("unrelated source", r.settings); assert.equal(r.requests.length, 3);
    }
});

test("T6 repeated invalid generations preserve the draft without automatic retries", async () => {
    const f = outgoingFixture({source: "||秘密||"}), r = recordingClient(["secret", "||secret"]);
    f.plugin.client = r.client; f.plugin.settings.model = "test-model"; f.plugin.settings.outgoingIncludeOriginal = true;
    for (let attempt = 1; attempt <= 2; attempt++) {
        assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
        assert.equal(r.requests.length, attempt); assert.equal(f.sent.length, 0); assert.equal(r.client.cache.size, 0);
    }
});

test("T6 cancellation after a valid result is cached does not delete that result", async () => {
    const f = outgoingFixture(), r = recordingClient(["valid translation"]);
    f.plugin.settings.model = "test-model"; f.plugin.settings.outgoingIncludeOriginal = true;
    let cancelOnce = true;
    f.plugin.client = {translate: async (...args) => {
        const result = await r.client.translate(...args);
        if (cancelOnce) {cancelOnce = false; f.outgoing.cancel();}
        return result;
    }};
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
    assert.equal(f.sent.length, 0); assert.equal(r.client.cache.size, 1);
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, true);
    assert.equal(r.requests.length, 1); assert.equal(r.client.stats.cacheHits, 1);
});

test("T6 an old cache entry rejected by the current sending policy is evicted precisely", async () => {
    const source = "你好", f = outgoingFixture({source}), r = recordingClient(["```js\nunfinished", "unrelated", "hello"]);
    f.plugin.client = r.client; f.plugin.settings.model = "test-model";
    // Translation-only sending previously accepted this text, creating a cache entry.
    await f.outgoing.submit("101", [f.payload], f.original, f.editor);
    await r.client.translate("another source", r.settings);
    const otherEntry = [...r.client.cache.entries()].find(([, entry]) => entry.text === "unrelated");
    f.plugin.settings.outgoingIncludeOriginal = true;
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, false);
    assert.equal(r.requests.length, 2); assert.equal(r.client.cache.size, 1);
    assert.equal(r.client.cache.get(otherEntry[0]), otherEntry[1]);
    assert.equal((await f.outgoing.submit("101", [f.payload, f.extra], f.original, f.editor)).shouldClear, true);
    assert.equal(r.requests.length, 3); assert.equal(f.sent.length, 2);
    assert.equal(f.sent[1][0].value, Plugin.testing.outgoingMessageText(source, "hello", "English", true));
});

test("T6 cancellation during real-client generation preserves unrelated caches and permits a manual retry", async () => {
    const f = outgoingFixture(); let requests = 0, release, started;
    const gate = new Promise(resolve => {release = resolve;}), waiting = new Promise(resolve => {started = resolve;});
    const client = new TranslationClient(async () => {
        requests++;
        if (requests === 2) {started(); await gate;}
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content: "valid translation"}}]}))};
    });
    f.plugin.client = client; f.plugin.settings.model = "test-model"; f.plugin.settings.outgoingIncludeOriginal = true;
    await client.translate("unrelated source", {...DEFAULTS, model: "test-model"});
    const entry = [...client.cache.entries()][0];
    const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
    await waiting; f.outgoing.cancel(); release();
    assert.equal((await pending).shouldClear, false); assert.equal(f.sent.length, 0);
    assert.equal(client.cache.size, 1); assert.equal(client.cache.get(entry[0]), entry[1]);
    assert.equal((await f.outgoing.submit("101", [f.payload], f.original, f.editor)).shouldClear, true);
    assert.equal(requests, 3); assert.equal(f.sent.length, 1);
});

test("changing inclusion of the original cancels an in-flight send and cannot submit the old format", async () => {
    const f = outgoingFixture(); let complete;
    f.plugin.api.Data = {save() {}}; f.plugin.outgoingTranslator = f.outgoing;
    f.plugin.client.translate = () => new Promise(resolve => {complete = resolve;});
    const pending = f.outgoing.submit("101", [f.payload], f.original, f.editor);
    await new Promise(setImmediate);
    f.plugin.setOutgoingIncludeOriginal(true); complete("translated");
    assert.equal((await pending).shouldClear, false); assert.equal(f.sent.length, 0);
});

test("outgoing button cycles original, translation and bilingual atomically without changing targets", () => {
    const plugin=new Plugin(),writes=[];let cancels=0,scans=0;
    plugin.settings={...DEFAULTS,outgoingTranslate:false,outgoingIncludeOriginal:true,outgoingLanguage:"日本語"};
    plugin.api={Data:{save:(key,value)=>writes.push({...value})}};
    plugin.outgoingTranslator={cancel(){cancels++;},scan(){scans++;}};
    for(const [enabled,include] of [[true,false],[true,true],[false,false],[true,false]]) {
        plugin.cycleOutgoingSendMode();assert.equal(plugin.settings.outgoingTranslate,enabled);assert.equal(plugin.settings.outgoingIncludeOriginal,include);
        assert.equal(plugin.settings.outgoingLanguage,"日本語");assert.equal(plugin.settings.targetLanguage,DEFAULTS.targetLanguage);
        assert.equal(writes.at(-1).outgoingIncludeOriginal,include);
    }
    assert.equal(writes.length,4);assert.equal(cancels,4);assert.equal(scans,4);
});

test("changing outgoing mode cancels an in-flight translation and retains its draft", async () => {
    const f=outgoingFixture();let complete;
    f.plugin.api.Data={save(){}};f.plugin.outgoingTranslator=f.outgoing;f.outgoing.scan=()=>{};
    f.plugin.client.translate=()=>new Promise(resolve=>{complete=resolve;});
    const pending=f.outgoing.submit("101",[f.payload],f.original,f.editor);await new Promise(setImmediate);
    f.plugin.cycleOutgoingSendMode();assert.equal(f.plugin.settings.outgoingIncludeOriginal,true);
    complete("translated");assert.equal((await pending).shouldClear,false);assert.equal(f.sent.length,0);
});

test("each outgoing mode submits its exact payload, preserving attachments and reply parameters", async () => {
    const f=outgoingFixture();f.plugin.api.Data={save(){}};f.plugin.outgoingTranslator=f.outgoing;f.outgoing.scan=()=>{};
    f.plugin.settings.outgoingTranslate=false;
    await f.outgoing.submit("101",[f.payload,f.extra],f.original,f.editor);
    assert.equal(f.sent[0][0],f.payload);assert.equal(f.requests.length,0);
    f.plugin.cycleOutgoingSendMode();await f.outgoing.submit("101",[f.payload,f.extra],f.original,f.editor);
    assert.equal(f.sent[1][0].value,"I want the signature weapon");
    f.plugin.cycleOutgoingSendMode();await f.outgoing.submit("101",[f.payload,f.extra],f.original,f.editor);
    assert.equal(f.sent[2][0].value,f.payload.value+"\nI want the signature weapon (AI translation)");
    for(const args of f.sent){assert.equal(args[0].attachments,f.payload.attachments);assert.equal(args[1],f.extra);}
});

test("saved include-original setting refreshes send mode; cancelling the draft leaves it unchanged", () => {
    const host=settingsHost({outgoingTranslate:true}),panel=host.plugin.getSettingsPanel();let tree=host.render(panel),refreshed=[];
    host.plugin.outgoingTranslator={cancel(){},scan(){refreshed.push(host.plugin.settings.outgoingIncludeOriginal);}};
    find(tree,node=>node.props?.name==="outgoingIncludeOriginal").props.onChange({target:{checked:true}});
    assert.equal(refreshed.length,0);tree=host.render(panel);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.deepEqual(refreshed,[true]);assert.equal(host.plugin.settings.outgoingTranslate,true);
    tree=host.render(panel);find(tree,node=>node.props?.name==="outgoingIncludeOriginal").props.onChange({target:{checked:false}});
    tree=host.render(panel);find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();
    assert.equal(host.plugin.settings.outgoingIncludeOriginal,true);assert.deepEqual(refreshed,[true]);
});

test("include-original settings remain a draft until save-and-close", () => {
    const host=settingsHost(),panel=host.plugin.getSettingsPanel();let tree=host.render(panel);
    find(tree,node=>node.props?.name==="outgoingIncludeOriginal").props.onChange({target:{checked:true}});
    assert.equal(host.writes.length,0);assert.equal(host.plugin.settings.outgoingIncludeOriginal,false);
    tree=host.render(panel);find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.equal(host.writes[0].value.outgoingIncludeOriginal,true);
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

test("T10 bounded thinking tests report actual budget and never suggest an ineffective larger translation limit", async () => {
    for(const maxTokens of [128,2048,8192]) for(const outcome of ["length","reasoning-only","success"]) {
        let requests=0,body;
        const client=new TranslationClient(async(url,options)=>{requests++;body=JSON.parse(options.body);return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({
            choices:[{finish_reason:outcome==="length"?"length":"stop",message:{content:outcome==="success"?"OK":"",reasoning_content:"must not display"}}],
            usage:{prompt_tokens:10,completion_tokens:Math.min(maxTokens,2048)}}))};});
        const settings={...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",deepseekThinking:true,deepseekReasoningEffort:"max",maxTokens,contextTokens:32768};
        if(outcome==="success") assert.equal((await client.testConnection(settings)).generated,true);
        else await assert.rejects(client.testConnection(settings),error=>{
            assert.match(error.message,new RegExp(String(Math.min(maxTokens,2048))));assert.match(error.message,/测试上限/);
            assert.match(error.message,/降低思考强度或关闭思考/);assert.ok(!error.message.includes("请增加最大输出"));assert.ok(!error.message.includes("must not display"));return true;
        });
        assert.equal(requests,1);assert.equal(body.max_tokens,Math.min(maxTokens,2048));
        assert.equal(client.testStats.requests,1);assert.equal(client.testStats.usageResponses,1);
        assert.equal(client.testStats.promptTokens,10);assert.equal(client.testStats.completionTokens,Math.min(maxTokens,2048));
        assert.equal(client.testStats.failures,outcome==="success"?0:1);assert.equal(client.stats.generations,0);
    }
});

test("T10 connection usage stays separate from translations and includes failed and missing-usage responses once", async () => {
    let calls=0;
    const responses=[{choices:[{finish_reason:"length",message:{content:""}}],usage:{prompt_tokens:10,completion_tokens:2048}},
        {choices:[{message:{content:"OK"}}]},
        {choices:[{message:{content:"OK"}}],usage:{prompt_tokens:0,completion_tokens:0}},
        {choices:[{message:{content:"hello"}}],usage:{prompt_tokens:20,completion_tokens:5}}];
    const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(responses[calls++]))}));
    const input={...DEFAULTS,providerMode:"online",baseUrl:"https://api.example.test",model:"test"};
    await assert.rejects(client.testConnection(input));await client.testConnection(input);await client.testConnection(input);
    assert.equal(client.testStats.requests,3);assert.equal(client.testStats.failures,1);assert.equal(client.testStats.usageResponses,2);
    assert.equal(client.testStats.promptTokens,10);assert.equal(client.testStats.completionTokens,2048);
    assert.equal(client.stats.usageResponses,0);assert.match(client.usageSummary(),/连接测试/);assert.match(client.usageSummary(),/1 次测试生成请求未返回用量/);
    await client.translate("你好",input);await client.translate("你好",input);
    assert.equal(calls,4);assert.equal(client.stats.generations,1);assert.equal(client.stats.cacheHits,1);
    assert.equal(client.stats.promptTokens,20);assert.equal(client.stats.completionTokens,5);assert.equal(client.testStats.requests,3);
    assert.ok(!client.usageSummary().includes("-1"));
});

test("T10 cancellation aborts one test promptly and ignores late usage without recording a failure", async () => {
    let finish,calls=0,innerSignal;
    const client=new TranslationClient(async(url,options)=>{calls++;innerSignal=options.signal;return new Promise(resolve=>finish=resolve);});
    const controller=new AbortController(),input={...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",deepseekThinking:true};
    const pending=client.testConnection(input,controller.signal);controller.abort();await assert.rejects(pending,error=>error.name==="AbortError");
    assert.equal(innerSignal.aborted,true);assert.equal(client.testStats.requests,1);assert.equal(client.testStats.cancelled,1);assert.equal(client.testStats.failures,0);
    finish({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:"OK"}}],usage:{prompt_tokens:10,completion_tokens:99}}))});await new Promise(setImmediate);
    assert.equal(calls,1);assert.equal(client.testStats.usageResponses,0);assert.equal(client.controllers.size,0);assert.equal(client.active,0);
    assert.match(client.usageSummary(),/取消的请求也可能已消耗/);
});

test("T10 model-list checks are not counted as generation and invalid usage cannot corrupt missing counts", async () => {
    let response={data:[{id:"local"}]};
    const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(response))}));
    await client.testConnection(DEFAULTS);assert.equal(client.testStats.modelChecks,1);assert.equal(client.testStats.requests,0);assert.match(client.usageSummary(),/尚无连接测试生成请求/);
    response={choices:[{message:{content:"OK"}}],usage:{prompt_tokens:-1,completion_tokens:5}};
    await client.testConnection({...DEFAULTS,providerMode:"online",baseUrl:"https://api.example.test",model:"test"});
    assert.equal(client.testStats.usageResponses,0);assert.equal(client.testStats.promptTokens,0);assert.match(client.usageSummary(),/未收到服务返回的测试 usage/);
});

test("DeepSeek validates effort, uses an explicit default model and permits its documented token limits", () => {
    const settings=validateSettings({...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com/v1/chat/completions",maxTokens:32768,contextTokens:1048576});
    assert.equal(settings.model,"deepseek-flash");assert.equal(settings.baseUrl,"https://api.deepseek.com/v1");assert.equal(settings.deepseekThinking,false);
    for(const effort of ["none","medium","ultra",""]) assert.throws(()=>validateSettings({...settings,deepseekReasoningEffort:effort}));
    assert.throws(()=>validateSettings({...settings,maxTokens:393217}));
    assert.throws(()=>validateSettings({...settings,baseUrl:"http://api.deepseek.com"}));
});

test("DeepSeek request parameters and cache keys track thinking while other providers keep their existing body", async () => {
    const bodies=[];const client=new TranslationClient(async(url,options)=>{
        assert.equal(url,"https://api.deepseek.com/chat/completions");bodies.push(JSON.parse(options.body));
        return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"hello",reasoning_content:"private reasoning"}}]}))};
    });
    const input={...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",model:"deepseek-flash"};
    assert.equal(await client.translate("你好",input),"hello");
    assert.equal(bodies[0].thinking.type,"disabled");assert.equal(bodies[0].reasoning_effort,"none");assert.equal(bodies[0].temperature,0.1);
    await client.translate("你好",{...input,deepseekReasoningEffort:"max"});assert.equal(bodies.length,1);
    for(const effort of ["low","high","max"]) {
        assert.equal(await client.translate("你好",{...input,deepseekThinking:true,deepseekReasoningEffort:effort}),"hello");
        assert.equal(bodies.at(-1).thinking.type,"enabled");assert.equal(bodies.at(-1).reasoning_effort,effort);
        assert.equal("temperature" in bodies.at(-1),false);assert.equal("extra_body" in bodies.at(-1),false);
    }
    await client.translate("你好",{...input,providerMode:"online"});assert.equal(bodies.length,5);
    assert.equal("thinking" in bodies.at(-1),false);assert.equal("reasoning_effort" in bodies.at(-1),false);
    assert.ok(bodies.every(body=>!JSON.stringify(body.messages).includes("private reasoning")));
});

test("DeepSeek connection tests use draft thinking parameters, a bounded budget and no chat history", async () => {
    const calls=[];const client=new TranslationClient(async(url,options)=>{calls.push(JSON.parse(options.body));return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"OK",reasoning_content:"private"}}]}))};});
    const settings={...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",deepseekThinking:true,deepseekReasoningEffort:"max",maxTokens:4096};
    await client.testConnection(settings);assert.equal(calls[0].reasoning_effort,"max");assert.equal(calls[0].max_tokens,2048);assert.equal(calls[0].messages.length,1);
    await client.testConnection({...settings,deepseekThinking:false});assert.equal(calls[1].thinking.type,"disabled");assert.equal(calls[1].reasoning_effort,"none");assert.equal(calls[1].max_tokens,64);
});

test("DeepSeek rejects reasoning-only or truncated completions instead of showing or caching reasoning", async () => {
    for(const choice of [{finish_reason:"stop",message:{content:"",reasoning_content:"private"}},{finish_reason:"length",message:{content:"partial",reasoning_content:"private"}}]) {
        const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[choice]}))}));
        const input={...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",deepseekThinking:true};
        await assert.rejects(client.translate("你好",input));assert.equal(client.cache.size,0);await assert.rejects(client.testConnection(input));
    }
});

test("DeepSeek settings use a draft, fill untouched defaults and save or cancel thinking options together", () => {
    const host=settingsHost(),panel=host.plugin.getSettingsPanel();let tree=host.render(panel);
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"deepseek"}});tree=host.render(panel);
    assert.equal(find(tree,node=>node.props?.name==="baseUrl").props.value,"https://api.deepseek.com");
    assert.equal(find(tree,node=>node.props?.name==="deepseekReasoningEffort").props.disabled,true);
    find(tree,node=>node.props?.name==="deepseekThinking").props.onChange({target:{checked:true}});tree=host.render(panel);
    find(tree,node=>node.props?.name==="deepseekReasoningEffort").props.onChange({target:{value:"max"}});
    assert.equal(host.writes.length,0);tree=host.render(panel);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.equal(host.plugin.settings.deepseekThinking,true);assert.equal(host.plugin.settings.deepseekReasoningEffort,"max");
    tree=host.render(panel);find(tree,node=>node.props?.name==="deepseekThinking").props.onChange({target:{checked:false}});tree=host.render(panel);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();assert.equal(host.plugin.settings.deepseekThinking,true);
    const other=settingsHost({baseUrl:"https://proxy.example.test/custom/v1",model:"custom/model"}),otherPanel=other.plugin.getSettingsPanel();
    tree=other.render(otherPanel);find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"deepseek"}});tree=other.render(otherPanel);
    assert.equal(find(tree,node=>node.props?.name==="baseUrl").props.value,"https://api.deepseek.com");assert.equal(find(tree,node=>node.props?.name==="model").props.value,"deepseek-flash");
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"local"}});tree=other.render(otherPanel);
    assert.equal(find(tree,node=>node.props?.name==="baseUrl").props.value,"https://proxy.example.test/custom/v1");assert.equal(find(tree,node=>node.props?.name==="model").props.value,"custom/model");
});

test("online endpoints preserve provider paths and stay stable through repeated validation", () => {
    for (const [input, expected] of [["https://api.example.test", "https://api.example.test"],
        ["https://api.example.test/chat/completions", "https://api.example.test"],
        ["https://api.example.test/v1/", "https://api.example.test/v1"],
        ["https://api.example.test/api/v1/chat/completions/", "https://api.example.test/api/v1"],
        ["https://api.example.test/gateway/team", "https://api.example.test/gateway/team"]]) {
        const settings = validateSettings({...DEFAULTS, providerMode: "online", baseUrl: input});
        assert.equal(settings.baseUrl, expected); assert.equal(validateSettings(settings).baseUrl, expected);
    }
    assert.equal(validateSettings({...DEFAULTS, providerMode: "online", baseUrl: "http://localhost:9000/v1"}).baseUrl, "http://localhost:9000/v1");
});

test("local remains default and online rejects unsafe remote addresses", () => {
    assert.equal(validateSettings({}).providerMode, "local");
    assert.throws(() => validateSettings({...DEFAULTS, baseUrl: "https://api.example.test/v1"}));
    for (const baseUrl of ["http://api.example.test/v1", "ftp://api.example.test/v1", "https://user:password@api.example.test/v1", "https://api.example.test/v1?api_key=test", "https://api.example.test/v1#part"]) {
        assert.throws(() => validateSettings({...DEFAULTS, providerMode: "online", baseUrl}));
    }
    assert.throws(() => validateSettings({...DEFAULTS, providerMode: "unknown"}));
});

test("online translation uses exactly the configured HTTPS endpoint, model and Bearer key with original context", async () => {
    const calls = [], client = new TranslationClient(async (url, options) => {
        calls.push({url, options, body: JSON.parse(options.body)});
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content: "translated"}}]}))};
    });
    const settings = {...DEFAULTS, providerMode: "online", baseUrl: "https://api.example.test/api/v1/chat/completions", model: "provider/model-id", apiKey: "test-key"};
    await client.translate("你好", settings, undefined, {areaTopic: {threadTitle: "Wuthering Waves"}, reply: {text: "original quoted text"}});
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.example.test/api/v1/chat/completions");
    assert.equal(calls[0].body.model, "provider/model-id"); assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
    assert.equal(calls[0].options.redirect, "manual"); assert.equal(calls[0].options.maxRedirects, 0);
    assert.ok(calls[0].body.messages.some(message => message.content.includes("original quoted text")));
    assert.ok(calls[0].body.messages.some(message => message.content.includes("Wuthering Waves")));
    await client.translate("你好", settings, undefined, {areaTopic: {threadTitle: "Wuthering Waves"}, reply: {text: "original quoted text"}});
    assert.equal(calls.length, 1);
});

test("online connection tests with a model do not require the models route or send chat history", async () => {
    const calls = [], client = new TranslationClient(async (url, options) => {
        calls.push({url, options, body: JSON.parse(options.body)});
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content: "OK"}}]}))};
    });
    const result = await client.testConnection({...DEFAULTS, providerMode: "online", baseUrl: "https://api.example.test/v1", model: "test-model", apiKey: "test-key"});
    assert.equal(result.generated, true); assert.equal(result.models[0], "test-model");
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.example.test/v1/chat/completions");
    assert.equal(calls[0].body.messages.length, 1); assert.equal(calls[0].body.messages[0].content, "Reply with OK.");
    assert.equal(client.cache.size, 0);
});

test("local connection tests still list models without generation; online auth failures do not retry", async () => {
    let calls = 0;
    const local = new TranslationClient(async (url, options) => {
        calls++; assert.ok(url.endsWith("/models")); assert.equal(options.method, "GET");
        return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({data: [{id: "local-model"}]}))};
    });
    assert.equal((await local.testConnection(DEFAULTS)).generated, false); assert.equal(calls, 1);
    const denied = new TranslationClient(async () => {calls++; return {status: 401};});
    await assert.rejects(denied.testConnection({...DEFAULTS, providerMode: "online", baseUrl: "https://api.example.test/v1", model: "model"}), /401/);
    assert.equal(calls, 2);
});

test("settings configure and persist online mode without changing receive or send target languages", () => {
    const host = settingsHost(), panel = host.plugin.getSettingsPanel(); let tree = host.render(panel);
    for (const [name, value] of [["providerMode", "online"], ["baseUrl", "https://api.example.test/api/v1"], ["model", "provider/model"], ["apiKey", "test-key"]]) {
        find(tree, node => node.props?.name === name).props.onChange({target: {value}}); tree = host.render(panel);
    }
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
    const value = host.writes.at(-1).value;
    assert.equal(value.providerMode, "online"); assert.equal(value.baseUrl, "https://api.example.test/api/v1");
    assert.equal(value.model, "provider/model"); assert.equal(value.apiKey, "test-key");
    assert.equal(value.targetLanguage, DEFAULTS.targetLanguage); assert.equal(value.outgoingLanguage, DEFAULTS.outgoingLanguage);
});

test("online connection tests reject incompatible responses and redirects without fallback requests", async () => {
    for (const result of [{status: 200, body: {}}, {status: 200, body: {choices: [null]}}, {status: 307}, {status: 429}]) {
        let calls = 0;
        const client = new TranslationClient(async (url, options) => {
            calls++; assert.equal(options.redirect, "manual"); assert.equal(options.maxRedirects, 0);
            return {status: result.status, arrayBuffer: async () => Buffer.from(JSON.stringify(result.body))};
        });
        await assert.rejects(client.testConnection({...DEFAULTS, providerMode: "online", baseUrl: "https://api.example.test/v1", model: "test-model"}));
        assert.equal(calls, 1);
    }
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

test("settings save sends subsequent local and online requests to the edited port, including cache bypass", async () => {
    for (const [providerMode, baseUrl] of [["local", "http://127.0.0.1:9031/v1"], ["local", "http://localhost:12345/v1"], ["online", "https://api.example.test:9443/api/v1"]]) {
        const host = settingsHost({model: "test-model"}), panel = host.plugin.getSettingsPanel(), calls = [];
        host.plugin.client = new TranslationClient(async (url, options) => {
            calls.push(url);
            return {status: 200, arrayBuffer: async () => Buffer.from(JSON.stringify({choices: [{message: {content: "translated"}}]}))};
        });
        await host.plugin.client.translate("你好", host.plugin.settings);
        let tree = host.render(panel);
        find(tree, node => node.props?.name === "providerMode").props.onChange({target: {value: providerMode}});
        find(tree, node => node.props?.name === "baseUrl").props.onInput({target: {value: baseUrl}});
        find(tree, node => node.props?.name === "model").props.onInput({target: {value: "test-model"}});
        tree = host.render(panel);
        find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
        assert.equal(host.writes.at(-1).value.baseUrl, baseUrl); assert.equal(host.plugin.settings.baseUrl, baseUrl);
        await host.plugin.client.translate("你好", host.plugin.settings);
        assert.equal(calls.length, 2); assert.equal(calls[1], baseUrl + "/chat/completions");
    }
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
    assert.ok(find(tree, node => node.type === "button" && node.props.children[0] === "Save and close"));
    find(tree, node => node.props.name === "baseUrl").props.onInput({currentTarget: {value: "http://localhost:9000"}});
    host.setLocale("ja"); tree = host.render(panel);
    assert.equal(find(tree, node => node.props.name === "baseUrl").props.value, "http://localhost:9000");
    assert.equal(find(tree, node => node.props.name === "targetLanguage").props.value, "简体中文");
    assert.ok(find(tree, node => node.type === "button" && node.props.children[0] === "保存して閉じる"));
    assert.equal(host.plugin.getSettingsPanel().type, panel.type);
    host.setLocale("zh-TW"); tree = host.render(panel);
    assert.ok(find(tree, node => node.type === "button" && node.props.children[0] === "儲存並關閉"));
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

test("display branding uses branded filenames and glossary location while preserving existing settings", () => {
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
    assert.deepEqual(namespaces, ["YetAnotherTranslator"]);
    assert.equal(plugin.settings.model, "existing-model"); assert.equal(plugin.settings.targetLanguage, "日本語");
    assert.ok(plugin.glossaryStore.defaultPath("wuthering-waves.json").includes("YetAnotherTranslator-glossaries"));
    assert.match(fs.readFileSync(path.join(__dirname, "YetAnotherTranslator.plugin.js"), "utf8"), /@name YetAnotherTranslator\b/);
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
    const addon = {id: "YetAnotherTranslator", name: "YetAnotherTranslator", description: "old", filename: "YetAnotherTranslator.plugin.js"};
    const Local = load({Plugins: {get: id => id === addon.id ? addon : null}, Webpack: {getStore: () => ({getLocale: () => locale})}});
    new Local({id: "YetAnotherTranslator"});
    assert.equal(addon.name, "Yet Another Translator"); assert.equal(addon.id, "YetAnotherTranslator");
    assert.equal(addon.filename, "YetAnotherTranslator.plugin.js"); assert.match(addon.description, /发送前翻译/);
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
        Data = {load: () => ({autoTranslateAreas:{"101":{name:"test",enabled:true}}})};
        DOM = {addStyle() {}, removeStyle() {}};
        ContextMenu = {patch: () => () => {}};
    }
    const Local = load(Api), plugin = new Local(); plugin.start();
    const chat = chatEnvironment();
    chat.document.nodes = [chat.message("1", "This is the original message")];
    plugin.autoTranslator = new Local.testing.AutoTranslator(chat.client, plugin.settings, chat.auto.env, undefined, undefined, {isAutoTranslationEnabled:()=>plugin.isAreaAutoEnabled("101")});
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
    const save = find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭");
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
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
    assert.equal(host.writes.length, 1);
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
    find(tree, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
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
    const input = {closest: selector => selector === '[data-yet-another-translator-panel]' ? {} : null};
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
    const originalItem = find(tree, node => node.props?.id === "yet-another-translator-original");
    assert.equal(originalItem.props.label, "查看原文");
    originalItem.props.action();
    assert.equal(host.alerts[0].title, "消息原文");
    assert.equal(host.alerts[0].content.props.children[0].props.children[0], "second original");
    assert.deepEqual(chat.calls, ["first original", "second original"]);
    const untranslated = {props: {navId: "message", children: []}};
    host.plugin.patchMessageMenu(untranslated, {message: {id: "3"}, channel: {id: "channel"}});
    assert.equal(find(untranslated, node => node.props?.id === "yet-another-translator-original"), undefined);
});

function glossaryFixture(t, entries) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yetanothertranslator-glossary-test-"));
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

test("area auto switches are ID-scoped, independent for forums/threads and migrate legacy global state once", () => {
    const plugin=new Plugin();let stored={...DEFAULTS,autoTranslate:true};delete stored.autoTranslateAreas;let writes=0,current="101";
    plugin.api={Data:{load:()=>stored,save:(key,value)=>{stored=value;writes++;}}};plugin.currentChannelId=()=>current;
    plugin.channelStore={getChannel:id=>({id,name:"same name",parent_id:id==="102"?"101":null})};
    plugin.loadSettings();assert.equal(writes,1);assert.equal(plugin.isAreaAutoEnabled("101"),true);assert.equal(plugin.isAreaAutoEnabled("102"),false);assert.equal(plugin.settings.autoTranslate,false);
    current="102";plugin.loadSettings();assert.equal(writes,1);assert.equal(plugin.isAreaAutoEnabled("102"),false);
    plugin.setAutoTranslation(true,"102");plugin.setAutoTranslation(false,"101");assert.equal(plugin.isAreaAutoEnabled("102"),true);assert.equal(plugin.isAreaAutoEnabled("101"),false);
    plugin.setAutoTranslation(true,"103");assert.equal(plugin.isAreaAutoEnabled("104"),false);
    const before=writes;plugin.setAutoTranslation(true,null);assert.equal(writes,before);
    assert.throws(()=>validateSettings({...DEFAULTS,autoTranslateAreas:{invalid:{enabled:true}}}));
});

test("area and message menus toggle the menu's area even after navigation and do not duplicate items", () => {
    const host=settingsHost();host.plugin.getSettingsPanel();const plugin=host.plugin;plugin.active=true;plugin.currentChannelId=()=>"999";
    const area={props:{navId:"channel-context",children:[]}};plugin.patchAreaMenu(area,{channel:{id:"101",type:0,name:"A"}});plugin.patchAreaMenu(area,{channel:{id:"101",type:0,name:"A"}});
    assert.equal(area.props.children.length,1);find(area,node=>node.props?.id==="yet-another-translator-area-auto").props.action();
    assert.equal(plugin.isAreaAutoEnabled("101"),true);assert.equal(plugin.isAreaAutoEnabled("999"),false);
    const message={props:{navId:"message",children:[]}};plugin.patchMessageMenu(message,{message:{id:"1",channel_id:"202"}});
    find(message,node=>node.props?.id==="yet-another-translator-area-auto").props.action();assert.equal(plugin.isAreaAutoEnabled("202"),true);assert.equal(plugin.isAreaAutoEnabled("101"),true);
    const dm={props:{navId:"gdm-context",children:[]}};plugin.patchAreaMenu(dm,{channel:{id:"303",type:3}});
    assert.ok(find(dm,node=>node.props?.id==="yet-another-translator-area-auto"));assert.equal(find(dm,node=>node.props?.id==="yet-another-translator-custom-area"),undefined);
    const reopened={props:{navId:"message",children:[]}};plugin.patchMessageMenu(reopened,{channel:{id:"101"},message:{id:"1"}});
    find(reopened,node=>node.props?.id==="yet-another-translator-area-auto").props.action();assert.equal(plugin.isAreaAutoEnabled("101"),false);assert.equal(plugin.isAreaAutoEnabled("202"),true);
});

test("automatic translation isolates simultaneous areas and restores retained results without new requests", async () => {
    const chat=chatEnvironment(),enabled=new Set(["101"]);chat.auto.sources.isAutoTranslationEnabled=id=>enabled.has(id);
    const a=chat.message("1","area A","101"),b=chat.message("2","area B","202");chat.document.nodes=[a,b];await chat.drain();
    assert.deepEqual(chat.calls,["area A"]);assert.equal(chat.auto.entries.get(a).sourceHidden,true);
    enabled.delete("101");chat.auto.syncAutoTranslation();assert.equal(chat.auto.entries.get(a).output,null);assert.equal(chat.auto.entries.get(a).sourceHidden,false);
    enabled.add("202");chat.auto.syncAutoTranslation();await chat.drain();assert.deepEqual(chat.calls,["area A","area B"]);
    enabled.add("101");chat.auto.syncAutoTranslation();await chat.drain();assert.equal(chat.calls.length,2);assert.equal(chat.auto.entries.get(a).sourceHidden,true);
    enabled.delete("202");chat.auto.syncAutoTranslation();chat.auto.refresh("2","202");await chat.drain();
    assert.equal(chat.auto.entries.get(b).sourceHidden,false);assert.equal(chat.auto.entries.get(b).manual,true);assert.ok(chat.auto.entries.get(b).output);
});

test("disabling one area cancels its pending receive translation and preserves other enabled areas", async () => {
    const chat=chatEnvironment(),enabled=new Set(["101","202"]);chat.auto.sources.isAutoTranslationEnabled=id=>enabled.has(id);
    let finish;chat.client.translate=text=>text==="pending A"?new Promise(resolve=>finish=resolve):Promise.resolve("translated B");
    const a=chat.message("1","pending A","101"),b=chat.message("2","ready B","202");chat.document.nodes=[a,b];
    chat.auto.scan();await new Promise(setImmediate);enabled.delete("101");chat.auto.syncAutoTranslation();assert.equal(chat.auto.pending.controller.signal.aborted,true);
    finish("stale A");await chat.drain();assert.equal(chat.auto.entries.get(a).output,null);assert.equal(chat.auto.entries.get(b).state,"done");assert.equal(chat.auto.entries.get(b).sourceHidden,true);
});

test("changing a different area's switch does not cancel the current area's pending translation", async () => {
    const chat=chatEnvironment(),enabled=new Set(["101","202"]);chat.auto.sources.isAutoTranslationEnabled=id=>enabled.has(id);
    let finish;chat.client.translate=()=>new Promise(resolve=>finish=resolve);
    const node=chat.message("1","pending A","101");chat.document.nodes=[node];chat.auto.scan();await new Promise(setImmediate);
    enabled.delete("202");chat.auto.syncAutoTranslation();assert.equal(chat.auto.pending.controller.signal.aborted,false);
    finish("translated A");await chat.drain();assert.equal(chat.auto.entries.get(node).state,"done");
});

test("area settings merge only edited IDs, preserve menu changes and discard cancellation", () => {
    const host=settingsHost(),plugin=host.plugin;plugin.currentChannelId=()=>"101";const panel=plugin.getSettingsPanel();let tree=host.render(panel);
    find(tree,node=>node.props?.name==="autoTranslateCurrentArea").props.onChange({target:{checked:true}});
    plugin.setAutoTranslation(true,"202");tree=host.render(panel);find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    assert.equal(plugin.isAreaAutoEnabled("101"),true);assert.equal(plugin.isAreaAutoEnabled("202"),true);
    tree=host.render(panel);find(tree,node=>node.props?.name==="autoTranslateCurrentArea").props.onChange({target:{checked:false}});
    tree=host.render(panel);find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();assert.equal(plugin.isAreaAutoEnabled("101"),true);
    plugin.active=true;plugin.setAutomaticTargetLanguage("日本語","303");assert.equal(plugin.isAreaAutoEnabled("303"),true);assert.equal(plugin.isAreaAutoEnabled("404"),false);
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
    const item = find(menu, node => node.props?.id === "yet-another-translator-custom-area");
    assert.equal(item.props.label, "打开自定义翻译");
    item.props.action();
    assert.equal(host.plugin.settings.customAreas[channel.id].enabled, true);
    assert.equal(path.basename(host.plugin.settings.customAreas[channel.id].glossaryPath), "wuthering-waves.json");
    const tree = host.render(host.plugin.getSettingsPanel());
    const input = find(tree, node => node.props?.name === "glossary-10001");
    const value = path.join(__dirname, "my-custom-terms.json");
    input.props.onInput({currentTarget: {value}});
    const updated = host.render(host.plugin.getSettingsPanel());
    find(updated, node => node.type === "button" && node.props.children[0] === "保存并关闭").props.onClick();
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

test("model requests retain glossary references on retry and cache only actual glossary content", async () => {
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
    assert.equal(requests.length, 2);
    await client.translate("Iuno", settings, undefined, {...context, glossary: {...context.glossary, version: "3", entries: [{en:"Iuno",zh:"新译名"}]}});
    assert.equal(requests.length, 3);
    await client.translate("Iuno", settings, undefined, {...context, refresh:true});assert.equal(requests.length,4);
});

test("G12 empty glossaries normalize to no glossary despite file name, version and priority changes", async () => {
    const requests=[];const client=new TranslationClient(async(url,options)=>{requests.push(JSON.parse(options.body));return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:"hello"}}]}))};});
    const settings={...DEFAULTS,model:"test"};
    for(const glossary of [undefined,{name:"one",version:"1",entries:[],priorities:[]},{name:"two",version:"2",entries:[],priorities:["nearby"]}]) await client.translate("你好",settings,undefined,glossary?{glossary}:null);
    assert.equal(requests.length,1);assert.equal(client.stats.cacheHits,2);assert.equal(requests[0].messages.some(message=>message.content.startsWith("LOCAL TERMINOLOGY")),false);
});

test("G12 local file reloads retain request cache for unselected changes and invalidate selected changes", async t => {
    const fixture=glossaryFixture(t,[{en:"Iuno",zh:"尤诺"},{en:"Unrelated",zh:"无关"}]),store=new GlossaryStore();let calls=0;
    const client=new TranslationClient(async()=>({status:200,arrayBuffer:async()=>{calls++;return Buffer.from(JSON.stringify({choices:[{message:{content:"尤诺"}}]}));}}));
    const settings={...DEFAULTS,model:"test"};
    let selected=await store.select(fixture.file,"Iuno");await client.translate("Iuno",settings,undefined,{glossary:selected});
    const write=(entries,time)=>{fs.writeFileSync(fixture.file,JSON.stringify({version:1,name:"Test glossary",entries}));fs.utimesSync(fixture.file,time,time);};
    write([{en:"Iuno",zh:"尤诺"},{en:"Unrelated",zh:"未使用的新词条"}],2000000000);
    let changed=await store.select(fixture.file,"Iuno");assert.notEqual(changed.version,selected.version);
    await client.translate("Iuno",settings,undefined,{glossary:changed});assert.equal(calls,1);
    write([{en:"Iuno",zh:"新译名"}],2000000001);changed=await store.select(fixture.file,"Iuno");
    await client.translate("Iuno",settings,undefined,{glossary:changed});assert.equal(calls,2);
    await client.translate("Iuno",settings,undefined,{glossary:changed,refresh:true});assert.equal(calls,3);
});

test("G12 economy is opt-in, removes short standalone nearby terms and bounds pronoun/reply terms", () => {
    const client=new TranslationClient(),glossary={name:"game",version:"1",entries:Array.from({length:20},(_,index)=>({en:"Character "+index,zh:"角色"+index})),priorities:Array(20).fill("nearby")};
    const context={before:[{text:"Character 0 and Character 1"}],after:[]};
    assert.ok(client.budget("你好",DEFAULTS,context,null,glossary).glossary.entries.length>0);
    assert.equal(client.budget("你好",{...DEFAULTS,glossaryEconomy:true},context,null,glossary).glossary.entries.length,0);
    for(const text of ["Is she good?","这个角色呢？","Это хорошо?","それは？"]) {
        const selected=client.budget(text,{...DEFAULTS,glossaryEconomy:true},context,null,glossary);
        assert.ok(selected.glossary.entries.length>0,text);
        const without=client.estimate(client.messages(text,DEFAULTS,selected.context,null,null,true));
        assert.ok(client.estimate(client.messages(text,DEFAULTS,selected.context,null,selected.glossary,true))-without<=700);
    }
    const reply={...context,reply:{text:"Character 7"}};
    const selected=client.budget("好",{...DEFAULTS,glossaryEconomy:true},reply,null,glossary);
    assert.equal(selected.glossary.entries[0].en,"Character 7");assert.ok(selected.context.reply.text.includes("Character 7"));
});

test("G12 economy compacts aliases and notes, merges duplicates and preserves same-name disambiguation", () => {
    const client=new TranslationClient(),entry={en:"Hero",zh:"英雄",game:"Game A",character:"Alice",category:"skill",note:"x".repeat(200),aliases:["HERO","heroine","unused","Heroine"]};
    const input={entries:[entry,{...entry,aliases:["heroine"]},{...entry,game:"Game B",character:"Bob"}],priorities:["nearby","direct","direct"]};
    const original=JSON.stringify(input),compact=client.compactGlossary("heroine",null,input);
    assert.equal(compact.entries.length,2);assert.ok(compact.priorities.every(priority=>priority==="direct"));
    for(const value of compact.entries){assert.equal(value.aliases.length,1);assert.equal(value.aliases[0].toLowerCase(),"heroine");assert.equal(value.note.length,96);assert.equal(value.category,"skill");}
    assert.equal(compact.entries[0].game,"Game A");assert.equal(compact.entries[1].game,"Game B");assert.equal(JSON.stringify(input),original);
    const selected=client.budget("heroine",{...DEFAULTS,glossaryEconomy:true},null,null,input);assert.equal(selected.glossary.entries.length,2);
});

test("G12 glossary economy setting saves with the draft and cancels without changing defaults", () => {
    const host=settingsHost(),panel=host.plugin.getSettingsPanel();let tree=host.render(panel);
    assert.equal(DEFAULTS.glossaryEconomy,false);
    find(tree,node=>node.props?.name==="glossaryEconomy").props.onChange({target:{checked:true}});assert.equal(host.writes.length,0);
    tree=host.render(panel);find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();assert.equal(host.plugin.settings.glossaryEconomy,false);
    tree=host.render(panel);find(tree,node=>node.props?.name==="glossaryEconomy").props.onChange({target:{checked:true}});tree=host.render(panel);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();assert.equal(host.plugin.settings.glossaryEconomy,true);
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


test("debug caller metadata distinguishes automatic, manual refresh and outgoing translation", async () => {
    const chat=chatEnvironment(), requests=[];
    chat.client.translate=async (...args)=>{requests.push(args);return "translated";};
    chat.document.nodes=[chat.message("202","hello")];await chat.drain();
    assert.equal(requests[0][5].kind,"automatic");assert.equal(requests[0][5].messageId,"202");
    chat.auto.refresh("202","channel","日本語");await chat.drain();assert.equal(requests.at(-1)[5].kind,"manual");
    const outgoing=outgoingFixture();await outgoing.outgoing.submit("101",[outgoing.payload,outgoing.extra],outgoing.original,outgoing.editor);
    assert.equal(outgoing.requests[0][5].kind,"outgoing");assert.equal(outgoing.requests[0][5].channelId,"101");
});


test("debug supports BetterDiscord's sync-only fs bridge, stripped error codes, appending and rotation", async t => {
    const f=debugFixture(t),calls=[];
    const bridge={};
    for(const method of ["mkdirSync","lstatSync","unlinkSync","renameSync","writeFileSync"]){
        bridge[method]=(...args)=>{calls.push({method,args});try{return fs[method](...args);}catch(error){throw Error(error.message);}};
    }
    const Bridged=load(undefined,{require:name=>name==="fs"?bridge:name==="buffer"?Buffer:require(name)});
    const logger=new Bridged.testing.DebugLogger(null,null,15000);
    const op=logger.operation(f.settings,{kind:"manual",originalText:"中文 bridge original"});
    op.emit("api_request",{requestBody:{messages:[{role:"user",content:"Translate 中文"}]}});await logger.flush();
    assert.equal(logger.lastError,null);assert.equal(f.records().length,2);
    assert.ok(f.read().includes("Translate 中文"));
    assert.ok(calls.some(call=>call.method==="writeFileSync"&&call.args[2].flag==="a"));
    assert.equal(fs.existsSync(f.file),true);
    for(let i=0;i<12;i++)op.emit("sample",{padding:"x".repeat(5000),index:i});await logger.flush();
    assert.equal(logger.lastError,null);assert.ok(fs.existsSync(f.file+".3"));assert.ok(f.read().includes('"index": 11'));
    const saved=bridge.writeFileSync;bridge.writeFileSync=()=>{throw Error("EACCES: permission denied");};
    op.emit("blocked");await logger.flush();assert.equal(logger.lastError,"EACCES");
    bridge.writeFileSync=saved;op.emit("recovered");await logger.flush();assert.equal(logger.lastError,null);
});


test("debug writes a complete manual translation on BetterDiscord fs and direct Buffer exports, including existing files", async t => {
    const f=debugFixture(t),bridge={};
    for(const method of ["mkdirSync","lstatSync","unlinkSync","renameSync","writeFileSync"])bridge[method]=(...args)=>fs[method](...args);
    const Bridged=load(undefined,{require:name=>name==="fs"?bridge:name==="buffer"?Buffer:require(name)});
    fs.writeFileSync(f.file,"Existing log header\n");
    const client=new Bridged.testing.TranslationClient(async(url,options)=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(url.endsWith("/models")?{data:[{id:"discovered-model"}]}:{choices:[{finish_reason:"stop",message:{content:"译文内容"}}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}}))}));
    assert.equal(await client.translate("manual source 中文",{...f.settings,model:""},null,{areaTopic:{channelName:"test channel"}},null,{kind:"manual",channelId:"101",messageId:"202"}),"译文内容");
    await client.debugLogger.flush();assert.equal(client.debugLogger.lastError,null);
    const records=f.records();assert.equal(records.length,6);assert.equal(records.at(-1).event,"operation_complete");
    assert.ok(f.read().startsWith("Existing log header"));
    const request=records.find(event=>event.route==="/chat/completions"&&event.event==="api_request");
    assert.equal(request.model,"discovered-model");assert.equal(request.translationType,"manual");
    assert.equal(records[0].originalText,"manual source 中文");assert.equal(request.originalText,undefined);assert.ok(request.requestBody.messages.some(message=>message.content.includes("manual source 中文")));
    assert.equal(records.at(-1).translation,"译文内容");assert.ok(records.some(event=>event.usage?.total_tokens===16));
});


test("compact debug logs retain each payload once and correlate cached operations without duplicating translations", async t => {
    const f=debugFixture(t),requests=[];const source="source line 1\nsource line 2",translated="final translation";
    const client=new TranslationClient(async(url,options)=>{requests.push(JSON.parse(options.body));return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:translated}}]}))};});
    await client.translate(source,f.settings);await client.translate(source,f.settings);await client.debugLogger.flush();
    const records=f.records();assert.equal(requests.length,1);assert.equal(records.length,7);
    const ids=[...new Set(records.map(record=>record.operationId))];assert.equal(ids.length,2);
    for(const id of ids){const events=records.filter(record=>record.operationId===id);assert.equal(events[0].event,"operation_start");
        assert.equal(events[0].originalText,source);assert.equal(events.at(-1).translation,translated);
        assert.equal(events.filter(record=>Object.hasOwn(record,"originalText")).length,1);
        assert.equal(events.filter(record=>Object.hasOwn(record,"translation")).length,1);
    }
    assert.ok(records.every(record=>record.schemaVersion===2));
    assert.equal(records.filter(record=>record.requestBody).length,1);assert.deepEqual(records.find(record=>record.requestBody).requestBody,requests[0]);
    assert.equal(records.find(record=>record.event==="cache_hit").translation,undefined);
    assert.ok(!f.read().includes("### 提示词 / Prompt"));assert.ok(!f.read().includes("### 原文 / Original"));
});


test("T13 Debug on/off preserves model discovery results and request counts for malformed list entries", async t => {
    const f=debugFixture(t);
    const cases=[{data:[null,{}, {id:42},{id:" "},{id:"usable-model"}]},{data:[]},{data:[null,{id:""},{id:7}]},{data:null},{data:{}},{data:"wrong type"},{}];
    for(const body of cases){
        for(const action of ["translate","testConnection"]){
            const outcomes=[];
            for(const enabled of [false,true]){
                const calls=[];const client=new TranslationClient(async(url,options)=>{
                    calls.push({route:new URL(url).pathname,body:options.body?JSON.parse(options.body):null});
                    return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(url.endsWith("/models")?body:{choices:[{message:{content:"hello"}}]}))};
                });
                const settings={...f.settings,model:"",debugEnabled:enabled};let outcome;
                try{const value=action==="translate"?await client.translate("你好",settings):await client.testConnection(settings);outcome={value:JSON.parse(JSON.stringify(value))};}
                catch(error){outcome={error:{name:error.name,message:error.message}};}
                await client.debugLogger.flush();assert.equal(client.debugLogger.lastError,null);
                outcomes.push({...outcome,calls});
            }
            assert.deepEqual(outcomes[1],outcomes[0],action+" with "+JSON.stringify(body));
            const valid=Array.isArray(body.data)&&body.data.some(item=>item?.id==="usable-model");
            if(valid){assert.equal(outcomes[1].calls.length,action==="translate"?2:1);assert.ok(!outcomes[1].error);}
            else {assert.equal(outcomes[1].calls.length,1);assert.match(outcomes[1].error.message,/服务未提供可用模型/);}
        }
    }
    const responses=f.records().filter(event=>event.event==="api_response"&&event.route==="/models");
    assert.equal(responses.length,cases.length*2);
    for(const response of responses)assert.deepEqual(response.models,response.models.length?["usable-model"]:[]);
    assert.ok(!f.records().some(event=>event.event==="api_error"));
});

test("T13 lazy Debug payload projection failures are isolated from translation and connection tests", async t => {
    const f=debugFixture(t);
    for(const action of ["translate","testConnection"]){
        const codes=[],client=new TranslationClient(async(url)=>({status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(url.endsWith("/models")?{data:[{id:"usable-model"}]}:{choices:[{message:{content:"hello"}}]}))}),null,code=>codes.push(code));
        const create=client.debugLogger.operation.bind(client.debugLogger);
        client.debugLogger.operation=(...args)=>{
            const operation=create(...args),emit=operation.emit;
            operation.emit=(event,details)=>emit(event,event==="api_response"?()=>{throw Error("Synthetic log projection failure");}:details);
            return operation;
        };
        const settings={...f.settings,model:""};
        if(action==="translate")assert.equal(await client.translate("你好",settings),"hello");
        else assert.deepEqual(JSON.parse(JSON.stringify(await client.testConnection(settings))),{models:["usable-model"],generated:false});
        await client.debugLogger.flush();assert.ok(codes.includes("LOG_FORMAT_ERROR"));
        assert.equal(client.active,0);assert.equal(client.controllers.size,0);
    }
    assert.equal(f.records().filter(event=>event.event==="operation_complete").length,2);
    assert.ok(!f.records().some(event=>event.event==="api_error"||event.event==="operation_error"));
});

test("image downloads allow Discord media only and never send model credentials", async () => {
    const {discordImageUrl,imageIdentity}=Plugin.testing;
    for(const url of ["http://127.0.0.1/image.png","file:///C:/secret.png","https://example.com/a.png","https://cdn.discordapp.com.evil/a.png","https://cdn.discordapp.com/emojis/1.png","https://user:pass@cdn.discordapp.com/attachments/1/2/a.png"])
        assert.throws(()=>discordImageUrl(url));
    assert.equal(imageIdentity("https://media.discordapp.net/attachments/1/2/a.png?width=100"),imageIdentity("https://cdn.discordapp.com/attachments/1/2/a.png?ex=123"));
    assert.equal(imageIdentity("https://media.discordapp.net/ephemeral-attachments/1/2/a.png?width=100"),imageIdentity("https://cdn.discordapp.com/ephemeral-attachments/1/2/a.png?ex=123"));
    let options;const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
    const client=new TranslationClient(async(url,input)=>{options=input;return {status:200,arrayBuffer:async()=>png.buffer};});
    const image=await client.downloadImage("https://cdn.discordapp.com/attachments/1/2/a.png",{...DEFAULTS,apiKey:"MODEL_SECRET"});
    assert.equal(image.mime,"image/png");assert.equal(image.bytes,8);assert.equal(image.dataUrl,"data:image/png;base64,iVBORw0KGgo=");
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.credentials,"omit");assert.equal(options.redirect,"manual");assert.equal(options.maxRedirects,0);
    const Bridged=load(undefined,{require:name=>name==="buffer"?Buffer:require(name)}).testing.TranslationClient;
    const bridged=new Bridged(async()=>({status:200,arrayBuffer:async()=>png.buffer}));
    assert.equal((await bridged.downloadImage("https://cdn.discordapp.com/attachments/1/2/a.png",DEFAULTS)).dataUrl,image.dataUrl);
    for(const providerMode of ["online","deepseek"]){await assert.rejects(client.downloadImage("https://cdn.discordapp.com/attachments/1/2/a.png",{...DEFAULTS,providerMode,baseUrl:"https://api.example.com/v1"}));}
});

test("image downloads reject oversized, redirected and non-image content and cancel promptly", async () => {
    const url="https://cdn.discordapp.com/attachments/1/2/a.png";
    for(const response of [{status:200,arrayBuffer:async()=>new ArrayBuffer(8*1024*1024+1)},{status:302,arrayBuffer:()=>{throw Error("must not follow");}},{status:200,headers:{get:()=>String(9*1024*1024)},arrayBuffer:()=>{throw Error("must not read");}},{status:200,arrayBuffer:async()=>Buffer.from("<html>not an image</html>")}]){
        const client=new TranslationClient(async()=>response);await assert.rejects(client.downloadImage(url,DEFAULTS));
    }
    let received;const client=new TranslationClient(async(url,options)=>{received=options;return new Promise(()=>{});}),controller=new AbortController();
    const pending=client.downloadImage(url,DEFAULTS,controller.signal);controller.abort();await assert.rejects(pending,error=>error.name==="AbortError");assert.equal(received.signal.aborted,true);
});

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const imageFixture = (data = Buffer.from(TINY_PNG, "base64"), mime = "image/png") => ({dataUrl:"data:"+mime+";base64,"+data.toString("base64"),mime,bytes:data.length});

test("single local vision call includes image, topic, replies and terms, with redacted Debug payload", async t => {
    const f=debugFixture(t),requests=[],image=imageFixture();
    const client=new TranslationClient(async(url,options)=>{
        if(url.endsWith("/models"))return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({data:[{id:"vision-model"}]}))};
        if(url.endsWith("/input_tokens"))return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({input_tokens:512}))};
        const body=JSON.parse(options.body);requests.push(body);
        const data={translation:"译文",summary:"概括",sourceLanguage:"ENG",hasText:true,unwanted:"not copied"};
        return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(data),reasoning_content:"HIDDEN_REASONING"}}],usage:{prompt_tokens:12,completion_tokens:5,total_tokens:17}}))};
    });
    const context={areaTopic:{threadTitle:"Wuthering Waves",imageCaption:"Iuno"},reply:{id:"reply",text:"original reply",speaker:"author"},glossary:{name:"game glossary",entries:[{en:"Iuno",zh:"尤诺"}]}};
    const result=await client.translateImage(image,{...f.settings,model:""},null,context,{channelId:"101",messageId:"202"});await client.debugLogger.flush();
    assert.equal(result.translation,"译文");assert.equal(result.summary,"概括");assert.equal(result.sourceLanguage,"ENG");assert.equal(result.unwanted,undefined);
    assert.equal(requests.length,1);assert.equal(requests[0].messages.at(-1).content[1].image_url.url,image.dataUrl);
    assert.equal(requests[0].model,"vision-model");
    const payload=JSON.stringify(requests[0]);for(const reference of ["Wuthering Waves","original reply","Iuno","尤诺"])assert.ok(payload.includes(reference));
    assert.equal(client.stats.generations,1);assert.equal(client.stats.repairs,0);assert.equal(client.stats.usageResponses,1);
    const records=f.records();assert.ok(records.some(record=>record.task==="image_translate"&&record.image.width===1&&record.image.height===1));
    assert.ok(f.read().includes("[IMAGE DATA OMITTED]"));assert.ok(!f.read().includes(TINY_PNG));assert.ok(!f.read().includes("HIDDEN_REASONING"));
    assert.equal(records.filter(record=>record.event==="operation_complete").length,1);
});

test("vision tasks reject online mode, invalid JSON, truncation and contradictory empty output without retries", async () => {
    const image=imageFixture();
    for(const providerMode of ["online","deepseek"]){let calls=0;const client=new TranslationClient(async()=>{calls++;});await assert.rejects(client.translateImage(image,{...DEFAULTS,providerMode,baseUrl:"https://api.example.com/v1"}));assert.equal(calls,0);}
    const good={translation:"text",summary:"summary",sourceLanguage:"ENG",hasText:true};
    for(const choice of [{finish_reason:"length",message:{content:JSON.stringify(good)}},{message:{content:JSON.stringify({...good,translation:42})}},{message:{content:JSON.stringify({...good,translation:"x".repeat(24001)})}},{message:{content:"not json"}},{message:{content:JSON.stringify({...good,hasText:false})}}]){
        let calls=0;const client=new TranslationClient(async url=>{if(url.endsWith("/input_tokens"))return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({input_tokens:512}))};calls++;return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[choice]}))};});
        await assert.rejects(client.translateImage(image,{...DEFAULTS,model:"vision"}));assert.equal(calls,1);assert.equal(client.active,0);
    }
    const client=new TranslationClient();assert.throws(()=>client.translateImage({...image,dataUrl:"file:///C:/secret"},DEFAULTS));
});

function sizedImage(mime,width,height){
    let bytes;
    if(mime==="image/png"){
        // A real compressed, grayscale PNG with valid chunk CRCs (including the audit reproducer).
        const crc=body=>{let result=0xffffffff;for(const value of body){result^=value;for(let n=0;n<8;n++)result=(result>>>1)^((result&1)?0xedb88320:0);}return (result^0xffffffff)>>>0;};
        const chunk=(type,body)=>{const head=Buffer.alloc(4),tail=Buffer.alloc(4),content=Buffer.concat([Buffer.from(type),body]);head.writeUInt32BE(body.length);tail.writeUInt32BE(crc(content));return Buffer.concat([head,content,tail]);};
        const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;
        bytes=Buffer.concat([Buffer.from(TINY_PNG,"base64").subarray(0,8),chunk("IHDR",ihdr),chunk("IDAT",require("node:zlib").deflateSync(Buffer.alloc((width+1)*height))),chunk("IEND",Buffer.alloc(0))]);
    } else if(mime==="image/jpeg"){
        bytes=Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,0x11,0,255,217]);bytes.writeUInt16BE(height,7);bytes.writeUInt16BE(width,9);
    } else if(mime==="image/gif"){
        bytes=Buffer.alloc(13);bytes.write("GIF89a");bytes.writeUInt16LE(width,6);bytes.writeUInt16LE(height,8);
    } else {
        bytes=Buffer.alloc(30);bytes.write("RIFF");bytes.writeUInt32LE(22,4);bytes.write("WEBPVP8X",8);bytes.writeUInt32LE(10,16);bytes.writeUIntLE(width-1,24,3);bytes.writeUIntLE(height-1,27,3);
    }
    return imageFixture(bytes,mime);
}

test("T15 all formats reject compressed-large pixels before decoding or generating and accept exact limits", async()=>{
    const {ImageTranslator,inspectImage}=Plugin.testing;const translator=new ImageTranslator({},{});let calls=0;
    const client=new TranslationClient(async()=>{calls++;throw Error("must not call model");});
    for(const mime of ["image/png","image/jpeg","image/gif","image/webp"]){
        const image=sizedImage(mime,8192,4096);assert.ok(image.bytes<100000);
        await assert.rejects(translator.prepare(image,new AbortController().signal),error=>error.uiMessage?.key==="imageTooLarge");
        if(mime!=="image/webp")assert.throws(()=>client.translateImage(image,{...DEFAULTS,contextTokens:2048,maxTokens:1024}),error=>error.uiMessage?.key==="imageTooLarge");
        assert.equal(inspectImage(sizedImage(mime,8192,2048),true).width,8192);
        assert.throws(()=>inspectImage(sizedImage(mime,8193,1),true));
        const cancelled=new AbortController();cancelled.abort();await assert.rejects(translator.prepare(image,cancelled.signal),error=>error.name==="AbortError");
    }
    assert.equal(calls,0);
    for(const mime of ["image/png","image/jpeg","image/gif"]){assert.throws(()=>inspectImage(sizedImage(mime,0,1)));}
    assert.throws(()=>inspectImage(imageFixture(Buffer.from(TINY_PNG,"base64").subarray(0,8))));
    const fake={...imageFixture(),width:8192,height:4096,bytes:1};assert.equal(inspectImage(fake).width,1);
    const bridge=load(undefined,{require:name=>name==="buffer"?Buffer:require(name)});assert.equal(bridge.testing.inspectImage(fake).height,1);
});


test("T15 native visual budget blocks oversized inputs; older servers fall back without extra generations",async t=>{
    const f=debugFixture(t),image=imageFixture(),limit=DEFAULTS.contextTokens-DEFAULTS.maxTokens;
    for(const outcome of [{input_tokens:limit+1},{input_tokens:0},{input_tokens:"512"},null]){
        const routes=[];const client=new TranslationClient(async(url)=>{routes.push(url);return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(outcome))};});
        await assert.rejects(client.translateImage(image,{...DEFAULTS,model:"vision"}));assert.equal(routes.length,1);assert.ok(routes[0].endsWith("/input_tokens"));assert.equal(client.stats.generations,0);assert.equal(client.active,0);
    }
    for(const status of [200,404,405,501,401,500]){
        const routes=[];const client=new TranslationClient(async(url,options)=>{routes.push({url,body:JSON.parse(options.body)});
            const counting=url.endsWith("/input_tokens");return {status:counting?status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(counting?status===200?{input_tokens:limit}:{error:{message:"unsupported"}}:{choices:[{message:{content:JSON.stringify({translation:"",summary:"",sourceLanguage:"UNK",hasText:false})}}]}))};});
        if([401,500].includes(status)){await assert.rejects(client.translateImage(image,f.settings));assert.equal(routes.length,1);assert.equal(client.stats.generations,0);}
        else {const result=await client.translateImage(image,f.settings);assert.equal(result.hasText,false);assert.equal(routes.length,2);assert.equal(client.stats.generations,1);assert.deepEqual(routes[0].body,routes[1].body);}
        await client.debugLogger.flush();assert.equal(client.active,0);
    }
    const records=f.records();assert.ok(records.some(item=>item.event==="image_budget"&&item.mode==="native"));assert.ok(records.some(item=>item.event==="image_budget"&&item.mode==="pixel_limits_only"));
    assert.ok(records.filter(item=>item.event==="api_request"&&item.route.endsWith("/input_tokens")).every(item=>item.modelInvoked===false));
    let release;const started=new Promise(resolve=>release=resolve),controller=new AbortController();
    const client=new TranslationClient(async()=>{release();return new Promise(()=>{});});
    const pending=client.translateImage(image,{...DEFAULTS,model:"vision"},controller.signal);await started;controller.abort();await assert.rejects(pending,error=>error.name==="AbortError");assert.equal(client.stats.generations,0);assert.equal(client.active,0);
});


test("T15 image payload retention is bounded and clearing cancels all retained work",async()=>{
    const {ImageTranslator}=Plugin.testing;let current,downloads=0;
    const plugin={active:true,settings:{...DEFAULTS,targetLanguage:"English"},readMessage:()=>null,loadedMessages:()=>[],readReply:()=>null,getAreaTopic:()=>null,getGlossary:async()=>null,
        client:{downloadImage:async()=>{downloads++;return imageFixture();},translateImage:async()=>({hasText:true,translation:"translated",summary:"summary",sourceLanguage:"ENG"})}};
    const translator=new ImageTranslator(plugin,{document:{querySelectorAll:()=>[]}});translator.running=true;translator.render=()=>{};translator.locations=()=>new Map([[current.key,current]]);
    for(let i=0;i<101;i++){current={key:String(i),channelId:"101",messageId:String(i),url:"ignored by mock"};await translator.translate(current);}
    assert.equal(translator.entries.size,100);assert.equal(translator.imageCache.size,100);assert.equal(translator.imageCache.has("0"),false);
    assert.equal(translator.imageCacheSize,[...translator.imageCache.values()].reduce((sum,image)=>sum+image.dataUrl.length,0));
    const before=downloads;await translator.translate(current,"日本語");assert.equal(downloads,before);assert.equal(translator.imageCache.size,100);
    translator.clear();assert.equal(translator.entries.size,0);assert.equal(translator.imageCache.size,0);assert.equal(translator.imageCacheSize,0);
});


test("image captions such as yup remain reference data, never the final user translation target",async()=>{
    const requests=[],client=new TranslationClient(async(url,options)=>{
        const body=JSON.parse(options.body);requests.push({url,body});
        const data=url.endsWith("/input_tokens")?{input_tokens:512}:{choices:[{message:{content:JSON.stringify({translation:"游戏启动错误",summary:"需要通过官方启动器打开游戏。",sourceLanguage:"ENG",hasText:true})}}]};
        return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify(data))};
    });
    const context={target:{id:"202",channelId:"101",text:"yup",speaker:"sender"},before:[{id:"201",text:"nearby reference",speaker:"other"}],reply:{id:"200",text:"reply reference"},areaTopic:{threadTitle:"game",imageCaption:"yup"}};
    await client.translateImage(imageFixture(),{...DEFAULTS,model:"vision"},null,context);
    assert.equal(requests.length,2);
    for(const {body} of requests){
        const user=body.messages.at(-1);assert.equal(user.role,"user");assert.equal(user.content[0].type,"text");
        assert.ok(!user.content[0].text.includes("yup"));assert.match(user.content[0].text,/ONLY text physically visible inside/);
        assert.match(body.messages[0].content,/Never include or translate the accompanying Discord message/);
        const reference=body.messages.find(item=>item.content.startsWith?.("REFERENCE DATA"));
        const data=JSON.parse(reference.content.slice(reference.content.indexOf("\n")+1));
        assert.equal(data.target.text,undefined);assert.equal(data.target.contentScope,"image_attachment_only");
        assert.ok(body.messages.some(item=>typeof item.content==="string"&&item.content.includes('"imageCaption":"yup"')));
        assert.ok(JSON.stringify(body.messages).includes("reply reference"));assert.ok(JSON.stringify(body.messages).includes("nearby reference"));
    }
    assert.equal(client.stats.generations,1);
});


test("provider drafts independently remember credentials, models, limits and thinking across batched switches and reload",()=>{
    const host=settingsHost({baseUrl:"http://localhost:9012/v1",model:"local-vision",apiKey:"LOCAL_SECRET",timeoutSeconds:75,maxTokens:1024,contextTokens:4096},{deferUpdates:true});
    const panel=host.plugin.getSettingsPanel();let tree=host.render(panel);
    const set=(name,value)=>{find(tree,node=>node.props?.name===name).props.onInput({target:{value}});};
    const switchTo=mode=>{find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:mode}});};
    const value=name=>find(tree,node=>node.props?.name===name).props.value;
    switchTo("deepseek");set("baseUrl","https://deepseek.example.test/v1");set("model","deepseek-custom");set("apiKey","DEEPSEEK_SECRET");set("maxTokens","32768");set("contextTokens","131072");tree=host.render(panel);
    find(tree,node=>node.props?.name==="deepseekThinking").props.onChange({target:{checked:true}});tree=host.render(panel);
    find(tree,node=>node.props?.name==="deepseekReasoningEffort").props.onChange({target:{value:"max"}});
    switchTo("online");tree=host.render(panel);assert.equal(value("apiKey"),"");assert.equal(value("baseUrl"),"");assert.equal(value("model"),"");
    set("baseUrl","https://online.example.test/custom/v1");set("model","online-custom");set("apiKey","ONLINE_SECRET");
    switchTo("local");tree=host.render(panel);
    for(const [name,expected] of Object.entries({baseUrl:"http://localhost:9012/v1",model:"local-vision",apiKey:"LOCAL_SECRET",timeoutSeconds:75,maxTokens:1024,contextTokens:4096}))assert.equal(value(name),expected);
    assert.equal(host.writes.length,0);assert.equal(host.plugin.settings.providerProfiles.deepseek,undefined);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();
    const saved=JSON.parse(JSON.stringify(host.writes.at(-1).value));assert.equal(saved.providerMode,"local");assert.equal(saved.providerProfiles.deepseek.apiKey,"DEEPSEEK_SECRET");assert.equal(saved.providerProfiles.online.apiKey,"ONLINE_SECRET");
    const reopened=settingsHost(saved),nextPanel=reopened.plugin.getSettingsPanel();let next=reopened.render(nextPanel);
    find(next,node=>node.props?.name==="providerMode").props.onChange({target:{value:"deepseek"}});next=reopened.render(nextPanel);
    assert.equal(find(next,node=>node.props?.name==="apiKey").props.value,"DEEPSEEK_SECRET");assert.equal(find(next,node=>node.props?.name==="maxTokens").props.value,"32768");assert.equal(find(next,node=>node.props?.name==="deepseekThinking").props.checked,true);
    assert.equal(find(next,node=>node.props?.name==="deepseekReasoningEffort").props.value,"max");
    find(next,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();assert.equal(reopened.plugin.settings.maxTokens,32768);
});

test("cancel discards all provider draft edits; old DeepSeek configurations migrate only into their own profile",()=>{
    const legacy={providerMode:"deepseek",baseUrl:"https://api.deepseek.com",model:"saved-deepseek",apiKey:"OLD_SECRET",maxTokens:32768,contextTokens:131072};
    const host=settingsHost(legacy),panel=host.plugin.getSettingsPanel();let tree=host.render(panel);
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"local"}});tree=host.render(panel);
    assert.equal(find(tree,node=>node.props?.name==="baseUrl").props.value,DEFAULTS.baseUrl);assert.equal(find(tree,node=>node.props?.name==="apiKey").props.value,"");assert.equal(find(tree,node=>node.props?.name==="maxTokens").props.value,DEFAULTS.maxTokens);
    find(tree,node=>node.props?.name==="baseUrl").props.onInput({target:{value:"http://localhost:9876/v1"}});
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"deepseek"}});tree=host.render(panel);
    find(tree,node=>node.props?.name==="apiKey").props.onInput({target:{value:"UNSAVED_SECRET"}});
    find(tree,node=>node.type==="button"&&node.props.children[0]==="取消").props.onClick();tree=host.render(panel);
    assert.equal(host.writes.length,0);assert.equal(host.plugin.settings.apiKey,"OLD_SECRET");assert.equal(host.plugin.settings.providerProfiles.local,undefined);
    assert.equal(find(tree,node=>node.props?.name==="apiKey").props.value,"OLD_SECRET");
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"local"}});tree=host.render(panel);assert.equal(find(tree,node=>node.props?.name==="baseUrl").props.value,DEFAULTS.baseUrl);
});

test("inactive provider drafts do not invalidate current translations and active fields override stale profile snapshots",()=>{
    const {rememberProviderSettings,switchProviderSettings}=Plugin.testing;
    const legacy={...DEFAULTS,providerMode:"online",baseUrl:"https://active.example.test/v1",apiKey:"CURRENT_KEY",model:"current",providerProfiles:{online:{apiKey:"STALE_KEY",model:"stale"},deepseek:{apiKey:"DS_KEY",model:"ds",unknown:"drop",nested:{apiKey:"DROP"}},local:[]}};
    const remembered=rememberProviderSettings(legacy);assert.equal(remembered.providerProfiles.online.apiKey,"CURRENT_KEY");assert.equal(remembered.providerProfiles.deepseek.unknown,undefined);assert.equal(remembered.providerProfiles.local,undefined);
    const local=switchProviderSettings(remembered,"local");assert.equal(local.apiKey,"");assert.equal(switchProviderSettings(local,"online").model,"current");
    assert.equal(legacy.providerProfiles.online.apiKey,"STALE_KEY");assert.throws(()=>switchProviderSettings(local,"unknown"));
    const host=settingsHost(),panel=host.plugin.getSettingsPanel();let tree=host.render(panel),cancels=0;
    host.plugin.client.cancelAll=()=>cancels++;host.plugin.restartAutoTranslation=()=>cancels++;
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"deepseek"}});tree=host.render(panel);
    find(tree,node=>node.props?.name==="apiKey").props.onInput({target:{value:"DS_KEY"}});
    find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:"local"}});tree=host.render(panel);
    find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();assert.equal(cancels,0);assert.equal(host.plugin.settings.providerProfiles.deepseek.apiKey,"DS_KEY");
});


test("restored provider requests use only that provider's endpoint, model and credentials",async()=>{
    const host=settingsHost({baseUrl:"http://localhost:9911/v1",model:"vision-local",apiKey:"LOCAL_KEY"}),panel=host.plugin.getSettingsPanel();let tree=host.render(panel);const requests=[];
    host.plugin.client=new TranslationClient(async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return {status:200,arrayBuffer:async()=>Buffer.from(JSON.stringify({choices:[{message:{content:"translated"}}]}))};});
    const switchTo=mode=>{find(tree,node=>node.props?.name==="providerMode").props.onChange({target:{value:mode}});tree=host.render(panel);};
    const save=()=>{find(tree,node=>node.type==="button"&&node.props.children[0]==="保存并关闭").props.onClick();tree=host.render(panel);};
    switchTo("deepseek");find(tree,node=>node.props?.name==="apiKey").props.onInput({target:{value:"DEEPSEEK_KEY"}});save();
    await host.plugin.client.translate("test",host.plugin.settings);
    switchTo("local");save();await host.plugin.client.translate("test",host.plugin.settings);
    assert.equal(requests.length,2);assert.equal(requests[0].options.headers.Authorization,"Bearer DEEPSEEK_KEY");assert.equal(requests[0].body.model,"deepseek-flash");
    assert.equal(requests[1].url,"http://localhost:9911/v1/chat/completions");assert.equal(requests[1].options.headers.Authorization,"Bearer LOCAL_KEY");assert.equal(requests[1].body.model,"vision-local");
    assert.ok(!JSON.stringify(requests[1]).includes("DEEPSEEK_KEY"));assert.ok(!JSON.stringify(requests[0]).includes("LOCAL_KEY"));
    const count=host.writes.length;switchTo("online");save();assert.equal(host.writes.length,count);assert.equal(host.plugin.settings.providerMode,"local");
});


test("renamed namespace migrates legacy settings once without overwriting existing new settings",()=>{
    const legacyName="LocalTranslator",name="YetAnotherTranslator",calls=[],writes=[];
    const legacy={providerMode:"deepseek",baseUrl:"https://api.deepseek.com",model:"remembered-model",apiKey:"PRIVATE_TEST_KEY",targetLanguage:"日本語",autoTranslateAreas:{"101":{name:"game",enabled:true}},customAreas:{"101":{name:"game",enabled:true,glossaryPath:"C:/User Terms/game.json"}},providerProfiles:{local:{baseUrl:"http://localhost:9999/v1",apiKey:"LOCAL_TEST_KEY"}}};
    const data=new Map();
    class Api {
        constructor(namespace){assert.equal(namespace,name);}
        static React={createElement:(type,props)=>({type,props})};
        static Data={load:(namespace,key)=>{calls.push({namespace,key});return namespace===legacyName?legacy:null;}};
        Data={load:key=>data.get(key),save:(key,value)=>{writes.push(value);data.set(key,JSON.parse(JSON.stringify(value)));}};
        DOM={addStyle(){}};
    }
    const Renamed=load(Api),plugin=new Renamed();plugin.getSettingsPanel();
    assert.equal(writes.length,1);assert.equal(plugin.settings.apiKey,"PRIVATE_TEST_KEY");assert.equal(plugin.settings.providerProfiles.local.apiKey,"LOCAL_TEST_KEY");
    assert.equal(plugin.settings.customAreas["101"].glossaryPath,"C:/User Terms/game.json");assert.equal(plugin.settings.autoTranslateAreas["101"].enabled,true);
    const reopened=new Renamed();reopened.getSettingsPanel();assert.equal(calls.length,1);assert.equal(writes.length,1);assert.equal(reopened.settings.model,"remembered-model");
    data.set("settings",{});new Renamed().getSettingsPanel();assert.equal(calls.length,1);assert.equal(writes.length,1);
});

test("legacy namespace load failures do not write defaults over existing user data",()=>{
    let writes=0;
    class Api {
        static React={createElement:(type,props)=>({type,props})};
        static Data={load(){throw Error("synthetic legacy read failure");}};
        Data={load:()=>undefined,save(){writes++;}};DOM={addStyle(){}};
    }
    const Renamed=load(Api);assert.throws(()=>new Renamed().getSettingsPanel(),/synthetic legacy read failure/);assert.equal(writes,0);
});


test("outgoing non-text filter sends emoji, links and attachment-only payloads unchanged without context or model calls",async()=>{
    const sources=["", "  \n", "😀", "👍🏽", "👨‍👩‍👧‍👦", "🇨🇳", "1️⃣", "❤", "❤️", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "<:happy:1409648830307369061>", "<a:dance:1409649023870173377>", "https://example.test/image.png?a=1&b=2", "<https://example.test/game>", "HTTPS://EXAMPLE.TEST/game", "||😀||", "😀 https://example.test", "<@123456789012345678>"];
    for(const source of sources)for(const includeOriginal of [false,true]){
        const f=outgoingFixture({source});f.plugin.settings.outgoingIncludeOriginal=includeOriginal;
        f.plugin.outgoingContext=()=>{throw Error("must skip reference lookup");};f.plugin.getGlossary=()=>{throw Error("must skip terminology lookup");};
        f.payload.uploads=[{id:"image-upload"}];f.payload.stickers=["sticker-id"];
        const result=await f.outgoing.submit("101",[f.payload,f.extra],f.original,f.editor);
        assert.equal(result.shouldClear,true);assert.equal(f.requests.length,0);assert.equal(f.errors.length,0);assert.equal(f.sent.length,1);
        assert.equal(f.sent[0][0],f.payload);assert.equal(f.sent[0][1],f.extra);assert.equal(f.sent[0][0].value,source);assert.equal(f.outgoing.pending.size,0);
    }
});

test("outgoing filter keeps real words, digits and captions eligible for translation",async()=>{
    for(const source of ["hello 😀","请看 https://example.test","1","#","*",":)","[guide](https://example.test)","||需要翻译||","文字 <:happy:1409648830307369061>"]){
        const f=outgoingFixture({source});await f.outgoing.submit("101",[f.payload,f.extra],f.original,f.editor);assert.equal(f.requests.length,1,source);assert.equal(f.sent.length,1);assert.equal(f.sent[0][0].value,"I want the signature weapon");
    }
});

test("direct native sending cancels the previous channel job and prevents a late translated send",async()=>{
    const f=outgoingFixture();let complete;f.plugin.client.translate=()=>new Promise(resolve=>{complete=resolve;});
    const old=f.outgoing.submit("101",[f.payload,f.extra],f.original,f.editor);await new Promise(setImmediate);
    const job=f.outgoing.pending.get("101"),native={...f.payload,value:"😀"};
    await f.outgoing.submit("101",[native,f.extra],f.original,f.editor);assert.equal(job.controller.signal.aborted,true);
    complete("late translation");await old;assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],native);assert.equal(f.outgoing.pending.size,0);
});
