import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {entries} from '../scripts/registry.mjs';
import {run} from '../scripts/runtime.mjs';

test('Automatic timeout or user takeover resumes the same dynamic or video with fresh inspection and no repeated preparation',{skip:process.platform!=='darwin'},async()=>{
 for(const interruption of ['takeover','timeout'])for(const type of ['dynamic','video']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-auto-resume-'));
  try{
   const fixture=path.join(dir,'fixture.json'),input=path.join(dir,'input.txt'),child=path.join(dir,'child.mjs'),ego=path.join(dir,'ego.mjs'),runner=path.join(dir,'runner.mjs'),configFile=path.join(dir,'settings.json');
   const platform=type==='dynamic'?'x':'youtube',stateRoot=path.join(dir,type+'-jobs'),jobDir=path.join(stateRoot,'resume');
   fs.writeFileSync(fixture,JSON.stringify({calls:[],prepares:0,clicks:0,handoffs:0,takeovers:0,resume:false}));
   fs.writeFileSync(configFile,JSON.stringify({profile:'',platforms:{[type]:[platform]},waitTimeout:1}));
   fs.writeFileSync(input,`是否全自动：是\n类型：${type==='dynamic'?'动态':'视频'}\n标题：${type==='dynamic'?'无':'标题'}\n正文：我的安全验证经验\n标签：无\n媒体：/tmp/a.mp4\n平台：${type==='dynamic'?'X':'YouTube'}`);
   fs.writeFileSync(child,`import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2),file=${JSON.stringify(fixture)},f=JSON.parse(fs.readFileSync(file)),directory=${JSON.stringify(jobDir)},statePath=path.join(directory,'state.json');
f.calls.push(args[0]);
if(args[0]==='prepare'){
 f.prepares++;fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(statePath,JSON.stringify({taskSpaceId:65,taskSpaceName:f.name,pageLabel:'p1',pkg:{platform:${JSON.stringify(platform)}},assets:[],fingerprint:'fixture',effectivePackage:{videoPath:'/tmp/a.mp4',cover:{uploadCustomCover:false}},platforms:{${platform}:{taskSpaceId:65,taskSpaceName:f.name,pageLabel:'p1'}}}));
}
if(args[0]==='inspect'){
 const state=JSON.parse(fs.readFileSync(statePath)),controlPath=path.join(directory,'manual-control.json');
 const control=fs.existsSync(controlPath)?JSON.parse(fs.readFileSync(controlPath)):{};
 if(state.handoff||Object.keys(control.handoffs||{}).length)throw Error('Manual handoff marker prevents automatic recovery');
 if(!f.resume&&${interruption==='takeover'})f.ownership='user';
}
fs.writeFileSync(file,JSON.stringify(f));
console.log(JSON.stringify(args[0]==='check'?${type==='video'?"{ok:true,platform:'youtube'}":"{status:'input_checked'}"}:args[0]==='prepare'?{status:'configured',configurationComplete:true,finalPublishClicked:false}:f.resume?{status:'draft_verified',ready:true,finalPublishClicked:false}:${interruption==='takeover'?"{status:'needs_user',reason:'USER_CONTROL: user now controls',ready:false,finalPublishClicked:false}":"{status:'processing',ready:false,finalPublishClicked:false}"}));`);
   fs.writeFileSync(ego,`#!${process.execPath}
import fs from 'node:fs';import vm from 'node:vm';
let body='';for await(const chunk of process.stdin)body+=chunk;
const file=${JSON.stringify(fixture)},f=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(f));
if(body.includes('data-168-auto-publish')){
 if(f.ownership!=='agent')throw Error('USER_CONTROL');
 f.clicks++;save();console.log('168_PUBLISHER_RESULT:'+JSON.stringify({status:'published',finalPublishClicked:true,reason:'发布成功'}));
}else{
 const page={label:'p1',goto:async url=>{f.url=url;save();},waitForFunction:async()=>{},evaluate:async()=>({status:f.prepares?'needs_login':'login_checked'})};
 const task={spaceId:65,get name(){return f.name},tabs:async()=>[{label:'p1',url:f.url||'about:blank'}],page:()=>page,handOff:async()=>{f.handoffs++;f.ownership='user';save();}};
 await vm.runInNewContext('(async()=>{'+body+'})()',{console,taskSpace:async id=>{if(!f.name){f.name=id;f.ownership='agent';save();}return task;},listTaskSpaces:async()=>f.name?[{id:65,name:f.name,ownership:f.ownership}]:[],takeOverTaskSpace:async()=>{f.takeovers++;f.ownership='agent';save();return task;}});
}`,{mode:0o700});
   const registry={[type]:{...entries[type],platforms:[platform],entry:child}};
   fs.writeFileSync(runner,`import {main} from ${JSON.stringify(new URL('../scripts/publisher.mjs',import.meta.url).href)};await main(process.argv.slice(2),${JSON.stringify({stateHome:dir,configFile,registry})});`);
   const env={...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:ego,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks'),PUBLISHER_VIDEO_CONFIG:path.join(dir,'video.json')};
   fs.writeFileSync(env.PUBLISHER_VIDEO_CONFIG,JSON.stringify({declarations:{originalityPolicy:'all_videos_original'}}));
   const initial=await run(process.execPath,[runner,'preflight','--input',input,'--job-id','resume'],{env});
   assert.equal(initial.code,10,initial.stderr);
   const report=JSON.parse(fs.readFileSync(path.join(jobDir,'run-report.json')));
   assert.equal(report.platforms[platform].configurationComplete,true);
   assert.equal(report.platforms[platform].status,'needs_user');
   assert.match(report.platforms[platform].reason,interruption==='takeover'?/USER_CONTROL/:/超时/);
   const first=JSON.parse(fs.readFileSync(fixture));
   assert.equal(first.prepares,1);assert.equal(first.clicks,0);assert.equal(first.handoffs,interruption==='takeover'?0:1);assert.equal(first.takeovers,0);
   const state=JSON.parse(fs.readFileSync(path.join(jobDir,'state.json')));
   assert.equal(state.handoff,undefined);assert.equal(fs.existsSync(path.join(jobDir,'manual-control.json')),false);
   fs.writeFileSync(fixture,JSON.stringify({...first,resume:true}));
   const resumed=await run(process.execPath,[runner,'run','--job-id','resume','--resume-control'],{env});
   assert.equal(resumed.code,0,resumed.stderr);
   const last=JSON.parse(fs.readFileSync(fixture));
   assert.equal(last.prepares,1);assert.equal(last.clicks,1);assert.equal(last.handoffs,first.handoffs+1);assert.equal(last.takeovers,1);
   assert.deepEqual(last.calls.slice(first.calls.length),['check','inspect']);
   assert.match(resumed.stdout,/平台已确认发布/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});
