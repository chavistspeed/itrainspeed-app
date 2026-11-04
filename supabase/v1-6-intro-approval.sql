-- REVIEW/STAGING ONLY. Requires the current base schema (export reconstructed in tests/exported-schema.sql).
-- Additive guards deliberately preserve booking/cancellation/Stripe RPC bodies.
begin;
create schema if not exists intro_private;
revoke all on schema intro_private from public;

create table public.family_approvals (
  guardian_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','grandfathered')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
-- This migration is intentionally applied once: every profile present at this
-- transaction's cutover is grandfathered. Lock closes the concurrent signup gap.
lock table public.profiles in share row exclusive mode;
insert into public.family_approvals(guardian_id,status,approved_at)
select id,'grandfathered',now() from public.profiles;

create function intro_private.new_family() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.family_approvals(guardian_id) values(new.id);
  return new;
end $$;
create trigger intro_new_family after insert on public.profiles
for each row execute function intro_private.new_family();

create function intro_private.is_staff() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('coach','admin'))
$$;
-- Approval relies on the existing profile role; prevent a permissive legacy
-- profile update policy from letting a parent promote themselves into a coach.
create function intro_private.guard_staff_role() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role() in ('anon','authenticated') and not intro_private.is_staff() then
   if tg_op='INSERT' then
     if new.role::text in ('coach','admin') then raise exception 'Staff role changes require coach access'; end if;
   elsif new.role is distinct from old.role then
     raise exception 'Staff role changes require coach access';
   end if;
 end if;
 return new;
end $$;
create trigger intro_guard_staff_role before insert or update of role on public.profiles
for each row execute function intro_private.guard_staff_role();

create function public.training_approved(p_guardian_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select status in ('approved','grandfathered') from public.family_approvals
    where guardian_id=p_guardian_id),false)
    and (p_guardian_id=auth.uid() or intro_private.is_staff() or auth.role()='service_role')
$$;
revoke all on function public.training_approved(uuid) from public,anon,authenticated,service_role;
grant execute on function public.training_approved(uuid) to authenticated,service_role;

alter table public.family_approvals enable row level security;
create policy approvals_read on public.family_approvals for select to authenticated
using(guardian_id=auth.uid() or intro_private.is_staff());
-- No table write grants or write policies: only the coach RPC can approve.
revoke all on public.family_approvals from public,anon,authenticated;
grant select on public.family_approvals to authenticated;

