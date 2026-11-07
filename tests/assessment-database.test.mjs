import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
const db=new PGlite(),C='00000000-0000-0000-0000-000000000001',P='00000000-0000-0000-0000-000000000002',O='00000000-0000-0000-0000-000000000003',N='00000000-0000-0000-0000-000000000004'
const q=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await q(s,p)).rows[0]
async function actor(id,fn,role='authenticated'){await q("select set_config('test.uid',$1,false),set_config('test.role',$2,false)",[id,role]);await q(`set role ${role}`);try{return await fn()}finally{await q('reset role')}}
const action=(name,data)=>q('select manage_assessment($1,$2::jsonb) id',[name,JSON.stringify(data)])
const id=async(name,data)=>(await action(name,data)).rows[0].id
let athlete,otherAthlete,newAthlete,template,slot,appointment,day

test('free assessments: real schema, permissions, scheduling, results and preservation',async t=>{
 await db.exec(await readFile(new URL('./exported-schema.sql',import.meta.url),'utf8'))
 for(const u of [C,P,O])await q('insert into auth.users(id) values($1)',[u])
 await q("update profiles set role='coach' where id=$1",[C])
 await db.exec(await readFile(new URL('../supabase/v1-6-intro-approval.sql',import.meta.url),'utf8'))
 await q('insert into auth.users(id) values($1)',[N])
 const before=(await q("select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace")).rows
 await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated; alter default privileges in schema public grant execute on functions to anon,authenticated;')
 await db.exec(await readFile(new URL('../supabase/migrations/20261104034138_free_performance_assessments.sql',import.meta.url),'utf8'))
 athlete=(await one("insert into athletes(guardian_id,first_name) values($1,'Athlete') returning id",[P])).id
 otherAthlete=(await one("insert into athletes(guardian_id,first_name) values($1,'Other') returning id",[O])).id
 newAthlete=(await one("insert into athletes(guardian_id,first_name) values($1,'New') returning id",[N])).id
 template=(await one("select id from assessment_templates where name like 'Track%'")).id
 day=(await one("select ((now() at time zone 'America/New_York')::date+14+((8-extract(isodow from now() at time zone 'America/New_York')::int)%7))::text as day")).day
 const at=time=>`${day} ${time} America/New_York`
 await t.test('all prior RPC bodies unchanged; 8 tests and 3 templates seeded',async()=>{
  for(const f of before)assert.equal((await one('select pg_get_functiondef(oid) body from pg_proc where proname=$1',[f.proname])).body,f.body,f.proname)
  assert.equal((await one('select count(*)::int n from assessment_tests')).n,8)
  assert.equal((await one('select count(*)::int n from assessment_templates')).n,3)
 })
 await t.test('parent/anon cannot manage library, mutate results, or bypass approval',async()=>{
  await actor(P,async()=>{
   await assert.rejects(action('create_test',{name:'bad'}),/Coach access/)
   await assert.rejects(q("insert into assessment_tests(name,unit,protocol,direction) values('bad','s','bad','lower')"),/permission denied/)
   await assert.rejects(q('update assessment_results set value=1'),/permission denied/)
  })
  await actor('',async()=>{await assert.rejects(action('create_test',{}),/permission denied/)},'anon')
 })
 await actor(C,async()=>{slot=await id('publish_slot',{template_id:template,start_at:at('10:00'),end_at:at('10:45'),location:'Test venue'})})
 await t.test('approval and athlete ownership enforced even for coach booking',async()=>{
  await actor(N,async()=>{await assert.rejects(action('book',{slot_id:slot,athlete_id:newAthlete}),/approval/)} )
  await actor(P,async()=>{await assert.rejects(action('book',{slot_id:slot,athlete_id:otherAthlete}),/Athlete not found/)})
  await actor(C,async()=>{await assert.rejects(action('book',{slot_id:slot,athlete_id:newAthlete}),/approval/)})
 })
 const creditsBefore=await one('select credits from profiles where id=$1',[P])
 await actor(P,async()=>{appointment=await id('book',{slot_id:slot,athlete_id:athlete})})
 await t.test('occupancy true across families, duplicate rejected, family data private',async()=>{
  await actor(O,async()=>{
   const slots=(await q('select assessment_available_slots() s')).rows.map(x=>x.s);assert.equal(slots.find(s=>s.id===slot).occupied,true)
   assert.equal((await q('select * from assessment_appointments')).rows.length,0)
   await assert.rejects(action('book',{slot_id:slot,athlete_id:otherAthlete}),/duplicate key/)
   await assert.rejects(action('cancel',{id:appointment}),/coach assistance/)
  })
  assert.deepEqual(await one('select credits from profiles where id=$1',[P]),creditsBefore)
  assert.equal((await one('select count(*)::int n from bookings')).n,0)
  assert.equal((await one('select count(*)::int n from purchases')).n,0)
  assert.equal((await one('select count(*)::int n from assessment_mail')).n,2)
 })
 await t.test('calendar guards reject overlapping assessment, intro, blockout and training',async()=>{
  await actor(C,async()=>{
   await assert.rejects(action('publish_slot',{template_id:template,start_at:at('10:15'),end_at:at('11:00'),location:'Here'}),/conflict/)
   await assert.rejects(q("select save_intro_window('blocked',$1,$2)",[at('10:00'),at('10:20')]),/conflict/)
   await q("select save_intro_window('available',$1,$2)",[at('09:00'),at('16:00')])
   await assert.rejects(q('select book_intro($1,$2)',[C,at('10:00')]),/conflict|no longer available/)
   assert.equal((await q('select * from intro_slots($1,$2)',[C,day])).rows.some(r=>new Date(r.start_at).getTime()===new Date(at('10:00')).getTime()),false)
  })
  const program=(await one("insert into programs(name) values('Training') returning id")).id
  await assert.rejects(q('insert into sessions(program_id,start_at,capacity) values($1,$2,10)',[program,at('10:00')]),/conflict/)
  await q('insert into sessions(program_id,start_at,capacity) values($1,$2,10)',[program,at('12:00')])
  await actor(C,async()=>{await assert.rejects(action('publish_slot',{template_id:template,start_at:at('12:30'),end_at:at('13:00'),location:'Here'}),/Training calendar conflict/)})
 })
 await t.test('cancel frees capacity without restoring nonexistent credits',async()=>{
  await actor(P,async()=>{await action('cancel',{id:appointment});appointment=await id('book',{slot_id:slot,athlete_id:athlete})})
  assert.deepEqual(await one('select credits from profiles where id=$1',[P]),creditsBefore)
 })
 const testIds=(await one('select test_ids from assessment_templates where id=$1',[template])).test_ids
 await t.test('future testing rejected; past assessment records immutable snapshots and corrections',async()=>{
  await actor(C,async()=>{await assert.rejects(action('save_results',{id:appointment,tested_at:'2020-01-01',results:[{test_id:testIds[0],value:1.2}]}),/started/)})
  // Owner-only fixture clock movement; production clients have no slot UPDATE grant.
  await q("update assessment_slots set start_at=now()-interval '1 day',end_at=now()-interval '23 hours' where id=$1",[slot])
  const date=(await one("select (now() at time zone 'America/New_York')::date::text d")).d
  await actor(C,async()=>{
   await assert.rejects(action('save_results',{id:appointment,tested_at:date,results:[{test_id:testIds[0],value:-1}]}),/check constraint/)
   await action('save_results',{id:appointment,tested_at:date,results:[{test_id:testIds[0],value:1.2,notes:'Timing gates; 20m run-in'}]})
   await assert.rejects(action('save_results',{id:appointment,tested_at:date,results:[{test_id:testIds[0],value:1.1}]}),/duplicate key/)
   const r=await one('select * from assessment_results');assert.ok(r.protocol);assert.equal(r.unit,'s');assert.equal(r.created_by,C)
   await action('void_result',{id:r.id,reason:'Transcription correction'})
   await action('save_results',{id:appointment,tested_at:date,results:[{test_id:testIds[0],value:1.1}]})
   assert.equal((await q('select * from assessment_results')).rows.length,2)
  })
  await actor(P,async()=>{assert.equal((await q('select * from assessment_results')).rows.length,2);await assert.rejects(action('void_result',{id:appointment,reason:'bad'}),/Coach access/)})
  await actor(O,async()=>{assert.equal((await q('select * from assessment_results')).rows.length,0)})
 })
 await t.test('ongoing coaching results need no appointment and are immediately visible only to their family',async()=>{
  const date=(await one("select (now() at time zone 'America/New_York')::date::text d")).d
  const payload={entry_id:'20000000-0000-0000-0000-000000000001',athlete_id:otherAthlete,tested_at:date,results:[{test_id:testIds[0],value:1.3,notes:'Weekly sprint work'}]}
  const mailCount=(await one('select count(*)::int n from assessment_mail')).n
  await actor(O,async()=>{await assert.rejects(action('save_training_results',payload),/Coach access/)})
  await actor(C,async()=>{
   const saved=await id('save_training_results',payload);assert.equal(saved,payload.entry_id)
   assert.equal(await id('save_training_results',payload),saved)
   await assert.rejects(action('save_training_results',{...payload,results:[{test_id:testIds[0],value:1.4}]}),/already been used/)
  })
  await actor(O,async()=>{
   const rows=(await q('select * from assessment_results')).rows
   assert.equal(rows.length,1);assert.equal(rows[0].appointment_id,null);assert.equal(rows[0].training_entry_id,payload.entry_id)
   assert.equal(rows[0].notes,'Weekly sprint work');assert.equal(+rows[0].value,1.3)
   await assert.rejects(q('select * from athlete_training_entries'),/permission denied/)
  })
  await actor(P,async()=>{assert.equal((await q('select * from assessment_results where athlete_id=$1',[otherAthlete])).rows.length,0)})
  await actor(C,async()=>{
   const later={...payload,entry_id:'20000000-0000-0000-0000-000000000002',results:[{test_id:testIds[0],value:1.2}]}
   await action('save_training_results',later)
   assert.equal((await q('select * from assessment_results where athlete_id=$1',[otherAthlete])).rows.length,2)
   await assert.rejects(action('save_training_results',{...later,entry_id:'20000000-0000-0000-0000-000000000003',tested_at:'2099-01-01'}),/nonfuture/)
   await assert.rejects(action('save_training_results',{...later,entry_id:'20000000-0000-0000-0000-000000000004',results:[{test_id:testIds[0],value:1},{test_id:testIds[1],value:-1}]}),/check constraint/)
  })
  assert.equal((await q('select * from athlete_training_entries')).rows.length,2)
  assert.equal((await one('select count(*)::int n from assessment_mail')).n,mailCount)
  assert.deepEqual(await one('select credits from profiles where id=$1',[P]),creditsBefore)
 })
 await t.test('templates validate tests and preserve archived history; no payments/credits',async()=>{
  await actor(C,async()=>{
   await assert.rejects(action('create_template',{name:'Empty',test_ids:[]}),/check constraint/)
   await assert.rejects(action('create_template',{name:'Duplicate',test_ids:[testIds[0],testIds[0]]}),/Duplicate/)
   await action('archive_test',{id:testIds[0]})
   assert.equal((await q('select * from assessment_results')).rows.length,4)
  })
  assert.deepEqual(await one('select credits from profiles where id=$1',[P]),creditsBefore)
  for(const table of ['bookings','purchases','entitlements'])assert.equal((await one(`select count(*)::int n from ${table}`)).n,0)
 })
 await db.close()
})
