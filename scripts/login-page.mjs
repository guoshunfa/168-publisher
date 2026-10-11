export function loginState(input) {
  const platform=typeof input==='string'?input:input.platform;
  const roots=[document],seen=new Set(roots);let unreadableFrames=0;
  for(let i=0;i<roots.length;i++)for(const element of roots[i].querySelectorAll('*')){
    if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element.shadowRoot);}
    if(element.tagName==='IFRAME'&&element.getBoundingClientRect().height>0){
      try{const frame=element.contentDocument;if(frame&&!seen.has(frame)){seen.add(frame);roots.push(frame);}else if(!frame)unreadableFrames++;}catch{unreadableFrames++;}
    }
  }
  const snapshot=typeof input==='object'?input.snapshotText||'':'',custom=typeof input==='object'?input.login||{}:{};
  const text=[...roots.map(r=>r.body?.innerText||r.host?.innerText||''),snapshot].join('\n');
  const visible=selector=>roots.some(r=>[...r.querySelectorAll(selector)].some(e=>e.getBoundingClientRect().height>0));
  const any=selector=>roots.some(r=>r.querySelectorAll(selector).length>0);
  const url=new URL(location.href);
  const evidence={url:url.origin+url.pathname,title:document.title||'',readyState:document.readyState||'',roots:roots.length,unreadableFrames,source:snapshot?'dom_and_snapshot':'dom'};
  const result=(status,reason,signal)=>({status,reason,evidence:{...evidence,signal}});
  if(url.hostname==='accounts.google.com'||/(?:^|\/)(?:login|signin|passport)(?:[/.]|$)/i.test(url.pathname)||/扫码登录|微信快捷登录|选择视频号登录/.test(text))return result('needs_login',platform==='wechat_channels'?'请在原页面手动登录视频号并选择账号，完成后明确继续':'原页面需要登录或选择账号','login_page');
  if(/请登录|登录后|验证码|安全验证|登录\/注册/.test(text)||visible('input[type="password"]'))return result('needs_login','原页面需要人工登录或验证','login_or_verification');
  const authenticated={
    x:()=>visible('[data-testid="AppTabBar_Profile_Link"],[data-testid="tweetTextarea_0"]'),
    weibo:()=>visible('textarea[placeholder="有什么新鲜事想分享给大家？"]'),
    xiaohongshu:()=>/创作服务平台/.test(text)&&/发布笔记|草稿箱/.test(text),
    douyin:()=>url.hostname==='creator.douyin.com'&&(
      /创作者中心|创作者服务中心|创作服务平台/.test(text)&&/发布视频|作品管理|发布作品|上传视频|内容管理/.test(text)
      ||/作品发布|发布视频|上传视频/.test(text)&&/内容管理|作品管理/.test(text)&&/发布设置|点击上传|选择视频|上传视频/.test(text)
      ||/\/creator-micro\//.test(url.pathname)&&any('input[type="file"][accept*="video"],input[placeholder*="作品标题"]')&&/上传|作品描述|发布设置/.test(text)
      ||/退出登录/.test(text)&&/作品管理|内容管理/.test(text)),
    bilibili:()=>/成为UP主的第|稿件标题|视频投稿/.test(text),
    wechat_channels:()=>/视频管理|发表动态/.test(text),
    youtube:()=>visible('button[aria-label="创建"],button[aria-label="Create"],ytcp-uploads-dialog'),
  }[platform];
  if(authenticated?.()||custom.selector&&visible(custom.selector)||custom.authenticatedText&&text.includes(custom.authenticatedText))return result('login_checked',undefined,'authenticated_workspace');
  const reason=!text.trim()?'页面尚未加载出可识别内容':unreadableFrames&&!snapshot?'页面包含未读取的内嵌内容，需要补充页面快照':'页面已读取，但没有匹配到登录页或已登录工作区';
  return {...result('needs_user',reason,'unrecognized_page'),evidence:{...evidence,signal:'unrecognized_page',textExcerpt:text.replace(/\s+/g,' ').trim().slice(0,1200)}};
}

export function loginCheckScript(session,loginOptions={}) {
  return `const session=${JSON.stringify(session)},task=await taskSpace(session.taskSpaceId);
if(task.name!==session.name)throw new Error('Original run space changed');
const results={},loginOptions=${JSON.stringify(loginOptions)};
for(const [platform,label] of Object.entries(session.pages)){
  const page=task.page(label);
  try{
    if(session.pageErrors?.[platform])throw new Error(session.pageErrors[platform]);
    const input={platform,login:loginOptions[platform]||{}};
    try{await page.waitForFunction(input=>{const read=${loginState.toString()};return read(input).status!=='needs_user';},input,{timeout:15000});}catch{}
    let observed=await page.evaluate(${loginState.toString()},input);
    if(observed.status==='needs_user'){
      try{
        const snapshot=await page.snapshot({scope:'full_page'});
        const snapshotText=typeof snapshot==='string'?snapshot:JSON.stringify(snapshot);
        observed=await page.evaluate(${loginState.toString()},{...input,snapshotText});
      }catch(error){observed.evidence={...observed.evidence,snapshotError:String(error.message||error)};}
    }
    results[platform]={...observed,pageLabel:label,taskSpaceId:task.spaceId};
  }catch(error){results[platform]={status:'needs_user',reason:String(error.message||error),pageLabel:label,taskSpaceId:task.spaceId};}
}
console.log('168_PUBLISHER_RESULT:'+JSON.stringify({platforms:results,finalPublishClicked:false}));`;
}
