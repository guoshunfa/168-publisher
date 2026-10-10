import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {request,execute} from '../scripts/publisher.mjs';
import {normalizeDynamic,sha256} from '../scripts/dynamic-input.mjs';
import {run} from '../scripts/runtime.mjs';

// Execute the maintained CLI and its space-selection scripts; only platform observations are simulated.
test('Real dynamic action CLI reports blockers immediately and explicit retry reuses original media without polling',{skip:process.platform!=='darwin'},async()=>{
 for(const mode of ['before-upload','after-upload','attempted','captcha','login','identity','profile','control','unknown','persistent']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'168-rate-recovery-'));
  try{
   const local=path.join(dir,'one.png'),packagePath=path.join(dir,'package.json'),root=path.join(dir,'jobs');
   const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');fs.writeFileSync(local,bytes);
   const raw={type:'dynamic',text:'confirmed',images:[local]},pkg=normalizeDynamic(raw,dir,'jike');fs.writeFileSync(packagePath,JSON.stringify(raw));
   const assets=[{source:local,path:local,size:bytes.length,sha256:sha256(bytes),width:1,height:1,format:'png'}];
   const statePath=path.join(root,'case/state.json');fs.mkdirSync(path.dirname(statePath),{recursive:true});
   fs.writeFileSync(statePath,JSON.stringify({jobId:'case',pkg,assets,inputFingerprint:sha256(JSON.stringify(pkg)),fingerprint:sha256(JSON.stringify({pkg,media:assets.map(a=>a.sha256)})),taskSpaceId:40,taskSpaceName:'original',pageLabel:'p2',profile:'fixture-main',account:'account',uploadAttempted:['attempted','unknown'].includes(mode),cleanupComplete:true}));
   const fixturePath=path.join(dir,'fixture.json'),mock=path.join(dir,'fake-ego.mjs');
   const put=f=>fs.writeFileSync(fixturePath,JSON.stringify(f)),get=()=>JSON.parse(fs.readFileSync(fixturePath));
   put({phase:mode==='after-upload'?'ready':['captcha','login','unknown'].includes(mode)?mode:'rate',media:['attempted','unknown'].includes(mode),text:['attempted','unknown'].includes(mode),uploads:0,mutations:0,reads:0,afterUpload:mode==='after-upload',controlBetween:mode==='control-between',profile:mode==='profile'?'foreign':'fixture-main',ownership:mode==='control'?'user':'agent',name:mode==='identity'?'foreign':'original'});
   fs.writeFileSync(mock,`#!${process.execPath}
import fs from 'node:fs';import vm from 'node:vm';
let body='';for await(const c of process.stdin)body+=c;
const file=${JSON.stringify(fixturePath)},f=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(f));
const observation=()=>{f.reads++;if(f.controlBetween&&f.phase==='ready')f.ownership='user';save();const rate=f.phase==='rate',upload=f.media&&f.phase!=='pending',gates={authenticated:f.phase!=='login',account:true,composer:true,text:f.text,media:f.media&&f.phase!=='unknown',upload:upload&&f.text,noBlockingDialog:!rate&&f.phase!=='captcha',safety:true};return {observedAt:new Date().toISOString(),account:'account',text:f.text?'confirmed':'',editorText:f.text?'confirmed':'',images:[],videos:0,videoPreviews:[],files:f.media?[{}]:[],native:{ids:f.media?['native']:[]},rateLimited:rate,uploadComplete:upload,gates,finalPublishClicked:false};};
const page={cdp:async()=>{},evaluate:async fn=>fn.name==='observeJike'?observation():fn.name==='armGuard'?{armed:true}:false,waitForFunction:async()=>{},setInputFiles:async()=>{f.uploads++;f.mutations++;f.media=true;if(f.afterUpload)f.phase='rate';save();},focus:async()=>{f.mutations++;save();},keyboard:{press:async()=>{},paste:async()=>{f.text=true;save();}}};
const task={spaceId:40,name:f.name,tabs:async()=>[{label:'p1'},{label:'p2'}],page:label=>{if(label!=='p2')throw new Error('Wrong page');return page;}};
const context={console,profiles:async()=>[{name:f.profile,isDefault:true}],listTaskSpaces:async()=>[{id:40,name:f.name,profileName:f.profile,ownership:f.ownership}],taskSpace:async()=>task};
await vm.runInNewContext('(async()=>{'+body+'})()',context);
`,{mode:0o700});
   const plan=request(['run','--package',packagePath,'--platform','jike','--profile','fixture-main','--job-id','case','--state-root',root,'--wait-timeout','45'],raw);
   if(mode==='control-between')plan.flags.add('--resume-control');
   const calls=[];
   const invoke=async(job,phase,args)=>{calls.push(phase);return run(process.execPath,[fileURLToPath(new URL('../scripts/dynamic.mjs',import.meta.url)),...args],{env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:mock,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks')}});};
   const first=await execute(plan,invoke,()=>assert.fail('No background polling'));
   assert.deepEqual(calls,['check','prepare']);
   const success=['before-upload','after-upload','attempted'].includes(mode);
   assert.equal(first.jike.configurationComplete,false);
   if(success){const f=get();f.phase='ready';f.afterUpload=false;put(f);const resumed=await execute(plan,invoke,()=>assert.fail('No background polling'));assert.equal(resumed.jike.status,'configured',mode);}
   else assert.equal(first.jike.status,mode==='login'?'needs_login':['captcha','control','persistent'].includes(mode)?'needs_user':'result_unknown',mode);
   const f=get();
   assert.equal(f.uploads,['before-upload','after-upload'].includes(mode)?1:0,mode);
   if(!success)assert.equal(f.mutations,0,mode);
   assert.ok(!calls.includes('inspect'));
   const state=JSON.parse(fs.readFileSync(statePath));assert.equal(state.taskSpaceId,40);assert.equal(state.pageLabel,'p2');assert.equal(state.inputFingerprint,sha256(JSON.stringify(pkg)));assert.equal(state.handoff,undefined);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});
