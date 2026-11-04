import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {PGlite} from '@electric-sql/pglite'
const COACH='00000000-0000-0000-0000-000000000001',EXISTING='00000000-0000-0000-0000-000000000002',OTHER='00000000-0000-0000-0000-000000000003',NEW='00000000-0000-0000-0000-000000000004',NEW2='00000000-0000-0000-0000-000000000005'
let db
const sql=(q,p=[])=>db.query(q,p)
const as=async(id,role='authenticated')=>{await sql("select set_config('test.uid',$1,false),set_config('test.role',$2,false)",[id,role])}
const reject=async(q,p,match)=>assert.rejects(sql(q,p),match)
const call=(coach,time)=>sql('select public.book_intro($1,$2) id',[coach,time])
const window=(kind,start,end)=>sql('select public.save_intro_window($1,$2,$3) id',[kind,start,end])
const scalar=async(q,p)=>(await sql(q,p)).rows[0]
test('database contract, authorization, scheduling and preserved credit RPCs',async t=>{
 db=new PGlite()
 await db.exec(await readFile(new URL('./fixture.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/v1-6-intro-approval.sql',import.meta.url),'utf8'))
 await sql('insert into profiles(id,full_name) values($1,$2),($3,$4)',[NEW,'New family',NEW2,'Second family'])
 const {chosen_day:day}=await scalar("select ((now() at time zone 'America/New_York')::date + ((8-extract(isodow from now() at time zone 'America/New_York')::int)%7)+7)::text chosen_day")
 const instant=(day,time)=>`${day} ${time} America/New_York`
 const at=time=>instant(day,time)
 await t.test('existing families are grandfathered; new families fail closed',async()=>{
   await as(EXISTING);assert.equal((await scalar('select training_approved($1) ok',[EXISTING])).ok,true)
   await as(NEW);assert.equal((await scalar('select training_approved($1) ok',[NEW])).ok,false)
   await reject('insert into purchases(guardian_id,status) values($1,\'paid\')',[NEW],/Coach approval/)
   await reject('insert into entitlements(guardian_id) values($1)',[NEW],/Coach approval/)
   await reject('select approve_family($1)',[NEW],/Coach access/)
 })
 await t.test('parents cannot bypass approval by promoting their profile role',async()=>{
   await as(NEW)
   await reject("update profiles set role='coach' where id=$1",[NEW],/Staff role changes/)
   await sql('update profiles set full_name=$1 where id=$2',['Updated name',NEW])
   await as(NEW,'service_role')
   await reject("insert into purchases(guardian_id,status) values($1,'paid')",[NEW],/Coach approval/)
   await as(NEW)
 })
 await t.test('RLS and grants prohibit self-approval and direct calendar writes',async()=>{
   await as(NEW);await sql('set role authenticated')
   try {
     assert.equal((await sql('select * from family_approvals')).rows.length,1)
     await reject("update family_approvals set status='approved' where guardian_id=$1",[NEW],/permission denied/)
     await reject('insert into intro_calls(coach_id,guardian_id,start_at,end_at) values($1,$2,$3,$4)',[COACH,NEW,at('12:00'),at('12:20')],/permission denied/)
     await reject('select intro_private.slot_free($1,$2,$3)',[COACH,at('12:00'),at('12:20')],/permission denied/)
   }finally{await sql('reset role')}
   await as('', 'anon');await sql('set role anon')
   try{await reject('select intro_coaches()',[],/permission denied/)}finally{await sql('reset role')}
 })
 await t.test('coach availability, slot boundaries, Sundays, DST and notice',async()=>{
   await as(COACH);await window('available',at('09:00'),at('16:00'))
   await as(NEW)
   const slots=(await sql('select * from intro_slots($1,$2)',[COACH,day])).rows
   assert.equal(slots.length,21)
   await reject('select book_intro($1,now()+interval \'23 hours\')',[COACH],/24 hours/)
   for(const time of ['08:40','16:00','12:10'])await assert.rejects(call(COACH,at(time)),/20-minute slot/)
   const {sunday}=await scalar('select ($1::date+6)::text sunday',[day])
   await assert.rejects(call(COACH,instant(sunday,'12:00')),/20-minute slot/)
   assert.equal((await scalar("select intro_private.valid_intro_time('2027-03-15 09:00 America/New_York') ok")).ok,true)
   assert.equal((await scalar("select intro_private.valid_intro_time('2027-03-14 09:00 America/New_York') ok")).ok,false)
 })
 let booked
 await t.test('overlaps, duplicate bookings and outbox are atomic',async()=>{
   await as(COACH);await window('blocked',at('10:00'),at('10:20'))
   await as(NEW);await assert.rejects(call(COACH,at('10:00')),/no longer available/)
   booked=(await call(COACH,at('12:00'))).rows[0].id
   assert.equal((await sql('select * from intro_mail where call_id=$1',[booked])).rows.length,2)
   await as(NEW2);await assert.rejects(call(COACH,at('12:00')),/no longer available/)
   await as(NEW);await assert.rejects(call(COACH,at('13:00')),/already has an upcoming/)
   assert.equal((await scalar('select count(*)::int n from intro_calls')).n,1)
 })
 await t.test('conflicting blockouts, removed coverage and training sessions are rejected',async()=>{
   await as(COACH)
   await assert.rejects(window('blocked',at('11:50'),at('12:10')),/conflicting intro/)
   const available=(await scalar("select id from intro_windows where kind='available'")).id
   await reject('select delete_intro_window($1)',[available],/cover existing/)
   await reject("insert into sessions(start_at,duration_minutes,status) values($1,60,'published')",[at('11:40')],/overlaps/)
   await sql("insert into sessions(start_at,duration_minutes,status) values($1,60,'published')",[at('14:00')])
   await as(NEW2);await assert.rejects(call(COACH,at('14:20')),/no longer available/)
 })
 await t.test('owner-only cancellation frees slots and queues both recipients',async()=>{
   await as(NEW2);await reject('select cancel_intro($1)',[booked],/not found/)
   await as(NEW);await sql('select cancel_intro($1)',[booked])
   assert.equal((await sql('select * from intro_mail where call_id=$1',[booked])).rows.length,4)
   await as(NEW2);await call(COACH,at('12:00'))
 })
 await t.test('only staff can approve; approval is distinct from an intro booking',async()=>{
   await as(NEW2);assert.equal((await scalar('select training_approved($1) ok',[NEW2])).ok,false)
   await as(COACH);await sql('select approve_family($1)',[NEW])
   await as(NEW);assert.equal((await scalar('select training_approved($1) ok',[NEW])).ok,true)
   await sql("insert into purchases(guardian_id,status) values($1,'paid')",[NEW])
 })
 await t.test('database guard covers legacy and future booking RPC writes',async()=>{
   await as(NEW2)
   await reject("insert into bookings(guardian_id,status) values($1,'booked')",[NEW2],/Coach approval/)
   const b=await scalar("insert into bookings(guardian_id,status) values($1,'cancelled') returning id",[NEW2])
   await reject("update bookings set status='booked' where id=$1",[b.id],/Coach approval/)
 })
 await t.test('preserved V1.4 booking and cancellation decrement and restore typed credits',async()=>{
   // Load the original RPC bodies directly, without copying their implementation.
   const original=await readFile(new URL('../supabase/v1-4-safe-upgrade.sql',import.meta.url),'utf8')
   const start=original.indexOf('create or replace function public.book_session_v14')
   const end=original.indexOf('-- V1.4-aware coach cancellation')
   await db.exec(original.slice(start,end))
   const athlete='10000000-0000-0000-0000-000000000001',prog='20000000-0000-0000-0000-000000000001'
   await sql('insert into athletes(id,guardian_id) values($1,$2)',[athlete,EXISTING])
   await sql("insert into programs values($1,'group',1)",[prog])
   const session=(await scalar("insert into sessions(program_id,start_at,duration_minutes,capacity,status) values($1,$2,60,5,'published') returning id",[prog,at('09:00')])).id
   await sql("insert into entitlements(guardian_id,credit_type,credits_remaining,unlimited) values($1,'group',5,false)",[EXISTING])
   await as(EXISTING)
   const id=(await scalar('select book_session_v14($1,$2) id',[session,athlete])).id
   assert.equal((await scalar('select credits_remaining from entitlements where guardian_id=$1',[EXISTING])).credits_remaining,4)
   await sql('select cancel_booking_v14($1)',[id])
   assert.equal((await scalar('select credits_remaining from entitlements where guardian_id=$1',[EXISTING])).credits_remaining,5)
   await reject('select cancel_booking_v14($1)',[id],/not found/)
 })
 await t.test('mail job compare-and-set allows one claim',async()=>{
   const {id}=await scalar("select id from intro_mail where state='pending' limit 1")
   const query="update intro_mail set state='sending' where id=$1 and state='pending' returning id"
   assert.equal((await sql(query,[id])).rows.length,1)
   assert.equal((await sql(query,[id])).rows.length,0)
 })
 await t.test('prepared Acuity import is repeat-safe, silent, and detects mapping mismatches',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'itrain-import-'))
   try{
     const start=new Date(`${day}T15:00:00Z`)
     const label=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'}).format(start)
     const csv=join(dir,'source.csv'),output=join(dir,'import.sql')
     await writeFile(csv,`Appointment ID,Start Time,End Time,Timezone\n12345,"${label} 3:00 pm","${label} 3:20 pm",America/New_York\n`)
     execFileSync('python3',['scripts/prepare-acuity-import.py',csv,'--appointment-id','12345','--coach-id',COACH,'--guardian-id',NEW,'--output',output],{cwd:resolve('.')})
     const script=await readFile(output,'utf8')
     await as(COACH)
     const before=(await scalar('select count(*)::int n from intro_mail')).n
     await db.exec(script);await db.exec(script)
     assert.equal((await scalar("select count(*)::int n from intro_calls where source_id='acuity:12345'")).n,1)
     assert.equal((await scalar('select count(*)::int n from intro_mail')).n,before)
     await assert.rejects(db.exec(script.replaceAll(NEW,EXISTING)),/different details/)
     await db.exec('rollback')
   }finally{await rm(dir,{recursive:true,force:true})}
 })
 await db.close()
})
