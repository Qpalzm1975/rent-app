import { requireOwner,sameOrigin,jsonBody } from '@/lib/server/auth';
import { bankClient } from '@/lib/server/sync';
import { snapshot } from '@/lib/server/database';
import { origin } from '@/lib/server/env';
import { json,failure } from '@/lib/server/http';
import { z } from 'zod';
export async function POST(req:Request){try{await requireOwner();sameOrigin(req);const {connectionId}=z.object({connectionId:z.string().uuid().optional()}).parse(await jsonBody(req));const s=await snapshot();const c=connectionId?s.connections.find(c=>c.id===connectionId):null;if(connectionId&&!c)throw new Error('Connection not found.');return json(await bankClient().link(origin()+'/settings?connected=1',c?.providerId));}catch(e){return failure(e);}}
