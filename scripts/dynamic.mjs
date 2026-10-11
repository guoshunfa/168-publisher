#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {dynamicAudit,addAuditErrors,reviewMedia} from './content-audit.mjs';
import { normalizeDynamic, materializeImages, materializeVideo, sha256 } from "./dynamic-input.mjs";
import { armGuard, observeX } from "./x-page.mjs";
import { observeWeibo } from "./weibo-page.mjs";
import { observeXhs, fillXhsScript } from "./xhs-page.mjs";
import { observeJike } from "./jike-page.mjs";
import { PREFIX, readJson, writeJson, ego, checkProfile, isMain, openDraftPageScript, clearCurrentEditor } from "./runtime.mjs";
import { acquireJobLock, resolvePublisherLockDirectory } from "../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs";

import {parseDynamicOptions,existingSpaceScript,resultFrom,assertManualSendContent} from './task.mjs';
export {parseDynamicOptions,existingSpaceScript,resultFrom} from './task.mjs';

export function dynamicVerdict(observation, state = {}) {
  const gates = observation.gates || {};
  const preparationRequired = state.preparationPending && (!state.uploadAttempted || !gates.text);
  const canResumePreparation = preparationRequired && (!state.uploadAttempted || gates.media && observation.uploadComplete === true);
  const previewPending = gates.text === true && state.pkg?.platform === 'x' && !!state.pkg.videoPath && state.uploadAttempted === true
    && state.assets?.length === 1 && state.assets[0].kind === 'video' && observation.images?.length === 0
    && observation.videos === 0 && observation.videoPreviews?.length === 0 && observation.files?.length === 1
    && observation.files.every((file,index)=>!file.pending&&!file.error&&file.sha256===state.assets[index].sha256&&file.size===state.assets[index].size);
  const missing = ["authenticated", "account", "composer", "text", "media", "upload", "noBlockingDialog", "safety"].filter(gate => gates[gate] !== true);
  const status = !missing.length ? "draft_verified" : !gates.authenticated ? "needs_login"
    : !gates.safety || !gates.account || !gates.composer || observation.editorText === null ? "result_unknown"
    : observation.errors?.length || [...(observation.images || []), ...(observation.videoPreviews || [])].some(item => item.media?.uploadFailed === true) ? "failed"
    : !gates.noBlockingDialog ? observation.rateLimited === true ? "processing" : "needs_user"
    : previewPending ? "processing"
    : canResumePreparation ? "processing"
    : observation.mediaPending === true ? "processing"
    : !gates.media ? "result_unknown"
    : !gates.upload ? "processing" : "failed";
  const waitingFor = status === 'processing' && observation.rateLimited === true ? 'rate_limit'
    : status === 'processing' && canResumePreparation && gates.noBlockingDialog ? 'preparation'
    : status === 'processing' && previewPending ? 'media_preview' : undefined;
  return { ready: !missing.length, status, missing, waitingFor, resumePreparation: waitingFor === 'preparation' };
}
export function assertDynamicReady(observation, state, now = Date.now()) {
  const verdict = dynamicVerdict(observation);
  const age = now - Date.parse(observation.observedAt);
  if (!verdict.ready || observation.finalPublishClicked !== false || observation.taskSpaceId !== state.taskSpaceId
    || observation.account !== state.account || !Number.isFinite(age) || age < 0 || age > 60000) throw new Error("Draft not freshly verified; manual handoff stopped");
}
const observer = state => state.pkg.platform === "jike" ? observeJike : state.pkg.platform === "xiaohongshu" ? observeXhs : state.pkg.platform === "weibo" ? observeWeibo : observeX;
const guardKey = state => state.pkg.platform === "jike" ? "__168_PUBLISHER_JIKE__" : state.pkg.platform === "xiaohongshu" ? "__168_PUBLISHER_XHS__" : state.pkg.platform === "weibo" ? "__168_PUBLISHER_WEIBO__" : "__168_PUBLISHER_X__";
const observeScript = state => existingSpaceScript(state) + `
const observation = await page.evaluate(${observer(state).toString()}, expected);
console.log(${JSON.stringify(PREFIX)} + JSON.stringify({ ...observation, taskSpaceId: task.spaceId }));`;
export function handoffDynamicScript(state, defer = false) {
  return existingSpaceScript(state) + `
const fresh = await page.evaluate(${observer(state).toString()}, expected);
if (Object.values(fresh.gates).some(ok => ok !== true)) throw new Error("Draft changed before handoff");
const released = await page.evaluate(() => window[${JSON.stringify(guardKey(state))}].release());
${defer?'':'await task.handOff();'}
console.log(${JSON.stringify(PREFIX)} + JSON.stringify({ status: "awaiting_manual_send", taskSpaceId: task.spaceId, finalPublishClicked: false, released }));`;
}

