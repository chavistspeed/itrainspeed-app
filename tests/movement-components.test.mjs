import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {loadComponent} from './helpers/load-component.mjs'
const {MovementReportForm,MovementReportView}=loadComponent(new URL('../components/MovementReport.js',import.meta.url).pathname)
const Benchmarks=loadComponent(new URL('../components/PerformanceBenchmarks.js',import.meta.url).pathname).default
const rubric={name:'Initial Movement Assessment',items:[{key:'jump',section:'Dynamic Warm-Up',drill:'Jump Rope',dosage:'2 min'},{key:'wall',section:'Sprint Mechanics',drill:'Wall Drill',dosage:'2 x 10 reps'}]}
const report={id:'r',revision:2,rubric_snapshot:rubric,scores:[{key:'jump',score:2.5,notes:'Improved rhythm'}],assessed_on:'2026-11-04',observations:'Athlete moves with more control',strengths:'Effort and focus',priorities:'Single-leg balance'}
test('movement form renders saved half-points, unscored drills and all coaching fields',()=>{
 const html=renderToStaticMarkup(createElement(MovementReportForm,{report,rubric,appointment:{id:'fixture'},slot:{start_at:'2026-11-04T14:00:00Z'},onSave:()=>{},onClose:()=>{},busy:false}))
 assert.match(html,/<option value="2.5" selected="">2.5 \/ 5/)
 for(const word of ['Not scored','Overall observations','Strengths','Development priorities','Improved rhythm','Wall Drill'])assert.ok(html.includes(word),word)
 assert.ok(!html.includes('Save performance results'))
})
test('parent movement report shows quality scores and notes without inventing a quantitative benchmark',()=>{
 const html=renderToStaticMarkup(createElement(MovementReportView,{report}))
 for(const word of ['2.5 / 5','Not scored','Single-leg balance','Initial Movement Assessment'])assert.ok(html.includes(word),word)
 assert.ok(!html.includes('Personal best'))
})
test('performance view renders benchmarks and graph separately with first measurement baseline',()=>{
 const data={tests:[],templates:[],results:[{id:'x',athlete_id:'athlete',test_id:'fly',test_name:'10m Fly',unit:'s',protocol:'Flying start',direction:'lower',value:1.2,tested_at:'2026-11-01',created_at:'2026-11-01'},{id:'y',athlete_id:'athlete',test_id:'fly',test_name:'10m Fly',unit:'s',protocol:'Flying start',direction:'lower',value:1.1,tested_at:'2026-11-04',created_at:'2026-11-04'}]}
 const html=renderToStaticMarkup(createElement(Benchmarks,{coach:false,athlete:'athlete',data,perform:()=>{},busy:false}))
 for(const word of ['Athlete Progress','Performance Benchmarks','Progress over time','Lower is faster','Personal best'])assert.ok(html.includes(word),word)
 assert.ok(!html.includes('Overall observations'));assert.ok(!html.includes('2.5 / 5'))
})
