-- Athlete assessment reports and private attachments. Additive upgrade.
create table public.athlete_assessments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  assessed_on date not null default current_date,
  notes text not null default '',
  training_focus text not null default '',
  metrics jsonb not null default '[]'::jsonb check (jsonb_typeof(metrics) = 'array'),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index athlete_assessments_athlete_date on public.athlete_assessments(athlete_id, assessed_on desc);
alter table public.athlete_assessments enable row level security;
revoke all on public.athlete_assessments from anon;
grant select, insert, update, delete on public.athlete_assessments to authenticated;
create policy assessment_staff on public.athlete_assessments for all to authenticated
  using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('coach','admin')))
  with check (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('coach','admin')));
create policy assessment_parent_read on public.athlete_assessments for select to authenticated
  using (status='published' and exists(select 1 from public.athletes a where a.id=athlete_id and a.guardian_id=(select auth.uid())));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('assessment-files','assessment-files',false,52428800,
 array['text/csv','application/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','video/mp4','video/webm','video/quicktime'])
on conflict (id) do nothing;
create policy assessment_file_read on storage.objects for select to authenticated
using (bucket_id='assessment-files' and exists(
 select 1 from public.athlete_assessments r where r.id::text=(storage.foldername(name))[1]
 and (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('coach','admin'))
   or (r.status='published' and r.attachments @> jsonb_build_array(jsonb_build_object('path',name)) and exists(select 1 from public.athletes a where a.id=r.athlete_id and a.guardian_id=(select auth.uid()))))
));
create policy assessment_file_insert on storage.objects for insert to authenticated
with check (bucket_id='assessment-files'
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('coach','admin'))
 and exists(select 1 from public.athlete_assessments r where r.id::text=(storage.foldername(name))[1] and r.status='draft'));
create policy assessment_file_delete on storage.objects for delete to authenticated
using (bucket_id='assessment-files' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('coach','admin')));
