"use strict";
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),assert=require("node:assert/strict");
const dependencies=require("node:module").createRequire(path.resolve(__dirname,"../.local/markdown-verify/package.json"));
const {JSDOM}=dependencies("jsdom");
const dom=new JSDOM('<!doctype html><html><head></head><body><div class="channelTextArea_test"><div class="buttons_test"></div><div role="textbox" contenteditable="true" data-slate-editor="true"></div></div></body></html>',{url:"https://discord.com"});
const filename=path.resolve(__dirname,"../YetAnotherTranslator.plugin.js");
const sandbox={module:{exports:{}},require,__dirname:path.dirname(filename),URL,AbortController,TextDecoder,setTimeout,clearTimeout,document:dom.window.document,BdApi:{}};
vm.runInNewContext(fs.readFileSync(filename,"utf8")+'\nmodule.exports.testing={DEFAULTS,OutgoingTranslator,CSS,bindSettingsFooter};',sandbox);
const Plugin=sandbox.module.exports,{DEFAULTS,OutgoingTranslator,CSS}=Plugin.testing,plugin=new Plugin();
const document=dom.window.document,style=document.createElement("style");style.textContent=CSS;document.head.append(style);
plugin.settings={...DEFAULTS};let writes=0;
plugin.api={Data:{save(){writes++;}},Patcher:{instead:()=>()=>{}}};
const owner={props:{channel:{id:"101"}},forceUpdate(){}};
const outgoing=new OutgoingTranslator(plugin,{document,clearTimeout,getComputedStyle:node=>dom.window.getComputedStyle(node)});
outgoing.submission=()=>({instance:owner,key:"onSubmit",channelId:"101"});plugin.outgoingTranslator=outgoing;
outgoing.scan();
const toggle=document.querySelector(".lt-compose-controls button"),language=document.querySelector(".lt-compose-controls select");
assert.ok(toggle.querySelector("svg"));assert.equal(toggle.getAttribute("data-send-mode"),"original");
assert.equal(toggle.getAttribute("role"),null);assert.equal(toggle.getAttribute("aria-pressed"),"false");
toggle.click();assert.equal(toggle.getAttribute("data-send-mode"),"translated");assert.equal(plugin.settings.outgoingIncludeOriginal,false);
const translationColor=dom.window.getComputedStyle(toggle).color;
toggle.click();assert.equal(toggle.getAttribute("data-send-mode"),"bilingual");assert.equal(plugin.settings.outgoingIncludeOriginal,true);
assert.equal(toggle.getAttribute("aria-pressed"),"mixed");assert.match(toggle.title,/原文及译文/);
assert.notEqual(dom.window.getComputedStyle(toggle).color,translationColor);
language.value="日本語";language.dispatchEvent(new dom.window.Event("change"));
assert.equal(toggle.getAttribute("data-send-mode"),"bilingual");assert.equal(plugin.settings.outgoingLanguage,"日本語");
toggle.click();assert.equal(toggle.getAttribute("data-send-mode"),"original");assert.equal(plugin.settings.outgoingIncludeOriginal,false);
assert.equal(writes,4);
plugin.settings.outgoingTranslate=true;plugin.settings.outgoingIncludeOriginal=true;outgoing.scan();
assert.equal(toggle.getAttribute("data-send-mode"),"bilingual");
plugin.settings.outgoingIncludeOriginal=false;outgoing.scan();assert.equal(toggle.getAttribute("data-send-mode"),"translated");
outgoing.stop();assert.equal(document.querySelector(".lt-compose-controls"),null);
console.log("PASS: three-state button clicks, distinct active colors, settings linkage, language preservation and cleanup in real DOM simulation.");
function verifyAreaTags() {
    const sidebar=document.createElement("nav");sidebar.innerHTML='<a href="/channels/1/101"><span class="name_test">same name</span></a><a href="/channels/1/202"><span class="name_test">same name</span></a><a href="/channels/1/303"><span class="name_test">forum</span></a><a href="/channels/1/304"><span class="threadName_test">thread</span></a><a href="/channels/@me/505"><span class="name_test">DM</span></a>';
    document.body.append(sidebar);
    const messageLink=document.createElement("a");messageLink.href="/channels/1/101/9";messageLink.innerHTML='<span class="name_test">message link</span>';document.body.append(messageLink);
    plugin.active=true;plugin.setAutoTranslation(true,"101");
    assert.equal(sidebar.querySelectorAll(".lt-area-auto-tag").length,1);assert.equal(messageLink.querySelector(".lt-area-auto-tag"),null);
    let anchor=sidebar.querySelector('[href="/channels/1/101"]');assert.ok(anchor.querySelector(".name_test > .lt-area-auto-tag"));
    assert.equal(sidebar.querySelector('[href="/channels/1/202"] .lt-area-auto-tag'),null);
    plugin.scanAreaTags();assert.equal(sidebar.querySelectorAll(".lt-area-auto-tag").length,1);
    anchor.innerHTML='<span class="name_test">renamed</span>';plugin.scanAreaTags();assert.equal(anchor.querySelectorAll(".lt-area-auto-tag").length,1);
    const replacement=anchor.cloneNode(true);replacement.querySelector(".lt-area-auto-tag").remove();anchor.replaceWith(replacement);anchor=replacement;
    plugin.scanAreaTags();assert.equal(sidebar.querySelectorAll(".lt-area-auto-tag").length,1);
    anchor.setAttribute("href","/channels/1/202");plugin.scanAreaTags();assert.equal(sidebar.querySelectorAll(".lt-area-auto-tag").length,0);
    plugin.setAutoTranslation(true,"303");assert.ok(sidebar.querySelector('[href="/channels/1/303"] .lt-area-auto-tag'));assert.equal(sidebar.querySelector('[href="/channels/1/304"] .lt-area-auto-tag'),null);
    plugin.setAutoTranslation(true,"505");assert.ok(sidebar.querySelector('[href="/channels/@me/505"] .lt-area-auto-tag'));
    plugin.setAutoTranslation(false,"303");assert.equal(sidebar.querySelector('[href="/channels/1/303"] .lt-area-auto-tag'),null);
    const list=document.createElement("div");list.setAttribute("role","treeitem");list.setAttribute("data-list-item-id","channels___606");
    list.innerHTML='<span id="channel-name-606" class="hashLabel">No link</span>';document.body.append(list);plugin.setAutoTranslation(true,"606");
    assert.ok(list.querySelector("#channel-name-606 > .lt-area-auto-tag"));
    const compact=document.createElement("div");compact.className="sidebar_fresh";
    compact.innerHTML='<div class="row"><a href="https://discord.com/channels/1/707"><div id="channel-name-707" style="overflow:hidden;white-space:nowrap;width:100%">Long compact name</div></a></div><div data-list-item-id="private-channels-uid_1___808" aria-labelledby="renamed-label"><span id="renamed-label">DM label</span></div><div data-list-item-id="channels___909">Raw text label</div>';
    document.body.append(compact);plugin.setAutoTranslation(true,"707");plugin.setAutoTranslation(true,"808");plugin.setAutoTranslation(true,"909");
    const label=compact.querySelector("#channel-name-707");assert.ok(label.querySelector(".lt-area-auto-tag"));
    assert.equal(dom.window.getComputedStyle(label).paddingInlineEnd,"21px");assert.equal(dom.window.getComputedStyle(label.querySelector(".lt-area-auto-tag")).position,"absolute");
    assert.ok(compact.querySelector("#renamed-label > .lt-area-auto-tag"));assert.ok(compact.querySelector('[data-list-item-id="channels___909"] > .lt-area-auto-tag'));
    compact.querySelector(".row").setAttribute("data-list-item-id","channels___707");
    plugin.scanAreaTags();plugin.scanAreaTags();assert.equal(label.querySelectorAll(".lt-area-auto-tag").length,1);assert.ok(label.classList.contains("lt-area-tagged-name"));
    const clone=list.cloneNode(true);list.replaceWith(clone);plugin.scanAreaTags();assert.equal(clone.querySelectorAll(".lt-area-auto-tag").length,1);
    plugin.setAutoTranslation(false,"606");assert.equal(clone.querySelector(".lt-area-auto-tag"),null);assert.equal(clone.querySelector(".lt-area-tagged-name"),null);
    plugin.api.DOM={removeStyle(){}};plugin.stop();assert.equal(sidebar.querySelector(".lt-area-auto-tag"),null);assert.equal(plugin.areaTags.size,0);
    sidebar.remove();messageLink.remove();
    assert.equal(compact.querySelector(".lt-area-tagged-name"),null);clone.remove();compact.remove();
    console.log("PASS: sidebar per-area badges, same-name IDs, no forum inheritance, DM, remount/navigation, deduplication and plugin-stop cleanup.");
}
verifyAreaTags();
async function verifyFooter() {
    const modal=document.createElement("div");modal.className="bd-addon-modal";
    modal.innerHTML='<div class="lt-panel"><button type="button">Test</button></div><footer><button type="submit" class="native-button">Done</button><span class="anchor"></span></footer>';
    document.body.append(modal);const panel=modal.querySelector(".lt-panel"),confirm=modal.querySelector('[type="submit"]');
    let saves=0,closes=0,cancels=0;confirm.addEventListener("click",()=>closes++);
    const actions={current:{busy:false,save(){saves++;return true;},cancel(){cancels++;}}};
    let binding=Plugin.testing.bindSettingsFooter(panel,actions);
    const footer=modal.querySelector(".lt-modal-footer"),cancel=footer.querySelector('[type="button"]');
    assert.equal(footer.children[0],cancel);assert.equal(footer.children[1],confirm);
    assert.equal(dom.window.getComputedStyle(footer).gap,"12px");
    const expected=dom.window.getComputedStyle(panel.querySelector("button")).backgroundColor;
    assert.equal(dom.window.getComputedStyle(confirm).backgroundColor,expected);assert.equal(dom.window.getComputedStyle(cancel).backgroundColor,expected);
    confirm.click();await Promise.resolve();assert.equal(saves,1);assert.equal(closes,1);binding.cleanup();
    assert.equal(modal.querySelector(".lt-modal-footer"),null);assert.equal(confirm.nextElementSibling.className,"anchor");
    assert.equal(confirm.className,"native-button");assert.equal(confirm.textContent,"Done");
    binding=Plugin.testing.bindSettingsFooter(panel,actions);modal.querySelector('.lt-modal-footer [type="button"]').click();
    assert.equal(cancels,1);assert.equal(saves,1);assert.equal(closes,2);binding.cleanup();modal.remove();
    console.log("PASS: modal footer gap, order, matching button colors, save/cancel routing and host cleanup in real DOM simulation.");
    global.window=dom.window;global.document=document;
    const React=dependencies("react"),ReactDOM={...dependencies("react-dom"),...dependencies("react-dom/client")};
    const h=React.createElement;
    for(const cancelMode of [false,true]) {
        const rootNode=document.createElement("div");document.body.append(rootNode);let actualSaves=0,actualCancels=0;
        function Settings() {
            const ref=React.useRef(null),handlers=React.useRef({busy:false,save(){actualSaves++;return true;},cancel(){actualCancels++;}});
            React.useLayoutEffect(()=>{const bound=Plugin.testing.bindSettingsFooter(ref.current,handlers);return ()=>bound.cleanup();},[]);
            return h("div",{ref,className:"lt-panel"},"settings");
        }
        function Host() {
            const[open,setOpen]=React.useState(true);
            return open?h("div",{className:"bd-addon-modal"},h(Settings),h("footer",null,h("button",{type:"submit",onClick:()=>setOpen(false)},"Done"))):null;
        }
        const reactRoot=ReactDOM.createRoot(rootNode);ReactDOM.flushSync(()=>reactRoot.render(h(Host)));
        rootNode.querySelector(cancelMode?'.lt-modal-footer [type="button"]':'.lt-modal-footer [type="submit"]').click();
        await new Promise(resolve=>setTimeout(resolve,20));
        assert.equal(actualSaves,cancelMode?0:1);assert.equal(actualCancels,cancelMode?1:0);assert.equal(rootNode.childNodes.length,0);
        ReactDOM.flushSync(()=>reactRoot.unmount());rootNode.remove();
    }
    console.log("PASS: actual React host save/cancel closes and unmounts without footer DOM ownership errors.");
    await verifySettingsLayout(React,ReactDOM);
}
async function verifySettingsLayout(React,ReactDOM) {
    let locale="en-US",writes=0;const listeners=new Set();
    const saved={...DEFAULTS,providerMode:"deepseek",baseUrl:"https://api.deepseek.com",model:"deepseek-flash",customAreas:{"101":{name:"Game area",enabled:true,glossaryPath:"C:/Terms/game.json"}}};
    class SettingsApi {
        static React=React;
        static Webpack={getStore:name=>name==="LocaleStore"?{getLocale:()=>locale,addChangeListener:listener=>listeners.add(listener),removeChangeListener:listener=>listeners.delete(listener)}:null};
        Data={load:()=>saved,save(){writes++;}};DOM={addStyle(){}};
    }
    const settingsSandbox={...sandbox,module:{exports:{}},BdApi:SettingsApi};
    vm.runInNewContext(fs.readFileSync(filename,"utf8"),settingsSandbox);
    const SettingsPlugin=settingsSandbox.module.exports;
    const settingsPlugin=new SettingsPlugin();settingsPlugin.active=true;settingsPlugin.currentChannelId=()=>"101";settingsPlugin.areaName=()=>"Game area";
    const rootNode=document.createElement("div");document.body.append(rootNode);const reactRoot=ReactDOM.createRoot(rootNode);
    ReactDOM.flushSync(()=>reactRoot.render(settingsPlugin.getSettingsPanel()));
    const sections=[...rootNode.querySelectorAll("[data-lt-settings-section]")];
    assert.deepEqual(sections.map(node=>node.getAttribute("data-lt-settings-section")),["messages","outgoing","model","glossary","diagnostics"]);
    for(const name of ["debugEnabled","autoTranslateCurrentArea","skipOwnMessages","outgoingIncludeOriginal","glossaryEconomy"]){
        const input=rootNode.querySelector('input[name="'+name+'"]'),label=input.closest("label"),note=label.querySelector(":scope > .lt-note");
        assert.ok(note,name+" has separate help text");assert.equal(dom.window.getComputedStyle(note).display,"block");assert.equal(dom.window.getComputedStyle(note).fontSize,"12px");assert.equal(dom.window.getComputedStyle(note).fontWeight,"normal");
    }
    assert.ok(sections[0].querySelector('[name="targetLanguage"]'));assert.ok(sections[1].querySelector('[name="outgoingLanguage"]'));assert.ok(sections[2].querySelector('[name="apiKey"]'));assert.ok(sections[3].querySelector('[name="glossary-101"]'));assert.ok(sections[4].querySelector('[name="debugEnabled"]'));
    const advanced=sections[2].querySelector("details");assert.equal(advanced.open,false);advanced.querySelector("summary").click();assert.equal(advanced.open,true);assert.equal(advanced.querySelector('[name="timeoutSeconds"]').value,"120");
    const provider=rootNode.querySelector('[name="providerMode"]');ReactDOM.flushSync(()=>{provider.value="local";provider.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
    assert.equal(rootNode.querySelector('[name="baseUrl"]').value,DEFAULTS.baseUrl);assert.equal(advanced.open,true);assert.equal(writes,0);
    settingsPlugin.client.testConnection=async()=>({models:["synthetic-connection-model"],generated:false});
    const testButton=[...sections[2].querySelectorAll("button")].find(button=>button.textContent==="Test connection");
    ReactDOM.flushSync(()=>testButton.click());await new Promise(resolve=>setTimeout(resolve,20));
    const feedback=sections[2].querySelector("[data-lt-connection-result]");assert.ok(feedback.textContent.includes("synthetic-connection-model"));assert.equal(feedback.getAttribute("role"),"status");assert.equal(writes,0);
    locale="ja";ReactDOM.flushSync(()=>{for(const listener of [...listeners])listener();});assert.equal(rootNode.querySelector(".lt-settings-section h3").textContent,"メッセージ翻訳");assert.equal(rootNode.querySelector('[name="baseUrl"]').value,DEFAULTS.baseUrl);
    ReactDOM.flushSync(()=>reactRoot.unmount());rootNode.remove();assert.equal(listeners.size,0);
    console.log("PASS: real settings React DOM section order, block help text, advanced disclosure, provider drafts and live localized headings.");
}
verifyFooter().catch(error=>{console.error(error);process.exitCode=1;});
