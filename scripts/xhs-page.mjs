export async function observeXhs(expected) {
  const visible = node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.01 && node.getAttribute('aria-hidden') !== 'true';
  };
  const editors = [...document.querySelectorAll('.tiptap[contenteditable="true"]')].filter(visible);
  const editor = editors.length === 1 ? editors[0] : null;
  const titleInput = document.querySelector('input[placeholder="填写标题会有更多赞哦"]');
  const stores = new Set(), seen = new Set();
  function walk(vnode) {
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return;
    seen.add(vnode);
    if (vnode.component) {
      const state = vnode.component.props?.state;
      const candidate = state?.imgList?._object;
      if (candidate && typeof candidate.title === 'string' && typeof candidate.desc === 'string' && Array.isArray(candidate.imgList)) stores.add(candidate);
      walk(vnode.component.subTree);
    }
    walk(vnode.ssContent);
    if (Array.isArray(vnode.children)) vnode.children.forEach(walk);
  }
  document.querySelectorAll('[data-v-app]').forEach(root => walk(root._vnode));
  let store = stores.size === 1 ? [...stores][0] : null;
  if(expected.videoPath){
    const models=new Set([...document.querySelectorAll('[data-v-app]')].map(root=>root.__vue_app__?.config.globalProperties.$pinia).filter(Boolean));
    if(models.size===1){const modelsById=[...models][0]._s;
      const draft=modelsById.get('draft'),publisher=modelsById.get('publisher'),settings=modelsById.get('settings'),user=modelsById.get('user');
      if(draft&&publisher&&settings&&user)store={...draft,...publisher,...settings,...user};
    }
  }
  const users = new Set([...document.querySelectorAll('[data-v-app]')].map(root => root.__vue_app__?.config.globalProperties.$pinia?._s.get('user')?.userInfo?.id).filter(id => typeof id === 'string' && id));
  const authenticatedAccount = users.size === 1 ? [...users][0] : '';
  const account = typeof store?.userInfo?.id === 'string' ? store.userInfo.id : authenticatedAccount;
  const guard = window.__168_PUBLISHER_XHS__;
  const items = store?.imgList || [];
  const files = (guard?.files || []).map(file => ({ ...file }));
  const images = [...document.querySelectorAll('.format-img img.preview')].filter(visible).map((node, index) => {
    const item = items[index], original = guard?.blobs[item?.url];
    return { src: node.src, width: node.naturalWidth, height: node.naturalHeight, loaded: node.complete && node.naturalWidth > 0,
      sha256: guard?.blobs[node.src]?.sha256 || '', media: item && { count: items.length, currentUrl: item.url,
        originalSha256: original && !original.pending && !original.error ? original.sha256 || '' : '', originalSize: item.file?.size,
        uploadId: item.fileId || '', status: item.status, progress: item.progress } };
  });
  let doc = null;
  try { doc = editor?.editor?.getJSON() || null; } catch {}
  const blocks = doc?.content || [];
  const tags = expected.tags || [];
  const tagBlock = tags.length ? blocks.at(-1) : null;
  const topics = (tagBlock?.content || []).filter(node => node.type === 'topic').map(node => node.attrs?.data);
  const plain = node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : node.type === 'topic' ? '' : null;
  const body = tags.length ? blocks.slice(0, -2) : blocks;
  const bodySupported = body.every(block => block.type === 'paragraph' && (block.content || []).every(node => plain(node) !== null));
  const text = body.map(block => (block.content || []).map(plain).join('')).join('\n');
  const topicsOk = !tags.length || blocks.length >= 2 && blocks.at(-2).type === 'paragraph' && !blocks.at(-2).content?.length
    && topics.length === tags.length && topics.every((topic, index) => topic?.name === tags[index] && typeof topic.id === 'string' && !!topic.id)
    && tagBlock.type === 'paragraph' && (tagBlock.content || []).every(node => node.type === 'topic' || node.type === 'text' && /^[ \u00a0]*$/.test(node.text));
  const nativeDesc = !text && !tags.length ? '' : blocks.map(block => {
    const value = (block.content || []).map(node => node.type === 'topic' ? '#' + node.attrs?.data?.name + '[话题]#' : plain(node) || '').join('');
    return block === tagBlock ? value.replace(/\u00a0/g, ' ').trimEnd() : value || '\t';
  }).join('\n');
  const template = document.createElement('template');
  template.innerHTML = store?.descInnerHTML || '';
  const storedBlocks = [...template.content.querySelectorAll('p')];
  const displayedBlocks = [...(editor?.querySelectorAll('p') || [])];
  const htmlMatches = storedBlocks.length === displayedBlocks.length && storedBlocks.every((block, index) => block.textContent === displayedBlocks[index].textContent);
  const ordered = items.length === expected.assets.length && images.length === expected.assets.length && images.every((image, index) => image.loaded
    && image.sha256 === expected.assets[index].sha256 && image.media?.originalSha256 === expected.assets[index].sha256
    && image.media.originalSize === expected.assets[index].size && image.src === image.media.currentUrl);
  const receipts = files.length === expected.assets.length && files.every((file, index) => !file.pending && !file.error && file.sha256 === expected.assets[index].sha256 && file.size === expected.assets[index].size);
  const videoFile=store?.videoFile,video=store?.video;
  const videoCache=guard?(guard.nativeFiles||=new WeakMap()):new WeakMap();
  let videoSha256='';
  if(expected.videoPath&&videoFile instanceof File){
    if(!videoCache.has(videoFile)){
      try{videoCache.set(videoFile,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await videoFile.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''));}catch{}
    }
    videoSha256=videoCache.get(videoFile)||'';
  }
  const videoBlob=guard?.blobs[store?.videoBlobUrl];
  const cover=document.querySelector('.cover-plugin-preview .default.row, .cover-plugin-preview .default.column');
  const coverBackground=cover?getComputedStyle(cover).backgroundImage:'';
  const videoMedia=expected.videoPath&&{originalSha256:videoSha256,originalSize:videoFile?.size,blobSha256:videoBlob?.sha256||'',
    uploadId:video?.fileid||'',videoId:video?.videoId||'',width:video?.width,height:video?.height,duration:video?.duration,
    uploaded:store?.isVideoReady,uploadPercent:store?.uploadPercent,transcodePercent:store?.transcodePercent,
    coverMatches:!!store?.coverUrl&&coverBackground.includes(store.coverUrl),publishType:store?.publishType};
  const root = document.querySelector('.publish-page-content-base');
  const uploadPage = !root && !editor && document.querySelector(expected.videoPath?'input.upload-input[accept*=".mp4"]':'input.upload-input[accept*=".jpg"]') && items.length === 0;
  const buttons = [...document.querySelectorAll('xhs-publish-btn[is-publish="true"]')];
  const button = buttons.length === 1 ? buttons[0] : null;
  const buttonReady = button?.getAttribute('submit-text') === '发布' && button.getAttribute('submit-disabled') === 'false' && button.getAttribute('submit-loading') === 'false';
  const blockers = [...document.querySelectorAll('[role="dialog"], .d-modal-mask')].filter(visible);
  const errors = [...document.querySelectorAll('[role="alert"], [class*="toast"]')].filter(visible).map(node => node.innerText.trim()).filter(text => /上传失败|网络错误/.test(text));
  const privacy = store?.privacyInfo;
  const publicOnly = !Object.keys(privacy || {}).length || privacy.type === 0 && privacy.opType === 1 && Array.isArray(privacy.userIds) && privacy.userIds.length === 0;
  const gates = {
    authenticated: !!account && !location.pathname.includes('login'),
    account: !!account && (!authenticatedAccount || authenticatedAccount === account) && (!expected.account || account === expected.account),
    composer: (!!uploadPage && !!authenticatedAccount || !!store && !!root && editors.length === 1 && !!titleInput
      && store.imageNoteOrigin === 0 && !store.postTiming && publicOnly && !store.collectionId) && location.hostname === 'creator.xiaohongshu.com',
    text: !!doc && bodySupported && text === expected.text && topicsOk && htmlMatches && store?.desc === nativeDesc
      && titleInput?.value === expected.title && store?.title === expected.title && Number.isFinite(store?.descLength) && store.descLength <= 1000,
    media: expected.assets.length > 0 && ordered && receipts,
    upload: !!buttonReady && errors.length === 0 && store?.isImageReady === true
      && images.every(image => image.media?.status === 2 && image.media.progress === 1 && typeof image.media.uploadId === 'string' && !!image.media.uploadId),
    noBlockingDialog: blockers.length === 0,
    safety: guard?.version === 3 && guard.armed === true && guard.fingerprint === expected.fingerprint && guard.blockedAttempts.length === 0,
  };
  if(expected.videoPath){
    gates.composer=gates.composer&&store?.publishType===0&&store?.hasBeenPublished===false&&store?.isPublishing===false;
    gates.media=receipts&&items.length===0&&images.length===0&&videoSha256===expected.assets[0]?.sha256&&videoFile?.size===expected.assets[0]?.size
      &&!!videoBlob&&!videoBlob.pending&&!videoBlob.error&&videoBlob.sha256===videoSha256&&videoBlob.size===videoFile.size
      &&video?.fsize===videoFile.size&&video.width>0&&video.height>0&&Number.isFinite(video.duration)&&video.duration>0
      &&Number(store?.videoInfo?.Width)===video.width&&Number(store?.videoInfo?.Height)===video.height&&Math.abs(Number(store?.videoInfo?.Duration)-video.duration)<0.1;
    gates.upload=!!buttonReady&&errors.length===0&&store?.isVideoReady===true&&Number(store?.uploadPercent)===100&&!!video?.fileid&&!!videoMedia.coverMatches;
  }
  return { observedAt: new Date().toISOString(), account, title: titleInput?.value || '', text, editorText: store?.desc ?? (uploadPage ? '' : null), nativeDesc, descLength: store?.descLength,
    topics, images, videos: document.querySelectorAll('.publish-page-content-base video').length, videoPreviews:videoMedia?[{media:videoMedia}]:[], files, errors, gates,
    finalPublishClicked: false, blockedAttempts: guard?.blockedAttempts.length ?? null, button: button && { text: button.getAttribute('submit-text'), disabled: !buttonReady, closedComponent: true } };
}

