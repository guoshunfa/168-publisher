export function imageControls(platform) {
  const roots=[document];
  for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const visible=e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  for(const root of roots)for(const node of root.querySelectorAll('[data-168-image=body],[data-168-image=title],[data-168-image=files]'))node.removeAttribute('data-168-image');
  const selectors={douyin:{editor:'[contenteditable="true"]',title:'input[placeholder*="作品标题"]',scope:'body'},bilibili:{editor:'.bili-rich-textarea__inner[contenteditable="true"]',title:'.bili-dyn-publishing__title__input',scope:'.bili-dyn-publishing'},wechat_channels:{editor:'.input-editor[contenteditable]',title:'input[placeholder*="22个字符"]',scope:'.post-edit-wrap'},youtube:{editor:'ytd-backstage-post-dialog-renderer #contenteditable-root',scope:'ytd-backstage-post-dialog-renderer'}}[platform];
  if(!selectors)throw new Error('Unsupported image platform');
  const find=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]).filter(visible);
  const editors=find(selectors.editor),titles=selectors.title?find(selectors.title):[];
  const scope=find(selectors.scope).find(e=>editors[0]&&e.contains(editors[0]))||editors[0]?.getRootNode();
  const files=roots.flatMap(root=>[...root.querySelectorAll('input[type=file]')]).filter(e=>/image|png|jpe?g/i.test(e.accept)&&e.multiple&&(!scope||scope.contains(e)));
  if(editors.length===1)editors[0].setAttribute('data-168-image','body');
  if(titles.length===1)titles[0].setAttribute('data-168-image','title');
  if(files.length===1)files[0].setAttribute('data-168-image','files');
  return {editor:editors.length===1,title:titles.length===1,file:files.length===1,editorCount:editors.length,fileCount:files.length};
}

