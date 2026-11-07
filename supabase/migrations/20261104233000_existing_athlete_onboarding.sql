-- Coach attestations recognize onboarding completed before the app; never fabricate
-- appointments, waivers, movement scores, benchmark results or training approval.
create table public.onboarding_attestations (
 id bigint generated always as identity primary key,
 guardian_id uuid not null references public.profiles,
 athlete_id uuid references public.athletes,
 step text not null check(step in ('intro','assessment')),
 completed boolean not null,
 completed_on date check(completed_on is null or completed_on<=current_date),
 note text not null default '' check(length(note)<=1000),
 recorded_by uuid not null references public.profiles,
 recorded_at timestamptz not null default now(),
 check((step='intro' and athlete_id is null) or (step='assessment' and athlete_id is not null)),
 check(completed or completed_on is null)
);
create index onboarding_attestation_lookup on public.onboarding_attestations(guardian_id,step,athlete_id,id desc);
alter table public.onboarding_attestations enable row level security;
revoke all on public.onboarding_attestations from public,anon,authenticated,service_role;
grant select on public.onboarding_attestations to authenticated;
create policy onboarding_attestation_coach_read on public.onboarding_attestations for select to authenticated using(intro_private.is_staff());

create function movement_private.attested(p_guardian uuid,p_athlete uuid,p_step text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select completed from public.onboarding_attestations where guardian_id=p_guardian and athlete_id is not distinct from p_athlete and step=p_step order by id desc limit 1),false)
$$;
create or replace function movement_private.intro_completed(p_guardian uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select movement_private.attested(p_guardian,null,'intro') or exists(select 1 from public.intro_calls where guardian_id=p_guardian and status='completed' and completed_at is not null and end_at<=now())
$$;
create function movement_private.assessment_completed(p_guardian uuid,p_athlete uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select movement_private.attested(p_guardian,p_athlete,'assessment') or exists(select 1 from public.assessment_appointments a join public.assessment_slots s on s.id=a.slot_id where a.guardian_id=p_guardian and a.athlete_id=p_athlete and s.rubric_id is not null and a.status='completed')
$$;
create or replace function movement_private.onboarding(p_guardian uuid,p_athlete uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or (p_guardian is distinct from auth.uid() and not intro_private.is_staff()) then raise exception 'Family access required' using errcode='42501'; end if;
 if p_athlete is not null and not exists(select 1 from public.athletes where id=p_athlete and guardian_id=p_guardian) then raise exception 'Athlete not found' using errcode='42501'; end if;
 return jsonb_build_object('waiver_signed',movement_private.waiver_signed(p_guardian),'intro_completed',movement_private.intro_completed(p_guardian),'training_approved',public.training_approved(p_guardian),
 'intro_previously_completed',movement_private.attested(p_guardian,null,'intro'),
 'assessment_previously_completed',case when p_athlete is not null then movement_private.attested(p_guardian,p_athlete,'assessment') else false end,
 'movement_completed',case when p_athlete is not null then movement_private.assessment_completed(p_guardian,p_athlete) else exists(select 1 from public.athletes where guardian_id=p_guardian) and not exists(select 1 from public.athletes where guardian_id=p_guardian and not movement_private.assessment_completed(p_guardian,id)) end);
end $$;
create function movement_private.record_onboarding(p_athlete uuid,p_step text,p_completed boolean,p_completed_on date,p_note text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_guardian uuid; v_athlete uuid;
begin
 if auth.uid() is null or not intro_private.is_staff() then raise exception 'Coach access required' using errcode='42501'; end if;
 if p_step is null or p_step not in ('intro','assessment') or p_completed is null then raise exception 'Choose an onboarding step and completion status'; end if;
 select guardian_id into v_guardian from public.athletes where id=p_athlete;
 if v_guardian is null then raise exception 'Athlete not found'; end if;
 if length(coalesce(p_note,''))>1000 or p_completed_on>current_date or (not p_completed and p_completed_on is not null) then raise exception 'Choose a past completion date or leave it blank; notes must be 1000 characters or fewer'; end if;
 v_athlete=case when p_step='assessment' then p_athlete end;
 perform pg_advisory_xact_lock(hashtextextended('onboarding:'||v_guardian::text,0));
 if movement_private.attested(v_guardian,v_athlete,p_step) is distinct from p_completed then
  insert into public.onboarding_attestations(guardian_id,athlete_id,step,completed,completed_on,note,recorded_by) values(v_guardian,v_athlete,p_step,p_completed,p_completed_on,coalesce(p_note,''),auth.uid());
 end if;
 return movement_private.onboarding(v_guardian,p_athlete);
end $$;
create function public.record_existing_onboarding(p_athlete_id uuid,p_step text,p_completed boolean,p_completed_on date default null,p_note text default '') returns jsonb
language sql security invoker set search_path=pg_catalog as $$select movement_private.record_onboarding(p_athlete_id,p_step,p_completed,p_completed_on,p_note)$$;
revoke all on function movement_private.attested(uuid,uuid,text),movement_private.assessment_completed(uuid,uuid),movement_private.record_onboarding(uuid,text,boolean,date,text),public.record_existing_onboarding(uuid,text,boolean,date,text) from public,anon,authenticated,service_role;
grant execute on function movement_private.record_onboarding(uuid,text,boolean,date,text),public.record_existing_onboarding(uuid,text,boolean,date,text) to authenticated;
