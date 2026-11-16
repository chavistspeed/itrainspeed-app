'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AppShell from '../../../components/AppShell'
import AssessmentReport from '../../../components/AssessmentReport'
import { supabase } from '../../../lib/supabase'
import { fileKind, fileContentType, MAX_FILE_BYTES, spreadsheetPreview } from '../../../lib/assessment-spreadsheet'

const blank = () => ({ id: null, title: 'Athlete Assessment', assessed_on: new Date().toLocaleDateString('en-CA'), notes: '', training_focus: '', metrics: [{ test: '', result: '', unit: '' }], attachments: [], status: 'draft' })

export default function CoachAssessments() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const [athletes, setAthletes] = useState([])
  const [athleteId, setAthleteId] = useState('')
  const [reports, setReports] = useState([])
  const [form, setForm] = useState(blank)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const fileInput = useRef(null)
  const saving = useRef(false)
  const savedForm = useRef(null)
  const hasUnsavedChanges = () => files.length > 0 || JSON.stringify(form) !== JSON.stringify(savedForm.current || blank())

  useEffect(() => {
    const beforeUnload = event => {
      if (saving.current || hasUnsavedChanges()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [form, files])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const s = supabase()
        const { data: { user } } = await s.auth.getUser()
        if (!user) { router.replace('/login'); return }
        const { data: profile, error: profileError } = await s.from('profiles').select('role').eq('id', user.id).single()
        if (profileError) throw profileError
        if (!['coach', 'admin'].includes(profile?.role)) { router.replace('/dashboard'); return }
        const { data, error } = await s.rpc('get_coach_athletes_v2')
        if (error) throw error
        if (!active) return
        setAllowed(true); setAthletes(data || []); setLoading(false)
        const requested = new URLSearchParams(window.location.search).get('athlete')
        setAthleteId(data?.find(a => a.athlete_id === requested)?.athlete_id || data?.[0]?.athlete_id || '')
      } catch (e) { if (active) { setMessage(e.message); setLoading(false) } }
    }
    load()
    return () => { active = false }
  }, [router])

  useEffect(() => {
    if (!athleteId || !allowed) return
    let active = true
    setReports([]); setPreview(null); setLoading(true); setMessage('')
    supabase().from('athlete_assessments').select('*').eq('athlete_id', athleteId).order('assessed_on', { ascending: false }).order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!active) return
      setReports(data || []); setLoading(false)
      if (error) setMessage(error.message)
    }).catch(e => { if (active) { setMessage(e.message); setLoading(false) } })
    return () => { active = false }
  }, [athleteId, allowed])

  function reset() { savedForm.current = null; setForm(blank()); setFiles([]); setPreview(null); if (fileInput.current) fileInput.current.value = '' }
  function updateMetric(index, field, value) { setForm(f => ({ ...f, metrics: f.metrics.map((m, i) => i === index ? { ...m, [field]: value } : m) })) }
  function edit(report) {
    const editable = { ...report, metrics: report.metrics.length ? report.metrics : [{ test: '', result: '', unit: '' }] }
    savedForm.current = editable
    setForm(editable)
    setFiles([]); setPreview(null); setMessage('')
    if (fileInput.current) fileInput.current.value = ''
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function remember(report) {
    savedForm.current = report
    setForm(report)
    setReports(current => [report, ...current.filter(r => r.id !== report.id)].sort((a, b) => b.assessed_on.localeCompare(a.assessed_on) || b.created_at.localeCompare(a.created_at)))
  }

  async function save(event) {
    event.preventDefault()
    if (saving.current || !athleteId) return
    const publish = event.nativeEvent.submitter?.value === 'published'
    saving.current = true; setBusy(true); setPreview(null)
    const s = supabase()
    let report = null
    let pending = [...files]
    try {
      const metrics = form.metrics.filter(m => m.test.trim() || m.result.trim() || m.unit.trim())
      if (metrics.some(m => !m.test.trim() || !m.result.trim())) throw new Error('Enter a test name and result for each score, or remove the empty score.')
      for (const file of pending) {
        fileKind(file.name)
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds 50 MB. Please upload a shorter video or a smaller file.`)
        if (file.size === 0) throw new Error(`${file.name} is empty.`)
      }
      setMessage('Saving draft…')
      const payload = { athlete_id: athleteId, title: form.title.trim(), assessed_on: form.assessed_on, notes: form.notes, training_focus: form.training_focus, metrics, attachments: form.attachments, status: 'draft', updated_at: new Date().toISOString() }
      const query = form.id ? s.from('athlete_assessments').update(payload).eq('id', form.id).eq('athlete_id', athleteId) : s.from('athlete_assessments').insert(payload)
      const saved = await query.select().single()
      if (saved.error) throw saved.error
      report = saved.data; remember(report)
      for (const file of [...pending]) {
        setMessage(`Uploading ${file.name}… Please keep this page open.`)
        const kind = fileKind(file.name)
        // Read only displayed values. Spreadsheet formulas are never executed.
        const sheets = kind === 'spreadsheet' ? await spreadsheetPreview(file) : undefined
        const path = `${report.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const uploaded = await s.storage.from('assessment-files').upload(path, file, { contentType: fileContentType(file.name), upsert: false, cacheControl: '0' })
        if (uploaded.error) throw new Error(`${file.name}: ${uploaded.error.message}`)
        const attachment = { name: file.name, path, kind, size: file.size, ...(sheets ? { sheets } : {}) }
        const attached = await s.from('athlete_assessments').update({ attachments: [...report.attachments, attachment], updated_at: new Date().toISOString() }).eq('id', report.id).eq('status', 'draft').select().single()
        if (attached.error) {
          await s.storage.from('assessment-files').remove([path])
          throw attached.error
        }
        report = attached.data; remember(report)
        pending = pending.filter(item => item !== file); setFiles(pending)
      }
      if (publish) {
        const published = await s.from('athlete_assessments').update({ status: 'published', updated_at: new Date().toISOString() }).eq('id', report.id).select().single()
        if (published.error) throw published.error
        report = published.data; remember(report)
      }
      if (fileInput.current) fileInput.current.value = ''
      setPreview(report)
      setMessage(publish ? 'Published. This athlete’s parent can now view the report, results, and videos in Assessment Results & Videos.' : 'Draft saved. Parents cannot see it until you publish.')
    } catch (e) {
      setMessage(`${e.message || 'Something went wrong.'}${report ? ' Your report is saved as a draft. Successfully uploaded files are retained; retry to finish the remaining files.' : ''}`)
    } finally { saving.current = false; setBusy(false) }
  }

  const selected = athletes.find(a => a.athlete_id === athleteId)
  return <AppShell title="Coach Assessments">
    <div className="row"><h1>Assessment reports</h1><Link href="/coach">Back to Coach</Link></div>
    {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
    {!allowed ? <p>{loading ? 'Checking coach access…' : 'Coach access is required to enter assessments.'}</p> : <>
      <label>Choose athlete<select disabled={busy} value={athleteId} onChange={e => {
        if (hasUnsavedChanges() && !window.confirm('Switch athletes? Save your current changes first if you want to keep them.')) return
        setAthleteId(e.target.value); reset()
      }}><option value="">Select an athlete</option>{athletes.map(a => <option key={a.athlete_id} value={a.athlete_id}>{a.first_name} {a.last_name} — {a.guardian_name || a.guardian_email || 'Family'}</option>)}</select></label>
      {!athletes.length && <p className="empty">No athletes yet. The parent must add their child’s profile first.</p>}
      {!!athleteId && <>
        <form className="card" onSubmit={save}>
          <h2>{form.id ? 'Edit assessment' : 'Add assessment'} for {selected?.first_name} {selected?.last_name}</h2>
          <p className="subtle">Attach only this athlete’s results. Remove other athletes’ information from spreadsheets before uploading.</p>
          <fieldset disabled={busy} className="assessmentFields">
            <div className="form2"><label>Report title<input required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><label>Assessment date<input required type="date" value={form.assessed_on} onChange={e => setForm({ ...form, assessed_on: e.target.value })} /></label></div>
            <h3>Test results <small>(optional if attached in your spreadsheet)</small></h3>
            {form.metrics.map((m, i) => <div className="assessmentMetric" key={i}><label>Test<input placeholder="10m fly" value={m.test} onChange={e => updateMetric(i, 'test', e.target.value)} /></label><label>Result<input placeholder="1.35" value={m.result} onChange={e => updateMetric(i, 'result', e.target.value)} /></label><label>Unit<input placeholder="seconds" value={m.unit} onChange={e => updateMetric(i, 'unit', e.target.value)} /></label><button type="button" className="secondary smallBtn" onClick={() => setForm({ ...form, metrics: form.metrics.filter((_, index) => index !== i) })}>Remove score {i + 1}</button></div>)}
            <button type="button" className="secondary smallBtn" onClick={() => setForm({ ...form, metrics: [...form.metrics, { test: '', result: '', unit: '' }] })}>Add test result</button>
            <label>Coach’s feedback<textarea rows={5} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Strengths, observations, and areas to improve" /></label>
            <label>Recommended training focus<textarea rows={3} value={form.training_focus} onChange={e => setForm({ ...form, training_focus: e.target.value })} /></label>
            <label>Upload spreadsheet, PDF, or videos<input ref={fileInput} type="file" multiple accept=".xlsx,.csv,.pdf,.mp4,.webm,.mov" onChange={e => setFiles(Array.from(e.target.files || []))} /></label>
            <p className="subtle">Excel (.xlsx), CSV, PDF, MP4, WebM, or MOV. Maximum 50 MB per file. MP4 is recommended for parent playback. Uploading a spreadsheet attaches its results to this report; it does not split a team roster into separate athletes.</p>
            {!!files.length && <ul>{files.map((file, i) => <li key={i}>{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB) <button type="button" className="linkBtn" onClick={() => setFiles(files.filter((_, n) => n !== i))}>Remove selected file</button></li>)}</ul>}
            {form.attachments.map(file => <div className="row" key={file.path}><span>{file.name}</span><button type="button" className="linkBtn" onClick={() => setForm({ ...form, attachments: form.attachments.filter(a => a.path !== file.path) })}>Remove from report</button></div>)}
            {form.status === 'published' && <p className="notice">Saving as a draft hides this report from the parent until you publish it again.</p>}
            <div className="inlineActions"><button type="submit" value="draft" className="secondary">Save draft</button><button type="submit" value="published">{busy ? 'Saving…' : 'Publish to parent'}</button><button type="button" className="linkBtn" onClick={() => { if (window.confirm('Start a new assessment? Save any current changes first.')) { reset(); setMessage('') } }}>New assessment</button></div>
          </fieldset>
        </form>
        {preview && <section><h2>Report preview</h2><AssessmentReport report={preview} /></section>}
        <h2>Assessment history</h2>
        {loading ? <p>Loading reports…</p> : !reports.length ? <p className="empty">No reports for this athlete yet. Add the first assessment above.</p> : reports.map(report => <div className="card" key={report.id}><div className="row"><div><b>{report.title}</b><span>{report.assessed_on} • {report.status === 'published' ? 'Published to parent' : 'Draft — coach only'}</span></div><div className="inlineActions"><button disabled={busy} type="button" className="secondary smallBtn" onClick={() => setPreview(report)}>View report</button><button disabled={busy} type="button" className="smallBtn" onClick={() => { if (hasUnsavedChanges() && !window.confirm('Open this report? Unsaved changes will be discarded.')) return; edit(report) }}>Edit report</button></div></div></div>)}
      </>}
    </>}
  </AppShell>
}
