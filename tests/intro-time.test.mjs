import test from 'node:test'
import assert from 'node:assert/strict'
import {easternInstant,easternTime} from '../lib/intro-time.mjs'
test('Eastern wall times respect DST independent of the device zone',()=>{
 assert.equal(easternInstant('2026-11-06','12:00'),'2026-11-06T17:00:00.000Z')
 assert.equal(easternInstant('2027-07-06','12:00'),'2027-07-06T16:00:00.000Z')
 assert.equal(easternInstant('2027-03-13','09:00'),'2027-03-13T14:00:00.000Z')
 assert.equal(easternInstant('2027-03-15','09:00'),'2027-03-15T13:00:00.000Z')
 assert.match(easternTime('2026-11-06T17:00:00Z'),/12:00/)
 assert.throws(()=>easternInstant('2026-11-06','08:00'))
})
