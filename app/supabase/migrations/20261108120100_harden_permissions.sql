-- Rescue: tighten what signed-in users can write. The Lovable schema had RLS on every table,
-- but its GRANTs were whole-table, so a user could change columns nobody meant them to.
-- Every rule here is proved in supabase/tests/rls.test.sql.

-- 1. Profiles: a user may edit their name and nothing else. Before this, a client could
--    rewrite the email the agency sees on the dashboard and pose as someone else.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- The profile email now follows the real login email when it changes.
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
revoke execute on function public.sync_profile_email() from public, anon, authenticated;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- 2. Requests: clients send the form fields only. id, status and timestamps are set by the
--    database, so nobody can backdate a request or file it as already "done".
revoke insert, update on public.requests from authenticated;
grant insert (client_id, title, description, category, urgency) on public.requests to authenticated;
-- Staff change the status (the RLS policy already limits UPDATE to admins). They can no longer
-- rewrite what the client wrote or move a request to another client.
grant update (status) on public.requests to authenticated;

-- 3. has_role() is SECURITY DEFINER. Postgres lets PUBLIC execute new functions, so anyone,
--    signed in or not, could ask "is this user id an admin?". Only signed-in users need it (RLS).
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

-- 4. AI triage written by the triage-request Edge Function (service role) and read by staff only.
--    Clients never see it: it holds the internal priority and a draft reply.
create type public.triage_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.request_triage (
  request_id uuid primary key references public.requests(id) on delete cascade,
  summary text not null default '' check (char_length(summary) <= 400),
  priority public.triage_priority not null,
  reason text not null check (char_length(reason) <= 300),
  suggested_reply text not null default '' check (char_length(suggested_reply) <= 1500),
  needs_review boolean not null default false,
  model text not null,
  created_at timestamptz not null default now()
);
revoke all on public.request_triage from anon, authenticated;
grant select on public.request_triage to authenticated;
grant all on public.request_triage to service_role;
alter table public.request_triage enable row level security;
create policy "Admins read triage" on public.request_triage for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- 5. Second layer behind RLS. Supabase grants anon and authenticated every privilege on new
--    tables by default, so RLS was the only thing stopping a delete or an anonymous read.
--    Nobody uses this app signed out, and nobody deletes requests, profiles or roles from the app.
revoke all on public.profiles, public.user_roles, public.requests, public.request_notes from anon;
revoke insert, delete, truncate, references, trigger on public.profiles, public.user_roles from authenticated;
revoke update on public.user_roles from authenticated;
revoke delete, truncate, references, trigger on public.requests from authenticated;
revoke update, truncate, references, trigger on public.request_notes from authenticated;
