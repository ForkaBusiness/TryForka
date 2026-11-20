-- Forka Pro: every meal, and a goal for each person. Additive: three settings columns.
-- Both tables already have row level security (each household reads and writes only its
-- own rows), which these columns inherit.
--
--   user_preferences.plan_snacks     plan an afternoon snack each day (Pro)
--   family_members.school_lunch      this child gets a packed school lunch on weekdays (Pro)
--   family_members.goal, goal_calories, goal_protein
--                                    an optional goal for this person (Pro): a calorie or
--                                    protein target, or a general one. Safe ranges are
--                                    enforced here too, and children can only have general
--                                    goals, never numbers (src/lib/portions.ts validates
--                                    the same rules first, with plain words).
--
-- Rollback: supabase/rollbacks/20261124_pro_meals_and_goals_down.sql

alter table public.user_preferences
  add column if not exists plan_snacks boolean not null default false;

alter table public.family_members
  add column if not exists school_lunch boolean not null default false,
  add column if not exists goal text not null default 'none'
    check (goal in ('none', 'calories', 'protein', 'more_protein', 'lighter', 'growing_kid')),
  add column if not exists goal_calories integer check (goal_calories is null or goal_calories between 1200 and 4000),
  add column if not exists goal_protein integer check (goal_protein is null or goal_protein between 20 and 250);

alter table public.family_members drop constraint if exists family_members_kid_goals;
alter table public.family_members add constraint family_members_kid_goals
  check (kind <> 'kid' or (goal in ('none', 'more_protein', 'growing_kid') and goal_calories is null and goal_protein is null));
