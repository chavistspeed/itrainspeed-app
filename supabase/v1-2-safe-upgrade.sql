-- iTrainSpeed Production V1.2 SAFE UPGRADE
-- Fixes rebooking after cancellation without dropping the unique booking constraint.
-- Safe to rerun: CREATE OR REPLACE updates only the booking RPC.

create or replace function public.book_session(p_session_id uuid, p_athlete_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_cost int;
  v_capacity int;
  v_booked int;
  v_id uuid;
  v_existing_status booking_status;
begin
  if v_user is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1 from public.athletes
    where id=p_athlete_id and guardian_id=v_user
  ) then
    raise exception 'Athlete not found';
  end if;

  select p.credit_cost, s.capacity
    into v_cost, v_capacity
  from public.sessions s
  join public.programs p on p.id=s.program_id
  where s.id=p_session_id and s.status='published'
  for update of s;

  if v_cost is null then
    raise exception 'Session not found or is not available';
  end if;

  select b.id, b.status
    into v_id, v_existing_status
  from public.bookings b
  where b.session_id=p_session_id and b.athlete_id=p_athlete_id
  for update;

  if v_existing_status = 'booked' then
    raise exception 'This athlete is already booked for this session';
  end if;

  select count(*) into v_booked
  from public.bookings
  where session_id=p_session_id and status='booked';

  if v_booked >= v_capacity then
    raise exception 'Session is full';
  end if;

  perform 1 from public.profiles where id=v_user for update;
  if (select credits from public.profiles where id=v_user) < v_cost then
    raise exception 'Not enough training credits';
  end if;

  update public.profiles
  set credits=credits-v_cost
  where id=v_user;

  if v_id is not null then
    update public.bookings
    set status='booked',
        guardian_id=v_user,
        credit_cost=v_cost,
        created_at=now()
    where id=v_id;
  else
    insert into public.bookings(session_id,athlete_id,guardian_id,credit_cost,status)
    values(p_session_id,p_athlete_id,v_user,v_cost,'booked')
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.book_session(uuid,uuid) to authenticated;
