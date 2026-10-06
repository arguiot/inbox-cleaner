import {run} from './engine.mjs';
import {SchedulerState} from './scheduler-state.mjs';

export async function durableSchedule(env,event,step,{process=run,fetcher=fetch}={}){
  const state=new SchedulerState(env.DB),owner=event.instanceId;
  const options={retries:{limit:0,delay:'5 seconds',backoff:'constant'},timeout:'1 minute'};
  // Free-plan subrequests accumulate across an entire Workflow, including sleeps.
  // One bounded batch per instance leaves room for the successor handoff.
  const result=await step.do('clean',options,async()=>{
    if(!await state.claim(owner))return {stop:true,status:'already running'};
    if(await state.mode()!=='trash'||env.MODE!=='trash'){
      await state.release(owner);return {stop:true,status:'stopped'};
    }
    let requests=0;
    const boundedFetch=(...args)=>{
      if(requests>=40)throw new Error('Cleanup request budget reached');
      requests++;return fetcher(...args);
    };
    try{
      const report=await process(env,{execute:true,fetcher:boundedFetch});
      const counts={mode:report.mode,scanned:0,flagged:0,trashed:0};
      for(const a of report.accounts)for(const k of ['scanned','flagged','trashed'])counts[k]+=a[k];
      console.log(JSON.stringify({event:'durable_cleanup',...counts}));
      return counts;
    }catch{
      // Failures retain unclassified mail and retry in the next instance.
      console.error('Durable cleanup failed; unclassified mail retained');
      return {deferred:true};
    }
  });
  if(result.stop)return {status:result.status};
  await step.sleep('wait','2 minutes');
  // Three steps per cycle stay below the Free allowance of 3,000/day.
  // Each successor receives a fresh request budget and the latest deployed code.
  return step.do('renew scheduler',options,async()=>{
    if(await state.mode()!=='trash'||env.MODE!=='trash'){
      await state.release(owner);return {status:'stopped'};
    }
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));
    const next='clean-'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
    if(!await state.handoff(owner,next))return {status:'superseded'};
    try{await env.CLEANER_WORKFLOW.create({id:next});}
    catch{
      // A replay after creation must recover the existing deterministic successor.
      const instance=await env.CLEANER_WORKFLOW.get(next);
      const status=await instance.status();
      if(!['running','queued','waiting','complete'].includes(status.status))throw new Error('Scheduler renewal failed');
    }
    return {status:'renewed'};
  });
}
