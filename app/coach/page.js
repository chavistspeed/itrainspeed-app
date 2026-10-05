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

const ACCESS_TYPES = [
  ['credits', 'Credit Package'],
  ['membership', 'Membership'],
  ['promotion', 'Promotion'],
]

const serviceLabel = (type) =>
  SERVICE_TYPES.find(([value]) => value === type)?.[1] ||
  type ||
  'Group Training'

const accessLabel = (type) =>
  ACCESS_TYPES.find(([value]) => value === type)?.[1] ||
  type ||
  'Credit Package'

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

const makeBlankPackage = () => ({
  name: '',
  description: '',
  access_type: 'credits',
  credit_type: 'group',
  credits: 1,
  duration_days: '',
  purchase_limit: '',
  active: true,
  sort_order: 0,
})

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

function formatDate(value) {
  if (!value) return '—'

  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(value) {
  if (!value) return '—'

  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function Coach() {
  const [role, setRole] = useState('')

  const [programs, setPrograms] = useState([])
  const [sessions, setSessions] = useState([])
  const [packages, setPackages] = useState([])

  const [athletes, setAthletes] = useState([])
  const [athleteSearch, setAthleteSearch] = useState('')
  const [athleteMsg, setAthleteMsg] = useState('')
  const [expandedAthlete, setExpandedAthlete] = useState(null)

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

  const [packageMsg, setPackageMsg] = useState('')
  const [editingPackage, setEditingPackage] = useState(null)
  const [packageForm, setPackageForm] = useState(makeBlankPackage())

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
      { data: packageRows },
      {
        data: athleteRows,
        error: athleteError,
      },
    ] = await Promise.all([
      s.from('profiles')
        .select('role')
        .eq('id', user.id)
        .single(),

      s.from('programs')
        .select('*')
        .order('active', {
          ascending: false,
        })
        .order('name'),

      s.from('session_availability')
        .select('*')
        .gte('start_at', new Date().toISOString())
        .order('start_at')
        .limit(100),

      s.from('packages')
        .select('*')
        .order('active', {
          ascending: false,
        })
        .order('sort_order', {
          ascending: true,
        })
        .order('name'),

      s.rpc('get_coach_athletes_v2'),
    ])

    setRole(profile?.role || 'parent')
    setPrograms(programRows || [])
    setSessions(sessionRows || [])
    setPackages(packageRows || [])

    setAthletes(athleteRows || [])

    setAthleteMsg(
      athleteError
        ? athleteError.message
        : ''
    )

    setF((current) => ({
      ...current,
      program_id:
        current.program_id ||
        programRows?.find(
          (program) => program.active
        )?.id ||
        '',
    }))
  }

  useEffect(() => {
    load()
  }, [])

  /* =====================================================
     SESSIONS
     ===================================================== */

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
      Math.min(
        26,
        Number(f.repeat_weeks) || 1
      )
    )

    const rows = Array.from(
      { length: count },
      (_, i) => ({
        program_id: f.program_id,

        start_at: new Date(
          base.getTime() +
            i *
              7 *
              24 *
              60 *
              60 *
              1000
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

    const {
      data,
      error,
    } = await supabase().rpc(
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

  /* =====================================================
     ATHLETES
     ===================================================== */

  const filteredAthletes =
    athletes.filter((athlete) => {
      const query =
        athleteSearch
          .trim()
          .toLowerCase()

      if (!query) return true

      const searchable = [
        athlete.first_name,
        athlete.last_name,
        athlete.sport,
        athlete.age,
        athlete.guardian_name,
        athlete.guardian_email,
      ]
        .filter(
          (value) =>
            value !== null &&
            value !== undefined
        )
        .join(' ')
        .toLowerCase()

      return searchable.includes(query)
    })

  function toggleAthlete(athleteId) {
    setExpandedAthlete(
      expandedAthlete === athleteId
        ? null
        : athleteId
    )
  }

  /* =====================================================
     PROGRAMS
     ===================================================== */

  function editProgram(program) {
    const type =
      program.service_type ||
      program.credit_type ||
      'group'

    setEditing(program.id)

    setPf({
      name: program.name || '',

      category:
        program.category ||
        'Speed & Agility',

      min_age:
        program.min_age ?? 6,

      max_age:
        program.max_age ?? 18,

      credit_cost:
        program.credit_cost ?? 1,

      credit_type: type,
      service_type: type,

      price_cents:
        program.price_cents ?? 0,

      price_dollars: (
        Number(program.price_cents ?? 0) / 100
      ).toFixed(2),

      active:
        program.active !== false,
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

    const priceDollars =
      Number(pf.price_dollars)

    if (
      !Number.isFinite(priceDollars) ||
      priceDollars < 0
    ) {
      setPm(
        'Please enter a valid single-session price.'
      )
      return
    }

    const minAge =
      Number(pf.min_age)

    const maxAge =
      Number(pf.max_age)

    const creditCost =
      Number(pf.credit_cost)

    if (
      !Number.isFinite(minAge) ||
      !Number.isFinite(maxAge) ||
      minAge < 0 ||
      maxAge < minAge
    ) {
      setPm(
        'Please enter a valid age range.'
      )
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

    const payload = {
      name: pf.name.trim(),
      category: pf.category,
      min_age: minAge,
      max_age: maxAge,
      credit_cost: creditCost,
      credit_type: pf.service_type,
      service_type: pf.service_type,
      price_cents:
        Math.round(
          priceDollars * 100
        ),
      active:
        Boolean(pf.active),
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

  /* =====================================================
     PACKAGES
     ===================================================== */

  function editPackage(item) {
    setEditingPackage(item.id)

    setPackageForm({
      name: item.name || '',
      description:
        item.description || '',
      access_type:
        item.access_type ||
        'credits',
      credit_type:
        item.credit_type ||
        'group',
      credits:
        item.credits ?? '',
      duration_days:
        item.duration_days ?? '',
      purchase_limit:
        item.purchase_limit ?? '',
      active:
        item.active !== false,
      sort_order:
        item.sort_order ?? 0,
    })

    setPackageMsg('')
    setTab('packages')
  }

  function cancelPackageEdit() {
    setEditingPackage(null)
    setPackageForm(makeBlankPackage())
    setPackageMsg('')
  }

  function updateAccessType(type) {
    setPackageForm(
      (current) => ({
        ...current,
        access_type: type,
        credits:
          type === 'credits'
            ? current.credits || 1
            : '',
      })
    )
  }

  async function savePackage(e) {
    e.preventDefault()

    setPackageMsg('')

    if (!editingPackage) {
      setPackageMsg(
        'New paid packages should be created through the Stripe setup workflow so Stripe and iTrainSpeed stay synchronized.'
      )
      return
    }

    if (!packageForm.name.trim()) {
      setPackageMsg(
        'Please enter a package name.'
      )
      return
    }

    const credits =
      packageForm.access_type ===
      'credits'
        ? Number(
            packageForm.credits
          )
        : null

    if (
      packageForm.access_type ===
        'credits' &&
      (
        !Number.isFinite(
          credits
        ) ||
        credits < 1
      )
    ) {
      setPackageMsg(
        'Credit packages must include at least 1 credit.'
      )
      return
    }

    const durationDays =
      packageForm.duration_days ===
      ''
        ? null
        : Number(
            packageForm.duration_days
          )

    if (
      durationDays !== null &&
      (
        !Number.isFinite(
          durationDays
        ) ||
        durationDays < 1
      )
    ) {
      setPackageMsg(
        'Duration must be at least 1 day or left blank.'
      )
      return
    }

    const purchaseLimit =
      packageForm.purchase_limit ===
      ''
        ? null
        : Number(
            packageForm.purchase_limit
          )

    if (
      purchaseLimit !== null &&
      (
        !Number.isFinite(
          purchaseLimit
        ) ||
        purchaseLimit < 1
      )
    ) {
      setPackageMsg(
        'Purchase limit must be at least 1 or left blank.'
      )
      return
    }

    const sortOrder =
      Number(
        packageForm.sort_order
      )

    if (!Number.isFinite(sortOrder)) {
      setPackageMsg(
        'Please enter a valid display order.'
      )
      return
    }

    const payload = {
      name:
        packageForm.name.trim(),

      description:
        packageForm.description.trim() ||
        null,

      access_type:
        packageForm.access_type,

      credit_type:
        packageForm.credit_type,

      credits,

      duration_days:
        durationDays,

      purchase_limit:
        purchaseLimit,

      active:
        Boolean(
          packageForm.active
        ),

      sort_order:
        Math.round(sortOrder),
    }

    const { error } =
      await supabase()
        .from('packages')
        .update(payload)
        .eq(
          'id',
          editingPackage
        )

    setPackageMsg(
      error
        ? error.message
        : 'Package updated.'
    )

    if (!error) {
      setEditingPackage(null)
      setPackageForm(makeBlankPackage())
      await load()
    }
  }

  async function togglePackage(item) {
    const confirmed =
      confirm(
        item.active
          ? `Hide ${item.name} from new purchases? Existing customer access will not be removed.`
          : `Make ${item.name} available for purchase?`
      )

    if (!confirmed) return

    const { error } =
      await supabase()
        .from('packages')
        .update({
          active:
            !item.active,
        })
        .eq(
          'id',
          item.id
        )

    setPackageMsg(
      error
        ? error.message
        : `${item.name} ${
            item.active
              ? 'hidden from new purchases'
              : 'activated'
          }.`
    )

    if (!error) {
      await load()
    }
  }

  /* =====================================================
     ACCESS CONTROL
     ===================================================== */

  if (
    role &&
    role === 'parent'
  ) {
    return (
      <AppShell title="Coach">
        <div className="card">
          <h1>
            Coach access required
          </h1>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Coach Control Center">
      <div className="pageTitleRow">
        <h1>
          Booking Control Center
        </h1>

        <div className="tabs">
          <button
            className={
              tab === 'schedule'
                ? 'tab activeTab'
                : 'tab'
            }
            onClick={() =>
              setTab('schedule')
            }
          >
            Schedule
          </button>

          <button
            className={
              tab === 'athletes'
                ? 'tab activeTab'
                : 'tab'
            }
            onClick={() =>
              setTab('athletes')
            }
          >
            Athletes
          </button>

          <button
            className={
              tab === 'programs'
                ? 'tab activeTab'
                : 'tab'
            }
            onClick={() =>
              setTab('programs')
            }
          >
            Programs
          </button>

          <button
            className={
              tab === 'packages'
                ? 'tab activeTab'
                : 'tab'
            }
            onClick={() =>
              setTab('packages')
            }
          >
            Packages
          </button>
        </div>
      </div>

      {/* ===============================================
          SCHEDULE
          =============================================== */}

      {tab === 'schedule' && (
        <>
          <div className="grid2">
            <section className="card">
              <h2>
                Publish sessions
              </h2>

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
                      .map(
                        (program) => (
                          <option
                            key={
                              program.id
                            }
                            value={
                              program.id
                            }
                          >
                            {
                              program.name
                            }{' '}
                            —{' '}
                            {serviceLabel(
                              program.service_type ||
                                program.credit_type
                            )}
                          </option>
                        )
                      )}
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
                    Duration
                    (minutes)

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
                    value={
                      f.repeat_weeks
                    }
                    onChange={(e) =>
                      setF({
                        ...f,
                        repeat_weeks:
                          e.target.value,
                      })
                    }
                  >
                    {[
                      1,
                      2,
                      4,
                      6,
                      8,
                      10,
                      12,
                    ].map((n) => (
                      <option
                        key={n}
                        value={n}
                      >
                        {n === 1
                          ? 'No repeat'
                          : `${n} weeks`}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="submit">
                  Publish{' '}
                  {Number(
                    f.repeat_weeks
                  ) > 1
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
              <h2>
                Upcoming schedule
              </h2>

              {sessions.length ? (
                sessions.map(
                  (session) => (
                    <div
                      className="card compact"
                      key={
                        session.id
                      }
                    >
                      <b>
                        {
                          session.program_name
                        }
                      </b>

                      <span>
                        {new Date(
                          session.start_at
                        ).toLocaleString()}
                      </span>

                      <span>
                        {
                          session.booked_count
                        }
                        /
                        {
                          session.capacity
                        }{' '}
                        booked •{' '}
                        {
                          session.location
                        }
                      </span>

                      <div className="inlineActions">
                        <button
                          type="button"
                          className="linkBtn"
                          onClick={() =>
                            openRoster(
                              session
                            )
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
                  )
                )
              ) : (
                <div className="empty">
                  No upcoming
                  sessions.
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
                    {
                      selected.program_name
                    }
                  </h2>

                  <span>
                    {new Date(
                      selected.start_at
                    ).toLocaleString()}{' '}
                    •{' '}
                    {
                      selected.location
                    }
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
                  roster.map(
                    (item, i) => (
                      <div
                        className="rosterRow"
                        key={
                          item.booking_id
                        }
                      >
                        <b>
                          {i + 1}.{' '}
                          {
                            item.athlete_name
                          }
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
                    )
                  )
                ) : (
                  <div className="empty">
                    No athletes
                    booked yet.
                  </div>
                ))}
            </section>
          )}
        </>
      )}

      {/* ===============================================
          ATHLETES
          =============================================== */}

      {tab === 'athletes' && (
        <section>
          <div className="card">
            <small>
              ATHLETE DIRECTORY
            </small>

            <h2>
              Registered Athletes
            </h2>

            <span>
              {athletes.length}{' '}
              athlete
              {athletes.length === 1
                ? ''
                : 's'}{' '}
              registered
            </span>

            <label
              style={{
                marginTop: '24px',
              }}
            >
              Search athletes

              <input
                type="search"
                placeholder="Search athlete, parent, email, age, or sport..."
                value={athleteSearch}
                onChange={(e) =>
                  setAthleteSearch(
                    e.target.value
                  )
                }
              />
            </label>

            {athleteMsg && (
              <div className="notice">
                {athleteMsg}
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: '20px',
            }}
          >
            {!athleteMsg &&
              filteredAthletes.map(
                (athlete) => {
                  const isOpen =
                    expandedAthlete ===
                    athlete.athlete_id

                  return (
                    <div
                      className="card"
                      key={
                        athlete.athlete_id
                      }
                      style={{
                        marginBottom:
                          '14px',
                      }}
                    >
                      <div className="programTop">
                        <div>
                          <b
                            style={{
                              fontSize:
                                '17px',
                            }}
                          >
                            {
                              athlete.first_name
                            }{' '}
                            {
                              athlete.last_name
                            }
                          </b>

                          <span>
                            {athlete.age !==
                              null &&
                            athlete.age !==
                              undefined
                              ? `Age ${athlete.age}`
                              : 'Age not provided'}

                            {athlete.sport
                              ? ` • ${athlete.sport}`
                              : ''}
                          </span>

                          <span>
                            Added{' '}
                            {formatDate(
                              athlete.athlete_created_at
                            )}
                          </span>
                        </div>

                        <span className="status activeStatus">
                          Athlete
                        </span>
                      </div>

                      <div
                        className="inlineActions"
                        style={{
                          marginTop:
                            '14px',
                        }}
                      >
                        <button
                          type="button"
                          className="linkBtn"
                          onClick={() =>
                            toggleAthlete(
                              athlete.athlete_id
                            )
                          }
                        >
                          {isOpen
                            ? 'Hide details ↑'
                            : 'View athlete →'}
                        </button>
                      </div>

                      {isOpen && (
                        <div
                          style={{
                            marginTop:
                              '20px',
                            paddingTop:
                              '20px',
                            borderTop:
                              '1px solid #e5e7eb',
                          }}
                        >
                          <div className="grid2">
                            <div>
                              <small>
                                PARENT /
                                GUARDIAN
                              </small>

                              <h3>
                                {athlete.guardian_name ||
                                  'Name not provided'}
                              </h3>

                              <span>
                                {athlete.guardian_email ||
                                  'Email unavailable'}
                              </span>

                              <span>
                                Account
                                created{' '}
                                {formatDate(
                                  athlete.guardian_created_at
                                )}
                              </span>
                            </div>

                            <div>
                              <small>
                                WAIVER
                              </small>

                              <h3>
                                {athlete.waiver_signed
                                  ? '✓ Signed'
                                  : 'Not signed'}
                              </h3>

                              {athlete.waiver_signed && (
                                <span>
                                  Accepted{' '}
                                  {formatDate(
                                    athlete.waiver_accepted_at
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                          <div
                            className="grid2"
                            style={{
                              marginTop:
                                '24px',
                            }}
                          >
                            <div>
                              <small>
                                TRAINING
                                ACCESS
                              </small>

                              <h3>
                                {athlete.has_unlimited_access
                                  ? 'Unlimited Access'
                                  : `${Number(
                                      athlete.credits_remaining ||
                                        0
                                    )} Credits`}
                              </h3>

                              <span>
                                {Number(
                                  athlete.entitlement_count ||
                                    0
                                )}{' '}
                                active access
                                record
                                {Number(
                                  athlete.entitlement_count ||
                                    0
                                ) === 1
                                  ? ''
                                  : 's'}
                              </span>

                              {Number(
                                athlete.guardian_credits ||
                                  0
                              ) > 0 && (
                                <span>
                                  Family
                                  balance:{' '}
                                  {
                                    athlete.guardian_credits
                                  }{' '}
                                  credits
                                </span>
                              )}
                            </div>

                            <div>
                              <small>
                                BOOKING
                                ACTIVITY
                              </small>

                              <h3>
                                {Number(
                                  athlete.active_bookings ||
                                    0
                                )}{' '}
                                Active
                              </h3>

                              <span>
                                {Number(
                                  athlete.total_bookings ||
                                    0
                                )}{' '}
                                total •{' '}
                                {Number(
                                  athlete.cancelled_bookings ||
                                    0
                                )}{' '}
                                cancelled
                              </span>

                              <span>
                                Last booking:{' '}
                                {athlete.last_booking_at
                                  ? formatDateTime(
                                      athlete.last_booking_at
                                    )
                                  : 'None yet'}
                              </span>
                            </div>
                          </div>

                          <div
                            className="notice"
                            style={{
                              marginTop:
                                '24px',
                            }}
                          >
                            Athlete ID:{' '}
                            {
                              athlete.athlete_id
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
              )}

            {!athleteMsg &&
              athletes.length === 0 && (
                <div className="empty">
                  No registered
                  athletes found.
                </div>
              )}

            {!athleteMsg &&
              athletes.length > 0 &&
              filteredAthletes.length ===
                0 && (
                <div className="empty">
                  No athletes match
                  your search.
                </div>
              )}
          </div>
        </section>
      )}

      {/* ===============================================
          PROGRAMS
          =============================================== */}

      {tab === 'programs' && (
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
                      name:
                        e.target.value,
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
                  ].map(
                    (category) => (
                      <option
                        key={
                          category
                        }
                        value={
                          category
                        }
                      >
                        {category}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                Service Type

                <select
                  value={
                    pf.service_type
                  }
                  onChange={(e) =>
                    updateServiceType(
                      e.target.value
                    )
                  }
                  required
                >
                  {SERVICE_TYPES.map(
                    ([
                      value,
                      text,
                    ]) => (
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
                This determines
                which package,
                credits, or
                membership can be
                used to book this
                program.
              </small>

              <div className="form2">
                <label>
                  Minimum age

                  <input
                    type="number"
                    min="0"
                    value={
                      pf.min_age
                    }
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
                    value={
                      pf.max_age
                    }
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
                    value={
                      pf.credit_cost
                    }
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
                    value={
                      pf.price_dollars
                    }
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
            <h2>
              Class offerings
            </h2>

            {programs.length ? (
              programs.map(
                (program) => (
                  <div
                    className="card programCard"
                    key={
                      program.id
                    }
                  >
                    <div>
                      <div className="programTop">
                        <b>
                          {
                            program.name
                          }
                        </b>

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
                        {
                          program.category
                        }{' '}
                        • Ages{' '}
                        {
                          program.min_age
                        }
                        –
                        {
                          program.max_age
                        }
                      </span>

                      <span>
                        {serviceLabel(
                          program.service_type ||
                            program.credit_type
                        )}{' '}
                        •{' '}
                        {
                          program.credit_cost
                        }{' '}
                        credit
                        {program.credit_cost ===
                        1
                          ? ''
                          : 's'}{' '}
                        •{' '}
                        {money(
                          program.price_cents
                        )}{' '}
                        single session
                      </span>
                    </div>

                    <div className="inlineActions">
                      <button
                        type="button"
                        className="linkBtn"
                        onClick={() =>
                          editProgram(
                            program
                          )
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
                )
              )
            ) : (
              <div className="empty">
                No programs
                created yet.
              </div>
            )}
          </section>
        </div>
      )}

      {/* ===============================================
          PACKAGES
          =============================================== */}

      {tab === 'packages' && (
        <div className="grid2">
          <section className="card">
            <h2>
              {editingPackage
                ? 'Edit package'
                : 'Package manager'}
            </h2>

            {!editingPackage ? (
              <>
                <p className="subtle">
                  Select a package
                  from the list to
                  edit its customer
                  settings.
                </p>

                <div className="notice">
                  Paid package
                  creation and price
                  changes are
                  protected because
                  Stripe and
                  iTrainSpeed must
                  stay synchronized.
                </div>
              </>
            ) : (
              <form
                onSubmit={
                  savePackage
                }
              >
                <label>
                  Package name

                  <input
                    value={
                      packageForm.name
                    }
                    onChange={(e) =>
                      setPackageForm({
                        ...packageForm,
                        name:
                          e.target.value,
                      })
                    }
                    required
                  />
                </label>

                <label>
                  Description

                  <textarea
                    value={
                      packageForm.description
                    }
                    onChange={(e) =>
                      setPackageForm({
                        ...packageForm,
                        description:
                          e.target.value,
                      })
                    }
                    rows="4"
                  />
                </label>

                <label>
                  Access type

                  <select
                    value={
                      packageForm.access_type
                    }
                    onChange={(e) =>
                      updateAccessType(
                        e.target.value
                      )
                    }
                  >
                    {ACCESS_TYPES.map(
                      ([
                        value,
                        text,
                      ]) => (
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

                <label>
                  Training type

                  <select
                    value={
                      packageForm.credit_type
                    }
                    onChange={(e) =>
                      setPackageForm({
                        ...packageForm,
                        credit_type:
                          e.target.value,
                      })
                    }
                  >
                    {SERVICE_TYPES.map(
                      ([
                        value,
                        text,
                      ]) => (
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

                {packageForm.access_type ===
                  'credits' && (
                  <label>
                    Credits included

                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={
                        packageForm.credits
                      }
                      onChange={(e) =>
                        setPackageForm({
                          ...packageForm,
                          credits:
                            e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                )}

                <div className="form2">
                  <label>
                    Duration (days)

                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="No expiration"
                      value={
                        packageForm.duration_days
                      }
                      onChange={(e) =>
                        setPackageForm({
                          ...packageForm,
                          duration_days:
                            e.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    Purchase limit

                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="No limit"
                      value={
                        packageForm.purchase_limit
                      }
                      onChange={(e) =>
                        setPackageForm({
                          ...packageForm,
                          purchase_limit:
                            e.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                <label>
                  Display order

                  <input
                    type="number"
                    step="1"
                    value={
                      packageForm.sort_order
                    }
                    onChange={(e) =>
                      setPackageForm({
                        ...packageForm,
                        sort_order:
                          e.target.value,
                      })
                    }
                  />
                </label>

                <label className="check">
                  <input
                    type="checkbox"
                    checked={
                      packageForm.active
                    }
                    onChange={(e) =>
                      setPackageForm({
                        ...packageForm,
                        active:
                          e.target.checked,
                      })
                    }
                  />

                  Available for purchase
                </label>

                <div className="notice">
                  Price:{' '}
                  <b>
                    {money(
                      packages.find(
                        (item) =>
                          item.id ===
                          editingPackage
                      )
                        ?.price_cents
                    )}
                  </b>

                  <br />

                  Billing:{' '}

                  <b>
                    {packages.find(
                      (item) =>
                        item.id ===
                        editingPackage
                    )
                      ?.payment_type ===
                    'subscription'
                      ? 'Recurring subscription'
                      : 'One-time payment'}
                  </b>

                  <br />

                  These billing
                  settings are
                  locked here to
                  protect Stripe
                  synchronization.
                </div>

                <div className="inlineActions">
                  <button
                    type="submit"
                  >
                    Save package
                  </button>

                  <button
                    type="button"
                    className="secondary smallBtn"
                    onClick={
                      cancelPackageEdit
                    }
                  >
                    Cancel edit
                  </button>
                </div>
              </form>
            )}

            {packageMsg && (
              <div className="notice">
                {packageMsg}
              </div>
            )}
          </section>

          <section>
            <h2>
              Customer packages
            </h2>

            {packages.length ? (
              packages.map(
                (item) => (
                  <div
                    className="card packageAdminCard"
                    key={item.id}
                  >
                    <div className="programTop">
                      <b>
                        {item.name}
                      </b>

                      <span
                        className={
                          item.active
                            ? 'status activeStatus'
                            : 'status'
                        }
                      >
                        {item.active
                          ? 'Active'
                          : 'Hidden'}
                      </span>
                    </div>

                    {item.description && (
                      <span>
                        {
                          item.description
                        }
                      </span>
                    )}

                    <div className="packageAdminMeta">
                      <span>
                        {money(
                          item.price_cents
                        )}

                        {item.payment_type ===
                        'subscription'
                          ? ' / month'
                          : ''}
                      </span>

                      <span>
                        {accessLabel(
                          item.access_type
                        )}{' '}
                        •{' '}
                        {serviceLabel(
                          item.credit_type
                        )}
                      </span>

                      <span>
                        {item.credits ==
                        null
                          ? 'Unlimited access'
                          : `${item.credits} credit${
                              item.credits ===
                              1
                                ? ''
                                : 's'
                            }`}
                      </span>

                      {item.duration_days && (
                        <span>
                          {
                            item.duration_days
                          }{' '}
                          day access
                        </span>
                      )}

                      {item.purchase_limit && (
                        <span>
                          Limit:{' '}
                          {
                            item.purchase_limit
                          }
                        </span>
                      )}

                      <span>
                        Order:{' '}
                        {
                          item.sort_order
                        }
                      </span>
                    </div>

                    <div className="inlineActions">
                      <button
                        type="button"
                        className="linkBtn"
                        onClick={() =>
                          editPackage(
                            item
                          )
                        }
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="dangerGhost"
                        onClick={() =>
                          togglePackage(
                            item
                          )
                        }
                      >
                        {item.active
                          ? 'Hide'
                          : 'Activate'}
                      </button>
                    </div>
                  </div>
                )
              )
            ) : (
              <div className="empty">
                No packages found.
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
