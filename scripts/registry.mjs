import {fileURLToPath} from 'node:url';
import {PLATFORMS} from '../assets/vendor/video-publisher/scripts/v2/lib/model.mjs';

export const entries = {
  video: {actionPreparation: true, urls: {xiaohongshu:"https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=video",douyin:"https://creator.douyin.com/creator-micro/content/upload",bilibili:"https://member.bilibili.com/platform/upload/video/frame",wechat_channels:"https://channels.weixin.qq.com/platform/post/create",youtube:"https://studio.youtube.com/"}, platforms: PLATFORMS, entry: fileURLToPath(new URL('./video.mjs', import.meta.url))},
  dynamic: {actionPreparation: true, urls: {x:"https://x.com/compose/post",weibo:"https://weibo.com/",xiaohongshu:"https://creator.xiaohongshu.com/publish/publish?source=official"}, platforms: ['x', 'weibo', 'xiaohongshu'], entry: fileURLToPath(new URL('./dynamic.mjs', import.meta.url))},
};

entries.image={actionPreparation:true,platforms:['douyin','bilibili','wechat_channels','youtube'],urls:{douyin:'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',bilibili:'https://t.bilibili.com/',wechat_channels:'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate',youtube:'https://www.youtube.com/'},entry:fileURLToPath(new URL('./dynamic.mjs',import.meta.url))};

entries.media={actionPreparation:true,retiredPlatforms:['jike'],platforms:[...new Set([...entries.video.platforms,...entries.dynamic.platforms])]};
