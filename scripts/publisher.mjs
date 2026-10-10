#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {entries} from './registry.mjs';
import {expandRequest,saveRequestResult} from './input.mjs';
import {renderReport} from './report.mjs';
import {loginCheckScript} from './login-page.mjs';
import {configuration} from './settings.mjs';
import {videoConfiguration} from './video-defaults.mjs';
import {assertManualSendContent} from './task.mjs';
import {readJson,writeJson,run,isMain,ego,checkProfile,PREFIX} from './runtime.mjs';
import {acquireJobLock} from '../assets/vendor/video-publisher/scripts/v2/lib/job-lock.mjs';

export function request(argv,raw,registry=entries) {
  const [command,...args]=argv,values={},flags=new Set();
  if(!['run','check','preflight','inspect','handoff'].includes(command))throw new Error('Usage: publisher.mjs preflight|run|check|inspect|handoff --package FILE --platform NAME [--job-id JOB]');
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(['--resume-control','--confirm-original-rights','--confirm-manual-send'].includes(key)){if(flags.has(key))throw new Error('Duplicate flag');flags.add(key);continue;}
    if(!['--package','--platform','--platforms','--profile','--job-id','--state-root','--space','--wait-timeout'].includes(key)||values[key]!==undefined)throw new Error('Unsupported or duplicate option: '+key);
    const value=args[++i];if(!value||value.startsWith('--'))throw new Error(key+' requires a value');values[key]=value;
  }
  if(!raw || typeof raw !== 'object' || Array.isArray(raw))throw new Error('Content package must be a JSON object');
  const type=raw.type??'video';
  if(!Object.hasOwn(registry,type))throw new Error('Unsupported content type in this edition: '+type);
  if(!values['--package']||!!values['--platform']===!!values['--platforms'])throw new Error('Provide --package and either --platform or --platforms');
  const selected=(values['--platform']||values['--platforms']).split(',');
  if(new Set(selected).size!==selected.length||selected.some(p=>!registry[type].platforms.includes(p)))throw new Error('Unsupported or duplicate platform for '+type);
  if(command==='preflight'&&registry[type].actionPreparation!==true)throw new Error('Login preflight supports video and dynamic only');
  if(command==='handoff'&&!flags.has('--confirm-manual-send'))throw new Error('handoff requires explicit manual-send confirmation');
  if(command!=='handoff'&&flags.has('--confirm-manual-send'))throw new Error('Manual-send flag only valid for handoff');
  if(command==='handoff')assertManualSendContent(raw);
  if(flags.has('--confirm-original-rights')&&type!=='video')throw new Error('Original-rights flag is video only');
  if(flags.has('--resume-control')&&(!values['--job-id']||!['run','inspect','preflight'].includes(command)))throw new Error('Explicit resume requires an existing job');
  if(values['--space']&&(!['run','preflight'].includes(command)||!/^\d+$/.test(values['--space'])))throw new Error('--space requires a numeric ID for preparation');
  if(values['--wait-timeout']&&(!/^\d+$/.test(values['--wait-timeout'])||!Number.isSafeInteger(Number(values['--wait-timeout']))||Number(values['--wait-timeout'])<1||command!=='run'))throw new Error('--wait-timeout requires positive seconds for run');
  if(['inspect','handoff'].includes(command)&&!values['--job-id'])throw new Error('Existing job-id required');
  const base=values['--job-id']||createHash('sha256').update(JSON.stringify({raw,type,selected})).digest('hex').slice(0,16);
  const jobs=selected.map(platform=>({platform,jobId:selected.length===1?base:base+'-'+platform}));
  if(jobs.some(j=>!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(j.jobId)))throw new Error('Invalid or too long job-id');
  return {command,type,entry:registry[type].entry,actionPreparation:registry[type].actionPreparation===true,urls:registry[type].urls,values,flags,jobs,base};
}

