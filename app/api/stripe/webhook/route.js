import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function addDays(date, days) {
  const result = new Date(date)

  result.setUTCDate(
    result.getUTCDate() +
      Number(days || 0)
  )

  return result.toISOString()
}

function stripeTimestampToIso(value) {
  if (!value) return null

  return new Date(
    Number(value) * 1000
  ).toISOString()
}

function getSubscriptionPeriodEnd(
  subscription
) {
  if (
    subscription?.current_period_end
  ) {
    return subscription.current_period_end
  }

  const firstItem =
    subscription?.items?.data?.[0]

  return (
    firstItem?.current_period_end ||
    null
  )
}

function getCancellationState(
  subscription
) {
  const cancelAtPeriodEnd =
    Boolean(
      subscription?.cancel_at_period_end
    )

  if (!cancelAtPeriodEnd) {
    return {
      cancel_at_period_end: false,
      cancellation_effective_at:
        null,
    }
  }

  const cancellationTimestamp =
    subscription?.cancel_at ||
    getSubscriptionPeriodEnd(
      subscription
    )

  return {
    cancel_at_period_end: true,

    cancellation_effective_at:
      stripeTimestampToIso(
        cancellationTimestamp
      ),
  }
}

function createAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}

async function eventAlreadyProcessed(
  admin,
  eventId
) {
  const { data, error } = await admin
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', eventId)
    .maybeSingle()

  if (error) throw error

  return Boolean(data)
}

async function markEventProcessed(
  admin,
  event
) {
  const { error } = await admin
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
    })

  if (
    error &&
    error.code !== '23505'
  ) {
    throw error
  }
}

function errorContains(
  error,
  value
) {
  const message = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ]
    .filter(Boolean)
    .join(' ')

  return String(message).includes(
    value
  )
}

function isPromoSoldOutError(
  error
) {
  return errorContains(
    error,
    'PROMO_SOLD_OUT'
  )
}

function isAthleteAlreadyEnrolledError(
  error
) {
  return errorContains(
    error,
    'ATHLETE_ALREADY_ENROLLED'
  )
}

/*
 * -------------------------------------------------------
 * EMAIL HELPERS
 * -------------------------------------------------------
 */

function escapeHtml(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return ''
  }

  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatMoney(cents) {
  const amount =
    Number(cents || 0) / 100

  return new Intl.NumberFormat(
    'en-US',
    {
      style: 'currency',
      currency: 'USD',
    }
  ).format(amount)
}

function formatPurchaseDate(
  dateValue = new Date()
) {
  try {
    return new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }
    ).format(new Date(dateValue))
  } catch {
    return new Date(
      dateValue
    ).toISOString()
  }
}

function getPaymentTypeLabel(
  packageData
) {
  if (
    packageData.payment_type ===
    'subscription'
  ) {
    return 'Recurring Membership'
  }

  return 'One-Time Purchase'
}

