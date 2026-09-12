/**
 * Logging, crash capture and the diagnostic bundle.
 *
 * A portable exe that only prints to a console is unhelpful when the person
 * reporting a problem closes the window and has nothing to send. So every run
 * writes dated logs, every unhandled error writes a full crash report, and one
 * button (or `--diagnose`) packs the whole thing into a zip that can be handed
 * over as-is.
 *
 * Logs live outside the exe's folder: the exe may sit on a read-only share or be
 * run straight from a download folder, and mixing user data with the program
 * makes upgrades messy. Nothing here throws — a logging failure must never be the
 * reason the app stops working.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { zip } = require('./zip.js')

const APP = { name: 'ddon-hub-portable', version: '1.0.0' }
const KEEP_LOG_DAYS = 14
const KEEP_CRASH_FILES = 20
const RECENT_LIMIT = 200

/* --------------------------------------------------------------- locations */

/** `%LOCALAPPDATA%\ddon-hub-portable`, or the platform equivalent. */
function defaultDataDir() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_DATA_HOME ||
    (process.env.HOME ? path.join(process.env.HOME, '.local', 'share') : os.tmpdir())
  return path.join(base, APP.name)
}

/**
 * Pick the writable data directory.
 *
 * `DDON_HUB_DATA` wins so a user can redirect it (a USB stick, a synced folder).
 * Otherwise the platform data directory is used, and only if that cannot be
 * created does it fall back to the folder holding the exe.
 */
function resolveDataDir() {
  const candidates = []
  if (process.env.DDON_HUB_DATA) candidates.push(process.env.DDON_HUB_DATA)
  candidates.push(defaultDataDir())
  candidates.push(path.join(__dirname, '..', 'data'))
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true })
      fs.accessSync(candidate, fs.constants.W_OK)
      return candidate
    } catch {
      /* try the next one */
    }
  }
  return os.tmpdir()
}

const DATA_DIR = resolveDataDir()
const LOG_DIR = path.join(DATA_DIR, 'logs')
const CRASH_DIR = path.join(DATA_DIR, 'crashes')

/**
 * Expand an 8.3 short name in a path.
 *
 * `%LOCALAPPDATA%` and `%TEMP%` both resolve to short forms on some accounts
 * (measured: `C:\Users\CHENKE~1\AppData\Local\...`). That is the path the process
 * really uses, but it is not one a person can recognise or paste with confidence,
 * and this path is shown in the UI.
 *
 * The environment is the source of truth here: each of these variables points at a
 * directory whose long form is already known, so a short prefix is simply swapped
 * for its long equivalent. No filesystem enumeration is needed, and nothing that
 * is not a known variable is touched.
 *
 * Runs at module load, so it must not call `log` — that is defined further down.
 */
function expandShortPath(raw) {
  if (process.platform !== 'win32') return raw
  const values = [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.TEMP || process.env.TMP, process.env.ProgramData]
  for (const value of values) {
    if (typeof value !== 'string' || value === '') continue
    const head = (text) => text.split(/[\\/]/).slice(0, 3).join('\\')
    const rawLead = head(raw).toLowerCase()
    /* Only the account segment gets shortened; comparing whole paths would fail on
       the differences further down. */
    if (!/\~\d/.test(rawLead)) continue
    const longHead = head(value)
    if (rawLead === longHead.toLowerCase()) continue
    const rest = raw.split(/[\\/]/).slice(3).join('\\')
    return rest === '' ? longHead : `${longHead}\\${rest}`
  }
  return raw
}

const DISPLAY_DIR = expandShortPath(DATA_DIR)

for (const dir of [DATA_DIR, LOG_DIR, CRASH_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* reported by the first write attempt instead */
  }
}

/* ------------------------------------------------------------------ writing */

const recent = []

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z')
}

/** `app-YYYY-MM-DD.log`, so rotation is a name change rather than a rename. */
function logFileFor(date) {
  return path.join(LOG_DIR, `app-${date.toISOString().slice(0, 10)}.log`)
}

/** One line: timestamp, level, message, optional compact JSON detail. */
function formatLine(date, level, message, detail) {
  let tail = ''
  if (detail !== undefined) {
    try {
      tail = ' ' + JSON.stringify(detail)
    } catch {
      tail = ' [detail not serializable]'
    }
  }
  return `${date.toISOString()} ${level.padEnd(5)} ${message}${tail}\n`
}

function record(level, message, detail) {
  const date = new Date()
  const line = formatLine(date, level, message, detail)
  recent.push({ at: date.toISOString(), level, message, detail })
  if (recent.length > RECENT_LIMIT) recent.shift()
  try {
    fs.appendFileSync(logFileFor(date), line, 'utf8')
  } catch {
    /* disk full or removed mid-run: keep serving, the console still has it */
  }
  const stream = level === 'ERROR' || level === 'CRASH' ? process.stderr : process.stdout
  try {
    stream.write(line)
  } catch {
    /* console detached */
  }
}

const log = {
  info: (message, detail) => record('INFO', message, detail),
  warn: (message, detail) => record('WARN', message, detail),
  error: (message, detail) => record('ERROR', message, detail),
  recent: () => recent.slice(),
}

