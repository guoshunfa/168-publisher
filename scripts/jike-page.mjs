export async function observeJike(expected) {
  const visible = node => node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden';
  const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(visible);
  const editor = editors.length === 1 ? editors[0] : null;
  const form = editor?.closest('form');
  const guard = window.__168_PUBLISHER_JIKE__;
  let fiber = editor?.[Object.keys(editor).find(key => key.startsWith('__reactFiber$'))];
  let root = fiber;
  for (let depth = 0; root?.return && depth < 128; depth++) root = root.return;
  // Host fiber references may point to the alternate; only the mounted tree proves committed form values.
  const stack = root?.stateNode?.current ? [root.stateNode.current] : [];
  fiber = null;
  for (let count = 0; stack.length && count < 12000; count++) {
    const node = stack.pop();
    if (node.stateNode === editor) { fiber = node; break; }
    if (node.sibling) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  let control, inputText = null;
  const users = [];
  for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (props?.control?._formValues && typeof props.getValues === 'function') control = props.control;
    if (props?.name === 'content' && typeof props.value === 'string') inputText = props.value;
    let hook = fiber.memoizedState;
    for (let count = 0; hook && count < 80; count++, hook = hook.next) {
      const data = hook.memoizedState?.data;
      if (data?.isLoginUser === true && typeof data.id === 'string' && typeof data.username === 'string') users.push({id:data.id, username:data.username});
    }
  }
  const values = control?._formValues;
  const avatar = form?.parentElement?.querySelector('a[href^="/u/"]');
  const username = avatar?.getAttribute('href')?.slice(3);
  const accounts = [...new Set(users.filter(user => user.username === username).map(user => user.id))];
  const account = accounts.length === 1 ? accounts[0] : '';
  let doc = null;
  try { doc = editor?.__lexicalEditor?.getEditorState().toJSON(); } catch {}
  const blocks = doc?.root?.children || [];
  const supported = blocks.every(block => block.type === 'paragraph' && (block.children || []).every(node => node.type === 'text' || node.type === 'linebreak'));
  const editorText = doc && supported ? blocks.map(block => (block.children || []).map(node => node.type === 'linebreak' ? '\n' : node.text).join('')).join('\n\n') : null;
  const text = (editor?.innerText === '\n' ? '' : editor?.innerText || '').replace(/\r\n/g, '\n');
  const attachments = values?.attachment;
  const ids = attachments?.ids || [];
  const items = ids.map(id => attachments.map?.[id]);
  const images = [...(form?.querySelectorAll('img') || [])].filter(visible);
  if (guard && !guard.nativeFiles) guard.nativeFiles = new WeakMap();
  const hash = async file => {
    if (!(file instanceof File) || !guard) return '';
    if (!guard.nativeFiles.has(file)) guard.nativeFiles.set(file, crypto.subtle.digest('SHA-256', await file.arrayBuffer()).then(bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('')));
    return guard.nativeFiles.get(file);
  };
  const previews = await Promise.all(images.map(async (image,index) => {
    const item = items[index], upload = item?.cdn?.file;
    return {src:image.src, loaded:image.complete && image.naturalWidth>0, sha256:guard?.blobs[image.src]?.sha256 || '',
      media:{count:items.length,originalSha256:await hash(item?.file),originalSize:item?.file?.size,type:item?.type,status:item?.status,
        uploadFailed:['FAILED','UPLOAD_FAILED'].includes(item?.status),uploadId:upload?.id || '',key:upload?.key || '',url:upload?.fileUrl || '',success:upload?.success===true}};
  }));
  const files = guard?.files || [];
  // Native video receipts omit image IDs; their key embeds the Qiniu file ETag.
  const videoEtag=async file=>{
    if(!(file instanceof File)||!guard)return '';
    if(!guard.nativeEtags)guard.nativeEtags=new WeakMap();
    if(!guard.nativeEtags.has(file))guard.nativeEtags.set(file,(async()=>{
      const hashes=[],blockSize=4*1024*1024;
      for(let offset=0;offset<file.size;offset+=blockSize)hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-1',await file.slice(offset,offset+blockSize).arrayBuffer())));
      if(!hashes.length)return '';
      const digest=hashes.length===1?hashes[0]:new Uint8Array(await crypto.subtle.digest('SHA-1',Uint8Array.from(hashes.flatMap(h=>[...h]))));
      return btoa(String.fromCharCode(hashes.length===1?0x16:0x96,...digest)).replace(/\+/g,'-').replace(/\//g,'_');
    })());
    return guard.nativeEtags.get(file);
  };
  const videoNodes=[...(form?.querySelectorAll('video')||[])].filter(visible),videos=videoNodes.length;
  const videoPreviews=await Promise.all(videoNodes.map(async(node,index)=>{const item=items[index],upload=item?.cdn?.file;return {src:node.currentSrc||node.src,sha256:guard?.blobs[node.currentSrc||node.src]?.sha256||'',width:node.videoWidth,height:node.videoHeight,duration:node.duration,decoded:node.readyState>=1&&!node.error,
    media:{etag:await videoEtag(item?.file),originalSha256:await hash(item?.file),originalSize:item?.file?.size,type:item?.type,status:item?.status,uploadFailed:['FAILED','UPLOAD_FAILED'].includes(item?.status),key:upload?.key||'',url:upload?.fileUrl||'',width:item?.metadata?.width,height:item?.metadata?.height}};}));
  const videoMedia=!!expected.videoPath&&items.length===1&&images.length===0&&videoPreviews.length===1&&videoPreviews.every(v=>v.decoded&&v.width>0&&v.height>0&&Math.min(v.width,v.height)<=1080&&Math.max(v.width,v.height)<=1920&&Number.isFinite(v.duration)&&v.duration>=3&&v.duration<=360&&Math.abs(v.duration-expected.assets[0].duration)<0.1&&v.media.type==='VIDEO'&&v.media.originalSha256===expected.assets[0].sha256&&v.media.originalSize===expected.assets[0].size&&v.sha256===expected.assets[0].sha256&&(v.media.status==='UPLOADING'&&!v.media.width&&!v.media.height||v.media.width===v.width&&v.media.height===v.height));
  const videoUploaded=videoPreviews.every(v=>v.media.status==='UPLOADED'&&!!v.media.etag&&v.media.key===v.media.etag+'.mp4'&&guard?.blobs[v.media.url]?.sha256===v.sha256);

  const ordered = items.length === expected.assets.length && images.length === items.length && items.every(item => item?.type === 'PICTURE')
    && previews.every((image,index) => image.loaded && image.sha256===expected.assets[index].sha256
      && image.media.originalSha256===expected.assets[index].sha256 && image.media.originalSize===expected.assets[index].size);
  const receipts = files.length === expected.assets.length && files.every((file,index) => !file.pending && !file.error && file.sha256===expected.assets[index].sha256 && file.size===expected.assets[index].size);
  const button = form?.querySelector('button[type="submit"]');
  const errors = [...document.querySelectorAll('[role="alert"], .mantine-Notification-root')].filter(visible).map(node=>node.innerText).filter(text=>/失败|错误|超出|failed|error/i.test(text));
  const blockers=[...document.querySelectorAll('[role=status],[role=alert]')].filter(visible).map(n=>n.innerText).filter(t=>/操作过于频繁|需要验证|请稍后再试/.test(t));
  const dialogs=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
  const rateLimited=blockers.length>0&&blockers.every(text=>text.trim()==='操作过于频繁')&&!dialogs.length&&!errors.length;
  const cleanSettings = !!values && Object.keys(values).every(key => ['content','attachment','topic'].includes(key)) && !values.topic;
  const uploadComplete=(!expected.videoPath||videoUploaded)&&previews.every(image=>image.media.status==='UPLOADED'
    && image.media.success && image.media.uploadId && image.media.key && image.media.url===`https://cdnv2.ruguoapp.com/${image.media.key}`);
  const gates = {
    authenticated:!!account && !location.pathname.includes('login'),
    account:!!account && (!expected.account || expected.account===account),
    composer:editors.length===1 && !!form && location.hostname==='web.okjike.com',
    text:editorText!==null && editorText===expected.text && text===expected.text && values?.content===expected.text && inputText===expected.text,
    media:(expected.videoPath?videoMedia:ordered&&videos===0)&&receipts,
    upload:!!button && !button.disabled && button.getAttribute('data-loading')!=='true' && !control?._formState?.isSubmitting
      && cleanSettings && Object.keys(control?._formState?.errors || {}).length===0 && uploadComplete,
    noBlockingDialog:!dialogs.length && !errors.length&&!blockers.length,
    safety:guard?.version===2 && guard.armed===true && guard.fingerprint===expected.fingerprint && guard.blockedAttempts.length===0,
  };
  return {observedAt:new Date().toISOString(),account,text,editorText,images:previews,videos,videoPreviews,files,errors,blockers,rateLimited,uploadComplete,gates,finalPublishClicked:false,
    blockedAttempts:guard?.blockedAttempts.length ?? null,native:{ids,content:values?.content ?? null,topicSelected:!!values?.topic},button:button && {text:button.innerText,disabled:button.disabled}};
}
