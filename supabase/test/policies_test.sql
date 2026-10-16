-- Run after supabase_stub.sql and schema.sql. Each check raises an exception on failure.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test',  '{"first_name":"Ada","last_name":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'sched@test',  '{"first_name":"Sam","last_name":"Sched"}'),
  ('00000000-0000-0000-0000-00000000000c', 'emp@test',    '{"first_name":"Eve","last_name":"Emp"}'),
  ('00000000-0000-0000-0000-00000000000d', 'new@test',    '{}');
-- bootstrap exactly as the README tells the owner to
update public.profiles set role = 'super_admin', active = true where email = 'admin@test';

create or replace function pg_temp.act(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok (blocked): %', label; return; end;
  raise exception 'FAIL: % should have been blocked', label;
end $$;
create or replace function pg_temp.expect_rows(q text, n int, label text) returns void language plpgsql as $$
declare got int;
begin
  execute 'select count(*) from (' || q || ') x' into got;
  if got <> n then raise exception 'FAIL: % expected % rows, got %', label, n, got; end if;
  raise notice 'ok: % (% rows)', label, got;
end $$;

-- super admin approves the scheduler and employee
select pg_temp.act('00000000-0000-0000-0000-00000000000a');
select public.admin_update_user('00000000-0000-0000-0000-00000000000b', 'scheduler', true);
select public.admin_update_user('00000000-0000-0000-0000-00000000000c', 'employee', true);
select pg_temp.expect_fail($q$select public.admin_update_user('00000000-0000-0000-0000-00000000000a','employee',true)$q$, 'admin demoting self');
reset role;

-- scheduler creates a game and assigns themselves + employee
select pg_temp.act('00000000-0000-0000-0000-00000000000b');
insert into public.games (client, booking_ref, game, players, starts_at, duration_min)
  values ('Acme Co', 'B1411', 'Feud', 7, '2026-12-06 05:30+00', 60);
insert into public.assignments (game_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000b', 'Host' from public.games;
insert into public.assignments (game_id, user_id, role) select id, '00000000-0000-0000-0000-00000000000c', 'Scorekeeper' from public.games;
select pg_temp.expect_rows('select * from public.profile_details', 4, 'scheduler sees all contact details');
select pg_temp.expect_fail($q$select public.admin_update_user('00000000-0000-0000-0000-00000000000c','scheduler',true)$q$, 'scheduler changing roles');
select pg_temp.expect_fail($q$update public.profiles set role='super_admin' where id = auth.uid()$q$, 'scheduler self-promote via update');
reset role;

-- employee: reads schedule, edits own profile, can't change games or see others' details
select pg_temp.act('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_rows('select * from public.games', 1, 'employee sees games');
select pg_temp.expect_rows('select * from public.assignments', 2, 'employee sees assignments');
select pg_temp.expect_rows('select * from public.profiles', 4, 'employee sees crew names');
select pg_temp.expect_rows('select * from public.profile_details', 1, 'employee sees only own details');
update public.profile_details set phone = '+1 555 0100', payment_method = 'PayPal', payout_handle = 'eve@pay' where id = auth.uid();
update public.profiles set first_name = 'Evelyn' where id = auth.uid();
select pg_temp.expect_rows($q$select * from public.profiles where first_name='Evelyn'$q$, 1, 'employee renamed self');
select pg_temp.expect_fail($q$insert into public.games (client, game, starts_at) values ('x','y',now())$q$, 'employee adding game');
select pg_temp.expect_fail($q$update public.profiles set role='super_admin' where id = auth.uid()$q$, 'employee self-promote');
select pg_temp.expect_fail($q$update public.profiles set active=true where id = auth.uid()$q$, 'employee changing active');
select pg_temp.expect_fail($q$update public.profile_details set payment_method='Bitcoin' where id = auth.uid()$q$, 'invalid payment method');
-- silent no-op checks (RLS filters rows rather than erroring)
update public.games set client = 'hacked';
delete from public.assignments;
update public.profile_details set phone = 'x' where id <> auth.uid();
reset role;
select pg_temp.expect_rows($q$select * from public.games where client='hacked'$q$, 0, 'employee update had no effect');
select pg_temp.expect_rows('select * from public.assignments', 2, 'employee delete had no effect');
select pg_temp.expect_rows($q$select * from public.profile_details where phone='x'$q$, 0, 'employee could not edit others');

-- pending (unapproved) user sees nothing but themself
select pg_temp.act('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_rows('select * from public.games', 0, 'pending user sees no games');
select pg_temp.expect_rows('select * from public.profiles', 1, 'pending user sees only self');
select pg_temp.expect_fail($q$insert into public.games (client, game, starts_at) values ('x','y',now())$q$, 'pending user adding game');
reset role;

-- signed out
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect_fail('select * from public.games', 'anon reading games');
select pg_temp.expect_fail('select * from public.profiles', 'anon reading profiles');
reset role;

-- deleting a game removes its assignments
delete from public.games;
select pg_temp.expect_rows('select * from public.assignments', 0, 'cascade delete');
select 'ALL POLICY TESTS PASSED' as result;
