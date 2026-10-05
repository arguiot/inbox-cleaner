import {run} from './engine.mjs';
import {SchedulerState} from './scheduler-state.mjs';

export async function durableSchedule(env,event,step,{process=run,ticks=30}={}){
  const state=new SchedulerState(env.DB),owner=event.instanceId;
  const options={retries:{limit:0},timeout:'1 minute'};
  const claimed=await step.do('claim scheduler',options,()=>state.claim(owner));
  if(!claimed)return {status:'already running'};
  for(let tick=0;tick<ticks;tick++){
    const result=await step.do(`clean ${tick}`,options,async()=>{
      if(await state.mode()!=='delete'||env.MODE!=='delete'||!await state.refresh(owner))return {stop:true};
      try{
        const report=await process(env,{execute:true});
        const counts={mode:report.mode,scanned:0,flagged:0,deleted:0};
        for(const a of report.accounts)for(const k of ['scanned','flagged','deleted'])counts[k]+=a[k];
        console.log(JSON.stringify({event:'durable_cleanup',...counts}));
        return counts;
      }catch{
        // Failures retain unclassified mail and retry on the next timer tick.
        console.error('Durable cleanup failed; unclassified mail retained');
        return {deferred:true};
      }
    });
    if(result.stop){await step.do('release stopped scheduler',options,()=>state.release(owner));return {status:'stopped'};}
    await step.sleep(`wait ${tick}`,'2 minutes');
  }
  // Each successor uses the latest deployed class and keeps instance state bounded.
  const next=await step.do('successor identifier',options,async()=>{
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));
    return 'clean-'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  });
  await step.do('renew scheduler',options,async()=>{
    if(await state.mode()!=='delete'){await state.release(owner);return {status:'stopped'};}
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
  return {status:'renewed'};
}
