'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

const CANCELLATION_WINDOW_HOURS = 6
const CURRENT_WAIVER_VERSION = '2026-01'

function formatDate(value) {
  if (!value) return ''

  return new Date(value).toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }
  )
}

function canCancelBooking(startAt) {
  if (!startAt) return false

  const startTime =
    new Date(startAt).getTime()

  const now = Date.now()

  const cancellationDeadline =
    startTime -
    CANCELLATION_WINDOW_HOURS *
      60 *
      60 *
      1000

  return now <= cancellationDeadline
}

function cancellationDeadline(startAt) {
  if (!startAt) return ''

  const deadline =
    new Date(startAt).getTime() -
    CANCELLATION_WINDOW_HOURS *
      60 *
      60 *
      1000

  return new Date(
    deadline
  ).toLocaleString()
}

export default function Dashboard() {
  const [profile, setProfile] =
    useState(null)

  const [athletes, setAthletes] =
    useState([])

  const [bookings, setBookings] =
    useState([])

  const [ents, setEnts] =
    useState([])

  const [msg, setMsg] =
    useState('')

  const router = useRouter()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const s = supabase()

    if (!s) {
      router.replace('/login')
      return
    }

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) {
      router.replace('/login')
      return
    }

    const [
      { data: p },
      { data: a },
      { data: b },
      { data: e },
    ] = await Promise.all([
      s.from('profiles')
        .select('*')
        .eq('id', user.id)
        .single(),

      s.from('athletes')
        .select('*')
        .eq('guardian_id', user.id)
        .order('created_at'),

      s.from('bookings')
        .select(
          'id,status,athlete_id,sessions(start_at,location,programs(name))'
        )
        .eq('guardian_id', user.id)
        .eq('status', 'booked')
        .order('created_at', {
          ascending: false,
        })
        .limit(10),

      s.from('entitlements')
        .select(
          '*,packages(name,access_type)'
        )
        .eq('guardian_id', user.id)
        .eq('status', 'active'),
    ])

    setProfile(p)
    setAthletes(a || [])

    const upcomingBookings =
      (b || [])
        .filter(
          (booking) =>
            booking.sessions?.start_at &&
            new Date(
              booking.sessions.start_at
            ) > new Date()
        )
        .sort(
          (a, b) =>
            new Date(
              a.sessions.start_at
            ) -
            new Date(
              b.sessions.start_at
            )
        )

    setBookings(
      upcomingBookings
    )

    setEnts(
      (e || []).filter(
        (entitlement) => {
          const unexpired =
            !entitlement.expires_at ||
            new Date(
              entitlement.expires_at
            ) > new Date()

          if (!unexpired) {
            return false
          }

          if (
            entitlement.unlimited
          ) {
            return true
          }

          return (
            Number(
              entitlement
                .credits_remaining ||
                0
            ) > 0
          )
        }
      )
    )
  }

