/**
 * End-to-end check against a running exe.
 *
 * PowerShell mangles non-ASCII in request bodies (its console codepage is not
 * UTF-8), which silently corrupts the Japanese note key, so the whole exchange is
 * done here with node:http instead.
 *
 * Run with: node build/e2e.js <port> [--write]
 */
'use strict'

const http = require('node:http')

const port = Number(process.argv[2] || 8811)
const write = process.argv.includes('--write')

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {} },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }))
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  const hub = JSON.parse((await call('GET', '/api/hub')).buffer.toString('utf8'))
  const hunter = hub.jobs.jobs.find((job) => job.ja === 'ハンター')
  const row = hunter.summaryRows.find((r) => (r.note || '') !== '')
  console.log('target note key :', JSON.stringify(row.note))
  console.log('current zhNote  :', JSON.stringify(row.zhNote))

  if (!write) {
    console.log('(read-only; pass --write to save an edit)')
    return
  }

  const target = '端到端测试写入'
  const saved = await call('POST', '/api/note', { kind: 'note', source: row.note, target })
  console.log('POST /api/note  :', saved.status, saved.buffer.toString('utf8'))
  if (saved.status !== 200) process.exit(1)

  const after = JSON.parse((await call('GET', '/api/hub')).buffer.toString('utf8'))
  const afterRow = after.jobs.jobs.find((job) => job.ja === 'ハンター').summaryRows.find((r) => (r.note || '') === row.note)
  console.log('after reload    :', JSON.stringify(afterRow.zhNote), 'edited=' + afterRow.noteEdited)
  console.log('note stats      :', after.notes.overridden + '/' + after.notes.total, 'editedCells=' + after.notes.editedCells)
  if (afterRow.zhNote !== target) {
    console.log('FAIL: the edit did not come back applied')
    process.exit(1)
  }
  console.log('OK: note edit round-trips over HTTP with non-ASCII keys intact')

  /* A detail value has no key of its own: it is addressed by job + skill + label +
     the original text, which only works if every cell carries its skill name. */
  const job = hub.jobs.jobs.find((j) => j.details && j.details.some((d) => (d.cells || []).some((c) => c.value)));
  const detail = job.details.find((d) => (d.cells || []).some((c) => c.value && c.value !== '-'))
  const cell = detail.cells.find((c) => c.value && c.value !== '-')
  const cellTarget = '端到端数值'
  const savedCell = await call('POST', '/api/note', {
    kind: 'cell',
    job: job.ja,
    skill: cell.skill,
    label: cell.label,
    source: cell.value,
    target: cellTarget,
  })
  console.log('POST cell       :', savedCell.status, savedCell.buffer.toString('utf8'))
  if (savedCell.status !== 200) process.exit(1)

  const afterCell = JSON.parse((await call('GET', '/api/hub')).buffer.toString('utf8'))
  const sameJob = afterCell.jobs.jobs.find((j) => j.ja === job.ja)
  const sameDetail = sameJob.details.find((d) => d.ja === detail.ja)
  const sameCell = sameDetail.cells.find((c) => c.value === cell.value && c.label === cell.label)
  console.log('cell after      :', JSON.stringify(sameCell.zhValue), 'edited=' + sameCell.valueEdited)
  console.log('note stats      :', afterCell.notes.editedCells + ' edited cells')
  if (sameCell.zhValue !== cellTarget) {
    console.log('FAIL: the detail value edit did not come back applied')
    process.exit(1)
  }
  console.log('OK: detail value edit round-trips over HTTP')
}

main().catch((error) => {
  console.error('e2e failed:', error && error.message ? error.message : error)
  process.exit(1)
})
