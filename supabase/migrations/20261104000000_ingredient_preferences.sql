-- Per-ingredient dislike strength, ingredient-level allergies, and whole-word matching.
-- safe_recipes() stays a coarse first pass; the recipe filter (recipeFilter.ts) is the
-- source of truth and also expands allergen families.

-- skip_ingredients = "never show"; avoid_ingredients = "avoid if possible" (ranked last).
alter table public.user_preferences
  add column if not exists avoid_ingredients text[] not null default '{}';

-- allergies can now hold ingredient names ("mustard") beside the 9 keys; those names are
-- matched like skipped ingredients. Terms are whole words with an optional plural, so "tea"
-- no longer hides "steak" or "egg" hide "eggplant". Disliking olives doesn't reach olive oil,
-- which alone would hide a third of the catalog. Punctuation in a term is escaped because
-- users can add custom terms, and one bad pattern would otherwise break every recipe list.
-- A dislike that is a family key standing for a group ("dairy") uses the allergens column.
create or replace function public.safe_recipes()
returns setof public.recipes
language sql
stable
security invoker
set search_path = public
as $$
  with prefs as (
    select allergies || array(select s from unnest(skip_ingredients) s where s = any (array['dairy', 'gluten', 'fish', 'shellfish', 'tree_nut'])) as allergens,
           diet,
           array(
             select '\m' || regexp_replace(regexp_replace(t, '(es|s)$', ''), '([^[:alnum:][:space:]])', '\\\1', 'g') || 'e?s?\M(?! oil)'
             from (
               select lower(trim(s)) as t from unnest(skip_ingredients) s
               union all
               select lower(trim(a)) from unnest(allergies) a
               where lower(trim(a)) <> all (array['dairy', 'egg', 'gluten', 'peanut', 'tree_nut', 'soy', 'fish', 'shellfish', 'sesame'])
             ) terms
             where length(t) >= 3
           ) as skips
    from user_preferences where user_id = auth.uid()
  )
  select r.*
  from recipes r
  left join prefs p on true
  where r.meal_role is not null
    and not (r.allergens && coalesce(p.allergens, '{}'))
    and (coalesce(p.diet, 'none') = 'none' or r.diets @> array[p.diet])
    and not exists (
      select 1 from unnest(coalesce(p.skips, '{}')) s
      where lower(r.name) ~ s
         or exists (select 1 from unnest(r.ingredient_names) n where n ~ s)
    )
$$;

grant execute on function public.safe_recipes() to anon, authenticated;
