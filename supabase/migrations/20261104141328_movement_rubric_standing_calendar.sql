-- REVIEW ONLY: additive follow-up to the released assessment schema.
-- Do not replay earlier grandfathering, baseline or scheduler migrations.
begin;
create schema movement_private;
revoke all on schema movement_private from public;
create table public.movement_rubrics (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 60),
 active boolean not null default true, supersedes uuid references public.movement_rubrics,
 created_by uuid references public.profiles, created_at timestamptz not null default now()
);
alter table public.assessment_slots alter column template_id drop not null;
alter table public.assessment_slots add column rubric_id uuid references public.movement_rubrics;
alter table public.assessment_slots add constraint assessment_slot_kind check(num_nonnulls(template_id,rubric_id)=1);
alter table public.assessment_slots add constraint movement_slot_duration check(rubric_id is null or end_at=start_at+interval '45 minutes');
alter table public.assessment_appointments add column rescheduled_from uuid references public.assessment_appointments;
create unique index movement_one_reschedule on public.assessment_appointments(rescheduled_from) where rescheduled_from is not null;
create table public.movement_reports (
 id uuid primary key default gen_random_uuid(), appointment_id uuid not null unique references public.assessment_appointments,
 athlete_id uuid not null references public.athletes, rubric_id uuid not null references public.movement_rubrics,
 rubric_snapshot jsonb not null, scores jsonb not null, assessed_on date not null,
 observations text not null default '' check(length(observations)<=5000), strengths text not null default '' check(length(strengths)<=5000),
 priorities text not null default '' check(length(priorities)<=5000), revision integer not null check(revision>0),
 created_by uuid not null references public.profiles, updated_by uuid not null references public.profiles,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index movement_reports_athlete on public.movement_reports(athlete_id,assessed_on);
create table public.movement_report_revisions (
 report_id uuid not null references public.movement_reports, revision integer not null,
 snapshot jsonb not null, changed_by uuid not null references public.profiles, changed_at timestamptz not null default now(),
 primary key(report_id,revision)
);
alter table public.movement_rubrics enable row level security;
alter table public.movement_reports enable row level security;
alter table public.movement_report_revisions enable row level security;
revoke all on public.movement_rubrics,public.movement_reports,public.movement_report_revisions from public,anon,authenticated,service_role;
grant select on public.movement_rubrics,public.movement_reports,public.movement_report_revisions to authenticated;
create policy movement_rubric_read on public.movement_rubrics for select to authenticated using(auth.uid() is not null);
create policy movement_report_read on public.movement_reports for select to authenticated using(intro_private.is_staff() or exists(select 1 from public.athletes a where a.id=athlete_id and a.guardian_id=auth.uid()));
create policy movement_revision_read on public.movement_report_revisions for select to authenticated using(exists(select 1 from public.movement_reports r where r.id=report_id));

alter table public.intro_calls drop constraint intro_calls_status_check;
alter table public.intro_calls add constraint intro_calls_status_check check(status in ('booked','cancelled','completed','no_show'));
alter table public.intro_calls add column completed_at timestamptz;
alter table public.intro_calls add column completed_by uuid references public.profiles;
create function movement_private.waiver_signed(p_guardian uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles where id=p_guardian and waiver_accepted_at is not null and waiver_version='2026-01' and length(trim(waiver_signed_name))>=2)
$$;
create function movement_private.intro_completed(p_guardian uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.intro_calls where guardian_id=p_guardian and status='completed' and completed_at is not null and end_at<=now())
$$;
-- Staff roles come from protected profiles, never editable user_metadata.
create function movement_private.onboarding(p_guardian uuid,p_athlete uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or (p_guardian is distinct from auth.uid() and not intro_private.is_staff()) then raise exception 'Family access required' using errcode='42501'; end if;
 if p_athlete is not null and not exists(select 1 from public.athletes where id=p_athlete and guardian_id=p_guardian) then raise exception 'Athlete not found' using errcode='42501'; end if;
 return jsonb_build_object('waiver_signed',movement_private.waiver_signed(p_guardian),'intro_completed',movement_private.intro_completed(p_guardian),'training_approved',public.training_approved(p_guardian),
 'movement_completed',exists(select 1 from public.assessment_appointments a join public.assessment_slots s on s.id=a.slot_id where a.guardian_id=p_guardian and (p_athlete is null or a.athlete_id=p_athlete) and s.rubric_id is not null and a.status='completed'));
end $$;
create function public.athlete_onboarding_status(p_guardian_id uuid,p_athlete_id uuid default null) returns jsonb
language sql security invoker set search_path=pg_catalog as $$select movement_private.onboarding(p_guardian_id,p_athlete_id)$$;

-- Standing schedule replaces the need for date-by-date 'available' windows.
-- Existing training lacks an assigned-coach field. Reserve all activity globally,
-- matching the conservative shared-calendar policy of the released assessment system.
create function movement_private.calendar_free(p_coach uuid,p_start timestamptz,p_end timestamptz,p_ignore_slot uuid default null) returns boolean
language sql volatile security definer set search_path=pg_catalog,public as $$
 select p_end>p_start
 and exists(select 1 from public.profiles where id=p_coach and role in ('coach','admin'))
 and extract(isodow from p_start at time zone 'America/New_York') between 1 and 6
 and (p_start at time zone 'America/New_York')::date=(p_end at time zone 'America/New_York')::date
 and (p_start at time zone 'America/New_York')::time>=time '09:00'
 and (p_end at time zone 'America/New_York')::time<=time '16:00'
 and not exists(select 1 from public.intro_windows w where w.kind='blocked' and w.start_at<p_end and w.end_at>p_start)
 and not exists(select 1 from public.intro_calls c where c.status='booked' and c.start_at<p_end and c.end_at>p_start)
 and not exists(select 1 from public.sessions s where s.status='published' and s.start_at<p_end and s.start_at+make_interval(mins=>coalesce(s.duration_minutes,60))>p_start)
 and not exists(select 1 from public.assessment_slots s where not s.cancelled and s.id is distinct from p_ignore_slot and s.start_at<p_end and s.end_at>p_start)
$$;
create or replace function intro_private.slot_free(p_coach uuid,p_start timestamptz,p_end timestamptz) returns boolean
language sql volatile security definer set search_path=pg_catalog,public as $$select movement_private.calendar_free(p_coach,p_start,p_end)$$;
create or replace function public.intro_slots(p_coach_id uuid,p_date date) returns table(start_at timestamptz)
language sql volatile security definer set search_path=pg_catalog,public as $$
 select slot from generate_series((p_date+time '09:00') at time zone 'America/New_York',(p_date+time '15:40') at time zone 'America/New_York',interval '20 minutes') slot
 where auth.uid() is not null and (intro_private.is_staff() or movement_private.waiver_signed(auth.uid()))
 and p_date between (now() at time zone 'America/New_York')::date and (now() at time zone 'America/New_York')::date+90
 and slot>=clock_timestamp()+interval '24 hours' and intro_private.valid_intro_time(slot) and intro_private.slot_free(p_coach_id,slot,slot+interval '20 minutes')
$$;
create or replace function intro_private.validate_call() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' then
  if (new.coach_id,new.guardian_id,new.start_at,new.end_at,new.source_id) is distinct from (old.coach_id,old.guardian_id,old.start_at,old.end_at,old.source_id) then raise exception 'Cancel and rebook to change an intro call'; end if;
  if new.status<>old.status then
   if old.status<>'booked' then raise exception 'This intro call is already finalized'; end if;
   if new.status in ('completed','no_show') then
    if not intro_private.is_staff() then raise exception 'Coach access required' using errcode='42501'; end if;
    if new.end_at>clock_timestamp() then raise exception 'The intro call has not ended'; end if;
   end if;
  end if;
  if new.status='completed' then
   if tg_op='UPDATE' and old.status='completed' and (new.completed_at,new.completed_by) is distinct from (old.completed_at,old.completed_by) then raise exception 'Completion audit is immutable'; end if;
   if new.completed_at is null or new.completed_by is null then raise exception 'Coach completion audit required'; end if;
  end if;
  return new;
 end if;
 if new.status<>'booked' then raise exception 'New calls must be booked'; end if;
 if not movement_private.waiver_signed(new.guardian_id) then raise exception 'Sign the participation waiver before scheduling an intro call' using errcode='42501'; end if;
 if new.start_at<clock_timestamp()+interval '24 hours' then raise exception 'At least 24 hours advance notice required'; end if;
 if not intro_private.valid_intro_time(new.start_at) then raise exception 'Choose an available intro time'; end if;
 if not intro_private.slot_free(new.coach_id,new.start_at,new.end_at) then raise exception 'This time is no longer available'; end if;
 if exists(select 1 from public.intro_calls where guardian_id=new.guardian_id and status='booked' and end_at>now()) then raise exception 'This family already has an upcoming intro call'; end if;
 return new;
end $$;
-- No retrospective completion or approval inference for old families/calls.
create function movement_private.intro_status(p_call uuid,p_status text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not intro_private.is_staff() then raise exception 'Coach access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(619402611);
 if p_status not in ('completed','cancelled','no_show') then raise exception 'Choose a valid status'; end if;
 update public.intro_calls set status=p_status,completed_at=case when p_status='completed' then now() end,completed_by=case when p_status='completed' then auth.uid() end where id=p_call and status='booked';
 if not found then raise exception 'Booked intro call not found'; end if;
end $$;
create function public.set_intro_call_status(p_call_id uuid,p_status text) returns void
language sql security invoker set search_path=pg_catalog as $$select movement_private.intro_status(p_call_id,p_status)$$;
create or replace function intro_private.enqueue_mail() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.source_id is null and new.status in ('booked','cancelled') and (tg_op='INSERT' or new.status is distinct from old.status) then
  insert into public.intro_mail(call_id,kind,recipient) values(new.id,new.status,'family'),(new.id,new.status,'coach') on conflict do nothing;
 end if;
 return new;
end $$;
create or replace function intro_private.validate_window() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op in ('INSERT','UPDATE') then
  if not exists(select 1 from public.profiles where id=new.coach_id and role in ('coach','admin')) then raise exception 'Coach not found'; end if;
  if new.kind='blocked' and exists(select 1 from public.intro_calls c where c.status='booked' and c.start_at<new.end_at and c.end_at>new.start_at) then raise exception 'Reschedule or cancel the conflicting intro call first'; end if;
 end if;
 return null;
end $$;
create function movement_private.available(p_coach uuid,p_date date,p_ignore_appointment uuid default null) returns table(start_at timestamptz,end_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_ignore uuid;
begin
 if p_ignore_appointment is not null then
  if not intro_private.is_staff() then raise exception 'Coach access required' using errcode='42501'; end if;
  select a.slot_id into strict v_ignore from public.assessment_appointments a join public.assessment_slots s on s.id=a.slot_id where a.id=p_ignore_appointment and a.status='booked' and s.rubric_id is not null;
 end if;
 return query select slot,slot+interval '45 minutes' from generate_series((p_date+time '09:00') at time zone 'America/New_York',(p_date+time '15:15') at time zone 'America/New_York',interval '15 minutes') slot
 where auth.uid() is not null and (intro_private.is_staff() or (movement_private.waiver_signed(auth.uid()) and movement_private.intro_completed(auth.uid())))
 and p_date between (now() at time zone 'America/New_York')::date and (now() at time zone 'America/New_York')::date+90
 and slot>clock_timestamp() and movement_private.calendar_free(p_coach,slot,slot+interval '45 minutes',v_ignore);
end $$;
create function public.movement_assessment_slots(p_coach_id uuid,p_date date,p_ignore_appointment_id uuid default null) returns table(start_at timestamptz,end_at timestamptz)
language sql security invoker set search_path=pg_catalog as $$select * from movement_private.available(p_coach_id,p_date,p_ignore_appointment_id)$$;

create function movement_private.manage(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_staff boolean; v_id uuid; v_guardian uuid; v_athlete uuid; v_coach uuid; v_start timestamptz; v_slot uuid; v_old public.assessment_appointments; v_old_slot public.assessment_slots;
 v_rubric public.movement_rubrics; v_report public.movement_reports; v_item jsonb; v_score numeric; v_snapshot jsonb; v_revision integer; v_date date; v_status text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED'; end if;
 perform pg_advisory_xact_lock(619402611);
 v_staff:=intro_private.is_staff();
 if p_action not in ('book','cancel') and not v_staff then raise exception 'Coach access required' using errcode='42501'; end if;
 case p_action
 when 'create_rubric' then
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 60 then raise exception 'Choose 1 to 60 rubric items'; end if;
  for v_item in select * from jsonb_array_elements(p_data->'items') loop
   if coalesce(v_item->>'key','')!~'^[A-Za-z0-9_-]{1,80}$' or length(trim(coalesce(v_item->>'section',''))) not between 1 and 120 or length(trim(coalesce(v_item->>'drill',''))) not between 1 and 120 or length(coalesce(v_item->>'dosage',''))>120 then raise exception 'Each rubric item needs a unique key, section and drill'; end if;
  end loop;
  if (select count(*)<>count(distinct i->>'key') from jsonb_array_elements(p_data->'items') i) then raise exception 'Duplicate rubric keys'; end if;
  if p_data->>'supersedes' is not null and not exists(select 1 from public.movement_rubrics where id=(p_data->>'supersedes')::uuid) then raise exception 'Rubric to revise not found'; end if;
  insert into public.movement_rubrics(name,items,supersedes,created_by) values(trim(p_data->>'name'),p_data->'items',(p_data->>'supersedes')::uuid,auth.uid()) returning id into v_id;
  if p_data->>'supersedes' is not null then update public.movement_rubrics set active=false where id=(p_data->>'supersedes')::uuid; end if;
 when 'archive_rubric' then
  update public.movement_rubrics set active=false where id=(p_data->>'id')::uuid returning id into v_id;
 when 'book','reschedule' then
  v_athlete:=(p_data->>'athlete_id')::uuid;
  if p_action='reschedule' then
   select * into strict v_old from public.assessment_appointments where id=(p_data->>'id')::uuid and status='booked';
   select * into strict v_old_slot from public.assessment_slots where id=v_old.slot_id and rubric_id is not null and not cancelled;
   if v_old_slot.start_at<=now() then raise exception 'Only upcoming assessments can be rescheduled'; end if;
   v_athlete:=v_old.athlete_id;
  end if;
  select guardian_id into strict v_guardian from public.athletes where id=v_athlete;
  if not v_staff and v_guardian<>auth.uid() then raise exception 'Athlete not found' using errcode='42501'; end if;
  if not movement_private.waiver_signed(v_guardian) then raise exception 'A signed participation waiver is required' using errcode='42501'; end if;
  if not movement_private.intro_completed(v_guardian) then raise exception 'The coach must complete the intro call before scheduling an assessment' using errcode='42501'; end if;
  select * into strict v_rubric from public.movement_rubrics where id=coalesce((p_data->>'rubric_id')::uuid,v_old_slot.rubric_id) and (active or (p_action='reschedule' and id=v_old_slot.rubric_id));
  v_coach:=(p_data->>'coach_id')::uuid;v_start:=(p_data->>'start_at')::timestamptz;
  if v_start is null or v_start<=clock_timestamp() or v_start>now()+interval '90 days' or extract(second from v_start)<>0 or extract(minute from v_start at time zone 'America/New_York')::int%15<>0 then raise exception 'Choose an available assessment time within 90 days'; end if;
  if not movement_private.calendar_free(v_coach,v_start,v_start+interval '45 minutes',v_old_slot.id) then raise exception 'This time is no longer available'; end if;
  if exists(select 1 from public.assessment_appointments a join public.assessment_slots s on s.id=a.slot_id where a.athlete_id=v_athlete and a.status='booked' and not s.cancelled and s.rubric_id is not null and s.end_at>now() and a.id is distinct from v_old.id) then raise exception 'Athlete already has a scheduled assessment'; end if;
  if p_action='reschedule' then
   update public.assessment_appointments set status='cancelled' where id=v_old.id;
   update public.assessment_slots set cancelled=true where id=v_old_slot.id;
  end if;
  insert into public.assessment_slots(coach_id,rubric_id,start_at,end_at,location) values(v_coach,v_rubric.id,v_start,v_start+interval '45 minutes',case when v_staff then coalesce(nullif(trim(p_data->>'location'),''),v_old_slot.location,'iTrainSpeed') else 'iTrainSpeed' end) returning id into v_slot;
  insert into public.assessment_appointments(slot_id,athlete_id,guardian_id,rescheduled_from) values(v_slot,v_athlete,v_guardian,v_old.id) returning id into v_id;
  return jsonb_build_object('id',v_id,'notifications',case when v_old.id is null then jsonb_build_array(v_id) else jsonb_build_array(v_old.id,v_id) end);
 when 'cancel','status' then
  select * into strict v_old from public.assessment_appointments where id=(p_data->>'id')::uuid and status='booked';
  select * into strict v_old_slot from public.assessment_slots where id=v_old.slot_id and rubric_id is not null;
  if not v_staff and (v_old.guardian_id<>auth.uid() or v_old_slot.start_at<=now()) then raise exception 'Contact your coach for cancellation assistance' using errcode='42501'; end if;
  v_status:=case when p_action='cancel' then 'cancelled' else p_data->>'status' end;
  if v_status not in ('completed','cancelled','no_show') or v_status is null then raise exception 'Choose completed, cancelled or no-show'; end if;
  if v_status in ('completed','no_show') and v_old_slot.end_at>now() then raise exception 'The assessment has not ended'; end if;
  update public.assessment_appointments set status=v_status where id=v_old.id returning id into v_id;
  if v_status='cancelled' then update public.assessment_slots set cancelled=true where id=v_old_slot.id; end if;
  return jsonb_build_object('id',v_id,'notifications',case when v_status='no_show' then '[]'::jsonb else jsonb_build_array(v_id) end);
 when 'save_report' then
  select * into strict v_old from public.assessment_appointments where id=(p_data->>'appointment_id')::uuid and status in ('booked','completed');
  select * into strict v_old_slot from public.assessment_slots where id=v_old.slot_id and rubric_id is not null and not cancelled;
  if v_old_slot.start_at>now() then raise exception 'The assessment has not started'; end if;
  v_date:=(p_data->>'assessed_on')::date;
  if v_date is null or v_date<(v_old_slot.start_at at time zone 'America/New_York')::date or v_date>(now() at time zone 'America/New_York')::date then raise exception 'Choose a valid assessment date'; end if;
  select * into v_report from public.movement_reports where appointment_id=v_old.id;
  if coalesce((p_data->>'expected_revision')::int,-1)<>coalesce(v_report.revision,0) then raise exception 'Assessment was changed by another coach. Reload before editing'; end if;
  select * into strict v_rubric from public.movement_rubrics where id=v_old_slot.rubric_id;
  v_snapshot:=coalesce(v_report.rubric_snapshot,jsonb_build_object('name',v_rubric.name,'items',v_rubric.items));
  if jsonb_typeof(p_data->'scores') is distinct from 'array' or jsonb_array_length(p_data->'scores') not between 1 and 60 then raise exception 'Enter movement scores'; end if;
  if (select count(*)<>count(distinct i->>'key') from jsonb_array_elements(p_data->'scores') i) then raise exception 'Duplicate drill scores'; end if;
  for v_item in select * from jsonb_array_elements(p_data->'scores') loop
   if not exists(select 1 from jsonb_array_elements(v_snapshot->'items') i where i->>'key'=v_item->>'key') then raise exception 'Drill does not belong to the assessment rubric'; end if;
   if jsonb_typeof(v_item->'score') is distinct from 'null' and jsonb_typeof(v_item->'score') is distinct from 'number' then raise exception 'Use numeric scores or leave untested drills blank'; end if;
   v_score:=(v_item->>'score')::numeric;
   if v_score is not null and (v_score<1 or v_score>5 or mod(v_score*2,1)<>0) then raise exception 'Scores must be 1–5 in half-point increments'; end if;
   if length(coalesce(v_item->>'notes',''))>2000 then raise exception 'Drill notes must be 2000 characters or fewer'; end if;
  end loop;
  if not exists(select 1 from jsonb_array_elements(p_data->'scores') i where jsonb_typeof(i->'score')='number') then raise exception 'Score at least one drill'; end if;
  v_revision:=coalesce(v_report.revision,0)+1;
  insert into public.movement_reports(appointment_id,athlete_id,rubric_id,rubric_snapshot,scores,assessed_on,observations,strengths,priorities,revision,created_by,updated_by)
  values(v_old.id,v_old.athlete_id,v_rubric.id,v_snapshot,p_data->'scores',v_date,coalesce(p_data->>'observations',''),coalesce(p_data->>'strengths',''),coalesce(p_data->>'priorities',''),v_revision,auth.uid(),auth.uid())
  on conflict(appointment_id) do update set scores=excluded.scores,assessed_on=excluded.assessed_on,observations=excluded.observations,strengths=excluded.strengths,priorities=excluded.priorities,revision=excluded.revision,updated_by=auth.uid(),updated_at=now() returning * into v_report;
  insert into public.movement_report_revisions(report_id,revision,snapshot,changed_by) values(v_report.id,v_revision,to_jsonb(v_report),auth.uid());v_id:=v_report.id;
 else raise exception 'Unknown movement action';
 end case;
 if v_id is null then raise exception 'Record not found'; end if;
 return jsonb_build_object('id',v_id,'notifications','[]'::jsonb);
end $$;
create function public.manage_movement(p_action text,p_data jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$select movement_private.manage(p_action,p_data)$$;

-- Keep the released performance API for tests, benchmarks and legacy history.
-- It cannot create new performance appointments or write numbers into movement reports.
alter function assessment_private.manage(text,jsonb) rename to manage_legacy;
create function assessment_private.manage(p_action text,p_data jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if p_action in ('publish_slot','book') then raise exception 'Use the movement assessment calendar. Performance benchmarks do not require appointments'; end if;
 if p_action in ('cancel','cancel_slot','no_show','save_results') and exists(select 1 from public.assessment_slots s left join public.assessment_appointments a on a.slot_id=s.id where s.rubric_id is not null and (s.id=(p_data->>'id')::uuid or a.id=(p_data->>'id')::uuid)) then raise exception 'Use movement assessment controls'; end if;
 return assessment_private.manage_legacy(p_action,p_data);
end $$;
-- Public SQL wrapper may retain a dependency on the renamed function: bind it explicitly.
create or replace function public.manage_assessment(p_action text,p_data jsonb) returns uuid
language sql security invoker set search_path=pg_catalog as $$select assessment_private.manage(p_action,p_data)$$;
revoke all on function assessment_private.manage(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function assessment_private.manage(text,jsonb) to authenticated;
-- Revoke direct client access to the legacy manager. The private definer facade
-- checks retired actions first; the legacy body still enforces auth.uid/staff/ownership.
revoke all on function assessment_private.manage_legacy(text,jsonb) from public,anon,authenticated,service_role;
alter function assessment_private.manage(text,jsonb) security definer;

-- Explicit ACLs defeat permissive inherited default privileges.
revoke all on all functions in schema movement_private from public,anon,authenticated,service_role;
grant usage on schema movement_private to authenticated;
grant execute on function movement_private.onboarding(uuid,uuid),movement_private.intro_status(uuid,text),movement_private.available(uuid,date,uuid),movement_private.manage(text,jsonb) to authenticated;
revoke all on function public.athlete_onboarding_status(uuid,uuid),public.set_intro_call_status(uuid,text),public.movement_assessment_slots(uuid,date,uuid),public.manage_movement(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.athlete_onboarding_status(uuid,uuid),public.set_intro_call_status(uuid,text),public.movement_assessment_slots(uuid,date,uuid),public.manage_movement(text,jsonb) to authenticated;

insert into public.movement_rubrics(name,items)
select 'Initial Movement Assessment',jsonb_agg(jsonb_build_object('key',k,'section',section,'drill',drill,'dosage',dosage) order by n)
from (values
(1,'jump-rope','Dynamic Warm-Up','Jump Rope','2 min'),
(2,'high-knees','Dynamic Warm-Up','High Knees','30 sec'),
(3,'butt-kicks','Dynamic Warm-Up','Butt Kicks','30 sec'),
(4,'a-skips','Dynamic Warm-Up','A-Skips','30 sec'),
(5,'lateral-shuffles','Dynamic Warm-Up','Lateral Shuffles','30 sec'),
(6,'arm-hip','Dynamic Warm-Up','Arm Swings, Hip Circles',''),
(7,'wall-drill','Sprint Mechanics & Acceleration','Wall Drill','2 x 10 reps'),
(8,'zig-zag','Agility & Change of Direction','Zig-Zag Cone Drill','2 reps'),
(9,'ladder','Body Movement','Ladder Overall',''),
(10,'load-leg-first','Body Movement','Load Leg — first entry',''),
(11,'shuffle-first','Body Movement','Shuffle',''),
(12,'fast-feet','Body Movement','Fast Feet',''),
(13,'fast-knees','Body Movement','Fast Knees',''),
(14,'sprint-skips','Body Movement','Sprint Skips',''),
(15,'single-leg-bounds','Body Movement','1 Leg Bounds',''),
(16,'load-leg-second','Body Movement','Load Leg — second entry',''),
(17,'shuffles-second','Body Movement','Shuffles',''),
(18,'endurance','Body Movement','Endurance',''),
(19,'confidence','Body Movement','Mental Confidence',''),
(20,'coordination','Body Movement','Coordination','')
) seed(n,k,section,drill,dosage);
-- Display-name cleanup only; IDs, protocols, units, history snapshots and template membership stay intact.
update public.assessment_tests t set name=n.new_name from (values
 ('10m fly','10m Fly'),('30-second run','30-second Run'),('45-second run','45-second Run'),
 ('Standing broad jump','Broad Jump'),('Vertical jump','Vertical Jump'),('40-yard dash','40-yard Dash'),
 ('60-yard dash (baseball)','60-yard Dash'),('5-10-5 shuttle','5-10-5 Shuttle')
) n(old_name,new_name) where t.name=n.old_name;
update public.assessment_templates set name=case name when 'Track baseline / initial assessment' then 'Track Benchmarks' when 'Baseball baseline / initial assessment' then 'Baseball Benchmarks' when 'Speed & power baseline / initial assessment' then 'Speed & Power Benchmarks' end
where name in ('Track baseline / initial assessment','Baseball baseline / initial assessment','Speed & power baseline / initial assessment');
notify pgrst,'reload schema';
commit;
