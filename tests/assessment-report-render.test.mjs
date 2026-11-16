import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadComponent } from './helpers/load-component.mjs'
const Report = loadComponent(new URL('../components/AssessmentReport.js', import.meta.url).pathname).default
test('parent report renders scores, workbook preview and feedback as escaped text', () => {
  const html = renderToStaticMarkup(createElement(Report, { report: {
    title: 'Speed assessment', assessed_on: '2026-11-16', status: 'published',
    notes: '<script>alert("unsafe")</script>', training_focus: 'Acceleration and posture',
    metrics: [{ test: '10m fly', result: '1.35', unit: 'seconds' }],
    attachments: [{ path: 'report/scores.xlsx', name: 'scores.xlsx', kind: 'spreadsheet', sheets: [{ name: 'Speed', rows: [['Test','Result'], ['Standing jump','1.85m']], truncated: true }] }],
  } }))
  for (const text of ['Speed assessment','10m fly','1.35','seconds','Standing jump','1.85m','Acceleration and posture','Preview limited to 200 rows']) assert.ok(html.includes(text), text)
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('visible to coaches only'))
})
