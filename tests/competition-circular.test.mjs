import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const code=buildSync({entryPoints:['functions/api/competition-circular.ts'],bundle:true,platform:'node',format:'esm',write:false}).outputFiles[0].text;
const {onRequestPost}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const fixture={tests:[{name:'600 m · Sub 16',categories:['Sub 16'],sex:'all',minYear:2011,maxYear:2012,notes:'',evidence:'p. 1: Sub 16, 600 m, 2011–2012'}],warnings:[]};
async function run({role='coach',auth=200,payload=fixture,stop='end_turn',data='JVBERi0xLjQ=',key=true}={}) {
 const before=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,init={})=>{calls.push({url,init});if(url.endsWith('/user'))return Response.json({id:'coach'},{status:auth});if(url.includes('/profiles?'))return Response.json([{role}]);if(url.includes('/models?'))return Response.json({data:[{id:'claude-sonnet-4-6'}]});if(url.endsWith('/messages'))return Response.json({stop_reason:stop,content:[{type:'text',text:JSON.stringify(payload)}]});throw Error('unexpected');};
 try {const response=await onRequestPost({env:{SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',ANTHROPIC_API_KEY:key?'test':undefined},request:new Request('https://club.invalid/api/competition-circular',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({data})})});return {status:response.status,body:await response.json(),calls};}finally{globalThis.fetch=before;}
}
test('only authenticated staff may trigger PDF analysis; no writes or athlete data reads',async()=>{
 for(const opts of [{auth:401},{role:'family'},{role:'administrative_viewer'},{key:false}]){const r=await run(opts);assert.ok(r.status>=400);assert.ok(!r.calls.some(c=>c.url.includes('anthropic.com')));}
 const r=await run();assert.equal(r.status,200);assert.deepEqual(r.body,fixture);assert.equal(r.calls.filter(c=>c.init.method==='POST').length,1);assert.ok(!r.calls.some(c=>c.url.includes('athletes')));
});
test('ambiguous, unsupported, reversed-year, duplicate and truncated outputs cannot become an unrestricted test',async()=>{
 for(const payload of [{...fixture,tests:[{...fixture.tests[0],categories:[]}]},{...fixture,tests:[{...fixture.tests[0],categories:['Sub 6']}]},{...fixture,tests:[{...fixture.tests[0],minYear:2020,maxYear:2010}]},{...fixture,tests:[{...fixture.tests[0],evidence:''}]},{...fixture,tests:[fixture.tests[0],fixture.tests[0]]}])assert.equal((await run({payload})).status,422);
 assert.equal((await run({stop:'max_tokens'})).status,422);
 assert.equal((await run({data:'not a pdf'})).status,400);
});
