import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fillXhsScript} from '../scripts/xhs-page.mjs';

function topicPage(mode = 'ready', tags = ['AI', '设计', '视频生成']) {
  const events = [], waits = [], marker = 'data-168-publisher-topic-target';
  const pkg = {text:'原始正文\n保留换行', title:'原始标题', tags};
  let doc = {type:'doc', content:[{type:'paragraph'}]}, rows = [], pending = null, ticks = 0, blurred = false, cursorAtEnd = false, controlLost = false, callsAfterControlLost = 0, now = 0;
  const rect = () => ({width:20, height:20});
  const plain = node => node.type === 'topic' ? '#' + node.attrs.data.name + '[话题]#' : node.text || '';
  const textBlocks = () => doc.content.map(block => ({textContent:(block.content || []).map(plain).join('')}));
  const store = {title:'', desc:'', descInnerHTML:'', descLength:0, imgList:[], userInfo:{id:'account'}};
  const title = {tagName:'INPUT', value:''};
  const editor = {tagName:'DIV', getBoundingClientRect:rect, getAttribute:()=>null,
    querySelectorAll:()=>textBlocks(), editor:{getJSON:()=>doc, getText:({blockSeparator='\n\n'}={})=>{
      assert.equal(blockSeparator,'\n');return textBlocks().map(block=>block.textContent).join(blockSeparator);
    }}};
  const app = {_vnode:{component:{props:{state:{imgList:{_object:store}}}}}};
  const row = (name, hidden = false) => {
    const attributes = new Map();
    return {name, hidden, getBoundingClientRect:()=>({width:20,height:hidden?0:20}),
      querySelector:s=>s === '.name' ? {textContent:name} : null,
      getAttribute:name=>attributes.get(name) ?? null, setAttribute:(name,value)=>attributes.set(name,value), removeAttribute:name=>attributes.delete(name)};
  };
  const document = {activeElement:{tagName:'BODY'},
    querySelector:s=>s === '.tiptap' ? editor : s.startsWith('input[placeholder') ? title
      : s === '[data-168-publisher-topic-target]' ? rows.find(item=>item.getAttribute(marker)) || null : null,
    querySelectorAll:s=>s === '#creator-editor-topic-container .item' ? rows
      : s === '[data-168-publisher-topic-target]' ? rows.filter(item=>item.getAttribute(marker))
      : s.startsWith('.tiptap') ? [editor] : s === '[data-v-app]' ? [app] : [],
    createElement:()=>({content:{querySelectorAll:()=>textBlocks()}})};
  const context = vm.createContext({document, window:{}, location:{hostname:'creator.xiaohongshu.com',pathname:'/publish/publish'},
    getComputedStyle:()=>({visibility:'visible',opacity:'1',display:'block'}), Date});
  const evaluate = (fn,arg) => {context.argument = arg;return vm.runInContext(`(${fn.toString()})(argument)`,context);};
  const commit = tag => {
    doc.content.at(-1).content.pop();
    doc.content.at(-1).content.push({type:'text',text:' '},{type:'topic',attrs:{data:{name:mode === 'wrong_case' ? tag.toLowerCase() : tag,id:mode === 'empty_id' ? '' : 'topic-' + tag}}},{type:'text',text:'\u00a0'});
    events.push('entity:' + tag); rows = [];
  };
  const page = {
    evaluate:async(fn,arg)=>{if(controlLost)callsAfterControlLost++;return evaluate(fn,arg);},
    waitForSelector:async()=>{},
    waitForFunction:async(fn,arg,{timeout})=>{
      waits.push(timeout);assert.ok(timeout > 0 && timeout <= 30000);
      for(let attempt=0;attempt<6;attempt++) {
        if(await evaluate(fn,arg)) {if(mode === 'budget')now += Math.min(9000,timeout);return;}
        if(pending && ++ticks === 3) {commit(pending);pending = null;}
        await Promise.resolve();
      }
      throw new Error('page.waitForFunction timed out');
    },
    fill:async(selector,value)=>{assert.ok(selector.startsWith('input[placeholder'));title.value = store.title = value;events.push('title');},
    focus:async selector=>{
      if(selector.startsWith('input[placeholder')) {
        blurred = true;document.activeElement = title;events.push('blur');
        if(mode === 'lost_on_blur')doc.content.at(-1).content = [{type:'text',text:'#' + tags[0]}];
        store.desc = doc.content.map(block=>(block.content || []).map(plain).join('').replace(/\u00a0/g,' ').trimEnd() || '\t').join('\n');
        store.descInnerHTML = 'native';store.descLength = store.desc.length;
      } else {assert.equal(selector,'.tiptap[contenteditable="true"]');document.activeElement = editor;cursorAtEnd = false;}
    },
    keyboard:{
      press:async key=>{if(key === 'Backspace')doc.content = [{type:'paragraph'}];else if(key === 'Enter')doc.content.push({type:'paragraph'});else if(key === 'Meta+ArrowDown')cursorAtEnd = true;else assert.equal(key,'Meta+A');},
      paste:async text=>{assert.equal(text,pkg.text);doc.content = text.split('\n').map(line=>({type:'paragraph',content:[{type:'text',text:line}]}));},
      type:async text=>{
        assert.equal(document.activeElement,editor);assert.equal(cursorAtEnd,true,'focus resets selection: move to the end before typing');assert.equal(pending,null,'next query must wait for the previous entity');
        assert.ok(text.startsWith(' #'));const tag = text.slice(2);assert.ok(tags.includes(tag));events.push('type:' + text);
        doc.content.at(-1).content ||= [];doc.content.at(-1).content.push({type:'text',text});
        rows = mode === 'missing' ? [row('#unrelated')] : [row('#' + tag),row('#' + tag,true),row('#' + tag + '相似')];
        if(mode === 'ambiguous')rows.push(row('#' + tag));
        if(mode === 'case_candidate')rows = [row('#' + tag.toLowerCase())];
        if(mode === 'marker_exists')rows[0].setAttribute(marker,'existing');
      },
    },
    click:async selector=>{
      assert.equal(selector,'[data-168-publisher-topic-target="true"]','click must target the full marked row');
      const matching = rows.filter(item=>item.getAttribute(marker));assert.equal(matching.length,1);
      events.push('click:' + matching[0].name);
      if(mode === 'click_error') {controlLost = true;throw new Error('USER_CONTROL: user now controls');}
      if(mode === 'click_failed')throw new Error('Native click failed');
      if(mode !== 'no_entity') {pending = matching[0].name.slice(1);ticks = 0;}
    },
  };
  const runContext = vm.createContext({page, state:{pkg}, expected:{...pkg,assets:[]},console:{log:message=>events.push('success')},Date:{now:()=>now}});
  return {run:()=>vm.runInContext('(async()=>{' + fillXhsScript({}) + '})()',runContext),events,waits,
    snapshot:()=>({doc,rows,blurred,store,callsAfterControlLost})};
}

