from pathlib import Path
# Canonical typed records correspond to lib/engine/types.ts. SQL columns preserve
# the same names to keep the server-only PostgREST RPC boundary lossless.
spec={
 'properties':('property','name text not null, address text not null, archived boolean not null'),
 'rooms':('room','propertyId uuid not null, name text not null, archived boolean not null'),
 'tenants':('tenant','name text not null, email text not null, notes text not null, active boolean not null'),
 'tenancies':('tenancy','tenantId uuid not null, roomId uuid not null, startDate date not null, endDate date, paymentDay integer not null check ("paymentDay" between 0 and 6), graceDays integer not null check ("graceDays" between 0 and 30), active boolean not null'),
 'rentRates':('rent_rate_history','tenancyId uuid not null, effectiveDate date not null, weeklyCents bigint not null check ("weeklyCents" > 0), createdAt timestamptz not null'),
 'rents':('rent_obligation','tenancyId uuid not null, tenantId uuid not null, propertyId uuid not null, periodStart date not null, periodEnd date not null, dueDate date not null, amountCents bigint not null check ("amountCents" > 0), rateSnapshot text not null, active boolean not null, waived boolean not null, waiverReason text, createdAt timestamptz not null'),
 'bills':('bill','propertyId uuid not null, name text not null, category text not null, supplier text not null, supplierAlias text not null, amountCents bigint not null check ("amountCents" > 0), billDate date not null, dueDate date not null, notes text not null, divider integer not null check (divider between 1 and 100), ownerShareCents bigint not null check ("ownerShareCents" >= 0), active boolean not null, createdAt timestamptz not null'),
 'billShares':('bill_share','billId uuid not null, tenantId uuid not null, amountCents bigint not null check ("amountCents" >= 0), dueDate date not null, active boolean not null, waived boolean not null, waiverReason text'),
 'connections':('bank_connection','providerId text not null, institution text not null, status text not null, consentExpiresAt timestamptz, providerRefreshedAt timestamptz, lastSyncedAt timestamptz, lastAttemptAt timestamptz, error text'),
 'accounts':('bank_account','connectionId uuid not null, providerId text not null, name text not null, maskedNumber text not null, currency text not null check (currency = \'aud\'), selected boolean not null, propertyId uuid, balanceCents bigint, balanceObservedAt timestamptz, balanceFreshness text, lastSyncedAt timestamptz, coverageFrom date'),
 'transactions':('bank_transaction','accountId uuid not null, providerId text not null, date date not null, postedDate date, description text not null, reference text not null, counterparty text not null, amountCents bigint not null check ("amountCents" > 0), direction text not null check (direction in (\'credit\',\'debit\')), bankStatus text not null check ("bankStatus" in (\'posted\',\'pending\')), status text not null check (status in (\'Matched\',\'Partially Allocated\',\'Unmatched\',\'Ignored\',\'Needs Review\')), tenantId uuid, confidence integer, reasons jsonb not null, fingerprint text not null, ignored boolean not null, autoMatchDisabled boolean not null, createdAt timestamptz not null, updatedAt timestamptz not null'),
 'allocations':('transaction_allocation','transactionId uuid not null, kind text not null check (kind in (\'rent\',\'reimbursement\',\'expense\',\'other_income\',\'other_expense\')), rentId uuid, billShareId uuid, billId uuid, tenantId uuid, propertyId uuid not null, category text not null, amountCents bigint not null check ("amountCents" > 0), active boolean not null, source text not null check (source in (\'automatic\',\'manual\')), reasons jsonb not null, createdAt timestamptz not null, removedAt timestamptz, removalReason text'),
 'aliases':('tenant_transaction_alias','tenantId uuid not null, text text not null, active boolean not null'),
 'rules':('matching_rule','tenantId uuid not null, text text not null, field text not null check (field in (\'any\',\'description\',\'reference\',\'counterparty\')), mode text not null check (mode in (\'contains\',\'equals\')), enabled boolean not null, createdAt timestamptz not null'),
 'notifications':('notification','key text not null, type text not null, title text not null, detail text not null, href text not null, read boolean not null, resolved boolean not null, createdAt timestamptz not null'),
 'audit':('audit_log','event text not null, entityId text not null, actor text not null, detail text not null, createdAt timestamptz not null'),
 'webhookEvents':('webhook_event','providerEventId text not null, type text not null, receivedAt timestamptz not null, processedAt timestamptz')}
