import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { timingSafeEqual } from 'node:crypto'
import { easternTime } from '../../../../lib/intro-time.mjs'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
function sameSecret(a,b) {
  return Boolean(a&&b&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b)))
}
export async function POST(request) {
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||''
  const cron=sameSecret(token,process.env.ASSESSMENT_MAIL_CRON_SECRET)
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key)return Response.json({error:'Email service is not configured.'},{status:503})
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  try {
    let callId
    if(!cron){
      const {data:{user},error}=await admin.auth.getUser(token)
      if(error||!user)return Response.json({error:'Sign in required.'},{status:401})
      const body=await request.json();callId=body.appointment_id
      if(typeof callId!=='string'||!/^[-0-9a-f]{36}$/i.test(callId))return Response.json({error:'A valid appointment ID is required.'},{status:400})
      const [{data:call,error:callError},{data:profile}]=await Promise.all([
        admin.from('assessment_appointments').select('guardian_id,assessment_slots(coach_id)').eq('id',callId).maybeSingle(),
        admin.from('profiles').select('role').eq('id',user.id).maybeSingle()
      ])
      if(callError)throw callError
      if(!call||(call.guardian_id!==user.id&& !(['coach','admin'].includes(profile?.role))))return Response.json({error:'Assessment not found.'},{status:404})
    }
    if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return Response.json({error:'Email delivery is pending configuration.'},{status:503})
    let query=admin.from('assessment_mail').select('*').eq('state','pending').order('id').limit(50)
    if(callId)query=query.eq('appointment_id',callId)
    const {data:jobs,error}=await query;if(error)throw error
    const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:465,secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})
    let sent=0,review=0
    for(const job of jobs||[]){
      // Compare-and-set is atomic: competing requests cannot both claim a job.
      const {data:claimed,error:claimError}=await admin.from('assessment_mail').update({state:'sending',claimed_at:new Date().toISOString()}).eq('id',job.id).eq('state','pending').select('id')
      if(claimError)throw claimError
      if(!claimed?.length)continue
      try {
        const {data:call,error:lookupError}=await admin.from('assessment_appointments').select('*,assessment_slots(*)').eq('id',job.appointment_id).single()
        if(lookupError)throw lookupError
        const recipientId=job.recipient==='family'?call.guardian_id:call.assessment_slots.coach_id
        const {data:{user},error:userError}=await admin.auth.admin.getUserById(recipientId)
        if(userError||!user?.email)throw new Error('Recipient email unavailable')
        // A cancellation can race a queued booking email; never send a stale
        // booking confirmation after cancellation has already been persisted.
        if(job.kind==='booked'&&call.status!=='booked'){
          const {error:skipError}=await admin.from('assessment_mail').update({state:'sent',sent_at:new Date().toISOString()}).eq('id',job.id).eq('state','sending')
          if(skipError)throw skipError
          continue
        }
        const state=job.kind==='booked'?'confirmed':job.kind==='completed'?'completed':'cancelled'
        const text=`Your iTrainSpeed athlete assessment is ${state}.\n\n${easternTime(call.assessment_slots.start_at)}\nLocation: ${call.assessment_slots.location}\nTime zone: America/New_York\n\nAssessment cost: $0. No training credits deducted. View appointments and progress in Athlete Hub.`
        await transporter.sendMail({from:`"iTrainSpeed" <${process.env.SMTP_USER}>`,to:user.email,subject:`iTrainSpeed assessment ${job.kind}`,text,messageId:`<assessment-${job.id}@itrainspeed.com>`})
        const {error:saveError}=await admin.from('assessment_mail').update({state:'sent',sent_at:new Date().toISOString()}).eq('id',job.id).eq('state','sending')
        if(saveError)throw saveError
        sent++
      }catch(e){
        // SMTP cannot promise exactly-once delivery. Leave uncertain sends
        // claimed for operator review instead of automatically duplicating mail.
        review++;console.error('Assessment email needs review',job.id,e.message)
      }
    }
    let remaining=admin.from('assessment_mail').select('state').neq('state','sent')
    if(callId)remaining=remaining.eq('appointment_id',callId)
    const {data:unsent,error:remainingError}=await remaining;if(remainingError)throw remainingError
    return Response.json({sent,pending:(unsent||[]).filter(j=>j.state==='pending').length,review:Math.max(review,(unsent||[]).filter(j=>j.state==='sending').length)})
  }catch(e){
    console.error('Assessment notification processing failed',e.message)
    return Response.json({error:'Unable to process confirmations.'},{status:500})
  }
}
