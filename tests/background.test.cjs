const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../extension/core');
function harness() {
  const data={}, alarms=new Map(), tabs=new Map(), events={}; let tabId=0, uuid=0;
  const event=name=>({addListener(fn){events[name]=fn;}});
  const chrome={
    storage:{local:{async get(keys){return structuredClone(data);},async set(value){Object.assign(data,structuredClone(value));}}},
    runtime:{id:'test-extension',getURL:file=>`chrome-extension://test-extension/${file}`,onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup')},
    action:{onClicked:event('action')},
    tabs:{async get(id){if(!tabs.has(id))throw Error('missing');return tabs.get(id);},async create(value){const tab={...value,id:++tabId};tabs.set(tab.id,tab);return tab;},async update(id,value){Object.assign(tabs.get(id),value);return tabs.get(id);},onRemoved:event('removed')},
    alarms:{async create(name,value){alarms.set(name,value);},async clear(name){return alarms.delete(name);},async get(name){return alarms.get(name);},onAlarm:event('alarm')}
  };
  const ctx=vm.createContext({chrome,NSC:core,importScripts(){},crypto:{randomUUID:()=>String(++uuid)},console,Date,URL,Promise});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),ctx);
  const dashboard={id:chrome.runtime.id,url:chrome.runtime.getURL('dashboard.html')};
  const send=(message,sender=dashboard)=>new Promise(resolve=>events.message(message,sender,resolve));
  const settle=()=>send({type:'GET'});
  const source=()=>({id:chrome.runtime.id,tab:{id:data.job.tabId,url:tabs.get(data.job.tabId).url},url:tabs.get(data.job.tabId).url,documentId:`doc-${data.job.keywordIndex}-${data.job.page}`});
  const content=async(type,extra={})=>send({type,token:data.job.token,...extra},source());
  return {data,alarms,tabs,events,send,source,content,settle};
}
test('collects pages 1 and 2, waits 3–10 minutes, then advances keyword',async()=>{
  const h=harness(); assert((await h.send({type:'START',keywords:['사료','간식']})).ok);
  assert.equal(new URL(h.tabs.get(1).url).searchParams.get('query'),'사료');
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
  h.data.job.lastHeartbeat=Date.now()-181000;h.events.alarm({name:'collector-watchdog'});await h.settle();assert.equal(h.data.job.status,'paused');
  assert.equal((await h.send({type:'CLEAR'},{id:'evil',url:'https://example.com'})).ok,false);
  assert.equal((await h.send({type:'CLEAR'})).ok,false);
  await h.send({type:'STOP'});await h.send({type:'CLEAR'});assert.equal(h.data.job,null);
});
test('existing results are never silently overwritten by a new start',async()=>{
  const h=harness();h.data.items=[{productName:'보관 중'}];
  assert.equal((await h.send({type:'START',keywords:['사료']})).ok,false);assert.equal(h.data.items.length,1);
});
