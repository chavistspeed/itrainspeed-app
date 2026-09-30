'use client'

import Link from 'next/link'

export default function SupportPage() {
  return (
    <>
      <main>
        <div className="pageTitleRow">
          <div>
            <p
              style={{
                color: '#e5484d',
                fontWeight: 800,
                fontSize: 12,
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '.08em',
              }}
            >
              iTrainSpeed Support
            </p>

            <h1 style={{ marginBottom: 8 }}>
              Help & Policies
            </h1>

            <p className="subtle">
              Everything you need to know about booking,
              cancellations, training credits, memberships,
              and account support.
            </p>
          </div>
        </div>

        <div className="supportGrid">

          {/* BOOKING */}
          <section className="card supportCard">
            <h2>Booking Training</h2>

            <p>
              Available training sessions are based on the
              active training access associated with your
              account or athlete.
            </p>

            <p>
              Select your athlete, choose an available
              session, and use the appropriate training
              credit or membership to reserve the spot.
            </p>

            <Link
              href="/booking"
              className="miniCta"
              style={{ marginTop: 10 }}
            >
              Book Training
            </Link>
          </section>


          {/* CANCELLATIONS */}
          <section className="card supportCard">
            <h2>Session Cancellations</h2>

            <p>
              Training sessions must be canceled at least
              <strong> 6 hours before the scheduled start
              time </strong>
              for the training credit to be returned to
              your account.
            </p>

            <p>
              Cancellations made within 6 hours of the
              scheduled start time, including no-shows,
              will result in the training credit being
              forfeited.
            </p>

            <p className="subtle">
              iTrainSpeed may make exceptions at its
              discretion for emergencies or other
              circumstances.
            </p>
          </section>


          {/* CREDITS */}
          <section className="card supportCard">
            <h2>Training Credits</h2>

            <p>
              Eligible group and private training packages
              provide credits that can be used to reserve
              the corresponding type of training session.
            </p>

            <p>
              Group and private training credits purchased
              for a family account may be shared among
              athletes on that account when the package
              allows family-shared access.
            </p>

            <p>
              Athlete-specific memberships and programs
              can only be used by the athlete assigned to
              that membership.
            </p>
          </section>


          {/* MEMBERSHIPS */}
          <section className="card supportCard">
            <h2>Memberships</h2>

            <p>
              Active memberships provide access according
              to the training program included with that
              membership.
            </p>

            <p>
              Recurring memberships may be canceled through
              the billing portal. Cancellation takes effect
              at the end of the current paid billing period.
            </p>

            <Link
              href="/plans"
              className="miniCta"
              style={{ marginTop: 10 }}
            >
              View Training Plans
            </Link>
          </section>


          {/* FOUNDING ATHLETE */}
          <section className="card supportCard">
            <h2>Founding Athlete Membership</h2>

            <p>
              The Founding Athlete Membership provides
              unlimited eligible Group Training for
              <strong> $175 per month </strong>
              and is limited to the first 10 eligible
              athlete memberships.
            </p>

            <p>
              The $175 monthly Founding Athlete rate remains
              available to that athlete while the
              membership remains continuously active.
            </p>

            <p>
              If the membership is canceled, the
              grandfathered Founding Athlete rate is
              forfeited and may not be available again.
            </p>
          </section>


          {/* TRACK */}
          <section className="card supportCard">
            <h2>Off-Season Track & Field</h2>

            <p>
              Off-Season Track & Field memberships are
              athlete-specific and provide unlimited access
              to eligible Track & Field training sessions
              while the membership is active.
            </p>

            <p>
              Track & Field membership access cannot be
              transferred between athletes.
            </p>
          </section>


          {/* BILLING */}
          <section className="card supportCard">
            <h2>Billing & Purchases</h2>

            <p>
              Training packages and memberships are
              purchased securely through the iTrainSpeed
              checkout experience.
            </p>

            <p>
              Recurring membership billing and payment
              method management can be handled through your
              billing portal.
            </p>

            <p className="subtle">
              If you believe there is an issue with a
              payment or purchase, contact iTrainSpeed
              before making another purchase.
            </p>
          </section>


          {/* SUPPORT */}
          <section className="card supportCard">
            <h2>Need Help?</h2>

            <p>
              Having trouble with your account, athlete
              profile, booking, training credits, or
              billing?
            </p>

            <p>
              Contact iTrainSpeed support and include the
              name of the athlete associated with the
              account when applicable.
            </p>

            <a
              href="mailto:chavis@itrainspeed.com"
              className="ctaLink"
              style={{ marginTop: 10 }}
            >
              Email iTrainSpeed Support
            </a>

            <p
              style={{
                marginTop: 14,
                fontWeight: 800,
              }}
            >
              chavis@itrainspeed.com
            </p>
          </section>

        </div>


        {/* FOOTER NOTE */}
        <section
          className="card"
          style={{
            marginTop: 24,
            textAlign: 'center',
          }}
        >
          <strong>iTrainSpeed</strong>

          <p
            className="subtle"
            style={{
              margin: '8px auto 0',
            }}
          >
            Train with purpose. Move with intent.
            Develop speed that transfers to sport.
          </p>
        </section>
      </main>
    </>
  )
}
