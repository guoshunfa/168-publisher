import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseTemplate,expandRequest,saveRequestResult} from '../scripts/input.mjs';
import {resolveDefaults,withEffectivePackage} from '../scripts/video-defaults.mjs';
import {renderReport} from '../scripts/report.mjs';
import {entries as currentEntries} from '../scripts/registry.mjs';
const {media,image,...entries}=currentEntries;
import {execute,request,compactResult} from '../scripts/publisher.mjs';
const settings={profile:'账号 A',platforms:{video:entries.video.platforms,dynamic:entries.dynamic.platforms},waitTimeout:1800};
const template='类型：动态\n标题：无\n正文：第一行\n\n第二行  原样\n标签：AI 工具、发布\n媒体：\n/tmp/a b.png\n/tmp/c.png\n平台：X、微博、小红书';

test('Template preserves user text, ordered paths with spaces and delimiter-only tags',()=>{
 const value=parseTemplate(template,settings,entries);
 assert.equal(value.pkg.text,'第一行\n\n第二行  原样');assert.deepEqual(value.pkg.images,['/tmp/a b.png','/tmp/c.png']);
 assert.deepEqual(value.pkg.tags,['AI 工具','发布']);assert.deepEqual(value.platforms,['x','weibo','xiaohongshu']);assert.equal(value.profile,'账号 A');assert.deepEqual(value.errors,[]);
 assert.equal(parseTemplate(template.replace('正文：第一行','正文：none'),settings,entries).pkg.text.startsWith('none'),true);
});
test('All targets and matching outer path quotes work without changing literal filename characters',()=>{
 const input=template.replace('X、微博、小红书','所有').replace('/tmp/a b.png',"'/tmp/a b.png'").replace('/tmp/c.png','"/tmp/it\'s c.png"');
 const value=parseTemplate(input,settings,entries);
 assert.deepEqual(value.errors,[]);assert.deepEqual(value.platforms,settings.platforms.dynamic);
 assert.deepEqual(value.pkg.images,['/tmp/a b.png',"/tmp/it's c.png"]);
 assert.ok(parseTemplate(input.replace("'/tmp/a b.png'","'/tmp/a b.png\""),settings,entries).errors.length);
});
test('English and legacy template aliases map without generating content',()=>{
 const p=parseTemplate('Type: video\nTitle: title\nBody: body\nTags: one、two\nMedia: /tmp/a.mp4\nPlatforms: Xiaohongshu、Douyin、Bilibili、WeChat Channels、YouTube\nWeChat Short Title: 六个字的短标题\nYouTube Audience: made_for_kids\nBilibili Title: custom\nYouTube Body: exact\nCover: default',settings,entries);
 assert.deepEqual(p.platforms,settings.platforms.video);assert.equal(p.pkg.wechatShortTitle,'六个字的短标题');assert.equal(p.pkg.bilibiliTitle,'custom');assert.equal(p.pkg.youtubeDescription,'exact');assert.deepEqual(p.pkg.cover,{uploadCustomCover:true});assert.equal(p.pkg.aiGenerated,undefined);assert.deepEqual(p.errors,[]);
 const legacy=parseTemplate('内容：动态\n正文：原文\n标签：无\n媒体：/tmp/a.mp4\n平台：微博',settings,entries);assert.equal(legacy.pkg.type,'dynamic');assert.equal(legacy.pkg.videoPath,'/tmp/a.mp4');
});
test('Video template default, empty and omitted cover select first frame, supplied image wins',()=>{
 const input='Type: video\nTitle: title\nBody: body\nTags: none\nMedia: /tmp/a.mp4\nPlatforms: YouTube';
 const config={effectiveDefaults:resolveDefaults({defaults:{cover:{uploadCustomCover:false}}})};
 for(const cover of ['', '   ', 'default', '默认']){
  const value=parseTemplate(input+'\nCover: '+cover,settings,entries);
  assert.deepEqual(value.errors,[]);assert.deepEqual(value.pkg.cover,{uploadCustomCover:true});
  assert.equal(withEffectivePackage(value.pkg,config).cover.uploadCustomCover,true);
 }
 const omitted=parseTemplate(input,settings,entries);assert.deepEqual(omitted.pkg.cover,{uploadCustomCover:true});assert.equal(withEffectivePackage(omitted.pkg,config).cover.uploadCustomCover,true);
 assert.match(renderReport({command:'preflight',platforms:{}},{scope:{type:'video',platforms:['youtube']}},omitted.pkg),/封面：视频首帧（上传至各平台封面项/);
 const custom=parseTemplate(input+'\nCover: /tmp/custom cover.png',settings,entries);assert.deepEqual(custom.errors,[]);assert.deepEqual(custom.pkg.cover,{uploadCustomCover:true,sourcePath:'/tmp/custom cover.png'});
});
test('Dynamic accepts empty or default cover and rejects a custom image path',()=>{
 for(const cover of ['', '   ', 'default', '默认']){
  const value=parseTemplate(template+'\nCover: '+cover,settings,entries);
  assert.deepEqual(value.errors,[]);assert.equal(value.pkg.cover,undefined);
 }
 assert.deepEqual(parseTemplate(template+'\nCover: /tmp/cover.png',settings,entries).errors,['动态不支持自定义封面']);
});
test('Incomplete content is returned as blocking errors, ambiguous routing fails before pages',()=>{
 assert.throws(()=>parseTemplate('正文：a',settings,entries),/类型/);
 for(const platforms of ['X、X','YouTube','unknown'])assert.throws(()=>parseTemplate(template.replace('X、微博、小红书',platforms),settings,entries),/平台/);
 const p=parseTemplate(template.replace('标题：无','标题：独立标题').replace('AI 工具、发布','a、、a').replace('/tmp/c.png','/tmp/c.mp4'),settings,entries);
 assert.ok(p.errors.length>=2);assert.equal(parseTemplate(template.replace('X、微博、小红书','所有平台'),settings,entries).platforms.length,3);
 const body=parseTemplate('类型：视频\n正文：不静默丢失\n标签：无\n平台：小红书',settings,entries);assert.match(body.errors.join(),/不写正文/);
});
test('Stored request freezes defaults and scope, detects tampering, and closes locks after failure',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-input-')),oldConfig=process.env.PUBLISHER_VIDEO_CONFIG;
 try{
  const input=path.join(dir,'input.txt'),configFile=path.join(dir,'settings.json'),videoConfig=path.join(dir,'video.json');process.env.PUBLISHER_VIDEO_CONFIG=videoConfig;
  fs.writeFileSync(configFile,JSON.stringify(settings));fs.writeFileSync(videoConfig,JSON.stringify({defaults:{youtubeVisibility:'unlisted'}}));
  fs.writeFileSync(input,'类型：视频\n标题：标题\n正文：原文\n标签：无\n媒体：/tmp/a.mp4\n平台：YouTube');
  const options={registry:entries,stateHome:dir,configFile};
  const first=expandRequest(['check','--input',input,'--job-id','test'],options);assert.equal(JSON.parse(fs.readFileSync(first.context.packagePath)).youtubeVisibility,'unlisted');first.release();
  fs.writeFileSync(videoConfig,JSON.stringify({defaults:{youtubeVisibility:'public'}}));fs.writeFileSync(configFile,'invalid');
  assert.throws(()=>expandRequest(['run','--job-id','test'],options),/resume-control/);
  const resumed=expandRequest(['run','--job-id','test','--resume-control'],options);assert.equal(resumed.context.videoConfig.effectiveDefaults.youtubeVisibility,'unlisted');assert.ok(resumed.argv.includes('账号 A'));resumed.release();
  const snapshot=fs.readFileSync(resumed.context.videoConfigPath);fs.writeFileSync(resumed.context.videoConfigPath,'{}');assert.throws(()=>expandRequest(['run','--job-id','test','--resume-control'],options),/快照已改变/);fs.writeFileSync(resumed.context.videoConfigPath,snapshot);
  assert.throws(()=>expandRequest(['check','--input',input,'--job-id','test','--state-root',path.join(dir,'different')],options),/不可改变/);
  fs.writeFileSync(input,fs.readFileSync(input,'utf8').replace('正文：原文','正文：修正'));
  const corrected=expandRequest(['check','--input',input,'--job-id','test'],options);assert.equal(JSON.parse(fs.readFileSync(corrected.context.packagePath)).description,'修正');
  saveRequestResult(corrected.context,{reportPath:'/tmp/report'});corrected.release();
  const runs=path.join(corrected.context.scope.stateRoot,'.runs');fs.mkdirSync(runs,{recursive:true});fs.writeFileSync(path.join(runs,'test.json'),JSON.stringify({fingerprint:'sealed'}));
  assert.throws(()=>expandRequest(['check','--input',input,'--job-id','test'],options),/不可改包/);
  fs.writeFileSync(corrected.context.packagePath,'{}');assert.throws(()=>expandRequest(['run','--job-id','test','--resume-control'],options),/已改变/);
 }finally{if(oldConfig===undefined)delete process.env.PUBLISHER_VIDEO_CONFIG;else process.env.PUBLISHER_VIDEO_CONFIG=oldConfig;fs.rmSync(dir,{recursive:true,force:true});}
});
test('Any template error blocks preparation for all platforms after technical checks',async()=>{
 const plan=request(['run','--package','/tmp/a.json','--platforms','x,weibo'],{type:'dynamic'});plan.inputErrors=['媒体混选'];let prepared=false;const phases=[];
 const result=await execute(plan,async(_,phase)=>{phases.push(phase);return {code:0,stdout:JSON.stringify({status:'input_checked'})};},undefined,{beforePreparation:async()=>{prepared=true;}});
 assert.deepEqual(phases,['check','check']);assert.equal(prepared,false);assert.equal(result.x.status,'failed');assert.deepEqual(result.weibo.errors,['媒体混选']);
});
test('Summary preserves complete text and every error, distinguishes login unknown and actual short title',()=>{
 const context={jobId:'case',scope:{type:'video',platforms:['wechat_channels','youtube'],profile:''},videoConfig:{}};
 const pkg={title:'共享标题',wechatShortTitle:'',description:'第一行\n第二行',tags:['AI'],videoPath:'/tmp/a b.mp4'};
 const report={command:'preflight',platforms:{wechat_channels:{status:'needs_user',reason:'读取失败',contentAudit:{errors:['错误一','错误二']}},youtube:{status:'login_checked'}},inputErrors:['模板错误']};
 const output=renderReport(report,context,pkg);assert.match(output,/视频号 \| — \| 留空/);for(const text of ['第一行\n第二行','错误一','错误二','读取失败','模板错误','/tmp/a b.mp4'])assert.ok(output.includes(text));assert.ok(output.endsWith('完成后回复继续'));
 const compact=compactResult('video','bilibili','prepare',{code:1,stdout:JSON.stringify({platforms:{bilibili:{status:'needs_user',blocker:{code:'DECLARATION',message:'具体失败原因',evidence:{selected:false}}}}})});assert.equal(compact.reason,'具体失败原因');assert.deepEqual(compact.blockerEvidence,{selected:false});
});

