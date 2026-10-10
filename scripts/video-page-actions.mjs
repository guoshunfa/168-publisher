// Browser functions are serialized into the pinned adapter's execution context.
export async function submitNativeVideo(platform, file, beforeDispatch) {
  const controls={xiaohongshu:'loc=role:button[name="上传视频"]',bilibili:'.upload-area',youtube:'loc=css:button[aria-label="选择文件"]'};
  let selector=await page.evaluate(()=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const inputs=roots.flatMap(r=>[...r.querySelectorAll('input[type=file]')]).filter(e=>/video|\.mp4|\.mov/i.test(e.accept||''));if(inputs.length!==1)return null;inputs[0].id='publisher-native-video';return '#publisher-native-video';});
  if(platform==='xiaohongshu'&&!selector){
    await page.reload();
    await page.waitForSelector(controls.xiaohongshu,{timeout:15000});
    const guard=await armFinalPublishGuard();if(!guard.ok||!guard.armed)throw new Error('Final button guard unavailable after refresh');
    const refreshed=await inspectXiaohongshu();if(refreshed.gates.video?.ok||refreshed.gates.video?.evidence?.uploading)throw new Error('Historical video restored after refresh; refusing replacement');
  }
  // Bilibili has multiple inputs; its upload area's chooser owns the working one.
  if(platform==='bilibili'||!selector){
    const control=controls[platform];
    if(!control)throw new Error('Unique native video input unavailable');
    const choosing=page.waitForFileChooser({timeout:10000});
    await page.click(control);
    const chooser=await choosing;
    beforeDispatch();
    await chooser.setFiles(file);
  }else{
    beforeDispatch();
    await page.setInputFiles(selector,[file]);
  }
  return {ok:true};
}

export async function openYoutubeUploadCompat() {
  if(await page.evaluate(()=>!!document.querySelector('ytcp-uploads-dialog')))return {ok:true};
  const create=await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button')].filter(e=>/^(创建|Create)$/.test(e.getAttribute('aria-label')||'')&&e.getBoundingClientRect().height>0);if(buttons.length!==1)return false;buttons[0].id='publisher-youtube-create';return true;});
  if(!create)return {ok:false,reason:'YouTube unique create control missing'};
  await page.click('#publisher-youtube-create');
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=menuitem]')].some(e=>/^(上传视频|Upload videos)$/.test(e.innerText.trim())&&e.getBoundingClientRect().height>0),undefined,{timeout:10000});
  const menu=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('[role=menuitem]')].filter(e=>/^(上传视频|Upload videos)$/.test(e.innerText.trim())&&e.getBoundingClientRect().height>0);if(nodes.length!==1)return false;nodes[0].id='publisher-youtube-upload';return true;});
  if(!menu)return {ok:false,reason:'YouTube unique upload menu missing'};
  await page.click('#publisher-youtube-upload');
  await page.waitForSelector('ytcp-uploads-dialog',{timeout:15000});
  return {ok:true};
}

export async function selectBilibiliTopic(tag) {
  await page.click('text="搜索更多话题 >"');
  await page.fill('input[placeholder="请输入"]',tag);
  await page.press('input[placeholder="请输入"]','Enter');
  await page.waitForFunction(tag=>[...document.querySelectorAll('.topic-card .topic-tag-name')].some(e=>e.textContent.trim()===tag),tag,{timeout:actionControlTimeout(10000)});
  const candidate=await page.evaluate(tag=>{const matches=[...document.querySelectorAll('.topic-card')].filter(e=>e.querySelector('.topic-tag-name')?.textContent.trim()===tag&&e.getBoundingClientRect().height>0);if(matches.length!==1)return false;matches[0].id='publisher-bilibili-topic';return true;},tag);
  if(!candidate)return {ok:false,reason:'Bilibili exact topic missing or ambiguous: '+tag};
  await page.click('#publisher-bilibili-topic');
  await page.click('loc=role:button[name="确定"]');
  await page.waitForFunction(tag=>[...document.querySelectorAll('#tag-container .label-item-v2-content')].some(e=>e.textContent.trim()===tag),tag,{timeout:actionControlTimeout(5000)});
  return {ok:true};
}

export async function ensureBilibiliMetadataCompat(before) {
  const result=await ensureBilibiliEarlyMetadata(before);
  if(result.ok||!result.current?.gates?.tags?.evidence?.missing?.length)return result;
  for(const tag of result.current.gates.tags.evidence.missing){
    const topic=await selectBilibiliTopic(tag);
    if(!topic.ok)return {...result,blocker:typedBlocker('ACTION_FAILED',topic.reason)};
  }
  return ensureBilibiliEarlyMetadata(await inspectBilibili());
}

