import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseOptions, assertExisting, assertFreshReady, handoffScript, verifyScript, spaceCheckScript, summarize, assertMetadataRevision, bilibiliMetadataScript, platformSource } from "../scripts/video.mjs";
import { createOnboardedConfig } from "../assets/vendor/video-publisher/scripts/lib/config.mjs";
import { readPackage } from "../assets/vendor/video-publisher/scripts/lib/content-package.mjs";
import { buildIdentity } from "../assets/vendor/video-publisher/scripts/v2/lib/identity.mjs";
import os from "node:os";
import {webcrypto} from 'node:crypto';
import { requiredGates, PLATFORMS } from "../assets/vendor/video-publisher/scripts/v2/lib/model.mjs";
import {compatVideoScript} from '../scripts/ego-video.mjs';

const config = () => ({ availablePlatforms: PLATFORMS, defaultPlatforms: ["bilibili"], declarations: {}, execution: {} });
const item = { taskSpaceId: 123, taskSpaceName: "168 publisher video test" };
const state = { fingerprint: "same", platforms: { bilibili: item } };

test('all content CLIs execute validation through a directory symlink instead of silently exiting',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-skill-link-'));
  try{
    const linked=path.join(dir,'scripts');fs.symlinkSync(fileURLToPath(new URL('../scripts/',import.meta.url)),linked,'dir');
    for(const name of ['video.mjs','dynamic.mjs','publisher.mjs']){
      const result=spawnSync(process.execPath,[path.join(linked,name),'not-a-command'],{encoding:'utf8'});
      assert.notEqual(result.status,0,name);assert.ok(result.stderr.trim(),name);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("page actions never count as success and notification prompts remain a user stop", () => {
  for (const [code, status] of [["AUTH_REQUIRED", "needs_login"], ["USER_CONTROL", "needs_user"], ["INPUT_CHANNEL_BROKEN", "result_unknown"], ["UPLOAD_STALLED", "processing"], ["ACTION_FAILED", "failed"]]) {
    assert.equal(summarize({ platforms: { bilibili: { ready: false, blocker: { code } } } }).status, status);
  }
  assert.equal(summarize({ platforms: { bilibili: { ready: false, blocker: { code: "INPUT_CHANNEL_BROKEN", evidence: { detail: "A browser permission prompt for notifications has appeared. The user now controls this task space." } } } } }).status, "needs_user");
  assert.equal(summarize({ platforms: { bilibili: { ready: true } } }).status, "draft_verified");
  assert.equal(summarize({ platforms: { youtube: { ready: false, blocker: { code: "STATE_AMBIGUOUS", evidence: { video: { evidence: { processing: true, failed: false } } } } } } }).status, "processing");
});

test('video compatibility protects and reads closed XHS footer, upgrades clean guards and blocks shortcut sends',async()=>{
 const source=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 assert.equal(compatVideoScript('console.log("Profile check")'),'console.log("Profile check")');
 assert.throws(()=>compatVideoScript(source.replace("if (!match) return","drift")),/source changed/);
 for(const mode of ['closed','disabled','missing','shortcut','old','dirty']){
  const listeners=new Map();class Element{matches(s){return s.includes('xhs-publish-btn');}getAttribute(k){return {'submit-text':'发布','submit-disabled':mode==='disabled'?'true':'false','submit-loading':'false'}[k]||null;}getBoundingClientRect(){return {width:680,height:90};}}
  const host=new Element(),window={};
  const sidebar={tagName:'BUTTON',innerText:'发布笔记',matches:()=>false,getAttribute:()=>null,getBoundingClientRect:()=>({width:64,height:24})};
  if(['old','dirty'].includes(mode)){const old={armed:true,version:1,blockedAttempts:mode==='dirty'?[{}]:[],releaseForConfirmedPublish(){this.armed=false;return {ok:true};}};window.__VIDEO_PUBLISHER_FINAL_GUARD__=old;}
  const browser=vm.createContext({window,Element,document:{addEventListener:(name,fn)=>listeners.set(name,fn),querySelectorAll:s=>s==='*'?[]:mode==='missing'?[sidebar]:[sidebar,host]},getComputedStyle:()=>({display:'block',visibility:'visible'}),Date});
  const script=vm.createContext({platform:'xiaohongshu',js:async expression=>vm.runInContext(expression,browser)});
  vm.runInContext(compatVideoScript(source)+'\nthis.arm=armFinalPublishGuard;this.inspect=inspectFinalButtons;',script);
  if(mode==='dirty'){await assert.rejects(script.arm());continue;}
  await script.arm();const buttons=await script.inspect();if(mode==='missing'){assert.equal(buttons.length,0);continue;}assert.equal(buttons.length,1);assert.equal(buttons[0].text,'发布');assert.equal(buttons[0].disabled,mode==='disabled');
  let blocked=false;const type=mode==='shortcut'?'keydown':'click';listeners.get(type)({type,target:mode==='shortcut'?null:host,key:'Enter',metaKey:mode==='shortcut',preventDefault(){blocked=true;},stopImmediatePropagation(){}});
  assert.equal(blocked,true);const guard=window.__VIDEO_PUBLISHER_FINAL_GUARD__;assert.equal(guard.closedFooterProtected,true);assert.equal(guard.releaseForConfirmedPublish().ok,false);
 }
});

test('upstream video Ego relay applies compatibility before forwarding the actual script',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-ego-relay-'));
 try{
  const mock=path.join(dir,'ego-mock'),captured=path.join(dir,'script.mjs');
  fs.writeFileSync(mock,`#!${process.execPath}\nimport fs from 'node:fs';let source='';for await(const chunk of process.stdin)source+=chunk;fs.writeFileSync(${JSON.stringify(captured)},source);console.log('forwarded');\n`,{mode:0o700});
  const source=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
  const linked=path.join(dir,'scripts');fs.symlinkSync(fileURLToPath(new URL('../scripts/',import.meta.url)),linked,'dir');
  const result=spawnSync(process.execPath,[path.join(linked,'ego-video.mjs'),'nodejs'],{encoding:'utf8',input:source,env:{...process.env,PUBLISHER_EGO_COMMAND:mock,VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN:''}});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'forwarded');assert.equal(fs.readFileSync(captured,'utf8'),compatVideoScript(source));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Bilibili empty ratio slots upload once through their own input; existing editors retain native selection',async()=>{
 const core=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 const upstream=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/platforms/bilibili.mjs',import.meta.url),'utf8');
 const source=compatVideoScript(core+'\n'+upstream);
 const functionSource=source.slice(source.indexOf('async function uploadBilibiliCoverSlot(asset)'),source.indexOf('async function finishBilibiliCoverEditor'));
 for(const mode of ['empty','existing','intercepted','pending-unknown','missing'])for(const ratio of ['4:3','16:9']){
  let uploaded=0,clicked=0,changed=false,listener;
  const slot=ratio==='4:3'?'.ratio_4_3':'.ratio_16_9';
  const input={id:'',accept:'image/png',value:'',files:[],removeAttribute(){this.id='';},closest:s=>s===slot&&mode==='empty'?{}:null,addEventListener:(_e,fn)=>{listener=fn;}};
  const existing=['existing','intercepted','pending-unknown'].includes(mode);let active=!['intercepted','pending-unknown'].includes(mode);
  const editor={parentElement:{classList:{contains:()=>active}},closest:()=>dialog,dispatchEvent:event=>{assert.equal(event.type,'mousedown');active=true;}};
  const dialog={innerText:'封面制作',getBoundingClientRect:()=>({width:500,height:500}),querySelectorAll:s=>s.includes('sync-checkbox')?[{checked:false},{checked:false}]:s==='.cover-upload input[type=file]'&&existing||s===slot+' input[type=file]'&&mode==='empty'?[input]:[],querySelector:()=>({})};
  const browser=vm.createContext({MouseEvent:class{constructor(type){this.type=type;}},window:{},document:{querySelectorAll:s=>s==='.bcc-dialog'?[dialog]:s==='#vp2-bili-cover'&&input.id?[input]:[],querySelector:s=>s==='#vp2-bili-cover'&&input.id?input:s.startsWith('#editor_')&&(existing||changed)?editor:null,body:{}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:1,backgroundImage:changed?'url("https://fixture/cover.png")':'none'}),Image:class{complete=true;naturalWidth=ratio==='4:3'?1440:1280;naturalHeight=ratio==='4:3'?1080:720;}});
  const expectedReceipts=mode==='pending-unknown'?{cover:{slots:{'test-slot':{selectedFile:{name:'cover.png',size:100}}}}}:{};
  const context=vm.createContext({expectedReceipts,activateBilibiliUploadLifecycle:async()=>{},js:async code=>vm.runInContext(code,browser),click:async()=>{clicked++;},wait:async()=>{},uploadFile:async selector=>{assert.equal(selector,'#vp2-bili-cover');uploaded++;input.files=[{name:'cover.png',size:100,type:'image/png'}];changed=true;listener();},path,fs:{statSync:()=>({size:100})},bilibiliCoverRatioMatches:(image,expected)=>image.width/image.height===Number(expected.split(':')[0])/Number(expected.split(':')[1])});
  vm.runInContext(functionSource+source.slice(source.indexOf('async function selectBilibiliCoverSlotCompat'))+'\nthis.upload=uploadBilibiliCoverSlot;',context);
  const result=await context.upload({ratio,editor:ratio==='4:3'?'#editor_4_3':'#editor_16_9',slot:'test-slot',path:'/fixture/cover.png'});
  assert.equal(result.ok,!['missing','pending-unknown'].includes(mode));assert.equal(uploaded,['missing','pending-unknown'].includes(mode)?0:1);assert.equal(clicked,mode==='missing'?0:1);
  if(mode==='pending-unknown')assert.equal(active,true);
 }
});

test('Douyin waits for the native video input mount and never uploads while probing',async()=>{
 const core=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 const platform=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/platforms/douyin.mjs',import.meta.url),'utf8');
 const source=compatVideoScript(core+'\n'+platform);
 const probe=source.slice(source.indexOf('async function exposeDouyinVideoInputOnce()'),source.indexOf('async function waitDouyinEarlyMutationReady'));
 const wrapper=source.slice(source.lastIndexOf('async function exposeDouyinVideoInput()'));
 for(const available of [true,false]){
  let polls=0;const input={accept:'video/mp4',value:'',id:''};
  const browser=vm.createContext({document:{querySelectorAll:()=>{polls++;return available&&polls>=3?[input]:[];}}});
  const context=vm.createContext({js:async s=>vm.runInContext(s,browser),wait:async()=>{}});
  vm.runInContext(probe+wrapper+'\nthis.expose=exposeDouyinVideoInput;',context);
  const result=await context.expose();assert.equal(result.ok,available);assert.equal(polls,available?3:10);assert.equal(input.id,available?'vp2-douyin-video':'');
 }
});

test('WeChat cover confirmation uses one native click; proven existing cover skips upload and unknown pending editors stop',async()=>{
 const core=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 const platform=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/platforms/wechat-channels.mjs',import.meta.url),'utf8');
 const source=compatVideoScript(core+'\n'+platform);
 const body=source.slice(source.indexOf('async function uploadWechatCover(asset)'),source.indexOf('async function ensureWechatEarlyMetadata'));
 assert.match(source,/pending cover editor requires inspection; refusing discard or reupload/);
 for(const recovered of [true,false]){
  let uploads=0,clicks=0,accepted=false;
  const image={url:'new',width:1080,height:1440};
  const context=vm.createContext({wechatCustomCover:true,path,fs:{statSync:()=>({size:100})},activateWechatLifecycle:async()=>{},wait:async()=>{},
   recoverWechatCoverCompat:async()=>recovered?{ok:true,recovered:true}:null,
   inspectWechatChannels:async()=>({gates:{cover:{evidence:{urlsBySlot:{vertical:accepted?['new']:['old']},imagesBySlot:{vertical:accepted?[image]:[]}}},noBlockingDialog:{ok:accepted}}}),
   probeWechatCoverEditor:async()=>({editorMatched:true,image:{sourceKey:uploads?'new':'old'}}),
   wechatCoverEditorExpression:(_title,expression)=>expression,
   wechatCoverPreviewMatches:()=>true,wechatCoverRatioMatches:()=>true,
   cdp:async(method)=>{if(method==='DOM.setFileInputFiles'){uploads++;return{};}return method==='Runtime.evaluate'?{result:{objectId:'input'}}:{result:{value:{name:'cover.png',size:100,type:'image/png'}}};},
   js:async expression=>{if(expression.includes('cover edit entry'))return{ok:true};assert.ok(expression.includes("buttons[0].id='vp2-wechat-cover-confirm'"));assert.ok(!expression.includes('buttons[0].click()'));return{ok:true,selector:'#vp2-wechat-cover-confirm'};},
   click:async selector=>{assert.equal(selector,'#vp2-wechat-cover-confirm');clicks++;accepted=true;},
  });
  vm.runInContext(body+'\nthis.upload=uploadWechatCover;',context);
  const result=await context.upload({slot:'vertical',wrap:'.vertical-cover-wrap',ratio:'3:4',path:'/fixture/cover.png',dialogTitle:'编辑个人主页卡片'});
  assert.equal(result.ok,true);assert.equal(uploads,recovered?0:1);assert.equal(clicks,recovered?0:1);
 }
});

test('WeChat retained cover recovery requires original raster, native slot and current accepted URL association',async()=>{
 const core=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 const platform=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/platforms/wechat-channels.mjs',import.meta.url),'utf8');
 const source=compatVideoScript(core+'\n'+platform).slice(compatVideoScript(core+'\n'+platform).lastIndexOf('async function recoverWechatCoverCompat'));
 for(const mode of ['match','different-raster','different-url','different-slot']){
  const expectedBytes=new Uint8Array([1,2,3,255]);
  const native={width:1080,height:1440,getContext:()=>({getImageData:()=>({data:mode==='different-raster'?new Uint8Array([4,5,6,255]):expectedBytes})})};
  const owner={video:{coverUrl:'accepted'},hasEditProfileCover:true,lastEditedMode:'landscape-profile'};
  const editor={$options:{name:'EditCoverDialog'},$parent:owner,previewMode:mode==='different-slot'?'landscape-share':'landscape-profile',useCustomCover:true,customCover:native};
  const card={src:mode==='different-url'?'unknown':'accepted',complete:true,naturalWidth:810,naturalHeight:1080};
  const browser=vm.createContext({crypto:webcrypto,Image:class{naturalWidth=1080;naturalHeight=1440;async decode(){}},document:{querySelectorAll:s=>s==='*'?[]:s==='.single-cover-uploader-wrap'?[{__vue__:editor}]:[card],createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:expectedBytes})})})}});
  const context=vm.createContext({path,fs:{readFileSync:()=>Buffer.from('fixture'),statSync:()=>({size:7})},js:async s=>vm.runInContext(s,browser),wechatCoverRatioMatches:image=>image.width/image.height===3/4});
  vm.runInContext(source+'\nthis.recover=recoverWechatCoverCompat;',context);
  const result=await context.recover({slot:'vertical',wrap:'.vertical-cover-wrap',image:'img.vertical-img-size',ratio:'3:4',path:'/fixture/cover.png'});
  assert.equal(Boolean(result?.ok),mode==='match');
  if(result)assert.equal(result.receipt.selectedFile.recoveredFromNativeCanvas,true);
 }
});

