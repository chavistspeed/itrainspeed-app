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
  const cron=sameSecret(token,process.env.INTRO_MAIL_CRON_SECRET)
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key)return Response.json({error:'Email service is not configured.'},{status:503})
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  try {
    let callId
    if(!cron){
      const {data:{user},error}=await admin.auth.getUser(token)
      if(error||!user)return Response.json({error:'Sign in required.'},{status:401})
      const body=await request.json();callId=body.call_id
      if(typeof callId!=='string'||!/^[-0-9a-f]{36}$/i.test(callId))return Response.json({error:'A valid call ID is required.'},{status:400})
      const [{data:call,error:callError},{data:profile}]=await Promise.all([
        admin.from('intro_calls').select('guardian_id,coach_id').eq('id',callId).maybeSingle(),
        admin.from('profiles').select('role').eq('id',user.id).maybeSingle()
      ])
      if(callError)throw callError
      if(!call||(call.guardian_id!==user.id&& !(['coach','admin'].includes(profile?.role)&&call.coach_id===user.id)))return Response.json({error:'Call not found.'},{status:404})
    }
    if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return Response.json({error:'Email delivery is pending configuration.'},{status:503})
    let query=admin.from('intro_mail').select('*').eq('state','pending').order('id').limit(50)
    if(callId)query=query.eq('call_id',callId)
    const {data:jobs,error}=await query;if(error)throw error
    const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:465,secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})
    let sent=0,review=0
    for(const job of jobs||[]){
      // Compare-and-set is atomic: competing requests cannot both claim a job.
      const {data:claimed,error:claimError}=await admin.from('intro_mail').update({state:'sending',claimed_at:new Date().toISOString()}).eq('id',job.id).eq('state','pending').select('id')
      if(claimError)throw claimError
      if(!claimed?.length)continue
      try {
        const {data:call,error:lookupError}=await admin.from('intro_calls').select('*').eq('id',job.call_id).single()
        if(lookupError)throw lookupError
        const recipientId=job.recipient==='family'?call.guardian_id:call.coach_id
        const {data:{user},error:userError}=await admin.auth.admin.getUserById(recipientId)
        if(userError||!user?.email)throw new Error('Recipient email unavailable')
        // A cancellation can race a queued booking email; never send a stale
        // booking confirmation after cancellation has already been persisted.
        if(job.kind==='booked'&&call.status!=='booked'){
          const {error:skipError}=await admin.from('intro_mail').update({state:'sent',sent_at:new Date().toISOString()}).eq('id',job.id).eq('state','sending')
          if(skipError)throw skipError
          continue
        }
        const text=`Your iTrainSpeed 20-minute intro call is ${job.kind==='booked'?'confirmed':'cancelled'}.\n\n${easternTime(call.start_at)}\nTime zone: America/New_York\n\nYou can view your intro calls in the iTrainSpeed app. Training approval is a separate coach decision.`
        await transporter.sendMail({from:`"iTrainSpeed" <${process.env.SMTP_USER}>`,to:user.email,subject:`iTrainSpeed intro call ${job.kind==='booked'?'confirmed':'cancelled'}`,text,messageId:`<intro-${job.id}@itrainspeed.com>`})
        const {error:saveError}=await admin.from('intro_mail').update({state:'sent',sent_at:new Date().toISOString()}).eq('id',job.id).eq('state','sending')
        if(saveError)throw saveError
        sent++
      }catch(e){
        // SMTP cannot promise exactly-once delivery. Leave uncertain sends
        // claimed for operator review instead of automatically duplicating mail.
        review++;console.error('Intro email needs review',job.id,e.message)
      }
    }
    let remaining=admin.from('intro_mail').select('state').neq('state','sent')
    if(callId)remaining=remaining.eq('call_id',callId)
    const {data:unsent,error:remainingError}=await remaining;if(remainingError)throw remainingError
    return Response.json({sent,pending:(unsent||[]).filter(j=>j.state==='pending').length,review:Math.max(review,(unsent||[]).filter(j=>j.state==='sending').length)})
  }catch(e){
    console.error('Intro notification processing failed',e.message)
    return Response.json({error:'Unable to process confirmations.'},{status:500})
  }
}
