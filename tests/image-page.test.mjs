import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {imageControls,observeImage,armImageReceipts} from '../scripts/image-page.mjs';
import {normalizeDynamic} from '../scripts/dynamic-input.mjs';
import {entries} from '../scripts/registry.mjs';
import {parseTemplate} from '../scripts/input.mjs';
import {adapterPackage,adapterType} from '../scripts/media-routing.mjs';
import {request} from '../scripts/publisher.mjs';

const visible=()=>({height:30,width:80});
test('Images route to all eight platforms; native titles, overrides and limits remain explicit',()=>{
 const input='Auto publish: no\nTitle: Native title\nBody: Original body\nTags: AI\nMedia: /tmp/a.png\nPlatforms: all platforms\nWeChat Channels Title: Channel title';
 const parsed=parseTemplate(input,{platforms:{media:entries.media.platforms}},entries);
 assert.deepEqual(parsed.errors,[]);assert.equal(parsed.platforms.length,8);
 const plan=request(['check','--package','/tmp/pkg','--platforms',parsed.platforms.join(',')],parsed.pkg);
 for(const job of plan.jobs){const pkg=adapterPackage(parsed.pkg,job.platform,job.type),value=normalizeDynamic(pkg,'/tmp',job.platform);assert.equal(value.sources[0],'/tmp/a.png');assert.equal(value.text,job.platform==='xiaohongshu'?'Original body':'Original body\n\n#AI'+(job.platform==='weibo'?'#':''));assert.equal(job.type,entries.image.platforms.includes(job.platform)?'image':'dynamic');}
 for(const platform of entries.image.platforms){
  const type=adapterType(parsed.pkg,platform,entries),pkg=adapterPackage(parsed.pkg,platform,type);
  assert.throws(()=>normalizeDynamic({...pkg,videoPath:'/tmp/a.mp4'},'/tmp',platform),/not yet implemented/);
  assert.throws(()=>normalizeDynamic({...pkg,images:[]},'/tmp',platform),/media requires/);
  assert.throws(()=>normalizeDynamic({...pkg,text:' '},'/tmp',platform),/non-whitespace/);
 }
 assert.throws(()=>normalizeDynamic({type:'image',text:'body',images:['a.png']},'/tmp','douyin'),/requires.*title/);
 assert.throws(()=>normalizeDynamic({type:'image',text:'body',title:'x'.repeat(23),images:['a.png']},'/tmp','wechat_channels'),/title/);
 assert.throws(()=>normalizeDynamic({type:'image',text:'x'.repeat(1001),images:['a.png']},'/tmp','wechat_channels'),/1000/);
 assert.throws(()=>normalizeDynamic({type:'image',text:'body',images:Array.from({length:11},(_,i)=>i+'.png')},'/tmp','youtube'),/10/);
 assert.deepEqual(entries.dynamic.platforms,['x','weibo','xiaohongshu','jike'],'Historical dynamic jobs keep their original platforms');
});

function observed(platform,problem){
 const asset={sha256:'first',size:20},url='https://media.example/first.png';
 const image={src:problem==='foreign'?'https://media.example/other.png':url,complete:true,naturalWidth:100,className:'',getBoundingClientRect:visible,closest:()=>null};
 const scope={querySelectorAll:()=>[image]};
 const editor={innerText:'Original body',getBoundingClientRect:visible,closest:()=>scope,getRootNode:()=>scope};
 const title={value:problem==='title'?'other':'Native title',getBoundingClientRect:visible};
 const button={innerText:'发布',className:'',getBoundingClientRect:visible,disabled:false,getAttribute:()=>null};
 const nativeFile={__reactFiber$test:{memoizedProps:{userInfo:{uid:'account'}}}};
 const nodes=[{__vue__:{userStore:{finderUsername:'account'}}}];
 const document={querySelector:selector=>selector==='ytd-backstage-post-dialog-renderer'?{data:{imageButton:{buttonRenderer:{navigationEndpoint:{backstageImageUploadEndpoint:{channelId:problem==='recommendation'?undefined:'UCtest'}}}}}}:selector==='ytd-channel-name'?{innerText:'recommended creator'}:selector.includes('header-entry')?{href:'account'}:selector.includes('user-name')?{innerText:'account'}:null,querySelectorAll:selector=>selector==='*'?nodes:selector==='#publisher-image-files'?[nativeFile]:selector==='#publisher-image-body'?(problem==='ambiguous'?[editor,editor]:[editor]):selector==='#publisher-image-title'?(platform==='youtube'?[]:[title]):selector.startsWith('button,')?[button]:[]};
 const guard={armed:true,fingerprint:'fingerprint',blockedAttempts:problem==='blocked'?[{}]:[],files:[{sha256:problem==='file'?'other':'first',size:20}],blobs:{},uploads:[{sha256:'first',size:20,status:problem==='failed'?500:200,urls:[url]}]};
 const expected={platform,account:problem==='account'?'other':platform==='youtube'?'UCtest':'account',fingerprint:'fingerprint',text:'Original body',title:platform==='youtube'?'':'Native title',assets:[asset]};
 return vm.runInNewContext(`(${observeImage.toString()})(expected)`,{expected,document,window:{__168_PUBLISHER_IMAGE__:guard},location:{hostname:{douyin:'creator.douyin.com',bilibili:'t.bilibili.com',wechat_channels:'channels.weixin.qq.com',youtube:'www.youtube.com'}[platform],pathname:'/channel/UCtest/posts'},getComputedStyle:()=>({visibility:'visible'})});
}
test('Native image verification requires ordered upload receipts, account, content and a clean guard',()=>{
 for(const platform of entries.image.platforms){
  assert.ok(Object.values(observed(platform,'none').gates).every(Boolean),platform);
  for(const problem of ['foreign','file','failed','account','ambiguous','blocked',...(platform==='youtube'?['recommendation']:['title'])])assert.ok(Object.values(observed(platform,problem).gates).some(ok=>!ok),platform+': '+problem);
 }
});

