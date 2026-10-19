import 'server-only';
import { env } from './env';
import { ProviderError, RedbarkClient, type ProviderBalance } from '../bank/redbark';
import { ingestDirectory,ingestTransaction,applyBalance,applyEventNotices,recordBankFailure,retireMissingPending } from '../bank/ingest';
import { mutate,rpc,snapshot } from './database';
import { addDays,localDate } from '../engine/dates';
import { audit,generateRent,notify,reconcileNotifications } from '../engine/ledger';
import { matchAll } from '../engine/matching';
export const bankClient=()=>new RedbarkClient(env('REDBARK_API_KEY'),env('REDBARK_API_VERSION')||undefined);
export async function refreshDirectory(){const client=bankClient();const [connections,accounts]=await Promise.all([client.connections(),client.accounts()]);return mutate(s=>{ingestDirectory(s,connections,accounts);reconcileNotifications(s);});}
// Events that can mean new or changed bank data trigger a full history sweep;
// lifecycle-only events (sync runs, destination health, pings) need only the
// normal incremental window.
const FULL_SWEEP_EVENTS=new Set(['transactions.synced','connection.created','connection.refreshed']);
function inactiveConsentMessage(status:string){return status==='pending'?'Your bank is still preparing this connection (Redbark status: pending). Rentledger retries automatically.':`Bank consent is not active (Redbark status: ${status}). Renew the connection in Settings.`;}
export interface SyncResult{busy:boolean;imported:number;foreignSkipped?:number;success?:boolean;reason?:'bank_not_configured'}
export async function runSync():Promise<SyncResult>{
 const token=crypto.randomUUID();if(!await rpc<boolean>('claim_job',{p_name:'bank-sync',p_token:token,p_seconds:300}))return{busy:true,imported:0};
 let imported=0,foreignSkipped=0;const started=Date.now();
 try {
  // Rent generation and matching never depend on the bank being reachable.
  await mutate(s=>{generateRent(s);matchAll(s);reconcileNotifications(s);});
  if(!env('REDBARK_API_KEY')){await mutate(s=>{if(!s.connections.length)notify(s,'bank:setup','bank','Connect your bank feed','Add the Redbark API key to the server environment, then connect your bank in Settings.','/settings');});return{busy:false,imported:0,success:false,reason:'bank_not_configured'};}
  const client=bankClient();await refreshDirectory();const state=await snapshot();const today=localDate(new Date(),state.settings.timezone);
  const pendingEvents=state.webhookEvents.filter(e=>!e.processedAt).sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)),pendingEventIds=pendingEvents.map(e=>e.id);
  if(pendingEvents.length)await mutate(s=>applyEventNotices(s,pendingEvents.map(e=>e.type)));
  // The superseded bank status needs migration 202610190001; older schemas keep pending rows as they are.
  const supportsSuperseded=(state.schemaVersion??1)>=2;
  const full=!state.audit.some(a=>a.event==='full_sync_completed'&&Date.parse(a.createdAt)>Date.now()-86400000)||pendingEvents.some(e=>FULL_SWEEP_EVENTS.has(e.type));
  // Redbark filters bare dates in its own time zone, which can be ahead of the
  // property's, so each sweep asks for one extra day.
  const end=addDays(today,1);
  let allSucceeded=true;const failedConnections=new Set<string>();
  for(const account of state.accounts.filter(a=>a.selected)){
   const connection=state.connections.find(c=>c.id===account.connectionId)!;
   try {
    if(!['active','expiring'].includes(connection.status))throw new Error(inactiveConsentMessage(connection.status));
    await mutate(s=>{const c=s.connections.find(c=>c.id===connection.id)!;c.lastAttemptAt=new Date().toISOString();});
    const initialFrom=addDays(today,-state.settings.historyDays);
    let from=full?(account.coverageFrom&&account.coverageFrom<initialFrom?account.coverageFrom:initialFrom):(account.lastSyncedAt?addDays(localDate(new Date(account.lastSyncedAt),state.settings.timezone),-35):initialFrom);
    // Fetch bounded date windows, commit incrementally, and advance the feed
    // watermark only after every page/window has succeeded.
    while(from<=end){
     if(Date.now()-started>220000)throw new Error('The sync reached its time budget. Saved pages are retained; the scheduled retry will continue safely.');
     const candidate=addDays(from,29),to=candidate<end?candidate:end;const rows=await client.transactions(account.providerId,from,to);
     const windowFrom=from;
     const result=await mutate(s=>{let created=0,foreign=0;for(const row of rows){const r=ingestTransaction(s,account.id,row);if(r==='created')created++;else if(r==='foreign')foreign++;}if(supportsSuperseded)retireMissingPending(s,account.id,windowFrom,to,new Set(rows.map(r=>r.id)));matchAll(s);return{created,foreign};});
     imported+=result.result.created;foreignSkipped+=result.result.foreign;from=addDays(to,1);
    }
    // The balance is informational. A rate limit or temporary outage leaves the
    // previous observation in place; it does not make the transaction feed stale.
    let balance:ProviderBalance|null=null;
    try{balance=await client.balance(account.providerId);}catch(e){if(e instanceof ProviderError&&!e.retryable)throw e;}
    await mutate(s=>{if(balance)applyBalance(s,account.id,balance);const a=s.accounts.find(x=>x.id===account.id)!;a.lastSyncedAt=new Date().toISOString();a.coverageFrom=a.coverageFrom&&a.coverageFrom<initialFrom?a.coverageFrom:initialFrom;const c=s.connections.find(c=>c.id===a.connectionId)!;if(!failedConnections.has(c.id))c.error=null;reconcileNotifications(s);});
   }catch(e){allSucceeded=false;failedConnections.add(connection.id);await mutate(s=>recordBankFailure(s,e instanceof Error?e.message:'Bank sync failed.',connection.id));}
  }
  await mutate(s=>{
   for(const c of s.connections){const accounts=s.accounts.filter(a=>a.selected&&a.connectionId===c.id);if(accounts.length&&accounts.every(a=>a.lastSyncedAt&&Date.parse(a.lastSyncedAt)>=started)&&!c.error)c.lastSyncedAt=new Date().toISOString();}
   generateRent(s);matchAll(s);reconcileNotifications(s);
   if(allSucceeded&&s.accounts.some(a=>a.selected)){s.webhookEvents.filter(e=>pendingEventIds.includes(e.id)).forEach(e=>e.processedAt=new Date().toISOString());if(full)audit(s,'full_sync_completed','bank','Full configured history reconciled.');}
   // Routine no-change runs (48 a day) are not audited; imports and failures are.
   if(imported>0||!allSucceeded)audit(s,'sync_completed','bank',`${imported} new bank transaction(s). ${allSucceeded?'All selected accounts checked.':'Some accounts require attention.'}`);
  });
  return {busy:false,imported,foreignSkipped,success:allSucceeded};
 }catch(e){await mutate(s=>{recordBankFailure(s,e instanceof Error?e.message:'Bank sync failed.');reconcileNotifications(s);});throw e;}
 finally{await rpc('release_job',{p_name:'bank-sync',p_token:token});}
}
