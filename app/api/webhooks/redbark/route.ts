import { after } from 'next/server';
import { z } from 'zod';
import { verifyWebhook } from '@/lib/bank/webhook';
import { receiveEvent } from '@/lib/bank/ingest';
import { DatabaseError,mutate,rpc } from '@/lib/server/database';
import { env } from '@/lib/server/env';
import { limitedBody } from '@/lib/server/auth';
import { runSync } from '@/lib/server/sync';
import { json,failure } from '@/lib/server/http';
export const maxDuration=300;
// Records the verified event id once. Uses the narrow record_webhook_event RPC
// (migration 202610190001) so a delivery never loads or rewrites the whole
// ledger; falls back to a full ledger commit on a database that lacks it.
// Returns true for a new event, false for a repeat, null before the ledger exists.
async function record(eventId:string,type:string):Promise<boolean|null>{
 try{return await rpc<boolean|null>('record_webhook_event',{p_owner:'owner',p_event_id:eventId,p_type:type});}
 catch(e){if(e instanceof DatabaseError&&e.code==='PGRST202'){const {result}=await mutate(s=>receiveEvent(s,eventId,type));return result;}throw e;}
}
export async function POST(req:Request){try{
 const raw=await limitedBody(req,2000000);
 const isV2=req.headers.has('redbark-signature');
 const secrets=isV2?[env('REDBARK_EVENT_SECRET'),env('REDBARK_EVENT_SECRET_PREVIOUS')]:[env('REDBARK_WEBHOOK_SECRET'),env('REDBARK_WEBHOOK_SECRET_PREVIOUS')];
 if(!await verifyWebhook(req.headers,raw,secrets))return json({error:'Invalid webhook signature'},401);
 const event=z.object({id:z.string().min(1).max(200),type:z.string().min(1).max(100),object:z.literal('event')}).passthrough().parse(JSON.parse(raw));
 const delivery=req.headers.get(isV2?'redbark-event-id':'x-redbark-delivery-id');if(delivery&&delivery!==event.id)return json({error:'Event identifier mismatch'},400);
 let created:boolean|null;
 try{created=await record(event.id,event.type);}
 catch(e){
  // Redbark retries v2 lifecycle events for three days, so ask for a retry.
  // The transaction webhook is disabled after a single failed delivery, and it
  // only signals "sync now": acknowledge it and let the scheduled REST
  // reconciliation (every 30 minutes) pick up the same bank data.
  if(isV2)return failure(e);
  return json({accepted:true,recorded:false},202);
 }
 // Acknowledge promptly and reconcile afterwards over REST. Cron drains any
 // recorded event whose continuation is interrupted.
 if(created===true)after(async()=>{try{await runSync();}catch{/* failure is recorded in the ledger; scheduled job retries */}});
 return json({accepted:true,recorded:created!==null,duplicate:created===false},202);
 }catch(e){return failure(e);}}
