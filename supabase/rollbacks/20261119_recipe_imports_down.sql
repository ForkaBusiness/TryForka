-- Rollback for 20261119000000_recipe_imports.sql. Run by hand, only if needed:
--   supabase db query --linked -f supabase/rollbacks/20261119_recipe_imports_down.sql
--
-- WARNING: this deletes every household's own recipes (rows with owner_id set) and the
-- import log. Export them first if they should be kept:
--   select * from public.recipes where owner_id is not null;
-- Photos in the recipe-photos bucket are not deleted here (Supabase doesn't support
-- deleting storage objects from SQL): empty the bucket from the dashboard or the Storage
-- API first, then drop it with the commented line at the end.

begin;

-- Saved recipes counted as before (favorites and collections only).
create or replace function public.usage_summary()
returns table (plan text, saved_recipes integer, smart_imports integer, shopping_lists integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce((select p.plan from user_plans p where p.user_id = auth.uid()), 'free'),
    (select count(*)::int from (
       select f.recipe_id from favorites f where f.user_id = auth.uid()
       union
       select cr.recipe_id from collection_recipes cr join collections c on c.id = cr.collection_id where c.user_id = auth.uid()
     ) saved),
    coalesce((select p.smart_imports_count from user_plans p where p.user_id = auth.uid()), 0),
    0
$$;

drop policy if exists "Recipe photo owners can read" on storage.objects;
drop policy if exists "Recipe photo owners can upload" on storage.objects;
drop policy if exists "Recipe photo owners can update" on storage.objects;
drop policy if exists "Recipe photo owners can delete" on storage.objects;

drop table if exists public.import_events;

drop policy if exists "Household recipes are private" on public.recipes;
drop policy if exists "Households add their own recipes" on public.recipes;
drop policy if exists "Households edit their own recipes" on public.recipes;
drop policy if exists "Households delete their own recipes" on public.recipes;

delete from public.recipes where owner_id is not null;

alter table public.recipes drop constraint if exists recipes_household_id_range;
alter table public.recipes alter column id drop default;
drop index if exists public.recipes_owner_source;
alter table public.recipes
  drop column if exists owner_id,
  drop column if exists servings,
  drop column if exists prep_minutes,
  drop column if exists cook_minutes,
  drop column if exists notes,
  drop column if exists source_name,
  drop column if exists source_kind,
  drop column if exists source_platform,
  drop column if exists source_handle,
  drop column if exists created_at,
  drop column if exists updated_at;
drop sequence if exists public.household_recipe_ids;

-- The table-level grants as they were before (Supabase's defaults).
revoke insert, update on public.recipes from authenticated;
grant insert, update, delete, truncate on public.recipes to anon, authenticated;

delete from supabase_migrations.schema_migrations where version = '20261119000000';

commit;

-- After emptying the bucket:
-- delete from storage.buckets where id = 'recipe-photos';
