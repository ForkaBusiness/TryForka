-- Rollback for 20261120000000_ingredient_nutrition_owner.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261120_ingredient_nutrition_owner_down.sql
--
-- Rows that were private to a household become readable by every signed-in user again
-- (the column holding their owner is dropped). Redeploy a nutrition function that doesn't
-- write owner_id first, or its cache writes will fail until it is.

begin;

drop policy if exists "Household ingredients stay private" on public.ingredient_nutrition;
drop index if exists public.ingredient_nutrition_owner;
alter table public.ingredient_nutrition drop column if exists owner_id;

delete from supabase_migrations.schema_migrations where version = '20261120000000';

commit;
