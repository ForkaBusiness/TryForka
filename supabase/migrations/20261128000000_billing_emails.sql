-- Forka Pro's welcome and yearly renewal emails: what was sent, so each goes out once.
-- Additive: two nullable columns on user_plans, written by the service role only (no client
-- write policies on user_plans, as before).
--
--   welcome_sent_for       the subscription the "welcome to Forka Pro" email was sent for
--   renewal_reminder_for   the renewal date the yearly "your plan renews soon" email was sent for
--
-- Rollback: supabase/rollbacks/20261128_billing_emails_down.sql

alter table public.user_plans
  add column if not exists welcome_sent_for text,
  add column if not exists renewal_reminder_for timestamptz;
