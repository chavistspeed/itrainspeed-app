import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes} from 'node:crypto'
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import pg from 'pg'
import {assessmentInstant} from '../lib/performance.mjs'
const C='00000000-0000-0000-0000-000000000001'
test('real PostgreSQL movement booking, rescheduling, conflict and report races',{timeout:60000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'itrain-movement-pg-')),password=randomBytes(20).toString('hex'),port=55441
 const child=fork(fileURLToPath(new URL('./helpers/postgres-server.mjs',import.meta.url)),[root,String(port),password],{execArgv:[],stdio:['ignore','pipe','pipe','ipc']});let diagnostics='',pool,started=false
 child.stdout.on('data',x=>{diagnostics+=x});child.stderr.on('data',x=>{diagnostics+=x});const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
 try{
  await new Promise((resolve,reject)=>{child.once('message',m=>m.ready?resolve():reject(new Error('Startup failed')));child.once('error',reject);child.once('exit',code=>reject(new Error(`Startup ${code}: ${diagnostics}`)))})
  started=true;pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:24})
  await pool.query(await readFile(new URL('./exported-schema.sql',import.meta.url),'utf8'))
  await pool.query('insert into auth.users(id) values($1)',[C]);await pool.query("update profiles set role='coach' where id=$1",[C])
  for(const f of ['v1-6-intro-approval.sql','migrations/20261104034138_free_performance_assessments.sql','migrations/20261104141328_movement_rubric_standing_calendar.sql'])await pool.query(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'))
  const ids=Array.from({length:12},(_,i)=>`30000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`),athletes=[]
  // Fictional setup only. Real client authorization and transitions are covered separately.
  await pool.query('alter table intro_calls disable trigger intro_validate_call')
  for(const id of ids){
   await pool.query('insert into auth.users(id) values($1)',[id]);await pool.query("update profiles set waiver_accepted_at=now(),waiver_signed_name='Fixture Parent',waiver_version='2026-01' where id=$1",[id])
   athletes.push((await pool.query("insert into athletes(guardian_id,first_name) values($1,'Synthetic athlete') returning id",[id])).rows[0].id)
   await pool.query("insert into intro_calls(coach_id,guardian_id,start_at,end_at,status,completed_at,completed_by) values($1,$2,now()-interval '2 days',now()-interval '2 days'+interval '20 minutes','completed',now(),$1)",[C,id])
  }
  await pool.query('alter table intro_calls enable trigger intro_validate_call')
  const raceAthletes={}
  for(const i of [1,3,4])raceAthletes[i]=(await pool.query("insert into athletes(guardian_id,first_name) values($1,'Separate race athlete') returning id",[ids[i]])).rows[0].id
  const rubric=(await pool.query('select id from movement_rubrics limit 1')).rows[0].id
  const day=(await pool.query("select ((now() at time zone 'America/New_York')::date+14+((8-extract(isodow from now() at time zone 'America/New_York')::int)%7))::text as day")).rows[0].day
  const at=time=>assessmentInstant(day,time)
  async function acting(who,fn){const c=await pool.connect();try{await c.query('begin');await c.query("select set_config('test.uid',$1,true)",[who]);await c.query('set local role authenticated');const r=await fn(c);await c.query('commit');return r}catch(e){await c.query('rollback');throw e}finally{c.release()}}
  const manage=(who,action,data)=>acting(who,c=>c.query('select manage_movement($1,$2::jsonb) r',[action,JSON.stringify(data)]))
  const book=(who,athlete,start)=>manage(who,'book',{athlete_id:athlete,rubric_id:rubric,coach_id:C,start_at:start})
  let first
  await t.test('12 simultaneous parents contend for one 45-minute time and exactly one wins',async()=>{
   const rows=await Promise.allSettled(ids.map((id,i)=>book(id,athletes[i],at('09:00'))));assert.equal(rows.filter(r=>r.status==='fulfilled').length,1)
   first=rows.find(r=>r.status==='fulfilled').value.rows[0].r.id
   for(const r of rows.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/no longer available/)
   assert.equal((await pool.query('select count(*)::int n from assessment_mail')).rows[0].n,2)
  })
  await t.test('movement publication and intro booking cannot overlap under a race',async()=>{
   const results=await Promise.allSettled([book(ids[1],raceAthletes[1],at('10:00')),acting(ids[2],c=>c.query('select book_intro($1,$2)',[C,at('10:00')]))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await pool.query("select count(*)::int n from assessment_slots s join intro_calls c on c.start_at<s.end_at and c.end_at>s.start_at where c.status='booked' and not s.cancelled")).rows[0].n,0)
  })
  await t.test('movement booking and coach blockout cannot leave a conflicting booking',async()=>{
   const results=await Promise.allSettled([book(ids[3],raceAthletes[3],at('12:00')),acting(C,c=>c.query("select save_intro_window('blocked',$1,$2)",[at('12:00'),at('12:45')]))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  })
  await t.test('movement booking and training publication reserve one calendar winner',async()=>{
   const program=(await pool.query("insert into programs(name) values('Synthetic training') returning id")).rows[0].id
   const results=await Promise.allSettled([book(ids[4],raceAthletes[4],at('14:45')),acting(C,c=>c.query("insert into sessions(program_id,start_at,duration_minutes,capacity,status) values($1,$2,45,10,'published')",[program,at('14:45')]))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  })
  await t.test('simultaneous movement edits use optimistic revisions and preserve one original version',async()=>{
   const slot=(await pool.query('select slot_id from assessment_appointments where id=$1',[first])).rows[0].slot_id
   await pool.query("update assessment_slots set start_at=now()-interval '1 day',end_at=now()-interval '1 day'+interval '45 minutes' where id=$1",[slot])
   const date=(await pool.query("select (now() at time zone 'America/New_York')::date::text as date")).rows[0].date
   const results=await Promise.allSettled([2.5,3].map(score=>manage(C,'save_report',{appointment_id:first,assessed_on:date,expected_revision:0,scores:[{key:'jump-rope',score,notes:'Concurrent observation'}]})))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/changed by another coach/)
   assert.equal((await pool.query('select count(*)::int n from movement_report_revisions')).rows[0].n,1)
  })
  await t.test('two concurrent reschedules preserve exactly one replacement appointment',async()=>{
   const nextDay=(await pool.query('select ($1::date+7)::text as d',[day])).rows[0].d
   // Ensure this athlete has no other future movement booking from earlier race tests.
   const id=(await book(ids[11],athletes[11],assessmentInstant(nextDay,'09:00'))).rows[0].r.id
   const results=await Promise.allSettled(['10:00','11:00'].map(time=>manage(C,'reschedule',{id,coach_id:C,rubric_id:rubric,start_at:assessmentInstant(nextDay,time)})))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await pool.query('select count(*)::int n from assessment_appointments where rescheduled_from=$1',[id])).rows[0].n,1)
   assert.equal((await pool.query('select status from assessment_appointments where id=$1',[id])).rows[0].status,'cancelled')
   assert.equal((await pool.query('select count(*)::int n from bookings')).rows[0].n,0)
  })
 }finally{
  if(pool)await pool.end();if(started&&child.connected)child.send('stop');const {code,signal}=await exited;assert.equal(code,0,`${signal}: ${diagnostics}`);await rm(root,{recursive:true,force:true})
 }
})
