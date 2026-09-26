'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

export default function Dashboard() {
  const [profile, setProfile] = useState(null)
  const [athletes, setAthletes] = useState([])
  const [bookings, setBookings] = useState([])
  const [ents, setEnts] = useState([])
  const [msg, setMsg] = useState('')

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
        .select('*,packages(name,access_type)')
        .eq('guardian_id', user.id)
        .eq('status', 'active'),
    ])

    setProfile(p)
    setAthletes(a || [])
    setBookings(b || [])

    setEnts(
      (e || []).filter(
        (entitlement) =>
          !entitlement.expires_at ||
          new Date(entitlement.expires_at) >
            new Date()
      )
    )
  }

  async function cancel(id) {
    if (
      !confirm(
        'Cancel this booking and return the training credit?'
      )
    ) {
      return
    }

    const { error } = await supabase().rpc(
      'cancel_booking_v14',
      {
        p_booking_id: id,
      }
    )

    setMsg(
      error
        ? error.message
        : 'Booking cancelled. Your session has been returned to your training access.'
    )

    if (!error) {
      await load()
    }
  }

  async function out() {
    await supabase()?.auth.signOut()
    router.replace('/login')
  }

  /*
   * -------------------------------------------------------
   * ACTIVE ACCESS
   * -------------------------------------------------------
   */

  const groupEntitlements =
    ents.filter(
      (e) => e.credit_type === 'group'
    )

  const privateEntitlements =
    ents.filter(
      (e) => e.credit_type === 'private'
    )

  const trackEntitlements =
    ents.filter(
      (e) => e.credit_type === 'track'
    )

  /*
   * Shared Group credits have no athlete_id.
   *
   * Founding Athlete Membership is Group access,
   * but it belongs to one specific athlete.
   */
  const sharedGroupEntitlements =
    groupEntitlements.filter(
      (e) => !e.athlete_id
    )

  const athleteGroupMemberships =
    groupEntitlements.filter(
      (e) =>
        e.athlete_id &&
        e.unlimited
    )

  /*
   * Shared Group credits should never become
   * "Unlimited" just because one athlete has an
   * unlimited membership.
   */
  const sharedGroupCredits =
    sharedGroupEntitlements.reduce(
      (total, entitlement) =>
        total +
        Number(
          entitlement.credits_remaining ||
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
          (total, entitlement) =>
            total +
            Number(
              entitlement.credits_remaining ||
                0
            ),
          0
        )

  /*
   * Build athlete-specific unlimited membership
   * information for the dashboard.
   */
  const unlimitedGroupAthletes =
    athleteGroupMemberships.map(
      (entitlement) => {
        const athlete =
          athletes.find(
            (a) =>
              a.id ===
              entitlement.athlete_id
          )

        return {
          entitlement,
          athlete,
        }
      }
    )

  function athleteName(athlete) {
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

  return (
    <AppShell title="Athlete Hub">
      <section className="hero">
        <p>WELCOME BACK</p>

        <h1>
          {profile?.full_name ||
            'iTrainSpeed Family'}
        </h1>

        <div className="stats walletStats">
          <div>
            <b>{sharedGroupCredits}</b>
            <span>
              Shared Group sessions
            </span>
          </div>

          <div>
            <b>{privateBalance}</b>
            <span>Private sessions</span>
          </div>

          <div>
            <b>
              {trackEntitlements.length
                ? 'Active'
                : '—'}
            </b>
            <span>Track membership</span>
          </div>

          <div>
            <b>{athletes.length}</b>
            <span>Athletes</span>
          </div>

          <div>
            <b>{bookings.length}</b>
            <span>Upcoming</span>
          </div>
        </div>

        <div className="heroActions">
          <Link
            className="heroCta"
            href="/booking"
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
                key={entitlement.id}
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
                    Unlimited Group sessions
                  </span>
                </div>

                <Link
                  className="miniCta"
                  href={`/booking?athlete=${entitlement.athlete_id}&type=group&entitlement=${entitlement.id}`}
                >
                  Book training
                </Link>
              </div>
            )
          )}
        </section>
      )}

      <section>
        <div className="row">
          <h2>Your athletes</h2>

          <Link href="/athletes">
            Manage
          </Link>
        </div>

        {athletes.length ? (
          athletes.map((athlete) => (
            <div
              className="card athleteAction"
              key={athlete.id}
            >
              <div>
                <b>
                  {athlete.first_name}{' '}
                  {athlete.last_name}
                </b>

                <span>
                  {athlete.age
                    ? `Age ${athlete.age}`
                    : ''}{' '}
                  {athlete.sport
                    ? `• ${athlete.sport}`
                    : ''}
                </span>
              </div>

              <Link
                className="miniCta"
                href={`/booking?athlete=${athlete.id}`}
              >
                Book training
              </Link>
            </div>
          ))
        ) : (
          <div className="empty">
            Add your first athlete to
            start booking.
          </div>
        )}
      </section>

      <section>
        <div className="row">
          <h2>Upcoming training</h2>

          <Link href="/booking">
            Book training
          </Link>
        </div>

        {bookings.length ? (
          bookings.map((booking) => {
            const athlete =
              athletes.find(
                (a) =>
                  a.id ===
                  booking.athlete_id
              )

            return (
              <div
                className="bookingRow card"
                key={booking.id}
              >
                <div>
                  <b>
                    {
                      booking.sessions
                        ?.programs?.name
                    }
                  </b>

                  <span>
                    {booking.sessions
                      ?.start_at
                      ? new Date(
                          booking.sessions.start_at
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
                </div>

                <div className="bookingActions">
                  <span className="pill">
                    Booked
                  </span>

                  <button
                    className="dangerGhost"
                    onClick={() =>
                      cancel(
                        booking.id
                      )
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="empty">
            No upcoming bookings yet.
          </div>
        )}
      </section>

      {profile?.role !== 'parent' && (
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
