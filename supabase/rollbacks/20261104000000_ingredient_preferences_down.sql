-- Rollback for migrations/20261104000000_ingredient_preferences.sql. Not a migration: run it
-- by hand with psql. Restores safe_recipes() as it was in 20261015000001.
-- avoid_ingredients is kept on purpose. It's harmless to the old app, and dropping it would
-- delete what users saved. Only drop it once nothing reads it:
--   alter table public.user_preferences drop column avoid_ingredients;
create or replace function public.safe_recipes()
returns setof public.recipes
language sql
stable
security invoker
set search_path = public
as $$
  with prefs as (
    select allergies, diet,
           array(select regexp_replace(lower(trim(s)), '(es|s)$', '') from unnest(skip_ingredients) s where length(trim(s)) >= 3) as skips
    from user_preferences where user_id = auth.uid()
  )
  select r.*
  from recipes r
  left join prefs p on true
  where r.meal_role is not null
    and not (r.allergens && coalesce(p.allergies, '{}'))
    and (coalesce(p.diet, 'none') = 'none' or r.diets @> array[p.diet])
    and not exists (
      select 1 from unnest(coalesce(p.skips, '{}')) s
      where lower(r.name) like '%' || s || '%'
         or exists (select 1 from unnest(r.ingredient_names) n where n like '%' || s || '%')
    )
$$;

grant execute on function public.safe_recipes() to anon, authenticated;
