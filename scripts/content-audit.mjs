import fs from 'node:fs';
import {parseTweet} from '../assets/twitter-text/bundle.mjs';
import path from 'node:path';
import {coverAssetsForPlatform,getImageDimensions} from '../assets/vendor/video-publisher/scripts/lib/content-package.mjs';
import {inspectMediaFile} from '../assets/vendor/video-publisher/scripts/lib/media.mjs';

const points=value=>[...value].length;
export const DYNAMIC_RULES=Object.freeze({x:Object.freeze({maxImages:4,maxImageBytes:5_000_000,maxBody:280}),weibo:Object.freeze({maxImages:9,maxImageBytes:5*1024**2}),xiaohongshu:Object.freeze({maxImages:18,maxImageBytes:5*1024**2,maxTitle:20,maxBody:1000}),jike:Object.freeze({maxImages:9,maxImageBytes:5*1024**2})});
export function dynamicBody(platform,text,tags=[]){return platform==='xiaohongshu'||!tags.length?text:text+'\n\n'+tags.map(t=>'#'+t+(platform==='weibo'?'#':'')).join(' ');}
export function dynamicTagErrors(tags){
 if(!Array.isArray(tags)||tags.some(t=>typeof t!=='string'||!/^#?[^\s#]+$/u.test(t)))return ['tags must be an array of nonempty hashtag names without spaces; split user input only on 、'];
 return new Set(tags.map(t=>t.replace(/^#/,''))).size!==tags.length?['Duplicate tags']:[];
}
export function mediaRules(platform,entry,kind){
 const rules={platform,entry,kind,maxBytes:null,maxDurationSeconds:null,minDurationSeconds:null,extensions:null,source:'program'};
 if(kind==='video'){
  if(entry==='dynamic')Object.assign(rules,{extensions:['.mp4'],maxBytes:platform==='jike'?100*1024**2:512_000_000,requireMp4Header:true});
  if(entry==='dynamic'&&platform==='x')Object.assign(rules,{minDurationSeconds:0,minExclusive:true,maxDurationSeconds:140,requireDuration:true,durationLimitSource:'official_ordinary_post'});
  if(entry==='dynamic'&&platform==='jike')Object.assign(rules,{minDurationSeconds:3,maxDurationSeconds:360,requireDuration:true,maxShortEdge:1080,maxLongEdge:1920});
  if(entry==='video'&&platform==='douyin')Object.assign(rules,{extensions:['.mp4','.m4v','.mov'],minDurationSeconds:0,minExclusive:true,requireDuration:true});
  if(entry==='video'&&platform==='youtube')Object.assign(rules,{maxBytes:256_000_000_000,maxDurationSeconds:43200,source:'official_absolute_limit'});
 }else if(kind==='image'&&entry==='dynamic')Object.assign(rules,{maxBytes:DYNAMIC_RULES[platform]?.maxImageBytes??null,formats:['png','jpeg']});
 else if(kind==='cover'&&entry==='video'&&platform==='youtube')Object.assign(rules,{maxBytes:50_000_000,maxBytesExclusive:true,minWidth:640,source:'official_desktop_thumbnail'});
 return rules;
}
export function inspectUploadVideo(file){
 const media=inspectMediaFile(file);
 if(media.exists){const handle=fs.openSync(media.path,'r'),header=Buffer.alloc(12);try{fs.readSync(handle,header,0,header.length,0);media.mp4Header=header.toString('ascii',4,8)==='ftyp';}finally{fs.closeSync(handle);}}
 return media;
}
export function reviewMedia(platform,entry,kind,media,{field=kind,requireDuration,requireFile=true,legacy=false}={}){
 const rules=mediaRules(platform,entry,kind),errors=[],warnings=[],issues=[];
 const add=(severity,code,message,actual=null,limit=null)=>{const text=field+': '+message;(severity==='error'?errors:warnings).push(text);issues.push({platform,entry,field,kind,severity,code,message:text,actual,limit,source:rules.source});};
 if(legacy&&entry==='dynamic'&&platform==='x'){if(kind==='image')rules.maxBytes=5*1024**2;if(kind==='video'){rules.minDurationSeconds=null;rules.maxDurationSeconds=null;}}
 const observed={...media,...rules,...(legacy?{historicalContract:true}:{})};
 if(rules.maxShortEdge){observed.dimensions=null;observed.dimensionsVerified=false;add('warning','MEDIA_DIMENSIONS_UNVERIFIED','Jike video dimensions (short edge <=1080, long edge <=1920) require native editor verification; local dimensions not parsed');}
 if(requireFile&&media?.exists!==true)add('error','MEDIA_MISSING','local file missing or not a regular file');
 if(media?.exists){
  if(!(media.sizeBytes>0))add('error','MEDIA_EMPTY','local file must be nonempty',media.sizeBytes,0);
  if(rules.maxBytes!==null&&(rules.maxBytesExclusive?media.sizeBytes>=rules.maxBytes:media.sizeBytes>rules.maxBytes))add('error','MEDIA_SIZE','size exceeds '+(rules.maxBytesExclusive?'strict ':'')+rules.maxBytes.toLocaleString('en-US')+' bytes',media.sizeBytes,rules.maxBytes);
  if(rules.extensions&&!rules.extensions.includes(path.extname(media.path||'').toLowerCase()))add('error','MEDIA_FORMAT','use '+rules.extensions.join('/')+' source',path.extname(media.path||''),rules.extensions);
  if(rules.requireMp4Header&&media.mp4Header!==true)add('error','MEDIA_CONTAINER','Unreadable MP4 container; no automatic conversion');
  if(kind==='video'){
   const duration=media.durationSeconds,known=Number.isFinite(duration),required=requireDuration??rules.requireDuration;
   if(!known){if(required)add('error','MEDIA_DURATION_UNVERIFIED','duration must be verifiable');else add('warning','MEDIA_DURATION_UNVERIFIED','Video duration could not be verified; duration limits remain unchecked');}
   else{
    if(rules.minDurationSeconds!==null&&(rules.minExclusive?duration<=rules.minDurationSeconds:duration<rules.minDurationSeconds))add('error','MEDIA_DURATION','duration is below '+(rules.minExclusive?'exclusive ':'')+rules.minDurationSeconds+' seconds',duration,rules.minDurationSeconds);
    if(rules.maxDurationSeconds!==null&&duration>rules.maxDurationSeconds)add('error','MEDIA_DURATION','duration exceeds '+rules.maxDurationSeconds+' seconds',duration,rules.maxDurationSeconds);
   }
   if(entry==='video'&&platform==='youtube'&&known&&duration>900)add('warning','ACCOUNT_VERIFICATION','YouTube videos over 15 minutes require account verification; not checked locally');
   if(rules.maxDurationSeconds===null||rules.maxBytes===null)add('warning','MEDIA_LIMIT_UNKNOWN','platform size/duration limits not fully confirmed for this publication entry');
  }
  if(rules.formats&&media.format&&!rules.formats.includes(media.format))add('error','MEDIA_FORMAT','Only readable PNG/JPEG images are currently implemented',media.format,rules.formats);
  if(rules.minWidth&&media.width<rules.minWidth)add('error','MEDIA_DIMENSIONS','minimum width is '+rules.minWidth+' pixels',media.width,rules.minWidth);
 }
 return {media:observed,errors,warnings,issues};
}
function issueFor(platform,entry,severity,message){const field=message.match(/^([\w[\].-]+):/)?.[1]??'content';return {platform,entry,field,kind:field.startsWith('images')?'image':field==='cover'||field==='covers'?'cover':field==='video'?'video':null,severity,code:severity==='error'?'CONTENT_INVALID':'REVIEW_REQUIRED',message,source:'program'};}
export function addAuditErrors(audit,errors,issues=[]){
 audit.issues.push(...issues.filter(i=>!audit.issues.some(old=>old.severity===i.severity&&old.message===i.message)));
 for(const error of errors)if(!audit.errors.includes(error)){audit.errors.push(error);if(!audit.issues.some(i=>i.severity==='error'&&i.message===error))audit.issues.push(issueFor(audit.platform,audit.entry,'error',error));}
 audit.status=audit.errors.length?'failed':'input_checked';return audit;
}

export function auditField(value,{required=false,min=required?1:0,max=null,unit='Unicode code points',applicable=true,source='program',count}={}){
 const length=typeof value==='string'?(count?count(value):unit==='UTF-16 units'?value.length:points(value)):Array.isArray(value)?value.length:null;
 const errors=[];
 if(applicable){
  if(value!==undefined&&value!==null&&(unit==='items'?!Array.isArray(value):typeof value!=='string'))errors.push('Invalid field type');
  if(required&&(length===null||typeof value==='string'&&!value.trim()||length===0))errors.push('Required value missing');
  if(length!==null&&length>0&&length<min)errors.push(`Length ${length} is below ${min}`);
  if(length!==null&&max!==null&&length>max)errors.push(`Length ${length} exceeds ${max}`);
 }
 return {value:value??null,length,required,min,max,unit,applicable,source,errors};
}
export function finishAudit(platform,fields,{errors=[],warnings=[],media=null,entry=null,issues=[]}={}){
 errors=[...Object.entries(fields).flatMap(([key,field])=>field.errors.map(error=>`${key}: ${error}`)),...errors];
 errors=[...new Set(errors)];warnings=[...new Set(warnings)];
 const known=new Set(issues.map(i=>i.severity+'|'+i.message));
 issues=[...issues,...errors.filter(m=>!known.has('error|'+m)).map(m=>issueFor(platform,entry,'error',m)),...warnings.filter(m=>!known.has('warning|'+m)).map(m=>issueFor(platform,entry,'warning',m))];
 return {platform,entry,status:errors.length?'failed':'input_checked',scope:'supported_program_rules',fields,media,errors,warnings,issues};
}
export function videoAudit(platform,pkg,{media=null,errors=[]}={}){
 const reviews=[];
 if(media){const review=reviewMedia(platform,'video','video',media);reviews.push(review);media=review.media;errors.push(...review.errors);}
 const title=pkg.platformTitle?.[platform]??pkg.title;
 const descriptions={douyin:'douyinDescription',bilibili:'bilibiliDescription',wechat_channels:'wechatDescription',youtube:'youtubeDescription'};
 const tags={xiaohongshu:'xhsTopics',douyin:'douyinTopics',bilibili:'bilibiliTags',wechat_channels:'wechatTags',youtube:'youtubeTags'};
 const fields={
  title:auditField(title,{required:true,max:{xiaohongshu:20,douyin:30,bilibili:80,youtube:100}[platform]??null,...(platform==='xiaohongshu'?{min:0,unit:'ASCII 0.5 / other code point 1',count:v=>[...v].reduce((n,c)=>n+(c.codePointAt(0)<=127?0.5:1),0)}:{})}),
  body:auditField(pkg[descriptions[platform]]??pkg.description??'',{required:['bilibili','wechat_channels','youtube'].includes(platform),max:platform==='youtube'?5000:null,applicable:platform!=='xiaohongshu'}),
  tags:auditField(pkg[tags[platform]]??pkg.tags??[],{required:platform!=='youtube',max:{douyin:5,bilibili:10}[platform]??null,unit:'items'}),
 };
 if(Array.isArray(fields.tags.value)&&fields.tags.value.some(t=>typeof t!=='string'))fields.tags.errors.push('Each tag must be a string');
 if(platform==='youtube')fields.tags={...fields.tags,serializedLength:Array.isArray(fields.tags.value)?fields.tags.value.join(',').length:null,serializedMax:500,serializedUnit:'UTF-16 units'};
 if(platform==='youtube'&&fields.tags.serializedLength>500)fields.tags.errors.push('Serialized tags exceed 500 UTF-16 units');
 if(platform==='wechat_channels')fields.shortTitle=auditField(pkg.wechatShortTitle??'',{min:6,unit:'Unicode code points'});
 if(pkg.cover?.uploadCustomCover===true){
  const assets=coverAssetsForPlatform(pkg,platform);
  fields.covers=auditField(assets.map(a=>a.path),{unit:'items'});
  for(const asset of assets)try{const stat=fs.statSync(asset.path),dimensions=getImageDimensions(asset.path),review=reviewMedia(platform,'video','cover',{path:asset.path,exists:stat.isFile(),sizeBytes:stat.size,...dimensions},{field:'cover'});reviews.push(review);errors.push(...review.errors);}catch(e){errors.push('cover '+asset.slot+': '+e.message);}
 }
 const warnings=['Unknown platform limits and account-dependent rules require review in the original editor'];
 if(platform==='xiaohongshu')warnings.push('Video adapter does not write a body; shared description is not applicable');
 if(platform==='wechat_channels')warnings.push('Shared title identifies the task; only shortTitle maps to the optional native title');
 warnings.push(...reviews.flatMap(r=>r.warnings));
 return finishAudit(platform,fields,{errors,warnings,media,entry:'video',issues:reviews.flatMap(r=>r.issues)});
}
export function rawVideoAudit(platform,raw,defaults={},options={}){
 const p={...defaults,...raw};
 p.platformTitle={[platform]:raw[{xiaohongshu:'xhsTitle',douyin:'douyinTitle',bilibili:'bilibiliTitle',wechat_channels:'wechatTitle',youtube:'youtubeTitle'}[platform]]??(platform==='xiaohongshu'?raw.xiaohongshuTitle:platform==='wechat_channels'?raw.wechatChannelsTitle:undefined)??raw.title};
 return videoAudit(platform,p,options);
}
export function dynamicAudit(platform,raw,directory,{legacy=false}={}){
 const p={...raw,...(raw.platforms?.[platform]&&typeof raw.platforms[platform]==='object'?raw.platforms[platform]:{})},tags=p.tags??[],images=p.images??[];
 const normalized=Array.isArray(tags)?tags.map(t=>typeof t==='string'?t.replace(/^#/,''):t):tags;
 const body=typeof p.text==='string'&&platform!=='xiaohongshu'&&Array.isArray(normalized)&&normalized.every(t=>typeof t==='string')?dynamicBody(platform,p.text,normalized):p.text;
 const fields={body:auditField(body,{required:true}),tags:auditField(tags,{unit:'items'}),images:auditField(images,{max:DYNAMIC_RULES[platform]?.maxImages,unit:'items'})};
 fields.images.maxBytesPerImage=DYNAMIC_RULES[platform]?.maxImageBytes;
 if(platform==='x'){
  const parsed=typeof body==='string'?parseTweet(body):null;
  fields.body=auditField(body,{required:true,max:DYNAMIC_RULES.x.maxBody,unit:'twitter-text v3 weighted units',count:v=>parseTweet(v).weightedLength,source:'official_twitter_text_v3'});
  if(parsed&&!parsed.valid&&parsed.weightedLength<=DYNAMIC_RULES.x.maxBody)fields.body.errors.push('Contains invalid characters under twitter-text v3');
 }
 if(platform==='xiaohongshu')fields.title=auditField(p.title??'',{max:DYNAMIC_RULES.xiaohongshu.maxTitle,unit:'UTF-16 units'});
 if(platform==='xiaohongshu'){fields.body=auditField(body,{required:true,max:DYNAMIC_RULES.xiaohongshu.maxBody,unit:'UTF-16 units',source:'conservative_program_limit'});fields.body.nativeTopicCountVerified=false;}
 const errors=[],warnings=['Unknown platform limits and account-dependent rules require review in the original editor'];
 if(typeof p.text==='string'&&(!p.text.trim()||p.text.includes('\0')))errors.push('body: user body must be nonempty and without NUL');
 errors.push(...dynamicTagErrors(tags).map(error=>'tags: '+error));
 if(!Array.isArray(images)||images.some(v=>typeof v!=='string'||!v))errors.push('images: expected file paths or public HTTPS URLs');
 if(p.videoPath!==undefined&&Array.isArray(images)&&images.length)errors.push('media: choose images or one video, not both');
 if(p.videoPath===undefined&&(!Array.isArray(images)||!images.length))errors.push('media: at least one image or one local MP4 is required');
 if(platform==='xiaohongshu')warnings.push('1000 UTF-16 body units is a conservative program limit; native topic entity count and final descLength require editor verification');
 let media=null;const reviews=[];
 if(p.videoPath!==undefined){
  if(typeof p.videoPath!=='string'||!p.videoPath||/^[a-z][a-z0-9+.-]*:/i.test(p.videoPath))errors.push('video: expected a local MP4 path');
  else{try{const review=reviewMedia(platform,'dynamic','video',inspectUploadVideo(path.resolve(directory,p.videoPath)));media=review.media;reviews.push(review);errors.push(...review.errors);warnings.push(...review.warnings);}catch(e){errors.push('video: '+e.message);}}
 }
 for(const [i,file] of (Array.isArray(images)?images:[]).entries())if(typeof file==='string'&&!/^[a-z][a-z0-9+.-]*:/i.test(file)){try{const stat=fs.statSync(path.resolve(directory,file)),review=reviewMedia(platform,'dynamic','image',{path:file,exists:stat.isFile(),sizeBytes:stat.size},{field:`images[${i}]`});reviews.push(review);errors.push(...review.errors);}catch(e){errors.push(`images[${i}]: ${e.code||e.message}`);}}

 if(legacy){const historicalIssues=[...errors,...Object.entries(fields).flatMap(([key,f])=>f.errors.map(e=>key+': '+e))];for(const field of Object.values(fields)){field.warnings=field.errors;field.errors=[];field.enforced=false;}const audit=finishAudit(platform,fields,{warnings:[...warnings,...historicalIssues.map(e=>'Historical input: '+e),'Historical task check preserves original input and media identity; new-task constraints are not reapplied'],media,entry:'dynamic'});audit.scope='historical_identity_review';return audit;}
 return finishAudit(platform,fields,{errors,warnings,media,entry:'dynamic',issues:reviews.flatMap(r=>r.issues)});
}
