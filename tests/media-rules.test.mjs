import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {videoAudit,dynamicAudit,inspectUploadVideo,reviewMedia,DYNAMIC_RULES} from '../scripts/content-audit.mjs';
import {normalizeDynamic,materializeVideo,materializeImages,sha256} from '../scripts/dynamic-input.mjs';
import {createOnboardedConfig} from '../assets/vendor/video-publisher/scripts/lib/config.mjs';
const fixture=async operation=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'168-media-rules-'));try{return await operation(d);}finally{fs.rmSync(d,{recursive:true,force:true});}};
function mp4(file,seconds){const box=(type,data)=>{const h=Buffer.alloc(8);h.writeUInt32BE(data.length+8);h.write(type,4);return Buffer.concat([h,data]);},mvhd=Buffer.alloc(20);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(seconds*1000,16);fs.writeFileSync(file,Buffer.concat([box('ftyp',Buffer.alloc(4)),box('moov',box('mvhd',mvhd))]));}
function coherent(audit){for(const [severity,list] of [['error',audit.errors],['warning',audit.warnings]])for(const message of list)assert.ok(audit.issues.some(i=>i.severity===severity&&i.message===message),message);assert.ok(audit.issues.every(i=>i.platform===audit.platform&&i.entry===audit.entry));}

test('X duration limit provenance preserves actual probe provenance for known and unknown durations',()=>fixture(d=>{
 const known=path.join(d,'known.mp4'),unknown=path.join(d,'unknown.mp4');mp4(known,4);fs.writeFileSync(unknown,Buffer.from([0,0,0,12,102,116,121,112,0,0,0,0]));
 for(const [file,duration,source] of [[known,4,'iso-bmff-mvhd'],[unknown,null,null]]){const probe=inspectUploadVideo(file),review=reviewMedia('x','dynamic','video',probe);assert.equal(probe.durationSeconds,duration);assert.equal(probe.durationSource,source);assert.equal(review.media.durationSeconds,duration);assert.equal(review.media.durationSource,source);assert.equal(review.media.durationLimitSource,'official_ordinary_post');}
}));

test('Both real CLIs reject the same empty video with a shared scoped issue and no browser invocation',()=>fixture(d=>{
 const video=path.join(d,'empty.mp4'),config=path.join(d,'config.json');fs.writeFileSync(video,'');fs.writeFileSync(config,JSON.stringify(createOnboardedConfig({sourceDirectory:d,availablePlatforms:['xiaohongshu'],defaultPlatforms:['xiaohongshu'],declarations:{originalityPolicy:'all_videos_original'}})));
 for(const type of ['video','dynamic']){const file=path.join(d,type+'.json');fs.writeFileSync(file,JSON.stringify({type,...(type==='video'?{title:'Title',description:'Body'}:{title:'Title',text:'Body'}),tags:['tag'],videoPath:video}));const args=type==='video'?['check','xiaohongshu',file]:['check','--package',file,'--platform','xiaohongshu','--state-root',path.join(d,'jobs')],result=spawnSync(process.execPath,[new URL('../scripts/'+type+'.mjs',import.meta.url).pathname,...args],{encoding:'utf8',env:{...process.env,PUBLISHER_VIDEO_CONFIG:config,VIDEO_PUBLISHER_V2_EGO_COMMAND:'/not/a/browser',VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(d,'locks')}});assert.notEqual(result.status,0);const audit=JSON.parse(result.stdout).audit;assert.ok(audit.issues.some(i=>i.code==='MEDIA_EMPTY'&&i.kind==='video'&&i.field==='video'));coherent(audit);}
}));

test('Same platform keeps entry-specific text and video format constraints instead of inheriting unrelated rules',()=>fixture(d=>{
 const file=path.join(d,'source.mov');mp4(file,14);const pkg={title:'A'.repeat(40),description:'User body',tags:['tag'],wechatShortTitle:'短标题'},video=videoAudit('xiaohongshu',pkg,{media:inspectUploadVideo(file)}),dynamic=dynamicAudit('xiaohongshu',{type:'dynamic',title:pkg.title,text:'User body',tags:['tag'],videoPath:file},d);
 assert.equal(video.fields.title.length,20);assert.equal(video.fields.body.applicable,false);assert.equal(video.errors.length,0);assert.equal(dynamic.fields.title.length,40);assert.equal(dynamic.fields.body.applicable,true);assert.ok(dynamic.issues.some(i=>i.code==='MEDIA_FORMAT'));assert.ok(dynamic.fields.title.errors.length);assert.equal(video.fields.shortTitle,undefined);assert.equal(dynamic.fields.shortTitle,undefined);assert.equal(dynamic.fields.covers,undefined);coherent(video);coherent(dynamic);
}));

