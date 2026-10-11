import {platformNames} from './input.mjs';

const name=platform=>platformNames[platform]||platform;
const cell=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const message=value=>typeof value==='string'?value:JSON.stringify(value);
const labels={published:'平台已确认发布',submitted:'已点击发布，结果待确认',configured:'已配置',draft_verified:'草稿已核验',input_checked:'内容通过',failed:'失败',needs_user:'需处理',needs_login:'需登录',processing:'处理中',not_started:'未开始',result_unknown:'结果未确认',awaiting_manual_send:'等待手动发送'};

export function renderReport(report,context,pkg){
 const video=context.scope.type==='video'||context.scope.type==='media'&&!!pkg.videoPath;
 const standalone=['xiaohongshu','douyin','bilibili','wechat_channels','youtube'];
 const preflight=report.command==='preflight',problems=[...(report.inputErrors||[]).map(e=>'需修改：'+e)];
 const rows=Object.entries(report.platforms||{});
 const lines=preflight?['| 平台 | 登录状态 | 标题 |','| --- | --- | --- |']:['| 平台 | 状态 | 说明 |','| --- | --- | --- |'];
 for(const [platform,item] of rows){
  const checked=item.contentAudit||item,audit=checked.audit;
  if(preflight){
   const title=platform==='wechat_channels'&&video?(audit?.fields?.shortTitle?.value??pkg.wechatShortTitle)||'留空':(context.scope.type==='dynamic'||context.scope.type==='media'&&(!video||!standalone.includes(platform)))&&!(video?['xiaohongshu']:['xiaohongshu','douyin','bilibili','wechat_channels']).includes(platform)?'不使用':audit?.fields?.title?.value??checked.title??pkg.platforms?.[platform]?.title??pkg.title??'留空';
   lines.push(`| ${name(platform)} | ${item.status==='login_checked'?'已登录':item.status==='needs_login'?'未登录':'—'} | ${cell(title)} |`);
   if(item.status!=='login_checked')problems.push(`需检查：${name(platform)}${item.status==='needs_login'?'登录未完成':'登录检查失败'}：${item.reason||'未取得明确结果'}`);
  }else lines.push(`| ${name(platform)} | ${labels[item.status]||cell(item.status)} | ${cell(item.reason||item.error||item.blocker|| (item.skipped?'沿用已完成配置':item.configurationComplete?'已触发媒体提交；上传及平台处理待查看':''))} |`);
  for(const error of checked.errors||audit?.errors||[])problems.push(`需修改：${name(platform)}：${message(error)}`);
  if(checked.error)problems.push(`需检查：${name(platform)}：${checked.error}`);
  for(const issue of audit?.issues||[])if(issue.severity==='warning'&&issue.code==='ACCOUNT_VERIFICATION')problems.push(`需检查：${name(platform)}：${issue.message}`);
 }
 if(preflight){
  lines.unshift(`是否全自动：${context.autoPublish===true?'是':'否'}`,...(context.scope.type==='media'?[`媒体类型：${video?'视频':'图文'}`]:[]),'');
  lines.push('','**发布内容与说明**','', '- 正文：', '', pkg.text??pkg.description??'无','',`- 标签：${pkg.tags?.length?pkg.tags.join('、'):'无'}`);
  for(const [platform,item] of rows){
   const fields=item.contentAudit?.audit?.fields||{},override=pkg.platforms?.[platform];
   const body=override?.text??(video&&fields.body?.applicable?fields.body.value:undefined);
   if(body!==undefined&&body!==(pkg.text??pkg.description))lines.push(`- ${name(platform)}正文：`,'',body,'');
   const tags=fields.tags?.value;
   if(tags&&JSON.stringify(tags)!==JSON.stringify(pkg.tags))lines.push(`- ${name(platform)}标签：${tags.length?tags.join('、'):'无'}`);
  }
  lines.push('- 素材：',...(pkg.images||[pkg.videoPath]).filter(Boolean).map(p=>'  - '+p));
  const coverTargets=context.scope.type!=='media'||!video||context.scope.platforms.some(p=>standalone.includes(p));
  lines.push(`- 封面：${!coverTargets||!video?'不适用':pkg.cover?.uploadCustomCover?(pkg.cover.sourceKind==='video_first_frame'||!pkg.cover.sourcePath?'视频首帧':pkg.cover.sourcePath)+`（上传至${context.scope.type==='media'?'支持的':'各'}平台封面项；保留完整画面、按需缩小、黑色补边，不裁切或放大）`:'平台默认'}`,`- Profile：${context.scope.profile||'Ego 当前默认'}`);
  if(video&&coverTargets){
   lines.push(`- 默认设置：${pkg.original?'原创/自制':'非原创'}；${context.videoConfig?.declarations?.originalityPolicy==='ask_each_run'?'原创权利需本次确认':'沿用原创授权策略'}${context.scope.platforms.includes('youtube')?`；YouTube ${pkg.youtubeAudience==='made_for_kids'?'面向儿童':'非面向儿童'}、${pkg.youtubeVisibility}、${pkg.youtubePaidPromotion?'有':'无'}推广、${pkg.youtubeAlteredContent?'有':'无'}逼真合成、${pkg.youtubeLicense}、${pkg.youtubeAllowEmbedding?'允许':'禁止'}嵌入、${pkg.youtubeNotifySubscribers?'通知':'不通知'}订阅者`:''}${pkg.aiGenerated===undefined?'':`；AI 生成：${pkg.aiGenerated?'是':'否'}`}。`);
   if(context.scope.platforms.includes('xiaohongshu'))lines.push('- 单独说明：小红书视频入口不写入正文。');
   if(context.scope.type==='media'&&context.scope.platforms.some(p=>!standalone.includes(p)))lines.push('- '+context.scope.platforms.filter(p=>!standalone.includes(p)).map(name).join('、')+'的视频入口不使用独立标题、自定义封面或上述视频声明。');
  }else lines.push('- 默认设置：仅填写用户提供的正文、支持的标题及标签。');
 }
 lines.push('',`Job ID：${context.jobId}${report.taskSpaceId?'；原空间：'+report.taskSpaceId:''}`);
 if(report.handoffError)problems.push('需检查：页面交接失败：'+report.handoffError);
 if(problems.length)lines.push('','**需要处理的问题**','',...[...new Set(problems)].map(p=>'- '+p));
 if(preflight)lines.push('',problems.length?'完成后回复继续':report.autoContinuing?'检查通过，继续自动配置与发布。':'目前没有需要处理的问题，回复“继续”会继续执行。');
 else if(report.command==='run')lines.push('',report.autoPublish?'全自动发布结果见上表；未确认的结果请检查原页面，系统不会重复点击发布。':report.handedOff?'已交回原页面，请查看上传和平台处理结果；最终发送由你手动完成。':'请按报告处理未完成项。');
 return lines.join('\n');
}
