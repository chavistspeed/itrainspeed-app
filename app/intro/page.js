'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'
import { easternTime } from '../../lib/intro-time.mjs'
export default function Intro() {
  const [coaches,setCoaches]=useState([]), [coach,setCoach]=useState(''), [date,setDate]=useState('')
  const [slots,setSlots]=useState([]), [calls,setCalls]=useState([]), [msg,setMsg]=useState(''), [busy,setBusy]=useState(false)
  const [onboarding,setOnboarding]=useState(null)
  const [signedIn,setSignedIn]=useState(false), [ready,setReady]=useState(false)
  const upcomingCall = calls.find(c => c.status === 'booked' && new Date(c.start_at).getTime() > Date.now())
  const pendingCompletion=calls.find(c=>c.status==='booked'&&new Date(c.start_at).getTime()<=Date.now())
  async function refresh() {
    const s=supabase()
    if (!s) { setMsg('Service unavailable.'); setReady(true); return }
    const {data:{user}}=await s.auth.getUser()
    setSignedIn(Boolean(user))
    if(!user) { setReady(true); return }
    const results=await Promise.all([s.rpc('intro_coaches'),s.from('intro_calls').select('*').eq('guardian_id',user.id).order('start_at'),s.rpc('athlete_onboarding_status',{p_guardian_id:user.id})])
    const error=results.find(r=>r.error)?.error
    if(error) { setMsg(error.message); setReady(true); return }
    setOnboarding(results[2].data);setCoaches(results[0].data||[]);setCoach(c=>c||results[0].data?.[0]?.id||'');setCalls(results[1].data||[]);setReady(true)
  }
  useEffect(()=>{const reload=()=>refresh().catch(()=>{setMsg('Unable to load intro calls.');setReady(true)});reload();const timer=setInterval(reload,15000);window.addEventListener('focus',reload);return()=>{clearInterval(timer);window.removeEventListener('focus',reload)}},[])
  useEffect(()=>{
    let active=true;setSlots([])
    if(coach&&date&&!upcomingCall&&!pendingCompletion&&onboarding?.waiver_signed&&!onboarding?.intro_completed) supabase().rpc('intro_slots',{p_coach_id:coach,p_date:date}).then(({data,error})=>{
      if(active){setSlots(data||[]);if(error)setMsg(error.message)}
    })
    return ()=>{active=false}
  },[coach,date,busy,upcomingCall?.id,pendingCompletion?.id,onboarding?.waiver_signed,onboarding?.intro_completed])
  async function notify(id) {
    try {
      const {data:{session}}=await supabase().auth.getSession()
      const response=await fetch('/api/intro/notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token}`},body:JSON.stringify({call_id:id})})
      const result=await response.json()
      if(!response.ok||result.pending||result.review) return ' Your call is saved; email delivery is pending. Contact your coach if needed.'
      return ' Confirmation emails sent.'
    } catch { return ' Your call is saved; email delivery is pending.' }
  }
  async function change(action,args) {
    setBusy(true);setMsg('')
    try {
      const {data,error}=await supabase().rpc(action,args)
      if(error) throw error
      const id=action==='book_intro'?data:args.p_call_id
      if(action==='book_intro') {
        setCalls(current=>[...current,{id,coach_id:args.p_coach_id,start_at:args.p_start_at,status:'booked'}])
        setSlots([])
      } else {
        setCalls(current=>current.map(c=>c.id===id?{...c,status:'cancelled'}:c))
      }
      const confirmation=action==='book_intro'?'Your intro call is confirmed.':'Your intro call is cancelled.'
      setMsg(confirmation)
      await refresh()
      setMsg(confirmation+await notify(id))
    }catch(e){setMsg(e.message||'Unable to update your call.')}finally{setBusy(false)}
  }
  return <AppShell title="Intro Call"><section className="card"><h1>Meet your coach</h1>
    <p>Join Coach Chavis for a quick and engaging introduction call! During this session, we’ll explore your athlete’s current skill level, discuss their goals, and outline the results you’re aiming to achieve.</p>
    <p>Let’s kickstart their journey to success together!</p>
    <p role="status">{msg}</p>
    {!ready?<p>Loading…</p>:!signedIn?<Link href="/login">Sign in to schedule your call →</Link>:<>
      {!onboarding?.waiver_signed?<p><Link href="/waiver">Sign the participation waiver</Link> before scheduling your intro call.</p>:onboarding?.intro_completed&&!upcomingCall?<div className="card"><h2>Intro call completed</h2><p>You can now <Link href="/assessments">Schedule Assessment</Link>.</p></div>:pendingCompletion?<div className="card"><h2>Intro call awaiting coach completion</h2><p>Your call is recorded. Once your coach marks it completed, Schedule Assessment will be available here.</p></div>:upcomingCall ? <div className="card" role="status">
        <h2>You’re booked!</h2>
        <p>Your introduction call with {coaches.find(c=>c.id===upcomingCall.coach_id)?.full_name||'Coach Chavis'} is confirmed.</p>
        <p><strong>{easternTime(upcomingCall.start_at)}</strong></p>
        <p>You’re all set. We look forward to meeting you and learning about your athlete!</p>
        <button disabled={busy} onClick={()=>change('cancel_intro',{p_call_id:upcomingCall.id})}>Cancel intro call</button>
      </div> : <>
      <label>Coach<select value={coach} onChange={e=>setCoach(e.target.value)}>{coaches.map(c=><option value={c.id} key={c.id}>{c.full_name||'Coach'}</option>)}</select></label>
      <label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      {date&&!slots.length&&<p>No available times on this date. Try another date.</p>}
      <div className="introSlots">{slots.map(s=><button key={s.start_at} disabled={busy} onClick={()=>change('book_intro',{p_coach_id:coach,p_start_at:s.start_at})}>{easternTime(s.start_at)}</button>)}</div>
      </>}
      {calls.some(c=>c.id!==upcomingCall?.id)&&<h2>Your intro calls</h2>}{calls.filter(c=>c.id!==upcomingCall?.id).map(c=><div className="card" key={c.id}><p>{easternTime(c.start_at)} · {c.status}</p>
      {c.status==='booked'&&<button disabled={busy} onClick={()=>change('cancel_intro',{p_call_id:c.id})}>Cancel intro call</button>}</div>)}
      <p>Coach approval is required separately before training purchases and bookings.</p>
    </>}
  </section></AppShell>
}