fks={'propertyId':'property','roomId':'room','tenantId':'tenant','tenancyId':'tenancy','billId':'bill','connectionId':'bank_connection','accountId':'bank_account','transactionId':'bank_transaction','rentId':'rent_obligation','billShareId':'bill_share'}
# Split on comma only outside SQL parentheses.
def cols(s):
 out=[];depth=0;start=0
 for i,c in enumerate(s):
  if c=='(':depth+=1
  elif c==')':depth-=1
  elif c==',' and depth==0:out.append(s[start:i].strip());start=i+1
 out.append(s[start:].strip());return out
sql='''-- Rentledger: personal owner, relational PostgreSQL ledger. Money is BIGINT
-- cents (fixed precision); calendar dates and UTC timestamps are distinct.
-- Run through `supabase db push` or the Supabase SQL editor as project owner.
create table public.app_user (id text primary key, name text not null, timezone text not null, "createdAt" timestamptz not null);
create table public.ledger_meta (owner_id text primary key references public.app_user(id), revision bigint not null default 0, settings jsonb not null);
'''
for key,(table,raw) in spec.items():
 cs=cols(raw);defs=['id uuid not null','owner_id text not null references public.app_user(id)']
 for c in cs:
  name,rest=c.split(' ',1);defs.append('"'+name+'" '+rest)
 defs.append('primary key (owner_id, id)')
 for c in cs:
  name=c.split(' ')[0]
  if name in fks:defs.append('foreign key (owner_id,"'+name+'") references public.'+fks[name]+'(owner_id,id) deferrable initially deferred')
 sql+='create table public.'+table+' (\n  '+',\n  '.join(defs)+'\n);\n'
sql+='''
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
'''
for table in ['app_user','ledger_meta',*[v[0] for v in spec.values()],'job_lock','login_attempt']:
 sql+=f'alter table public.{table} enable row level security;\nrevoke all on public.{table} from anon, authenticated;\n'
sql+='''
-- No browser can read the ledger directly, even using the public Supabase key.
-- The server's service-role key is the only role granted access to these RPCs.
create function public.ledger_snapshot(p_owner text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 select jsonb_build_object('revision',m.revision,'settings',m.settings,'user',to_jsonb(u)) into result from ledger_meta m join app_user u on u.id=m.owner_id where m.owner_id=p_owner;
 if result is null then return null; end if;
'''
for key,(table,_) in spec.items():
 sql+=f"result := result || jsonb_build_object('{key}',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from {table} t where owner_id=p_owner));\n"
sql+='return result; end $$;\n'
sql+='''
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
'''
# Important: deactivate superseded records before unique-active inserts.
sql+='''
 update rent_obligation r set active=false where r.owner_id=p_owner and r.id in (select (v->>'id')::uuid from jsonb_array_elements(p_state->'rents') v where v->>'active'='false');
'''
for key,(table,raw) in spec.items():
 names=['id','owner_id']+[c.split(' ')[0] for c in cols(raw)]
 namelist=', '.join('"'+n+'"' for n in names)
 update=', '.join('"'+n+'"=excluded."'+n+'"' for n in names if n not in ['id','owner_id'])
 # Rows are inserted in their foreign-key order. No physical deletes.
 conflict='do nothing' if key in ['audit','rentRates'] else 'do update set '+update
 sql+=f'''insert into {table} ({namelist}) select {namelist} from jsonb_populate_recordset(null::{table},coalesce((select jsonb_agg(v || jsonb_build_object('owner_id',p_owner)) from jsonb_array_elements(p_state->'{key}') v),'[]'::jsonb)) on conflict(owner_id,id) {conflict};\n'''
sql+='''
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
'''
Path('supabase/migrations/202609280001_initial_ledger.sql').write_text(sql)
