import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function escapeHtml(value) {
  if (value === null || value === undefined) return ''

  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDateTime(value) {
  if (!value) {
    return {
      date: 'Not available',
      time: 'Not available',
    }
  }

  const date = new Date(value)

  return {
    date: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date),

    time: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date),
  }
}

function serviceLabel(type) {
  return (
    {
      group: 'Group Training',
      private: 'Private Training',
      track: 'Track & Field',
      recovery: 'Recovery',
    }[type] ||
    type ||
    'Training'
  )
}

export async function POST(request) {
  try {
    /*
     * -------------------------------------------------------
     * SERVER CONFIGURATION
     * -------------------------------------------------------
     */

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL

    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const smtpHost =
      process.env.SMTP_HOST

    const smtpUser =
      process.env.SMTP_USER

    const smtpPass =
      process.env.SMTP_PASS

    const ownerEmail =
      process.env.OWNER_NOTIFICATION_EMAIL ||
      'chavis@itrainspeed.com'

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(
        'New booking notification: Supabase configuration is incomplete.'
      )

      return Response.json(
        {
          error: 'Server configuration error.',
        },
        {
          status: 500,
        }
      )
    }

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.error(
        'New booking notification: SMTP configuration is incomplete.'
      )

      return Response.json(
        {
          error: 'Email configuration error.',
        },
        {
          status: 500,
        }
      )
    }

    /*
     * -------------------------------------------------------
     * VERIFY AUTHENTICATED PARENT
     * -------------------------------------------------------
     */

    const authorization =
      request.headers.get('authorization')

    if (
      !authorization ||
      !authorization.startsWith('Bearer ')
    ) {
      return Response.json(
        {
          error: 'Unauthorized.',
        },
        {
          status: 401,
        }
      )
    }

    const accessToken =
      authorization
        .replace('Bearer ', '')
        .trim()

    if (!accessToken) {
      return Response.json(
        {
          error: 'Unauthorized.',
        },
        {
          status: 401,
        }
      )
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },

        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(
      accessToken
    )

    if (userError || !user) {
      console.error(
        'New booking notification: unable to verify user.',
        userError?.message
      )

      return Response.json(
        {
          error: 'Unauthorized.',
        },
        {
          status: 401,
        }
      )
    }

    /*
     * -------------------------------------------------------
     * REQUEST DATA
     * -------------------------------------------------------
     */

    let body

    try {
      body = await request.json()
    } catch {
      return Response.json(
        {
          error: 'Invalid request.',
        },
        {
          status: 400,
        }
      )
    }

    const athleteId =
      body?.athlete_id

    const sessionId =
      body?.session_id

    if (!athleteId || !sessionId) {
      return Response.json(
        {
          error:
            'Athlete ID and session ID are required.',
        },
        {
          status: 400,
        }
      )
    }

    /*
     * -------------------------------------------------------
     * VERIFY ATHLETE OWNERSHIP
     * -------------------------------------------------------
     */

    const {
      data: athlete,
      error: athleteError,
    } = await supabase
      .from('athletes')
      .select(
        `
          id,
          guardian_id,
          first_name,
          last_name,
          age,
          sport
        `
      )
      .eq('id', athleteId)
      .eq('guardian_id', user.id)
      .single()

    if (athleteError || !athlete) {
      console.error(
        'New booking notification: athlete verification failed.',
        athleteError?.message
      )

      return Response.json(
        {
          error: 'Athlete not found.',
        },
        {
          status: 404,
        }
      )
    }

    /*
     * -------------------------------------------------------
     * VERIFY CONFIRMED BOOKING EXISTS
     *
     * This is important:
     * receiving a session ID from the browser is not enough.
     * We only send an email when the database confirms that
     * this parent + athlete + session has status "booked".
     * -------------------------------------------------------
     */

    const {
      data: booking,
      error: bookingError,
    } = await supabase
      .from('bookings')
      .select(
        `
          id,
          session_id,
          athlete_id,
          guardian_id,
          status,
          credit_cost,
          entitlement_id,
          created_at
        `
      )
      .eq('session_id', sessionId)
      .eq('athlete_id', athleteId)
      .eq('guardian_id', user.id)
      .eq('status', 'booked')
      .maybeSingle()

    if (bookingError) {
      console.error(
        'New booking notification: booking lookup failed.',
        bookingError.message
      )

      return Response.json(
        {
          error:
            'Unable to verify booking.',
        },
        {
          status: 500,
        }
      )
    }

    if (!booking) {
      return Response.json(
        {
          error:
            'Confirmed booking not found.',
        },
        {
          status: 404,
        }
      )
    }

    /*
     * -------------------------------------------------------
     * GET SESSION INFORMATION
     * -------------------------------------------------------
     */

    const {
      data: session,
      error: sessionError,
    } = await supabase
      .from('session_availability')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionError || !session) {
      console.error(
        'New booking notification: session lookup failed.',
        sessionError?.message
      )

      return Response.json(
        {
          error:
            'Training session not found.',
        },
        {
          status: 404,
        }
      )
    }

    /*
     * -------------------------------------------------------
     * GET PARENT PROFILE
     * -------------------------------------------------------
     */

    const {
      data: parentProfile,
      error: profileError,
    } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      console.warn(
        'New booking notification: parent profile lookup failed.',
        profileError.message
      )
    }

    /*
     * -------------------------------------------------------
     * GET ACCESS / ENTITLEMENT INFORMATION
     * -------------------------------------------------------
     */

    let accessName =
      serviceLabel(
        session.service_type ||
          session.credit_type
      )

    let accessRemaining =
      'Active access'

    if (booking.entitlement_id) {
      const {
        data: entitlement,
        error: entitlementError,
      } = await supabase
        .from('entitlements')
        .select(`
          id,
          unlimited,
          credits_remaining,
          credit_type,
          packages (
            name
          )
        `)
        .eq(
          'id',
          booking.entitlement_id
        )
        .maybeSingle()

      if (entitlementError) {
        console.warn(
          'New booking notification: entitlement lookup failed.',
          entitlementError.message
        )
      }

      if (entitlement) {
        accessName =
          entitlement.packages?.name ||
          serviceLabel(
            entitlement.credit_type
          )

        accessRemaining =
          entitlement.unlimited
            ? 'Unlimited active access'
            : `${Number(
                entitlement.credits_remaining ||
                  0
              )} ${
                Number(
                  entitlement.credits_remaining ||
                    0
                ) === 1
                  ? 'credit'
                  : 'credits'
              } remaining`
      }
    }

    /*
     * -------------------------------------------------------
     * PREPARE EMAIL VALUES
     * -------------------------------------------------------
     */

    const athleteName = [
      athlete.first_name,
      athlete.last_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()

    const parentName =
      parentProfile?.full_name ||
      'Parent / Guardian'

    const parentEmail =
      user.email ||
      'Not available'

    const programName =
      session.program_name ||
      session.category ||
      serviceLabel(
        session.service_type ||
          session.credit_type
      )

    const location =
      session.location ||
      'iTrainSpeed'

    const duration =
      session.duration_minutes
        ? `${session.duration_minutes} minutes`
        : 'Not specified'

    const serviceType =
      serviceLabel(
        session.service_type ||
          session.credit_type
      )

    const {
      date: sessionDate,
      time: sessionTime,
    } = formatDateTime(
      session.start_at
    )

    const bookingTime =
      formatDateTime(
        booking.created_at
      )

    const safeAthleteName =
      escapeHtml(
        athleteName ||
          'Athlete'
      )

    const safeParentName =
      escapeHtml(parentName)

    const safeParentEmail =
      escapeHtml(parentEmail)

    const safeProgramName =
      escapeHtml(programName)

    const safeLocation =
      escapeHtml(location)

    const safeDuration =
      escapeHtml(duration)

    const safeServiceType =
      escapeHtml(serviceType)

    const safeSessionDate =
      escapeHtml(sessionDate)

    const safeSessionTime =
      escapeHtml(sessionTime)

    const safeAccessName =
      escapeHtml(accessName)

    const safeAccessRemaining =
      escapeHtml(accessRemaining)

    const safeBookingTime =
      escapeHtml(
        `${bookingTime.date} at ${bookingTime.time}`
      )

    /*
     * -------------------------------------------------------
     * GOOGLE WORKSPACE SMTP
     * -------------------------------------------------------
     */

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

    /*
     * -------------------------------------------------------
     * EMAIL
     * -------------------------------------------------------
     */

    const subject =
      `📅 New Booking — ${athleteName || 'Athlete'}`

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
            margin:0;
            padding:0;
            background:#f4f4f4;
            font-family:Arial,Helvetica,sans-serif;
            color:#111111;
          "
        >

          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="
              width:100%;
              background:#f4f4f4;
              padding:30px 15px;
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
                    max-width:600px;
                    background:#ffffff;
                    border-radius:14px;
                    overflow:hidden;
                  "
                >

                  <tr>
                    <td
                      style="
                        background:#000000;
                        padding:28px 30px;
                        text-align:center;
                      "
                    >
                      <div
                        style="
                          color:#ffffff;
                          font-size:28px;
                          font-weight:800;
                          letter-spacing:-1px;
                        "
                      >
                        <span
                          style="color:#e10600;"
                        >i</span>TrainSpeed
                      </div>

                      <div
                        style="
                          margin-top:7px;
                          color:#bdbdbd;
                          font-size:11px;
                          font-weight:700;
                          letter-spacing:2px;
                        "
                      >
                        TRAIN. TRACK. DEVELOP.
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td
                      style="
                        padding:34px 32px;
                      "
                    >

                      <div
                        style="
                          font-size:12px;
                          font-weight:800;
                          color:#e10600;
                          text-transform:uppercase;
                          letter-spacing:1.5px;
                          margin-bottom:10px;
                        "
                      >
                        New Booking
                      </div>

                      <h1
                        style="
                          margin:0 0 8px 0;
                          font-size:27px;
                          line-height:1.2;
                        "
                      >
                        ${safeAthleteName}
                      </h1>

                      <p
                        style="
                          margin:0 0 28px 0;
                          color:#666666;
                          font-size:15px;
                          line-height:1.6;
                        "
                      >
                        A training session has been booked successfully.
                      </p>

                      <table
                        role="presentation"
                        width="100%"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="
                          width:100%;
                          border:1px solid #e5e5e5;
                          border-radius:10px;
                          margin-bottom:20px;
                        "
                      >

                        <tr>
                          <td
                            colspan="2"
                            style="
                              padding:15px 18px;
                              background:#f8f8f8;
                              font-size:13px;
                              font-weight:800;
                              text-transform:uppercase;
                              letter-spacing:1px;
                            "
                          >
                            Training Session
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Program
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeProgramName}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Training Type
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeServiceType}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Date
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeSessionDate}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Time
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeSessionTime}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Duration
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeDuration}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Location
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeLocation}
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
                          width:100%;
                          border:1px solid #e5e5e5;
                          border-radius:10px;
                          margin-bottom:20px;
                        "
                      >

                        <tr>
                          <td
                            colspan="2"
                            style="
                              padding:15px 18px;
                              background:#f8f8f8;
                              font-size:13px;
                              font-weight:800;
                              text-transform:uppercase;
                              letter-spacing:1px;
                            "
                          >
                            Athlete & Parent
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Athlete
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeAthleteName}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Parent
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeParentName}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Email
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeParentEmail}
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
                          width:100%;
                          border:1px solid #e5e5e5;
                          border-radius:10px;
                          margin-bottom:20px;
                        "
                      >

                        <tr>
                          <td
                            colspan="2"
                            style="
                              padding:15px 18px;
                              background:#f8f8f8;
                              font-size:13px;
                              font-weight:800;
                              text-transform:uppercase;
                              letter-spacing:1px;
                            "
                          >
                            Training Access
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Access
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeAccessName}
                          </td>
                        </tr>

                        <tr>
                          <td
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              color:#777777;
                              font-size:14px;
                            "
                          >
                            Remaining
                          </td>

                          <td
                            align="right"
                            style="
                              padding:14px 18px;
                              border-top:1px solid #eeeeee;
                              font-size:14px;
                              font-weight:700;
                            "
                          >
                            ${safeAccessRemaining}
                          </td>
                        </tr>

                      </table>

                      <div
                        style="
                          background:#111111;
                          color:#ffffff;
                          padding:18px;
                          border-radius:10px;
                        "
                      >
                        <div
                          style="
                            color:#999999;
                            font-size:11px;
                            font-weight:800;
                            text-transform:uppercase;
                            letter-spacing:1px;
                            margin-bottom:6px;
                          "
                        >
                          Booking Confirmed
                        </div>

                        <div
                          style="
                            font-size:15px;
                            font-weight:700;
                          "
                        >
                          ${safeBookingTime}
                        </div>
                      </div>

                    </td>
                  </tr>

                  <tr>
                    <td
                      style="
                        padding:22px 30px;
                        background:#f8f8f8;
                        text-align:center;
                        color:#888888;
                        font-size:12px;
                        line-height:1.6;
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
NEW iTRAINSPEED BOOKING

ATHLETE
${athleteName}

PARENT / GUARDIAN
${parentName}
${parentEmail}

TRAINING
Program: ${programName}
Type: ${serviceType}
Date: ${sessionDate}
Time: ${sessionTime}
Duration: ${duration}
Location: ${location}

TRAINING ACCESS
${accessName}
${accessRemaining}

Booking confirmed:
${bookingTime.date} at ${bookingTime.time}

iTrainSpeed
TRAIN. TRACK. DEVELOP.
    `.trim()

    await transporter.sendMail({
      from:
        `"iTrainSpeed" <${smtpUser}>`,

      to: ownerEmail,

      replyTo:
        user.email || smtpUser,

      subject,
      text,
      html,
    })

    console.log(
      'New booking notification sent.',
      {
        bookingId:
          booking.id,
        sessionId,
        athleteId,
        guardianId:
          user.id,
      }
    )

    return Response.json({
      ok: true,
      booking_id: booking.id,
    })
  } catch (error) {
    console.error(
      'New booking notification error:',
      error
    )

    return Response.json(
      {
        error:
          'Unable to send booking notification.',
      },
      {
        status: 500,
      }
    )
  }
}
