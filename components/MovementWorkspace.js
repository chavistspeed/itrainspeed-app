'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import AppShell from './AppShell'
import PerformanceBenchmarks from './PerformanceBenchmarks'
import ExistingAthleteOnboarding from './ExistingAthleteOnboarding'
import {MovementReportView,MovementReportForm,RubricManager} from './MovementReport'
import {athleteDirectory,easternDate} from '../lib/performance.mjs'
import {appointmentTime,appointmentDate} from '../lib/movement.mjs'
import {supabase} from '../lib/supabase'

async function allRows(table,order='created_at') {
 const rows=[];for(let from=0;;from+=500){const {data,error}=await supabase().from(table).select('*').order(order).order('id').range(from,from+499);if(error)throw error;rows.push(...data);if(data.length<500)return rows}
}
export default function MovementWorkspace({coach=false}) {
 const [data,setData]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[view,setView]=useState('assessment')
 const [athlete,setAthlete]=useState(''),[status,setStatus]=useState(null),[coachId,setCoachId]=useState(''),[date,setDate]=useState(easternDate()),[times,setTimes]=useState([]),[rubricId,setRubricId]=useState('')
 const [reschedule,setReschedule]=useState(null),[editing,setEditing]=useState(null),[audit,setAudit]=useState(null)
 const [location,setLocation]=useState('iTrainSpeed')
 async function load(){
  const s=supabase();if(!s)throw new Error('App connection is unavailable.')
  const {data:{user},error}=await s.auth.getUser();if(error||!user)throw new Error('Please sign in to continue.')
  const {data:profile,error:pe}=await s.from('profiles').select('role').eq('id',user.id).single();if(pe)throw pe
  const staff=['coach','admin'].includes(profile?.role);if(coach&&!staff)throw new Error('Coach access required.')
  const responses=await Promise.all([s.from('movement_rubrics').select('*').order('created_at',{ascending:false}),s.rpc('intro_coaches'),coach?s.rpc('get_coach_athletes_v2'):s.from('athletes').select('*').eq('guardian_id',user.id),s.from('assessment_tests').select('*').order('name'),s.from('assessment_templates').select('*').order('name')])
  for(const r of responses)if(r.error)throw r.error
  const [rubrics,coaches,athleteRows,tests,templates]=responses.map(r=>r.data||[])
  const [slots,appointments,reports,results,onboardingHistory]=await Promise.all([allRows('assessment_slots','start_at'),allRows('assessment_appointments'),allRows('movement_reports'),allRows('assessment_results'),coach?allRows('onboarding_attestations','recorded_at'):Promise.resolve([])])
  const athletes=athleteDirectory(athleteRows)
  setData({rubrics,coaches,athletes,tests,templates,slots,appointments,reports,results,onboardingHistory,userId:user.id,loadedAt:Date.now()})
  setAthlete(old=>old&&athletes.some(a=>a.id===old)?old:athletes[0]?.id||'')
  setCoachId(old=>old||coaches.find(c=>c.id===user.id)?.id||coaches[0]?.id||'')
  setRubricId(old=>rubrics.some(r=>r.id===old&&r.active)?old:rubrics.find(r=>r.active)?.id||'')
 }
 useEffect(()=>{const refresh=()=>load().catch(e=>setMessage(e.message));refresh();if(coach)return;const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh)}},[coach])
 const selectedAthlete=data?.athletes.find(a=>a.id===athlete),guardian=selectedAthlete?.guardian_id||data?.userId
 useEffect(()=>{let active=true;setStatus(null);if(guardian)supabase().rpc('athlete_onboarding_status',{p_guardian_id:guardian,p_athlete_id:athlete||null}).then(({data,error})=>{if(active){if(error)setMessage(error.message);else setStatus(data)}});return()=>{active=false}},[guardian,athlete,data?.loadedAt])
 const eligible=Boolean(status?.waiver_signed&&status?.intro_completed)
 useEffect(()=>{let active=true;setTimes([]);if(view==='schedule'&&coachId&&date&&eligible)supabase().rpc('movement_assessment_slots',{p_coach_id:coachId,p_date:date,p_ignore_appointment_id:reschedule?.id||null}).then(({data,error})=>{if(active){if(error)setMessage(error.message);else setTimes(data||[])}});return()=>{active=false}},[view,coachId,date,eligible,reschedule?.id,data?.loadedAt])
 async function perform(domain,action,payload){
  if(busy)return null;setBusy(true);setMessage('')
  try{
   const {data:result,error}=await supabase().rpc(domain==='movement'?'manage_movement':'manage_assessment',{p_action:action,p_data:payload});if(error)throw error
   await load();setMessage('Saved.')
   const notifications=domain==='movement'?result?.notifications||[]:['cancel','save_results'].includes(action)?[result]:[]
   if(notifications.length){try{
    const {data:{session}}=await supabase().auth.getSession()
    for(const id of notifications){const response=await fetch('/api/assessments/notifications',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token}`},body:JSON.stringify({appointment_id:id})});const info=await response.json();if(!response.ok||info.pending||info.review)setMessage('Saved. Confirmation delivery is pending; your appointment is recorded below.')}
   }catch{setMessage('Saved. Confirmation delivery is pending; your appointment is recorded below.')}}
   return result
  }catch(e){setMessage(e.message||'Unable to save.');return null}finally{setBusy(false)}
 }
 async function recordExisting(step,completed,completedOn,note){
  if(busy||!athlete)return;setBusy(true);setMessage('')
  try{const {error}=await supabase().rpc('record_existing_onboarding',{p_athlete_id:athlete,p_step:step,p_completed:completed,p_completed_on:completedOn,p_note:note});if(error)throw error;await load();setMessage('Onboarding updated.')}catch(e){setMessage(e.message||'Unable to update onboarding.')}finally{setBusy(false)}
 }
 function scheduleExisting(a){const s=data.slots.find(s=>s.id===a.slot_id);setAthlete(a.athlete_id);setReschedule({...a,rubric_id:s.rubric_id});setCoachId(s.coach_id);setLocation(s.location);setDate(appointmentDate(s.start_at));setRubricId(s.rubric_id);setView('schedule');setEditing(null)}
 function editReport(a){setAthlete(a.athlete_id);const slot=data.slots.find(s=>s.id===a.slot_id);setEditing({appointment:a,slot,rubric:data.rubrics.find(r=>r.id===slot.rubric_id),report:data.reports.find(r=>r.appointment_id===a.id)});setView('assessment')}
 async function revisions(report){const {data:rows,error}=await supabase().from('movement_report_revisions').select('*').eq('report_id',report.id).order('revision',{ascending:false});if(error)setMessage(error.message);else setAudit({id:report.id,rows})}
 const appointments=data?.appointments.filter(a=>a.athlete_id===athlete)||[]
 return <AppShell title={coach?'Coach Control Center':'Athlete Hub'}><h1>{coach?'Assessments & Athlete Progress':'Athlete Hub'}</h1>
  <p><Link href={coach?'/coach':'/athletes'}>{coach?'Back to Coach Control Center':'Manage athlete profiles'}</Link></p>
  <p role="status" aria-live="polite">{message}</p>
  {!data?<p>{message?<Link href="/login">Sign in</Link>:'Loading…'}</p>:<>
   <label>Athlete<select value={athlete} onChange={e=>{setAthlete(e.target.value);setReschedule(null);setEditing(null);setAudit(null)}}><option value="">Choose athlete</option>{data.athletes.map(a=><option key={a.id} value={a.id}>{a.first_name} {a.last_name||''}</option>)}</select></label>
   {!data.athletes.length&&<p>Add an athlete profile before scheduling or recording results.</p>}
   <nav className="assessmentTabs" aria-label="Athlete Hub sections">{[['schedule','Schedule Assessment'],['assessment','Athlete Assessment'],['progress','Athlete Progress'],...(coach?[['templates','Manage Templates']]:[])].map(([key,label])=><button key={key} type="button" aria-pressed={view===key} onClick={()=>{setView(key);if(key!=='schedule')setReschedule(null)}}>{label}</button>)}</nav>
   {coach&&athlete&&status&&<ExistingAthleteOnboarding key={athlete} status={status} history={data.onboardingHistory.filter(r=>r.guardian_id===guardian&&(r.step==='intro'||r.athlete_id===athlete))} busy={busy} onSave={recordExisting}/>}
   {!coach&&status&&<section className="notice"><b>Your athlete’s next step</b><p>{!status.waiver_signed?<Link href="/waiver">Sign the participation waiver</Link>:!status.intro_completed?<Link href="/intro">Schedule your intro call, then your coach will mark it completed</Link>:!status.movement_completed?'Schedule an Initial Movement Assessment or view your upcoming appointment.':'View Athlete Assessment for movement observations and Athlete Progress for performance benchmarks.'}</p></section>}
   {view==='schedule'&&<section className="card"><h2>Schedule Assessment</h2><p>Initial Movement Assessment · 45 minutes</p>
    {!eligible&&<p>{!status?'Checking onboarding…':!status.waiver_signed?'The parent must sign the participation waiver before scheduling.':'Your coach must mark the intro call completed before an assessment can be scheduled.'}</p>}
    {reschedule&&<p>Rescheduling the appointment below. The original stays booked unless the new time is saved successfully. <button type="button" onClick={()=>setReschedule(null)}>Stop rescheduling</button></p>}
    <div className="form2"><label>Coach<select value={coachId} onChange={e=>setCoachId(e.target.value)}>{data.coaches.map(c=><option key={c.id} value={c.id}>{c.full_name||'Coach'}</option>)}</select></label><label>Date<input type="date" min={easternDate()} value={date} onChange={e=>setDate(e.target.value)}/></label></div>
    <p className="subtle">Monday–Saturday, 9 AM–4 PM. Times are shown in Eastern.</p>
    {coach&&<><label>Movement rubric<select value={rubricId} onChange={e=>setRubricId(e.target.value)}>{data.rubrics.filter(r=>r.active||r.id===reschedule?.rubric_id).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Location<input maxLength={300} value={location} onChange={e=>setLocation(e.target.value)}/></label></>}
    {eligible&&!rubricId&&<p>Your coach needs to activate a movement rubric before appointments can be booked.</p>}
    {eligible&&date&&!times.length&&<p>No available times on this date. Try another date.</p>}
    <div className="introSlots">{times.map(s=><button key={s.start_at} disabled={busy||!athlete||!rubricId} onClick={async()=>{const saved=await perform('movement',reschedule?'reschedule':'book',{id:reschedule?.id,athlete_id:athlete,coach_id:coachId,start_at:s.start_at,rubric_id:rubricId,location});if(saved){setReschedule(null);setView('assessment')}}}>{appointmentTime(s.start_at)}</button>)}</div>
    {coach&&<p><Link href="/coach/intro">Manage vacation, sick-day and other blocked times</Link></p>}
   </section>}
   {(view==='assessment'||view==='schedule')&&<section className="card"><h2>{coach?'Assessment appointments':'Athlete Assessment'}</h2>
    {status?.assessment_previously_completed&&<p>Your coach has recorded the Initial Movement Assessment as previously completed. View Athlete Progress for ongoing performance results.</p>}
    {!appointments.length&&!status?.assessment_previously_completed&&<p>No assessments scheduled yet.</p>}
    {appointments.map(a=>{const slot=data.slots.find(s=>s.id===a.slot_id);if(!slot)return null;const movement=Boolean(slot.rubric_id),report=data.reports.find(r=>r.appointment_id===a.id),name=data.athletes.find(x=>x.id===a.athlete_id);return <article className="card compact" key={a.id}>
     <h3>{name?.first_name} {name?.last_name||''}</h3><p>{movement?'Initial Movement Assessment':'Earlier performance appointment'} · {appointmentTime(slot.start_at)} · {slot.location} · {a.status.replace('_','-')}</p>
     {a.rescheduled_from&&<p>Rescheduled appointment</p>}
     {a.status==='booked'&&<div className="inlineActions"><button disabled={busy} onClick={()=>perform(movement?'movement':'benchmark','cancel',{id:a.id})}>Cancel</button>{coach&&movement&&<><button disabled={busy||new Date(slot.start_at)<=new Date()} onClick={()=>scheduleExisting(a)}>Reschedule</button><button disabled={busy||new Date(slot.end_at)>new Date()} onClick={()=>perform('movement','status',{id:a.id,status:'completed'})}>Mark completed</button><button disabled={busy||new Date(slot.end_at)>new Date()} onClick={()=>perform('movement','status',{id:a.id,status:'no_show'})}>Mark no-show</button></>}</div>}
     {coach&&movement&&['booked','completed'].includes(a.status)&&<button disabled={busy||new Date(slot.start_at)>new Date()} onClick={()=>editReport(a)}>{report?'Edit assessment results':'Enter assessment results'}</button>}
     {report&&<><MovementReportView report={report}/>{coach&&<button disabled={busy} onClick={()=>revisions(report)}>View edit history</button>}</>}
     {audit?.id===report?.id&&audit?.rows&&<details open><summary>Saved assessment revisions</summary>{audit.rows.map(r=><p key={r.revision}>Revision {r.revision} · {appointmentTime(r.changed_at)} · {r.snapshot.observations||'No overall observations'} · {r.snapshot.scores.filter(s=>s.score!=null).map(s=>`${s.key}: ${s.score}`).join(', ')}</p>)}</details>}
    </article>})}
   </section>}
   {editing&&view==='assessment'&&<MovementReportForm key={editing.appointment.id} {...editing} busy={busy} onClose={()=>setEditing(null)} onSave={payload=>perform('movement','save_report',payload)}/>}
   {view==='progress'&&<PerformanceBenchmarks key={athlete} coach={coach} athlete={athlete} data={data} perform={perform} busy={busy}/>}
   {coach&&view==='templates'&&<><RubricManager rubrics={data.rubrics} perform={perform} busy={busy}/><p>Performance test templates are managed under Athlete Progress → Performance Benchmarks.</p><Link href="/coach/intro">Manage calendar exceptions and intro calls</Link></>}
  </>}
 </AppShell>
}
