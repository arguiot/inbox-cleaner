import {protectedMessage, normalize} from './policy.mjs';
import {classify} from './classifier.mjs';
import {Gmail, accessToken} from './gmail.mjs';
import {Store} from './store.mjs';
import {SchedulerState} from './scheduler-state.mjs';

async function pendingPage(gmail,store,account,stream,execute) {
  const page=await store.cursor(account,stream);
  const options={unreadOnly:stream==='unread'};
  let listed;
  try {listed=await gmail.list(page,options);}
  catch(error) {if(!page)throw error;listed=await gmail.list(undefined,options);}
  const ids=(listed.messages ?? []).map(m=>m.id),seen=await store.seen(account,ids);
  const candidates=ids.filter(id=>!seen.has(id)||(execute&&seen.get(id).status==='preview'&&seen.get(id).action==='delete'));
  return {listed,candidates};
}

export async function mayDelete(message, gmail, now = Date.now()) {
  if (protectedMessage(message) || !message.labelIds?.includes('INBOX')) return false;
  const thread = await gmail.thread(message.threadId);
  return !(thread.messages ?? []).some(m => m.labelIds?.includes('SENT') &&
    Number(m.internalDate) > now - 14*86400000);
}

export async function processMessages({messages, gmail, infer, model, execute = false, canExecute = async()=>true, onDecision = async()=>{}}) {
  const decisions=[];
  for (const message of messages) {
    const decision = await classify(message,infer,{model});
    let deleted=false;
    if (execute && decision.action === 'delete') {
      if (!await canExecute()) throw new Error('Deletion is disabled');
      const fresh = await gmail.get(message.id);
      // A changed message/labels must go through classification again on the next run.
      if (JSON.stringify(normalize(message)) === JSON.stringify(normalize(fresh)) && await mayDelete(fresh,gmail)) {
        await gmail.delete(message.id);
        deleted=true;
      } else {
        decision.action='keep'; decision.category='uncertain'; decision.reason='Changed or protected conversation';
      }
    }
    await onDecision(message,decision,deleted);
    decisions.push({id:message.id,...decision,deleted});
  }
  return decisions;
}

export async function run(env, {execute = false, fetcher = fetch, now = Date.now()} = {}) {
  if (!env.DB) throw new Error('State database not configured');
  const accounts=JSON.parse(env.GMAIL_ACCOUNTS_JSON ?? '[]');
  if (!accounts.length) throw new Error('Gmail accounts not configured');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth not configured');
  if (execute && env.MODE !== 'delete') throw new Error('Deletion is disabled');
  const state=new SchedulerState(env.DB);
  if (execute && await state.mode()!=='delete') throw new Error('Deletion is disabled');
  const store=new Store(env.DB), owner=crypto.randomUUID();
  if (!await store.lease(owner,now)) return {mode:'busy',accounts:[]};
  const report={mode:execute?'delete':'preview',accounts:[]};
  const deadline=Date.now()+45000;
  try {
    const batchLimit=Math.min(3,Math.max(1,Number(env.MAX_MESSAGES_PER_ACCOUNT ?? 3)));
    const dailyLimit=Math.min(500,Math.max(1,Number(env.MAX_AI_MESSAGES_PER_DAY ?? 500)));
    for (const account of accounts) {
      if (!account.email || !account.refreshToken) throw new Error('Incomplete account credentials');
      const token=await accessToken(account,env,fetcher), gmail=new Gmail(token,fetcher);
      const profile=await gmail.profile();
      if (profile.emailAddress.toLowerCase() !== account.email.toLowerCase()) throw new Error('Gmail account identity mismatch');
      let stream='unread';
      let {listed,candidates}=await pendingPage(gmail,store,account.email,stream,execute);
      if (!candidates.length && !listed.nextPageToken) {
        await store.setCursor(account.email,undefined,stream);
        stream='recent';
        ({listed,candidates}=await pendingPage(gmail,store,account.email,stream,execute));
      }
      const summary={account:account.email,scanned:0,flagged:0,deleted:0,kept:0,deferred:0};
      report.accounts.push(summary);
      for (const id of candidates.slice(0,batchLimit)) {
        if (Date.now()>deadline) {summary.deferred++;break;}
        const message=await gmail.get(id);
        if (!message.labelIds?.includes('INBOX')) continue;
        const infer=async input=> {
          if (!await store.reserve(new Date(now).toISOString().slice(0,10),dailyLimit)) throw new Error('Daily AI limit reached');
          let timeout;
          try {
            return await Promise.race([env.AI.run(env.AI_MODEL,input),new Promise((_,reject)=>{
              timeout=setTimeout(()=>reject(new Error('Classifier timed out')),15000);
            })]);
          } finally {clearTimeout(timeout);}
        };
        const result=(await processMessages({messages:[message],gmail,infer,model:env.AI_MODEL,execute,
          canExecute:async()=>await state.mode()==='delete',
          onDecision:async (m,d,deleted)=> {
            if (!d.retry) await store.record(account.email,m.id,d,deleted?'deleted':execute?'processed':'preview',now);
          }}))[0];
        summary.scanned++;
        if (result.retry) {summary.deferred++;break;}
        if (result.action==='delete') summary.flagged++; else summary.kept++;
        if (result.deleted) summary.deleted++;
      }
      // Stay on this page until every candidate has been processed; then paginate the backlog.
      if (candidates.length<=summary.scanned && !summary.deferred) await store.setCursor(account.email,listed.nextPageToken,stream);
    }
    return report;
  } finally { await store.release(owner); }
}
