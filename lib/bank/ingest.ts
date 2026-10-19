import type { State } from '../engine/types';
import type { ProviderTransaction,ProviderAccount,ProviderConnection,ProviderBalance } from './redbark';
import { audit,id,notify,unmatch } from '../engine/ledger';
import { checked } from '../engine/money';
export type IngestResult='created'|'updated'|'duplicate'|'zero'|'foreign';
export function ingestTransaction(s:State,accountId:string,row:ProviderTransaction,now=new Date()):IngestResult{
 const account=s.accounts.find(a=>a.id===accountId);if(!account||account.providerId!==row.account)throw new Error('Provider transaction belongs to a different account.');
 if(row.amount.amount===0)return 'zero';
 // The ledger is AUD-only. A foreign-currency row (Redbark reports each
 // transaction in its own currency) is left out instead of stopping the feed.
 if(row.amount.currency!=='aud')return 'foreign';
 if((row.amount.amount>0)!==(row.direction==='credit'))throw new Error('Provider amount and direction disagree.');
 const value={date:row.date,postedDate:row.post_date,description:row.description,reference:row.reference??'',counterparty:[row.extended_description,row.merchant_name].filter(Boolean).join(' · '),amountCents:checked(Math.abs(row.amount.amount)),direction:row.direction,bankStatus:row.status};
 const fingerprint=JSON.stringify(value),old=s.transactions.find(t=>t.accountId===accountId&&t.providerId===row.id);
 if(old){if(old.fingerprint===fingerprint&&old.bankStatus!=='superseded')return 'duplicate';
  // A pending row marked superseded that the bank reports again is restored.
  if(old.bankStatus==='superseded'&&old.status==='Ignored'&&!old.ignored){old.status='Unmatched';old.reasons=[];}
  const changedPosted=old.bankStatus==='posted';const oldValue={amountCents:old.amountCents,direction:old.direction,date:old.date,postedDate:old.postedDate};
  if(changedPosted){unmatch(s,old.id,'The provider changed a posted transaction; previous allocations were reversed.',now);old.status='Needs Review';old.autoMatchDisabled=true;notify(s,`changed:${old.id}`,'changed','A posted transaction changed','Its allocations have been reversed. Review and confirm the corrected transaction.','/transactions?status=Needs%20Review',now);}
  Object.assign(old,value,{fingerprint,updatedAt:now.toISOString()});audit(s,'bank_transaction_changed',old.id,JSON.stringify({before:oldValue,after:{amountCents:old.amountCents,direction:old.direction,date:old.date,postedDate:old.postedDate}}),'bank',now);return 'updated';
 }
 const transactionId=id();s.transactions.push({id:transactionId,accountId,providerId:row.id,...value,status:'Unmatched',tenantId:null,confidence:null,reasons:[],fingerprint,ignored:false,autoMatchDisabled:false,createdAt:now.toISOString(),updatedAt:now.toISOString()});audit(s,'bank_transaction_received',transactionId,`${value.direction}, ${value.amountCents} cents, ${value.bankStatus}.`,'bank',now);return 'created';
}
export function ingestDirectory(s:State,connections:ProviderConnection[],accounts:ProviderAccount[]){
 for(const c of connections){const old=s.connections.find(x=>x.providerId===c.id);const common={institution:c.institution?.name??'Australian bank',status:c.status,consentExpiresAt:c.consent?.expires_at??null,providerRefreshedAt:c.last_refreshed_at};if(old)Object.assign(old,common);else s.connections.push({id:id(),providerId:c.id,...common,lastSyncedAt:null,lastAttemptAt:null,error:null});}
 for(const a of accounts){const c=s.connections.find(c=>c.providerId===a.connection);if(!c)continue;const old=s.accounts.find(x=>x.providerId===a.id);if(old){old.name=a.name;old.maskedNumber=a.account_number??'';}else s.accounts.push({id:id(),connectionId:c.id,providerId:a.id,name:a.name,maskedNumber:a.account_number??'',currency:a.currency,selected:false,propertyId:null,balanceCents:null,balanceObservedAt:null,balanceFreshness:null,lastSyncedAt:null,coverageFrom:null});}
 // A formerly known connection missing from a successful provider listing is
 // no longer treated as healthy. Historical local records remain intact.
 for(const c of s.connections)if(!connections.some(p=>p.id===c.providerId)&&c.status!=='revoked'){c.status='revoked';c.error='The connection is no longer returned by Redbark. Reconnect or renew consent.';}
}
export function applyBalance(s:State,accountId:string,b:ProviderBalance){const a=s.accounts.find(a=>a.id===accountId);if(a){a.balanceCents=b.current&&b.current.currency==='aud'?b.current.amount:null;a.balanceObservedAt=b.observed_at;a.balanceFreshness=b.freshness;}}
// A pending row the bank no longer reports inside a fully fetched window has
// settled under a new ID or been cancelled (CDR pending IDs are not stable).
// Keep it for history, never allocate it, and stop showing it as pending.
export function retireMissingPending(s:State,accountId:string,from:string,to:string,returned:Set<string>,now=new Date()){
 let n=0;for(const t of s.transactions)if(t.accountId===accountId&&t.bankStatus==='pending'&&t.date>=from&&t.date<=to&&!returned.has(t.providerId)){t.bankStatus='superseded';t.status='Ignored';t.reasons=['Your bank no longer reports this pending transaction. It settled under a new ID or was cancelled.'];t.updatedAt=now.toISOString();n++;}
 if(n)audit(s,'pending_transactions_superseded',accountId,`${n} pending transaction(s) no longer reported between ${from} and ${to}.`,'bank',now);return n;
}
// Redbark lifecycle events carry no data; a few deserve an owner notice.
const EVENT_NOTICES:Record<string,{key:string;title:string;detail:string}>={
 'destination.disabled':{key:'bank:redbark-destination',title:'Redbark paused instant bank updates',detail:'Redbark disabled the transaction webhook after a failed delivery. The scheduled sync keeps running; re-enable the destination in Redbark once the app is reachable.'},
 'event_destination.disabled':{key:'bank:redbark-events',title:'Redbark paused bank status alerts',detail:'Redbark disabled the lifecycle event destination. The scheduled sync keeps running; re-enable the destination in Redbark.'},
 'sync.attention':{key:'bank:redbark-sync',title:'Your Redbark sync needs attention',detail:'Open the Rentledger sync in Redbark. Renewing bank consent or re-enabling the destination usually resolves this.'},
};
const EVENT_RESOLVES:Record<string,string>={'transactions.synced':'bank:redbark-destination','event_destination.ping':'bank:redbark-events','sync_run.succeeded':'bank:redbark-sync'};
export function applyEventNotices(s:State,types:string[],now=new Date()){for(const type of types){const n=EVENT_NOTICES[type];if(n)notify(s,n.key,'bank',n.title,n.detail,'/settings',now);const key=EVENT_RESOLVES[type];if(key)s.notifications.filter(x=>x.key===key&&!x.resolved).forEach(x=>x.resolved=true);}}
export function receiveEvent(s:State,eventId:string,type:string,now=new Date()){if(s.webhookEvents.some(e=>e.providerEventId===eventId))return false;s.webhookEvents.push({id:id(),providerEventId:eventId,type,receivedAt:now.toISOString(),processedAt:null});audit(s,'webhook_received',eventId,type,'bank',now);return true;}
export function recordBankFailure(s:State,message:string,connectionId?:string,now=new Date()){for(const c of s.connections.filter(c=>!connectionId||c.id===connectionId)){c.lastAttemptAt=now.toISOString();c.error=message;notify(s,`bank:${c.id}`,'bank',`${c.institution} stopped syncing`,message,'/settings',now);}if(!s.connections.length)notify(s,'bank:setup','bank','Bank connection needs attention',message,'/settings',now);}
