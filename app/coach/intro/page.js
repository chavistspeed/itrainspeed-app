'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import AppShell from '../../../components/AppShell'
import {supabase} from '../../../lib/supabase'
import {assessmentInstant} from '../../../lib/performance.mjs'
import {appointmentTime} from '../../../lib/movement.mjs'
export default function CoachIntro(){
 const [allowed,setAllowed]=useState(false),[windows,setWindows]=useState([]),[calls,setCalls]=useState([]),[families,setFamilies]=useState([])
 const [msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[date,setDate]=useState(''),[endDate,setEndDate]=useState(''),[start,setStart]=useState('09:00'),[end,setEnd]=useState('16:00')
 async function load(){const s=supabase();if(!s)return;const {data:{user}}=await s.auth.getUser();if(!user)return;const {data:p}=await s.from('profiles').select('role').eq('id',user.id).single();if(!['coach','admin'].includes(p?.role))return;const {data,error}=await s.rpc('coach_intro_overview');if(error)throw error;setAllowed(true);setWindows((data.windows||[]).filter(w=>w.kind==='blocked'));setCalls(data.calls||[]);setFamilies(data.families||[])}
 useEffect(()=>{load().catch(e=>setMsg(e.message||'Unable to load calendar.'))},[])
 async function flush(id){const {data:{session}}=await supabase().auth.getSession();const response=await fetch('/api/intro/notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token}`},body:JSON.stringify({call_id:id})});const result=await response.json();setMsg(response.ok&&!result.review&&!result.pending?'Saved. Confirmation processing complete.':'Saved. Email delivery is pending or needs review.')}
 async function act(name,args){if(busy)return;setBusy(true);setMsg('');try{const {error}=await supabase().rpc(name,args);if(error)throw error;await load();setMsg('Saved.');if(name==='cancel_intro')await flush(args.p_call_id)}catch(e){setMsg(e.message||'Unable to save.')}finally{setBusy(false)}}
 function save(e){e.preventDefault();try{act('save_intro_window',{p_kind:'blocked',p_start_at:assessmentInstant(date,start),p_end_at:assessmentInstant(endDate||date,end)})}catch(e){setMsg(e.message)}}
 return <AppShell title="Coach Calendar"><p><Link href="/coach">Back to Coach Control Center</Link> · <Link href="/coach/assessments">Athlete assessments</Link></p><p role="status">{msg}</p>
 {!allowed?<p>Coach access required.</p>:<>
 <section className="card"><h1>Calendar exceptions</h1><p>Standing availability is Monday–Saturday, 9 AM–4 PM. You do not need to publish recurring availability. Add blocks for vacation, sick time or other exceptions. Reschedule or cancel conflicting appointments before blocking their time.</p>
 <form onSubmit={save}><fieldset disabled={busy}><legend>Block unavailable time</legend><div className="form2"><label>From date<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Through date (optional)<input type="date" min={date} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label><label>Start<input required type="time" value={start} onChange={e=>setStart(e.target.value)}/></label><label>End<input required type="time" value={end} onChange={e=>setEnd(e.target.value)}/></label></div><p className="subtle">Times use the iTrainSpeed schedule in Eastern. A single block can span up to 31 days.</p><button>Save block</button></fieldset></form>
 {windows.map(w=><div className="card compact" key={w.id}><p>{appointmentTime(w.start_at)} – {appointmentTime(w.end_at)}</p><button disabled={busy} onClick={()=>act('delete_intro_window',{p_window_id:w.id})}>Remove block</button></div>)}</section>
 <section className="card"><h2>Intro calls</h2><p>After a call ends, mark it completed to unlock that family’s assessment calendar. Training approval remains a separate coach decision.</p>
 {calls.map(c=><div className="card compact" key={c.id}><p>{c.family_name||'Family'} · {appointmentTime(c.start_at)} · {c.status.replace('_','-')}</p>{c.status==='booked'&&<><button disabled={busy||new Date(c.end_at)>new Date()} onClick={()=>act('set_intro_call_status',{p_call_id:c.id,p_status:'completed'})}>Mark completed</button><button disabled={busy||new Date(c.end_at)>new Date()} onClick={()=>act('set_intro_call_status',{p_call_id:c.id,p_status:'no_show'})}>Mark no-show</button><button disabled={busy} onClick={()=>act('cancel_intro',{p_call_id:c.id})}>Cancel call</button></>}<button disabled={busy} onClick={()=>flush(c.id).catch(()=>setMsg('Email processing unavailable.'))}>Send pending confirmations</button></div>)}</section>
 <section className="card"><h2>Families awaiting training approval</h2><p>Approve when you decide a family is ready for training. Assessment scheduling requires a completed intro call; completing the intro does not approve training.</p>{families.map(f=><div className="card compact" key={f.guardian_id}><p>{f.family_name||'Family'}</p><button disabled={busy} onClick={()=>act('approve_family',{p_guardian_id:f.guardian_id})}>Approve training access</button></div>)}</section>
 </>}
 </AppShell>
}
