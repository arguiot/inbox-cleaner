import {cloudflareTarget} from './cloudflare-target.mjs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,db=process.env.CLOUDFLARE_D1_DATABASE_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const target=cloudflareTarget();
if(!token||!db||account!==target.accountId||!target.freePlanVerified)
  throw Error('Verified configured Cloudflare credentials required');
async function api(path,options={},allowMissing=false){
  const r=await fetch(`https://api.cloudflare.com/client/v4${path}`,{...options,
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
  const j=await r.json();if(r.status===404&&allowMissing)return null;
  if(!r.ok||!j.success)throw Error(`Cloudflare scheduler API ${r.status}`);return j.result;
}
const user=await api('/user');if(user.email?.toLowerCase()!==target.email)throw Error('Cloudflare identity mismatch');
const result=await api(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',body:JSON.stringify({sql:
  "SELECT value FROM settings WHERE key='mode'; SELECT owner,expires FROM scheduler WHERE id=1;"})});
if(result[0].results[0]?.value!=='trash'){console.log('Scheduled cleanup is disabled.');process.exit(0);}
const active=result[1].results[0];
if(active){
  const instance=await api(`/accounts/${account}/workflows/inbox-cleaner-scheduler/instances/${encodeURIComponent(active.owner)}`,{},true);
  if(instance?.status==='paused'){console.log('Durable scheduler is paused; no new instance started.');process.exit(0);}
  if(!instance&&active.expires>Date.now()){
    console.log('Scheduler handoff pending; waiting for lease expiry.');process.exit(0);
  }
  if(active.expires>Date.now()&&['running','waiting','queued'].includes(instance?.status)){
    console.log('Durable scheduler is healthy; no new instance needed.');process.exit(0);
  }
  if(!instance||['errored','terminated','complete'].includes(instance.status))
    await api(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',body:JSON.stringify({sql:'DELETE FROM scheduler WHERE id=1 AND owner=?',params:[active.owner]})});
}
const id=`recovery-${crypto.randomUUID()}`;
await api(`/accounts/${account}/workflows/inbox-cleaner-scheduler/instances`,{method:'POST',body:JSON.stringify({instance_id:id})});
for(let attempt=0;attempt<10;attempt++){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const instance=await api(`/accounts/${account}/workflows/inbox-cleaner-scheduler/instances/${id}`);
  if(['errored','terminated','complete'].includes(instance.status))throw Error(`Durable scheduler startup ${instance.status}`);
  const state=await api(`/accounts/${account}/d1/database/${db}/query`,{method:'POST',body:JSON.stringify({sql:'SELECT owner,expires FROM scheduler WHERE id=1'})});
  const lease=state[0].results[0];
  if(lease?.owner===id&&lease.expires>Date.now()){
    console.log(`Verified configured Cloudflare durable scheduler: ${id}`);process.exit(0);
  }
}
throw Error('Durable scheduler did not establish a heartbeat');
