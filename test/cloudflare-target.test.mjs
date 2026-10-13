import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cloudflareTarget} from '../scripts/cloudflare-target.mjs';

test('deployment target requires a verified account and explicit owner identity',()=>{
  const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EXPECTED_EMAIL:'OWNER@example.test',CLOUDFLARE_FREE_PLAN_VERIFIED:'true'};
  assert.equal(cloudflareTarget(env).email,'owner@example.test');
  for(const key of Object.keys(env))assert.throws(()=>cloudflareTarget({...env,[key]:''},'/missing-target'),/Configure a verified/);
  assert.throws(()=>cloudflareTarget({...env,CLOUDFLARE_ACCOUNT_ID:'invalid'}),/Configure a verified/);
});
test('global account credentials cannot override a pinned local deployment target',()=>{
  const dir=mkdtempSync(join(tmpdir(),'inbox-target-'));
  try{
    const path=join(dir,'target.json');
    writeFileSync(path,JSON.stringify({accountId:'b'.repeat(32),email:'owner@example.test',freePlanVerified:true}));
    const target=cloudflareTarget({CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)},path);
    assert.equal(target.accountId,'b'.repeat(32));
  }finally{rmSync(dir,{recursive:true});}
});
