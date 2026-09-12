/**
 * Offline-degradation check.
 *
 * Recipients sit behind different networks, and one of the two status APIs is a
 * Japanese host. The question this answers: when every upstream is unreachable,
 * does the app still open and explain itself, or does it fail to start?
 *
 * The upstream URLs are redirected to an unroutable address (RFC 5737 TEST-NET-1,
 * which never answers) before the modules load, so the real failure path runs
 * without touching the network.
 *
 * Run with: node build/offline-check.js
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const SANDBOX = path.join(os.tmpdir(), 'ddon-hub-offline-' + Date.now())
process.env.DDON_HUB_DATA = SANDBOX
fs.mkdirSync(SANDBOX, { recursive: true })

/*
 * Stand in for "no route": patch the config after it is loaded but before any
 * request is made. A short timeout keeps the check fast.
 */
const upstream = require('../src/upstream.js')
upstream.CONFIG.revivalStatusUrl = 'http://192.0.2.1/status'
upstream.CONFIG.legacyStatusUrl = 'http://192.0.2.1/status'
upstream.CONFIG.risingStatusUrl = 'http://192.0.2.1/status'
upstream.CONFIG.newsSources = [
  { id: 'revival', label: 'DDON Revival', url: 'http://192.0.2.1/' },
  { id: 'legacy', label: 'LegacyDDON', url: 'http://192.0.2.1/' },
]
upstream.CONFIG.timeoutMs = 2500

const notes = require('../src/notes.js')
const { SNAPSHOT } = require('../src/data.js')
const manifest = require('../src/manifest.js')
const { renderPage } = require('../src/page.js')
const serverHandler = require('../src/server.js').__handlerForTests

const request = (port, urlPath) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })

async function main() {
  console.log('offline-degradation check')

  /* The page is server-rendered from baked data, so it must not need the network. */
  const html = renderPage({ jobs: SNAPSHOT, stats: notes.stats(SNAPSHOT.jobs, notes.readStore()), manifest, lan: false })
  assert.ok(html.includes('id="jobs"'), 'the page renders its job switcher')
  assert.ok(html.includes('獵人'), 'the baked job data is in the page')
  console.log('  ok  the page renders without touching the network (' + (html.length / 1024).toFixed(0) + ' KB)')

  const port = 8877
  const instance = http.createServer((req, res) => {
    serverHandler(req, res).catch((error) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(error && error.stack ? error.stack : error))
    })
  })
  await new Promise((resolve) => instance.listen(port, '127.0.0.1', resolve))

  const home = await request(port, '/')
  assert.equal(home.status, 200, 'the page is still served with no network')
  assert.ok(home.buffer.toString('utf8').includes('职业技能数据'), 'and still carries the tables')
  console.log('  ok  GET / answers 200 with every upstream dead')

  const hub = await request(port, '/api/hub')
  assert.equal(hub.status, 200, 'the api answers rather than erroring')
  const body = JSON.parse(hub.buffer.toString('utf8'))
  assert.equal(body.ok, true, 'and reports ok')
  assert.equal(body.jobs.jobs.length, 11, 'the baked skill data is still complete')
  assert.equal(body.servers.length, 3, 'all three server cards are still present')
  assert.ok(
    body.servers.every((row) => row.live === false && typeof row.error === 'string' && row.error !== ''),
    'every server card reports why it has no numbers',
  )
  assert.equal(body.news, null, 'news reports as unavailable rather than empty-but-ok')
  console.log('  ok  /api/hub degrades: 11 jobs intact, all ' + body.servers.length + ' cards carry a reason, news null')
  console.log('        first reason: ' + body.servers[0].error)

  const again = await request(port, '/api/hub')
  assert.equal(again.status, 200, 'a second call is not slower or broken')
  const againBody = JSON.parse(again.buffer.toString('utf8'))
  assert.ok(
    againBody.servers.every((row) => row.live === false),
    'the second call still reports the outage',
  )
  console.log('  ok  repeated calls stay healthy')

  /*
   * The page polls every 30 seconds. Without a failure memory each poll would
   * block for the full timeout, which on an unreachable network reads as "the page
   * is always slow" — so the second call must return promptly.
   */
  const started = Date.now()
  await request(port, '/api/hub')
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1500, `a poll during an outage must not block (took ${elapsed}ms)`)
  console.log('  ok  a poll during an outage returns in ' + elapsed + 'ms instead of blocking again')

  await new Promise((resolve) => instance.close(resolve))
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  console.log('\nOK: the app opens and explains itself with no reachable upstream')
}

main().catch((error) => {
  console.error('\noffline check failed:', error && error.stack ? error.stack : error)
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(1)
})
