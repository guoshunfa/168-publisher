import {loginState} from './login-page.mjs';
// Reuse platform field adapters while keeping server completion out of the preparation contract.
export function configurationVerdict(observation, submitted) {
  const gates=observation.gates||{};
  const required=['authenticated','draftIdentity','safety'];
  const missing=required.filter(name=>gates[name]?.ok!==true);
  const complete=submitted===true&&observation.configurationComplete===true&&!observation.blocker&&!missing.length;
  return {status:complete?'configured':gates.authenticated?.ok===false?'needs_login':observation.blocker?.code==='PLATFORM_REJECTED_ASSET'?'failed':'needs_user',configurationComplete:complete,missing,blocker:observation.blocker};
}

export function actionsDispatch(platform, statePath, item, clearEditorSource) {
  const inspectors={xiaohongshu:'inspectXiaohongshu',douyin:'inspectDouyin',bilibili:'inspectBilibili',wechat_channels:'inspectWechatChannels',youtube:'inspectYoutube'};
  const inspector=inspectors[platform];
  const metadata={xiaohongshu:'ensureXiaohongshuEarlyMetadata',douyin:'ensureDouyinMetadata',bilibili:'ensureBilibiliMetadataCompat',wechat_channels:'ensureWechatMetadataCompat',youtube:'ensureYoutubeMetadata'}[platform];
  const selectors={xiaohongshu:'input[placeholder*="填写标题"]',douyin:'input[placeholder*="作品标题"]',bilibili:'input[placeholder*="稿件标题"]',wechat_channels:'[contenteditable=true],[contenteditable=""]',youtube:'#title-textarea #textbox'};
  const expose=platform==='youtube'?'await openYoutubeUploadCompat()':'{ok:true}';
  const original={xiaohongshu:'await ensureXhsOriginal()',bilibili:'await ensureBilibiliDeclarationCompat()',wechat_channels:'await ensureWechatOriginal()',douyin:'{ok:true}',youtube:'{ok:true}'}[platform];
  return `
const actionStatePath=${JSON.stringify(statePath)};
const persist=checkpoint=>{const temporary=actionStatePath+'.actions.tmp';fs.writeFileSync(temporary,JSON.stringify(checkpoint,null,2),{mode:0o600});fs.renameSync(temporary,actionStatePath);};
const progress=step=>console.error(JSON.stringify({progress:{platform,step}}));
let actionDeadline=Date.now()+30000;
const ordinaryWait=wait;
wait=async seconds=>{if(Date.now()+seconds*1000>actionDeadline)throw new Error('Required page controls did not settle within 30 seconds');await ordinaryWait(seconds);};
const ordinaryUpload=uploadFile;
uploadFile=async(selector,file)=>{
  if(file!==videoPath){
    const checkpoint=JSON.parse(fs.readFileSync(actionStatePath,'utf8')),item=checkpoint.platforms[platform];
    item.coverAttempts||={};
    if(item.coverAttempts[file])throw new Error('Original cover upload was already attempted; refusing duplicate upload');
    item.coverAttempts[file]=true;persist(checkpoint);
  }
  return ordinaryUpload(selector,file);
};
const prepared=await preparePlatform();
await page.cdp('Page.bringToFront',{});
if(!prepared.selected.ok)throw new Error(prepared.selected.blocker?.message||'Platform page unavailable');
progress('load_editor');
const loginOutcome=${platform==='wechat_channels'?`await page.evaluate(${loginState.toString()},'wechat_channels')`:'null'};
if(!loginOutcome||loginOutcome.status==='login_checked')await page.waitForFunction(()=>/login|accounts\\.google/.test(location.href)||document.querySelector('input[type=file],#title-textarea,.creator-tab,.upload-container,button[aria-label="创建"],button[aria-label="Create"],wujie-app'),undefined,{timeout:15000});
let before=await ${inspector}(),submitted=false;
if(loginOutcome&&loginOutcome.status!=='login_checked'){await emitObservation({...before,configurationComplete:false,gates:{...before.gates,authenticated:{ok:false}},blocker:typedBlocker('AUTH_REQUIRED',loginOutcome.reason||'请在原页面手动登录视频号，完成后明确继续',{requiresUser:true})});}
else if(!before.gates.authenticated?.ok){await emitObservation({...before,configurationComplete:false,blocker:typedBlocker('AUTH_REQUIRED','平台需要登录',{requiresUser:true})});}
else {
  if(!${JSON.stringify(item.uploadAttempted===true||!!item.videoReceipt||!!item.receipts?.uploadStart)}){
    progress('clear_current_editor');
    const snapshotPath=path.join(path.dirname(actionStatePath),'stale-content.json');
    fs.writeFileSync(snapshotPath,JSON.stringify(before,null,2),{mode:0o600});
    await (${clearEditorSource})(page,{type:'video',platform});
    before=await ${inspector}();
    if(before.gates.video?.evidence?.anyUploaded||before.gates.video?.evidence?.uploading||before.gates.video?.evidence?.uploaded||before.gates.video?.ok)throw new Error('Historical video association remains; refusing replacement');
    progress('submit_video');
    const exposed=${expose};
    if(!exposed.ok)throw new Error(exposed.reason||'Video input unavailable');
    const markDispatch=()=>{const checkpoint=JSON.parse(fs.readFileSync(actionStatePath,'utf8'));checkpoint.platforms[platform].uploadAttempted=true;persist(checkpoint);};
    ${platform==='douyin'?`const douyinInput=await exposeDouyinVideoInput();if(!douyinInput.ok)throw new Error(douyinInput.reason);markDispatch();await uploadFile(douyinInput.selector,videoPath);`:`await submitNativeVideo(platform,videoPath,markDispatch);`}
    submitted=true;const submittedState=JSON.parse(fs.readFileSync(actionStatePath,'utf8'));submittedState.platforms[platform].uploadSubmitted=true;persist(submittedState);
    ${platform==='wechat_channels'?`const receipt=createWechatUploadStartReceipt('injected');if(!receipt)throw new Error('Upload identity receipt unavailable');expectedReceipts.uploadStart=receipt;const checkpoint=JSON.parse(fs.readFileSync(actionStatePath,'utf8'));checkpoint.platforms[platform].receipts={...checkpoint.platforms[platform].receipts,uploadStart:receipt};persist(checkpoint);checkpointReceipts(expectedReceipts);`:''}
  } else {
    progress('reuse_original_upload');
    const proof=before.gates.video?.evidence?.filenameVisible===true||before.gates.draftIdentity?.evidence?.filenameVisible===true;
    const selected=await page.evaluate(expected=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];return roots.flatMap(r=>[...r.querySelectorAll('input[type=file]')]).some(e=>[...(e.files||[])].some(f=>f.name===expected.name&&f.size===expected.size));},{name:path.basename(videoPath),size:fs.statSync(videoPath).size});
    if(!before.gates.draftIdentity?.ok||!proof&&!selected)throw new Error('Original upload outcome unknown or current media missing; refusing metadata changes or repeat upload');
    submitted=true;
  }
  progress('wait_for_input_controls');
  await page.waitForFunction(selector=>{
    const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];
    return roots.some(root=>[...root.querySelectorAll(selector)].some(e=>e.getBoundingClientRect().height>0));
  },${JSON.stringify(selectors[platform])},{timeout:15000});
  actionDeadline=Date.now()+30000;
  progress('fill_title_body_tags');
  before=await ${inspector}();
  if(!before.gates.draftIdentity?.ok)throw new Error('Original video association unknown; refusing metadata changes');
  const metadata=await ${metadata}(before);
  let configured=metadata.ok===true;
  let blocker=metadata.blocker;
  ${platform==='bilibili'?`if(configured){const description=await setBilibiliDescriptionV2();configured=description.ok===true;if(!configured)blocker=typedBlocker('ACTION_FAILED',description.reason||'B站简介未填写');}`:''}
  if(configured){progress('configure_platform_fields');const original=${original};configured=original.ok===true;if(!configured)blocker=typedBlocker('ACTION_FAILED',original.reason||'原创声明未配置');}
  ${platform==='youtube'?`if(configured&&youtubeCustomThumbnail){progress('submit_thumbnail');const cover=await uploadYoutubeThumbnail();configured=cover.ok===true;if(!configured)blocker=typedBlocker('ACTION_FAILED',cover.reason||'封面未配置');}`:platform==='xiaohongshu'?`if(configured&&xhsCustomCover){progress('submit_cover');const cover=await uploadXhsCover();configured=cover.ok===true;if(!configured)blocker=typedBlocker('ACTION_FAILED',cover.reason||'封面未配置');}`:platform==='bilibili'?`if(configured&&bilibiliCustomCover){progress('submit_cover');const cover=await uploadBilibiliCoverV2();configured=cover.ok===true;if(!configured)blocker=typedBlocker('ACTION_FAILED',cover.reason||'封面未配置');}`:platform==='wechat_channels'?`if(configured&&wechatCustomCover){progress('submit_cover');for(const asset of wechatCoverAssets){const cover=await uploadWechatCover(asset);if(!cover.ok){configured=false;blocker=typedBlocker('ACTION_FAILED',cover.reason||'封面未配置');break;}}}`:`if(configured&&douyinCustomCover){progress('submit_cover');for(const asset of douyinCoverAssets){const cover=await uploadDouyinCoverSlot(asset);if(!cover.ok){configured=false;blocker=typedBlocker('ACTION_FAILED',cover.reason||'封面未配置');break;}}}`}
  ${platform==='youtube'?`if(configured){progress('configure_visibility');const advanced=await advanceYoutubeToVisibility();const visibility=advanced.ok?await ensureYoutubeVisibility():advanced;configured=visibility.ok===true;if(!configured)blocker=typedBlocker('ACTION_FAILED',visibility.reason||'YouTube可见性未配置');}`:''}
  await emitObservation({uploadSubmitted:submitted,configurationComplete:configured,blocker,gates:{authenticated:before.gates.authenticated,draftIdentity:before.gates.draftIdentity},actions:{metadata:metadata.actions},uploadStatus:'not_awaited'});
}`;
}

