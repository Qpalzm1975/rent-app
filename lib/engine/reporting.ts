import type { State } from './types';
import { available, paid, statusOf } from './ledger';
import { sum } from './money';
export interface ReportFilters {from:string;to:string;propertyId?:string;tenantId?:string;category?:string}
export function report(s:State,f:ReportFilters){
 const txs=s.transactions.filter(t=>t.bankStatus==='posted'&&!t.ignored&&(t.postedDate??t.date)>=f.from&&(t.postedDate??t.date)<=f.to);
 const txIds=new Set(txs.map(t=>t.id));
 const rows=s.allocations.filter(a=>a.active&&txIds.has(a.transactionId)&&(!f.propertyId||a.propertyId===f.propertyId)&&(!f.tenantId||a.tenantId===f.tenantId)&&(!f.category||a.category===f.category));
 const total=(kind:string)=>sum(rows.filter(r=>r.kind===kind).map(r=>r.amountCents));
 const rent=total('rent'),reimbursements=total('reimbursement'),expenses=total('expense'),otherIncome=total('other_income'),otherExpenses=total('other_expense');
 const creditRows=txs.filter(t=>t.direction==='credit'&&t.tenantId&&(!f.tenantId||t.tenantId===f.tenantId)&&(!f.category||f.category==='Tenant credit')&&(!f.propertyId||s.accounts.find(a=>a.id===t.accountId)?.propertyId===f.propertyId));
 const tenantCredits=sum(creditRows.map(t=>available(s,t)));
 const unclassified=txs.filter(t=>available(s,t)>0&&!t.tenantId&&(!f.propertyId||s.accounts.find(a=>a.id===t.accountId)?.propertyId===f.propertyId)&&!f.tenantId);
 const billed=s.bills.filter(b=>b.active&&b.billDate>=f.from&&b.billDate<=f.to&&(!f.propertyId||b.propertyId===f.propertyId)&&(!f.category||b.category===f.category));
 // Bill cohort is deliberately independent of cash receipt dates. It answers
 // how much of bills issued in the range is still an owner's unreimbursed cost.
 const billCohortUnreimbursed=sum(billed.map(b=>paid(s,'expense',b.id)-sum(s.billShares.filter(sh=>sh.active&&sh.billId===b.id).map(sh=>paid(s,'reimbursement',sh.id)))));
 return {rent,reimbursements,expenses,otherIncome,otherExpenses,tenantCredits,net:rent+reimbursements+otherIncome+tenantCredits-expenses-otherExpenses,rows,creditRows,unclassified,unclassifiedCredits:sum(unclassified.filter(t=>t.direction==='credit').map(t=>available(s,t))),unclassifiedDebits:sum(unclassified.filter(t=>t.direction==='debit').map(t=>available(s,t))),billCohortUnreimbursed};
}
export function tenantTotals(s:State,tenantId:string){const rents=s.rents.filter(r=>r.active&&!r.waived&&r.tenantId===tenantId),shares=s.billShares.filter(r=>r.active&&!r.waived&&r.tenantId===tenantId);return {rentExpected:sum(rents.map(r=>r.amountCents)),rentReceived:sum(rents.map(r=>paid(s,'rent',r.id))),billExpected:sum(shares.map(r=>r.amountCents)),billReceived:sum(shares.map(r=>paid(s,'reimbursement',r.id))),credit:sum(s.transactions.filter(t=>t.tenantId===tenantId&&!t.ignored&&t.bankStatus==='posted'&&t.direction==='credit').map(t=>available(s,t)))};}
export function dashboard(s:State,from:string,to:string,now=new Date(),propertyId?:string){const rents=s.rents.filter(r=>r.active&&!r.waived&&(!propertyId||r.propertyId===propertyId));const week=rents.filter(r=>r.dueDate>=from&&r.dueDate<=to);return{expected:sum(week.map(r=>r.amountCents)),received:sum(week.map(r=>paid(s,'rent',r.id))),overdue:sum(rents.filter(r=>statusOf(s,r,now)==='Overdue').map(r=>r.amountCents-paid(s,'rent',r.id))),billsOutstanding:sum(s.billShares.filter(r=>r.active&&!r.waived&&(!propertyId||s.bills.some(b=>b.id===r.billId&&b.propertyId===propertyId))).map(r=>r.amountCents-paid(s,'reimbursement',r.id)))};}
