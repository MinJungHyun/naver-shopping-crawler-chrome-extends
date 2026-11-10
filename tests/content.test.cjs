const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../extension/core');
async function simulate({page=2,maxPages=3,cancel=false,visibility='visible',seed=null}={}){
  let now=0;const messages=[],scrolls=[],moves=[];
  const settings=core.normalizeSettings({maxPages,scrollPercent:50,actionMin:5,actionMax:5});
  const job={keywords:['사료'],keywordIndex:0,page,settings,token:'test'};
  class Clock extends Date{static now(){return now;}}
  class FakeMouseEvent{constructor(type,init={}){Object.assign(this,{type,...init});}}
  class FakePointerEvent extends FakeMouseEvent{}
  const window={innerWidth:1200,innerHeight:800,scrollY:0,scrollBy({top}){scrolls.push({at:now,top});this.scrollY=Math.max(0,Math.min(1200,this.scrollY+top));}};
  const target={dispatchEvent(event){moves.push({type:event.type,x:event.clientX,y:event.clientY,at:now});return true;}};
  const document={visibilityState:visibility,body:{innerText:'정상 상품'},documentElement:{scrollHeight:1200},querySelectorAll(){return [{textContent:String(page+1)}];},elementFromPoint(){return target;}};
  const chrome={runtime:{async sendMessage(message){messages.push({...message,at:now});if(message.type==='READY')return {ok:true,active:true,job};return {ok:true,active:!(cancel&&message.type==='HEARTBEAT')};}}};
  const extractor={pageIssue:()=>'',extractProducts:(doc,context)=>[{...context,productId:'1',productName:'예시'}]};
  const ctx=vm.createContext({chrome,window,document,location:{href:core.searchUrl('사료',page)},NSC:core,NSCExtractor:extractor,Date:Clock,MouseEvent:FakeMouseEvent,PointerEvent:FakePointerEvent,setTimeout(fn,ms){now+=ms;queueMicrotask(fn);}});
  if(seed!=null)vm.runInContext(`Math.random = () => ${seed}`,ctx);
  await vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'),ctx);
  const bursts=[];for(const s of scrolls){if(!bursts.length||s.at-bursts.at(-1).last>2000)bursts.push({net:0,count:0,first:s.at,last:s.at,flicks:0});const b=bursts.at(-1);b.net+=s.top;b.count++;b.last=s.at;}
  // A flick is a run of animation frames; frames are ~16ms apart, flicks 200ms+.
  for(const burst of bursts){const own=scrolls.filter(s=>s.at>=burst.first&&s.at<=burst.last);burst.flicks=1+own.slice(1).filter((s,i)=>s.at-own[i].at>100).length;}
  return {messages,scrolls,moves,bursts};
}
test('content scrolls like a person: uneven flicks that still cover the selected distance',async()=>{
  const {messages,scrolls,bursts}=await simulate();
  assert(scrolls.length>0);assert(scrolls[0].at>=5000);
  assert(bursts.length>=2);
  for(const burst of bursts){assert(Math.abs(burst.net-400)<=3);assert(burst.flicks>=2&&burst.flicks<=5);}
  const waits=messages.filter(v=>v.type==='PROGRESS'&&v.nextActionAt);assert(waits.every(v=>v.nextActionAt-v.at===5000));
  assert(waits.some(v=>v.message.startsWith('3페이지 이동 전')));
  assert.equal(messages.at(-1).type,'PAGE_DONE');assert.equal(messages.at(-1).hasNext,true);
});
test('sometimes glances back up, but never loses ground overall',async()=>{
  const {scrolls,bursts}=await simulate({seed:0.05});
  assert(scrolls.some(v=>v.top<0));
  for(const burst of bursts)assert(Math.abs(burst.net-400)<=3);
  const {scrolls:calm,bursts:calmBursts}=await simulate({seed:0.95});
  assert(calm.every(v=>v.top>0));
  for(const burst of calmBursts)assert(Math.abs(burst.net-400)<=3);
  assert.notEqual(calmBursts[0].flicks,bursts[0].flicks);
});
test('a hidden tab scrolls in instant flicks instead of animating',async()=>{
  const {bursts,moves}=await simulate({visibility:'hidden'});
  assert(bursts.length>=2);
  for(const burst of bursts){assert(Math.abs(burst.net-400)<=3);assert.equal(burst.count,burst.flicks);assert(burst.flicks>=2&&burst.flicks<=5);}
  assert.equal(moves.length,0);
});
test('pointer drifts like a hand inside the page, away from the layer',async()=>{
  const {moves}=await simulate();
  assert(moves.length>0);
  assert(moves.some(v=>v.type==='mousemove'));assert(moves.some(v=>v.type==='pointermove'));
  for(const move of moves){assert(move.x>0&&move.x<900);assert(move.y>0&&move.y<800);}
  const steps=moves.filter(v=>v.type==='mousemove');
  const gaps=[];for(let i=1;i<steps.length;i++)gaps.push(steps[i].at-steps[i-1].at);
  assert(gaps.filter(gap=>gap<2000).every(gap=>gap>=28));
  const xs=new Set(steps.map(v=>v.x));assert(xs.size>3);
});
test('final configured page skips the page-navigation delay',async()=>{
  const {messages}=await simulate({page:3,maxPages:3});
  assert(!messages.some(v=>v.type==='PROGRESS'&&v.message.startsWith('4페이지 이동 전')));
  assert.equal(messages.at(-1).type,'PAGE_DONE');
});
test('pause during a short wait prevents subsequent scrolling',async()=>{
  const {messages,scrolls}=await simulate({cancel:true});assert.equal(scrolls.length,0);assert(!messages.some(v=>v.type==='PAGE_DONE'));
});