export function argumentsFor(plan,job,phase) {
  if(phase==='check'&&plan.type==='video')return ['check',job.platform,path.resolve(plan.values['--package']),'--job-id',job.jobId,...(plan.values['--state-root']?['--state-root',plan.values['--state-root']]:[])];
  const args=[phase,'--package',path.resolve(plan.values['--package']),'--platform',job.platform,'--job-id',job.jobId];
  for(const key of ['--state-root',...(phase==='check'?[]:['--profile'])])if(plan.values[key])args.push(key,plan.values[key]);
  if(phase==='prepare'&&plan.values['--space'])args.push('--space',plan.values['--space']);
  if(phase==='prepare'&&plan.actionPreparation)args.push('--actions-only');
  if(phase==='prepare'&&job.pageLabel)args.push('--page-label',job.pageLabel);
  if(phase==='handoff'&&plan.jobs.length>1)args.push('--defer-handoff');
  for(const flag of plan.flags)if(phase==='prepare'&&flag!=='--confirm-manual-send'||phase==='handoff'&&flag==='--confirm-manual-send'||phase==='inspect'&&plan.command==='inspect'&&flag==='--resume-control')args.push(flag);
  return args;
}

export function compactResult(type,platform,phase,result) {
  let value;try{value=JSON.parse(result.stdout.trim()||result.stderr.trim());}catch{return {status:'result_unknown',phase,error:'Entry returned no unambiguous JSON; inspect the detail file'};}
  const item=value.platforms?.[platform]||value;
  if(phase==='check')return {status:result.code===0&&(type==='video'?value.ok===true&&value.platform===platform:value.status==='input_checked')?'input_checked':'failed',phase,title:value.input?.title??value.title,conversions:value.input?.conversions||value.conversions||[],audit:value.audit,error:value.error,errors:value.errors??value.audit?.errors};
  const status=item.status||value.status||(/USER_CONTROL|user now controls|user-controlled/.test(value.error||'')?'needs_user':'result_unknown');
  const verified=status==='draft_verified'&&item.ready===true&&value.finalPublishClicked===false&&result.code===0;
  const handoff=status==='awaiting_manual_send'&&value.finalPublishClicked===false&&value.released?.ok===true&&result.code===0;
  const prepared=status==='configured'&&value.configurationComplete===true&&value.finalPublishClicked===false&&result.code===0;
  return {configurationComplete:prepared,status:status==='configured'&&!prepared?'result_unknown':status==='draft_verified'&&!verified||status==='awaiting_manual_send'&&!handoff||value.finalPublishClicked===true?'result_unknown':status,phase,ready:verified,taskSpaceId:item.taskSpaceId||value.taskSpaceId,draftId:value.draftId,missing:item.missing||value.missing,blocker:item.blocker?.code,reason:item.blocker?.message||item.reason||value.reason,blockerEvidence:item.blocker?.evidence,error:value.error,finalPublishClicked:value.finalPublishClicked,evidencePath:value.evidencePath,waitingFor:value.waitingFor,resumePreparation:type==='dynamic'&&status==='processing'&&value.finalPublishClicked===false&&value.waitingFor==='preparation'&&value.resumePreparation===true};
}

