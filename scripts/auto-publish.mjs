import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {readJson,writeJson,ego,PREFIX,checkProfile} from './runtime.mjs';
import {existingSpaceScript,assertManualSendContent} from './task.mjs';
import {observeX} from './x-page.mjs';
import {observeWeibo} from './weibo-page.mjs';
import {observeXhs} from './xhs-page.mjs';
import {observeImage,imageControls} from './image-page.mjs';
import {observeJike} from './jike-page.mjs';
import {verifyScript} from './video.mjs';
import {requiredGates} from '../assets/vendor/video-publisher/scripts/v2/lib/model.mjs';
import {acquireJobLock,resolvePublisherLockDirectory} from '../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs';

// Keep the click intent on disk before browser execution: a lost reply must never cause a second send.
export async function publishOnce(file,action){
  if(fs.existsSync(file))return readJson(file);
  const pending={status:'result_unknown',finalPublishClicked:null,reason:'发布操作已开始，结果未确认；请检查原页面，不自动重试',attemptedAt:new Date().toISOString()};
  writeJson(file,pending);
  try{
    const receipt=await action();
    if(!['published','submitted','result_unknown'].includes(receipt?.status)||typeof receipt.finalPublishClicked!=='boolean')throw new Error('Invalid publication receipt');
    const result={...pending,...receipt};writeJson(file,result);return result;
  }catch(error){const result={...pending,error:String(error.message||error)};writeJson(file,result);return result;}
}

export async function waitUntilReady(inspect,{timeout=1800,sleep=pause,now=Date.now}={}){
  const deadline=now()+timeout*1000;
  for(;;){
    const result=await inspect();
    if(result.ready===true||result.status!=='processing')return result;
    if(now()>=deadline)return {...result,status:'needs_user',reason:'等待上传或平台处理超时；请检查原页面后继续'};
    await sleep(Math.min(15000,deadline-now()));
  }
}

export function selectPublishButton({type,platform,guardKey,fingerprint}){
  const roots=[document];
  for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none';};
  const compact=node=>(node.innerText||node.textContent||node.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim();
  const selector=platform==='x'?'[role="dialog"] [data-testid="tweetButton"]':platform==='youtube'&&type==='video'?'ytcp-uploads-dialog #done-button':type==='dynamic'&&platform==='xiaohongshu'?'xhs-publish-btn[is-publish="true"]':platform==='jike'?'form button[type="submit"]':'button,[role="button"],.submit-add,.bili-dyn-publishing__action.launcher';
  const names={weibo:/^发送$/,xiaohongshu:/^(发布|发布笔记)$/,douyin:/^发布$/,bilibili:type==='image'?/^发布$/:/^立即投稿$/,wechat_channels:/^发表$/,youtube:type==='image'?/^(发布|Post)$/:null};
  let candidates=roots.flatMap(root=>[...root.querySelectorAll(selector)]).filter(visible);
  if(names[platform]&&!(type==='dynamic'&&platform==='xiaohongshu'))candidates=candidates.filter(node=>names[platform].test(compact(node)));
  candidates=candidates.filter(node=>!candidates.some(other=>other!==node&&other.contains(node)));
  if(candidates.length!==1)throw new Error('最终发布按钮缺失或不唯一');
  const button=candidates[0];
  if(button.disabled||button.getAttribute('aria-disabled')==='true'||/disabled/.test(String(button.className))||button.getAttribute('submit-disabled')==='true'||button.getAttribute('submit-loading')==='true')throw new Error('最终发布按钮尚不可用');
  const guard=window[guardKey];
  if(guard?.armed!==true||guard.blockedAttempts?.length!==0||fingerprint&&guard.fingerprint!==fingerprint)throw new Error('发布保护或内容关联已改变');
  const release=guard.releaseForConfirmedPublish||guard.release;
  if(typeof release!=='function'||release.call(guard)?.ok!==true)throw new Error('无法解除发布保护');
  button.setAttribute('data-168-auto-publish','target');
  return {ready:true};
}

export async function clickPublishButton(page,platform,recheck){
  const selector='[data-168-auto-publish="target"]';
  if(platform!=='x'){await page.click(selector);return;}
  await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll('[data-168-auto-publish="target"]')];
    if(buttons.length!==1)throw new Error('发布按钮关联已改变');
    const button=buttons[0],receipt={button,clicks:0};
    window.__168_AUTO_PUBLISH_CLICK__=receipt;
    const capture=event=>{if(event.composedPath().includes(button)){receipt.clicks++;window.removeEventListener('click',capture,true);}};
    window.addEventListener('click',capture,true);
  });
  try{await page.click(selector);}
  catch(error){
    if(!/intercepts pointer events/.test(String(error.message||error)))throw error;
    await recheck();
    await page.evaluate(()=>{
      const receipt=window.__168_AUTO_PUBLISH_CLICK__,buttons=[...document.querySelectorAll('[data-168-auto-publish="target"]')];
      const button=buttons[0],guard=window.__168_PUBLISHER_X__;
      if(!receipt||receipt.clicks!==0||buttons.length!==1||button!==receipt.button||!button.isConnected
        ||button.disabled||button.getAttribute('aria-disabled')==='true'||guard?.armed!==false||guard.blockedAttempts?.length!==0)throw new Error('无法确认未发送，不重试发布');
      const rect=button.getBoundingClientRect(),style=getComputedStyle(button);
      if(rect.width<=0||rect.height<=0||style.display==='none'||style.visibility==='hidden')throw new Error('发布按钮已不可见');
      // Ego can hit an empty X overlay although the verified composer button remains visible.
      button.click();
    });
  }
}

