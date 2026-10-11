import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {entries} from '../scripts/registry.mjs';
import {parseTemplate,expandRequest} from '../scripts/input.mjs';
import {adapterType,adapterPackage,mediaKind} from '../scripts/media-routing.mjs';
import {configuration} from '../scripts/settings.mjs';
import {request,argumentsFor,execute} from '../scripts/publisher.mjs';
import {run} from '../scripts/runtime.mjs';
import {createOnboardedConfig} from '../assets/vendor/video-publisher/scripts/lib/config.mjs';

const settings={profile:'',platforms:{media:entries.media.platforms},waitTimeout:30};
const template=(media,platforms='所有')=>`是否全自动：否\n标题：原题\n正文：第一行\n第二行  原样\n标签：AI\n媒体：${media}\n平台：${platforms}`;

test('A type-free request infers images or video, deduplicates platforms and ignores a legacy type selection',()=>{
 for(const [file,kind,count] of [['/tmp/a.png','image',7],['/tmp/a.mp4','video',7]]){
  const parsed=parseTemplate(template(file),settings,entries);
  assert.equal(parsed.pkg.type,'media');assert.equal(mediaKind(parsed.pkg),kind);assert.equal(parsed.platforms.length,count);
  assert.equal(new Set(parsed.platforms).size,count);assert.deepEqual(parsed.errors,[]);
  assert.deepEqual(parseTemplate('类型：动态\n'+template(file),settings,entries).pkg,parsed.pkg);
  assert.deepEqual(parseTemplate('类型：视频\n'+template(file),settings,entries).pkg,parsed.pkg);
 }
 const image=parseTemplate(template('/tmp/a.png','小红书'),settings,entries);
 assert.equal(adapterPackage(image.pkg,'xiaohongshu','dynamic').platforms.xiaohongshu.title,'原题');
 const x=adapterPackage(image.pkg,'x','dynamic');assert.equal(x.title,undefined);assert.equal(x.text,'第一行\n第二行  原样');
});

test('Video reuses the existing native entry on each platform without copying unsupported fields',()=>{
 const parsed=parseTemplate(template('/tmp/a.mp4')+'\nX正文：X 原文\nYouTube正文：YouTube 原文\n封面：/tmp/cover.png',settings,entries);
 assert.deepEqual(parsed.errors,[]);
 for(const platform of parsed.platforms){
  const type=adapterType(parsed.pkg,platform,entries),pkg=adapterPackage(parsed.pkg,platform,type);
  assert.equal(pkg.videoPath,'/tmp/a.mp4');
  assert.equal(type,['x','weibo'].includes(platform)?'dynamic':'video');
  if(type==='dynamic'){assert.equal(pkg.cover,undefined);assert.equal(pkg.title,undefined);}else assert.equal(pkg.cover.sourcePath,'/tmp/cover.png');
 }
 assert.equal(adapterPackage(parsed.pkg,'x','dynamic').platforms.x.text,'X 原文');
 assert.equal(adapterPackage(parsed.pkg,'youtube','video').youtubeDescription,'YouTube 原文');
 assert.throws(()=>adapterPackage({...parsed.pkg,unknown:'value'},'x','dynamic'),/Unsupported/);
 assert.throws(()=>adapterPackage({...parsed.pkg,platforms:{youtube:{text:'must not be dropped'}}},'youtube','video'),/overrides/);
 assert.match(parseTemplate(template('/tmp/a.mp4','小红书'),settings,entries).errors.join(),/不写正文/);
});

test('Missing, mixed or unsupported media and explicitly unsupported platforms stop before browser work',()=>{
 for(const input of ['正文：a',template('/tmp/a.gif'),template('/tmp/a.png','unsupported'),template('/tmp/a.png','X、X')])assert.throws(()=>parseTemplate(input,settings,entries));
 const mixed=parseTemplate(template('/tmp/a.png\n/tmp/a.mp4','X'),settings,entries);assert.match(mixed.errors.join(),/不得混选/);
 assert.throws(()=>request(['check','--package','/tmp/a.json','--platform','unsupported'],{type:'media',images:['/tmp/a.png']}),/Unsupported/);
 assert.throws(()=>request(['check','--package','/tmp/a.json','--platform','x'],{type:'media',images:['/tmp/a.png'],videoPath:'/tmp/a.mp4'}),/混选/);
});

test('One default platform list filters images and keeps explicit platform order',()=>{
 const custom={...settings,platforms:{media:['youtube','weibo','x']}};
 assert.deepEqual(parseTemplate(template('/tmp/a.png'),custom,entries).platforms,['youtube','weibo','x']);
 assert.deepEqual(parseTemplate(template('/tmp/a.mp4'),custom,entries).platforms,['youtube','weibo','x']);
 assert.deepEqual(parseTemplate(template('/tmp/a.mp4','X、YouTube'),custom,entries).platforms,['x','youtube']);
 assert.throws(()=>parseTemplate(template('/tmp/a.png'),{...settings,platforms:{media:[]}},entries),/目标为空/);
});

