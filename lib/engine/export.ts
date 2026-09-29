import type {State} from './types';
import {report,type ReportFilters} from './reporting';
import {decimal} from './money';
export function exportRows(s:State,f:ReportFilters):string[][] {
 const r=report(s,f);return [['Date','Property','Tenant','Type','Category','Description','Amount AUD','Bank transaction ID','Allocation ID'],...r.rows.map(a=>{const t=s.transactions.find(t=>t.id===a.transactionId)!;return [t.postedDate??t.date,s.properties.find(p=>p.id===a.propertyId)?.name??'',s.tenants.find(t=>t.id===a.tenantId)?.name??'',a.kind,a.category,t.description,decimal((t.direction==='debit'?-1:1)*a.amountCents),t.providerId,a.id];}),...r.creditRows.map(t=>{const a=s.accounts.find(a=>a.id===t.accountId)!;const allocated=s.allocations.filter(a=>a.active&&a.transactionId===t.id).reduce((n,a)=>n+a.amountCents,0);return [t.postedDate??t.date,s.properties.find(p=>p.id===a.propertyId)?.name??'',s.tenants.find(x=>x.id===t.tenantId)?.name??'','tenant_credit','Tenant credit',t.description,decimal(t.amountCents-allocated),t.providerId,''];})];
}
// Neutralise spreadsheet-formula injection while preserving numeric amounts.
export function csv(rows:string[][]){return '\uFEFF'+rows.map((r,i)=>r.map((x,j)=>{const safe=(i>0&&j===6)?x:(/^[=+\-@\t\r]/.test(x)?"'"+x:x);return '"'+safe.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