export async function main(argv = process.argv.slice(2)) {
  if (process.platform !== "darwin") throw new Error("168 同步发布 supports macOS only");
  const args=[...argv];let space,pageLabel;
  const labelIndex=args.indexOf('--page-label');if(labelIndex>=0){pageLabel=args[labelIndex+1];args.splice(labelIndex,2);if(!/^p[1-9][0-9]*$/.test(pageLabel||'')||args.includes('--page-label'))throw new Error('Invalid page label');}
  const actionsOnly=args.includes('--actions-only');if(actionsOnly)args.splice(args.indexOf('--actions-only'),1);
  const i=args.indexOf('--space');if(i>=0){space=args[i+1];args.splice(i,2);if(!/^\d+$/.test(space||'')||args.includes('--space'))throw new Error('Invalid space');}
  const options = parseDynamicOptions(args);
  if(space&&options.command!=='prepare')throw new Error('--space only valid for new preparation');
  const packagePath = path.resolve(options.package);
  const raw = readJson(packagePath);
  const audit=options.command==='check'?dynamicAudit(options.platform,raw,path.dirname(packagePath)):null;
  // Derive the original job identity before applying new-task requirements to historical drafts.
  let pkg;try{pkg=normalizeDynamic(raw,path.dirname(packagePath),options.platform,{allowIncomplete:true});}catch(error){if(!audit)throw error;addAuditErrors(audit,[error.message]);console.log(JSON.stringify({status:'failed',audit,errors:audit.errors},null,2));process.exitCode=1;return;}
  if (options.command === 'handoff') assertManualSendContent(pkg);
  const inputFingerprint = sha256(JSON.stringify(pkg));
  const jobId = options["job-id"] || inputFingerprint.slice(0, 16);
  const root = path.resolve(options["state-root"] || path.join(os.homedir(), ".168-publisher/dynamic-jobs"));
  const jobDir = path.join(root, jobId), statePath = path.join(jobDir, "state.json");
  // ponytail: share the existing global browser lock; per-account locks only if throughput requires them.
  const directory = resolvePublisherLockDirectory();
  const release = acquireJobLock(directory, { jobId, scope: "publisher" });
  const lock = { directory, release };
  let state = fs.existsSync(statePath) ? readJson(statePath) : null;
  if(audit&&state){const historical=dynamicAudit(options.platform,raw,path.dirname(packagePath),{legacy:true});Object.assign(audit,historical);}
  const report = (observation, emit = true) => {
    const verdict = dynamicVerdict(observation, state);
    state.status = verdict.status; state.observedAt = observation.observedAt;
    delete state.error;
    writeJson(path.join(jobDir, "last-verification.json"), { observation, verdict });
    writeJson(statePath, state);
    if(emit){
      console.log(JSON.stringify({ jobId, ...verdict, taskSpaceId: state.taskSpaceId, account: observation.account, finalPublishClicked: false, evidencePath: path.join(jobDir, "last-verification.json") }, null, 2));
      if (!verdict.ready) process.exitCode = 10;
    }
    return verdict;
  };
  try {
    if(options.command!=='check'&&fs.existsSync(path.join(jobDir,'publication.json')))throw new Error('Publication already attempted; check original page, do not resend');
    if(audit?.errors.length){console.log(JSON.stringify({status:'failed',audit,errors:audit.errors},null,2));process.exitCode=1;return;}
    if (!state) normalizeDynamic(raw, path.dirname(packagePath), options.platform);
    if (state?.handoff && options.command !== 'check') throw new Error("Already handed off or handoff result unknown; check original page, do not resend");
    if (state && (state.jobId !== jobId || JSON.stringify(state.pkg) !== JSON.stringify(pkg) || state.inputFingerprint !== inputFingerprint || (options.profile && state.profile !== options.profile) || (space && Number(space)!==state.taskSpaceId))) throw new Error("Existing draft content or Profile changed");
    if (!state && ["inspect", "handoff"].includes(options.command)) throw new Error("Existing draft state required");
    const assets = pkg.videoPath ? await materializeVideo(pkg, state?.assets) : await materializeImages(pkg, path.join(jobDir, "assets"), state?.assets);
    const fingerprint = sha256(JSON.stringify({ pkg, media: assets.map(asset => asset.sha256) }));
    if (state && state.fingerprint !== fingerprint) throw new Error("Existing media fingerprint changed");
    if(audit)for(const [index,asset] of assets.entries())if(asset.kind!=='video'){const review=reviewMedia(options.platform,'dynamic','image',{...asset,sizeBytes:asset.size,exists:true},{field:`images[${index}]`});addAuditErrors(audit,review.errors,review.issues);}
    if(audit?.errors.length){audit.status='failed';console.log(JSON.stringify({status:'failed',audit,errors:audit.errors},null,2));process.exitCode=1;return;}
    if (options.command === "check") { console.log(JSON.stringify({ status: "input_checked", audit, pkg, assets, fingerprint }, null, 2)); return; }
    await checkProfile(options.profile || state?.profile, lock);
    if (!state) {
      state = { version: 1, jobId, packagePath, inputFingerprint, fingerprint, pkg, assets, profile: options.profile || "", taskSpaceName: `168 publisher ${options.platform} ${jobId} ${crypto.randomUUID()}`, stage: "opening", uploadAttempted: false };
      writeJson(statePath, state);
    }
    if (!state.taskSpaceId) {
      if(state.pageOpeningAttempted)throw new Error('Page creation outcome unknown; refusing another page');
      state.pageOpeningAttempted=true;writeJson(statePath,state);
      const created = resultFrom(await ego(openDraftPageScript(state,space,pageLabel),lock));
      Object.assign(state, created); writeJson(statePath, state);
      if(!pageLabel)await ego(existingSpaceScript(state) + `await page.goto(${JSON.stringify(options.platform === "jike" ? "https://web.okjike.com/following" : options.platform === "xiaohongshu" ? "https://creator.xiaohongshu.com/publish/publish?source=official" : options.platform === "weibo" ? "https://weibo.com/" : "https://x.com/compose/post")}); console.log("Composer opened");`, lock);
      state.stage = "opened"; writeJson(statePath, state);
    }
    if (options["resume-control"]) await ego(existingSpaceScript(state, true) + `console.log("Original control resumed");`, lock);
    if (options.command === "prepare") {
      await ego(existingSpaceScript(state)+`await page.cdp('Page.bringToFront',{});console.log('Current platform focused');`,lock);
      if (options.platform === "xiaohongshu" && !pkg.videoPath && !state.uploadAttempted) await ego(existingSpaceScript(state) + `
await page.evaluate(${armGuard.toString()}, {platform:state.pkg.platform,fingerprint:state.fingerprint});
await page.waitForFunction(() => location.pathname.includes('login') || document.querySelector('.creator-tab'), undefined, {timeout:30000});
if (!await page.evaluate(() => location.pathname.includes('login'))) {
  await page.evaluate(() => {
    if (document.querySelector('input.upload-input[accept*=".jpg"]') || document.querySelector('.tiptap')) return;
    const tabs = [...document.querySelectorAll('.creator-tab')].filter(node => {
      const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
      return node.textContent.trim()==='上传图文' && rect.left>=0 && rect.top>=0 && rect.width>0 && rect.height>0 && Number(style.opacity)>0.01 && node.getAttribute('aria-hidden')!=='true';
    });
    if (tabs.length!==1) throw new Error('Graphic tab ambiguous');
    tabs[0].id='publisher-xhs-image-tab';
  });
  if (await page.evaluate(() => !!document.querySelector('#publisher-xhs-image-tab'))) await page.click('#publisher-xhs-image-tab .title');
}
console.log('Graphic entry selected');`, lock);
      const xhsFileSelector=pkg.videoPath?'input.upload-input[accept*=".mp4"]':'input.upload-input[accept*=".jpg"]';
      const editorSelector = options.platform === "jike" ? '[data-lexical-editor="true"][contenteditable="true"]' : options.platform === "xiaohongshu" ? '.tiptap[contenteditable="true"], '+xhsFileSelector : options.platform === "weibo" ? 'textarea[placeholder="有什么新鲜事想分享给大家？"]' : '[role="dialog"] [data-testid="tweetTextarea_0"][contenteditable="true"]';
      const fileSelector = options.platform === "xiaohongshu" ? xhsFileSelector : ["weibo", "jike"].includes(options.platform) ? 'input[type="file"]' : '[role="dialog"] input[data-testid="fileInput"]';
      let initial = resultFrom(await ego(existingSpaceScript(state) + `
await page.evaluate(${armGuard.toString()}, { platform: state.pkg.platform, fingerprint: state.fingerprint });
await page.waitForFunction(() => location.pathname.includes('login') || [...document.querySelectorAll(${JSON.stringify(editorSelector)})].some(e => e.type === 'file' || e.getBoundingClientRect().height > 0), undefined, { timeout: 30000 });
console.log(${JSON.stringify(PREFIX)} + JSON.stringify(await page.evaluate(${observer(state).toString()}, expected)));`, lock));
      if (!initial.gates.authenticated) { state.status = "needs_login"; writeJson(statePath, state); console.log(JSON.stringify({ jobId, status: state.status, taskSpaceId: state.taskSpaceId }, null, 2)); process.exitCode = 10; return; }
      if (!initial.gates.composer || !initial.gates.account || !initial.gates.safety) throw new Error("Composer, account or guard not proven");
      if(state.account&&initial.account!==state.account)throw new Error('Original account changed');
      if (!state.account) { state.account = initial.account; writeJson(statePath, state); }
      if(initial.rateLimited===true){state.preparationPending=true;if(actionsOnly){state.status='needs_user';writeJson(statePath,state);console.log(JSON.stringify({jobId,status:'needs_user',waitingFor:'rate_limit',taskSpaceId:state.taskSpaceId,finalPublishClicked:false}));process.exitCode=10;}else report(initial);return;}
      if(initial.gates.noBlockingDialog===false)throw new Error("PLATFORM_BLOCKED: platform blocker requires user handling before content changes");
      if(actionsOnly&&state.uploadAttempted&&!initial.gates.media){
        const selected=(initial.files||[]);
        if(selected.length!==state.assets.length||!selected.every((file,index)=>!file.error&&file.size===state.assets[index].size&&file.sha256===state.assets[index].sha256))throw new Error('Original media association unknown; refusing reupload');
      }
      if(!actionsOnly&&state.preparationPending&&state.uploadAttempted&&!initial.gates.media){report(initial);return;}
      if(!state.uploadAttempted&&!state.cleanupComplete){
        if(state.cleanupAttempted)throw new Error('History cleanup outcome unknown');
        const dirty=initial.text.trim()||initial.title||initial.images.length||initial.videos||initial.files.length||initial.videoPreviews?.some(v=>v.media?.originalSize);
        if(dirty){
        writeJson(path.join(jobDir,'stale-content.json'),initial);
        state.cleanupAttempted=true;writeJson(statePath,state);
        await ego(existingSpaceScript(state)+`await (${clearCurrentEditor.toString()})(page,{type:'dynamic',platform:state.pkg.platform});console.log('Historical editor content cleared');`,lock);
        initial=resultFrom(await ego(existingSpaceScript(state)+`await page.waitForFunction(async expected=>{const o=await (${observer(state).toString()})(expected);return !o.text.trim()&&!o.title&&!o.images.length&&!o.videos&&!o.files.length&&!o.videoPreviews?.some(v=>v.media?.originalSize);},expected,{timeout:15000});console.log(${JSON.stringify(PREFIX)}+JSON.stringify(await page.evaluate(${observer(state).toString()},expected)));`,lock));
        if(initial.text.trim()||initial.title||initial.images.length||initial.videos||initial.files.length||initial.videoPreviews?.some(v=>v.media?.originalSize))throw new Error('History cleanup did not produce an empty editor');
        if(!initial.gates.account||!initial.gates.safety)throw new Error('Account or safety changed during cleanup');
        }
        state.cleanupComplete=true;writeJson(statePath,state);
      }
      if(initial.rateLimited===true){state.preparationPending=true;if(actionsOnly){state.status='needs_user';writeJson(statePath,state);console.log(JSON.stringify({jobId,status:'needs_user',waitingFor:'rate_limit',taskSpaceId:state.taskSpaceId,finalPublishClicked:false}));process.exitCode=10;}else report(initial);return;}
      if(initial.gates.noBlockingDialog===false)throw new Error("PLATFORM_BLOCKED: platform blocker requires user handling before content changes");
      if (!initial.gates.text && ((initial.text.trim() && initial.text !== pkg.text) || (initial.editorText?.trim() && initial.editorText !== pkg.text))) throw new Error("Unexpected existing text; refusing overwrite or upload");
      if (initial.title && initial.title !== pkg.title) throw new Error("Unexpected existing title; refusing overwrite or upload");
      if (!state.uploadAttempted && !initial.gates.media) {
        if (initial.images.length || initial.videos || initial.files.length || initial.native?.picIds?.length || initial.native?.mediaKeys?.length || initial.native?.ids?.length
          || initial.videoPreviews?.some(item=>item.media?.originalSize>0||item.media?.uploadId||item.media?.originalSha256)) throw new Error("Unexpected media present; refusing to replace it");
        console.error(JSON.stringify({progress:{platform:options.platform,step:'submit_media'}}));
        state.uploadAttempted = true; writeJson(statePath, state);
        await ego(existingSpaceScript(state) + `
await page.setInputFiles(${JSON.stringify(fileSelector)}, state.assets.map(asset => asset.path));
${actionsOnly?'':`await page.waitForFunction(() => window[${JSON.stringify(guardKey(state))}]?.files.length > 0 && window[${JSON.stringify(guardKey(state))}].files.every(f => !f.pending), undefined, { timeout: 30000 });`}
console.log("Upload input submitted; server completion is not awaited");`, lock);
        if(options.platform==='jike'){
          initial=resultFrom(await ego(observeScript(state),lock));
          if(initial.rateLimited===true){state.preparationPending=true;if(actionsOnly){state.status='needs_user';writeJson(statePath,state);console.log(JSON.stringify({jobId,status:'needs_user',waitingFor:'rate_limit',taskSpaceId:state.taskSpaceId,finalPublishClicked:false}));process.exitCode=10;}else report(initial);return;}
          if(!initial.gates.authenticated||!initial.gates.account||!initial.gates.composer||!initial.gates.safety||initial.gates.noBlockingDialog===false){report(initial);return;}
        }
      }
      if (!initial.gates.text) {
        console.error(JSON.stringify({progress:{platform:options.platform,step:'fill_title_body_tags'}}));
        await ego(existingSpaceScript(state) + (options.platform === "xiaohongshu" ? fillXhsScript(state) : `
await page.focus(${JSON.stringify(editorSelector)});
await page.keyboard.press('Meta+A');
await page.keyboard.press('Backspace');
if (state.pkg.text) await page.keyboard.paste(state.pkg.text);
await page.waitForFunction(async expected => (await (${observer(state).toString()})(expected)).gates.text, expected, { timeout: 10000 });
console.log("Text entered; independent verification required");`), lock);
      }
      delete state.preparationPending;
      writeJson(statePath,state);
    }
    if (options.platform === "jike" && options.command === "prepare") await ego(existingSpaceScript(state) + `
if (await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].some(node => node.innerText.trim()==='从草稿箱中恢复未发送的内容' && node.querySelector('button[aria-label="关闭提示"]')))) {
  await page.click('button[aria-label="关闭提示"]');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="关闭提示"]'), undefined, {timeout:10000});
}
console.log('Draft recovery guide checked; no draft recovery or final send');`, lock);
    const observation = resultFrom(await ego(observeScript(state), lock));
    if (options.command === "handoff") {
      report(observation,false);
      assertDynamicReady(observation, state);
      state.handoff = { status: "result_unknown", at: new Date().toISOString() }; writeJson(statePath, state);
      const receipt = resultFrom(await ego(handoffDynamicScript(state,options['defer-handoff']), lock));
      if (receipt.status !== "awaiting_manual_send" || receipt.finalPublishClicked !== false || !receipt.released?.ok) throw new Error("Handoff result unknown");
      state.handoff = receipt; writeJson(statePath, state); console.log(JSON.stringify(receipt, null, 2)); return;
    }
    if(actionsOnly&&options.command==='prepare'){
      const missing=['authenticated','account','composer','text','noBlockingDialog','safety'].filter(gate=>observation.gates[gate]!==true);
      const failed=observation.errors?.length||observation.videoPreviews?.some(v=>v.media?.uploadFailed===true);
      const complete=missing.length===0&&state.uploadAttempted===true&&!failed;
      const status=complete?'configured':!observation.gates.authenticated?'needs_login':failed?'failed':'needs_user';
      state.status=status;state.configurationComplete=complete;writeJson(statePath,state);
      console.log(JSON.stringify({jobId,status,configurationComplete:complete,missing,taskSpaceId:state.taskSpaceId,finalPublishClicked:false,uploadStatus:'not_awaited'},null,2));
      if(!complete)process.exitCode=10;
      return;
    }
    report(observation);
  } catch (error) {
    error.status = /permission prompt|user now controls|USER_CONTROL|PLATFORM_BLOCKED/i.test(error.message) ? "needs_user" : "result_unknown";
    if(options.command==='check'){addAuditErrors(audit,[error.message]);console.log(JSON.stringify({status:'failed',audit,errors:audit.errors},null,2));process.exitCode=1;return;}
    if (state) {
      state.status = error.status;
      state.error = error.message; writeJson(statePath, state);
    }
    throw error;
  } finally { release(); }
}
if (isMain(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: error.status || "result_unknown", error: error.message })); process.exitCode = 1; });
}
