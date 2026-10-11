import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {parseTemplate,expandRequest} from '../scripts/input.mjs';
import {entries} from '../scripts/registry.mjs';
import {autoPublish,publishOnce,waitUntilReady,selectPublishButton,clickPublishButton,publicationFeedback,publicationScript} from '../scripts/auto-publish.mjs';
import {execute,request} from '../scripts/publisher.mjs';
import {run} from '../scripts/runtime.mjs';
const settings={profile:'',platforms:{video:['youtube'],dynamic:['x']},waitTimeout:1};
const template=type=>`类型：${type}\n标题：标题\n正文：原文\n标签：无\n媒体：/tmp/media.mp4\n平台：${type==='视频'?'YouTube':'小红书'}`;

test('Both types default to manual; only explicit yes enables automatic publishing',()=>{
 for(const type of ['视频','动态']){
  assert.equal(parseTemplate(template(type),settings,entries).autoPublish,false);
  assert.equal(parseTemplate('是否全自动：否\n'+template(type),settings,entries).autoPublish,false);
  assert.equal(parseTemplate('是否全自动：是\n'+template(type),settings,entries).autoPublish,true);
  for(const value of ['','true','随便','是\n是否全自动：否'])assert.ok(parseTemplate('是否全自动：'+value+'\n'+template(type),settings,entries).errors.length);
 }
});
test('Saved mode survives continuation and cannot change after configuration starts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-auto-input-'));
 try{
  const input=path.join(dir,'input'),configFile=path.join(dir,'settings.json');fs.writeFileSync(configFile,JSON.stringify(settings));
  fs.writeFileSync(input,'是否全自动：是\n'+template('动态'));
  const options={stateHome:dir,configFile,registry:entries};
  const initial=expandRequest(['preflight','--input',input,'--job-id','automatic'],options);initial.release();
  const resumed=expandRequest(['run','--job-id','automatic'],options);assert.equal(resumed.context.autoPublish,true);
  fs.writeFileSync(resumed.context.requestPath,JSON.stringify({...resumed.context,locked:true}));resumed.release();
  fs.writeFileSync(input,'是否全自动：否\n'+template('动态'));
  assert.throws(()=>expandRequest(['preflight','--input',input,'--job-id','automatic'],options),/不可改包/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Lost replies and completed publications are never sent twice',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-once-'));let calls=0;
 try{
  for(const failure of [true,false]){
   const file=path.join(dir,String(failure)+'.json');
   const action=async()=>{calls++;assert.equal(JSON.parse(fs.readFileSync(file)).finalPublishClicked,null);if(failure)throw Error('reply lost');return {status:'published',finalPublishClicked:true,reason:'发布成功'};};
   const first=await publishOnce(file,action),second=await publishOnce(file,action);
   assert.deepEqual(first,second);assert.equal(first.status,failure?'result_unknown':'published');
  }
  assert.equal(calls,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Only processing is polled; blockers stop and waiting has a deadline',async()=>{
 let time=0,calls=0;
 const result=await waitUntilReady(async()=>({status:++calls<3?'processing':'draft_verified',ready:calls===3}),{timeout:60,now:()=>time,sleep:async ms=>{time+=ms;}});
 assert.equal(result.ready,true);assert.equal(calls,3);
 for(const status of ['needs_login','needs_user','failed','result_unknown']){calls=0;assert.equal((await waitUntilReady(async()=>{calls++;return {status};})).status,status);assert.equal(calls,1);}
 time=0;const timed=await waitUntilReady(async()=>({status:'processing'}),{timeout:1,now:()=>time,sleep:async ms=>{time+=ms;}});assert.equal(timed.status,'needs_user');assert.equal(time,1000);
});
test('Final button requires a unique enabled target, clean guard and correct fingerprint',()=>{
 for(const problem of ['none','missing','duplicate','disabled','dirty','changed']){
  let released=0,marked=0;
  const button={innerText:'发送',className:'',disabled:problem==='disabled',getBoundingClientRect:()=>({width:80,height:32}),getAttribute:()=>null,setAttribute:()=>{marked++;},contains:()=>false};
  const guard={armed:true,fingerprint:problem==='changed'?'other':'expected',blockedAttempts:problem==='dirty'?[{}]:[],release(){released++;this.armed=false;return {ok:true};}};
  const buttons=problem==='missing'?[]:problem==='duplicate'?[button,{...button}]:[button];
  const context={document:{querySelectorAll:selector=>selector==='*'?[]:buttons},window:{guard},getComputedStyle:()=>({visibility:'visible',display:'block'})};
  const action=()=>vm.runInNewContext(`(${selectPublishButton.toString()})({type:'dynamic',platform:'weibo',guardKey:'guard',fingerprint:'expected'})`,context);
  if(problem==='none'){assert.equal(action().ready,true);assert.equal(released,1);assert.equal(marked,1);}else{assert.throws(action);assert.equal(released,0);assert.equal(marked,0);}
 }
});
test('Only platform feedback confirms success, not author text or an arbitrary URL change',()=>{
 const success={innerText:'发布成功',getBoundingClientRect:()=>({width:50,height:50})};
 for(const toast of [false,true]){
  const result=vm.runInNewContext(`(${publicationFeedback.toString()})()`,{document:{body:{innerText:'发布成功'},querySelectorAll:selector=>toast&&selector.includes('[role="alert"]')?[success]:[]},getComputedStyle:()=>({visibility:'visible'})});
  assert.equal(result.success,toast?'发布成功':undefined);
 }
});
test('X retries only an undispatched intercepted click with unchanged content and button',async()=>{
 for(const mode of ['normal','overlay','dispatched','lostReply','changedContent','changedButton','disabled','hidden','userControl','otherPlatform']){
  const listeners=new Set();let sends=0,nativeClicks=0,rechecks=0;
  const button={isConnected:true,disabled:false,getAttribute:()=>null,getBoundingClientRect:()=>({width:60,height:32}),click(){
   for(const fn of [...listeners])fn({composedPath:()=>[button]});sends++;
  }};
  let buttons=[button];
  const window={__168_PUBLISHER_X__:{armed:false,blockedAttempts:[]},addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)};
  const context=vm.createContext({window,document:{querySelectorAll:()=>buttons},getComputedStyle:()=>({display:mode==='hidden'?'none':'block',visibility:'visible'})});
  const page={evaluate:(fn,arg)=>{context.arg=arg;return vm.runInContext(`(${fn.toString()})(arg)`,context);},click:async()=>{
   nativeClicks++;
   if(mode==='normal'){button.click();return;}
   if(['dispatched','lostReply'].includes(mode))button.click();
   if(mode==='disabled')button.disabled=true;
   if(mode==='changedButton')buttons=[{...button}];
   throw Error(mode==='lostReply'?'reply lost':mode==='userControl'?'USER_CONTROL':'<div> intercepts pointer events');
  }};
  const action=()=>clickPublishButton(page,mode==='otherPlatform'?'weibo':'x',async()=>{rechecks++;if(mode==='changedContent')throw Error('content changed');});
  if(['normal','overlay'].includes(mode))await action();else await assert.rejects(action,undefined,mode);
  assert.equal(nativeClicks,1,mode);assert.equal(sends,['normal','overlay','dispatched','lostReply'].includes(mode)?1:0,mode);
  if(['normal','lostReply','userControl','otherPlatform'].includes(mode))assert.equal(rechecks,0,mode);
 }
});
test('Chinese X sent toast and the dedicated XHS success page confirm publication',()=>{
 const toast={innerText:'你的帖子已发送。你有 1 小时时间进行任何编辑。',getBoundingClientRect:()=>({width:50,height:50})};
 const run=(platform,pathname,body,hasEditor=false)=>vm.runInNewContext(`(${publicationFeedback.toString()})(${JSON.stringify(platform)})`,{
  location:{hostname:'creator.xiaohongshu.com',pathname},document:{body:{innerText:body},querySelector:()=>hasEditor?{}:null,querySelectorAll:selector=>platform==='x'&&selector.includes('[role="alert"]')?[toast]:[]},getComputedStyle:()=>({visibility:'visible'})});
 assert.match(run('x','/home','').success,/你的帖子已发送/);
 assert.equal(run('xiaohongshu','/publish/success','创作平台\n发布成功\n立即返回').success,'发布成功');
 for(const [pathname,body,editor] of [['/publish/publish','发布成功',false],['/publish/success','我的正文发布成功',false],['/publish/success','发布成功',true]])assert.equal(run('xiaohongshu',pathname,body,editor).success,undefined);
});
test('Previously attempted automatic publications skip prepare even after partial runs',async()=>{
 const plan=request(['run','--package','/tmp/a.json','--platforms','x,weibo'],{type:'dynamic'});plan.autoPublish=true;plan.publications={x:{status:'result_unknown',finalPublishClicked:null}};
 const calls=[];
 const result=await execute(plan,async(job,phase)=>{calls.push(job.platform+':'+phase);return {code:0,stdout:JSON.stringify(phase==='check'?{status:'input_checked'}:{status:'configured',configurationComplete:true,finalPublishClicked:false})};});
 assert.equal(result.x.status,'result_unknown');assert.ok(!calls.includes('x:prepare'));assert.ok(calls.includes('weibo:prepare'));
});

