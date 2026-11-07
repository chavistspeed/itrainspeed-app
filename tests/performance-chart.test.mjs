import test from 'node:test'
import assert from 'node:assert/strict'
import {progressChart,chartDate,seriesKey} from '../lib/performance-chart.mjs'
import {summarize} from '../lib/performance.mjs'
const row=(id,date,value,extra={})=>({id,test_id:'fly',tested_at:date,value,created_at:date,protocol:'Flying start',unit:'s',direction:'lower',...extra})
test('date axis preserves irregular testing intervals rather than equal spacing',()=>{
 const c=progressChart([row('a','2026-10-01',1.2),row('b','2026-10-02',1.1),row('c','2026-10-11',1.15)],600)
 assert.ok(Math.abs((c.points[1].x-c.points[0].x)/(c.points[2].x-c.points[0].x)-.1)<1e-8)
 assert.ok(c.points[1].y>c.points[0].y,'a faster time moves downward')
 for(const p of c.points){assert.ok(p.x>=c.left&&p.x<=c.right);assert.ok(p.y>c.top&&p.y<c.bottom)}
})
test('single or flat results and same-day observations remain finite and selectable',()=>{
 for(const rows of [[row('a','2026-11-01',1.2)],[row('a','2026-11-01',1.2),row('b','2026-11-01',1.2)]]){
  const c=progressChart(rows,280);assert.equal(c.points.length,rows.length);assert.equal(c.xTicks.length,1)
  for(const p of c.points){assert.ok(Number.isFinite(p.x));assert.ok(Number.isFinite(p.y))}
 }
 assert.equal(progressChart([]),null)
})
test('chart selection keeps incompatible units/protocols separate and excludes corrections',()=>{
 const groups=summarize([row('a','2026-11-01',1.2),row('b','2026-11-02',1.1,{voided_at:'now'}),row('c','2026-11-03',2,{unit:'ms'}),row('d','2026-11-04',2,{protocol:'Standing'})])
 assert.equal(new Set(groups.map(seriesKey)).size,3);assert.equal(progressChart(groups[0].rows).points.length,1)
 assert.equal(chartDate('2026-01-01'),'Jan 1, 2026')
})
test('mobile chart limits date labels while retaining all observations',()=>{
 const rows=Array.from({length:30},(_,i)=>row(String(i),`2026-11-${String(i+1).padStart(2,'0')}`,100+i))
 const c=progressChart(rows,280);assert.equal(c.xTicks.length,2);assert.equal(c.points.length,30)
 assert.equal(c.xTicks[0].date,'2026-11-01');assert.equal(c.xTicks.at(-1).date,'2026-11-30')
})