create function public.approve_family(p_guardian_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not intro_private.is_staff() then raise exception 'Coach access required'; end if;
  update public.family_approvals set status='approved',approved_by=auth.uid(),approved_at=now()
  where guardian_id=p_guardian_id and status='pending';
  if not found then raise exception 'Pending family not found'; end if;
end $$;
revoke all on function public.approve_family(uuid) from public,anon,authenticated,service_role;
grant execute on function public.approve_family(uuid) to authenticated;

create function intro_private.guard_training() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_table_name='bookings' then
    if new.status::text <> 'booked' then return new; end if;
    if tg_op='UPDATE' and old.status::text='booked' and old.guardian_id=new.guardian_id
      and old.athlete_id=new.athlete_id and old.session_id=new.session_id then return new; end if;
  elsif tg_table_name='purchases' and tg_op='UPDATE' then
    -- Preserve subscription renewal/status maintenance on an existing purchase.
    if old.guardian_id=new.guardian_id then return new; end if;
  end if;
  if not exists(select 1 from public.family_approvals where guardian_id=new.guardian_id
     and status in ('approved','grandfathered')) then
    raise exception 'Coach approval is required before training purchases or bookings' using errcode='42501';
  end if;
  return new;
end $$;
create trigger intro_training_booking_guard before insert or update on public.bookings
for each row execute function intro_private.guard_training();
create trigger intro_training_purchase_guard before insert or update on public.purchases
for each row execute function intro_private.guard_training();
create trigger intro_training_entitlement_guard before insert or update of guardian_id on public.entitlements
for each row execute function intro_private.guard_training();

create table public.intro_windows (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('available','blocked')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  check(end_at>start_at and end_at-start_at<=interval '31 days')
);
create table public.intro_calls (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id),
  guardian_id uuid not null references public.profiles(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked' check(status in ('booked','cancelled')),
  source_id text unique,
  created_at timestamptz not null default now(),
  check(end_at=start_at+interval '20 minutes')
);
-- All calls use aligned 20-minute slots. This unique constraint also protects
-- against duplicates under non-default transaction isolation.
create unique index intro_one_coach_per_slot on public.intro_calls(coach_id,start_at) where status='booked';
create index intro_calls_coach_time on public.intro_calls(coach_id,start_at) where status='booked';
create index intro_windows_coach_time on public.intro_windows(coach_id,start_at);
create unique index intro_one_upcoming_per_family_time on public.intro_calls(guardian_id,start_at) where status='booked';

-- One transaction-level advisory lock covers ALL calendar writers, including
-- direct writes by service-role and existing training-session creation RPCs.
create function intro_private.calendar_lock() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Calendar writes require READ COMMITTED transaction isolation';
  end if;
  perform pg_advisory_xact_lock(619402611);
  return null;
end $$;
create trigger intro_calls_lock before insert or update or delete on public.intro_calls
for each statement execute function intro_private.calendar_lock();
create trigger intro_windows_lock before insert or update or delete on public.intro_windows
for each statement execute function intro_private.calendar_lock();
create trigger intro_sessions_lock before insert or update or delete on public.sessions
for each statement execute function intro_private.calendar_lock();

create function intro_private.slot_free(p_coach uuid,p_start timestamptz,p_end timestamptz)
returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles where id=p_coach and role in ('coach','admin'))
 and exists(select 1 from public.intro_windows where coach_id=p_coach and kind='available'
   and start_at<=p_start and end_at>=p_end)
 and not exists(select 1 from public.intro_windows where coach_id=p_coach and kind='blocked'
   and start_at<p_end and end_at>p_start)
 and not exists(select 1 from public.intro_calls where coach_id=p_coach and status='booked'
   and start_at<p_end and end_at>p_start)
 -- Existing sessions have created_by, not an assigned coach. Conservatively
 -- reserve all published training time across coaches until assignment exists.
 and not exists(select 1 from public.sessions where status::text='published'
   and start_at<p_end and start_at+make_interval(mins=>coalesce(duration_minutes,60))>p_start)
$$;
create function intro_private.valid_intro_time(p_start timestamptz) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select extract(isodow from p_start at time zone 'America/New_York')<=6
 and (p_start at time zone 'America/New_York')::time>=time '09:00'
 and ((p_start+interval '20 minutes') at time zone 'America/New_York')::time<=time '16:00'
 and (p_start at time zone 'America/New_York')::date=
     ((p_start+interval '20 minutes') at time zone 'America/New_York')::date
 and extract(second from p_start)=0
 and extract(minute from p_start at time zone 'America/New_York')::int % 20=0
$$;
create function intro_private.validate_call() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' then
   if (new.coach_id,new.guardian_id,new.start_at,new.end_at,new.source_id) is distinct from
      (old.coach_id,old.guardian_id,old.start_at,old.end_at,old.source_id) then
      raise exception 'Cancel and rebook to change an intro call'; end if;
   if old.status='cancelled' and new.status='booked' then raise exception 'Create a new booking'; end if;
   return new;
 end if;
 if new.status<>'booked' then raise exception 'New calls must be booked'; end if;
 if new.start_at<clock_timestamp()+interval '24 hours' then raise exception 'At least 24 hours advance notice required'; end if;
 if not intro_private.valid_intro_time(new.start_at) then raise exception 'Choose a 20-minute slot Monday–Saturday, 9 AM–4 PM Eastern'; end if;
 if not intro_private.slot_free(new.coach_id,new.start_at,new.end_at) then raise exception 'This time is no longer available'; end if;
 if exists(select 1 from public.intro_calls where guardian_id=new.guardian_id and status='booked' and end_at>now()) then
   raise exception 'This family already has an upcoming intro call'; end if;
 return new;