test('Legacy defaults merge once, preserve Pro article defaults, and invalid configurations stay unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-media-settings-'));
 try{
  const file=path.join(dir,'settings.json'),registry={...entries,article:{platforms:['zhihu','bilibili']}};
  const old={profile:'work',platforms:{video:['youtube','xiaohongshu'],dynamic:['x','xiaohongshu'],article:['zhihu']},waitTimeout:60};
  fs.writeFileSync(file,JSON.stringify(old));
  const merged=configuration(file,registry).configuration;
  assert.deepEqual(merged,{...old,platforms:{media:['youtube','xiaohongshu','x'],article:['zhihu']}});
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),merged);assert.equal(fs.statSync(file).mode&0o777,0o600);
  const invalid={...old,platforms:{...old.platforms,dynamic:['unknown']}};fs.writeFileSync(file,JSON.stringify(invalid));
  assert.throws(()=>configuration(file,registry));assert.deepEqual(JSON.parse(fs.readFileSync(file)),invalid);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Legacy saved requests keep their adapters and snapshots after the unified entry is installed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-media-legacy-'));
 try{
  const {media,image,...legacy}=entries,file=path.join(dir,'input'),configFile=path.join(dir,'settings.json');
  fs.writeFileSync(file,'类型：动态\n'+template('/tmp/a.mp4','X'));
  const previous=expandRequest(['check','--input',file,'--job-id','legacy'],{registry:legacy,stateHome:dir,configFile});previous.release();
  const stored=fs.readFileSync(previous.context.packagePath,'utf8');
  const resumed=expandRequest(['run','--job-id','legacy','--resume-control'],{registry:entries,stateHome:dir,configFile});
  assert.equal(resumed.context.scope.type,'dynamic');assert.equal(fs.readFileSync(resumed.context.packagePath,'utf8'),stored);assert.ok(resumed.context.settings.platforms.dynamic);resumed.release();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Mixed native adapters check every target before preparing once, retaining platform-specific argument contracts',async()=>{
 const plan=request(['run','--package','/tmp/pkg.json','--platforms','x,xiaohongshu,youtube','--confirm-original-rights'],{type:'media',videoPath:'/tmp/a.mp4'}),calls=[];
 assert.equal(plan.urls.x,entries.dynamic.urls.x);assert.equal(plan.urls.xiaohongshu,entries.video.urls.xiaohongshu);
 for(const job of plan.jobs){job.packagePath='/tmp/'+job.platform+'.json';const args=argumentsFor(plan,job,'check');assert.ok(args.includes(job.packagePath));}
 const result=await execute(plan,async(job,phase,args)=>{
  calls.push(job.platform+':'+phase);
  if(phase==='prepare')assert.equal(args.includes('--confirm-original-rights'),job.type==='video');
  return {code:0,stdout:JSON.stringify(phase==='check'?(job.type==='video'?{ok:true,platform:job.platform}:{status:'input_checked'}):{status:'configured',configurationComplete:true,finalPublishClicked:false})};
 });
 assert.deepEqual(calls,['x:check','xiaohongshu:check','youtube:check','x:prepare','xiaohongshu:prepare','youtube:prepare']);
 assert.ok(Object.values(result).every(r=>r.configurationComplete));
});

test('Type-free images and video pass real local checks across all supported targets without Ego',{skip:process.platform!=='darwin'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-media-check-'));
 try{
  const image=path.join(dir,'a.png'),video=path.join(dir,'a.mp4'),input=path.join(dir,'input'),runner=path.join(dir,'runner.mjs');
  fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=1280x720:r=24','-t','4','-c:v','libx264','-pix_fmt','yuv420p',video]);
  fs.writeFileSync(path.join(dir,'video.json'),JSON.stringify(createOnboardedConfig({sourceDirectory:dir,availablePlatforms:entries.video.platforms,defaultPlatforms:['youtube'],declarations:{originalityPolicy:'all_videos_original'}})));
  fs.writeFileSync(runner,`import {main} from ${JSON.stringify(new URL('../scripts/publisher.mjs',import.meta.url).href)};await main(process.argv.slice(2),${JSON.stringify({stateHome:dir,configFile:path.join(dir,'settings.json')})});`);
  for(const [media,count] of [[image,7],[video,7]]){
   fs.writeFileSync(input,template(media));
   const result=await run(process.execPath,[runner,'check','--input',input],{env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:'/fixture/no-browser',PUBLISHER_VIDEO_CONFIG:path.join(dir,'video.json')}});
   assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.equal((result.stdout.match(/内容通过/g)||[]).length,count);
  }
  fs.writeFileSync(image,'not a PNG');fs.writeFileSync(input,template(image,'X'));
  const bad=await run(process.execPath,[runner,'check','--input',input],{env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:'/fixture/no-browser'}});
  assert.equal(bad.code,10);assert.match(bad.stdout,/失败/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
