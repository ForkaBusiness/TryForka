-- Run once, at the moment Forka Pro goes live (after the app with Pro is deployed):
--   supabase db query --linked -f supabase/launch/founding_at_launch.sql
--
-- Migration 20261123000000 marked every account from before 2026-11-19 18:00 UTC as a
-- founding family. Pro launches later than that, so this brings in everyone who signed up
-- in between: the same rule (lifetime Pro, never the test account), with the cutoff at the
-- moment this runs. Data only and additive: it never removes founding status, and it
-- leaves alone anyone already on a paid plan or trial. Safe to run again; a second run only
-- adds accounts created since the first.
--
-- After running it, set FOUNDING_CUTOFF in supabase/functions/_shared/billing/state.ts to
-- the launch time so the code's record of the rule matches.
-- Undo for accounts it added: supabase/rollbacks/20261123_founding_families_down.sql
-- (that rollback removes founding status from every founding family; read it first).

begin;

insert into public.user_plans (user_id, plan, billing_status, founding)
select u.id, 'pro', 'founding', true
from auth.users u
where u.created_at < now()
  and coalesce((u.raw_app_meta_data ->> 'test_account')::boolean, false) = false
on conflict (user_id) do update
  set plan = 'pro', billing_status = 'founding', founding = true, pro_until = null, updated_at = now()
  where public.user_plans.founding = false
    and public.user_plans.billing_status not in ('trialing', 'active', 'past_due');

select count(*) filter (where founding) as founding_families from public.user_plans;

commit;
