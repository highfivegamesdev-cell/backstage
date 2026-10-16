-- Backstage: High Five Games crew scheduling
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run. Safe to run once
-- on a fresh project.
--
-- Roles
--   super_admin  everything, including approving accounts and changing roles
--   scheduler    create/edit games and assign anyone (including themselves); sees crew contact info
--   employee     sees the schedule, all games and their own history; edits only their own profile
--
-- New sign-ups start as inactive employees and see nothing until a super admin approves them.

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  first_name  text not null default '',
  last_name   text not null default '',
  role        text not null default 'employee' check (role in ('super_admin', 'scheduler', 'employee')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Private contact details: visible to the person themself, schedulers and super admins only.
create table public.profile_details (
  id              uuid primary key references public.profiles (id) on delete cascade,
  phone           text not null default '',
  payment_method  text not null default ''
                  check (payment_method in ('', 'PayPal', 'Wise', 'Bank transfer', 'Revolut', 'Payoneer', 'Other')),
  payout_handle   text not null default '',   -- e.g. PayPal email; never bank account numbers
  updated_at      timestamptz not null default now()
);

create table public.games (
  id            bigint generated always as identity primary key,
  client        text not null check (length(trim(client)) > 0),
  booking_ref   text not null default '',
  game          text not null check (length(trim(game)) > 0),
  players       integer check (players > 0),
  starts_at     timestamptz not null,
  duration_min  integer not null default 60 check (duration_min between 15 and 480),
  color         text not null default 'pink' check (color in ('pink', 'orange', 'yellow', 'blue', 'green', 'gray')),
  notes         text not null default '',
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index games_starts_at_idx on public.games (starts_at);

-- Who works which game, and in what role. A game can have several crew members.
create table public.assignments (
  game_id  bigint not null references public.games (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  role     text not null default 'Host' check (role in ('Host', 'Game Leader', 'Scorekeeper', 'Co-host')),
  primary key (game_id, user_id)
);
create index assignments_user_idx on public.assignments (user_id);

-- ---------------------------------------------------------------- helpers

create function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.is_crew() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create function public.can_schedule() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('super_admin', 'scheduler'), false)
$$;

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'super_admin', false)
$$;

-- New auth user → profile + empty details row.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'first_name', ''),
          coalesce(new.raw_user_meta_data ->> 'last_name', ''));
  insert into public.profile_details (id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Keep profiles.email in sync if someone changes their login email.
create function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users for each row execute function public.handle_user_email_change();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger games_touch before update on public.games
  for each row execute function public.touch_updated_at();
create trigger profile_details_touch before update on public.profile_details
  for each row execute function public.touch_updated_at();

-- Super admins approve accounts and change roles through this function only.
create function public.admin_update_user(target uuid, new_role text, new_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change roles or approve accounts';
  end if;
  if new_role not in ('super_admin', 'scheduler', 'employee') then
    raise exception 'Unknown role %', new_role;
  end if;
  if target = auth.uid() and (new_role <> 'super_admin' or not new_active) then
    raise exception 'You can''t remove your own super admin access';
  end if;
  update public.profiles set role = new_role, active = new_active where id = target;
end $$;

-- ---------------------------------------------------------------- security (row level)

alter table public.profiles        enable row level security;
alter table public.profile_details enable row level security;
alter table public.games           enable row level security;
alter table public.assignments     enable row level security;

-- Nobody signed out can read anything; signed-in users are limited by the policies below.
revoke all on public.profiles, public.profile_details, public.games, public.assignments from anon;
revoke all on public.profiles, public.profile_details, public.games, public.assignments from authenticated;
grant select on public.profiles, public.profile_details, public.games, public.assignments to authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;          -- not role/active
grant update (phone, payment_method, payout_handle) on public.profile_details to authenticated;
grant insert, update, delete on public.games, public.assignments to authenticated;

revoke execute on function public.admin_update_user(uuid, text, boolean) from public, anon;
grant execute on function public.admin_update_user(uuid, text, boolean) to authenticated;

-- profiles: you always see yourself (so a pending account can see it's pending); approved crew see everyone.
create policy "profiles: read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_crew());
create policy "profiles: edit own name" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- profile_details: yourself, schedulers and super admins.
create policy "details: read" on public.profile_details for select to authenticated
  using (id = auth.uid() or public.can_schedule());
create policy "details: edit own" on public.profile_details for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- games and assignments: all approved crew can read; schedulers and super admins can change.
create policy "games: read" on public.games for select to authenticated using (public.is_crew());
create policy "games: add" on public.games for insert to authenticated with check (public.can_schedule());
create policy "games: edit" on public.games for update to authenticated
  using (public.can_schedule()) with check (public.can_schedule());
create policy "games: delete" on public.games for delete to authenticated using (public.can_schedule());

create policy "assignments: read" on public.assignments for select to authenticated using (public.is_crew());
create policy "assignments: add" on public.assignments for insert to authenticated with check (public.can_schedule());
create policy "assignments: edit" on public.assignments for update to authenticated
  using (public.can_schedule()) with check (public.can_schedule());
create policy "assignments: delete" on public.assignments for delete to authenticated using (public.can_schedule());
