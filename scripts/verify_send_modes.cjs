"use strict";
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),assert=require("node:assert/strict");
const dependencies=require("node:module").createRequire(path.resolve(__dirname,"../.local/markdown-verify/package.json"));
const {JSDOM}=dependencies("jsdom");
const dom=new JSDOM('<!doctype html><html><head></head><body><div class="channelTextArea_test"><div class="buttons_test"></div><div role="textbox" contenteditable="true" data-slate-editor="true"></div></div></body></html>',{url:"https://discord.com"});
const filename=path.resolve(__dirname,"../YetAnotherTranslator.plugin.js");
const sandbox={module:{exports:{}},require,__dirname:path.dirname(filename),URL,AbortController,TextDecoder,setTimeout,clearTimeout,BdApi:{}};
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
}
verifyFooter().catch(error=>{console.error(error);process.exitCode=1;});
