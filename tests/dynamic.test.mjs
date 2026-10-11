import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { webcrypto } from 'node:crypto';
import { normalizeDynamic, materializeImages, materializeVideo, sha256, publicAddress, validateImageURL } from '../scripts/dynamic-input.mjs';
import { parseDynamicOptions, dynamicVerdict, assertDynamicReady, existingSpaceScript, handoffDynamicScript } from '../scripts/dynamic.mjs';
import { armGuard, observeX } from '../scripts/x-page.mjs';
import { observeWeibo } from '../scripts/weibo-page.mjs';
import { observeXhs, fillXhsScript } from '../scripts/xhs-page.mjs';
import { observeJike } from '../scripts/jike-page.mjs';
import {openDraftPageScript,clearCurrentEditor} from '../scripts/runtime.mjs';
import {request,execute} from '../scripts/publisher.mjs';

test('ordered sources, overrides and unsupported fields are explicit; unsafe URLs stop before browser work', () => {
  const raw = { type:'dynamic', text:'base', tags:['软件'], images:['one.png','https://example.com/two.png'], platforms:{x:{text:'X'}} };
  assert.deepEqual(normalizeDynamic(raw,'/tmp'), {type:'dynamic',platform:'x',text:'X\n\n#软件',sources:['/tmp/one.png','https://example.com/two.png']});
  for (const extra of [{title:'x'},{videoPath:'/tmp/a.mp4'},{images:['one.png','one.png']},{tags:['软件','#软件']},{platforms:{x:[]}},{platforms:{unknown:{}}}]) assert.throws(()=>normalizeDynamic({...raw,...extra},'/tmp'));
  for (const url of ['http://example.com/a','https://127.0.0.1/a','https://[::1]/a','https://localhost/a','https://user:pass@example.com/a','https://example.com:444/a','https://[::ffff:127.0.0.1]/a']) assert.throws(()=>validateImageURL(url));
  for (const address of ['10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','fe80::1','::ffff:7f00:1']) assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.throws(()=>parseDynamicOptions(['handoff','--package','/tmp/a','--platform','x','--job-id','ok']),/manual send/);
  assert.throws(()=>parseDynamicOptions(['prepare','--package','/tmp/a','--platform','x','--job-id','../escape']),/Invalid/);
});

test('Every dynamic platform requires user copy and one media mode before browser work', () => {
  for (const platform of ['x', 'weibo', 'xiaohongshu', 'jike']) {
    const raw = {type:'dynamic', text:'正文\n保留原文', tags:['AI', '视频生成'], images:['first.png', 'second.png']};
    const pkg = normalizeDynamic(raw, '/tmp', platform);
    assert.deepEqual(pkg.sources, ['/tmp/first.png', '/tmp/second.png']);
    assert.equal(pkg.text, platform === 'xiaohongshu' ? raw.text : raw.text + '\n\n#AI' + (platform === 'weibo' ? '# #视频生成#' : ' #视频生成'));
    if (platform === 'xiaohongshu') assert.deepEqual(pkg.tags, ['AI', '视频生成']);
    assert.equal(normalizeDynamic({...raw, images:[], videoPath:'clip.mp4'}, '/tmp', platform).videoPath, '/tmp/clip.mp4');
    for (const text of ['', ' \n\t', '\u3000']) assert.throws(() => normalizeDynamic({...raw, text}, '/tmp', platform), /non-whitespace/);
    assert.throws(() => normalizeDynamic({...raw, platforms:{[platform]:{text:'  '}}}, '/tmp', platform), /non-whitespace/);
    assert.throws(() => normalizeDynamic({...raw, images:[]}, '/tmp', platform), /Dynamic media/);
    assert.throws(() => normalizeDynamic({...raw, videoPath:'clip.mp4'}, '/tmp', platform), /not both/);
    assert.throws(() => normalizeDynamic({...raw, tags:['AI 视频生成']}, '/tmp', platform), /without spaces/);
  }
});

test('Original dynamic normalization remains available only for recovery identity checks', () => {
  for (const platform of ['x', 'weibo', 'jike']) {
    assert.equal(normalizeDynamic({type:'dynamic', text:'legacy copy'}, '/tmp', platform, {allowIncomplete:true}).text, 'legacy copy');
    assert.equal(normalizeDynamic({type:'dynamic', text:'', videoPath:'clip.mp4'}, '/tmp', platform, {allowIncomplete:true}).videoPath, '/tmp/clip.mp4');
    assert.throws(() => normalizeDynamic({type:'dynamic', text:''}, '/tmp', platform, {allowIncomplete:true}), /Empty dynamic/);
  }
  assert.throws(() => normalizeDynamic({type:'dynamic', text:'copy'}, '/tmp', 'xiaohongshu', {allowIncomplete:true}), /requires images/);
  assert.throws(() => normalizeDynamic({type:'dynamic', text:'', images:['one.png']}, '/tmp', 'xiaohongshu', {allowIncomplete:true}), /nonempty body/);
});

