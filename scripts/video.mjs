#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { coverForPlatform } from "../assets/vendor/video-publisher/scripts/lib/content-package.mjs";
import {loadVideoConfig as loadConfig,readVideoPackage as readPackage,videoConfiguration,setVideoDefaults,withTemporaryPackage} from './video-defaults.mjs';
import * as packageChecks from '../assets/vendor/video-publisher/scripts/lib/content-package.mjs';
import {inspectMediaFile} from '../assets/vendor/video-publisher/scripts/lib/media.mjs';
import { buildIdentity } from "../assets/vendor/video-publisher/scripts/v2/lib/identity.mjs";
import { parsePublisherArgs } from "../assets/vendor/video-publisher/scripts/v2/lib/cli-args.mjs";
import { PLATFORMS, evaluateObservation } from "../assets/vendor/video-publisher/scripts/v2/lib/model.mjs";
import { parseV2Result } from "../assets/vendor/video-publisher/scripts/v2/lib/result-line.mjs";
import { acquireJobLock, resolvePublisherLockDirectory } from "../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs";
import { PREFIX, readJson, writeJson, run, ego, checkProfile, isMain, clearCurrentEditor } from "./runtime.mjs";
import { JobStore } from "../assets/vendor/video-publisher/scripts/v2/lib/job-store.mjs";
import { compatVideoScript } from "./ego-video.mjs";
import {actionsDispatch,configurationVerdict,actionPlatformSource} from './video-actions.mjs';
import * as pageActions from './video-page-actions.mjs';
import {assertManualSendContent} from './task.mjs';
import {videoAudit,rawVideoAudit} from './content-audit.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM = path.resolve(DIR, "../assets/vendor/video-publisher/scripts");
const STATE_ROOT = path.join(os.homedir(), ".168-publisher/video-jobs");

const HOSTS = {
  xiaohongshu: "creator.xiaohongshu.com", douyin: "creator.douyin.com",
  bilibili: "member.bilibili.com", wechat_channels: "channels.weixin.qq.com", youtube: "studio.youtube.com",
};
const PLATFORM_FILES = { wechat_channels: "wechat-channels.mjs" };

