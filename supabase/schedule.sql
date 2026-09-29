-- Run manually AFTER the app is deployed. Do not add this file to migrations
-- because it requires your chosen domain and secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Supabase Vault is installed by default. Create these two named secrets in
-- the Supabase dashboard Vault UI (preferred) or with vault.create_secret:
--   rentledger_origin       = https://YOUR-APP-DOMAIN
--   rentledger_cron_secret  = the exact CRON_SECRET in Vercel
-- Do not commit a copy of this file with secret values filled in.

-- Idempotent: replace this named job rather than creating duplicates.
do $$ begin
 perform cron.unschedule(jobid) from cron.job where jobname='rentledger-reconcile';
end $$;
select cron.schedule('rentledger-reconcile','*/30 * * * *',$job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='rentledger_origin') || '/api/jobs/run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='rentledger_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$job$);
-- Monitor: select * from cron.job_run_details order by start_time desc limit 20;
-- HTTP response: select id,status_code,timed_out,error_msg,created from net._http_response order by id desc limit 20;
-- Both the cron dispatch AND the HTTP response must succeed.
-- Pause: select cron.unschedule('rentledger-reconcile');
