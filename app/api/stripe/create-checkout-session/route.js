import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return Response.json(
        { error: 'Stripe is not configured.' },
        { status: 500 }
      )
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        { error: 'Supabase server access is not configured.' },
        { status: 500 }
      )
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    const authHeader = request.headers.get('authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json(
        { error: 'You must be signed in.' },
        { status: 401 }
      )
    }

    const token = authHeader.replace('Bearer ', '')

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    )

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return Response.json(
        { error: 'Your session has expired. Please sign in again.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const packageId = body.package_id
    const athleteId = body.athlete_id || null

    if (!packageId) {
      return Response.json(
        { error: 'A package is required.' },
        { status: 400 }
      )
    }

    // Never trust pricing or entitlement details from the browser.
    // Supabase is the source of truth.
    const { data: packageData, error: packageError } =
      await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', packageId)
        .eq('active', true)
        .single()

    if (packageError || !packageData) {
      return Response.json(
        { error: 'This package is no longer available.' },
        { status: 404 }
      )
    }

    const creditType = packageData.credit_type

    if (
      !['group', 'private', 'track', 'recovery'].includes(
        creditType
      )
    ) {
      return Response.json(
        { error: 'This package has an invalid service type.' },
        { status: 400 }
      )
    }

 // Track memberships and Group memberships belong
// to one specific athlete.
//
// Normal Group credit packages remain family-shared.
const requiresAthlete =
  creditType === 'track' ||
  (
    creditType === 'group' &&
    packageData.access_type === 'membership'
  )

if (requiresAthlete) {
  if (!athleteId) {
    return Response.json(
      {
        error:
          'Please select the athlete receiving this membership.',
      },
      { status: 400 }
    )
  }

  const { data: athlete, error: athleteError } =
    await supabaseAdmin
      .from('athletes')
      .select('id, guardian_id')
      .eq('id', athleteId)
      .eq('guardian_id', user.id)
      .single()

  if (athleteError || !athlete) {
    return Response.json(
      {
        error:
          'That athlete is not available on your account.',
      },
      { status: 403 }
    )
  }
}
      if (!athleteId) {
        return Response.json(
          {
            error:
              'Please select the athlete receiving this Track & Field membership.',
          },
          { status: 400 }
        )
      }

      const { data: athlete, error: athleteError } =
        await supabaseAdmin
          .from('athletes')
          .select('id, guardian_id')
          .eq('id', athleteId)
          .eq('guardian_id', user.id)
          .single()

      if (athleteError || !athlete) {
        return Response.json(
          { error: 'That athlete is not available on your account.' },
          { status: 403 }
        )
      }
    }

    // Group/private/recovery access belongs to the family account.
    // Track access belongs to the selected athlete.
    const entitlementAthleteId =
  requiresAthlete ? athleteId : null

    /*
     * LIMITED PACKAGE PRE-CHECK
     *
     * This improves customer experience by preventing checkout
     * from starting when a limited package is already sold out.
     *
     * The database fulfillment RPC remains the final authority
     * against concurrent purchases.
     */
    if (
      packageData.purchase_limit !== null &&
      Number(packageData.purchase_limit) > 0
    ) {
      const { count, error: countError } =
        await supabaseAdmin
          .from('purchases')
          .select('id', {
            count: 'exact',
            head: true,
          })
          .eq('package_id', packageData.id)
          .eq('status', 'paid')

      if (countError) {
        console.error(
          'Limited package availability check failed:',
          countError
        )

        return Response.json(
          {
            error:
              'Unable to verify package availability. Please try again.',
          },
          { status: 500 }
        )
      }

      if (
        (count || 0) >=
        Number(packageData.purchase_limit)
      ) {
        return Response.json(
          {
            error: `${packageData.name} is sold out.`,
            code: 'PACKAGE_SOLD_OUT',
          },
          { status: 409 }
        )
      }
    }

    // Reuse the existing Stripe customer whenever possible.
    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single()

    if (profileError) {
      console.error(
        'Unable to load Stripe customer profile:',
        profileError
      )
    }

    let stripeCustomerId =
      profile?.stripe_customer_id || null

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: {
          guardian_id: user.id,
        },
      })

      stripeCustomerId = customer.id

      const { error: customerSaveError } =
        await supabaseAdmin
          .from('profiles')
          .update({
            stripe_customer_id: stripeCustomerId,
          })
          .eq('id', user.id)

      if (customerSaveError) {
        console.error(
          'Unable to save Stripe customer ID:',
          customerSaveError
        )
      }
    }

    const origin =
      request.headers.get('origin') ||
      `https://${request.headers.get('host')}`

    const isSubscription =
      packageData.payment_type === 'subscription'

    const metadata = {
      package_id: String(packageData.id),
      guardian_id: String(user.id),
      credit_type: String(creditType),
      athlete_id: entitlementAthleteId
        ? String(entitlementAthleteId)
        : '',
    }

    const priceData = {
      currency: 'usd',
      unit_amount: Number(packageData.price_cents),
      product_data: {
        name: packageData.name,
        metadata: {
          package_id: String(packageData.id),
          credit_type: String(creditType),
        },
      },
    }

    if (isSubscription) {
      priceData.recurring = {
        interval: 'month',
      }
    }

    const checkoutSession =
      await stripe.checkout.sessions.create({
        mode: isSubscription
          ? 'subscription'
          : 'payment',

        customer: stripeCustomerId,

        line_items: [
          {
            price_data: priceData,
            quantity: 1,
          },
        ],

        metadata,

        ...(isSubscription
          ? {
              subscription_data: {
                metadata,
              },
            }
          : {
              payment_intent_data: {
                metadata,
              },
            }),

        success_url:
          `${origin}/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}`,

        cancel_url:
          `${origin}/plans?checkout=cancelled`,
      })

    return Response.json({
      url: checkoutSession.url,
    })
  } catch (error) {
    console.error('Stripe checkout error:', error)

    return Response.json(
      {
        error:
          error?.message ||
          'Unable to start checkout.',
      },
      { status: 500 }
    )
  }
}
