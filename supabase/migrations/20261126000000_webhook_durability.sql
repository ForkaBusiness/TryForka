-- Stripe webhook durability. Additive.
--
-- 1. stripe_events keeps each event's full payload and where it stands:
--      received -> processing (locked) -> processed, or failed (with the error).
--    The webhook stores the event before handling it and marks it processed only after
--    the plan is written. If the function dies mid-event, the row stays "processing";
--    once its lock is older than 5 minutes, Stripe's retry (or the daily reconciliation)
--    processes it again from the stored payload. Rows from before this migration were
--    processed, so they default to "processed".
-- 2. billing_reconciliations: what each daily reconciliation run checked and fixed.
-- 3. A daily pg_cron job at 08:17 UTC calls the billing-reconcile Edge Function, which
--    compares every subscription in user_plans with Stripe, fixes mismatches, and
--    processes events left unfinished. It authenticates with a shared secret kept in
--    Vault ("billing_reconcile_secret") and in the function's secrets
--    (BILLING_RECONCILE_SECRET); without it the call is refused and nothing changes.
-- All service role only.
--
-- Rollback: supabase/rollbacks/20261126_webhook_durability_down.sql

alter table public.stripe_events
  add column if not exists payload      jsonb,
  add column if not exists status       text not null default 'processed',
  add column if not exists attempts     integer not null default 0,
  add column if not exists locked_at    timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error   text;

alter table public.stripe_events drop constraint if exists stripe_events_status_check;
alter table public.stripe_events add constraint stripe_events_status_check
  check (status in ('received', 'processing', 'processed', 'failed'));

create index if not exists stripe_events_unfinished on public.stripe_events (received_at) where status <> 'processed';

create table if not exists public.billing_reconciliations (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  checked     integer not null default 0,
  fixed       integer not null default 0,
  events_redone integer not null default 0,
  details     jsonb not null default '[]'::jsonb
);
alter table public.billing_reconciliations enable row level security;
revoke all on table public.billing_reconciliations from anon, authenticated;
-- No policies: nobody but the service role reads or writes it.

-- The daily run. Replaces a job of the same name, so applying this again is harmless.
select cron.unschedule(jobid) from cron.job where jobname = 'billing-reconcile-daily';
select cron.schedule(
  'billing-reconcile-daily',
  '17 8 * * *',
  $job$
    select net.http_post(
      url := 'https://akufkhzzqwjhssmegvof.supabase.co/functions/v1/billing-reconcile',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reconcile-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'billing_reconcile_secret'), '')
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);
