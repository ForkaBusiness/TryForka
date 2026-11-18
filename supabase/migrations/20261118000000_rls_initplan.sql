-- Row level security: call auth.uid() once per query, not once per row.
--
-- Supabase's performance advisor (auth_rls_initplan) flags policies that call auth.uid()
-- directly: Postgres then evaluates it for every row it checks. Wrapped in a select, it is
-- evaluated once per query and the result reused. Who can see and change what is exactly
-- the same; only the expressions' form changes. Each policy is altered in place (nothing
-- is dropped), and running this again changes nothing.
--
-- Rollback (by hand, only if needed): supabase/rollbacks/20261118_rls_initplan_down.sql

alter policy "Users can manage own collection recipes" on public.collection_recipes
  using (((select auth.uid()) = ( SELECT collections.user_id
   FROM public.collections
  WHERE (collections.id = collection_recipes.collection_id))));

alter policy "Users can manage own collections" on public.collections
  using (((select auth.uid()) = user_id));

alter policy "Users can manage own cooked log" on public.cooked_recipes
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users can add own lookups" on public.dish_lookups
  with check (((select auth.uid()) = user_id));

alter policy "Users can read own lookups" on public.dish_lookups
  using (((select auth.uid()) = user_id));

alter policy "Users can manage own family members" on public.family_members
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users can manage own favorites" on public.favorites
  using (((select auth.uid()) = user_id));

alter policy "Users can manage own feedback" on public.feedback
  using (((select auth.uid()) = user_id));

alter policy "Users can manage own grocery list" on public.grocery_lists
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users can manage own check-ins" on public.meal_checkins
  using (((select auth.uid()) = user_id))
  with check ((((select auth.uid()) = user_id) AND ((member_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.family_members m
  WHERE ((m.id = meal_checkins.member_id) AND (m.user_id = (select auth.uid()))))))));

alter policy "Users can manage own notes" on public.notes
  using (((select auth.uid()) = user_id));

alter policy "Users can manage own plan events" on public.plan_events
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users can manage own ratings" on public.recipe_ratings
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users can read own plan" on public.user_plans
  using (((select auth.uid()) = user_id));

alter policy "users_own_preferences_insert" on public.user_preferences
  with check (((select auth.uid()) = user_id));

alter policy "users_own_preferences_select" on public.user_preferences
  using (((select auth.uid()) = user_id));

alter policy "users_own_preferences_update" on public.user_preferences
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy "Users can manage own profile" on public.users
  using (((select auth.uid()) = id));

alter policy "Users can manage own week plan" on public.week_plans
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));
