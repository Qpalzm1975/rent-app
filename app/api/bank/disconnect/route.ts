import { z } from 'zod';
import { requireOwner,sameOrigin,jsonBody } from '@/lib/server/auth';
import { bankClient } from '@/lib/server/sync';
import { mutate,snapshot } from '@/lib/server/database';
import { audit,reconcileNotifications } from '@/lib/engine/ledger';
import { json,failure } from '@/lib/server/http';
// Withdraws the owner's CDR consent through Redbark. Imported transactions,
// allocations and reports stay in the ledger; the accounts stop being tracked.
export async function POST(req:Request){try{
 await requireOwner();sameOrigin(req);
 const {connectionId}=z.object({connectionId:z.string().uuid()}).parse(await jsonBody(req));
 const connection=(await snapshot()).connections.find(c=>c.id===connectionId);if(!connection)throw new Error('Connection not found.');
 await bankClient().revoke(connection.providerId);
 const {state}=await mutate(s=>{const c=s.connections.find(x=>x.id===connectionId)!;c.status='revoked';c.error=null;for(const a of s.accounts.filter(a=>a.connectionId===c.id))a.selected=false;s.notifications.filter(n=>[`bank:${c.id}`,`consent:${c.id}`].includes(n.key)).forEach(n=>n.resolved=true);audit(s,'bank_connection_revoked',c.id,'Owner withdrew bank consent from Rentledger; local history retained.','owner');reconcileNotifications(s);});
 return json(state);
}catch(e){return failure(e);}}
