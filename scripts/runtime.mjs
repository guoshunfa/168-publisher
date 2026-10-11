import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { registerJobLockMember } from "../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs";
export const PREFIX = "168_PUBLISHER_RESULT:";
export const isMain = url => !!process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url));
export const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function run(file, args, { input, lock, env = process.env, inherit = false, mirrorStderr = false, mirrorProgress = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"] });
    const unregister = [];
    let stdout = "", stderr = "", progressBuffer="";
    child.on("error", reject);
    if (lock && child.pid) {
      try {
        for (const memberLock of [lock, lock.publisher].filter(Boolean)) unregister.push(registerJobLockMember(memberLock.directory, memberLock.release.token, { pid: child.pid }));
      } catch (error) { child.kill(); unregister.forEach(release => release()); reject(error); return; }
    }
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; if (mirrorStderr) process.stderr.write(chunk);
      if(mirrorProgress){progressBuffer+=chunk;let index;while((index=progressBuffer.indexOf('\n'))>=0){const line=progressBuffer.slice(0,index);progressBuffer=progressBuffer.slice(index+1);try{const value=JSON.parse(line);if(value.progress&&typeof value.progress.platform==='string'&&typeof value.progress.step==='string')process.stderr.write(JSON.stringify({progress:value.progress})+'\n');}catch{}}} });
    child.on("close", code => { unregister.forEach(release => release()); resolve({ code: code ?? 1, stdout, stderr }); });
    child.stdin?.end(input || "");
  });
}
export async function ego(script, lock) {
  const result = await run(process.env.VIDEO_PUBLISHER_V2_EGO_COMMAND || "ego-browser", ["nodejs"], { input: script, lock, mirrorProgress: true });
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "Ego failed";
    throw new Error(message.replace(/https?:\/\/[^\s"'<>]+/g, value => {
      try { const url = new URL(value); return url.origin + url.pathname; } catch { return "[invalid URL]"; }
    }));
  }
  return `${result.stdout}\n${result.stderr}`;
}
export async function checkProfile(profile, lock) {
  if (!profile) return;
  const output = await ego(`const items = await profiles(); console.log(${JSON.stringify(PREFIX)} + JSON.stringify(items.filter(p => p.isDefault).map(p => p.name)));`, lock);
  const line = output.split("\n").find(line => line.startsWith(PREFIX));
  const names = line && JSON.parse(line.slice(PREFIX.length));
  if (!names || names.length !== 1 || names[0] !== profile) throw new Error(`Requested Profile ${profile} is not the Ego default; stopped before creator work`);
}

export function openDraftPageScript(state, space, pageLabel) {
  return `
const requested=${JSON.stringify(space ? Number(space) : null)}, name=${JSON.stringify(state.taskSpaceName)};
const matches=(await listTaskSpaces()).filter(s=>requested?Number(s.id??s.spaceId)===requested:s.name===name);
if(matches.length>1||requested&&matches.length!==1)throw new Error('Space identity unavailable');
if(matches.length&&matches[0].ownership!=='agent')throw new Error('USER_CONTROL: explicit resume required');
const task=await taskSpace(matches.length?Number(matches[0].id??matches[0].spaceId):name);
const tabs=await task.tabs();
const blank=tabs.length===1&&tabs[0].label==='p1'&&(!matches.length||!tabs[0].url||tabs[0].url==='about:blank');
const bound=${JSON.stringify(pageLabel||null)};
if(bound&&tabs.filter(tab=>tab.label===bound).length!==1)throw new Error('Precreated platform page unavailable');
const page=bound?task.page(bound):blank?task.page('p1'):await task.newPage();
console.log(${JSON.stringify(PREFIX)}+JSON.stringify({taskSpaceId:task.spaceId,taskSpaceName:task.name,pageLabel:page.label}));`;
}

export async function clearCurrentEditor(page, {type, platform, cleanup={}}) {
  if(platform==='bilibili'){
    const restore=await page.evaluate(()=>[...document.querySelectorAll('*')].some(e=>e.textContent.trim()==='不用了'&&e.getBoundingClientRect().height>0));
    if(restore)await page.click('text="不用了"');
  }
  if(platform==='xiaohongshu'){
    await page.evaluate(()=>{
      const models=new Set([...document.querySelectorAll('[data-v-app]')].map(root=>root.__vue_app__?.config.globalProperties.$pinia).filter(Boolean));
      if(models.size!==1)throw new Error('Native draft reset unavailable');
      const stores=[...models][0]._s;
      for(const id of ['draft','publisher','settings'])if(typeof stores.get(id)?.$reset!=='function')throw new Error('Native draft reset changed');
      for(const id of ['draft','publisher','settings'])stores.get(id).$reset();
    });
    return;
  }
  const selectors=cleanup.selectors || (type==='dynamic'?{
    x:['[role="dialog"] [data-testid="tweetTextarea_0"][contenteditable="true"]'],
    weibo:['textarea[placeholder="有什么新鲜事想分享给大家？"]'],
  }[platform]:type==='video'?{
    douyin:['input[placeholder*="作品标题"]','[contenteditable=true]'],
    bilibili:['input[placeholder*="稿件标题"]','.ql-editor[contenteditable=true]'],
    wechat_channels:['input[placeholder*="标题"]','[contenteditable=true]'],
    youtube:['#title-textarea #textbox','#description-textarea #textbox'],
  }[platform]:null);
  if(!selectors)throw new Error('Editor cleanup unavailable');
  for(const selector of selectors){
    if(!await page.evaluate(selector=>!!document.querySelector(selector),selector))continue;
    await page.focus(selector);await page.keyboard.press('Meta+A');await page.keyboard.press('Backspace');
  }
  for(let index=0;index<40;index++){
    const found=await page.evaluate(({type,platform,cleanup})=>{
      const root=platform==='weibo'?document.querySelector('[class*="_publishCard_"]'):platform==='x'?document.querySelector('[role="dialog"]'):cleanup.rootSelector?document.querySelector(cleanup.rootSelector)?.closest(cleanup.closest||cleanup.rootSelector):document.querySelector(type==='video'?'.upload-container,.upload-content,.post-content,ytcp-uploads-dialog':'.UploadPicture,.cover,.cover-preview-con');
      const candidates=[...(root?.querySelectorAll('button,[role=button],[title],[aria-label],i')||[])].filter(node=>{
        if(node.getBoundingClientRect().height===0)return false;
        const label=(node.title||node.getAttribute('aria-label')||node.innerText||'').trim();
        if(node.matches('[data-testid="removeMedia"]'))return true;
        if(/^(删除|移除|删除封面|移除封面|Remove media|Remove|Delete)$/i.test(label))return true;
        const props=node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))];
        return !!cleanup.handlerPattern&&new RegExp(cleanup.handlerPattern).test(props?.onClick?.toString()||'');
      });
      if(!candidates.length)return false;
      candidates[0].id='publisher-clear-history';return true;
    },{type,platform,cleanup});
    if(!found)return;
    await page.click('#publisher-clear-history');
  }
  throw new Error('History cleanup did not finish');
}
