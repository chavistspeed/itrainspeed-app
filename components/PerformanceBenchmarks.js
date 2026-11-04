'use client'
import {useState} from 'react'
import AthleteProgressChart from './AthleteProgressChart'
import {summarize,easternDate} from '../lib/performance.mjs'
import {benchmarkLabel} from '../lib/movement.mjs'
export default function PerformanceBenchmarks({coach,athlete,data,perform,busy}) {
 const [values,setValues]=useState({}),[date,setDate]=useState(easternDate()),[notes,setNotes]=useState(''),[entryId,setEntryId]=useState(null)
 const [selectedTemplate,setSelectedTemplate]=useState('')
 const [test,setTest]=useState({name:'',unit:'s',direction:'lower',protocol:''}),[template,setTemplate]=useState({name:'',test_ids:[]})
 const history=data.results.filter(r=>r.athlete_id===athlete)
 const display=history.map(r=>({...r,test_name:benchmarkLabel(r)}))
 function edit(id,value){setValues({...values,[id]:value});setEntryId(null)}
 return <><section className="card"><h2>Athlete Progress</h2><p>Performance results measure improvement throughout coaching. Movement rubric scores stay in Athlete Assessment.</p>
  <AthleteProgressChart key={athlete} results={display}/>
  <h2>Performance Benchmarks</h2>{!history.length&&<p>No performance benchmarks recorded yet.</p>}
  {summarize(display).map(g=><article className="card compact" key={g.latest.test_id}><h3>{g.latest.test_name}</h3><p>{g.latest.protocol}</p><p>Baseline: {g.baseline.value} {g.baseline.unit} ({g.baseline.tested_at}) · Latest: {g.latest.value} {g.latest.unit} ({g.latest.tested_at})</p><p>Personal best: <b>{g.best.value} {g.best.unit}</b> · {g.percent>=0?'+':''}{g.percent.toFixed(1)}% improvement from baseline</p><details><summary>Historical results & coaching notes</summary><ul>{g.rows.map(r=><li key={r.id}>{r.tested_at}: {r.value} {r.unit} — {r.notes||'No additional notes'}{coach&&<button disabled={busy} onClick={()=>{const reason=prompt('Reason for correcting this result:');if(reason)perform('benchmark','void_result',{id:r.id,reason})}}>Void for correction</button>}</li>)}</ul></details></article>)}
  {coach&&history.some(r=>r.voided_at)&&<details><summary>Correction audit</summary>{history.filter(r=>r.voided_at).map(r=><p key={r.id}>{r.tested_at} · {r.test_name}: {r.value} {r.unit} — {r.void_reason}</p>)}</details>}
 </section>
 {coach&&<><section className="card"><h2>Record performance benchmarks</h2><p>No assessment appointment is needed. Enter only the tests used; results are visible to the parent when saved.</p><form onSubmit={async e=>{e.preventDefault();const entry_id=entryId||crypto.randomUUID();setEntryId(entry_id);if(await perform('benchmark','save_training_results',{entry_id,athlete_id:athlete,tested_at:date,results:Object.entries(values).filter(([,v])=>v!=='').map(([test_id,value])=>({test_id,value:Number(value),notes}))})){setValues({});setNotes('');setEntryId(null)}}}><fieldset disabled={busy}><legend>Test results</legend>
  <label>Test date<input required type="date" max={easternDate()} value={date} onChange={e=>{setDate(e.target.value);setEntryId(null)}}/></label>
  <label>Use a test template<select value={selectedTemplate} onChange={e=>{setSelectedTemplate(e.target.value);const selected=data.templates.find(t=>t.id===e.target.value);if(selected)setValues(Object.fromEntries(selected.test_ids.map(id=>[id,values[id]||''])));setEntryId(null)}}><option value="">All active tests</option>{data.templates.filter(t=>t.active).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  {data.tests.filter(t=>t.active&&(!selectedTemplate||data.templates.find(x=>x.id===selectedTemplate)?.test_ids.includes(t.id))).map(t=><label key={t.id}>{benchmarkLabel(t)} ({t.unit})<p>{t.protocol}</p><input type="number" step="any" min="0.000001" placeholder="Leave blank if not tested" value={values[t.id]||''} onChange={e=>edit(t.id,e.target.value)}/></label>)}
  <label>Coaching and testing notes<textarea maxLength={2000} value={notes} onChange={e=>{setNotes(e.target.value);setEntryId(null)}}/></label><button disabled={!athlete||!Object.values(values).some(v=>v!=='')}>Save performance results</button>
 </fieldset></form></section>
 <section className="card"><h2>Performance test library</h2><p>Add tests without changing code. A new unit or protocol needs a new definition so historical results remain comparable.</p>
  {data.tests.map(t=><details key={t.id}><summary>{benchmarkLabel(t)} ({t.unit}) · {t.active?'Active':'Archived'}</summary><p>{t.protocol}</p>{t.active&&<button disabled={busy} onClick={()=>perform('benchmark','archive_test',{id:t.id})}>Archive test</button>}</details>)}
  <form onSubmit={async e=>{e.preventDefault();if(await perform('benchmark','create_test',test))setTest({name:'',unit:'s',direction:'lower',protocol:''})}}><fieldset disabled={busy}><legend>Add performance test</legend>
  {[['name','Test name',120],['unit','Unit',30]].map(([key,label,max])=><label key={key}>{label}<input required maxLength={max} value={test[key]} onChange={e=>setTest({...test,[key]:e.target.value})}/></label>)}<label>Improvement direction<select value={test.direction} onChange={e=>setTest({...test,direction:e.target.value})}><option value="lower">Lower is better</option><option value="higher">Higher is better</option></select></label><label>Testing protocol<textarea required maxLength={2000} value={test.protocol} onChange={e=>setTest({...test,protocol:e.target.value})}/></label><button>Add test</button></fieldset></form>
 </section>
 <section className="card"><h2>Performance test templates</h2>{data.templates.map(t=><p key={t.id}>{t.name} · {t.test_ids.length} tests · {t.active?'Active':'Archived'} {t.active&&<button disabled={busy} onClick={()=>perform('benchmark','archive_template',{id:t.id})}>Archive template</button>}</p>)}
  <form onSubmit={async e=>{e.preventDefault();if(await perform('benchmark','create_template',template))setTemplate({name:'',test_ids:[]})}}><fieldset disabled={busy}><legend>Create test template</legend><label>Template name<input required maxLength={120} value={template.name} onChange={e=>setTemplate({...template,name:e.target.value})}/></label>{data.tests.filter(t=>t.active).map(t=><label className="check" key={t.id}><input type="checkbox" checked={template.test_ids.includes(t.id)} onChange={e=>setTemplate({...template,test_ids:e.target.checked?[...template.test_ids,t.id]:template.test_ids.filter(id=>id!==t.id)})}/>{benchmarkLabel(t)}</label>)}<button disabled={!template.test_ids.length}>Create template</button></fieldset></form>
 </section></>}
 </>
}
