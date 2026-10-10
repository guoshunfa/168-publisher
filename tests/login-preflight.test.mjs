import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {request,execute,runScopeFingerprint,reviewHandoffScript} from '../scripts/publisher.mjs';
import {loginState,loginCheckScript} from '../scripts/login-page.mjs';
import {submitNativeVideo,selectBilibiliTopic,ensureWechatMetadataCompat,ensureBilibiliDeclarationCompat,openYoutubeUploadCompat} from '../scripts/video-page-actions.mjs';

function readLogin(document,input='douyin',href='https://creator.douyin.com/creator-micro/content/upload'){
 const context={document,location:{href},URL};vm.runInNewContext('this.read='+loginState.toString(),context);return context.read(input);
}
function loginDocument(text='',elements=[],selectors={}){
 return {body:{innerText:text},title:'Creator',readyState:'complete',querySelectorAll:selector=>selector==='*'?elements:selectors[selector]||[]};
}

test('Douyin recognizes changed creator wording and hidden native video controls without requiring old headings',()=>{
 assert.equal(readLogin(loginDocument('抖音创作服务平台 上传视频')).status,'login_checked');
 const document=loginDocument('点击上传 视频',{length:0,[Symbol.iterator]:function*(){}},{'input[type="file"][accept*="video"],input[placeholder*="作品标题"]':[{}]});
 assert.equal(readLogin(document).status,'login_checked');
 assert.equal(readLogin(document,'douyin','https://example.com/creator-micro/content/upload').status,'needs_user');
});

test('Login traverses nested shadow roots and same-origin frames, while verification still blocks',()=>{
 const child=loginDocument('抖音创作服务平台 上传视频');
 const frame={tagName:'IFRAME',contentDocument:child,getBoundingClientRect:()=>({height:300})};
 const inner=loginDocument('',[frame]),outer=loginDocument('',[{shadowRoot:inner}]),document=loginDocument('',[{shadowRoot:outer}]);
 assert.equal(readLogin(document).status,'login_checked');
 child.body.innerText+=' 安全验证';assert.equal(readLogin(document).status,'needs_login');
 const unreadable=loginDocument('',[{tagName:'IFRAME',get contentDocument(){throw Error('cross origin');},getBoundingClientRect:()=>({height:300})}]);
 const failed=readLogin(unreadable);assert.equal(failed.status,'needs_user');assert.equal(failed.evidence.unreadableFrames,1);
 assert.equal(readLogin(unreadable,{platform:'douyin',snapshotText:'抖音创作服务平台 上传视频'}).status,'login_checked');
});

test('Unknown pages retain bounded diagnostics and URL excludes query and fragment',()=>{
 const failed=readLogin(loginDocument('其他页面 '.repeat(500)),'douyin','https://creator.douyin.com/other?private=secret#token');
 assert.equal(failed.status,'needs_user');assert.equal(failed.evidence.url,'https://creator.douyin.com/other');assert.ok(failed.evidence.textExcerpt.length<=1200);
 assert.match(readLogin(loginDocument()).reason,/尚未加载/);
});

test('Preflight automatically falls back to one read-only snapshot and retains failures',async()=>{
 for(const snapshotFailure of [false,true]){
  const events=[],reports=[];const page={waitForFunction:async()=>{throw Error('timeout');},evaluate:async(_fn,input)=>input.snapshotText?{status:'login_checked'}:{status:'needs_user',evidence:{url:'https://creator.douyin.com/creator-micro/content/upload'}},snapshot:async()=>{events.push('snapshot');if(snapshotFailure)throw Error('snapshot unavailable');return '抖音创作服务平台 上传视频';}};
  await vm.runInNewContext('(async()=>{'+loginCheckScript({taskSpaceId:65,name:'same',pages:{douyin:'p2'}})+'})()',{taskSpace:async()=>({name:'same',spaceId:65,page:()=>page}),console:{log:s=>reports.push(s)}});
  const result=JSON.parse(reports[0].split('168_PUBLISHER_RESULT:')[1]).platforms.douyin;
  assert.equal(result.status,snapshotFailure?'needs_user':'login_checked');assert.deepEqual(events,['snapshot']);
  if(snapshotFailure)assert.match(result.evidence.snapshotError,/snapshot unavailable/);
 }
});

