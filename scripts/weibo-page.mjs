export async function observeWeibo(expected) {
  const visible = node => node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== "hidden";
  const editors = [...document.querySelectorAll('textarea[placeholder="有什么新鲜事想分享给大家？"]')].filter(visible);
  const editor = editors.length === 1 ? editors[0] : null;
  let publisher = null, input = null;
  const seen = new Set();
  // Production Vue omits DOM component pointers; use the mounted application's current vnode tree.
  function walk(vnode, parents = []) {
    if (!vnode || typeof vnode !== "object" || seen.has(vnode)) return;
    seen.add(vnode);
    if (vnode.el === editor) {
      input = parents.findLast(component => typeof component.data?.text === "string");
      publisher = parents.findLast(component => typeof component.data?.content === "string" && Array.isArray(component.data?.pic_id));
    }
    if (vnode.component) walk(vnode.component.subTree, [...parents, vnode.component]);
    if (Array.isArray(vnode.children)) vnode.children.forEach(child => walk(child, parents));
  }
  walk(document.querySelector('#app')?._vnode);
  const root = editor?.closest('[class*="_publishCard_"]');
  const buttons = [...(root?.querySelectorAll('button') || [])].filter(node => visible(node) && node.innerText.trim() === "发送");
  const button = buttons.length === 1 ? buttons[0] : null;
  const accountLinks = [...document.querySelectorAll('.woo-tab-nav a[href]')].filter(node => /\/u\/\d+$/.test(node.href) && node.querySelector('img[alt="profile"]'));
  const account = accountLinks.length === 1 ? accountLinks[0].href.match(/\/u\/(\d+)$/)[1] : "";
  const guard = window.__168_PUBLISHER_WEIBO__;
  const files = (guard?.files || []).map(file => ({ ...file }));
  const text = editor?.value || "";
  const editorText = publisher && input ? publisher.data.content : null;
  const items = Array.isArray(publisher?.data.pic_id) ? publisher.data.pic_id : [];
  const nodes = [...(root?.querySelectorAll('[class*="_picbed_"] img') || [])].filter(visible);
  const cache = guard ? (guard.nativeFiles ||= new WeakMap()) : new WeakMap();
  const images = await Promise.all(nodes.map(async (node, index) => {
    const item = items[index];
    let originalSha256 = "";
    if (item?.file instanceof File) {
      if (!cache.has(item.file)) {
        try { cache.set(item.file, Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await item.file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("")); } catch {}
      }
      originalSha256 = cache.get(item.file) || "";
    }
    return { src: node.src, width: node.naturalWidth, height: node.naturalHeight, loaded: node.complete && node.naturalWidth > 0,
      media: item ? { count: items.length, originalSha256, originalSize: item.file?.size, currentUrl: item.url,
        uploadId: item.pid || "", status: item.status, index: item.index } : null };
  }));
  const videos = root?.querySelectorAll('video').length || 0;
  const videoItem=items.length===1&&items[0].type==='video'?items[0]:null;
  // The native uploader retains currFile after deleting attachment.file and clearing fileList.
  const uploadedFile=videoItem?.wbUploader?.currFile;
  let videoSha256='';
  if(uploadedFile instanceof File){
    if(!cache.has(uploadedFile)){
      try{cache.set(uploadedFile,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await uploadedFile.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''));}catch{}
    }
    videoSha256=cache.get(uploadedFile)||'';
  }
  const detail=uploadedFile?.detail;
  const uploadChunks=Array.isArray(uploadedFile?.sliceInfo)?uploadedFile.sliceInfo.map(chunk=>{
    let accepted=false;try{accepted=JSON.parse(chunk.responseBody).result===true;}catch{}
    return {index:chunk.sliceNum,size:chunk.sliceSize,status:chunk.statusCode,accepted};
  }):[];
  const videoMedia=videoItem&&{originalSha256:videoSha256,originalSize:uploadedFile?.size,receiptId:uploadedFile?.initRes?.media_id||'',
    width:detail?.detail?.width,height:detail?.detail?.height,receiptDuration:detail?.detail?.duration,
    receiptPosterId:detail?.screenshot?.[0]?.pid,receiptPoster:detail?.screenshot?.[0]?.url,
    status:videoItem.status,uploadProgress:videoItem.uploadProgress,uploadedBytes:Array.isArray(uploadedFile?.progress)?uploadedFile.progress.reduce((sum,bytes)=>sum+bytes,0):null,uploadChunks,
    uploadId:videoItem.media_id||'',groupId:videoItem.media_group_id||'',duration:videoItem.duration,
    posterId:videoItem.pid||'',poster:videoItem.url,index:videoItem.index};
  const blockers = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .woo-modal-main')].filter(visible);
  const errors = [...document.querySelectorAll('[role="alert"], [class*="toast"]')].filter(visible).map(node => node.innerText.trim())
    .filter(text => /上传失败|上传图片失败|图片上传失败|网络错误|上传错误/.test(text));
  const receipts = files.length === expected.assets.length && files.every((file, index) => !file.pending && !file.error && file.sha256 === expected.assets[index].sha256 && file.size === expected.assets[index].size);
  const noMedia = publisher && Array.isArray(publisher.data.pic_id) && items.length === 0 && Object.keys(publisher.data.media || {}).length === 0 && images.length === 0 && !videos;
  const ordered = images.length === expected.assets.length && items.length === expected.assets.length && images.every((image, index) => image.loaded
    && image.media?.originalSha256 === expected.assets[index].sha256 && image.media.originalSize === expected.assets[index].size
    && image.media.currentUrl === image.src && image.media.index === index);
  const data = publisher?.data;
  const supported = data?.type === 'text1' && data.visible === 0 && !data.schedule_timestamp && !data.publishMarkdown && !data.share_id
    && !data.blog_audio && !data.position && !data.shopConfig && Object.keys(data.vote || {}).length === 0 && Object.keys(data.mcomment || {}).length === 0
    && !data.ispost;
  const gates = {
    authenticated: !!account && !location.pathname.includes('newlogin'),
    account: !!account && (!expected.account || account === expected.account),
    composer: editors.length === 1 && !!root && !!publisher && !!input && !!supported && location.hostname === "weibo.com",
    text: !!editor && text === expected.text && editorText === expected.text && input?.data.text === expected.text,
    media: (expected.videoPath ? !!videoMedia && videoMedia.originalSha256===expected.assets[0]?.sha256 && videoMedia.originalSize===expected.assets[0]?.size
      && images.length<=1 && !videos && Object.keys(data?.media||{}).length===0 : expected.assets.length ? ordered && !videos && Object.keys(publisher?.data.media || {}).length === 0 : !!noMedia) && receipts,
    upload: errors.length === 0 && !!button && !button.disabled && publisher?.data.formDisabled === false && images.every(image => image.media?.status === 3
      && typeof image.media.uploadId === "string" && !!image.media.uploadId && new URL(image.src).hostname.endsWith('.sinaimg.cn')
      && new URL(image.src).pathname.includes('/' + image.media.uploadId + '.')) && !expected.videoPath,
    noBlockingDialog: blockers.length === 0,
    safety: guard?.version === 2 && guard.armed === true && guard.fingerprint === expected.fingerprint && guard.blockedAttempts.length === 0,
  };
  // Native success follows server checksum verification; throttled display progress can remain below 100.
  if(expected.videoPath)gates.upload=errors.length===0&&!!button&&!button.disabled&&data?.formDisabled===false&&videoMedia?.status===3
    &&videoMedia.uploadedBytes===videoMedia.originalSize&&uploadChunks.length>0
    &&uploadChunks.every((chunk,index)=>chunk.index===index&&Number.isFinite(chunk.size)&&chunk.size>0&&chunk.status===200&&chunk.accepted)
    &&uploadChunks.reduce((sum,chunk)=>sum+chunk.size,0)===videoMedia.originalSize
    &&!!videoMedia.uploadId&&videoMedia.uploadId===videoMedia.receiptId&&!!videoMedia.groupId
    &&Number.isFinite(videoMedia.duration)&&videoMedia.duration>0&&videoMedia.duration===videoMedia.receiptDuration&&videoMedia.width>0&&videoMedia.height>0
    &&images.length===1&&images[0].loaded&&images[0].src===videoMedia.poster&&!!videoMedia.posterId
    &&videoMedia.posterId===videoMedia.receiptPosterId&&videoMedia.poster===videoMedia.receiptPoster
    &&new URL(videoMedia.poster).hostname.endsWith('.sinaimg.cn')&&new URL(videoMedia.poster).pathname.includes('/'+videoMedia.posterId+'.');
  return { observedAt: new Date().toISOString(), account, text, editorText, images, videos, files, errors, gates, finalPublishClicked: false,
    blockedAttempts: guard?.blockedAttempts.length ?? null, button: button && { text: button.innerText, disabled: button.disabled },
    videoPreviews:videoItem?[{media:videoMedia}]:[],
    native: publisher && { type: publisher.data.type, picIds: items.map(item => item.pid || ""), mediaKeys: Object.keys(publisher.data.media || {}), formDisabled: publisher.data.formDisabled } };
}
