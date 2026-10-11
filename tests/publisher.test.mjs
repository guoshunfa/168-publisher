import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {request,argumentsFor,compactResult,execute,precreatePagesScript,preparationLoginCheckScript,reviewHandoffScript,runFingerprint} from '../scripts/publisher.mjs';

const result=value=>({code:0,stdout:JSON.stringify(value),stderr:''});
const checked=(type,platform)=>result(type==='video'?{ok:true,platform}:{status:'input_checked'});
const configured=()=>result({status:'configured',configurationComplete:true,finalPublishClicked:false,taskSpaceId:65});
const options=(type,selected,command='run')=>request([command,'--package','/private/package.json','--platforms',selected.join(','),'--job-id','case'],{type});

test('Community rejects unsupported types and ambiguous selections before browser work',()=>{
 for(const raw of [null,[],1,{type:'article'},{type:'__proto__'}])assert.throws(()=>request(['run','--package','/tmp/input','--platform','x'],raw));
 for(const flags of [['--platforms','x,x'],['--platform','x','--platforms','weibo'],['--platform','x','--confirm-manual-send']])assert.throws(()=>request(['run','--package','/tmp/input',...flags],{type:'dynamic'}));
});

test('All nine targets preflight, create every page, then configure in order and hand back without inspection or sleep',async()=>{
 for(const [type,selected] of Object.entries({video:['xiaohongshu','douyin','bilibili','wechat_channels','youtube'],dynamic:['x','weibo','xiaohongshu','jike']})){
  const calls=[],progress=[],plan=options(type,selected);
  const reports=await execute(plan,async(job,phase,args)=>{calls.push(job.platform+':'+phase);if(phase==='prepare')assert.ok(args.includes('--actions-only'));return phase==='check'?checked(type,job.platform):configured();},()=>assert.fail('No background wait'),{
   beforePreparation:async()=>calls.push('all_pages_created'),afterPreparation:async()=>calls.push('handoff'),onProgress:(_r,current)=>progress.push(current),
  });
  assert.deepEqual(calls,[...selected.map(p=>p+':check'),'all_pages_created',...selected.map(p=>p+':prepare'),'handoff']);
  assert.ok(Object.values(reports).every(r=>r.configurationComplete&&r.status==='configured'));
  assert.deepEqual(progress.filter(p=>p.step==='prepare').map(p=>p.platform),selected);
 }
});

test('A failed preflight never creates pages or prepares another valid target',async()=>{
 const calls=[],reports=await execute(options('dynamic',['x','weibo']),async(job,phase)=>{calls.push(phase);return job.platform==='weibo'?{...result({error:'bad input'}),code:1}:checked('dynamic',job.platform);},undefined,{beforePreparation:()=>assert.fail()});
 assert.deepEqual(calls,['check','check']);assert.equal(reports.weibo.status,'failed');
});

test('Login and field failures remain explicit; later tabs are configured and partial work is handed back',async()=>{
 for(const status of ['needs_login','needs_user','failed','result_unknown','processing']){
  let handoffs=0;const calls=[];
  const reports=await execute(options('dynamic',['x','weibo']),async(job,phase)=>{calls.push(job.platform+':'+phase);return phase==='check'?checked('dynamic',job.platform):job.platform==='x'?result({status,error:'field unavailable',finalPublishClicked:false}):configured();},()=>assert.fail(),{afterPreparation:()=>handoffs++});
  assert.equal(reports.x.status,status);assert.equal(reports.x.configurationComplete,false);assert.equal(reports.weibo.status,'configured');assert.equal(handoffs,1);assert.equal(calls.length,4);
 }
});

test('Actual user takeover stops actions without reclaiming control or beginning another tab',async()=>{
 const reports=await execute(options('dynamic',['x','weibo']),async(job,phase)=>phase==='check'?checked('dynamic',job.platform):result({error:'USER_CONTROL: user now controls'}));
 assert.equal(reports.weibo.status,'not_started');
});

