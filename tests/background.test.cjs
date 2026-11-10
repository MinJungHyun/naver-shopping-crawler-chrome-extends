const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../extension/core');
function harness() {
  const data={}, alarms=new Map(), tabs=new Map(), events={}, windowCalls=[], popupCalls=[], scriptCalls=[], flags={}; let tabId=0, uuid=0;
  const event=name=>({addListener(fn){events[name]=fn;}});
  const chrome={
    storage:{local:{async get(keys){return structuredClone(data);},async set(value){Object.assign(data,structuredClone(value));}}},
    runtime:{id:'test-extension',getURL:file=>`chrome-extension://test-extension/${file}`,onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup')},
    action:{onClicked:event('action')},
    windows:{async update(id,value){windowCalls.push({id,...value});},async create(value){popupCalls.push({...value});return {id:900,...value};}},
    tabs:{async get(id){if(!tabs.has(id))throw Error('missing');return tabs.get(id);},async create(value){const tab={...value,id:++tabId};tabs.set(tab.id,tab);return tab;},async update(id,value){Object.assign(tabs.get(id),value);return tabs.get(id);},onRemoved:event('removed'),onUpdated:event('updated')},
    scripting:{async executeScript(value){scriptCalls.push(value);if(flags.failScripting)throw Error('Cannot access contents of the page.');return [{result:flags.hasOverlay}];}},
    alarms:{async create(name,value){alarms.set(name,value);},async clear(name){return alarms.delete(name);},async get(name){return alarms.get(name);},onAlarm:event('alarm')}
  };
  const ctx=vm.createContext({chrome,NSC:core,importScripts(){},crypto:{randomUUID:()=>String(++uuid)},console,Date,URL,Promise});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),ctx);
  const dashboard={id:chrome.runtime.id,url:chrome.runtime.getURL('dashboard.html')};
  const send=(message,sender=dashboard)=>new Promise(resolve=>events.message(message,sender,resolve));
  const settle=()=>send({type:'GET'});
  const source=()=>({id:chrome.runtime.id,tab:{id:data.job.tabId,url:tabs.get(data.job.tabId).url},url:tabs.get(data.job.tabId).url,documentId:`doc-${data.job.keywordIndex}-${data.job.page}`});
  const content=async(type,extra={})=>send({type,token:data.job.token,...extra},source());
  return {data,alarms,tabs,events,send,source,content,settle,windowCalls,popupCalls,scriptCalls,flags};
}
test('collects pages 1 and 2, waits 3–10 minutes, then advances keyword',async()=>{
  const h=harness(); assert((await h.send({type:'START',keywords:['사료','간식'],settings:{maxPages:2}})).ok);
  const first=new URL(h.tabs.get(1).url);
  assert.equal(first.searchParams.get('query'),'사료');
  assert.equal(first.searchParams.get('pagingSize'),'80');
  assert.equal(first.searchParams.get('catId'),null);
  assert((await h.content('READY')).active);
  await h.content('PROGRESS',{items:[{keyword:'사료',page:1,productId:'1',isAd:false}],scrolls:3,message:'저장'});
  const staleToken=h.data.job.token, staleSource=h.source();
  await h.content('PAGE_DONE',{count:1,hasNext:true}); assert.equal(h.data.job.page,2);
  const stale=await h.send({type:'PROGRESS',token:staleToken,items:[{keyword:'사료',page:1,productId:'2'}]},staleSource);
  assert.equal(stale.active,false); assert.equal(h.data.items.length,1);
  assert((await h.content('READY')).active);
  await h.content('PAGE_DONE',{count:0,hasNext:true});
  assert.equal(h.data.job.phase,'keyword-wait');
  const wait=h.data.job.nextActionAt-Date.now(); assert(wait>=179000 && wait<=600000); assert(h.alarms.has('next-keyword'));
  h.data.job.nextActionAt=Date.now()-1; h.events.alarm({name:'next-keyword'}); await h.settle();
  assert.equal(h.data.job.keywordIndex,1); assert.equal(h.data.job.page,1);
  await h.content('READY'); await h.content('PAGE_DONE',{count:0,hasNext:false});
  assert.equal(h.data.job.status,'completed'); assert.equal(h.data.items.length,1);
});
test('pause rejects late results and resume reloads current page',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});await h.content('READY');
  const token=h.data.job.token;await h.send({type:'PAUSE'});
  assert.equal(h.data.job.status,'paused');
  assert.equal((await h.content('PROGRESS',{token,items:[{keyword:'사료',page:1,productId:'2'}]})).active,false);
  assert.equal(h.data.items.length,0);await h.send({type:'RESUME'});
  assert.equal(h.data.job.phase,'loading');assert.notEqual(h.data.job.token,token);
});
test('pause during keyword wait preserves remaining duration',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료','간식']});await h.content('READY');await h.content('PAGE_DONE',{count:0,hasNext:false});
  await h.send({type:'PAUSE'});const remaining=h.data.job.remainingWait;assert(remaining>=179000);assert(!h.alarms.has('next-keyword'));
  await h.send({type:'RESUME'});assert.equal(h.data.job.phase,'keyword-wait');assert(h.alarms.has('next-keyword'));assert(Math.abs(h.data.job.nextActionAt-Date.now()-remaining)<1000);
});
test('security screen, restart and closed tab pause the run',async()=>{
  for(const event of ['issue','startup','closed']){
    const h=harness();await h.send({type:'START',keywords:['사료']});await h.content('READY');
    if(event==='issue') await h.content('ISSUE',{message:'접근 제한'});
    if(event==='startup') h.events.startup();
    if(event==='closed') {h.tabs.delete(h.data.job.tabId);h.events.removed(h.data.job.tabId);}
    await h.settle();assert.equal(h.data.job.status,'paused');
    await h.send({type:'RESUME'});assert.equal(h.data.job.status,'running');
  }
});
test('unresponsive pages pause and untrusted callers cannot clear results',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});
  h.data.job.lastHeartbeat=Date.now()-61000;h.events.alarm({name:'collector-watchdog'});await h.settle();assert.equal(h.data.job.status,'paused');
  assert.equal((await h.send({type:'CLEAR'},{id:'evil',url:'https://example.com'})).ok,false);
  assert.equal((await h.send({type:'CLEAR'})).ok,false);
  await h.send({type:'STOP'});await h.send({type:'CLEAR'});assert.equal(h.data.job,null);
});
test('reset stops a stuck job and clears stored results',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});await h.content('READY');
  h.data.items=[{productName:'보관 중'}];
  assert.equal((await h.send({type:'RESET'})).ok,true);
  assert.equal(h.data.job,null);assert.equal(h.data.items.length,0);
  assert.equal(h.alarms.has('collector-watchdog'),false);assert.equal(h.alarms.has('next-keyword'),false);
  assert.equal((await h.send({type:'START',keywords:['사료']})).ok,true);
});
test('a redirected search page pauses with the actual address',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});
  h.tabs.get(h.data.job.tabId).url='https://search.shopping.naver.com/ns/search?query=%EC%82%AC%EB%A3%8C';
  await h.content('READY');
  assert.equal(h.data.job.status,'paused');
  assert.match(h.data.job.message,/예상 주소와 다릅니다/);
});
test('a page that never runs the content script is re-injected once, then pauses',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});
  h.events.alarm({name:'collector-url-check'});await h.settle();
  assert.equal(h.scriptCalls.length,1);
  assert.equal(h.scriptCalls[0].files.at(-1),'content.js');
  assert.equal(h.data.job.status,'running');
  for(let i=0;i<5;i++){h.events.alarm({name:'collector-url-check'});await h.settle();}
  assert.equal(h.data.job.status,'paused');
  assert.match(h.data.job.message,/수집 스크립트가 응답하지 않습니다/);
});
test('an open page that reports READY is not re-injected',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});await h.content('READY');
  h.events.alarm({name:'collector-url-check'});await h.settle();
  assert.equal(h.scriptCalls.length,0);assert.equal(h.data.job.status,'running');
});
test('a tab that lands on another site pauses with the actual address',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});
  h.tabs.get(h.data.job.tabId).url='https://nid.naver.com/nidlogin.login?url=x';
  h.events.alarm({name:'collector-url-check'});await h.settle();
  assert.equal(h.data.job.status,'paused');
  assert.match(h.data.job.message,/nid\.naver\.com\/nidlogin\.login/);
});
test('existing results are never silently overwritten by a new start',async()=>{  const h=harness();h.data.items=[{productName:'보관 중'}];
  assert.equal((await h.send({type:'START',keywords:['사료']})).ok,false);assert.equal(h.data.items.length,1);
});
test('toolbar action toggles the in-page layer without starting a job',async()=>{
  const h=harness();await h.settle();
  h.events.action({id:1,url:'https://search.shopping.naver.com/search/all'});
  await h.settle();
  assert.equal(h.scriptCalls.at(-1).files?.[0],'overlay.js');
  assert.equal(h.tabs.size,0);assert.equal(h.data.job,undefined);assert.equal(h.popupCalls.length,0);
  h.flags.hasOverlay=true;
  h.events.action({id:1,url:'https://search.shopping.naver.com/search/all'});
  await h.settle();
  assert.equal(typeof h.scriptCalls.at(-1).func,'function');assert.equal(h.scriptCalls.at(-1).files,undefined);
});
test('a page that refuses injection falls back to a popup window',async()=>{
  const h=harness();h.flags.failScripting=true;
  h.events.action({id:1,url:'chrome://extensions/'});await h.settle();
  assert.equal(h.popupCalls.length,1);
  assert.equal(h.popupCalls[0].type,'popup');
  assert.match(h.popupCalls[0].url,/dashboard\.html$/);
});
test('a blocked frame asked for a window instead',async()=>{
  const h=harness();
  const sender={id:'test-extension',tab:{id:1,url:'https://search.shopping.naver.com/'},url:'https://search.shopping.naver.com/'};
  assert.equal((await h.send({type:'OVERLAY_FAILED'},sender)).ok,true);
  assert.equal(h.popupCalls.length,1);
});
test('the layer appears on the collecting tab when its page completes',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});
  h.events.updated(1,{status:'complete'},{id:1,url:h.tabs.get(1).url});
  await h.settle();
  assert.equal(h.scriptCalls.at(-1).files?.[0],'overlay.js');
});
test('collector stays in the starting window and focus reveals its existing tab',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료'],windowId:7});
  assert.equal(h.data.job.windowId,7);assert.equal(h.tabs.get(1).windowId,7);
  const before=structuredClone(h.data.job);
  assert.equal((await h.send({type:'FOCUS'})).ok,true);
  assert.equal(h.tabs.size,1);assert.equal(h.tabs.get(1).active,true);
  assert.deepEqual(h.windowCalls,[{id:7,focused:true}]);assert.deepEqual(h.data.job,before);
  h.tabs.delete(1);assert.equal((await h.send({type:'FOCUS'})).ok,false);
  h.events.removed(1);await h.settle();
  await h.send({type:'RESUME',windowId:8});assert.equal(h.data.job.windowId,8);assert.equal(h.tabs.get(2).windowId,8);
});
test('opening a real search preview neither creates a job nor collects any items',async()=>{
  const h=harness();
  assert.equal((await h.send({type:'OPEN_PREVIEW',keywords:['플래티넘 사료'],windowId:7})).ok,true);
  assert.equal(h.data.job,undefined);assert.equal(h.data.items,undefined);assert.equal(h.alarms.size,0);
  assert.equal(h.tabs.get(1).windowId,7);assert.equal(new URL(h.tabs.get(1).url).searchParams.get('query'),'플래티넘 사료');
  const sender={id:'test-extension',tab:{id:1,url:h.tabs.get(1).url},url:h.tabs.get(1).url,documentId:'preview'};
  assert.equal((await h.send({type:'READY'},sender)).active,false);
  assert.equal(h.data.job,undefined);assert.equal(h.data.items,undefined);
});
test('category id and page size are applied to start and preview URLs',async()=>{
  const h=harness();
  assert.equal((await h.send({type:'START',keywords:['사료'],settings:{catId:'50000155',pagingSize:40}})).ok,true);
  const url=new URL(h.tabs.get(1).url);
  assert.equal(url.searchParams.get('catId'),'50000155');assert.equal(url.searchParams.get('pagingSize'),'40');
  await h.send({type:'STOP'});await h.send({type:'CLEAR'});
  assert.equal((await h.send({type:'OPEN_PREVIEW',keywords:['사료'],settings:{catId:'50000155'}})).ok,true);
  const preview=new URL([...h.tabs.values()].at(-1).url);
  assert.equal(preview.searchParams.get('catId'),'50000155');assert.equal(preview.searchParams.get('pagingSize'),'80');
});
test('a default run covers one page of 80 without turning pages',async()=>{
  const h=harness();await h.send({type:'START',keywords:['사료']});
  assert.equal(h.data.job.settings.maxPages,1);assert.equal(h.data.job.settings.pagingSize,80);
  await h.content('READY');await h.content('PAGE_DONE',{count:80,hasNext:true});
  assert.equal(h.data.job.page,1);assert.equal(h.data.job.status,'completed');
});
test('selected page count and keyword delay control the actual job',async()=>{
  const h=harness(), settings={maxPages:3,scrollPercent:50,actionMin:5,actionMax:300,keywordMin:60,keywordMax:60};
  assert.equal((await h.send({type:'START',keywords:['사료','간식'],settings})).ok,true);
  assert.deepEqual(h.data.job.settings,core.normalizeSettings(settings));
  for(const page of [1,2,3]){
    assert.equal(h.data.job.page,page);await h.content('READY');await h.content('PAGE_DONE',{count:0,hasNext:true});
  }
  assert.equal(h.data.job.phase,'keyword-wait');assert.equal(h.data.job.page,3);
  assert(h.data.job.nextActionAt-Date.now()<=60000 && h.data.job.nextActionAt-Date.now()>=59000);
});
test('one-page runs never navigate to page two and invalid settings do not start a job',async()=>{
  const h=harness();
  assert.equal((await h.send({type:'START',keywords:['사료'],settings:{actionMin:1}})).ok,false);assert.equal(h.data.job,undefined);
  await h.send({type:'START',keywords:['사료'],settings:{maxPages:1}});await h.content('READY');await h.content('PAGE_DONE',{count:0,hasNext:true});
  assert.equal(h.data.job.page,1);assert.equal(h.data.job.status,'completed');
});
