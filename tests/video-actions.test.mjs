import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {actionsDispatch,configurationVerdict,actionPlatformSource} from '../scripts/video-actions.mjs';
import {platformSource,verifyScript,assertOriginalRights} from '../scripts/video.mjs';

const gates={authenticated:{ok:true},draftIdentity:{ok:true},safety:{ok:true},video:{ok:false,evidence:{uploading:true}},title:{ok:true},description:{ok:true},tags:{ok:true}};
test('Missing video duration or ongoing processing cannot block completed configuration; missing fields still do',()=>{
 assert.equal(configurationVerdict({gates,configurationComplete:true},true).status,'configured');
 assert.equal(configurationVerdict({gates,configurationComplete:false},true).status,'needs_user');
 assert.equal(configurationVerdict({gates,configurationComplete:true},false).status,'needs_user');
 assert.equal(configurationVerdict({gates,configurationComplete:true,blocker:{code:'PLATFORM_REJECTED_ASSET'}},true).status,'failed');
});

test('Every composed action script parses while fixed upstream sources remain usable for maintenance',()=>{
 for(const platform of ['xiaohongshu','douyin','bilibili','wechat_channels','youtube']){
  const item={taskSpaceId:65,taskSpaceName:'fixture',pageLabel:'p1',receipts:{}},pkg={videoPath:'/tmp/input.mp4',cover:{}},state={packagePath:'/tmp/input.json',fingerprint:'id'};
  const source=verifyScript(item,platform,pkg,state,'configure','/tmp/state.json');
  new vm.Script('(async()=>{'+source.replace(/import fs from "node:fs"; import path from "node:path";/,'')+'})()');
  assert.ok(actionPlatformSource(platformSource(platform),platform));
 }
});

test('Originality is required before mutation unless the existing standing policy is confirmed',()=>{
 assert.throws(()=>assertOriginalRights({platforms:['bilibili'],originalityPolicy:'ask_each_run'}),/Originality confirmation/);
 assert.doesNotThrow(()=>assertOriginalRights({platforms:['bilibili'],originalRightsConfirmed:true}));
 assert.doesNotThrow(()=>assertOriginalRights({platforms:['xiaohongshu'],originalityPolicy:'all_videos_original'}));
 assert.doesNotThrow(()=>assertOriginalRights({platforms:['douyin','youtube']}));
});

