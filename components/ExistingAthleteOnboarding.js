'use client'
import {useState} from 'react'
import {easternDate} from '../lib/performance.mjs'
export default function ExistingAthleteOnboarding({status,history=[],busy,onSave}){
 const [date,setDate]=useState(''),[note,setNote]=useState('')
 return <section className="card"><h2>Existing athlete onboarding</h2>
  <p>Record steps completed before using the app. No appointment or test scores will be created. Intro completion applies to the whole family; assessment completion applies only to the selected athlete.</p>
  <p>Intro call: {status.intro_completed?'Completed':'Not completed'} · Initial Movement Assessment: {status.movement_completed?'Completed':'Not completed'}</p>
  <label>Previous completion date (optional)<input type="date" max={easternDate()} value={date} onChange={e=>setDate(e.target.value)}/></label>
  <label>Coach note (optional)<textarea maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
  <div className="inlineActions">{[['intro','intro call','intro_completed','intro_previously_completed'],['assessment','assessment','movement_completed','assessment_previously_completed']].map(([step,label,done,previous])=><div key={step}>
   {!status[done]&&<button disabled={busy} onClick={()=>onSave(step,true,date||null,note)}>Mark {label} previously completed</button>}
   {status[previous]&&<button disabled={busy} onClick={()=>onSave(step,false,null,note)}>Undo previous {label} completion</button>}
  </div>)}</div>
  {history.length>0&&<details><summary>Previous completion history</summary>{[...history].reverse().map(row=><p key={row.id}>{row.step==='intro'?'Family intro call':'Athlete assessment'}: {row.completed?'Recorded as previously completed':'Previous completion undone'}{row.completed_on?` · Completed ${row.completed_on}`:''} · Recorded {new Date(row.recorded_at).toLocaleString()}{row.note?` · ${row.note}`:''}</p>)}</details>}
  <p className="subtle">Changes are recorded in coach history. Waiver signing and training approval remain separate.</p>
 </section>
}
