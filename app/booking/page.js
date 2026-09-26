'use client'

import {
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react'
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
  }[type] ||
  type ||
  'Training')

function BookingContent() {
  const params = useSearchParams()

  const requestedType =
    params.get('type') || ''

  const requestedAthlete =
    params.get('athlete') || ''

  const requestedEntitlement =
    params.get('entitlement') || ''

  const [athletes, setAthletes] =
    useState([])

  const [sessions, setSessions] =
    useState([])

  const [ents, setEnts] =
    useState([])

  const [booked, setBooked] =
    useState(new Set())

  const [athlete, setAthlete] =
    useState(requestedAthlete)

  const [filter, setFilter] =
    useState(requestedType)

  const [msg, setMsg] =
    useState('')

  async function loadBase() {
    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const [
      { data: athleteData },
      { data: sessionData },
      { data: entitlementData },
    ] = await Promise.all([
      s
        .from('athletes')
        .select('*')
        .eq('guardian_id', user.id)
        .order('first_name'),

      s
        .from('session_availability')
        .select('*')
        .gte(
          'start_at',
          new Date().toISOString()
        )
        .order('start_at')
        .limit(80),

      s
        .from('entitlements')
        .select(`
          *,
          packages (
            id,
            name,
            access_type,
            credit_type,
            credits,
            price_cents
          )
        `)
        .eq('guardian_id', user.id)
        .eq('status', 'active'),
    ])

    const athleteList =
      athleteData || []

    const entitlementList =
      entitlementData || []

    setAthletes(athleteList)
    setSessions(sessionData || [])
    setEnts(entitlementList)

    /*
     * If the customer arrived from a specific
     * athlete-specific entitlement, that
     * entitlement is the source of truth for
     * which athlete is being booked.
     */
    const exactEntitlement =
      requestedEntitlement
        ? entitlementList.find(
            (item) =>
              item.id ===
              requestedEntitlement
          )
        : null

    const lockedAthleteId =
      exactEntitlement?.athlete_id ||
      ''

    setAthlete(
      (current) =>
        lockedAthleteId ||
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

      const { data } =
        await supabase()
          .from('bookings')
          .select('session_id')
          .eq(
            'athlete_id',
            athlete
          )
          .eq('status', 'booked')

      setBooked(
        new Set(
          (data || []).map(
            (booking) =>
              booking.session_id
          )
        )
      )
    }

    loadBooked()
  }, [athlete])

  function sessionServiceType(session) {
    return (
      session.service_type ||
      session.credit_type ||
      ''
    )
  }

  /*
   * Locate the requested entitlement directly
   * from all active entitlements first.
   *
   * This allows us to determine whether the
   * entitlement itself is athlete-specific.
   */
  const requestedEntitlementRecord =
    useMemo(() => {
      if (!requestedEntitlement) {
        return null
      }

      return (
        ents.find(
          (entitlement) =>
            entitlement.id ===
            requestedEntitlement
        ) || null
      )
    }, [
      ents,
      requestedEntitlement,
    ])

  /*
   * An entitlement is athlete-locked whenever
   * it has an athlete_id.
   *
   * This automatically supports Founding,
   * Track, and any future athlete-specific
   * package without hard-coding package names.
   */
  const lockedAthleteId =
    requestedEntitlementRecord?.athlete_id ||
    ''

  const athleteLocked =
    Boolean(
      requestedEntitlement &&
      lockedAthleteId
    )

  /*
   * Keep the selected athlete synchronized
   * with an athlete-specific entitlement.
   */
  useEffect(() => {
    if (
      athleteLocked &&
      athlete !== lockedAthleteId
    ) {
      setAthlete(lockedAthleteId)
    }
  }, [
    athleteLocked,
    lockedAthleteId,
    athlete,
  ])

  const selectedAthlete =
    athletes.find(
      (item) =>
        item.id === athlete
    )

  const validEntitlements =
    useMemo(() => {
      return ents.filter(
        (entitlement) => {
          const notExpired =
            !entitlement.expires_at ||
            new Date(
              entitlement.expires_at
            ) > new Date()

          const hasAccess =
            entitlement.unlimited ||
            Number(
              entitlement.credits_remaining
            ) > 0

          const belongsToAthlete =
            !entitlement.athlete_id ||
            entitlement.athlete_id ===
              athlete

          return (
            notExpired &&
            hasAccess &&
            belongsToAthlete
          )
        }
      )
    }, [ents, athlete])

  const selectedEntitlement =
    useMemo(() => {
      if (!requestedEntitlement) {
        return null
      }

      return (
        validEntitlements.find(
          (entitlement) =>
            entitlement.id ===
            requestedEntitlement
        ) || null
      )
    }, [
      validEntitlements,
      requestedEntitlement,
    ])

  const availableTypes =
    selectedEntitlement
      ? [
          selectedEntitlement.credit_type,
        ]
      : [
          ...new Set(
            validEntitlements.map(
              (entitlement) =>
                entitlement.credit_type
            )
          ),
        ]

  useEffect(() => {
    if (
      selectedEntitlement &&
      !filter
    ) {
      setFilter(
        selectedEntitlement.credit_type
      )
    }
  }, [selectedEntitlement, filter])

  const eligibleSessions =
    sessions.filter((session) => {
      const serviceType =
        sessionServiceType(session)

      const minAge =
        Number(session.min_age)

      const maxAge =
        Number(session.max_age)

      const athleteAge =
        Number(selectedAthlete?.age)

      const hasAthleteAge =
        Number.isFinite(
          athleteAge
        ) && athleteAge > 0

      const hasMinimum =
        Number.isFinite(minAge)

      const hasMaximum =
        Number.isFinite(maxAge)

      const ageEligible =
        !hasAthleteAge ||
        ((!hasMinimum ||
          athleteAge >= minAge) &&
          (!hasMaximum ||
            athleteAge <= maxAge))

      const matchesFilter =
        !filter ||
        serviceType === filter

      const hasCorrectAccess =
        availableTypes.includes(
          serviceType
        )

      return (
        ageEligible &&
        matchesFilter &&
        hasCorrectAccess
      )
    })

  const filteredEntitlements =
    selectedEntitlement
      ? [selectedEntitlement]
      : validEntitlements.filter(
          (entitlement) =>
            !filter ||
            entitlement.credit_type ===
              filter
        )

  const unlimitedAccess =
    filteredEntitlements.some(
      (entitlement) =>
        entitlement.unlimited
    )

  const remainingCredits =
    filteredEntitlements.reduce(
      (total, entitlement) =>
        total +
        Number(
          entitlement.credits_remaining ||
            0
        ),
      0
    )

  const accessName =
    selectedEntitlement?.packages?.name ||
    (filter
      ? label(filter)
      : 'Training Access')

  async function book(sessionId) {
    if (!athlete) {
      setMsg(
        'Add or select an athlete first.'
      )
      return
    }

    /*
     * Extra client-side protection.
     * The database RPC remains the final
     * authorization layer.
     */
    if (
      athleteLocked &&
      athlete !== lockedAthleteId
    ) {
      setMsg(
        'This membership belongs to a different athlete.'
      )
      return
    }

    if (
      requestedEntitlement &&
      !selectedEntitlement
    ) {
      setMsg(
        'The selected training access is no longer available for this athlete. Return to Plans & Access and choose active training access.'
      )
      return
    }

    setMsg('')

    const { error } =
      await supabase().rpc(
        'book_session_v15',
        {
          p_session_id: sessionId,
          p_athlete_id: athlete,
          p_entitlement_id:
            selectedEntitlement?.id ||
            null,
        }
      )

    if (error) {
      setMsg(error.message)
      return
    }

    setMsg(
      'Training booked successfully.'
    )

    await loadBase()

    const { data } =
      await supabase()
        .from('bookings')
        .select('session_id')
        .eq(
          'athlete_id',
          athlete
        )
        .eq('status', 'booked')

    setBooked(
      new Set(
        (data || []).map(
          (booking) =>
            booking.session_id
        )
      )
    )
  }

  return (
    <AppShell title="Book Training">
      <div className="pageTitleRow">
        <div>
          <h1>Book training</h1>

          <p className="subtle">
            Only sessions your athlete
            can book with active credits
            or memberships are shown.
          </p>
        </div>

        <Link href="/plans">
          View my access
        </Link>
      </div>

      <div className="bookingFilters">
        <label>
          Booking for

          {athleteLocked ? (
            <>
              <select
                value={athlete}
                disabled
              >
                {selectedAthlete ? (
                  <option
                    value={
                      selectedAthlete.id
                    }
                  >
                    {
                      selectedAthlete.first_name
                    }{' '}
                    {
                      selectedAthlete.last_name
                    }
                  </option>
                ) : (
                  <option
                    value={
                      lockedAthleteId
                    }
                  >
                    Selected athlete
                  </option>
                )}
              </select>

              <small>
                This access belongs to this
                athlete.
              </small>
            </>
          ) : (
            <select
              value={athlete}
              onChange={(event) =>
                setAthlete(
                  event.target.value
                )
              }
            >
              <option value="">
                Select athlete
              </option>

              {athletes.map(
                (item) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.first_name}{' '}
                    {item.last_name}
                  </option>
                )
              )}
            </select>
          )}
        </label>

        <label>
          Training access

          <select
            value={filter}
            disabled={
              Boolean(
                selectedEntitlement
              )
            }
            onChange={(event) =>
              setFilter(
                event.target.value
              )
            }
          >
            {!selectedEntitlement && (
              <option value="">
                All eligible training
              </option>
            )}

            {availableTypes.map(
              (type) => (
                <option
                  key={type}
                  value={type}
                >
                  {label(type)}
                </option>
              )
            )}
          </select>
        </label>
      </div>

      {(filter ||
        selectedEntitlement) && (
        <div className="accessBanner">
          <b>
            Using: {accessName}
          </b>

          <span>
            {unlimitedAccess
              ? 'Unlimited active access'
              : `${remainingCredits} ${
                  remainingCredits === 1
                    ? 'credit'
                    : 'credits'
                } remaining`}
          </span>

          {athleteLocked &&
            selectedAthlete && (
              <span>
                For{' '}
                {
                  selectedAthlete.first_name
                }{' '}
                {
                  selectedAthlete.last_name
                }
              </span>
            )}
        </div>
      )}

      {msg && (
        <div className="notice">
          {msg}
        </div>
      )}

      <div className="sessions">
        {eligibleSessions.map(
          (session) => {
            const serviceType =
              sessionServiceType(
                session
              )

            const full =
              Number(
                session.booked_count
              ) >=
              Number(
                session.capacity
              )

            const isBooked =
              booked.has(session.id)

            return (
              <article
                className="session card"
                key={session.id}
              >
                <div>
                  <small>
                    {(
                      session.category ||
                      label(
                        serviceType
                      ) ||
                      'TRAINING'
                    ).toUpperCase()}
                  </small>

                  <h3>
                    {
                      session.program_name
                    }
                  </h3>

                  <span>
                    {new Date(
                      session.start_at
                    ).toLocaleString()}
                  </span>

                  <span>
                    {session.location ||
                      'iTrainSpeed'}{' '}
                    •{' '}
                    {
                      session.duration_minutes
                    }{' '}
                    min
                  </span>

                  <span>
                    {
                      session.booked_count
                    }
                    /{session.capacity}{' '}
                    booked • Eligible with{' '}
                    {label(serviceType)}
                  </span>
                </div>

                <button
                  className={
                    isBooked
                      ? 'bookedBtn'
                      : ''
                  }
                  disabled={
                    full ||
                    isBooked
                  }
                  onClick={() =>
                    book(session.id)
                  }
                >
                  {isBooked
                    ? 'Booked'
                    : full
                      ? 'Full'
                      : 'Book'}
                </button>
              </article>
            )
          }
        )}

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

export default function Booking() {
  return (
    <Suspense
      fallback={
        <AppShell title="Book Training">
          <div className="pageTitleRow">
            <div>
              <h1>
                Book training
              </h1>

              <p className="subtle">
                Loading your available
                training...
              </p>
            </div>
          </div>
        </AppShell>
      }
    >
      <BookingContent />
    </Suspense>
  )
}
