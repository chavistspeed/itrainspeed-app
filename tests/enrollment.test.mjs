import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACK_ENROLLMENT_PATH, isOffSeasonTrack, currentMembership, bookingUrl, enrollmentReturn, checkoutReturnPaths } from '../lib/enrollment.mjs'

const pkg = { id: 'track-package', name: 'Off-Season Track & Field', credit_type: 'track', access_type: 'membership' }
const entitlement = { id: 'access-1', package_id: pkg.id, athlete_id: 'athlete-1', status: 'active', unlimited: true }

test('resolves only the existing off-season track membership', () => {
  assert.ok(isOffSeasonTrack(pkg))
  assert.equal(isOffSeasonTrack({ ...pkg, name: 'Other Track Program' }), false)
  assert.equal(isOffSeasonTrack({ ...pkg, credit_type: 'group' }), false)
  assert.equal(isOffSeasonTrack({ ...pkg, access_type: 'credits' }), false)
})

test('detects the selected athlete membership including scheduled cancellations', () => {
  assert.equal(currentMembership([entitlement], pkg.id, 'athlete-1'), entitlement)
  assert.equal(currentMembership([entitlement], pkg.id, 'sibling'), undefined)
  assert.equal(currentMembership([entitlement], 'different-package', 'athlete-1'), undefined)
  const cancelling = { ...entitlement, cancel_at_period_end: true, expires_at: '2030-01-01' }
  assert.equal(currentMembership([cancelling], pkg.id, 'athlete-1', Date.parse('2026-11-07')), cancelling)
})

test('expired and inactive memberships do not grant access', () => {
  for (const change of [{ status: 'cancelled' }, { expires_at: '2020-01-01' }, { expires_at: 'invalid' }]) {
    assert.equal(currentMembership([{ ...entitlement, ...change }], pkg.id, 'athlete-1'), undefined)
  }
})

test('booking keeps the athlete and exact track entitlement', () => {
  const url = new URL(bookingUrl(entitlement), 'https://example.com')
  assert.equal(url.pathname, '/booking')
  assert.equal(url.searchParams.get('type'), 'track')
  assert.equal(url.searchParams.get('athlete'), entitlement.athlete_id)
  assert.equal(url.searchParams.get('entitlement'), entitlement.id)
})

test('login return preserves program and athlete without accepting external destinations', () => {
  const next = `${TRACK_ENROLLMENT_PATH}?athlete=athlete-1&checkout=success`
  assert.equal(enrollmentReturn(new URLSearchParams({ next }).toString()), next)
  for (const next of ['https://evil.example/enroll/off-season-track', '//evil.example', '/coach', 'http://[', '/enroll/off-season-track/../../coach', '\\\\evil.example']) {
    assert.equal(enrollmentReturn(new URLSearchParams({ next }).toString()), '/dashboard')
  }
  assert.equal(enrollmentReturn(''), '/dashboard')
})

test('checkout returns only to the selected program; normal plans retain existing behavior', () => {
  assert.deepEqual(checkoutReturnPaths(pkg, 'off-season-track', 'athlete-1'), {
    success: `${TRACK_ENROLLMENT_PATH}?athlete=athlete-1&checkout=success`,
    cancel: `${TRACK_ENROLLMENT_PATH}?athlete=athlete-1&checkout=cancelled`,
  })
  for (const args of [[pkg, undefined], [{ ...pkg, name: 'Other' }, 'off-season-track'], [pkg, 'https://evil.example']]) {
    assert.deepEqual(checkoutReturnPaths(...args), { success: '/plans?checkout=success', cancel: '/plans?checkout=cancelled' })
  }
})