test('Historical drafts recover only with their exact original package and fingerprints; new tasks remain strict', {skip:process.platform!=='darwin'}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '168-dynamic-legacy-'));
  try {
    const image = path.join(dir, 'one.png');
    fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
    const video = path.join(dir, 'clip.mp4');
    const header = Buffer.alloc(24); header.writeUInt32BE(24, 0); header.write('ftypisom', 4); fs.writeFileSync(video, header);
    const packagePath = path.join(dir, 'package.json'), root = path.join(dir, 'jobs');
    const marker = path.join(dir, 'browser-calls'), mock = path.join(dir, 'ego-mock');
    const gates = {authenticated:true, account:true, composer:true, text:true, media:true, upload:true, noBlockingDialog:true, safety:true};
    fs.writeFileSync(mock, `#!${process.execPath}\nimport fs from 'node:fs';let body='';for await(const c of process.stdin)body+=c;fs.appendFileSync(${JSON.stringify(marker)},'call\\n');if(body.includes('await page.setInputFiles'))throw new Error('Unexpected upload');const handoff=body.includes('const released = await page.evaluate');console.log('168_PUBLISHER_RESULT:'+JSON.stringify(handoff?{status:'awaiting_manual_send',taskSpaceId:40,finalPublishClicked:false,released:{ok:true}}:{text:'legacy',editorText:'legacy',images:[],videos:0,files:[],account:'account',taskSpaceId:40,observedAt:new Date().toISOString(),finalPublishClicked:false,gates:${JSON.stringify(gates)}}));\n`, {mode:0o700});
    const invoke = (command, jobId) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/dynamic.mjs', import.meta.url)), command, '--package', packagePath, '--platform', 'x', ...(jobId ? ['--job-id', jobId] : []), '--state-root', root, ...(command === 'handoff' ? ['--confirm-manual-send'] : [])], {encoding:'utf8', env:{...process.env, VIDEO_PUBLISHER_V2_EGO_COMMAND:mock, VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir, 'locks')}});
    for (const raw of [{type:'dynamic', text:'legacy'}, {type:'dynamic', text:'', images:[image]}, {type:'dynamic', text:'', videoPath:video}]) {
      fs.writeFileSync(packagePath, JSON.stringify(raw));
      const pkg = normalizeDynamic(raw, dir, 'x', {allowIncomplete:true}), inputFingerprint = sha256(JSON.stringify(pkg));
      const jobId = inputFingerprint.slice(0, 16), jobDir = path.join(root, jobId), statePath = path.join(jobDir, 'state.json');
      fs.mkdirSync(jobDir, {recursive:true});
      const assets = pkg.videoPath ? await materializeVideo(pkg) : await materializeImages(pkg, path.join(jobDir, 'assets'));
      const state = {jobId, pkg, assets, inputFingerprint, fingerprint:sha256(JSON.stringify({pkg, media:assets.map(asset=>asset.sha256)})), taskSpaceId:40, taskSpaceName:'original', account:'account', uploadAttempted:true, cleanupComplete:true};
      for (const command of ['prepare', 'inspect', 'handoff']) {
        fs.writeFileSync(statePath, JSON.stringify(state));
        const result = invoke(command, command === 'prepare' ? undefined : jobId);
        assert.equal(result.status, 0, command + ': ' + result.stderr);
        assert.equal(JSON.parse(result.stdout).status, command === 'handoff' ? 'awaiting_manual_send' : 'draft_verified');
      }
      fs.writeFileSync(statePath, JSON.stringify(state));
      fs.rmSync(marker, {force:true});
      const checked = invoke('check', jobId);
      assert.equal(checked.status, 0, checked.stderr);
      assert.equal(JSON.parse(checked.stdout).status, 'input_checked');
      assert.notEqual(invoke('check', 'new-check').status, 0);
      assert.notEqual(invoke('prepare', 'new-job').status, 0);
      assert.equal(fs.existsSync(path.join(root, 'new-job', 'state.json')), false);
      assert.equal(fs.existsSync(marker), false, 'Strict failures must precede browser work');
      for (const changed of [{...state, jobId:'other'}, {...state, pkg:{...pkg, text:'changed'}}, {...state, inputFingerprint:'wrong'}, {...state, fingerprint:'wrong'}]) {
        fs.writeFileSync(statePath, JSON.stringify(changed));
        assert.notEqual(invoke('check', jobId).status, 0);
        assert.notEqual(invoke('inspect', jobId).status, 0);
        assert.equal(fs.existsSync(marker), false, 'Changed identity must precede browser work');
      }
      fs.writeFileSync(statePath, JSON.stringify(state));
      fs.writeFileSync(packagePath, JSON.stringify({...raw, text:raw.text+'changed'}));
      assert.notEqual(invoke('inspect', jobId).status, 0);
      assert.equal(fs.existsSync(marker), false);
    }
  } finally {fs.rmSync(dir, {recursive:true, force:true});}
});

