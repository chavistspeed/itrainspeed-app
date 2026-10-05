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

function formatDate(dateValue) {
  if (!dateValue) return '—'

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(dateValue))
  } catch {
    return String(dateValue)
  }
}

export async function POST(request) {
  try {
    // ---------------------------------------------------------
    // 1. Verify required environment variables
    // ---------------------------------------------------------

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const smtpHost = process.env.SMTP_HOST
    const smtpUser = process.env.SMTP_USER
    const smtpPass = process.env.SMTP_PASS

    const ownerEmail =
      process.env.OWNER_NOTIFICATION_EMAIL || 'chavis@itrainspeed.com'

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase environment variables.')

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
      console.error('Missing SMTP environment variables.')

      return Response.json(
        {
          error: 'Email configuration error.',
        },
        {
          status: 500,
        }
      )
    }

    // ---------------------------------------------------------
    // 2. Read Authorization header
    // ---------------------------------------------------------

    const authorization = request.headers.get('authorization')

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return Response.json(
        {
          error: 'Unauthorized.',
        },
        {
          status: 401,
        }
      )
    }

    const accessToken = authorization.replace('Bearer ', '').trim()

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

    // ---------------------------------------------------------
    // 3. Verify the logged-in Supabase user
    // ---------------------------------------------------------

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
    } = await supabase.auth.getUser(accessToken)

    if (userError || !user) {
      console.error(
        'Unable to verify user:',
        userError?.message || 'No user returned'
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

    // ---------------------------------------------------------
    // 4. Get athlete ID from request
    // ---------------------------------------------------------

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

    const athleteId = body?.athlete_id

    if (!athleteId) {
      return Response.json(
        {
          error: 'Athlete ID is required.',
        },
        {
          status: 400,
        }
      )
    }

    // ---------------------------------------------------------
    // 5. Retrieve athlete
    //
    // IMPORTANT:
    // We require guardian_id to match the logged-in user.
    // A parent cannot use this endpoint to retrieve another
    // family's athlete.
    // ---------------------------------------------------------

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
          sport,
          created_at
        `
      )
      .eq('id', athleteId)
      .eq('guardian_id', user.id)
      .single()

    if (athleteError || !athlete) {
      console.error(
        'Unable to retrieve athlete:',
        athleteError?.message || 'Athlete not found'
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

    // ---------------------------------------------------------
    // 6. Retrieve parent profile
    // ---------------------------------------------------------

    const {
      data: parentProfile,
      error: profileError,
    } = await supabase
      .from('profiles')
      .select(
        `
          full_name,
          created_at
        `
      )
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      console.error(
        'Unable to retrieve parent profile:',
        profileError.message
      )
    }

    // ---------------------------------------------------------
    // 7. Prepare safe values for email
    // ---------------------------------------------------------

    const athleteFirstName =
      escapeHtml(athlete.first_name) || 'Unknown'

    const athleteLastName =
      escapeHtml(athlete.last_name) || ''

    const athleteName =
      `${athleteFirstName} ${athleteLastName}`.trim()

    const athleteAge =
      athlete.age !== null && athlete.age !== undefined
        ? escapeHtml(athlete.age)
        : 'Not provided'

    const athleteSport =
      escapeHtml(athlete.sport) || 'Not provided'

    const parentName =
      escapeHtml(parentProfile?.full_name) || 'Parent / Guardian'

    const parentEmail =
      escapeHtml(user.email) || 'Not available'

    const registrationTime =
      formatDate(athlete.created_at)

    // ---------------------------------------------------------
    // 8. Configure Google Workspace SMTP
    // ---------------------------------------------------------

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    // ---------------------------------------------------------
    // 9. Build branded notification email
    // ---------------------------------------------------------

    const subject =
      `🏃 New Athlete Registered — ${athleteName}`

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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

                  <!-- HEADER -->

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
                        <span style="color: #e10600;">i</span>TrainSpeed
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

                  <!-- BODY -->

                  <tr>
                    <td style="padding: 34px 32px;">

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
                        New Athlete Registered
                      </div>

                      <h1
                        style="
                          margin: 0 0 8px 0;
                          font-size: 27px;
                          line-height: 1.2;
                          color: #111111;
                        "
                      >
                        ${athleteName}
                      </h1>

                      <p
                        style="
                          margin: 0 0 28px 0;
                          color: #666666;
                          font-size: 15px;
                          line-height: 1.6;
                        "
                      >
                        A new athlete has been added to iTrainSpeed.
                      </p>

                      <!-- ATHLETE -->

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
                            Athlete
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
                            Name
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
                            ${athleteName}
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
                            Age
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
                            ${athleteAge}
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
                            Primary Sport
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
                            ${athleteSport}
                          </td>
                        </tr>

                      </table>

                      <!-- PARENT -->

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
                            Parent / Guardian
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
                            Name
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
                            ${parentName}
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
                            ${parentEmail}
                          </td>
                        </tr>

                      </table>

                      <!-- REGISTRATION -->

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
                          Registered
                        </div>

                        <div
                          style="
                            font-size: 15px;
                            font-weight: 700;
                          "
                        >
                          ${registrationTime}
                        </div>
                      </div>

                    </td>
                  </tr>

                  <!-- FOOTER -->

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
NEW ATHLETE REGISTERED

Athlete
Name: ${athlete.first_name || ''} ${athlete.last_name || ''}
Age: ${athlete.age ?? 'Not provided'}
Primary Sport: ${athlete.sport || 'Not provided'}

Parent / Guardian
Name: ${parentProfile?.full_name || 'Parent / Guardian'}
Email: ${user.email || 'Not available'}

Registered:
${registrationTime}

iTrainSpeed
TRAIN. TRACK. DEVELOP.
    `.trim()

    // ---------------------------------------------------------
    // 10. Send notification
    // ---------------------------------------------------------

    await transporter.sendMail({
      from: `"iTrainSpeed" <${smtpUser}>`,
      to: ownerEmail,
      replyTo: user.email || smtpUser,
      subject,
      text,
      html,
    })

    console.log(
      `New athlete notification sent for athlete ${athlete.id}`
    )

    return Response.json({
      ok: true,
    })
  } catch (error) {
    console.error(
      'New athlete notification error:',
      error
    )

    return Response.json(
      {
        error: 'Unable to send athlete notification.',
      },
      {
        status: 500,
      }
    )
  }
}
