export const TRACK_ENROLLMENT_PATH = '/enroll/off-season-track'

// Only the named existing catalog entry may be sold by this enrollment link.
export function isOffSeasonTrack(pkg) {
  return pkg?.name === 'Off-Season Track & Field' &&
    pkg.credit_type === 'track' && pkg.access_type === 'membership'
}

export function currentMembership(entitlements, packageId, athleteId, now = Date.now()) {
  return entitlements.find((ent) =>
    ent.package_id === packageId && ent.athlete_id === athleteId &&
    ent.status === 'active' &&
    (!ent.expires_at || new Date(ent.expires_at).getTime() > now)
  )
}

export function bookingUrl(entitlement) {
  return `/booking?${new URLSearchParams({
    type: 'track', athlete: entitlement.athlete_id, entitlement: entitlement.id,
  })}`
}

// The return target is deliberately restricted to this enrollment flow.
export function enrollmentReturn(search, fallback = '/dashboard') {
  const next = new URLSearchParams(search).get('next')
  if (!next) return fallback
  try {
    const url = new URL(next, 'https://local.invalid')
    if (url.origin !== 'https://local.invalid' || url.pathname !== TRACK_ENROLLMENT_PATH) return fallback
    return `${url.pathname}${url.search}`
  } catch { return fallback }
}

export function checkoutReturnPaths(pkg, enrollment, athleteId) {
  if (enrollment !== 'off-season-track' || !isOffSeasonTrack(pkg)) {
    return { success: '/plans?checkout=success', cancel: '/plans?checkout=cancelled' }
  }
  const query = new URLSearchParams({ athlete: athleteId })
  return {
    success: `${TRACK_ENROLLMENT_PATH}?${query}&checkout=success`,
    cancel: `${TRACK_ENROLLMENT_PATH}?${query}&checkout=cancelled`,
  }
}
