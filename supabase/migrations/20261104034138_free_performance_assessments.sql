-- REVIEW ONLY. Apply after v1-6-intro-approval.sql; never run old baseline migrations again.
begin;
create schema assessment_private;
revoke all on schema assessment_private from public;
create table public.assessment_tests (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 unit text not null check(length(trim(unit)) between 1 and 30), protocol text not null check(length(trim(protocol)) between 1 and 2000),
 direction text not null check(direction in ('lower','higher')), active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.assessment_templates (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 120),
 test_ids uuid[] not null check(cardinality(test_ids) between 1 and 30), active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.assessment_slots (
 id uuid primary key default gen_random_uuid(), coach_id uuid not null references public.profiles,
 template_id uuid not null references public.assessment_templates,
 start_at timestamptz not null, end_at timestamptz not null,
 location text not null check(length(trim(location)) between 1 and 300), cancelled boolean not null default false,
 price_cents integer not null default 0 check(price_cents=0), credit_cost integer not null default 0 check(credit_cost=0),
 check(end_at>start_at and end_at<=start_at+interval '2 hours')
);
create table public.assessment_appointments (
 id uuid primary key default gen_random_uuid(), slot_id uuid not null references public.assessment_slots,
 athlete_id uuid not null references public.athletes, guardian_id uuid not null references public.profiles,
 status text not null default 'booked' check(status in ('booked','cancelled','completed','no_show')),
 created_at timestamptz not null default now()
);
create unique index assessment_one_booking on public.assessment_appointments(slot_id) where status<>'cancelled';
create index assessment_athlete_appointments on public.assessment_appointments(athlete_id);
create index assessment_guardian_appointments on public.assessment_appointments(guardian_id);
create index assessment_slot_start on public.assessment_slots(start_at);
-- Ongoing coaching entries are independent of assessment appointments.
create table public.athlete_training_entries (
 id uuid primary key, athlete_id uuid not null references public.athletes,
 created_by uuid not null references public.profiles, payload jsonb not null,
 created_at timestamptz not null default now()
);
create index athlete_training_entry_athlete on public.athlete_training_entries(athlete_id);
alter table public.athlete_training_entries enable row level security;
revoke all on public.athlete_training_entries from public,anon,authenticated;
-- Internal request ledger: no client read/write grants or policies.
create table public.assessment_results (
 id uuid primary key default gen_random_uuid(), appointment_id uuid references public.assessment_appointments,
 training_entry_id uuid references public.athlete_training_entries,
 check(num_nonnulls(appointment_id,training_entry_id)=1),
 athlete_id uuid not null references public.athletes, test_id uuid not null references public.assessment_tests,
 value numeric not null check(value>0 and value<'Infinity'::numeric), tested_at date not null,
 test_name text not null, unit text not null, protocol text not null, direction text not null check(direction in ('lower','higher')),
 notes text not null default '' check(length(notes)<=2000), created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(), void_reason text, voided_at timestamptz, voided_by uuid references public.profiles,
 source text not null default 'manual' check(source in ('manual','ovr_csv')),
 source_record_id text, source_metadata jsonb not null default '{}'::jsonb
);
create unique index assessment_one_result on public.assessment_results(appointment_id,test_id) where voided_at is null;
create unique index training_one_result on public.assessment_results(training_entry_id,test_id) where voided_at is null;
create index assessment_result_history on public.assessment_results(athlete_id,tested_at);
create unique index assessment_import_identity on public.assessment_results(source,source_record_id) where source_record_id is not null;
-- Reserved provenance fields are not writable by browser clients. No importer/API sync is assumed.
create table public.assessment_mail (
 id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.assessment_appointments,
 kind text not null check(kind in ('booked','cancelled','completed')), recipient text not null check(recipient in ('family','coach')),
 state text not null default 'pending' check(state in ('pending','sending','sent')), claimed_at timestamptz, sent_at timestamptz,
 unique(appointment_id,kind,recipient)
);

-- All writes are explicit authenticated operations. Tables expose SELECT only.
create function assessment_private.manage(p_action text,p_data jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_slot public.assessment_slots; v_appt public.assessment_appointments;
 v_test public.assessment_tests; v_item jsonb; v_guardian uuid; v_staff boolean; v_date date;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 v_staff:=intro_private.is_staff();
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED'; end if;
 -- Same lock as the released intro/training calendar; checks follow acquisition.
 perform pg_advisory_xact_lock(619402611);
 if p_action in ('create_test','archive_test','create_template','archive_template','publish_slot','cancel_slot','save_results','save_training_results','void_result','no_show') and not v_staff then
  raise exception 'Coach access required' using errcode='42501';
 end if;
 case p_action
 when 'create_test' then
  insert into public.assessment_tests(name,unit,protocol,direction) values(trim(p_data->>'name'),trim(p_data->>'unit'),trim(p_data->>'protocol'),p_data->>'direction') returning id into v_id;
 when 'archive_test' then
  update public.assessment_tests set active=false where id=(p_data->>'id')::uuid returning id into v_id;
 when 'create_template' then
  if jsonb_typeof(p_data->'test_ids') is distinct from 'array' then raise exception 'Choose tests'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_data->'test_ids') x where not exists(select 1 from public.assessment_tests t where t.id=x::uuid and t.active)) then raise exception 'Choose active tests'; end if;
  if (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_data->'test_ids') x) then raise exception 'Duplicate tests'; end if;
  insert into public.assessment_templates(name,test_ids) values(trim(p_data->>'name'),array(select x::uuid from jsonb_array_elements_text(p_data->'test_ids') x)) returning id into v_id;
 when 'archive_template' then
  update public.assessment_templates set active=false where id=(p_data->>'id')::uuid returning id into v_id;
 when 'publish_slot' then
  if not exists(select 1 from public.assessment_templates where id=(p_data->>'template_id')::uuid and active) then raise exception 'Choose an active template'; end if;
  if (p_data->>'start_at')::timestamptz<=now() then raise exception 'Choose a future slot'; end if;
  insert into public.assessment_slots(coach_id,template_id,start_at,end_at,location)
   values(auth.uid(),(p_data->>'template_id')::uuid,(p_data->>'start_at')::timestamptz,(p_data->>'end_at')::timestamptz,trim(p_data->>'location')) returning id into v_id;
 when 'book' then
  select * into strict v_slot from public.assessment_slots where id=(p_data->>'slot_id')::uuid and not cancelled and start_at>now();
  select guardian_id into strict v_guardian from public.athletes where id=(p_data->>'athlete_id')::uuid;
  if v_guardian<>auth.uid() and not v_staff then raise exception 'Athlete not found' using errcode='42501'; end if;
  if not public.training_approved(v_guardian) then raise exception 'Coach approval is required before assessment booking' using errcode='42501'; end if;
  if exists(select 1 from public.assessment_appointments a join public.assessment_slots s on s.id=a.slot_id where a.athlete_id=(p_data->>'athlete_id')::uuid and a.status='booked' and s.start_at<v_slot.end_at and s.end_at>v_slot.start_at) then raise exception 'Athlete already booked at this time'; end if;
  insert into public.assessment_appointments(slot_id,athlete_id,guardian_id) values(v_slot.id,(p_data->>'athlete_id')::uuid,v_guardian) returning id into v_id;
 when 'cancel','no_show' then
  select * into strict v_appt from public.assessment_appointments where id=(p_data->>'id')::uuid;
  select * into strict v_slot from public.assessment_slots where id=v_appt.slot_id;
  if not v_staff and (v_appt.guardian_id<>auth.uid() or v_slot.start_at<=now()) then raise exception 'Cancellation requires coach assistance' using errcode='42501'; end if;
  if v_appt.status<>'booked' then raise exception 'Appointment is no longer booked'; end if;
  if p_action='no_show' and v_slot.start_at>now() then raise exception 'Appointment has not started'; end if;
  update public.assessment_appointments set status=case when p_action='cancel' then 'cancelled' else 'no_show' end where id=v_appt.id returning id into v_id;
 when 'cancel_slot' then
  update public.assessment_slots set cancelled=true where id=(p_data->>'id')::uuid returning id into v_id;
  update public.assessment_appointments set status='cancelled' where slot_id=v_id and status='booked';
 when 'save_results' then
  select * into strict v_appt from public.assessment_appointments where id=(p_data->>'id')::uuid and status in ('booked','completed');
  select * into strict v_slot from public.assessment_slots where id=v_appt.slot_id and not cancelled;
  v_date:=(p_data->>'tested_at')::date;
  if v_date is null or v_date>(now() at time zone 'America/New_York')::date or v_slot.start_at>now() then raise exception 'Results require an assessment that has started and a nonfuture date'; end if;
  if v_date<(v_slot.start_at at time zone 'America/New_York')::date then raise exception 'Testing date precedes appointment'; end if;
  if jsonb_typeof(p_data->'results') is distinct from 'array' or jsonb_array_length(p_data->'results') not between 1 and 30 then raise exception 'Enter 1 to 30 results'; end if;
  for v_item in select * from jsonb_array_elements(p_data->'results') loop
   select t.* into strict v_test from public.assessment_tests t join public.assessment_templates tpl on t.id=any(tpl.test_ids) where tpl.id=v_slot.template_id and t.id=(v_item->>'test_id')::uuid;
   insert into public.assessment_results(appointment_id,athlete_id,test_id,value,tested_at,test_name,unit,protocol,direction,notes,created_by)
   values(v_appt.id,v_appt.athlete_id,v_test.id,(v_item->>'value')::numeric,v_date,v_test.name,v_test.unit,v_test.protocol,v_test.direction,coalesce(v_item->>'notes',''),auth.uid());
  end loop;
  update public.assessment_appointments set status='completed' where id=v_appt.id returning id into v_id;
 when 'save_training_results' then
  select guardian_id into strict v_guardian from public.athletes where id=(p_data->>'athlete_id')::uuid;
  v_date:=(p_data->>'tested_at')::date;
  if v_date is null or v_date>(now() at time zone 'America/New_York')::date then raise exception 'Choose a nonfuture testing date'; end if;
  if jsonb_typeof(p_data->'results') is distinct from 'array' or jsonb_array_length(p_data->'results') not between 1 and 30 then raise exception 'Enter 1 to 30 results'; end if;
  v_id:=(p_data->>'entry_id')::uuid;
  if v_id is null then raise exception 'Entry ID is required'; end if;
  if exists(select 1 from public.athlete_training_entries where id=v_id) then
   if exists(select 1 from public.athlete_training_entries where id=v_id and created_by=auth.uid() and payload=p_data) then return v_id; end if;
   raise exception 'Entry ID has already been used';
  end if;
  insert into public.athlete_training_entries(id,athlete_id,created_by,payload) values(v_id,(p_data->>'athlete_id')::uuid,auth.uid(),p_data);
  for v_item in select * from jsonb_array_elements(p_data->'results') loop
   select * into strict v_test from public.assessment_tests where id=(v_item->>'test_id')::uuid and active;
   insert into public.assessment_results(training_entry_id,athlete_id,test_id,value,tested_at,test_name,unit,protocol,direction,notes,created_by)
   values(v_id,(p_data->>'athlete_id')::uuid,v_test.id,(v_item->>'value')::numeric,v_date,v_test.name,v_test.unit,v_test.protocol,v_test.direction,coalesce(v_item->>'notes',''),auth.uid());
  end loop;
 when 'void_result' then
  if length(trim(coalesce(p_data->>'reason',''))) not between 1 and 500 then raise exception 'Enter a correction reason'; end if;
  update public.assessment_results set void_reason=trim(p_data->>'reason'),voided_at=now(),voided_by=auth.uid() where id=(p_data->>'id')::uuid and voided_at is null returning id into v_id;
 else raise exception 'Unknown assessment action';
 end case;
 if v_id is null then raise exception 'Record not found'; end if;
 return v_id;