test('Takeover in preparation error, reason or blocker stops automatic publication of earlier configured tabs',async()=>{
 for(const signal of [{error:'USER_CONTROL: user now controls'},{reason:'user-controlled space'},{blocker:{code:'USER_CONTROL',message:'Original space requires user control'}}]){
  const plan=options('dynamic',['x','weibo','jike']);plan.autoPublish=true;
  const calls=[];
  const reports=await execute(plan,async(job,phase)=>{
   calls.push(job.platform+':'+phase);
   return phase==='check'?checked('dynamic',job.platform):job.platform==='x'?configured():result({status:'needs_user',finalPublishClicked:false,...signal});
  },undefined,{afterPreparation:()=>assert.fail('Takeover must stop before automatic inspection, publishing or handoff')});
  assert.equal(reports.x.configurationComplete,true);
  assert.equal(reports.weibo.status,'needs_user');
  assert.equal(reports.jike.status,'not_started');
  assert.ok(!calls.includes('jike:prepare'));
 }
});

test('Automatic recovery checks login only for unconfigured jobs and leaves filled or published pages to their observers',async()=>{
 const plan=options('dynamic',['x','weibo','xiaohongshu','jike']);plan.autoPublish=true;
 plan.previousResults={
  x:{jobId:'case-x',configurationComplete:true},
  xiaohongshu:{jobId:'other-job',configurationComplete:true},
  jike:{jobId:'case-jike',configurationComplete:false},
 };
 plan.publications={weibo:{status:'submitted',finalPublishClicked:true}};
 const session={name:'fixture',taskSpaceId:65,pages:{x:'p1',weibo:'p2',xiaohongshu:'p3',jike:'p4'}},checkedPages=[],output=[];
 const task={name:'fixture',page:label=>{
  checkedPages.push(label);
  assert.ok(!['p1','p2'].includes(label),'Do not read filled text such as 我的安全验证经验 or a publication result as a login hint');
  return {waitForFunction:async()=>{},evaluate:async()=>({status:label==='p4'?'needs_login':'login_checked'})};
 }};
 await vm.runInNewContext('(async()=>{'+preparationLoginCheckScript(plan,session)+'})()',{taskSpace:async()=>task,console:{log:line=>output.push(line)}});
 assert.deepEqual(checkedPages,['p3','p4']);
 const report=JSON.parse(output[0].split('168_PUBLISHER_RESULT:')[1]);
 assert.deepEqual(Object.keys(report.platforms),['xiaohongshu','jike']);
 assert.equal(report.platforms.jike.status,'needs_login');
});

test('A resumed configured job keeps preparation evidence but clears old blockers before fresh automatic verification',async()=>{
 const plan=options('dynamic',['x']);plan.autoPublish=true;
 plan.previousResults={x:{jobId:'case',status:'needs_user',configurationComplete:true,evidencePath:'/private/prepared.json',error:'USER_CONTROL',reason:'user now controls',blocker:'USER_CONTROL'}};
 let resumed=false,verified=false;
 await execute(plan,async(job,phase)=>{
  assert.equal(phase,'check','The prepared job must not be prepared again');
  return checked('dynamic',job.platform);
 },undefined,{
  beforePreparation:async()=>{resumed=true;},
  afterPreparation:async results=>{
   assert.equal(resumed,true);
   assert.equal(results.x.configurationComplete,true);assert.equal(results.x.evidencePath,'/private/prepared.json');
   for(const key of ['error','reason','blocker'])assert.equal(results.x[key],undefined);
   verified=true;
  },
 });
 assert.equal(verified,true);assert.equal(plan.previousResults.x.error,'USER_CONTROL');
});

test('Configured requires a successful action receipt and never implies completed upload or publication',()=>{
 for(const value of [{status:'configured'},{status:'configured',configurationComplete:false,finalPublishClicked:false},{status:'configured',configurationComplete:true,finalPublishClicked:true}])assert.equal(compactResult('dynamic','x','prepare',result(value)).status,'result_unknown');
 assert.equal(compactResult('dynamic','x','prepare',{...configured(),code:1}).status,'result_unknown');
 assert.equal(compactResult('dynamic','x','prepare',result({status:'processing'})).configurationComplete,false);
});

