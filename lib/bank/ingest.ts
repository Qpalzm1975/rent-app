import type { State } from '../engine/types';
import type { ProviderTransaction,ProviderAccount,ProviderConnection,ProviderBalance } from './redbark';
import { audit,id,notify,unmatch } from '../engine/ledger';
import { checked } from '../engine/money';
export function ingestTransaction(s:State,accountId:string,row:ProviderTransaction,now=new Date()){
 const account=s.accounts.find(a=>a.id===accountId);if(!account||account.providerId!==row.account)throw new Error('Provider transaction belongs to a different account.');
 if(row.amount.amount===0)return 'zero';if((row.amount.amount>0)!==(row.direction==='credit'))throw new Error('Provider amount and direction disagree.');
 const value={date:row.date,postedDate:row.post_date,description:row.description,reference:row.reference??'',counterparty:[row.extended_description,row.merchant_name].filter(Boolean).join(' · '),amountCents:checked(Math.abs(row.amount.amount)),direction:row.direction,bankStatus:row.status};
 const fingerprint=JSON.stringify(value),old=s.transactions.find(t=>t.accountId===accountId&&t.providerId===row.id);
 if(old){if(old.fingerprint===fingerprint)return 'duplicate';
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
 for(const c of s.connections)if(!connections.some(p=>p.id===c.providerId)){c.status='revoked';c.error='The connection is no longer returned by Redbark. Reconnect or renew consent.';}
}
export function applyBalance(s:State,accountId:string,b:ProviderBalance){const a=s.accounts.find(a=>a.id===accountId);if(a){a.balanceCents=b.current?.amount??null;a.balanceObservedAt=b.observed_at;a.balanceFreshness=b.freshness;}}
export function receiveEvent(s:State,eventId:string,type:string,now=new Date()){if(s.webhookEvents.some(e=>e.providerEventId===eventId))return false;s.webhookEvents.push({id:id(),providerEventId:eventId,type,receivedAt:now.toISOString(),processedAt:null});audit(s,'webhook_received',eventId,type,'bank',now);return true;}
export function recordBankFailure(s:State,message:string,connectionId?:string,now=new Date()){for(const c of s.connections.filter(c=>!connectionId||c.id===connectionId)){c.lastAttemptAt=now.toISOString();c.error=message;notify(s,`bank:${c.id}`,'bank',`${c.institution} stopped syncing`,message,'/settings',now);}if(!s.connections.length)notify(s,'bank:setup','bank','Bank connection needs attention',message,'/settings',now);}