end $$;
create trigger intro_validate_call before insert or update on public.intro_calls
for each row execute function intro_private.validate_call();

create function intro_private.validate_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' or tg_op='UPDATE' then
   if not exists(select 1 from public.profiles where id=new.coach_id and role in ('coach','admin')) then raise exception 'Coach not found'; end if;
   if new.kind='blocked' and exists(select 1 from public.intro_calls where coach_id=new.coach_id and status='booked'
     and start_at<new.end_at and end_at>new.start_at) then raise exception 'Cancel the conflicting intro call first'; end if;
 end if;
 -- AFTER trigger sees the final window state. Removing availability cannot
 -- silently strand a previously confirmed appointment.
 if exists(select 1 from public.intro_calls c where c.status='booked' and c.end_at>now()
   and not exists(select 1 from public.intro_windows w where w.coach_id=c.coach_id and w.kind='available'
     and w.start_at<=c.start_at and w.end_at>=c.end_at)) then raise exception 'Availability must cover existing intro calls'; end if;
 return null;
end $$;
create trigger intro_validate_window after insert or update or delete on public.intro_windows
for each row execute function intro_private.validate_window();
create function intro_private.validate_training_time() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status::text='published' and exists(select 1 from public.intro_calls where status='booked'
   and start_at<new.start_at+make_interval(mins=>coalesce(new.duration_minutes,60)) and end_at>new.start_at) then
   raise exception 'Training overlaps a confirmed intro call'; end if;
 return new;
end $$;
create trigger intro_validate_training before insert or update on public.sessions
for each row execute function intro_private.validate_training_time();

alter table public.intro_windows enable row level security;
alter table public.intro_calls enable row level security;
revoke all on public.intro_windows,public.intro_calls from public,anon,authenticated;
grant select on public.intro_windows,public.intro_calls to authenticated;
create policy intro_windows_staff_read on public.intro_windows for select to authenticated using(intro_private.is_staff());
create policy intro_calls_read on public.intro_calls for select to authenticated using(guardian_id=auth.uid() or intro_private.is_staff());
-- The policy helper is the ONLY private function accessible to authenticated.
grant usage on schema intro_private to authenticated;
revoke all on all functions in schema intro_private from public,anon,authenticated;
grant execute on function intro_private.is_staff() to authenticated;

create function public.intro_coaches() returns table(id uuid,full_name text)
language sql stable security definer set search_path=pg_catalog,public as $$
 select id,full_name from public.profiles where role in ('coach','admin') and auth.uid() is not null
