-- A stand-in for the parts of Supabase the migrations lean on, so the real
-- migration files can be run and tested locally without touching the live
-- database. Only the shapes matter: the columns the migrations and policies
-- actually reference.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  last_sign_in_at timestamptz
);

create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'unverified',
  factor_type text not null default 'totp'
);

-- The same definitions Supabase ships.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- nullif before the cast, the way Supabase does it: with no session the
  -- setting is an empty string, and an empty string is not valid json.
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create role anon;
create role authenticated;

-- ---------------------------------------------------------------------
-- The application tables, with the columns the policies and audit
-- triggers touch.
-- ---------------------------------------------------------------------

create table public.dogs (
  id uuid primary key default gen_random_uuid(),
  dog_name text not null,
  phone text,
  last_name text,
  breed text,
  notes text,
  birthdate text,
  photo_data text,
  created_at timestamptz default now()
);

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  owner_name text,
  email text,
  address text,
  emergency_contact text,
  vet_name text,
  created_at timestamptz default now()
);

create table public.signins (
  id uuid primary key default gen_random_uuid(),
  dog_name text,
  dog_id uuid,
  phone text,
  action text,
  service_type text,
  price numeric,
  signature_data text,
  created_at timestamptz default now()
);

create table public.boardings (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid,
  phone text,
  start_date date,
  end_date date
);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  phone text,
  client_name text,
  dog_name text,
  kind text,
  total_days int,
  days_used int default 0,
  price numeric,
  created_at timestamptz default now()
);

create table public.package_uses (
  id uuid primary key default gen_random_uuid(),
  package_id uuid,
  dog_id uuid,
  signin_id uuid,
  used_on date default current_date
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  phone text,
  amount numeric,
  paid_on date default current_date,
  method text,
  created_at timestamptz default now()
);

create table public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid,
  vaccine text,
  given_on date,
  expires_on date,
  file_data text
);

create table public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid,
  date date,
  meal text
);

create table public.walk_logs (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid,
  date date,
  slot text,
  walk_out text
);

create table public.dog_docs (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid,
  kind text,
  file_data text
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  status text default 'pending',
  owner_name text,
  phone text,
  payload jsonb,
  created_at timestamptz default now()
);

create table public.boarding_requests (
  id uuid primary key default gen_random_uuid(),
  status text default 'pending',
  phone text,
  created_at timestamptz default now()
);

create table public.settings (
  id int primary key,
  data jsonb,
  updated_at timestamptz default now()
);

create table public.site_photos (
  id uuid primary key default gen_random_uuid(),
  slot text,
  data text
);

-- A leftover from a vaccination import that exists in the live database and
-- that no migration had ever named. Here so the lockdown is tested against
-- the real table list rather than an idealised one.
create table public.vaccinations_staging (
  id uuid primary key default gen_random_uuid(),
  dog_name text,
  phone text,
  vaccine text,
  given_on date
);

-- What Supabase grants by default. RLS filters on top of these; without
-- them the API roles get permission denied whatever the policies say.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- A row so the public read path has something to return.
insert into public.settings (id, data) values (1, '{"business":{"name":"Test"}}'::jsonb);
