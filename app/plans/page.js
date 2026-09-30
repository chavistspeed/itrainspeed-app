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

/*
 * Determines whether a package belongs
 * to one specific athlete.
 *
 * Track memberships are athlete-specific.
 *
 * Group memberships such as Founding
 * Athlete Membership are athlete-specific.
 *
 * Normal Group and Private credit packages
 * remain family-shared.
 */
const isAthleteSpecific = (p) =>
  p?.credit_type === 'track' ||
  (
    p?.credit_type === 'group' &&
    p?.access_type === 'membership'
  )

function PlansContent() {
  const searchParams = useSearchParams()

  const [packages, setPackages] =
    useState([])

  const [ents, setEnts] =
    useState([])

  const [athletes, setAthletes] =
    useState([])

  const [msg, setMsg] =
    useState('')

  const [
    selectedAthlete,
    setSelectedAthlete,
  ] = useState('')

  const [
    purchasing,
    setPurchasing,
  ] = useState(null)

  const [
    openingPortal,
    setOpeningPortal,
  ] = useState(false)

  /*
   * -------------------------------------------------------
   * LOAD CUSTOMER DATA
   * -------------------------------------------------------
   */

  async function load() {
    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const [
      { data: pk },
      { data: e },
      { data: a },
    ] = await Promise.all([
      s.from('packages')
        .select('*')
        .eq('active', true)
        .order('sort_order'),

      s.from('entitlements')
        .select(
          '*,packages(name,access_type)'
        )
        .eq(
          'guardian_id',
          user.id
        )
        .eq(
          'status',
          'active'
        )
        .order(
          'created_at',
          {
            ascending: false,
          }
        ),

      s.from('athletes')
        .select('*')
        .eq(
          'guardian_id',
          user.id
        )
        .order('first_name'),
    ])

    setPackages(pk || [])
    setAthletes(a || [])

    /*
     * Only show access the customer can
     * currently use.
     *
     * Unlimited memberships remain visible.
     *
     * Credit packages with zero remaining
     * sessions stay in Supabase for history
     * but disappear from Active Access.
     */
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

    setSelectedAthlete(
      (current) =>
        current ||
        a?.[0]?.id ||
        ''
    )
  }

  useEffect(() => {
    load()
  }, [])

  /*
   * -------------------------------------------------------
   * CHECKOUT RETURN
   * -------------------------------------------------------
   */

  useEffect(() => {
    const checkout =
      searchParams.get(
        'checkout'
      )

    if (
      checkout === 'success'
    ) {
      setMsg(
        'Payment successful. Your training access is being activated.'
      )

      const timer1 =
        setTimeout(() => {
          load()
        }, 1500)

      const timer2 =
        setTimeout(() => {
          load()
        }, 4000)

      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }

    if (
      checkout === 'cancelled'
    ) {
      setMsg(
        'Checkout was cancelled. You were not charged.'
      )
    }
  }, [searchParams])

  /*
   * -------------------------------------------------------
   * STRIPE CHECKOUT
   * -------------------------------------------------------
   */

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

      if (
        !session?.access_token
      ) {
        throw new Error(
          'Please sign in again before purchasing.'
        )
      }

      const response =
        await fetch(
          '/api/stripe/create-checkout-session',
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
                package_id:
                  p.id,

                athlete_id:
                  athleteSpecific
                    ? selectedAthlete
                    : null,
              }),
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
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

      window.location.href =
        result.url
    } catch (error) {
      setMsg(
        error?.message ||
          'Unable to start checkout.'
      )

      setPurchasing(null)
    }
  }

  /*
   * -------------------------------------------------------
   * STRIPE CUSTOMER PORTAL
   * -------------------------------------------------------
   */

  async function openBillingPortal() {
    setMsg('')
    setOpeningPortal(true)

    try {
      const s = supabase()

      const {
        data: { session },
      } = await s.auth.getSession()

      if (
        !session?.access_token
      ) {
        throw new Error(
          'Please sign in again before managing your billing.'
        )
      }

      const response =
        await fetch(
          '/api/stripe/create-portal-session',
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${session.access_token}`,
            },
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
            'Unable to open billing management.'
        )
      }

      if (!result.url) {
        throw new Error(
          'Stripe did not return a billing portal URL.'
        )
      }

      window.location.href =
        result.url
    } catch (error) {
      setMsg(
        error?.message ||
          'Unable to open billing management.'
      )

      setOpeningPortal(false)
    }
  }

  /*
   * -------------------------------------------------------
   * BOOKING LINKS
   * -------------------------------------------------------
   */

  function bookUrl(e) {
    const q =
      new URLSearchParams({
        type:
          e.credit_type,

        entitlement:
          e.id,
      })

    if (e.athlete_id) {
      q.set(
        'athlete',
        e.athlete_id
      )
    }

    return `/booking?${q.toString()}`
  }

  /*
   * -------------------------------------------------------
   * PURCHASE BUTTON
   * -------------------------------------------------------
   */

  function purchaseButtonText(p) {
    if (
      purchasing === p.id
    ) {
      return 'Opening checkout...'
    }

    if (
      p.payment_type ===
      'subscription'
    ) {
      return `Start ${money(
        p.price_cents
      )}/month`
    }

    return `Purchase ${money(
      p.price_cents
    )}`
  }

  /*
   * -------------------------------------------------------
   * MEMBERSHIP STATUS
   * -------------------------------------------------------
   */

  function accessStatus(e) {
    if (
      e.cancel_at_period_end &&
      e.cancellation_effective_at
    ) {
      return `Active through ${formatDate(
        e.cancellation_effective_at
      )}`
    }

    if (
      e.cancel_at_period_end
    ) {
      return 'Cancellation scheduled'
    }

    if (
      e.stripe_subscription_id
    ) {
      return 'Active recurring membership'
    }

    if (e.expires_at) {
      return `Valid through ${formatDate(
        e.expires_at
      )}`
    }

    return 'Active access'
  }

  /*
   * -------------------------------------------------------
   * PAGE
   * -------------------------------------------------------
   */

  return (
    <AppShell title="Plans & Packages">
      <div className="pageTitleRow">
        <div>
          <h1>
            My training
          </h1>

          <p className="subtle">
            Purchase training,
            manage your available
            sessions and memberships,
            and book eligible
            training.
          </p>
        </div>

        {/*
         * Keep these two primary actions
         * identical in height and alignment.
         *
         * Explicit margin: 0 prevents the
         * global .secondary button style from
         * pushing Manage Billing downward.
         */}
        <div
          className="inlineActions"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <Link
            className="ctaLink"
            href="/booking"
            style={{
              minWidth: '140px',
              height: '60px',
              minHeight: '60px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              whiteSpace: 'nowrap',
              margin: 0,
              padding: '0 18px',
              lineHeight: 1,
            }}
          >
            Book Training
          </Link>

          <button
            className="secondary"
            onClick={
              openBillingPortal
            }
            disabled={
              openingPortal
            }
            style={{
              minWidth: '148px',
              height: '60px',
              minHeight: '60px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              whiteSpace: 'nowrap',
              margin: 0,
              padding: '0 18px',
              lineHeight: 1,
            }}
          >
            {openingPortal
              ? 'Opening Billing...'
              : 'Manage Billing'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="notice">
          {msg}
        </div>
      )}

      {/*
       * ---------------------------------------------------
       * ACTIVE ACCESS
       * ---------------------------------------------------
       */}

      <section>
        <h2>
          Your active access
        </h2>

        {ents.length ? (
          ents.map((e) => {
            const athlete =
              athletes.find(
                (x) =>
                  x.id ===
                  e.athlete_id
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

                  {athlete && (
                    <b className="athleteAccessName">
                      {
                        athlete.first_name
                      }{' '}
                      {
                        athlete.last_name ||
                        ''
                      }
                    </b>
                  )}

                  <h3>
                    {e.packages
                      ?.name ||
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

                  {!athlete && (
                    <span>
                      Shared by all
                      athletes on this
                      account
                    </span>
                  )}

                  <span>
                    {accessStatus(e)}
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
            You don't have any active
            training access yet.
          </div>
        )}
      </section>

      {/*
       * ---------------------------------------------------
       * AVAILABLE PLANS
       * ---------------------------------------------------
       */}

      <section>
        <h2>
          Available plans
        </h2>

        {packages.length ? (
          packages.map((p) => {
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

                  <h3>
                    {p.name}
                  </h3>

                  {p.description && (
                    <span>
                      {p.description}
                    </span>
                  )}

                  {p.purchase_limit && (
                    <span className="promoText">
                      Limited to the
                      first{' '}
                      {
                        p.purchase_limit
                      }{' '}
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
                          athletes.map(
                            (a) => (
                              <option
                                key={
                                  a.id
                                }
                                value={
                                  a.id
                                }
                              >
                                {
                                  a.first_name
                                }{' '}
                                {
                                  a.last_name
                                }
                              </option>
                            )
                          )
                        ) : (
                          <option value="">
                            Add an athlete
                            first
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
                      purchasing !==
                        null ||
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
                </div>
              </article>
            )
          })
        ) : (
          <div className="empty">
            No training plans are
            currently available.
          </div>
        )}
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
