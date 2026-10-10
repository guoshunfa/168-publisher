import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from '../scripts/runtime.mjs';
import {request,runFingerprint} from '../scripts/publisher.mjs';

const publisher=fileURLToPath(new URL('../scripts/publisher.mjs',import.meta.url));
test('Existing jobs with or without an older run session restore original page bindings without creating tabs',{skip:process.platform!=='darwin'},async()=>{
 for(const existingSession of [false,true]){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-old-run-'));
  try{
   const packagePath=path.join(directory,'package.json'),root=path.join(directory,'jobs'),fixturePath=path.join(directory,'fixture.json'),child=path.join(directory,'entry.mjs'),ego=path.join(directory,'ego.mjs'),runner=path.join(directory,'runner.mjs');
   const raw={type:'dynamic',text:'original'},argv=['run','--package',packagePath,'--platforms','x,weibo','--job-id','case','--state-root',root];
   fs.writeFileSync(packagePath,JSON.stringify(raw));
   const plan=request(argv,raw);
   for(const [index,job] of plan.jobs.entries()){
    const jobDir=path.join(root,job.jobId);fs.mkdirSync(jobDir,{recursive:true});
    fs.writeFileSync(path.join(jobDir,'state.json'),JSON.stringify({taskSpaceId:65,taskSpaceName:'original',pageLabel:'p'+(index+2)}));
   }
   if(existingSession){fs.mkdirSync(path.join(root,'.runs'),{recursive:true});fs.writeFileSync(path.join(root,'.runs','case.json'),JSON.stringify({fingerprint:runFingerprint(plan,raw),taskSpaceId:65,name:'original',profile:''}));}
   fs.writeFileSync(fixturePath,JSON.stringify({handOffs:0,pages:['p2','p3']}));
   fs.writeFileSync(child,`import fs from 'node:fs';const args=process.argv.slice(2);if(args[0]==='check')console.log(JSON.stringify({status:'input_checked'}));else{const platform=args[args.indexOf('--platform')+1],label=args[args.indexOf('--page-label')+1];if(label!==(platform==='x'?'p2':'p3'))throw new Error('Wrong original page');if(!args.includes('--actions-only'))throw new Error('Wrong preparation mode');console.log(JSON.stringify({status:'configured',configurationComplete:true,taskSpaceId:65,finalPublishClicked:false}));}`);
   fs.writeFileSync(ego,`#!${process.execPath}\nimport fs from 'node:fs';import vm from 'node:vm';let body='';for await(const c of process.stdin)body+=c;const file=${JSON.stringify(fixturePath)},fixture=JSON.parse(fs.readFileSync(file)),task={spaceId:65,name:'original',tabs:async()=>fixture.pages.map(label=>({label,url:'https://example.com'})),page:label=>{if(!fixture.pages.includes(label))throw new Error('Wrong page');return {evaluate:async()=>[],goto:async()=>{throw new Error('Original page navigated');}};},newPage:async()=>{throw new Error('Duplicate page');},handOff:async()=>{fixture.handOffs++;fs.writeFileSync(file,JSON.stringify(fixture));}};await vm.runInNewContext('(async()=>{'+body+'})()',{console,listTaskSpaces:async()=>[{id:65,name:'original',ownership:'agent'}],taskSpace:async()=>task});`,{mode:0o700});
   fs.writeFileSync(runner,`import {main} from ${JSON.stringify(publisher)};await main(${JSON.stringify(argv)},{registry:{dynamic:{platforms:['x','weibo'],entry:${JSON.stringify(child)},actionPreparation:true,urls:{x:'https://x.com',weibo:'https://weibo.com'}}}});`);
   const output=await run(process.execPath,[runner],{env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:ego,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(directory,'locks')}});
   assert.equal(output.code,0,output.stderr);assert.equal(JSON.parse(output.stdout).status,'configured');
   const session=JSON.parse(fs.readFileSync(path.join(root,'.runs/case.json')));assert.deepEqual(session.pages,{x:'p2',weibo:'p3'});
   assert.equal(JSON.parse(fs.readFileSync(fixturePath)).handOffs,1);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
});

test('First-stage audit reports incomplete content and still creates all login pages, then enriched input reuses that space',{skip:process.platform!=='darwin'},async()=>{
 for(const failure of [false,true,'creation']){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-login-stage-'));
 try{
  const packagePath=path.join(directory,'package.json'),root=path.join(directory,'jobs'),fixturePath=path.join(directory,'fixture.json'),child=path.join(directory,'entry.mjs'),ego=path.join(directory,'ego.mjs'),runner=path.join(directory,'runner.mjs');
  fs.writeFileSync(packagePath,JSON.stringify({type:'video'}));fs.writeFileSync(fixturePath,JSON.stringify({pages:['p1'],urls:{p1:'about:blank'},calls:[],handOffs:0,creates:0,failNavigation:failure===true,failEvaluation:failure===true,failCreation:failure==='creation'}));
  fs.writeFileSync(child,`import fs from 'node:fs';const args=process.argv.slice(2),file=${JSON.stringify(fixturePath)},fixture=JSON.parse(fs.readFileSync(file));fixture.calls.push(args[0]);fs.writeFileSync(file,JSON.stringify(fixture));if(args[0]==='check'){const pkg=JSON.parse(fs.readFileSync(args[2]));if(!pkg.youtubeAudience)throw new Error('Full input missing');console.log(JSON.stringify({ok:true,platform:args[1]}));}else console.log(JSON.stringify({status:'configured',configurationComplete:true,taskSpaceId:65,finalPublishClicked:false}));`);
  fs.writeFileSync(ego,`#!${process.execPath}\nimport fs from 'node:fs';import vm from 'node:vm';let body='';for await(const c of process.stdin)body+=c;const file=${JSON.stringify(fixturePath)},f=JSON.parse(fs.readFileSync(file));const save=()=>fs.writeFileSync(file,JSON.stringify(f));const page=label=>({label,goto:async url=>{if(f.failNavigation&&url.includes('bilibili'))throw Error('navigation failed');f.urls[label]=url;save();},waitForFunction:async()=>{},evaluate:async fn=>{if(fn.toString().includes('const roots=')){if(f.failEvaluation&&label==='p2')throw Error('page read failed');return {status:label==='p1'?'needs_login':'login_checked'};}return [];}});const task={spaceId:65,get name(){return f.name},tabs:async()=>f.pages.map(label=>({label,url:f.urls[label]})),page,newPage:async()=>{const label='p'+(f.pages.length+1);f.pages.push(label);f.urls[label]='about:blank';f.creates++;save();if(f.failCreation)throw Error('page creation reply missing');return {...page(label),label};},handOff:async()=>{f.ownership='user';f.handOffs++;save();}};const taskSpace=async id=>{if(typeof id==='string'&&!f.name){f.name=id;f.ownership='agent';save();}return task;};await vm.runInNewContext('(async()=>{'+body+'})()',{console,listTaskSpaces:async()=>f.name?[{id:65,name:f.name,ownership:f.ownership}]:[],taskSpace,takeOverTaskSpace:async()=>{f.ownership='agent';save();return task;}});`,{mode:0o700});
  const registry={video:{platforms:['bilibili','youtube'],entry:child,actionPreparation:true,urls:{bilibili:'https://member.bilibili.com/platform/upload',youtube:'https://studio.youtube.com/'}}};
  const runStage=async(command,flags=[])=>{
   const argv=[command,'--package',packagePath,'--platforms','bilibili,youtube','--job-id','case','--state-root',root,...flags];
   fs.writeFileSync(runner,`import {main} from ${JSON.stringify(publisher)};await main(${JSON.stringify(argv)},{registry:${JSON.stringify(registry)}});`);
   return run(process.execPath,[runner],{env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:ego,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(directory,'locks')}});
  };
  const login=await runStage('preflight');assert.equal(login.code,0,login.stderr);const loginReport=JSON.parse(login.stdout);assert.equal(loginReport.status,failure?'needs_user':'needs_login');if(failure==='creation'){assert.equal(JSON.parse(fs.readFileSync(fixturePath)).handOffs,1);const repeat=await runStage('preflight',['--resume-control']);assert.equal(JSON.parse(repeat.stdout).status,'needs_user');assert.match(JSON.parse(repeat.stdout).platforms.bilibili.reason,/page creation|precreation|pre-creation/i);assert.equal(JSON.parse(fs.readFileSync(fixturePath)).creates,1);continue;}if(failure){assert.match(loginReport.platforms.bilibili.reason,/navigation failed/);assert.match(loginReport.platforms.youtube.reason,/page read failed/);}assert.equal(loginReport.platforms.bilibili.jobId,'case-bilibili');
  const first=JSON.parse(fs.readFileSync(fixturePath));assert.deepEqual(first.calls,['check','check']);assert.equal(loginReport.contentStatus,'needs_input');assert.equal(loginReport.contentErrors.length,2);assert.equal(first.pages.length,2);assert.equal(first.creates,1);assert.equal(first.handOffs,1);
  const sessionBefore=fs.readFileSync(path.join(root,'.runs/case.json'),'utf8');const unauthorized=await runStage('preflight');assert.equal(JSON.parse(unauthorized.stdout).status,'result_unknown');assert.equal(fs.readFileSync(path.join(root,'.runs/case.json'),'utf8'),sessionBefore);assert.equal(JSON.parse(fs.readFileSync(fixturePath)).handOffs,1);
  first.failNavigation=false;first.failEvaluation=false;fs.writeFileSync(fixturePath,JSON.stringify(first));
  fs.writeFileSync(packagePath,JSON.stringify({type:'video',youtubeAudience:'not_made_for_kids'}));
  const resumed=await runStage('run',['--resume-control']);assert.equal(resumed.code,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).status,'configured');
  const after=JSON.parse(fs.readFileSync(fixturePath));assert.equal(after.creates,1);assert.equal(after.handOffs,2);assert.deepEqual(after.calls,['check','check','check','check','prepare','prepare']);
  const session=JSON.parse(fs.readFileSync(path.join(root,'.runs/case.json')));assert.equal(session.taskSpaceId,65);assert.equal(session.completed,true);assert.ok(session.fingerprint);assert.deepEqual(session.pages,{bilibili:'p1',youtube:'p2'});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
});
