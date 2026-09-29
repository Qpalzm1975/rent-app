-- Rentledger: personal owner, relational PostgreSQL ledger. Money is BIGINT
-- cents (fixed precision); calendar dates and UTC timestamps are distinct.
-- Run through `supabase db push` or the Supabase SQL editor as project owner.
create table public.app_user (id text primary key, name text not null, timezone text not null, "createdAt" timestamptz not null);
create table public.ledger_meta (owner_id text primary key references public.app_user(id), revision bigint not null default 0, settings jsonb not null);
create table public.property (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "name" text not null,
  "address" text not null,
  "archived" boolean not null,
  primary key (owner_id, id)
);
create table public.room (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "propertyId" uuid not null,
  "name" text not null,
  "archived" boolean not null,
  primary key (owner_id, id),
  foreign key (owner_id,"propertyId") references public.property(owner_id,id) deferrable initially deferred
);
create table public.tenant (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "name" text not null,
  "email" text not null,
  "notes" text not null,
  "active" boolean not null,
  primary key (owner_id, id)
);
create table public.tenancy (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "tenantId" uuid not null,
  "roomId" uuid not null,
  "startDate" date not null,
  "endDate" date,
  "paymentDay" integer not null check ("paymentDay" between 0 and 6),
  "graceDays" integer not null check ("graceDays" between 0 and 30),
  "active" boolean not null,
  primary key (owner_id, id),
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"roomId") references public.room(owner_id,id) deferrable initially deferred
);
create table public.rent_rate_history (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "tenancyId" uuid not null,
  "effectiveDate" date not null,
  "weeklyCents" bigint not null check ("weeklyCents" > 0),
  "createdAt" timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id,"tenancyId") references public.tenancy(owner_id,id) deferrable initially deferred
);
create table public.rent_obligation (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "tenancyId" uuid not null,
  "tenantId" uuid not null,
  "propertyId" uuid not null,
  "periodStart" date not null,
  "periodEnd" date not null,
  "dueDate" date not null,
  "amountCents" bigint not null check ("amountCents" > 0),
  "rateSnapshot" text not null,
  "active" boolean not null,
  "waived" boolean not null,
  "waiverReason" text,
  "createdAt" timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id,"tenancyId") references public.tenancy(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"propertyId") references public.property(owner_id,id) deferrable initially deferred
);
create table public.bill (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "propertyId" uuid not null,
  "name" text not null,
  "category" text not null,
  "supplier" text not null,
  "supplierAlias" text not null,
  "amountCents" bigint not null check ("amountCents" > 0),
  "billDate" date not null,
  "dueDate" date not null,
  "notes" text not null,
  "divider" integer not null check (divider between 1 and 100),
  "ownerShareCents" bigint not null check ("ownerShareCents" >= 0),
  "active" boolean not null,
  "createdAt" timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id,"propertyId") references public.property(owner_id,id) deferrable initially deferred
);
create table public.bill_share (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "billId" uuid not null,
  "tenantId" uuid not null,
  "amountCents" bigint not null check ("amountCents" >= 0),
  "dueDate" date not null,
  "active" boolean not null,
  "waived" boolean not null,
  "waiverReason" text,
  primary key (owner_id, id),
  foreign key (owner_id,"billId") references public.bill(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred
);
create table public.bank_connection (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "providerId" text not null,
  "institution" text not null,
  "status" text not null,
  "consentExpiresAt" timestamptz,
  "providerRefreshedAt" timestamptz,
  "lastSyncedAt" timestamptz,
  "lastAttemptAt" timestamptz,
  "error" text,
  primary key (owner_id, id)
);
create table public.bank_account (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "connectionId" uuid not null,
  "providerId" text not null,
  "name" text not null,
  "maskedNumber" text not null,
  "currency" text not null check (currency = 'aud'),
  "selected" boolean not null,
  "propertyId" uuid,
  "balanceCents" bigint,
  "balanceObservedAt" timestamptz,
  "balanceFreshness" text,
  "lastSyncedAt" timestamptz,
  "coverageFrom" date,
  primary key (owner_id, id),
  foreign key (owner_id,"connectionId") references public.bank_connection(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"propertyId") references public.property(owner_id,id) deferrable initially deferred
);
create table public.bank_transaction (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "accountId" uuid not null,
  "providerId" text not null,
  "date" date not null,
  "postedDate" date,
  "description" text not null,
  "reference" text not null,
  "counterparty" text not null,
  "amountCents" bigint not null check ("amountCents" > 0),
  "direction" text not null check (direction in ('credit','debit')),
  "bankStatus" text not null check ("bankStatus" in ('posted','pending')),
  "status" text not null check (status in ('Matched','Partially Allocated','Unmatched','Ignored','Needs Review')),
  "tenantId" uuid,
  "confidence" integer,
  "reasons" jsonb not null,
  "fingerprint" text not null,
  "ignored" boolean not null,
  "autoMatchDisabled" boolean not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id,"accountId") references public.bank_account(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred
);
create table public.transaction_allocation (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "transactionId" uuid not null,
  "kind" text not null check (kind in ('rent','reimbursement','expense','other_income','other_expense')),
  "rentId" uuid,
  "billShareId" uuid,
  "billId" uuid,
  "tenantId" uuid,
  "propertyId" uuid not null,
  "category" text not null,
  "amountCents" bigint not null check ("amountCents" > 0),
  "active" boolean not null,
  "source" text not null check (source in ('automatic','manual')),
  "reasons" jsonb not null,
  "createdAt" timestamptz not null,
  "removedAt" timestamptz,
  "removalReason" text,
  primary key (owner_id, id),
  foreign key (owner_id,"transactionId") references public.bank_transaction(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"rentId") references public.rent_obligation(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"billShareId") references public.bill_share(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"billId") references public.bill(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred,
  foreign key (owner_id,"propertyId") references public.property(owner_id,id) deferrable initially deferred
);
create table public.tenant_transaction_alias (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "tenantId" uuid not null,
  "text" text not null,
  "active" boolean not null,
  primary key (owner_id, id),
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred
);
create table public.matching_rule (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "tenantId" uuid not null,
  "text" text not null,
  "field" text not null check (field in ('any','description','reference','counterparty')),
  "mode" text not null check (mode in ('contains','equals')),
  "enabled" boolean not null,
  "createdAt" timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id,"tenantId") references public.tenant(owner_id,id) deferrable initially deferred
);
create table public.notification (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "key" text not null,
  "type" text not null,
  "title" text not null,
  "detail" text not null,
  "href" text not null,
  "read" boolean not null,
  "resolved" boolean not null,
  "createdAt" timestamptz not null,
  primary key (owner_id, id)
);
create table public.audit_log (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "event" text not null,
  "entityId" text not null,
  "actor" text not null,
  "detail" text not null,
  "createdAt" timestamptz not null,
  primary key (owner_id, id)
);
create table public.webhook_event (
  id uuid not null,
  owner_id text not null references public.app_user(id),
  "providerEventId" text not null,
  "type" text not null,
  "receivedAt" timestamptz not null,
  "processedAt" timestamptz,
  primary key (owner_id, id)
);

create unique index unique_bank_provider_id on public.bank_transaction(owner_id,"accountId","providerId");
create unique index unique_bank_account on public.bank_account(owner_id,"providerId");
create unique index unique_connection on public.bank_connection(owner_id,"providerId");
create unique index unique_webhook_event on public.webhook_event(owner_id,"providerEventId");
create unique index unique_rate_effective on public.rent_rate_history(owner_id,"tenancyId","effectiveDate");
create unique index unique_active_rent on public.rent_obligation(owner_id,"tenancyId","periodStart") where active;
create index rent_due on public.rent_obligation(owner_id,"dueDate") where active;
create index bank_date on public.bank_transaction(owner_id,date);
create index allocation_transaction on public.transaction_allocation(owner_id,"transactionId") where active;
create index audit_chronology on public.audit_log(owner_id,"createdAt");
create table public.job_lock (name text primary key, token uuid not null, expires_at timestamptz not null);
create table public.login_attempt (bucket text primary key, attempts integer not null, expires_at timestamptz not null);
alter table public.app_user enable row level security;
revoke all on public.app_user from anon, authenticated;
alter table public.ledger_meta enable row level security;
revoke all on public.ledger_meta from anon, authenticated;
alter table public.property enable row level security;
revoke all on public.property from anon, authenticated;
alter table public.room enable row level security;
revoke all on public.room from anon, authenticated;
alter table public.tenant enable row level security;
revoke all on public.tenant from anon, authenticated;
alter table public.tenancy enable row level security;
revoke all on public.tenancy from anon, authenticated;
alter table public.rent_rate_history enable row level security;
revoke all on public.rent_rate_history from anon, authenticated;
alter table public.rent_obligation enable row level security;
revoke all on public.rent_obligation from anon, authenticated;
alter table public.bill enable row level security;
revoke all on public.bill from anon, authenticated;
alter table public.bill_share enable row level security;
revoke all on public.bill_share from anon, authenticated;
alter table public.bank_connection enable row level security;
revoke all on public.bank_connection from anon, authenticated;
alter table public.bank_account enable row level security;
revoke all on public.bank_account from anon, authenticated;
alter table public.bank_transaction enable row level security;
revoke all on public.bank_transaction from anon, authenticated;
alter table public.transaction_allocation enable row level security;
revoke all on public.transaction_allocation from anon, authenticated;
alter table public.tenant_transaction_alias enable row level security;
revoke all on public.tenant_transaction_alias from anon, authenticated;
alter table public.matching_rule enable row level security;
revoke all on public.matching_rule from anon, authenticated;
alter table public.notification enable row level security;
revoke all on public.notification from anon, authenticated;
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
alter table public.webhook_event enable row level security;
revoke all on public.webhook_event from anon, authenticated;
alter table public.job_lock enable row level security;
revoke all on public.job_lock from anon, authenticated;
alter table public.login_attempt enable row level security;
revoke all on public.login_attempt from anon, authenticated;

-- No browser can read the ledger directly, even using the public Supabase key.
-- The server's service-role key is the only role granted access to these RPCs.
create function public.ledger_snapshot(p_owner text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 select jsonb_build_object('revision',m.revision,'settings',m.settings,'user',to_jsonb(u)) into result from ledger_meta m join app_user u on u.id=m.owner_id where m.owner_id=p_owner;
 if result is null then return null; end if;
result := result || jsonb_build_object('properties',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from property t where owner_id=p_owner));
result := result || jsonb_build_object('rooms',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from room t where owner_id=p_owner));
result := result || jsonb_build_object('tenants',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from tenant t where owner_id=p_owner));
result := result || jsonb_build_object('tenancies',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from tenancy t where owner_id=p_owner));
result := result || jsonb_build_object('rentRates',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from rent_rate_history t where owner_id=p_owner));
result := result || jsonb_build_object('rents',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from rent_obligation t where owner_id=p_owner));
result := result || jsonb_build_object('bills',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from bill t where owner_id=p_owner));
result := result || jsonb_build_object('billShares',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from bill_share t where owner_id=p_owner));
result := result || jsonb_build_object('connections',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from bank_connection t where owner_id=p_owner));
result := result || jsonb_build_object('accounts',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from bank_account t where owner_id=p_owner));
result := result || jsonb_build_object('transactions',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from bank_transaction t where owner_id=p_owner));
result := result || jsonb_build_object('allocations',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from transaction_allocation t where owner_id=p_owner));
result := result || jsonb_build_object('aliases',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from tenant_transaction_alias t where owner_id=p_owner));
result := result || jsonb_build_object('rules',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from matching_rule t where owner_id=p_owner));
result := result || jsonb_build_object('notifications',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from notification t where owner_id=p_owner));
result := result || jsonb_build_object('audit',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from audit_log t where owner_id=p_owner));
result := result || jsonb_build_object('webhookEvents',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from webhook_event t where owner_id=p_owner));
return result; end $$;

