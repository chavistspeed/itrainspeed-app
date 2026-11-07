import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
const db=new PGlite(),C='00000000-0000-0000-0000-000000000001',P='00000000-0000-0000-0000-000000000002',O='00000000-0000-0000-0000-000000000003'
const q=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await q(s,p)).rows[0]
async function actor(id,fn,role='authenticated'){await q("select set_config('test.uid',$1,false),set_config('test.role',$2,false)",[id,role]);await q(`set role ${role}`);try{return await fn()}finally{await q('reset role')}}
const state=async(a=null)=>(await one('select athlete_onboarding_status($1,$2) s',[P,a])).s
const record=async(a,step,done=true,date=null,note='Previously completed')=>(await one('select record_existing_onboarding($1,$2,$3,$4,$5) s',[a,step,done,date,note])).s

test('existing athlete attestations recognize prior onboarding securely without fabricating activity',async t=>{
 for(const f of ['tests/exported-schema.sql','supabase/v1-6-intro-approval.sql','supabase/migrations/20261104034138_free_performance_assessments.sql','supabase/migrations/20261104141328_movement_rubric_standing_calendar.sql']){
  if(f.includes('v1-6')){for(const id of [C,P,O])await q('insert into auth.users(id) values($1)',[id]);await q("update profiles set role='coach' where id=$1",[C])}
  await db.exec(await readFile(new URL('../'+f,import.meta.url),'utf8'))
 }
 const before=(await q("select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace")).rows
 await db.exec('alter default privileges grant all on tables to anon,authenticated,service_role; alter default privileges grant execute on functions to anon,authenticated,service_role;')
 await db.exec(await readFile(new URL('../supabase/migrations/20261104233000_existing_athlete_onboarding.sql',import.meta.url),'utf8'))
 const a=(await one("insert into athletes(guardian_id,first_name) values($1,'Existing') returning id",[P])).id
 const sibling=(await one("insert into athletes(guardian_id,first_name) values($1,'Sibling') returning id",[P])).id
 const approved=await actor(P,async()=>(await state(a)).training_approved)
 await t.test('anonymous, parent, service role and direct writes cannot forge completion',async()=>{
  await actor('',async()=>assert.rejects(record(a,'intro'),/permission denied/),'anon')
  await actor(P,async()=>{await assert.rejects(record(a,'intro'),/Coach access/);assert.equal((await q('select * from onboarding_attestations')).rows.length,0);await assert.rejects(q("insert into onboarding_attestations(step) values('intro')"),/permission denied/)})
  await actor(C,async()=>{await assert.rejects(q('update onboarding_attestations set completed=false'),/permission denied/);await assert.rejects(q('delete from onboarding_attestations'),/permission denied/)})
 })
 await t.test('coach recognition updates parent status; assessment is athlete-specific and waiver remains required',async()=>{
  await actor(C,async()=>{await record(a,'intro');await record(a,'assessment',true,'2026-01-01')})
  await actor(P,async()=>{const s=await state(a);assert.equal(s.intro_completed,true);assert.equal(s.movement_completed,true);assert.equal(s.waiver_signed,false);assert.equal(s.training_approved,approved);assert.equal((await state(sibling)).movement_completed,false);assert.equal((await state()).movement_completed,false)})
  await actor(O,async()=>assert.rejects(state(a),/Family access/))
  assert.equal((await one('select count(*)::int n from intro_calls')).n,0)
  for(const table of ['assessment_slots','assessment_appointments','movement_reports','assessment_results','intro_mail','assessment_mail'])assert.equal((await one(`select count(*)::int n from ${table}`)).n,0,table)
 })
 await t.test('undo appends audit, repeats are idempotent, date and step validation reject bad writes',async()=>{
  await actor(C,async()=>{
   await record(a,'assessment');assert.equal((await q('select * from onboarding_attestations')).rows.length,2)
   await record(a,'assessment',false);assert.equal((await state(a)).movement_completed,false)
   const rows=(await q("select * from onboarding_attestations where step='assessment' order by id")).rows
   assert.equal(rows.length,2);assert.equal(rows[0].completed,true);assert.equal(rows[1].completed,false);assert.equal(rows[0].recorded_by,C)
   await assert.rejects(record(a,'bad'),/Choose an onboarding/)
   await assert.rejects(record(a,'assessment',true,'2999-01-01'),/past completion date/)
   await assert.rejects(record(a,'intro',false,'2026-01-01'),/past completion date/)
  })
 })
 await t.test('existing public payment, approval, scheduling and waiver functions are untouched',async()=>{
  for(const f of before)assert.equal((await one('select pg_get_functiondef(oid) body from pg_proc where proname=$1',[f.proname])).body,f.body,f.proname)
 })
 await db.close()
})
