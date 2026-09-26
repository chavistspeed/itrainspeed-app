'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

const label = (type) =>
  ({
    group: 'Group Training',
    private: 'Private Training',
    track: 'Track & Field',
    recovery: 'Recovery',
  }[type] || type)

export default function Booking() {
  const params = useSearchParams()

  const requestedType = params.get('type') || ''
  const requestedAthlete = params.get('athlete') || ''

  const [athletes, setAthletes] = useState([])
  const [sessions, setSessions] = useState([])
  const [ents, setEnts] = useState([])
  const [booked, setBooked] = useState(new Set())
  const [athlete, setAthlete] = useState(requestedAthlete)
  const [filter, setFilter] = useState(requestedType)
  const [msg, setMsg] = useState('')

  async function loadBase() {
    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const [{ data: athleteData }, { data: sessionData }, { data: entitlementData }] =
      await Promise.all([
        s
          .from('athletes')
          .select('*')
          .eq('guardian_id', user.id)
          .order('first_name'),

        s
          .from('session_availability')
          .select('*')
          .gte('start_at', new Date().toISOString())
          .order('start_at')
          .limit(80),

        s
          .from('entitlements')
          .select('*')
          .eq('guardian_id', user.id)
          .eq('status', 'active'),
      ])

    const athleteList = athleteData || []

    setAthletes(athleteList)
    setSessions(sessionData || [])
    setEnts(entitlementData || [])

    setAthlete(
      (current) =>
        current ||
        requestedAthlete ||
        athleteList?.[0]?.id ||
        ''
    )
  }

  useEffect(() => {
    loadBase()
  }, [])

  useEffect(() => {
    async function loadBooked() {
      if (!athlete) {
        setBooked(new Set())
        return
      }

      const { data } = await supabase()
        .from('bookings')
        .select('session_id')
        .eq('athlete_id', athlete)
        .eq('status', 'booked')

      setBooked(
        new Set((data || []).map((booking) => booking.session_id))
      )
    }

    loadBooked()
  }, [athlete])

  async function book(sessionId) {
    if (!athlete) {
      setMsg('Add or select an athlete first.')
      return
    }

    setMsg('')

    const { error } = await supabase().rpc('book_session_v14', {
      p_session_id: sessionId,
      p_athlete_id: athlete,
    })

    if (error) {
      setMsg(error.message)
      return
    }

    setMsg('Training booked successfully.')

    await loadBase()

    const { data } = await supabase()
      .from('bookings')
      .select('session_id')
      .eq('athlete_id', athlete)
      .eq('status', 'booked')

    setBooked(
      new Set((data || []).map((booking) => booking.session_id))
    )
  }

  const selectedAthlete = athletes.find(
    (item) => item.id === athlete
  )

  const validEntitlements = useMemo(() => {
    return ents.filter((entitlement) => {
      const notExpired =
        !entitlement.expires_at ||
        new Date(entitlement.expires_at) > new Date()

      const hasAccess =
        entitlement.unlimited ||
        Number(entitlement.credits_remaining) > 0

      // Family Group/Private credits have no athlete_id.
      // Athlete-specific memberships, such as Track, must match.
      const belongsToAthlete =
        !entitlement.athlete_id ||
        entitlement.athlete_id === athlete

      return notExpired && hasAccess && belongsToAthlete
    })
  }, [ents, athlete])

  const availableTypes = [
    ...new Set(
      validEntitlements.map(
        (entitlement) => entitlement.credit_type
      )
    ),
  ]

  const eligibleSessions = sessions.filter((session) => {
    const ageEligible =
      !selectedAthlete?.age ||
      (selectedAthlete.age >= session.min_age &&
        selectedAthlete.age <= session.max_age)

    const matchesFilter =
      !filter || session.credit_type === filter

    const hasCorrectAccess =
      availableTypes.includes(session.credit_type)

    return ageEligible && matchesFilter && hasCorrectAccess
  })

  const filteredEntitlements = validEntitlements.filter(
    (entitlement) => entitlement.credit_type === filter
  )

  const unlimitedAccess = filteredEntitlements.some(
    (entitlement) => entitlement.unlimited
  )

  const remainingSessions = filteredEntitlements.reduce(
    (total, entitlement) =>
      total + Number(entitlement.credits_remaining || 0),
    0
  )

  return (
    <AppShell title="Book Training">
      <div className="pageTitleRow">
        <div>
          <h1>Book training</h1>

          <p className="subtle">
            Only sessions your athlete can book with active
            credits or memberships are shown.
          </p>
        </div>

        <Link href="/plans">View my access</Link>
      </div>

      <div className="bookingFilters">
        <label>
          Booking for

          <select
            value={athlete}
            onChange={(event) =>
              setAthlete(event.target.value)
            }
          >
            <option value="">Select athlete</option>

            {athletes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.first_name} {item.last_name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Training access

          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value)
            }
          >
            <option value="">
              All eligible training
            </option>

            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filter && (
        <div className="accessBanner">
          <b>Using: {label(filter)}</b>

          <span>
            {unlimitedAccess
              ? 'Unlimited active access'
              : `${remainingSessions} sessions available`}
          </span>
        </div>
      )}

      {msg && <div className="notice">{msg}</div>}

      <div className="sessions">
        {eligibleSessions.map((session) => {
          const full =
            session.booked_count >= session.capacity

          const isBooked = booked.has(session.id)

          return (
            <article
              className="session card"
              key={session.id}
            >
              <div>
                <small>
                  {(
                    session.category ||
                    label(session.credit_type) ||
                    'TRAINING'
                  ).toUpperCase()}
                </small>

                <h3>{session.program_name}</h3>

                <span>
                  {new Date(
                    session.start_at
                  ).toLocaleString()}
                </span>

                <span>
                  {session.location || 'iTrainSpeed'} •{' '}
                  {session.duration_minutes} min
                </span>

                <span>
                  {session.booked_count}/{session.capacity}{' '}
                  booked • Eligible with{' '}
                  {label(session.credit_type)}
                </span>
              </div>

              <button
                className={
                  isBooked ? 'bookedBtn' : ''
                }
                disabled={full || isBooked}
                onClick={() => book(session.id)}
              >
                {isBooked
                  ? 'Booked'
                  : full
                    ? 'Full'
                    : 'Book'}
              </button>
            </article>
          )
        })}

        {!eligibleSessions.length && (
          <div className="empty">
            {availableTypes.length
              ? 'No upcoming sessions match this access yet. Try another training type or check back when new sessions are published.'
              : 'This athlete does not currently have active training access. Visit My Training to add a package or membership.'}

            <br />
            <br />

            <Link href="/plans">
              View plans &amp; access →
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  )
}
