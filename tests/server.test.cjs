const {test} = require('node:test');
const assert = require('node:assert/strict');
const server = require('../extension/server');
const config = {serverUrl:'https://collector.example',token:'t'.repeat(40)};
const response = body => ({ok:true,status:200,json:async()=>body});

test('accepts HTTPS origins and loopback HTTP, normalizes the API base',()=>{
  assert.equal(server.normalizeUrl(' https://collector.example/api/naver-collector/v1/ '),config.serverUrl);
  assert.equal(server.normalizeUrl('http://127.0.0.1:8787/'),'http://127.0.0.1:8787');
  assert.equal(server.normalizeUrl('http://localhost:8787'),'http://localhost:8787');
  for(const url of ['http://external.example','file:///tmp/x','https://name:secret@collector.example','https://collector.example?token=x','https://collector.example/#x','https://collector.example/wrong','']) assert.throws(()=>server.normalizeUrl(url));
});
test('a blank token only preserves credentials for the same saved origin',()=>{
  assert.deepEqual(server.connection({serverUrl:config.serverUrl,token:''},config),config);
  assert.throws(()=>server.connection({serverUrl:'https://other.example',token:''},config));
  for(const token of ['short','x'.repeat(257),'Bearer '+config.token,'x'.repeat(39)+'!']) assert.throws(()=>server.connection({...config,token}));
  assert.deepEqual(server.publicConfig(config),{serverUrl:config.serverUrl,hasToken:true});
  assert.equal(JSON.stringify(server.publicConfig(config)).includes(config.token),false);
});
test('connection check is a read-only authenticated request with no redirects or cookies',async()=>{
  const requests=[];
  const result=await server.check(config,async(url,options)=>{requests.push({url,options});return response({ok:true,data:{tasks:[]}});});
  assert.equal(result.connected,true);
  assert.equal(requests.length,1);assert.equal(requests[0].url,config.serverUrl+'/api/naver-collector/v1/tasks?limit=1');
  assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.headers.Authorization,'Bearer '+config.token);
  assert.equal(requests[0].options.redirect,'error');assert.equal(requests[0].options.credentials,'omit');
});
test('HTTP errors are translated without echoing server-supplied credential text',async()=>{
  for(const [status,message] of [[401,/인증 실패/],[403,/확장 ID/],[404,/주소/],[426,/HTTPS/],[503,/DB 연결/]]){
    await assert.rejects(server.check(config,async()=>({ok:false,status,json:async()=>({error:config.token})})),error=>message.test(error.message)&&!error.message.includes(config.token));
  }
});
test('HTML, invalid API payloads and network errors are safe and distinguishable',async()=>{
  await assert.rejects(server.check(config,async()=>({...response(null),json:async()=>{throw Error(config.token);}})),/JSON 응답/);
  await assert.rejects(server.check(config,async()=>response({ok:true,data:{}})),/응답 형식/);
  await assert.rejects(server.check(config,async()=>{throw Error(config.token);}),error=>/네트워크/.test(error.message)&&!error.message.includes(config.token));
});
test('slow connections are aborted and do not retain a timer',async()=>{
  await assert.rejects(server.check(config,async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))),10),/시간이 초과/);
});
