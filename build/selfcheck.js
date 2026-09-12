/**
 * Self-check for the portable build.
 *
 * Runs against a throwaway data directory and an ephemeral port, so it never
 * touches real notes or logs. Three things are proven here: the page renders, the
 * HTTP routes answer with the shapes the page expects, and an edit round-trips
 * through disk and comes back applied.
 *
 * Run with: node build/selfcheck.js
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

/* The app resolves its data directory at require time, so this must be set first. */
const SANDBOX = path.join(os.tmpdir(), 'ddon-hub-selfcheck-' + Date.now())
process.env.DDON_HUB_DATA = SANDBOX
fs.mkdirSync(SANDBOX, { recursive: true })

const logger = require('../src/logger.js')
const notes = require('../src/notes.js')
const page = require('../src/page.js')
const upstream = require('../src/upstream.js')
const { SNAPSHOT, LEGEND } = require('../src/data.js')
const manifest = require('../src/manifest.js')

let passed = 0
function ok(label) {
  passed += 1
  console.log('  ok  ' + label)
}

/* ------------------------------------------------------------------- data */

/*
 * Nothing may reach outside this project at runtime.
 *
 * An earlier version imported the DSH plugin by absolute path
 * (`C:\Users\...\.dsh\plugins\...`) to reuse its parsing functions. That works on
 * this machine and fails on every other one: the exe shipped carrying a hard
 * dependency the recipient does not have, and every request reported
 * "Cannot find module". The copies live in `src/parsers.js` and `sync-check.js`
 * keeps them honest; this scan stops a local-path dependency from coming back.
 */
