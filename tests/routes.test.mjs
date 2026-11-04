import {test,mock} from 'node:test'
import assert from 'node:assert/strict'
const USER='00000000-0000-0000-0000-000000000004',COACH='00000000-0000-0000-0000-000000000001',CALL='00000000-0000-0000-0000-000000000009'
let approved=false,approvalError=null,userId=USER,checkoutCount=0,smtpFail=false,sends=0
let jobs=[]
const appointment={id:CALL,guardian_id:USER,coach_id:COACH,start_at:'2026-11-06T17:00:00Z',status:'booked'}
class Query {
 constructor(table){this.table=table;this.filters=[];this.updateData=null}
 select(){return this} eq(k,v){this.filters.push([k,v,false]);return this} neq(k,v){this.filters.push([k,v,true]);return this}
 order(){return this} limit(){return this} update(value){this.updateData=value;return this}
 single(){return this.result(true)} maybeSingle(){return this.result(true)}
 async result(single=false){
  let rows=this.table==='intro_mail'?jobs:this.table==='intro_calls'?[appointment]:this.table==='profiles'?[{id:userId,role:'parent',stripe_customer_id:'cus_test'}]:this.table==='packages'?[{id:'pkg',active:true,credit_type:'group',access_type:'credits',price_cents:3500,payment_type:'one_time'}]:[]
  // The package and profile fixture IDs are selected by the production query;
  // only filter fields relevant to the route paths under test.
  if(['intro_mail','intro_calls'].includes(this.table))rows=rows.filter(r=>this.filters.every(([k,v,not])=>not?r[k]!==v:r[k]===v))
  if(this.updateData)for(const row of rows)Object.assign(row,this.updateData)
  return {data:single?rows[0]||null:rows,error:null}
 }
 then(a,b){return this.result().then(a,b)}
}
const admin={
 auth:{getUser:async(token)=>({data:{user:token==='valid'?{id:userId,email:'test@example.invalid'}:null},error:token==='valid'?null:new Error('unauthorized')}),admin:{getUserById:async(id)=>({data:{user:{id,email:`${id}@example.invalid`}},error:null})}},
 rpc:async()=>({data:approved,error:approvalError}),from:table=>new Query(table)
}
mock.module('@supabase/supabase-js',{namedExports:{createClient:()=>admin}})
mock.module('stripe',{defaultExport:class {
 customers={create:async()=>{throw new Error('unexpected customer creation')}}
 checkout={sessions:{create:async()=>{checkoutCount++;return {url:'https://checkout.example.invalid/test'}}}}
}})
mock.module('nodemailer',{defaultExport:{createTransport:()=>({sendMail:async()=>{sends++;if(smtpFail)throw new Error('SMTP uncertain')}})}})
const checkout=await import('../app/api/stripe/create-checkout-session/route.js')
const mail=await import('../app/api/intro/notifications/route.js')
Object.assign(process.env,{STRIPE_SECRET_KEY:'test-not-live',SUPABASE_SERVICE_ROLE_KEY:'fixture',NEXT_PUBLIC_SUPABASE_URL:'http://example.invalid',SMTP_HOST:'example.invalid',SMTP_USER:'test@example.invalid',SMTP_PASS:'fixture'})
const request=(body={},token='valid')=>new Request('http://example.invalid/test',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
test('Stripe checkout enforces approval before external payment actions',async t=>{
 await t.test('unauthenticated request is rejected',async()=>{assert.equal((await checkout.POST(request({},'invalid'))).status,401);assert.equal(checkoutCount,0)})
 await t.test('pending family is forbidden',async()=>{assert.equal((await checkout.POST(request({package_id:'pkg'}))).status,403);assert.equal(checkoutCount,0)})
 await t.test('approval lookup failure fails closed',async()=>{approvalError=new Error('unavailable');assert.equal((await checkout.POST(request({package_id:'pkg'}))).status,503);approvalError=null;assert.equal(checkoutCount,0)})
 await t.test('approved family retains existing checkout flow',async()=>{approved=true;const result=await checkout.POST(request({package_id:'pkg'}));assert.equal(result.status,200);assert.equal((await result.json()).url,'https://checkout.example.invalid/test');assert.equal(checkoutCount,1)})
})
test('intro confirmations use authorization and atomic per-recipient claims',async t=>{
 await t.test('invalid authentication and other family are rejected',async()=>{
  assert.equal((await mail.POST(request({call_id:CALL},'invalid'))).status,401)
  userId='00000000-0000-0000-0000-000000000005';assert.equal((await mail.POST(request({call_id:CALL}))).status,404);userId=USER
 })
 await t.test('two simultaneous processors send each recipient once',async()=>{
  jobs=[{id:'mail-1',call_id:CALL,kind:'booked',recipient:'family',state:'pending'},{id:'mail-2',call_id:CALL,kind:'booked',recipient:'coach',state:'pending'}];sends=0
  const results=await Promise.all([mail.POST(request({call_id:CALL})),mail.POST(request({call_id:CALL}))])
  assert.ok(results.every(r=>r.status===200));assert.equal(sends,2);assert.ok(jobs.every(j=>j.state==='sent'))
  await mail.POST(request({call_id:CALL}));assert.equal(sends,2)
 })
 await t.test('uncertain SMTP delivery remains claimed for review',async()=>{
  jobs=[{id:'mail-3',call_id:CALL,kind:'booked',recipient:'family',state:'pending'}];smtpFail=true
  const result=await (await mail.POST(request({call_id:CALL}))).json();assert.equal(result.review,1);assert.equal(jobs[0].state,'sending')
  const before=sends;await mail.POST(request({call_id:CALL}));assert.equal(sends,before);smtpFail=false
 })
 await t.test('cancelled call does not send a queued booking confirmation',async()=>{
  jobs=[{id:'mail-4',call_id:CALL,kind:'booked',recipient:'family',state:'pending'}];appointment.status='cancelled'
  const before=sends;await mail.POST(request({call_id:CALL}));assert.equal(sends,before);assert.equal(jobs[0].state,'sent')
 })
})
