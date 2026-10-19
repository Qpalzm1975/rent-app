-- Rentledger follow-up migration (2026-10-19). Append-only: apply after
-- 202609280001_initial_ledger.sql. Safe to run once on a live ledger; it changes
-- no financial rows.
--
-- 1. ledger_snapshot returns a bounded working set. Every request and every
--    sync step loads the snapshot and commits it back, so an ever-growing audit
--    log, notification history and webhook log would make each save slower and
--    larger (dozens of rows a day, forever). Rows outside the window stay in the
--    database untouched: ledger_commit only inserts or updates rows it is given
--    and never deletes. Recent history is unchanged for the app's own logic.
-- 2. "superseded" bank status for pending rows the bank stopped reporting.
-- 3. record_webhook_event: records a verified provider event without loading
--    or rewriting the whole ledger.

do $$ declare c text; begin
 for c in select conname from pg_constraint where conrelid='public.bank_transaction'::regclass and contype='c' and pg_get_constraintdef(oid) like '%bankStatus%' loop
  execute format('alter table public.bank_transaction drop constraint %I',c);
 end loop;
end $$;
alter table public.bank_transaction add constraint bank_transaction_bank_status_check check ("bankStatus" in ('posted','pending','superseded'));

create index if not exists notification_open on public.notification(owner_id,"createdAt") where not resolved;
create index if not exists webhook_event_open on public.webhook_event(owner_id,"receivedAt") where "processedAt" is null;

create or replace function public.ledger_snapshot(p_owner text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 select jsonb_build_object('revision',m.revision,'schemaVersion',2,'settings',m.settings,'user',to_jsonb(u)) into result from ledger_meta m join app_user u on u.id=m.owner_id where m.owner_id=p_owner;
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
-- Open notifications always; resolved ones for 45 days.
result := result || jsonb_build_object('notifications',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from notification t where owner_id=p_owner and (not resolved or "createdAt">now()-interval '45 days')));
-- The newest 1,000 audit entries (the app displays the latest 300).
result := result || jsonb_build_object('audit',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from (select * from audit_log where owner_id=p_owner order by "createdAt" desc,id desc limit 1000) t));
-- Unprocessed events always; processed ones for 45 days. Redbark keeps and can
-- redeliver events for 30 days, and the unique index still rejects older repeats.
result := result || jsonb_build_object('webhookEvents',(select coalesce(jsonb_agg(to_jsonb(t)-'owner_id' order by id),'[]'::jsonb) from webhook_event t where owner_id=p_owner and ("processedAt" is null or "receivedAt">now()-interval '45 days')));
return result; end $$;

create or replace function public.record_webhook_event(p_owner text,p_event_id text,p_type text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare inserted integer;
begin
 if p_event_id is null or length(p_event_id) not between 1 and 200 or p_type is null or length(p_type) not between 1 and 100 then raise exception 'invalid webhook event'; end if;
 -- Before the owner's ledger exists there is nothing to reconcile.
 if not exists(select 1 from ledger_meta where owner_id=p_owner) then return null; end if;
 insert into webhook_event(id,owner_id,"providerEventId","type","receivedAt","processedAt") values(gen_random_uuid(),p_owner,p_event_id,p_type,now(),null) on conflict(owner_id,"providerEventId") do nothing;
 get diagnostics inserted=row_count;
 if inserted>0 then insert into audit_log(id,owner_id,"event","entityId","actor","detail","createdAt") values(gen_random_uuid(),p_owner,'webhook_received',p_event_id,'bank',p_type,now()); end if;
 return inserted>0;
end $$;

-- Same privilege model as the initial migration: only the server's service role.
revoke all on function public.ledger_snapshot(text) from public, anon, authenticated;
revoke all on function public.record_webhook_event(text,text,text) from public, anon, authenticated;
grant execute on function public.ledger_snapshot(text), public.record_webhook_event(text,text,text) to service_role;
