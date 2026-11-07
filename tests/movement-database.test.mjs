import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {assessmentInstant} from '../lib/performance.mjs'
const C='00000000-0000-0000-0000-000000000001',P='00000000-0000-0000-0000-000000000002',O='00000000-0000-0000-0000-000000000003',db=new PGlite()
const q=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await q(s,p)).rows[0]
async function actor(id,fn,role='authenticated'){await q("select set_config('test.uid',$1,false),set_config('test.role',$2,false)",[id,role]);await q(`set role ${role}`);try{return await fn()}finally{await q('reset role')}}
const act=async(action,data)=>(await one('select manage_movement($1,$2::jsonb) result',[action,JSON.stringify(data)])).result
let athlete,other,rubric,day,call,appointment,oldSlot,report
const today=()=>one("select (now() at time zone 'America/New_York')::date::text d")
test('movement assessment onboarding, scoring, scheduling and preservation',async t=>{
 for(const file of ['tests/exported-schema.sql','supabase/v1-6-intro-approval.sql','supabase/migrations/20261104034138_free_performance_assessments.sql']){
  if(file.includes('v1-6')){for(const id of [C,P])await q('insert into auth.users(id) values($1)',[id]);await q("update profiles set role='coach' where id=$1",[C])}
  await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'))
 }
 await q('insert into auth.users(id) values($1)',[O])
 const oldFunctions=(await q("select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace and proname not in ('intro_slots','manage_assessment')")).rows
 await db.exec('alter default privileges grant all on tables to anon,authenticated,service_role; alter default privileges grant execute on functions to anon,authenticated,service_role;')
 await db.exec(await readFile(new URL('../supabase/migrations/20261104141328_movement_rubric_standing_calendar.sql',import.meta.url),'utf8'))
 athlete=(await one("insert into athletes(guardian_id,first_name) values($1,'Movement fixture') returning id",[P])).id
 other=(await one("insert into athletes(guardian_id,first_name) values($1,'Other fixture') returning id",[O])).id
 rubric=await one('select * from movement_rubrics')
 day=(await one("select ((now() at time zone 'America/New_York')::date+14+((8-extract(isodow from now() at time zone 'America/New_York')::int)%7))::text as day")).day
 const at=time=>assessmentInstant(day,time)
 await t.test('new rubric preserves all 20 original drills without copying sample scores',async()=>{
  assert.equal(rubric.items.length,20);assert.equal(rubric.items[0].drill,'Jump Rope');assert.equal(rubric.items[0].dosage,'2 min')
  assert.equal(rubric.items.filter(i=>i.drill.startsWith('Load Leg')).length,2);assert.ok(rubric.items.every(i=>!('score' in i)))
  assert.equal((await q('select * from assessment_tests')).rows.length,8)
 })
 await t.test('anonymous callers and parents cannot mutate movement reports, rubrics or revision history',async()=>{
  await actor('',async()=>{await assert.rejects(q('select * from movement_rubrics'),/permission denied/);await assert.rejects(act('create_rubric',{}),/permission denied/)},'anon')
  await actor(P,async()=>{
   await assert.rejects(q("insert into movement_reports(appointment_id) values(gen_random_uuid())"),/permission denied/)
   await assert.rejects(q('update movement_report_revisions set revision=9'),/permission denied/)
   await assert.rejects(act('create_rubric',{name:'Unauthorized',items:[]}),/Coach access/)
  })
 })
 await t.test('billing, credits, waiver signing, training approval and cancellation RPC bodies unchanged',async()=>{
  for(const f of oldFunctions)assert.equal((await one('select pg_get_functiondef(oid) body from pg_proc where proname=$1',[f.proname])).body,f.body,f.proname)
  await actor(P,async()=>assert.equal((await one('select training_approved($1) ok',[P])).ok,true))
 })
 await t.test('waiver is required before intro slots and booking; parents cannot complete calls',async()=>{
  await actor(P,async()=>{
   assert.equal((await q('select * from intro_slots($1,$2)',[C,day])).rows.length,0)
   await assert.rejects(q('select book_intro($1,$2)',[C,at('09:00')]),/waiver/)
   await q("select sign_parent_waiver_v1('Fixture Parent',false,'2026-01')")
   assert.ok((await q('select * from intro_slots($1,$2)',[C,day])).rows.length>0,'standing availability requires no windows')
   call=(await one('select book_intro($1,$2) id',[C,at('09:00')])).id
   await assert.rejects(q("select set_intro_call_status($1,'completed')",[call]),/Coach access/)
  })
 })
 await t.test('completed intro is distinct from coach approval, and cannot be inferred from elapsed time',async()=>{
  await actor(P,async()=>{await assert.rejects(act('book',{athlete_id:athlete,rubric_id:rubric.id,coach_id:C,start_at:at('10:00')}),/complete the intro/)})
  await actor(C,async()=>{await assert.rejects(q("select set_intro_call_status($1,'completed')",[call]),/has not ended/)})
  // Only fixture owner moves a synthetic appointment clock; browser has no UPDATE grant.
  await db.exec('alter table intro_calls disable trigger intro_validate_call')
  await q("update intro_calls set start_at=now()-interval '2 days',end_at=now()-interval '2 days'+interval '20 minutes' where id=$1",[call])
  await db.exec('alter table intro_calls enable trigger intro_validate_call')
  await actor(P,async()=>{assert.equal((await one('select athlete_onboarding_status($1) s',[P])).s.intro_completed,false)})
  await actor(C,async()=>{await q("select set_intro_call_status($1,'completed')",[call])})
  await actor(P,async()=>{assert.equal((await one('select athlete_onboarding_status($1) s',[P])).s.intro_completed,true);await assert.rejects(q('select athlete_onboarding_status($1)',[O]),/Family access/)})
  assert.equal((await one('select count(*)::int n from intro_mail')).n,2,'completion does not enqueue an invalid intro mail kind')
 })
 await t.test('standing 45-minute calendar, exact boundaries, no Sunday and no coach bypass of onboarding',async()=>{
  await actor(P,async()=>{
   const slots=(await q('select * from movement_assessment_slots($1,$2)',[C,day])).rows
   assert.equal(slots.length,26);assert.equal(+new Date(slots[0].end_at)-+new Date(slots[0].start_at),45*60000)
   assert.equal(+new Date(slots.at(-1).start_at),+new Date(at('15:15')))
   for(const time of ['08:00','09:10','15:30','16:00'])await assert.rejects(act('book',{athlete_id:athlete,rubric_id:rubric.id,coach_id:C,start_at:at(time)}),/available assessment time|no longer available/)
   appointment=(await act('book',{athlete_id:athlete,rubric_id:rubric.id,coach_id:C,start_at:at('10:00')})).id
   await assert.rejects(act('book',{athlete_id:other,rubric_id:rubric.id,coach_id:C,start_at:at('11:00')}),/Athlete not found/)
  })
  await actor(C,async()=>{await assert.rejects(act('book',{athlete_id:other,rubric_id:rubric.id,coach_id:C,start_at:at('11:00')}),/waiver/)})
  oldSlot=(await one('select slot_id from assessment_appointments where id=$1',[appointment])).slot_id
  const s=await one('select * from assessment_slots where id=$1',[oldSlot]);assert.equal(s.price_cents,0);assert.equal(s.credit_cost,0);assert.equal(s.template_id,null);assert.equal(s.rubric_id,rubric.id)
  const sunday=(await one('select ($1::date+6)::text d',[day])).d
  await actor(C,async()=>{assert.equal((await q('select * from movement_assessment_slots($1,$2)',[C,sunday])).rows.length,0)})
 })
 await t.test('intro, training and blockouts exclude assessments reciprocally; direct legacy bypass retired',async()=>{
  await actor(C,async()=>{
   await assert.rejects(q("select save_intro_window('blocked',$1,$2)",[at('10:00'),at('10:45')]),/conflict/)
   await q("select save_intro_window('blocked',$1,$2)",[at('13:00'),at('14:00')])
   assert.ok(!(await q('select * from movement_assessment_slots($1,$2)',[C,day])).rows.some(s=>+new Date(s.start_at)===+new Date(at('13:00'))))
   await assert.rejects(q("select manage_assessment('publish_slot','{}')"),/movement assessment calendar/)
   await assert.rejects(q("select manage_assessment('save_results',jsonb_build_object('id',$1::uuid))",[appointment]),/movement assessment controls/)
   await assert.rejects(q("select assessment_private.manage_legacy('publish_slot','{}')"),/permission denied/)
  })
  const program=(await one("insert into programs(name) values('Fixture training') returning id")).id
  await assert.rejects(q('insert into sessions(program_id,start_at,capacity) values($1,$2,10)',[program,at('10:00')]),/conflict/)
  await q('insert into sessions(program_id,start_at,capacity) values($1,$2,10)',[program,at('14:00')])
  await actor(C,async()=>{assert.ok(!(await q('select * from movement_assessment_slots($1,$2)',[C,day])).rows.some(s=>+new Date(s.start_at)===+new Date(at('14:30'))))})
 })
 await t.test('reschedule is coach-only, atomic, includes old-time overlap, and retains appointment audit',async()=>{
  await actor(P,async()=>{await assert.rejects(act('reschedule',{id:appointment}),/Coach access/);await assert.rejects(q('select * from movement_assessment_slots($1,$2,$3)',[C,day,appointment]),/Coach access/)})
  await actor(C,async()=>{
   const times=(await q('select * from movement_assessment_slots($1,$2,$3)',[C,day,appointment])).rows
   assert.ok(times.some(s=>+new Date(s.start_at)===+new Date(at('10:15'))))
   await assert.rejects(act('reschedule',{id:appointment,coach_id:C,start_at:at('13:00'),rubric_id:rubric.id}),/no longer available/)
   assert.equal((await one('select status from assessment_appointments where id=$1',[appointment])).status,'booked')
   const original=appointment;const res=await act('reschedule',{id:appointment,coach_id:C,start_at:at('10:15'),rubric_id:rubric.id});appointment=res.id
   assert.deepEqual(res.notifications,[original,appointment]);assert.equal((await one('select rescheduled_from from assessment_appointments where id=$1',[appointment])).rescheduled_from,original)
   assert.equal((await one('select cancelled from assessment_slots where id=$1',[oldSlot])).cancelled,true)
  })
 })
 await t.test('rubric quality scores accept halves only, save separately, and preserve revision history',async()=>{
  const slot=(await one('select slot_id from assessment_appointments where id=$1',[appointment])).slot_id
  await q("update assessment_slots set start_at=now()-interval '1 day',end_at=now()-interval '1 day'+interval '45 minutes' where id=$1",[slot])
  const payload={appointment_id:appointment,assessed_on:(await today()).d,expected_revision:0,scores:[{key:'jump-rope',score:2.5,notes:'Rhythm improving'}],observations:'Movement review',strengths:'Effort',priorities:'Coordination'}
  await actor(P,async()=>{await assert.rejects(act('save_report',payload),/Coach access/)})
  await actor(C,async()=>{
   for(const score of [0,5.5,2.25,'2.5'])await assert.rejects(act('save_report',{...payload,scores:[{key:'jump-rope',score}]}),/Scores must|numeric/)
   await assert.rejects(act('save_report',{...payload,scores:[{key:'unknown',score:2}]}),/does not belong/)
   report=(await act('save_report',payload)).id
   await assert.rejects(act('save_report',payload),/changed by another coach/)
   await act('save_report',{...payload,expected_revision:1,scores:[{key:'jump-rope',score:3,notes:'Corrected observation'}]})
   await act('status',{id:appointment,status:'completed'})
  })
  await actor(P,async()=>{const row=await one('select * from movement_reports where id=$1',[report]);assert.equal(row.revision,2);assert.equal(row.scores[0].score,3);assert.equal(row.priorities,'Coordination');assert.equal((await q('select * from movement_report_revisions')).rows.length,2);assert.equal((await q('select * from assessment_results')).rows.length,0)})
  await actor(O,async()=>{assert.equal((await q('select * from movement_reports')).rows.length,0);assert.equal((await q('select * from movement_report_revisions')).rows.length,0)})
 })
 await t.test('pending training approval does not prevent assessment booking after waiver and completed intro',async()=>{
  await actor(O,async()=>{
   assert.equal((await one('select training_approved($1) ok',[O])).ok,false)
   await q("select sign_parent_waiver_v1('Other Fixture Parent',false,'2026-01')")
   call=(await one('select book_intro($1,$2) id',[C,at('15:20')])).id
  })
  await db.exec('alter table intro_calls disable trigger intro_validate_call')
  await q("update intro_calls set start_at=now()-interval '3 days',end_at=now()-interval '3 days'+interval '20 minutes' where id=$1",[call])
  await db.exec('alter table intro_calls enable trigger intro_validate_call')
  await actor(C,async()=>{await q("select set_intro_call_status($1,'completed')",[call])})
  await actor(O,async()=>{
   const a=await act('book',{athlete_id:other,coach_id:C,rubric_id:rubric.id,start_at:at('11:00'),location:'Parents cannot override the facility'})
   assert.equal((await one('select s.location from assessment_slots s join assessment_appointments a on a.slot_id=s.id where a.id=$1',[a.id])).location,'iTrainSpeed')
   assert.equal((await one('select training_approved($1) ok',[O])).ok,false)
   await act('cancel',{id:a.id})
   assert.equal((await one('select training_approved($1) ok',[O])).ok,false)
  })
 })
 await t.test('custom rubric revisions preserve original snapshots; no payment or credit writes',async()=>{
  await actor(C,async()=>{
   await act('create_rubric',{name:'Revised movement review',supersedes:rubric.id,items:[{key:'new-drill',section:'Custom',drill:'New movement drill',dosage:'2 reps'}]})
   assert.equal((await one('select rubric_snapshot from movement_reports where id=$1',[report])).rubric_snapshot.items.length,20)
   assert.equal((await one('select active from movement_rubrics where id=$1',[rubric.id])).active,false)
  })
  for(const table of ['bookings','purchases','entitlements','assessment_results'])assert.equal((await one(`select count(*)::int n from ${table}`)).n,0)
  assert.equal((await one('select credits from profiles where id=$1',[P])).credits,0)
 })
 await db.close()
})