async function cancel(
  booking
) {
  const startAt =
    booking.sessions?.start_at

  if (
    !canCancelBooking(
      startAt
    )
  ) {
    setMsg(
      'The cancellation window for this session has closed. Training sessions must be cancelled at least 6 hours before the scheduled start time.'
    )

    return
  }

  if (
    !confirm(
      'Cancel this booking? Your training credit will be returned to your account.'
    )
  ) {
    return
  }

  const s = supabase()

  const { error } =
    await s.rpc(
      'cancel_booking_v14',
      {
        p_booking_id:
          booking.id,
      }
    )

  if (error) {
    setMsg(
      error.message
    )
    return
  }

  /*
   * The database cancellation has succeeded.
   * The credit has already been restored by
   * cancel_booking_v14.
   *
   * Email failure must never make the customer
   * think the cancellation itself failed.
   */
  try {
    const {
      data: { session },
    } = await s.auth.getSession()

    if (
      session?.access_token
    ) {
      const response =
        await fetch(
          '/api/notifications/cancel-booking',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${session.access_token}`,
            },

            body:
              JSON.stringify({
                booking_id:
                  booking.id,
              }),
          }
        )

      if (!response.ok) {
        const result =
          await response
            .json()
            .catch(() => null)

        console.error(
          'Cancellation notification failed:',
          result?.error ||
            response.statusText
        )
      }
    }
  } catch (notificationError) {
    console.error(
      'Cancellation notification error:',
      notificationError
    )
  }

  setMsg(
    'Booking cancelled. Your session has been returned to your training access.'
  )

  await load()
}

  async function out() {
    await supabase()
      ?.auth.signOut()

    router.replace('/login')
  }

  const waiverComplete =
    Boolean(
      profile?.waiver_accepted_at &&
      profile?.waiver_version ===
        CURRENT_WAIVER_VERSION
    )

  function bookingHref(
    href = '/booking'
  ) {
    return waiverComplete
      ? href
      : '/waiver'
  }

  const groupEntitlements =
    ents.filter(
      (e) =>
        e.credit_type ===
        'group'
    )

  const privateEntitlements =
    ents.filter(
      (e) =>
        e.credit_type ===
        'private'
    )

  const trackEntitlements =
    ents.filter(
      (e) =>
        e.credit_type ===
        'track'
    )

  const sharedGroupEntitlements =
    groupEntitlements.filter(
      (e) =>
        !e.athlete_id
    )

  const athleteGroupMemberships =
    groupEntitlements.filter(
      (e) =>
        e.athlete_id &&
        e.unlimited
    )

  const sharedGroupCredits =
    sharedGroupEntitlements.reduce(
      (
        total,
        entitlement
      ) =>
        total +
        Number(
          entitlement
            .credits_remaining ||
            0
        ),
      0
    )

  const privateBalance =
    privateEntitlements.some(
      (e) => e.unlimited
    )
      ? 'Unlimited'
      : privateEntitlements.reduce(
          (
            total,
            entitlement
          ) =>
            total +
            Number(
              entitlement
                .credits_remaining ||
                0
            ),
          0
        )

  const unlimitedGroupAthletes =
    athleteGroupMemberships.map(
      (entitlement) => {
        const athlete =
          athletes.find(
            (a) =>
              a.id ===
              entitlement
                .athlete_id
          )

        return {
          entitlement,
          athlete,
        }
      }
    )

  function athleteName(
    athlete
  ) {
    if (!athlete) {
      return 'Athlete'
    }

    return [
      athlete.first_name,
      athlete.last_name,
    ]
      .filter(Boolean)
      .join(' ')
  }

  function membershipStatus(
    entitlement
  ) {
    if (
      entitlement
        .cancel_at_period_end &&
      entitlement
        .cancellation_effective_at
    ) {
      return `Active through ${formatDate(
        entitlement
          .cancellation_effective_at
      )}`
    }

    if (
      entitlement
        .cancel_at_period_end
    ) {
      return 'Cancellation scheduled'
    }

    return 'Active membership'
  }

  return (
    <AppShell title="Athlete Hub">

      <section className="hero">
        <p>
          WELCOME BACK
        </p>

        <h1>
          {profile?.full_name ||
            'iTrainSpeed Family'}
        </h1>

        <div className="stats walletStats">

          <div>
            <b>
              {sharedGroupCredits}
            </b>

            <span>
              Group Credits
            </span>
          </div>

          <div>
            <b>
              {privateBalance}
            </b>

            <span>
              Private Credits
            </span>
          </div>

          <div>
            <b>
              {trackEntitlements.length
                ? 'Active'
                : '—'}
            </b>

            <span>
              Track Access
            </span>
          </div>

          <div>
            <b>
              {athletes.length}
            </b>

            <span>
              Athletes
            </span>
          </div>

          <div>
            <b>
              {bookings.length}
            </b>

            <span>
              Upcoming
            </span>
          </div>

        </div>

        <div className="heroActions">

          <Link
            className="heroCta"
            href={bookingHref(
              '/booking'
            )}
          >
            Book Training
          </Link>

          <Link
            className="heroSecondary"
            href="/plans"
          >
            My Training Access
          </Link>

        </div>
      </section>


      {msg && (
        <div className="notice">
          {msg}
        </div>
      )}


      <section>

        <div className="row">
          <h2>
            Participation Waiver
          </h2>

          <Link href="/waiver">
            {waiverComplete
              ? 'View waiver'
              : 'Complete waiver'}
          </Link>
        </div>

        {waiverComplete ? (
          <div className="card">
            <b>
              ✓ Waiver Complete
            </b>

            <span>
              Signed by{' '}
              {
                profile
                  ?.waiver_signed_name
              }
            </span>

            <span>
              On file since{' '}
              {formatDate(
                profile
                  ?.waiver_accepted_at
              )}
            </span>
          </div>
        ) : (
          <div
            className="card"
            style={{
              borderColor:
                '#ff525d',
            }}
          >
            <b>
              Participation Waiver Required
            </b>

            <span>
              Complete your one-time
              family participation waiver
              before booking training.
            </span>

            <Link
              className="miniCta"
              href="/waiver"
              style={{
                marginTop: 12,
              }}
            >
              Complete Waiver
            </Link>
          </div>
        )}

      </section>


      {unlimitedGroupAthletes.length >
        0 && (
        <section>

          <div className="row">
            <h2>
              Unlimited Group Training
            </h2>

            <Link href="/plans">
              View access
            </Link>
          </div>

          {unlimitedGroupAthletes.map(
            ({
              entitlement,
              athlete,
            }) => (
              <div
                className="card athleteAction"
                key={
                  entitlement.id
                }
              >
                <div>
                  <b>
                    {athleteName(
                      athlete
                    )}
                  </b>

                  <span>
                    {entitlement
                      .packages?.name ||
                      'Unlimited Group Training'}
                  </span>

                  <span>
                    {membershipStatus(
                      entitlement
                    )}
                  </span>
                </div>

                <Link
                  className="miniCta"
                  href={bookingHref(
                    `/booking?athlete=${entitlement.athlete_id}&type=group&entitlement=${entitlement.id}`
                  )}
                >
                  Book Training
                </Link>
              </div>
            )
          )}

        </section>
      )}


      <section>

        <div className="row">
          <h2>
            Your athletes
          </h2>

          <Link href="/athletes">
            Manage
          </Link>
        </div>

        {athletes.length ? (
          athletes.map(
            (athlete) => (
              <div
                className="card athleteAction"
                key={
                  athlete.id
                }
              >
                <div>

                  <b>
                    {athleteName(
                      athlete
                    )}
                  </b>

                  <span>
                    {athlete.age
                      ? `Age ${athlete.age}`
                      : ''}

                    {athlete.age &&
                    athlete.sport
                      ? ' • '
                      : ''}

                    {athlete.sport ||
                      ''}
                  </span>

                </div>

                <Link
                  className="miniCta"
                  href={bookingHref(
                    `/booking?athlete=${athlete.id}`
                  )}
                >
                  Book Training
                </Link>

              </div>
            )
          )
        ) : (
          <div className="empty">
            Add your first athlete
            to start booking.
          </div>
        )}

      </section>


      <section>

        <div className="row">
          <h2>
            Upcoming training
          </h2>

          <Link
            href={bookingHref(
              '/booking'
            )}
          >
            Book training
          </Link>
        </div>

        {bookings.length ? (
          bookings.map(
            (booking) => {

              const athlete =
                athletes.find(
                  (a) =>
                    a.id ===
                    booking
                      .athlete_id
                )

              const cancellationOpen =
                canCancelBooking(
                  booking.sessions
                    ?.start_at
                )

              return (
                <div
                  className="bookingRow card"
                  key={
                    booking.id
                  }
                >

                  <div>

                    <b>
                      {
                        booking
                          .sessions
                          ?.programs
                          ?.name
                      }
                    </b>

                    <span>
                      {booking.sessions
                        ?.start_at
                        ? new Date(
                            booking
                              .sessions
                              .start_at
                          ).toLocaleString()
                        : ''}
                    </span>

                    <span>
                      {athlete
                        ? athleteName(
                            athlete
                          )
                        : ''}
                    </span>

                    {cancellationOpen ? (
                      <span>
                        Cancel by{' '}
                        {cancellationDeadline(
                          booking
                            .sessions
                            ?.start_at
                        )}{' '}
                        to have your
                        training credit
                        returned.
                      </span>
                    ) : (
                      <span
                        style={{
                          color:
                            '#b42318',
                          fontWeight:
                            700,
                        }}
                      >
                        Cancellation
                        window closed.
                      </span>
                    )}

                  </div>

                  <div className="bookingActions">

                    <span className="pill">
                      Booked
                    </span>

                    {cancellationOpen ? (
                      <button
                        className="dangerGhost"
                        onClick={() =>
                          cancel(
                            booking
                          )
                        }
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        className="dangerGhost"
                        disabled
                        title="Sessions must be cancelled at least 6 hours before the scheduled start time."
                      >
                        Cancel
                      </button>
                    )}

                  </div>

                </div>
              )
            }
          )
        ) : (
          <div className="empty">
            No upcoming bookings yet.
          </div>
        )}

      </section>


      {profile?.role !==
        'parent' && (
        <Link
          className="biglink"
          href="/coach"
        >
          Open Coach Control Center →
        </Link>
      )}

      <button
        className="secondary"
        onClick={out}
      >
        Sign out
      </button>

    </AppShell>
  )
}
