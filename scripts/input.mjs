import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {configuration} from './settings.mjs';
import {loadVideoConfig,withEffectivePackage} from './video-defaults.mjs';
import {readJson,writeJson} from './runtime.mjs';
import {acquireJobLock} from '../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs';

export const platformNames={x:'X',weibo:'微博',xiaohongshu:'小红书',jike:'即刻',douyin:'抖音',bilibili:'B站',wechat_channels:'视频号',youtube:'YouTube'};
const aliases={x:'x',weibo:'weibo','微博':'weibo',xiaohongshu:'xiaohongshu','小红书':'xiaohongshu',jike:'jike','即刻':'jike',douyin:'douyin','抖音':'douyin',bilibili:'bilibili','b站':'bilibili',wechat_channels:'wechat_channels','wechat channels':'wechat_channels','视频号':'wechat_channels',youtube:'youtube'};
const fieldNames={'是否全自动':'autoPublish','auto publish':'autoPublish','类型':'type',type:'type','标题':'title',title:'title','正文':'body',body:'body','内容':'content','标签':'tags',tags:'tags','媒体':'media',media:'media','封面':'cover',cover:'cover','平台':'platforms',platforms:'platforms',profile:'profile','视频号短标题':'shortTitle','wechat short title':'shortTitle','儿童受众':'audience','youtube儿童受众':'audience','youtube audience':'audience','ai生成':'aiGenerated','ai generated':'aiGenerated','原创':'original',original:'original'};
const videoTitles={xiaohongshu:'xhsTitle',douyin:'douyinTitle',bilibili:'bilibiliTitle',wechat_channels:'wechatTitle',youtube:'youtubeTitle'};
const videoBodies={douyin:'douyinDescription',bilibili:'bilibiliDescription',wechat_channels:'wechatDescription',youtube:'youtubeDescription'};
const videoTags={xiaohongshu:'xhsTopics',douyin:'douyinTopics',bilibili:'bilibiliTags',wechat_channels:'wechatTags',youtube:'youtubeTags'};
const none=value=>/^(无|none)$/i.test(value.trim());
const typeOf=value=>({'视频':'video',video:'video','动态':'dynamic',post:'dynamic',dynamic:'dynamic'})[value?.trim().toLowerCase()];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validJob=id=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,55}$/.test(id);

function fieldName(label){
 const name=label.trim().toLowerCase();
 if(Object.hasOwn(fieldNames,name))return fieldNames[name];
 for(const [alias,platform] of Object.entries(aliases))for(const [suffix,field] of Object.entries({'标题':'title','正文':'body','简介':'body','标签':'tags',' title':'title',' body':'body',' tags':'tags'}))if(name===alias+suffix)return platform+'.'+field;
}

