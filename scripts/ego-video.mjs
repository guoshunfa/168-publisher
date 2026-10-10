#!/usr/bin/env node
import {run,isMain,clearCurrentEditor} from './runtime.mjs';
import {resolvePublisherLockDirectory} from '../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs';

async function recoverBilibiliCoverSlotCompat(asset) {
  const previous=expectedReceipts.cover?.slots?.[asset.slot];
  const pending=await js('window.__VP2_BILI_SELECTED_FILE__');
  const original=previous?.selectedFile||pending;
  const hasEditor=await js(`Boolean(document.querySelector(${JSON.stringify(asset.editor)}))`);
  if(hasEditor&&original?.name===path.basename(asset.path)&&original.size===fs.statSync(asset.path).size){
    await selectBilibiliCoverSlotCompat(asset);
    const proof=await js(String.raw`(async(selector)=>{
      const e=document.querySelector(selector),dialog=e?.closest('.bcc-dialog');
      const url=getComputedStyle(dialog?.querySelector('.cover-upload .upload-area')||document.body).backgroundImage.match(/url\(["']?([^"')]+)/)?.[1]||'';
      if(!url.startsWith('blob:')||!e?.parentElement.classList.contains('active'))return null;
      const bytes=await (await fetch(url,{signal:AbortSignal.timeout(3000)})).arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      const image=new Image();image.src=url;await image.decode();
      return {url,hash,loaded:true,active:true,width:image.naturalWidth,height:image.naturalHeight};
    })(${JSON.stringify(asset.editor)})`);
    if(!proof)return {ok:false,reason:'pending bilibili cover original bytes cannot be proven; refusing reupload'};
    const {createHash}=await import('node:crypto');
    const hash=createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');
    if(proof.hash!==hash||!bilibiliCoverRatioMatches(proof,asset.ratio))return {ok:false,reason:'pending bilibili cover original bytes cannot be proven; refusing reupload'};
    return {ok:true,recovered:true,receipt:{assetPath:asset.path,ratio:asset.ratio,selectedFile:original,previewProof:{...proof,slot:asset.slot,changed:true},recovery:{originalSha256:hash}}};
  }
  return null;
}

async function selectBilibiliCoverSlotCompat(asset) {
  await click(asset.editor,{label:'select bilibili cover slot'}).catch(()=>{});
  const select=()=>js(`((selector)=>{
    const e=document.querySelector(selector);
    if(!e?.closest('.bcc-dialog'))return false;
    if(!e.parentElement.classList.contains('active'))e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
    return e.parentElement.classList.contains('active');
  })(${JSON.stringify(asset.editor)})`);
  for(let i=0;i<12;i++){if(await select())return true;await wait(0.25);}
  throw new Error('Bilibili requested cover slot did not become active');
}

async function exposeDouyinVideoInput() {
  let result;
  for(let i=0;i<10;i++){
    result=await exposeDouyinVideoInputOnce();
    if(result.ok)return result;
    await wait(0.5);
  }
  return result;
}

