import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes} from 'node:crypto'
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import pg from 'pg'
const COACH='00000000-0000-0000-0000-000000000001'
test('real PostgreSQL simultaneous booking, blockout, and training races',{timeout:60000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'itrain-pg-'))
 const password=randomBytes(20).toString('hex')
 const port=55439
 const child=fork(fileURLToPath(new URL('./helpers/postgres-server.mjs',import.meta.url)),[root,String(port),password],{execArgv:[],stdio:['ignore','pipe','pipe','ipc']})
 let diagnostics=''
 child.stdout.on('data',chunk=>{diagnostics+=chunk})
 child.stderr.on('data',chunk=>{diagnostics+=chunk})
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
 let pool,started=false
 try{
  await new Promise((resolve,reject)=>{
   child.once('message',message=>message.ready?resolve():reject(new Error('Unexpected PostgreSQL startup message')))
   child.once('error',reject)
   child.once('exit',code=>reject(new Error(`PostgreSQL startup failed (${code}): ${diagnostics}`)))
  })
  started=true
  pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:24})
  await pool.query(await readFile(new URL('./exported-schema.sql',import.meta.url),'utf8'))
  await pool.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'coach@example.invalid','{\"full_name\":\"Coach\"}')",[COACH])
  await pool.query("update profiles set role='coach' where id=$1",[COACH])
  const program=(await pool.query("insert into programs(name) values('Fixture training') returning id")).rows[0].id
  await pool.query(await readFile(new URL('../supabase/v1-6-intro-approval.sql',import.meta.url),'utf8'))
  await pool.query(await readFile(new URL('../supabase/migrations/20261104034138_free_performance_assessments.sql',import.meta.url),'utf8'))
  const ids=Array.from({length:20},(_,i)=>`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`)
  for(const id of ids)await pool.query('insert into auth.users(id) values($1)',[id])
  const {rows:[{day}]}=await pool.query("select ((now() at time zone 'America/New_York')::date+14+((8-extract(isodow from now() at time zone 'America/New_York')::int)%7))::text as day")
  const at=time=>`${day} ${time} America/New_York`
  async function acting(id,fn){
   const c=await pool.connect()
   try{await c.query('begin');await c.query("select set_config('test.uid',$1,true)",[id]);const result=await fn(c);await c.query('commit');return result}
   catch(e){await c.query('rollback');throw e}finally{c.release()}
  }
  await acting(COACH,c=>c.query("select save_intro_window('available',$1,$2)",[at('09:00'),at('16:00')]))
  await t.test('calendar rejects snapshot isolation that could hide a committed conflict',async()=>{
   const c=await pool.connect()
   try{
    await c.query('begin isolation level repeatable read')
    await assert.rejects(c.query("insert into sessions(program_id,start_at,duration_minutes,status) values($1,$2,20,'published')",[program,at('15:40')]),/READ COMMITTED/)
   }finally{await c.query('rollback');c.release()}
  })
  await t.test('20 simultaneous families contend for one slot; exactly one succeeds',async()=>{
   const results=await Promise.allSettled(ids.map(id=>acting(id,c=>c.query('select book_intro($1,$2)',[COACH,at('12:00')]))))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal(results.filter(r=>r.status==='rejected').length,19)
   for(const r of results.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/no longer available|duplicate key/)
   assert.equal((await pool.query("select count(*)::int n from intro_calls where status='booked'")).rows[0].n,1)
   assert.equal((await pool.query('select count(*)::int n from intro_mail')).rows[0].n,2)
  })
  await t.test('booking and blockout race cannot leave overlapping records',async()=>{
   const winner=(await pool.query('select guardian_id from intro_calls')).rows[0].guardian_id
   const family=ids.find(id=>id!==winner)
   const results=await Promise.allSettled([
    acting(family,c=>c.query('select book_intro($1,$2)',[COACH,at('13:00')])),
    acting(COACH,c=>c.query("select save_intro_window('blocked',$1,$2)",[at('13:00'),at('13:20')]))
   ])
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await pool.query("select count(*)::int n from intro_calls c join intro_windows w on c.coach_id=w.coach_id and c.start_at<w.end_at and c.end_at>w.start_at where c.status='booked' and w.kind='blocked'")).rows[0].n,0)
  })
  await t.test('booking and published training creation race cannot overlap',async()=>{
   const already=new Set((await pool.query('select guardian_id from intro_calls')).rows.map(r=>r.guardian_id))
   const family=ids.find(id=>!already.has(id))
   const results=await Promise.allSettled([
    acting(family,c=>c.query('select book_intro($1,$2)',[COACH,at('14:00')])),
    acting(COACH,c=>c.query("insert into sessions(program_id,start_at,duration_minutes,status) values($1,$2,60,'published')",[program,at('14:00')]))
   ])
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((await pool.query("select count(*)::int n from intro_calls c join sessions s on c.start_at<s.start_at+make_interval(mins=>s.duration_minutes) and c.end_at>s.start_at where c.status='booked' and s.status='published'")).rows[0].n,0)
  })

  const template=(await pool.query('select id from assessment_templates limit 1')).rows[0].id
  const manage=(who,action,data)=>acting(who,c=>c.query('select manage_assessment($1,$2::jsonb) id',[action,JSON.stringify(data)]))
  await t.test('assessment publication racing intro or training reserves one calendar winner',async()=>{
   for(const [time,other] of [
    ['09:00',()=>acting(ids.at(-1),c=>c.query('select book_intro($1,$2)',[COACH,at('09:00')]))],
    ['10:00',()=>acting(COACH,c=>c.query("insert into sessions(program_id,start_at,duration_minutes,status) values($1,$2,30,'published')",[program,at('10:00')]))]
   ]){
    const results=await Promise.allSettled([manage(COACH,'publish_slot',{template_id:template,start_at:at(time),end_at:at(time.slice(0,2)+':30'),location:'Fixture'}),other()])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   }
  })
  await t.test('20 concurrent free assessment requests create one appointment and two emails',async()=>{
   const slot=(await manage(COACH,'publish_slot',{template_id:template,start_at:at('17:00'),end_at:at('17:45'),location:'Fixture'})).rows[0].id
   const athletes=[]
   for(const family of ids){
    await acting(COACH,c=>c.query('select approve_family($1)',[family]))
    athletes.push((await pool.query("insert into athletes(guardian_id,first_name) values($1,'Synthetic') returning id",[family])).rows[0].id)
   }
   const result=await Promise.allSettled(ids.map((family,i)=>manage(family,'book',{slot_id:slot,athlete_id:athletes[i]})))
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1)
   for(const r of result.filter(r=>r.status==='rejected'))assert.match(r.reason.message,/duplicate key/)
   assert.equal((await pool.query('select count(*)::int n from assessment_appointments')).rows[0].n,1)
   assert.equal((await pool.query('select count(*)::int n from assessment_mail')).rows[0].n,2)
   assert.equal((await pool.query('select count(*)::int n from bookings')).rows[0].n,0)
  })
 }finally{
  if(pool)await pool.end()
  if(started&&child.connected)child.send('stop')
  const {code,signal}=await exited
  assert.equal(code,0,`PostgreSQL helper failed (${signal}): ${diagnostics}`)
  await rm(root,{recursive:true,force:true})
 }
})
