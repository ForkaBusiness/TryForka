-- Founding families: every account that existed before Forka Pro launched gets Pro for
-- life, marked founding, except test accounts (app_metadata.test_account, the QA account).
-- Data only, additive: a user_plans row is added (or set) for each; nothing is removed.
-- Founding rows are never changed by Stripe (_shared/billing/state.ts subscriptionPatch).
--
-- The same rule as isFoundingFamily() in _shared/billing/state.ts (FOUNDING_CUTOFF), tested
-- in tests/billing.test.ts. Accounts created after the cutoff start on Free.
--
-- Rollback: supabase/rollbacks/20261123_founding_families_down.sql

insert into public.user_plans (user_id, plan, billing_status, founding)
select u.id, 'pro', 'founding', true
from auth.users u
where u.created_at < timestamptz '2026-11-19 18:00:00+00'
  and coalesce((u.raw_app_meta_data ->> 'test_account')::boolean, false) = false
on conflict (user_id) do update
  set plan = 'pro', billing_status = 'founding', founding = true, pro_until = null, updated_at = now()
  where public.user_plans.founding = false;
