'use client'

import { useEffect, useState } from 'react'
import AppShell from '../../components/AppShell'
import { supabase } from '../../lib/supabase'

const SERVICE_TYPES = [
  ['group', 'Group Training'],
  ['private', '1-on-1 Private Training'],
  ['track', 'Track & Field'],
  ['recovery', 'Recovery'],
]

const serviceLabel = (type) =>
  SERVICE_TYPES.find(([value]) => value === type)?.[1] || type || 'Group Training'

const blankProgram = {
  name: '',
  category: 'Speed & Agility',
  min_age: 6,
  max_age: 18,
  credit_cost: 1,
  credit_type: 'group',
  service_type: 'group',
  price_cents: 3500,
  price_dollars: '35.00',
  active: true,
}

export default function Coach() {
  const [role, setRole] = useState('')
  const [programs, setPrograms] = useState([])
  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState(null)
  const [roster, setRoster] = useState([])
  const [rosterMsg, setRosterMsg] = useState('')
  const [tab, setTab] = useState('schedule')
  const [f, setF] = useState({
    program_id: '',
    start_at: '',
    duration_minutes: 60,
    capacity: 10,
    location: 'iTrainSpeed',
    repeat_weeks: 1,
  })
  const [msg, setMsg] = useState('')
  const [pm, setPm] = useState('')
  const [editing, setEditing] = useState(null)
  const [pf, setPf] = useState(blankProgram)

  async function load() {
    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const [{ data: p }, { data: pr }, { data: ss }] = await Promise.all([
      s.from('profiles').select('role').eq('id', user.id).single(),

      s.from('programs')
        .select('*')
        .order('active', { ascending: false })
        .order('name'),

      s.from('session_availability')
        .select('*')
        .gte('start_at', new Date().toISOString())
        .order('start_at')
        .limit(100),
    ])

    setRole(p?.role || 'parent')
    setPrograms(pr || [])

    setF((x) => ({
      ...x,
      program_id:
        x.program_id ||
        pr?.find((z) => z.active)?.id ||
        '',
    }))

    setSessions(ss || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function create(e) {
    e.preventDefault()
    setMsg('')

    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    const base = new Date(f.start_at)

    const count = Math.max(
      1,
      Math.min(26, Number(f.repeat_weeks) || 1)
    )

    const rows = Array.from({ length: count }, (_, i) => ({
      ...f,
      repeat_weeks: undefined,
      duration_minutes: Number(f.duration_minutes),
      capacity: Number(f.capacity),
      start_at: new Date(
        base.getTime() + i * 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
      created_by: user.id,
      status: 'published',
    })).map(({ repeat_weeks, ...x }) => x)

    const { error } = await s.from('sessions').insert(rows)

    setMsg(
      error
        ? error.message
        : `${count} session${count > 1 ? 's' : ''} published.`
    )

    if (!error) load()
  }

  async function openRoster(x) {
    setSelected(x)
    setRosterMsg('')

    const { data, error } = await supabase().rpc(
      'get_session_roster',
      {
        p_session_id: x.id,
      }
    )

    if (error) {
      setRoster([])
      setRosterMsg(error.message)
    } else {
      setRoster(data || [])
    }
  }

  async function cancelSession(x) {
    if (
      !confirm(
        `Cancel ${x.program_name} on ${new Date(
          x.start_at
        ).toLocaleString()}? Booked athletes will have their credits restored.`
      )
    ) {
      return
    }

    const { error } = await supabase().rpc(
      'admin_cancel_session',
      {
        p_session_id: x.id,
      }
    )

    setMsg(
      error
        ? error.message
        : 'Session cancelled and booked credits restored.'
    )

    setSelected(null)

    if (!error) load()
  }

  function editProgram(p) {
    const type = p.service_type || p.credit_type || 'group'

    setEditing(p.id)

    setPf({
  name: p.name || '',
  category: p.category || '',
  min_age: p.min_age ?? 6,
  max_age: p.max_age ?? 18,
  credit_cost: p.credit_cost ?? 1,
  credit_type: type,
  service_type: type,
  price_cents: p.price_cents ?? 0,
  price_dollars: (
    Number(p.price_cents ?? 0) / 100
  ).toFixed(2),
  active: p.active !== false,
})

    setTab('programs')
    setPm('')
  }

  function updateServiceType(type) {
    setPf((current) => ({
      ...current,
      service_type: type,
      credit_type: type,
    }))
  }

  async function saveProgram(e) {
    e.preventDefault()
    setPm('')

    if (!pf.service_type) {
      setPm('Please select a service type.')
      return
    }

    const payload = {
      ...pf,
      service_type: pf.service_type,
      credit_type: pf.service_type,
      min_age: Number(pf.min_age),
      max_age: Number(pf.max_age),
      credit_cost: Number(pf.credit_cost),
      price_cents: Math.round(
  Number(pf.price_dollars || 0) * 100
),
    }
    delete payload.price_dollars

    const s = supabase()

    const q = editing
      ? s.from('programs').update(payload).eq('id', editing)
      : s.from('programs').insert(payload)

    const { error } = await q

    setPm(
      error
        ? error.message
        : editing
          ? 'Program updated.'
          : 'Program created.'
    )

    if (!error) {
      setEditing(null)
      setPf(blankProgram)
      await load()
    }
  }

  async function toggleProgram(p) {
    const { error } = await supabase()
      .from('programs')
      .update({ active: !p.active })
      .eq('id', p.id)

    setPm(
      error
        ? error.message
        : `${p.name} ${p.active ? 'archived' : 'activated'}.`
    )

    if (!error) load()
  }

  if (role && role === 'parent') {
    return (
      <AppShell title="Coach">
        <div className="card">
          <h1>Coach access required</h1>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Coach Control Center">
      <div className="pageTitleRow">
        <h1>Booking Control Center</h1>

        <div className="tabs">
          <button
            className={
              tab === 'schedule'
                ? 'tab activeTab'
                : 'tab'
            }
            onClick={() => setTab('schedule')}
          >
            Schedule
          </button>

          <button
            className={
              tab === 'programs'
                ? 'tab activeTab'
                : 'tab'
            }
            onClick={() => setTab('programs')}
          >
            Programs
          </button>
        </div>
      </div>

      {tab === 'schedule' ? (
        <>
          <div className="grid2">
            <section className="card">
              <h2>Publish sessions</h2>

              <form onSubmit={create}>
                <label>
                  Program
                  <select
                    value={f.program_id}
                    onChange={(e) =>
                      setF({
                        ...f,
                        program_id: e.target.value,
                      })
                    }
                    required
                  >
                    {programs
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} —{' '}
                          {serviceLabel(
                            p.service_type ||
                              p.credit_type
                          )}
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  First date & time
                  <input
                    type="datetime-local"
                    value={f.start_at}
                    onChange={(e) =>
                      setF({
                        ...f,
                        start_at: e.target.value,
                      })
                    }
                    required
                  />
                </label>

                <div className="form2">
                  <label>
                    Capacity
                    <input
                      type="number"
                      min="1"
                      value={f.capacity}
                      onChange={(e) =>
                        setF({
                          ...f,
                          capacity: e.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min="15"
                      value={f.duration_minutes}
                      onChange={(e) =>
                        setF({
                          ...f,
                          duration_minutes:
                            e.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                <label>
                  Location
                  <input
                    value={f.location}
                    onChange={(e) =>
                      setF({
                        ...f,
                        location: e.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Repeat weekly
                  <select
                    value={f.repeat_weeks}
                    onChange={(e) =>
                      setF({
                        ...f,
                        repeat_weeks: e.target.value,
                      })
                    }
                  >
                    {[1, 2, 4, 6, 8, 10, 12].map(
                      (n) => (
                        <option key={n} value={n}>
                          {n === 1
                            ? 'No repeat'
                            : `${n} weeks`}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <button>
                  Publish{' '}
                  {Number(f.repeat_weeks) > 1
                    ? `${f.repeat_weeks} sessions`
                    : 'session'}
                </button>
              </form>

              {msg && (
                <div className="notice">{msg}</div>
              )}
            </section>

            <section>
              <h2>Upcoming schedule</h2>

              {sessions.map((x) => (
                <div
                  className="card compact"
                  key={x.id}
                >
                  <b>{x.program_name}</b>

                  <span>
                    {new Date(
                      x.start_at
                    ).toLocaleString()}
                  </span>

                  <span>
                    {x.booked_count}/{x.capacity}{' '}
                    booked • {x.location}
                  </span>

                  <div className="inlineActions">
                    <button
                      className="linkBtn"
                      onClick={() => openRoster(x)}
                    >
                      View roster →
                    </button>

                    <button
                      className="dangerGhost"
                      onClick={() =>
                        cancelSession(x)
                      }
                    >
                      Cancel session
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </div>

          {selected && (
            <section className="rosterPanel card">
              <div className="row">
                <div>
                  <small>SESSION ROSTER</small>

                  <h2>
                    {selected.program_name}
                  </h2>

                  <span>
                    {new Date(
                      selected.start_at
                    ).toLocaleString()}{' '}
                    • {selected.location}
                  </span>
                </div>

                <button
                  className="secondary smallBtn"
                  onClick={() =>
                    setSelected(null)
                  }
                >
                  Close
                </button>
              </div>

              {rosterMsg && (
                <div className="notice">
                  {rosterMsg}
                </div>
              )}

              {!rosterMsg &&
                (roster.length ? (
                  roster.map((x, i) => (
                    <div
                      className="rosterRow"
                      key={x.booking_id}
                    >
                      <b>
                        {i + 1}. {x.athlete_name}
                      </b>

                      <span>
                        {x.age
                          ? `Age ${x.age}`
                          : ''}
                        {x.sport
                          ? ` • ${x.sport}`
                          : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    No athletes booked yet.
                  </div>
                ))}
            </section>
          )}
        </>
      ) : (
        <>
          <div className="grid2">
            <section className="card">
              <h2>
                {editing
                  ? 'Edit program'
                  : 'Add program'}
              </h2>

              <form onSubmit={saveProgram}>
                <label>
                  Program name
                  <input
                    value={pf.name}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        name: e.target.value,
                      })
                    }
                    required
                  />
                </label>

                <label>
                  Category
                  <select
                    value={pf.category}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        category: e.target.value,
                      })
                    }
                  >
                    {[
                      'Speed & Agility',
                      'Track & Field',
                      'Private Training',
                      'Recovery',
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Service Type
                  <select
                    value={pf.service_type}
                    onChange={(e) =>
                      updateServiceType(
                        e.target.value
                      )
                    }
                    required
                  >
                    {SERVICE_TYPES.map(
                      ([value, text]) => (
                        <option
                          key={value}
                          value={value}
                        >
                          {text}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <small className="subtle">
                  This determines which package,
                  credits, or membership can be used
                  to book this program.
                </small>

                <div className="form2">
                  <label>
                    Minimum age
                    <input
                      type="number"
                      value={pf.min_age}
                      onChange={(e) =>
                        setPf({
                          ...pf,
                          min_age: e.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    Maximum age
                    <input
                      type="number"
                      value={pf.max_age}
                      onChange={(e) =>
                        setPf({
                          ...pf,
                          max_age: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                <div className="form2">
                  <label>
                    Credits per booking
                    <input
                      type="number"
                      min="0"
                      value={pf.credit_cost}
                      onChange={(e) =>
                        setPf({
                          ...pf,
                          credit_cost:
                            e.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                   <label>
  Single-session price ($)
  <input
    type="number"
    min="0"
    step="0.01"
    value={pf.price_dollars}
    onChange={(e) =>
      setPf({
        ...pf,
        price_dollars: e.target.value,
      })
    }
  />
</label>
                </div>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={pf.active}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        active: e.target.checked,
                      })
                    }
                  />
                  Active / bookable
                </label>

                <div className="inlineActions">
                  <button>
                    {editing
                      ? 'Save changes'
                      : 'Create program'}
                  </button>

                  {editing && (
                    <button
                      type="button"
                      className="secondary smallBtn"
                      onClick={() => {
                        setEditing(null)
                        setPf(blankProgram)
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>

              {pm && (
                <div className="notice">{pm}</div>
              )}
            </section>

            <section>
              <h2>Class offerings</h2>

              {programs.map((p) => (
                <div
                  className="card programCard"
                  key={p.id}
                >
                  <div>
                    <div className="programTop">
                      <b>{p.name}</b>

                      <span
                        className={
                          p.active
                            ? 'status activeStatus'
                            : 'status'
                        }
                      >
                        {p.active
                          ? 'Active'
                          : 'Archived'}
                      </span>
                    </div>

                    <span>
                      {p.category} • Ages{' '}
                      {p.min_age}–{p.max_age}
                    </span>

                    <span>
                      {serviceLabel(
                        p.service_type ||
                          p.credit_type
                      )}{' '}
                      • {p.credit_cost} credit
                      {p.credit_cost === 1
                        ? ''
                        : 's'}{' '}
                      • $
                      {(
                        p.price_cents / 100
                      ).toFixed(2)}{' '}
                      single session
                    </span>
                  </div>

                  <div className="inlineActions">
                    <button
                      className="linkBtn"
                      onClick={() =>
                        editProgram(p)
                      }
                    >
                      Edit
                    </button>

                    <button
                      className="dangerGhost"
                      onClick={() =>
                        toggleProgram(p)
                      }
                    >
                      {p.active
                        ? 'Archive'
                        : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </AppShell>
  )
}
