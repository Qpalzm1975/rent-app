import { requireOwner,sameOrigin } from '@/lib/server/auth';
import { runSync } from '@/lib/server/sync';
import { json,failure } from '@/lib/server/http';
export const maxDuration=300;
export async function POST(req:Request){try{await requireOwner();sameOrigin(req);return json(await runSync());}catch(e){return failure(e);}}
