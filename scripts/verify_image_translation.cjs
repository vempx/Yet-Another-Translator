"use strict";
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),assert=require("node:assert/strict");
const dependencies=require("node:module").createRequire(path.resolve(__dirname,"../.local/markdown-verify/package.json"));
const {JSDOM}=dependencies("jsdom");
const dom=new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>',{url:"https://discord.com"});
const document=dom.window.document;let menu;
const BdApi={React:{createElement:(type,props,...children)=>({type,props:{...props,children}})}};
const sandbox={module:{exports:{}},require,URL,AbortController,TextDecoder,setTimeout,clearTimeout,BdApi};
const filename=path.resolve(__dirname,"../YetAnotherTranslator.plugin.js");
vm.runInNewContext(fs.readFileSync(filename,"utf8")+'\nmodule.exports.testing={DEFAULTS,ImageTranslator,CSS};',sandbox);
const Plugin=sandbox.module.exports,{DEFAULTS,ImageTranslator,CSS}=Plugin.testing;
const style=document.createElement("style");style.textContent=CSS;document.head.append(style);
const plugin=new Plugin();plugin.active=true;plugin.settings={...DEFAULTS,targetLanguage:"English"};
plugin.api={ContextMenu:{buildItem:config=>({props:{...config,children:config.items.map(item=>({props:item}))}}),buildMenu:items=>items,open:(event,items)=>{menu=items;},close(){}},Data:{save(){throw Error("image language must not change saved settings");}}};
plugin.readMessage=(channel,id)=>({id,channel_id:channel,content:"image caption",author:{id:"author"}});
plugin.loadedMessages=()=>[];plugin.readReply=()=>({id:"reply",text:"original reply"});plugin.getAreaTopic=()=>({threadTitle:"Wuthering Waves"});
const calls={download:[],ocr:[],summary:[],glossary:[]};let summaryImpl=null,ocrImpl=null;
plugin.getGlossary=async(channel,text,context)=>{calls.glossary.push({channel,text,context});return {entries:[{en:"Iuno",zh:"尤诺"}]};};
plugin.client={async downloadImage(url){calls.download.push(url);return {dataUrl:"data:image/png;base64,iVBORw0KGgo=",mime:"image/png",bytes:8,tag:new URL(url).pathname.split("/").at(-1)};},
    async readImage(image,settings,signal,info){calls.ocr.push({image,settings,signal,info});return ocrImpl?ocrImpl(image,settings,signal,info):{text:"Iuno "+image.tag,sourceLanguage:"ENG",model:"vision"};},
    async summarizeImageText(text,settings,signal,context,info){calls.summary.push({text,settings,signal,context,info});return summaryImpl?summaryImpl(text,settings,signal,context,info):{translation:settings.targetLanguage+": "+text,summary:'<img src=x onerror="bad()"> summary'};}};
