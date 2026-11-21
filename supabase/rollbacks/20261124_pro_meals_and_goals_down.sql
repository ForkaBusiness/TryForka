-- Rollback for 20261124000000_pro_meals_and_goals.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261124_pro_meals_and_goals_down.sql
--
-- Drops the snack and school lunch settings and everyone's goals. Deploy an app that
-- doesn't read these columns first, or its settings reads will fail.

begin;

alter table public.family_members drop constraint if exists family_members_kid_goals;
alter table public.family_members
  drop column if exists school_lunch,
  drop column if exists goal,
  drop column if exists goal_calories,
  drop column if exists goal_protein;
alter table public.user_preferences drop column if exists plan_snacks;

delete from supabase_migrations.schema_migrations where version = '20261124000000';

commit;
