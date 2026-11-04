import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
const COACH='00000000-0000-0000-0000-000000000001',OLD='00000000-0000-0000-0000-000000000002',NEW='00000000-0000-0000-0000-000000000003'
const db=new PGlite()
const q=(s,p=[])=>db.query(s,p)
const one=async(s,p=[])=>(await q(s,p)).rows[0]
const as=async(id,role='authenticated')=>q("select set_config('test.uid',$1,false),set_config('test.role',$2,false)",[id,role])
const actor=async(id,fn,role='authenticated')=>{
 await as(id,role);await q(`set role ${role}`)
 try{return await fn()}finally{await q('reset role')}
}
const user=async(id,name)=>q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('full_name',$3::text))",[id,`${id}@example.invalid`,name])
const fulfill=(id,session,pkg,athlete=null,unlimited=false)=>q('select fulfill_stripe_checkout_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) id',[id,athlete,pkg,'fixture','group',5,unlimited,null,session,'pi_'+session,unlimited?'sub_'+session:null,'cus_fixture',3500])
let packageId,athlete,newAthlete,session,lateSession,day

test('exported Supabase schema compatibility and preserved production RPC behavior',async t=>{
 await db.exec(await readFile(new URL('./exported-schema.sql',import.meta.url),'utf8'))
 // Auth signup trigger is the real handle_new_user body; auth table is a stub.
 await as('', 'service_role');await user(COACH,'Coach');await user(OLD,'Existing family')
 await q("update profiles set role='coach' where id=$1",[COACH])
 const before=(await q("select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace order by proname")).rows
 // Exercise hostile default grants too: PostgreSQL/Supabase may give new
 // functions explicit anon privileges independently of the PUBLIC grant.
 await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role; alter default privileges in schema public grant all on tables to anon,authenticated,service_role;')
 await db.exec(await readFile(new URL('../supabase/v1-6-intro-approval.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/migrations/20261104034138_free_performance_assessments.sql',import.meta.url),'utf8'))
 await user(NEW,'New family')
 const after=(await q("select proname,pg_get_functiondef(oid) body from pg_proc where pronamespace='public'::regnamespace order by proname")).rows
 await t.test('migration preserves all 15 exported RPC bodies',()=>{
  assert.equal(before.length,15)
  for(const r of before)assert.equal(after.find(x=>x.proname===r.proname)?.body,r.body,r.proname)
 })
 await t.test('real signup trigger creates pending families; existing family is grandfathered',async()=>{
  assert.equal((await one('select status from family_approvals where guardian_id=$1',[OLD])).status,'grandfathered')
  assert.equal((await one('select status from family_approvals where guardian_id=$1',[NEW])).status,'pending')
  await actor(NEW,async()=>{
   await assert.rejects(q("update family_approvals set status='approved' where guardian_id=$1",[NEW]),/permission denied/)
   await assert.rejects(q('select approve_family($1)',[NEW]),/Coach access/)
  })
 })
 const program=(await one("insert into programs(name,credit_type,service_type) values('Fixture','group','group') returning id")).id
 packageId=(await one("insert into packages(name,credit_type,access_type,credits,price_cents) values('Fixture','group','credits',5,3500) returning id")).id
 athlete=(await one("insert into athletes(guardian_id,first_name) values($1,'Existing athlete') returning id",[OLD])).id
 newAthlete=(await one("insert into athletes(guardian_id,first_name) values($1,'New athlete') returning id",[NEW])).id
 day=(await one("select ((now() at time zone 'America/New_York')::date+14+((8-extract(isodow from now() at time zone 'America/New_York')::int)%7))::text as day")).day
 const at=time=>`${day} ${time} America/New_York`
 session=(await one("insert into sessions(program_id,start_at,duration_minutes,capacity,status) values($1,$2,60,10,'published') returning id",[program,at('17:00')])).id
 lateSession=(await one("insert into sessions(program_id,start_at,duration_minutes,capacity,status) values($1,now()+interval '5 hours',60,10,'published') returning id",[program])).id
 await t.test('service-role Stripe fulfillment remains idempotent and grants exact credits',async()=>{
  await actor('',async()=>{
   const first=(await fulfill(OLD,'cs_test_old',packageId)).rows[0].id
   const second=(await fulfill(OLD,'cs_test_old',packageId)).rows[0].id
   assert.equal(first,second)
  },'service_role')
  assert.equal((await one("select count(*)::int n from purchases where stripe_checkout_session_id='cs_test_old'")).n,1)
  assert.equal((await one('select credits_remaining from entitlements where guardian_id=$1',[OLD])).credits_remaining,5)
 })
 await t.test('pending family cannot bypass approval through actual legacy or V1.5 RPCs',async()=>{
  // Sign the actual waiver before testing approval, so waiver failures cannot
  // disguise a missing training gate. Legacy credit RPC is tested separately.
  await actor(NEW,()=>q("select sign_parent_waiver_v1('New Parent',false,'2026-01')"))
  await q('update profiles set credits=10 where id=$1',[NEW])
  // Simulate pre-existing access from a concurrent trusted setup path, then
  // restore pending state as the test owner. Clients cannot perform this setup.
  await q("update family_approvals set status='approved' where guardian_id=$1",[NEW])
  const ent=(await one("insert into entitlements(guardian_id,credit_type,credits_remaining) values($1,'group',5) returning id",[NEW])).id
  await q("update family_approvals set status='pending' where guardian_id=$1",[NEW])
  await actor(NEW,async()=>{
   await assert.rejects(q('select book_session($1,$2)',[session,newAthlete]),/Coach approval/)
   await assert.rejects(q('select book_session_v14($1,$2)',[session,newAthlete]),/Coach approval/)
   await assert.rejects(q('select book_session_v15($1,$2,$3)',[session,newAthlete,ent]),/Coach approval/)
   await assert.rejects(q('select fulfill_stripe_checkout_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[NEW,null,packageId,'fixture','group',5,false,null,'cs_forged','pi_forged',null,'cus_fixture',3500]),/permission denied/)
  })
  // Each rejected function must roll back its prior credit decrement.
  assert.equal((await one('select credits_remaining from entitlements where id=$1',[ent])).credits_remaining,5)
  assert.equal((await one('select credits from profiles where id=$1',[NEW])).credits,10)
  await actor('',()=>assert.rejects(fulfill(NEW,'cs_pending',packageId),/Coach approval/),'service_role')
  assert.equal((await one("select count(*)::int n from purchases where stripe_checkout_session_id='cs_pending'")).n,0)
 })
 let entitlement,booking
 await t.test('V1.5 waiver, explicit entitlement, credit consumption and cancellation refund survive',async()=>{
  entitlement=(await one('select id from entitlements where guardian_id=$1',[OLD])).id
  await actor(OLD,async()=>{
   await assert.rejects(q('select book_session_v15($1,$2,$3)',[session,athlete,entitlement]),/Participation Waiver/)
   await q("select sign_parent_waiver_v1('Existing Parent',false,'2026-01')")
   await assert.rejects(q('select book_session_v15($1,$2,$3)',[session,athlete,packageId]),/selected training access/)
   booking=(await one('select book_session_v15($1,$2,$3) id',[session,athlete,entitlement])).id
  })
  assert.equal((await one('select credits_remaining from entitlements where id=$1',[entitlement])).credits_remaining,4)
  await actor(OLD,()=>q('select cancel_booking_v14($1)',[booking]))
  assert.equal((await one('select credits_remaining from entitlements where id=$1',[entitlement])).credits_remaining,5)
 })
 await t.test('actual six-hour cancellation policy blocks changes without refunding credits',async()=>{
  const booked=await actor(OLD,()=>one('select book_session_v15($1,$2,$3) id',[lateSession,athlete,entitlement]))
  await actor(OLD,()=>assert.rejects(q('select cancel_booking_v14($1)',[booked.id]),/Cancellation window closed/))
  assert.equal((await one('select status from bookings where id=$1',[booked.id])).status,'booked')
  assert.equal((await one('select credits_remaining from entitlements where id=$1',[entitlement])).credits_remaining,4)
  await actor(COACH,()=>q('select admin_cancel_session($1)',[lateSession]))
  assert.equal((await one('select credits_remaining from entitlements where id=$1',[entitlement])).credits_remaining,5)
 })
 await t.test('coach dashboard can identify pending families without broadening profile RLS',async()=>{
  await actor(COACH,async()=>{
   assert.equal((await q('select * from profiles where id=$1',[NEW])).rows.length,0)
   const overview=(await one('select coach_intro_overview() data')).data
   assert.equal(overview.families.find(f=>f.guardian_id===NEW)?.family_name,'New family')
   await q("select save_intro_window('available',$1,$2)",[at('09:00'),at('16:00')])
  })
  await actor(NEW,()=>assert.rejects(q('select coach_intro_overview()'),/Coach access/))
  await actor('',()=>assert.rejects(q('select coach_intro_overview()'),/permission denied/),'anon')
 })
 await t.test('nullable legacy session duration reserves the default sixty minutes',async()=>{
  await q("insert into sessions(program_id,start_at,duration_minutes,status) values($1,$2,null,'published')",[program,at('10:00')])
  await actor(NEW,()=>assert.rejects(q('select book_intro($1,$2)',[COACH,at('10:20')]),/no longer available/))
  const call=await actor(NEW,()=>one('select book_intro($1,$2) id',[COACH,at('12:00')]))
  await assert.rejects(q("insert into sessions(program_id,start_at,duration_minutes,status) values($1,$2,null,'published')",[program,at('11:30')]),/overlaps/)
  await actor(COACH,async()=>{
   const overview=(await one('select coach_intro_overview() data')).data
   assert.equal(overview.calls.find(c=>c.id===call.id)?.family_name,'New family')
  })
  await actor(NEW,()=>q('select cancel_intro($1)',[call.id]))
 })
 await t.test('approved new family can use existing Stripe and V1.5 booking flows',async()=>{
  await actor(COACH,()=>q('select approve_family($1)',[NEW]))
  await actor('',()=>fulfill(NEW,'cs_approved',packageId),'service_role')
  await actor(NEW,()=>q('select book_session_v15($1,$2,null)',[session,newAthlete]))
 })
 await t.test('family-shared credits and athlete-specific unlimited access keep their scope',async()=>{
  const sibling=(await one("insert into athletes(guardian_id,first_name) values($1,'Sibling') returning id",[OLD])).id
  const member=(await one("insert into entitlements(guardian_id,athlete_id,package_id,credit_type,unlimited,credits_remaining) values($1,$2,$3,'group',true,0) returning id",[OLD,athlete,packageId])).id
  await actor(OLD,async()=>{
   await assert.rejects(q('select book_session_v15($1,$2,$3)',[session,sibling,member]),/selected training access/)
   await assert.rejects(q('select book_session_v15($1,$2,$3)',[session,newAthlete,entitlement]),/Athlete not found/)
   const shared=await one('select book_session_v15($1,$2,$3) id',[session,sibling,entitlement])
   await q('select cancel_booking_v14($1)',[shared.id])
   const specific=await one('select book_session_v15($1,$2,$3) id',[session,athlete,member])
   await q('select cancel_booking_v14($1)',[specific.id])
  })
  const result=await one('select unlimited,credits_remaining from entitlements where id=$1',[member])
  assert.equal(result.unlimited,true);assert.equal(result.credits_remaining,0)
 })
 await t.test('existing Stripe subscription and refund maintenance remains permitted',async()=>{
  await actor('',async()=>{
   await fulfill(OLD,'cs_subscription',packageId,athlete,true)
   await q("update entitlements set expires_at=now()+interval '30 days',cancel_at_period_end=true,cancellation_effective_at=now()+interval '30 days',updated_at=now() where stripe_subscription_id='sub_cs_subscription'")
   await q("update purchases set refund_status='partial',refunded_amount_cents=1000,refunded_at=now(),updated_at=now() where stripe_checkout_session_id='cs_subscription'")
  },'service_role')
  const membership=await one("select cancel_at_period_end,expires_at>now() active from entitlements where stripe_subscription_id='sub_cs_subscription'")
  assert.equal(membership.cancel_at_period_end,true);assert.equal(membership.active,true)
 })
 await t.test('limited promo allocation, duplicate delivery and sold-out handling survive',async()=>{
  const pkg=(await one("insert into packages(name,access_type,credit_type,purchase_limit) values('Limited','promotion','group',1) returning id")).id
  const args=[OLD,athlete,pkg,'Limited','group',null,'cs_limited','pi_limited',null,'cus_fixture',17500]
  const query='select fulfill_limited_promo_checkout_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id'
  await actor('',async()=>{
   const first=(await one(query,args)).id;assert.equal((await one(query,args)).id,first)
   await assert.rejects(q(query,[NEW,newAthlete,pkg,'Limited','group',null,'cs_soldout','pi_soldout',null,'cus_fixture',17500]),/PROMO_SOLD_OUT/)
  },'service_role')
  assert.equal((await one('select count(*)::int n from purchases where package_id=$1',[pkg])).n,1)
 })
 await db.close()
})