test('Login stage accepts incomplete content but rejects ambiguous targets and unsupported registries',()=>{
 const plan=request(['preflight','--package','/tmp/input','--platform','youtube','--job-id','case'],{type:'video'});
 assert.equal(plan.command,'preflight');assert.throws(()=>request(['preflight','--package','/tmp/input','--platform','x,x'],{type:'dynamic'}));
 const before=runScopeFingerprint(plan);plan.jobs[0].pageLabel='p3';assert.equal(runScopeFingerprint(plan),before);
 assert.throws(()=>request(['preflight','--package','/tmp/input','--platform','site'],{type:'article'},{article:{platforms:['site']}}),/video and dynamic/);
});

test('Login observations do not click, upload, navigate, or declare an ambiguous login successful',async()=>{
 for(const [url,text,status] of [['https://channels.weixin.qq.com/login.html','郭顺发 微信快捷登录','needs_login'],['https://channels.weixin.qq.com/platform','选择视频号登录 账号一 账号二','needs_login'],['https://studio.youtube.com/channel/example','', 'login_checked'],['https://member.bilibili.com/platform/upload','成为UP主的第2天','login_checked'],['https://member.bilibili.com/platform/upload','视频投稿 安全验证','needs_login'],['https://creator.douyin.com/creator-micro/content/upload','创作者中心 发布视频 请登录','needs_login'],['https://creator.douyin.com/creator-micro/content/publish','作品发布 内容管理 发布设置','login_checked'],['https://creator.douyin.com/creator-micro/content/publish','作品发布 内容管理 发布设置 请登录','needs_login'],['https://example.com','', 'needs_user']]){
  const document={body:{innerText:text},querySelectorAll:selector=>selector==='button[aria-label="创建"],button[aria-label="Create"],ytcp-uploads-dialog'&&url.includes('youtube')?[{getBoundingClientRect:()=>({height:20})}]:[]};
  const context={document,location:{href:url},URL};vm.runInNewContext('this.read='+loginState.toString(),context);
  assert.equal(context.read(url.includes('weixin')?'wechat_channels':url.includes('youtube')?'youtube':url.includes('douyin')?'douyin':'bilibili').status,status);
 }
 const events=[],reports=[];const page={waitForFunction:async()=>events.push('observe'),evaluate:async()=>({status:'login_checked'})};
 await vm.runInNewContext('(async()=>{'+loginCheckScript({taskSpaceId:65,name:'same',pages:{bilibili:'p1',youtube:'p2'}})+'})()', {taskSpace:async()=>({name:'same',spaceId:65,page:()=>page}),console:{log:s=>reports.push(s)}});
 assert.deepEqual(events,['observe','observe']);assert.equal(JSON.parse(reports[0].split('168_PUBLISHER_RESULT:')[1]).platforms.youtube.pageLabel,'p2');
});

test('Resume skips configured and handed-off platforms while still preparing unfinished pages',async()=>{
 const plan=request(['run','--package','/tmp/input','--platforms','douyin,bilibili','--job-id','case'],{type:'video'});
 plan.previousResults={douyin:{jobId:'case-douyin',status:'configured',configurationComplete:true,handedOff:true,taskSpaceId:65}};
 const calls=[];const results=await execute(plan,async(job,phase)=>{calls.push(job.platform+':'+phase);return {code:0,stderr:'',stdout:JSON.stringify(phase==='check'?{ok:true,platform:job.platform}:{status:'configured',configurationComplete:true,finalPublishClicked:false})};});
 assert.equal(results.douyin.skipped,true);assert.deepEqual(calls,['douyin:check','bilibili:check','bilibili:prepare']);
});

