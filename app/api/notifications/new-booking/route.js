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
     * REQUEST DATA
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
     * VERIFY ATHLETE OWNERSHIP
     */

    const {
      data: athlete,
      error: athleteError,
    } = await supabase
      .from('athletes')
      .select(`
        id,
        guardian_id,
        first_name,
        last_name,
        age,
        sport
      `)
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
     * VERIFY CONFIRMED BOOKING
     */

    const {
      data: booking,
      error: bookingError,
    } = await supabase
      .from('bookings')
      .select(`
        id,
        session_id,
        athlete_id,
        guardian_id,
        status,
        credit_cost,
        entitlement_id,
        created_at
      `)
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
          error: 'Unable to verify booking.',
        },
        {
          status: 500,
        }
      )
    }

    if (!booking) {
      return Response.json(
        {
          error: 'Confirmed booking not found.',
        },
        {
          status: 404,
        }
      )
    }

    /*
     * GET SESSION
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
          error: 'Training session not found.',
        },
        {
          status: 404,
        }
      )
    }

    /*
     * GET PARENT PROFILE
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
     * TRAINING ACCESS
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
              } remaining`
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

    const firstName =
      parentProfile?.full_name
        ?.trim()
        ?.split(/\s+/)?.[0] ||
      'there'

    const parentName =
      parentProfile?.full_name ||
      'Parent / Guardian'

    const parentEmail =
      user.email || ''

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
        athleteName || 'Athlete'
      )

    const safeFirstName =
      escapeHtml(firstName)

    const safeParentName =
      escapeHtml(parentName)

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
      `📅 New Booking — ${athleteName || 'Athlete'}`

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

          ${detailTable(
            'Training Session',
            detailRow(
              'Program',
              safeProgramName
            ) +
            detailRow(
              'Training Type',
              safeServiceType
            ) +
            detailRow(
              'Date',
              safeSessionDate
            ) +
            detailRow(
              'Time',
              safeSessionTime
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

          ${detailTable(
            'Training Access',
            detailRow(
              'Access',
              safeAccessName
            ) +
            detailRow(
              'Remaining',
              safeAccessRemaining
            )
          )}

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
        `,
        'iTrainSpeed Owner Notification'
      )

    const ownerText = `
NEW iTRAINSPEED BOOKING

ATHLETE
${athleteName}

PARENT / GUARDIAN
${parentName}
${parentEmail || 'Not available'}

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

    /*
     * PARENT CONFIRMATION EMAIL
     */

    const parentSubject =
      `Training Confirmed — ${athleteName || 'iTrainSpeed'}`

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
            Booking Confirmed
          </div>

          <h1
            style="
              margin:0 0 12px 0;
              font-size:27px;
              line-height:1.2;
            "
          >
            You're booked.
          </h1>

          <p
            style="
              margin:0 0 26px 0;
              color:#555555;
              font-size:15px;
              line-height:1.7;
            "
          >
            Hi ${safeFirstName}, ${safeAthleteName}'s
            training session with iTrainSpeed is confirmed.
            Here are the details.
          </p>

          ${detailTable(
            'Training Details',
            detailRow(
              'Athlete',
              safeAthleteName
            ) +
            detailRow(
              'Program',
              safeProgramName
            ) +
            detailRow(
              'Training Type',
              safeServiceType
            ) +
            detailRow(
              'Date',
              safeSessionDate
            ) +
            detailRow(
              'Time',
              safeSessionTime
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
            'Your Training Access',
            detailRow(
              'Access',
              safeAccessName
            ) +
            detailRow(
              'Remaining',
              safeAccessRemaining
            )
          )}

          <div
            style="
              background:#fff7f7;
              border:1px solid #f1d0d0;
              border-left:4px solid #e10600;
              padding:18px;
              border-radius:8px;
              margin:4px 0 26px 0;
            "
          >
            <div
              style="
                font-size:13px;
                font-weight:800;
                margin-bottom:7px;
              "
            >
              Cancellation Policy
            </div>

            <div
              style="
                color:#555555;
                font-size:13px;
                line-height:1.6;
              "
            >
              Sessions must be cancelled at least
              6 hours before the scheduled start time
              for the training credit to be returned.
              Cancellations made within 6 hours of the
              session and no-shows will forfeit the
              training credit. Exceptions may be made
              at iTrainSpeed's discretion.
            </div>
          </div>

          <div style="text-align:center;">
            <a
              href="${appUrl}"
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
              Open iTrainSpeed
            </a>
          </div>

          <p
            style="
              margin:28px 0 0 0;
              color:#777777;
              font-size:13px;
              line-height:1.6;
              text-align:center;
            "
          >
            We'll see you at training.
          </p>
        `,
        'iTrainSpeed Training Confirmation'
      )

    const parentText = `
YOUR iTRAINSPEED TRAINING IS CONFIRMED

Hi ${firstName},

${athleteName}'s training session is confirmed.

TRAINING DETAILS
Athlete: ${athleteName}
Program: ${programName}
Type: ${serviceType}
Date: ${sessionDate}
Time: ${sessionTime}
Duration: ${duration}
Location: ${location}

TRAINING ACCESS
${accessName}
${accessRemaining}

CANCELLATION POLICY
Sessions must be cancelled at least 6 hours before the scheduled start time for the training credit to be returned. Cancellations made within 6 hours of the session and no-shows will forfeit the training credit. Exceptions may be made at iTrainSpeed's discretion.

Open iTrainSpeed:
${appUrl}

TRAIN. TRACK. DEVELOP.
    `.trim()

    /*
     * SEND OWNER EMAIL
     *
     * Each email is isolated. If one fails,
     * we still attempt to send the other.
     */

    let ownerSent = false
    let parentSent = false

    try {
      await transporter.sendMail({
        from:
          `"iTrainSpeed" <${smtpUser}>`,

        to: ownerEmail,

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
        'Owner booking notification failed:',
        error
      )
    }

    /*
     * SEND PARENT EMAIL
     */

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
          'Parent booking confirmation failed:',
          error
        )
      }
    } else {
      console.warn(
        'Parent booking confirmation skipped: no parent email.'
      )
    }

    console.log(
      'Booking notification processing complete.',
      {
        bookingId:
          booking.id,

        sessionId,

        athleteId,

        guardianId:
          user.id,

        ownerSent,

        parentSent,
      }
    )

    return Response.json({
      ok: true,
      booking_id:
        booking.id,
      owner_notification_sent:
        ownerSent,
      parent_confirmation_sent:
        parentSent,
    })
  } catch (error) {
    console.error(
      'New booking notification error:',
      error
    )

    return Response.json(
      {
        error:
          'Unable to process booking notifications.',
      },
      {
        status: 500,
      }
    )
  }
}
