"use strict";
// Test-only pinned dependencies live outside the distributed plugin.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path"), assert = require("node:assert/strict");
const dependencies = require("node:module").createRequire(path.resolve(__dirname, "../.local/markdown-verify/package.json"));
const {JSDOM} = dependencies("jsdom"), React = dependencies("react"), markdown = dependencies("simple-markdown");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {url: "https://discord.com"});
global.window = dom.window; global.document = dom.window.document;
const ReactDOM = {...dependencies("react-dom"), ...dependencies("react-dom/client")};
const filename = path.resolve(__dirname, "../YetAnotherTranslator.plugin.js");
let native = null, nativeCalls = 0;
const BdApi = {React, ReactDOM, Webpack: {
    getByKeys: (...keys) => keys.includes("parseTopic") ? native : keys.includes("defaultReactOutput") ? markdown : null,
    getStore: name => name === "UserStore" ? {getUser: () => ({username: "Alice"})} : null
}};
const sandbox = {module: {exports: {}}, require, __dirname: path.dirname(filename), URL, AbortController, TextDecoder, setTimeout, clearTimeout, BdApi};
vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports.verify = {renderTranslatedMessage, AutoTranslator, DEFAULTS, CSS};", sandbox);
const render = (text, check, sourceText = text) => {
    const container = document.createElement("div"); document.body.append(container); let cleanup;
    try {
        ReactDOM.flushSync(() => {cleanup = sandbox.module.exports.verify.renderTranslatedMessage(container, text, {text: sourceText}, document);});
        assert.equal(container.textContent.includes("\uE000"), false, "display placeholders must not leak");
        check(container);
    } finally {if (cleanup) ReactDOM.flushSync(cleanup); assert.equal(container.childNodes.length, 0); container.remove();}
};
const emoji = "<:smile:1409648830307369061>";
// Real library + React DOM assertions cover the compatibility rules, not a mocked AST.
render("# Heading\nbody", node => {assert.equal(node.getAttribute("data-lt-markdown-engine"), "discord-compatibility"); assert.equal(node.querySelector("h1").textContent, "Heading"); assert.ok(node.textContent.includes("body")); assert.ok(!node.querySelector("h1").textContent.includes("body"));});
render("before\n## Heading\nbody\n-# subtext\nafter", node => {
    assert.equal(node.querySelector("h2").textContent, "Heading"); assert.equal(node.querySelector("small").textContent, "subtext");
    assert.ok(node.textContent.includes("before")); assert.ok(node.textContent.includes("after"));
});
render("-# subtext", node => {assert.equal(node.querySelector("small").textContent, "subtext"); assert.ok(!node.textContent.includes("-#"));});
render(">>> first\nsecond\n\nthird", node => {assert.equal(node.querySelectorAll("blockquote").length, 1); assert.ok(node.querySelector("blockquote").textContent.includes("third"));});
render(">>> first " + emoji + "\n\n||**secret** " + emoji + "||\n\nthird <@101>", node => {
    const quote = node.querySelector("blockquote"); assert.equal(node.querySelectorAll("blockquote").length, 1);
    assert.ok(quote.querySelector(".lt-rendered-emoji")); assert.equal(quote.querySelector(".lt-rendered-mention").textContent, "@Alice");
    const hidden = quote.querySelector(".lt-spoiler-content"); assert.equal(hidden.hidden, true); assert.ok(hidden.querySelector("strong"));
    assert.ok(hidden.querySelector(".lt-rendered-emoji")); quote.querySelector(".lt-spoiler-reveal").click(); assert.equal(hidden.hidden, false);
    assert.ok(quote.textContent.includes("third"));
});
render("**bold** __underline__ *italic* ~~strike~~ [link](https://example.com)\n\n- one\n- two\n\n```js\n# code\n>>> literal\n```\n\ntext (AI translation)", node => {
    for (const selector of ["strong", "u", "em", "del", 'a[href="https://example.com"]', "ul li", "pre code", ".lt-ai-label"]) assert.ok(node.querySelector(selector), selector);
    assert.equal(node.querySelector("h1"), null); assert.equal(node.querySelector("blockquote"), null);
    assert.ok(node.querySelector("pre code").textContent.includes(">>> literal"));
});
render("\\# literal\n\\-# literal\n\\>>> literal", node => {assert.equal(node.querySelector("h1,small,blockquote"), null);});
render("[unsafe](javascript:alert(1)) <script>bad</script> ![remote](https://example.com/pixel)", node => {
    assert.equal(node.querySelector('script,img,a[href^="javascript:"]'), null);
});
render("[trusted](https://example.com/path) [invented](https://evil.example/path)", node => {
    assert.ok(node.querySelector('a[href="https://example.com/path"]'));
    assert.equal(node.querySelector('a[href="https://evil.example/path"]'),null);
    assert.ok(node.textContent.includes("invented"));
}, "original https://example.com/path");
render("[prefix](https://example.com/path) [suffix](https://example.com/path.evil)", node => {
    assert.equal(node.querySelectorAll("a").length,1);
}, "original https://example.com/path");
// The same classifier must protect click targets while accepting Chinese-adjacent originals.
render("[docs](https://example.com/index.js)", node => {
    assert.ok(node.querySelector('a[href="https://example.com/index.js"]'));
}, "请看https://example.com/index.js然后回复");
for(const file of ["debug.log","index.js","style.css","index.html"]) render("[download](https://"+file+")", node => {
    assert.equal(node.querySelector("a"),null);assert.ok(node.textContent.includes("download"));
}, "文件名改成"+file);
render("[网页](https://例子.中国/路径)", node => {
    assert.ok(node.querySelector("a"));
}, "请看<https://例子.中国/路径>然后回复");
// Unicode destinations must be complete and use the same canonical form as sends.
render("[changed](https://example.com/café)", node => {
    assert.equal(node.querySelector("a"),null);
}, "Visit https://example.com/caf");
render("[equivalent](https://example.com/caf%c3%a9)", node => {
    assert.ok(node.querySelector("a"));
}, "Visit https://example.com/café");
render("[changed](https://example.com/?q=cafè)", node => {
    assert.equal(node.querySelector("a"),null);
}, "Visit https://example.com/?q=café");
// Branch probe: real DOM, both modules available. This is not a live Discord parser.
native = {parseTopic() {}, parse(text, inline, state) {nativeCalls++; assert.equal(inline, true); assert.equal(state.allowHeading, true); assert.equal(state.allowList, true); return React.createElement("div", {"data-native-probe": true}, text);}};
render("# Heading\nbody", node => {assert.equal(node.getAttribute("data-lt-markdown-engine"), "discord-message"); assert.ok(node.querySelector("[data-native-probe]")); assert.equal(node.querySelector("h1"), null);});
assert.equal(nativeCalls, 1);
native = {parseTopic() {}, parse() {throw Error("changed host interface");}};
render("# Heading\nbody", node => {assert.equal(node.querySelector("h1").textContent, "Heading");});
console.log("PASS: real Markdown/React DOM headings, subtext, multiline quotes, emoji/spoilers, safety, cleanup and message-parser priority. Live Discord remains a separate verification.");

