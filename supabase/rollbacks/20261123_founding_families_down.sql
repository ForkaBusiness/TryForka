-- Rollback for 20261123000000_founding_families.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261123_founding_families_down.sql
--
-- Founding families go back to Free. Their rows stay (with their usage counts); only the
-- plan columns change. Nothing in Stripe is touched (founding families have no
-- subscription).

begin;

update public.user_plans
   set plan = 'free', billing_status = 'none', founding = false, updated_at = now()
 where founding = true;

delete from supabase_migrations.schema_migrations where version = '20261123000000';

commit;
