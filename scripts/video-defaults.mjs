import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {loadConfig as upstreamConfig, normalizeConfig, validateConfig} from '../assets/vendor/video-publisher/scripts/lib/config.mjs';
import {readPackage as upstreamPackage} from '../assets/vendor/video-publisher/scripts/lib/content-package.mjs';
import {writeJson} from './runtime.mjs';
import {prepareVideoCover,assertCoverSource} from './video-cover.mjs';

export const VIDEO_DEFAULTS = Object.freeze({youtubeAudience:'not_made_for_kids',youtubePaidPromotion:false,youtubeAlteredContent:false,youtubeVisibility:'public',youtubeLicense:'standard_youtube',youtubeAllowEmbedding:true,youtubeNotifySubscribers:true,youtubeCategory:'',youtubeLanguage:'',youtubePlaylist:'',wechatShortTitle:'',original:true,cover:{uploadCustomCover:true}});
export const resolveConfigPath=()=>path.resolve(process.env.PUBLISHER_VIDEO_CONFIG||process.env.VIDEO_PUBLISHER_CONFIG||path.join(os.homedir(),'.config/168-publisher/video.json'));
const booleanKeys=['youtubePaidPromotion','youtubeAlteredContent','youtubeAllowEmbedding','youtubeNotifySubscribers','original','aiGenerated'];
const enums={youtubeAudience:['made_for_kids','not_made_for_kids'],youtubeVisibility:['private','unlisted','public'],youtubeLicense:['standard_youtube','creative_commons']};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateVideoDefaults(value){
 if(!object(value))throw new Error('Video defaults must be an object');
 for(const [key,v] of Object.entries(value)){
  if(!Object.hasOwn(VIDEO_DEFAULTS,key)&&key!=='aiGenerated')throw new Error('Unsupported video default: '+key);
  if(booleanKeys.includes(key)){if(typeof v!=='boolean')throw new Error(key+' must be boolean');}
  else if(key==='cover'){if(!object(v)||Object.keys(v).some(k=>k!=='uploadCustomCover')||typeof v.uploadCustomCover!=='boolean')throw new Error('Default cover requires boolean uploadCustomCover');}
  else if(typeof v!=='string'||enums[key]&&!enums[key].includes(v))throw new Error('Invalid video default: '+key);
  if(key==='wechatShortTitle'&&v&&[...v].length<6)throw new Error('WeChat optional short title must be empty or at least 6 characters');
 }
 return value;
}
export function loadVideoConfig(options={}){
 const file=options.configPath||resolveConfigPath(),raw=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 if(!object(raw))throw new Error('Video configuration must be an object');
 for(const key of ['declarations','platforms','execution','cover'])if(raw[key]!==undefined&&!object(raw[key]))throw new Error('Invalid video configuration: '+key);
 for(const key of ['checkConcurrency','uploadConcurrency'])if(raw.execution?.[key]!==undefined&&(!Number.isInteger(raw.execution[key])||raw.execution[key]<1))throw new Error('Invalid execution.'+key);
 if(raw.cover?.uploadExistingByDefault!==undefined&&typeof raw.cover.uploadExistingByDefault!=='boolean')throw new Error('cover.uploadExistingByDefault must be boolean');
 const config=upstreamConfig({...options,configPath:file});
 if(raw.declarations?.originalityPolicy!==undefined&&!['ask_each_run','all_videos_original'].includes(raw.declarations.originalityPolicy))throw new Error('Invalid declarations.originalityPolicy');
 const defaults=validateVideoDefaults(raw.defaults??{});
 return {...config,declarations:{...config.declarations,originalityPolicy:raw.declarations?.originalityPolicy??'all_videos_original'},defaults,effectiveDefaults:resolveDefaults(raw)};
}
export function resolveDefaults(raw={}){
 const defaults=validateVideoDefaults(raw.defaults??{}),legacy=raw.platforms?.youtube||{};
 const inherited={};for(const [field,key] of [['youtubeVisibility','defaultVisibility'],['youtubeCategory','defaultCategory'],['youtubeLanguage','defaultLanguage']])if(Object.hasOwn(legacy,key))inherited[field]=legacy[key];
 return validateVideoDefaults({...VIDEO_DEFAULTS,...inherited,...defaults,cover:{...VIDEO_DEFAULTS.cover,...defaults.cover}});
}
export function withEffectivePackage(raw,config){
 if(!object(raw))throw new Error('Content package must be an object');
 if(raw.cover!==undefined&&!object(raw.cover))throw new Error('cover must be an object');
 const value={...config.effectiveDefaults,...raw,cover:{...config.effectiveDefaults.cover,...raw.cover}};
 validateVideoDefaults(Object.fromEntries(Object.entries(value).filter(([k])=>!['cover','wechatShortTitle'].includes(k)&&(Object.hasOwn(VIDEO_DEFAULTS,k)||k==='aiGenerated'))));
 if(typeof value.cover.uploadCustomCover!=='boolean')throw new Error('cover.uploadCustomCover must be boolean');
 return value;
}
export function temporaryPackage(value,operation){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'168-publisher-package-')),file=path.join(directory,'package.json');
 try{fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});return operation(file);}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
