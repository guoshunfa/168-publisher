export function armGuard(fingerprint) {
  const platform = typeof fingerprint === "object" ? fingerprint.platform : "x";
  if (typeof fingerprint === "object") fingerprint = fingerprint.fingerprint;
  if (!["x", "weibo", "xiaohongshu", "jike"].includes(platform)) throw new Error("Unknown guard platform");
  const key = {x: '__168_PUBLISHER_X__', weibo: '__168_PUBLISHER_WEIBO__', xiaohongshu: '__168_PUBLISHER_XHS__', jike: '__168_PUBLISHER_JIKE__'}[platform];
  const version = platform === 'xiaohongshu' ? 3 : 2;
  const old = window[key];
  if (old) {
    if (old.fingerprint !== fingerprint || old.blockedAttempts.length) throw new Error("Draft guard identity changed or unsafe");
    if (old.armed && old.version === version) return { armed: true };
    if (typeof old.release !== "function") throw new Error("Unknown guard version");
    if(old.armed)old.release();
  }
  const guard = { version, fingerprint, armed: true, blockedAttempts: [], files: old?.files || [], blobs: old?.blobs || {} };
  const stop = event => {
    if (!guard.armed) return;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const control = target?.closest('button, a, [role="button"]');
    // The closed XHS component retargets clicks to its host; protect the entire footer, including draft save.
    const final = platform === "xiaohongshu" && target?.closest('xhs-publish-btn') || (platform !== "x" ? control && /^(发送|发表|群发|确认发表|确认群发|立即发表|定时发表|发布|立即发布|确认发布|确定并发布|提交审核|发布微博|定时发布|定时发送|定时|保存并发布|发布笔记)$/.test((control.innerText || control.getAttribute("aria-label") || "").trim())
      : target?.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], [data-testid="scheduleOption"]'));
    const shortcut = ["keydown", "keyup", "keypress"].includes(event.type) && event.key === "Enter" && (event.metaKey || event.ctrlKey);
    if (final || shortcut || event.type === "submit") {
      event.preventDefault(); event.stopImmediatePropagation();
      guard.blockedAttempts.push({ type: event.type, at: Date.now() });
    }
  };
  for (const event of ["click", "keydown", "keyup", "keypress", "submit"]) window.addEventListener(event, stop, true);
  const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
  const seenChanges = new WeakSet();
  const change = event => {
    const target = event.target;
    if (!target.matches?.(platform !== "x" ? 'input[type="file"]' : '[role="dialog"] input[data-testid="fileInput"]')) return;
    if (seenChanges.has(event)) return;
    seenChanges.add(event);
    const records = [...target.files].map(file => ({ name: file.name, size: file.size, type: file.type, pending: true }));
    guard.files = records;
    [...target.files].forEach(async (file, index) => {
      try { records[index].sha256 = await hash(file); records[index].pending = false; }
      catch { records[index].error = true; }
    });
  };
  window.addEventListener("change", change, true);
  const create = URL.createObjectURL;
  const tracked = function(blob) {
    const url = create.call(URL, blob);
    const receipt = guard.blobs[url] = { size: blob.size, pending: true };
    hash(blob).then(sha256 => Object.assign(receipt, { sha256, pending: false }), () => { receipt.error = true; });
    return url;
  };
  URL.createObjectURL = tracked;
  guard.release = () => {
    if (!guard.armed || guard.blockedAttempts.length) throw new Error("Guard cannot be released");
    guard.armed = false;
    for (const event of ["click", "keydown", "keyup", "keypress", "submit"]) window.removeEventListener(event, stop, true);
    window.removeEventListener("change", change, true);
    if (URL.createObjectURL === tracked) URL.createObjectURL = create;
    return { ok: true };
  };
  window[key] = guard;
  return { armed: true };
}

