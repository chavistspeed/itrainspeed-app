import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function addDays(date, days) {
  const result = new Date(date)

  result.setUTCDate(
    result.getUTCDate() + Number(days || 0)
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

function isPromoSoldOutError(error) {
  const message =
    error?.message ||
    error?.details ||
    ''

  return String(message).includes(
    'PROMO_SOLD_OUT'
  )
}

async function refundSoldOutCheckout(
  stripe,
  session
) {
  const paymentIntentId =
    typeof session.payment_intent ===
    'string'
      ? session.payment_intent
      : session.payment_intent?.id ||
        null

  if (!paymentIntentId) {
    throw new Error(
      'Limited package sold out, but no PaymentIntent was available to refund.'
    )
  }

  /*
   * Stripe idempotency prevents duplicate
   * refunds if this webhook is delivered
   * more than once.
   */
  await stripe.refunds.create(
    {
      payment_intent:
        paymentIntentId,

      metadata: {
        reason:
          'itrainspeed_limited_package_sold_out',

        checkout_session_id:
          session.id,
      },
    },
    {
      idempotencyKey:
        `sold-out-${session.id}`,
    }
  )
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

  const now = new Date()

  let expiresAt = null

  /*
   * One-time promotions or packages may
   * expire after their configured duration.
   */
  if (
    !isSubscription &&
    durationDays > 0
  ) {
    expiresAt = addDays(
      now,
      durationDays
    )
  }

  /*
   * Stripe controls recurring subscription
   * lifecycle.
   */
  if (isSubscription) {
    expiresAt = null
  }

  /*
   * Determine whether this entitlement belongs
   * to the family or to one specific athlete.
   *
   * Track memberships are athlete-specific.
   * Group memberships such as the Founding
   * Athlete Membership are also athlete-specific.
   */
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
   * LIMITED PACKAGE
   *
   * PostgreSQL locks the package row,
   * counts successful purchases, and
   * atomically decides whether inventory
   * remains.
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

    if (limitedFulfillmentError) {
      /*
       * Rare race condition:
       *
       * Two customers may enter Stripe
       * Checkout while one limited spot is
       * still available.
       *
       * PostgreSQL allows only the first
       * successful fulfillment.
       */
      if (
        isPromoSoldOutError(
          limitedFulfillmentError
        )
      ) {
        await refundSoldOutCheckout(
          stripe,
          session
        )

        console.warn(
          'Limited package sold out after payment. Payment automatically refunded.',
          {
            checkoutSessionId:
              session.id,

            packageId:
              packageData.id,

            guardianId,
          }
        )

        return {
          refundedBecauseSoldOut:
            true,
        }
      }

      throw limitedFulfillmentError
    }
  } else {
    /*
     * Normal package fulfillment.
     *
     * Purchase + entitlement are created
     * in one PostgreSQL transaction.
     */
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

  /*
   * Save Stripe customer ID on the parent
   * profile when available.
   */
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
    refundedBecauseSoldOut:
      false,
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

async function syncSubscription(
  admin,
  subscription
) {
  const subscriptionId =
    subscription.id

  if (!subscriptionId) return

  /*
   * IMPORTANT BILLING RULE:
   *
   * Only terminal Stripe subscription states
   * revoke training access.
   *
   * Failed invoices and retry/dunning states
   * should not immediately remove an athlete's
   * access while Stripe is still attempting to
   * collect payment.
   */
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

  /*
   * Clearly active subscriptions should have
   * an active iTrainSpeed entitlement.
   *
   * This also restores access after a
   * successful payment recovery.
   */
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
   * All other non-terminal states are preserved.
   *
   * Examples can include payment retry/dunning
   * states. We intentionally do NOT change the
   * entitlement status here.
   */
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

async function handleInvoicePaid(
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
   * A successful subscription invoice restores
   * or maintains the existing entitlement.
   *
   * We update the existing row rather than
   * creating another entitlement.
   */
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
   * A failed renewal does NOT immediately
   * revoke access.
   *
   * Stripe may still retry the payment or the
   * customer may replace their payment method.
   */
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
    /*
     * Prevent duplicate Stripe webhook
     * deliveries from being processed twice.
     */
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
         * subscription. Access should now end.
         */
        await deactivateSubscription(
          admin,
          event.data.object.id
        )
        break

      case 'invoice.paid':
        /*
         * Successful initial/renewal/recovery
         * payment keeps the entitlement active.
         */
        await handleInvoicePaid(
          admin,
          event.data.object
        )
        break

      case 'invoice.payment_failed':
        /*
         * Do not revoke access merely because
         * an invoice payment failed.
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

    /*
     * Returning non-2xx tells Stripe that
     * processing failed and should be retried.
     */
    return new Response(
      'Webhook processing failed.',
      {
        status: 500,
      }
    )
  }
}
