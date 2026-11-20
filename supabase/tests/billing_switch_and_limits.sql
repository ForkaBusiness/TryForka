-- Database tests for the billing switch and Free limits (20261125000000). Runs inside a
-- transaction that is rolled back: nothing it does is kept. Any failure raises an error.
--   supabase db query --linked -f supabase/tests/billing_switch_and_limits.sql
-- Uses the QA account (qa@tryforka.com, a test account).

begin;

do $$
declare
  qa constant uuid := '8afe2cc9-1a29-4ab7-9f09-828e9a0934b0';
  ok boolean;
  i integer;
begin
  -- Set up as the service role: a Free QA account with no recipes of its own.
  update public.user_plans set plan = 'free', billing_status = 'none', founding = false, pro_until = null, billing_preview = false, smart_imports_count = 0 where user_id = qa;
  delete from public.recipes where owner_id = qa;
  update public.app_settings set value = 'false' where key = 'billing_enabled';

  perform set_config('request.jwt.claims', json_build_object('sub', qa, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Billing off: nothing is limited.
  assert not public.billing_on(), 'billing should be off';
  assert public.effective_plan() = 'pro', 'billing off: everyone has every feature';
  for i in 1..21 loop insert into public.recipes (name, owner_id) values ('db test ' || i, qa); end loop;
  update public.user_plans set smart_imports_count = smart_imports_count where false; -- no-op as the client (no update rights)
  reset role;
  update public.user_plans set smart_imports_count = 20 where user_id = qa;
  set local role authenticated;
  assert public.claim_smart_import(), 'billing off: a 21st import is fine';

  -- Billing on (the global switch): Free is limited.
  reset role;
  delete from public.recipes where owner_id = qa;
  update public.user_plans set smart_imports_count = 19 where user_id = qa;
  update public.app_settings set value = 'true' where key = 'billing_enabled';
  set local role authenticated;
  assert public.billing_on() and public.effective_plan() = 'free', 'billing on: Free';
  for i in 1..20 loop insert into public.recipes (name, owner_id) values ('db test ' || i, qa); end loop;
  begin
    insert into public.recipes (name, owner_id) values ('db test 21', qa);
    raise exception 'FAIL: a 21st recipe of its own was allowed on Free';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'free_limit_recipes' then raise; end if;
  end;
  assert public.claim_smart_import(), 'the 20th import is fine';
  assert not public.claim_smart_import(), 'the 21st import is refused';
  assert (select smart_imports_count from public.user_plans where user_id = qa) = 20, 'a refused import is not counted';
  assert not has_function_privilege('authenticated', 'public.release_smart_import(uuid)', 'execute'), 'clients cannot hand imports back';
  assert not has_table_privilege('authenticated', 'public.app_settings', 'update'), 'clients cannot flip the switch';

  -- Founding families and Pro are never limited.
  reset role;
  update public.user_plans set founding = true where user_id = qa;
  set local role authenticated;
  assert public.effective_plan() = 'pro', 'founding is Pro';
  insert into public.recipes (name, owner_id) values ('db test founding', qa);
  assert public.claim_smart_import(), 'founding: no import limit';
  reset role;
  update public.user_plans set founding = false, plan = 'pro', billing_status = 'past_due', pro_until = now() - interval '1 day' where user_id = qa;
  set local role authenticated;
  assert public.effective_plan() = 'free', 'Pro after its grace period has ended is Free';

  -- The per-account preview: billing for this account only.
  reset role;
  update public.app_settings set value = 'false' where key = 'billing_enabled';
  update public.user_plans set plan = 'free', billing_status = 'none', pro_until = null, billing_preview = true where user_id = qa;
  set local role authenticated;
  assert public.billing_on() and public.effective_plan() = 'free', 'preview: billing on for this account';
  reset role;
  raise notice 'billing switch and limits: all checks passed';
end $$;

-- Only reached when every check above passed.
select 'all checks passed' as result;

rollback;