test("YouTube dialog filename and paid-promotion radios are read without matching background content", async () => {
  for (const matches of [true, false]) {
    const filename = matches ? "example.mp4" : "other.mp4";
    const radio = { checked: true, getAttribute: key => key === "aria-checked" ? "true" : null };
    const scope = { innerText: `${filename} Upload complete Checks`, querySelectorAll: () => [], getAttribute: key => key === "workflow-step" ? "DETAILS" : "video-id", querySelector: selector => {
      if (selector.includes("#original-filename")) return { innerText: filename };
      if (selector.includes('name="VIDEO_PAID_PRODUCT_PLACEMENT_NO"')) return radio;
      if (selector === '#paid-promotion tp-yt-paper-radio-button') return {};
      return null;
    } };
    const browser = vm.createContext({ document: { body: { innerText: "YouTube Studio example.mp4" }, querySelector: selector => selector === 'ytcp-uploads-dialog' ? scope : null, querySelectorAll: () => [] }, location: { hostname: "studio.youtube.com", href: "https://studio.youtube.com/" }, getComputedStyle: () => ({ display: "block", visibility: "visible" }) });
    const context = vm.createContext({
      pkg: { platformTitle: { youtube: "expected" }, youtubeDescription: "", youtubeTags: [], youtubeAudience: "not_made_for_kids", youtubeVisibility: "private", youtubeLicense: "standard_youtube" },
      videoPath: "/tmp/example.mp4", expectedReceipts: {}, cdp: async () => ({}), js: async expression => vm.runInContext(expression, browser),
      inspectFinalButtons: async () => [], YOUTUBE_FINAL_TEXT: /Save/, okGate: evidence => ({ok:true,evidence}), failedGate: evidence => ({ok:false,evidence}),
    });
    vm.runInContext(platformSource("youtube") + "\nthis.inspector = inspectYoutube;", context);
    const observed = await context.inspector();
    assert.equal(observed.gates.draftIdentity.ok, matches);
    assert.equal(observed.gates.settings.evidence.actual.paidPromotion, false);
    if (matches) assert.equal(observed.gates.draftIdentity.evidence.fileNameText, filename);
  }
  assert.throws(() => verifyScript(item, "youtube", { videoPath: "/tmp/test.mp4" }, state, "publish"), /Unsafe/);
});

