// Isolated UI acceptance checks. Supabase requests are mocked; no customer data is changed.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE })
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3100'
const athleteId = '10000000-0000-0000-0000-000000000001'
const reportId = '20000000-0000-0000-0000-000000000001'
const errors = []
let report, failUpload = false, uploads = 0
async function open(role) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const user = { id: role === 'coach' ? 'coach-1' : 'parent-1', email: `${role}@example.test`, aud: 'authenticated', role: 'authenticated' }
  const token = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.test'
  const session = { access_token: token, refresh_token: 'test-refresh', expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user }
  await context.addCookies([{ name: 'sb-example-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base }])
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://example.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()
    let response = [], status = 200
    if (url.pathname.includes('/auth/v1/user')) response = user
    else if (url.pathname.includes('/auth/v1/token')) response = session
    else if (table === 'profiles') response = { role, full_name: 'Test Family' }
    else if (table === 'get_coach_athletes_v2') response = [{ athlete_id: athleteId, first_name: 'Alex', last_name: 'Runner', guardian_name: 'Test Family' }]
    else if (table === 'athletes') response = [{ id: athleteId, first_name: 'Alex', last_name: 'Runner' }]
    else if (table === 'athlete_assessments') {
      if (req.method() === 'GET') response = report && (role === 'coach' || report.status === 'published') ? [report] : []
      else {
        const body = req.postDataJSON()
        report = { ...report, ...body, id: reportId, created_at: '2026-11-16T15:00:00Z' }
        response = report
      }
    } else if (url.pathname.includes('/object/sign/assessment-files')) response = req.postDataJSON().paths.map(path => ({ path, signedURL: '/object/sign/assessment-files/' + path + '?token=fixture' }))
    else if (url.pathname.includes('/object/assessment-files/')) {
      if (failUpload) { status = 500; response = { statusCode: 500, message: 'Fixture upload failure', error: 'Fixture upload failure' } }
      else { uploads++; response = { Key: 'assessment-files/' + url.pathname.split('/assessment-files/')[1] } }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) })
  })
  return { context, page }
}
try {
  const { page: coach, context: coachContext } = await open('coach')
  await coach.goto(base + '/coach/assessment-reports?athlete=' + athleteId)
  await coach.getByRole('heading', { name: 'Add assessment for Alex Runner' }).waitFor()
  await coach.getByLabel('Report title').fill('November speed assessment')
  await coach.getByLabel('Test', { exact: true }).fill('10m fly')
  await coach.getByLabel('Result', { exact: true }).fill('1.35')
  await coach.getByLabel('Unit', { exact: true }).fill('seconds')
  await coach.getByLabel('Coach’s feedback').fill('Improved posture and effort')
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Speed results')
  sheet.addRow(['Test', 'Result']); sheet.addRow(['Standing long jump', '1.85m'])
  const excel = Buffer.from(await book.xlsx.writeBuffer())
  await coach.getByLabel('Upload spreadsheet, PDF, or videos').setInputFiles([{ name: 'alex.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel }, { name: 'sprint.webm', mimeType: 'video/webm', buffer: Buffer.from('fixture-video') }])
  await coach.getByRole('button', { name: 'Save draft', exact: true }).click()
  await coach.getByText('Draft saved. Parents cannot see it until you publish.').waitFor()
  assert.equal(report.status, 'draft'); assert.equal(report.attachments.length, 2)
  assert.equal(uploads, 2)
  await coach.getByRole('cell', { name: 'Standing long jump', exact: true }).waitFor()
  assert.equal(await coach.locator('video[controls]').count(), 1)
  const { page: parent, context: parentContext } = await open('parent')
  await parent.goto(base + '/assessment-reports')
  await parent.getByText('No assessments have been shared for this athlete yet.', { exact: false }).waitFor()
  await coach.getByRole('button', { name: 'Publish to parent', exact: true }).click()
  await coach.getByText('Published. This athlete’s parent can now view', { exact: false }).waitFor()
  await parent.reload()
  await parent.getByRole('heading', { name: 'November speed assessment', exact: true }).waitFor()
  await parent.getByRole('cell', { name: '1.35', exact: true }).waitFor()
  await parent.getByRole('cell', { name: 'Standing long jump', exact: true }).waitFor()
  assert.equal(await parent.locator('video[controls]').count(), 1)
  assert.ok((await parent.getByRole('link', { name: 'Open / download alex.xlsx' }).getAttribute('href')).includes('/object/sign/assessment-files/'))
  assert.equal(await parent.getByRole('button', { name: 'Publish to parent' }).count(), 0)
  assert.equal(await parent.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  failUpload = true
  await coach.getByLabel('Upload spreadsheet, PDF, or videos').setInputFiles({ name: 'extra.csv', mimeType: 'text/csv', buffer: Buffer.from('Test,Result\nJump,2') })
  await coach.getByRole('button', { name: 'Publish to parent', exact: true }).click()
  await coach.getByText('Your report is saved as a draft.', { exact: false }).waitFor()
  assert.equal(report.status, 'draft'); assert.equal(report.attachments.length, 2)
  failUpload = false
  await coach.getByRole('button', { name: 'Publish to parent', exact: true }).click()
  await coach.getByText('Published. This athlete’s parent can now view', { exact: false }).waitFor()
  assert.equal(report.attachments.length, 3); assert.equal(report.status, 'published')
  assert.equal(uploads, 3)
  assert.deepEqual(errors, [])
  console.log('PASS: coach draft + Excel/video uploads; parent draft privacy; publish + parent report; mobile layout; failed-upload recovery with retained files.')
  await coachContext.close(); await parentContext.close()
} finally { await browser.close() }
