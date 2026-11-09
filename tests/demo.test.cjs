const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const core=require('../extension/core');
const {createDemo,stateAt}=require('../extension/demo-model');
test('demo covers scroll, two pages, keyword waits and completion with synthetic items',()=>{
  const model=createDemo();assert.equal(stateAt(model,0).job,null);
  for(const keyword of model.keywords){
    assert.deepEqual([...new Set(model.products.filter(v=>v.keyword===keyword).map(v=>v.page))],[1,2]);
    assert(model.steps.some(v=>v.keywordIndex===model.keywords.indexOf(keyword)&&v.scrolls>0));
  }
  assert(model.steps.some(v=>v.phase==='keyword-wait' && v.waitSeconds>=180 && v.waitSeconds<=600));
  const final=stateAt(model,model.steps.length-1);assert.equal(final.job.status,'completed');assert.equal(final.items.length,24);
  assert(final.items.every(v=>v.productId.startsWith('demo-') && v.productUrl==='' && v.imageUrl==='demo-product.svg'));
  assert(final.items.every(v=>v.couponPrice==null || v.couponPrice<v.price));
});
test('demo paused and stopped states are distinct and wait values stay within real ranges',()=>{
  const model=createDemo(['사료']);
  assert.equal(stateAt(model,2,'paused').job.status,'paused');assert.equal(stateAt(model,2,'stopped').job.status,'stopped');
  const waiting=model.steps.findIndex(v=>v.waitSeconds);
  assert.equal(stateAt(model,waiting,'running',17).demoRemainingSeconds,17);
  assert(model.steps.filter(v=>v.waitSeconds).every(v=>v.waitSeconds>=10 && v.waitSeconds<=70));
});
test('demo reflects selected settings in pages, waiting and scroll steps',()=>{
  const model=createDemo(['사료','간식'],{maxPages:1,scrollPercent:100,actionMin:5,actionMax:5,keywordMin:1200,keywordMax:1200});
  assert.equal(model.products.length,12);assert(model.products.every(v=>v.page===1));assert(!model.steps.some(v=>v.stage==='다음 페이지로 이동'));
  assert(model.steps.some(v=>v.waitSeconds===5));assert(model.steps.some(v=>v.waitSeconds===1200));assert(model.steps.some(v=>v.message.includes('100%')));
  assert.equal(stateAt(model,2).job.settings.maxPages,1);
});
function dashboardHarness(protocol='chrome-extension:',demo=true){
  const html=fs.readFileSync(path.join(__dirname,'../extension/dashboard.html'),'utf8');
  const {window}=parseHTML(html), document=window.document;
  const listeners={},messages=[],apiCalls=[];
  const parent={postMessage:value=>messages.push(value)};
  const origin=protocol==='chrome-extension:'?'chrome-extension://test-extension':'http://localhost:8765';
  const location={protocol,origin,href:origin+'/dashboard.html'+(demo?'?demo=1':''),search:demo?'?demo=1':''};
  const chrome={runtime:{id:'test-extension',async sendMessage(message){apiCalls.push(message);return {ok:true,job:null,items:[]};}},storage:{local:{async get(){apiCalls.push('storage.get');return {};},async set(){apiCalls.push('storage.set');}},onChanged:{addListener(){}}}};
  const ctx=vm.createContext({document,window:{parent,addEventListener:(name,fn)=>listeners[name]=fn},location,chrome,NSC:core,URL,URLSearchParams,Blob,console,setInterval(){},setTimeout(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/dashboard.js'),'utf8'),ctx);
  return {document,parent,listeners,messages,apiCalls,location};
}
test('demo cannot touch Chrome runtime or storage even inside an installed extension',()=>{
  const h=dashboardHarness();assert.equal(h.apiCalls.length,0);
  assert(h.document.body.classList.contains('demo-mode'));assert(h.messages.some(v=>v.type==='NSC_DEMO_READY'));
  assert.equal(h.document.getElementById('start').textContent,'데모 재생');
  const model=createDemo();
  h.listeners.message({source:h.parent,origin:h.location.origin,data:{type:'NSC_DEMO_STATE',state:stateAt(model,4)}});
  assert.equal(h.document.getElementById('result-count').textContent,'6개');
  assert.equal(h.document.querySelectorAll('#rows tr').length,6);assert.equal(h.apiCalls.length,0);
  assert(h.document.getElementById('csv').disabled);assert(h.document.getElementById('json').disabled);
  const before=h.document.getElementById('result-count').textContent;
  h.listeners.message({source:{},origin:h.location.origin,data:{type:'NSC_DEMO_STATE',state:stateAt(model,0)}});
  assert.equal(h.document.getElementById('result-count').textContent,before);
});
test('regular local preview remains read-only and does not access extension storage',()=>{
  const h=dashboardHarness('http:',false);
  assert(h.document.getElementById('start').disabled);assert.equal(h.apiCalls.length,0);
});