test('Native chooser checkpoints only after preparation, and an uncertain dispatch cannot be retried',async()=>{
 for(const failure of ['chooser','dispatch',null]){
  const events=[];const page={evaluate:async()=>null,reload:async()=>events.push('reload'),waitForSelector:async()=>{},waitForFileChooser:()=>Promise.resolve({setFiles:async()=>{events.push('file');if(failure==='dispatch')throw Error('result unknown');}}),click:async()=>{if(failure==='chooser')throw Error('control missing');}};
  const context={page,armFinalPublishGuard:async()=>({ok:true,armed:true}),inspectXiaohongshu:async()=>({gates:{video:{ok:false}}})};vm.runInNewContext('this.submit='+submitNativeVideo.toString(),context);
  const operation=context.submit('xiaohongshu','/tmp/video.mp4',()=>events.push('attempt'));
  if(failure)await assert.rejects(operation);else await operation;
  assert.equal(events.includes('attempt'),failure!=='chooser');assert.equal(events.includes('file'),failure!=='chooser');
 }
});

test('YouTube opens the actual create menu before awaiting its upload dialog',async()=>{
 const events=[];let read=0;
 const page={evaluate:async()=>read++?true:false,click:async selector=>events.push(selector),waitForFunction:async()=>events.push('menu_ready'),waitForSelector:async()=>events.push('dialog_ready')};
 const context={page};vm.runInNewContext('this.open='+openYoutubeUploadCompat.toString(),context);assert.equal((await context.open()).ok,true);
 assert.deepEqual(events,['#publisher-youtube-create','menu_ready','#publisher-youtube-upload','dialog_ready']);
});

test('Bilibili topic search refuses ambiguity and waits for the selected native chip',async()=>{
 for(const unique of [true,false]){
  const events=[];const page={click:async s=>events.push(s),fill:async(_s,t)=>events.push(t),press:async()=>{},waitForFunction:async()=>events.push('wait'),evaluate:async()=>unique};
  const context={page,actionControlTimeout:n=>n};vm.runInNewContext('this.select='+selectBilibiliTopic.toString(),context);const result=await context.select('AI视频生成');assert.equal(result.ok,unique);
  assert.equal(events.includes('loc=role:button[name="确定"]'),unique);assert.equal(events.filter(e=>e==='wait').length,unique?2:1);
 }
});

