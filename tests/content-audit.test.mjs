import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {videoAudit,dynamicAudit} from '../scripts/content-audit.mjs';
import {execute,request} from '../scripts/publisher.mjs';
import {createOnboardedConfig} from '../assets/vendor/video-publisher/scripts/lib/config.mjs';
import {parseTweet} from '../assets/twitter-text/bundle.mjs';
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'168-content-audit-'));

test('WeChat optional native short title is audited separately, including exact empty default and six-point boundary',()=>{
 for(const [shortTitle,valid] of [['',true],['五个字标题',false],['六个字的标题',true],['😀😀😀😀😀',false],['😀😀😀😀😀😀',true]]){
  const audit=videoAudit('wechat_channels',{title:'Identity',description:'User body',tags:['tag'],wechatShortTitle:shortTitle});
  assert.equal(audit.fields.shortTitle.value,shortTitle);assert.equal(audit.errors.length===0,valid);assert.equal(audit.fields.title.value,'Identity');assert.equal(audit.fields.shortTitle.max,null);
 }
});

test('Video title units and multiple independent violations are reported together',()=>{
 assert.equal(videoAudit('xiaohongshu',{title:'a'.repeat(40),tags:['tag']}).fields.title.length,20);
 assert.ok(videoAudit('xiaohongshu',{title:'a'.repeat(41),tags:['tag']}).errors.some(e=>e.includes('title')));
 const audit=videoAudit('wechat_channels',{title:'',description:'',tags:[],wechatShortTitle:'short'});
 assert.ok(['title','body','tags','shortTitle'].every(name=>audit.errors.some(e=>e.startsWith(name+':'))));
 const xhs=videoAudit('xiaohongshu',{title:'Title',description:'Not written',tags:['tag']});assert.equal(xhs.fields.body.applicable,false);assert.ok(xhs.warnings.some(w=>w.includes('does not write')));
 assert.equal(videoAudit('douyin',{title:'😀'.repeat(30),tags:['tag']}).fields.title.length,30);
});

test('YouTube absolute duration/size limits fail locally while verification and unknown duration are warnings',()=>{
 const pkg={title:'Title',description:'Body',tags:[]};
 for(const [seconds,bytes,valid] of [[43200,256_000_000_000,true],[43201,100,false],[1,256_000_000_001,false]])assert.equal(videoAudit('youtube',pkg,{media:{exists:true,sizeBytes:bytes,durationSeconds:seconds}}).errors.length===0,valid);
 assert.ok(videoAudit('youtube',pkg,{media:{exists:true,sizeBytes:1,durationSeconds:901}}).warnings.some(w=>w.includes('verification')));
 assert.ok(videoAudit('youtube',pkg,{media:{exists:true,sizeBytes:1,durationSeconds:null}}).warnings.some(w=>w.includes('could not be verified')));
});

test('Official fixed X counter handles 280 boundary, URLs, CJK, normalization, skin tone and ZWJ emoji',()=>{
 for(const [value,length] of [['a'.repeat(280),280],['中'.repeat(140),280],['👍🏽'.repeat(140),280],['👨‍👩‍👧‍👦'.repeat(140),280],['https://example.com/'+'a'.repeat(300),23],['example.com',23],['e\u0301',1]])assert.equal(parseTweet(value).weightedLength,length);
 for(const [value,valid] of [['a'.repeat(280),true],['a'.repeat(281),false],['中'.repeat(141),false],['👨‍👩‍👧‍👦'.repeat(141),false]]){
  const audit=dynamicAudit('x',{type:'dynamic',text:value,images:['https://example.com/a.png']},'/tmp');assert.equal(audit.fields.body.errors.length===0,valid);
 }
 const withTags=dynamicAudit('x',{text:'a'.repeat(276),tags:['t'],images:['https://example.com/a.png']},'/tmp');assert.equal(withTags.fields.body.length,280);
 const manifest=JSON.parse(fs.readFileSync(new URL('../assets/twitter-text/manifest.json',import.meta.url)));assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../assets/twitter-text/bundle.mjs',import.meta.url))).digest('hex'),manifest.bundle.sha256);
});

