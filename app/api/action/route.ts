import { requireOwner,sameOrigin,jsonBody } from '@/lib/server/auth';
import { mutate } from '@/lib/server/database';
import { executeCommand } from '@/lib/engine/commands';
import { json,failure } from '@/lib/server/http';
export async function POST(req:Request){try{await requireOwner();sameOrigin(req);const body=await jsonBody(req);const {state}=await mutate(s=>executeCommand(s,body));return json(state);}catch(e){return failure(e);}}
