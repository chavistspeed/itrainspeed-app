-- Source metadata SHA-256: c0745cb8184e14e804b10ae28d4fb12be0f94e582e8a3b07791e386cde9cf011
-- TEST ONLY: reconstructed from user-provided schema metadata, November 2, 2026.
-- No customer records. auth.users and JWT helpers below are isolated test stubs.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role',true),''),'authenticated') $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
create type public.booking_status as enum('booked','cancelled','attended','no_show','waitlisted');
create type public.user_role as enum('parent','coach','admin');
create table public."athletes" ("id" uuid not null default gen_random_uuid(),
"guardian_id" uuid not null,
"first_name" text not null,
"last_name" text,
"age" int4,
"sport" text,
"created_at" timestamptz default now());
create table public."booking_reminders" ("id" uuid not null default gen_random_uuid(),
"booking_id" uuid not null,
"reminder_type" text not null,
"recipient_email" text not null,
"sent_at" timestamptz not null default now(),
"created_at" timestamptz not null default now());
create table public."bookings" ("id" uuid not null default gen_random_uuid(),
"session_id" uuid not null,
"athlete_id" uuid not null,
"guardian_id" uuid not null,
"status" booking_status default 'booked'::booking_status,
"credit_cost" int4 default 1,
"created_at" timestamptz default now(),
"entitlement_id" uuid);
create table public."entitlements" ("id" uuid not null default gen_random_uuid(),
"guardian_id" uuid not null,
"athlete_id" uuid,
"package_id" uuid,
"credit_type" text not null,
"credits_remaining" int4,
"unlimited" bool not null default false,
"starts_at" timestamptz not null default now(),
"expires_at" timestamptz,
"status" text not null default 'active'::text,
"source" text not null default 'manual'::text,
"created_at" timestamptz not null default now(),
"stripe_subscription_id" text,
"updated_at" timestamptz default now(),
"cancel_at_period_end" bool not null default false,
"cancellation_effective_at" timestamptz);
create table public."packages" ("id" uuid not null default gen_random_uuid(),
"name" text not null,
"description" text,
"access_type" text not null default 'credits'::text,
"credit_type" text not null default 'group'::text,
"credits" int4,
"price_cents" int4 not null default 0,
"duration_days" int4,
"recurring" bool not null default false,
"purchase_limit" int4,
"active" bool not null default true,
"sort_order" int4 not null default 0,
"created_at" timestamptz not null default now(),
"stripe_price_id" text,
"stripe_product_id" text,
"payment_type" text default 'one_time'::text);
create table public."performance_results" ("id" uuid not null default gen_random_uuid(),
"athlete_id" uuid,
"metric" text not null,
"value" numeric not null,
"unit" text,
"tested_at" date default CURRENT_DATE,
"created_by" uuid,
"created_at" timestamptz default now());
create table public."profiles" ("id" uuid not null,
"full_name" text,
"role" user_role not null default 'parent'::user_role,
"credits" int4 not null default 0,
"stripe_customer_id" text,
"created_at" timestamptz default now(),
"waiver_accepted_at" timestamptz,
"waiver_signed_name" text,
"waiver_version" text,
"media_consent" bool,
"media_consent_at" timestamptz);
create table public."programs" ("id" uuid not null default gen_random_uuid(),
"name" text not null,
"category" text,
"min_age" int4 default 6,
"max_age" int4 default 18,
"credit_cost" int4 default 1,
"price_cents" int4 default 4000,
"active" bool default true,
"credit_type" text default 'group'::text,
"service_type" text not null default 'group'::text);
create table public."purchases" ("id" uuid not null default gen_random_uuid(),
"guardian_id" uuid,
"stripe_checkout_session_id" text,
"package_key" text,
"credits_added" int4 default 0,
"amount_cents" int4,
"status" text,
"created_at" timestamptz default now(),
"package_id" uuid,
"athlete_id" uuid,
"stripe_payment_intent_id" text,
"stripe_subscription_id" text,
"stripe_customer_id" text,
"payment_status" text default 'pending'::text,
"amount_paid_cents" int4,
"updated_at" timestamptz default now(),
"refunded_amount_cents" int4 not null default 0,
"refunded_at" timestamptz,
"refund_status" text);
create table public."sessions" ("id" uuid not null default gen_random_uuid(),
"program_id" uuid not null,
"start_at" timestamptz not null,
"duration_minutes" int4 default 60,
"capacity" int4 not null default 10,
"location" text,
"status" text default 'published'::text,
"created_by" uuid,
"created_at" timestamptz default now());
create table public."stripe_webhook_events" ("id" uuid not null default gen_random_uuid(),
"stripe_event_id" text not null,
"event_type" text not null,
"processed_at" timestamptz not null default now());
alter table public."athletes" add constraint "athletes_pkey" PRIMARY KEY (id);
alter table public."booking_reminders" add constraint "booking_reminders_pkey" PRIMARY KEY (id);
alter table public."booking_reminders" add constraint "booking_reminders_unique" UNIQUE (booking_id, reminder_type);
alter table public."bookings" add constraint "bookings_pkey" PRIMARY KEY (id);
alter table public."bookings" add constraint "bookings_session_id_athlete_id_key" UNIQUE (session_id, athlete_id);
alter table public."entitlements" add constraint "entitlements_credit_type_check" CHECK ((credit_type = ANY (ARRAY['group'::text, 'private'::text, 'recovery'::text, 'track'::text])));
alter table public."entitlements" add constraint "entitlements_pkey" PRIMARY KEY (id);
alter table public."entitlements" add constraint "entitlements_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text])));
alter table public."packages" add constraint "packages_access_type_check" CHECK ((access_type = ANY (ARRAY['credits'::text, 'membership'::text, 'promotion'::text])));
alter table public."packages" add constraint "packages_credit_type_check" CHECK ((credit_type = ANY (ARRAY['group'::text, 'private'::text, 'recovery'::text, 'track'::text])));
alter table public."packages" add constraint "packages_payment_type_check" CHECK ((payment_type = ANY (ARRAY['one_time'::text, 'subscription'::text])));
alter table public."packages" add constraint "packages_pkey" PRIMARY KEY (id);
alter table public."performance_results" add constraint "performance_results_pkey" PRIMARY KEY (id);
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public."programs" add constraint "programs_pkey" PRIMARY KEY (id);
alter table public."programs" add constraint "programs_service_type_check" CHECK ((service_type = ANY (ARRAY['group'::text, 'private'::text, 'track'::text, 'recovery'::text])));
alter table public."purchases" add constraint "purchases_pkey" PRIMARY KEY (id);
alter table public."purchases" add constraint "purchases_refund_status_check" CHECK (((refund_status IS NULL) OR (refund_status = ANY (ARRAY['partial'::text, 'full'::text]))));
alter table public."purchases" add constraint "purchases_stripe_checkout_session_id_key" UNIQUE (stripe_checkout_session_id);
alter table public."sessions" add constraint "sessions_pkey" PRIMARY KEY (id);
alter table public."stripe_webhook_events" add constraint "stripe_webhook_events_pkey" PRIMARY KEY (id);
alter table public."stripe_webhook_events" add constraint "stripe_webhook_events_stripe_event_id_key" UNIQUE (stripe_event_id);
alter table public."athletes" add constraint "athletes_guardian_id_fkey" FOREIGN KEY (guardian_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."booking_reminders" add constraint "booking_reminders_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public."bookings" add constraint "bookings_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table public."bookings" add constraint "bookings_entitlement_id_fkey" FOREIGN KEY (entitlement_id) REFERENCES entitlements(id) ON DELETE SET NULL;
alter table public."bookings" add constraint "bookings_guardian_id_fkey" FOREIGN KEY (guardian_id) REFERENCES profiles(id);
alter table public."bookings" add constraint "bookings_session_id_fkey" FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public."entitlements" add constraint "entitlements_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table public."entitlements" add constraint "entitlements_guardian_id_fkey" FOREIGN KEY (guardian_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."entitlements" add constraint "entitlements_package_id_fkey" FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL;
alter table public."performance_results" add constraint "performance_results_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
alter table public."performance_results" add constraint "performance_results_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."purchases" add constraint "purchases_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE SET NULL;
alter table public."purchases" add constraint "purchases_guardian_id_fkey" FOREIGN KEY (guardian_id) REFERENCES profiles(id);
alter table public."purchases" add constraint "purchases_package_id_fkey" FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL;
alter table public."sessions" add constraint "sessions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public."sessions" add constraint "sessions_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id);
CREATE INDEX booking_reminders_booking_id_idx ON public.booking_reminders USING btree (booking_id);
CREATE INDEX booking_reminders_sent_at_idx ON public.booking_reminders USING btree (sent_at);
CREATE INDEX idx_entitlements_guardian_type ON public.entitlements USING btree (guardian_id, credit_type);
CREATE INDEX idx_entitlements_subscription ON public.entitlements USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);
CREATE INDEX idx_programs_service_type ON public.programs USING btree (service_type);
CREATE INDEX idx_purchases_guardian ON public.purchases USING btree (guardian_id);
CREATE UNIQUE INDEX purchases_stripe_checkout_session_unique ON public.purchases USING btree (stripe_checkout_session_id) WHERE (stripe_checkout_session_id IS NOT NULL);
CREATE INDEX idx_stripe_webhook_events_processed ON public.stripe_webhook_events USING btree (processed_at);
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id uuid, p_credits integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin update profiles set credits=credits+p_credits where id=p_user_id; end $function$
;
CREATE OR REPLACE FUNCTION public.admin_cancel_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_grant_test_package(p_package_id uuid, p_guardian_id uuid, p_athlete_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.book_session(p_session_id uuid, p_athlete_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select 1
    from public.athletes
    where id = p_athlete_id
      and guardian_id = v_user
  ) then
    raise exception 'Athlete not found';
  end if;

  select p.credit_cost, s.capacity
  into v_cost, v_capacity
  from public.sessions s
  join public.programs p on p.id = s.program_id
  where s.id = p_session_id
    and s.status = 'published'
  for update of s;

  if v_cost is null then
    raise exception 'Session not found or is not available';
  end if;

  select b.id, b.status
  into v_id, v_existing_status
  from public.bookings b
  where b.session_id = p_session_id
    and b.athlete_id = p_athlete_id
  for update;

  if v_existing_status = 'booked' then
    raise exception 'This athlete is already booked for this session';
  end if;

  select count(*)
  into v_booked
  from public.bookings
  where session_id = p_session_id
    and status = 'booked';

  if v_booked >= v_capacity then
    raise exception 'Session is full';
  end if;

  perform 1
  from public.profiles
  where id = v_user
  for update;

  if (
    select credits
    from public.profiles
    where id = v_user
  ) < v_cost then
    raise exception 'Not enough training credits';
  end if;

  update public.profiles
  set credits = credits - v_cost
  where id = v_user;

  if v_id is not null then
    update public.bookings
    set
      status = 'booked',
      guardian_id = v_user,
      credit_cost = v_cost,
      created_at = now()
    where id = v_id;
  else
    insert into public.bookings (
      session_id,
      athlete_id,
      guardian_id,
      credit_cost,
      status
    )
    values (
      p_session_id,
      p_athlete_id,
      v_user,
      v_cost,
      'booked'
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.book_session_v14(p_session_id uuid, p_athlete_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.book_session_v15(p_session_id uuid, p_athlete_id uuid, p_entitlement_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_capacity int;
  v_booked int;
  v_id uuid;
  v_existing_status booking_status;

  v_type text;
  v_ent uuid;
  v_remaining int;
  v_unlimited boolean;
begin

  if v_user is null then
    raise exception 'You must be signed in';
  end if;

  /*
   * -------------------------------------------------------
   * PARTICIPATION WAIVER
   * -------------------------------------------------------
   *
   * Every parent/guardian must have accepted the current
   * iTrainSpeed participation waiver before a booking can
   * be created.
   */
  if not exists (
    select 1
    from public.profiles
    where id = v_user
      and waiver_accepted_at is not null
      and waiver_signed_name is not null
      and length(trim(waiver_signed_name)) > 0
      and waiver_version = '2026-01'
  ) then
    raise exception
      'Complete your Participation Waiver before booking training.';
  end if;

  -- Verify athlete belongs to signed-in parent
  if not exists (
    select 1
    from public.athletes
    where id = p_athlete_id
      and guardian_id = v_user
  ) then
    raise exception 'Athlete not found';
  end if;

  -- Get session capacity + service/credit type
  select
    s.capacity,
    coalesce(
      p.service_type,
      p.credit_type,
      'group'
    )
  into
    v_capacity,
    v_type
  from public.sessions s
  join public.programs p
    on p.id = s.program_id
  where s.id = p_session_id
    and s.status = 'published'
  for update of s;

  if v_capacity is null then
    raise exception
      'Session not found or is not available';
  end if;

  -- Prevent duplicate booking
  select
    b.id,
    b.status
  into
    v_id,
    v_existing_status
  from public.bookings b
  where b.session_id = p_session_id
    and b.athlete_id = p_athlete_id
  for update;

  if v_existing_status = 'booked' then
    raise exception
      'This athlete is already booked for this session';
  end if;

  -- Capacity check
  select count(*)
  into v_booked
  from public.bookings
  where session_id = p_session_id
    and status = 'booked';

  if v_booked >= v_capacity then
    raise exception 'Session is full';
  end if;

  /*
   * If customer selected a specific entitlement,
   * require that exact entitlement to be valid.
   */
  if p_entitlement_id is not null then

    select
      e.id,
      e.credits_remaining,
      e.unlimited
    into
      v_ent,
      v_remaining,
      v_unlimited
    from public.entitlements e
    where e.id = p_entitlement_id
      and e.guardian_id = v_user
      and e.credit_type = v_type
      and e.status = 'active'
      and (
        e.athlete_id is null
        or e.athlete_id = p_athlete_id
      )
      and (
        e.expires_at is null
        or e.expires_at > now()
      )
      and (
        e.unlimited = true
        or coalesce(
          e.credits_remaining,
          0
        ) > 0
      )
    for update;

    if v_ent is null then
      raise exception
        'The selected training access cannot be used for this session.';
    end if;

  else

    /*
     * Fallback behavior for bookings that did not
     * specify a package.
     */
    select
      e.id,
      e.credits_remaining,
      e.unlimited
    into
      v_ent,
      v_remaining,
      v_unlimited
    from public.entitlements e
    where e.guardian_id = v_user
      and e.credit_type = v_type
      and e.status = 'active'
      and (
        e.athlete_id is null
        or e.athlete_id = p_athlete_id
      )
      and (
        e.expires_at is null
        or e.expires_at > now()
      )
      and (
        e.unlimited = true
        or coalesce(
          e.credits_remaining,
          0
        ) > 0
      )
    order by
      e.unlimited desc,
      e.expires_at nulls last,
      e.created_at
    limit 1
    for update;

    if v_ent is null then
      raise exception
        'No eligible % training access. Visit Plans to add a package or membership.',
        v_type;
    end if;

  end if;

  /*
   * Consume exactly one credit when this is not
   * unlimited access.
   */
  if not v_unlimited then
    update public.entitlements
    set
      credits_remaining =
        credits_remaining - 1,
      updated_at = now()
    where id = v_ent;
  end if;

  /*
   * Restore an existing cancelled booking or create
   * a new booking.
   */
  if v_id is not null then

    update public.bookings
    set
      status = 'booked',
      guardian_id = v_user,
      credit_cost = 0,
      entitlement_id = v_ent,
      created_at = now()
    where id = v_id;

  else

    insert into public.bookings (
      session_id,
      athlete_id,
      guardian_id,
      credit_cost,
      status,
      entitlement_id
    )
    values (
      p_session_id,
      p_athlete_id,
      v_user,
      0,
      'booked',
      v_ent
    )
    returning id into v_id;

  end if;

  return v_id;

end;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_cost int; begin update bookings set status='cancelled' where id=p_booking_id and guardian_id=auth.uid() and status='booked' returning credit_cost into v_cost; if v_cost is null then raise exception 'Booking not found'; end if; update profiles set credits=credits+v_cost where id=auth.uid(); end $function$
;
CREATE OR REPLACE FUNCTION public.cancel_booking_v14(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare
  v_ent uuid;
  v_unlimited boolean;
  v_start_at timestamptz;

begin

  /*
   * Get the session start time for this booking.
   *
   * The guardian check ensures a customer can
   * only cancel their own booking.
   */
  select
    s.start_at
  into
    v_start_at
  from public.bookings b
  join public.sessions s
    on s.id = b.session_id
  where
    b.id = p_booking_id
    and b.guardian_id = auth.uid()
    and b.status = 'booked';

  if not found then
    raise exception 'Booking not found';
  end if;


  /*
   * Customer cancellation policy:
   *
   * A booking must be cancelled at least
   * 6 hours before the scheduled session.
   *
   * This check happens BEFORE the booking
   * status or training credits are changed.
   */
  if v_start_at < now() + interval '6 hours' then
    raise exception
      'Cancellation window closed. Sessions must be cancelled at least 6 hours before the scheduled start time.';
  end if;


  /*
   * Cancel the booking.
   */
  update public.bookings
  set status = 'cancelled'
  where
    id = p_booking_id
    and guardian_id = auth.uid()
    and status = 'booked'
  returning
    entitlement_id
  into
    v_ent;

  if not found then
    raise exception 'Booking not found';
  end if;


  /*
   * Restore one credit when the booking used
   * a credit-based entitlement.
   *
   * Unlimited memberships do not need a
   * credit restored.
   */
  if v_ent is not null then

    select
      unlimited
    into
      v_unlimited
    from public.entitlements
    where id = v_ent
    for update;

    if coalesce(
      v_unlimited,
      false
    ) = false then

      update public.entitlements
      set
        credits_remaining =
          credits_remaining + 1
      where id = v_ent;

    end if;

  end if;

end
$function$
;
CREATE OR REPLACE FUNCTION public.fulfill_limited_promo_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_id uuid;
  v_existing_purchase_id uuid;
  v_purchase_limit integer;
  v_successful_purchases integer;
  v_now timestamptz := now();
BEGIN

  -- Idempotency: the same Stripe Checkout Session
  -- can never create access twice.
  SELECT id
  INTO v_existing_purchase_id
  FROM public.purchases
  WHERE stripe_checkout_session_id =
        p_checkout_session_id
  LIMIT 1;

  IF v_existing_purchase_id IS NOT NULL THEN
    RETURN v_existing_purchase_id;
  END IF;

  -- Lock the package row while checking the limited
  -- Founding allocation.
  SELECT purchase_limit
  INTO v_purchase_limit
  FROM public.packages
  WHERE id = p_package_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package is unavailable';
  END IF;

  -- Prevent the same athlete from receiving this
  -- limited membership more than once while active.
  IF p_athlete_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.entitlements
    WHERE package_id = p_package_id
      AND athlete_id = p_athlete_id
      AND status = 'active'
      AND (
        expires_at IS NULL
        OR expires_at > v_now
      )
  ) THEN
    RAISE EXCEPTION 'ATHLETE_ALREADY_ENROLLED';
  END IF;

  -- Paid purchases permanently consume a Founding spot.
  -- Cancelling later does not reopen the spot.
  SELECT count(*)
  INTO v_successful_purchases
  FROM public.purchases
  WHERE package_id = p_package_id
    AND status = 'paid';

  IF v_purchase_limit IS NOT NULL
     AND v_successful_purchases >=
         v_purchase_limit THEN
    RAISE EXCEPTION 'PROMO_SOLD_OUT';
  END IF;

  INSERT INTO public.purchases (
    guardian_id,
    athlete_id,
    package_id,
    package_key,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    stripe_subscription_id,
    stripe_customer_id,
    credits_added,
    amount_cents,
    amount_paid_cents,
    status,
    payment_status,
    updated_at
  )
  VALUES (
    p_guardian_id,
    p_athlete_id,
    p_package_id,
    p_package_key,
    p_checkout_session_id,
    p_payment_intent_id,
    p_subscription_id,
    p_customer_id,
    0,
    p_amount_paid_cents,
    p_amount_paid_cents,
    'paid',
    'paid',
    v_now
  )
  RETURNING id
  INTO v_purchase_id;

  INSERT INTO public.entitlements (
    guardian_id,
    athlete_id,
    package_id,
    credit_type,
    credits_remaining,
    unlimited,
    starts_at,
    expires_at,
    status,
    source,
    stripe_subscription_id,
    updated_at
  )
  VALUES (
    p_guardian_id,
    p_athlete_id,
    p_package_id,
    p_credit_type,
    0,
    true,
    v_now,
    p_expires_at,
    'active',
    'stripe',
    p_subscription_id,
    v_now
  );

  RETURN v_purchase_id;

EXCEPTION
  WHEN unique_violation THEN
    SELECT id
    INTO v_existing_purchase_id
    FROM public.purchases
    WHERE stripe_checkout_session_id =
          p_checkout_session_id
    LIMIT 1;

    IF v_existing_purchase_id IS NOT NULL THEN
      RETURN v_existing_purchase_id;
    END IF;

    RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fulfill_stripe_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_credits integer, p_unlimited boolean, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase_id uuid;
  v_existing_purchase_id uuid;
  v_now timestamptz := now();
BEGIN

  /*
   * Stripe Checkout Session IDs must only be
   * fulfilled once.
   */
  SELECT id
  INTO v_existing_purchase_id
  FROM public.purchases
  WHERE stripe_checkout_session_id =
    p_checkout_session_id
  LIMIT 1;

  IF v_existing_purchase_id IS NOT NULL THEN
    RETURN v_existing_purchase_id;
  END IF;

  /*
   * Create the purchase.
   */
  INSERT INTO public.purchases (
    guardian_id,
    athlete_id,
    package_id,
    package_key,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    stripe_subscription_id,
    stripe_customer_id,
    credits_added,
    amount_cents,
    amount_paid_cents,
    status,
    payment_status,
    updated_at
  )
  VALUES (
    p_guardian_id,
    p_athlete_id,
    p_package_id,
    p_package_key,
    p_checkout_session_id,
    p_payment_intent_id,
    p_subscription_id,
    p_customer_id,
    CASE
      WHEN p_unlimited THEN 0
      ELSE COALESCE(p_credits, 0)
    END,
    p_amount_paid_cents,
    p_amount_paid_cents,
    'paid',
    'paid',
    v_now
  )
  RETURNING id INTO v_purchase_id;

  /*
   * Create the matching training entitlement.
   *
   * Because this happens inside the same
   * PostgreSQL function/transaction, failure
   * here also rolls back the purchase above.
   */
  INSERT INTO public.entitlements (
    guardian_id,
    athlete_id,
    package_id,
    credit_type,
    credits_remaining,
    unlimited,
    starts_at,
    expires_at,
    status,
    source,
    stripe_subscription_id,
    updated_at
  )
  VALUES (
    p_guardian_id,
    p_athlete_id,
    p_package_id,
    p_credit_type,
    CASE
      WHEN p_unlimited THEN 0
      ELSE COALESCE(p_credits, 0)
    END,
    p_unlimited,
    v_now,
    p_expires_at,
    'active',
    'stripe',
    p_subscription_id,
    v_now
  );

  RETURN v_purchase_id;

EXCEPTION
  WHEN unique_violation THEN

    /*
     * If Stripe delivered the same Checkout
     * Session more than once, return the
     * purchase already created.
     */
    SELECT id
    INTO v_existing_purchase_id
    FROM public.purchases
    WHERE stripe_checkout_session_id =
      p_checkout_session_id
    LIMIT 1;

    IF v_existing_purchase_id IS NOT NULL THEN
      RETURN v_existing_purchase_id;
    END IF;

    RAISE;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_coach_athletes_v1()
 RETURNS TABLE(athlete_id uuid, guardian_id uuid, first_name text, last_name text, age integer, sport text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_role text;
begin
  select p.role
  into current_role
  from public.profiles p
  where p.id = auth.uid();

  if current_role is null or current_role = 'parent' then
    raise exception 'Coach access required';
  end if;

  return query
  select
    a.id as athlete_id,
    a.guardian_id,
    a.first_name,
    a.last_name,
    a.age,
    a.sport,
    a.created_at
  from public.athletes a
  order by
    a.created_at desc,
    a.last_name asc,
    a.first_name asc;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_coach_athletes_v2()
 RETURNS TABLE(athlete_id uuid, guardian_id uuid, first_name text, last_name text, age integer, sport text, athlete_created_at timestamp with time zone, guardian_name text, guardian_email text, guardian_created_at timestamp with time zone, waiver_signed boolean, waiver_accepted_at timestamp with time zone, guardian_credits integer, entitlement_count bigint, credits_remaining bigint, has_unlimited_access boolean, total_bookings bigint, active_bookings bigint, cancelled_bookings bigint, last_booking_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  current_role text;
begin

  /*
   * Confirm that the signed-in user is
   * allowed to access the coach directory.
   */
  select p.role::text
  into current_role
  from public.profiles p
  where p.id = auth.uid();

  if current_role is null
     or current_role = 'parent' then
    raise exception 'Coach access required';
  end if;

  return query

  select
    a.id as athlete_id,
    a.guardian_id,
    a.first_name,
    a.last_name,
    a.age,
    a.sport,
    a.created_at as athlete_created_at,

    p.full_name as guardian_name,

    u.email::text as guardian_email,

    p.created_at as guardian_created_at,

    (
      p.waiver_accepted_at is not null
    ) as waiver_signed,

    p.waiver_accepted_at,

    coalesce(
      p.credits,
      0
    )::integer as guardian_credits,

    /*
     * Entitlements that belong either
     * specifically to this athlete OR
     * to the family/guardian.
     */
    (
      select count(*)
      from public.entitlements e
      where
        e.guardian_id = a.guardian_id
        and (
          e.athlete_id = a.id
          or e.athlete_id is null
        )
    ) as entitlement_count,

    /*
     * Sum remaining credits from matching
     * family or athlete entitlements.
     *
     * Unlimited entitlements are handled
     * separately below.
     */
    (
      select coalesce(
        sum(
          coalesce(
            e.credits_remaining,
            0
          )
        ),
        0
      )
      from public.entitlements e
      where
        e.guardian_id = a.guardian_id
        and (
          e.athlete_id = a.id
          or e.athlete_id is null
        )
    ) as credits_remaining,

    /*
     * Does this athlete have any
     * unlimited entitlement?
     */
    exists (
      select 1
      from public.entitlements e
      where
        e.guardian_id = a.guardian_id
        and (
          e.athlete_id = a.id
          or e.athlete_id is null
        )
        and e.unlimited = true
    ) as has_unlimited_access,

    /*
     * Total booking history.
     */
    (
      select count(*)
      from public.bookings b
      where b.athlete_id = a.id
    ) as total_bookings,

    /*
     * Everything that has not been
     * cancelled.
     */
    (
      select count(*)
      from public.bookings b
      where
        b.athlete_id = a.id
        and b.status::text <> 'cancelled'
    ) as active_bookings,

    /*
     * Cancelled bookings.
     */
    (
      select count(*)
      from public.bookings b
      where
        b.athlete_id = a.id
        and b.status::text = 'cancelled'
    ) as cancelled_bookings,

    /*
     * Most recent booking creation date.
     */
    (
      select max(
        b.created_at
      )
      from public.bookings b
      where b.athlete_id = a.id
    ) as last_booking_at

  from public.athletes a

  left join public.profiles p
    on p.id = a.guardian_id

  left join auth.users u
    on u.id = a.guardian_id

  order by
    a.created_at desc,
    a.last_name asc,
    a.first_name asc;

end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_session_roster(p_session_id uuid)
 RETURNS TABLE(booking_id uuid, athlete_id uuid, athlete_name text, age integer, sport text, guardian_id uuid, booked_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin insert into profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','')); return new; end $function$
;
CREATE OR REPLACE FUNCTION public.sign_parent_waiver_v1(p_signed_name text, p_media_consent boolean, p_waiver_version text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'You must be signed in to complete the waiver.';
  end if;

  if p_signed_name is null
     or length(trim(p_signed_name)) < 2 then
    raise exception 'A valid parent or guardian legal name is required.';
  end if;

  if p_waiver_version is null
     or trim(p_waiver_version) <> '2026-01' then
    raise exception 'Invalid waiver version.';
  end if;

  update public.profiles
  set
    waiver_accepted_at = now(),
    waiver_signed_name = trim(p_signed_name),
    waiver_version = '2026-01',
    media_consent = p_media_consent,
    media_consent_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'Parent profile not found.';
  end if;
end;
$function$
;
create view public.session_availability as  SELECT s.id,
    s.program_id,
    s.start_at,
    s.duration_minutes,
    s.capacity,
    s.location,
    s.status,
    s.created_by,
    s.created_at,
    p.name AS program_name,
    p.min_age,
    p.max_age,
    p.credit_cost,
    p.price_cents,
    row_to_json(p.*) AS programs,
    (count(b.id) FILTER (WHERE (b.status = 'booked'::booking_status)))::integer AS booked_count,
    p.service_type,
    p.credit_type
   FROM ((sessions s
     JOIN programs p ON ((p.id = s.program_id)))
     LEFT JOIN bookings b ON ((b.session_id = s.id)))
  GROUP BY s.id, p.id;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
alter table public.athletes enable row level security;
alter table public.booking_reminders enable row level security;
alter table public.bookings enable row level security;
alter table public.entitlements enable row level security;
alter table public.packages enable row level security;
alter table public.performance_results enable row level security;
alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.purchases enable row level security;
alter table public.sessions enable row level security;
alter table public.stripe_webhook_events enable row level security;
create policy "athlete_guardian" on public."athletes" as PERMISSIVE for ALL to PUBLIC using ((guardian_id = auth.uid())) with check ((guardian_id = auth.uid()));
create policy "bookings_guardian" on public."bookings" as PERMISSIVE for SELECT to PUBLIC using ((guardian_id = auth.uid()));
create policy "entitlements_owner_read" on public."entitlements" as PERMISSIVE for SELECT to PUBLIC using (((guardian_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['coach'::user_role, 'admin'::user_role])))))));
create policy "admin_packages_manage" on public."packages" as PERMISSIVE for ALL to PUBLIC using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))) with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role)))));
create policy "packages_public_read" on public."packages" as PERMISSIVE for SELECT to PUBLIC using (((active = true) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))));
create policy "results_guardian" on public."performance_results" as PERMISSIVE for SELECT to PUBLIC using ((EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = performance_results.athlete_id) AND (a.guardian_id = auth.uid())))));
create policy "profile_self" on public."profiles" as PERMISSIVE for SELECT to PUBLIC using ((id = auth.uid()));
create policy "admin_programs_manage" on public."programs" as PERMISSIVE for ALL to PUBLIC using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role))))) with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::user_role)))));
create policy "programs_read" on public."programs" as PERMISSIVE for SELECT to PUBLIC using ((active = true));
create policy "purchases_guardian" on public."purchases" as PERMISSIVE for SELECT to PUBLIC using ((guardian_id = auth.uid()));
create policy "coach_sessions" on public."sessions" as PERMISSIVE for ALL to PUBLIC using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['coach'::user_role, 'admin'::user_role])))))) with check ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['coach'::user_role, 'admin'::user_role]))))));
create policy "sessions_read" on public."sessions" as PERMISSIVE for SELECT to PUBLIC using ((status = 'published'::text));
grant DELETE on table public.athletes to "anon";
grant TRIGGER on table public.athletes to "anon";
grant REFERENCES on table public.athletes to "anon";
grant TRUNCATE on table public.athletes to "anon";
grant UPDATE on table public.athletes to "anon";
grant SELECT on table public.athletes to "anon";
grant INSERT on table public.athletes to "anon";
grant INSERT on table public.athletes to "authenticated";
grant TRIGGER on table public.athletes to "authenticated";
grant TRUNCATE on table public.athletes to "authenticated";
grant REFERENCES on table public.athletes to "authenticated";
grant SELECT on table public.athletes to "authenticated";
grant UPDATE on table public.athletes to "authenticated";
grant DELETE on table public.athletes to "authenticated";
grant REFERENCES on table public.athletes to "postgres";
grant INSERT on table public.athletes to "postgres";
grant SELECT on table public.athletes to "postgres";
grant UPDATE on table public.athletes to "postgres";
grant DELETE on table public.athletes to "postgres";
grant TRUNCATE on table public.athletes to "postgres";
grant TRIGGER on table public.athletes to "postgres";
grant INSERT on table public.athletes to "service_role";
grant SELECT on table public.athletes to "service_role";
grant UPDATE on table public.athletes to "service_role";
grant DELETE on table public.athletes to "service_role";
grant TRUNCATE on table public.athletes to "service_role";
grant REFERENCES on table public.athletes to "service_role";
grant TRIGGER on table public.athletes to "service_role";
grant TRUNCATE on table public.booking_reminders to "anon";
grant REFERENCES on table public.booking_reminders to "anon";
grant TRIGGER on table public.booking_reminders to "anon";
grant UPDATE on table public.booking_reminders to "anon";
grant SELECT on table public.booking_reminders to "anon";
grant INSERT on table public.booking_reminders to "anon";
grant DELETE on table public.booking_reminders to "anon";
grant DELETE on table public.booking_reminders to "authenticated";
grant TRIGGER on table public.booking_reminders to "authenticated";
grant TRUNCATE on table public.booking_reminders to "authenticated";
grant INSERT on table public.booking_reminders to "authenticated";
grant SELECT on table public.booking_reminders to "authenticated";
grant REFERENCES on table public.booking_reminders to "authenticated";
grant UPDATE on table public.booking_reminders to "authenticated";
grant DELETE on table public.booking_reminders to "postgres";
grant SELECT on table public.booking_reminders to "postgres";
grant INSERT on table public.booking_reminders to "postgres";
grant REFERENCES on table public.booking_reminders to "postgres";
grant TRIGGER on table public.booking_reminders to "postgres";
grant TRUNCATE on table public.booking_reminders to "postgres";
grant UPDATE on table public.booking_reminders to "postgres";
grant TRUNCATE on table public.booking_reminders to "service_role";
grant TRIGGER on table public.booking_reminders to "service_role";
grant REFERENCES on table public.booking_reminders to "service_role";
grant DELETE on table public.booking_reminders to "service_role";
grant UPDATE on table public.booking_reminders to "service_role";
grant SELECT on table public.booking_reminders to "service_role";
grant INSERT on table public.booking_reminders to "service_role";
grant TRUNCATE on table public.bookings to "anon";
grant REFERENCES on table public.bookings to "anon";
grant INSERT on table public.bookings to "anon";
grant TRIGGER on table public.bookings to "anon";
grant SELECT on table public.bookings to "anon";
grant UPDATE on table public.bookings to "anon";
grant DELETE on table public.bookings to "anon";
grant REFERENCES on table public.bookings to "authenticated";
grant TRUNCATE on table public.bookings to "authenticated";
grant DELETE on table public.bookings to "authenticated";
grant UPDATE on table public.bookings to "authenticated";
grant SELECT on table public.bookings to "authenticated";
grant INSERT on table public.bookings to "authenticated";
grant TRIGGER on table public.bookings to "authenticated";
grant UPDATE on table public.bookings to "postgres";
grant TRIGGER on table public.bookings to "postgres";
grant REFERENCES on table public.bookings to "postgres";
grant TRUNCATE on table public.bookings to "postgres";
grant INSERT on table public.bookings to "postgres";
grant DELETE on table public.bookings to "postgres";
grant SELECT on table public.bookings to "postgres";
grant TRIGGER on table public.bookings to "service_role";
grant UPDATE on table public.bookings to "service_role";
grant SELECT on table public.bookings to "service_role";
grant INSERT on table public.bookings to "service_role";
grant DELETE on table public.bookings to "service_role";
grant TRUNCATE on table public.bookings to "service_role";
grant REFERENCES on table public.bookings to "service_role";
grant SELECT on table public.entitlements to "anon";
grant UPDATE on table public.entitlements to "anon";
grant DELETE on table public.entitlements to "anon";
grant TRUNCATE on table public.entitlements to "anon";
grant REFERENCES on table public.entitlements to "anon";
grant TRIGGER on table public.entitlements to "anon";
grant INSERT on table public.entitlements to "anon";
grant REFERENCES on table public.entitlements to "authenticated";
grant TRIGGER on table public.entitlements to "authenticated";
grant INSERT on table public.entitlements to "authenticated";
grant SELECT on table public.entitlements to "authenticated";
grant UPDATE on table public.entitlements to "authenticated";
grant DELETE on table public.entitlements to "authenticated";
grant TRUNCATE on table public.entitlements to "authenticated";
grant TRIGGER on table public.entitlements to "postgres";
grant REFERENCES on table public.entitlements to "postgres";
grant TRUNCATE on table public.entitlements to "postgres";
grant DELETE on table public.entitlements to "postgres";
grant UPDATE on table public.entitlements to "postgres";
grant SELECT on table public.entitlements to "postgres";
grant INSERT on table public.entitlements to "postgres";
grant REFERENCES on table public.entitlements to "service_role";
grant TRIGGER on table public.entitlements to "service_role";
grant DELETE on table public.entitlements to "service_role";
grant TRUNCATE on table public.entitlements to "service_role";
grant UPDATE on table public.entitlements to "service_role";
grant INSERT on table public.entitlements to "service_role";
grant SELECT on table public.entitlements to "service_role";
grant REFERENCES on table public.packages to "anon";
grant UPDATE on table public.packages to "anon";
grant TRIGGER on table public.packages to "anon";
grant DELETE on table public.packages to "anon";
grant INSERT on table public.packages to "anon";
grant SELECT on table public.packages to "anon";
grant TRUNCATE on table public.packages to "anon";
grant UPDATE on table public.packages to "authenticated";
grant TRUNCATE on table public.packages to "authenticated";
grant REFERENCES on table public.packages to "authenticated";
grant TRIGGER on table public.packages to "authenticated";
grant SELECT on table public.packages to "authenticated";
grant INSERT on table public.packages to "authenticated";
grant DELETE on table public.packages to "authenticated";
grant TRUNCATE on table public.packages to "postgres";
grant INSERT on table public.packages to "postgres";
grant SELECT on table public.packages to "postgres";
grant UPDATE on table public.packages to "postgres";
grant DELETE on table public.packages to "postgres";
grant REFERENCES on table public.packages to "postgres";
grant TRIGGER on table public.packages to "postgres";
grant TRIGGER on table public.packages to "service_role";
grant INSERT on table public.packages to "service_role";
grant SELECT on table public.packages to "service_role";
grant UPDATE on table public.packages to "service_role";
grant DELETE on table public.packages to "service_role";
grant TRUNCATE on table public.packages to "service_role";
grant REFERENCES on table public.packages to "service_role";
grant INSERT on table public.performance_results to "anon";
grant TRIGGER on table public.performance_results to "anon";
grant REFERENCES on table public.performance_results to "anon";
grant TRUNCATE on table public.performance_results to "anon";
grant DELETE on table public.performance_results to "anon";
grant UPDATE on table public.performance_results to "anon";
grant SELECT on table public.performance_results to "anon";
grant TRUNCATE on table public.performance_results to "authenticated";
grant REFERENCES on table public.performance_results to "authenticated";
grant TRIGGER on table public.performance_results to "authenticated";
grant DELETE on table public.performance_results to "authenticated";
grant UPDATE on table public.performance_results to "authenticated";
grant SELECT on table public.performance_results to "authenticated";
grant INSERT on table public.performance_results to "authenticated";
grant SELECT on table public.performance_results to "postgres";
grant REFERENCES on table public.performance_results to "postgres";
grant TRIGGER on table public.performance_results to "postgres";
grant TRUNCATE on table public.performance_results to "postgres";
grant DELETE on table public.performance_results to "postgres";
grant UPDATE on table public.performance_results to "postgres";
grant INSERT on table public.performance_results to "postgres";
grant DELETE on table public.performance_results to "service_role";
grant REFERENCES on table public.performance_results to "service_role";
grant TRIGGER on table public.performance_results to "service_role";
grant UPDATE on table public.performance_results to "service_role";
grant SELECT on table public.performance_results to "service_role";
grant INSERT on table public.performance_results to "service_role";
grant TRUNCATE on table public.performance_results to "service_role";
grant REFERENCES on table public.profiles to "anon";
grant TRIGGER on table public.profiles to "anon";
grant TRUNCATE on table public.profiles to "anon";
grant DELETE on table public.profiles to "anon";
grant UPDATE on table public.profiles to "anon";
grant SELECT on table public.profiles to "anon";
grant INSERT on table public.profiles to "anon";
grant INSERT on table public.profiles to "authenticated";
grant TRIGGER on table public.profiles to "authenticated";
grant REFERENCES on table public.profiles to "authenticated";
grant TRUNCATE on table public.profiles to "authenticated";
grant DELETE on table public.profiles to "authenticated";
grant UPDATE on table public.profiles to "authenticated";
grant SELECT on table public.profiles to "authenticated";
grant TRIGGER on table public.profiles to "postgres";
grant REFERENCES on table public.profiles to "postgres";
grant TRUNCATE on table public.profiles to "postgres";
grant DELETE on table public.profiles to "postgres";
grant UPDATE on table public.profiles to "postgres";
grant SELECT on table public.profiles to "postgres";
grant INSERT on table public.profiles to "postgres";
grant SELECT on table public.profiles to "service_role";
grant REFERENCES on table public.profiles to "service_role";
grant TRIGGER on table public.profiles to "service_role";
grant INSERT on table public.profiles to "service_role";
grant UPDATE on table public.profiles to "service_role";
grant DELETE on table public.profiles to "service_role";
grant TRUNCATE on table public.profiles to "service_role";
grant UPDATE on table public.programs to "anon";
grant INSERT on table public.programs to "anon";
grant SELECT on table public.programs to "anon";
grant DELETE on table public.programs to "anon";
grant TRUNCATE on table public.programs to "anon";
grant REFERENCES on table public.programs to "anon";
grant TRIGGER on table public.programs to "anon";
grant TRUNCATE on table public.programs to "authenticated";
grant INSERT on table public.programs to "authenticated";
grant TRIGGER on table public.programs to "authenticated";
grant SELECT on table public.programs to "authenticated";
grant UPDATE on table public.programs to "authenticated";
grant DELETE on table public.programs to "authenticated";
grant REFERENCES on table public.programs to "authenticated";
grant TRIGGER on table public.programs to "postgres";
grant REFERENCES on table public.programs to "postgres";
grant TRUNCATE on table public.programs to "postgres";
grant DELETE on table public.programs to "postgres";
grant UPDATE on table public.programs to "postgres";
grant SELECT on table public.programs to "postgres";
grant INSERT on table public.programs to "postgres";
grant UPDATE on table public.programs to "service_role";
grant TRUNCATE on table public.programs to "service_role";
grant REFERENCES on table public.programs to "service_role";
grant TRIGGER on table public.programs to "service_role";
grant INSERT on table public.programs to "service_role";
grant SELECT on table public.programs to "service_role";
grant DELETE on table public.programs to "service_role";
grant SELECT on table public.purchases to "anon";
grant INSERT on table public.purchases to "anon";
grant DELETE on table public.purchases to "anon";
grant UPDATE on table public.purchases to "anon";
grant TRUNCATE on table public.purchases to "anon";
grant TRIGGER on table public.purchases to "anon";
grant REFERENCES on table public.purchases to "anon";
grant INSERT on table public.purchases to "authenticated";
grant UPDATE on table public.purchases to "authenticated";
grant SELECT on table public.purchases to "authenticated";
grant TRIGGER on table public.purchases to "authenticated";
grant REFERENCES on table public.purchases to "authenticated";
grant TRUNCATE on table public.purchases to "authenticated";
grant DELETE on table public.purchases to "authenticated";
grant REFERENCES on table public.purchases to "postgres";
grant SELECT on table public.purchases to "postgres";
grant INSERT on table public.purchases to "postgres";
grant TRUNCATE on table public.purchases to "postgres";
grant DELETE on table public.purchases to "postgres";
grant UPDATE on table public.purchases to "postgres";
grant TRIGGER on table public.purchases to "postgres";
grant DELETE on table public.purchases to "service_role";
grant UPDATE on table public.purchases to "service_role";
grant SELECT on table public.purchases to "service_role";
grant INSERT on table public.purchases to "service_role";
grant TRIGGER on table public.purchases to "service_role";
grant REFERENCES on table public.purchases to "service_role";
grant TRUNCATE on table public.purchases to "service_role";
grant INSERT on table public.session_availability to "anon";
grant TRIGGER on table public.session_availability to "anon";
grant REFERENCES on table public.session_availability to "anon";
grant TRUNCATE on table public.session_availability to "anon";
grant DELETE on table public.session_availability to "anon";
grant UPDATE on table public.session_availability to "anon";
grant SELECT on table public.session_availability to "anon";
grant DELETE on table public.session_availability to "authenticated";
grant REFERENCES on table public.session_availability to "authenticated";
grant INSERT on table public.session_availability to "authenticated";
grant SELECT on table public.session_availability to "authenticated";
grant TRIGGER on table public.session_availability to "authenticated";
grant UPDATE on table public.session_availability to "authenticated";
grant TRUNCATE on table public.session_availability to "authenticated";
grant INSERT on table public.session_availability to "postgres";
grant TRIGGER on table public.session_availability to "postgres";
grant REFERENCES on table public.session_availability to "postgres";
grant TRUNCATE on table public.session_availability to "postgres";
grant DELETE on table public.session_availability to "postgres";
grant UPDATE on table public.session_availability to "postgres";
grant SELECT on table public.session_availability to "postgres";
grant TRIGGER on table public.session_availability to "service_role";
grant INSERT on table public.session_availability to "service_role";
grant SELECT on table public.session_availability to "service_role";
grant UPDATE on table public.session_availability to "service_role";
grant DELETE on table public.session_availability to "service_role";
grant TRUNCATE on table public.session_availability to "service_role";
grant REFERENCES on table public.session_availability to "service_role";
grant TRIGGER on table public.sessions to "anon";
grant REFERENCES on table public.sessions to "anon";
grant TRUNCATE on table public.sessions to "anon";
grant DELETE on table public.sessions to "anon";
grant UPDATE on table public.sessions to "anon";
grant SELECT on table public.sessions to "anon";
grant INSERT on table public.sessions to "anon";
grant TRUNCATE on table public.sessions to "authenticated";
grant INSERT on table public.sessions to "authenticated";
grant SELECT on table public.sessions to "authenticated";
grant UPDATE on table public.sessions to "authenticated";
grant DELETE on table public.sessions to "authenticated";
grant REFERENCES on table public.sessions to "authenticated";
grant TRIGGER on table public.sessions to "authenticated";
grant UPDATE on table public.sessions to "postgres";
grant DELETE on table public.sessions to "postgres";
grant TRUNCATE on table public.sessions to "postgres";
grant REFERENCES on table public.sessions to "postgres";
grant TRIGGER on table public.sessions to "postgres";
grant INSERT on table public.sessions to "postgres";
grant SELECT on table public.sessions to "postgres";
grant TRIGGER on table public.sessions to "service_role";
grant DELETE on table public.sessions to "service_role";
grant UPDATE on table public.sessions to "service_role";
grant SELECT on table public.sessions to "service_role";
grant INSERT on table public.sessions to "service_role";
grant REFERENCES on table public.sessions to "service_role";
grant TRUNCATE on table public.sessions to "service_role";
grant DELETE on table public.stripe_webhook_events to "anon";
grant UPDATE on table public.stripe_webhook_events to "anon";
grant TRIGGER on table public.stripe_webhook_events to "anon";
grant SELECT on table public.stripe_webhook_events to "anon";
grant INSERT on table public.stripe_webhook_events to "anon";
grant REFERENCES on table public.stripe_webhook_events to "anon";
grant TRUNCATE on table public.stripe_webhook_events to "anon";
grant INSERT on table public.stripe_webhook_events to "authenticated";
grant DELETE on table public.stripe_webhook_events to "authenticated";
grant TRUNCATE on table public.stripe_webhook_events to "authenticated";
grant REFERENCES on table public.stripe_webhook_events to "authenticated";
grant TRIGGER on table public.stripe_webhook_events to "authenticated";
grant SELECT on table public.stripe_webhook_events to "authenticated";
grant UPDATE on table public.stripe_webhook_events to "authenticated";
grant SELECT on table public.stripe_webhook_events to "postgres";
grant INSERT on table public.stripe_webhook_events to "postgres";
grant UPDATE on table public.stripe_webhook_events to "postgres";
grant DELETE on table public.stripe_webhook_events to "postgres";
grant TRUNCATE on table public.stripe_webhook_events to "postgres";
grant REFERENCES on table public.stripe_webhook_events to "postgres";
grant TRIGGER on table public.stripe_webhook_events to "postgres";
grant UPDATE on table public.stripe_webhook_events to "service_role";
grant TRIGGER on table public.stripe_webhook_events to "service_role";
grant REFERENCES on table public.stripe_webhook_events to "service_role";
grant TRUNCATE on table public.stripe_webhook_events to "service_role";
grant DELETE on table public.stripe_webhook_events to "service_role";
grant INSERT on table public.stripe_webhook_events to "service_role";
grant SELECT on table public.stripe_webhook_events to "service_role";
revoke all on function public.add_credits(p_user_id uuid, p_credits integer) from public,anon,authenticated,service_role;
grant execute on function public.add_credits(p_user_id uuid, p_credits integer) to "postgres";
grant execute on function public.add_credits(p_user_id uuid, p_credits integer) to "service_role";
revoke all on function public.admin_cancel_session(p_session_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_cancel_session(p_session_id uuid) to "authenticated";
grant execute on function public.admin_cancel_session(p_session_id uuid) to "postgres";
grant execute on function public.admin_cancel_session(p_session_id uuid) to "service_role";
revoke all on function public.admin_grant_test_package(p_package_id uuid, p_guardian_id uuid, p_athlete_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_grant_test_package(p_package_id uuid, p_guardian_id uuid, p_athlete_id uuid) to "postgres";
grant execute on function public.admin_grant_test_package(p_package_id uuid, p_guardian_id uuid, p_athlete_id uuid) to "service_role";
revoke all on function public.book_session(p_session_id uuid, p_athlete_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.book_session(p_session_id uuid, p_athlete_id uuid) to "authenticated";
grant execute on function public.book_session(p_session_id uuid, p_athlete_id uuid) to "postgres";
grant execute on function public.book_session(p_session_id uuid, p_athlete_id uuid) to "service_role";
revoke all on function public.book_session_v14(p_session_id uuid, p_athlete_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.book_session_v14(p_session_id uuid, p_athlete_id uuid) to "authenticated";
grant execute on function public.book_session_v14(p_session_id uuid, p_athlete_id uuid) to "postgres";
grant execute on function public.book_session_v14(p_session_id uuid, p_athlete_id uuid) to "service_role";
revoke all on function public.book_session_v15(p_session_id uuid, p_athlete_id uuid, p_entitlement_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.book_session_v15(p_session_id uuid, p_athlete_id uuid, p_entitlement_id uuid) to "authenticated";
grant execute on function public.book_session_v15(p_session_id uuid, p_athlete_id uuid, p_entitlement_id uuid) to "postgres";
grant execute on function public.book_session_v15(p_session_id uuid, p_athlete_id uuid, p_entitlement_id uuid) to "service_role";
revoke all on function public.cancel_booking(p_booking_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_booking(p_booking_id uuid) to "authenticated";
grant execute on function public.cancel_booking(p_booking_id uuid) to "postgres";
grant execute on function public.cancel_booking(p_booking_id uuid) to "service_role";
revoke all on function public.cancel_booking_v14(p_booking_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_booking_v14(p_booking_id uuid) to "authenticated";
grant execute on function public.cancel_booking_v14(p_booking_id uuid) to "postgres";
grant execute on function public.cancel_booking_v14(p_booking_id uuid) to "service_role";
revoke all on function public.fulfill_limited_promo_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer) from public,anon,authenticated,service_role;
grant execute on function public.fulfill_limited_promo_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer) to "postgres";
grant execute on function public.fulfill_limited_promo_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer) to "service_role";
revoke all on function public.fulfill_stripe_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_credits integer, p_unlimited boolean, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer) from public,anon,authenticated,service_role;
grant execute on function public.fulfill_stripe_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_credits integer, p_unlimited boolean, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer) to "postgres";
grant execute on function public.fulfill_stripe_checkout_v1(p_guardian_id uuid, p_athlete_id uuid, p_package_id uuid, p_package_key text, p_credit_type text, p_credits integer, p_unlimited boolean, p_expires_at timestamp with time zone, p_checkout_session_id text, p_payment_intent_id text, p_subscription_id text, p_customer_id text, p_amount_paid_cents integer) to "service_role";
revoke all on function public.get_coach_athletes_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_coach_athletes_v1() to "anon";
grant execute on function public.get_coach_athletes_v1() to "authenticated";
grant execute on function public.get_coach_athletes_v1() to "postgres";
grant execute on function public.get_coach_athletes_v1() to "service_role";
revoke all on function public.get_coach_athletes_v2() from public,anon,authenticated,service_role;
grant execute on function public.get_coach_athletes_v2() to "anon";
grant execute on function public.get_coach_athletes_v2() to "authenticated";
grant execute on function public.get_coach_athletes_v2() to "postgres";
grant execute on function public.get_coach_athletes_v2() to "service_role";
revoke all on function public.get_session_roster(p_session_id uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_session_roster(p_session_id uuid) to "authenticated";
grant execute on function public.get_session_roster(p_session_id uuid) to "postgres";
grant execute on function public.get_session_roster(p_session_id uuid) to "service_role";
revoke all on function public.handle_new_user() from public,anon,authenticated,service_role;
grant execute on function public.handle_new_user() to PUBLIC;
grant execute on function public.handle_new_user() to "anon";
grant execute on function public.handle_new_user() to "authenticated";
grant execute on function public.handle_new_user() to "postgres";
grant execute on function public.handle_new_user() to "service_role";
revoke all on function public.sign_parent_waiver_v1(p_signed_name text, p_media_consent boolean, p_waiver_version text) from public,anon,authenticated,service_role;
grant execute on function public.sign_parent_waiver_v1(p_signed_name text, p_media_consent boolean, p_waiver_version text) to "anon";
grant execute on function public.sign_parent_waiver_v1(p_signed_name text, p_media_consent boolean, p_waiver_version text) to "authenticated";
grant execute on function public.sign_parent_waiver_v1(p_signed_name text, p_media_consent boolean, p_waiver_version text) to "postgres";
grant execute on function public.sign_parent_waiver_v1(p_signed_name text, p_media_consent boolean, p_waiver_version text) to "service_role";