test('Ambiguous image inputs never receive the upload target ID, including inside shadow roots',()=>{
 const editor={getBoundingClientRect:visible,id:'',getRootNode:()=>scope};
 const files=[1,2].map(()=>({accept:'image/*',multiple:true,id:''}));
 const scope={contains:()=>true};
 const shadow={querySelectorAll:selector=>selector==='*'?[]:selector.includes('contenteditable')?[editor]:selector.includes('type=file')?files:[]};
 const document={querySelectorAll:selector=>selector==='*'?[{shadowRoot:shadow}]:[]};
 const result=vm.runInNewContext(`(${imageControls.toString()})('douyin')`,{document,getComputedStyle:()=>({visibility:'visible'})});
 assert.equal(result.file,false);assert.equal(result.fileCount,2);assert.ok(files.every(file=>!file.id));
});

test('Upload proof hashes submitted bytes, keeps server errors and restores browser APIs on release',async()=>{
 class Input{click(){}addEventListener(){}}
 class Xhr{open(){}send(){}addEventListener(name,fn){this.listener=fn;}}
 const guard={armed:true,release(){this.armed=false;return {ok:true};}};
 const fetch=async()=>new Response(JSON.stringify({url:'https://media.example/first.png'}),{status:200});
 const window={__168_PUBLISHER_IMAGE__:guard,fetch};
 const context=vm.createContext({window,XMLHttpRequest:Xhr,HTMLInputElement:Input,FormData,Blob,crypto:webcrypto});
 const inputClick=Input.prototype.click,send=Xhr.prototype.send;
 vm.runInContext(`(${armImageReceipts.toString()})()`,context);
 const body=new FormData();body.append('image',new Blob(['original bytes'],{type:'image/png'}),'first.png');
 await window.fetch('/upload',{method:'POST',body});
 const xhr=new Xhr();xhr.send(body);xhr.status=500;xhr.responseText=JSON.stringify({url:'https://media.example/first.png'});xhr.listener();
 for(let i=0;i<50&&guard.uploads.some(u=>u.pending||!u.status);i++)await pause(5);
 assert.equal(guard.uploads.length,2);assert.ok(guard.uploads.every(u=>u.sha256?.length===64));
 assert.equal(guard.uploads[0].status,200);assert.equal(guard.uploads[1].status,500);assert.equal(guard.uploads[0].urls[0],'https://media.example/first.png');
 guard.release();assert.equal(window.fetch,fetch);assert.equal(Input.prototype.click,inputClick);assert.equal(Xhr.prototype.send,send);
});


test('Repeated control scans remove stale IDs when a second native editor appears',()=>{
 const scope={contains:()=>true};
 const editors=[{id:'',getBoundingClientRect:visible,getRootNode:()=>scope}];
 const document={querySelectorAll:selector=>selector==='*'?[]:selector.startsWith('#publisher-image-body')?editors.filter(e=>e.id):selector.includes('contenteditable')?editors:[]};
 const context={document,getComputedStyle:()=>({visibility:'visible'})};
 const scan=()=>vm.runInNewContext(`(${imageControls.toString()})('douyin')`,context);
 assert.equal(scan().editor,true);assert.equal(editors[0].id,'publisher-image-body');
 editors.push({id:'',getBoundingClientRect:visible,getRootNode:()=>scope});
 assert.equal(scan().editor,false);assert.ok(editors.every(e=>e.id===''));
});