export function actionPlatformSource(source, platform) {
  const tails={
    youtube:['async function uploadYoutubeThumbnail()', '  await wait(.7);', 'async function advanceYoutubeToVisibility()'],
    xiaohongshu:['async function uploadXhsCover()', "  let after = '';", 'async function ensureXiaohongshuEarlyMetadata('],
    wechat_channels:['async function uploadWechatCover(asset)', '  let after=[];let dialogClosed=false;let acceptedImage=null;', 'async function ensureWechatEarlyMetadata('],
    bilibili:['async function finishBilibiliCoverEditor(receipt)', '  let images=null,closed=false;', 'async function uploadBilibiliCoverV2()'],
  };
  if(platform==='youtube'){
    const from=source.indexOf('async function advanceYoutubeToVisibility()'),to=source.indexOf('async function returnYoutubeToDetails()',from);
    if(from<0||to<0)throw new Error('Pinned YouTube visibility adapter changed');
    const advance=source.slice(from,to).replace('attempt <= 180','attempt <= 4').replace("    if (!next.waiting) return next;\n    await wait(2);",'    return next;');
    source=source.slice(0,from)+advance+source.slice(to);
  }
  const tail=tails[platform];
  if(!tail)return source;
  const start=source.indexOf(tail[0]),from=source.indexOf(tail[1],start),to=source.indexOf(tail[2],from);
  if(start<0||from<0||to<0)throw new Error('Pinned cover action adapter changed');
  return source.slice(0,from)+'  return {ok:true,submitted:true};\n}\n\n'+source.slice(to);
}
