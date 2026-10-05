import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Store} from '../src/store.mjs';
import {run} from '../src/engine.mjs';
import {CLEF_MODEL} from '../src/classifier.mjs';

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_state.sql',import.meta.url),'utf8'));
  return {prepare(sql){
    return {bind(...args){
      assert.ok(args.length<=100,'D1 bound parameter limit');
      const statement=sqlite.prepare(sql);
      return {async run(){return {meta:{changes:Number(statement.run(...args).changes)}};},
        async first(){return statement.get(...args)??null;}, async all(){return {results:statement.all(...args)};}};
    }};
  },sqlite};
}
test('run lease excludes concurrent runs and cannot be released by another owner',async()=>{
  const store=new Store(database());
  assert.equal(await store.lease('first',100),true);
  assert.equal(await store.lease('second',101),false);
  await store.release('second');
  assert.equal(await store.lease('second',102),false);
  await store.release('first');
  assert.equal(await store.lease('second',103),true);
});
test('daily budget stops exactly at the shared limit and resets on a new day',async()=>{
  const store=new Store(database());
  assert.equal(await store.reserve('2026-10-05',2),true);
  assert.equal(await store.reserve('2026-10-05',2),true);
  assert.equal(await store.reserve('2026-10-05',2),false);
  assert.equal(await store.reserve('2026-10-06',2),true);
});
test('message cache and pagination stay isolated between Gmail accounts',async()=>{
  const store=new Store(database());
  await store.record('personal','same-id',{action:'delete',category:'marketing'},'preview',100);
  assert.equal((await store.seen('personal',['same-id'])).get('same-id').status,'preview');
  assert.equal((await store.seen('work',['same-id'])).size,0);
  await store.setCursor('personal','page2');
  assert.equal(await store.cursor('personal'),'page2');
  assert.equal(await store.cursor('work'),undefined);
});
test('a full Gmail page fits D1 parameter limits without dropping cached IDs',async()=>{
  const store=new Store(database()), ids=Array.from({length:100},(_,i)=>`mail-${i}`);
  for (const id of ids) await store.record('personal',id,{action:'keep',category:'important'},'preview',100);
  assert.equal((await store.seen('personal',ids)).size,100);
  assert.equal((await store.seen('work',ids)).size,0);
  assert.equal((await store.seen('personal',[])).size,0);
});
test('entire scheduled preview runs through OAuth, account verification, Gmail reads, AI, and SQLite without writes',async()=>{
  const db=database(), writes=[];
  const mail={id:'a',threadId:'t',labelIds:['INBOX'],payload:{headers:[]},snippet:'Sale'};
  let inferenceCalls=0;
  const fetcher=async(url,options={})=>{
    if (url.endsWith('/token')) return Response.json({access_token:'token'});
    if (url.endsWith('/profile')) return Response.json({emailAddress:'arguiot@gmail.com'});
    if (url.includes('/messages?')) return Response.json({messages:[{id:'a'}]});
    if (url.includes('/messages/a?')) return Response.json(mail);
    writes.push({url,options});throw new Error('Unexpected Gmail write');
  };
  const env={DB:db,GMAIL_ACCOUNTS_JSON:JSON.stringify([{email:'arguiot@gmail.com',refreshToken:'refresh'}]),
    GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',MODE:'preview',AI_MODEL:CLEF_MODEL,
    AI:{run:async(model,input)=>{inferenceCalls++;assert.equal(model,CLEF_MODEL);assert.equal(input.model,'clef-flash');
      return {answers:{relevance:{type:'choice',choice:'unwanted',probabilities:{unwanted:0.95,wanted:0.05}}}};}}};
  const report=await run(env,{fetcher});
  assert.equal(report.accounts[0].flagged,1);assert.equal(report.accounts[0].deleted,0);assert.equal(writes.length,0);
  assert.equal(inferenceCalls,1);
  const second=await run(env,{fetcher});
  assert.equal(second.accounts[0].scanned,0);assert.equal(inferenceCalls,1);
});
test('scheduled run rejects a token for the wrong Gmail account before reading messages',async()=>{
  const db=database();let reads=0;
  const fetcher=async url=>{
    if (url.endsWith('/token')) return Response.json({access_token:'token'});
    if (url.endsWith('/profile')) return Response.json({emailAddress:'wrong@example.test'});
    reads++;throw new Error('must not read');
  };
  const env={DB:db,GMAIL_ACCOUNTS_JSON:JSON.stringify([{email:'arguiot@gmail.com',refreshToken:'refresh'}]),GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'};
  await assert.rejects(run(env,{fetcher}),/identity mismatch/);assert.equal(reads,0);
});
