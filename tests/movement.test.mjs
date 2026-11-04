import test from 'node:test'
import assert from 'node:assert/strict'
import {movementDraft,groupRubric,scoreOptions,appointmentDate,appointmentTime,benchmarkLabel} from '../lib/movement.mjs'
import {summarize} from '../lib/performance.mjs'
test('editing uses the saved movement snapshot, not a newly revised rubric',()=>{
 const original=[{key:'jump',section:'Warm-Up',drill:'Jump Rope',dosage:'2 min'}]
 const report={revision:2,rubric_snapshot:{name:'Original',items:original},scores:[{key:'jump',score:2.5,notes:'Rhythm'}],assessed_on:'2026-11-04',observations:'Review',strengths:'Effort',priorities:'Coordination'}
 const draft=movementDraft(report,{name:'New',items:[{key:'other'}]})
 assert.equal(draft.snapshot.name,'Original');assert.deepEqual(draft.scores,report.scores);assert.equal(draft.expected_revision,2)
 draft.scores[0].notes='Changed locally';assert.equal(report.scores[0].notes,'Rhythm')
})
test('unscored drills remain blank rather than becoming zero or sample scores',()=>{
 const d=movementDraft(null,{name:'Rubric',items:[{key:'jump',section:'Warm-Up',drill:'Jump Rope'}]})
 assert.equal(d.scores[0].score,null);assert.equal(d.expected_revision,0);assert.deepEqual(scoreOptions,[1,1.5,2,2.5,3,3.5,4,4.5,5])
})
test('sections preserve order and repeated drill entries independently',()=>{
 const groups=groupRubric([{key:'first',section:'Body',drill:'Load Leg'},{key:'second',section:'Body',drill:'Load Leg'},{key:'third',section:'Other',drill:'Coordination'}])
 assert.equal(groups.length,2);assert.equal(groups[0].items.length,2);assert.notEqual(groups[0].items[0].key,groups[0].items[1].key)
})
test('appointment displays use business time zone independently of parent device zone',()=>{
 assert.equal(appointmentDate('2026-11-05T01:00:00Z'),'2026-11-04')
 assert.match(appointmentTime('2026-11-04T14:00:00Z'),/9:00 AM/)
 assert.equal(benchmarkLabel({name:'60-yard dash (baseball)'}),'60-yard Dash')
})
test('performance comparisons do not interpret movement appointment IDs as a special baseline',()=>{
 const base={test_id:'fly',unit:'s',protocol:'Flying',direction:'lower'}
 const [g]=summarize([{...base,id:'first',tested_at:'2026-10-01',created_at:'2026-10-01',value:1.2},{...base,id:'legacy',appointment_id:'old-performance-appointment',tested_at:'2026-10-05',created_at:'2026-10-05',value:1.1}])
 assert.equal(g.baseline.id,'first');assert.equal(g.best.id,'legacy')
})