async function recoverWechatCoverCompat(asset) {
  const dataUrl='data:image/png;base64,'+fs.readFileSync(asset.path).toString('base64');
  const proof=await js(String.raw`(async(asset,dataUrl)=>{
    const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];
    const uploaders=roots.flatMap(r=>[...r.querySelectorAll('.single-cover-uploader-wrap')]);
    if(uploaders.length!==1)return null;
    let editor=uploaders[0].__vue__;
    while(editor&&editor.$options.name!=='EditCoverDialog')editor=editor.$parent;
    const owner=editor?.$parent,mode=asset.slot==='vertical'?'landscape-profile':'landscape-share';
    const card=roots.flatMap(r=>[...r.querySelectorAll(asset.wrap+' '+asset.image)])[0];
    const url=asset.slot==='vertical'?owner?.video?.coverUrl:owner?.video?.shareCoverUrl;
    const edited=asset.slot==='vertical'?owner?.hasEditProfileCover:owner?.hasEditShareCover;
    if(editor?.previewMode!==mode||owner.lastEditedMode!==mode||!edited||!editor.useCustomCover||!editor.customCover||!card?.complete||!card.naturalWidth||card.src!==url)return null;
    const expected=new Image();expected.src=dataUrl;await expected.decode();
    const canvas=document.createElement('canvas');canvas.width=expected.naturalWidth;canvas.height=expected.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(expected,0,0);
    const native=editor.customCover;
    if(native.width!==canvas.width||native.height!==canvas.height)return null;
    const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const expectedHash=await hash(ctx.getImageData(0,0,canvas.width,canvas.height).data);
    const nativeHash=await hash(native.getContext('2d').getImageData(0,0,native.width,native.height).data);
    if(nativeHash!==expectedHash)return null;
    return {rasterSha256:nativeHash,image:{width:native.width,height:native.height,loaded:true,sourceKey:nativeHash},acceptedImage:{url,width:card.naturalWidth,height:card.naturalHeight}};
  })(${JSON.stringify({slot:asset.slot,wrap:asset.wrap,image:asset.image})},${JSON.stringify(dataUrl)})`);
  if(!proof||!wechatCoverRatioMatches(proof.acceptedImage,asset.ratio))return null;
  return {ok:true,recovered:true,receipt:{assetPath:asset.path,ratio:asset.ratio,beforeUrls:[],afterUrl:proof.acceptedImage.url,selectedFile:{name:path.basename(asset.path),size:fs.statSync(asset.path).size,recoveredFromNativeCanvas:true},previewProof:{editorMatched:true,image:proof.image},acceptedImage:proof.acceptedImage,recovery:{nativeSelection:true,rasterSha256:proof.rasterSha256}}};
}