export async function execute(plan,invoke,_pause,{onProgress=()=>{},beforePreparation=async()=>{},afterPreparation=async()=>{}}={}) {
  const results={};
  const call=async(job,phase)=>{
    onProgress(results,{platform:job.platform,step:phase,index:plan.jobs.indexOf(job)+1,total:plan.jobs.length});
    try{return compactResult(plan.type,job.platform,phase,await invoke(job,phase,argumentsFor(plan,job,phase)));}catch(error){if(phase!=='check')throw error;return {status:'failed',phase,error:String(error.message||error),errors:[String(error.message||error)]};}
  };
  if(['run','check'].includes(plan.command)){
    for(const job of plan.jobs)results[job.platform]={jobId:job.jobId,...await call(job,'check')};
    if(plan.inputErrors?.length)for(const item of Object.values(results)){item.status='failed';item.errors=[...(item.errors||[]),...plan.inputErrors];}
    if(plan.command==='check'||Object.values(results).some(r=>r.status!=='input_checked'))return results;
    await beforePreparation();
  }
  if(plan.command==='handoff'&&plan.jobs.length>1){
    for(const job of plan.jobs)results[job.platform]={jobId:job.jobId,...await call(job,'inspect')};
    if(Object.values(results).some(r=>!r.ready))return results;
    if(new Set(Object.values(results).map(r=>r.taskSpaceId)).size!==1)throw new Error('Multi-platform handoff requires one original space');
  }
  for(const job of plan.jobs){
    const previous=plan.previousResults?.[job.platform];
    if(plan.command==='run'&&previous?.configurationComplete===true&&previous.handedOff===true&&previous.jobId===job.jobId){results[job.platform]={...previous,skipped:true};continue;}
    const checked=results[job.platform],phase=plan.command==='run'?'prepare':plan.command;
    results[job.platform]={jobId:job.jobId,conversions:checked?.conversions||[],audit:checked?.audit,...await call(job,phase)};
    onProgress(results,{platform:job.platform,step:'completed',index:plan.jobs.indexOf(job)+1,total:plan.jobs.length});
    if(/USER_CONTROL|user now controls|user-controlled/.test(results[job.platform].error||'')){
      for(const later of plan.jobs.slice(plan.jobs.indexOf(job)+1))results[later.platform]={jobId:later.jobId,status:'not_started'};
      break;
    }
  }
  if(plan.command==='run'&&plan.actionPreparation)await afterPreparation(results);
  return results;
}

export function precreatePagesScript(session,jobs,urls) {
  return `const session=${JSON.stringify(session)}, jobs=${JSON.stringify(jobs)}, urls=${JSON.stringify(urls)};
const task=await taskSpace(session.taskSpaceId);
if(task.name!==session.name)throw new Error('Run space identity changed');
const pages={...(session.pages||{})};
if(session.pageCreationAttempted&&!session.pages)throw new Error('Page creation outcome unknown; refusing duplicate pages');
const tabs=await task.tabs();
for(const job of jobs){
  if(pages[job.platform]){if(tabs.filter(t=>t.label===pages[job.platform]).length!==1)throw new Error('Original platform page missing');continue;}
  const page=Object.keys(pages).length===0&&tabs.length===1&&tabs[0].label==='p1'&&tabs[0].url==='about:blank'?task.page('p1'):await task.newPage();
  pages[job.platform]=page.label;
}
console.log(${JSON.stringify(PREFIX)}+JSON.stringify({pages}));`;
}

export function reviewHandoffScript(session,{protectedContent=false}={}) {
  return `const session=${JSON.stringify(session)};
const match=(await listTaskSpaces()).find(s=>Number(s.id??s.spaceId)===session.taskSpaceId&&s.name===session.name);
if(!match||match.ownership!=='agent')throw new Error('USER_CONTROL: review handoff requires original Agent control');
const task=await taskSpace(session.taskSpaceId),guardWarnings=[];
for(const label of Object.values(session.pages||{})){
  const page=task.page(label);
  if(!${protectedContent})guardWarnings.push(...await page.evaluate(()=>{
    const warnings=[];
    for(const key of ['__VIDEO_PUBLISHER_FINAL_GUARD__','__168_PUBLISHER_X__','__168_PUBLISHER_WEIBO__','__168_PUBLISHER_XHS__','__168_PUBLISHER_JIKE__']){
      const guard=window[key];if(!guard?.armed)continue;
      try{const released=(guard.releaseForConfirmedPublish||guard.release)?.call(guard);if(!released?.ok)throw new Error('Guard release rejected');}
      catch{guard.armed=false;warnings.push({key,blockedAttempts:guard.blockedAttempts?.length||0});}
    }
    return warnings;
  }));
}
await task.handOff();
console.log(${JSON.stringify(PREFIX)}+JSON.stringify({handedOff:true,taskSpaceId:task.spaceId,guardWarnings,protectedContent:${protectedContent},finalPublishClicked:false}));`;
}

