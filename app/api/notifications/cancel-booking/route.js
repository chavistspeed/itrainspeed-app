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

function emailShell(content, footerText) {
  return `
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
                      <span style="color:#e10600;">i</span>TrainSpeed
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
                  <td style="padding:34px 32px;">
                    ${content}
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
                    ${footerText}
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
}

function detailRow(label, value) {
  return `
    <tr>
      <td
        style="
          padding:14px 18px;
          border-top:1px solid #eeeeee;
          color:#777777;
          font-size:14px;
        "
      >
        ${label}
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
        ${value}
      </td>
    </tr>
  `
}

function detailTable(title, rows) {
  return `
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
          ${title}
        </td>
      </tr>

      ${rows}
    </table>
  `
}

export async function POST(request) {
  try {
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
     * VERIFY AUTHENTICATED PARENT
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
     * REQUEST
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

    const bookingId =
      body?.booking_id

    if (!bookingId) {
      return Response.json(
        {
          error: 'Booking ID is required.',
        },
        {
          status: 400,
        }
      )
    }

    /*
     * VERIFY THAT THIS BOOKING BELONGS TO THE
     * AUTHENTICATED PARENT AND IS NOW CANCELLED.
     *
     * The email route does NOT cancel anything.
     * cancel_booking_v14 remains the authority.
     */

    const {
      data: booking,
      error: bookingError,
    } = await supabase
      .from('bookings')
      .select(`
        id,
        status,
        athlete_id,
        guardian_id,
        entitlement_id,
        credit_cost,
        created_at,
        sessions (
          id,
          start_at,
          location,
          duration_minutes,
          programs (
            name
          )
        )
      `)
      .eq('id', bookingId)
      .eq('guardian_id', user.id)
      .maybeSingle()

    if (bookingError) {
      console.error(
        'Cancellation notification booking lookup failed:',
        bookingError.message
      )

      return Response.json(
        {
          error: 'Unable to verify cancellation.',
        },
        {
          status: 500,
        }
      )
    }

    if (!booking) {
      return Response.json(
        {
          error: 'Booking not found.',
        },
        {
          status: 404,
        }
      )
    }

    if (booking.status === 'booked') {
      return Response.json(
        {
          error:
            'Booking has not been cancelled.',
        },
        {
          status: 409,
        }
      )
    }

    /*
     * ATHLETE
     */

    const {
      data: athlete,
      error: athleteError,
    } = await supabase
      .from('athletes')
      .select(`
        id,
        first_name,
        last_name
      `)
      .eq(
        'id',
        booking.athlete_id
      )
      .eq(
        'guardian_id',
        user.id
      )
      .maybeSingle()

    if (athleteError || !athlete) {
      console.error(
        'Cancellation notification athlete lookup failed:',
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
     * PARENT
     */

    const {
      data: parentProfile,
    } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()

    /*
     * ACCESS AFTER CREDIT RESTORATION
     */

    let accessName =
      'Training Access'

    let accessRemaining =
      'Credit returned'

    if (booking.entitlement_id) {
      const {
        data: entitlement,
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

      if (entitlement) {
        accessName =
          entitlement.packages?.name ||
          'Training Access'

        const credits =
          Number(
            entitlement.credits_remaining ||
              0
          )

        accessRemaining =
          entitlement.unlimited
            ? 'Unlimited active access'
            : `${credits} ${
                credits === 1
                  ? 'credit'
                  : 'credits'
              } available`
      }
    }

    /*
     * PREPARE VALUES
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

    const firstName =
      parentProfile?.full_name
        ?.trim()
        ?.split(/\s+/)?.[0] ||
      'there'

    const parentEmail =
      user.email || ''

    const programName =
      booking.sessions
        ?.programs
        ?.name ||
      'iTrainSpeed Training'

    const location =
      booking.sessions
        ?.location ||
      'iTrainSpeed'

    const duration =
      booking.sessions
        ?.duration_minutes
        ? `${booking.sessions.duration_minutes} minutes`
        : 'Not specified'

    const sessionTime =
      formatDateTime(
        booking.sessions
          ?.start_at
      )

    const safeAthleteName =
      escapeHtml(
        athleteName ||
          'Athlete'
      )

    const safeParentName =
      escapeHtml(parentName)

    const safeFirstName =
      escapeHtml(firstName)

    const safeParentEmail =
      escapeHtml(
        parentEmail ||
          'Not available'
      )

    const safeProgramName =
      escapeHtml(programName)

    const safeLocation =
      escapeHtml(location)

    const safeDuration =
      escapeHtml(duration)

    const safeDate =
      escapeHtml(
        sessionTime.date
      )

    const safeTime =
      escapeHtml(
        sessionTime.time
      )

    const safeAccessName =
      escapeHtml(accessName)

    const safeAccessRemaining =
      escapeHtml(accessRemaining)

    /*
     * SMTP
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
     * OWNER EMAIL
     */

    const ownerSubject =
      `❌ Booking Cancelled — ${athleteName || 'Athlete'}`

    const ownerHtml =
      emailShell(
        `
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
            Booking Cancelled
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
            A parent has cancelled an upcoming
            iTrainSpeed training session.
          </p>

          ${detailTable(
            'Cancelled Session',
            detailRow(
              'Program',
              safeProgramName
            ) +
            detailRow(
              'Date',
              safeDate
            ) +
            detailRow(
              'Time',
              safeTime
            ) +
            detailRow(
              'Duration',
              safeDuration
            ) +
            detailRow(
              'Location',
              safeLocation
            )
          )}

          ${detailTable(
            'Athlete & Parent',
            detailRow(
              'Athlete',
              safeAthleteName
            ) +
            detailRow(
              'Parent',
              safeParentName
            ) +
            detailRow(
              'Email',
              safeParentEmail
            )
          )}

          <div
            style="
              background:#edf9f0;
              border:1px solid #b8dfc1;
              border-radius:10px;
              padding:18px;
            "
          >
            <div
              style="
                font-size:12px;
                font-weight:800;
                text-transform:uppercase;
                letter-spacing:1px;
                color:#26733a;
                margin-bottom:7px;
              "
            >
              Credit Returned
            </div>

            <div
              style="
                font-size:15px;
                font-weight:700;
              "
            >
              ${safeAccessName}
            </div>

            <div
              style="
                margin-top:4px;
                color:#555555;
                font-size:13px;
              "
            >
              ${safeAccessRemaining}
            </div>
          </div>
        `,
        'iTrainSpeed Owner Notification'
      )

    const ownerText = `
iTRAINSPEED BOOKING CANCELLED

Athlete: ${athleteName}
Parent: ${parentName}
Email: ${parentEmail || 'Not available'}

CANCELLED SESSION
Program: ${programName}
Date: ${sessionTime.date}
Time: ${sessionTime.time}
Duration: ${duration}
Location: ${location}

CREDIT RETURNED
${accessName}
${accessRemaining}

iTrainSpeed
TRAIN. TRACK. DEVELOP.
    `.trim()

    /*
     * PARENT EMAIL
     */

    const parentSubject =
      `Cancellation Confirmed — ${athleteName || 'iTrainSpeed'}`

    const appUrl =
      'https://app.itrainspeed.com'

    const parentHtml =
      emailShell(
        `
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
            Cancellation Confirmed
          </div>

          <h1
            style="
              margin:0 0 12px 0;
              font-size:27px;
              line-height:1.2;
            "
          >
            Your session has been cancelled.
          </h1>

          <p
            style="
              margin:0 0 26px 0;
              color:#555555;
              font-size:15px;
              line-height:1.7;
            "
          >
            Hi ${safeFirstName}, we've cancelled
            ${safeAthleteName}'s upcoming training
            session as requested.
          </p>

          ${detailTable(
            'Cancelled Training',
            detailRow(
              'Athlete',
              safeAthleteName
            ) +
            detailRow(
              'Program',
              safeProgramName
            ) +
            detailRow(
              'Date',
              safeDate
            ) +
            detailRow(
              'Time',
              safeTime
            ) +
            detailRow(
              'Duration',
              safeDuration
            ) +
            detailRow(
              'Location',
              safeLocation
            )
          )}

          <div
            style="
              background:#edf9f0;
              border:1px solid #b8dfc1;
              border-left:4px solid #26733a;
              padding:18px;
              border-radius:8px;
              margin-bottom:26px;
            "
          >
            <div
              style="
                font-size:13px;
                font-weight:800;
                color:#26733a;
                margin-bottom:7px;
              "
            >
              Your training credit has been returned.
            </div>

            <div
              style="
                color:#555555;
                font-size:13px;
                line-height:1.6;
              "
            >
              ${safeAccessName}<br />
              ${safeAccessRemaining}
            </div>
          </div>

          <p
            style="
              margin:0 0 24px 0;
              color:#555555;
              font-size:14px;
              line-height:1.7;
            "
          >
            You can use your available training
            access to reserve another eligible
            iTrainSpeed session.
          </p>

          <div style="text-align:center;">
            <a
              href="${appUrl}/booking"
              style="
                display:inline-block;
                background:#e10600;
                color:#ffffff;
                text-decoration:none;
                font-size:14px;
                font-weight:800;
                padding:14px 24px;
                border-radius:8px;
              "
            >
              Book Another Session
            </a>
          </div>

          <p
            style="
              margin:28px 0 0 0;
              color:#777777;
              font-size:12px;
              line-height:1.6;
              text-align:center;
            "
          >
            Reminder: training sessions must be
            cancelled at least 6 hours before the
            scheduled start time for the training
            credit to be returned.
          </p>
        `,
        'iTrainSpeed Cancellation Confirmation'
      )

    const parentText = `
YOUR CANCELLATION IS CONFIRMED

Hi ${firstName},

${athleteName}'s training session has been cancelled.

CANCELLED TRAINING
Program: ${programName}
Date: ${sessionTime.date}
Time: ${sessionTime.time}
Duration: ${duration}
Location: ${location}

CREDIT RETURNED
${accessName}
${accessRemaining}

You can use your available training access to book another eligible session.

Book another session:
${appUrl}/booking

Reminder: sessions must be cancelled at least 6 hours before the scheduled start time for the training credit to be returned.

iTrainSpeed
TRAIN. TRACK. DEVELOP.
    `.trim()

    /*
     * SEND BOTH EMAILS INDEPENDENTLY
     */

    let ownerSent = false
    let parentSent = false

    try {
      await transporter.sendMail({
        from:
          `"iTrainSpeed" <${smtpUser}>`,

        to:
          ownerEmail,

        replyTo:
          parentEmail ||
          smtpUser,

        subject:
          ownerSubject,

        text:
          ownerText,

        html:
          ownerHtml,
      })

      ownerSent = true
    } catch (error) {
      console.error(
        'Owner cancellation notification failed:',
        error
      )
    }

    if (parentEmail) {
      try {
        await transporter.sendMail({
          from:
            `"iTrainSpeed" <${smtpUser}>`,

          to:
            parentEmail,

          replyTo:
            smtpUser,

          subject:
            parentSubject,

          text:
            parentText,

          html:
            parentHtml,
        })

        parentSent = true
      } catch (error) {
        console.error(
          'Parent cancellation confirmation failed:',
          error
        )
      }
    }

    console.log(
      'Cancellation notification processing complete.',
      {
        bookingId,
        guardianId:
          user.id,
        ownerSent,
        parentSent,
      }
    )

    return Response.json({
      ok: true,
      booking_id:
        bookingId,
      owner_notification_sent:
        ownerSent,
      parent_confirmation_sent:
        parentSent,
    })
  } catch (error) {
    console.error(
      'Cancellation notification error:',
      error
    )

    return Response.json(
      {
        error:
          'Unable to process cancellation notifications.',
      },
      {
        status: 500,
      }
    )
  }
}
