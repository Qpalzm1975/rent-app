export type ID = string;
// Every monetary value is an integer number of Australian cents. All operations
// are bounded to Number.MAX_SAFE_INTEGER; input decimals are parsed as strings.
export type Cents = number;
export type LocalDate = string;
export type ObligationStatus = 'Upcoming'|'Due'|'Awaiting Bank Update'|'Paid'|'Partially Paid'|'Overdue'|'Needs Review'|'Waived';
export type TransactionStatus = 'Matched'|'Partially Allocated'|'Unmatched'|'Ignored'|'Needs Review';
export interface User { id:ID; name:string; timezone:string; createdAt:string }
export interface Settings { timezone:string; earlyDays:number; lateDays:number; graceDays:number; bankLagHours:number; staleHours:number; historyDays:number; setupComplete:boolean }
export interface Property { id:ID; name:string; address:string; archived:boolean }
export interface Room { id:ID; propertyId:ID; name:string; archived:boolean }
export interface Tenant { id:ID; name:string; email:string; notes:string; active:boolean }
export interface Tenancy { id:ID; tenantId:ID; roomId:ID; startDate:LocalDate; endDate:LocalDate|null; paymentDay:number; graceDays:number; active:boolean }
export interface RentRateHistory { id:ID; tenancyId:ID; effectiveDate:LocalDate; weeklyCents:Cents; createdAt:string }
export interface RentObligation { id:ID; tenancyId:ID; tenantId:ID; propertyId:ID; periodStart:LocalDate; periodEnd:LocalDate; dueDate:LocalDate; amountCents:Cents; rateSnapshot:string; active:boolean; waived:boolean; waiverReason:string|null; createdAt:string }
export interface Bill { id:ID; propertyId:ID; name:string; category:string; supplier:string; supplierAlias:string; amountCents:Cents; billDate:LocalDate; dueDate:LocalDate; notes:string; divider:number; ownerShareCents:Cents; active:boolean; createdAt:string }
export interface BillShare { id:ID; billId:ID; tenantId:ID; amountCents:Cents; dueDate:LocalDate; active:boolean; waived:boolean; waiverReason:string|null }
export interface BankConnection { id:ID; providerId:string; institution:string; status:string; consentExpiresAt:string|null; providerRefreshedAt:string|null; lastSyncedAt:string|null; lastAttemptAt:string|null; error:string|null }
export interface BankAccount { id:ID; connectionId:ID; providerId:string; name:string; maskedNumber:string; currency:string; selected:boolean; propertyId:ID|null; balanceCents:Cents|null; balanceObservedAt:string|null; balanceFreshness:string|null; lastSyncedAt:string|null; coverageFrom:LocalDate|null }
export interface BankTransaction { id:ID; accountId:ID; providerId:string; date:LocalDate; postedDate:LocalDate|null; description:string; reference:string; counterparty:string; amountCents:Cents; direction:'credit'|'debit'; bankStatus:'posted'|'pending'|'superseded'; status:TransactionStatus; tenantId:ID|null; confidence:number|null; reasons:string[]; fingerprint:string; ignored:boolean; autoMatchDisabled:boolean; createdAt:string; updatedAt:string }
export type AllocationKind='rent'|'reimbursement'|'expense'|'other_income'|'other_expense';
export interface TransactionAllocation { id:ID; transactionId:ID; kind:AllocationKind; rentId:ID|null; billShareId:ID|null; billId:ID|null; tenantId:ID|null; propertyId:ID; category:string; amountCents:Cents; active:boolean; source:'automatic'|'manual'; reasons:string[]; createdAt:string; removedAt:string|null; removalReason:string|null }
export interface TenantTransactionAlias { id:ID; tenantId:ID; text:string; active:boolean }
export interface MatchingRule { id:ID; tenantId:ID; text:string; field:'any'|'description'|'reference'|'counterparty'; mode:'contains'|'equals'; enabled:boolean; createdAt:string }
export interface Notification { id:ID; key:string; type:'overdue_rent'|'overdue_bill'|'review'|'bank'|'consent'|'changed'; title:string; detail:string; href:string; read:boolean; resolved:boolean; createdAt:string }
export interface AuditLog { id:ID; event:string; entityId:ID; actor:string; detail:string; createdAt:string }
export interface WebhookEvent { id:ID; providerEventId:string; type:string; receivedAt:string; processedAt:string|null }
// schemaVersion is reported by ledger_snapshot from migration 2 onward; absent
// means the database still has only the initial migration.
export interface State { revision:number; schemaVersion?:number; user:User; settings:Settings; properties:Property[]; rooms:Room[]; tenants:Tenant[]; tenancies:Tenancy[]; rentRates:RentRateHistory[]; rents:RentObligation[]; bills:Bill[]; billShares:BillShare[]; connections:BankConnection[]; accounts:BankAccount[]; transactions:BankTransaction[]; allocations:TransactionAllocation[]; aliases:TenantTransactionAlias[]; rules:MatchingRule[]; notifications:Notification[]; audit:AuditLog[]; webhookEvents:WebhookEvent[] }
export const emptyState = (owner='owner'):State => ({revision:0,user:{id:owner,name:'Property owner',timezone:'Australia/Perth',createdAt:new Date().toISOString()},settings:{timezone:'Australia/Perth',earlyDays:2,lateDays:2,graceDays:2,bankLagHours:24,staleHours:30,historyDays:90,setupComplete:false},properties:[],rooms:[],tenants:[],tenancies:[],rentRates:[],rents:[],bills:[],billShares:[],connections:[],accounts:[],transactions:[],allocations:[],aliases:[],rules:[],notifications:[],audit:[],webhookEvents:[]});
