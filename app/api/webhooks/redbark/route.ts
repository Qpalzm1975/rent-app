import { after } from 'next/server';
import { z } from 'zod';
import { verifyWebhook } from '@/lib/bank/webhook';
import { receiveEvent } from '@/lib/bank/ingest';
import { mutate } from '@/lib/server/database';
import { env } from '@/lib/server/env';
import { limitedBody } from '@/lib/server/auth';
import { runSync } from '@/lib/server/sync';
import { json,failure } from '@/lib/server/http';
export const maxDuration=300;
export async function POST(req:Request){try{
 const raw=await limitedBody(req,2000000);
 const isV2=req.headers.has('redbark-signature');
 const secrets=isV2?[env('REDBARK_EVENT_SECRET'),env('REDBARK_EVENT_SECRET_PREVIOUS')]:[env('REDBARK_WEBHOOK_SECRET'),env('REDBARK_WEBHOOK_SECRET_PREVIOUS')];
 if(!await verifyWebhook(req.headers,raw,secrets))return json({error:'Invalid webhook signature'},401);
 const event=z.object({id:z.string().min(1).max(200),type:z.string().min(1).max(100),object:z.literal('event')}).passthrough().parse(JSON.parse(raw));
 const delivery=req.headers.get(isV2?'redbark-event-id':'x-redbark-delivery-id');if(delivery&&delivery!==event.id)return json({error:'Event identifier mismatch'},400);
 const {result}=await mutate(s=>receiveEvent(s,event.id,event.type));
 // Persist first, acknowledge promptly, process afterward. Cron drains durable
 // pending events if this process is interrupted or the provider is unavailable.
 if(result)after(async()=>{try{await runSync();}catch{/* failure is recorded in the ledger; scheduled job retries */}});
 return json({accepted:true,duplicate:!result},202);
 }catch(e){return failure(e);}}
