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
  SERVICE_TYPES.find(([value]) => value === type)?.[1] ||
  type ||
  'Group Training'

const makeBlankProgram = () => ({
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
})

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
  const [pf, setPf] = useState(makeBlankProgram())

  async function load() {
    const s = supabase()

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const [
      { data: profile },
      { data: programRows },
      { data: sessionRows },
    ] = await Promise.all([
      s.from('profiles')
        .select('role')
        .eq('id', user.id)
        .single(),

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

    setRole(profile?.role || 'parent')
    setPrograms(programRows || [])
    setSessions(sessionRows || [])

    setF((current) => ({
      ...current,
      program_id:
        current.program_id ||
        programRows?.find((program) => program.active)?.id ||
        '',
    }))
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

    if (!user) {
      setMsg('Please sign in again.')
      return
    }

    const base = new Date(f.start_at)

    if (Number.isNaN(base.getTime())) {
      setMsg('Please select a valid date and time.')
      return
    }

    const count = Math.max(
      1,
      Math.min(26, Number(f.repeat_weeks) || 1)
    )

    const rows = Array.from(
      { length: count },
      (_, i) => ({
        program_id: f.program_id,
        start_at: new Date(
          base.getTime() +
            i * 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
        duration_minutes: Number(f.duration_minutes),
        capacity: Number(f.capacity),
        location: f.location,
        created_by: user.id,
        status: 'published',
      })
    )

    const { error } = await s
      .from('sessions')
      .insert(rows)

    setMsg(
      error
        ? error.message
        : `${count} session${
            count > 1 ? 's' : ''
          } published.`
    )

    if (!error) {
      await load()
    }
  }

  async function openRoster(session) {
    setSelected(session)
    setRosterMsg('')

    const { data, error } = await supabase().rpc(
      'get_session_roster',
      {
        p_session_id: session.id,
      }
    )

    if (error) {
      setRoster([])
      setRosterMsg(error.message)
      return
    }

    setRoster(data || [])
  }

  async function cancelSession(session) {
    const confirmed = confirm(
      `Cancel ${session.program_name} on ${new Date(
        session.start_at
      ).toLocaleString()}? Booked athletes will have their credits restored.`
    )

    if (!confirmed) return

    const { error } = await supabase().rpc(
      'admin_cancel_session',
      {
        p_session_id: session.id,
      }
    )

    setMsg(
      error
        ? error.message
        : 'Session cancelled and booked credits restored.'
    )

    setSelected(null)

    if (!error) {
      await load()
    }
  }

  function editProgram(program) {
    const type =
      program.service_type ||
      program.credit_type ||
      'group'

    setEditing(program.id)

    setPf({
      name: program.name || '',
      category:
        program.category || 'Speed & Agility',
      min_age: program.min_age ?? 6,
      max_age: program.max_age ?? 18,
      credit_cost: program.credit_cost ?? 1,
      credit_type: type,
      service_type: type,
      price_cents: program.price_cents ?? 0,

      // Keep the editable dollar value separate
      // from the integer cents stored in Supabase.
      price_dollars: (
        Number(program.price_cents ?? 0) / 100
      ).toFixed(2),

      active: program.active !== false,
    })

    setTab('programs')
    setPm('')
  }

  function cancelProgramEdit() {
    setEditing(null)
    setPf(makeBlankProgram())
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

    if (!pf.name.trim()) {
      setPm('Please enter a program name.')
      return
    }

    if (!pf.service_type) {
      setPm('Please select a service type.')
      return
    }

    const priceDollars = Number(pf.price_dollars)

    if (
      !Number.isFinite(priceDollars) ||
      priceDollars < 0
    ) {
      setPm(
        'Please enter a valid single-session price.'
      )
      return
    }

    const minAge = Number(pf.min_age)
    const maxAge = Number(pf.max_age)
    const creditCost = Number(pf.credit_cost)

    if (
      !Number.isFinite(minAge) ||
      !Number.isFinite(maxAge) ||
      minAge < 0 ||
      maxAge < minAge
    ) {
      setPm('Please enter a valid age range.')
      return
    }

    if (
      !Number.isFinite(creditCost) ||
      creditCost < 0
    ) {
      setPm(
        'Please enter a valid credit cost.'
      )
      return
    }

    // Only send actual database columns to Supabase.
    // price_dollars is intentionally NOT included.
    const payload = {
      name: pf.name.trim(),
      category: pf.category,
      min_age: minAge,
      max_age: maxAge,
      credit_cost: creditCost,
      credit_type: pf.service_type,
      service_type: pf.service_type,
      price_cents: Math.round(
        priceDollars * 100
      ),
      active: Boolean(pf.active),
    }

    const s = supabase()

    let result

    if (editing) {
      result = await s
        .from('programs')
        .update(payload)
        .eq('id', editing)
    } else {
      result = await s
        .from('programs')
        .insert(payload)
    }

    const { error } = result

    setPm(
      error
        ? error.message
        : editing
          ? 'Program updated.'
          : 'Program created.'
    )

    if (!error) {
      setEditing(null)
      setPf(makeBlankProgram())
      await load()
    }
  }

  async function toggleProgram(program) {
    const { error } = await supabase()
      .from('programs')
      .update({
        active: !program.active,
      })
      .eq('id', program.id)

    setPm(
      error
        ? error.message
        : `${program.name} ${
            program.active
              ? 'archived'
              : 'activated'
          }.`
    )

    if (!error) {
      await load()
    }
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
                        program_id:
                          e.target.value,
                      })
                    }
                    required
                  >
                    {programs
                      .filter(
                        (program) =>
                          program.active
                      )
                      .map((program) => (
                        <option
                          key={program.id}
                          value={program.id}
                        >
                          {program.name} —{' '}
                          {serviceLabel(
                            program.service_type ||
                              program.credit_type
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
                        start_at:
                          e.target.value,
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
                          capacity:
                            e.target.value,
                        })
                      }
                      required
                    />
                  </label>

                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min="15"
                      value={
                        f.duration_minutes
                      }
                      onChange={(e) =>
                        setF({
                          ...f,
                          duration_minutes:
                            e.target.value,
                        })
                      }
                      required
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
                        location:
                          e.target.value,
                      })
                    }
                    required
                  />
                </label>

                <label>
                  Repeat weekly
                  <select
                    value={f.repeat_weeks}
                    onChange={(e) =>
                      setF({
                        ...f,
                        repeat_weeks:
                          e.target.value,
                      })
                    }
                  >
                    {[1, 2, 4, 6, 8, 10, 12].map(
                      (n) => (
                        <option
                          key={n}
                          value={n}
                        >
                          {n === 1
                            ? 'No repeat'
                            : `${n} weeks`}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <button type="submit">
                  Publish{' '}
                  {Number(f.repeat_weeks) > 1
                    ? `${f.repeat_weeks} sessions`
                    : 'session'}
                </button>
              </form>

              {msg && (
                <div className="notice">
                  {msg}
                </div>
              )}
            </section>

            <section>
              <h2>Upcoming schedule</h2>

              {sessions.length ? (
                sessions.map((session) => (
                  <div
                    className="card compact"
                    key={session.id}
                  >
                    <b>
                      {session.program_name}
                    </b>

                    <span>
                      {new Date(
                        session.start_at
                      ).toLocaleString()}
                    </span>

                    <span>
                      {session.booked_count}/
                      {session.capacity}{' '}
                      booked •{' '}
                      {session.location}
                    </span>

                    <div className="inlineActions">
                      <button
                        type="button"
                        className="linkBtn"
                        onClick={() =>
                          openRoster(session)
                        }
                      >
                        View roster →
                      </button>

                      <button
                        type="button"
                        className="dangerGhost"
                        onClick={() =>
                          cancelSession(
                            session
                          )
                        }
                      >
                        Cancel session
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  No upcoming sessions.
                </div>
              )}
            </section>
          </div>

          {selected && (
            <section className="rosterPanel card">
              <div className="row">
                <div>
                  <small>
                    SESSION ROSTER
                  </small>

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
                  type="button"
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
                  roster.map((item, i) => (
                    <div
                      className="rosterRow"
                      key={item.booking_id}
                    >
                      <b>
                        {i + 1}.{' '}
                        {item.athlete_name}
                      </b>

                      <span>
                        {item.age
                          ? `Age ${item.age}`
                          : ''}
                        {item.sport
                          ? ` • ${item.sport}`
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
                      category:
                        e.target.value,
                    })
                  }
                >
                  {[
                    'Speed & Agility',
                    'Track & Field',
                    'Private Training',
                    'Recovery',
                  ].map((category) => (
                    <option
                      key={category}
                      value={category}
                    >
                      {category}
                    </option>
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
                credits, or membership can be
                used to book this program.
              </small>

              <div className="form2">
                <label>
                  Minimum age
                  <input
                    type="number"
                    min="0"
                    value={pf.min_age}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        min_age:
                          e.target.value,
                      })
                    }
                    required
                  />
                </label>

                <label>
                  Maximum age
                  <input
                    type="number"
                    min="0"
                    value={pf.max_age}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        max_age:
                          e.target.value,
                      })
                    }
                    required
                  />
                </label>
              </div>

              <div className="form2">
                <label>
                  Credits per booking
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={pf.credit_cost}
                    onChange={(e) =>
                      setPf({
                        ...pf,
                        credit_cost:
                          e.target.value,
                      })
                    }
                    required
                  />
                </label>

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
                        price_dollars:
                          e.target.value,
                      })
                    }
                    required
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
                      active:
                        e.target.checked,
                    })
                  }
                />
                Active / bookable
              </label>

              <div className="inlineActions">
                <button type="submit">
                  {editing
                    ? 'Save changes'
                    : 'Create program'}
                </button>

                {editing && (
                  <button
                    type="button"
                    className="secondary smallBtn"
                    onClick={
                      cancelProgramEdit
                    }
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </form>

            {pm && (
              <div className="notice">
                {pm}
              </div>
            )}
          </section>

          <section>
            <h2>Class offerings</h2>

            {programs.length ? (
              programs.map((program) => (
                <div
                  className="card programCard"
                  key={program.id}
                >
                  <div>
                    <div className="programTop">
                      <b>{program.name}</b>

                      <span
                        className={
                          program.active
                            ? 'status activeStatus'
                            : 'status'
                        }
                      >
                        {program.active
                          ? 'Active'
                          : 'Archived'}
                      </span>
                    </div>

                    <span>
                      {program.category} •
                      Ages {program.min_age}–
                      {program.max_age}
                    </span>

                    <span>
                      {serviceLabel(
                        program.service_type ||
                          program.credit_type
                      )}{' '}
                      • {program.credit_cost}{' '}
                      credit
                      {program.credit_cost ===
                      1
                        ? ''
                        : 's'}{' '}
                      • $
                      {(
                        Number(
                          program.price_cents ||
                            0
                        ) / 100
                      ).toFixed(2)}{' '}
                      single session
                    </span>
                  </div>

                  <div className="inlineActions">
                    <button
                      type="button"
                      className="linkBtn"
                      onClick={() =>
                        editProgram(program)
                      }
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="dangerGhost"
                      onClick={() =>
                        toggleProgram(
                          program
                        )
                      }
                    >
                      {program.active
                        ? 'Archive'
                        : 'Activate'}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">
                No programs created yet.
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
