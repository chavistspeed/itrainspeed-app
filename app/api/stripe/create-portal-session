import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return Response.json(
        {
          error:
            'Stripe is not configured.',
        },
        { status: 500 }
      )
    }

    if (
      !process.env
        .SUPABASE_SERVICE_ROLE_KEY
    ) {
      return Response.json(
        {
          error:
            'Supabase server access is not configured.',
        },
        { status: 500 }
      )
    }

    if (
      !process.env
        .NEXT_PUBLIC_SUPABASE_URL
    ) {
      return Response.json(
        {
          error:
            'Supabase URL is not configured.',
        },
        { status: 500 }
      )
    }

    const authHeader =
      request.headers.get(
        'authorization'
      )

    if (
      !authHeader?.startsWith(
        'Bearer '
      )
    ) {
      return Response.json(
        {
          error:
            'You must be signed in.',
        },
        { status: 401 }
      )
    }

    const token =
      authHeader.replace(
        'Bearer ',
        ''
      )

    const admin = createClient(
      process.env
        .NEXT_PUBLIC_SUPABASE_URL,
      process.env
        .SUPABASE_SERVICE_ROLE_KEY,
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
    } = await admin.auth.getUser(
      token
    )

    if (
      userError ||
      !user
    ) {
      return Response.json(
        {
          error:
            'Your session has expired. Please sign in again.',
        },
        { status: 401 }
      )
    }

    /*
     * The Stripe customer belongs to the
     * signed-in guardian.
     */
    const {
      data: profile,
      error: profileError,
    } = await admin
      .from('profiles')
      .select(
        'stripe_customer_id'
      )
      .eq('id', user.id)
      .single()

    if (
      profileError ||
      !profile
    ) {
      return Response.json(
        {
          error:
            'Unable to load your billing profile.',
        },
        { status: 500 }
      )
    }

    if (
      !profile.stripe_customer_id
    ) {
      return Response.json(
        {
          error:
            'No Stripe billing account was found for this account.',
        },
        { status: 400 }
      )
    }

    const stripe =
      new Stripe(
        process.env
          .STRIPE_SECRET_KEY
      )

    /*
     * Only allow access to a Stripe customer
     * that actually belongs to this guardian.
     */
    let customer

    try {
      customer =
        await stripe.customers.retrieve(
          profile.stripe_customer_id
        )
    } catch (error) {
      console.error(
        'Unable to retrieve Stripe customer:',
        error
      )

      return Response.json(
        {
          error:
            'Your Stripe billing account could not be found.',
        },
        { status: 400 }
      )
    }

    if (
      customer.deleted
    ) {
      return Response.json(
        {
          error:
            'Your Stripe billing account is no longer available.',
        },
        { status: 400 }
      )
    }

    if (
      customer.metadata
        ?.guardian_id &&
      customer.metadata
        .guardian_id !==
        user.id
    ) {
      console.error(
        'Stripe customer guardian mismatch:',
        {
          userId:
            user.id,
          stripeCustomerId:
            profile
              .stripe_customer_id,
          stripeGuardianId:
            customer.metadata
              ?.guardian_id,
        }
      )

      return Response.json(
        {
          error:
            'Unable to verify your billing account.',
        },
        { status: 403 }
      )
    }

    const origin =
      request.headers.get(
        'origin'
      ) ||
      `https://${request.headers.get(
        'host'
      )}`

    /*
     * Stripe hosts the billing portal.
     *
     * After the customer is finished managing
     * billing, they return to My Training.
     */
    const portalSession =
      await stripe.billingPortal.sessions.create(
        {
          customer:
            profile
              .stripe_customer_id,

          return_url:
            `${origin}/plans`,
        }
      )

    return Response.json({
      url:
        portalSession.url,
    })
  } catch (error) {
    console.error(
      'Stripe portal error:',
      error
    )

    return Response.json(
      {
        error:
          error?.message ||
          'Unable to open billing management.',
      },
      { status: 500 }
    )
  }
}
