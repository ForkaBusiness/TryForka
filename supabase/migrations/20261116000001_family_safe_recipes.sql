-- The per-user recipe filter, now counting every person in the family. Additive: a new
-- function beside safe_recipes(), which is left exactly as it is for app versions that
-- still call it.
--
-- family_safe_recipes() is safe_recipes() with one difference: the allergies it filters by
-- are the household's (user_preferences.allergies) plus each person's
-- (family_members.allergies). Diet and skipped ingredients are the household's, as before.
-- Like safe_recipes() it is a coarse first pass: the app's recipe filter (recipeFilter.ts)
-- runs on everything it returns and is the source of truth. SQL can be looser than that
-- filter, never stricter.
--
-- Security invoker: row level security on user_preferences and family_members applies, so
-- a caller only ever reads their own family. Signed-out callers (no auth.uid()) get the
-- unfiltered, classified catalog, as with safe_recipes().
create or replace function public.family_safe_recipes()
returns setof public.recipes
language sql
stable
security invoker
set search_path = public
as $$
  with household as (
    -- One row even when the user has no user_preferences row yet.
    select
      coalesce((select p.allergies from user_preferences p where p.user_id = auth.uid()), '{}')
        || coalesce((select array_agg(a) from family_members m cross join lateral unnest(m.allergies) a where m.user_id = auth.uid()), '{}') as allergies,
      coalesce((select p.skip_ingredients from user_preferences p where p.user_id = auth.uid()), '{}') as skip_ingredients,
      coalesce((select p.diet from user_preferences p where p.user_id = auth.uid()), 'none') as diet
  ),
  prefs as (
    select allergies || array(select s from unnest(skip_ingredients) s where s = any (array['dairy', 'gluten', 'fish', 'shellfish', 'tree_nut'])) as allergens,
           diet,
           array(
             select '\m' || regexp_replace(regexp_replace(t, '(es|s)$', ''), '([^[:alnum:][:space:]])', '\\\1', 'g') || 'e?s?\M(?! oil| tomato| lettuce)'
             from (
               select lower(trim(s)) as t from unnest(skip_ingredients) s
               union all
               select lower(trim(a)) from unnest(allergies) a
               where lower(trim(a)) <> all (array['dairy', 'egg', 'gluten', 'peanut', 'tree_nut', 'soy', 'fish', 'shellfish', 'sesame'])
             ) terms
             where length(t) >= 3
           ) as skips
    from household
  )
  select r.*
  from recipes r
  cross join prefs p
  where r.meal_role is not null
    and not (r.allergens && p.allergens)
    and (p.diet = 'none' or r.diets @> array[p.diet])
    and not exists (
      select 1 from unnest(p.skips) s
      where lower(r.name) ~ s
         or exists (select 1 from unnest(r.ingredient_names) n where n ~ s)
    )
$$;

grant execute on function public.family_safe_recipes() to anon, authenticated;
