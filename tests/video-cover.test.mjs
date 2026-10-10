import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareVideoCover} from '../scripts/video-cover.mjs';
import {readVideoPackage,resolveDefaults} from '../scripts/video-defaults.mjs';
import {normalizeConfig,createOnboardedConfig} from '../assets/vendor/video-publisher/scripts/lib/config.mjs';
import {getImageDimensions,validateCoverPackage,coverForPlatform} from '../assets/vendor/video-publisher/scripts/lib/content-package.mjs';

test('Video first frame becomes all platform cover assets; cache, custom priority and frozen tasks remain safe',{skip:process.platform!=='darwin'},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-first-frame-')),previous=process.env.PUBLISHER_COVER_CACHE;
 process.env.PUBLISHER_COVER_CACHE=path.join(directory,'cache');
 try{
  const video=path.join(directory,'two colors.mp4'),file=path.join(directory,'package.json');
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:s=320x240:r=1:d=1','-f','lavfi','-i','color=blue:s=320x240:r=1:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-pix_fmt','yuv420p',video],{stdio:'pipe'});
  const raw={title:'Sample',videoPath:video};fs.writeFileSync(file,JSON.stringify(raw));
  const config={...normalizeConfig({}),effectiveDefaults:resolveDefaults()},pkg=readVideoPackage(file,{config});
  assert.equal(pkg.cover.uploadCustomCover,true);assert.equal(pkg.cover.sourceKind,'video_first_frame');
  const pixel=execFileSync('ffmpeg',['-v','error','-i',pkg.cover.sourcePath,'-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  assert.ok(pixel[0]>240&&pixel[1]<10&&pixel[2]<10,'Cover must be the red first frame, not the blue later frame');
  for(const platform of ['xiaohongshu','douyin','bilibili','wechat_channels','youtube']){
   assert.deepEqual(validateCoverPackage(pkg,platform),[]);
   const cover=coverForPlatform(pkg,platform);assert.equal(cover.uploadCustomCover,true);
   assert.ok(Object.entries(cover).some(([key,value])=>key.endsWith('Path')&&fs.existsSync(value)));
  }
  const stamp=fs.statSync(pkg.cover.sourcePath).mtimeMs;
  assert.deepEqual(readVideoPackage(file,{config}),pkg);assert.equal(fs.statSync(pkg.cover.sourcePath).mtimeMs,stamp);
  const frozen={effectivePackage:{...pkg,cover:{uploadCustomCover:false}},packageInput:raw};
  assert.equal(readVideoPackage(file,{config,state:frozen}).cover.uploadCustomCover,false);
  const custom=path.join(directory,'custom.png');fs.copyFileSync(pkg.cover.sourcePath,custom);
  fs.writeFileSync(file,JSON.stringify({...raw,videoPath:'/missing/video.mp4',cover:{uploadCustomCover:true,sourcePath:custom}}));
  const supplied=readVideoPackage(file,{config});assert.equal(supplied.cover.sourcePath,custom);assert.equal(supplied.cover.sourceKind,undefined);
  const invalid=path.join(directory,'invalid.mp4');fs.writeFileSync(invalid,'invalid');
  assert.throws(()=>prepareVideoCover({uploadCustomCover:true},invalid),/Cannot extract/);
  assert.equal(fs.readdirSync(process.env.PUBLISHER_COVER_CACHE).some(name=>name.startsWith('.')),false);
  fs.writeFileSync(file,JSON.stringify(raw));fs.appendFileSync(pkg.cover.sourcePath,'changed');
  assert.throws(()=>readVideoPackage(file,{config}),/cache changed/);
 }finally{if(previous===undefined)delete process.env.PUBLISHER_COVER_CACHE;else process.env.PUBLISHER_COVER_CACHE=previous;fs.rmSync(directory,{recursive:true,force:true});}
});

test('Single cover works in all five platform slots, reuses verified assets and protects frozen source',{skip:process.platform!=='darwin'},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-cover-')),previous=process.env.PUBLISHER_COVER_CACHE;
 process.env.PUBLISHER_COVER_CACHE=path.join(directory,'cache');
 try{
  const source=path.join(directory,'image with spaces.png'),file=path.join(directory,'package.json');
  fs.writeFileSync(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  execFileSync('/usr/bin/sips',['--resampleHeightWidth','600','800',source,'--out',source],{stdio:'pipe'});
  const original=fs.readFileSync(source),raw={title:'Sample',videoPath:'/tmp/video.mp4',cover:{uploadCustomCover:true,sourcePath:source}};
  fs.writeFileSync(file,JSON.stringify(raw));
  const config={...normalizeConfig({}),effectiveDefaults:resolveDefaults()},pkg=readVideoPackage(file,{config});
  assert.deepEqual(fs.readFileSync(source),original);
  for(const platform of ['xiaohongshu','douyin','bilibili','wechat_channels','youtube'])assert.deepEqual(validateCoverPackage(pkg,platform),[]);
  assert.deepEqual(getImageDimensions(pkg.cover.vertical3x4Path),{width:1080,height:1440,format:'png'});
  assert.deepEqual(getImageDimensions(pkg.cover.horizontal4x3Path),{width:1440,height:1080,format:'png'});
  assert.deepEqual(getImageDimensions(pkg.cover.horizontal16x9Path),{width:1920,height:1080,format:'png'});
  const stamp=fs.statSync(pkg.cover.horizontal16x9Path).mtimeMs;
  assert.deepEqual(readVideoPackage(file,{config}),pkg);assert.equal(fs.statSync(pkg.cover.horizontal16x9Path).mtimeMs,stamp);
  const state={effectivePackage:pkg,packageInput:raw};assert.deepEqual(readVideoPackage(file,{config,state}),pkg);
  const video=path.join(directory,'video.mp4'),configFile=path.join(directory,'video.json');
  const box=(type,data)=>{const header=Buffer.alloc(8);header.writeUInt32BE(data.length+8);header.write(type,4);return Buffer.concat([header,data]);},mvhd=Buffer.alloc(20);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(14000,16);fs.writeFileSync(video,Buffer.concat([box('ftyp',Buffer.alloc(4)),box('moov',box('mvhd',mvhd))]));
  const platforms=['xiaohongshu','douyin','bilibili','wechat_channels','youtube'];
  fs.writeFileSync(configFile,JSON.stringify(createOnboardedConfig({sourceDirectory:directory,availablePlatforms:platforms,defaultPlatforms:['youtube'],declarations:{originalityPolicy:'all_videos_original'}})));
  fs.writeFileSync(file,JSON.stringify({...raw,videoPath:video,description:'Example body',tags:['Example'],bilibiliAllowedAutoTags:[]}));
  const report=JSON.parse(execFileSync(process.execPath,[new URL('../scripts/publisher.mjs',import.meta.url).pathname,'check','--package',file,'--platforms',platforms.join(','),'--job-id','cover-check','--state-root',path.join(directory,'jobs')],{env:{...process.env,PUBLISHER_VIDEO_CONFIG:configFile},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal(report.status,'input_checked');
  for(const [platform,item] of Object.entries(report.platforms)){assert.equal(item.conversions.length,1);assert.equal(item.conversions[0].source,source);assert.equal(item.conversions[0].assets.length,['xiaohongshu','youtube'].includes(platform)?1:2);}
  fs.writeFileSync(file,JSON.stringify(raw));
  fs.appendFileSync(source,'changed');assert.throws(()=>readVideoPackage(file,{config,state}),/cover image changed/);
  fs.writeFileSync(source,original);
  fs.appendFileSync(pkg.cover.horizontal16x9Path,'changed');assert.throws(()=>readVideoPackage(file,{config}),/cache changed/);
  assert.equal(fs.readdirSync(process.env.PUBLISHER_COVER_CACHE).some(name=>name.startsWith('.prepare-')),false);
 }finally{if(previous===undefined)delete process.env.PUBLISHER_COVER_CACHE;else process.env.PUBLISHER_COVER_CACHE=previous;fs.rmSync(directory,{recursive:true,force:true});}
});

test('Platform default needs no cover file; invalid or conflicting custom input is rejected',()=>{
 const cover={uploadCustomCover:false};assert.equal(prepareVideoCover(cover),cover);
 assert.throws(()=>prepareVideoCover({uploadCustomCover:true,sourcePath:'relative.png'}),/absolute/);
 assert.throws(()=>prepareVideoCover({uploadCustomCover:true,sourcePath:'/tmp/image.png',vertical3x4Path:'/tmp/other.png'}),/not both/);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-cover-invalid-'));
 try{const file=path.join(directory,'invalid.png');fs.writeFileSync(file,'not an image');assert.throws(()=>prepareVideoCover({uploadCustomCover:true,sourcePath:file}),/JPEG or PNG/);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
