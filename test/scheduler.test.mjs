import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {SchedulerState} from '../src/scheduler-state.mjs';
import {durableSchedule} from '../src/durable-schedule.mjs';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0002_scheduler.sql',import.meta.url),'utf8'));
  sqlite.exec("UPDATE settings SET value='delete' WHERE key='mode'");
  const db={prepare(sql){
    const s=sqlite.prepare(sql);
    return {
      bind(...args){return {async run(){return {meta:{changes:Number(s.run(...args).changes)}};}};},
      async first(){return s.get()??null;},
    };
  }};
  const sleeps=[],successors=[],results=[];
  const env={DB:db,MODE:'delete',CLEANER_WORKFLOW:{async create(o){successors.push(o.id);}}};
  const step={async do(name,options,fn){assert.equal(options.retries.limit,0);const result=await fn();results.push(result);return result;},async sleep(name,duration){sleeps.push(duration);}};
  return {sqlite,db,env,step,sleeps,successors,results};
}
test('one batch hands off a fresh instance, persisting only counts in three steps',async()=>{
  const f=fixture();let runs=0;
  const process=async()=>{runs++;return {mode:'delete',accounts:[{scanned:3,flagged:2,deleted:2,account:'private'}]};};
  assert.equal((await durableSchedule(f.env,{instanceId:'initial'},f.step,{process})).status,'renewed');
  assert.equal(runs,1);assert.deepEqual(f.sleeps,['2 minutes']);assert.equal(f.successors.length,1);
  assert.deepEqual(f.results[0],{mode:'delete',scanned:3,flagged:2,deleted:2});
  assert.equal(f.results.length+f.sleeps.length,3);
  assert.equal(f.sqlite.prepare('SELECT owner FROM scheduler').get().owner,f.successors[0]);
});
test('a duplicate durable instance cannot start a parallel scheduler',async()=>{
  const f=fixture();await new SchedulerState(f.db).claim('running');
  const result=await durableSchedule(f.env,{instanceId:'duplicate'},f.step,{process:()=>{throw Error('must not run');}});
  assert.equal(result.status,'already running');assert.equal(f.sleeps.length,0);assert.equal(f.successors.length,0);
});
test('database pause stops an already running workflow before renewal',async()=>{
  const f=fixture();let runs=0;
  const result=await durableSchedule(f.env,{instanceId:'running'},f.step,{process:async()=>{
    runs++;f.sqlite.exec("UPDATE settings SET value='preview' WHERE key='mode'");return {mode:'delete',accounts:[]};
  }});
  assert.equal(result.status,'stopped');assert.equal(runs,1);assert.equal(f.successors.length,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM scheduler').get().n,0);
});
test('an expired scheduler can recover and the superseded owner cannot refresh it',async()=>{
  const f=fixture(),s=new SchedulerState(f.db);
  assert.equal(await s.claim('old',100),true);assert.equal(await s.claim('new',101),false);
  assert.equal(await s.claim('new',300101),true);assert.equal(await s.refresh('old',300102),false);
});
test('each successor gets a fresh bounded request budget over more than an hour',async()=>{
  const f=fixture();let owner='first',calls=0;
  const fetcher=async()=>{calls++;return new Response('{}');};
  const process=async(env,{fetcher})=>{
    for(let i=0;i<40;i++)await fetcher('https://example.test');
    assert.throws(()=>fetcher('https://example.test'),/request budget/);
    return {mode:'delete',accounts:[]};
  };
  for(let cycle=0;cycle<32;cycle++){
    assert.equal((await durableSchedule(f.env,{instanceId:owner},f.step,{process,fetcher})).status,'renewed');
    owner=f.successors.at(-1);
  }
  assert.equal(calls,1280);assert.equal(f.successors.length,32);
});
test('exhausting the fetch budget still renews instead of killing the scheduler',async()=>{
  const f=fixture();let calls=0;
  const process=async(env,{fetcher})=>{for(let i=0;i<41;i++)await fetcher('https://example.test');};
  assert.equal((await durableSchedule(f.env,{instanceId:'initial'},f.step,{process,fetcher:async()=>{calls++;}})).status,'renewed');
  assert.equal(calls,40);assert.deepEqual(f.results[0],{deferred:true});assert.equal(f.successors.length,1);
});
test('handoff can be replayed after the state update, without stealing a later owner',async()=>{
  const f=fixture(),s=new SchedulerState(f.db);await s.claim('initial');
  assert.equal(await s.handoff('initial','next'),true);
  assert.equal(await s.handoff('initial','next'),true);
  assert.equal(await s.handoff('next','later'),true);
  assert.equal(await s.handoff('initial','next'),false);
});
function watchdog(expired){
  const target=JSON.parse(readFileSync(new URL('../cloudflare-target.json',import.meta.url),'utf8'));
  const script=new URL('../scripts/scheduler.mjs',import.meta.url).href;
  const code=`
    let cleared=false,created;
    globalThis.setTimeout=fn=>{queueMicrotask(fn);return 0;};
    globalThis.fetch=async(url,options={})=>{
      let result;
      if(url.endsWith('/user'))result={email:'arguiot@gmail.com'};
      else if(url.endsWith('/query')){
        const body=JSON.parse(options.body);
        if(body.sql.startsWith('SELECT value'))result=[{results:[{value:'delete'}]},{results:[{owner:'missing-successor',expires:Date.now()+${expired?-1000:300000}}]}];
        else if(body.sql.startsWith('DELETE')){cleared=true;result=[];}
        else result=[{results:[{owner:created,expires:Date.now()+300000}]}];
      }else if(url.endsWith('/instances')){
        if(!cleared)throw Error('Missing lease must be cleared first');
        created=JSON.parse(options.body).instance_id;result={id:created};
      }else if(url.endsWith('/missing-successor'))return Response.json({success:false},{status:404});
      else result={status:'running'};
      return Response.json({success:true,result});
    };
    await import(${JSON.stringify(script)});
  `;
  return execFileSync(process.execPath,['--input-type=module','--eval',code],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',env:{...process.env,
      CLOUDFLARE_ACCOUNT_ID:target.accountId,CLOUDFLARE_D1_DATABASE_ID:'test-db',CLOUDFLARE_API_TOKEN:'test-only'},
  });
}
test('watchdog recovers an expired lease pointing to an uncreated successor',()=>{
  assert.match(watchdog(true),/Verified personal Cloudflare durable scheduler/);
});
test('watchdog allows an in-progress handoff to finish instead of racing it',()=>{
  assert.match(watchdog(false),/handoff pending/);
});
