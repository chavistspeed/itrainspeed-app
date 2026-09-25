'use client'
import {useEffect} from 'react';import {useRouter} from 'next/navigation';import {supabase} from '../lib/supabase'
export default function Page(){const r=useRouter();useEffect(()=>{const s=supabase();if(!s){r.replace('/login');return}s.auth.getSession().then(({data})=>r.replace(data.session?'/dashboard':'/login'))},[r]);return <div className="center">Loading iTrainSpeed…</div>}
