-- iTrainSpeed Production V1.1 SAFE UPGRADE
-- Safe to run on the existing Booking V2 database. It does NOT recreate enums/tables.
-- Adds only a coach/admin roster function. CREATE OR REPLACE makes reruns safe.

create or replace function public.get_session_roster(p_session_id uuid)
returns table(
  booking_id uuid,
  athlete_id uuid,
  athlete_name text,
  age int,
  sport text,
  guardian_id uuid,
  booked_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('coach','admin')
  ) then
    raise exception 'Coach or admin access required';
  end if;

  return query
  select b.id,
         a.id,
         trim(concat(a.first_name,' ',coalesce(a.last_name,'')))::text,
         a.age,
         a.sport,
         b.guardian_id,
         b.created_at
  from public.bookings b
  join public.athletes a on a.id=b.athlete_id
  where b.session_id=p_session_id and b.status='booked'
  order by a.first_name,a.last_name;
end;
$$;

grant execute on function public.get_session_roster(uuid) to authenticated;
