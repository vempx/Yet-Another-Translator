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
const tinyPng="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const calls={download:[],vision:[],glossary:[]};let visionImpl=null;
plugin.getGlossary=async(channel,text,context)=>{calls.glossary.push({channel,text,context});return {entries:[{en:"Iuno",zh:"尤诺"}]};};
plugin.client={async downloadImage(url){calls.download.push(url);return {dataUrl:"data:image/png;base64,"+tinyPng,mime:"image/png",bytes:Buffer.from(tinyPng,"base64").length,tag:new URL(url).pathname.split("/").at(-1)};},
    async translateImage(image,settings,signal,context,info){calls.vision.push({image,settings,signal,context,info});return visionImpl?visionImpl(image,settings,signal,context,info):{translation:settings.targetLanguage+": "+image.tag,summary:'<img src=x onerror="bad()"> summary',sourceLanguage:"ENG",hasText:true};}};
const translator=new ImageTranslator(plugin,{document,Image:dom.window.Image});plugin.imageTranslator=translator;translator.start();
function row(channel="101",id="202"){
    const node=document.createElement("div");node.id=`chat-messages-${channel}-${id}`;
    for(const file of ["one.png","two.png"]){const container=document.createElement("div");container.className="visualMediaItemContainer_fixture";const wrapper=document.createElement("div");wrapper.className="imageWrapper_fixture";const link=document.createElement("a");link.href=`https://cdn.discordapp.com/attachments/${channel}/${id}/${file}?ex=signed`;const image=document.createElement("img");image.src=`https://media.discordapp.net/attachments/${channel}/${id}/${file}?width=100`;link.append(image);wrapper.append(link);container.append(wrapper);node.append(container);}
    document.querySelector("main").append(node);return node;
}
function menuItem(tree,id){return tree.props.children.flatMap(group=>group.props.children||[]).find(node=>node.props.id===id);}
const event=()=>({preventDefault(){},stopPropagation(){}});
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
async function verifyMenuTargets(){
    const host=document.createElement("div");host.id="chat-messages-707-808";
    host.innerHTML='<div class="mediaContainer_fixture"><a href="https://cdn.discordapp.com/attachments/707/808/original.png"><img src="https://media.discordapp.net/external/proxy/original.png"></a><div class="overlay_fixture"></div></div>';
    document.querySelector("main").append(host);const image=host.querySelector("img"),overlay=host.querySelector(".overlay_fixture");
    overlay.dispatchEvent(new dom.window.MouseEvent("mousedown",{bubbles:true,button:2}));
    let tree={props:{navId:"attachment-link",children:[]}};plugin.patchImageMenu(tree,{src:image.src});
    assert.ok(menuItem(tree,"yet-another-translator-image"),"right-down overlay capture should populate the menu before contextmenu");
    const unknown={props:{navId:"native-context",children:[]}};plugin.patchImageMenu(unknown,{src:image.src});assert.ok(menuItem(unknown,"yet-another-translator-image"));
    const unrelated={props:{navId:"user-context",children:[]}};plugin.patchImageMenu(unrelated,{});assert.equal(menuItem(unrelated,"yet-another-translator-image"),undefined);
    translator.captured=null;
    assert.equal(translator.menuLocation({src:image.src}).messageId,"808","props-only proxy URLs must resolve to their original attachment");
    assert.equal(translator.menuLocation({event:{target:overlay}}).messageId,"808");
    const viewer=document.createElement("img");viewer.src=image.src;document.body.append(viewer);
    viewer.dispatchEvent(new dom.window.MouseEvent("contextmenu",{bubbles:true,button:2}));
    assert.equal(translator.menuLocation({target:viewer,src:viewer.src}).messageId,"808","viewer must resolve the underlying message image");viewer.remove();
    host.removeAttribute("id");host.setAttribute("data-list-item-id","chat-messages___chat-messages-707-808");translator.captured=null;
    assert.equal(translator.menuLocation({src:image.src}).channelId,"707","stable message-list identifiers must also work");
    assert.equal(translator.menuLocation({src:image.src,message:{id:"999"}}),null);
    const duplicate=host.cloneNode(true);duplicate.setAttribute("data-list-item-id","chat-messages___chat-messages-707-909");document.querySelector("main").append(duplicate);translator.captured=null;translator.viewerOrigin=null;
    assert.equal(translator.menuLocation({src:image.src}),null,"ambiguous image URLs must not choose another message");
    image.dispatchEvent(new dom.window.MouseEvent("mousedown",{bubbles:true,button:0}));
    assert.equal(translator.menuLocation({src:image.src}).messageId,"808","viewer origin must disambiguate a known image click");
    assert.equal(translator.menuLocation({src:image.src,message:{id:"909"},channel:{id:"707"}}).messageId,"909");
    duplicate.remove();host.remove();translator.captured=null;translator.viewerOrigin=null;
    const diagnostics=[];plugin.client.debugLogger={operation(settings,info){diagnostics.push(info);return {emit(event,details){diagnostics.push(typeof details==="function"?details():details);}};}};
    const missing={props:{navId:"image-context",children:[]}};translator.lastMenuMiss=null;
    plugin.patchImageMenu(missing,{src:"https://cdn.discordapp.com/attachments/707/808/absent.png",secret:"MODEL_SECRET"});
    assert.equal(diagnostics[0].task,"image_menu_unmatched");assert.equal(diagnostics[1].modelInvoked,false);assert.equal(diagnostics[1].menu.recognizedImages,0);
    assert.ok(!JSON.stringify(diagnostics).includes("MODEL_SECRET"));
    plugin.client.debugLogger.operation=()=>{throw Error("diagnostic failure");};translator.lastMenuMiss=null;
    assert.doesNotThrow(()=>plugin.patchImageMenu({props:{navId:"image-context",children:[]}},{src:"https://cdn.discordapp.com/attachments/707/808/absent.png"}));delete plugin.client.debugLogger;
    console.log("PASS: media overlays, pre-contextmenu capture, props-only proxy URLs, large-image viewers, stable row IDs, ambiguous-message rejection and isolated diagnostics.");
}
async function main(){
    await verifyMenuTargets();
    let message=row(),images=message.querySelectorAll("img");
    images[0].dispatchEvent(new dom.window.MouseEvent("contextmenu",{bubbles:true}));
    const tree={props:{navId:"image-context",children:[]}};plugin.patchImageMenu(tree,{src:images[0].src});plugin.patchImageMenu(tree,{src:images[0].src});
    assert.equal(tree.props.children.length,1);const item=menuItem(tree,"yet-another-translator-image");assert.equal(item.props.label,"翻译概括图片内文字");
    assert.equal(translator.menuLocation({target:images[0],message:{id:"wrong-message"}}),null);
    images[1].parentElement.className="spoilerContent_fixture hidden_fixture";assert.equal(translator.location(images[1]),null);images[1].parentElement.className="";
    item.props.action();assert.equal(message.querySelector(".lt-image-language").disabled,true);item.props.action();await flush();
    assert.equal(calls.download.length,1);assert.equal(calls.vision.length,1);
    let first=message.querySelector(".lt-image-result");assert.equal(first.previousElementSibling,images[0].closest('[class*="visualMediaItemContainer"]'));
    assert.ok(first.textContent.includes("English: one.png"));assert.equal(first.querySelector("img"),null);assert.equal(first.querySelector("button").textContent,"ENG");
    assert.equal(dom.window.getComputedStyle(first).fontSize,"0.875rem");assert.ok(CSS.includes(".lt-image-result"));assert.match(dom.window.getComputedStyle(first).color,/text-muted|153/);
    assert.equal(calls.vision[0].context.areaTopic.threadTitle,"Wuthering Waves");assert.equal(calls.vision[0].context.areaTopic.imageCaption,"image caption");
    assert.equal(calls.vision[0].context.reply.text,"original reply");assert.ok(calls.glossary[0].text.includes("image caption"));
    first.querySelector("button").click();const japanese=menu.find(item=>item.id.endsWith("JPN")),control=japanese.control({},null);
    assert.equal(control.props.children.filter(child=>child&&child.type==="button").length,1);
    control.props.children[0].props.onClick(event());await flush();
    assert.equal(calls.download.length,1);assert.equal(calls.vision.length,2);assert.equal(calls.vision[1].settings.targetLanguage,"日本語");
    assert.equal(plugin.settings.targetLanguage,"English");assert.equal(plugin.settings.autoTranslateAreas["101"],undefined);
    assert.ok(message.querySelector(".lt-image-result").textContent.includes("日本語"));
    await translator.translate(translator.location(images[0]),"English");assert.equal(calls.vision.length,2);
    await translator.translate(translator.location(images[1]));assert.equal(calls.download.length,2);assert.equal(message.querySelectorAll(".lt-image-result").length,2);
    assert.ok(message.querySelectorAll(".lt-image-result")[1].textContent.includes("two.png"));
    console.log("PASS: image context menu deduplication, exact image placement, muted small text, safe output, default language and image payload reuse across language changes.");

    const beforeRefresh=calls.vision.length, downloads=calls.download.length;
    plugin.readMessage=(channel,id)=>({id,channel_id:channel,content:"updated caption Iuno",author:{id:"author"}});
    plugin.readReply=()=>({id:"reply",text:"updated reply"});
    plugin.getGlossary=async(channel,text,context)=>{calls.glossary.push({channel,text,context});return {entries:[{en:"Iuno",zh:"新术语"}]};};
    item.props.action();item.props.action();await flush();
    assert.equal(calls.vision.length,beforeRefresh+1);assert.equal(calls.download.length,downloads);
    assert.equal(calls.vision.at(-1).context.areaTopic.imageCaption,"updated caption Iuno");
    assert.equal(calls.vision.at(-1).context.reply.text,"updated reply");assert.equal(calls.vision.at(-1).context.glossary.entries[0].zh,"新术语");
    assert.equal(translator.entries.get(translator.location(images[0]).key).results.size,1,"refresh discards stale language results");
    await translator.translate(translator.location(images[0]),"English");assert.equal(calls.vision.length,beforeRefresh+1);
    console.log("PASS: explicit menu refresh rereads caption, reply and glossary, reuses image bytes, deduplicates clicks and invalidates stale language caches.");

    let completeOld,oldStarted;const started=new Promise(resolve=>oldStarted=resolve);
    visionImpl=(image,settings)=>settings.targetLanguage==="Deutsch"?new Promise(resolve=>{completeOld=resolve;oldStarted();}):Promise.resolve({translation:settings.targetLanguage,summary:"summary",sourceLanguage:"ENG",hasText:true});
    const pending=translator.translate(translator.location(images[0]),"Deutsch");await started;
    await translator.translate(translator.location(images[0]),"Español");completeOld({translation:"STALE RESULT",summary:"old"});await pending;
    assert.ok(message.querySelector(".lt-image-result").textContent.includes("Español"));assert.ok(!message.textContent.includes("STALE RESULT"));
    const counts=JSON.stringify([calls.download.length,calls.vision.length]);const clone=message.cloneNode(true);message.remove();translator.scan();document.querySelector("main").append(clone);message=clone;images=message.querySelectorAll("img");translator.scan();translator.scan();
    assert.equal(message.querySelectorAll(".lt-image-result").length,2);assert.equal(JSON.stringify([calls.download.length,calls.vision.length]),counts);
    message.id="chat-messages-303-404";translator.scan();assert.equal(message.querySelectorAll(".lt-image-result").length,0);
    console.log("PASS: latest image language wins, remounted messages restore results without requests, recycled rows cannot inherit another message's output.");

    visionImpl=async()=>({translation:"",summary:"",sourceLanguage:"UNK",hasText:false});let before=calls.vision.length;
    await translator.translate(translator.location(images[0]));assert.equal(calls.vision.length,before+1);assert.ok(message.textContent.includes("未识别到可读文字"));
    plugin.settings={...plugin.settings,providerMode:"online",baseUrl:"https://api.example.com/v1"};before=calls.download.length;
    await translator.translate(translator.location(images[1]));assert.equal(calls.download.length,before);assert.ok(message.textContent.includes("仅支持本地"));
    plugin.settings={...plugin.settings,providerMode:"local",baseUrl:DEFAULTS.baseUrl};
    translator.clear();message.remove();message=row("303","404");images=message.querySelectorAll("img");let resolveVision;visionImpl=()=>new Promise(resolve=>{resolveVision=resolve;});
    const cancelled=translator.translate(translator.location(images[0]));await flush();message.remove();translator.scan();resolveVision({translation:"late",summary:"late",sourceLanguage:"ENG",hasText:true});await cancelled;
    message=row("303","404");translator.scan();assert.ok(message.textContent.includes("已取消"));assert.ok(!message.textContent.includes("late"));
    translator.stop();message.querySelector("img").dispatchEvent(new dom.window.MouseEvent("mousedown",{bubbles:true,button:2}));assert.equal(translator.captured,null);assert.equal(document.querySelectorAll(".lt-image-result").length,0);assert.equal(translator.entries.size,0);
    console.log("PASS: no-text images return a single empty result, online mode never downloads/uploads, navigation cancels pending work, and stop removes all results.");

    class Bitmap {set src(value){if(value){this.naturalWidth=1;this.naturalHeight=1;queueMicrotask(()=>this.onload?.());}}}
    let drawn=0;const webpTranslator=new ImageTranslator(plugin,{Image:Bitmap,document:{createElement:()=>({getContext:()=>({drawImage(){drawn++;}}),toDataURL:()=>"data:image/png;base64,"+tinyPng})}});
    const webp=Buffer.alloc(30);webp.write("RIFF");webp.writeUInt32LE(22,4);webp.write("WEBPVP8X",8);webp.writeUInt32LE(10,16);
    const prepared=await webpTranslator.prepare({mime:"image/webp",dataUrl:"data:image/webp;base64,"+webp.toString("base64")},new AbortController().signal);
    assert.equal(prepared.mime,"image/png");assert.equal(drawn,1);
    // Padding in Base64 must not inflate a valid exactly-8-MiB conversion by one byte.
    const boundaryPng=Buffer.alloc(8*1024*1024);Buffer.from(tinyPng,"base64").copy(boundaryPng);
    const boundaryTranslator=new ImageTranslator(plugin,{Image:Bitmap,document:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>"data:image/png;base64,"+boundaryPng.toString("base64")})}});
    const boundaryResult=await boundaryTranslator.prepare({mime:"image/webp",dataUrl:"data:image/webp;base64,"+webp.toString("base64")},new AbortController().signal);assert.equal(boundaryResult.bytes,8*1024*1024);
    const controller=new AbortController();
    class PendingBitmap {set src(value){this.value=value;}}
    const waiting=new ImageTranslator(plugin,{Image:PendingBitmap,document:{createElement(){throw Error("cancelled decoding must not draw");}}});
    const pendingWebp=waiting.prepare({mime:"image/webp",dataUrl:"data:image/webp;base64,"+webp.toString("base64")},controller.signal);
    controller.abort();await assert.rejects(pendingWebp,error=>error.name==="AbortError");
    console.log("PASS: WebP conversion uses decoded pixels to produce a PNG input for llama-server.");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>dom.window.close());