$$;
create function public.intro_slots(p_coach_id uuid,p_date date) returns table(start_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,public as $$
 select slot from generate_series((p_date+time '09:00') at time zone 'America/New_York',
   (p_date+time '15:40') at time zone 'America/New_York',interval '20 minutes') slot
 where auth.uid() is not null and p_date between (now() at time zone 'America/New_York')::date
   and (now() at time zone 'America/New_York')::date+90
 and slot>=clock_timestamp()+interval '24 hours' and intro_private.valid_intro_time(slot)
 and intro_private.slot_free(p_coach_id,slot,slot+interval '20 minutes')
$$;
create function public.book_intro(p_coach_id uuid,p_start_at timestamptz) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to book'; end if;
 perform pg_advisory_xact_lock(619402611);
 if p_start_at>now()+interval '90 days' then raise exception 'Choose a time within 90 days'; end if;
 insert into public.intro_calls(coach_id,guardian_id,start_at,end_at)
 values(p_coach_id,auth.uid(),p_start_at,p_start_at+interval '20 minutes') returning id into v_id;
 return v_id;
end $$;
create function public.cancel_intro(p_call_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform pg_advisory_xact_lock(619402611);
 update public.intro_calls set status='cancelled' where id=p_call_id and status='booked'
 and (guardian_id=auth.uid() or intro_private.is_staff());
 if not found then raise exception 'Booking not found'; end if;
end $$;
create function public.save_intro_window(p_kind text,p_start_at timestamptz,p_end_at timestamptz) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
 if not intro_private.is_staff() then raise exception 'Coach access required'; end if;
 perform pg_advisory_xact_lock(619402611);
 insert into public.intro_windows(coach_id,kind,start_at,end_at) values(auth.uid(),p_kind,p_start_at,p_end_at) returning id into v_id;
 return v_id;
end $$;
create function public.delete_intro_window(p_window_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not intro_private.is_staff() then raise exception 'Coach access required'; end if;
 perform pg_advisory_xact_lock(619402611);
 delete from public.intro_windows where id=p_window_id and coach_id=auth.uid();
 if not found then raise exception 'Availability not found'; end if;
end $$;

-- Durable per-recipient outbox, atomically created with booking/cancellation.
create table public.intro_mail (
 id uuid primary key default gen_random_uuid(),
 call_id uuid not null references public.intro_calls(id),
 kind text not null check(kind in ('booked','cancelled')),
 recipient text not null check(recipient in ('family','coach')),
 state text not null default 'pending' check(state in ('pending','sending','sent')),
 claimed_at timestamptz,
 sent_at timestamptz,
 unique(call_id,kind,recipient)
);
alter table public.intro_mail enable row level security;
revoke all on public.intro_mail from public,anon,authenticated;
create function intro_private.enqueue_mail() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Explicit source imports are handled separately and do not send duplicate email.
 if new.source_id is null and (tg_op='INSERT' or new.status is distinct from old.status) then
  insert into public.intro_mail(call_id,kind,recipient) values(new.id,new.status,'family'),(new.id,new.status,'coach') on conflict do nothing;
 end if;
 return new;
end $$;
create trigger intro_enqueue_mail after insert or update on public.intro_calls
for each row execute function intro_private.enqueue_mail();
revoke all on all functions in schema intro_private from public,anon,authenticated;
grant execute on function intro_private.is_staff() to authenticated;

-- Enumerated public RPC grants; anonymous callers cannot invoke definer RPCs.
revoke all on function public.intro_coaches(),public.intro_slots(uuid,date),public.book_intro(uuid,timestamptz),
 public.cancel_intro(uuid),public.save_intro_window(text,timestamptz,timestamptz),public.delete_intro_window(uuid) from public,anon,authenticated,service_role;
grant execute on function public.intro_coaches(),public.intro_slots(uuid,date),public.book_intro(uuid,timestamptz),
 public.cancel_intro(uuid),public.save_intro_window(text,timestamptz,timestamptz),public.delete_intro_window(uuid) to authenticated;
-- Supabase normally grants service_role table access through default privileges;
-- make the new outbox permissions explicit for server-side processing.
grant all on public.intro_mail,public.intro_calls to service_role;

-- Current profile RLS permits self reads only. Return the specific coach
-- dashboard fields after checking staff access, without widening profile RLS.
create function public.coach_intro_overview() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not intro_private.is_staff() then raise exception 'Coach access required'; end if;
 return jsonb_build_object(
  'windows',coalesce((select jsonb_agg(to_jsonb(w) order by w.start_at)
    from public.intro_windows w where w.coach_id=auth.uid()),'[]'::jsonb),
  'calls',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('family_name',p.full_name) order by c.start_at)
    from public.intro_calls c join public.profiles p on p.id=c.guardian_id
    where c.coach_id=auth.uid()),'[]'::jsonb),
  'families',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('family_name',p.full_name) order by a.created_at)
    from public.family_approvals a join public.profiles p on p.id=a.guardian_id
    where a.status='pending' and p.role::text='parent'),'[]'::jsonb)
 );
end $$;
revoke all on function public.coach_intro_overview() from public,anon,authenticated,service_role;
grant execute on function public.coach_intro_overview() to authenticated;
commit;
