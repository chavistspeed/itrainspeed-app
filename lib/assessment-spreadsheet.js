export const MAX_FILE_BYTES = 50 * 1024 * 1024

export function fileKind(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['xlsx', 'csv'].includes(ext)) return 'spreadsheet'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'document'
  throw new Error('Choose an Excel (.xlsx), CSV, PDF, MP4, WebM, or MOV file.')
}

export function fileContentType(name) {
  return { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[name.split('.').pop().toLowerCase()]
}

export function parseCSV(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((c === '\n' || c === '\r') && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''
      if (c === '\r' && text[i + 1] === '\n') i++
    } else cell += c
  }
  if (quoted) throw new Error('CSV contains an unfinished quoted field.')
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function cellText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result)
    if (value.richText) return value.richText.map(t => t.text).join('')
    return String(value.text || value.error || '')
  }
  return String(value)
}

function previewSheet(name, rows) {
  const nonempty = rows.filter(row => row.some(v => v !== ''))
  return { name, rows: nonempty.slice(0, 200).map(row => row.slice(0, 30).map(v => cellText(v).slice(0, 1000))), truncated: nonempty.length > 200 || nonempty.some(row => row.length > 30) }
}

export async function spreadsheetPreview(file) {
  if (/\.csv$/i.test(file.name)) return [previewSheet('Results', parseCSV(await file.text()))]
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  return workbook.worksheets.slice(0, 5).map(sheet => {
    const rows = []
    sheet.eachRow(row => rows.push(Array.from({ length: Math.min(row.cellCount, 30) }, (_, i) => cellText(row.getCell(i + 1).value))))
    const preview = previewSheet(sheet.name, rows)
    preview.truncated ||= sheet.columnCount > 30 || workbook.worksheets.length > 5
    return preview
  })
}
