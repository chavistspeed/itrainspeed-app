#!/usr/bin/env python3
"""Offline CSV validation / SQL preparation only. Never opens a database."""
import argparse,csv,json,uuid
from datetime import datetime,timezone,time
from pathlib import Path
from zoneinfo import ZoneInfo
p=argparse.ArgumentParser()
p.add_argument('csv',type=Path)
p.add_argument('--appointment-id',default='1799537202')
p.add_argument('--coach-id',required=True,type=uuid.UUID)
p.add_argument('--guardian-id',required=True,type=uuid.UUID)
p.add_argument('--output',required=True,type=Path)
a=p.parse_args()
with a.csv.open(encoding='utf-8-sig',newline='') as f:
 rows=[r for r in csv.DictReader(f) if r['Appointment ID']==a.appointment_id]
if len(rows)!=1: raise SystemExit('Expected exactly one matching source appointment.')
r=rows[0]
start=datetime.strptime(r['Start Time'],'%B %d, %Y %I:%M %p').replace(tzinfo=ZoneInfo(r['Timezone']))
end=datetime.strptime(r['End Time'],'%B %d, %Y %I:%M %p').replace(tzinfo=ZoneInfo(r['Timezone']))
if r['Timezone']!='America/New_York' or (end-start).total_seconds()!=1200:
 raise SystemExit('Appointment must be 20 minutes in America/New_York.')
if start.weekday()>=6 or start.time()<time(9) or end.time()>time(16) or start.minute%20:
 raise SystemExit('Appointment falls outside valid intro slots.')
if not a.appointment_id.isdigit(): raise SystemExit('Invalid appointment ID.')
# Real schema uses profile IDs. The operator must verify email/coach identity,
# active Acuity state, and create availability before this reviewed script runs.
source='acuity:'+a.appointment_id
sql=f'''-- PREPARED ONLY: requires explicit production approval before execution.
-- Confirm the source appointment is still active and IDs match its participants.
-- This does not approve training access or send a duplicate confirmation.
begin;
select pg_advisory_xact_lock(619402611);
do $$
begin
 if exists(select 1 from public.intro_calls where source_id='{source}'
   and (coach_id<>'{a.coach_id}'::uuid or guardian_id<>'{a.guardian_id}'::uuid
     or start_at<>'{start.isoformat()}'::timestamptz or end_at<>'{end.isoformat()}'::timestamptz)) then
   raise exception 'Source ID already imported with different details';
 end if;
 if not exists(select 1 from public.intro_calls where source_id='{source}') then
   insert into public.intro_calls(coach_id,guardian_id,start_at,end_at,source_id)
   values('{a.coach_id}','{a.guardian_id}','{start.isoformat()}','{end.isoformat()}','{source}');
 end if;
end $$;
commit;
'''
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(sql)
print(json.dumps({'status':'prepared_only','source_id':source,'starts_at':start.isoformat(),'starts_at_utc':start.astimezone(timezone.utc).isoformat(),'output':str(a.output)}))
