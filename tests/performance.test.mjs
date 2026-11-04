import test from 'node:test'
import assert from 'node:assert/strict'
import {summarize,assessmentInstant,athleteDirectory} from '../lib/performance.mjs'
const row=(id,value,date='2026-11-01',extra={})=>({id,test_id:'fly',value,tested_at:date,created_at:date,unit:'s',protocol:'flying',direction:'lower',...extra})
test('time PB, dated baseline and direction-aware improvement',()=>{
 const [g]=summarize([row('2',1.1,'2026-11-29'),row('1',1.2)])
 assert.equal(g.baseline.value,1.2);assert.equal(g.best.value,1.1);assert.ok(Math.abs(g.percent-8.333333)<0.00001)
})
test('distance PB; protocol, unit and test variants remain separate; voided excluded',()=>{
 const r=[row('1',10,undefined,{direction:'higher'}),row('2',12,'2026-11-29',{direction:'higher'}),row('3',100,undefined,{voided_at:'now'}),row('4',3,undefined,{unit:'m'}),row('5',4,undefined,{protocol:'standing'})]
 const groups=summarize(r);assert.equal(groups.length,3);assert.equal(groups[0].best.value,12);assert.equal(groups[0].percent,20)
})
test('performance baseline is the first measured benchmark, separate from movement assessment',()=>{
 const [g]=summarize([row('1',1.3,'2026-10-01'),row('2',1.2,'2026-10-05',{appointment_id:'initial'}),row('3',1.1,'2026-10-12'),row('4',1.15,'2026-10-19')])
 assert.equal(g.baseline.id,'1');assert.equal(g.latest.id,'4');assert.equal(g.best.id,'3');assert.equal(g.rows.length,4)
 assert.ok(Math.abs(g.percent-11.5384615)<0.00001)
})
test('tests introduced during coaching use their first measurement as the reference',()=>{
 const [g]=summarize([row('1',1.2),row('2',1.1,'2026-11-08')])
 assert.equal(g.baseline.id,'1');assert.equal(g.baseline.appointment_id,undefined)
})

test('Eastern conversion supports evening blockouts and rejects clock-change ambiguity',()=>{
 assert.equal(assessmentInstant('2026-11-10','18:30'),'2026-11-10T23:30:00.000Z')
 assert.equal(assessmentInstant('2026-07-10','18:30'),'2026-07-10T22:30:00.000Z')
 assert.throws(()=>assessmentInstant('2026-03-08','02:30'),/clock change/)
 assert.throws(()=>assessmentInstant('2026-11-01','01:30'),/clock change/)
 assert.throws(()=>assessmentInstant('2026-02-30','09:00'))
})

test('coach RPC athlete_id and parent table id select the same athlete for result entry',()=>{
 const coach=athleteDirectory([{athlete_id:'athlete-fixture',first_name:'Fixture',guardian_id:'family-fixture'}])
 const parent=athleteDirectory([{id:'athlete-fixture',first_name:'Fixture',guardian_id:'family-fixture'}])
 assert.equal(coach[0].id,parent[0].id);assert.equal(coach[0].guardian_id,'family-fixture')
 assert.equal(coach.find(a=>a.id==='athlete-fixture').first_name,'Fixture')
})