const translator=new ImageTranslator(plugin,{document,Image:dom.window.Image});plugin.imageTranslator=translator;translator.start();
function row(channel="101",id="202"){
    const node=document.createElement("div");node.id=`chat-messages-${channel}-${id}`;
    for(const file of ["one.png","two.png"]){const container=document.createElement("div");container.className="visualMediaItemContainer_fixture";const wrapper=document.createElement("div");wrapper.className="imageWrapper_fixture";const link=document.createElement("a");link.href=`https://cdn.discordapp.com/attachments/${channel}/${id}/${file}?ex=signed`;const image=document.createElement("img");image.src=`https://media.discordapp.net/attachments/${channel}/${id}/${file}?width=100`;link.append(image);wrapper.append(link);container.append(wrapper);node.append(container);}
    document.querySelector("main").append(node);return node;
}
function menuItem(tree,id){return tree.props.children.flatMap(group=>group.props.children||[]).find(node=>node.props.id===id);}
const event=()=>({preventDefault(){},stopPropagation(){}});
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
async function main(){
    let message=row(),images=message.querySelectorAll("img");
    images[0].dispatchEvent(new dom.window.MouseEvent("contextmenu",{bubbles:true}));
    const tree={props:{navId:"image-context",children:[]}};plugin.patchImageMenu(tree,{src:images[0].src});plugin.patchImageMenu(tree,{src:images[0].src});
    assert.equal(tree.props.children.length,1);const item=menuItem(tree,"local-translator-image");assert.equal(item.props.label,"翻译概括图片内文字");
    assert.equal(translator.menuLocation({target:images[0],message:{id:"wrong-message"}}),null);
    images[1].parentElement.className="spoilerContent_fixture hidden_fixture";assert.equal(translator.location(images[1]),null);images[1].parentElement.className="";
    item.props.action();assert.equal(message.querySelector(".lt-image-language").disabled,true);item.props.action();await flush();
    assert.equal(calls.download.length,1);assert.equal(calls.ocr.length,1);assert.equal(calls.summary.length,1);
    let first=message.querySelector(".lt-image-result");assert.equal(first.previousElementSibling,images[0].closest('[class*="visualMediaItemContainer"]'));
    assert.ok(first.textContent.includes("English: Iuno one.png"));assert.equal(first.querySelector("img"),null);assert.equal(first.querySelector("button").textContent,"ENG");
    assert.equal(dom.window.getComputedStyle(first).fontSize,"0.875rem");assert.ok(CSS.includes(".lt-image-result"));assert.match(dom.window.getComputedStyle(first).color,/text-muted|153/);
    assert.equal(calls.summary[0].context.areaTopic.threadTitle,"Wuthering Waves");assert.equal(calls.summary[0].context.areaTopic.imageCaption,"image caption");
    assert.equal(calls.summary[0].context.reply.text,"original reply");assert.equal(calls.glossary[0].text,"Iuno one.png");
    first.querySelector("button").click();const japanese=menu.find(item=>item.id.endsWith("JPN")),control=japanese.control({},null);
    assert.equal(control.props.children.filter(child=>child&&child.type==="button").length,1);
    control.props.children[0].props.onClick(event());await flush();
    assert.equal(calls.download.length,1);assert.equal(calls.ocr.length,1);assert.equal(calls.summary.length,2);assert.equal(calls.summary[1].settings.targetLanguage,"日本語");
    assert.equal(plugin.settings.targetLanguage,"English");assert.equal(plugin.settings.autoTranslateAreas["101"],undefined);
    assert.ok(message.querySelector(".lt-image-result").textContent.includes("日本語"));
    await translator.translate(translator.location(images[0]),"English");assert.equal(calls.summary.length,2);
    await translator.translate(translator.location(images[1]));assert.equal(calls.download.length,2);assert.equal(message.querySelectorAll(".lt-image-result").length,2);
    assert.ok(message.querySelectorAll(".lt-image-result")[1].textContent.includes("two.png"));
    console.log("PASS: image context menu deduplication, exact image placement, muted small text, safe output, default language and OCR reuse across language changes.");

    let completeOld,oldStarted;const started=new Promise(resolve=>oldStarted=resolve);
    summaryImpl=(text,settings)=>settings.targetLanguage==="Deutsch"?new Promise(resolve=>{completeOld=resolve;oldStarted();}):Promise.resolve({translation:settings.targetLanguage,summary:"summary"});
    const pending=translator.translate(translator.location(images[0]),"Deutsch");await started;
    await translator.translate(translator.location(images[0]),"Español");completeOld({translation:"STALE RESULT",summary:"old"});await pending;
    assert.ok(message.querySelector(".lt-image-result").textContent.includes("Español"));assert.ok(!message.textContent.includes("STALE RESULT"));
    const counts=JSON.stringify([calls.download.length,calls.ocr.length,calls.summary.length]);const clone=message.cloneNode(true);message.remove();translator.scan();document.querySelector("main").append(clone);message=clone;images=message.querySelectorAll("img");translator.scan();translator.scan();
    assert.equal(message.querySelectorAll(".lt-image-result").length,2);assert.equal(JSON.stringify([calls.download.length,calls.ocr.length,calls.summary.length]),counts);
    message.id="chat-messages-303-404";translator.scan();assert.equal(message.querySelectorAll(".lt-image-result").length,0);
    console.log("PASS: latest image language wins, remounted messages restore results without requests, recycled rows cannot inherit another message's output.");

    ocrImpl=async()=>({text:"",sourceLanguage:"UNK",model:"vision"});let before=calls.summary.length;
    await translator.translate(translator.location(images[0]));assert.equal(calls.summary.length,before);assert.ok(message.textContent.includes("未识别到可读文字"));
    plugin.settings={...plugin.settings,providerMode:"online",baseUrl:"https://api.example.com/v1"};before=calls.download.length;
    await translator.translate(translator.location(images[1]));assert.equal(calls.download.length,before);assert.ok(message.textContent.includes("仅支持本地"));
    plugin.settings={...plugin.settings,providerMode:"local",baseUrl:DEFAULTS.baseUrl};
    translator.clear();message.remove();message=row("303","404");images=message.querySelectorAll("img");let resolveOCR;ocrImpl=()=>new Promise(resolve=>{resolveOCR=resolve;});
    const cancelled=translator.translate(translator.location(images[0]));await flush();message.remove();translator.scan();resolveOCR({text:"late",sourceLanguage:"ENG",model:"vision"});await cancelled;
    message=row("303","404");translator.scan();assert.ok(message.textContent.includes("已取消"));assert.ok(!message.textContent.includes("late"));
    translator.stop();assert.equal(document.querySelectorAll(".lt-image-result").length,0);assert.equal(translator.entries.size,0);
    console.log("PASS: no-text images skip summarization, online mode never downloads/uploads, navigation cancels pending work, and stop removes all results.");

    class Bitmap {set src(value){if(value){this.naturalWidth=10;this.naturalHeight=20;queueMicrotask(()=>this.onload?.());}}}
    let drawn=0;const webpTranslator=new ImageTranslator(plugin,{Image:Bitmap,document:{createElement:()=>({getContext:()=>({drawImage(){drawn++;}}),toDataURL:()=>"data:image/png;base64,iVBORw0KGgo="})}});
    const prepared=await webpTranslator.prepare({mime:"image/webp",dataUrl:"data:image/webp;base64,UklGRg=="},new AbortController().signal);
    assert.equal(prepared.mime,"image/png");assert.equal(drawn,1);
    console.log("PASS: WebP conversion uses decoded pixels to produce a PNG input for llama-server.");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>dom.window.close());
