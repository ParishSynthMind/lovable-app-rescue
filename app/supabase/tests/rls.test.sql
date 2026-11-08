-- Row level security and column grants, tested as the real roles PostgREST uses.
-- Run with: supabase test db   (needs the seed: staff, maria, tom and three requests)
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Act as a signed-in user, exactly like a request carrying their JWT.
create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A note and an AI triage row on Maria's checkout bug, written as the system would.
insert into public.request_notes (request_id, author_id, body)
  select id, '00000000-0000-4000-a000-000000000001', 'Payment provider changed their API, check webhook'
  from public.requests where title = 'Checkout page shows an error';
insert into public.request_triage (request_id, summary, priority, reason, suggested_reply, model)
  select id, 'Checkout fails at payment.', 'urgent', 'Payments broken.', 'We are on it.', 'test'
  from public.requests where title = 'Checkout page shows an error';

-- ---------- Maria, a client ----------
select pg_temp.login('00000000-0000-4000-a000-000000000002');

select is((select count(*)::int from public.requests), 2, 'client sees only her own 2 requests');
select is((select count(*)::int from public.requests where client_id = '00000000-0000-4000-a000-000000000003'), 0, 'client cannot see another client''s request');
select is((select count(*)::int from public.request_notes), 0, 'client cannot read internal notes');
select is((select count(*)::int from public.request_triage), 0, 'client cannot read the AI triage');
select is((select count(*)::int from public.profiles), 1, 'client sees only her own profile');

select lives_ok($$ insert into public.requests (client_id, title, description, category, urgency)
  values ('00000000-0000-4000-a000-000000000002', 'Footer link broken', 'The Privacy link in the footer goes to a 404.', 'bug', 'low') $$,
  'client can submit a request');
select throws_ok($$ insert into public.requests (client_id, title, description, category)
  values ('00000000-0000-4000-a000-000000000003', 'Sneaky', 'Filed as Tom', 'bug') $$,
  '42501', null, 'client cannot file a request as someone else');
select throws_ok($$ insert into public.requests (client_id, title, description, category, status)
  values ('00000000-0000-4000-a000-000000000002', 'x', 'y', 'bug', 'done') $$,
  '42501', null, 'client cannot set the status on a new request');
select throws_ok($$ insert into public.requests (client_id, title, description, category, created_at)
  values ('00000000-0000-4000-a000-000000000002', 'x', 'y', 'bug', now() - interval '1 year') $$,
  '42501', null, 'client cannot backdate a request (rescue fix)');

select throws_ok($$ update public.requests set title = 'changed' where client_id = auth.uid() $$,
  '42501', null, 'client cannot edit a request after sending it');
update public.requests set status = 'done' where client_id = auth.uid();
select is((select count(*)::int from public.requests where status = 'done'), 0, 'client cannot mark her own request done (0 rows changed)');
select throws_ok($$ delete from public.requests $$, '42501', null, 'client cannot delete requests');

select throws_ok($$ update public.profiles set email = 'ceo@bigclient.example' where id = auth.uid() $$,
  '42501', null, 'client cannot change the email staff see (rescue fix)');
select lives_ok($$ update public.profiles set full_name = 'Maria L.' where id = auth.uid() $$,
  'client can still change her name');
select throws_ok($$ insert into public.user_roles (user_id, role) values (auth.uid(), 'admin') $$,
  '42501', null, 'client cannot make herself admin');
select throws_ok($$ insert into public.request_triage (request_id, priority, reason, model)
  select id, 'low', 'x', 'x' from public.requests limit 1 $$,
  '42501', null, 'client cannot write an AI triage row');

-- ---------- Sam, agency staff ----------
select pg_temp.logout();
select pg_temp.login('00000000-0000-4000-a000-000000000001');

select is((select count(*)::int from public.requests), 4, 'staff see every request (3 seeded + 1 new)');
select is((select count(*)::int from public.request_notes), 1, 'staff read internal notes');
select is((select count(*)::int from public.request_triage), 1, 'staff read the AI triage');
select lives_ok($$ update public.requests set status = 'in_progress' where title = 'Checkout page shows an error' $$,
  'staff change a status');
select throws_ok($$ update public.requests set description = 'staff rewrote this' $$,
  '42501', null, 'staff cannot rewrite what the client wrote (rescue fix)');

-- ---------- Not signed in ----------
select pg_temp.logout();
set local role anon;
select throws_ok($$ select count(*) from public.requests $$, '42501', null, 'anonymous visitors cannot read requests');
select throws_ok($$ select public.has_role('00000000-0000-4000-a000-000000000001', 'admin') $$,
  '42501', null, 'anonymous visitors cannot probe who is admin (rescue fix)');
reset role;

-- ---------- Profile email follows the login email ----------
update auth.users set email = 'maria.lopez@example.com' where id = '00000000-0000-4000-a000-000000000002';
select is((select email from public.profiles where id = '00000000-0000-4000-a000-000000000002'),
  'maria.lopez@example.com', 'profile email follows a login email change (rescue fix)');

select * from finish();
rollback;
