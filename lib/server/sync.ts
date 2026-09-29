import 'server-only';
import { env } from './env';
import { RedbarkClient } from '../bank/redbark';
import { ingestDirectory,ingestTransaction,applyBalance,recordBankFailure } from '../bank/ingest';
import { mutate,rpc,snapshot } from './database';
import { addDays,localDate } from '../engine/dates';
import { audit,generateRent,reconcileNotifications } from '../engine/ledger';
import { matchAll } from '../engine/matching';
export const bankClient=()=>new RedbarkClient(env('REDBARK_API_KEY'),env('REDBARK_API_VERSION')||undefined);
export async function refreshDirectory(){const client=bankClient();const [connections,accounts]=await Promise.all([client.connections(),client.accounts()]);return mutate(s=>{ingestDirectory(s,connections,accounts);reconcileNotifications(s);});}
export async function runSync(){
 const token=crypto.randomUUID();if(!await rpc<boolean>('claim_job',{p_name:'bank-sync',p_token:token,p_seconds:300}))return{busy:true,imported:0};
 let imported=0;const started=Date.now();
 try {
  await mutate(s=>{generateRent(s);matchAll(s);reconcileNotifications(s);});
  const client=bankClient();await refreshDirectory();const state=await snapshot();const today=localDate(new Date(),state.settings.timezone);
  const pendingEventIds=state.webhookEvents.filter(e=>!e.processedAt).map(e=>e.id);
  const full=!state.audit.some(a=>a.event==='full_sync_completed'&&Date.parse(a.createdAt)>Date.now()-86400000)||pendingEventIds.length>0;
  let allSucceeded=true;
  for(const account of state.accounts.filter(a=>a.selected)){
   const connection=state.connections.find(c=>c.id===account.connectionId)!;
   try {
    if(!['active','expiring'].includes(connection.status))throw new Error('Bank consent is not active. Renew the connection in Settings.');
    await mutate(s=>{const c=s.connections.find(c=>c.id===connection.id)!;c.lastAttemptAt=new Date().toISOString();});
    const initialFrom=addDays(today,-state.settings.historyDays);
    let from=full?(account.coverageFrom&&account.coverageFrom<initialFrom?account.coverageFrom:initialFrom):(account.lastSyncedAt?addDays(localDate(new Date(account.lastSyncedAt),state.settings.timezone),-35):initialFrom);
    // Fetch bounded date windows, commit incrementally, and advance the feed
    // watermark only after every page/window and balance has succeeded.
    while(from<=today){
     if(Date.now()-started>220000)throw new Error('The sync reached its time budget. Saved pages are retained; the scheduled retry will continue safely.');
     const candidate=addDays(from,29),to=candidate<today?candidate:today;const rows=await client.transactions(account.providerId,from,to);
     const result=await mutate(s=>{let n=0;for(const row of rows)if(ingestTransaction(s,account.id,row)==='created')n++;matchAll(s);return n;});imported+=result.result;from=addDays(to,1);
    }
    const balance=await client.balance(account.providerId);
    await mutate(s=>{applyBalance(s,account.id,balance);const a=s.accounts.find(x=>x.id===account.id)!;a.lastSyncedAt=new Date().toISOString();a.coverageFrom=a.coverageFrom&&a.coverageFrom<initialFrom?a.coverageFrom:initialFrom;const c=s.connections.find(c=>c.id===a.connectionId)!;c.error=null;reconcileNotifications(s);});
   }catch(e){allSucceeded=false;await mutate(s=>recordBankFailure(s,e instanceof Error?e.message:'Bank sync failed.',connection.id));}
  }
  await mutate(s=>{for(const c of s.connections){const accounts=s.accounts.filter(a=>a.selected&&a.connectionId===c.id);if(accounts.length&&accounts.every(a=>a.lastSyncedAt&&Date.parse(a.lastSyncedAt)>=started)&&!c.error)c.lastSyncedAt=new Date().toISOString();}generateRent(s);matchAll(s);reconcileNotifications(s);if(allSucceeded&&s.accounts.some(a=>a.selected)){s.webhookEvents.filter(e=>pendingEventIds.includes(e.id)).forEach(e=>e.processedAt=new Date().toISOString());if(full)audit(s,'full_sync_completed','bank','Full configured history reconciled.');}audit(s,'sync_completed','bank',allSucceeded?'All selected accounts checked.':'Some accounts require attention.');});
  return {busy:false,imported,success:allSucceeded};
 }catch(e){await mutate(s=>{recordBankFailure(s,e instanceof Error?e.message:'Bank sync failed.');reconcileNotifications(s);});throw e;}
 finally{await rpc('release_job',{p_name:'bank-sync',p_token:token});}
}