const SRC_DIR = path.join(__dirname, '..', 'src')
const sourceFiles = fs.readdirSync(SRC_DIR).filter((name) => name.endsWith('.js'))
const externalRefs = []
for (const name of sourceFiles) {
  const text = fs.readFileSync(path.join(SRC_DIR, name), 'utf8')
  for (const match of text.matchAll(/(?:require|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const spec = match[1]
    const relative = spec.startsWith('./') || spec.startsWith('../')
    const builtin = spec.startsWith('node:') || ['fs', 'path', 'os', 'http', 'https', 'url', 'zlib', 'vm', 'crypto', 'assert', 'events', 'stream', 'util'].includes(spec)
    if (!relative && !builtin) externalRefs.push(`${name} requires "${spec}"`)
  }
  /*
   * A user-specific absolute path in live code — comments may mention one.
   * `C:\Program Files` is deliberately not flagged: that one is a legitimate
   * fallback when an environment variable is unset, and it is the same path on
   * every Windows machine. What must never come back is a path under a particular
   * user's profile, which is what the plugin import was.
   */
  for (const match of text.matchAll(/['"]([A-Za-z]:\\\\Users\\\\[^'"]+|C:\\\\Users\\\\[^'"]+)['"]/g)) {
    externalRefs.push(`${name} embeds the absolute path ${match[1].slice(0, 46)}`)
  }
}
assert.deepEqual(
  externalRefs,
  [],
  'src/ must not reference anything outside the project:\n    ' + externalRefs.join('\n    '),
)
ok('src/ has no external module or absolute-path dependency (' + sourceFiles.length + ' files scanned)')

/*
 * And the same check on the bundle that actually ships.
 *
 * The scan above reads `src/`; the exe runs what esbuild produced. Bundling inlines
 * every reachable module, so a path that survives into the bundle is a path the
 * recipient will try to resolve. This is the check that would have caught the
 * plugin import before an exe was built with it.
 */
const BUNDLE = path.join(__dirname, '_stage', 'app.cjs')
if (fs.existsSync(BUNDLE)) {
  const bundled = fs.readFileSync(BUNDLE, 'utf8')
  const leaked = []
  for (const match of bundled.matchAll(/['"`]([A-Za-z]:\\\\Users\\\\[^'"`]+)['"`]/g)) leaked.push(match[1].slice(0, 60))
  for (const match of bundled.matchAll(/['"`]([^'"`]*\.dsh[\\/][^'"`]*)['"`]/g)) leaked.push(match[1].slice(0, 60))
  assert.deepEqual(leaked, [], 'the shipped bundle embeds paths that only exist on this machine:\n    ' + leaked.join('\n    '))
  ok('shipped bundle carries no machine-specific path (' + (bundled.length / 1024).toFixed(0) + ' KB scanned)')
} else {
  console.log('  --  bundle not built yet, skipping the shipped-bundle scan')
}

assert.equal(SNAPSHOT.jobs.length, 11, 'eleven jobs are baked in')
assert.ok(
  SNAPSHOT.jobs.every((job) => (job.details || []).every((d) => (d.cells || []).every((c) => typeof c.skill === 'string' && c.skill !== ''))),
  'every cell carries its skill name',
)
assert.ok(LEGEND.includes('剩余箭矢') && LEGEND.includes('蓄力点数'), 'the legend explains both 残弾 meanings')
assert.equal(manifest.counts.cells, 3064, 'the baked cell count is recorded')
ok('baked snapshot: ' + SNAPSHOT.jobs.length + ' jobs, ' + manifest.counts.details + ' detail tables, ' + manifest.counts.cells + ' cells')

/* -------------------------------------------------------------------- page */

const rendered = page.renderPage({ jobs: SNAPSHOT, stats: notes.stats(SNAPSHOT.jobs, notes.readStore()), manifest, lan: false })
assert.ok(rendered.startsWith('<!doctype html>'), 'the page is a full document')
assert.ok(rendered.includes('id="boot"'), 'the job tree is embedded for the first paint')
assert.ok(rendered.includes('导出诊断包'), 'the diagnostics button is present')
assert.ok(rendered.includes('退出'), 'the exit button is present')
/*
 * The icons are injected as data URIs. A first build read them from disk at
 * runtime, which the bundler cannot carry, so the page shipped without a favicon
 * or a crest and nothing failed. These two assertions are what catch that.
 */
assert.ok(rendered.includes('rel="icon"'), 'the favicon is inlined into the page head')
assert.ok(rendered.includes('data:image/png;base64,'), 'the icon bytes are embedded, not linked')
assert.ok(rendered.includes('class="crest"'), 'the header crest is rendered')
const bootMatch = /<script id="boot"[^>]*>([\s\S]*?)<\/script>/.exec(rendered)
assert.notEqual(bootMatch, null, 'the boot block can be extracted again (the page reloads it after an edit)')
const boot = JSON.parse(bootMatch[1])
assert.equal(boot.jobs.length, 11, 'the boot block carries every job')
assert.equal(boot.defaultJob, '獵人', 'the hunter page is the default tab')
ok('page renders: ' + (rendered.length / 1024).toFixed(0) + ' KB, boot block parses back')

/* The browser-side helpers are pure; check the two that had real bugs. */
assert.equal(page.cellText({ zhValue: '2.5s(架式)', value: '2.5s(構え)' }), '2.5s(架式)', 'a detail value renders the translation')
assert.equal(page.cellText({ value: '構え' }), '', 'an untranslated value is empty, not Japanese')
assert.equal(page.noteText({ zhNote: '以 8 連發為前提。' }), '以 8 連發為前提。', 'a note renders the translation')
assert.equal(page.noteText({ zhNote: '', note: '８セット発前提。' }), '', 'a missing note translation is pending, not Japanese')
assert.equal(page.hasKana('煉成・環爆'), false, 'U+30FB is not treated as kana')
ok('render helpers: zhValue/zhNote only, pending instead of raw Japanese')

/* --------------------------------------------------------------- upstream */

const probe = upstream.cacheSnapshot()
assert.equal(probe.revival.loaded, false, 'the cache starts cold')
assert.ok('rising' in probe, 'the cache tracks the third server too')
ok('cache snapshot reports cold state before any fetch')

/* All three upstreams must be wired, including the one whose payload is a single
   object rather than a list, and the news feed that cannot be read server-side. */
const cfg = upstream.CONFIG
for (const key of ['revivalStatusUrl', 'legacyStatusUrl', 'risingStatusUrl']) {
  assert.ok(typeof cfg[key] === 'string' && cfg[key].startsWith('https://'), `${key} is an https endpoint`)
}
assert.equal(cfg.newsSources.length, 2, 'two pages are scraped for news')
for (const key of ['rising', 'risingNews', 'risingDiscord', 'risingHowToPlay', 'risingMap']) {
  assert.ok(typeof cfg.links[key] === 'string' && cfg.links[key] !== '', `links.${key} is set`)
}
assert.ok(cfg.links.risingNews.includes('dogmarising'), 'the Dogma Rising news link points at that site')
ok('three status upstreams and the Dogma Rising links are configured')

/* ------------------------------------------------------------------- notes */

const hunter = SNAPSHOT.jobs.find((row) => row.ja === 'ハンター')
const target = hunter.summaryRows.find((row) => (row.note || '') !== '')
const source = target.note
notes.save({ kind: 'note', source, target: '自检写入的备注' })
const applied = notes.applyOverrides(SNAPSHOT, notes.readStore())
const afterRow = applied.jobs.find((row) => row.ja === 'ハンター').summaryRows.find((row) => (row.note || '') === source)
assert.equal(afterRow.zhNote, '自检写入的备注', 'a saved note comes back applied')
assert.equal(afterRow.noteEdited, true, 'an edited note is flagged')
const pristine = SNAPSHOT.jobs.find((row) => row.ja === 'ハンター').summaryRows.find((row) => (row.note || '') === source)
assert.equal(pristine.noteEdited, undefined, 'the baked snapshot is never mutated')
ok('note edit round-trips through disk and back')

const cell = SNAPSHOT.jobs[0].details[0].cells[0]
notes.save({ kind: 'cell', job: SNAPSHOT.jobs[0].ja, skill: cell.skill, label: cell.label, source: cell.value, target: '自检写入的数值' })
const appliedCell = notes.applyOverrides(SNAPSHOT, notes.readStore()).jobs[0].details[0].cells[0]
assert.equal(appliedCell.zhValue, '自检写入的数值', 'a detail value override applies')
assert.equal(appliedCell.valueEdited, true, 'an edited value is flagged')
ok('detail value edit round-trips through disk and back')

const stats = notes.stats(SNAPSHOT.jobs, notes.readStore())
assert.ok(stats.overridden >= 1, 'the coverage summary counts the edit')
assert.equal(stats.editedCells, 1, 'the coverage summary counts the edited cell')
assert.ok(stats.log.length >= 2, 'the edit log records what changed')
assert.ok(stats.file.startsWith(SANDBOX), 'notes live in the data directory, not beside the exe')
ok('coverage summary: ' + stats.total + ' notes, ' + stats.overridden + ' edited, ' + stats.editedCells + ' cells, ' + stats.log.length + ' log rows')

/*
 * The path shown in the UI has to be one a person can paste into Explorer. The
 * process may see an 8.3 short name (`CHENKE~1`), which is why there are two
 * fields and only one of them is for display.
 */
assert.ok(typeof stats.dir === 'string' && stats.dir !== '', 'a display path is reported')
assert.ok(!/~\d/.test(stats.dir), 'the display path has no 8.3 short name: ' + stats.dir)
assert.ok(stats.dir === stats.dataDir || stats.dir.endsWith('ddon-hub-portable') || stats.dir.includes('ddon'), 'the display path still names the app folder')
ok('display path is readable: ' + stats.dir)

/*
 * The footer and the exit dialog are both built in the browser from the polled
 * payload, so the server-rendered HTML holds the code that reads the path rather
 * than the path itself. Assert on the code and on the payload field; the value is
 * asserted above.
 */
const renderedWithStats = page.renderPage({ jobs: SNAPSHOT, stats, manifest, lan: false })
assert.ok(renderedWithStats.includes('保存位置'), 'the footer has a save-location row')
assert.ok(renderedWithStats.includes('esc(stats.dir || stats.dataDir'), 'the footer renders the data directory from the payload')
assert.ok(renderedWithStats.includes('你改过的备注和详表数值已经保存在'), 'the exit dialog says where the data went')
assert.ok(renderedWithStats.includes('state.hub.notes.dir'), 'the exit dialog reads the path from the payload')
ok('page names the data directory in the footer and the exit dialog')

/*
 * Parse the page's inline scripts exactly as the browser receives them.
 *
 * This is the check that was missing when a real line break inside a quoted string
 * shipped: the markup rendered, every fetch-driven section stayed empty, and the
 * page looked "loaded but dead". Nothing short of parsing the emitted code catches
 * that — string assertions pass either way.
 */
const inlineScripts = [...rendered.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1])
assert.ok(inlineScripts.length >= 2, 'the page emits a boot block and the app script')
inlineScripts.forEach((body, index) => {
  try {
    if (/^\s*\{/.test(body)) JSON.parse(body)
    else new vm.Script(body, { filename: `inline-${index}.js` })
  } catch (error) {
    assert.fail(`inline script #${index} does not parse: ${error.message}`)
  }
})
ok('both inline scripts parse (' + inlineScripts.map((s) => (s.length / 1024).toFixed(0) + ' KB').join(' + ') + ')')

/* Notes must survive a "restart": a fresh read of the same file. */
const reread = notes.readStore()
assert.equal(reread.notes[source], '自检写入的备注', 'notes survive a reload from disk')
ok('notes persist across a simulated restart')

/* ------------------------------------------------------------------ server */

const serverHandler = require('../src/server.js').__handlerForTests

const request = (port, urlPath, options) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: (options && options.method) || 'GET', headers: (options && options.headers) || {} },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }))
      },
    )
    req.on('error', reject)
    if (options && options.body) req.write(options.body)
    req.end()
  })