test('Precreation binds four unique pages before any platform preparation and refuses unknown creation recovery',async()=>{
 const events=[],pages={},task={name:'fixture',tabs:async()=>[{label:'p1',url:'about:blank'}],page:label=>(pages[label]||={label}),newPage:async()=>{const label='p'+(Object.keys(pages).length+1);events.push('create:'+label);return pages[label]={label};}};
 const output=[],session={name:'fixture',taskSpaceId:65},jobs=['x','weibo','xiaohongshu','jike'].map(platform=>({platform}));
 await vm.runInNewContext('(async()=>{'+precreatePagesScript(session,jobs,{})+'})()', {taskSpace:async()=>task,console:{log:line=>output.push(line)}});
 const bindings=JSON.parse(output[0].split('168_PUBLISHER_RESULT:')[1]).pages;
 assert.deepEqual(Object.values(bindings),['p1','p2','p3','p4']);assert.equal(events.length,3);
 await assert.rejects(vm.runInNewContext('(async()=>{'+precreatePagesScript({...session,pageCreationAttempted:true},jobs,{})+'})()', {taskSpace:async()=>task,console:{log(){}}}),/outcome unknown/);
});

test('Review releases Agent guards, hands off once and never clicks; test drafts are still handed back with guard intact',async()=>{
 for(const protectedContent of [false,true])for(const guardKey of ['__168_PUBLISHER_X__','__168_PUBLISHER_IMAGE__']){
  const events=[],guard={armed:true,release(){events.push('release');this.armed=false;return {ok:true};}},task={page:()=>({evaluate:async fn=>vm.runInNewContext('('+fn.toString()+')()', {window:{[guardKey]:guard}})}),handOff:async()=>events.push('handoff'),spaceId:65};
  await vm.runInNewContext('(async()=>{'+reviewHandoffScript({name:'fixture',taskSpaceId:65,pages:{x:'p1'}},{protectedContent})+'})()', {listTaskSpaces:async()=>[{id:65,name:'fixture',ownership:'agent'}],taskSpace:async()=>task,console:{log(){}}});
  assert.deepEqual(events,protectedContent?['handoff']:['release','handoff']);assert.equal(guard.armed,protectedContent);
 }
});

test('Custom registries without the new capability receive their own preparation result without new claims or handoff',async()=>{
 const plan=request(['run','--package','/tmp/input','--platform','zhihu'],{type:'article'},{article:{platforms:['zhihu'],entry:'/custom/article.mjs'}});
 const reports=await execute(plan,async(_job,phase,args)=>{assert.ok(!args.includes('--actions-only'));return phase==='check'?result({status:'input_checked'}):result({status:'processing',finalPublishClicked:false});},()=>assert.fail(),{afterPreparation:()=>assert.fail()});
 assert.equal(reports.zhihu.status,'processing');assert.equal(reports.zhihu.configurationComplete,false);
});

test('Bound original page and explicit resume are forwarded only to preparation',()=>{
 const plan=options('dynamic',['x']);plan.flags.add('--resume-control');plan.values['--space']='65';plan.jobs[0].pageLabel='p3';
 const args=argumentsFor(plan,plan.jobs[0],'prepare');assert.ok(args.includes('--space')&&args.includes('--page-label')&&args.includes('--resume-control'));
 for(const phase of ['check','inspect'])assert.ok(!argumentsFor(plan,plan.jobs[0],phase).includes('--page-label'));
});


test('Run fingerprint remains identical when original page labels are restored',()=>{
 const plan=options('dynamic',['x','weibo']),raw={type:'dynamic',text:'fixture'};
 const before=runFingerprint(plan,raw);plan.jobs[0].pageLabel='p2';plan.jobs[1].pageLabel='p3';
 assert.equal(runFingerprint(plan,raw),before);
});


test('A guard with a previously blocked attempt is disabled only at user handoff and reported, without a send action',async()=>{
 const output=[],events=[],guard={armed:true,blockedAttempts:[{}],release(){throw new Error('Dirty guard');}},task={spaceId:65,page:()=>({evaluate:async fn=>vm.runInNewContext('('+fn.toString()+')()', {window:{__168_PUBLISHER_X__:guard}})}),handOff:async()=>events.push('handoff')};
 await vm.runInNewContext('(async()=>{'+reviewHandoffScript({name:'fixture',taskSpaceId:65,pages:{x:'p1'}})+'})()', {listTaskSpaces:async()=>[{id:65,name:'fixture',ownership:'agent'}],taskSpace:async()=>task,console:{log:line=>output.push(line)}});
 assert.deepEqual(events,['handoff']);assert.equal(guard.armed,false);assert.equal(JSON.parse(output[0].split('168_PUBLISHER_RESULT:')[1]).guardWarnings[0].blockedAttempts,1);
});