export function observeX(expected) {
  const visible = e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden";
  const editors = [...document.querySelectorAll('[role="dialog"] [data-testid^="tweetTextarea_"][contenteditable="true"]')].filter(visible);
  const editor = editors.length === 1 ? editors[0] : null;
  const dialog = editor?.closest('[role="dialog"]');
  const button = dialog?.querySelector('[data-testid="tweetButton"]');
  const guard = window.__168_PUBLISHER_X__;
  const account = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.innerText.match(/@[a-zA-Z0-9_]+/)?.[0] || "";
  const groups = [...(dialog?.querySelectorAll('[role="group"]') || [])];
  const readMedia = node => {
    const src = node.currentSrc || node.src;
    let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
    let media = null;
    // The mounted media component's current props avoid stale functional-fiber upload state.
    for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
      const items = fiber.stateNode?.props?.media;
      if (!Array.isArray(items)) continue;
      const matches = items.filter(item => item.mediaFile?.url === src);
      if (matches.length === 1) {
        const item = matches[0];
        const original = guard?.blobs[item.originalMediaFile?.url];
        media = { count: items.length, originalSha256: original && !original.pending && !original.error ? original.sha256 || "" : "",
          originalSize: item.originalMediaFile?.fileHandle?.size, currentUrl: item.mediaFile.url,
          isVideo: item.mediaFile.isVideo === true,
          uploadId: item.uploadId || "", uploading: item.uploading, uploadProgress: item.uploadProgress,
          uploadFailed: item.uploadFailed, needsProcessing: item.needsProcessing };
      }
      break;
    }
    return media;
  };
  const images = [...new Set(groups.flatMap(group => [...group.querySelectorAll('img')]))].filter(visible).map(img => {
    return { src: img.src, sha256: guard?.blobs[img.src]?.sha256 || "", width: img.naturalWidth, height: img.naturalHeight,
      loaded: img.complete && img.naturalWidth > 0, media: readMedia(img) };
  });
  const files = (guard?.files || []).map(file => ({ ...file }));
  const videoPreviews = [...(dialog?.querySelectorAll('video') || [])].filter(visible).map(video => ({
    src: video.currentSrc || video.src, duration: Number.isFinite(video.duration) ? video.duration : null,
    width: video.videoWidth, height: video.videoHeight, loaded: video.readyState >= 2 && video.videoWidth > 0 && !video.error,
    sha256: guard?.blobs[video.currentSrc || video.src]?.sha256 || "", media: readMedia(video),
  }));
  const videos = videoPreviews.length;
  const videoMode = expected.assets.length === 1 && expected.assets[0].kind === "video";
  const previews = videoMode ? videoPreviews : images;
  const correctType = videoMode ? images.length === 0 && videos === 1 && videoPreviews[0].duration > 0 && videoPreviews[0].duration <= 140 : videos === 0;
  const ordered = correctType && previews.length === expected.assets.length && previews.every((item, index) => item.loaded && !!item.sha256
    && item.media?.count === expected.assets.length && item.media.currentUrl === item.src && item.media.isVideo === videoMode
    && item.media.originalSha256 === expected.assets[index].sha256 && item.media.originalSize === expected.assets[index].size);
  const receipts = files.length === expected.assets.length && files.every((file, index) => !file.pending && !file.error && file.sha256 === expected.assets[index].sha256 && file.size === expected.assets[index].size);
  const mediaProgress = groups.filter(group => group.querySelector('img, video'))
    .flatMap(group => [...group.querySelectorAll('[role="progressbar"], [role="progressindicator"]')]).some(visible);
  const blockers = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].filter(e => visible(e) && !e.contains(editor) && !editor?.contains(e));
  const errors = [...document.querySelectorAll('[role="alert"]')].filter(visible).map(node=>node.innerText).filter(text=>/失败|错误|failed|error/i.test(text));
  const rawText = editor?.innerText === "\n" ? "" : (editor?.innerText || "").replace(/\r\n/g, "\n");
  const blocks = [...(editor?.querySelectorAll('[data-block="true"]') || [])];
  // innerText adds a layout newline for empty DraftJS blocks; block text preserves actual blank lines.
  const actualText = blocks.length ? blocks.map(block => block.textContent || "").join("\n").replace(/\r\n/g, "\n") : rawText;
  let editorText = null;
  let fiber = editor?.[Object.keys(editor).find(key => key.startsWith("__reactFiber$"))];
  // Current component props avoid accepting DOM-only edits or stale alternate fibers.
  for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
    const state = fiber.stateNode?.props?.editorState;
    if (typeof state?.getCurrentContent !== "function") continue;
    try { editorText = state.getCurrentContent().getPlainText().replace(/\r\n/g, "\n"); } catch {}
    break;
  }
  const gates = {
    authenticated: !!account && !location.pathname.includes('/i/flow/login'),
    account: !!account && (!expected.account || account === expected.account),
    composer: editors.length === 1 && location.hostname === "x.com",
    text: !!editor && actualText === expected.text && editorText === expected.text,
    media: ordered && receipts,
    upload: !!dialog && !mediaProgress
      && previews.every(img => img.media?.uploading === false && img.media.needsProcessing === false
        && img.media.uploadFailed === false && img.media.uploadProgress === 1 && typeof img.media.uploadId === "string" && !!img.media.uploadId)
      && !!button && !button.disabled && button.getAttribute("aria-disabled") !== "true",
    noBlockingDialog: blockers.length === 0 && errors.length === 0,
    safety: guard?.version === 2 && guard.armed === true && guard.fingerprint === expected.fingerprint && guard.blockedAttempts.length === 0,
  };
  return { observedAt: new Date().toISOString(), account, text: actualText, rawText, editorText, images, videos, videoPreviews, files, errors, gates,
    finalPublishClicked: false, guardVersion: guard?.version ?? null, blockedAttempts: guard?.blockedAttempts.length ?? null,
    button: button && { text: button.innerText, disabled: button.disabled, ariaDisabled: button.getAttribute("aria-disabled") },
    dialogCount: blockers.length };
}
