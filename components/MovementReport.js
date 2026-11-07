'use client'
import {useState} from 'react'
import {MOVEMENT_SCALE,scoreOptions,movementDraft,groupRubric,appointmentDate} from '../lib/movement.mjs'
import {easternDate} from '../lib/performance.mjs'
export function MovementReportView({report}) {
 return <article className="card"><h3>{report.rubric_snapshot.name}</h3><p>{report.assessed_on} · Revision {report.revision}</p>
  {groupRubric(report.rubric_snapshot.items).map(group=><section key={group.section}><h4>{group.section}</h4><dl>{group.items.map(item=>{const score=report.scores.find(s=>s.key===item.key);return <div className="movementDrill" key={item.key}><dt><b>{item.drill}</b>{item.dosage&&` · ${item.dosage}`}</dt><dd>{score?.score!=null?`${score.score} / 5`:'Not scored'}{score?.notes&&<p>{score.notes}</p>}</dd></div>})}</dl></section>)}
  <h4>Overall observations</h4><p>{report.observations||'No observations recorded.'}</p><h4>Strengths</h4><p>{report.strengths||'No strengths recorded.'}</p><h4>Development priorities</h4><p>{report.priorities||'No priorities recorded.'}</p>
 </article>
}
export function MovementReportForm({report,rubric,appointment,slot,onSave,onClose,busy}) {
 const [draft,setDraft]=useState(()=>{const d=movementDraft(report,rubric);return {...d,assessed_on:d.assessed_on||appointmentDate(slot.start_at)}})
 function score(key,field,value){setDraft(d=>({...d,scores:d.scores.map(s=>s.key===key?{...s,[field]:value}:s)}))}
 return <section className="card"><h2>{report?'Edit Athlete Assessment':'Enter Athlete Assessment'}</h2>
  <p>Score movement quality from 1–5. Half-points are allowed. Leave untested drills unscored. Saved observations are visible to the parent.</p>
  <details><summary>Scoring guide</summary><ul>{MOVEMENT_SCALE.map(([value,label])=><li key={value}>{value}: {label}</li>)}</ul></details>
  <form onSubmit={async e=>{e.preventDefault();if(await onSave({...draft,appointment_id:appointment.id}))onClose()}}>
   <fieldset disabled={busy}><legend>{draft.snapshot.name}</legend>
   <label>Assessment date<input type="date" required max={easternDate()} value={draft.assessed_on} onChange={e=>setDraft({...draft,assessed_on:e.target.value})}/></label>
   {groupRubric(draft.snapshot.items).map(group=><section key={group.section}><h3>{group.section}</h3>{group.items.map(item=>{const value=draft.scores.find(s=>s.key===item.key);return <div className="movementDrill" key={item.key}><b>{item.drill}</b>{item.dosage&&<p>{item.dosage}</p>}<div className="form2"><label>{item.drill} score<select value={value.score??''} onChange={e=>score(item.key,'score',e.target.value===''?null:Number(e.target.value))}><option value="">Not scored</option>{scoreOptions.map(n=><option key={n} value={n}>{n} / 5</option>)}</select></label><label>Drill notes<textarea maxLength={2000} value={value.notes} onChange={e=>score(item.key,'notes',e.target.value)}/></label></div></div>})}</section>)}
   {[['observations','Overall observations'],['strengths','Strengths'],['priorities','Development priorities']].map(([key,label])=><label key={key}>{label}<textarea rows="3" maxLength={5000} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}
   <button type="submit">Save assessment</button> <button type="button" className="secondary" onClick={onClose}>Close editor</button>
   </fieldset>
  </form>
 </section>
}
export function RubricManager({rubrics,perform,busy}) {
 const [draft,setDraft]=useState({name:'',items:[],supersedes:null})
 function change(key,field,value){setDraft(d=>({...d,items:d.items.map(i=>i.key===key?{...i,[field]:value}:i)}))}
 function clone(r){setDraft({name:r.name,items:r.items.map(i=>({...i})),supersedes:r.id})}
 return <section className="card"><h2>Movement assessment templates</h2><p>Customize sections, drills and repetitions. Editing creates a new version; completed reports retain their original rubric.</p>
  {rubrics.map(r=><div className="card compact" key={r.id}><b>{r.name}</b><p>{r.items.length} drills · {r.active?'Active':'Archived'}</p><button disabled={busy} onClick={()=>clone(r)}>{r.active?'Edit as new version':'Use as a starting point'}</button>{r.active&&<button disabled={busy} onClick={()=>perform('movement','archive_rubric',{id:r.id})}>Archive</button>}</div>)}
  <form onSubmit={async e=>{e.preventDefault();if(await perform('movement','create_rubric',draft))setDraft({name:'',items:[],supersedes:null})}}><fieldset disabled={busy}><legend>{draft.supersedes?'Revise rubric':'Create rubric'}</legend>
   <label>Template name<input required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   {draft.items.map((item,index)=><div className="movementDrill" key={item.key}><div className="form2">{[['section','Section'],['drill','Drill'],['dosage','Reps / duration']].map(([key,label])=><label key={key}>{label}<input required={key!=='dosage'} maxLength={120} value={item[key]} onChange={e=>change(item.key,key,e.target.value)}/></label>)}</div><button type="button" className="secondary" onClick={()=>setDraft({...draft,items:draft.items.filter((_,i)=>i!==index)})}>Remove drill</button></div>)}
   <button type="button" disabled={draft.items.length>=60} onClick={()=>setDraft({...draft,items:[...draft.items,{key:crypto.randomUUID(),section:'',drill:'',dosage:''}]})}>Add drill</button> <button disabled={!draft.items.length||busy}>Save template version</button>
  </fieldset></form>
 </section>
}
