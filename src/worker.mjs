import {run} from './engine.mjs';
import {publicPage} from './pages.mjs';
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (request.method==='GET') {const page=publicPage(url.pathname);if (page) return page;}
    if (url.pathname==='/health' && request.method==='GET')
      return Response.json({service:'inbox-cleaner',mode:env.MODE ?? 'preview',ready:!!(env.DB && env.GMAIL_ACCOUNTS_JSON && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)},{headers:{'Cache-Control':'no-store'}});
    if (!env.ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`)
      return new Response('Unauthorized',{status:401});
    if (url.pathname !== '/run' || request.method !== 'POST') return new Response('Not found',{status:404});
    try {
      // HTTP runs are preview-only, including when the scheduled worker is in delete mode.
      return Response.json(await run(env),{headers:{'Cache-Control':'no-store'}});
    } catch {return Response.json({error:'Run failed; check account configuration and provider availability'},{status:503});}
  },
  async scheduled(event,env) {
    console.log(JSON.stringify({event:'scheduled',mode:env.MODE,ready:!!(env.DB && env.GMAIL_ACCOUNTS_JSON)}));
    if (!env.DB || !env.GMAIL_ACCOUNTS_JSON) return;
    await run(env,{execute:env.MODE==='delete'}).then(report=> {
      console.log(JSON.stringify({mode:report.mode,scanned:report.accounts.reduce((n,a)=>n+a.scanned,0),
        flagged:report.accounts.reduce((n,a)=>n+a.flagged,0),deleted:report.accounts.reduce((n,a)=>n+a.deleted,0)}));
    }).catch(error=> {
      // Only our fixed messages/status codes and source locations may enter logs.
      const message=String(error?.message ?? '');
      const known=/^(Google token refresh \d{3}|Gmail \d{3}|Missing access token|Gmail account identity mismatch|Incomplete account credentials|State database not configured|Gmail accounts not configured|Google OAuth not configured|Deletion is disabled)$/;
      console.error(JSON.stringify({error:known.test(message)?message:message.includes('D1_ERROR')?'State database error':'Run failed',
        location:String(error?.stack ?? '').split('\n').slice(1,4).join('\n')}));
    });
  },
};
