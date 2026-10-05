import {WorkflowEntrypoint} from 'cloudflare:workers';
import worker from './worker.mjs';
import {durableSchedule} from './durable-schedule.mjs';
export default worker;
export class InboxCleanerWorkflow extends WorkflowEntrypoint {
  async run(event,step){return durableSchedule(this.env,event,step);}
}
