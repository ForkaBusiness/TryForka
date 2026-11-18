-- Rollback for the six phase-1 migrations (20261116000000 to 20261116000005). Not a
-- migration: run it by hand only if phase 1 has to come out. It removes what those
-- migrations added and nothing else. Dropping these tables and columns deletes what users
-- saved in them since (family members, check-ins, plan events, nutrition cache, plans and
-- counters, on-hand lists, recipes taken off grocery lists); take a backup first.
begin;
drop function if exists public.usage_summary();
drop function if exists public.record_usage(text);
drop table if exists public.user_plans;
drop table if exists public.ingredient_nutrition;
alter table public.user_preferences drop column if exists on_hand, drop column if exists on_hand_at;
alter table public.grocery_lists drop column if exists excluded_recipes;
drop function if exists public.family_safe_recipes();
drop table if exists public.meal_checkins;
drop table if exists public.plan_events;
drop table if exists public.family_members;
delete from supabase_migrations.schema_migrations where version between '20261116000000' and '20261116000005';
commit;
