import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {normalize} from '../src/policy.mjs';
import {cloudflareTarget} from './cloudflare-target.mjs';
import {classify} from '../src/classifier.mjs';

const [snapshotPath, reportPath='reports/preview.json']=process.argv.slice(2);
if (!snapshotPath) throw new Error('Usage: npm run preview -- <ignored snapshot.json> [report.json]');
if (!process.env.CF_ACCOUNT_ID || !process.env.CF_AI_TOKEN) throw new Error('Personal Cloudflare AI credentials required');
const target=cloudflareTarget();
if (target.accountId!==process.env.CF_ACCOUNT_ID || target.freePlanVerified!==true)
  throw new Error('Personal Free-plan account must be verified before sending email to Cloudflare AI');
const model=process.env.AI_MODEL ?? '@cf/cloudflare/clef-flash';
const metrics={requests:0,inputTokens:0,outputTokens:0,totalMs:0};
const infer=async input=> {
  const started=performance.now();
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/${model}`,{
    method:'POST',headers:{Authorization:`Bearer ${process.env.CF_AI_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify(input),signal:AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Cloudflare AI ${response.status}`);
  const value=await response.json();
  if (!value.success) throw new Error('Cloudflare AI request failed');
  metrics.requests++;
  metrics.inputTokens+=value.result.usage?.input_tokens ?? value.result.usage?.prompt_tokens ?? 0;
  metrics.outputTokens+=value.result.usage?.output_tokens ?? value.result.usage?.completion_tokens ?? 0;
  metrics.totalMs+=performance.now()-started;
  return value.result;
};
const accounts=JSON.parse(await readFile(snapshotPath,'utf8'));
const reports=[];
for (const account of accounts) {
  const rows=[];
  for (const message of account.messages) {
    const decision=await classify(message,infer,{model});
    rows.push({...normalize(message),...decision});
    if (decision.retry) throw new Error('AI unavailable; refusing to report a misleading preview count');
  }
  const summary={account:account.email,total:rows.length,flagged:rows.filter(r=>r.action==='delete').length,
    kept:rows.filter(r=>r.action==='keep').length,rows};
  reports.push(summary);
  console.log(JSON.stringify({account:summary.account,total:summary.total,flagged:summary.flagged,kept:summary.kept}));
}
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
console.log(JSON.stringify({model,metrics:{...metrics,totalMs:Math.round(metrics.totalMs)}}));
await writeFile(reportPath,JSON.stringify({generatedAt:new Date().toISOString(),mode:'preview',model,metrics,accounts:reports},null,2),{mode:0o600});