export function publicationFeedback(platform){
  const visible=node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(node).visibility!=='hidden';};
  const nodes=[...document.querySelectorAll('[role="alert"],[role="status"],.el-message,.ant-message-notice,.woo-message,.d-toast,.weui-desktop-toast,ytcp-video-share-dialog')].filter(visible);
  const messages=nodes.map(node=>(node.innerText||node.textContent||'').trim()).filter(Boolean);
  let success=messages.find(text=>/发布成功|发表成功|投稿成功|发送成功|已发布|你的帖子已发送|Your post was sent|Video published|Published successfully/i.test(text));
  if(!success&&platform==='xiaohongshu'&&location.hostname==='creator.xiaohongshu.com'&&location.pathname==='/publish/success'
    &&document.body.innerText.split('\n').some(line=>line.trim()==='发布成功')&&!document.querySelector('.tiptap[contenteditable="true"]'))success='发布成功';
  const failure=messages.find(text=>/发布失败|发表失败|投稿失败|发送失败|操作过于频繁|验证码|安全验证|发布审核不通过|failed to (publish|post|send)/i.test(text));
  const dialogs=[...document.querySelectorAll('[role="dialog"],.el-dialog,.ant-modal,.weui-desktop-dialog__wrp')].filter(visible);
  const confirmations=dialogs.flatMap(dialog=>[...dialog.querySelectorAll('button,[role="button"]')]).filter(button=>visible(button)&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&/^(确认发布|确定发布|确认发表|立即发布|Publish now|Confirm publish)$/.test((button.innerText||button.textContent||'').trim()));
  if(confirmations.length===1)confirmations[0].setAttribute('data-168-auto-confirm','target');
  return {success,failure,confirmation:confirmations.length===1,ambiguous:confirmations.length>1};
}

