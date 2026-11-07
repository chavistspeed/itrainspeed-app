export const MOVEMENT_SCALE = [
 [1,'Needs significant development'],[2,'Developing — frequent corrections needed'],
 [3,'Competent — occasional corrections'],[4,'Proficient — consistent execution'],[5,'Advanced — excellent execution'],
]
export const scoreOptions = Array.from({length:9},(_,i)=>1+i/2)
export function appointmentDate(value) {
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
}
export function appointmentTime(value) {
 return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
}
export function movementDraft(report,rubric) {
 const snapshot=report?.rubric_snapshot||{name:rubric.name,items:rubric.items}
 return {snapshot,expected_revision:report?.revision||0,assessed_on:report?.assessed_on||'',scores:snapshot.items.map(i=>({key:i.key,score:report?.scores.find(s=>s.key===i.key)?.score??null,notes:report?.scores.find(s=>s.key===i.key)?.notes||''})),observations:report?.observations||'',strengths:report?.strengths||'',priorities:report?.priorities||''}
}
export function groupRubric(items) {
 return [...new Set(items.map(i=>i.section))].map(section=>({section,items:items.filter(i=>i.section===section)}))
}
export function benchmarkLabel(test) {
 return ({'10m fly':'10m Fly','30-second run':'30-second Run','45-second run':'45-second Run','Standing broad jump':'Broad Jump','Vertical jump':'Vertical Jump','40-yard dash':'40-yard Dash','60-yard dash (baseball)':'60-yard Dash','5-10-5 shuttle':'5-10-5 Shuttle'})[test.name||test.test_name]||(test.name||test.test_name)
}