test('User takeover stops automatic inspection of every later platform',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-auto-control-'));
 try{
  for(const control of [{error:'USER_CONTROL: resume required'},{reason:'user now controls the space'},{blocker:'USER_CONTROL'},{blocker:{code:'USER_CONTROL',message:'resume required'}}])for(const duringInspection of [false,true]){
   const jobs=[{platform:'x',jobId:'x'},{platform:'weibo',jobId:'weibo'}],calls=[];
   const results={x:{configurationComplete:true,...(duringInspection?{}:control)},weibo:{configurationComplete:true}};
   await autoPublish({autoPublish:true,jobs},results,{raw:{text:'fixture'},stateRoot:dir,inspect:async job=>{calls.push(job.platform);return {ready:false,status:'needs_user',...control};}});
   assert.deepEqual(calls,duringInspection?['x']:[]);
   assert.deepEqual(results.weibo,{configurationComplete:true});
   assert.deepEqual(fs.readdirSync(dir),[]);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Inspection blockers and wait timeouts preserve completed configuration for resume',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-auto-configured-'));
 try{
  for(const status of ['processing','needs_user','needs_login','failed','result_unknown']){
   const job={platform:'x',jobId:'configured-x'},results={x:{jobId:job.jobId,configurationComplete:true}};let inspections=0;
   await autoPublish({autoPublish:true,jobs:[job]},results,{raw:{text:'fixture'},stateRoot:dir,timeout:0,inspect:async()=>{inspections++;return {ready:false,status,configurationComplete:false};}});
   assert.equal(inspections,1);assert.equal(results.x.jobId,job.jobId);assert.equal(results.x.configurationComplete,true);
   assert.equal(results.x.status,status==='processing'?'needs_user':status);assert.equal(results.x.ready,false);
   const plan=request(['run','--package','/tmp/a.json','--platform','x','--job-id',job.jobId],{type:'dynamic'});plan.autoPublish=true;plan.previousResults=results;
   const calls=[];
   const resumed=await execute(plan,async(_job,phase)=>{calls.push(phase);return {code:0,stdout:JSON.stringify({status:'input_checked'})};});
   assert.deepEqual(calls,['check']);assert.equal(resumed.x.configurationComplete,true);assert.equal(resumed.x.skipped,true);
   assert.deepEqual(fs.readdirSync(dir),[]);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Generated video publication executes complete observation gates before releasing or clicking',async()=>{
 for(const mode of ['ready','dirtyGuard','changedContent']){
  let clicks=0,inspections=0;const logs=[],attributes={};
  const button={innerText:'发布',textContent:'发布',tagName:'BUTTON',className:'',disabled:false,
   getBoundingClientRect:()=>({width:80,height:32}),getAttribute:key=>attributes[key]??null,setAttribute:(key,value)=>{attributes[key]=value;},matches:selector=>selector!=='xhs-publish-btn',contains:()=>false};
  const toast={innerText:'发布成功',getBoundingClientRect:()=>({width:80,height:32})};
  const guard={armed:true,version:1,closedFooterProtected:true,blockedAttempts:mode==='dirtyGuard'?[{type:'click'}]:[],releaseForConfirmedPublish(){if(!this.armed||this.blockedAttempts.length)return {ok:false};this.armed=false;return {ok:true};}};
  const browser=vm.createContext({window:{__VIDEO_PUBLISHER_FINAL_GUARD__:guard},getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{
   querySelectorAll:selector=>selector==='*'?[]:selector.includes('[role="alert"]')?(clicks?[toast]:[]):selector.includes('[role="dialog"]')?[]:[button],
  }});
  const page={evaluate:async(fn,arg)=>{browser.arg=arg;return vm.runInContext(`(${fn.toString()})(arg)`,browser);},click:async selector=>{
   assert.equal(selector,'[data-168-auto-publish="target"]');assert.equal(attributes['data-168-auto-publish'],'target');assert.equal(guard.armed,false);clicks++;
  }};
  const tab={label:'p1',targetId:'p1',url:'https://creator.douyin.com/creator-micro/content/upload'};
  const task={spaceId:65,id:65,name:'fixture',tabs:async()=>[tab],page:()=>page};
  const state={packagePath:'/tmp/package.json',fingerprint:'fixture',effectivePackage:{videoPath:'/tmp/a.mp4',platformTitle:{douyin:'标题'},douyinDescription:'正文',douyinTopics:[],cover:{uploadCustomCover:false}},platforms:{douyin:{taskSpaceId:65,taskSpaceName:'fixture',pageLabel:'p1'}}};
  const source=publicationScript('video','douyin',state,'/tmp/state.json');
  const api={fs,path,listTaskSpaces:async()=>[{id:65,name:'fixture',ownership:'agent'}],taskSpace:async()=>task,useOrCreateTaskSpace:async()=>task,
   listTabs:async()=>[tab],switchTab:async()=>{},pageInfo:async()=>({w:1200,h:800}),cliLog:line=>logs.push(line),console:{log:line=>logs.push(line)},
   js:async script=>{
    if(script.startsWith('((expectedTitle, expectedDescription, requestedTopics) =>')){
     inspections++;
     return {title:mode==='changedContent'&&inspections===2?'changed':'标题',prose:'正文',selected:[],plainResidue:[],duplicates:[],tokenCounts:{},uploadSucceeded:true,uploading:false,uploadFailed:false,loginRequired:false,identityMatches:true,noSyncChecked:true,syncOn:false,simultaneousChecked:false,coverUrls:{landscape:['blob:cover'],portrait:[]},dialogs:[]};
    }
    return vm.runInContext(script,browser);
   },
  };
  // Only replace Node imports with supplied modules; execute the generated inspectors and publication flow unchanged.
  const execute=new (Object.getPrototypeOf(async function(){}).constructor)(...Object.keys(api),source.replace(/^import fs from "node:fs"; import path from "node:path";\n/,''));
  if(mode==='ready')await execute(...Object.values(api));else await assert.rejects(execute(...Object.values(api)),/发布前内容或上传状态改变/);
  assert.equal(inspections,2);assert.equal(clicks,mode==='ready'?1:0);assert.equal(guard.armed,mode!=='ready');
  const observations=logs.filter(line=>line.startsWith('VIDEO_PUBLISHER_V2_RESULT:')).map(line=>JSON.parse(line.slice('VIDEO_PUBLISHER_V2_RESULT:'.length)));
  assert.equal(observations.length,2);assert.equal(observations.at(-1).gates.safety.ok,mode!=='dirtyGuard');
  const receipts=logs.filter(line=>line.startsWith('168_PUBLISHER_RESULT:')).map(line=>JSON.parse(line.slice('168_PUBLISHER_RESULT:'.length)));
  assert.deepEqual(receipts,mode==='ready'?[{status:'published',finalPublishClicked:true,reason:'发布成功'}]:[]);
 }
});

test('Automatic preflight proceeds through configure, inspect and publish without a manual handoff; login blocks all writes',{skip:process.platform!=='darwin'},async()=>{
 for(const type of ['dynamic','video'])for(const loggedIn of [true,false]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-auto-flow-'));
  try{
   const fixture=path.join(dir,'fixture.json'),input=path.join(dir,'input'),child=path.join(dir,'entry.mjs'),ego=path.join(dir,'ego.mjs'),runner=path.join(dir,'runner.mjs'),configFile=path.join(dir,'settings.json');
   fs.writeFileSync(fixture,JSON.stringify({calls:[],clicks:0,handoffs:0,loggedIn}));fs.writeFileSync(configFile,JSON.stringify({...settings,platforms:{dynamic:['x']}}));fs.writeFileSync(input,'是否全自动：是\n类型：动态\n标题：无\n正文：原文\n标签：无\n媒体：/tmp/a.png\n平台：X');
   fs.writeFileSync(child,`import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2),f=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}));f.calls.push(args[0]);fs.writeFileSync(${JSON.stringify(fixture)},JSON.stringify(f));if(args[0]==='prepare'){const directory=path.join(args[args.indexOf('--state-root')+1],args[args.indexOf('--job-id')+1]);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({taskSpaceId:65,taskSpaceName:f.name,pageLabel:'p1',pkg:{platform:'x'},assets:[],fingerprint:'test'}));}console.log(JSON.stringify(args[0]==='check'?{status:'input_checked'}:args[0]==='inspect'?{status:'draft_verified',ready:true,finalPublishClicked:false}:{status:'configured',configurationComplete:true,finalPublishClicked:false}));`);
   fs.writeFileSync(ego,`#!${process.execPath}\nimport fs from 'node:fs';import vm from 'node:vm';let body='';for await(const chunk of process.stdin)body+=chunk;const file=${JSON.stringify(fixture)},f=JSON.parse(fs.readFileSync(file));const save=()=>fs.writeFileSync(file,JSON.stringify(f));if(body.includes('data-168-auto-publish')){f.clicks++;save();console.log('168_PUBLISHER_RESULT:'+JSON.stringify({status:'published',finalPublishClicked:true,reason:'发布成功'}));}else{const page={label:'p1',goto:async url=>{f.url=url;save();},waitForFunction:async()=>{},evaluate:async fn=>fn.toString().includes('const roots=')?{status:f.loggedIn?'login_checked':'needs_login'}:[]};const task={spaceId:65,get name(){return f.name},tabs:async()=>[{label:'p1',url:f.url||'about:blank'}],page:()=>page,handOff:async()=>{f.handoffs++;f.ownership='user';save();}};await vm.runInNewContext('(async()=>{'+body+'})()',{console,taskSpace:async id=>{if(!f.name){f.name=id;f.ownership='agent';save();}return task;},listTaskSpaces:async()=>f.name?[{id:65,name:f.name,ownership:f.ownership}]:[],takeOverTaskSpace:async()=>{f.ownership='agent';save();return task;}});}`,{mode:0o700});
   const platform=type==='video'?'youtube':'x';
   const registry={[type]:{...entries[type],platforms:[platform],entry:child}};
   fs.writeFileSync(configFile,JSON.stringify({...settings,platforms:{[type]:[platform]}}));
   if(type==='video'){
    fs.writeFileSync(input,'是否全自动：是\n类型：视频\n标题：标题\n正文：原文\n标签：无\n媒体：/tmp/a.mp4\n平台：YouTube');
    fs.writeFileSync(child,fs.readFileSync(child,'utf8').replace("{status:'input_checked'}","{ok:true,platform:'youtube'}").replace("pkg:{platform:'x'},assets:[],fingerprint:'test'","pkg:{platform:'youtube'},assets:[],fingerprint:'test',effectivePackage:{videoPath:'/tmp/a.mp4',cover:{uploadCustomCover:false}},platforms:{youtube:{taskSpaceId:65,taskSpaceName:f.name,pageLabel:'p1'}}"));
   }
   fs.writeFileSync(runner,`import {main} from ${JSON.stringify(new URL('../scripts/publisher.mjs',import.meta.url).href)};await main(['preflight','--input',${JSON.stringify(input)},'--job-id','auto'],${JSON.stringify({stateHome:dir,configFile,registry})});`);
   const env={...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:ego,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks'),PUBLISHER_VIDEO_CONFIG:path.join(dir,'video.json')};
   fs.writeFileSync(env.PUBLISHER_VIDEO_CONFIG,JSON.stringify({declarations:{originalityPolicy:'all_videos_original'}}));
   const output=await run(process.execPath,[runner],{env});
   assert.equal(output.code,0,output.stderr);const f=JSON.parse(fs.readFileSync(fixture));
   assert.equal(f.clicks,loggedIn?1:0,`${type}, loggedIn=${loggedIn}: ${output.stdout}`);assert.equal(f.handoffs,1);assert.deepEqual(f.calls,loggedIn?['check','check','prepare','inspect']:['check']);
   if(loggedIn){
    assert.match(output.stdout,/平台已确认发布/);
    fs.writeFileSync(runner,fs.readFileSync(runner,'utf8').replace("['preflight','--input',"+JSON.stringify(input)+",'--job-id','auto']","['run','--job-id','auto','--resume-control']"));
    const resumed=await run(process.execPath,[runner],{env});assert.equal(resumed.code,0,resumed.stderr);assert.equal(JSON.parse(fs.readFileSync(fixture)).clicks,1);assert.match(resumed.stdout,/平台已确认发布/);
   }else assert.match(output.stdout,/登录未完成/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});


test('Generated publication scripts compile for all nine supported targets',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-auto-syntax-'));
 try{
  for(const [type,entry] of Object.entries(entries))for(const platform of entry.platforms){
   const state={taskSpaceId:1,taskSpaceName:'fixture',pageLabel:'p1',pkg:{platform},assets:[],fingerprint:'fixture',effectivePackage:{videoPath:'/tmp/a.mp4',cover:{uploadCustomCover:false}},platforms:{[platform]:{taskSpaceId:1,taskSpaceName:'fixture',pageLabel:'p1'}}};
   const file=path.join(dir,type+'-'+platform+'.mjs');fs.writeFileSync(file,publicationScript(type,platform,state,path.join(dir,'state.json')));
   const result=await run(process.execPath,['--check',file]);assert.equal(result.code,0,result.stderr);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