test('CLI template preflight, saved report, confirmed run and resume use the same pages',{skip:process.platform!=='darwin'},async()=>{
 const {run}=await import('../scripts/runtime.mjs');const {fileURLToPath}=await import('node:url');
 for(const unified of [false,true]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-template-cli-'));
 try{
  const fixture=path.join(dir,'fixture.json'),child=path.join(dir,'entry.mjs'),ego=path.join(dir,'ego.mjs'),runner=path.join(dir,'runner.mjs'),input=path.join(dir,'input.txt');
  fs.writeFileSync(input,unified?'标题：原题\n正文：原文\n标签：AI\n媒体：/tmp/a.mp4\n平台：X、YouTube':template.replace('AI 工具','AI').replace('X、微博、小红书','X、微博'));fs.writeFileSync(fixture,JSON.stringify({pages:['p1'],urls:{p1:'about:blank'},calls:[],egoCalls:0,creates:0,handOffs:0}));
  fs.writeFileSync(child,`import fs from 'node:fs';const args=process.argv.slice(2),f=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}));f.calls.push(args[0]);fs.writeFileSync(${JSON.stringify(fixture)},JSON.stringify(f));console.log(JSON.stringify(args[0]==='check'?{ok:true,platform:'youtube',status:'input_checked'}:{status:'configured',configurationComplete:true,taskSpaceId:65,finalPublishClicked:false}));`);
  fs.writeFileSync(ego,`#!${process.execPath}\nimport fs from 'node:fs';import vm from 'node:vm';let body='';for await(const c of process.stdin)body+=c;const file=${JSON.stringify(fixture)},f=JSON.parse(fs.readFileSync(file));f.egoCalls++;const save=()=>fs.writeFileSync(file,JSON.stringify(f));save();const page=label=>({label,goto:async url=>{f.urls[label]=url;save();},waitForFunction:async()=>{},evaluate:async fn=>fn.toString().includes('const roots=')?{status:'login_checked'}:[]});const task={spaceId:65,get name(){return f.name},tabs:async()=>f.pages.map(label=>({label,url:f.urls[label]})),page,newPage:async()=>{const label='p'+(f.pages.length+1);f.pages.push(label);f.urls[label]='about:blank';f.creates++;save();return page(label);},handOff:async()=>{f.ownership='user';f.handOffs++;save();}};await vm.runInNewContext('(async()=>{'+body+'})()',{console,listTaskSpaces:async()=>f.name?[{id:65,name:f.name,ownership:f.ownership}]:[],taskSpace:async id=>{if(!f.name){f.name=id;f.ownership='agent';save();}return task;},takeOverTaskSpace:async()=>{f.ownership='agent';save();return task;}});`,{mode:0o700});
  const publisher=fileURLToPath(new URL('../scripts/publisher.mjs',import.meta.url));
  const options={registry:{dynamic:{platforms:['x','weibo'],entry:child,actionPreparation:true,urls:{x:'https://x.com',weibo:'https://weibo.com'}}},stateHome:dir,configFile:path.join(dir,'settings.json')};
  if(unified)options.registry={...currentEntries,video:{...currentEntries.video,entry:child},dynamic:{...currentEntries.dynamic,entry:child}};
  fs.writeFileSync(runner,`import {main} from ${JSON.stringify(publisher)};await main(process.argv.slice(2),${JSON.stringify(options)});`);
  const invoke=args=>run(process.execPath,[runner,...args],{input:fs.readFileSync(input,'utf8'),env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:ego,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(dir,'locks')}});
  const first=await invoke(['preflight','--input','-','--job-id','case']);assert.equal(first.code,0,first.stderr);assert.match(first.stdout,/平台 \| 登录状态 \| 标题/);assert.match(first.stdout,/目前没有需要处理的问题/);
  let observed=JSON.parse(fs.readFileSync(fixture));assert.deepEqual(observed.calls,['check','check']);assert.equal(observed.creates,1);assert.equal(observed.handOffs,1);
  const count=observed.egoCalls;const report=await invoke(['report','--job-id','case']);assert.equal(report.stdout,first.stdout);assert.equal(JSON.parse(fs.readFileSync(fixture)).egoCalls,count);
  const unauthorized=await invoke(['run','--job-id','case']);assert.notEqual(unauthorized.code,0);assert.equal(JSON.parse(fs.readFileSync(fixture)).egoCalls,count);
  fs.writeFileSync(options.configFile,'invalid changed settings');
  const confirmed=await invoke(['run','--job-id','case','--resume-control']);assert.equal(confirmed.code,0,confirmed.stderr);assert.match(confirmed.stdout,/已配置/);
  observed=JSON.parse(fs.readFileSync(fixture));assert.deepEqual(observed.calls,['check','check','check','check','prepare','prepare']);assert.equal(observed.creates,1);assert.equal(observed.handOffs,2);
  const repeat=await invoke(['run','--job-id','case','--resume-control']);assert.notEqual(repeat.code,0);assert.equal(JSON.parse(fs.readFileSync(fixture)).calls.filter(c=>c==='prepare').length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});
