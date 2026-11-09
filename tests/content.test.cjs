const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../extension/core');
async function simulate({page=2,maxPages=3,cancel=false}={}){
  let now=0;const messages=[],scrolls=[];
  const settings=core.normalizeSettings({maxPages,scrollPercent:50,actionMin:5,actionMax:5});
  const job={keywords:['사료'],keywordIndex:0,page,settings,token:'test'};
  class Clock extends Date{static now(){return now;}}
  const window={innerHeight:800,scrollY:0,scrollBy({top}){scrolls.push({at:now,top});this.scrollY=Math.min(400,this.scrollY+top);}};
  const document={body:{innerText:'정상 상품'},documentElement:{scrollHeight:1200},querySelectorAll(){return [{textContent:String(page+1)}];}};
  const chrome={runtime:{async sendMessage(message){messages.push({...message,at:now});if(message.type==='READY')return {ok:true,active:true,job};return {ok:true,active:!(cancel&&message.type==='HEARTBEAT')};}}};
  const extractor={pageIssue:()=>'',extractProducts:(doc,context)=>[{...context,productId:'1',productName:'예시'}]};
  const ctx=vm.createContext({chrome,window,document,location:{href:core.searchUrl('사료',page)},NSC:core,NSCExtractor:extractor,Date:Clock,setTimeout(fn,ms){now+=ms;queueMicrotask(fn);}});
  await vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'),ctx);
  return {messages,scrolls};
}
test('content applies selected scroll distance, 5-second waits and next-page detection',async()=>{
  const {messages,scrolls}=await simulate();
  assert(scrolls.length>0);assert(scrolls.every(v=>v.top===400));assert(scrolls[0].at>=5000);
  const waits=messages.filter(v=>v.type==='PROGRESS'&&v.nextActionAt);assert(waits.every(v=>v.nextActionAt-v.at===5000));
  assert(waits.some(v=>v.message.startsWith('3페이지 이동 전')));
  assert.equal(messages.at(-1).type,'PAGE_DONE');assert.equal(messages.at(-1).hasNext,true);
});
test('final configured page skips the page-navigation delay',async()=>{
  const {messages}=await simulate({page:3,maxPages:3});
  assert(!messages.some(v=>v.type==='PROGRESS'&&v.message.startsWith('4페이지 이동 전')));
  assert.equal(messages.at(-1).type,'PAGE_DONE');
});
test('pause during a short wait prevents subsequent scrolling',async()=>{
  const {messages,scrolls}=await simulate({cancel:true});assert.equal(scrolls.length,0);assert(!messages.some(v=>v.type==='PAGE_DONE'));
});
