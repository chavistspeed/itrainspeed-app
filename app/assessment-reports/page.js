'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AppShell from '../../components/AppShell'
import AssessmentReport from '../../components/AssessmentReport'
import { supabase } from '../../lib/supabase'

export default function Assessments() {
  const router = useRouter()
  const [athletes, setAthletes] = useState([])
  const [athleteId, setAthleteId] = useState('')
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const s = supabase()
        const { data: { user } } = await s.auth.getUser()
        if (!user) { router.replace('/login'); return }
        const { data, error } = await s.from('athletes').select('id,first_name,last_name').eq('guardian_id', user.id).order('first_name')
        if (error) throw error
        if (!active) return
        setAthletes(data || [])
        const requested = new URLSearchParams(window.location.search).get('athlete')
        setAthleteId(data?.find(a => a.id === requested)?.id || data?.[0]?.id || '')
        setLoading(false)
      } catch (e) { if (active) { setError(e.message); setLoading(false) } }
    }
    load()
    return () => { active = false }
  }, [router])
  useEffect(() => {
    if (!athleteId) return
    let active = true
    setReports([]); setLoading(true); setError('')
    supabase().from('athlete_assessments').select('*').eq('athlete_id', athleteId).eq('status', 'published').order('assessed_on', { ascending: false }).order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!active) return
      setReports(data || []); setError(error?.message || ''); setLoading(false)
    }).catch(e => { if (active) { setError(e.message); setLoading(false) } })
    return () => { active = false }
  }, [athleteId])
  return <AppShell title="Assessments & Progress">
    <div className="row"><h1>Assessments & Progress</h1><Link href="/dashboard">Back to home</Link></div>
    <p>View your child’s results, assessment videos, and coaching feedback over time.</p>
    {!!athletes.length && <label>Choose your athlete<select value={athleteId} onChange={e => setAthleteId(e.target.value)}>{athletes.map(a => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}</select></label>}
    {error && <p className="notice" role="alert">{error}</p>}
    {loading ? <p role="status">Loading assessments…</p> : !error && (!athletes.length ? <p className="empty">Add your child under Athletes to get started.</p> : !reports.length ? <p className="empty">No assessments have been shared for this athlete yet. Published reports will appear here.</p> : reports.map(report => <AssessmentReport key={report.id} report={report} />))}
  </AppShell>
}