/* ------------------------------------------------------------------- crashes */

/** Environment facts worth attaching to a report; no personal data beyond paths. */
function environment() {
  const interfaces = []
  try {
    const nets = os.networkInterfaces()
    for (const [name, rows] of Object.entries(nets)) {
      for (const row of rows || []) {
        if (row.family === 'IPv4' && !row.internal) interfaces.push(`${name} ${row.address}`)
      }
    }
  } catch {
    /* ignore */
  }
  return {
    app: APP,
    startedAt: STARTED_AT,
    now: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    execPath: process.execPath,
    argv: process.argv.slice(1),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpus: os.cpus().length,
    totalMemoryMB: Math.round(os.totalmem() / 1048576),
    freeMemoryMB: Math.round(os.freemem() / 1048576),
    dataDir: DATA_DIR,
    logDir: LOG_DIR,
    cwd: process.cwd(),
    lanAddresses: interfaces,
    env: {
      DDON_HUB_DATA: process.env.DDON_HUB_DATA || null,
      DDON_HUB_PORT: process.env.DDON_HUB_PORT || null,
      LOCALLANG: process.env.LANG || null,
    },
  }
}

const STARTED_AT = new Date().toISOString()

/**
 * Serialize an error the way a report reader needs it: message, stack, and any
 * extra fields the caller attached (URL, status, upstream body).
 */
function describeError(error) {
  if (error === null || error === undefined) return { message: 'unknown error (falsy throw)' }
  if (typeof error !== 'object') return { message: String(error) }
  const out = { message: String(error.message || error) }
  if (error.stack) out.stack = String(error.stack)
  if (error.code) out.code = error.code
  for (const key of ['url', 'status', 'where', 'upstream', 'body']) {
    if (error[key] !== undefined) out[key] = error[key]
  }
  if (error.cause) out.cause = describeError(error.cause)
  return out
}

/** Write one crash report file and log a one-line summary. */
function captureCrash(kind, error, context) {
  const date = new Date()
  const file = path.join(CRASH_DIR, `crash-${stamp(date)}.txt`)
  const payload = {
    kind,
    at: date.toISOString(),
    error: describeError(error),
    context: context === undefined ? null : context,
    environment: environment(),
    recentLog: recent.slice(-60),
  }
  let body
  try {
    body = JSON.stringify(payload, null, 2)
  } catch {
    body = `{"kind":${JSON.stringify(kind)},"note":"context was not serializable"}`
  }
  try {
    fs.writeFileSync(file, body, 'utf8')
  } catch {
    /* reported below regardless */
  }
  record('CRASH', `${kind}: ${payload.error.message}`, { report: file })
  return file
}

/**
 * Install process-level guards. `onFatal` lets the caller print a friendly hint
 * before the process goes down.
 */
function installCrashHandlers(onFatal) {
  process.on('uncaughtException', (error) => {
    const file = captureCrash('uncaughtException', error)
    if (typeof onFatal === 'function') onFatal(error, file)
    record('CRASH', 'uncaught exception; shutting down', { report: file })
    process.exitCode = 1
    /* Let pending log writes flush before the runtime goes away. */
    setTimeout(() => process.exit(1), 50).unref()
  })
  process.on('unhandledRejection', (reason) => {
    captureCrash('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)))
  })
}

/* --------------------------------------------------------------- retention */

function listFiles(dir, prefix) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(prefix === 'crash-' ? '.txt' : '.log'))
      .map((name) => {
        const full = path.join(dir, name)
        return { name, full, at: fs.statSync(full).mtimeMs, size: fs.statSync(full).size }
      })
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

/** Drop logs past the retention window, and old crash reports. */
function prune() {
  const cutoff = Date.now() - KEEP_LOG_DAYS * 86400000
  let removed = 0
  for (const file of listFiles(LOG_DIR, 'app-')) {
    if (file.at < cutoff) {
      try {
        fs.unlinkSync(file.full)
        removed += 1
      } catch {
        /* ignore */
      }
    }
  }
  const crashes = listFiles(CRASH_DIR, 'crash-')
  for (const file of crashes.slice(KEEP_CRASH_FILES)) {
    try {
      fs.unlinkSync(file.full)
      removed += 1
    } catch {
      /* ignore */
    }
  }
  if (removed > 0) log.info('pruned old diagnostics', { removed })
}

/* ------------------------------------------------------------- diagnostics */

/**
 * Probe every upstream and report what came back.
 *
 * This is what makes a bundle actionable: a reader can tell "the page was empty
 * because api.ddon.org timed out from that network" from "the page was empty
 * because the exe is broken".
 */
