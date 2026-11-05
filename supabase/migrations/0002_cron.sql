-- Lingua Quest Online – phase 2: server bot helper table + pg_cron job that calls the `scheduler` Edge Function
-- every 5 minutes. Safe to run with `supabase db push`: the project URL and the shared secret are NOT written here,
-- they are read at run time from Supabase Vault (create them once, see step 2 below and supabase/README.md).

-- ---------- 1. bot_pending: short-lived values behind Telegram inline buttons ----------
-- Telegram callback data is limited to 64 bytes and Edge Functions keep no memory, so the bot stores the card being
-- reviewed, a quiz, a word to save or a report here and puts only the short id in the button. Rows older than 2 days
-- are removed by the scheduler. user_id is null only for "failed link attempts of a chat" (brute-force limit).
create table if not exists public.bot_pending (
  id text primary key check (length(id) between 1 and 40),
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null check (kind in ('review', 'word', 'quiz', 'report', 'linkfail')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bot_pending_user_idx on public.bot_pending (user_id, kind, created_at desc);
create index if not exists bot_pending_created_idx on public.bot_pending (created_at);
-- Only the Edge Functions (service role) use it: RLS on, no policy for anon/authenticated.
alter table public.bot_pending enable row level security;

-- Helps the scheduler's per-user notification_log lookups.
create index if not exists notification_log_sent_idx on public.notification_log (user_id, sent_at desc);

-- ---------- 2. secrets for the cron job (run ONCE in the SQL Editor, not part of this migration) ----------
-- Replace the placeholders and run these two lines yourself (Dashboard → SQL Editor):
--
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'lq_project_url');
--   select vault.create_secret('<SCHEDULER_SECRET – the same value as the Edge Function secret>', 'lq_scheduler_secret');
--
-- To change them later: select vault.update_secret((select id from vault.secrets where name = 'lq_scheduler_secret'), '<new>');

-- ---------- 3. pg_cron + pg_net: call the scheduler every 5 minutes ----------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running the migration replaces the job instead of adding a second one.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lq-scheduler') then
    perform cron.unschedule('lq-scheduler');
  end if;
end $$;

select cron.schedule(
  'lq-scheduler',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lq_project_url') || '/functions/v1/scheduler',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lq_scheduler_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'lq_project_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'lq_scheduler_secret');
  $job$
);

-- Check: select * from cron.job;  select * from cron.job_run_details order by start_time desc limit 5;
--        select id, status_code, content from net._http_response order by created desc limit 5;
-- Stop:  select cron.unschedule('lq-scheduler');
