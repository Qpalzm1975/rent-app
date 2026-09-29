import { env } from '@/lib/server/env';
import { constantEqual } from '@/lib/server/crypto';
import { runSync } from '@/lib/server/sync';
import { json,failure } from '@/lib/server/http';
export const maxDuration=300;
export async function GET(req:Request){if(env('CRON_SECRET').length<32||!constantEqual(req.headers.get('authorization')??'',`Bearer ${env('CRON_SECRET')}`))return json({error:'Unauthorized'},401);try{return json(await runSync());}catch(e){return failure(e);}}
export const POST=GET;
