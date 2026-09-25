-- iTrainSpeed Production V1.4 SAFE UPGRADE
-- Packages, typed entitlements, memberships, promotions, and test grants.
-- Designed for the existing V1.3 database. Safe to rerun.

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  access_type text not null default 'credits' check (access_type in ('credits','membership','promotion')),
  credit_type text not null default 'group' check (credit_type in ('group','private','recovery','track')),
  credits int,
  price_cents int not null default 0,
  duration_days int,
  recurring boolean not null default false,
  purchase_limit int,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid references public.athletes(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  credit_type text not null check (credit_type in ('group','private','recovery','track')),
  credits_remaining int,
  unlimited boolean not null default false,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  source text not null default 'admin_test',
  created_at timestamptz not null default now()
);

alter table public.programs add column if not exists credit_type text;
update public.programs set credit_type = case
  when category='Private Training' then 'private'
  when category='Recovery' then 'recovery'
  when category='Track & Field' then 'track'
  else 'group'
end where credit_type is null;
alter table public.programs alter column credit_type set default 'group';

alter table public.bookings add column if not exists entitlement_id uuid references public.entitlements(id) on delete set null;

alter table public.purchases add column if not exists package_id uuid references public.packages(id) on delete set null;
alter table public.purchases add column if not exists athlete_id uuid references public.athletes(id) on delete set null;

alter table public.packages enable row level security;
alter table public.entitlements enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='packages' and policyname='packages_public_read') then
    create policy "packages_public_read" on public.packages for select using (active=true or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='packages' and policyname='admin_packages_manage') then
    create policy "admin_packages_manage" on public.packages for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entitlements' and policyname='entitlements_owner_read') then
    create policy "entitlements_owner_read" on public.entitlements for select using (guardian_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('coach','admin')));
  end if;
end $$;

-- Seed launch catalog only if a matching package name does not already exist.
insert into public.packages(name,description,access_type,credit_type,credits,price_cents,duration_days,recurring,purchase_limit,sort_order)
select * from (values
 ('Group Single Session','One group training session.','credits','group',1,3500,null,false,null,10),
 ('Group 5-Pack','Five group training credits.','credits','group',5,16500,null,false,null,20),
 ('Group 10-Pack','Ten group training credits.','credits','group',10,30000,null,false,null,30),
 ('Group 20-Pack','Twenty group training credits.','credits','group',20,55000,null,false,null,40),
 ('Unlimited Group Monthly','Unlimited eligible group training for 30 days.','membership','group',null,28000,30,true,null,50),
 ('Founding Athlete Promo','First 10 athletes: unlimited group training for 30 days.','promotion','group',null,17500,30,false,10,5),
 ('Off-Season Track & Field','Athlete-specific off-season track & field access for 30 days.','membership','track',null,17500,30,true,null,60),
 ('1-on-1 Single','One private training session.','credits','private',1,6000,null,false,null,70),
 ('1-on-1 5-Pack','Five private training credits.','credits','private',5,28500,null,false,null,80),
 ('1-on-1 10-Pack','Ten private training credits.','credits','private',10,54000,null,false,null,90),
 ('1-on-1 20-Pack','Twenty private training credits.','credits','private',20,100000,null,false,null,100)
) as v(name,description,access_type,credit_type,credits,price_cents,duration_days,recurring,purchase_limit,sort_order)
where not exists(select 1 from public.packages p where p.name=v.name);