export async function ensureBilibiliDeclarationCompat() {
  const declaration=pkg.aiGenerated===true?'含AI生成内容':'内容无需标注';
  // The collapsed input may show only the authorization text, hiding the selected declaration.
  const read=()=>page.evaluate(()=>{const root=document.querySelector('.creation-statement-container');return {declarations:[...(root?.querySelectorAll('.bcc-option.selected')||[])].map(e=>e.textContent.trim()),original:!!root?.querySelector('.auth-content .option-text-selected')};});
  const matches=value=>value.declarations.length===1&&value.declarations[0]===declaration&&value.original;
  let current=await read();
  if(matches(current))return {ok:true,skipped:true,evidence:current};
  if(current.declarations.length!==1||current.declarations[0]!==declaration){
    await page.click('input[placeholder*="创作声明"]');
    await page.click('text="'+declaration+'"');
  }
  current=await read();
  if(!current.original){await page.click('input[placeholder*="创作声明"]');await page.click('text="内容为自制：未经作者允许，禁止转载"');}
  await page.click('input[placeholder*="稿件标题"]');
  current=await read();
  return {ok:matches(current),evidence:current,reason:matches(current)?undefined:'B站创作声明或自制授权未保留'};
}

export async function ensureWechatMetadataCompat() {
  const tags=pkg.wechatTags||[],body=pkg.wechatDescription,shortTitle=String(pkg.wechatShortTitle||'');
  const expected=body+(tags.length?' '+tags.map(t=>'#'+t).join(' ')+' ':'');
  const fields=await page.evaluate(()=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)],editors=roots.flatMap(r=>[...r.querySelectorAll('.input-editor[contenteditable]')]);if(editors.length!==1)return null;editors[0].id='publisher-wechat-description';return {shortTitle:roots.flatMap(r=>[...r.querySelectorAll('input')]).find(e=>e.placeholder.includes('短标题'))?.value||'',text:editors[0].innerText,tags:[...editors[0].querySelectorAll('[data-type=topic]')].map(e=>e.textContent.slice(1))};});
  if(!fields)return {ok:false,blocker:typedBlocker('ACTION_FAILED','视频号描述控件缺失或有歧义')};
  if(fields.text!==expected||JSON.stringify(fields.tags)!==JSON.stringify(tags)){
    await page.focus('#publisher-wechat-description');await page.keyboard.press('Meta+A');await page.keyboard.paste(body);
    if(tags.length){
      await page.keyboard.press('End');await page.keyboard.insertText(' ');
      for(let index=0;index<tags.length;index++){
        await page.keyboard.insertText('#'+tags[index]);await page.keyboard.press('Space');
        try{
          await page.waitForFunction(({tags,index})=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)],editor=roots.flatMap(r=>[...r.querySelectorAll('#publisher-wechat-description')])[0],actual=[...(editor?.querySelectorAll('[data-type=topic]')||[])].map(e=>e.textContent.slice(1));return JSON.stringify(actual)===JSON.stringify(tags.slice(0,index+1));},{tags,index},{timeout:actionControlTimeout(5000)});
        }catch(error){return {ok:false,blocker:typedBlocker('ACTION_FAILED','视频号话题未形成真实节点：'+tags[index],{evidence:{tag:tags[index],step:'commit_topic',message:error.message}})};}
      }
    }
    await page.focus('input[placeholder*="短标题"]');
  }
  if(fields.shortTitle!==shortTitle)await page.fill('input[placeholder*="短标题"]',shortTitle);
  const after=await page.evaluate(()=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)],editor=roots.flatMap(r=>[...r.querySelectorAll('#publisher-wechat-description')])[0];return editor?{text:editor.innerText,tags:[...editor.querySelectorAll('[data-type=topic]')].map(e=>e.textContent.slice(1))}:null;});
  const ok=after?.text===expected&&JSON.stringify(after.tags)===JSON.stringify(tags);
  return {ok,actions:{description:after,shortTitle},blocker:ok?undefined:typedBlocker('ACTION_FAILED','视频号正文或真实话题未保留')};
}

export async function inspectWechatChannelsCompat() {
  const result=await inspectWechatChannelsBase();
  const fields=await page.evaluate(()=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)],editor=roots.flatMap(r=>[...r.querySelectorAll('.input-editor')])[0];return {tags:[...(editor?.querySelectorAll('[data-type=topic]')||[])].map(e=>e.textContent.slice(1)),shortTitle:roots.flatMap(r=>[...r.querySelectorAll('input')]).find(e=>e.placeholder.includes('短标题'))?.value||''};});
  const tags=pkg.wechatTags||[],expected=String(pkg.wechatShortTitle||'');
  result.gates.tags={ok:JSON.stringify(fields.tags)===JSON.stringify(tags),evidence:{expected:tags,actual:fields.tags}};
  result.gates.shortTitle={ok:fields.shortTitle===expected,evidence:{expected,actual:fields.shortTitle}};
  return result;
}

export function actionControlTimeout(limit) {
  if(typeof actionDeadline==='undefined')return limit;
  const remaining=actionDeadline-Date.now();
  if(remaining<=0)throw new Error('Required field controls did not settle within 30 seconds');
  return Math.min(limit,remaining);
}
