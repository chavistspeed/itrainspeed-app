export const INTRO_ZONE = 'America/New_York'
export function easternTime(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: INTRO_ZONE, dateStyle: 'full', timeStyle: 'short' }).format(new Date(value))
}
// The coach enters Eastern wall time explicitly, independent of device timezone.
export function easternInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Choose a date and time.')
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  if (h < 9 || h > 16 || min > 59) throw new Error('Enter a time between 9 AM and 4 PM Eastern.')
  const wall = Date.UTC(y, m - 1, d, h, min)
  const format = new Intl.DateTimeFormat('en-CA', {timeZone: INTRO_ZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  let instant = wall
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map(p => [p.type, p.value]))
    const shown = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute)
    instant += wall - shown
  }
  return new Date(instant).toISOString()
}
