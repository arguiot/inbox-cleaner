import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {cloudflareTarget} from './cloudflare-target.mjs';
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
if (!accountId || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare deployment credentials required');
const target=cloudflareTarget();
if (target.accountId!==accountId || target.freePlanVerified!==true)
  throw new Error('Deployment target must be pinned after verifying the configured account and Free plan');
const response=await fetch('https://api.cloudflare.com/client/v4/user',{
  headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000),
});
const user=await response.json();
if (!response.ok || user.result?.email?.toLowerCase()!==target.email)
  throw new Error('Refusing deployment: token owner must match the configured Cloudflare email');
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
if(process.env.CLEANER_MODE) config.vars.MODE=process.env.CLEANER_MODE;
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