// Badges are siblings of the React root: a Markdown commit must not remove them.
{
    const {AutoTranslator,DEFAULTS,CSS,renderTranslatedMessage}=sandbox.module.exports.verify;
    const style=document.createElement("style");style.textContent=CSS;document.head.append(style);
    const auto=new AutoTranslator({},DEFAULTS,{document});auto.running=true;
    for(const hasHeader of [true,false]) {
        const row=document.createElement("div");row.id="chat-messages-101-202";
        row.innerHTML=(hasHeader?"<h3>Sender</h3>":"")+'<div id="message-content-202">original</div>';
        const output=document.createElement("div");output.className="lt-message-text";
        const content=document.createElement("div");content.className="lt-translation-content";output.append(content);row.append(output);document.body.append(row);
        const entry={state:"done",sourceLanguage:"ENG",text:"original",node:row.querySelector('[id="message-content-202"]'),output};
        auto.renderLanguageBadge(entry);const badge=entry.languageBadge;
        let cleanup;ReactDOM.flushSync(()=>{cleanup=renderTranslatedMessage(content,"**translated** text",entry,document);});
        assert.equal(output.firstElementChild,badge);assert.equal(badge.nextElementSibling,content);assert.equal(content.contains(badge),false);
        assert.equal(row.querySelector("h3 .lt-source-language"),null);assert.equal(content.querySelector("strong").textContent,"translated");
        assert.equal(dom.window.getComputedStyle(output).display,"flex");assert.equal(dom.window.getComputedStyle(content).minWidth,"0");
        auto.renderLanguageBadge(entry);assert.equal(output.querySelectorAll(".lt-source-language").length,1);
        ReactDOM.flushSync(cleanup);assert.equal(output.firstElementChild,badge);badge.remove();row.remove();
    }
    style.remove();
    console.log("PASS: first and grouped message badges precede translated content outside React roots and survive Markdown commits.");
}
