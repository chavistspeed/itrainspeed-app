'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

const money = (c) =>
  `$${(Number(c || 0) / 100).toFixed(2)}`

const label = (t) =>
  ({
    group: 'Group Training',
    private: 'Private Training',
    track: 'Track & Field',
    recovery: 'Recovery',
  }[t] || t)

/*
 * Determines whether a package belongs to one athlete.
 *
 * Track access is athlete-specific.
 * Group memberships such as Founding Athlete Membership
 * are athlete-specific.
 *
 * Normal Group credit packages remain family-shared.
 */
const isAthleteSpecific = (p) =>
  p?.credit_type === 'track' ||
  (
    p?.credit_type === 'group' &&
    p?.access_type === 'membership'
  )

function PlansContent() {
  const searchParams = useSearchParams()

  const [packages, setPackages] = useState([])
  const [ents, setEnts] = useState([])
  const [athletes, setAthletes] = useState([])
  const [profile, setProfile] = useState(null)

  const [msg, setMsg] = useState('')
  const [selectedAthlete, setSelectedAthlete] =
    useState('')

  const [purchasing, setPurchasing] =
    useState(null)

  async function load() {
    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const [
      { data: p },
      { data: pk },
      { data: e },
      { data: a },
    ] = await Promise.all([
      s.from('profiles')
        .select('*')
        .eq('id', user.id)
        .single(),

      s.from('packages')
        .select('*')
        .eq('active', true)
        .order('sort_order'),

      s.from('entitlements')
        .select('*,packages(name)')
        .eq('guardian_id', user.id)
        .eq('status', 'active')
        .order('created_at', {
          ascending: false,
        }),

      s.from('athletes')
        .select('*')
        .eq('guardian_id', user.id)
        .order('first_name'),
    ])

    setProfile(p)
    setPackages(pk || [])
    setEnts(e || [])
    setAthletes(a || [])

    setSelectedAthlete(
      (current) =>
        current || a?.[0]?.id || ''
    )
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const checkout =
      searchParams.get('checkout')

    if (checkout === 'success') {
      setMsg(
        'Payment successful. Your training access is being activated.'
      )

      const timer1 = setTimeout(() => {
        load()
      }, 1500)

      const timer2 = setTimeout(() => {
        load()
      }, 4000)

      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }

    if (checkout === 'cancelled') {
      setMsg(
        'Checkout was cancelled. You were not charged.'
      )
    }
  }, [searchParams])

  async function purchase(p) {
    setMsg('')

    const athleteSpecific =
      isAthleteSpecific(p)

    if (
      athleteSpecific &&
      !selectedAthlete
    ) {
      setMsg(
        'Please select the athlete receiving this membership.'
      )
      return
    }

    setPurchasing(p.id)

    try {
      const s = supabase()

      const {
        data: { session },
      } = await s.auth.getSession()

      if (!session?.access_token) {
        setMsg(
          'Please sign in again before purchasing.'
        )
        setPurchasing(null)
        return
      }

      const response = await fetch(
        '/api/stripe/create-checkout-session',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${session.access_token}`,
          },

          body: JSON.stringify({
            package_id: p.id,

            athlete_id:
              athleteSpecific
                ? selectedAthlete
                : null,
          }),
        }
      )

      const result = await response.json()

if (!response.ok) {
  if (result.diagnostic) {
    throw new Error(
      JSON.stringify(
        result.diagnostic,
        null,
        2
      )
    )
  }

  throw new Error(
    result.error ||
      'Unable to start checkout.'
  )
}

      if (!result.url) {
        throw new Error(
          'Stripe did not return a checkout URL.'
        )
      }

      window.location.href = result.url
    } catch (error) {
      setMsg(
        error?.message ||
          'Unable to start checkout.'
      )

      setPurchasing(null)
    }
  }

  async function grant(p) {
    if (profile?.role !== 'admin') {
      return
    }

    setMsg('')

    const athleteSpecific =
      isAthleteSpecific(p)

    const athleteId =
      athleteSpecific
        ? selectedAthlete || null
        : null

    if (
      athleteSpecific &&
      !athleteId
    ) {
      setMsg(
        'Select an athlete before granting athlete-specific access.'
      )
      return
    }

    const { error } = await supabase().rpc(
      'admin_grant_test_package',
      {
        p_package_id: p.id,
        p_guardian_id: profile.id,
        p_athlete_id: athleteId,
      }
    )

    setMsg(
      error
        ? error.message
        : `Test access granted: ${p.name}`
    )

    if (!error) load()
  }

  function bookUrl(e) {
    const q = new URLSearchParams({
      type: e.credit_type,
      entitlement: e.id,
    })

    if (e.athlete_id) {
      q.set('athlete', e.athlete_id)
    }

    return `/booking?${q.toString()}`
  }

  function purchaseButtonText(p) {
    if (purchasing === p.id) {
      return 'Opening checkout...'
    }

    if (
      p.payment_type === 'subscription'
    ) {
      return `Start ${money(
        p.price_cents
      )}/month`
    }

    return `Purchase ${money(
      p.price_cents
    )}`
  }

  return (
    <AppShell title="Plans & Packages">
      <div className="pageTitleRow">
        <div>
          <h1>My training</h1>

          <p className="subtle">
            Purchase training, manage your
            available sessions and memberships,
            and book eligible training.
          </p>
        </div>

        <Link
          className="ctaLink"
          href="/booking"
        >
          Book training
        </Link>
      </div>

      {msg && (
        <div className="notice">
          {msg}
        </div>
      )}

      {profile?.role === 'admin' && (
        <div className="notice">
          <b>Admin test mode:</b>{' '}
          Customer checkout is now enabled.
          You can still grant test packages
          without charging a card.
        </div>
      )}

      <section>
        <h2>Your active access</h2>

        {ents.length ? (
          ents.map((e) => {
            const athlete =
              athletes.find(
                (x) =>
                  x.id === e.athlete_id
              )

            return (
              <div
                className="card entitlementCard"
                key={e.id}
              >
                <div>
                  <small>
                    {label(
                      e.credit_type
                    ).toUpperCase()}
                  </small>

                  <h3>
                    {e.packages?.name ||
                      label(
                        e.credit_type
                      )}
                  </h3>

                  <b className="balanceText">
                    {e.unlimited
                      ? 'Unlimited access'
                      : `${
                          e.credits_remaining
                        } ${
                          e.credits_remaining ===
                          1
                            ? 'session'
                            : 'sessions'
                        } remaining`}
                  </b>

                  <span>
                    {athlete
                      ? `For ${
                          athlete.first_name
                        } ${
                          athlete.last_name ||
                          ''
                        }`
                      : 'Shared by all athletes on this account'}
                  </span>

                  <span>
                    {e.expires_at
                      ? `Valid through ${new Date(
                          e.expires_at
                        ).toLocaleDateString()}`
                      : 'No expiration'}
                  </span>
                </div>

                <Link
                  className="ctaLink"
                  href={bookUrl(e)}
                >
                  {e.credit_type ===
                  'track'
                    ? 'Book Track Training'
                    : 'Book a Session'}
                </Link>
              </div>
            )
          })
        ) : (
          <div className="empty">
            No package or membership
            access yet.
          </div>
        )}
      </section>

      <section>
        <h2>Available plans</h2>

        {packages.map((p) => {
          const athleteSpecific =
            isAthleteSpecific(p)

          return (
            <article
              className="card packageCard"
              key={p.id}
            >
              <div>
                <small>
                  {(
                    p.access_type ||
                    'training'
                  ).toUpperCase()}{' '}
                  •{' '}
                  {label(
                    p.credit_type
                  ).toUpperCase()}
                </small>

                <h3>{p.name}</h3>

                {p.description && (
                  <span>
                    {p.description}
                  </span>
                )}

                {p.purchase_limit && (
                  <span className="promoText">
                    Limited to the first{' '}
                    {p.purchase_limit}{' '}
                    athletes
                  </span>
                )}

                <b className="packagePrice">
                  {money(
                    p.price_cents
                  )}
                  {p.payment_type ===
                  'subscription'
                    ? '/month'
                    : ''}
                </b>

                {athleteSpecific && (
                  <label>
                    Athlete
                    <select
                      value={
                        selectedAthlete
                      }
                      onChange={(e) =>
                        setSelectedAthlete(
                          e.target.value
                        )
                      }
                      required
                    >
                      {athletes.length ? (
                        athletes.map((a) => (
                          <option
                            key={a.id}
                            value={a.id}
                          >
                            {a.first_name}{' '}
                            {a.last_name}
                          </option>
                        ))
                      ) : (
                        <option value="">
                          Add an athlete first
                        </option>
                      )}
                    </select>
                  </label>
                )}
              </div>

              <div className="inlineActions">
                <button
                  onClick={() =>
                    purchase(p)
                  }
                  disabled={
                    purchasing !== null ||
                    (
                      athleteSpecific &&
                      !selectedAthlete
                    )
                  }
                >
                  {purchaseButtonText(
                    p
                  )}
                </button>

                {profile?.role ===
                  'admin' && (
                  <button
                    className="secondary smallBtn"
                    onClick={() =>
                      grant(p)
                    }
                    disabled={
                      purchasing !== null ||
                      (
                        athleteSpecific &&
                        !selectedAthlete
                      )
                    }
                  >
                    Grant test access
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </section>
    </AppShell>
  )
}

export default function Plans() {
  return (
    <Suspense
      fallback={
        <AppShell title="Plans & Packages">
          <div className="card">
            <h2>
              Loading your training
              plans...
            </h2>
          </div>
        </AppShell>
      }
    >
      <PlansContent />
    </Suspense>
  )
}