end $$;
revoke all on function assessment_private.manage(text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema assessment_private to authenticated;
grant execute on function assessment_private.manage(text,jsonb) to authenticated;
create function public.manage_assessment(p_action text,p_data jsonb) returns uuid
language sql security invoker set search_path=pg_catalog as $$select assessment_private.manage(p_action,p_data)$$;
revoke all on function public.manage_assessment(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.manage_assessment(text,jsonb) to authenticated;

create or replace function intro_private.slot_free(p_coach uuid,p_start timestamptz,p_end timestamptz)
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
 and not exists(select 1 from public.assessment_slots where not cancelled and start_at<p_end and end_at>p_start)
$$;

-- Reciprocal guards: publishing training or booking an intro cannot overlap an assessment.
create function assessment_private.calendar_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_start timestamptz; v_end timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Use READ COMMITTED'; end if;
 perform pg_advisory_xact_lock(619402611);
 if tg_table_name='assessment_slots' then
  if new.cancelled then return new; end if;
  v_start:=new.start_at; v_end:=new.end_at;
  if exists(select 1 from public.assessment_slots s where s.id<>new.id and not s.cancelled and s.start_at<v_end and s.end_at>v_start) then raise exception 'Assessment calendar conflict'; end if;
  if exists(select 1 from public.intro_calls c where c.status='booked' and c.start_at<v_end and c.end_at>v_start) then raise exception 'Intro calendar conflict'; end if;
  if exists(select 1 from public.intro_windows w where w.kind='blocked' and w.start_at<v_end and w.end_at>v_start) then raise exception 'Coach is unavailable'; end if;
  if exists(select 1 from public.sessions s where s.status='published' and s.start_at<v_end and s.start_at+make_interval(mins=>coalesce(s.duration_minutes,60))>v_start) then raise exception 'Training calendar conflict'; end if;
 elsif tg_table_name='sessions' then
  if new.status is distinct from 'published' then return new; end if;
  v_start:=new.start_at;v_end:=new.start_at+make_interval(mins=>coalesce(new.duration_minutes,60));
 elsif tg_table_name='intro_windows' then
  if new.kind<>'blocked' then return new; end if;
  v_start:=new.start_at;v_end:=new.end_at;
 else
  if new.status<>'booked' then return new; end if;
  v_start:=new.start_at;v_end:=new.end_at;
 end if;
 if tg_table_name<>'assessment_slots' and exists(select 1 from public.assessment_slots s where not s.cancelled and s.start_at<v_end and s.end_at>v_start) then raise exception 'Assessment calendar conflict'; end if;
 return new;
end $$;
revoke all on function assessment_private.calendar_guard() from public,anon,authenticated,service_role;
create trigger assessment_calendar before insert or update on public.assessment_slots for each row execute function assessment_private.calendar_guard();
create trigger assessment_training_calendar before insert or update on public.sessions for each row execute function assessment_private.calendar_guard();
create trigger assessment_intro_calendar before insert or update on public.intro_calls for each row execute function assessment_private.calendar_guard();
create trigger assessment_block_calendar before insert or update on public.intro_windows for each row execute function assessment_private.calendar_guard();
create function assessment_private.queue_mail() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and new.status=old.status then return new; end if;
 if new.status in ('booked','cancelled','completed') then
 insert into public.assessment_mail(appointment_id,kind,recipient) values(new.id,new.status,'family'),(new.id,new.status,'coach') on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function assessment_private.queue_mail() from public,anon,authenticated,service_role;
create trigger assessment_mail_queue after insert or update on public.assessment_appointments for each row execute function assessment_private.queue_mail();

alter table public.assessment_tests enable row level security;
alter table public.assessment_templates enable row level security;
alter table public.assessment_slots enable row level security;
alter table public.assessment_appointments enable row level security;
alter table public.assessment_results enable row level security;
alter table public.assessment_mail enable row level security;
revoke all on public.assessment_tests,public.assessment_templates,public.assessment_slots,public.assessment_appointments,public.assessment_results,public.assessment_mail from public,anon,authenticated;
grant select on public.assessment_tests,public.assessment_templates,public.assessment_slots,public.assessment_appointments,public.assessment_results to authenticated;
grant all on public.assessment_mail to service_role;
grant select on public.assessment_appointments,public.assessment_slots to service_role;
create policy assessment_test_read on public.assessment_tests for select to authenticated using(auth.uid() is not null);
create policy assessment_template_read on public.assessment_templates for select to authenticated using(auth.uid() is not null);
create policy assessment_slot_read on public.assessment_slots for select to authenticated using(auth.uid() is not null);
create policy assessment_appointment_read on public.assessment_appointments for select to authenticated using(guardian_id=auth.uid() or intro_private.is_staff());
create policy assessment_result_read on public.assessment_results for select to authenticated using(intro_private.is_staff() or exists(select 1 from public.athletes a where a.id=athlete_id and a.guardian_id=auth.uid()));
-- Availability deliberately exposes no athlete or family identities.
-- RLS hides other families' appointments; use a narrowly scoped definer for truthful occupancy.
create function assessment_private.availability() returns setof jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select to_jsonb(s)||jsonb_build_object('occupied',exists(select 1 from public.assessment_appointments a where a.slot_id=s.id and a.status<>'cancelled')) from public.assessment_slots s where auth.uid() is not null and not s.cancelled and s.start_at>now() order by s.start_at limit 200
$$;
revoke all on function assessment_private.availability() from public,anon,authenticated,service_role;
grant execute on function assessment_private.availability() to authenticated;
create function public.assessment_available_slots() returns setof jsonb language sql security invoker set search_path=pg_catalog as $$select * from assessment_private.availability()$$;
revoke all on function public.assessment_available_slots() from public,anon,authenticated,service_role;
grant execute on function public.assessment_available_slots() to authenticated;

insert into public.assessment_tests(name,unit,protocol,direction) values
('10m fly','s','Flying start; time the 10-metre zone. Record run-in distance and timing equipment in notes; use the same setup at retests.','lower'),
('30-second run','m','Standing start; record total distance covered in exactly 30 seconds on the same measured course.','higher'),
('45-second run','m','Standing start; record total distance covered in exactly 45 seconds on the same measured course.','higher'),
('Standing broad jump','in','Two-foot standing takeoff; measure from takeoff line to nearest heel. Record best valid attempt and surface.','higher'),
('Vertical jump','in','Countermovement jump; record jump height using a consistent device and arm-swing protocol. Note equipment and method.','higher'),
('40-yard dash','s','Standing start over 40 yards; keep start stance and timing method consistent. Record best valid attempt.','lower'),
('60-yard dash (baseball)','s','Standing start over 60 yards; keep start stance and timing method consistent. Record best valid attempt.','lower'),
('5-10-5 shuttle','s','Start at center; sprint 5 yards, reverse for 10 yards, return 5 yards. Record starting direction, line-touch rule and timing method.','lower');
insert into public.assessment_templates(name,test_ids) select 'Track baseline / initial assessment',array_agg(id order by name) from public.assessment_tests where name in ('10m fly','30-second run','45-second run');
insert into public.assessment_templates(name,test_ids) select 'Baseball baseline / initial assessment',array_agg(id order by name) from public.assessment_tests where name in ('60-yard dash (baseball)','Standing broad jump','Vertical jump','5-10-5 shuttle');
insert into public.assessment_templates(name,test_ids) select 'Speed & power baseline / initial assessment',array_agg(id order by name) from public.assessment_tests where name in ('10m fly','40-yard dash','Standing broad jump','Vertical jump','5-10-5 shuttle');
commit;