export function runFingerprint(plan,raw) {
  return createHash('sha256').update(JSON.stringify({package:raw,type:plan.type,jobs:plan.jobs.map(({platform,jobId})=>({platform,jobId})),profile:plan.values['--profile']||''})).digest('hex');
}

export function runScopeFingerprint(plan){return createHash('sha256').update(JSON.stringify({type:plan.type,jobs:plan.jobs.map(({platform,jobId})=>({platform,jobId})),profile:plan.values['--profile']||''})).digest('hex');}

export async function ensureRunSpace(plan,sessionPath) {
  let session=fs.existsSync(sessionPath)?readJson(sessionPath):null;
  const scopeFingerprint=runScopeFingerprint(plan);
  const fingerprint=plan.command==='preflight'?null:runFingerprint(plan,readJson(path.resolve(plan.values['--package'])));
  if(session&&(session.scopeFingerprint&&session.scopeFingerprint!==scopeFingerprint||session.fingerprint&&session.fingerprint!==fingerprint||session.completed||session.handoffAttempted&&!session.handedOff))throw new Error('Run identity changed, completed, or handoff result unknown');
  if(session?.handedOff&&!plan.flags.has('--resume-control'))throw new Error('USER_CONTROL: explicit resume required');
  if(!session){session={fingerprint,scopeFingerprint,name:'168 publisher '+plan.type+' '+plan.base+' '+Date.now(),profile:plan.values['--profile']||'',external:!!plan.values['--space'],taskSpaceId:plan.values['--space']?Number(plan.values['--space']):null};writeJson(sessionPath,session);}
  await checkProfile(session.profile);
  const output=await ego(`const session=${JSON.stringify(session)};
const matches=(await listTaskSpaces()).filter(s=>session.taskSpaceId?Number(s.id??s.spaceId)===session.taskSpaceId:s.name===session.name);
if(matches.length>1||session.taskSpaceId&&matches.length!==1)throw new Error('Original run space unavailable');
if(matches.length&&session.profile&&matches[0].profileName!==session.profile)throw new Error('Run Profile changed');
if(session.taskSpaceId&&!session.external&&matches[0].name!==session.name)throw new Error('Run space identity changed');
const userControl=matches.length&&['user','agentDelegatedToUser'].includes(matches[0].ownership);
if(userControl&&!${plan.flags.has('--resume-control')})throw new Error('USER_CONTROL: explicit resume required');
const task=userControl?await takeOverTaskSpace(Number(matches[0].id??matches[0].spaceId)):await taskSpace(matches.length?Number(matches[0].id??matches[0].spaceId):session.name);
if(!matches.length)await task.page('p1').goto('about:blank');
console.log(${JSON.stringify(PREFIX)}+JSON.stringify({taskSpaceId:task.spaceId,name:task.name}));`);
  const line=output.split('\n').find(line=>line.startsWith(PREFIX));if(!line)throw new Error('Space creation result unknown');
  Object.assign(session,JSON.parse(line.slice(PREFIX.length)));
  session.scopeFingerprint=scopeFingerprint;if(plan.command!=='preflight')session.fingerprint=fingerprint;
  if(plan.flags.has('--resume-control')){delete session.handoffAttempted;delete session.handedOff;}
  writeJson(sessionPath,session);
  return session;
}

