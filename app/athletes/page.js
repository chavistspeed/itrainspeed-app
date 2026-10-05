'use client'

import { useEffect, useState } from 'react'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

export default function Athletes() {
  const [list, setList] = useState([])

  const [f, setF] = useState({
    first_name: '',
    last_name: '',
    age: '',
    sport: '',
  })

  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data, error } = await supabase()
      .from('athletes')
      .select('*')
      .order('created_at')

    if (error) {
      setMsg(error.message)
      return
    }

    setList(data || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function add(e) {
    e.preventDefault()

    if (saving) return

    setSaving(true)
    setMsg('')

    try {
      const s = supabase()

      const {
        data: { user },
        error: userError,
      } = await s.auth.getUser()

      if (userError || !user) {
        setMsg('Please sign in again.')
        return
      }

      const athletePayload = {
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        age: f.age
          ? Number(f.age)
          : null,
        sport:
          f.sport.trim() || null,
        guardian_id: user.id,
      }

      const {
        data: athlete,
        error,
      } = await s
        .from('athletes')
        .insert(athletePayload)
        .select()
        .single()

      if (error) {
        setMsg(error.message)
        return
      }

      /*
       * Athlete creation succeeded.
       *
       * Notification failure should NEVER prevent
       * the parent from successfully adding an athlete.
       */
      try {
        const {
          data: { session },
        } = await s.auth.getSession()

        if (session?.access_token) {
          const response = await fetch(
            '/api/notifications/new-athlete',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                Authorization:
                  `Bearer ${session.access_token}`,
              },

              body: JSON.stringify({
                athlete_id:
                  athlete.id,
              }),
            }
          )

          if (!response.ok) {
            console.error(
              'New athlete notification failed.'
            )
          }
        }
      } catch (
        notificationError
      ) {
        console.error(
          'New athlete notification error:',
          notificationError
        )
      }

      setF({
        first_name: '',
        last_name: '',
        age: '',
        sport: '',
      })

      setMsg('Athlete added.')

      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell title="Athletes">
      <h1>
        Athlete profiles
      </h1>

      <div className="grid2">
        <section className="card">
          <h2>
            Add athlete
          </h2>

          <form onSubmit={add}>
            <label>
              First name

              <input
                value={
                  f.first_name
                }
                onChange={(e) =>
                  setF({
                    ...f,
                    first_name:
                      e.target.value,
                  })
                }
                required
              />
            </label>

            <label>
              Last name

              <input
                value={
                  f.last_name
                }
                onChange={(e) =>
                  setF({
                    ...f,
                    last_name:
                      e.target.value,
                  })
                }
              />
            </label>

            <label>
              Age

              <input
                type="number"
                min="5"
                max="25"
                value={f.age}
                onChange={(e) =>
                  setF({
                    ...f,
                    age:
                      e.target.value,
                  })
                }
              />
            </label>

            <label>
              Primary sport

              <input
                value={f.sport}
                onChange={(e) =>
                  setF({
                    ...f,
                    sport:
                      e.target.value,
                  })
                }
                placeholder="Track, football, soccer…"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
            >
              {saving
                ? 'Adding athlete...'
                : 'Add athlete'}
            </button>
          </form>

          {msg && (
            <p>{msg}</p>
          )}
        </section>

        <section>
          <h2>
            Your athletes
          </h2>

          {list.length ? (
            list.map((a) => (
              <div
                className="card compact"
                key={a.id}
              >
                <b>
                  {a.first_name}{' '}
                  {a.last_name}
                </b>

                <span>
                  Age{' '}
                  {a.age || '—'} •{' '}
                  {a.sport ||
                    'Sport not set'}
                </span>
              </div>
            ))
          ) : (
            <div className="empty">
              No athletes added yet.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}
