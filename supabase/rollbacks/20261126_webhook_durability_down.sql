-- Rollback for 20261126000000_webhook_durability.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261126_webhook_durability_down.sql
--
-- Stops the daily reconciliation and removes the event payloads and statuses, keeping
-- each event id (so duplicates are still recognized). Deploy a stripe-webhook that
-- doesn't write these columns first. The Vault secret is left in place; remove it in the
-- dashboard if wanted.

begin;

select cron.unschedule(jobid) from cron.job where jobname = 'billing-reconcile-daily';
drop table if exists public.billing_reconciliations;
drop index if exists public.stripe_events_unfinished;
alter table public.stripe_events drop constraint if exists stripe_events_status_check;
alter table public.stripe_events
  drop column if exists payload,
  drop column if exists status,
  drop column if exists attempts,
  drop column if exists locked_at,
  drop column if exists processed_at,
  drop column if exists last_error;

delete from supabase_migrations.schema_migrations where version = '20261126000000';

commit;
