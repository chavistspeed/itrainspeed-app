import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

let state
const pkg = { id: 'package-1', name: 'Off-Season Track & Field', active: true, credit_type: 'track', access_type: 'membership', price_cents: 17500, payment_type: 'subscription' }
class FakeStripe {
  constructor() {
    this.customers = { create: async () => { state.createdCustomers++; return { id: 'cus-1' } } }
    this.checkout = { sessions: { create: async (options) => { state.checkout = options; return { url: 'https://checkout.stripe.com/test' } } } }
  }
}
function createClient() {
  return {
    auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: 'guardian-1', email: 'parent@example.test' } : null } }) },
    from(table) {
      const filters = {}
      const query = {
        select() { return query }, eq(key, value) { filters[key] = value; return query }, update() { return query },
        single: async () => {
          if (table === 'packages') return { data: state.pkg }
          if (table === 'athletes') return { data: state.owned ? { id: 'athlete-1', guardian_id: 'guardian-1', first_name: 'Alex' } : null }
          if (table === 'profiles') return { data: { stripe_customer_id: 'cus-1', waiver_accepted_at: state.waiver ? '2026-01-01' : null, waiver_version: '2026-01' } }
        },
        then(resolve, reject) { return Promise.resolve({ data: state.lookupError ? null : state.entitlements, error: state.lookupError ? { message: 'lookup failed' } : null }).then(resolve, reject) },
      }
      return query
    },
  }
}
mock.module('stripe', { defaultExport: FakeStripe })
mock.module('@supabase/supabase-js', { namedExports: { createClient } })
const { POST } = await import('../app/api/stripe/create-checkout-session/route.js')
process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
function reset() { state = { authenticated: true, owned: true, waiver: true, pkg, entitlements: [], createdCustomers: 0 } }
function request(body = {}, authorized = true) {
  return new Request('https://app.example/api/stripe/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://app.example', ...(authorized ? { authorization: 'Bearer test-token' } : {}) }, body: JSON.stringify({ package_id: pkg.id, athlete_id: 'athlete-1', enrollment: 'off-season-track', ...body }) })
}

test('checkout uses server catalog pricing, athlete metadata, and program return paths', async () => {
  reset()
  const response = await POST(request({ price_cents: 1 }))
  assert.equal(response.status, 200)
  assert.equal(state.checkout.line_items[0].price_data.unit_amount, 17500)
  assert.equal(state.checkout.mode, 'subscription')
  assert.equal(state.checkout.metadata.athlete_id, 'athlete-1')
  assert.equal(state.checkout.success_url, 'https://app.example/enroll/off-season-track?athlete=athlete-1&checkout=success&session_id={CHECKOUT_SESSION_ID}')
  assert.equal(state.checkout.cancel_url, 'https://app.example/enroll/off-season-track?athlete=athlete-1&checkout=cancelled')
})

test('normal plans checkout retains original return URLs', async () => {
  reset(); await POST(request({ enrollment: undefined }))
  assert.equal(state.checkout.success_url, 'https://app.example/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}')
  assert.equal(state.checkout.cancel_url, 'https://app.example/plans?checkout=cancelled')
})

test('missing auth and foreign athletes cannot reach Stripe', async () => {
  reset(); assert.equal((await POST(request({}, false))).status, 401); assert.equal(state.checkout, undefined)
  reset(); state.authenticated = false; assert.equal((await POST(request())).status, 401); assert.equal(state.checkout, undefined)
  reset(); state.owned = false; assert.equal((await POST(request())).status, 403); assert.equal(state.checkout, undefined)
})

test('active membership including pending cancellation blocks duplicate checkout', async () => {
  reset(); state.entitlements = [{ id: 'ent-1', package_id: pkg.id, guardian_id: 'guardian-1', athlete_id: 'athlete-1', status: 'active', cancel_at_period_end: true }]
  const response = await POST(request())
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'ATHLETE_ALREADY_ENROLLED')
  assert.equal(state.checkout, undefined)
})

test('membership lookup failures and missing waiver block enrollment', async () => {
  reset(); state.lookupError = true; assert.equal((await POST(request())).status, 500); assert.equal(state.checkout, undefined)
  reset(); state.waiver = false; const response = await POST(request()); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'WAIVER_REQUIRED'); assert.equal(state.checkout, undefined)
})