test('Video action dispatch submits once, fills fields without upload polling, and reuses original media on resume',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-actions-'));
 try{
  for(const resumed of [false,true]){
   const statePath=path.join(directory,'state.json'),events=[],observations=[];
   fs.writeFileSync(statePath,JSON.stringify({platforms:{bilibili:{uploadAttempted:resumed}}}));
   const context={fs,path,platform:'bilibili',videoPath:statePath,page:{cdp:async()=>events.push('focus'),waitForFunction:async()=>events.push('controls'),evaluate:async()=>false},wait:async()=>assert.fail('No upload wait'),uploadFile:async()=>events.push('upload'),preparePlatform:async()=>({selected:{ok:true}}),inspectBilibili:async()=>({gates:{...gates,video:{ok:false,evidence:{filenameVisible:resumed,uploading:events.includes('upload')||resumed}}}}),submitNativeVideo:async(_p,_f,mark)=>{mark();events.push('upload');},ensureBilibiliMetadataCompat:async()=>{events.push('metadata');return {ok:true,actions:{}};},setBilibiliDescriptionV2:async()=>{events.push('body');return {ok:true};},ensureBilibiliDeclarationCompat:async()=>({ok:true}),bilibiliCustomCover:false,inspectFinalPublishGuard:async()=>({armed:true}),emitObservation:async o=>observations.push(o),typedBlocker:(code,message)=>({code,message}),console:{error(){}}};
   await vm.runInNewContext('(async()=>{'+actionsDispatch('bilibili',statePath,{uploadAttempted:resumed},'async function(){return;}')+'})()',context);
   assert.deepEqual(events,resumed?['focus','controls','controls','metadata','body']:['focus','controls','upload','controls','metadata','body']);
   assert.equal(observations[0].configurationComplete,true);assert.equal(observations[0].uploadStatus,'not_awaited');
   assert.equal(JSON.parse(fs.readFileSync(statePath)).platforms.bilibili.uploadAttempted,true);
  }
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Fast WeChat upload preserves an upload-start receipt before reading an empty-description editor',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-wechat-actions-'));
 try{
  const statePath=path.join(directory,'state.json'),receipts={},observations=[];let uploaded=false;
  fs.writeFileSync(statePath,JSON.stringify({platforms:{wechat_channels:{uploadAttempted:false,receipts:{}}}}));
  const context={fs,path,platform:'wechat_channels',videoPath:'/tmp/video.mp4',expectedReceipts:receipts,page:{cdp:async()=>{},waitForFunction:async()=>{},url:async()=> 'https://channels.weixin.qq.com/platform/post/create',evaluate:async()=>({status:'login_checked'})},wait:async()=>assert.fail(),uploadFile:async()=>assert.fail('Uses native shadow input'),preparePlatform:async()=>({selected:{ok:true}}),inspectWechatChannels:async()=>({gates:{...gates,draftIdentity:{ok:!uploaded||!!receipts.uploadStart},video:{ok:uploaded,evidence:{uploaded}}}}),submitNativeVideo:async(_p,_f,mark)=>{mark();uploaded=true;return {ok:true};},createWechatUploadStartReceipt:mode=>({mode,fingerprint:'fixture',taskSpaceId:65}),checkpointReceipts:()=>({ok:true}),ensureWechatMetadataCompat:async before=>{assert.equal(before.gates.draftIdentity.ok,true);return {ok:true,actions:{}};},ensureWechatOriginal:async()=>({ok:true}),wechatCustomCover:false,emitObservation:async o=>observations.push(o),typedBlocker:(code,message)=>({code,message}),console:{error(){}}};
  await vm.runInNewContext('(async()=>{'+actionsDispatch('wechat_channels',statePath,{uploadAttempted:false},'async function(){return;}')+'})()',context);
  assert.equal(observations[0].configurationComplete,true);assert.equal(JSON.parse(fs.readFileSync(statePath)).platforms.wechat_channels.receipts.uploadStart.fingerprint,'fixture');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('YouTube visibility refuses a disabled Next immediately and configures the selected visibility when controls are available',async()=>{
 const source=actionPlatformSource(platformSource('youtube'),'youtube'),from=source.indexOf('async function advanceYoutubeToVisibility()'),to=source.indexOf('async function returnYoutubeToDetails()',from);
 for(const disabled of [true,false]){
  const calls=[],context={js:async expression=>{calls.push(expression);return expression.includes("const dialog")?{ok:!disabled,waiting:disabled,reason:'youtube next button disabled'}:calls.length>2;},wait:async()=>calls.push('wait')};
  vm.runInNewContext(source.slice(from,to)+';this.advance=advanceYoutubeToVisibility;',context);
  const advanced=await context.advance();assert.equal(advanced.ok,!disabled);
  assert.equal(calls.includes('wait'),!disabled);
 }
});

test('An differently named historical Bilibili video refuses upload even without a matching identity or upload status',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-history-'));
 try{
  const file=path.join(directory,'state.json');fs.writeFileSync(file,JSON.stringify({platforms:{bilibili:{uploadAttempted:false}}}));
  const context={fs,path,platform:'bilibili',videoPath:'/tmp/new.mp4',wait:async()=>{},uploadFile:async()=>{},page:{cdp:async()=>{},waitForFunction:async()=>{}},preparePlatform:async()=>({selected:{ok:true}}),inspectBilibili:async()=>({gates:{authenticated:{ok:true},draftIdentity:{ok:false},video:{ok:false,evidence:{anyUploaded:true,uploaded:false,uploading:false}}}}),submitNativeVideo:async()=>assert.fail('Historical media must not be replaced or appended'),console:{error(){}}};
  await assert.rejects(vm.runInNewContext('(async()=>{'+actionsDispatch('bilibili',file,{},'async function(){return;}')+'})()',context),/Historical video association/);
  assert.equal(JSON.parse(fs.readFileSync(file)).platforms.bilibili.uploadAttempted,false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Attempted upload with an empty editor cannot become configured or mutate metadata on resume',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-unknown-upload-'));
 try{
  const file=path.join(directory,'state.json');fs.writeFileSync(file,JSON.stringify({platforms:{bilibili:{uploadAttempted:true}}}));
  for(const uploading of [false,true]){
  const context={fs,path,platform:'bilibili',videoPath:file,wait:async()=>{},uploadFile:async()=>assert.fail('Do not reupload'),page:{cdp:async()=>{},waitForFunction:async()=>{},evaluate:async()=>false},preparePlatform:async()=>({selected:{ok:true}}),inspectBilibili:async()=>({gates:{authenticated:{ok:true},draftIdentity:{ok:true},video:{ok:false,evidence:{anyUploaded:false,uploaded:false,uploading,filenameVisible:false}}}}),ensureBilibiliMetadataCompat:async()=>assert.fail('Do not mutate an unassociated draft'),submitNativeVideo:async()=>assert.fail('Do not retry unknown dispatch'),console:{error(){}}};
  await assert.rejects(vm.runInNewContext('(async()=>{'+actionsDispatch('bilibili',file,{uploadAttempted:true},'async function(){throw Error("Should not clean original")}')+'})()',context),/Original upload outcome unknown/);
  assert.equal(JSON.parse(fs.readFileSync(file)).platforms.bilibili.uploadSubmitted,undefined);
  }
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('WeChat preparation never logs in automatically, and continues only when already logged in',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-wechat-manual-'));
 try{for(const status of ['needs_login','needs_user','login_checked']){
  const file=path.join(directory,'state.json'),events=[],observations=[],receipts={};fs.writeFileSync(file,JSON.stringify({platforms:{wechat_channels:{uploadAttempted:false}}}));
  const context={fs,path,platform:'wechat_channels',videoPath:file,expectedReceipts:receipts,wait:async()=>assert.fail('No automatic login wait'),uploadFile:async()=>assert.fail(),page:{cdp:async()=>{},evaluate:async()=>({status,reason:'请在原页面手动登录视频号，完成后明确继续'}),waitForFunction:async()=>events.push('controls'),click:async()=>assert.fail('No automatic login click'),goto:async()=>assert.fail('Keep original login state')},preparePlatform:async()=>({selected:{ok:true}}),inspectWechatChannels:async()=>({gates:{...gates,video:{ok:false,evidence:{}}}}),submitNativeVideo:async(_p,_f,mark)=>{events.push('upload');mark();},createWechatUploadStartReceipt:()=>({fingerprint:'fixture'}),checkpointReceipts:()=>{},ensureWechatMetadataCompat:async()=>{events.push('metadata');return {ok:true};},ensureWechatOriginal:async()=>({ok:true}),wechatCustomCover:false,emitObservation:async o=>observations.push(o),typedBlocker:(code,message,options)=>({code,message,...options}),console:{error(){}}};
  await vm.runInNewContext('(async()=>{'+actionsDispatch('wechat_channels',file,{},'async function(){return;}')+'})()',context);
  assert.equal(observations[0].configurationComplete,status==='login_checked');assert.equal(events.includes('upload'),status==='login_checked');
  if(status!=='login_checked'){assert.deepEqual(events,[]);assert.equal(observations[0].blocker.code,'AUTH_REQUIRED');assert.match(observations[0].blocker.message,/手动登录/);assert.equal(JSON.parse(fs.readFileSync(file)).platforms.wechat_channels.uploadAttempted,false);}
 }}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