create function public.ledger_commit(p_owner text, p_expected bigint, p_state jsonb) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare current_revision bigint; next_revision bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('rentledger:'||p_owner,0));
 if p_state->'user'->>'id' <> p_owner then raise exception 'owner mismatch'; end if;
 select revision into current_revision from ledger_meta where owner_id=p_owner for update;
 if current_revision is null then
  if p_expected <> 0 then raise exception 'revision_conflict' using errcode='40001'; end if;
  insert into app_user select * from jsonb_populate_record(null::app_user,p_state->'user');
  insert into ledger_meta values(p_owner,0,p_state->'settings'); current_revision:=0;
 end if;
 if current_revision <> p_expected then raise exception 'revision_conflict' using errcode='40001'; end if;

 update rent_obligation r set active=false where r.owner_id=p_owner and r.id in (select (v->>'id')::uuid from jsonb_array_elements(p_state->'rents') v where v->>'active'='false');
insert into property ("id", "owner_id", "name", "address", "archived") select "id", "owner_id", "name", "address", "archived" from jsonb_populate_recordset(null::property,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'properties') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "name"=excluded."name", "address"=excluded."address", "archived"=excluded."archived";
insert into room ("id", "owner_id", "propertyId", "name", "archived") select "id", "owner_id", "propertyId", "name", "archived" from jsonb_populate_recordset(null::room,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'rooms') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "propertyId"=excluded."propertyId", "name"=excluded."name", "archived"=excluded."archived";
insert into tenant ("id", "owner_id", "name", "email", "notes", "active") select "id", "owner_id", "name", "email", "notes", "active" from jsonb_populate_recordset(null::tenant,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'tenants') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "name"=excluded."name", "email"=excluded."email", "notes"=excluded."notes", "active"=excluded."active";
insert into tenancy ("id", "owner_id", "tenantId", "roomId", "startDate", "endDate", "paymentDay", "graceDays", "active") select "id", "owner_id", "tenantId", "roomId", "startDate", "endDate", "paymentDay", "graceDays", "active" from jsonb_populate_recordset(null::tenancy,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'tenancies') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "tenantId"=excluded."tenantId", "roomId"=excluded."roomId", "startDate"=excluded."startDate", "endDate"=excluded."endDate", "paymentDay"=excluded."paymentDay", "graceDays"=excluded."graceDays", "active"=excluded."active";
insert into rent_rate_history ("id", "owner_id", "tenancyId", "effectiveDate", "weeklyCents", "createdAt") select "id", "owner_id", "tenancyId", "effectiveDate", "weeklyCents", "createdAt" from jsonb_populate_recordset(null::rent_rate_history,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'rentRates') v),'[]'::jsonb)) on conflict(owner_id,id) do nothing;
insert into rent_obligation ("id", "owner_id", "tenancyId", "tenantId", "propertyId", "periodStart", "periodEnd", "dueDate", "amountCents", "rateSnapshot", "active", "waived", "waiverReason", "createdAt") select "id", "owner_id", "tenancyId", "tenantId", "propertyId", "periodStart", "periodEnd", "dueDate", "amountCents", "rateSnapshot", "active", "waived", "waiverReason", "createdAt" from jsonb_populate_recordset(null::rent_obligation,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'rents') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "tenancyId"=excluded."tenancyId", "tenantId"=excluded."tenantId", "propertyId"=excluded."propertyId", "periodStart"=excluded."periodStart", "periodEnd"=excluded."periodEnd", "dueDate"=excluded."dueDate", "amountCents"=excluded."amountCents", "rateSnapshot"=excluded."rateSnapshot", "active"=excluded."active", "waived"=excluded."waived", "waiverReason"=excluded."waiverReason", "createdAt"=excluded."createdAt";
insert into bill ("id", "owner_id", "propertyId", "name", "category", "supplier", "supplierAlias", "amountCents", "billDate", "dueDate", "notes", "divider", "ownerShareCents", "active", "createdAt") select "id", "owner_id", "propertyId", "name", "category", "supplier", "supplierAlias", "amountCents", "billDate", "dueDate", "notes", "divider", "ownerShareCents", "active", "createdAt" from jsonb_populate_recordset(null::bill,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'bills') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "propertyId"=excluded."propertyId", "name"=excluded."name", "category"=excluded."category", "supplier"=excluded."supplier", "supplierAlias"=excluded."supplierAlias", "amountCents"=excluded."amountCents", "billDate"=excluded."billDate", "dueDate"=excluded."dueDate", "notes"=excluded."notes", "divider"=excluded."divider", "ownerShareCents"=excluded."ownerShareCents", "active"=excluded."active", "createdAt"=excluded."createdAt";
insert into bill_share ("id", "owner_id", "billId", "tenantId", "amountCents", "dueDate", "active", "waived", "waiverReason") select "id", "owner_id", "billId", "tenantId", "amountCents", "dueDate", "active", "waived", "waiverReason" from jsonb_populate_recordset(null::bill_share,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'billShares') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "billId"=excluded."billId", "tenantId"=excluded."tenantId", "amountCents"=excluded."amountCents", "dueDate"=excluded."dueDate", "active"=excluded."active", "waived"=excluded."waived", "waiverReason"=excluded."waiverReason";
insert into bank_connection ("id", "owner_id", "providerId", "institution", "status", "consentExpiresAt", "providerRefreshedAt", "lastSyncedAt", "lastAttemptAt", "error") select "id", "owner_id", "providerId", "institution", "status", "consentExpiresAt", "providerRefreshedAt", "lastSyncedAt", "lastAttemptAt", "error" from jsonb_populate_recordset(null::bank_connection,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'connections') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "providerId"=excluded."providerId", "institution"=excluded."institution", "status"=excluded."status", "consentExpiresAt"=excluded."consentExpiresAt", "providerRefreshedAt"=excluded."providerRefreshedAt", "lastSyncedAt"=excluded."lastSyncedAt", "lastAttemptAt"=excluded."lastAttemptAt", "error"=excluded."error";
insert into bank_account ("id", "owner_id", "connectionId", "providerId", "name", "maskedNumber", "currency", "selected", "propertyId", "balanceCents", "balanceObservedAt", "balanceFreshness", "lastSyncedAt", "coverageFrom") select "id", "owner_id", "connectionId", "providerId", "name", "maskedNumber", "currency", "selected", "propertyId", "balanceCents", "balanceObservedAt", "balanceFreshness", "lastSyncedAt", "coverageFrom" from jsonb_populate_recordset(null::bank_account,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'accounts') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "connectionId"=excluded."connectionId", "providerId"=excluded."providerId", "name"=excluded."name", "maskedNumber"=excluded."maskedNumber", "currency"=excluded."currency", "selected"=excluded."selected", "propertyId"=excluded."propertyId", "balanceCents"=excluded."balanceCents", "balanceObservedAt"=excluded."balanceObservedAt", "balanceFreshness"=excluded."balanceFreshness", "lastSyncedAt"=excluded."lastSyncedAt", "coverageFrom"=excluded."coverageFrom";
insert into bank_transaction ("id", "owner_id", "accountId", "providerId", "date", "postedDate", "description", "reference", "counterparty", "amountCents", "direction", "bankStatus", "status", "tenantId", "confidence", "reasons", "fingerprint", "ignored", "autoMatchDisabled", "createdAt", "updatedAt") select "id", "owner_id", "accountId", "providerId", "date", "postedDate", "description", "reference", "counterparty", "amountCents", "direction", "bankStatus", "status", "tenantId", "confidence", "reasons", "fingerprint", "ignored", "autoMatchDisabled", "createdAt", "updatedAt" from jsonb_populate_recordset(null::bank_transaction,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'transactions') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "accountId"=excluded."accountId", "providerId"=excluded."providerId", "date"=excluded."date", "postedDate"=excluded."postedDate", "description"=excluded."description", "reference"=excluded."reference", "counterparty"=excluded."counterparty", "amountCents"=excluded."amountCents", "direction"=excluded."direction", "bankStatus"=excluded."bankStatus", "status"=excluded."status", "tenantId"=excluded."tenantId", "confidence"=excluded."confidence", "reasons"=excluded."reasons", "fingerprint"=excluded."fingerprint", "ignored"=excluded."ignored", "autoMatchDisabled"=excluded."autoMatchDisabled", "createdAt"=excluded."createdAt", "updatedAt"=excluded."updatedAt";
insert into transaction_allocation ("id", "owner_id", "transactionId", "kind", "rentId", "billShareId", "billId", "tenantId", "propertyId", "category", "amountCents", "active", "source", "reasons", "createdAt", "removedAt", "removalReason") select "id", "owner_id", "transactionId", "kind", "rentId", "billShareId", "billId", "tenantId", "propertyId", "category", "amountCents", "active", "source", "reasons", "createdAt", "removedAt", "removalReason" from jsonb_populate_recordset(null::transaction_allocation,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'allocations') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "transactionId"=excluded."transactionId", "kind"=excluded."kind", "rentId"=excluded."rentId", "billShareId"=excluded."billShareId", "billId"=excluded."billId", "tenantId"=excluded."tenantId", "propertyId"=excluded."propertyId", "category"=excluded."category", "amountCents"=excluded."amountCents", "active"=excluded."active", "source"=excluded."source", "reasons"=excluded."reasons", "createdAt"=excluded."createdAt", "removedAt"=excluded."removedAt", "removalReason"=excluded."removalReason";
insert into tenant_transaction_alias ("id", "owner_id", "tenantId", "text", "active") select "id", "owner_id", "tenantId", "text", "active" from jsonb_populate_recordset(null::tenant_transaction_alias,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'aliases') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "tenantId"=excluded."tenantId", "text"=excluded."text", "active"=excluded."active";
insert into matching_rule ("id", "owner_id", "tenantId", "text", "field", "mode", "enabled", "createdAt") select "id", "owner_id", "tenantId", "text", "field", "mode", "enabled", "createdAt" from jsonb_populate_recordset(null::matching_rule,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'rules') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "tenantId"=excluded."tenantId", "text"=excluded."text", "field"=excluded."field", "mode"=excluded."mode", "enabled"=excluded."enabled", "createdAt"=excluded."createdAt";
insert into notification ("id", "owner_id", "key", "type", "title", "detail", "href", "read", "resolved", "createdAt") select "id", "owner_id", "key", "type", "title", "detail", "href", "read", "resolved", "createdAt" from jsonb_populate_recordset(null::notification,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'notifications') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "key"=excluded."key", "type"=excluded."type", "title"=excluded."title", "detail"=excluded."detail", "href"=excluded."href", "read"=excluded."read", "resolved"=excluded."resolved", "createdAt"=excluded."createdAt";
insert into audit_log ("id", "owner_id", "event", "entityId", "actor", "detail", "createdAt") select "id", "owner_id", "event", "entityId", "actor", "detail", "createdAt" from jsonb_populate_recordset(null::audit_log,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'audit') v),'[]'::jsonb)) on conflict(owner_id,id) do nothing;
insert into webhook_event ("id", "owner_id", "providerEventId", "type", "receivedAt", "processedAt") select "id", "owner_id", "providerEventId", "type", "receivedAt", "processedAt" from jsonb_populate_recordset(null::webhook_event,coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'webhookEvents') v),'[]'::jsonb)) on conflict(owner_id,id) do update set "providerEventId"=excluded."providerEventId", "type"=excluded."type", "receivedAt"=excluded."receivedAt", "processedAt"=excluded."processedAt";

 -- Database-level allocation invariants are checked inside the same transaction.
 if exists(select 1 from transaction_allocation a join bank_transaction t on t.owner_id=a.owner_id and t.id=a."transactionId" where a.owner_id=p_owner and a.active group by t.id,t."amountCents",t.direction,t."bankStatus",t.ignored having sum(a."amountCents")>t."amountCents" or count(distinct a."tenantId")>1 or t."bankStatus"<>'posted' or t.ignored) then raise exception 'invalid bank allocation'; end if;
 if exists(select 1 from transaction_allocation a join bank_transaction t on t.owner_id=a.owner_id and t.id=a."transactionId" join bank_account ac on ac.owner_id=t.owner_id and ac.id=t."accountId" where a.owner_id=p_owner and a.active and (ac."propertyId" is distinct from a."propertyId" or (a.kind in ('rent','reimbursement','other_income')) <> (t.direction='credit'))) then raise exception 'allocation property or direction mismatch'; end if;
 if exists(select 1 from transaction_allocation a left join rent_obligation r on r.owner_id=a.owner_id and r.id=a."rentId" left join bill_share sh on sh.owner_id=a.owner_id and sh.id=a."billShareId" left join bill b on b.owner_id=a.owner_id and b.id=a."billId" where a.owner_id=p_owner and a.active and ((a.kind='rent' and (r.id is null or not r.active or r.waived or r."tenantId" is distinct from a."tenantId" or r."propertyId" is distinct from a."propertyId")) or (a.kind='reimbursement' and (sh.id is null or not sh.active or sh.waived or sh."tenantId" is distinct from a."tenantId" or sh."billId" is distinct from a."billId" or b."propertyId" is distinct from a."propertyId")) or (a.kind='expense' and (b.id is null or not b.active or b."propertyId" is distinct from a."propertyId")))) then raise exception 'invalid obligation target'; end if;
 if exists(select 1 from rent_obligation r join transaction_allocation a on a.owner_id=r.owner_id and a."rentId"=r.id and a.active where r.owner_id=p_owner group by r.id,r."amountCents" having sum(a."amountCents")>r."amountCents") then raise exception 'rent overallocated'; end if;
 if exists(select 1 from bill_share r join transaction_allocation a on a.owner_id=r.owner_id and a."billShareId"=r.id and a.active where r.owner_id=p_owner group by r.id,r."amountCents" having sum(a."amountCents")>r."amountCents") then raise exception 'bill share overallocated'; end if;
 if exists(select 1 from bill b join transaction_allocation a on a.owner_id=b.owner_id and a."billId"=b.id and a.kind='expense' and a.active where b.owner_id=p_owner group by b.id,b."amountCents" having sum(a."amountCents")>b."amountCents") then raise exception 'bill expense overallocated'; end if;
 if exists(select 1 from bill b left join bill_share sh on sh.owner_id=b.owner_id and sh."billId"=b.id and sh.active where b.owner_id=p_owner and b.active group by b.id,b."amountCents",b."ownerShareCents" having coalesce(sum(sh."amountCents"),0)+b."ownerShareCents"<>b."amountCents") then raise exception 'bill split does not conserve money'; end if;
 next_revision:=current_revision+1;
 update ledger_meta set revision=next_revision,settings=p_state->'settings' where owner_id=p_owner;
 update app_user set name=p_state->'user'->>'name',timezone=p_state->'user'->>'timezone' where id=p_owner;
 return next_revision;
