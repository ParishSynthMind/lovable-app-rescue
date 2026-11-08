-- Copied unchanged from drizzle/migrations/0000_migration.sql (the Lovable Cloud export),
-- so the Supabase CLI can build the same database locally and on any Supabase project.

create type public.app_role as enum ('admin', 'user');
create type public.request_category as enum ('bug', 'change', 'question');
create type public.request_urgency as enum ('low', 'normal', 'high');
create type public.request_status as enum ('new', 'in_progress', 'done');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create policy "Users read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title text not null check (char_length(title) between 1 and 150),
  description text not null check (char_length(description) between 1 and 5000),
  category request_category not null,
  urgency request_urgency not null default 'normal',
  status request_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.requests to authenticated;
grant all on public.requests to service_role;
alter table public.requests enable row level security;
create policy "Clients read own, admins all" on public.requests for select to authenticated
  using (client_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "Clients create own new requests" on public.requests for insert to authenticated
  with check (client_id = auth.uid() and status = 'new');
create policy "Admins update requests" on public.requests for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table public.request_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid not null default auth.uid(),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.request_notes to authenticated;
grant all on public.request_notes to service_role;
alter table public.request_notes enable row level security;
create policy "Admins read notes" on public.request_notes for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins add notes" on public.request_notes for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and author_id = auth.uid());
create policy "Admins delete notes" on public.request_notes for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;
create trigger requests_touch before update on public.requests for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();