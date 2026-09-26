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

async function fulfillCheckout(
  admin,
  session
) {
  const packageId =
    session.metadata?.package_id

  const guardianId =
    session.metadata?.guardian_id

  const athleteId =
    session.metadata?.athlete_id || null

  if (!packageId || !guardianId) {
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
    credits === 0

  const durationDays =
    Number(
      packageData.duration_days || 0
    )

  const now = new Date()

  let expiresAt = null

  /*
   * One-time promotions may expire after
   * their configured number of days.
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
   * Stripe controls the lifecycle of
   * recurring subscriptions.
   */
  if (isSubscription) {
    expiresAt = null
  }

  /*
   * Track memberships must belong to one
   * specific athlete.
   */
  if (
    creditType === 'track' &&
    !athleteId
  ) {
    throw new Error(
      'Track membership is missing its athlete.'
    )
  }

  const entitlementAthleteId =
    creditType === 'track'
      ? athleteId
      : null

  /*
   * Purchase + entitlement are created in
   * one PostgreSQL transaction.
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
  const activeStatuses = [
    'active',
    'trialing',
  ]

  /*
   * Keep access active for active/trialing
   * subscriptions.
   *
   * A subscription set to cancel at period
   * end normally remains "active" until the
   * paid period actually finishes.
   */
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
   * These statuses should not retain access.
   */
  if (
    [
      'canceled',
      'unpaid',
      'incomplete_expired',
    ].includes(
      subscription.status
    )
  ) {
    await deactivateSubscription(
      admin,
      subscription.id
    )
  }

  /*
   * We intentionally do not immediately
   * deactivate "past_due" here. Stripe may
   * still be retrying the customer's card.
   * invoice.payment_failed is recorded below
   * without instantly removing access.
   */
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
   * A successful recurring invoice confirms
   * the subscription is paid and access can
   * remain active.
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
   * Do not immediately revoke access after
   * the first failed renewal. Stripe may
   * retry the payment.
   *
   * We update the timestamp so we have a
   * record that the entitlement was touched
   * by the billing lifecycle.
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
          event.data.object
        )
        break

      case 'invoice.payment_failed':
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
     * Non-2xx tells Stripe that processing
     * failed so Stripe can retry delivery.
     */
    return new Response(
      'Webhook processing failed.',
      {
        status: 500,
      }
    )
  }
}
