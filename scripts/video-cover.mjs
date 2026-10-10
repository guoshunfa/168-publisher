import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {getImageDimensions} from '../assets/vendor/video-publisher/scripts/lib/content-package.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const slots={vertical3x4Path:[1080,1440],horizontal4x3Path:[1440,1080],horizontal16x9Path:[1920,1080]};

export function assertCoverSource(cover){
  if(cover?.sourcePath&&cover.sourceSha256&&digest(fs.readFileSync(cover.sourcePath))!==cover.sourceSha256)throw new Error('Original cover image changed; keep the confirmed source for this task');
}

function firstFrameSource(videoPath){
  if(typeof videoPath!=='string'||!path.isAbsolute(videoPath)||!fs.statSync(videoPath).isFile())throw new Error('First-frame cover requires a local absolute video path');
  const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(videoPath,'r');
  try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,count));}finally{fs.closeSync(fd);}
  const cache=process.env.PUBLISHER_COVER_CACHE||path.join(os.homedir(),'.168-publisher','cover-cache');
  const directory=path.join(cache,'first-frame-v1-'+hash.digest('hex')),source=path.join(directory,'source.png');
  if(fs.existsSync(directory)){
    const receipt=JSON.parse(fs.readFileSync(path.join(directory,'receipt.json'),'utf8'));
    if(digest(fs.readFileSync(source))!==receipt.sha256)throw new Error('First-frame cover cache changed; refusing to replace task assets');
    return source;
  }
  fs.mkdirSync(cache,{recursive:true,mode:0o700});
  const stage=fs.mkdtempSync(path.join(cache,'.first-frame-'));
  try{
    const output=path.join(stage,'source.png');
    try{execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-i',videoPath,'-map','0:v:0','-frames:v','1','-update','1',output],{stdio:'pipe',timeout:30000});}
    catch(error){throw new Error('Cannot extract video first-frame cover; install FFmpeg or provide a JPEG/PNG cover: '+(error.stderr?.toString().trim()||error.message));}
    const dimensions=getImageDimensions(output);
    if(!dimensions.width||!dimensions.height)throw new Error('Video first frame is not a readable image');
    fs.chmodSync(output,0o600);
    fs.writeFileSync(path.join(stage,'receipt.json'),JSON.stringify({sha256:digest(fs.readFileSync(output))}),{mode:0o600});
    fs.renameSync(stage,directory);
    return source;
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}

export function prepareVideoCover(cover,videoPath){
  const hasRatio=Object.keys(slots).some(key=>cover?.[key])||Object.values(cover?.platforms||{}).some(value=>Object.keys(slots).some(key=>value?.[key]));
  if(cover?.uploadCustomCover&&cover.sourcePath===undefined&&!hasRatio)cover={...cover,sourcePath:firstFrameSource(videoPath),sourceKind:'video_first_frame'};
  if(!cover?.uploadCustomCover||cover.sourcePath===undefined)return cover;
  const source=cover.sourcePath;
  if(typeof source!=='string'||!path.isAbsolute(source))throw new Error('cover.sourcePath must be an absolute image path');
  if(Object.keys(slots).some(key=>cover[key])||Object.values(cover.platforms||{}).some(value=>Object.keys(slots).some(key=>value?.[key])))throw new Error('Use one cover.sourcePath or explicit ratio covers, not both');
  if(!fs.statSync(source).isFile())throw new Error('Cover must be a local image file');
  const bytes=fs.readFileSync(source),dimensions=getImageDimensions(source);
  if(!['png','jpeg'].includes(dimensions.format)||!dimensions.width||!dimensions.height)throw new Error('Cover must be a readable JPEG or PNG image');
  const sourceSha256=digest(bytes),cache=process.env.PUBLISHER_COVER_CACHE||path.join(os.homedir(),'.168-publisher','cover-cache');
  const directory=path.join(cache,'contain-v1-'+sourceSha256),receiptPath=path.join(directory,'receipt.json');
  const result=receipt=>({...cover,sourceSha256,adaptation:'contain_black_padding_no_upscale',...Object.fromEntries(Object.keys(slots).map(key=>[key,path.join(directory,receipt.files[key].name)]))});
  if(fs.existsSync(directory)){
    const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    for(const key of Object.keys(slots)){
      const file=receipt.files?.[key];
      if(file?.name!==key+'.png'||digest(fs.readFileSync(path.join(directory,file.name)))!==file.sha256)throw new Error('Prepared cover cache changed; refusing to replace task assets');
    }
    return result(receipt);
  }
  fs.mkdirSync(cache,{recursive:true,mode:0o700});
  const stage=fs.mkdtempSync(path.join(cache,'.prepare-'));
  try{
    const input=path.join(stage,'source.'+(dimensions.format==='jpeg'?'jpg':'png'));
    fs.writeFileSync(input,bytes,{mode:0o600});
    const receipt={sourceSha256,files:{}};
    for(const [key,[width,height]] of Object.entries(slots)){
      const scale=Math.min(1,width/dimensions.width,height/dimensions.height);
      const w=Math.max(1,Math.round(dimensions.width*scale)),h=Math.max(1,Math.round(dimensions.height*scale)),output=path.join(stage,key+'.png');
      // Keep the whole supplied image; ratio slots must never crop its text or subject.
      execFileSync('/usr/bin/sips',['-s','format','png','--resampleHeightWidth',String(h),String(w),'--padToHeightWidth',String(height),String(width),'--padColor','000000',input,'--out',output],{stdio:'pipe',timeout:30000});
      const actual=getImageDimensions(output);
      if(actual.width!==width||actual.height!==height)throw new Error('Cover adaptation did not produce the required dimensions');
      fs.chmodSync(output,0o600);receipt.files[key]={name:key+'.png',sha256:digest(fs.readFileSync(output))};
    }
    fs.rmSync(input);
    fs.writeFileSync(path.join(stage,'receipt.json'),JSON.stringify(receipt),{mode:0o600});
    fs.renameSync(stage,directory);
    return result(receipt);
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
