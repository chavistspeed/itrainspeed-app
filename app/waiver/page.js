'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

const WAIVER_VERSION = '2026-01'

export default function WaiverPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [profile, setProfile] = useState(null)
  const [athletes, setAthletes] = useState([])

  const [signedName, setSignedName] = useState('')
  const [waiverChecked, setWaiverChecked] = useState(false)
  const [mediaConsent, setMediaConsent] = useState('')

  const [msg, setMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

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
      { data: profileData, error: profileError },
      { data: athleteData, error: athleteError },
    ] = await Promise.all([
      s.from('profiles')
        .select(
          'id,full_name,role,waiver_accepted_at,waiver_signed_name,waiver_version,media_consent,media_consent_at'
        )
        .eq('id', user.id)
        .single(),

      s.from('athletes')
        .select('id,first_name,last_name')
        .eq('guardian_id', user.id)
        .order('created_at'),
    ])

    if (profileError) {
      setErrorMsg(profileError.message)
      setLoading(false)
      return
    }

    if (athleteError) {
      setErrorMsg(athleteError.message)
      setLoading(false)
      return
    }

    setProfile(profileData)
    setAthletes(athleteData || [])

    if (profileData?.waiver_signed_name) {
      setSignedName(
        profileData.waiver_signed_name
      )
    }

    if (
      profileData?.media_consent === true
    ) {
      setMediaConsent('yes')
    }

    if (
      profileData?.media_consent === false
    ) {
      setMediaConsent('no')
    }

    setLoading(false)
  }

  function athleteName(athlete) {
    return [
      athlete.first_name,
      athlete.last_name,
    ]
      .filter(Boolean)
      .join(' ')
  }

  async function submitWaiver(event) {
    event.preventDefault()

    setMsg('')
    setErrorMsg('')

    if (!waiverChecked) {
      setErrorMsg(
        'Please confirm that you have read and agree to the Participation Waiver & Release.'
      )
      return
    }

    if (!signedName.trim()) {
      setErrorMsg(
        'Please enter your full legal name to electronically sign the waiver.'
      )
      return
    }

    if (!mediaConsent) {
      setErrorMsg(
        'Please select Yes or No for photo and video consent.'
      )
      return
    }

    const s = supabase()

    if (!s) {
      setErrorMsg(
        'Unable to connect. Please try again.'
      )
      return
    }

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) {
      router.replace('/login')
      return
    }

    setSaving(true)

    const acceptedAt =
      new Date().toISOString()

    const { error } = await s
      .from('profiles')
      .update({
        waiver_accepted_at:
          acceptedAt,
        waiver_signed_name:
          signedName.trim(),
        waiver_version:
          WAIVER_VERSION,
        media_consent:
          mediaConsent === 'yes',
        media_consent_at:
          acceptedAt,
      })
      .eq('id', user.id)

    if (error) {
      setErrorMsg(error.message)
      setSaving(false)
      return
    }

    setProfile((current) => ({
      ...current,
      waiver_accepted_at:
        acceptedAt,
      waiver_signed_name:
        signedName.trim(),
      waiver_version:
        WAIVER_VERSION,
      media_consent:
        mediaConsent === 'yes',
      media_consent_at:
        acceptedAt,
    }))

    setWaiverChecked(false)

    setMsg(
      'Your Participation Waiver & Release has been signed and saved.'
    )

    setSaving(false)
  }

  if (loading) {
    return (
      <AppShell title="Participation Waiver">
        <div className="empty">
          Loading waiver...
        </div>
      </AppShell>
    )
  }

  const currentWaiverAccepted =
    profile?.waiver_accepted_at &&
    profile?.waiver_version ===
      WAIVER_VERSION

  if (currentWaiverAccepted) {
    return (
      <AppShell title="Participation Waiver">

        <section className="hero">
          <p>
            ITRAINSPEED FAMILY
          </p>

          <h1>
            Waiver Completed
          </h1>

          <p>
            Your Participation Waiver &
            Release is on file.
          </p>
        </section>

        {msg && (
          <div className="notice">
            {msg}
          </div>
        )}

        <section>
          <div className="card">

            <h2>
              Participation Waiver
            </h2>

            <p>
              <strong>
                Status:
              </strong>{' '}
              Completed
            </p>

            <p>
              <strong>
                Signed by:
              </strong>{' '}
              {
                profile
                  ?.waiver_signed_name
              }
            </p>

            <p>
              <strong>
                Accepted:
              </strong>{' '}
              {new Date(
                profile
                  .waiver_accepted_at
              ).toLocaleString()}
            </p>

            <p>
              <strong>
                Waiver version:
              </strong>{' '}
              {
                profile
                  ?.waiver_version
              }
            </p>

            <p>
              <strong>
                Photo & video consent:
              </strong>{' '}
              {profile
                ?.media_consent
                ? 'Yes'
                : 'No'}
            </p>

          </div>
        </section>

        <section>
          <div className="row">
            <h2>
              Athletes Covered
            </h2>

            <Link href="/athletes">
              Manage athletes
            </Link>
          </div>

          {athletes.length ? (
            athletes.map(
              (athlete) => (
                <div
                  className="card"
                  key={athlete.id}
                >
                  <b>
                    {athleteName(
                      athlete
                    )}
                  </b>
                </div>
              )
            )
          ) : (
            <div className="empty">
              No athletes have been
              added yet.
            </div>
          )}
        </section>

        <Link
          className="biglink"
          href="/dashboard"
        >
          Return to Athlete Hub →
        </Link>

      </AppShell>
    )
  }

  return (
    <AppShell title="Participation Waiver">

      <section className="hero">
        <p>
          REQUIRED BEFORE TRAINING
        </p>

        <h1>
          Participation Waiver & Release
        </h1>

        <p>
          Please review and electronically
          sign the iTrainSpeed participation
          waiver for the athlete(s) associated
          with your account.
        </p>
      </section>

      {errorMsg && (
        <div
          className="notice"
          style={{
            borderColor: '#b42318',
          }}
        >
          {errorMsg}
        </div>
      )}

      {msg && (
        <div className="notice">
          {msg}
        </div>
      )}

      <section>

        <div className="row">
          <h2>
            Athletes Covered
          </h2>

          <Link href="/athletes">
            Manage athletes
          </Link>
        </div>

        {athletes.length ? (
          athletes.map(
            (athlete) => (
              <div
                className="card"
                key={athlete.id}
              >
                <b>
                  {athleteName(
                    athlete
                  )}
                </b>
              </div>
            )
          )
        ) : (
          <div className="empty">
            No athletes have been added
            yet. You may complete the
            family waiver now and add
            athletes afterward.
          </div>
        )}

      </section>

      <form onSubmit={submitWaiver}>

        <section>

          <h2>
            Assumption of Risk
          </h2>

          <div className="card">

            <p>
              I understand that athletic
              training and physical activity
              involve inherent risks,
              including, but not limited to,
              running, sprinting, jumping,
              strength training, agility
              drills, resistance training,
              use of exercise equipment, and
              other sports-performance
              activities.
            </p>

            <p>
              I understand that participation
              may result in muscle soreness,
              strains, sprains, falls,
              collisions, or other injuries
              associated with physical
              activity and athletic training.
              I voluntarily allow my
              athlete(s) to participate in
              iTrainSpeed activities with
              knowledge of these risks.
            </p>

          </div>

        </section>

        <section>

          <h2>
            Health & Participation
          </h2>

          <div className="card">

            <p>
              I represent that my athlete(s)
              are physically able to
              participate in athletic training
              and that I will notify
              iTrainSpeed of any known injury,
              physical limitation, medical
              restriction, or other condition
              that may affect safe
              participation.
            </p>

            <p>
              I understand that iTrainSpeed
              coaches may modify or stop an
              athlete&apos;s participation
              when they believe continuing an
              activity may be unsafe.
            </p>

          </div>

        </section>

        <section>

          <h2>
            Emergency Care
          </h2>

          <div className="card">

            <p>
              If I cannot be reached during an
              emergency, I authorize
              iTrainSpeed staff to take
              reasonable steps to obtain
              appropriate emergency assistance
              for my athlete, including
              contacting emergency medical
              services.
            </p>

            <p>
              I understand that I remain
              responsible for medical expenses
              associated with care provided to
              my athlete.
            </p>

          </div>

        </section>

        <section>

          <h2>
            Release & Acknowledgment
          </h2>

          <div className="card">

            <p>
              To the extent permitted by
              applicable law, I acknowledge
              and voluntarily assume the
              ordinary and inherent risks
              associated with participation in
              iTrainSpeed athletic training
              activities.
            </p>

            <p>
              I release and hold harmless
              iTrainSpeed, its owners, coaches,
              employees, contractors, and
              representatives from claims
              arising from the ordinary and
              inherent risks of participation,
              except to the extent such claims
              cannot legally be waived or
              released.
            </p>

          </div>

        </section>

        <section>

          <h2>
            Training Policies
          </h2>

          <div className="card">

            <p>
              I understand that iTrainSpeed
              maintains policies concerning
              scheduling, attendance,
              cancellations, training credits,
              athlete conduct, and use of its
              facilities and equipment.
            </p>

            <p>
              Training sessions must be
              canceled at least 6 hours before
              the scheduled start time for an
              eligible training credit to be
              returned. Late cancellations and
              no-shows may result in forfeiture
              of the applicable training
              credit. iTrainSpeed may make
              exceptions at its discretion for
              emergencies or other
              circumstances.
            </p>

          </div>

        </section>

        <section>

          <h2>
            Parent/Guardian Certification
          </h2>

          <div className="card">

            <p>
              By electronically signing below,
              I certify that I am the parent
              or legal guardian authorized to
              provide consent for the minor
              athlete(s) associated with my
              iTrainSpeed account.
            </p>

            <p>
              I have read and understand this
              Participation Waiver & Release,
              understand the inherent risks
              associated with athletic
              training, and voluntarily permit
              my athlete(s) to participate.
            </p>

            <p>
              I understand that my electronic
              signature constitutes my
              acknowledgment and acceptance of
              this agreement.
            </p>

            <p>
              This waiver applies to the minor
              athlete(s) associated with my
              iTrainSpeed account and remains
              on file unless iTrainSpeed
              requires acceptance of an
              updated version.
            </p>

            <p>
              <strong>
                Waiver Version:
              </strong>{' '}
              {WAIVER_VERSION}
            </p>

          </div>

        </section>

        <section>

          <h2>
            Electronic Signature
          </h2>

          <div className="card">

            <label
              style={{
                display: 'block',
                marginBottom: 8,
                fontWeight: 700,
              }}
            >
              Parent/Guardian Full Legal Name
            </label>

            <input
              type="text"
              value={signedName}
              onChange={(event) =>
                setSignedName(
                  event.target.value
                )
              }
              placeholder="Enter your full legal name"
              autoComplete="name"
              required
            />

            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems:
                  'flex-start',
                marginTop: 20,
              }}
            >
              <input
                type="checkbox"
                checked={
                  waiverChecked
                }
                onChange={(event) =>
                  setWaiverChecked(
                    event.target
                      .checked
                  )
                }
                style={{
                  width: 'auto',
                  marginTop: 4,
                }}
              />

              <span>
                I have read and agree to
                the iTrainSpeed
                Participation Waiver &
                Release.
              </span>
            </label>

          </div>

        </section>

        <section>

          <h2>
            Photo & Video Consent
          </h2>

          <div className="card">

            <p>
              iTrainSpeed occasionally
              photographs or records training
              sessions, athletes, events, and
              activities for educational,
              promotional, social media,
              website, and marketing purposes.
            </p>

            <p>
              Your selection does not affect
              your athlete&apos;s ability to
              participate in training.
            </p>

            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems:
                  'flex-start',
                marginTop: 16,
              }}
            >
              <input
                type="radio"
                name="mediaConsent"
                value="yes"
                checked={
                  mediaConsent ===
                  'yes'
                }
                onChange={(event) =>
                  setMediaConsent(
                    event.target
                      .value
                  )
                }
                style={{
                  width: 'auto',
                  marginTop: 4,
                }}
              />

              <span>
                <strong>
                  Yes — I consent.
                </strong>{' '}
                I authorize iTrainSpeed
                to photograph and/or
                record the minor
                athlete(s) associated
                with my account and use
                appropriate images or
                recordings for
                iTrainSpeed promotional,
                educational, website,
                social media, and
                marketing purposes.
              </span>
            </label>

            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems:
                  'flex-start',
                marginTop: 16,
              }}
            >
              <input
                type="radio"
                name="mediaConsent"
                value="no"
                checked={
                  mediaConsent ===
                  'no'
                }
                onChange={(event) =>
                  setMediaConsent(
                    event.target
                      .value
                  )
                }
                style={{
                  width: 'auto',
                  marginTop: 4,
                }}
              />

              <span>
                <strong>
                  No — I do not consent.
                </strong>{' '}
                I do not authorize
                iTrainSpeed to use
                identifiable photographs
                or video recordings of
                my minor athlete(s) for
                promotional or marketing
                purposes.
              </span>
            </label>

          </div>

        </section>

        <button
          className="primary"
          type="submit"
          disabled={saving}
        >
          {saving
            ? 'Saving...'
            : 'Accept & Sign Waiver'}
        </button>

      </form>

      <p
        style={{
          marginTop: 20,
          opacity: 0.7,
          fontSize: 13,
        }}
      >
        By selecting Accept & Sign
        Waiver, you are providing an
        electronic signature for this
        agreement.
      </p>

    </AppShell>
  )
}