async function sendPurchaseNotification(
  admin,
  session,
  packageData
) {
  /*
   * Email should never interfere with payment
   * fulfillment. If SMTP fails, we log the failure
   * but do not throw back into Stripe processing.
   */

  try {
    const smtpHost =
      process.env.SMTP_HOST

    const smtpUser =
      process.env.SMTP_USER

    const smtpPass =
      process.env.SMTP_PASS

    const ownerEmail =
      process.env
        .OWNER_NOTIFICATION_EMAIL ||
      'chavis@itrainspeed.com'

    if (
      !smtpHost ||
      !smtpUser ||
      !smtpPass
    ) {
      console.warn(
        'Purchase notification skipped because SMTP configuration is incomplete.'
      )

      return
    }

    const guardianId =
      session.metadata?.guardian_id

    const athleteId =
      session.metadata?.athlete_id ||
      null

    let guardianName =
      'Parent / Guardian'

    let guardianEmail =
      session.customer_details?.email ||
      session.customer_email ||
      'Not available'

    if (guardianId) {
      const {
        data: guardian,
        error: guardianError,
      } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', guardianId)
        .maybeSingle()

      if (guardianError) {
        console.warn(
          'Unable to retrieve guardian for purchase notification:',
          guardianError.message
        )
      }

      if (guardian?.full_name) {
        guardianName =
          guardian.full_name
      }
    }

    let athleteName =
      'Family / Shared Access'

    if (athleteId) {
      const {
        data: athlete,
        error: athleteError,
      } = await admin
        .from('athletes')
        .select(
          'first_name, last_name'
        )
        .eq('id', athleteId)
        .maybeSingle()

      if (athleteError) {
        console.warn(
          'Unable to retrieve athlete for purchase notification:',
          athleteError.message
        )
      }

      if (athlete) {
        athleteName = [
          athlete.first_name,
          athlete.last_name,
        ]
          .filter(Boolean)
          .join(' ')
          .trim()

        if (!athleteName) {
          athleteName =
            'Athlete-specific Access'
        }
      }
    }

    const amountPaid =
      session.amount_total ??
      packageData.price_cents ??
      0

    const amount =
      formatMoney(amountPaid)

    const packageName =
      packageData.name ||
      'iTrainSpeed Training'

    const paymentType =
      getPaymentTypeLabel(
        packageData
      )

    const purchaseTime =
      formatPurchaseDate(
        session.created
          ? Number(
              session.created
            ) * 1000
          : new Date()
      )

    const safeGuardianName =
      escapeHtml(guardianName)

    const safeGuardianEmail =
      escapeHtml(guardianEmail)

    const safeAthleteName =
      escapeHtml(athleteName)

    const safePackageName =
      escapeHtml(packageName)

    const safePaymentType =
      escapeHtml(paymentType)

    const safeAmount =
      escapeHtml(amount)

    const safePurchaseTime =
      escapeHtml(purchaseTime)

    const transporter =
      nodemailer.createTransport({
        host: smtpHost,
        port: 465,
        secure: true,

        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      })

    const subject =
      `💰 New iTrainSpeed Purchase — ${amount}`

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
            font-family: Arial, Helvetica, sans-serif;
            color: #111111;
          "
        >
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="
              width: 100%;
              background-color: #f4f4f4;
              padding: 30px 15px;
            "
          >
            <tr>
              <td align="center">

                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="
                    max-width: 600px;
                    background-color: #ffffff;
                    border-radius: 14px;
                    overflow: hidden;
                  "
                >

                  <tr>
                    <td
                      style="
                        background-color: #000000;
                        padding: 28px 30px;
                        text-align: center;
                      "
                    >
                      <div
                        style="
                          color: #ffffff;
                          font-size: 28px;
                          font-weight: 800;
                          letter-spacing: -1px;
                        "
                      >
                        <span
                          style="
                            color: #e10600;
                          "
                        >
                          i
                        </span>TrainSpeed
                      </div>

                      <div
                        style="
                          margin-top: 7px;
                          color: #bdbdbd;
                          font-size: 11px;
                          font-weight: 700;
                          letter-spacing: 2px;
                        "
                      >
                        TRAIN. TRACK. DEVELOP.
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td
                      style="
                        padding: 34px 32px;
                      "
                    >

                      <div
                        style="
                          font-size: 12px;
                          font-weight: 800;
                          color: #e10600;
                          text-transform: uppercase;
                          letter-spacing: 1.5px;
                          margin-bottom: 10px;
                        "
                      >
                        New Purchase
                      </div>

                      <h1
                        style="
                          margin: 0 0 8px 0;
                          font-size: 32px;
                          line-height: 1.2;
                          color: #111111;
                        "
                      >
                        ${safeAmount}
                      </h1>

                      <p
                        style="
                          margin: 0 0 28px 0;
                          color: #666666;
                          font-size: 15px;
                          line-height: 1.6;
                        "
                      >
                        A successful iTrainSpeed purchase has been completed.
                      </p>

                      <table
                        role="presentation"
                        width="100%"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="
                          width: 100%;
                          border: 1px solid #e5e5e5;
                          border-radius: 10px;
                          margin-bottom: 20px;
                        "
                      >

                        <tr>
                          <td
                            colspan="2"
                            style="
                              padding: 15px 18px;
                              background-color: #f8f8f8;
                              font-size: 13px;
                              font-weight: 800;
                              text-transform: uppercase;
                              letter-spacing: 1px;
                            "
                          >
                            Purchase
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Training
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            ${safePackageName}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Amount
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            ${safeAmount}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Type
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            ${safePaymentType}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Status
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            Paid
                          </td>
                        </tr>

                      </table>

                      <table
                        role="presentation"
                        width="100%"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="
                          width: 100%;
                          border: 1px solid #e5e5e5;
                          border-radius: 10px;
                          margin-bottom: 20px;
                        "
                      >

                        <tr>
                          <td
                            colspan="2"
                            style="
                              padding: 15px 18px;
                              background-color: #f8f8f8;
                              font-size: 13px;
                              font-weight: 800;
                              text-transform: uppercase;
                              letter-spacing: 1px;
                            "
                          >
                            Customer
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Parent
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            ${safeGuardianName}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Email
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            ${safeGuardianEmail}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              color: #777777;
                              font-size: 14px;
                            "
                          >
                            Athlete
                          </td>

                          <td
                            align="right"
                            style="
                              padding: 14px 18px;
                              border-top: 1px solid #eeeeee;
                              font-size: 14px;
                              font-weight: 700;
                            "
                          >
                            ${safeAthleteName}
                          </td>
                        </tr>

                      </table>

                      <div
                        style="
                          background-color: #111111;
                          color: #ffffff;
                          padding: 18px;
                          border-radius: 10px;
                        "
                      >
                        <div
                          style="
                            color: #999999;
                            font-size: 11px;
                            font-weight: 800;
                            text-transform: uppercase;
                            letter-spacing: 1px;
                            margin-bottom: 6px;
                          "
                        >
                          Purchased
                        </div>

                        <div
                          style="
                            font-size: 15px;
                            font-weight: 700;
                          "
                        >
                          ${safePurchaseTime}
                        </div>
                      </div>

                    </td>
                  </tr>

                  <tr>
                    <td
                      style="
                        padding: 22px 30px;
                        background-color: #f8f8f8;
                        text-align: center;
                        color: #888888;
                        font-size: 12px;
                        line-height: 1.6;
                      "
                    >
                      iTrainSpeed Owner Notification
                      <br />
                      TRAIN. TRACK. DEVELOP.
                    </td>
                  </tr>

                </table>

              </td>
            </tr>
          </table>
        </body>
      </html>
    `

    const text = `
NEW iTRAINSPEED PURCHASE

Amount: ${amount}
Training: ${packageName}
Type: ${paymentType}
Status: Paid

CUSTOMER
Parent: ${guardianName}
Email: ${guardianEmail}
Athlete: ${athleteName}

Purchased:
${purchaseTime}

iTrainSpeed
TRAIN. TRACK. DEVELOP.
    `.trim()

    await transporter.sendMail({
      from:
        `"iTrainSpeed" <${smtpUser}>`,

      to: ownerEmail,

      replyTo:
        guardianEmail !==
        'Not available'
          ? guardianEmail
          : smtpUser,

      subject,
      text,
      html,
    })

    console.log(
      'Purchase notification sent.',
      {
        checkoutSessionId:
          session.id,

        guardianId,

        athleteId,

        packageId:
          packageData.id,

        amountPaid,
      }
    )
  } catch (error) {
    /*
     * Deliberately do not throw.
     *
     * A notification problem should NEVER cause
     * Stripe to retry an otherwise successful
     * purchase fulfillment.
     */
    console.error(
      'Purchase notification failed:',
      error
    )
  }
}

/*
 * -------------------------------------------------------
 * FAILED LIMITED MEMBERSHIP RECOVERY
 * -------------------------------------------------------
 */

async function cancelAndRefundRejectedCheckout(
  stripe,
  session,
  reason
) {
  const subscriptionId =
    typeof session.subscription ===
    'string'
      ? session.subscription
      : session.subscription?.id ||
        null

  if (subscriptionId) {
    let subscription = null

    try {
      subscription =
        await stripe.subscriptions.retrieve(
          subscriptionId,
          {
            expand: [
              'latest_invoice.payment_intent',
            ],
          }
        )
    } catch (error) {
      console.error(
        'Unable to retrieve rejected Stripe subscription:',
        {
          subscriptionId,
          checkoutSessionId:
            session.id,
          error:
            error?.message ||
            error,
        }
      )

      throw error
    }

    const latestInvoice =
      typeof subscription.latest_invoice ===
      'object'
        ? subscription.latest_invoice
        : null

    let paymentIntentId = null

    if (latestInvoice) {
      paymentIntentId =
        typeof latestInvoice.payment_intent ===
        'string'
          ? latestInvoice.payment_intent
          : latestInvoice
              .payment_intent?.id ||
            null
    }

    if (
      subscription.status !==
      'canceled'
    ) {
      await stripe.subscriptions.cancel(
        subscriptionId,
        {
          prorate: false,
        }
      )
    }

    if (paymentIntentId) {
      await stripe.refunds.create(
        {
          payment_intent:
            paymentIntentId,

          metadata: {
            reason,
            checkout_session_id:
              session.id,
            subscription_id:
              subscriptionId,
          },
        },
        {
          idempotencyKey:
            `rejected-membership-refund-${session.id}`,
        }
      )
    } else {
      throw new Error(
        'Rejected subscription was cancelled, but its successful payment could not be located for refund.'
      )
    }

    return {
      subscriptionCancelled:
        true,
      refunded: true,
    }
  }

  const paymentIntentId =
    typeof session.payment_intent ===
    'string'
      ? session.payment_intent
      : session.payment_intent?.id ||
        null

  if (!paymentIntentId) {
    throw new Error(
      'Rejected Checkout session did not contain a PaymentIntent to refund.'
    )
  }

  await stripe.refunds.create(
    {
      payment_intent:
        paymentIntentId,

      metadata: {
        reason,
        checkout_session_id:
          session.id,
      },
    },
    {
      idempotencyKey:
        `rejected-checkout-refund-${session.id}`,
    }
  )

  return {
    subscriptionCancelled:
      false,
    refunded: true,
  }
}

async function fulfillCheckout(
  admin,
  stripe,
  session
) {
  const packageId =
    session.metadata?.package_id

  const guardianId =
    session.metadata?.guardian_id

  const athleteId =
    session.metadata?.athlete_id ||
    null

  if (
    !packageId ||
    !guardianId
  ) {
    throw new Error(
      'Checkout session is missing iTrainSpeed metadata.'
    )
  }

  const {
    data: packageData,
    error: packageError,
  } = await admin
    .from('packages')
    .select('*')
    .eq('id', packageId)
    .single()

  if (
    packageError ||
    !packageData
  ) {
    throw new Error(
      'Package could not be found.'
    )
  }

  const creditType =
    packageData.credit_type

  const isSubscription =
    packageData.payment_type ===
    'subscription'

  const subscriptionId =
    typeof session.subscription ===
    'string'
      ? session.subscription
      : session.subscription?.id ||
        null

  const paymentIntentId =
    typeof session.payment_intent ===
    'string'
      ? session.payment_intent
      : session.payment_intent?.id ||
        null

  const customerId =
    typeof session.customer ===
    'string'
      ? session.customer
      : session.customer?.id ||
        null

  const amountPaid =
    session.amount_total ??
    packageData.price_cents

  const credits =
    Number(
      packageData.credits || 0
    )

  const unlimited =
    packageData.access_type ===
      'unlimited' ||
    packageData.access_type ===
      'promotion' ||
    packageData.access_type ===
      'membership' ||
    credits === 0

  const durationDays =
    Number(
      packageData.duration_days || 0
    )

  let expiresAt = null

  if (
    !isSubscription &&
    durationDays > 0
  ) {
    expiresAt = addDays(
      new Date(),
      durationDays
    )
  }

  if (isSubscription) {
    expiresAt = null
  }

  const requiresAthlete =
    creditType === 'track' ||
    (
      creditType === 'group' &&
      packageData.access_type ===
        'membership'
    )

  if (
    requiresAthlete &&
    !athleteId
  ) {
    throw new Error(
      'Athlete-specific membership is missing its athlete.'
    )
  }

  const entitlementAthleteId =
    requiresAthlete
      ? athleteId
      : null

  const hasPurchaseLimit =
    packageData.purchase_limit !==
      null &&
    Number(
      packageData.purchase_limit
    ) > 0

  if (hasPurchaseLimit) {
    const {
      error: limitedFulfillmentError,
    } = await admin.rpc(
      'fulfill_limited_promo_checkout_v1',
      {
        p_guardian_id:
          guardianId,

        p_athlete_id:
          entitlementAthleteId,

        p_package_id:
          packageData.id,

        p_package_key:
          packageData.name,

        p_credit_type:
          creditType,

        p_expires_at:
          expiresAt,

        p_checkout_session_id:
          session.id,

        p_payment_intent_id:
          paymentIntentId,

        p_subscription_id:
          subscriptionId,

        p_customer_id:
          customerId,

        p_amount_paid_cents:
          amountPaid,
      }
    )

    if (
      limitedFulfillmentError
    ) {
      if (
        isPromoSoldOutError(
          limitedFulfillmentError
        )
      ) {
        await cancelAndRefundRejectedCheckout(
          stripe,
          session,
          'itrainspeed_limited_package_sold_out'
        )

        console.warn(
          'Limited package sold out after payment. Subscription/payment automatically cancelled and refunded.',
          {
            checkoutSessionId:
              session.id,

            subscriptionId,

            packageId:
              packageData.id,

            guardianId,

            athleteId:
              entitlementAthleteId,
          }
        )

        return {
          rejected: true,
          reason:
            'PROMO_SOLD_OUT',
          packageData,
        }
      }

      if (
        isAthleteAlreadyEnrolledError(
          limitedFulfillmentError
        )
      ) {
        await cancelAndRefundRejectedCheckout(
          stripe,
          session,
          'itrainspeed_athlete_already_enrolled'
        )

        console.warn(
          'Duplicate athlete membership reached payment. Duplicate subscription/payment automatically cancelled and refunded.',
          {
            checkoutSessionId:
              session.id,

            subscriptionId,

            packageId:
              packageData.id,

            guardianId,

            athleteId:
              entitlementAthleteId,
          }
        )

        return {
          rejected: true,
          reason:
            'ATHLETE_ALREADY_ENROLLED',
          packageData,
        }
      }

      throw limitedFulfillmentError
    }
  } else {
    const {
      error: fulfillmentError,
    } = await admin.rpc(
      'fulfill_stripe_checkout_v1',
      {
        p_guardian_id:
          guardianId,

        p_athlete_id:
          entitlementAthleteId,

        p_package_id:
          packageData.id,

        p_package_key:
          packageData.name,

        p_credit_type:
          creditType,

        p_credits:
          credits,

        p_unlimited:
          unlimited,

        p_expires_at:
          expiresAt,

        p_checkout_session_id:
          session.id,

        p_payment_intent_id:
          paymentIntentId,

        p_subscription_id:
          subscriptionId,

        p_customer_id:
          customerId,

        p_amount_paid_cents:
          amountPaid,
      }
    )

    if (fulfillmentError) {
      throw fulfillmentError
    }
  }

  if (customerId) {
    const { error } = await admin
      .from('profiles')
      .update({
        stripe_customer_id:
          customerId,
      })
      .eq('id', guardianId)

    if (error) throw error
  }

  return {
    rejected: false,
    packageData,
  }
}

/*
 * -------------------------------------------------------
 * REFUND TRACKING
 * -------------------------------------------------------
 *
 * charge.refunded is the source of truth for refunds.
 *
 * We record the cumulative amount Stripe says has been
 * refunded against the charge.
 *
 * IMPORTANT:
 * This version deliberately does NOT delete or alter an
 * entitlement. Purchases and entitlements do not yet
 * have a direct purchase_id relationship, so guessing
 * which entitlement belongs to a refund could revoke
 * the wrong customer's credits when the same package
 * has been purchased multiple times.
 */

async function handleChargeRefunded(
  admin,
  charge
) {
  const paymentIntentId =
    typeof charge.payment_intent ===
    'string'
      ? charge.payment_intent
      : charge.payment_intent?.id ||
        null

  if (!paymentIntentId) {
    console.warn(
      'Refunded charge did not contain a PaymentIntent.',
      {
        chargeId: charge.id,
      }
    )

    return
  }

  const {
    data: purchase,
    error: purchaseError,
  } = await admin
    .from('purchases')
    .select(
      'id, amount_cents, stripe_payment_intent_id'
    )
    .eq(
      'stripe_payment_intent_id',
      paymentIntentId
    )
    .maybeSingle()

  if (purchaseError) {
    throw purchaseError
  }

  if (!purchase) {
    console.warn(
      'Stripe refund received with no matching iTrainSpeed purchase.',
      {
        chargeId: charge.id,
        paymentIntentId,
      }
    )

    return
  }

  const refundedAmount =
    Number(
      charge.amount_refunded || 0
    )

  const purchaseAmount =
    Number(
      purchase.amount_cents || 0
    )

  const isFullRefund =
    Boolean(charge.refunded) ||
    (
      purchaseAmount > 0 &&
      refundedAmount >=
        purchaseAmount
    )

  const refundStatus =
    isFullRefund
      ? 'full'
      : 'partial'

  const updates = {
    refunded_amount_cents:
      refundedAmount,

    refund_status:
      refundStatus,

    refunded_at:
      new Date().toISOString(),
  }

  const { error: updateError } =
    await admin
      .from('purchases')
      .update(updates)
      .eq('id', purchase.id)

  if (updateError) {
    throw updateError
  }

  console.log(
    'Stripe refund recorded.',
    {
      purchaseId: purchase.id,
      paymentIntentId,
      refundedAmount,
      refundStatus,
    }
  )
}

/*
 * -------------------------------------------------------
 * SUBSCRIPTION STATE
 * -------------------------------------------------------
 */

async function activateSubscription(
  admin,
  subscription
) {
  const subscriptionId =
    subscription.id

  if (!subscriptionId) return

  const cancellationState =
    getCancellationState(
      subscription
    )

  const { error } = await admin
    .from('entitlements')
    .update({
      status: 'active',

      expires_at: null,

      cancel_at_period_end:
        cancellationState
          .cancel_at_period_end,

      cancellation_effective_at:
        cancellationState
          .cancellation_effective_at,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'stripe_subscription_id',
      subscriptionId
    )

  if (error) throw error
}

async function deactivateSubscription(
  admin,
  subscriptionId
) {
  if (!subscriptionId) return

  const now =
    new Date().toISOString()

  const { error } = await admin
    .from('entitlements')
    .update({
      status: 'cancelled',

      expires_at: now,

      cancel_at_period_end:
        false,

      cancellation_effective_at:
        null,

      updated_at: now,
    })
    .eq(
      'stripe_subscription_id',
      subscriptionId
    )

  if (error) throw error
}

async function touchSubscription(
  admin,
  subscription
) {
  const subscriptionId =
    typeof subscription ===
    'string'
      ? subscription
      : subscription?.id

  if (!subscriptionId) return

  const updates = {
    updated_at:
      new Date().toISOString(),
  }

  if (
    typeof subscription ===
    'object'
  ) {
    const cancellationState =
      getCancellationState(
        subscription
      )

    updates.cancel_at_period_end =
      cancellationState
        .cancel_at_period_end

    updates.cancellation_effective_at =
      cancellationState
        .cancellation_effective_at
  }

  const { error } = await admin
    .from('entitlements')
    .update(updates)
    .eq(
      'stripe_subscription_id',
      subscriptionId
    )

  if (error) throw error
}

async function syncSubscription(
  admin,
  subscription
) {
  const subscriptionId =
    subscription.id

  if (!subscriptionId) return

  const terminalStatuses = [
    'canceled',
    'unpaid',
    'incomplete_expired',
  ]

  if (
    terminalStatuses.includes(
      subscription.status
    )
  ) {
    await deactivateSubscription(
      admin,
      subscriptionId
    )

    return
  }

  const activeStatuses = [
    'active',
    'trialing',
  ]

  if (
    activeStatuses.includes(
      subscription.status
    )
  ) {
    await activateSubscription(
      admin,
      subscription
    )

    return
  }

  await touchSubscription(
    admin,
    subscription
  )
}

async function handleInvoicePaid(
  admin,
  stripe,
  invoice
) {
  const subscriptionId =
    typeof invoice.subscription ===
    'string'
      ? invoice.subscription
      : invoice.subscription?.id ||
        null

  if (!subscriptionId) return

  let subscription

  try {
    subscription =
      await stripe.subscriptions.retrieve(
        subscriptionId
      )
  } catch (error) {
    console.warn(
      'Paid invoice received, but Stripe subscription could not be retrieved. Access was not restored.',
      {
        subscriptionId,
        invoiceId: invoice.id,
      }
    )

    return
  }

  const restorableStatuses = [
    'active',
    'trialing',
    'past_due',
  ]

  if (
    !restorableStatuses.includes(
      subscription.status
    )
  ) {
    console.warn(
      'Paid invoice received for a subscription that is not eligible for access restoration.',
      {
        subscriptionId,
        invoiceId: invoice.id,
        subscriptionStatus:
          subscription.status,
      }
    )

    return
  }

  if (
    subscription.status ===
    'past_due'
  ) {
    await touchSubscription(
      admin,
      subscription
    )

    return
  }

  await activateSubscription(
    admin,
    subscription
  )
}

async function handleInvoicePaymentFailed(
  admin,
  stripe,
  invoice
) {
  const subscriptionId =
    typeof invoice.subscription ===
    'string'
      ? invoice.subscription
      : invoice.subscription?.id ||
        null

  if (!subscriptionId) return

  try {
    const subscription =
      await stripe.subscriptions.retrieve(
        subscriptionId
      )

    await touchSubscription(
      admin,
      subscription
    )
  } catch (error) {
    await touchSubscription(
      admin,
      subscriptionId
    )
  }
}

export async function POST(
  request
) {
  if (
    !process.env
      .STRIPE_SECRET_KEY ||
    !process.env
      .STRIPE_WEBHOOK_SECRET ||
    !process.env
      .SUPABASE_SERVICE_ROLE_KEY
  ) {
    return new Response(
      'Webhook server configuration is incomplete.',
      {
        status: 500,
      }
    )
  }

  const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY
  )

  const signature =
    request.headers.get(
      'stripe-signature'
    )

  if (!signature) {
    return new Response(
      'Missing Stripe signature.',
      {
        status: 400,
      }
    )
  }

  const body =
    await request.text()

  let event

  try {
    event =
      stripe.webhooks.constructEvent(
        body,
        signature,
        process.env
          .STRIPE_WEBHOOK_SECRET
      )
  } catch (error) {
    console.error(
      'Stripe webhook signature error:',
      error
    )

    return new Response(
      `Webhook signature verification failed: ${error.message}`,
      {
        status: 400,
      }
    )
  }

  const admin = createAdmin()

  try {
    if (
      await eventAlreadyProcessed(
        admin,
        event.id
      )
    ) {
      return Response.json({
        received: true,
        duplicate: true,
      })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session =
          event.data.object

        const result =
          await fulfillCheckout(
            admin,
            stripe,
            session
          )

        /*
         * Send the owner notification ONLY when
         * fulfillment was accepted.
         *
         * Rejected limited memberships are cancelled
         * and refunded and must not generate a false
         * "new purchase" notification.
         */
        if (
          !result?.rejected &&
          result?.packageData
        ) {
          await sendPurchaseNotification(
            admin,
            session,
            result.packageData
          )
        }

        break
      }

      case 'charge.refunded':
        await handleChargeRefunded(
          admin,
          event.data.object
        )
        break

      case 'customer.subscription.updated':
        await syncSubscription(
          admin,
          event.data.object
        )
        break

      case 'customer.subscription.deleted':
        await deactivateSubscription(
          admin,
          event.data.object.id
        )
        break

      case 'invoice.paid':
        await handleInvoicePaid(
          admin,
          stripe,
          event.data.object
        )
        break

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(
          admin,
          stripe,
          event.data.object
        )
        break

      default:
        break
    }

    await markEventProcessed(
      admin,
      event
    )

    return Response.json({
      received: true,
    })
  } catch (error) {
    console.error(
      'Stripe webhook processing error:',
      error
    )

    return new Response(
      'Webhook processing failed.',
      {
        status: 500,
      }
    )
  }
}
