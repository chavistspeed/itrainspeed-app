// Compare only an immutable test definition, unit and protocol. Never mix test variants.
export function summarize(results) {
 const groups = new Map()
 for (const r of results.filter(r => !r.voided_at)) {
  const key = JSON.stringify([r.test_id,r.unit,r.protocol,r.direction])
  if (!groups.has(key)) groups.set(key,[])
  groups.get(key).push(r)
 }
 return [...groups.values()].map(rows => {
  rows.sort((a,b)=>a.tested_at.localeCompare(b.tested_at)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))
  const baseline=rows[0],latest=rows.at(-1)
  const best=rows.reduce((a,b)=>(latest.direction==='lower'?+b.value<+a.value:+b.value>+a.value)?b:a)
  const improvement=(+latest.value-+baseline.value)*(latest.direction==='lower'?-1:1)
  return {baseline,latest,best,improvement,percent:improvement/+baseline.value*100,rows}
 })
}
export const easternDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
// Assessment times may be any coach-selected Eastern time; intro-call hours stay unchanged.
export function assessmentInstant(date,time) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))throw new Error('Choose a date and time.')
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number)
 if(h>23||min>59)throw new Error('Choose a valid time.')
 const wall=Date.UTC(y,m-1,d,h,min)
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
 const matches=[4,5].map(offset=>wall+offset*3600000).filter(instant=>{
  const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(p=>[p.type,p.value]))
  return `${p.year}-${p.month}-${p.day}`===date&&`${p.hour}:${p.minute}`===time
 })
 if(matches.length!==1)throw new Error('Choose a time outside the daylight-saving clock change.')
 return new Date(matches[0]).toISOString()
}
// Parent table rows and the released coach directory RPC name their IDs differently.
export function athleteDirectory(rows) {
 return rows.map(row=>({...row,id:row.id||row.athlete_id}))
}
