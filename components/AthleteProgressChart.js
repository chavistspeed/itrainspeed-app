'use client'
import {useEffect,useId,useRef,useState} from 'react'
import {summarize} from '../lib/performance.mjs'
import {seriesKey,progressChart,chartDate} from '../lib/performance-chart.mjs'

export default function AthleteProgressChart({results}) {
 const groups=summarize(results),[testKey,setTestKey]=useState(''),[resultId,setResultId]=useState('')
 const [width,setWidth]=useState(320),container=useRef(null),id=useId()
 useEffect(()=>{
  if(!container.current)return
  const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,entry.contentRect.width)))
  observer.observe(container.current);return ()=>observer.disconnect()
 },[groups.length>0])
 if(!groups.length)return <p>No measurements to graph yet. Your coach’s saved results will appear here.</p>
 const group=groups.find(g=>seriesKey(g)===testKey)||groups[0]
 const chart=progressChart(group.rows,width),selected=group.rows.find(r=>r.id===resultId)||group.latest
 const format=value=>Number(value).toLocaleString('en-US',{maximumSignificantDigits:5})
 const select=point=>setResultId(point.id)
 return <section className="athleteProgress" aria-labelledby={`${id}-heading`}>
  <h3 id={`${id}-heading`}>Progress over time</h3>
  <label htmlFor={`${id}-test`}>Test<select id={`${id}-test`} value={seriesKey(group)} onChange={e=>{setTestKey(e.target.value);setResultId('')}}>{groups.map(g=><option key={seriesKey(g)} value={seriesKey(g)}>{g.latest.test_name} ({g.latest.unit}) — {g.latest.protocol}</option>)}</select></label>
  <p>{group.latest.direction==='lower'?(group.latest.unit==='s'?'Lower is faster':'Lower is better'):'Higher is better'}. Tap a result or choose a dated entry to read coaching notes.</p>
  <div className="progressStats">
   <p>Baseline<strong>{format(group.baseline.value)} {group.baseline.unit}</strong><span>{chartDate(group.baseline.tested_at)}</span></p>
   <p>Latest<strong>{format(group.latest.value)} {group.latest.unit}</strong><span>{chartDate(group.latest.tested_at)}</span></p>
   <p>Personal best<strong>{format(group.best.value)} {group.best.unit}</strong><span>{chartDate(group.best.tested_at)}</span></p>
  </div>
  <div ref={container}>
   <svg width="100%" height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} role="group" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>{`${group.latest.test_name} progression (${group.latest.unit})`}</title>
    <desc id={`${id}-desc`}>{group.rows.length} dated results. Dashed horizontal line marks the first measured benchmark. Select a point for notes; all readings are also available in the dated result selector below.</desc>
    {chart.yTicks.map(t=><g key={t.value}><line x1={chart.left} x2={chart.right} y1={t.y} y2={t.y} stroke="#dde1e7"/><text x={chart.left-8} y={t.y+4} textAnchor="end" fontSize="12" fill="currentColor">{format(t.value)}</text></g>)}
    <text x={chart.left} y="15" fontSize="12" fill="currentColor">Result ({group.latest.unit})</text>
    <line x1={chart.left} x2={chart.right} y1={chart.y(+group.baseline.value)} y2={chart.y(+group.baseline.value)} stroke="#687384" strokeDasharray="5 4"/>
    <path d={chart.path} fill="none" stroke="#e5484d" strokeWidth="2.5"/>
    {chart.points.map(p=><g key={p.id}>
     <circle cx={p.x} cy={p.y} r={p.id===group.baseline.id?7:5} fill={p.id===group.baseline.id?'#15171a':'#e5484d'} stroke="white" strokeWidth="2"/>
     {p.id===selected.id&&<circle cx={p.x} cy={p.y} r="11" fill="none" stroke="#15171a" strokeWidth="1.5"/>}
     <circle className="progressPoint" cx={p.x} cy={p.y} r="18" fill="transparent" tabIndex="0" role="button" aria-pressed={p.id===selected.id} aria-label={`${chartDate(p.tested_at)}: ${format(p.value)} ${p.unit}${p.id===group.baseline.id?', baseline':''}`} onClick={()=>select(p)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(p)}}}><title>{`${chartDate(p.tested_at)}: ${format(p.value)} ${p.unit}`}</title></circle>
    </g>)}
    {chart.xTicks.map((t,i)=><text key={t.date} x={t.x} y={chart.bottom+24} textAnchor={chart.xTicks.length===1?'middle':i===0?'start':i===chart.xTicks.length-1?'end':'middle'} fontSize="12" fill="currentColor">{chartDate(t.date).replace(/, \d{4}$/,'')}</text>)}
    <text x={(chart.left+chart.right)/2} y="274" textAnchor="middle" fontSize="12" fill="currentColor">Testing date</text>
   </svg>
  </div>
  <p className="progressLegend">Dashed line: baseline · Filled points: actual measurements</p>
  {group.rows.length===1&&<p>One result recorded. Your progress line will grow as your coach adds measurements.</p>}
  <label htmlFor={`${id}-result`}>Dated result<select id={`${id}-result`} value={selected.id} onChange={e=>setResultId(e.target.value)}>{group.rows.map(r=><option key={r.id} value={r.id}>{chartDate(r.tested_at)} — {format(r.value)} {r.unit} · Performance test</option>)}</select></label>
  <div className="progressDetail" aria-live="polite"><strong>{chartDate(selected.tested_at)} · {format(selected.value)} {selected.unit}</strong><p>{selected.notes||'No additional coaching notes for this result.'}</p><p>Protocol: {selected.protocol}</p></div>
 </section>
}
