import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function addDays(date, days) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + Number(days || 0))
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

async function eventAlreadyProcessed(admin, eventId) {
  const { data } = await admin
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', eventId)
    .maybeSingle()

  return Boolean(data)
}

async function markEventProcessed(admin, event) {
  const { error } = await admin
    .from('stripe_webhook_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
    })

  if (error && error.code !== '23505') {
    throw error
  }
}

async function fulfillCheckout(admin, session) {
  const packageId = session.metadata?.package_id
  const guardianId = session.metadata?.guardian_id
  const athleteId = session.metadata?.athlete_id || null

  if (!packageId || !guardianId) {
    throw new Error(
      'Checkout session is missing iTrainSpeed metadata.'
    )
  }

  const { data: packageData, error: packageError } =
    await admin
      .from('packages')
      .select('*')
      .eq('id', packageId)
      .single()

  if (packageError || !packageData) {
    throw new Error('Package could not be found.')
  }

  const { data: existingPurchase } = await admin
    .from('purchases')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle()

  // The Checkout Session itself is also unique.
  // This provides a second layer of duplicate protection.
  if (existingPurchase) return

  const creditType = packageData.credit_type
  const isSubscription =
    packageData.payment_type === 'subscription'

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id || null

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id || null

  const amountPaid =
    session.amount_total ?? packageData.price_cents

  const credits =
    Number(packageData.credits || 0)

  const unlimited =
    packageData.access_type === 'unlimited' ||
    credits === 0

  const durationDays =
    Number(packageData.duration_days || 0)

  const now = new Date()

  let expiresAt = null

  // One-time promotions such as Founding Athlete expire
  // after their configured number of days.
  if (!isSubscription && durationDays > 0) {
    expiresAt = addDays(now, durationDays)
  }

  // Memberships remain active while Stripe says the
  // subscription is active. We do not expire them here.
  if (isSubscription) {
    expiresAt = null
  }

  // Track access must remain athlete-specific.
  if (creditType === 'track' && !athleteId) {
    throw new Error(
      'Track membership is missing its athlete.'
    )
  }

  const entitlementAthleteId =
    creditType === 'track'
      ? athleteId
      : null

  const { error: purchaseError } = await admin
    .from('purchases')
    .insert({
      guardian_id: guardianId,
      athlete_id: entitlementAthleteId,
      package_id: packageData.id,
      package_key: packageData.name,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      credits_added: unlimited ? 0 : credits,
      amount_cents: amountPaid,
      amount_paid_cents: amountPaid,
      status: 'paid',
      payment_status: 'paid',
      updated_at: new Date().toISOString(),
    })

  if (purchaseError) {
    throw purchaseError
  }

  const { error: entitlementError } = await admin
    .from('entitlements')
    .insert({
      guardian_id: guardianId,
      athlete_id: entitlementAthleteId,
      package_id: packageData.id,
      credit_type: creditType,
      credits_remaining: unlimited
        ? 0
        : credits,
      unlimited,
      starts_at: now.toISOString(),
      expires_at: expiresAt,
      status: 'active',
      source: 'stripe',
      stripe_subscription_id: subscriptionId,
      updated_at: now.toISOString(),
    })

  if (entitlementError) {
    throw entitlementError
  }
}

async function deactivateSubscription(admin, subscription) {
  const subscriptionId = subscription.id

  if (!subscriptionId) return

  const { error } = await admin
    .from('entitlements')
    .update({
      status: 'inactive',
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)

  if (error) throw error
}

async function reactivateSubscription(admin, subscription) {
  const subscriptionId = subscription.id

  if (!subscriptionId) return

  const activeStatuses = ['active', 'trialing']

  if (activeStatuses.includes(subscription.status)) {
    const { error } = await admin
      .from('entitlements')
      .update({
        status: 'active',
        expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscriptionId)

    if (error) throw error
  }

  if (
    ['canceled', 'unpaid', 'incomplete_expired'].includes(
      subscription.status
    )
  ) {
    await deactivateSubscription(admin, subscription)
  }
}

export async function POST(request) {
  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return new Response(
      'Webhook server configuration is incomplete.',
      { status: 500 }
    )
  }

  const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY
  )

  const signature =
    request.headers.get('stripe-signature')

  if (!signature) {
    return new Response(
      'Missing Stripe signature.',
      { status: 400 }
    )
  }

  const body = await request.text()

  let event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (error) {
    console.error(
      'Stripe webhook signature error:',
      error
    )

    return new Response(
      `Webhook signature verification failed: ${error.message}`,
      { status: 400 }
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
        await reactivateSubscription(
          admin,
          event.data.object
        )
        break

      case 'customer.subscription.deleted':
        await deactivateSubscription(
          admin,
          event.data.object
        )
        break

      default:
        // We acknowledge events we don't currently
        // need without changing iTrainSpeed data.
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

    // Returning a non-2xx response tells Stripe
    // fulfillment did not complete successfully.
    return new Response(
      'Webhook processing failed.',
      { status: 500 }
    )
  }
}
