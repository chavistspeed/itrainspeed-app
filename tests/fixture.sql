-- Minimal contract fixture inferred from repository usages, NOT a production dump.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role',true),''),'authenticated') $$;
grant usage on schema auth to authenticated,service_role,anon;
grant execute on all functions in schema auth to authenticated,service_role,anon;
create type public.user_role as enum('parent','coach','admin');
create type public.booking_status as enum('booked','cancelled');
create table public.profiles(id uuid primary key,role user_role not null default 'parent', full_name text,credits int default 10);
create table public.athletes(id uuid primary key,guardian_id uuid references profiles(id));
create table public.programs(id uuid primary key,credit_type text,credit_cost int);
create table public.sessions(id uuid primary key default gen_random_uuid(),program_id uuid references programs(id),start_at timestamptz,duration_minutes int,capacity int,status text,created_by uuid);
create table public.entitlements(id uuid primary key default gen_random_uuid(),guardian_id uuid references profiles(id),athlete_id uuid,package_id uuid,credit_type text,credits_remaining int,unlimited boolean,starts_at timestamptz default now(),expires_at timestamptz,status text default 'active',source text,created_at timestamptz default now());
create table public.purchases(id uuid primary key default gen_random_uuid(),guardian_id uuid references profiles(id),status text);
create table public.bookings(id uuid primary key default gen_random_uuid(),guardian_id uuid references profiles(id),athlete_id uuid references athletes(id),session_id uuid references sessions(id),status booking_status,credit_cost int,entitlement_id uuid references entitlements(id),created_at timestamptz default now(),unique(session_id,athlete_id));
insert into profiles(id,full_name,role) values
 ('00000000-0000-0000-0000-000000000001','Coach','coach'),
 ('00000000-0000-0000-0000-000000000002','Existing family','parent'),
 ('00000000-0000-0000-0000-000000000003','Other coach','coach');