test("entry preserves safe defaults and rejects destructive flags, traversal and implicit copies", () => {
  const options = parseOptions("prepare", ["--package", "/tmp/pkg.json", "--platforms", PLATFORMS.join(","), "--profile", "test"], config);
  assert.equal(options.keepSpace, true);
  assert.equal(options.cleanupStaleSpaces, false);
  assert.equal(options.spacePrefix, "168 publisher video");
  assert.match(options.stateRoot, /\.168-publisher\/video-jobs$/);
  assert.equal(options.profile, "test");
  assert.deepEqual(options.platforms, PLATFORMS);
  for (const option of ["--cleanup-only", "--close-on-complete", "--force-fresh-space", "--space-name"]) {
    assert.throws(() => parseOptions("prepare", ["--package", "/tmp/pkg.json", option], config), /Unsupported option/);
  }
  assert.throws(() => parseOptions("inspect", ["--package", "/tmp/pkg.json"], config), /existing --job-id/);
  assert.throws(() => parseOptions("prepare", ["--package", "/tmp/pkg.json", "--job-id", "../escape"], config));
  assert.throws(() => parseOptions("prepare", ["--package", "/tmp/pkg.json", "--operation", "repost", "--confirm-new-copy"], config), /explicit new/);
  assert.throws(() => parseOptions("handoff", ["--package", "/tmp/pkg.json", "--job-id", "ok"], config), /confirm-manual-send/);
  assert.throws(() => parseOptions("prepare", ["--package", "/tmp/pkg.json", "--resume-control"], config), /existing --job-id/);
});