end $$;

-- Append-only histories: removal is recorded by changing active/removal fields.
create function public.protect_history() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'historical records cannot be deleted'; end if;
 if tg_table_name='rent_obligation' and (to_jsonb(old)-array['active','waived','waiverReason']) is distinct from (to_jsonb(new)-array['active','waived','waiverReason']) then raise exception 'rent history is immutable'; end if;
 if tg_table_name='transaction_allocation' and (to_jsonb(old)-array['active','removedAt','removalReason']) is distinct from (to_jsonb(new)-array['active','removedAt','removalReason']) then raise exception 'allocation history is immutable'; end if;
 if tg_table_name in ('audit_log','rent_rate_history') then raise exception 'append-only history'; end if;
 return new;
end $$;
create trigger protect_rent_history before update or delete on public.rent_obligation for each row execute function public.protect_history();
create trigger protect_allocation_history before update or delete on public.transaction_allocation for each row execute function public.protect_history();
create trigger protect_audit_history before update or delete on public.audit_log for each row execute function public.protect_history();
create trigger protect_rate_history before update or delete on public.rent_rate_history for each row execute function public.protect_history();

create function public.claim_job(p_name text,p_token uuid,p_seconds integer default 240) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 insert into job_lock values(p_name,p_token,now()+make_interval(secs=>least(p_seconds,600))) on conflict(name) do update set token=excluded.token,expires_at=excluded.expires_at where job_lock.expires_at<now();
 get diagnostics n=row_count;return n>0;
end $$;
create function public.release_job(p_name text,p_token uuid) returns void language sql security definer set search_path=public,pg_temp as $$ delete from job_lock where name=p_name and token=p_token $$;
create function public.login_allowed(p_bucket text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
 insert into login_attempt values(p_bucket,1,now()+interval '15 minutes') on conflict(bucket) do update set attempts=case when login_attempt.expires_at<now() then 1 else login_attempt.attempts+1 end,expires_at=case when login_attempt.expires_at<now() then now()+interval '15 minutes' else login_attempt.expires_at end returning attempts into n;
 return n<=10;
end $$;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.ledger_snapshot(text), public.ledger_commit(text,bigint,jsonb), public.claim_job(text,uuid,integer), public.release_job(text,uuid), public.login_allowed(text) to service_role;