export function armImageReceipts() {
  const guard=window.__168_PUBLISHER_IMAGE__;
  if(!guard?.armed)throw new Error('Image guard missing');
  if(guard.uploads)return;
  guard.uploads=[];
  const inputClick=HTMLInputElement.prototype.click;
  const capture=event=>{if(!guard.armed)return;const input=event.target;if(input.type!=='file')return;const files=[...input.files];const records=files.map(file=>({name:file.name,size:file.size,type:file.type,pending:true}));guard.files=records;files.forEach(async(file,index)=>{try{records[index].sha256=await digest(file);records[index].pending=false;}catch{records[index].error=true;records[index].pending=false;}});};
  const trackedInputClick=function(...args){if(this.type==='file')this.addEventListener('change',capture,{once:true});return inputClick.apply(this,args);};
  HTMLInputElement.prototype.click=trackedInputClick;
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
  const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  const receipts=body=>{
    const blobs=body instanceof FormData?[...body.values()].filter(v=>v instanceof Blob):body instanceof Blob?[body]:[];
    return blobs.filter(blob=>/^image\//.test(blob.type)).map(blob=>{const record={size:blob.size,pending:true,urls:[],status:0};guard.uploads.push(record);digest(blob).then(sha256=>{record.sha256=sha256;record.pending=false;},()=>{record.error=true;record.pending=false;});return record;});
  };
  const response=(records,status,value)=>{
    const urls=[];
    const visit=(v,depth=0)=>{if(depth>12)return;if(typeof v==='string'&&/^https:\/\//.test(v))urls.push(v);else if(v&&typeof v==='object')for(const item of Object.values(v))visit(item,depth+1);};
    try{visit(typeof value==='string'?JSON.parse(value):value);}catch{}
    for(const record of records)Object.assign(record,{status,urls});
  };
  const trackedOpen=function(...args){return open.apply(this,args);};
  const trackedSend=function(body){const records=receipts(body);if(records.length)this.addEventListener('loadend',()=>{let value;try{value=this.responseType==='json'?this.response:this.responseText;}catch{}response(records,this.status,value);},{once:true});return send.call(this,body);};
  XMLHttpRequest.prototype.open=trackedOpen;XMLHttpRequest.prototype.send=trackedSend;
  const originalFetch=window.fetch;
  const trackedFetch=async function(input,options){const records=receipts(options?.body);const result=await originalFetch.call(this,input,options);if(records.length)result.clone().text().then(value=>response(records,result.status,value),()=>{});return result;};
  window.fetch=trackedFetch;
  const release=guard.release;
  guard.release=()=>{const result=release.call(guard);if(HTMLInputElement.prototype.click===trackedInputClick)HTMLInputElement.prototype.click=inputClick;if(XMLHttpRequest.prototype.open===trackedOpen)XMLHttpRequest.prototype.open=open;if(XMLHttpRequest.prototype.send===trackedSend)XMLHttpRequest.prototype.send=send;if(window.fetch===trackedFetch)window.fetch=originalFetch;return result;};
}

export function observeImage(expected) {
  const platform=expected.platform,roots=[document];
  for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const visible=e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  const all=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]);
  const editors=all('[data-168-image=body]').filter(visible),editor=editors.length===1?editors[0]:null;
  const title=all('[data-168-image=title]').filter(visible)[0]?.value||'';
  const host={douyin:'creator.douyin.com',bilibili:'t.bilibili.com',wechat_channels:'channels.weixin.qq.com',youtube:'www.youtube.com'}[platform];
  let account='';
  if(platform==='bilibili')account=document.querySelector('a.header-entry-mini[href*="space.bilibili.com"]')?.href||'';
  if(platform==='youtube'){
    const dialog=document.querySelector('ytd-backstage-post-dialog-renderer');
    const data=dialog?.data||dialog?.__data?.data;
    const channel=data?.imageButton?.buttonRenderer?.navigationEndpoint?.backstageImageUploadEndpoint?.channelId;
    const pageChannel=location.pathname.match(/\/channel\/(UC[\w-]+)\/posts/)?.[1];
    if(typeof channel==='string'&&/^UC[\w-]+$/.test(channel)&&pageChannel===channel)account=channel;
  }
  if(platform==='wechat_channels')account=all('*').map(e=>e.__vue__?.userStore?.finderUsername).find(Boolean)||'';
  if(platform==='douyin'){
    const node=all('[data-168-image=files]')[0]||editor;
    let fiber=node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];
    const identities=new Set();
    for(let depth=0;fiber&&depth<64;depth++,fiber=fiber.return){const user=fiber.memoizedProps?.userInfo;if(user?.uid)identities.add(String(user.uid));}
    if(identities.size===1)account=[...identities][0];
  }
  const guard=window.__168_PUBLISHER_IMAGE__,files=(guard?.files||[]).map(e=>({...e}));
  const text=(editor?.innerText||'').replace(/\u200b/g,'').replace(/\r\n/g,'\n').replace(/^\n$|\n$/g,'');
  const scope=platform==='bilibili'?editor?.closest('.bili-dyn-publishing'):platform==='youtube'?editor?.closest('ytd-backstage-post-dialog-renderer'):editor?.getRootNode();
  const images=[...(scope?.querySelectorAll('img')||[])].filter(e=>visible(e)&&!e.closest('#avatar,ytd-channel-avatar-renderer')&&!/avatar|logo|banner|loading/i.test(String(e.className))&&!/finderhead|bfs\/face|douyin-creator-logo|data:image\/svg/.test(e.src)).map(e=>({src:e.src,loaded:e.complete&&e.naturalWidth>0,sha256:guard?.blobs[e.src]?.sha256||''}));
  const receipt=files.length===expected.assets.length&&files.every((f,i)=>!f.pending&&!f.error&&f.sha256===expected.assets[i].sha256&&f.size===expected.assets[i].size);
  const uploads=guard?.uploads||[];
  const serverProof=expected.assets.every((asset,i)=>uploads.some(u=>!u.pending&&!u.error&&u.status>=200&&u.status<300&&u.sha256===asset.sha256&&u.urls.some(url=>images[i]?.src.split('?')[0]===url.split('?')[0])));
  const ordered=images.length===expected.assets.length&&images.every((image,i)=>image.loaded&&(image.sha256===expected.assets[i].sha256||uploads.some(u=>u.sha256===expected.assets[i].sha256&&u.urls.some(url=>url.split('?')[0]===image.src.split('?')[0]))));
  const publish=all('button,[role=button],.bili-dyn-publishing__action.launcher').filter(visible).filter(e=>/^(发布|发表|Post|Publish)$/.test((e.innerText||e.getAttribute('aria-label')||'').trim()));
  const errors=all('[role=alert],.el-message,.ant-message-notice,.weui-desktop-toast').filter(visible).map(e=>e.innerText).filter(t=>/失败|错误|error|failed|验证码|安全验证/i.test(t));
  const blockers=all('[role=alertdialog],[role=dialog],.weui-desktop-dialog__wrp,.semi-modal').filter(e=>visible(e)&&!e.contains(editor));
  const readyFile=all('[data-168-image=files]').length===1;
  const gates={authenticated:!!account&&!/login/.test(location.pathname),account:!!account&&(!expected.account||expected.account===account),composer:location.hostname===host&&(editors.length===1||platform==='douyin'&&readyFile),text:!!editor&&text===expected.text&&title===(expected.title||''),media:receipt&&ordered,upload:serverProof&&ordered&&publish.length===1&&!publish[0].disabled&&!/disabled/.test(String(publish[0].className)),noBlockingDialog:!blockers.length&&!errors.length,safety:guard?.armed===true&&guard.fingerprint===expected.fingerprint&&guard.blockedAttempts.length===0};
  return {observedAt:new Date().toISOString(),account,text,title,editorText:editor?text:null,images,videos:0,files,errors,gates,mediaPending:receipt&&(!ordered||!serverProof),uploadComplete:gates.upload,finalPublishClicked:false};
}
