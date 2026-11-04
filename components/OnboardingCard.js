'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {supabase} from '../lib/supabase'
export default function OnboardingCard(){
 const [state,setState]=useState(null)
 useEffect(()=>{let active=true;async function load(){const s=supabase();if(!s)return;const {data:{user}}=await s.auth.getUser();if(!user)return;const {data:profile}=await s.from('profiles').select('role').eq('id',user.id).single();if(profile?.role!=='parent')return;const {data,error}=await s.rpc('athlete_onboarding_status',{p_guardian_id:user.id});if(active&&!error)setState(data)}load();return()=>{active=false}},[])
 if(!state)return null
 return <section className="card"><h2>Your athlete’s next step</h2>{!state.waiver_signed?<p><Link href="/waiver">Sign the participation waiver</Link> before scheduling your intro call.</p>:!state.intro_completed?<p><Link href="/intro">Schedule your intro call</Link>. Your coach marks it completed after you meet.</p>:!state.movement_completed?<p><Link href="/assessments">Schedule Assessment</Link> to start the movement evaluation.</p>:<p><Link href="/assessments">View Athlete Assessment and Athlete Progress</Link>.</p>}</section>
}
