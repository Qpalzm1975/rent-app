import type { State, BankTransaction, RentObligation, BillShare, ObligationStatus, TransactionAllocation, AllocationKind } from './types';
import { addDays, daysBetween, localDate, weekStart } from './dates';
import { checked, sum } from './money';
export const id=()=>crypto.randomUUID();
export function audit(s:State,event:string,entityId:string,detail:string,actor='system',now=new Date()){s.audit.push({id:id(),event,entityId,actor,detail,createdAt:now.toISOString()});}
export function notify(s:State,key:string,type:State['notifications'][number]['type'],title:string,detail:string,href:string,now=new Date()){
 const old=s.notifications.find(n=>n.key===key&&!n.resolved);if(old){old.detail=detail;return;}
 s.notifications.push({id:id(),key,type,title,detail,href,read:false,resolved:false,createdAt:now.toISOString()});
}
export const allocationsFor=(s:State,transactionId:string)=>s.allocations.filter(a=>a.active&&a.transactionId===transactionId);
export function paid(s:State,kind:'rent'|'reimbursement'|'expense',target:string){return sum(s.allocations.filter(a=>a.active&&a.kind===kind&&(kind==='rent'?a.rentId===target:kind==='reimbursement'?a.billShareId===target:a.billId===target)).map(a=>a.amountCents));}
export function available(s:State,t:BankTransaction){return checked(t.amountCents-sum(allocationsFor(s,t.id).map(a=>a.amountCents)));}
export function tenancyProperty(s:State,tenancyId:string){const t=s.tenancies.find(x=>x.id===tenancyId);return s.rooms.find(r=>r.id===t?.roomId)?.propertyId;}
export function amountForPeriod(s:State,tenancyId:string,start:string,end:string){
 const t=s.tenancies.find(x=>x.id===tenancyId)!;const rates=s.rentRates.filter(r=>r.tenancyId===t.id).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate));let numerator=0n;const used=new Set<string>();
 for(let d=start;d<=end;d=addDays(d,1)){if(d<t.startDate||(t.endDate&&d>t.endDate))continue;const rate=rates.find(r=>r.effectiveDate<=d);if(!rate)throw new Error('A rent rate is required from the tenancy start date.');numerator+=BigInt(rate.weeklyCents);used.add(rate.id);}
 return {amountCents:checked(Number((numerator+3n)/7n)),rateSnapshot:JSON.stringify(rates.filter(r=>used.has(r.id)).map(r=>({effectiveDate:r.effectiveDate,weeklyCents:r.weeklyCents}))) };
}
export function generateRent(s:State,now=new Date(),refreshFuture=false){
 const today=localDate(now,s.settings.timezone),horizon=addDays(today,14);
 for(const t of s.tenancies){
  const last=t.endDate&&t.endDate<horizon?t.endDate:horizon;
  // An ended tenancy still retains its genuine outstanding obligations.
  for(let start=weekStart(t.startDate,t.paymentDay);start<=last;start=addDays(start,7)){
   const end=addDays(start,6),dueDate=start<t.startDate?t.startDate:start;
   const existing=s.rents.find(r=>r.active&&r.tenancyId===t.id&&r.periodStart===start);
   if(existing&&(!refreshFuture||existing.dueDate<today))continue;
   const amount=amountForPeriod(s,t.id,start,end);
   if(existing){if(existing.amountCents===amount.amountCents&&existing.rateSnapshot===amount.rateSnapshot)continue;if(paid(s,'rent',existing.id)>0)throw new Error('Unmatch prepaid rent before changing the rate or tenancy dates.');existing.active=false;audit(s,'rent_obligation_superseded',existing.id,'Future obligation replaced; original retained.',undefined,now);}
   if(amount.amountCents===0)continue;
   const r:RentObligation={id:id(),tenancyId:t.id,tenantId:t.tenantId,propertyId:tenancyProperty(s,t.id)!,periodStart:start,periodEnd:end,dueDate,...amount,active:true,waived:false,waiverReason:null,createdAt:now.toISOString()};s.rents.push(r);audit(s,'rent_obligation_generated',r.id,`Rent due ${dueDate}: ${r.amountCents} cents.`,undefined,now);
  }
 }
}
// After a tenancy's dates change, retire every active obligation from `from`
// onward whose amount no longer matches the tenancy (including weeks now wholly
// outside it). Paid weeks are never rewritten: the owner must unmatch first.
// generateRent() then issues the replacement weeks.
export function retireChangedObligations(s:State,tenancyId:string,from:string,now=new Date()){
 for(const r of s.rents.filter(r=>r.active&&!r.waived&&r.tenancyId===tenancyId&&r.periodEnd>=from)){
  const next=amountForPeriod(s,tenancyId,r.periodStart,r.periodEnd);
  if(next.amountCents===r.amountCents&&next.rateSnapshot===r.rateSnapshot)continue;
  if(paid(s,'rent',r.id)>0)throw new Error('Unmatch the payment for the affected rent week first, then change the tenancy dates.');
  r.active=false;audit(s,'rent_obligation_superseded',r.id,'Tenancy dates changed; original obligation retained.','owner',now);
 }
}
export function bankFresh(s:State,propertyId:string,now=new Date()){
 const accounts=s.accounts.filter(a=>a.selected&&a.propertyId===propertyId);
 return accounts.length>0&&accounts.every(a=>{const c=s.connections.find(c=>c.id===a.connectionId);return c&&['active','expiring'].includes(c.status)&&!c.error&&a.lastSyncedAt&&now.getTime()-Date.parse(a.lastSyncedAt)<=s.settings.staleHours*3600000;});
}
export function statusOf(s:State,o:RentObligation|BillShare,now=new Date()):ObligationStatus {
 if(o.waived)return 'Waived';const isRent='tenancyId' in o,kind=isRent?'rent':'reimbursement',p=paid(s,kind,o.id);if(p>=o.amountCents)return 'Paid';
 const propertyId=isRent?o.propertyId:s.bills.find(b=>b.id===o.billId)!.propertyId;
 if(s.allocations.some(a=>a.active&&(a.rentId===o.id||a.billShareId===o.id)&&s.transactions.find(t=>t.id===a.transactionId)?.status==='Needs Review'))return 'Needs Review';
 const today=localDate(now,s.settings.timezone),grace=isRent?s.tenancies.find(t=>t.id===o.tenancyId)!.graceDays:s.settings.graceDays;
 const deadline=addDays(o.dueDate,grace),days=daysBetween(deadline,today);
 const matured=days>0&&days*24>s.settings.bankLagHours;
 if(matured&&bankFresh(s,propertyId,now)){
  // Require the feed to have been checked AFTER the grace/settlement window.
  const selected=s.accounts.filter(a=>a.selected&&a.propertyId===propertyId);
  if(selected.every(a=>a.lastSyncedAt&&localDate(new Date(a.lastSyncedAt),s.settings.timezone)>deadline))return 'Overdue';
 }
 if(today>deadline&&!bankFresh(s,propertyId,now))return 'Awaiting Bank Update';
 if(p>0)return 'Partially Paid';if(today<o.dueDate)return 'Upcoming';
 if(today>deadline||!bankFresh(s,propertyId,now))return 'Awaiting Bank Update';return 'Due';
}
export type AllocationInput={kind:AllocationKind;targetId?:string;tenantId?:string;propertyId?:string;amountCents:number;category?:string};
export function allocate(s:State,transactionId:string,inputs:AllocationInput[],source:'manual'|'automatic',reasons:string[],now=new Date()){
 const t=s.transactions.find(x=>x.id===transactionId);if(!t||t.bankStatus!=='posted'||t.ignored)throw new Error('Only posted, non-ignored transactions can be allocated.');
 const requested=sum(inputs.map(i=>{checked(i.amountCents);if(i.amountCents<=0)throw new Error('Allocation amounts must be positive.');return i.amountCents;}));
 if(requested>available(s,t))throw new Error('The allocations exceed the unallocated bank amount.');
 const existing=allocationsFor(s,t.id),newRows:TransactionAllocation[]=[];
 for(const i of inputs){
  let propertyId=i.propertyId??'',tenantId=i.tenantId??null,rentId:string|null=null,billShareId:string|null=null,billId:string|null=null,category=i.category??'';
  if(i.kind==='rent') {const o=s.rents.find(r=>r.id===i.targetId&&r.active&&!r.waived);if(!o||t.direction!=='credit')throw new Error('Invalid rent allocation.');if(paid(s,'rent',o.id)+sum(newRows.filter(a=>a.rentId===o.id).map(a=>a.amountCents))+i.amountCents>o.amountCents)throw new Error('Rent would be overpaid.');rentId=o.id;tenantId=o.tenantId;propertyId=o.propertyId;category='Rent';}
  else if(i.kind==='reimbursement'){const o=s.billShares.find(b=>b.id===i.targetId&&b.active&&!b.waived);if(!o||t.direction!=='credit')throw new Error('Invalid reimbursement allocation.');const b=s.bills.find(b=>b.id===o.billId&&b.active);if(!b)throw new Error('Bill is inactive.');if(paid(s,'reimbursement',o.id)+sum(newRows.filter(a=>a.billShareId===o.id).map(a=>a.amountCents))+i.amountCents>o.amountCents)throw new Error('Bill share would be overpaid.');billShareId=o.id;billId=o.billId;propertyId=b.propertyId;tenantId=o.tenantId;category=b.category;}
  else if(i.kind==='expense'){const b=s.bills.find(b=>b.id===i.targetId&&b.active);if(!b||t.direction!=='debit')throw new Error('Invalid property expense allocation.');if(paid(s,'expense',b.id)+sum(newRows.filter(a=>a.kind==='expense'&&a.billId===b.id).map(a=>a.amountCents))+i.amountCents>b.amountCents)throw new Error('Bill payment exceeds the bill total.');billId=b.id;propertyId=b.propertyId;category=b.category;}
  else {if((i.kind==='other_income')!==(t.direction==='credit')||!s.properties.some(p=>p.id===propertyId))throw new Error('Select a valid category, direction and property.');category=category||'Other';}
  const account=s.accounts.find(a=>a.id===t.accountId);if(account?.propertyId!==propertyId)throw new Error('The bank account and obligation belong to different properties.');
  newRows.push({id:id(),transactionId,kind:i.kind,rentId,billShareId,billId,tenantId,propertyId,category,amountCents:i.amountCents,active:true,source,reasons,createdAt:now.toISOString(),removedAt:null,removalReason:null});
 }
 const tenants=new Set([...existing,...newRows].map(a=>a.tenantId).filter(Boolean));if(tenants.size>1)throw new Error('A credit cannot pay obligations for unrelated tenants.');
 s.allocations.push(...newRows);t.tenantId=[...tenants][0]??t.tenantId;t.reasons=reasons;t.confidence=source==='manual'?100:t.confidence;t.status=available(s,t)===0?'Matched':'Partially Allocated';
 if(source==='manual')t.autoMatchDisabled=true;
 audit(s,source==='manual'?'manual_match_created':'automatic_match_created',t.id,`${requested} cents allocated. ${reasons.join('; ')}`,source==='manual'?'owner':'system',now);
 s.notifications.filter(n=>n.key===`review:${t.id}`).forEach(n=>n.resolved=true);
}
export function unmatch(s:State,transactionId:string,reason:string,now=new Date()){
 const t=s.transactions.find(t=>t.id===transactionId);if(!t)throw new Error('Transaction not found.');
 for(const a of allocationsFor(s,t.id)){a.active=false;a.removedAt=now.toISOString();a.removalReason=reason;}
 t.status='Unmatched';t.tenantId=null;t.confidence=null;t.reasons=[reason];t.autoMatchDisabled=true;audit(s,'match_removed',t.id,reason,'owner',now);
}
export function reconcileNotifications(s:State,now=new Date()){
 const overdueKeys=new Set<string>();
 for(const o of [...s.rents.filter(o=>o.active),...s.billShares.filter(o=>o.active)]){if(statusOf(s,o,now)!=='Overdue')continue;const rent='tenancyId' in o;const key=`overdue:${o.id}`;overdueKeys.add(key);const name=s.tenants.find(t=>t.id===o.tenantId)?.name??'Tenant';notify(s,key,rent?'overdue_rent':'overdue_bill',`${name} · ${rent?'rent':'bill reimbursement'} overdue`,`Due ${o.dueDate}. Balance ${o.amountCents-paid(s,rent?'rent':'reimbursement',o.id)} cents.`,rent?'/rent':'/bills',now);}
 s.notifications.filter(n=>n.key.startsWith('overdue:')&&!overdueKeys.has(n.key)).forEach(n=>n.resolved=true);
 for(const c of s.connections){
  const selected=s.accounts.some(a=>a.selected&&a.connectionId===c.id);if(!selected)continue;
  if(c.error||!c.lastSyncedAt||now.getTime()-Date.parse(c.lastSyncedAt)>s.settings.staleHours*3600000)notify(s,`bank:${c.id}`,'bank',`${c.institution} needs attention`,c.error??'The bank feed has not completed a recent sync.','/settings',now);
  else s.notifications.filter(n=>n.key===`bank:${c.id}`).forEach(n=>n.resolved=true);
  if(c.consentExpiresAt&&(Date.parse(c.consentExpiresAt)-now.getTime())<30*86400000)notify(s,`consent:${c.id}`,'consent','Renew your bank consent',`Consent for ${c.institution} expires ${c.consentExpiresAt.slice(0,10)}.`,'/settings',now);
  else s.notifications.filter(n=>n.key===`consent:${c.id}`).forEach(n=>n.resolved=true);
 }
}