test('X image byte limit is decimal 5 MB; errors aggregate across files and user body without creating uploads',()=>{
 const d=dir();try{
  const file=path.join(d,'large.png');fs.writeFileSync(file,Buffer.alloc(5_000_001));
  const x=dynamicAudit('x',{text:'',images:[file,'missing.png']},d);assert.ok(x.errors.some(e=>e.includes('5,000,000')));assert.ok(x.errors.some(e=>e.includes('images[1]')));assert.ok(x.errors.some(e=>e.includes('body')));
  const weibo=dynamicAudit('weibo',{text:'Body',images:[file]},d);assert.equal(weibo.errors.length,0);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('Actual video check aggregates malformed short title plus other missing fields without touching browser',()=>{
 const d=dir();try{
  const config=path.join(d,'config.json'),pkg=path.join(d,'package.json');fs.writeFileSync(config,JSON.stringify(createOnboardedConfig({sourceDirectory:d,availablePlatforms:['wechat_channels'],defaultPlatforms:['wechat_channels'],declarations:{originalityPolicy:'all_videos_original'}})));
  fs.writeFileSync(pkg,JSON.stringify({type:'video',title:'',description:'',tags:[],wechatShortTitle:'short'}));
  const result=spawnSync(process.execPath,[new URL('../scripts/video.mjs',import.meta.url).pathname,'check','wechat_channels',pkg],{encoding:'utf8',env:{...process.env,PUBLISHER_VIDEO_CONFIG:config,VIDEO_PUBLISHER_V2_EGO_COMMAND:'/not/a/browser'}});
  assert.notEqual(result.status,0);const value=JSON.parse(result.stdout);assert.equal(value.audit.fields.shortTitle.value,'short');assert.ok(['title','body','tags','shortTitle'].every(n=>value.errors.some(e=>e.startsWith(n+':'))));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('Any invalid selected target blocks all platform preparation while preserving every check and audit',async()=>{
 const plan=request(['run','--package','/tmp/input','--platforms','douyin,bilibili,wechat_channels'],{type:'video'}),calls=[];let opened=false;
 const result=await execute(plan,async(job,phase)=>{calls.push([job.platform,phase]);return {code:job.platform==='bilibili'?1:0,stderr:'',stdout:JSON.stringify({platform:job.platform,ok:job.platform!=='bilibili',audit:{fields:{title:{value:'Title'}},errors:job.platform==='bilibili'?['body: missing']:[]}})};},null,{beforePreparation:async()=>{opened=true;}});
 assert.equal(opened,false);assert.equal(calls.length,3);assert.ok(calls.every(([,phase])=>phase==='check'));assert.equal(result.bilibili.audit.errors[0],'body: missing');assert.equal(result.douyin.status,'input_checked');
});

test('X cached HTTPS images are subject to 5 MB after byte and fingerprint verification, without changing historical state',async()=>{
 const {normalizeDynamic,sha256}=await import('../scripts/dynamic-input.mjs'),d=dir();try{
  const source='https://example.com/original.png',cached=path.join(d,'cache.png'),raw={type:'dynamic',text:'Original body',images:[source]},pkg=normalizeDynamic(raw,d,'x'),root=path.join(d,'jobs'),jobDir=path.join(root,'original');fs.mkdirSync(jobDir,{recursive:true});
  const base=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'),buffer=Buffer.concat([base,Buffer.alloc(5_000_001-base.length)]);fs.writeFileSync(cached,buffer);
  const assets=[{source,path:cached,sha256:sha256(buffer),size:buffer.length,width:1,height:1,format:'png'}],state={jobId:'original',pkg,assets,inputFingerprint:sha256(JSON.stringify(pkg)),fingerprint:sha256(JSON.stringify({pkg,media:assets.map(a=>a.sha256)}))},statePath=path.join(jobDir,'state.json'),packagePath=path.join(d,'package.json');fs.writeFileSync(statePath,JSON.stringify(state));fs.writeFileSync(packagePath,JSON.stringify(raw));const before=fs.readFileSync(statePath,'utf8');
  const result=spawnSync(process.execPath,[new URL('../scripts/dynamic.mjs',import.meta.url).pathname,'check','--package',packagePath,'--platform','x','--job-id','original','--state-root',root],{encoding:'utf8',env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:'/not/a/browser',VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(d,'locks')}});
  assert.notEqual(result.status,0,result.stderr);assert.ok(JSON.parse(result.stdout).errors.some(e=>e.includes('5,000,000')));assert.equal(fs.readFileSync(statePath,'utf8'),before);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('Known XHS body overflow is rejected conservatively and topic checks remain explicit pending fields',()=>{
 for(const [length,valid] of [[1000,true],[1001,false]]){const audit=dynamicAudit('xiaohongshu',{text:'a'.repeat(length),tags:['tag'],images:['https://example.com/image.png']},'/tmp');assert.equal(audit.fields.body.errors.length===0,valid);assert.equal(audit.fields.body.unit,'UTF-16 units');assert.equal(audit.fields.body.nativeTopicCountVerified,false);assert.ok(audit.warnings.some(w=>w.includes('entity count')));}

});

test('Empty video and desktop YouTube thumbnail minimum width/strict 50 MB bounds are enforced',()=>{
 const d=dir();try{
  const image=path.join(d,'cover.png'),base=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'),pkg={title:'Title',description:'Body',cover:{uploadCustomCover:true,horizontal16x9Path:image}};
  for(const [width,size,valid] of [[640,base.length,true],[639,base.length,false],[640,50_000_000,false]]){const bytes=Buffer.from(base);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(360,20);fs.writeFileSync(image,bytes);fs.truncateSync(image,size);const audit=videoAudit('youtube',pkg);assert.equal(audit.errors.length===0,valid);}
  assert.ok(videoAudit('bilibili',{title:'Title',description:'Body',tags:['tag']},{media:{exists:true,sizeBytes:0}}).errors.some(e=>e.includes('nonempty')));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('One ASCII XHS title is nonempty even though its weighted length is 0.5; empty and whitespace titles fail',()=>{
 for(const [title,valid] of [['A',true],['',false],[' ',false]]){const audit=videoAudit('xiaohongshu',{title,tags:['tag']});assert.equal(audit.fields.title.errors.length===0,valid);}
});

test('Actual CLI short-title validation belongs only to WeChat and blocks all selected preparation when WeChat fails',()=>{
 const d=dir();try{
  const config=path.join(d,'config.json'),pkg=path.join(d,'package.json'),video=path.join(d,'source.mp4'),root=path.join(d,'jobs'),marker=path.join(d,'browser-calls'),mock=path.join(d,'ego-mock');
  fs.writeFileSync(config,JSON.stringify(createOnboardedConfig({sourceDirectory:d,availablePlatforms:['bilibili','youtube','wechat_channels'],defaultPlatforms:['bilibili'],declarations:{originalityPolicy:'all_videos_original'}})));
  const box=(type,data)=>{const header=Buffer.alloc(8);header.writeUInt32BE(data.length+8);header.write(type,4);return Buffer.concat([header,data]);},mvhd=Buffer.alloc(20);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(14000,16);fs.writeFileSync(video,Buffer.concat([box('ftyp',Buffer.alloc(4)),box('moov',box('mvhd',mvhd))]));
  fs.writeFileSync(pkg,JSON.stringify({type:'video',title:'Title',description:'Body',tags:['tag'],videoPath:video,cover:{uploadCustomCover:false},wechatShortTitle:'短标题'}));
  fs.writeFileSync(mock,`#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'Unexpected browser call');`,{mode:0o700});
  const env={...process.env,PUBLISHER_VIDEO_CONFIG:config,VIDEO_PUBLISHER_V2_EGO_COMMAND:mock,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(d,'locks')};
  for(const platform of ['bilibili','youtube','wechat_channels']){const result=spawnSync(process.execPath,[new URL('../scripts/video.mjs',import.meta.url).pathname,'check',platform,pkg],{encoding:'utf8',env});assert.equal(result.status,platform==='wechat_channels'?1:0,result.stderr);const observed=JSON.parse(result.stdout);assert.equal(observed.effectiveSettings.wechatShortTitle,'短标题');assert.equal(observed.audit.fields.shortTitle!==undefined,platform==='wechat_channels');}
  const run=spawnSync(process.execPath,[new URL('../scripts/publisher.mjs',import.meta.url).pathname,'run','--package',pkg,'--platforms','bilibili,youtube,wechat_channels','--job-id','case','--state-root',root],{encoding:'utf8',env});assert.notEqual(run.status,0,run.stderr);const results=JSON.parse(run.stdout);assert.equal(results.platforms.bilibili.status,'input_checked');assert.equal(results.platforms.youtube.status,'input_checked');assert.equal(results.platforms.wechat_channels.status,'failed');assert.equal(fs.existsSync(marker),false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
