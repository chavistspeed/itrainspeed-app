import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

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
 * FAILED LIMITED MEMBERSHIP RECOVERY
 * -------------------------------------------------------
 *
 * This protects against the rare race condition where
 * multiple customers enter Stripe Checkout while only
 * one limited membership spot remains.
 *
 * For one-time payments:
 *   Refund the Checkout PaymentIntent.
 *
 * For subscriptions:
 *   1. Retrieve the subscription.
 *   2. Find the successful payment from its latest invoice.
 *   3. Cancel the subscription immediately.
 *   4. Refund that successful payment.
 *
 * The operation is idempotent so Stripe webhook retries
 * cannot intentionally create multiple refunds.
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

  /*
   * -----------------------------------------------------
   * SUBSCRIPTION CHECKOUT
   * -----------------------------------------------------
   */
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

    /*
     * Cancel first so the rejected membership
     * cannot renew in the future.
     *
     * We intentionally do not prorate or create
     * a cancellation invoice because this
     * membership was never successfully
     * fulfilled by iTrainSpeed.
     */
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

    /*
     * If the initial subscription payment
     * succeeded, refund it.
     */
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
      /*
       * A completed Checkout session should normally
       * have a successful first invoice for this
       * membership. If Stripe does not expose a
       * PaymentIntent, throw so Stripe retries the
       * webhook rather than silently marking this
       * event complete without a refund.
       */
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

  /*
   * -----------------------------------------------------
   * ONE-TIME CHECKOUT
   * -----------------------------------------------------
   */

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

  /*
   * Stripe controls recurring subscription
   * expiration/cancellation.
   */
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

  /*
   * -----------------------------------------------------
   * LIMITED PACKAGE FULFILLMENT
   * -----------------------------------------------------
   *
   * The database transaction is the final authority
   * for both:
   *
   * - permanent limited-package capacity
   * - duplicate active athlete enrollment
   */
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
      /*
       * Race condition #1:
       * Customer paid just after the final
       * available limited spot was claimed.
       */
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
        }
      }

      /*
       * Race condition #2:
       * Two Checkout sessions for the same
       * athlete complete nearly simultaneously.
       *
       * The database accepts the first and
       * rejects the duplicate.
       */
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
  }
}

async function activateSubscription(
  admin,
  subscription
) {
  const subscriptionId =
    subscription.id

  if (!subscriptionId) return

  const { error } = await admin
    .from('entitlements')
    .update({
      status: 'active',
      expires_at: null,
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
  subscriptionId
) {
  if (!subscriptionId) return

  const { error } = await admin
    .from('entitlements')
    .update({
      updated_at:
        new Date().toISOString(),
    })
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

  /*
   * Only terminal Stripe states revoke
   * training access.
   */
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

  /*
   * Preserve access during non-terminal
   * billing states such as past_due.
   */
  await touchSubscription(
    admin,
    subscriptionId
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

  /*
   * IMPORTANT:
   *
   * A paid invoice alone is not enough to
   * restore membership access.
   *
   * Verify that the Stripe subscription
   * itself still exists and is in an
   * access-eligible state.
   */
  let subscription

  try {
    subscription =
      await stripe.subscriptions.retrieve(
        subscriptionId
      )
  } catch (error) {
    /*
     * If Stripe no longer has an active
     * subscription, do not restore access.
     */
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

  await activateSubscription(
    admin,
    subscription
  )
}

async function handleInvoicePaymentFailed(
  admin,
  invoice
) {
  const subscriptionId =
    typeof invoice.subscription ===
    'string'
      ? invoice.subscription
      : invoice.subscription?.id ||
        null

  if (!subscriptionId) return

  /*
   * Do not revoke access for an individual
   * failed payment. Stripe may still retry.
   */
  await touchSubscription(
    admin,
    subscriptionId
  )
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
      case 'checkout.session.completed':
        await fulfillCheckout(
          admin,
          stripe,
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
        /*
         * Stripe has actually terminated the
         * recurring subscription.
         */
        await deactivateSubscription(
          admin,
          event.data.object.id
        )
        break

      case 'invoice.paid':
        /*
         * Verify the subscription itself before
         * restoring access.
         */
        await handleInvoicePaid(
          admin,
          stripe,
          event.data.object
        )
        break

      case 'invoice.payment_failed':
        /*
         * Preserve access during Stripe's
         * payment retry/dunning period.
         */
        await handleInvoicePaymentFailed(
          admin,
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