export function parseOptions(command, argv, configLoader = loadConfig) {
  const forwarded = [];
  let profile = "", confirmManualSend = false, resumeControl = false, acceptMetadataRevision = false, space, pageLabel, actionsOnly = false, deferHandoff = false;
  const values = new Set(["--package", "--job-id", "--platform", "--platforms", "--task-suffix", "--state-root", "--operation"]);
  const flags = new Set(["--confirm-original-rights", "--confirm-new-copy"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if(arg==='--actions-only'){actionsOnly=true;continue;}
    if(arg==='--page-label'){pageLabel=argv[++i];if(!/^p[1-9][0-9]*$/.test(pageLabel||''))throw new Error('Invalid page label');continue;}
    if (arg === "--confirm-manual-send") { confirmManualSend = true; continue; }
    if (arg === '--defer-handoff') { deferHandoff=true; continue; }
    if (arg === '--space') { space=argv[++i];if(!/^\d+$/.test(space||''))throw new Error('Invalid space');continue; }
    if (arg === "--resume-control") { resumeControl = true; continue; }
    if (arg === "--accept-metadata-revision") { acceptMetadataRevision = true; continue; }
    if (arg === "--profile") {
      profile = argv[++i];
      if (!profile || profile.startsWith("--")) throw new Error("--profile requires a name");
      continue;
    }
    if (values.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      forwarded.push(arg, value);
    } else if (flags.has(arg)) forwarded.push(arg);
    else throw new Error(`Unsupported option: ${arg}; use explicit --package and --platform`);
  }
  if (command !== "prepare" && forwarded.includes("--operation")) throw new Error("--operation is valid only for prepare");
  if (command !== "handoff" && confirmManualSend) throw new Error("--confirm-manual-send is valid only for handoff");
  if(deferHandoff&&command!=='handoff'||space&&command!=='prepare')throw new Error('Invalid shared space/handoff option');
  const args = [...forwarded, "--state-root", valueOf(forwarded, "--state-root") || STATE_ROOT,
    "--space-prefix", "168 publisher video", "--no-cleanup-stale-spaces", "--keep-space"];
  if (command !== "prepare") args.push("--operation", "inspect");
  const options = parsePublisherArgs(args, {
    loadConfig: configLoader, PLATFORMS, UsageError: Error, defaultStateRoot: STATE_ROOT,
    positive: value => Number(value),
  });
  if (!PLATFORMS.some(platform => options.platforms.includes(platform))) throw new Error("Select a video platform");
  if (command === "prepare" && !["auto", "create", "resume", "replace-cover", "repost"].includes(options.operation)) throw new Error("Use inspect for verification");
  if (options.operation === "repost" && !options.jobId) throw new Error("repost requires an explicit new --job-id");
  if (command !== "prepare" && !options.jobId) throw new Error(`${command} requires an existing --job-id`);
  if (command === "handoff" && (!confirmManualSend || options.platforms.length !== 1)) throw new Error("handoff requires one platform and --confirm-manual-send after the user asks to take over");
  if (command === "repair-metadata" && (options.platforms.length !== 1 || options.platforms[0] !== "bilibili")) throw new Error("repair-metadata currently supports only bilibili");
  if (acceptMetadataRevision && command !== "repair-metadata") throw new Error("--accept-metadata-revision is valid only for repair-metadata after the user confirms changed metadata");
  if (resumeControl && (!options.jobId || command === "handoff")) throw new Error("--resume-control requires an existing --job-id after explicit user resume");
  return { ...options, args, profile, confirmManualSend, resumeControl, acceptMetadataRevision, space, pageLabel, actionsOnly, deferHandoff };
}
function resultFromLine(output){const lines=output.split('\n').filter(line=>line.startsWith(PREFIX));if(lines.length!==1)throw new Error('Ego result unknown');return JSON.parse(lines[0].slice(PREFIX.length));}
function valueOf(args, flag) { const i = args.indexOf(flag); return i < 0 ? "" : args[i + 1]; }

export function assertOriginalRights(options) {
  const targets=options.platforms.filter(platform=>['xiaohongshu','bilibili','wechat_channels'].includes(platform));
  if(targets.length&&options.originalityPolicy!=='all_videos_original'&&!options.originalRightsConfirmed)throw new Error('Originality confirmation required before browser mutation for: '+targets.join(', '));
}

export function assertExisting(state, identity, platforms, control = {}) {
  if (platforms.some(platform => control.handoffs?.[platform])) throw new Error("Platform handed off or handoff result unknown; do not prepare, inspect, or resend. Check the original page after explicit user resume.");
  if (state.fingerprint !== identity.fingerprint) throw new Error("Package or media changed; existing draft identity does not match");
  for (const platform of platforms) {
    const item = state.platforms?.[platform];
    if (!Number.isInteger(item?.taskSpaceId) || !item?.taskSpaceName) throw new Error(`No recorded draft space for ${platform}`);
  }
}

export function assertMetadataRevision(oldRaw, newRaw, oldIdentity, newIdentity) {
  const allowed = new Set(["bilibiliDescription", "bilibiliTags"]);
  const rest = raw => Object.fromEntries(Object.entries(raw).filter(([key]) => !allowed.has(key)));
  if (!isDeepStrictEqual(rest(oldRaw), rest(newRaw)) || !isDeepStrictEqual(oldIdentity.video, newIdentity.video)
    || oldIdentity.coverFingerprint !== newIdentity.coverFingerprint) throw new Error("Metadata revision cannot change video, cover, other platforms, or unrelated fields");
}

export function spaceCheckScript(item, platform, { requireTab = true, resumeControl = false } = {}) {
  return `
const expectedId = ${JSON.stringify(item.taskSpaceId)};
const expectedName = ${JSON.stringify(item.taskSpaceName)};
const host = ${JSON.stringify(HOSTS[platform])};
const spaces = await listTaskSpaces();
const match = spaces.find(s => Number(s.id ?? s.spaceId) === expectedId && s.name === expectedName);
const userControl = match?.ownership === "user" || match?.ownership === "agentDelegatedToUser";
if (!match || (userControl && !${JSON.stringify(resumeControl)})) throw new Error("Original draft space missing, changed, or user-controlled; refusing recreation");
const task = userControl ? await takeOverTaskSpace(expectedId) : await taskSpace(expectedId);
if (task.spaceId !== expectedId || task.name !== expectedName) throw new Error("Draft space identity mismatch");
${requireTab ? `
const matches = (await task.tabs()).filter(tab => ${item.pageLabel?`tab.label===${JSON.stringify(item.pageLabel)}`:`(() => {try{return new URL(tab.url).hostname===host;}catch{return false;}})()`});
if (matches.length !== 1) throw new Error("Expected exactly one platform draft tab");
const tab = matches[0];
const page = tab.label ? task.page(tab.label) : await task.adopt(tab.page);
` : ""}
`;
}

export function platformSource(platform) {
  let source = fs.readFileSync(path.join(UPSTREAM, "v2/platforms", PLATFORM_FILES[platform] || `${platform}.mjs`), "utf8");
  if (platform === "youtube") {
    // The current Studio filename lives in #original-filename; Document has no innerText.
    source = source.replace("const scope = document", "const scope = dialog || document.body")
      .replace("'#file-name, .file-name, ytcp-video-info #value, ytcp-video-info .value'", "'#original-filename, #file-name, .file-name, ytcp-video-info #value, ytcp-video-info .value'")
      .replace("const paidPromotion = checked(paidPromotionControl)", `const promotionYes = radioChecked(['VIDEO_PAID_PRODUCT_PLACEMENT_NOTIFY'])
    const promotionNo = radioChecked(['VIDEO_PAID_PRODUCT_PLACEMENT_NO'])
    const promotionRadios = scope.querySelector('#paid-promotion tp-yt-paper-radio-button')
    const paidPromotion = promotionRadios ? (promotionYes ? true : promotionNo ? false : null) : checked(paidPromotionControl)`)
      .replace("await ensureYoutubeCheckbox('#paid-promotion', /付费宣传|Paid promotion/i, youtubePaidPromotion, 'set YouTube paid promotion')", "await ensureYoutubePaidPromotionCompat()");
    source += `
async function ensureYoutubePaidPromotionCompat() {
  const radio = await js("(() => Boolean(document.querySelector('#paid-promotion tp-yt-paper-radio-button')))()");
  if (!radio) return ensureYoutubeCheckbox('#paid-promotion', /付费宣传|Paid promotion/i, youtubePaidPromotion, 'set YouTube paid promotion');
  const name = youtubePaidPromotion ? 'VIDEO_PAID_PRODUCT_PLACEMENT_NOTIFY' : 'VIDEO_PAID_PRODUCT_PLACEMENT_NO';
  const present = await js('Boolean(document.querySelector(' + JSON.stringify('#paid-promotion tp-yt-paper-radio-button[name="' + name + '"]') + '))');
  if (!present) return { ok: false, reason: 'YouTube paid-promotion radio missing' };
  return ensureYoutubeRadio([name], /付费宣传/, 'set YouTube paid promotion');
}
`;
  }
  if(platform==='bilibili')source=source.replace('const noMark=/内容无需标注/', 'const noMark=/内容无需标注|含AI生成内容/');
  if(platform==='wechat_channels')source=source.replace('const wechatDescription = pkg.wechatDescription;', "const wechatDescription = pkg.wechatDescription+(pkg.wechatTags?.length?' '+pkg.wechatTags.map(t=>'#'+t).join(' '):'');").replace('async function inspectWechatChannels()', 'async function inspectWechatChannelsBase()');
  source+='\n'+Object.values(pageActions).map(fn=>fn.toString()).join('\n');
  if(platform==='wechat_channels')source+='\nasync function inspectWechatChannels(){return inspectWechatChannelsCompat();}';
  return source;
}

export function verifyScript(item, platform, pkg, state, phase = "verify", statePath = "") {
  if (!["verify", "mutate", "configure"].includes(phase)) throw new Error("Unsafe phase");
  const header = `import fs from "node:fs"; import path from "node:path";
const platform = ${JSON.stringify(platform)}, phase = ${JSON.stringify(phase)};
const taskName = ${JSON.stringify(item.taskSpaceName)}, taskSpaceRef = ${JSON.stringify(String(item.taskSpaceId))};
const packagePath = ${JSON.stringify(state.packagePath)};
const pkg = ${JSON.stringify({ ...pkg, cover: coverForPlatform(pkg, platform) })};
const videoPath = ${JSON.stringify(path.resolve(pkg.videoPath))};
const expectedReceipts = ${JSON.stringify(item.receipts || {})}, expectedVideoReceipt = ${JSON.stringify(item.videoReceipt || null)};
const receiptCheckpointPath = ${JSON.stringify(phase==='configure'?path.join(path.dirname(statePath),'checkpoints',platform+'.receipts.json'):'')}, jobFingerprint = ${JSON.stringify(state.fingerprint)};
`;
  const strictSelection = `
selectTaskSpace = async () => {
  activeTaskSpace = await useOrCreateTaskSpace(expectedId);
  if (activeTaskSpace.id !== expectedId || activeTaskSpace.name !== expectedName) throw new Error("Draft space changed");
  return activeTaskSpace;
};
selectPlatformTab = async () => {
  const tabs = (await listTabs()).filter(tab => { try { return new URL(tab.url).hostname === host; } catch { return false; } });
  if (tabs.length !== 1) throw new Error("Platform tab changed; refusing navigation");
  await switchTab(tabs[0].targetId);
  const info = await pageInfo();
  if (info?.dialog || !info || info.w < 300 || info.h < 300) throw new Error("Draft viewport or browser dialog unavailable");
  return { ok: true, info };
};
`;
  const dispatch=phase==='configure'?actionsDispatch(platform,statePath,item,clearCurrentEditor.toString()):fs.readFileSync(path.join(UPSTREAM, "v2/platforms/dispatch.mjs"), "utf8");
  const core=fs.readFileSync(path.join(UPSTREAM, "v2/ego/core.mjs"), "utf8");
  const browserSource=phase==='configure'?actionPlatformSource(compatVideoScript(core+'\n'+platformSource(platform)),platform):compatVideoScript(core)+platformSource(platform);
  return header + spaceCheckScript(item, platform) + browserSource + strictSelection + dispatch;
}

export function assertFreshReady(observation, item, platform, now = Date.now()) {
  const verdict = evaluateObservation(observation);
  const age = now - Date.parse(observation.observedAt);
  if (observation.platform !== platform || observation.phase !== "verify" || !verdict.ready
    || observation.finalPublishClicked !== false || observation.taskSpaceId !== item.taskSpaceId
    || observation.taskSpace !== item.taskSpaceName || !Number.isFinite(age) || age < 0 || age > 60_000) {
    throw new Error(`Draft not freshly verified: ${verdict.blocker?.code || verdict.missing.join(",") || "identity/time mismatch"}`);
  }
  return verdict;
}

export function handoffScript(item, platform, defer = false) {
  return spaceCheckScript(item, platform) + `
const released = await page.evaluate(() => {
  const guard = window.__VIDEO_PUBLISHER_FINAL_GUARD__;
  if (guard?.version !== 1 || guard.armed !== true || guard.blockedAttempts?.length !== 0
    || typeof guard.releaseForConfirmedPublish !== "function") return { ok: false };
  return guard.releaseForConfirmedPublish();
});
if (!released?.ok) throw new Error("Final-button guard not clean; handoff stopped");
${defer?'':'await task.handOff();'}
console.log(${JSON.stringify(PREFIX)} + JSON.stringify({ status: "awaiting_manual_send", taskSpaceId: task.spaceId, finalPublishClicked: false, released }));
`;
}

export function bilibiliMetadataScript(item, pkg) {
  return spaceCheckScript(item, "bilibili") + `
const metadata = ${JSON.stringify({ description: pkg.bilibiliDescription, tags: pkg.bilibiliTags })};
const description = await page.evaluate(({ description }) => {
  const guard = window.__VIDEO_PUBLISHER_FINAL_GUARD__;
  if (guard?.armed !== true || guard.blockedAttempts?.length !== 0) throw new Error("Final guard unavailable");
  const editors = [...document.querySelectorAll('.ql-editor')].filter(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden');
  const quill = editors.length === 1 && editors[0].parentElement.__quill;
  if (!quill || typeof quill.setText !== 'function') throw new Error("Native description editor unavailable");
  quill.setText(description, 'user');
  return { text: quill.getText() };
}, metadata);
for (const tag of metadata.tags) {
  const added = await page.evaluate(({ tag, tags }) => {
    const chips = [...document.querySelectorAll('#tag-container .label-item-v2-content')].map(e => e.innerText.trim());
    if (chips.some(chip => !tags.includes(chip))) throw new Error("Unexpected tags; refusing metadata repair");
    if (chips.includes(tag)) return false;
    const guard = window.__VIDEO_PUBLISHER_FINAL_GUARD__;
    if (guard?.armed !== true || guard.blockedAttempts?.length !== 0) throw new Error("Final guard unavailable");
    const component = document.querySelector('#tag-container')?.__vue__;
    if (typeof component?.setCustomTag !== 'function') throw new Error("Native tag editor unavailable");
    component.setCustomTag(tag);
    return true;
  }, { tag, tags: metadata.tags });
  if (added) await page.waitForFunction(() => !document.querySelector('#tag-container')?.__vue__?.checkCustomTagLoading, undefined, { timeout: 10000 });
}
console.log("Metadata actions completed; fresh verification required");
`;
}

export function summarize(result) {
  const platforms = Object.fromEntries(Object.entries(result.platforms || {}).map(([platform, item]) => {
    const detail = item.blocker?.evidence?.detail || "";
    const code = item.blocker?.code;
    const upload = item.blocker?.evidence?.video?.evidence;
    const status = item.ready ? "draft_verified"
      : code === "AUTH_REQUIRED" ? "needs_login"
      : code === "USER_CONTROL" || /permission prompt|user now controls/i.test(detail) ? "needs_user"
      : code === "STATE_AMBIGUOUS" && (upload?.uploading || upload?.processing) && !upload?.failed ? "processing"
      : code === "INPUT_CHANNEL_BROKEN" || code === "STATE_AMBIGUOUS" ? "result_unknown"
      : code === "UPLOAD_STALLED" ? "processing" : "failed";
    return [platform, { ...item, upstreamStatus: item.status, status }];
  }));
  const statuses = Object.values(platforms).map(item => item.status);
  const status = ["needs_user", "needs_login", "result_unknown", "failed", "processing", "draft_verified"].find(status => statuses.includes(status)) || "result_unknown";
  return { ...result, upstreamStatus: result.status, status, platforms };
}


export function platformFactErrors(pkg,platforms=[]){
 const errors=[];
  if(pkg.original===false&&platforms.some(p=>['xiaohongshu','bilibili','wechat_channels'].includes(p)))errors.push('Non-original content is unsupported by the original/self-made adapters');
  if(pkg.aiGenerated!==undefined&&typeof pkg.aiGenerated!=='boolean')errors.push('aiGenerated must be a confirmed boolean');
  if(platforms.includes('wechat_channels')&&pkg.wechatShortTitle!==undefined&&(typeof pkg.wechatShortTitle!=='string'||pkg.wechatShortTitle&&[...pkg.wechatShortTitle].length<6))errors.push('WeChat optional short title must be empty or at least 6 characters');
 return errors;
}
export function assertPlatformFacts(pkg,platforms=[]){const errors=platformFactErrors(pkg,platforms);if(errors.length)throw new Error(errors.join('; '));}

export function checkVideoPackage(platform,pkg){
 const validators={xiaohongshu:packageChecks.validateXiaohongshuPackage,douyin:packageChecks.validateDouyinPackage,bilibili:packageChecks.validateBilibiliPackage,wechat_channels:packageChecks.validateWechatChannelsPackage,youtube:packageChecks.validateYoutubePackage};
 if(!validators[platform])throw new Error('Unsupported video platform');loadConfig({requireOnboarded:true});
 const media=inspectMediaFile(pkg.videoPath),errors=platformFactErrors(pkg,[platform]);
 try{errors.push(...validators[platform](pkg));}catch(error){errors.push(error.message);}
 const audit=videoAudit(platform,pkg,{media,errors});
 return {platform,ok:audit.errors.length===0,audit,title:pkg.platformTitle?.[platform]||pkg.title,media,conversions:pkg.cover.uploadCustomCover&&pkg.cover.sourcePath?[{field:'cover',source:pkg.cover.sourcePath,method:pkg.cover.adaptation,assets:packageChecks.coverAssetsForPlatform(pkg,platform)}]:[],cover:{uploadCustomCover:pkg.cover.uploadCustomCover,sourcePath:pkg.cover.sourcePath,assets:packageChecks.coverAssetsForPlatform(pkg,platform)},effectiveSettings:Object.fromEntries(Object.entries(pkg).filter(([k])=>k.startsWith('youtube')&&!['youtubeTitle','youtubeDescription','youtubeTags'].includes(k)||['wechatShortTitle','original','aiGenerated'].includes(k))),errors:audit.errors};
}

export async function main(argv = process.argv.slice(2)) {
  if (process.platform !== "darwin") throw new Error("168 同步发布 supports macOS only");
  process.env.VIDEO_PUBLISHER_CONFIG = process.env.PUBLISHER_VIDEO_CONFIG || path.join(os.homedir(), ".config/168-publisher/video.json");
  const [command, ...args] = argv;
  if(command==='config'){
    if(args[0]==='set-defaults'){console.log(JSON.stringify(setVideoDefaults(args.slice(1)),null,2));return;}
    if(!args.length||['status','show'].includes(args[0])){console.log(JSON.stringify(videoConfiguration(),null,2));return;}
    const before=loadConfig(),forwarded=[...args];
    if(args[0]==='onboard'&&!args.includes('--originality-policy'))forwarded.push('--originality-policy','all_videos_original');
    if((args[0]==='onboard'||args[0]==='add-platform'&&args[1]==='youtube')&&!args.includes('--youtube-visibility'))forwarded.push('--youtube-visibility',before.effectiveDefaults.youtubeVisibility);
    const result=await run(process.execPath,[path.join(UPSTREAM,'config.mjs'),...forwarded]);
    if(result.code!==0){console.log(result.stdout);process.exitCode=result.code;return;}
    if(['onboard','add-platform'].includes(args[0])){const file=process.env.VIDEO_PUBLISHER_CONFIG;const updated=readJson(file);updated.defaults=before.defaults;writeJson(file,updated);}
    console.log(JSON.stringify(videoConfiguration(),null,2));return;
  }
  if(command==='check'){
    const [platform,file,...extra]=args;
    let state;for(let i=0;i<extra.length;i+=2)if(!['--job-id','--state-root'].includes(extra[i])||extra[i+1]===undefined)throw new Error('Invalid video check option');
    const jobId=valueOf(extra,'--job-id'),stateRoot=valueOf(extra,'--state-root')||STATE_ROOT;
    if(jobId){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(jobId))throw new Error('Invalid job-id');const statePath=path.join(stateRoot,jobId,'state.json');if(fs.existsSync(statePath))state=readJson(statePath);}
    let result;
    try{const pkg=readPackage(file,{state});result=checkVideoPackage(platform,pkg);}
    catch(error){const raw=readJson(file);let defaults={};try{defaults=state?.effectivePackage??(state?{}:loadConfig().effectiveDefaults);}catch{}let media;try{media=inspectMediaFile(typeof raw.videoPath==='string'?raw.videoPath:undefined);}catch{}const audit=rawVideoAudit(platform,raw,defaults,{media,errors:[error.message]});result={platform,ok:false,audit,errors:audit.errors};}
    console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;return;
  }
  if (!["prepare", "inspect", "handoff", "repair-metadata", "repair-youtube"].includes(command)) throw new Error("Usage: video.mjs config|check|prepare|inspect|repair-metadata|repair-youtube|handoff; see references/video.md");
  const options = parseOptions(command, args);
  if (command === "repair-youtube" && (options.platforms.length !== 1 || options.platforms[0] !== "youtube")) throw new Error("repair-youtube requires one existing YouTube draft");
  const existingPath=options.jobId?path.join(options.stateRoot,options.jobId,'state.json'):'';
  const existingState=existingPath&&fs.existsSync(existingPath)?readJson(existingPath):undefined;
  const pkg=readPackage(options.packagePath,{state:existingState,acceptMetadataRevision:options.acceptMetadataRevision});
  if(existingState?.originalityPolicy)options.originalityPolicy=existingState.originalityPolicy;
  assertPlatformFacts(pkg,options.platforms);
  if(command==='prepare'&&options.actionsOnly)assertOriginalRights({...options,originalityPolicy:existingState?.originalityPolicy??options.originalityPolicy});
  if(command!=='prepare'||options.actionsOnly)for(const platform of options.platforms){const check=checkVideoPackage(platform,pkg);if(!check.ok)throw new Error('Package preflight failed for '+platform+': '+check.errors.join('; '));}
  if (command === 'handoff') assertManualSendContent(pkg);
  const identity = await buildIdentity(pkg);
  const jobId = options.jobId || identity.fingerprint.slice(0, 16);
  const jobDir = path.join(options.stateRoot, jobId);
  // ponytail: serial entry lock; split per job only when parallel independent jobs are needed.
  const directory = path.join(options.stateRoot, ".entry-lock");
  const release = acquireJobLock(directory, { jobId });
  const lock = { directory, release };
  let publisherRelease = () => {};
  try {
    const controlPath = path.join(jobDir, "manual-control.json");
    const control = fs.existsSync(controlPath) ? readJson(controlPath) : {};
    if (command === "prepare" && Object.keys(control.handoffs || {}).length) throw new Error("Job already handed off or its result is unknown; do not resend");
    if (control.profile && options.profile && control.profile !== options.profile) throw new Error("Job Profile changed");
    await checkProfile(options.profile || control.profile, lock);
    if(command==='prepare'&&options.actionsOnly){
      if(options.platforms.length!==1||!options.space||!options.pageLabel)throw new Error('Action preparation requires one precreated platform page');
      const platform=options.platforms[0],statePath=path.join(jobDir,'state.json');
      const space=resultFromLine(await ego(`const match=(await listTaskSpaces()).find(s=>Number(s.id??s.spaceId)===${Number(options.space)});if(!match||match.ownership!=='agent')throw new Error('USER_CONTROL: original run space unavailable');console.log(${JSON.stringify(PREFIX)}+JSON.stringify({id:Number(match.id??match.spaceId),name:match.name}));`,lock));
      let state=fs.existsSync(statePath)?readJson(statePath):null;
      if(state){assertExisting(state,identity,[platform],control);if(state.platforms[platform].pageLabel&&state.platforms[platform].pageLabel!==options.pageLabel)throw new Error('Original platform page changed');}
      else state={schemaVersion:4,effectivePackage:pkg,packageInput:readJson(options.packagePath),originalityPolicy:options.originalityPolicy,jobId,...identity,packagePath:options.packagePath,revisions:[],platforms:{[platform]:{taskSpaceId:space.id,taskSpaceName:space.name,pageLabel:options.pageLabel,receipts:{},history:[],uploadAttempted:false}}};
      const item=state.platforms[platform];
      if(item.taskSpaceId!==space.id||item.taskSpaceName!==space.name)throw new Error('Original video space changed');
      item.pageLabel=options.pageLabel;writeJson(statePath,state);
      await ego(spaceCheckScript(item,platform)+`await page.cdp('Page.bringToFront',{});if(!${JSON.stringify(!!options.pageLabel)})await page.goto(${JSON.stringify({xiaohongshu:'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=video',douyin:'https://creator.douyin.com/creator-micro/content/upload',bilibili:'https://member.bilibili.com/platform/upload/video/frame',wechat_channels:'https://channels.weixin.qq.com/platform/post/create',youtube:'https://studio.youtube.com/'}[platform])});`,lock);
      const script=verifyScript(item,platform,pkg,state,'configure',statePath);
      const observation=parseV2Result(await ego(script,lock));
      state=readJson(statePath);
      const verdict=configurationVerdict(observation,observation.uploadSubmitted===true);
      state.platforms[platform].status=verdict.status;writeJson(statePath,state);
      const evidencePath=path.join(jobDir,'configuration.json');writeJson(evidencePath,{observation,verdict});
      console.log(JSON.stringify({...verdict,jobId,taskSpaceId:space.id,evidencePath,finalPublishClicked:false,uploadStatus:'not_awaited'},null,2));if(!verdict.configurationComplete)process.exitCode=10;return;
    }
    if (command === "prepare") {
      const statePath = path.join(jobDir, "state.json");
      if(options.space){
        const output=await ego(`const match=(await listTaskSpaces()).find(s=>Number(s.id??s.spaceId)===${Number(options.space)});if(!match||match.ownership!=='agent')throw new Error('Original run space unavailable or user-controlled');console.log(${JSON.stringify(PREFIX)}+JSON.stringify({id:Number(match.id??match.spaceId),name:match.name}));`,lock);
        const line=output.split('\n').find(line=>line.startsWith(PREFIX));if(!line)throw new Error('Space identity unknown');
        const shared=JSON.parse(line.slice(PREFIX.length));
        if(fs.existsSync(statePath)&&Object.values(readJson(statePath).platforms).some(item=>item.taskSpaceId!=null&&(item.taskSpaceId!==shared.id||item.taskSpaceName!==shared.name)))throw new Error('Existing video belongs to another space');
        options.args.push('--space-name',shared.name);
      }
      if (fs.existsSync(statePath)) {
        const state = readJson(statePath);
        if (options.operation !== "replace-cover") assertExisting(state, identity, Object.keys(state.platforms), control);
        for (const [platform, item] of Object.entries(state.platforms)) {
          if (item.taskSpaceId != null) await ego(spaceCheckScript(item, platform, { requireTab: false, resumeControl: options.resumeControl && options.platforms.includes(platform) }) + `console.log("Existing space verified");`, lock);
        }
      }
      if (options.profile) writeJson(controlPath, { ...control, profile: options.profile });
      const env = { ...process.env, PUBLISHER_EGO_COMMAND: process.env.VIDEO_PUBLISHER_V2_EGO_COMMAND || "ego-browser", VIDEO_PUBLISHER_V2_EGO_COMMAND: path.join(DIR, "ego-video.mjs"),PUBLISHER_CLEAR_VIDEO_JOB:fs.existsSync(statePath)?'':jobId,PUBLISHER_HISTORY_SNAPSHOT:path.join(jobDir,'stale-content.json') };
      const result = await withTemporaryPackage(pkg,async file=>{
        const forwarded=[...options.args],at=forwarded.indexOf('--package');forwarded[at+1]=file;
        if(options.originalityPolicy==='all_videos_original'&&!forwarded.includes('--confirm-original-rights'))forwarded.push('--confirm-original-rights');
        return run(process.execPath,[path.join(UPSTREAM,'v2/publisher.mjs'),...forwarded],{lock,mirrorStderr:true,env});
      });
      if(fs.existsSync(statePath)){ const created=readJson(statePath);created.packagePath=options.packagePath;created.packageInput=readJson(options.packagePath);if(!existingState){created.effectivePackage=pkg;created.originalityPolicy=options.originalityPolicy;}writeJson(statePath,created);}
      if (result.stdout.trim()) console.log(JSON.stringify(summarize(JSON.parse(result.stdout)), null, 2));
      else if (result.code === 0) throw new Error("Publisher returned no structured result; result unknown");
      process.exitCode = result.code; return;
    }
    const statePath = path.join(jobDir, "state.json");
    const state = readJson(statePath);
    if (!options.acceptMetadataRevision) assertExisting(state, identity, options.platforms, control);
    publisherRelease = acquireJobLock(resolvePublisherLockDirectory(), { jobId, scope: "publisher" });
    lock.publisher = { directory: resolvePublisherLockDirectory(), release: publisherRelease };
    if (options.acceptMetadataRevision) {
      if (Object.keys(state.platforms).length !== 1) throw new Error("Metadata revision currently requires a single-platform bilibili job");
      const oldPkg = state.effectivePackage||readPackage(state.packagePath,{state});
      const oldIdentity = await buildIdentity(oldPkg);
      assertExisting(state, oldIdentity, options.platforms, control);
      assertMetadataRevision(readJson(state.packagePath), readJson(options.packagePath), oldIdentity, identity);
      if (options.resumeControl) await ego(spaceCheckScript(state.platforms.bilibili, "bilibili", { requireTab: false, resumeControl: true }) + `console.log("Original control resumed");`, lock);
      const oldObservation = parseV2Result(await ego(verifyScript(state.platforms.bilibili, "bilibili", oldPkg, state), lock));
      const before = evaluateObservation(oldObservation);
      if (oldObservation.blocker || before.missing.some(gate => !["description", "tags"].includes(gate))) throw new Error("Original uploaded video must be proven before a metadata revision");
      const previous = { fingerprint: state.fingerprint, packagePath: state.packagePath };
      state.effectivePackage=pkg;state.packageInput=readJson(options.packagePath);
      state.fingerprint = identity.fingerprint;
      state.contentFingerprint = identity.contentFingerprint;
      state.packagePath = options.packagePath;
      state.updatedAt = new Date().toISOString();
      state.revisions.push({ at: state.updatedAt, operation: "metadata-revision", from: previous.fingerprint, to: identity.fingerprint, packagePath: options.packagePath });
      const item = state.platforms.bilibili;
      if (item.videoReceipt) item.videoReceipt.fingerprint = identity.fingerprint;
      if (item.receipts?.uploadStart) item.receipts.uploadStart.fingerprint = identity.fingerprint;
      await new JobStore(jobDir, state).save();
      writeJson(path.join(jobDir, "metadata-revision.json"), { previous, current: { fingerprint: identity.fingerprint, packagePath: options.packagePath }, at: state.updatedAt });
    }
    const results = {};
    for (const platform of options.platforms) {
      const item = state.platforms[platform];
      if (options.resumeControl) await ego(spaceCheckScript(item, platform, { requireTab: false, resumeControl: true }) + `console.log("Original control resumed");`, lock);
      const output = await ego(verifyScript(item, platform, pkg, state), lock);
      let observation = parseV2Result(output);
      if (command === "repair-youtube") {
        const required = ["authenticated", "draftIdentity", "video", "noBlockingDialog", "safety"];
        if (observation.blocker || required.some(gate => observation.gates[gate]?.ok !== true)) throw new Error("YouTube repair requires the original uploaded video, completed processing and clean guard");
        const repaired = parseV2Result(await ego(verifyScript(item, platform, pkg, state, "mutate"), lock));
        if (repaired.receipts) item.receipts = { ...item.receipts, ...repaired.receipts };
        await new JobStore(jobDir, state).save();
        observation = parseV2Result(await ego(verifyScript(item, platform, pkg, state), lock));
      }
      if (command === "repair-metadata") {
        const before = evaluateObservation(observation);
        if (observation.blocker || before.missing.some(gate => !["description", "tags"].includes(gate))) throw new Error("Metadata repair requires a proven original video draft and all other gates");
        await ego(bilibiliMetadataScript(item, pkg), lock);
        observation = parseV2Result(await ego(verifyScript(item, platform, pkg, state), lock));
      }
      const verdict = evaluateObservation(observation);
      const evidencePath = path.join(jobDir, `manual-verify-${platform}.json`);
      writeJson(evidencePath, { observation, verdict });
      if (["repair-metadata", "repair-youtube"].includes(command)) {
        item.verdict = verdict;
        item.status = verdict.ready ? "ready" : "blocked";
        item.lastEvidencePath = evidencePath;
        item.lastObservedAt = observation.observedAt;
        state.status = Object.values(state.platforms).every(p => p.verdict?.ready) ? "ready" : "blocked";
        state.updatedAt = new Date().toISOString();
        await new JobStore(jobDir, state).save();
      }
      results[platform] = { ready: verdict.ready, missing: verdict.missing, blocker: verdict.blocker, taskSpaceId: observation.taskSpaceId };
      if (command === "handoff") {
        assertFreshReady(observation, item, platform);
        const handoffs = { ...control.handoffs, [platform]: { status: "result_unknown", at: new Date().toISOString() } };
        writeJson(controlPath, { ...control, handoffs });
        const handoff = await ego(handoffScript(item, platform, options.deferHandoff), lock);
        const line = handoff.split("\n").find(line => line.startsWith(PREFIX));
        const receipt = line && JSON.parse(line.slice(PREFIX.length));
        if (receipt?.status !== "awaiting_manual_send" || receipt.finalPublishClicked !== false) throw new Error("Handoff receipt unknown; do not repeat automatically");
        handoffs[platform] = { status: "awaiting_manual_send", at: new Date().toISOString(), receipt };
        writeJson(controlPath, { ...control, handoffs });
        console.log(JSON.stringify(receipt, null, 2));
        return;
      }
    }
    console.log(JSON.stringify(summarize({ jobId, finalPublishClicked: false, platforms: results }), null, 2));
    if (Object.values(results).some(r => !r.ready)) process.exitCode = 10;
  } finally { publisherRelease(); release(); }
}
if (isMain(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
