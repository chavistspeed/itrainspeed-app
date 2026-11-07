'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '../../../components/AppShell'
import { supabase } from '../../../lib/supabase'
import { TRACK_ENROLLMENT_PATH, isOffSeasonTrack, currentMembership, bookingUrl } from '../../../lib/enrollment.mjs'

function Enrollment() {
  const router = useRouter()
  const params = useSearchParams()
  const requestedAthlete = params.get('athlete') || ''
  const checkout = params.get('checkout')
  const [data, setData] = useState(null)
  const [athleteId, setAthleteId] = useState(requestedAthlete)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [waiting, setWaiting] = useState(checkout === 'success')

  const returnPath = TRACK_ENROLLMENT_PATH + (athleteId ? `?${new URLSearchParams({ athlete: athleteId })}` : '')
  const membership = data && currentMembership(data.entitlements, data.pkg?.id, athleteId)
  const waiverComplete = data?.profile?.waiver_accepted_at && data.profile.waiver_version === '2026-01'

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = supabase()
        if (!s) throw new Error('Unable to connect. Please try again later.')
        const { data: { user }, error: authError } = await s.auth.getUser()
        if (authError || !user) {
          const next = TRACK_ENROLLMENT_PATH + (params.toString() ? `?${params}` : '')
          router.replace(`/login?${new URLSearchParams({ next })}`)
          return
        }
        const results = await Promise.all([
          s.from('packages').select('*').eq('active', true).eq('name', 'Off-Season Track & Field'),
          s.from('athletes').select('*').eq('guardian_id', user.id).order('first_name'),
          s.from('entitlements').select('*').eq('guardian_id', user.id).eq('status', 'active'),
          s.from('profiles').select('id,full_name,waiver_accepted_at,waiver_version').eq('id', user.id).single(),
        ])
        if (results.some((result) => result.error)) throw new Error('We could not verify your program, profile, and membership. Please retry before purchasing.')
        const [packages, athletes, entitlements, profile] = results.map((result) => result.data)
        const matches = packages.filter(isOffSeasonTrack)
        if (cancelled) return
        setData({ pkg: matches.length === 1 ? matches[0] : null, athletes, entitlements, profile })
        setAthleteId((current) => athletes.some((a) => a.id === current) ? current : athletes.length === 1 ? athletes[0].id : '')
        setError('')
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load enrollment. Please retry.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [params, router, refresh])

  // Stripe's return is not proof of access. Wait for the existing webhook to grant it.
  useEffect(() => {
    if (checkout !== 'success' || membership) { setWaiting(false); return }
    setWaiting(true)
    const poll = setInterval(() => setRefresh((value) => value + 1), 3000)
    const timeout = setTimeout(() => { clearInterval(poll); setWaiting(false) }, 60000)
    return () => { clearInterval(poll); clearTimeout(timeout) }
  }, [checkout, membership?.id])

  async function purchase() {
    if (busy || error || !data?.pkg || !athleteId || membership || !waiverComplete || checkout === 'success') return
    setBusy(true)
    setError('')
    try {
      const { data: { session } } = await supabase().auth.getSession()
      if (!session?.access_token) {
        router.replace(`/login?${new URLSearchParams({ next: returnPath })}`)
        return
      }
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ package_id: data.pkg.id, athlete_id: athleteId, enrollment: 'off-season-track' }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (result.code === 'ATHLETE_ALREADY_ENROLLED') setRefresh((value) => value + 1)
        throw new Error(result.error || 'Unable to start checkout.')
      }
      if (!result.url) throw new Error('Checkout did not return a URL. Please retry.')
      window.location.assign(result.url)
    } catch (err) { setError(err.message || 'Unable to start checkout.') }
    finally { setBusy(false) }
  }

  return <AppShell title="Off-Season Track & Field">
    <h1>Off-Season Track &amp; Field</h1>
    <p>Returning families: select your athlete, enroll, and book eligible track training. No new intro call or initial assessment is required.</p>
    {error && <div className="notice" role="alert">{error} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
    {!data && !error && <p role="status">Checking your program and membership...</p>}
    {data && <>
      <label>Athlete<select value={athleteId} disabled={busy} onChange={(event) => {
        setAthleteId(event.target.value)
        // Keep athlete identity on reload and checkout return; discard old checkout notices.
        router.replace(TRACK_ENROLLMENT_PATH + (event.target.value ? `?${new URLSearchParams({ athlete: event.target.value })}` : ''))
      }}>
        <option value="">Select athlete</option>
        {data.athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.first_name} {athlete.last_name}</option>)}
      </select></label>
      {!data.athletes.length && <p>Add an athlete to your existing account first. <Link href={`/athletes?${new URLSearchParams({ next: returnPath })}`}>Add athlete</Link></p>}
      {data.pkg ? <article className="card">
        <h2>{data.pkg.name}</h2>
        <p>{data.pkg.description}</p>
        <b className="packagePrice">${(Number(data.pkg.price_cents) / 100).toFixed(2)}{data.pkg.payment_type === 'subscription' ? '/month' : ''}</b>
        <p>This membership belongs to the selected athlete.</p>
        {membership ? <>
          <p>This athlete already has this membership. No additional purchase is needed.</p>
          {membership.cancel_at_period_end && <p>Cancellation is scheduled. Access continues until the membership expires.</p>}
          {waiverComplete && <Link className="ctaLink" href={bookingUrl(membership)}>Book Track Training</Link>}
        </> : checkout === 'success' ? <p role="status">{waiting ? 'Checking for your membership activation...' : 'Your membership is not active yet. Refresh membership status or contact support before trying another payment.'}</p> : <>
          {checkout === 'cancelled' && <p>Checkout was cancelled. Enrollment has not been completed.</p>}
          <button onClick={purchase} disabled={busy || !athleteId || !waiverComplete || Boolean(error)}>{busy ? 'Opening checkout...' : 'Enroll selected athlete'}</button>
        </>}
        {!waiverComplete && <p>Complete the required participation waiver before continuing. <Link href={`/waiver?${new URLSearchParams({ next: returnPath })}`}>Review and sign waiver</Link></p>}
        <button className="secondary" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh membership status</button>
      </article> : <p className="notice">This program is currently unavailable. Contact iTrainSpeed for help.</p>}
      <p><Link href="/plans">View all plans and manage billing</Link> · <Link href="/support">Contact support</Link></p>
    </>}
  </AppShell>
}

export default function TrackEnrollment() {
  return <Suspense fallback={<AppShell title="Off-Season Track & Field"><p>Loading program...</p></AppShell>}><Enrollment /></Suspense>
}
