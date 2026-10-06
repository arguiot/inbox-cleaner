import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
if (!accountId || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Personal Cloudflare deployment credentials required');
const target=JSON.parse(await readFile('cloudflare-target.json','utf8'));
if (target.accountId!==accountId || target.freePlanVerified!==true || target.email!=='arguiot@gmail.com')
  throw new Error('Deployment target must be pinned after verifying the personal account and Free plan');
const response=await fetch('https://api.cloudflare.com/client/v4/user',{
  headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000),
});
const user=await response.json();
if (!response.ok || user.result?.email?.toLowerCase()!=='arguiot@gmail.com')
  throw new Error('Refusing deployment: token must identify the personal arguiot@gmail.com Cloudflare user');
const planResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/subscriptions`,{
  headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000),
});
const settings=await planResponse.json();
if (!planResponse.ok || !Array.isArray(settings.result) || settings.result_info?.total_count>settings.result.length)
  throw new Error('Cannot verify account subscriptions');
if (settings.result.some(subscription => {
  const plan=subscription.rate_plan;
  return /worker/i.test(`${plan?.id??''} ${plan?.public_name??''}`) && !/free/i.test(plan?.id??'');
})) throw new Error('Paid Workers subscription detected; refusing deployment');
// The selected account is pinned in a generated ignored config, never inferred from global Wrangler login.
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if (!['preview','trash'].includes(config.vars?.MODE)) throw new Error('Invalid cleaner mode');
config.account_id=accountId;
if (process.env.CLOUDFLARE_D1_DATABASE_ID) config.d1_databases=[{binding:'DB',database_name:'inbox-cleaner-state',
  database_id:process.env.CLOUDFLARE_D1_DATABASE_ID,migrations_dir:'migrations'}];
if (!config.d1_databases?.length) throw new Error('State database ID required');
await writeFile('.wrangler-deploy.json',JSON.stringify(config));
try {
  for (const args of [['d1','migrations','apply','inbox-cleaner-state','--remote','--config','.wrangler-deploy.json'],
    ['d1','execute','inbox-cleaner-state','--remote','--config','.wrangler-deploy.json','--command',
      `UPDATE settings SET value='${config.vars.MODE}' WHERE key='mode'`],
    ['deploy','--config','.wrangler-deploy.json']]) {
    const result=spawnSync('npx',['--no-install','wrangler',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    if (result.status!==0) process.exitCode=result.status??1;
    if (process.exitCode) break;
  }
  if (!process.exitCode) {
    const started=spawnSync(process.execPath,['scripts/scheduler.mjs'],{stdio:'inherit',env:process.env});
    if(started.status!==0)process.exitCode=started.status??1;
  }
} finally {await unlink('.wrangler-deploy.json');}