export function parseTemplate(text,settings,registry){
 if(typeof text!=='string'||text.includes('\0'))throw new Error('输入必须是不含 NUL 的文本');
 const fields={},errors=[];let current;
 for(const line of text.replaceAll('\r\n','\n').replace(/\n$/,'').split('\n')){
  const match=line.match(/^([^：:]{1,40})[：:](.*)$/),name=match&&fieldName(match[1]);
  if(name){
   if(Object.hasOwn(fields,name))errors.push('字段重复：'+match[1]);
   current=name;fields[name]??=[];const value=match[2].replace(/^ /,'');if(value)fields[name].push(value);
  }else if(current)fields[current].push(line);
  else if(line.trim()&&!/^\$168-publisher(?:-pro)?$/.test(line.trim()))errors.push('无法识别模板行：'+line);
 }
 const get=name=>(fields[name]||[]).join('\n');
 if(fields.content){
  if(!fields.type&&fields.body&&typeOf(get('content')))fields.type=fields.content;
  else if(fields.body)errors.push('内容与正文重复，请只保留一个正文字段');
  else fields.body=fields.content;
  delete fields.content;
 }
 const autoValue=get('autoPublish').trim();
 if(fields.autoPublish&&!['是','否','yes','no'].includes(autoValue.toLowerCase()))errors.push('是否全自动：只能填写“是”或“否”');
 const autoPublish=['是','yes'].includes(autoValue.toLowerCase());
 const type=typeOf(get('type'));if(!type||!registry[type])throw new Error('类型：请明确填写视频或动态');
 const platformsText=get('platforms').trim(),all=!platformsText||/^(所有|所有平台|全部|all platforms)$/i.test(platformsText);
 const platforms=all?[...(settings.platforms[type]||[])]:platformsText.split('、').map(value=>aliases[value.trim().toLowerCase()]);
 if(!platforms.length||platforms.some(p=>!registry[type].platforms.includes(p))||new Set(platforms).size!==platforms.length)throw new Error('平台：目标为空、重复或不支持该类型，请明确选择');
 const profileText=get('profile').trim(),profile=!profileText||/^(默认|default)$/i.test(profileText)?settings.profile:profileText;
 for(const [name,lines] of Object.entries(fields))if(!['body','media'].includes(name)&&!name.endsWith('.body')&&lines.length>1)errors.push('字段必须在一行内：'+name);
 const parseTags=(value,name)=>{
  const tags=none(value)?[]:value.split('、').map(t=>t.trim());
  if(tags.some(t=>!t)||new Set(tags).size!==tags.length)errors.push(name+'：不允许空项或重复项，仅用顿号分隔');
  return tags;
 };
 const body=type==='video'&&none(get('body'))?'':get('body'),tags=fields.tags?parseTags(get('tags'),'标签'):[];
 if(!fields.tags)errors.push('标签：请填写标签，或明确写“无”');
 const pkg=type==='video'?{type,title:get('title'),description:body,tags,bilibiliAllowedAutoTags:[]}:{type,text:body,tags};
 if(type==='dynamic'&&get('title')&&!none(get('title'))){if(platforms.includes('xiaohongshu'))pkg.platforms={xiaohongshu:{title:get('title')}};else errors.push('动态独立标题仅支持已选择的小红书');}
 const media=get('media').split('\n').map(v=>v.trim().replace(/^(['"])(\/.*)\1$/, '$2')).filter(Boolean),videos=media.filter(v=>/\.(mp4|m4v|mov)$/i.test(v)),images=media.filter(v=>/\.(png|jpe?g)$/i.test(v));
 if(media.some(v=>!path.isAbsolute(v)))errors.push('媒体：每行必须是一个完整的本地绝对路径');
 if(media.length!==videos.length+images.length||videos.length>1||videos.length&&images.length||type==='video'&&media.length&&videos.length!==1)errors.push('媒体：只支持一段视频或动态的多张 JPEG/PNG，不得混选');
 if(videos.length===1&&!images.length)pkg.videoPath=videos[0];else if(type==='dynamic')pkg.images=images;
 if(type==='video')pkg.cover={uploadCustomCover:true};
 if(fields.cover){
  const cover=get('cover').trim();
  if(!cover||/^(默认|default)$/i.test(cover)){if(type==='video')pkg.cover={uploadCustomCover:true};}
  else if(type==='dynamic')errors.push('动态不支持自定义封面');
  else if(!path.isAbsolute(cover)||!/\.(png|jpe?g)$/i.test(cover))errors.push('封面：必须为本地 JPEG/PNG 的绝对路径或“默认”');
  else pkg.cover={uploadCustomCover:true,sourcePath:cover};
 }
 if(fields.shortTitle){if(type!=='video'||!platforms.includes('wechat_channels'))errors.push('视频号短标题仅用于已选择的视频号视频');else pkg.wechatShortTitle=get('shortTitle');}
 if(fields.audience){const value=get('audience').trim(),audience={'面向儿童':'made_for_kids','非面向儿童':'not_made_for_kids',made_for_kids:'made_for_kids',not_made_for_kids:'not_made_for_kids'}[value];if(type!=='video'||!platforms.includes('youtube')||!audience)errors.push('儿童受众：请选择 YouTube 视频，并填写“面向儿童”或“非面向儿童”');else pkg.youtubeAudience=audience;}
 for(const name of ['original','aiGenerated'])if(fields[name]){const value=get(name).trim().toLowerCase();if(type!=='video'||!['是','否','true','false','原创','非原创'].includes(value))errors.push(name+'：仅支持视频的明确是/否值');else pkg[name]=['是','true','原创'].includes(value);}
 for(const name of Object.keys(fields).filter(n=>n.includes('.'))){
  const [platform,field]=name.split('.'),value=field==='tags'?parseTags(get(name),name):get(name);
  if(!platforms.includes(platform)){errors.push('未选择平台的专属字段：'+name);continue;}
  if(type==='video'){
   const key={title:videoTitles,body:videoBodies,tags:videoTags}[field][platform];
   if(!key){errors.push('该入口不支持字段：'+name);continue;}
   pkg[key]=field==='body'&&none(value)?'':value;
  }else if(field==='title'&&platform!=='xiaohongshu')errors.push('动态独立标题仅支持小红书');
  else{pkg.platforms??={};pkg.platforms[platform]??={};pkg.platforms[platform][field==='body'?'text':field]=field==='title'&&none(value)?'':value;}
 }
 if(type==='video'&&platforms.length===1&&platforms[0]==='xiaohongshu'&&body)errors.push('小红书独立视频不写正文；请确认不使用正文后将正文填“无”');
 return {pkg,platforms,profile,autoPublish,errors:[...new Set(errors)]};
}

// The stored request owns package, platform order and defaults; continuation must not reconstruct them from new settings.
export function expandRequest(argv,{registry,stateHome,configFile}){
 const [command,...args]=argv;
 if(args.includes('--package')||command==='config')return {argv};
 if(!['preflight','check','run','inspect','handoff','report'].includes(command))return {argv};
 const values={},flags=[];
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(['--resume-control','--confirm-original-rights','--confirm-manual-send'].includes(key)){if(flags.includes(key))throw new Error('Duplicate flag: '+key);flags.push(key);continue;}
  if(!['--input','--job-id','--state-root'].includes(key)||values[key]!==undefined)throw new Error('Unsupported or duplicate option: '+key);
  const value=args[++i];if(!value||value.startsWith('--'))throw new Error(key+' requires a value');values[key]=value;
 }
 if(values['--input']&&!['preflight','check'].includes(command))throw new Error('--input 仅用于 preflight 或 check；确认后按原 Job ID 运行');
 if(command==='report'&&flags.length)throw new Error('report 只读保存结果，不接受执行确认参数');
 const id=values['--job-id']||(values['--input']?'req-'+randomUUID():null);
 if(!id||!validJob(id))throw new Error('需要有效的原 Job ID，或用 --input 创建请求');
 const directory=path.join(stateHome,'.requests',id),file=path.join(directory,'request.json');
 const release=acquireJobLock(directory+'.lock',{jobId:id});
 try{
  const previous=fs.existsSync(file)?readJson(file):null;
  let context=previous;
  if(previous?.videoConfigPath&&!isDeepStrictEqual(readJson(previous.videoConfigPath),previous.videoConfig))throw new Error('原视频配置快照已改变；拒绝按原确认继续');
  if(previous&&digest(readJson(previous.packagePath))!==previous.packageDigest)throw new Error('原内容包已改变；拒绝按原确认继续');
  if(previous&&values['--state-root']&&path.resolve(values['--state-root'])!==previous.scope.stateRoot)throw new Error('原请求的状态目录不可改变');
  if(values['--input']){
   const sessionFile=previous&&path.join(previous.scope.stateRoot,'.runs',id+'.json');
   if(previous?.locked||sessionFile&&fs.existsSync(sessionFile)&&readJson(sessionFile).fingerprint)throw new Error('已开始配置的请求不可改包；使用原 Job ID 恢复');
   const settings=previous?.settings||configuration(configFile,registry).configuration;
   const text=fs.readFileSync(values['--input']==='-'?0:path.resolve(values['--input']),'utf8');
   const parsed=parseTemplate(text,settings,registry);
   const video=parsed.pkg.type==='video'?(previous?.videoConfig||loadVideoConfig()):null;
   const pkg=video?withEffectivePackage(parsed.pkg,video):parsed.pkg;
   const scope={type:pkg.type,platforms:parsed.platforms,profile:parsed.profile,stateRoot:path.resolve(previous?.scope.stateRoot||values['--state-root']||path.join(stateHome,pkg.type+'-jobs'))};
   if(previous&&!isDeepStrictEqual(scope,previous.scope))throw new Error('原请求的类型、平台或 Profile 不可改变');
   context={schemaVersion:1,jobId:id,scope,autoPublish:parsed.autoPublish,settings,videoConfig:video,packagePath:path.join(directory,'package.json'),packageDigest:digest(pkg),inputErrors:parsed.errors,requestPath:file};
   if(video){context.videoConfigPath=path.join(directory,'video-config.json');writeJson(context.videoConfigPath,video);}
   writeJson(context.packagePath,pkg);writeJson(file,context);
  }else if(!context)throw new Error('未找到保存的请求；旧 JSON 任务请沿用 --package 与原参数');
  if(values['--state-root']&&path.resolve(values['--state-root'])!==context.scope.stateRoot)throw new Error('原请求的状态目录不可改变');
  if(!registry[context.scope.type]||context.scope.platforms.some(p=>!registry[context.scope.type].platforms.includes(p)))throw new Error('保存的请求不适用于当前版本');
  if(command==='run'&&context.autoPublish!==true&&!flags.includes('--resume-control'))throw new Error('确认内容后使用 --resume-control 继续原请求');
  const expanded=[command,'--package',context.packagePath,'--platforms',context.scope.platforms.join(','),'--job-id',id,'--state-root',context.scope.stateRoot,...(context.scope.profile?['--profile',context.scope.profile]:[]),...flags];
  return {argv:expanded,context,release};
 }catch(error){release();throw error;}
}

export function saveRequestResult(context,report){
 if(!context)return;
 context.lastReport=report.reportPath;
 const sessionFile=path.join(context.scope.stateRoot,'.runs',context.jobId+'.json');
 if(fs.existsSync(sessionFile)&&readJson(sessionFile).fingerprint)context.locked=true;
 writeJson(context.requestPath,context);
}