function xhsTopicState({tag, mark = false} = {}) {
  const visible = node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      && Number(style.opacity) > 0.01 && node.getAttribute('aria-hidden') !== 'true';
  };
  const rows = [...document.querySelectorAll('#creator-editor-topic-container .item')].filter(visible);
  const matches = rows.filter(node => node.querySelector('.name')?.textContent.trim() === '#' + tag);
  const blocks = document.querySelector('.tiptap')?.editor?.getJSON()?.content || [];
  const topics = blocks.flatMap(block => (block.content || []).filter(node => node.type === 'topic').map(node => node.attrs?.data));
  const result = {matches: matches.length, candidates: rows.slice(0, 8).map(node => node.querySelector('.name')?.textContent.trim().slice(0, 80)),
    topics: topics.map(topic => ({name: topic?.name, id: topic?.id})), activeTag: document.activeElement?.tagName};
  if (mark) {
    if (matches.length !== 1) throw new Error('Expected one visible exact topic candidate; found ' + matches.length);
    if (document.querySelector('[data-168-publisher-topic-target]')) throw new Error('Topic target marker already exists');
    matches[0].setAttribute('data-168-publisher-topic-target', 'true');
  }
  return result;
}

export function fillXhsScript(state) {
  return `
let topicTag = null, topicStep = 'wait_editor', topicMarkerOwned = false, topicControlLost = false;
try {
await page.waitForSelector('.tiptap[contenteditable="true"]', { state: 'visible', timeout: 30000 });
const topicDeadline = Date.now() + 30000;
const topicTimeout = limit => { const left = topicDeadline - Date.now(); if (left <= 0) throw new Error('Content action window expired'); return Math.min(limit, left); };
topicStep = 'close_guide';
const guide = await page.evaluate(() => !!document.querySelector('button[aria-label="关闭新功能引导"]'));
if (guide) await page.click('button[aria-label="关闭新功能引导"]');
topicStep = 'fill_title';
await page.fill('input[placeholder="填写标题会有更多赞哦"]', state.pkg.title);
topicStep = 'fill_body';
await page.focus('.tiptap[contenteditable="true"]');
await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace');
if (state.pkg.text) await page.keyboard.paste(state.pkg.text);
topicStep = 'confirm_body';
await page.waitForFunction(text => document.querySelector('.tiptap')?.editor?.getText({blockSeparator:'\\n'}) === text, state.pkg.text, {timeout:topicTimeout(10000)});
if (state.pkg.tags.length) { await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); }
for (const [index, tag] of state.pkg.tags.entries()) {
  topicTag = tag; topicStep = 'trigger_topic'; topicTimeout(10000);
  await page.focus('.tiptap[contenteditable="true"]');
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' #' + tag);
  topicStep = 'find_candidate';
  await page.waitForFunction(tag => (${xhsTopicState.toString()})({tag}).matches > 0, tag, {timeout:topicTimeout(10000)});
  topicStep = 'select_candidate';
  await page.evaluate(${xhsTopicState.toString()}, {tag, mark:true});
  topicMarkerOwned = true;
  await page.click('[data-168-publisher-topic-target="true"]');
  await page.evaluate(() => document.querySelectorAll('[data-168-publisher-topic-target]').forEach(node => node.removeAttribute('data-168-publisher-topic-target')));
  topicMarkerOwned = false;
  topicStep = 'confirm_entity';
  await page.waitForFunction(tags => {
    const topics = (${xhsTopicState.toString()})().topics;
    return topics.length === tags.length && topics.every((topic, index) => topic.name === tags[index] && typeof topic.id === 'string' && !!topic.id);
  }, state.pkg.tags.slice(0, index + 1), {timeout:topicTimeout(10000)});
}
topicTag = null; topicStep = 'blur_editor';
await page.focus('input[placeholder="填写标题会有更多赞哦"]');
topicStep = 'verify_text';
await page.waitForFunction(async expected => (await (${observeXhs.toString()})(expected)).gates.text, expected, {timeout:topicTimeout(10000)});
console.log('Native title, body and topic entities entered; independent verification required');
} catch (error) {
  if (/USER_CONTROL|user now controls|user-controlled/i.test(error.message)) { topicControlLost = true; throw error; }
  let snapshot;
  try { snapshot = await page.evaluate(${xhsTopicState.toString()}, {tag:topicTag}); snapshot.topics = snapshot.topics.slice(0, 8).map(topic => ({name:topic.name, hasId:typeof topic.id === 'string' && !!topic.id})); } catch { snapshot = {unavailable:true}; }
  throw new Error('XHS content failed: ' + JSON.stringify({tag:topicTag, step:topicStep, snapshot}) + '; ' + error.message);
} finally {
  if (topicMarkerOwned && !topicControlLost) try { await page.evaluate(() => document.querySelectorAll('[data-168-publisher-topic-target]').forEach(node => node.removeAttribute('data-168-publisher-topic-target'))); } catch {}
}
`;
}