async function serverChecks() {
  const port = 8899
  const instance = http.createServer((req, res) => {
    serverHandler(req, res).catch((error) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(error && error.stack ? error.stack : error))
    })
  })
  await new Promise((resolve) => instance.listen(port, '127.0.0.1', resolve))

  const health = await request(port, '/healthz')
  assert.equal(health.status, 200, 'healthz answers')

  const home = await request(port, '/')
  assert.equal(home.status, 200, 'the page is served')
  assert.ok(home.headers['content-type'].includes('text/html'), 'the page is html')
  assert.ok(home.buffer.toString('utf8').includes('DDON 资料站'), 'the page carries its title')
  ok('GET / serves the page')

  const bad = await request(port, '/nope')
  assert.equal(bad.status, 404, 'an unknown path is a 404')

  /*
   * Chrome's app window asks the site root for /favicon.ico. Without this route
   * the launched window kept a generic icon even though the exe carried the right
   * one, which is a defect that is invisible from the page source alone.
   */
  const ico = await request(port, '/favicon.ico')
  assert.equal(ico.status, 200, 'the site root serves /favicon.ico')
  assert.equal(ico.headers['content-type'], 'image/x-icon', 'with the icon content type')
  assert.equal(ico.buffer.readUInt16LE(0), 0, 'the payload starts with the ICO reserved field')
  assert.equal(ico.buffer.readUInt16LE(2), 1, 'and declares itself an icon')
  assert.ok(ico.buffer.length > 10000, 'and carries the real multi-size icon, not a stub')
  ok('GET /favicon.ico serves the icon (' + (ico.buffer.length / 1024).toFixed(0) + ' KB)')

  const favPng = await request(port, '/favicon.png')
  assert.equal(favPng.status, 200, 'the png favicon is served too')
  assert.equal(favPng.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'and is a PNG')
  ok('GET /favicon.png serves a PNG')

  const badNote = await request(port, '/api/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: '' }),
  })
  assert.equal(badNote.status, 400, 'an empty source is rejected with 400, not a crash')
  ok('unknown path 404s and a bad edit 400s')

  const goodNote = await request(port, '/api/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'note', source: '自检键', target: '自检值' }),
  })
  assert.equal(goodNote.status, 200, 'a valid edit is accepted')
  assert.equal(JSON.parse(goodNote.buffer.toString('utf8')).ok, true, 'and reports ok')
  ok('POST /api/note accepts an edit')

  const diag = await request(port, '/api/diagnostics?reason=selfcheck')
  assert.equal(diag.status, 200, 'the diagnostic bundle is built')
  const diagBody = JSON.parse(diag.buffer.toString('utf8'))
  assert.ok(fs.existsSync(diagBody.file), 'the bundle file exists on disk')
  assert.ok(diagBody.entries.includes('manifest.json') && diagBody.entries.includes('summary.txt'), 'the bundle carries a manifest and a readable summary')
  assert.ok(diagBody.entries.some((name) => name.startsWith('logs/')), 'the bundle carries logs')
  ok('diagnostic bundle: ' + diagBody.entries.length + ' files, ' + (diagBody.bytes / 1024).toFixed(1) + ' KB')

  const download = await request(port, '/api/diagnostics/download?reason=selfcheck')
  assert.equal(download.status, 200, 'the bundle downloads')
  assert.ok(download.headers['content-disposition'].includes('.zip'), 'as a zip attachment')
  assert.equal(download.headers['content-type'], 'application/zip', 'with the zip content type')
  assert.equal(download.buffer.subarray(0, 2).toString('latin1'), 'PK', 'the download starts with the zip magic number')
  ok('diagnostic bundle downloads as a zip')

  await new Promise((resolve) => instance.close(resolve))
}

async function main() {
  console.log('portable self-check')
  await serverChecks()
  logger.prune()
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error('\nself-check failed:', error && error.stack ? error.stack : error)
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(1)
})
