const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {parseHTML} = require('linkedom');
const server = require('../extension/server');
const html=fs.readFileSync(path.join(__dirname,'../extension/dashboard.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../extension/server-settings.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({extensionMode=true,demoMode=false,initial=null,granted=true,checkError=null}={}){
  const {document,Event}=parseHTML(html).window, calls=[],permissions=[];
  let stored=initial;
  const $=id=>document.getElementById(id);
  const request=async(type,data={})=>{
    calls.push({type,...data});
    if(type==='GET_SERVER_CONFIG')return {server:server.publicConfig(stored)};
    if(type==='SAVE_SERVER_CONFIG'){stored=server.connection(data,stored||{});return {server:server.publicConfig(stored)};}
    if(type==='TEST_SERVER_CONNECTION'){if(checkError)throw Error(checkError);return {connected:true};}
    if(type==='CLEAR_SERVER_CONFIG'){stored=null;return {server:server.publicConfig(null)};}
    if(type==='SERVER_START'||type==='RETRY_SERVER_UPLOAD')return {};
  };
  const chrome={windows:{getCurrent:async()=>({id:1})},runtime:{id:'a'.repeat(32)},permissions:{request(value){permissions.push(value);return Promise.resolve(granted);}}};
  vm.runInNewContext(script,{document,extensionMode,demoMode,NSCServer:server,chrome,request,readSettings:()=>({maxPages:1})});
  const submit=()=>{$('server-form').dispatchEvent(new Event('submit',{cancelable:true}));return tick();};
  return {$,Event,calls,permissions,submit,getStored:()=>stored};
}
test('saved secrets are never rendered and mask toggle only reveals newly entered text',async()=>{
  const h=harness({initial:{serverUrl:'https://collector.example',token:'a'.repeat(40)}});await tick();
  assert.equal(h.$('server-url').value,'https://collector.example');assert.equal(h.$('server-token').value,'');
  assert.match(h.$('server-token').placeholder,/저장된 토큰/);
  assert.equal(h.$('server-token').type,'password');
  h.$('server-token-toggle').click();assert.equal(h.$('server-token').type,'text');
  h.$('server-token-toggle').click();assert.equal(h.$('server-token').type,'password');
  assert.equal(h.$('server-extension-id').hidden,false);
});
test('saving and checking uses the selected origin permission and clears the typed token',async()=>{
  const h=harness();await tick();
  h.$('server-url').value='https://collector.example/';h.$('server-token').value='a'.repeat(40);
  await h.submit();
  assert.equal(h.permissions[0].origins[0],'https://collector.example/*');
  assert.deepEqual(h.calls.map(x=>x.type),['GET_SERVER_CONFIG','SAVE_SERVER_CONFIG','TEST_SERVER_CONNECTION']);
  assert.equal(h.$('server-token').value,'');assert.equal(h.$('server-badge').textContent,'연결됨');
  assert.match(h.$('server-status').textContent,/연결 확인 완료/);assert.equal(h.$('server-connect').disabled,false);
});
test('permission refusal and invalid tokens never persist credentials',async()=>{
  const h=harness({granted:false});await tick();
  h.$('server-url').value='https://collector.example';h.$('server-token').value='a'.repeat(40);
  await h.submit();assert.equal(h.getStored(),null);assert.match(h.$('server-status').textContent,/접근을 허용/);
  h.$('server-token').value='short';await h.submit();
  assert.equal(h.permissions.length,1);assert.equal(h.calls.length,1);
});
test('missing credentials and a changed origin require a token before prompting for permissions',async()=>{
  const h=harness({initial:{serverUrl:'https://one.example',token:'a'.repeat(40)}});await tick();
  h.$('server-url').value='https://two.example';await h.submit();
  assert.equal(h.permissions.length,0);assert.match(h.$('server-status').textContent,/토큰을 다시/);
  assert.equal(h.getStored().serverUrl,'https://one.example');
});
test('authentication failures preserve saved settings for correction and deletion removes them',async()=>{
  const h=harness({checkError:'인증 실패 · 토큰을 확인하세요.'});await tick();
  h.$('server-url').value='https://collector.example';h.$('server-token').value='a'.repeat(40);
  await h.submit();assert.equal(h.$('server-status').dataset.error,'true');assert.equal(h.$('server-badge').textContent,'저장됨');
  assert.equal(h.$('server-token').value,'');assert(h.getStored());
  h.$('server-clear').click();await tick();assert.equal(h.getStored(),null);assert.equal(h.$('server-url').value,'');
});
test('HTTP preview and demo do not read storage, save, or contact the server',async()=>{
  const preview=harness({extensionMode:false});await tick();
  assert.equal(preview.$('server-connect').disabled,true);assert.equal(preview.$('server-clear').disabled,true);
  await preview.submit();assert.equal(preview.calls.length,0);assert.equal(preview.permissions.length,0);
  const demo=harness({extensionMode:false,demoMode:true});await tick();
  assert.equal(demo.$('server-panel').hidden,true);assert.equal(demo.calls.length,0);
});

test('saved token login can start server collection without email or OAuth settings',async()=>{
  const h=harness({initial:{serverUrl:'http://localhost:8080',token:'s'.repeat(40)}});await tick();
  h.$('server-start').click();await tick();
  assert.equal(h.calls.find(c=>c.type==='SERVER_START').windowId,1);
  assert.equal(h.$('server-start').disabled,false);
});
