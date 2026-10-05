import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
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
  const sleeps=[],successors=[];
  const env={DB:db,MODE:'delete',CLEANER_WORKFLOW:{async create(o){successors.push(o.id);}}};
  const step={async do(name,options,fn){assert.equal(options.retries.limit,0);return fn();},async sleep(name,duration){sleeps.push(duration);}};
  return {sqlite,db,env,step,sleeps,successors};
}
test('durable timers run independently, preserve only counts, and hand off one successor',async()=>{
  const f=fixture();let runs=0;
  const process=async()=>{runs++;return {mode:'delete',accounts:[{scanned:3,flagged:2,deleted:2,account:'private'}]};};
  await durableSchedule(f.env,{instanceId:'initial'},f.step,{ticks:2,process});
  assert.equal(runs,2);assert.deepEqual(f.sleeps,['2 minutes','2 minutes']);assert.equal(f.successors.length,1);
  assert.equal(f.sqlite.prepare('SELECT owner FROM scheduler').get().owner,f.successors[0]);
});
test('a duplicate durable instance cannot start a parallel scheduler',async()=>{
  const f=fixture();await new SchedulerState(f.db).claim('running');
  const result=await durableSchedule(f.env,{instanceId:'duplicate'},f.step,{process:()=>{throw Error('must not run');}});
  assert.equal(result.status,'already running');assert.equal(f.sleeps.length,0);assert.equal(f.successors.length,0);
});
test('database pause stops an already running workflow and prevents renewal',async()=>{
  const f=fixture();let runs=0;
  await durableSchedule(f.env,{instanceId:'running'},f.step,{ticks:2,process:async()=>{
    runs++;f.sqlite.exec("UPDATE settings SET value='preview' WHERE key='mode'");return {mode:'delete',accounts:[]};
  }});
  assert.equal(runs,1);assert.equal(f.successors.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM scheduler').get().n,0);
});
test('an expired scheduler can recover and the superseded owner cannot refresh it',async()=>{
  const f=fixture(),s=new SchedulerState(f.db);
  assert.equal(await s.claim('old',100),true);assert.equal(await s.claim('new',101),false);
  assert.equal(await s.claim('new',300101),true);assert.equal(await s.refresh('old',300102),false);
});