export function publicationScript(type,platform,state,statePath){
  const dynamic=['dynamic','image'].includes(type);
  const guards={x:'__168_PUBLISHER_X__',weibo:'__168_PUBLISHER_WEIBO__',xiaohongshu:'__168_PUBLISHER_XHS__',jike:'__168_PUBLISHER_JIKE__'};
  let source;
  if(dynamic){
    const observer={x:observeX,weibo:observeWeibo,xiaohongshu:observeXhs,jike:observeJike}[platform]||observeImage;
    source=existingSpaceScript(state)+`${type==='image'?`await page.evaluate(${imageControls.toString()},${JSON.stringify(platform)});`:''}const fresh=await page.evaluate(${observer.toString()},expected);if(Object.values(fresh.gates).some(ok=>ok!==true))throw new Error('发布前内容或上传状态改变');`;
  }else{
    const inspectors={xiaohongshu:'inspectXiaohongshu',douyin:'inspectDouyin',bilibili:'inspectBilibili',wechat_channels:'inspectWechatChannels',youtube:'inspectYoutube'};
    source=verifyScript(state.platforms[platform],platform,state.effectivePackage,state,'verify',statePath)+`\nconst fresh=await emitObservation(await ${inspectors[platform]}());if(fresh.blocker||${JSON.stringify(requiredGates(platform))}.some(key=>fresh.gates[key]?.ok!==true))throw new Error('发布前内容或上传状态改变');`;
  }
  return source+`
const priorFeedback=await page.evaluate(${publicationFeedback.toString()},${JSON.stringify(platform)});
if(priorFeedback.success||priorFeedback.failure||priorFeedback.confirmation||priorFeedback.ambiguous)throw new Error('发布前存在未处理提示或确认框');
await page.evaluate(${selectPublishButton.toString()},${JSON.stringify({type,platform,guardKey:dynamic?guards[platform]||'__168_PUBLISHER_IMAGE__':'__VIDEO_PUBLISHER_FINAL_GUARD__',fingerprint:dynamic?state.fingerprint:undefined})});
await (${clickPublishButton.toString()})(page,${JSON.stringify(platform)},async()=>{
  const feedback=await page.evaluate(${publicationFeedback.toString()},${JSON.stringify(platform)});
  if(feedback.success||feedback.failure||feedback.confirmation||feedback.ambiguous)throw new Error('发布状态已改变，不重试');
  const fresh=await page.evaluate(${observeX.toString()},expected);
  if(Object.entries(fresh.gates).some(([key,ok])=>key!=='safety'&&ok!==true))throw new Error('重试前内容或账号已改变');
  const sameGuard=await page.evaluate(fingerprint=>window.__168_PUBLISHER_X__?.fingerprint===fingerprint,expected.fingerprint);
  if(!sameGuard)throw new Error('发布保护关联已改变');
});
let publication={status:'submitted',finalPublishClicked:true,reason:'已点击最终发布；平台受理结果尚待确认'};
try{
  const autoPause=(await import('node:timers/promises')).setTimeout;
  let confirmed=false;
  for(let attempt=0;attempt<15;attempt++){
    const feedback=await page.evaluate(${publicationFeedback.toString()},${JSON.stringify(platform)});
    if(feedback.failure||feedback.ambiguous){publication.reason=feedback.failure||'发布确认按钮不唯一';break;}
    if(feedback.success){publication={status:'published',finalPublishClicked:true,reason:feedback.success};break;}
    if(feedback.confirmation){if(confirmed){publication.reason='发布后再次出现确认框，请检查原页面';break;}confirmed=true;await page.click('[data-168-auto-confirm="target"]');}
    await autoPause(2000);
  }
}catch(error){publication.reason='已点击发布，但回读失败：'+String(error.message||error);}
console.log(${JSON.stringify(PREFIX)}+JSON.stringify(publication));
`;
}

export async function autoPublish(plan,results,{inspect,stateRoot,raw,timeout,onProgress=()=>{}}){
  if(plan.autoPublish!==true)throw new Error('全自动发布需要本次明确选择“是”');
  assertManualSendContent(raw);
  const userControl=result=>/USER_CONTROL|user now controls|user-controlled/i.test(JSON.stringify([result?.error,result?.reason,result?.blocker]));
  if(Object.values(results).some(userControl))return;
  for(const job of plan.jobs){
    const file=path.join(stateRoot,job.jobId,'publication.json');
    if(fs.existsSync(file)){results[job.platform]={jobId:job.jobId,...readJson(file),skipped:true};continue;}
    if(results[job.platform]?.configurationComplete!==true)continue;
    onProgress(job,'verify_before_publish');
    const ready=await waitUntilReady(()=>inspect(job),{timeout});
    if(!ready.ready){results[job.platform]={...ready,jobId:job.jobId,configurationComplete:results[job.platform].configurationComplete,reason:ready.reason||'发布前检查未通过：'+(ready.missing?.join('、')||ready.status||'未取得核验结果')};if(userControl(ready))return;continue;}
    const directory=resolvePublisherLockDirectory();
    const type=job.type??plan.type;
    const releaseEntry=type==='video'?acquireJobLock(path.join(stateRoot,'.entry-lock'),{jobId:job.jobId}):()=>{};
    let release=()=>{};
    try{
      release=acquireJobLock(directory,{jobId:job.jobId,scope:'publisher'});
      const lock={directory,release};
      await checkProfile(plan.values['--profile']||'',lock);
      const statePath=path.join(stateRoot,job.jobId,'state.json'),state=readJson(statePath);
      onProgress(job,'publish');
      results[job.platform]={jobId:job.jobId,...await publishOnce(file,async()=>{
        const output=await ego(publicationScript(type,job.platform,state,statePath),lock);
        const line=output.split('\n').filter(line=>line.startsWith(PREFIX)).at(-1);
        if(!line)throw new Error('发布回执缺失');
        return JSON.parse(line.slice(PREFIX.length));
      })};
      if(userControl(results[job.platform]))return;
    }finally{release();releaseEntry();}
  }
}