export function compatVideoScript(source, {cleanupJob,cleanupPath} = {}) {
  if (!source.includes('async function armFinalPublishGuard()')) return source;
  const edits = [
    ["const existing = window[key]\n    if (existing?.armed === true && existing.version === 1)", "const existing = window[key]\n    if (existing?.armed === true && !existing.closedFooterProtected) {\n      if (existing.blockedAttempts.length || !existing.releaseForConfirmedPublish?.().ok) throw new Error('Old final guard cannot be upgraded safely')\n    }\n    if (existing?.armed === true && existing.version === 1 && existing.closedFooterProtected)"],
    ["const state = { armed: true, version: 1,", "const state = { armed: true, version: 1, closedFooterProtected: true,"],
    ["element.matches('button, input[type=\"submit\"], [role=\"button\"], .d-button, .bcc-button')", "element.matches('button, input[type=\"submit\"], [role=\"button\"], .d-button, .bcc-button, xhs-publish-btn')"],
    ["compact(element.value || element.getAttribute('aria-label')", "compact(element.getAttribute('submit-text') || element.value || element.getAttribute('aria-label')"],
    ["if (!match) return", "const shortcut = ['keydown', 'keyup', 'keypress'].includes(event.type) && event.key === 'Enter' && (event.metaKey || event.ctrlKey)\n      if (!match && !shortcut) return"],
    ["label: match.label,", "label: match?.label || 'Ctrl/Cmd+Enter',"],
    ["document.addEventListener('submit', guard, true)", "document.addEventListener('submit', guard, true)\n    for (const event of ['keydown', 'keyup', 'keypress']) document.addEventListener(event, guard, true)"],
    ["querySelectorAll('button, [role=\"button\"], .d-button, .bcc-button, div, span')", "querySelectorAll('button, [role=\"button\"], .d-button, .bcc-button, div, span, xhs-publish-btn')"],
    ["const text = compact(el.innerText || el.textContent || '')", "const text = compact(el.getAttribute('submit-text') || el.innerText || el.textContent || '')"],
    ["const buttonish = el.tagName === 'BUTTON'", "const buttonish = el.matches('xhs-publish-btn') || el.tagName === 'BUTTON'"],
    ["disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled')", "disabled: el.getAttribute('submit-disabled') === 'true' || el.getAttribute('submit-loading') === 'true' || Boolean(el.disabled) || el.getAttribute('aria-disabled')"],
    ["((source, flags) => {", "((source, flags, selectedPlatform) => {"],
    ["return { text, disabled:", "return { xhsFinalFooter: el.matches('xhs-publish-btn'), text, disabled:"],
    [".filter(item => re.test(item.text)", ".filter(item => (selectedPlatform !== 'xiaohongshu' || item.xhsFinalFooter) && re.test(item.text)"],
    ["})(${JSON.stringify(labels.source)}, ${JSON.stringify(labels.flags)})", "})(${JSON.stringify(labels.source)}, ${JSON.stringify(labels.flags)}, ${JSON.stringify(platform)})"],
  ];
  for (const [before, after] of edits) {
    if (!source.includes(before)) throw new Error('Pinned video guard source changed; refusing unsafe browser execution');
    source = source.replace(before, after);
  }
  if (source.includes('async function uploadBilibiliCoverSlot(asset)')) {
    const coverEdits = [
      ["const inputs=[...(dialog?.querySelectorAll('.cover-upload input[type=file]')||[])].filter(e=>/image/i.test(e.accept));", "const emptySelector=${JSON.stringify(asset.ratio==='4:3'?'.ratio_4_3 input[type=file]':'.ratio_16_9 input[type=file]')};\n      const selector=document.querySelector(${JSON.stringify(asset.editor)})?'.cover-upload input[type=file]':emptySelector;\n      const inputs=[...(dialog?.querySelectorAll(selector)||[])].filter(e=>/image/i.test(e.accept));\n      for(const old of document.querySelectorAll('#vp2-bili-cover'))old.removeAttribute('id');"],
      ["await click(asset.editor,{label:'select bilibili cover slot'});\n  let active=false;\n  for(let i=0;i<12;i+=1){active=await js(`(()=>{const e=document.querySelector(${JSON.stringify(asset.editor)});return !!e?.parentElement.classList.contains('active')})()`);if(active)break;await wait(0.25)}", "const emptySlot=await js(`(()=>{const input=document.querySelector('#vp2-bili-cover');return !document.querySelector(${JSON.stringify(asset.editor)})&&!!input?.closest(${JSON.stringify(asset.ratio==='4:3'?'.ratio_4_3':'.ratio_16_9')})})()`);\n  let active=emptySlot;\n  if(!emptySlot){\n    await click(asset.editor,{label:'select bilibili cover slot'});\n    for(let i=0;i<12;i+=1){active=await js(`(()=>{const e=document.querySelector(${JSON.stringify(asset.editor)});return !!e?.parentElement.classList.contains('active')})()`);if(active)break;await wait(0.25)}\n  }"],
      ["if(!opened.ok)return opened;\n  let exposed=null;", "if(!opened.ok)return opened;\n  const recovered=await recoverBilibiliCoverSlotCompat(asset);\n  if(recovered)return recovered;\n  let exposed=null;"],
      ["let previewProof=null;", "if(emptySlot){\n    for(let i=0;i<12;i+=1){if(await js(`Boolean(document.querySelector(${JSON.stringify(asset.editor)}))`))break;await wait(0.25)}\n    await click(asset.editor,{label:'select uploaded bilibili cover slot'});\n  }\n  let previewProof=null;"],
    ];
    for (const [before, after] of coverEdits) {
      if (!source.includes(before)) throw new Error('Pinned Bilibili cover source changed; refusing unsafe browser execution');
      source = source.replace(before, after);
    }
    source = source.replace("await click(asset.editor,{label:'select bilibili cover slot'});", 'await selectBilibiliCoverSlotCompat(asset);')
      .replace("await click(asset.editor,{label:'select uploaded bilibili cover slot'});", 'await selectBilibiliCoverSlotCompat(asset);');
    source += '\n'+selectBilibiliCoverSlotCompat.toString()+'\n'+recoverBilibiliCoverSlotCompat.toString();
  }
  if(source.includes('async function startDouyinUpload()')){
    const marker='async function exposeDouyinVideoInput()';
    if(!source.includes(marker))throw new Error('Pinned Douyin upload source changed');
    source=source.replace(marker,'async function exposeDouyinVideoInputOnce()')+'\n'+exposeDouyinVideoInput.toString();
  }
  if(source.includes('async function uploadWechatCover(asset)')){
    const edits=[
      ["const opened=await js(String.raw`((selector) => {", "const recovered=await recoverWechatCoverCompat(asset);\n  if(recovered)return recovered;\n  const opened=await js(String.raw`((selector) => {"],
      ["buttons[0].click();return {ok:false,waiting:true,cropConfirmed:true}", "buttons[0].id='vp2-wechat-cover-crop-confirm';return {ok:false,waiting:true,cropConfirmed:true,selector:'#vp2-wechat-cover-crop-confirm'}"],
      ["buttons[0].click();return {ok:true};\n    `));\n    if(confirmed.ok)break;", "buttons[0].id='vp2-wechat-cover-confirm';return {ok:true,selector:'#vp2-wechat-cover-confirm'};\n    `));\n    if(confirmed.selector)await click(confirmed.selector,{label:'confirm wechat cover editor'});\n    if(confirmed.ok)break;"],
      ["actions.coverRecovery=await dismissWechatCoverEditor();", "actions.coverRecovery={ok:false,reason:'pending cover editor requires inspection; refusing discard or reupload'};"],
    ];
    for(const [before,after] of edits){
      if(!source.includes(before))throw new Error('Pinned WeChat cover source changed');
      source=source.replace(before,after);
    }
    source+='\n'+recoverWechatCoverCompat.toString();
  }
  if(cleanupJob&&source.includes('const result = await runPlatformPhase();')){
    const inspector=['inspectXiaohongshu','inspectDouyin','inspectBilibili','inspectWechatChannels','inspectYoutube'].find(name=>source.includes('async function '+name+'('));
    if(!inspector)throw new Error('Video history inspector unavailable');
    source=source.replace('const result = await runPlatformPhase();',`await clearVideoHistoryCompat();\n  const result = await runPlatformPhase();`);
    source+='\n'+clearCurrentEditor.toString()+`\nasync function clearVideoHistoryCompat(){
      const task=await taskSpace(activeTaskSpace.id);
      const tab=(await task.tabs()).find(tab=>PLATFORM_HOSTS[platform].test(tab.url||''));
      if(!tab?.label)throw new Error('Original video editor page missing');
      const page=task.page(tab.label),key=${JSON.stringify(cleanupJob)};
      if(await page.evaluate(key=>window.__168_VIDEO_CLEANUP__===key,key))return;
      const before=await ${inspector}();if(!before.gates.authenticated?.ok)return;
      const snapshotPath=${JSON.stringify(cleanupPath||'')};
      if(snapshotPath){fs.mkdirSync(path.dirname(snapshotPath),{recursive:true,mode:0o700});fs.writeFileSync(snapshotPath,JSON.stringify(before,null,2),{mode:0o600});}
      if(platform!=='xiaohongshu'||await page.evaluate(()=>{const draft=[...document.querySelectorAll('[data-v-app]')].map(r=>r.__vue_app__?.config.globalProperties.$pinia?._s.get('draft')).find(Boolean);return !!(draft?.title||draft?.desc||draft?.videoFile||draft?.imgList?.length);}))await clearCurrentEditor(page,{type:'video',platform});
      await wait(0.5);
      const after=await ${inspector}(),video=after.gates.video;
      const textLeft=['title','description','shortTitle'].some(name=>String(after.gates[name]?.evidence?.actual||'').trim())||String(after.gates.description?.evidence?.editorText||'').trim();
      if(!after.gates.authenticated?.ok||textLeft||video?.ok||video?.evidence?.uploaded||video?.evidence?.uploading||video?.evidence?.anyUploaded)throw new Error('Video history cleanup did not produce an empty editor');
      await page.evaluate(key=>{window.__168_VIDEO_CLEANUP__=key;},key);
    }`;
  }
  return source;
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.slice(2).join(' ') !== 'nodejs') throw new Error('Only Ego nodejs input is supported');
    let source = ''; for await (const chunk of process.stdin) source += chunk;
    const token = process.env.VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN;
    const lock = token ? {directory:resolvePublisherLockDirectory(),release:{token}} : undefined;
    const result = await run(process.env.PUBLISHER_EGO_COMMAND || 'ego-browser', ['nodejs'], {input:compatVideoScript(source,{cleanupJob:process.env.PUBLISHER_CLEAR_VIDEO_JOB,cleanupPath:process.env.PUBLISHER_HISTORY_SNAPSHOT}),lock});
    process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