create or replace function public.admin_grant_test_package(p_package_id uuid,p_guardian_id uuid,p_athlete_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_role user_role; v_pkg public.packages%rowtype; v_id uuid; v_exp timestamptz;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role <> 'admin' then raise exception 'Admin access required'; end if;
  select * into v_pkg from public.packages where id=p_package_id and active=true;
  if v_pkg.id is null then raise exception 'Package not found'; end if;
  if v_pkg.credit_type='track' and p_athlete_id is null then raise exception 'Select an athlete for Track membership'; end if;
  if p_athlete_id is not null and not exists(select 1 from public.athletes where id=p_athlete_id and guardian_id=p_guardian_id) then raise exception 'Athlete does not belong to this account'; end if;
  if v_pkg.duration_days is not null then v_exp := now() + make_interval(days=>v_pkg.duration_days); end if;
  insert into public.entitlements(guardian_id,athlete_id,package_id,credit_type,credits_remaining,unlimited,expires_at,source)
  values(p_guardian_id,p_athlete_id,v_pkg.id,v_pkg.credit_type,case when v_pkg.access_type='credits' then v_pkg.credits else null end,v_pkg.access_type in ('membership','promotion'),v_exp,'admin_test') returning id into v_id;
  return v_id;
end $$;
grant execute on function public.admin_grant_test_package(uuid,uuid,uuid) to authenticated;

create or replace function public.book_session_v14(p_session_id uuid,p_athlete_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_capacity int; v_booked int; v_id uuid; v_existing_status booking_status;
  v_type text; v_ent uuid; v_remaining int; v_unlimited boolean;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;
  if not exists(select 1 from public.athletes where id=p_athlete_id and guardian_id=v_user) then raise exception 'Athlete not found'; end if;
  select s.capacity,coalesce(p.credit_type,'group') into v_capacity,v_type from public.sessions s join public.programs p on p.id=s.program_id where s.id=p_session_id and s.status='published' for update of s;
  if v_capacity is null then raise exception 'Session not found or is not available'; end if;
  select b.id,b.status into v_id,v_existing_status from public.bookings b where b.session_id=p_session_id and b.athlete_id=p_athlete_id for update;
  if v_existing_status='booked' then raise exception 'This athlete is already booked for this session'; end if;
  select count(*) into v_booked from public.bookings where session_id=p_session_id and status='booked';
  if v_booked>=v_capacity then raise exception 'Session is full'; end if;
  select e.id,e.credits_remaining,e.unlimited into v_ent,v_remaining,v_unlimited
  from public.entitlements e
  where e.guardian_id=v_user and e.credit_type=v_type and e.status='active'
    and (e.athlete_id is null or e.athlete_id=p_athlete_id)
    and (e.expires_at is null or e.expires_at>now())
    and (e.unlimited=true or coalesce(e.credits_remaining,0)>0)
  order by e.unlimited desc,e.expires_at nulls last,e.created_at
  limit 1 for update;
  if v_ent is null then raise exception 'No eligible % training access. Visit Plans to add a package or membership.',v_type; end if;
  if not v_unlimited then update public.entitlements set credits_remaining=credits_remaining-1 where id=v_ent; end if;
  if v_id is not null then update public.bookings set status='booked',guardian_id=v_user,credit_cost=0,entitlement_id=v_ent,created_at=now() where id=v_id;
  else insert into public.bookings(session_id,athlete_id,guardian_id,credit_cost,status,entitlement_id) values(p_session_id,p_athlete_id,v_user,0,'booked',v_ent) returning id into v_id; end if;
  return v_id;
end $$;
grant execute on function public.book_session_v14(uuid,uuid) to authenticated;

create or replace function public.cancel_booking_v14(p_booking_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_ent uuid; v_unlimited boolean;
begin
  update public.bookings set status='cancelled' where id=p_booking_id and guardian_id=auth.uid() and status='booked' returning entitlement_id into v_ent;
  if not found then raise exception 'Booking not found'; end if;
  if v_ent is not null then
    select unlimited into v_unlimited from public.entitlements where id=v_ent for update;
    if coalesce(v_unlimited,false)=false then update public.entitlements set credits_remaining=credits_remaining+1 where id=v_ent; end if;
  end if;
end $$;
grant execute on function public.cancel_booking_v14(uuid) to authenticated;

-- V1.4-aware coach cancellation: restore typed credits rather than legacy profile credits.
create or replace function public.admin_cancel_session(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_role user_role; r record; v_unlimited boolean;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role not in ('coach','admin') then raise exception 'Coach or admin access required'; end if;
  if not exists(select 1 from public.sessions where id=p_session_id) then raise exception 'Session not found'; end if;
  for r in select id,entitlement_id from public.bookings where session_id=p_session_id and status='booked' for update loop
    if r.entitlement_id is not null then
      select unlimited into v_unlimited from public.entitlements where id=r.entitlement_id for update;
      if coalesce(v_unlimited,false)=false then update public.entitlements set credits_remaining=credits_remaining+1 where id=r.entitlement_id; end if;
    end if;
  end loop;
  update public.bookings set status='cancelled' where session_id=p_session_id and status='booked';
  update public.sessions set status='cancelled' where id=p_session_id;
end $$;
grant execute on function public.admin_cancel_session(uuid) to authenticated;