test('local and cached HTTPS assets retain byte identity and reject changed sources without reupload', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-dynamic-'));
  try {
    const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
    const local=path.join(dir,'one.png'); fs.writeFileSync(local,image);
    const assets=await materializeImages({sources:[local]},dir);
    const cached={...assets[0],source:'https://example.com/one.png',path:local};
    const mixed=await materializeImages({sources:[local,cached.source]},dir,[assets[0],cached]);
    assert.deepEqual(mixed.map(a=>a.sha256),[assets[0].sha256,assets[0].sha256]);
    fs.writeFileSync(local,Buffer.concat([image,Buffer.from('changed')]));
    await assert.rejects(materializeImages({sources:[local]},dir,assets),/changed/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('guard blocks final clicks, submit and Cmd/Ctrl Enter; clean release never clicks', () => {
  for (const mode of ['clean','click','shortcut','submit']) {
    const listeners=new Map();
    class Element { closest(){return mode==='click'?{}:null;} }
    const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    const context=vm.createContext({window,Element,URL:{createObjectURL:()=>''},crypto:webcrypto,Date,Array,Uint8Array});
    vm.runInContext(`(${armGuard.toString()})('same')`,context);
    const guard=window.__168_PUBLISHER_X__;
    if(mode==='clean') {
      assert.equal(guard.release().ok,true); assert.equal(guard.armed,false); assert.equal(listeners.size,0);
    } else {
      let prevented=false,stopped=false;
      const type=mode==='click'?'click':mode==='submit'?'submit':'keydown';
      listeners.get(type)({type,target:new Element(),key:'Enter',metaKey:mode==='shortcut',preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
      assert.equal(prevented,true); assert.equal(stopped,true); assert.equal(guard.blockedAttempts.length,1);
      assert.throws(()=>guard.release()); assert.equal(guard.armed,true);
    }
  }
});

test('live acceptance requires original-file media bindings, completed uploads and committed text', () => {
  for(const mode of ['ordered','reversed','uncommitted','unknown','multiline','renderMismatch','transformed','pending','uploadFailed','wrongSource','unknownMedia']) {
    const text=mode==='multiline'?'first\nsecond 🐼\n\n#软件 #tag':'same';
    const reversed=mode==='reversed';
    const images=[{src:'blob:one',complete:true,naturalWidth:1,naturalHeight:1},{src:'blob:two',complete:true,naturalWidth:1,naturalHeight:1}].map(img=>({...img,getBoundingClientRect:()=>({height:20})}));
    if(reversed) images.reverse();
    const button={innerText:'发帖',disabled:false,getAttribute:()=>null};
    const group={querySelector:()=>images[0],querySelectorAll:s=>s==='img'?images:[]};
    const dialog={querySelector:s=>s.includes('tweetButton')?button:null,querySelectorAll:s=>s==='[role="group"]'?[group]:[]};
    const editor={innerText:mode==='multiline'?text.replace('\n\n','\n\n\n'):text,querySelectorAll:()=>(mode==='renderMismatch'?'different':text).split('\n').map(textContent=>({textContent})),closest:()=>dialog,getBoundingClientRect:()=>({height:20}),__reactFiber$test:{stateNode:{props:{editorState:{getCurrentContent:()=>({getPlainText:()=>mode==='uncommitted'?'':text})}}}}};
    if(mode==='unknown') delete editor.__reactFiber$test;
    const guard={version:2,armed:true,fingerprint:'id',blockedAttempts:[],files:[{sha256:'one',size:1},{sha256:'two',size:2}],blobs:{'blob:one':{sha256:'one'},'blob:two':{sha256:'two'}}};
    if(['transformed','wrongSource'].includes(mode)) {
      images[0].src='blob:converted';guard.blobs['blob:converted']={sha256:'converted'};
    }
    const media=['one','two'].map((id,index)=>({originalMediaFile:{url:mode==='wrongSource'&&index===0?'blob:other':'blob:'+id,fileHandle:{size:index+1}},mediaFile:{url:index===0&&['transformed','wrongSource'].includes(mode)?'blob:converted':'blob:'+id},uploadId:'uploaded-'+id,uploadProgress:mode==='pending'?0.5:1,uploading:mode==='pending',uploadFailed:mode==='uploadFailed',needsProcessing:false}));
    for(const img of images) img.__reactFiber$test={stateNode:{props:{media:mode==='unknownMedia'?null:media}},memoizedProps:{media:media.map(m=>({...m,uploading:true,uploadProgress:0.5}))}};
    const context=vm.createContext({window:{__168_PUBLISHER_X__:guard},document:{querySelector:()=>({innerText:'@account'}),querySelectorAll:s=>s.includes('contenteditable')?[editor]:[]},getComputedStyle:()=>({visibility:'visible'}),location:{hostname:'x.com',pathname:'/compose/post'},Date});
    const observation=vm.runInContext(`(${observeX.toString()})(${JSON.stringify({text,account:'@account',fingerprint:'id',assets:[{sha256:'one',size:1},{sha256:'two',size:2}]})})`,context);
    assert.equal(observation.gates.media,!['reversed','wrongSource','unknownMedia'].includes(mode)); assert.equal(dynamicVerdict(observation).ready,['ordered','multiline','transformed'].includes(mode),'Only original-file-bound, completed media and committed text may pass');
    if(mode==='unknown') assert.equal(dynamicVerdict(observation).status,'result_unknown');
    if(['pending','video-pending'].includes(mode)) assert.equal(dynamicVerdict(observation).status,'processing');
    if(mode==='uploadFailed') assert.equal(dynamicVerdict(observation).status,'failed');
  }
});

test('handoff rechecks the draft and only releases the guard and delegates; changed draft stays protected', async () => {
  for(const ready of [true,false]) {
    const events=[];
    const page={evaluate:async fn=>fn.name==='observeX'?{gates:{safety:true,text:ready}}:(events.push('release'),{ok:true})};
    const state={taskSpaceId:8,taskSpaceName:'same',profile:'test',account:'@account',pkg:{text:'same'},assets:[]};
    const task={spaceId:8,name:'same',tabs:async()=>[{label:'p1'}],page:()=>page,handOff:async()=>events.push('handoff')};
    const context=vm.createContext({console:{log(){}},taskSpace:async()=>task,listTaskSpaces:async()=>[{id:8,name:'same',profileName:'test',ownership:'agent'}]});
    const action=vm.runInContext(`(async()=>{${handoffDynamicScript(state)}})()`,context);
    if(ready){await action;assert.deepEqual(events,['release','handoff']);}
    else{await assert.rejects(action);assert.deepEqual(events,[]);}
  }
});

test('fresh handoff requires every gate, account and original space; user ownership needs explicit resume', async () => {
  const state={taskSpaceId:8,taskSpaceName:'same',profile:'test',account:'@account',pkg:{text:'same'},assets:[]};
  const observation={gates:Object.fromEntries(['authenticated','account','composer','text','media','upload','noBlockingDialog','safety'].map(g=>[g,true])),observedAt:new Date().toISOString(),taskSpaceId:8,account:'@account',finalPublishClicked:false};
  assertDynamicReady(observation,state);
  for(const changes of [{gates:{}},{taskSpaceId:9},{account:'@other'},{observedAt:new Date(Date.now()-61000).toISOString()},{finalPublishClicked:true}]) assert.throws(()=>assertDynamicReady({...observation,...changes},state));
  let resumed=0;
  const task={spaceId:8,name:'same',tabs:async()=>[{label:'p1'}],page:()=>({})};
  const context=vm.createContext({listTaskSpaces:async()=>[{id:8,name:'same',profileName:'test',ownership:'agentDelegatedToUser'}],takeOverTaskSpace:async()=>{resumed++;return task;}});
  await assert.rejects(vm.runInContext(`(async()=>{${existingSpaceScript(state)}})()`,context));
  assert.equal(resumed,0);
  await vm.runInContext(`(async()=>{${existingSpaceScript(state,true)}})()`,context);
  assert.equal(resumed,1);
});

test('video input is local, exclusive, size-limited and immutable across resume', async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-video-input-'));
  try {
    const file=path.join(dir,'clip.mp4'), bytes=Buffer.alloc(24);bytes.write('ftyp',4);fs.writeFileSync(file,bytes);
    const pkg=normalizeDynamic({type:'dynamic',text:'confirmed body',videoPath:'clip.mp4'},dir);
    assert.equal(pkg.videoPath,file);
    const assets=await materializeVideo(pkg);assert.equal(assets[0].kind,'video');
    assert.deepEqual(await materializeVideo(pkg,assets),assets);
    for(const raw of [{images:['a.png'],videoPath:file},{videoPath:'https://example.com/a.mp4'},{videoPath:''}])assert.throws(()=>normalizeDynamic({type:'dynamic',text:'test',...raw},dir));
    bytes[23]=1;fs.writeFileSync(file,bytes);await assert.rejects(materializeVideo(pkg,assets),/changed/);
    fs.writeFileSync(file,'invalid');await assert.rejects(materializeVideo(pkg),/container/);
    fs.writeFileSync(file,bytes);fs.truncateSync(file,512_000_001);await assert.rejects(materializeVideo(pkg),/512/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('video READY requires bound original, decoded preview and completed native upload',()=>{
 for(const mode of ['ready','pending','failed','wrongSource','wrongPreview','undecoded','tooLong']){
  const item={originalMediaFile:{url:mode==='wrongSource'?'blob:other':'blob:video',fileHandle:{size:4}},mediaFile:{url:mode==='wrongPreview'?'blob:other':'blob:video',isVideo:true},uploadId:'upload',uploadProgress:mode==='pending'?0.4:1,uploading:mode==='pending',uploadFailed:mode==='failed',needsProcessing:false};
  const video={src:'',currentSrc:'blob:video',duration:mode==='tooLong'?141:36.7,readyState:mode==='undecoded'?0:4,videoWidth:3454,videoHeight:2016,getBoundingClientRect:()=>({height:20}),__reactFiber$test:{stateNode:{props:{media:[item]}}}};
  const button={innerText:'发帖',disabled:false,getAttribute:()=>null};
  const group={querySelector:()=>video,querySelectorAll:()=>[]};
  const dialog={querySelector:()=>button,querySelectorAll:s=>s==='video'?[video]:s==='[role="group"]'?[group]:[]};
  const editor={innerText:'test',querySelectorAll:()=>[{textContent:'test'}],closest:()=>dialog,getBoundingClientRect:()=>({height:20}),__reactFiber$test:{stateNode:{props:{editorState:{getCurrentContent:()=>({getPlainText:()=>'test'})}}}}};
  const guard={version:2,armed:true,fingerprint:'id',blockedAttempts:[],files:[{size:4,sha256:'video'}],blobs:{'blob:video':{sha256:'video'}}};
  const context=vm.createContext({window:{__168_PUBLISHER_X__:guard},document:{querySelector:()=>({innerText:'@account'}),querySelectorAll:s=>s.includes('contenteditable')?[editor]:[]},getComputedStyle:()=>({visibility:'visible'}),location:{hostname:'x.com',pathname:'/compose/post'},Date});
  const observation=vm.runInContext(`(${observeX.toString()})(${JSON.stringify({text:'test',account:'@account',fingerprint:'id',assets:[{kind:'video',size:4,sha256:'video'}]})})`,context);
  assert.equal(dynamicVerdict(observation).ready,mode==='ready');
  if(['pending','video-pending'].includes(mode))assert.equal(dynamicVerdict(observation).status,'processing');
  if(['failed','video-failed'].includes(mode))assert.equal(dynamicVerdict(observation).status,'failed');
 if(mode==='rate-limit')assert.equal(dynamicVerdict(observation).status,'needs_user');
 }
});

test('unverified historical cleanup stops the real entry before any upload attempt',{skip:process.platform!=='darwin'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-dynamic-entry-'));
 try{
  fs.writeFileSync(path.join(dir,'one.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
  const packagePath=path.join(dir,'package.json'),raw={type:'dynamic',text:'confirmed',images:['one.png']};fs.writeFileSync(packagePath,JSON.stringify(raw));
  const pkg=normalizeDynamic(raw,dir),jobDir=path.join(dir,'jobs/job');fs.mkdirSync(jobDir,{recursive:true});
  const assets=await materializeImages(pkg,path.join(jobDir,'assets'));
  fs.writeFileSync(path.join(jobDir,'state.json'),JSON.stringify({jobId:'job',pkg,assets,inputFingerprint:sha256(JSON.stringify(pkg)),fingerprint:sha256(JSON.stringify({pkg,media:assets.map(asset=>asset.sha256)})),taskSpaceId:40,taskSpaceName:'test',uploadAttempted:false}));
  const marker=path.join(dir,'upload-started'),mock=path.join(dir,'ego-mock');
  const observation={text:'foreign draft',editorText:'foreign draft',images:[],videos:0,files:[],account:'@account',gates:{authenticated:true,account:true,composer:true,safety:true,media:false,text:false}};
  fs.writeFileSync(mock,`#!${process.execPath}\nimport fs from 'node:fs';let body='';for await(const c of process.stdin)body+=c;if(body.includes('await page.setInputFiles'))fs.writeFileSync(${JSON.stringify(marker)},'uploaded');console.log('168_PUBLISHER_RESULT:'+${JSON.stringify(JSON.stringify(observation))});\n`,{mode:0o700});
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/dynamic.mjs',import.meta.url)),'prepare','--package',packagePath,'--platform','x','--job-id','job','--state-root',path.join(dir,'jobs')],{encoding:'utf8',env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:mock,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks')}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/History cleanup did not produce an empty editor/);assert.equal(fs.existsSync(marker),false);assert.equal(JSON.parse(fs.readFileSync(path.join(jobDir,'state.json'),'utf8')).uploadAttempted,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Weibo uses closed hashtags, its own override and bounded ordered images',()=>{
 const raw={type:'dynamic',text:'base',tags:['软件'],images:['one.png'],platforms:{x:{text:'X'},weibo:{text:'微博 🐼'}}};
 assert.equal(normalizeDynamic(raw,'/tmp','weibo').text,'微博 🐼\n\n#软件#');
 assert.equal(normalizeDynamic(raw,'/tmp','x').text,'X\n\n#软件');
 assert.equal(normalizeDynamic({...raw,images:Array.from({length:9},(_,i)=>i+'.png')},'/tmp','weibo').sources.length,9);
 assert.equal(normalizeDynamic({...raw,images:[],videoPath:'clip.mp4'},'/tmp','weibo').videoPath,'/tmp/clip.mp4');
 for(const extra of [{images:Array.from({length:10},(_,i)=>i+'.png')},{images:['a.png'],videoPath:'clip.mp4'},{platforms:{weibo:{title:'unsupported'}}}])assert.throws(()=>normalizeDynamic({...raw,...extra},'/tmp','weibo'));
 assert.equal(parseDynamicOptions(['prepare','--package','a.json','--platform','weibo']).platform,'weibo');
});

test('Weibo READY binds current Vue text, original File bytes, ordered server previews and completed IDs',async()=>{
 const one=new File(['one'],'one.png'),two=new File(['two'],'two.png');
 for(const mode of ['ready','reversed','wrongFile','uncommitted','pending','missingId','foreignAccount','noModel','scheduled','error','pure']){
  const pure=mode==='pure',assets=pure?[]:[{sha256:sha256('one'),size:3},{sha256:sha256('two'),size:3}];
  const items=pure?[]:[one,two].map((file,index)=>({file,url:'https://wx1.sinaimg.cn/bmiddle/id'+index+'.jpg',pid:mode==='missingId'?'':'id'+index,status:mode==='pending'?2:3,index}));
  if(mode==='wrongFile')items[0].file=two;
  const nodes=items.map(item=>({src:item.url,naturalWidth:1,naturalHeight:1,complete:true,getBoundingClientRect:()=>({height:20})}));if(mode==='reversed')nodes.reverse();
  const button={innerText:'发送',disabled:false,getBoundingClientRect:()=>({height:20})};
  const root={querySelectorAll:s=>s==='button'?[button]:s.includes('_picbed_')?nodes:[]};
  const editor={value:'confirmed',closest:()=>root,getBoundingClientRect:()=>({height:20})};
  const data={content:mode==='uncommitted'?'':'confirmed',pic_id:items,media:{},type:'text1',visible:0,formDisabled:false,schedule_timestamp:mode==='scheduled'?1:0};
  const input={data:{text:'confirmed'},subTree:{el:editor}};
  const publisher={data,subTree:{component:input}};
  const vnode={component:publisher};
  const guard={version:2,armed:true,fingerprint:'id',blockedAttempts:[],files:assets.map(a=>({...a,pending:false}))};
  const account={href:'https://weibo.com/u/'+(mode==='foreignAccount'?'456':'123'),querySelector:()=>({})};
  const error={innerText:'上传失败',getBoundingClientRect:()=>({height:20})};
  const context=vm.createContext({window:{__168_PUBLISHER_WEIBO__:guard},File,crypto:webcrypto,URL,document:{querySelector:()=>({_vnode:mode==='noModel'?null:vnode}),querySelectorAll:s=>s.startsWith('textarea')?[editor]:s.includes('woo-tab-nav')?[account]:s.includes('toast')&&mode==='error'?[error]:[]},getComputedStyle:()=>({visibility:'visible'}),location:{hostname:'weibo.com',pathname:'/'},Date});
  const observation=await vm.runInContext(`(${observeWeibo.toString()})(${JSON.stringify({assets,text:'confirmed',account:'123',fingerprint:'id'})})`,context);
  const verdict=dynamicVerdict(observation);assert.equal(verdict.ready,['ready','pure'].includes(mode),mode);
  if(['pending','video-pending'].includes(mode))assert.equal(verdict.status,'processing');if(mode==='error')assert.equal(verdict.status,'failed');
 }
});

test('Weibo shares the final-send guard and rejects changed guard identity',()=>{
 const listeners=new Map();class Element{constructor(){this.innerText='发送';}closest(){return this;}}
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const context=vm.createContext({window,Element,URL:{createObjectURL:()=>''},crypto:webcrypto,Date,Array,Uint8Array});
 vm.runInContext(`(${armGuard.toString()})({platform:'weibo',fingerprint:'id'})`,context);
 assert.throws(()=>vm.runInContext(`(${armGuard.toString()})({platform:'weibo',fingerprint:'other'})`,context));
 let prevented=false;listeners.get('click')({type:'click',target:new Element(),preventDefault(){prevented=true;},stopImmediatePropagation(){}});
 assert.equal(prevented,true);assert.equal(window.__168_PUBLISHER_WEIBO__.blockedAttempts.length,1);assert.throws(()=>window.__168_PUBLISHER_WEIBO__.release());
});

test('Weibo video uses the retained native uploader File and completed server IDs',async()=>{
 const original=new File(['video'],'clip.mp4');
 original.initRes={media_id:'media'};
 original.detail={detail:{width:1280,height:720,duration:36.7},screenshot:[{pid:'poster',url:'https://wx1.sinaimg.cn/bmiddle/poster.jpg'}]};
 const item={type:'video',index:0,wbUploader:{currFile:original}};
 const window={__168_PUBLISHER_WEIBO__:{version:2,armed:true,fingerprint:'id',blockedAttempts:[],files:[{sha256:sha256('video'),size:5,pending:false}]}};
 for(const mode of ['ready','staleProgress','pending','missingChunks','partialBytes','partialChunks','failedChunk','malformedReply','foreignFile','missingId','wrongReceipt','wrongPoster','scheduled']){
  original.progress=[mode==='partialBytes'?4:5];
  original.sliceInfo=mode==='missingChunks'?[]:[{sliceNum:0,sliceSize:mode==='partialChunks'?4:5,statusCode:200,responseBody:mode==='malformedReply'?'invalid':JSON.stringify({result:mode!=='failedChunk'})}];
  original.initRes.media_id=mode==='wrongReceipt'?'other':'media';
  Object.assign(item,{status:mode==='pending'?2:3,uploadProgress:mode==='pending'?50:mode==='staleProgress'?89:100,media_id:mode==='missingId'?'':'media',media_group_id:'group',duration:36.7,pid:'poster',url:'https://wx1.sinaimg.cn/bmiddle/poster.jpg'});
  const button={innerText:'发送',disabled:false,getBoundingClientRect:()=>({height:20})};
  const image={src:mode==='wrongPoster'?'https://wx1.sinaimg.cn/bmiddle/foreign.jpg':item.url,naturalWidth:1,naturalHeight:1,complete:true,getBoundingClientRect:()=>({height:20})};
  const root={querySelectorAll:s=>s==='button'?[button]:s.includes('_picbed_')?[image]:[]};
  const editor={value:'confirmed',closest:()=>root,getBoundingClientRect:()=>({height:20})};
  const data={content:'confirmed',pic_id:[item],media:{},type:'text1',visible:0,formDisabled:false,schedule_timestamp:mode==='scheduled'?1:0};
  const publisher={data,subTree:{component:{data:{text:'confirmed'},subTree:{el:editor}}}};
  const account={href:'https://weibo.com/u/123',querySelector:()=>({})};
  const ctx=vm.createContext({window,File,crypto:webcrypto,URL,document:{querySelector:()=>({_vnode:{component:publisher}}),querySelectorAll:s=>s.startsWith('textarea')?[editor]:s.includes('woo-tab-nav')?[account]:[]},getComputedStyle:()=>({visibility:'visible'}),location:{hostname:'weibo.com',pathname:'/'},Date});
  const expected={assets:[{sha256:mode==='foreignFile'?'other':sha256('video'),size:5}],videoPath:'/clip.mp4',text:'confirmed',account:'123',fingerprint:'id'};
  const observation=await vm.runInContext(`(${observeWeibo.toString()})(${JSON.stringify(expected)})`,ctx);
  assert.equal(dynamicVerdict(observation).ready,['ready','staleProgress'].includes(mode),mode);
  if(mode==='pending')assert.equal(dynamicVerdict(observation).status,'processing');
 }
});

test('XHS title and topic entities are platform-specific; graphics require images',()=>{
 const raw={type:'dynamic',text:'hello',images:['one.png'],platforms:{xiaohongshu:{title:'标题',tags:['软件']}}};
 assert.deepEqual(normalizeDynamic(raw,'/tmp','xiaohongshu'),{type:'dynamic',platform:'xiaohongshu',text:'hello',title:'标题',tags:['软件'],sources:['/tmp/one.png']});
 assert.equal(normalizeDynamic({...raw,images:[],videoPath:'clip.mp4'},'/tmp','xiaohongshu').videoPath,'/tmp/clip.mp4');
 for(const extra of [{images:[]},{title:'x'.repeat(21),platforms:{}},{images:['one.png'],videoPath:'a.mp4'}])assert.throws(()=>normalizeDynamic({...raw,...extra},'/tmp','xiaohongshu'));
 const source=fillXhsScript({});assert.match(source,/waitForFunction/);assert.match(source,/creator-editor-topic-container/);assert.doesNotMatch(source,/execCommand|\.publish\(/);
});

test('XHS checks committed text, real topics, original image/video bytes and completed native IDs',async()=>{
 for(const mode of ['ready','reencoded','changedPixels','changedDimensions','changedReceipt','pixelPending','plainHashtag','uncommitted','wrongTitle','wrongImage','pending','missingId','disabled','private','scheduled','video-ready','video-pending','video-file','video-blob','video-id','video-info']){
  const videoMode=mode.startsWith('video-');
  const rect=()=>({width:20,height:20});
  const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hello'}]},{type:'paragraph'},{type:'paragraph',content:mode==='plainHashtag'?[{type:'text',text:'#软件'}]:[{type:'topic',attrs:{data:{id:'topic-id',name:'软件'}}},{type:'text',text:'\u00a0'}]}]};
  const textBlocks=['hello','','#软件[话题]#\u00a0'].map(textContent=>({textContent}));
  const editor={editor:{getJSON:()=>doc},querySelectorAll:()=>textBlocks,getBoundingClientRect:rect,getAttribute:()=>null};
  const store={title:mode==='wrongTitle'?'foreign':'title',desc:mode==='uncommitted'?'':'hello\n\t\n#软件[话题]#',descInnerHTML:'native',descLength:9,userInfo:{id:'account'},imageNoteOrigin:0,postTiming:mode==='scheduled',privacyInfo:{opType:1,type:mode==='private'?1:0,userIds:[]},collectionId:'',isImageReady:true,imgList:[{file:{size:3},url:'blob:image',status:mode==='pending'?1:2,progress:mode==='pending'?0.5:1,fileId:mode==='missingId'?'':'spectrum/id'}]};
  const root={};const title={value:'title'};const image={src:'blob:image',complete:true,naturalWidth:1,naturalHeight:1,getBoundingClientRect:rect,getAttribute:()=>null};
  const button={getAttribute:k=>({'submit-text':'发布','submit-disabled':mode==='disabled'?'true':'false','submit-loading':'false'}[k])};
  const vnode={component:{props:{state:{imgList:{_object:store}}},subTree:null}};
  const guard={version:3,armed:true,fingerprint:'id',blockedAttempts:[],files:[{sha256:'image',size:3}],blobs:{'blob:image':{sha256:mode==='wrongImage'?'other':'image'}}};
  if(['reencoded','changedPixels','changedDimensions','changedReceipt','pixelPending'].includes(mode)){
   Object.assign(guard.files[0],{pixelSha256:'pixels',width:1,height:1});
   Object.assign(guard.blobs['blob:image'],{sha256:'encoded',size:4,pixelSha256:mode==='changedPixels'?'other':'pixels',width:mode==='changedDimensions'?2:1,height:1,pending:mode==='pixelPending'});
   store.imgList[0].file.size=4;
   if(mode==='changedReceipt')guard.files[0].sha256='foreign';
  }
  if(videoMode){
   Object.assign(store,{imgList:[],videoFile:new File([mode==='video-file'?'other':'video'],'clip.mp4'),videoBlobUrl:'blob:video',video:{fileid:mode==='video-id'?'':'spectrum/video',videoId:'video-id',fsize:5,width:1280,height:720,duration:36.7},videoInfo:{Width:1280,Height:mode==='video-info'?100:720,Duration:36.7},coverUrl:'https://native/cover',isVideoReady:mode!=='video-pending',uploadPercent:mode==='video-pending'?50:100,publishType:0,hasBeenPublished:false,isPublishing:false});
   guard.files=[{sha256:sha256('video'),size:5,pending:false}];guard.blobs['blob:video']={sha256:mode==='video-blob'?'other':sha256('video'),size:5,pending:false};
  }
  const app={_vnode:vnode,__vue_app__:{config:{globalProperties:{$pinia:{_s:new Map(['draft','publisher','settings','user'].map(id=>[id,store]))}}}}};
  const document={querySelector:s=>s.startsWith('input[placeholder')?title:s==='.publish-page-content-base'?root:s.startsWith('.cover-plugin-preview')?{}:null,querySelectorAll:s=>s.startsWith('.tiptap')?[editor]:s==='[data-v-app]'?[app]:s.startsWith('.format-img')?(videoMode?[]:[image]):s.startsWith('xhs-publish-btn')?[button]:[],createElement:()=>({innerHTML:'',content:{querySelectorAll:()=>textBlocks}})};
  const context=vm.createContext({window:{__168_PUBLISHER_XHS__:guard},document,File,crypto:webcrypto,Array,Uint8Array,getComputedStyle:()=>({visibility:'visible',opacity:'1',backgroundImage:'url(https://native/cover)'}),location:{hostname:'creator.xiaohongshu.com',pathname:'/publish/publish'},Date});
  const observation=await vm.runInContext(`(${observeXhs.toString()})(${JSON.stringify({text:'hello',title:'title',tags:['软件'],...(videoMode?{videoPath:'/clip.mp4'}:{}),assets:videoMode?[{sha256:sha256('video'),size:5}]:[{sha256:'image',size:3}],fingerprint:'id',account:'account'})})`,context);
  assert.equal(dynamicVerdict(observation).ready,['ready','reencoded','video-ready'].includes(mode),mode);
  if(['video-pending','pixelPending'].includes(mode))assert.equal(dynamicVerdict(observation).status,'processing');
 }
});

test('XHS closed publish component is protected even when shadow clicks hide the button text',()=>{
 const listeners=new Map();class Element{closest(selector){return selector==='xhs-publish-btn'?{}:null;}}
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const context=vm.createContext({window,Element,URL:{createObjectURL:()=>''},crypto:webcrypto,Date,Array,Uint8Array});
 vm.runInContext(`(${armGuard.toString()})({platform:'xiaohongshu',fingerprint:'id'})`,context);
 let prevented=false;listeners.get('click')({type:'click',target:new Element(),preventDefault(){prevented=true;},stopImmediatePropagation(){}});
 assert.equal(prevented,true);assert.equal(window.__168_PUBLISHER_XHS__.version,3);assert.throws(()=>window.__168_PUBLISHER_XHS__.release());
});

test('Jike input preserves inline hashtag text and supports exclusive local video',()=>{
 const raw={type:'dynamic',text:'base',tags:['软件'],images:['one.png'],platforms:{jike:{text:'即刻 🐼'}}};
 assert.equal(normalizeDynamic(raw,'/tmp','jike').text,'即刻 🐼\n\n#软件');
 assert.equal(parseDynamicOptions(['prepare','--package','a.json','--platform','jike']).platform,'jike');
 assert.equal(normalizeDynamic({...raw,images:[],videoPath:'clip.mp4'},'/tmp','jike').videoPath,'/tmp/clip.mp4');
 assert.throws(()=>normalizeDynamic({...raw,images:['x.png'],videoPath:'clip.mp4'},'/tmp','jike'));
 for(const extra of [{topic:'circle'},{title:'title'},{images:Array.from({length:10},(_,i)=>i+'.png')}]) assert.throws(()=>normalizeDynamic({...raw,...extra},'/tmp','jike'));
});

test('Jike requires mounted Lexical/form agreement, original ordered files and completed CDN receipts',async()=>{
 const file=new File(['one'],'one.png');
 for(const mode of ['ready','staleHost','uncommitted','domOnly','wrongFile','wrongPreview','pending','failed','missingId','wrongAccount','circle','pure','video-ready','video-key','video-pending','video-failed','video-bytes','video-dimensions','video-duration','rate-limit']){
  const videoMode=mode.startsWith('video-'),pure=mode==='pure',text='hello\n\n#软件';
  const assets=pure?[]:[{sha256:sha256('one'),size:3,...(videoMode?{duration:10}:{})}];
  const values={content:mode==='uncommitted'?'':text,attachment:{ids:pure?[]:['1'],map:pure?{}:{'1':{file:mode==='wrongFile'?new File(['two'],'two.png'):file,type:'PICTURE',status:mode==='pending'?'UPLOADING':mode==='failed'?'FAILED':'UPLOADED',cdn:{file:{id:mode==='missingId'?'':'cdn-id',key:'key.png',fileUrl:'https://cdnv2.ruguoapp.com/key.png',success:true}}}}},topic:mode==='circle'?{id:'unconfirmed'}:undefined};
  const video={src:'blob:image',currentSrc:'blob:image',videoWidth:mode==='video-dimensions'?2000:1280,videoHeight:720,duration:mode==='video-duration'?12:10,readyState:1,error:null,getBoundingClientRect:()=>({height:20})};
  if(videoMode){const item=values.attachment.map['1'];item.type='VIDEO';item.metadata={width:1280,height:720};item.status=mode==='video-pending'?'UPLOADING':mode==='video-failed'?'UPLOAD_FAILED':'UPLOADED';item.cdn.file={key:mode==='video-key'?'foreign.mp4':'Fv4FvNzcSSgBJ4Gl8aKnfLtTmOEG.mp4',fileUrl:'blob:image'};if(mode==='video-bytes')item.file=new File(['two'],'clip.mp4');}
  const image={src:'blob:image',complete:true,naturalWidth:1,getBoundingClientRect:()=>({height:20})};
  const button={innerText:'发送',disabled:false,getAttribute:()=>null};
  const form={parentElement:{querySelector:()=>({getAttribute:()=>'/u/user'})},querySelector:()=>button,querySelectorAll:s=>s==='img'&&!pure&&!videoMode?[image]:s==='video'&&videoMode?[video]:[]};
  const doc={root:{children:[{type:'paragraph',children:[{type:'text',text:mode==='domOnly'?'':text}]}]}};
  const editor={innerText:text,closest:()=>form,getBoundingClientRect:()=>({height:20}),__lexicalEditor:{getEditorState:()=>({toJSON:()=>doc})}};
  const root={stateNode:{current:null}};
  const provider={memoizedProps:{control:{_formValues:values,_formState:{errors:{},isSubmitting:false}},getValues:()=>values},memoizedState:{memoizedState:{data:{isLoginUser:true,id:mode==='wrongAccount'?'other':'account',username:'user'}}},return:root};
  const input={memoizedProps:{name:'content',value:text},return:provider};
  const mounted={stateNode:editor,return:input};root.stateNode.current=mounted;
  editor.__reactFiber$test=mode==='staleHost'?{return:root,memoizedProps:{name:'content',value:'stale'}}:mounted;
  const guard={version:2,armed:true,fingerprint:'id',blockedAttempts:[],files:assets.map(a=>({...a,pending:false})),blobs:{'blob:image':{sha256:mode==='wrongPreview'?'other':sha256('one')}}};
  const context=vm.createContext({window:{__168_PUBLISHER_JIKE__:guard},File,crypto:webcrypto,Date,Uint8Array,btoa,document:{querySelectorAll:s=>s.includes('data-lexical-editor')?[editor]:s.includes('[role=status]')&&mode==='rate-limit'?[{getBoundingClientRect:()=>({height:1}),innerText:'操作过于频繁'}]:[]},getComputedStyle:()=>({visibility:'visible'}),location:{hostname:'web.okjike.com',pathname:'/following'}});
  const observation=await vm.runInContext(`(${observeJike.toString()})(${JSON.stringify({text,assets,...(videoMode?{videoPath:'/clip.mp4'}:{}),account:'account',fingerprint:'id'})})`,context);
  assert.equal(dynamicVerdict(observation).ready,['ready','staleHost','pure','video-ready'].includes(mode),mode);
  if(['pending','video-pending'].includes(mode))assert.equal(dynamicVerdict(observation).status,'processing');
  if(['failed','video-failed'].includes(mode))assert.equal(dynamicVerdict(observation).status,'failed');
 if(mode==='rate-limit'){assert.equal(dynamicVerdict(observation).status,'processing');assert.equal(dynamicVerdict(observation).waitingFor,'rate_limit');}
 }
});

test('Jike final send click, form submit and shortcut are protected',()=>{
 for(const type of ['click','submit','keydown']){
  const listeners=new Map();class Element{constructor(){this.innerText='发送';}closest(){return this;}}
  const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const context=vm.createContext({window,Element,URL:{createObjectURL:()=>''},crypto:webcrypto,Date,Array,Uint8Array});
  vm.runInContext(`(${armGuard.toString()})({platform:'jike',fingerprint:'id'})`,context);
  let stopped=false;listeners.get(type)({type,target:new Element(),key:'Enter',metaKey:true,preventDefault(){stopped=true;},stopImmediatePropagation(){}});
  assert.equal(stopped,true);assert.throws(()=>window.__168_PUBLISHER_JIKE__.release());
 }
});

test('Jike recovery uploads once; unexpected media and platform blockers still stop',{skip:process.platform!=='darwin'},()=>{
 for(const mode of ['fresh','existing','video','blocked']){
  const existing=mode==='existing';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-jike-entry-'));
  try{
   const local=path.join(dir,'one.png');fs.writeFileSync(local,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
   const raw={type:'dynamic',text:'confirmed',images:[local]},pkg=normalizeDynamic(raw,dir,'jike');
   const bytes=fs.readFileSync(local),assets=[{source:local,path:local,size:bytes.length,sha256:sha256(bytes),width:1,height:1,format:'png'}];
   const packagePath=path.join(dir,'package.json');fs.writeFileSync(packagePath,JSON.stringify(raw));
   const jobDir=path.join(dir,'jobs/job');fs.mkdirSync(jobDir,{recursive:true});
   fs.writeFileSync(path.join(jobDir,'state.json'),JSON.stringify({jobId:'job',pkg,assets,inputFingerprint:sha256(JSON.stringify(pkg)),fingerprint:sha256(JSON.stringify({pkg,media:assets.map(a=>a.sha256)})),taskSpaceId:40,taskSpaceName:'test',uploadAttempted:false,cleanupComplete:true}));
   const marker=path.join(dir,'uploads'),mock=path.join(dir,'ego-mock');
   const observation={text:'confirmed',editorText:'confirmed',images:[],videos:0,files:[],videoPreviews:mode==='video'?[{media:{originalSize:5,uploadId:'foreign'}}]:[],native:{ids:existing?['foreign']:[]},account:'account',gates:{authenticated:true,account:true,composer:true,safety:true,media:false,text:true,noBlockingDialog:mode!=='blocked'}};
   fs.writeFileSync(mock,`#!${process.execPath}\nimport fs from 'node:fs';let body='';for await(const c of process.stdin)body+=c;if(body.includes('await page.setInputFiles'))fs.appendFileSync(${JSON.stringify(marker)},'upload\\n');console.log('168_PUBLISHER_RESULT:'+${JSON.stringify(JSON.stringify(observation))});\n`,{mode:0o700});
   const args=[fileURLToPath(new URL('../scripts/dynamic.mjs',import.meta.url)),'prepare','--package',packagePath,'--platform','jike','--job-id','job','--state-root',path.join(dir,'jobs')];
   const env={...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:mock,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks')};
   const first=spawnSync(process.execPath,args,{encoding:'utf8',env});
   if(mode==='blocked'){assert.match(first.stderr,/platform blocker/);assert.equal(JSON.parse(first.stderr.trim()).status,'needs_user');assert.equal(fs.existsSync(marker),false);assert.equal(JSON.parse(fs.readFileSync(path.join(jobDir,'state.json'))).uploadAttempted,false);}
   else if(existing||mode==='video'){assert.match(first.stderr,/Unexpected media/);assert.equal(fs.existsSync(marker),false);}
   else{assert.equal(first.status,10,first.stderr);assert.equal(fs.readFileSync(marker,'utf8'),'upload\n');const second=spawnSync(process.execPath,args,{encoding:'utf8',env});assert.equal(second.status,10,second.stderr);assert.equal(fs.readFileSync(marker,'utf8'),'upload\n');}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
 const observation={gates:{authenticated:true,account:true,composer:true,text:true,media:true,upload:true,noBlockingDialog:false,safety:true},errors:[]};
 assert.equal(dynamicVerdict(observation).status,'needs_user');
});

test('Jike native video keys match Qiniu ETags for one block and multiple blocks without a dependency',async()=>{
 const source=observeJike.toString(),part=source.slice(source.indexOf('const videoEtag='),source.indexOf('const videoNodes='));
 const context=vm.createContext({File,guard:{},crypto:webcrypto,Uint8Array,btoa});vm.runInContext(part+'this.etag=videoEtag;',context);
 assert.equal(await context.etag(new File(['one'],'one.mp4')),'Fv4FvNzcSSgBJ4Gl8aKnfLtTmOEG');
 assert.equal(await context.etag(new File([Buffer.alloc(4*1024*1024,97),'b'],'large.mp4')),'lpVXp3RLT7YisM98iQR-0BSJTzXF');
 assert.equal(await context.etag(new File([],'empty.mp4')),'');
});

test('New platform pages reuse one space and recovered jobs keep their recorded page among siblings',async()=>{
 const tabs=[{label:'p1',url:'about:blank'}],outputs=[];let created=0;
 const task={spaceId:8,name:'shared',tabs:async()=>tabs,page:label=>({label}),newPage:async()=>{const page={label:'p'+(++created+1)};tabs.push({...page,url:'about:blank'});return page;}};
 const context=vm.createContext({console:{log:line=>outputs.push(JSON.parse(line.slice('168_PUBLISHER_RESULT:'.length)))},taskSpace:async()=>task,listTaskSpaces:async()=>[{id:8,name:'shared',ownership:'agent',profileName:'main'}]});
 await vm.runInContext(`(async()=>{${openDraftPageScript({taskSpaceName:'new'},8)}})()`,context);
 tabs[0].url='https://x.com/compose/post';
 await vm.runInContext(`(async()=>{${openDraftPageScript({taskSpaceName:'another'},8)}})()`,context);
 assert.deepEqual(outputs.map(r=>[r.taskSpaceId,r.pageLabel]),[[8,'p1'],[8,'p2']]);assert.equal(created,1);
 await vm.runInContext(`(async()=>{${existingSpaceScript({taskSpaceId:8,taskSpaceName:'shared',profile:'main',pageLabel:'p2',pkg:{},assets:[]})}})()`,context);
 tabs.pop();await assert.rejects(vm.runInContext(`(async()=>{${existingSpaceScript({taskSpaceId:8,taskSpaceName:'shared',pageLabel:'p2',pkg:{},assets:[]})}})()`,context),/Original composer tab/);
});

test('History cleanup uses native typing and attachment deletion without clicking send',async()=>{
 const actions=[];let removes=1;
 const page={evaluate:async(fn,arg)=>typeof arg==='string'?arg.startsWith('textarea'):removes-->0,focus:async selector=>actions.push(['focus',selector]),keyboard:{press:async key=>actions.push(['key',key])},click:async selector=>actions.push(['click',selector])};
 await clearCurrentEditor(page,{type:'dynamic',platform:'weibo'});
 assert.deepEqual(actions,[['focus','textarea[placeholder="有什么新鲜事想分享给大家？"]'],['key','Meta+A'],['key','Backspace'],['click','#publisher-clear-history']]);
});

test('X first video preview may wait only with the exact current original-file receipt and clean identity',()=>{
 const state={pkg:{platform:'x',videoPath:'/clip.mp4'},assets:[{kind:'video',sha256:'source',size:10}],uploadAttempted:true};
 const observation={editorText:'confirmed',images:[],videos:0,videoPreviews:[],files:[{sha256:'source',size:10,pending:false}],errors:[],gates:{authenticated:true,account:true,composer:true,text:true,media:false,upload:false,noBlockingDialog:true,safety:true}};
 const pending=dynamicVerdict(observation,state);assert.equal(pending.status,'processing');assert.equal(pending.ready,false);assert.equal(pending.waitingFor,'media_preview');assert.equal(pending.resumePreparation,false);
 for(const patch of [{files:[]},{files:[{sha256:'other',size:10}]},{files:[{sha256:'source',size:9}]},{files:[{sha256:'source',size:10,pending:true}]},{files:[{sha256:'source',size:10,error:true}]},{images:[{}]},{videos:1,videoPreviews:[{}]},{gates:{...observation.gates,text:false}},{gates:{...observation.gates,account:false}},{gates:{...observation.gates,safety:false}}])assert.equal(dynamicVerdict({...observation,...patch},state).status,'result_unknown');
 assert.equal(dynamicVerdict({...observation,gates:{...observation.gates,noBlockingDialog:false}},state).status,'needs_user');
 assert.equal(dynamicVerdict({...observation,errors:['Upload failed']},state).status,'failed');
 assert.equal(dynamicVerdict(observation,{...state,uploadAttempted:false}).status,'result_unknown');
 assert.equal(dynamicVerdict(observation,{...state,pkg:{...state.pkg,platform:'jike'}}).status,'result_unknown');
 assert.equal(dynamicVerdict({...observation,gates:{...observation.gates,media:true}},state).ready,false);
 assert.equal(dynamicVerdict({...observation,images:[],videos:1,videoPreviews:[{}],gates:{...observation.gates,media:true,upload:true}},state).status,'draft_verified');
});


test('Handed-back dynamic drafts still pass local resume checks and skip completed preparation, while mutation and identity changes stop', {skip:process.platform!=='darwin'}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-dynamic-handoff-check-'));
 try{
  const image=path.join(dir,'one.png'),packagePath=path.join(dir,'package.json'),root=path.join(dir,'jobs');
  fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
  const raw={type:'dynamic',text:'Confirmed body',images:[image]};fs.writeFileSync(packagePath,JSON.stringify(raw));
  const jobId='request-x',jobDir=path.join(root,jobId),statePath=path.join(jobDir,'state.json');
  fs.mkdirSync(jobDir,{recursive:true});const pkg=normalizeDynamic(raw,dir,'x'),assets=await materializeImages(pkg,path.join(jobDir,'assets'));
  const state={jobId,pkg,assets,inputFingerprint:sha256(JSON.stringify(pkg)),fingerprint:sha256(JSON.stringify({pkg,media:assets.map(a=>a.sha256)})),taskSpaceId:40,taskSpaceName:'original',uploadAttempted:true,handoff:{status:'review_handed_off'}};
  const original=JSON.stringify(state);fs.writeFileSync(statePath,original);
  const invoke=(command,platform='x',id=jobId)=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/dynamic.mjs',import.meta.url)),command,'--package',packagePath,'--platform',platform,'--job-id',id,'--state-root',root,...(command==='handoff'?['--confirm-manual-send']:[])],{encoding:'utf8',env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:'/nonexistent-browser',VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks')}});
  const checked=invoke('check');assert.equal(checked.status,0,checked.stderr);assert.equal(JSON.parse(checked.stdout).status,'input_checked');assert.equal(fs.readFileSync(statePath,'utf8'),original);
  for(const command of ['prepare','inspect','handoff']){const result=invoke(command);assert.notEqual(result.status,0,command);assert.match(result.stdout+result.stderr,/Already handed off/);assert.deepEqual(JSON.parse(fs.readFileSync(statePath)).handoff,state.handoff);}
  fs.writeFileSync(statePath,original);
  const plan=request(['run','--package',packagePath,'--platforms','x,weibo','--job-id','request','--state-root',root,'--resume-control'],raw);
  plan.previousResults={x:{jobId,configurationComplete:true,handedOff:true,status:'configured',taskSpaceId:40}};const preparations=[];
  const results=await execute(plan,async(job,phase)=>{if(phase==='check'){const r=invoke('check',job.platform,job.jobId);return {code:r.status,stdout:r.stdout,stderr:r.stderr};}preparations.push(job.platform);return {code:0,stdout:JSON.stringify({status:'configured',configurationComplete:true,finalPublishClicked:false,taskSpaceId:40})};});
  assert.deepEqual(preparations,['weibo']);assert.equal(results.x.skipped,true);assert.equal(results.weibo.configurationComplete,true);assert.equal(fs.readFileSync(statePath,'utf8'),original);
  for(const changed of [{...state,pkg:{...pkg,text:'changed'}},{...state,fingerprint:'changed'}]){fs.writeFileSync(statePath,JSON.stringify(changed));assert.notEqual(invoke('check').status,0);}
  fs.writeFileSync(statePath,original);fs.appendFileSync(image,'changed');const changedMedia=invoke('check');assert.notEqual(changedMedia.status,0);assert.match(changedMedia.stdout+changedMedia.stderr,/changed|size|bytes|fingerprint/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
