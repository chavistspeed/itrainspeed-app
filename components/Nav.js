'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function Nav() {
  const pathname = usePathname()

  const [role, setRole] = useState(null)

  useEffect(() => {
    loadRole()
  }, [])

  async function loadRole() {
    const s = supabase()

    if (!s) return

    const {
      data: { user },
    } = await s.auth.getUser()

    if (!user) return

    const {
      data: profile,
    } = await s
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    setRole(profile?.role || 'parent')
  }

  const items = [
    {
      href: '/dashboard',
      label: 'Home',
    },
    {
      href: '/booking',
      label: 'Book',
    },
    {
      href: '/athletes',
      label: 'Athletes',
    },
    {
      href: '/plans',
      label: 'Training',
    },
  ]

  /*
   * Coach Control Center should not appear
   * in normal parent navigation.
   */
  if (
    role === 'coach' ||
    role === 'admin'
  ) {
    items.push({
      href: '/coach',
      label: 'Coach',
    })
  }

  /*
   * Help is available to every signed-in
   * customer, coach, and admin.
   */
  items.push({
    href: '/support',
    label: 'Help',
  })

  function isActive(href) {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
    }

    return (
      pathname === href ||
      pathname?.startsWith(
        `${href}/`
      )
    )
  }

  return (
    <nav
      className="bottom"
      aria-label="Main navigation"
    >
      {items.map(
        ({ href, label }) => (
          <Link
            className={
              isActive(href)
                ? 'active'
                : ''
            }
            key={href}
            href={href}
          >
            {label}
          </Link>
        )
      )}
    </nav>
  )
}