export function readVideoPackage(file,{state,config=loadVideoConfig(),acceptMetadataRevision=false}={}){
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));
 const readEffective=value=>{
  value={...value,cover:prepareVideoCover(value.cover,value.videoPath)};
  return temporaryPackage(value,p=>{
   const pkg=upstreamPackage(p,{config});
   if(value.cover?.sourcePath)Object.assign(pkg.cover,{sourcePath:value.cover.sourcePath,sourceSha256:value.cover.sourceSha256,adaptation:value.cover.adaptation,...(value.cover.sourceKind?{sourceKind:value.cover.sourceKind}:{})});
   return pkg;
  });
 };
 if(state?.effectivePackage){
  assertCoverSource(state.effectivePackage.cover);
  if(!isDeepStrictEqual(raw,state.packageInput)){if(!acceptMetadataRevision)throw new Error('Package changed; frozen task defaults cannot be reapplied');const frozen=Object.fromEntries(Object.entries(state.effectivePackage).filter(([k])=>Object.hasOwn(VIDEO_DEFAULTS,k)||k==='aiGenerated'));const value=withEffectivePackage(raw,{effectiveDefaults:frozen});return raw.cover?.sourcePath?readEffective({...value,cover:raw.cover}):readEffective(value);}
  return structuredClone(state.effectivePackage);
 }
 // Older tasks have no defaults snapshot. Preserve their original reader and identity gate.
 if(state)return upstreamPackage(file,{config});
 return readEffective(withEffectivePackage(raw,config));
}
export function videoConfiguration(){const config=loadVideoConfig();return {configurationPath:resolveConfigPath(),configuration:config};}
export function setVideoDefaults(argv){
 if(argv[0]!=='--json'||argv[1]===undefined||![2,4].includes(argv.length)||argv.length===4&&argv[2]!=='--originality-policy')throw new Error('Usage: video.mjs config set-defaults --json JSON [--originality-policy ask_each_run|all_videos_original]');
 const file=resolveConfigPath(),raw=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 if(!object(raw))throw new Error('Video configuration must be an object');
 const existingErrors=validateConfig(normalizeConfig(raw));if(existingErrors.length)throw new Error(existingErrors.join('; '));loadVideoConfig({configPath:file});
 const patch=validateVideoDefaults(JSON.parse(argv[1])),policy=argv[3]??raw.declarations?.originalityPolicy??'all_videos_original';
 if(!['ask_each_run','all_videos_original'].includes(policy))throw new Error('Invalid declarations.originalityPolicy');
 const updated={...raw,defaults:{...raw.defaults,...patch},declarations:{...raw.declarations,originalityPolicy:policy}};
 const errors=validateConfig(normalizeConfig(updated));if(errors.length)throw new Error(errors.join('; '));resolveDefaults(updated);writeJson(file,updated);return videoConfiguration();
}

export async function withTemporaryPackage(value,operation){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'168-publisher-package-')),file=path.join(directory,'package.json');
 try{fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});return await operation(file);}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
