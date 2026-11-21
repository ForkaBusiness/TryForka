-- Rollback for 20261128000000_billing_emails.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261128_billing_emails_down.sql
-- Deploy a stripe-webhook and billing-reconcile that don't write these columns first.

begin;
alter table public.user_plans
  drop column if exists welcome_sent_for,
  drop column if exists renewal_reminder_for;
delete from supabase_migrations.schema_migrations where version = '20261128000000';
commit;
