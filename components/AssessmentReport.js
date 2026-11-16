'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AssessmentReport({ report }) {
  const [urls, setUrls] = useState({})
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setUrls({}); setError('')
    const paths = (report.attachments || []).map(a => a.path)
    if (!paths.length) return
    supabase().storage.from('assessment-files').createSignedUrls(paths, 3600).then(({ data, error }) => {
      if (!active) return
      if (error || data?.some(item => item.error)) setError('Some files could not be loaded. Try refreshing the files.')
      setUrls(Object.fromEntries((data || []).filter(item => item.signedUrl).map(item => [item.path, item.signedUrl])))
    }).catch(() => { if (active) setError('Files could not be loaded. Try refreshing the files.') })
    return () => { active = false }
  }, [report, refresh])

  return <article className="card assessmentReport">
    <div className="row"><h2>{report.title}</h2><span>{new Date(report.assessed_on + 'T12:00:00').toLocaleDateString()}</span></div>
    {report.status === 'draft' && <p className="notice">Draft — visible to coaches only</p>}
    {!!report.metrics?.length && <div className="assessmentTable"><table><thead><tr><th>Test</th><th>Result</th><th>Unit</th></tr></thead><tbody>{report.metrics.map((m, i) => <tr key={i}><td>{m.test}</td><td>{m.result}</td><td>{m.unit}</td></tr>)}</tbody></table></div>}
    {report.notes && <section><h3>Coach’s feedback</h3><p className="assessmentText">{report.notes}</p></section>}
    {report.training_focus && <section><h3>Recommended training focus</h3><p className="assessmentText">{report.training_focus}</p></section>}
    {(report.attachments || []).map(file => <section key={file.path}>
      <h3>{file.name}</h3>
      {file.kind === 'video' && urls[file.path] && <video controls playsInline preload="metadata" src={urls[file.path]} style={{ width: '100%', maxHeight: 480 }}>Your browser does not support this video. Use the file link below.</video>}
      {file.kind === 'video' && /\.mov$/i.test(file.name) && <p className="subtle">If this video does not play on your device, download it below. MP4 works on most devices.</p>}
      {(file.sheets || []).map((sheet, index) => <div key={index}><h4>{sheet.name}</h4><div className="assessmentTable"><table><tbody>{sheet.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => i === 0 ? <th key={j} scope="col">{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>{sheet.truncated && <p className="subtle">Preview limited to 200 rows, 30 columns, and 5 sheets. Download the spreadsheet for all results.</p>}</div>)}
      {urls[file.path] ? <a href={urls[file.path]} target="_blank" rel="noopener noreferrer">Open / download {file.name}</a> : <p className="subtle">Loading file…</p>}
    </section>)}
    {error && <p role="alert">{error}</p>}
    {!!report.attachments?.length && <button type="button" className="secondary smallBtn" onClick={() => setRefresh(n => n + 1)}>Refresh files</button>}
  </article>
}
