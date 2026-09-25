-- Run once in Supabase SQL Editor AFTER the Booking V2 schema.
-- Adds coach/admin read access needed by Production V1.
create policy "coach_profiles_read" on profiles for select using (
  id=auth.uid() or exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('coach','admin'))
);
create policy "coach_athletes_read" on athletes for select using (
  guardian_id=auth.uid() or exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('coach','admin'))
);
create policy "coach_bookings_read" on bookings for select using (
  guardian_id=auth.uid() or exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('coach','admin'))
);
create policy "coach_results_manage" on performance_results for all using (
  exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('coach','admin'))
) with check (
  exists(select 1 from profiles p where p.id=auth.uid() and p.role in ('coach','admin'))
);

-- AFTER you create your own account through the app, replace the email below
-- and run this one statement separately to make yourself admin:
-- update profiles set role='admin' where id=(select id from auth.users where email='YOUR_EMAIL_HERE');