async function probeUpstreams(config) {
  const https = require('node:https')
  const targets = [
    { id: 'revival-status', url: config.revivalStatusUrl, accept: 'application/json' },
    { id: 'legacy-status', url: config.legacyStatusUrl, accept: 'application/json' },
    ...config.newsSources.map((source) => ({ id: `news:${source.id}`, url: source.url, accept: 'text/html' })),
  ]

  const one = (target) =>
    new Promise((resolve) => {
      const started = Date.now()
      const request = https.get(
        target.url,
        {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ddon-hub-portable diagnostics',
            accept: target.accept,
          },
        },
        (response) => {
          let bytes = 0
          response.on('data', (chunk) => {
            bytes += chunk.length
          })
          response.on('end', () =>
            resolve({ id: target.id, url: target.url, status: response.statusCode, bytes, ms: Date.now() - started, ok: response.statusCode === 200 }),
          )
        },
      )
      request.setTimeout(12000, () => request.destroy(new Error('timeout')))
      request.on('error', (error) => resolve({ id: target.id, url: target.url, status: 0, ms: Date.now() - started, ok: false, error: error.message }))
    })

  return Promise.all(targets.map(one))
}

/**
 * Assemble the bundle: environment, live probes, recent log, crash reports.
 *
 * @returns `{ file, bytes, entries }`
 */
async function buildDiagnosticBundle(options) {
  const config = options.config
  const state = typeof options.state === 'function' ? options.state() : options.state
  const note = options.note || ''
  const at = new Date()
  const probes = await probeUpstreams(config)

  const manifest = {
    app: APP,
    generatedAt: at.toISOString(),
    reason: note || '手动导出',
    port: options.port || null,
    url: options.url || null,
    environment: environment(),
    state: state === undefined ? null : state,
    probes,
    recentLog: recent.slice(-80),
    logFiles: listFiles(LOG_DIR, 'app-').map((file) => ({ name: file.name, bytes: file.size, modified: new Date(file.at).toISOString() })),
    crashFiles: listFiles(CRASH_DIR, 'crash-').map((file) => ({ name: file.name, bytes: file.size, modified: new Date(file.at).toISOString() })),
  }

  const entries = [{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }]

  /* A human-readable first stop, so the reader does not have to parse JSON. */
  const summary = [
    `${APP.name} ${APP.version} 诊断包`,
    `生成时间：${manifest.generatedAt}`,
    `导出原因：${manifest.reason}`,
    `程序地址：${manifest.url || '(未启动)'}`,
    `数据目录：${DATA_DIR}`,
    `系统：${manifest.environment.platform}，Node ${manifest.environment.node}`,
    `运行时长：${manifest.environment.uptimeSeconds} 秒`,
    '',
    '上游连通性：',
    ...probes.map((row) => `  ${row.ok ? 'OK  ' : 'FAIL'} ${row.id.padEnd(18)} ${String(row.status).padEnd(4)} ${String(row.ms).padStart(6)}ms ${String(row.bytes).padStart(7)}B ${row.error || ''}`),
    '',
    `日志文件：${manifest.logFiles.length} 个`,
    `崩溃报告：${manifest.crashFiles.length} 个`,
    ...manifest.crashFiles.slice(0, 5).map((file) => `  ${file.name} (${file.bytes} B, ${file.modified})`),
    '',
    '排除法建议：',
    '  1. 若上游全部 FAIL，是本机网络或对方站点的问题，与程序无关。',
    '  2. 若只有 wiki 相关失败，属正常：技能表是烘在程序里的，不联网取。',
    '  3. 若崩溃报告非空，看 crashes/ 里最新的那份，栈顶就是出错位置。',
  ].join('\n')
  entries.push({ name: 'summary.txt', data: summary })

  /* The log for this run must be in the bundle even if it is empty so far. */
  const logFiles = listFiles(LOG_DIR, 'app-')
  const seen = new Set()
  for (const file of logFiles) {
    seen.add(file.name)
    try {
      entries.push({ name: `logs/${file.name}`, data: fs.readFileSync(file.full) })
    } catch (error) {
      entries.push({ name: `logs/${file.name}.error.txt`, data: `读取失败：${describeError(error).message}` })
    }
  }
  const today = logFileFor(new Date()).split(path.sep).pop()
  if (!seen.has(today)) entries.push({ name: `logs/${today}`, data: formatLine(at, 'INFO', '日志文件在打包时刚创建') })

  for (const file of listFiles(CRASH_DIR, 'crash-')) {
    try {
      entries.push({ name: `crashes/${file.name}`, data: fs.readFileSync(file.full) })
    } catch (error) {
      entries.push({ name: `crashes/${file.name}.error.txt`, data: `读取失败：${describeError(error).message}` })
    }
  }

  const archive = zip(entries)
  const dir = path.join(DATA_DIR, 'diagnostics')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `ddon-hub-diagnostics-${stamp(at)}.zip`)
  fs.writeFileSync(file, archive)
  log.info('diagnostic bundle written', { file, entries: entries.length, bytes: archive.length })
  return { file, bytes: archive.length, entries: entries.map((entry) => entry.name) }
}

module.exports = {
  APP,
  DATA_DIR,
  DISPLAY_DIR,
  LOG_DIR,
  CRASH_DIR,
  log,
  environment,
  describeError,
  captureCrash,
  installCrashHandlers,
  prune,
  probeUpstreams,
  buildDiagnosticBundle,
}
