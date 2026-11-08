-- Local development data only (supabase db reset runs this). Made-up people, example.com emails.
-- Password for all three: portal-demo-2026
do $$
declare
  staff  uuid := '00000000-0000-4000-a000-000000000001';
  maria  uuid := '00000000-0000-4000-a000-000000000002';
  tom    uuid := '00000000-0000-4000-a000-000000000003';
  u record;
begin
  for u in select * from (values
    (staff, 'staff@example.com', 'Sam Staff'),
    (maria, 'maria@example.com', 'Maria Lopez'),
    (tom,   'tom@example.com',   'Tom Becker')) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('portal-demo-2026', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(),
            '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now());
  end loop;

  -- handle_new_user() gave everyone the 'user' role; Sam is agency staff.
  insert into public.user_roles (user_id, role) values (staff, 'admin');

  insert into public.requests (client_id, title, description, category, urgency) values
    (maria, 'Checkout page shows an error', 'Since this morning customers get "Something went wrong" when they press Pay. We have lost two orders already.', 'bug', 'normal'),
    (maria, 'New photos for the About page', 'Please swap the three team photos for the new ones I emailed on Friday.', 'change', 'low'),
    (tom,   'Can we add a Spanish version?', 'About a third of our visitors are in Spain. What would a Spanish version of the site involve?', 'question', 'normal');
end $$;