test('Bilibili checks selected declaration and authorization separately from the collapsed input',async()=>{
 for(const scenario of [
  {selected:'内容无需标注',original:true,noop:true},
  {selected:'含AI生成内容',original:true,ai:true,noop:true},
  {selected:'含AI生成内容',original:true},
  {selected:'内容无需标注',original:false},
  {selected:'含AI生成内容',original:false},
  {selected:'内容无需标注',original:false,rejectAuthorization:true},
 ]){
  let selected=scenario.selected,original=scenario.original;const clicks=[];
  const root={querySelectorAll:()=>[{textContent:selected}],querySelector:()=>original?{}:null};
  const document={querySelector:selector=>selector==='.creation-statement-container'?root:{value:'内容为自制：未经作者允许，禁止转载'}};
  const page={evaluate:async(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(arg)',{document,arg}),click:async selector=>{clicks.push(selector);if(selector==='text="内容无需标注"')selected='内容无需标注';if(selector==='text="含AI生成内容"')selected='含AI生成内容';if(selector==='text="内容为自制：未经作者允许，禁止转载"'&&!scenario.rejectAuthorization)original=!original;}};
  const context={page,pkg:{aiGenerated:scenario.ai}};vm.runInNewContext('this.configure='+ensureBilibiliDeclarationCompat.toString(),context);
  const result=await context.configure();assert.equal(result.ok,!scenario.rejectAuthorization);
  assert.equal(clicks.length===0,!!scenario.noop);
  if(result.ok){clicks.length=0;assert.equal((await context.configure()).skipped,true);assert.equal(clicks.length,0);}
  else assert.match(result.reason,/自制授权未保留/);
 }
});

test('WeChat commits each space-delimited topic asynchronously, blurs, and skips matching content',async()=>{
 for(const scenario of ['success','missing_topic','lost_on_blur']){
  const events=[],tags=['AI','熊猫骑士','AI视频生成'],body='第一行\n第二行';let pending=null;
  const editor={innerText:body,tags:[],querySelectorAll(){return this.tags.map(t=>({textContent:'#'+t}));}};
  const short={placeholder:'短标题',value:''};
  const document={querySelectorAll:selector=>selector==='*'?[]:selector==='input'?[short]:[editor]};
  const evaluate=(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(arg)',{document,arg});
  const page={evaluate:async(fn,arg)=>evaluate(fn,arg),focus:async selector=>{events.push(['focus',selector]);if(selector.includes('短标题')&&scenario==='lost_on_blur')editor.tags.pop();},fill:async()=>assert.fail('Short title already matches'),keyboard:{press:async key=>{events.push(['key',key]);if(key==='Meta+A')editor.innerText='';if(key==='Space'){editor.innerText+=' ';pending=editor.innerText.match(/#([^# ]+) $/)[1];}},paste:async value=>{editor.innerText=value;},insertText:async value=>{events.push(['text',value]);editor.innerText+=value;}},waitForFunction:async(fn,arg,options)=>{
   events.push(['wait',arg.index]);assert.ok(options.timeout<=5000);
   assert.equal(evaluate(fn,arg),false,'Topic has not become an entity yet');
   if(scenario==='missing_topic'&&arg.index===1)throw Error('topic timeout');
   editor.tags.push(pending);pending=null;assert.equal(evaluate(fn,arg),true);
  }};
  const context={page,pkg:{wechatDescription:body,wechatTags:tags},actionControlTimeout:n=>n,typedBlocker:(code,message,options)=>({code,message,...options})};vm.runInNewContext('this.fill='+ensureWechatMetadataCompat.toString(),context);
  const result=await context.fill();assert.equal(result.ok,scenario==='success');
  if(scenario==='missing_topic'){assert.equal(result.blocker.evidence.tag,tags[1]);assert.equal(events.some(e=>e[1]==='#'+tags[2]),false);continue;}
  assert.deepEqual(events.filter(e=>e[0]==='text').map(e=>e[1]),[' ','#AI','#熊猫骑士','#AI视频生成']);
  assert.equal(events.filter(e=>e[1]==='Space').length,3);
  assert.deepEqual(events.filter(e=>e[0]==='wait').map(e=>e[1]),[0,1,2]);
  assert.deepEqual(events.at(-1),['focus','input[placeholder*="短标题"]']);
  if(result.ok){assert.equal(result.actions.description.text,body+' #AI #熊猫骑士 #AI视频生成 ');events.length=0;assert.equal((await context.fill()).ok,true);assert.deepEqual(events,[]);}
 }
});


test('WeChat login preflight stays read-only and leaves authentication to the user',async()=>{
 const reports=[],events=[];const page={waitForFunction:async()=>events.push('observe'),evaluate:async(fn)=>fn.toString().includes('const roots=')?{status:'needs_login',reason:'请在原页面手动登录视频号并选择账号，完成后明确继续'}:[],click:async()=>assert.fail('No automatic login click'),setInputFiles:async()=>assert.fail('No upload during login check')};
 await vm.runInNewContext('(async()=>{'+loginCheckScript({taskSpaceId:65,name:'same',pages:{wechat_channels:'p4'}})+'})()',{taskSpace:async()=>({name:'same',spaceId:65,page:()=>page}),console:{log:s=>reports.push(s)}});
 const result=JSON.parse(reports[0].split('168_PUBLISHER_RESULT:')[1]);assert.equal(result.platforms.wechat_channels.status,'needs_login');assert.match(result.platforms.wechat_channels.reason,/手动登录/);assert.deepEqual(events,['observe']);
 let handedOff=false;const task={spaceId:65,page:()=>page,handOff:async()=>{handedOff=true;}};await vm.runInNewContext('(async()=>{'+reviewHandoffScript({taskSpaceId:65,name:'same',pages:{wechat_channels:'p4'}})+'})()',{taskSpace:async()=>task,listTaskSpaces:async()=>[{id:65,name:'same',ownership:'agent'}],console:{log:s=>reports.push(s)}});assert.equal(handedOff,true);assert.equal(JSON.parse(reports[1].split('168_PUBLISHER_RESULT:')[1]).handedOff,true);
});
