-- iTrainSpeed Production V1.3 SAFE UPGRADE
-- Run once after V1.2. Safe to rerun.
-- Adds admin program management and safe session cancellation/refunds.

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='programs' and policyname='admin_programs_manage') then
    create policy "admin_programs_manage" on public.programs
    for all
    using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
    with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
  end if;
end $$;

create or replace function public.admin_cancel_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role user_role;
  r record;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role not in ('coach','admin') then raise exception 'Coach or admin access required'; end if;
  if not exists(select 1 from public.sessions where id=p_session_id) then raise exception 'Session not found'; end if;

  for r in
    select guardian_id, coalesce(credit_cost,0) as credit_cost
    from public.bookings
    where session_id=p_session_id and status='booked'
    for update
  loop
    update public.profiles set credits=credits+r.credit_cost where id=r.guardian_id;
  end loop;

  update public.bookings set status='cancelled' where session_id=p_session_id and status='booked';
  update public.sessions set status='cancelled' where id=p_session_id;
end;
$$;

grant execute on function public.admin_cancel_session(uuid) to authenticated;
