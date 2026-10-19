import type { State, BankTransaction } from './types';
import { addDays, daysBetween, localDate } from './dates';
import { sum } from './money';
import { allocate, available, paid, notify, type AllocationInput } from './ledger';
export function normalise(s:string){return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();}
export function contains(text:string,alias:string){const a=normalise(alias);return a.length>=3&&(` ${normalise(text)} `).includes(` ${a} `);}
export function textOf(t:BankTransaction){return [t.description,t.reference,t.counterparty].filter(Boolean).join(' ');}
// Words that appear in many people's payments. Text made only of these words
// (or bare numbers) cannot identify a tenant: "RENT", "ROOM 2" or "WEEKLY
// PAYMENT" would otherwise attribute another person's money to whoever used it
// first. Aliases, rules and learned references must contain a distinctive word.
const GENERIC_WORDS=new Set(['A','ACC','ACCOUNT','ACCT','AND','APP','AUD','BANK','BANKING','BILL','BILLS','BOND','BPAY','CASH','CREDIT','DEBIT','DEP','DEPOSIT','DIRECT','ELEC','ELECTRICITY','FAST','FOR','FORTNIGHT','FORTNIGHTLY','FROM','GAS','HOME','HOUSE','IN','INCOMING','INSTANT','INTERNET','MISC','MOBILE','MONEY','MONTH','MONTHLY','MY','NBN','NETBANK','NPP','OF','ONLINE','OSKO','OTHER','OUT','PAID','PAY','PAYID','PAYMENT','PAYMENTS','PMT','POWER','PYMT','RECEIPT','REF','REFERENCE','RENT','RENTAL','RENTS','RM','ROOM','SAVINGS','SHARE','TFR','THANK','THANKS','THE','TO','TRANSACTION','TRANSFER','TRF','TXN','TY','UTILITIES','UTILITY','WATER','WEEK','WEEKLY','WEEKS','WIFI','WK','WKLY','XFER','YOU']);
export function distinctive(text:string){return normalise(text).split(' ').some(word=>word.length>=2&&!GENERIC_WORDS.has(word)&&!/^\d+$/.test(word));}
export function requireDistinctive(text:string,what:string){if(!distinctive(text))throw new Error(`${what} “${text.trim()}” is too generic to identify a tenant. Include a name or a reference only this tenant uses.`);}
function review(s:State,t:BankTransaction,reasons:string[],now:Date){t.status='Needs Review';t.reasons=reasons;t.confidence=40;notify(s,`review:${t.id}`,'review','Payment needs your review',`${t.description}: ${reasons.join('; ')}`,'/transactions?status=Needs%20Review',now);}
function identities(s:State,t:BankTransaction){
 const text=textOf(t),evidence=new Map<string,string[]>();const add=(tenantId:string,reason:string)=>{evidence.set(tenantId,[...(evidence.get(tenantId)??[]),reason]);};
 for(const a of s.aliases.filter(a=>a.active)){if(contains(text,a.text))add(a.tenantId,`Tenant alias “${a.text}” matched`);}
 for(const r of s.rules.filter(r=>r.enabled)){const hay=r.field==='any'?text:t[r.field];if(r.mode==='equals'?normalise(hay)===normalise(r.text):contains(hay,r.text))add(r.tenantId,`Your ${r.field} rule matched “${r.text}”`);}
 // Only repeated, manually confirmed exact references can establish identity.
 // Amounts and recurring dates alone NEVER establish identity.
 if(t.reference.trim().length>=4&&distinctive(t.reference)){const history=s.transactions.filter(p=>p.id!==t.id&&p.reference&&normalise(p.reference)===normalise(t.reference)&&p.tenantId&&s.allocations.some(a=>a.active&&a.transactionId===p.id&&a.source==='manual'));
  const ids=[...new Set(history.map(x=>x.tenantId!))];if(ids.length===1&&history.length>=2)add(ids[0],'Same reference was manually confirmed at least twice');}
 return evidence;
}
interface Debt {kind:'rent'|'reimbursement';id:string;dueDate:string;remaining:number;label:string}
export function matchTransaction(s:State,t:BankTransaction,now=new Date()){
 if(t.bankStatus!=='posted'||t.ignored||t.autoMatchDisabled||available(s,t)<=0)return;
 const account=s.accounts.find(a=>a.id===t.accountId);if(!account?.selected||!account.propertyId)return;
 const amount=available(s,t),text=textOf(t);
 if(t.direction==='debit'){
  const bills=s.bills.filter(b=>b.active&&b.propertyId===account.propertyId&&b.amountCents-paid(s,'expense',b.id)>0&&contains(text,b.supplierAlias||b.supplier)&&t.date>=addDays(b.billDate,-s.settings.earlyDays)&&Math.abs(daysBetween(b.dueDate,t.date))<=90);
  const exact=bills.filter(b=>b.amountCents-paid(s,'expense',b.id)===amount);
  if(exact.length===1){t.confidence=98;allocate(s,t.id,[{kind:'expense',targetId:exact[0].id,amountCents:amount}],'automatic',['Supplier alias matched','Exact outstanding bill amount','No competing supplier bill'],now);}
  else if(bills.length)review(s,t,['Supplier identified; bill amount or bill identity needs confirmation'],now);
  return;
 }
 const evidence=identities(s,t);
 if(evidence.size!==1){review(s,t,[evidence.size?'References identify more than one tenant':'No unique tenant alias or confirmed reference; amount alone is insufficient'],now);return;}
 const [tenantId,reasons]=[...evidence][0];
 const tenancies=s.tenancies.filter(x=>x.tenantId===tenantId&&s.rooms.some(r=>r.id===x.roomId&&r.propertyId===account.propertyId));
 if(!tenancies.length){review(s,t,['Tenant identity matches but property does not'],now);return;}
 // First pass: judge the payment against obligations eligible on its own date.
 // Once it is known tenant money (part-allocated, or identified and held as
 // credit), the remainder also pays obligations that have since fallen due,
 // oldest first, so an early payment is never left beside an "overdue" week.
 const heldCredit=t.tenantId===tenantId||s.allocations.some(a=>a.active&&a.transactionId===t.id);
 const eligibilityDate=heldCredit?[t.date,localDate(now,s.settings.timezone)].sort().at(-1)!:t.date;
 const allDebts:Debt[]=[...s.rents.filter(r=>r.active&&!r.waived&&r.tenantId===tenantId&&r.propertyId===account.propertyId).map(r=>({kind:'rent' as const,id:r.id,dueDate:r.dueDate,remaining:r.amountCents-paid(s,'rent',r.id),label:'Rent'})),...s.billShares.filter(b=>b.active&&!b.waived&&b.tenantId===tenantId&&s.bills.some(x=>x.id===b.billId&&x.active&&x.propertyId===account.propertyId)).map(b=>({kind:'reimbursement' as const,id:b.id,dueDate:b.dueDate,remaining:b.amountCents-paid(s,'reimbursement',b.id),label:s.bills.find(x=>x.id===b.billId)!.name}))].filter(d=>d.remaining>0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id));
 t.tenantId=tenantId;
 const debts=allDebts.filter(d=>d.dueDate<=addDays(eligibilityDate,s.settings.earlyDays));
 if(!debts.length){t.status=available(s,t)===t.amountCents?'Unmatched':'Partially Allocated';t.reasons=[...reasons,'Credit retained for the tenant; no eligible obligation yet'];t.confidence=95;return;}
 const rentHint=contains(text,'RENT');const billHints=debts.filter(d=>d.kind==='reimbursement'&&contains(text,d.label));
 let pool=debts;
 if(billHints.length&&!rentHint)pool=billHints;
 else if(rentHint&&!billHints.length)pool=debts.filter(d=>d.kind==='rent');
 const rents=pool.filter(d=>d.kind==='rent'),bills=pool.filter(d=>d.kind==='reimbursement');
 let plan:AllocationInput[]=[];
 // An exact contiguous rent prepayment may cover future weeks. It must
 // start with an eligible unpaid week, carry a unique tenant identity, and
 // have no competing unlabelled bill allocation.
 if(rents.length&&(!bills.length||rentHint)&&amount>sum(pool.map(d=>d.remaining))){
  const futureRents=allDebts.filter(d=>d.kind==='rent'&&d.dueDate<=addDays(eligibilityDate,28));let prefix=0;const forward:Debt[]=[];
  for(const d of futureRents){prefix+=d.remaining;forward.push(d);if(prefix>=amount)break;}
  if(prefix===amount){pool=forward;reasons.push('Exact contiguous multiple-week rent payment');}
 }
 const total=sum(pool.map(d=>d.remaining));
 if(amount===total){plan=pool.map(d=>({kind:d.kind,targetId:d.id,amountCents:d.remaining}));reasons.push('Exact total of eligible outstanding obligations');}
 else if(!bills.length||!rents.length){
  // Explicitly targeted bill shares must be unambiguous when several exist.
  if(bills.length>1&&!billHints.length&&amount!==total){review(s,t,[...reasons,'Several bill shares could receive this payment'],now);return;}
  let left=amount;for(const d of pool){const n=Math.min(left,d.remaining);if(n>0)plan.push({kind:d.kind,targetId:d.id,amountCents:n});left-=n;}
  reasons.push(amount<pool[0].remaining?'Partial payment toward oldest obligation':'Oldest eligible obligations first');
 }
 else {
  const oldestRent=rents[0],exactBill=bills.filter(d=>d.remaining===amount);
  if(exactBill.length===1&&oldestRent.remaining!==amount){plan=[{kind:'reimbursement',targetId:exactBill[0].id,amountCents:amount}];reasons.push('Exact identified tenant bill share; no competing rent amount');}
  else if(exactBill.length===0&&amount===oldestRent.remaining){plan=[{kind:'rent',targetId:oldestRent.id,amountCents:amount}];reasons.push(amount===oldestRent.remaining?'Exact oldest rent amount':'Partial payment toward oldest rent');}
  else {review(s,t,[...reasons,'Rent and bills compete for this amount; confirm the split'],now);return;}
 }
 if(!plan.length)return;
 const dates=pool.map(d=>daysBetween(d.dueDate,t.date));reasons.push(dates.some(d=>d>=-s.settings.earlyDays&&d<=s.settings.lateDays)?'Within the expected payment window':'Late payment applied to outstanding debt');
 const prior=s.transactions.filter(p=>p.id!==t.id&&p.tenantId===tenantId&&p.status==='Matched');if(prior.length)reasons.push('Consistent with an established tenant payment history');
 reasons.push('No competing tenant identity');t.confidence=97;allocate(s,t.id,plan,'automatic',reasons,now);
}
export function matchAll(s:State,now=new Date()){for(const t of [...s.transactions].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)))matchTransaction(s,t,now);}
