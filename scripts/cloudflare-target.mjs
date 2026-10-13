import {readFileSync} from 'node:fs';

export function cloudflareTarget(env=process.env,path='cloudflare-target.json') {
  let target;
  if(env.CLOUDFLARE_EXPECTED_EMAIL){
    target={email:env.CLOUDFLARE_EXPECTED_EMAIL,accountId:env.CLOUDFLARE_ACCOUNT_ID,
      freePlanVerified:env.CLOUDFLARE_FREE_PLAN_VERIFIED==='true'};
  }else{
    try{target=JSON.parse(readFileSync(path,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;target={};}
  }
  if(!/^[a-f0-9]{32}$/.test(target.accountId??'')||!/^\S+@\S+\.\S+$/.test(target.email??'')||target.freePlanVerified!==true)
    throw Error('Configure a verified Cloudflare Free account and its expected owner email');
  return {...target,email:target.email.toLowerCase()};
}