test('XHS enters three exact topics in order, awaits asynchronous entities, and persists after blur',async()=>{
  const fixture = topicPage();await fixture.run();
  assert.deepEqual(fixture.events,['title','type: #AI','click:#AI','entity:AI','type: #设计','click:#设计','entity:设计','type: #视频生成','click:#视频生成','entity:视频生成','blur','success']);
  assert.equal(fixture.snapshot().store.desc,'原始正文\n保留换行\n\t\n #AI[话题]#  #设计[话题]#  #视频生成[话题]#');
  assert.equal(fixture.snapshot().blurred,true);
});

for(const [mode,step] of [['missing','find_candidate'],['ambiguous','select_candidate'],['case_candidate','find_candidate'],['no_entity','confirm_entity'],['empty_id','confirm_entity'],['wrong_case','confirm_entity'],['lost_on_blur','verify_text'],['click_failed','select_candidate']]) {
  test('XHS stops without success for ' + mode + ' and reports the failing tag/step',async()=>{
    const fixture = topicPage(mode);
    await assert.rejects(fixture.run(),error=>{
      assert.match(error.message,new RegExp('"step":"' + step + '"'));
      assert.match(error.message,mode === 'lost_on_blur' ? /"tag":null/ : /"tag":"AI"/);
      assert.match(error.message,/"snapshot":/);
      return true;
    });
    assert.equal(fixture.events.includes('success'),false);
    if(mode !== 'lost_on_blur')assert.equal(fixture.events.includes('type: #设计'),false);
    assert.equal(fixture.snapshot().rows.some(row=>row.getAttribute('data-168-publisher-topic-target')),false);
    if(['missing','ambiguous','case_candidate'].includes(mode))assert.equal(fixture.events.some(event=>event.startsWith('click:')),false);
  });
}

test('XHS immediately stops on user takeover without diagnostic reads or cleanup',async()=>{
  const fixture = topicPage('click_error');await assert.rejects(fixture.run(),/^Error: USER_CONTROL: user now controls$/);
  assert.equal(fixture.snapshot().callsAfterControlLost,0);
  assert.equal(fixture.events.includes('success'),false);
  assert.equal(fixture.events.includes('type: #设计'),false);
});

test('XHS shares a finite action window across tags and never passes a zero timeout',async()=>{
  const fixture = topicPage('budget');await assert.rejects(fixture.run(),/"tag":"设计".*"step":"confirm_entity".*Content action window expired/);
  assert.deepEqual(fixture.waits,[10000,10000,10000,3000]);
  assert.equal(fixture.events.includes('type: #视频生成'),false);
  assert.equal(fixture.events.includes('success'),false);
});

test('XHS refuses to overwrite or remove an existing target marker',async()=>{
  const fixture = topicPage('marker_exists');await assert.rejects(fixture.run(),/Topic target marker already exists/);
  assert.equal(fixture.snapshot().rows[0].getAttribute('data-168-publisher-topic-target'),'existing');
  assert.equal(fixture.events.some(event=>event.startsWith('click:')),false);
});

test('XHS with no topics keeps the exact body and verifies it after blur',async()=>{
  const fixture = topicPage('ready',[]);await fixture.run();
  assert.equal(fixture.snapshot().store.desc,'原始正文\n保留换行');
  assert.deepEqual(fixture.events,['title','blur','success']);
});
