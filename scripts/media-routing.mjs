import {VIDEO_DEFAULTS} from './video-defaults.mjs';

export function mediaKind(pkg) {
  const video=typeof pkg.videoPath==='string'&&pkg.videoPath.length>0;
  const images=Array.isArray(pkg.images)&&pkg.images.length>0;
  if(video===images)throw new Error('媒体：请提供一段视频或一组图片，不能混选或留空');
  return video?'video':'image';
}

export function adapterType(pkg,platform,registry) {
  if(pkg.type!=='media')return pkg.type??'video';
  const kind=mediaKind(pkg);
  if(kind==='video'&&registry.video.platforms.includes(platform))return 'video';
  if(registry.dynamic.platforms.includes(platform))return 'dynamic';
  if(kind==='image'&&registry.image?.platforms.includes(platform))return 'image';
  throw new Error('平台：'+platform+' 不支持当前图片媒体');
}

export function supportedMediaPlatforms(pkg,registry) {
  return mediaKind(pkg)==='image'?[...registry.dynamic.platforms,...(registry.image?.platforms||[])]:registry.media.platforms;
}

export function adapterPackage(pkg,platform,type) {
  const videoFields=['title','description','tags','videoPath','bilibiliAllowedAutoTags','xhsTitle','xhsTopics','douyinTitle','douyinDescription','douyinTopics','bilibiliTitle','bilibiliDescription','bilibiliTags','wechatTitle','wechatDescription','wechatTags','youtubeTitle','youtubeDescription','youtubeTags'];
  const allowed=new Set(['type','text','images','platforms',...videoFields,...Object.keys(VIDEO_DEFAULTS),'aiGenerated']);
  for(const key of Object.keys(pkg))if(!allowed.has(key))throw new Error('Unsupported media package field: '+key);
  if(type==='video'){
    if(pkg.platforms?.[platform])throw new Error('Native video overrides must use the existing flat platform fields');
    const value={...pkg,type:'video'};
    delete value.text;delete value.images;delete value.platforms;
    return value;
  }
  const value={type:type==='image'?'image':'dynamic',text:pkg.text??pkg.description??'',tags:pkg.tags??[]};
  if(pkg.videoPath)value.videoPath=pkg.videoPath;else value.images=pkg.images;
  const override={...pkg.platforms?.[platform]};
  if(['xiaohongshu','douyin','bilibili','wechat_channels'].includes(platform)&&pkg.title)override.title??=pkg.title;
  if(Object.keys(override).length)value.platforms={[platform]:override};
  return value;
}
