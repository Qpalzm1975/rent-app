import { z } from 'zod';
import type { State } from './types';
import { addDays, localDate, validDate } from './dates';
import { cents, splitBill } from './money';
import { allocate, audit, generateRent, id, paid, reconcileNotifications, retireChangedObligations, unmatch } from './ledger';
import { matchAll, normalise, requireDistinctive } from './matching';
const text=z.string().trim().min(1).max(180),date=z.string().refine(validDate,'Enter a valid date'),amount=z.string().refine(v=>{try{return cents(v)>0}catch{return false}},'Enter a positive amount with at most two decimal places'),uuid=z.string().uuid();
const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('property'),name:text,address:z.string().max(300)}),
 z.object({type:z.literal('room'),propertyId:uuid,name:text}),
 z.object({type:z.literal('tenant'),name:text,email:z.string().max(180).default(''),notes:z.string().max(4000).default(''),roomId:uuid,startDate:date,endDate:date.nullable().default(null),weeklyRent:amount,paymentDay:z.number().int().min(0).max(6).default(1),graceDays:z.number().int().min(0).max(30).default(2),aliases:z.array(z.string().trim().min(3).max(120)).max(30)}),
 z.object({type:z.literal('editTenant'),tenantId:uuid,name:text,email:z.string().max(180),notes:z.string().max(4000),active:z.boolean(),aliases:z.array(z.string().trim().min(3).max(120)).max(30)}),
 z.object({type:z.literal('rate'),tenancyId:uuid,effectiveDate:date,weeklyRent:amount}),
 z.object({type:z.literal('moveOut'),tenancyId:uuid,endDate:date}),
 z.object({type:z.literal('bill'),name:text,category:text,supplier:text,supplierAlias:z.string().max(180),propertyId:uuid,amount:amount,billDate:date,dueDate:date,notes:z.string().max(4000).default(''),tenantIds:z.array(uuid).max(50),divider:z.number().int().min(1).max(100)}),
 z.object({type:z.literal('resplitBill'),billId:uuid,tenantIds:z.array(uuid).max(50),divider:z.number().int().min(1).max(100)}),
 z.object({type:z.literal('editBill'),billId:uuid,name:text,category:text,supplier:text,supplierAlias:z.string().max(180),billDate:date,dueDate:date,notes:z.string().max(4000).default('')}),
 z.object({type:z.literal('voidBill'),billId:uuid,reason:z.string().trim().min(3).max(300)}),
 z.object({type:z.literal('allocate'),transactionId:uuid,replace:z.boolean().default(false),reason:z.string().min(3).max(300),remember:z.string().max(120).default(''),allocations:z.array(z.object({kind:z.enum(['rent','reimbursement','expense','other_income','other_expense']),targetId:uuid.optional(),tenantId:uuid.optional(),propertyId:uuid.optional(),amount:z.string(),category:z.string().max(100).optional()})).min(1).max(50)}),
 z.object({type:z.literal('unmatch'),transactionId:uuid,reason:z.string().min(3).max(300)}),
 z.object({type:z.literal('ignore'),transactionId:uuid,ignored:z.boolean()}),
 z.object({type:z.literal('retryMatch'),transactionId:uuid}),
 z.object({type:z.literal('waive'),kind:z.enum(['rent','reimbursement']),targetId:uuid,waived:z.boolean(),reason:z.string().min(3).max(300)}),
 z.object({type:z.literal('rule'),id:uuid.optional(),tenantId:uuid,text:z.string().trim().min(3).max(120),field:z.enum(['any','description','reference','counterparty']),mode:z.enum(['contains','equals']),enabled:z.boolean()}),
 z.object({type:z.literal('settings'),timezone:text,earlyDays:z.number().int().min(0).max(14),lateDays:z.number().int().min(0).max(90),graceDays:z.number().int().min(0).max(30),bankLagHours:z.number().int().min(0).max(168),staleHours:z.number().int().min(1).max(168),historyDays:z.number().int().min(1).max(730),setupComplete:z.boolean()}),
 z.object({type:z.literal('selectAccount'),accountId:uuid,propertyId:uuid,selected:z.boolean()}),
 z.object({type:z.literal('readNotifications')}),
 z.object({type:z.literal('generate')})
]);
function required<T>(item:T|undefined,message='Record not found.'):T{if(!item)throw new Error(message);return item;}
function addShares(s:State,billId:string,tenantIds:string[],divider:number){
 if(new Set(tenantIds).size!==tenantIds.length)throw new Error('Select each tenant only once.');
 const bill=required(s.bills.find(b=>b.id===billId));
 for(const tid of tenantIds)if(!s.tenancies.some(t=>t.tenantId===tid&&s.rooms.some(r=>r.id===t.roomId&&r.propertyId===bill.propertyId)))throw new Error('A selected tenant does not belong to this property.');
 const split=splitBill(bill.amountCents,tenantIds.length,divider);bill.ownerShareCents=split.owner;bill.divider=divider;
 tenantIds.forEach((tenantId,i)=>s.billShares.push({id:id(),billId,tenantId,amountCents:split.shares[i],dueDate:bill.dueDate,active:true,waived:false,waiverReason:null}));
}
export function executeCommand(s:State,input:unknown,now=new Date()):State{
 const a=actionSchema.parse(input),today=localDate(now,s.settings.timezone);let entity='settings';
 switch(a.type){
 case 'property':entity=id();s.properties.push({id:entity,name:a.name,address:a.address,archived:false});break;
 case 'room':required(s.properties.find(p=>p.id===a.propertyId));if(s.rooms.some(r=>r.propertyId===a.propertyId&&normalise(r.name)===normalise(a.name)))throw new Error('Room name already exists.');entity=id();s.rooms.push({id:entity,propertyId:a.propertyId,name:a.name,archived:false});break;
 case 'tenant':{
  required(s.rooms.find(r=>r.id===a.roomId));if(a.endDate&&a.endDate<a.startDate)throw new Error('Move-out must follow move-in.');for(const text of a.aliases)requireDistinctive(text,'The alias');if(a.startDate<addDays(today,-3650))throw new Error('Initial history is limited to ten years.');
  if(s.tenancies.some(t=>t.roomId===a.roomId&&(!t.endDate||t.endDate>=a.startDate)&&(!a.endDate||t.startDate<=a.endDate)))throw new Error('Another tenancy occupies this room during those dates.');
  entity=id();s.tenants.push({id:entity,name:a.name,email:a.email,notes:a.notes,active:true});const tid=id();s.tenancies.push({id:tid,tenantId:entity,roomId:a.roomId,startDate:a.startDate,endDate:a.endDate,paymentDay:a.paymentDay,graceDays:a.graceDays,active:true});s.rentRates.push({id:id(),tenancyId:tid,effectiveDate:a.startDate,weeklyCents:cents(a.weeklyRent),createdAt:now.toISOString()});for(const text of a.aliases)s.aliases.push({id:id(),tenantId:entity,text,active:true});generateRent(s,now);break;}
 case 'editTenant':{const t=required(s.tenants.find(t=>t.id===a.tenantId));entity=t.id;for(const text of a.aliases)requireDistinctive(text,'The alias');Object.assign(t,{name:a.name,email:a.email,notes:a.notes,active:a.active});s.aliases.filter(x=>x.tenantId===t.id).forEach(x=>x.active=false);a.aliases.forEach(text=>s.aliases.push({id:id(),tenantId:t.id,text,active:true}));break;}
 case 'rate':{
  const t=required(s.tenancies.find(t=>t.id===a.tenancyId));entity=t.id;if(a.effectiveDate<today||a.effectiveDate<t.startDate)throw new Error('Use an effective date from today onward; historical rates cannot be rewritten.');
  if(s.rentRates.some(r=>r.tenancyId===t.id&&r.effectiveDate===a.effectiveDate))throw new Error('A rate already exists for this date.');
  if(s.rents.some(r=>r.active&&r.tenancyId===t.id&&r.periodEnd>=a.effectiveDate&&(paid(s,'rent',r.id)>0||r.dueDate<today)))throw new Error('This rate affects an issued or prepaid week. Choose the next unpaid rental-week start.');
  s.rentRates.push({id:id(),tenancyId:t.id,effectiveDate:a.effectiveDate,weeklyCents:cents(a.weeklyRent),createdAt:now.toISOString()});generateRent(s,now,true);break;}
 case 'moveOut':{
  const t=required(s.tenancies.find(t=>t.id===a.tenancyId));entity=t.id;if(a.endDate<t.startDate)throw new Error('Move-out precedes move-in.');
  if(s.rents.some(r=>r.active&&r.tenancyId===t.id&&r.periodEnd>a.endDate&&paid(s,'rent',r.id)>0))throw new Error('Unmatch affected prepaid rent first, then record the move-out.');
  // A later date (an extension or a corrected move-out) also changes the
  // previously prorated final week, so recheck from the earlier of the two dates.
  const previousEnd=t.endDate,from=previousEnd&&previousEnd<a.endDate?previousEnd:a.endDate;
  t.endDate=a.endDate;t.active=a.endDate>=today;const tenant=required(s.tenants.find(x=>x.id===t.tenantId));tenant.active=s.tenancies.some(x=>x.tenantId===tenant.id&&x.active);
  retireChangedObligations(s,t.id,from,now);generateRent(s,now);break;}
 case 'bill':{
  required(s.properties.find(p=>p.id===a.propertyId));if(a.dueDate<a.billDate)throw new Error('The due date cannot precede the bill date.');entity=id();s.bills.push({id:entity,propertyId:a.propertyId,name:a.name,category:a.category,supplier:a.supplier,supplierAlias:a.supplierAlias,amountCents:cents(a.amount),billDate:a.billDate,dueDate:a.dueDate,notes:a.notes,divider:a.divider,ownerShareCents:0,active:true,createdAt:now.toISOString()});addShares(s,entity,a.tenantIds,a.divider);break;}
 case 'resplitBill':{
  const b=required(s.bills.find(b=>b.id===a.billId));entity=b.id;const shares=s.billShares.filter(x=>x.active&&x.billId===b.id);if(shares.some(x=>paid(s,'reimbursement',x.id)>0))throw new Error('Unmatch reimbursements before changing this bill split.');shares.forEach(x=>x.active=false);addShares(s,b.id,a.tenantIds,a.divider);break;}
 case 'editBill':{
  // Descriptive details and dates only; the amount and split stay as issued (void and re-enter a wrong amount).
  const b=required(s.bills.find(b=>b.id===a.billId&&b.active),'Bill not found.');entity=b.id;if(a.dueDate<a.billDate)throw new Error('The due date cannot precede the bill date.');
  const before={name:b.name,category:b.category,supplier:b.supplier,supplierAlias:b.supplierAlias,billDate:b.billDate,dueDate:b.dueDate};Object.assign(b,{name:a.name,category:a.category,supplier:a.supplier,supplierAlias:a.supplierAlias,billDate:a.billDate,dueDate:a.dueDate,notes:a.notes});
  for(const sh of s.billShares.filter(x=>x.active&&x.billId===b.id&&paid(s,'reimbursement',x.id)<x.amountCents))sh.dueDate=a.dueDate;
  audit(s,'bill_edited',b.id,JSON.stringify({before,after:{name:b.name,category:b.category,supplier:b.supplier,supplierAlias:b.supplierAlias,billDate:b.billDate,dueDate:b.dueDate}}),'owner',now);break;}
 case 'voidBill':{
  const b=required(s.bills.find(b=>b.id===a.billId&&b.active),'Bill not found.');entity=b.id;const shares=s.billShares.filter(x=>x.active&&x.billId===b.id);
  if(paid(s,'expense',b.id)>0||shares.some(x=>paid(s,'reimbursement',x.id)>0))throw new Error('Unmatch the bank payments linked to this bill first, then void it.');
  b.active=false;shares.forEach(x=>x.active=false);audit(s,'bill_voided',b.id,a.reason,'owner',now);break;}
 case 'allocate':{
  entity=a.transactionId;if(a.remember)requireDistinctive(a.remember,'The remembered reference');if(a.replace)unmatch(s,a.transactionId,a.reason,now);
  allocate(s,a.transactionId,a.allocations.map(i=>({...i,amountCents:cents(i.amount)})),'manual',[a.reason],now);
  if(a.remember){const t=required(s.transactions.find(t=>t.id===a.transactionId));if(!t.tenantId)throw new Error('Only tenant payments can create a tenant rule.');if(a.remember.trim().length<3)throw new Error('A remembered reference must have at least three characters.');s.rules.push({id:id(),tenantId:t.tenantId,text:a.remember,field:'any',mode:'contains',enabled:true,createdAt:now.toISOString()});}break;}
 case 'unmatch':entity=a.transactionId;unmatch(s,a.transactionId,a.reason,now);break;
 case 'ignore':{const t=required(s.transactions.find(t=>t.id===a.transactionId));entity=t.id;if(a.ignored){if(s.allocations.some(x=>x.active&&x.transactionId===t.id))throw new Error('Unmatch this transaction before ignoring it.');t.tenantId=null;t.status='Ignored';}else t.status='Unmatched';t.ignored=a.ignored;t.autoMatchDisabled=a.ignored;s.notifications.filter(n=>n.key===`review:${t.id}`).forEach(n=>n.resolved=true);break;}
 case 'retryMatch':{const t=required(s.transactions.find(t=>t.id===a.transactionId));entity=t.id;t.autoMatchDisabled=false;t.ignored=false;t.status='Unmatched';break;}
 case 'waive':{const o=required(a.kind==='rent'?s.rents.find(r=>r.id===a.targetId):s.billShares.find(r=>r.id===a.targetId));entity=o.id;if(paid(s,a.kind,o.id)>0)throw new Error('Unmatch allocations before waiving an obligation.');o.waived=a.waived;o.waiverReason=a.waived?a.reason:null;break;}
 case 'rule':{required(s.tenants.find(t=>t.id===a.tenantId));if(a.enabled)requireDistinctive(a.text,'The rule text');entity=a.id??id();const old=s.rules.find(r=>r.id===entity);const row={id:entity,tenantId:a.tenantId,text:a.text,field:a.field,mode:a.mode,enabled:a.enabled,createdAt:old?.createdAt??now.toISOString()};if(old)Object.assign(old,row);else s.rules.push(row);break;}
 case 'settings':try{new Intl.DateTimeFormat('en-AU',{timeZone:a.timezone}).format(now);}catch{throw new Error('Enter a valid IANA time zone.');}if(a.setupComplete&&(!s.properties.length||!s.tenants.length||!s.accounts.some(a=>a.selected)))throw new Error('Add the property, a tenant, and a selected live bank account first.');s.settings={...s.settings,...a};delete (s.settings as unknown as Record<string,unknown>).type;s.user.timezone=a.timezone;break;
 case 'selectAccount':{const account=required(s.accounts.find(x=>x.id===a.accountId));required(s.properties.find(p=>p.id===a.propertyId));entity=account.id;if(account.propertyId&&account.propertyId!==a.propertyId&&s.transactions.some(t=>t.accountId===account.id))throw new Error('An account with imported history cannot be reassigned to another property.');account.selected=a.selected;account.propertyId=a.propertyId;break;}
 case 'readNotifications':s.notifications.forEach(n=>n.read=true);break;
 case 'generate':generateRent(s,now);break;
 }
 audit(s,a.type,entity,JSON.stringify(a.type==='allocate'?{reason:a.reason}:a.type==='rate'?{effectiveDate:a.effectiveDate,weeklyCents:cents(a.weeklyRent)}:a.type==='moveOut'?{endDate:a.endDate}:{action:a.type}),'owner',now);
 // Explicit unmatching/rejection must persist through all automated runs.
 matchAll(s,now);reconcileNotifications(s,now);return s;
}