export async function main(argv=process.argv.slice(2),{registry=entries,stateHome=path.join(os.homedir(),'.168-publisher'),configFile=path.join(os.homedir(),'.config','168-publisher','settings.json')}={}) {
  if(process.platform!=='darwin')throw new Error('168 同步发布 supports macOS only');
  if(argv[0]==='config') {
    if(argv.length!==1)throw new Error('Usage: publisher.mjs config');
    console.log(JSON.stringify({...configuration(configFile,registry),video:videoConfiguration()},null,2));
    return;
  }
  const expanded=expandRequest(argv,{registry,stateHome,configFile}),context=expanded.context;
  argv=expanded.argv;
  try{
  if(argv[0]==='report'){
    if(!context?.lastReport)throw new Error('尚无保存的报告');
    console.log(renderReport(readJson(context.lastReport),context,readJson(context.packagePath)));return;
  }
  const at=argv.indexOf('--package');if(at<0||!argv[at+1])throw new Error('Explicit --package required');
  const raw=readJson(path.resolve(argv[at+1])),plan=request(argv,raw,registry),details=[];
  plan.inputErrors=context?.inputErrors||[];
  const childOptions={mirrorStderr:!context,mirrorProgress:!!context,env:context?.videoConfigPath?{...process.env,PUBLISHER_VIDEO_CONFIG:context.videoConfigPath}:process.env};
  const emit=report=>{Object.assign(report,{command:plan.command,type:plan.type,jobId:plan.base,inputErrors:plan.inputErrors});writeJson(report.reportPath,report);saveRequestResult(context,report);console.log(context?renderReport(report,context,raw):JSON.stringify(report,null,2));};
  const stateRoot=path.resolve(plan.values['--state-root']||path.join(stateHome,plan.type+'-jobs'));
  plan.values['--state-root']=stateRoot;
  const reportDirectory=path.join(stateRoot,plan.jobs[0].jobId);
  const sessionPath=path.join(stateRoot,'.runs',plan.base+'.json');
  const legacy=(!fs.existsSync(sessionPath)||!readJson(sessionPath).pages)&&plan.jobs.some(j=>fs.existsSync(path.join(stateRoot,j.jobId,'state.json')));
  let session;
  const release=acquireJobLock(path.join(stateRoot,'.runs',plan.base+'.lock'),{jobId:plan.base});
  try{
  const preparePages=async()=>{
      if(!plan.actionPreparation)return;
      if(legacy){
        const original=plan.jobs.map(job=>({job,state:readJson(path.join(stateRoot,job.jobId,'state.json'))}));
        const bindings=original.map(({job,state})=>({job,item:plan.type==='video'?state.platforms?.[job.platform]:state}));
        const spaces=new Set(bindings.map(({item})=>item?.taskSpaceId));
        if(spaces.size!==1||spaces.has(undefined))throw new Error('Legacy tasks do not share one original space; recover individually');
        const previous=fs.existsSync(sessionPath)?readJson(sessionPath):null;
        if(previous&&(previous.taskSpaceId!==bindings[0].item.taskSpaceId||previous.name!==bindings[0].item.taskSpaceName||previous.fingerprint!==runFingerprint(plan,raw)))throw new Error('Original run session identity changed');
        session={...previous,fingerprint:runFingerprint(plan,raw),taskSpaceId:bindings[0].item.taskSpaceId,name:bindings[0].item.taskSpaceName,pages:{},profile:plan.values['--profile']||'',external:true,pagesNavigated:true};
        for(const {job,item} of bindings){if(!item.pageLabel)throw new Error('Original task page label unavailable; use explicit maintenance recovery');job.pageLabel=item.pageLabel;session.pages[job.platform]=item.pageLabel;}
        plan.values['--space']=String(session.taskSpaceId);writeJson(sessionPath,session);
        session=await ensureRunSpace(plan,sessionPath);
        return;
      }
      session=await ensureRunSpace(plan,sessionPath);
      const creationScript=precreatePagesScript(session,plan.jobs,plan.urls);
      session.pageCreationAttempted=true;writeJson(sessionPath,session);
      const created=await ego(creationScript);
      const line=created.split('\n').find(line=>line.startsWith(PREFIX));if(!line)throw new Error('Platform page creation result unknown');
      session.pages=JSON.parse(line.slice(PREFIX.length)).pages;writeJson(sessionPath,session);
      for(const job of plan.jobs)job.pageLabel=session.pages[job.platform];
      if(!session.pagesNavigated||Object.keys(session.pageErrors||{}).length){
        const navigationPages=Object.fromEntries(Object.entries(session.pages).filter(([platform])=>!session.pagesNavigated||session.pageErrors?.[platform]));
        const opened=await ego(`const task=await taskSpace(${session.taskSpaceId}),errors={};for(const [platform,label] of Object.entries(${JSON.stringify(navigationPages)})){console.error(JSON.stringify({progress:{platform,step:'open_platform_page'}}));try{await task.page(label).goto(${JSON.stringify(plan.urls)}[platform]);}catch(error){errors[platform]=String(error.message||error);}}console.log(${JSON.stringify(PREFIX)}+JSON.stringify({pageErrors:errors}));`);
        const openedLine=opened.split('\n').find(line=>line.startsWith(PREFIX));if(!openedLine)throw new Error('Platform navigation result unknown');session.pageErrors=JSON.parse(openedLine.slice(PREFIX.length)).pageErrors;
        session.pagesNavigated=true;writeJson(sessionPath,session);
      }
  };
  if(plan.command==='preflight'){
    const contentAudit=await execute({...plan,command:'check'},async(job,phase,args)=>{
      const result=await run(process.execPath,[plan.entry,...args],childOptions);
      details.push({platform:job.platform,jobId:job.jobId,phase,...result});writeJson(path.join(reportDirectory,'run-details.json'),details);return result;
    });
    let report;
    try{
      if(legacy)throw new Error('Existing legacy task requires explicit maintenance recovery');
      await preparePages();
      const output=await ego(loginCheckScript(session));
      const line=output.split('\n').find(line=>line.startsWith(PREFIX));if(!line)throw new Error('Login check result unknown');
      report=JSON.parse(line.slice(PREFIX.length));
    }catch(error){report={platforms:Object.fromEntries(plan.jobs.map(job=>[job.platform,{status:'needs_user',reason:String(error.message||error)}])),finalPublishClicked:false};}
    for(const job of plan.jobs)report.platforms[job.platform]={...report.platforms[job.platform],jobId:job.jobId,contentAudit:contentAudit[job.platform]};
    report.contentStatus=Object.values(contentAudit).every(r=>r.status==='input_checked')?'input_checked':'needs_input';
    report.contentErrors=Object.entries(contentAudit).flatMap(([platform,item])=>(item.errors?.length?item.errors:item.error?[item.error]:[]).map(error=>({platform,error})));
    if(session?.taskSpaceId){
      session.handoffAttempted=true;writeJson(sessionPath,session);
      try{
        await ego(`const session=${JSON.stringify(session)},match=(await listTaskSpaces()).find(s=>Number(s.id??s.spaceId)===session.taskSpaceId&&s.name===session.name);if(match?.ownership!=='agent')throw new Error('USER_CONTROL: original space unavailable');const task=await taskSpace(session.taskSpaceId);await task.handOff();console.log('Login preflight handed off');`);
        session.handedOff=true;session.loginPreflight=true;writeJson(sessionPath,session);report.handedOff=true;
      }catch(error){report.handedOff=false;report.handoffError=String(error.message||error);}
    }
    report.status=report.handedOff!==true?'result_unknown':Object.values(report.platforms).every(r=>r.status==='login_checked')?'login_checked':Object.values(report.platforms).some(r=>r.status==='needs_login')?'needs_login':'needs_user';
    report.taskSpaceId=session?.taskSpaceId;report.jobId=plan.base;report.reportPath=path.join(reportDirectory,'login-report.json');emit(report);return;
  }
  if(plan.command==='run'&&fs.existsSync(path.join(reportDirectory,'run-report.json')))plan.previousResults=readJson(path.join(reportDirectory,'run-report.json')).platforms;
  const results=await execute(plan,async(job,phase,args)=>{
    if(phase==='prepare'&&!legacy){
      session||=await ensureRunSpace(plan,sessionPath);
      if(!args.includes('--space'))args.push('--space',String(session.taskSpaceId));
    }
    const result=await run(process.execPath,[plan.entry,...args],childOptions);
    details.push({platform:job.platform,jobId:job.jobId,phase,...result});writeJson(path.join(reportDirectory,'run-details.json'),details);return result;
  },undefined,{
    onProgress:(results,current)=>console.error(JSON.stringify({progress:current,platforms:Object.fromEntries(Object.entries(results).map(([p,r])=>[p,r.status]))})),
    beforePreparation:preparePages,
    afterPreparation:async results=>{
      if(!session&&fs.existsSync(sessionPath))session=readJson(sessionPath);
      if(!session)return;
      const userControl=Object.values(results).some(r=>/USER_CONTROL|user now controls|user-controlled/.test(r.error||''));
      if(userControl)return;
      session.handoffAttempted=true;writeJson(sessionPath,session);
      const output=await ego(reviewHandoffScript(session,{protectedContent:JSON.stringify(raw).includes('请勿发布')}));
      const line=output.split('\n').find(line=>line.startsWith(PREFIX));
      const receipt=line&&JSON.parse(line.slice(PREFIX.length));
      if(receipt?.handedOff!==true)throw new Error('Review handoff result unknown');
      if(receipt.guardWarnings?.length)for(const item of Object.values(results)){item.guardWarnings=receipt.guardWarnings;item.configurationComplete=false;if(item.status==='configured')item.status='needs_user';}
      for(const item of Object.values(results))item.handedOff=true;
      session.handedOff=true;session.completed=Object.values(results).every(r=>r.configurationComplete===true);writeJson(sessionPath,session);
      for(const job of plan.jobs.filter(job=>results[job.platform]?.configurationComplete===true)){const statePath=path.join(stateRoot,job.jobId,'state.json');if(!fs.existsSync(statePath))continue;if(plan.type==='dynamic'){const state=readJson(statePath);state.handoff={status:'review_handed_off',at:new Date().toISOString()};writeJson(statePath,state);}else{const file=path.join(stateRoot,job.jobId,'manual-control.json'),control=fs.existsSync(file)?readJson(file):{};writeJson(file,{...control,handoffs:{...control.handoffs,[job.platform]:{status:'review_handed_off'}}});}}
    }
  });
  if(plan.command==='handoff'&&plan.jobs.length>1&&Object.values(results).every(r=>r.status==='awaiting_manual_send')){
    const id=Object.values(results)[0].taskSpaceId;
    if(fs.existsSync(sessionPath)){session=readJson(sessionPath);session.handoffAttempted=true;writeJson(sessionPath,session);}
    await ego(`const task=await taskSpace(${JSON.stringify(id)});await task.handOff();console.log('Manual send control handed over');`);
  }
  const priority=['needs_user','needs_login','result_unknown','failed','processing','not_started','awaiting_manual_send','configured','draft_verified','input_checked'];
  const status=priority.find(s=>Object.values(results).some(r=>r.status===s))||'result_unknown';
  const report={type:plan.type,status,platforms:results,taskSpaceId:session?.taskSpaceId,handedOff:session?.handedOff===true,finalPublishClicked:false,reportPath:path.join(reportDirectory,'run-report.json'),detailPath:path.join(reportDirectory,'run-details.json')};
  emit(report);if(!['configured','draft_verified','input_checked','awaiting_manual_send'].includes(status))process.exitCode=10;
  }finally{release();}
  }finally{expanded.release?.();}
}
if(isMain(import.meta.url))main().catch(error=>{console.error(JSON.stringify({status:'result_unknown',error:error.message}));process.exitCode=1;});