test('Dynamic video uses applicable duration rules; recorded X video keeps original identity and unknown rules stay explicit',()=>fixture(async d=>{
 const file=path.join(d,'source.mp4');mp4(file,145);const raw={type:'dynamic',text:'Body',videoPath:file},x=dynamicAudit('x',raw,d),weibo=dynamicAudit('weibo',raw,d),bili=videoAudit('bilibili',{title:'Title',description:'Body',tags:['tag']},{media:inspectUploadVideo(file)});
 assert.ok(x.issues.some(i=>i.code==='MEDIA_DURATION'&&i.limit===140));assert.equal(weibo.errors.length,0);assert.equal(bili.errors.length,0);assert.ok(weibo.issues.some(i=>i.code==='MEDIA_LIMIT_UNKNOWN'));assert.equal(bili.media.maxDurationSeconds,null);
 const pkg=normalizeDynamic(raw,d,'x'),bytes=fs.readFileSync(file),recorded=[{source:file,path:file,size:bytes.length,sha256:sha256(bytes),format:'mp4',kind:'video'}];assert.deepEqual(await materializeVideo(pkg,recorded),recorded);await assert.rejects(materializeVideo(pkg),/140/);
 bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);await assert.rejects(materializeVideo(pkg,recorded),/changed/);
 coherent(x);coherent(weibo);coherent(bili);
}));

test('Shared dynamic title/image thresholds and tag rendering preserve normalized text and gate all targets before preparation',()=>fixture(d=>{
 const raw={type:'dynamic',text:'Original\ntext',tags:['AI'],images:['https://example.com/image.png']};const pkg=normalizeDynamic(raw,d,'weibo'),audit=dynamicAudit('weibo',raw,d);assert.equal(pkg.text,audit.fields.body.value);assert.equal(audit.fields.images.max,DYNAMIC_RULES.weibo.maxImages);
 const many={...raw,images:Array.from({length:DYNAMIC_RULES.xiaohongshu.maxImages+1},(_,i)=>'https://example.com/'+i+'.png')};assert.throws(()=>normalizeDynamic(many,d,'xiaohongshu'),/18/);assert.ok(dynamicAudit('xiaohongshu',many,d).fields.images.errors.length);
 const file=path.join(d,'long.mp4');mp4(file,145);const input=path.join(d,'input.json'),marker=path.join(d,'calls'),ego=path.join(d,'ego');fs.writeFileSync(input,JSON.stringify({type:'dynamic',text:'Body',videoPath:file}));fs.writeFileSync(ego,`#!${process.execPath}\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'unexpected');`,{mode:0o700});const result=spawnSync(process.execPath,[new URL('../scripts/publisher.mjs',import.meta.url).pathname,'run','--package',input,'--platforms','x,weibo','--job-id','case','--state-root',path.join(d,'jobs')],{encoding:'utf8',env:{...process.env,VIDEO_PUBLISHER_V2_EGO_COMMAND:ego,VIDEO_PUBLISHER_V2_LOCK_ROOT:path.join(d,'locks')}});assert.notEqual(result.status,0);const report=JSON.parse(result.stdout);assert.equal(report.platforms.x.status,'failed');assert.equal(report.platforms.weibo.status,'input_checked');assert.equal(fs.existsSync(marker),false);coherent(report.platforms.x.audit);coherent(report.platforms.weibo.audit);
}));

test('Recorded X image preparation keeps original 5 MiB loading contract while first-stage check retains its existing 5 MB gate',()=>fixture(async d=>{
 const file=path.join(d,'image.png'),base=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'),buffer=Buffer.concat([base,Buffer.alloc(5_000_001-base.length)]);fs.writeFileSync(file,buffer);const pkg={platform:'x',sources:[file]},recorded=[{source:file,path:file,size:buffer.length,sha256:sha256(buffer),width:1,height:1,format:'png'}];assert.deepEqual(await materializeImages(pkg,path.join(d,'assets'),recorded),recorded);await assert.rejects(materializeImages(pkg,path.join(d,'assets')),/5,000,000/);
 const audit=dynamicAudit('x',{type:'dynamic',text:'Body',images:[file]},d);assert.ok(audit.issues.some(i=>i.code==='MEDIA_SIZE'));coherent(audit);
}));
