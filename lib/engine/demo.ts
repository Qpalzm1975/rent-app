import { emptyState } from './types';
import { executeCommand } from './commands';
import { id,generateRent,reconcileNotifications } from './ledger';
import { ingestTransaction } from '../bank/ingest';
import { matchAll } from './matching';
export const DEMO_NOW='2026-10-02T04:00:00.000Z';
export function demoState(){
 const s=emptyState(),now=new Date(DEMO_NOW),propertyId=id(),connectionId=id(),accountId=id();s.settings.setupComplete=true;
 s.properties.push({id:propertyId,name:'The Midland house',address:'18 Railway Parade, Midland WA 6056',archived:false});
 s.connections.push({id:connectionId,providerId:'conn_demo',institution:'Sample Australian bank',status:'active',consentExpiresAt:'2027-03-28T00:00:00Z',providerRefreshedAt:DEMO_NOW,lastSyncedAt:DEMO_NOW,lastAttemptAt:DEMO_NOW,error:null});
 s.accounts.push({id:accountId,connectionId,providerId:'acct_demo',name:'Rental account',maskedNumber:'•••• 4821',currency:'aud',selected:true,propertyId,balanceCents:1279330,balanceObservedAt:DEMO_NOW,balanceFreshness:'fresh',lastSyncedAt:DEMO_NOW,coverageFrom:'2026-09-01'});
 const names=['Sarah Mitchell','Tom Wilson','Jack Taylor','Emily Chen'],rents=['250','260','240','250'];
 names.forEach((name,i)=>{const roomId=id();s.rooms.push({id:roomId,propertyId,name:`Room ${i+1}`,archived:false});executeCommand(s,{type:'tenant',name,roomId,startDate:'2026-09-07',weeklyRent:rents[i],paymentDay:1,graceDays:2,aliases:[name.toUpperCase()]},now);});
 function tx(providerId:string,date:string,description:string,amount:number){ingestTransaction(s,accountId,{id:providerId,account:'acct_demo',status:'posted',date,post_date:date,description,reference:description,extended_description:null,merchant_name:null,amount:{amount,currency:'aud'},direction:amount>0?'credit':'debit',livemode:true},now);}
 for(const start of ['2026-09-07','2026-09-14','2026-09-21'])names.forEach((n,i)=>tx(`${start}-${i}`,start,`${n.toUpperCase()} RENT`,Number(rents[i])*100));
 names.forEach((n,i)=>{if(i!==1)tx(`rent-current-${i}`,'2026-09-28',`${n.toUpperCase()} RENT`,Number(rents[i])*100);});
 executeCommand(s,{type:'bill',propertyId,name:'Electricity',category:'Electricity',supplier:'Synergy',supplierAlias:'SYNERGY',amount:'428',billDate:'2026-09-24',dueDate:'2026-09-28',tenantIds:s.tenants.map(t=>t.id),divider:4,notes:'Meter period 25 July–24 September.'},now);
 names.forEach((n,i)=>{if(i!==1)tx(`bill-current-${i}`,'2026-09-28',`${n.toUpperCase()} ELECTRICITY`,10700);});tx('synergy-out','2026-09-28','SYNERGY ELECTRICITY PAYMENT',-42800);
 tx('uncertain','2026-09-30','TRANSFER THANK YOU',25000);
 generateRent(s,now);matchAll(s,now);reconcileNotifications(s,now);s.revision=1;return s;
}