test("login recovery reuses the original space only after explicit resume and needs no creator tab yet", async () => {
  const events = [];
  const task = { spaceId: item.taskSpaceId, name: item.taskSpaceName };
  const context = vm.createContext({
    listTaskSpaces: async () => [{ id: item.taskSpaceId, name: item.taskSpaceName, ownership: "agentDelegatedToUser" }],
    takeOverTaskSpace: async id => { events.push(id); return task; },
  });
  await assert.rejects(vm.runInContext(`(async()=>{${spaceCheckScript(item, "bilibili", { requireTab: false })}})()`, context));
  assert.deepEqual(events, []);
  await vm.runInContext(`(async()=>{${spaceCheckScript(item, "bilibili", { requireTab: false, resumeControl: true })}})()`, context);
  assert.deepEqual(events, [item.taskSpaceId]);
});

test("real entry accepts Ego observations and Profile checks on stderr without creator side effects", { skip: process.platform !== "darwin" }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "168-publisher-test-"));
  try {
    const pkgPath = path.join(directory, "package.json");
    const configPath = path.join(directory, "config.json");
    const videoPath = path.join(directory, "video.mp4");
    fs.writeFileSync(videoPath, "identity-only-test");
    const supplied = createOnboardedConfig({ sourceDirectory: directory, availablePlatforms: ["bilibili"], defaultPlatforms: ["bilibili"] });
    fs.writeFileSync(configPath, JSON.stringify(supplied));
    fs.writeFileSync(pkgPath, JSON.stringify({ videoPath, title: "test", bilibiliTags: ["测试"], bilibiliDescription: "test" }));
    const identity = await buildIdentity(readPackage(pkgPath, { config: supplied }));
    const jobDir = path.join(directory, "jobs/example");
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, "state.json"), JSON.stringify({ ...state, packagePath: pkgPath, fingerprint: identity.fingerprint }));
    const observation = { platform: "bilibili", phase: "verify", taskSpaceId: item.taskSpaceId, taskSpace: item.taskSpaceName, finalPublishClicked: false,
      gates: Object.fromEntries(requiredGates("bilibili").map(name => [name, { ok: true }])), observedAt: new Date().toISOString() };
    observation.gates.safety.evidence = { finalPublishClicked: false, guardArmed: true, blockedAttempts: 0 };
    const mock = path.join(directory, "ego-mock");
    fs.writeFileSync(mock, `#!${process.execPath}\nlet body="";for await(const chunk of process.stdin)body+=chunk;console.error(body.includes("await profiles()")?'168_PUBLISHER_RESULT:["test"]':'VIDEO_PUBLISHER_V2_RESULT:'+${JSON.stringify(JSON.stringify(observation))});\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/video.mjs", import.meta.url)), "inspect", "--package", pkgPath, "--platform", "bilibili", "--job-id", "example", "--profile", "test", "--state-root", path.join(directory, "jobs")], {
      encoding: "utf8", env: { ...process.env, PUBLISHER_VIDEO_CONFIG: configPath, VIDEO_PUBLISHER_V2_EGO_COMMAND: mock, VIDEO_PUBLISHER_V2_LOCK_ROOT: path.join(directory, "locks") },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "draft_verified");
    assert.equal(fs.existsSync(path.join(jobDir, "manual-verify-bilibili.json")), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("identity changes and prior handoff block reuse; other unhanded platforms remain inspectable", () => {
  assertExisting(state, { fingerprint: "same" }, ["bilibili"]);
  assert.throws(() => assertExisting(state, { fingerprint: "different" }, ["bilibili"]), /identity/);
  assert.throws(() => assertExisting(state, { fingerprint: "same" }, ["bilibili"], { handoffs: { bilibili: { status: "result_unknown" } } }), /handed off/);
  assertExisting(state, { fingerprint: "same" }, ["bilibili"], { handoffs: { youtube: { status: "awaiting_manual_send" } } });
});

test("confirmed metadata revision accepts Bilibili fields and rejects asset or sibling changes", () => {
  const oldRaw = { videoPath: "/tmp/a.mp4", title: "same", bilibiliTags: ["测试", "软件"] };
  const newRaw = { ...oldRaw, bilibiliTags: ["软件"] };
  const identity = { video: { path: "/tmp/a.mp4", sha256: "same", size: 1 }, coverFingerprint: "same" };
  assertMetadataRevision(oldRaw, newRaw, identity, identity);
  for (const changed of [{ ...newRaw, title: "other" }, { ...newRaw, youtubeTitle: "other" }, { ...newRaw, videoPath: "/tmp/b.mp4" }]) assert.throws(() => assertMetadataRevision(oldRaw, changed, identity, identity));
  assert.throws(() => assertMetadataRevision(oldRaw, newRaw, identity, { ...identity, coverFingerprint: "different" }));
  assert.throws(() => assertMetadataRevision(oldRaw, newRaw, identity, { ...identity, video: { ...identity.video, sha256: "different" } }));
});

test("Bilibili compatibility uses native editors, preserves guard and never clicks a button", async () => {
  for (const dirty of [false, true]) {
    const events = [], tags = ["软件"];
    const guard = { armed: true, blockedAttempts: dirty ? [{}] : [] };
    const component = { checkCustomTagLoading: false, setCustomTag(tag) { tags.push(tag); events.push(tag); } };
    const editor = { getBoundingClientRect: () => ({ height: 20 }), parentElement: { __quill: { setText(text, source) { events.push([text, source]); }, getText: () => "body\n" } } };
    const browser = vm.createContext({ window: { __VIDEO_PUBLISHER_FINAL_GUARD__: guard }, getComputedStyle: () => ({ visibility: "visible" }), document: {
      querySelector: () => ({ __vue__: component }),
      querySelectorAll: selector => selector === ".ql-editor" ? [editor] : tags.map(tag => ({ innerText: tag })),
    } });
    const page = {
      evaluate: async (fn, argument) => vm.runInContext(`(${fn.toString()})(${JSON.stringify(argument)})`, browser),
      waitForFunction: async fn => assert.equal(vm.runInContext(`(${fn.toString()})()`, browser), true),
    };
    const task = { spaceId: item.taskSpaceId, name: item.taskSpaceName, tabs: async () => [{ label: "p1", url: "https://member.bilibili.com/", page }], page: () => page };
    const context = vm.createContext({ URL, console: { log() {} }, listTaskSpaces: async () => [{ id: item.taskSpaceId, name: item.taskSpaceName, ownership: "agent" }], taskSpace: async () => task });
    const run = vm.runInContext(`(async()=>{${bilibiliMetadataScript(item, { bilibiliDescription: "body", bilibiliTags: ["软件", "电脑"] })}})()`, context);
    if (dirty) { await assert.rejects(run); assert.deepEqual(events, []); }
    else { await run; assert.deepEqual(events, [["body", "user"], "电脑"]); }
    assert.equal(guard.armed, true);
  }
});

test("handoff needs all live gates, fresh timestamp and exact original space", () => {
  const observation = {
    platform: "bilibili", phase: "verify", taskSpaceId: item.taskSpaceId, taskSpace: item.taskSpaceName,
    observedAt: new Date().toISOString(), finalPublishClicked: false,
    gates: Object.fromEntries(requiredGates("bilibili").map(name => [name, { ok: true }])),
  };
  observation.gates.safety.evidence = { finalPublishClicked: false, guardArmed: true, blockedAttempts: 0 };
  assert.equal(assertFreshReady(observation, item, "bilibili").ready, true);
  for (const changes of [
    { observedAt: new Date(Date.now() - 61_000).toISOString() },
    { taskSpaceId: 999 }, { taskSpace: "another space" }, { phase: "inspect" },
    { finalPublishClicked: true }, { blocker: { code: "AUTH_REQUIRED" } },
    { gates: { ...observation.gates, title: { ok: false } } },
  ]) assert.throws(() => assertFreshReady({ ...observation, ...changes }, item, "bilibili"), /not freshly verified/);
});

test("handoff releases clean guard and hands off without any click; ambiguous tabs and dirty guard stop", async () => {
  for (const mode of ["clean", "dirty", "duplicate", "wrong-name", "user"]) {
    const events = [];
    const guard = { version: 1, armed: true, blockedAttempts: mode === "dirty" ? [{}] : [], releaseForConfirmedPublish() { events.push("release"); this.armed = false; return { ok: true }; } };
    const page = { evaluate: async callback => {
      const context = vm.createContext({ window: { __VIDEO_PUBLISHER_FINAL_GUARD__: guard } });
      return vm.runInContext(`(${callback.toString()})()`, context);
    } };
    const task = { spaceId: item.taskSpaceId, name: item.taskSpaceName, tabs: async () => Array.from({ length: mode === "duplicate" ? 2 : 1 }, () => ({ label: "p1", url: "https://member.bilibili.com/platform/upload", page })), page: () => page, handOff: async () => { events.push("handoff"); } };
    const context = vm.createContext({ URL, console: { log() {} }, taskSpace: async () => task,
      listTaskSpaces: async () => [{ id: item.taskSpaceId, name: mode === "wrong-name" ? "different" : item.taskSpaceName, ownership: mode === "user" ? "user" : "agent" }] });
    const run = vm.runInContext(`(async () => { ${handoffScript(item, "bilibili")} })()`, context);
    if (mode === "clean") { await run; assert.deepEqual(events, ["release", "handoff"]); }
    else { await assert.rejects(run); assert.deepEqual(events, []); assert.equal(guard.armed, true); }
  }
});

test("generated verification parses for all five platforms with strict space selection", async () => {
  for (const platform of PLATFORMS) {
    const source = verifyScript(item, platform, { videoPath: "/tmp/test.mp4" }, state);
    const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: source, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
    assert.ok(source.includes('phase = "verify"'));
    assert.ok(source.includes("refusing recreation"));
  }
});

test("vendored files still match the pinned MIT snapshot", async () => {
  const crypto = await import("node:crypto");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/vendor");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "upstream.json"), "utf8"));
  for (const [file, hash] of Object.entries(manifest.files)) {
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "video-publisher", file))).digest("hex"), hash, file);
  }
  assert.match(fs.readFileSync(path.join(root, "video-publisher/LICENSE"), "utf8"), /MIT License/);
});

test('New video history cleanup parses for each platform and uses only its own inspector',()=>{
 const core=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 const dispatch=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/platforms/dispatch.mjs',import.meta.url),'utf8');
 for(const platform of PLATFORMS){
  const source=compatVideoScript(core+platformSource(platform)+dispatch,{cleanupJob:'new-job'});
  const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'});
  assert.equal(checked.status,0,platform+': '+checked.stderr);assert.ok(source.includes('await clearVideoHistoryCompat()'));
 }
});

test('Video cleanup confirms empty text and media before marking the page clean',async()=>{
 const core=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/ego/core.mjs',import.meta.url),'utf8');
 const dispatch=fs.readFileSync(new URL('../assets/vendor/video-publisher/scripts/v2/platforms/dispatch.mjs',import.meta.url),'utf8');
 const generated=compatVideoScript(core+platformSource('bilibili')+dispatch,{cleanupJob:'new-job'});
 const helper=generated.slice(generated.indexOf('async function clearVideoHistoryCompat(){'));
 for(const residue of ['none','text','video']){
  let marked=false;
  const observation={gates:{authenticated:{ok:true},title:{evidence:{actual:residue==='text'?'old title':''}},video:{ok:false,evidence:{uploaded:residue==='video'}}}};
  const page={evaluate:async callback=>{if(callback.toString().includes('window.__168_VIDEO_CLEANUP__=key'))marked=true;return false;}};
  const context=vm.createContext({platform:'bilibili',activeTaskSpace:{id:1},PLATFORM_HOSTS:{bilibili:/bilibili/},taskSpace:async()=>({tabs:async()=>[{label:'p2',url:'https://member.bilibili.com'}],page:()=>page}),inspectBilibili:async()=>observation,clearCurrentEditor:async()=>{},wait:async()=>{}});
  const result=vm.runInContext(helper+'\nclearVideoHistoryCompat()',context);
  if(residue==='none'){await result;assert.equal(marked,true);}else{await assert.rejects(result,/empty editor/);assert.equal(marked,false);}
 }
});
