'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import AppShell from './AppShell'
export default function TrainingGate({ children }) {
  const [state, setState] = useState('loading')
  useEffect(() => {
    let active = true
    async function load() {
      const s = supabase()
      if (!s) { if (active) setState('error'); return }
      const { data: { user } } = await s.auth.getUser()
      if (!user) { if (active) setState('signin'); return }
      const { data, error } = await s.rpc('training_approved', { p_guardian_id: user.id })
      if (active) setState(error ? 'error' : data === true ? 'approved' : 'pending')
    }
    load().catch(() => active && setState('error'))
    return () => { active = false }
  }, [])
  if (state === 'approved') return children
  return <AppShell title="Training access"><section className="card">
    <h1>{state === 'loading' ? 'Checking training access…' : state === 'pending' ? 'Meet your coach first' : 'Training access'}</h1>
    <p>{state === 'pending' ? 'New families need coach approval before purchasing training or booking sessions. Schedule your free 20-minute intro call, then your coach can approve your family.' : state === 'error' ? 'We could not verify training access. Please reload or contact your coach.' : state === 'signin' ? 'Please sign in to continue.' : ''}</p>
    {state === 'pending' && <Link href="/intro">Schedule an intro call →</Link>}
    {state === 'signin' && <Link href="/login">Sign in</Link>}
  </section></AppShell>
}
