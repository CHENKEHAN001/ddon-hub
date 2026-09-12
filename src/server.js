/**
 * The portable app's HTTP server.
 *
 * Responsibilities kept deliberately small: serve one page, answer three JSON
 * routes, and own the process lifecycle (pick a port, open a window, shut down
 * cleanly). All the interesting work lives in the modules beside this one.
 *
 * Bind address defaults to 127.0.0.1. `--lan` opts into 0.0.0.0; that is a real
 * exposure decision (the page has no authentication and can edit notes), so it is
 * never inferred.
 */
'use strict'

const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

const logger = require('./logger.js')
const notes = require('./notes.js')
const upstream = require('./upstream.js')
const { renderPage } = require('./page.js')
const { SNAPSHOT } = require('./data.js')
const manifest = require('./manifest.js')
const ASSETS = require('./assets-inline.js')

const { log } = logger
const state = {
  startedAt: new Date().toISOString(),
  requests: 0,
  errors: 0,
  port: null,
  url: null,
  lan: false,
  lastHubAt: null,
  exits: 0,
}

/* ------------------------------------------------------------------ helpers */

function parseArgs(argv) {
  const out = { lan: false, port: Number(process.env.DDON_HUB_PORT) || 0, open: true, diagnose: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--lan') out.lan = true
    else if (arg === '--no-open') out.open = false
    else if (arg === '--diagnose') out.diagnose = true
    else if (arg === '--port') out.port = Number(argv[i + 1]) || 0
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice(7)) || 0
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function sendText(res, status, text, type) {
  res.writeHead(status, {
    'content-type': (type || 'text/plain') + '; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

/** Read a JSON body with a size limit; rejects oversized input instead of buffering it. */
function readJson(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const limit = limitBytes || 65536
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Snapshot of everything a diagnostic reader would want to know. */
function stateForReport() {
  const store = notes.readStore()
  return {
    ...state,
    counts: manifest.counts,
    builtAt: manifest.builtAt,
    dataDir: logger.DATA_DIR,
    notes: { notes: Object.keys(store.notes).length, cells: Object.keys(store.cells).length },
    upstream: upstream.cacheSnapshot ? upstream.cacheSnapshot() : null,
  }
}

/* ------------------------------------------------------------------- routes */

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  state.requests += 1
  const started = Date.now()

  const finish = (status) => log.info('request', { method: req.method, path: url.pathname, status, ms: Date.now() - started })

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const overrides = notes.readStore()
      const jobs = notes.applyOverrides(SNAPSHOT, overrides)
      const stats = notes.stats(SNAPSHOT.jobs, overrides)
      sendText(res, 200, renderPage({ jobs, stats, manifest, lan: state.lan }), 'text/html')
      return finish(200)
    }

    if (url.pathname === '/api/hub') {
      const force = url.searchParams.get('refresh') === '1'
      const body = await upstream.hub({ force })
      const overrides = notes.readStore()
      /*
       * The overrides are applied here as well as on the page render. The page is
       * server-rendered with them, so if this route returned the raw baked tree the
       * two would disagree and an edit would appear to do nothing until a reload
       * replaced the table with the server's copy.
       */
      body.jobs = notes.applyOverrides(body.jobs, overrides)
      body.notes = notes.stats(SNAPSHOT.jobs, overrides)
      state.lastHubAt = new Date().toISOString()
      sendJson(res, 200, body)
      return finish(200)
    }

    if (url.pathname === '/api/note') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return finish(405)
      }
      const body = await readJson(req)
      /* Handled before the generic catch so a rejected edit reports its own
         reason instead of looking like a crash. */
      try {
        const result = notes.save(body)
        sendJson(res, 200, result)
        return finish(200)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: logger.describeError(error).message })
        return finish(400)
      }
    }

    if (url.pathname === '/api/diagnostics') {
      const bundle = await logger.buildDiagnosticBundle({
        config: upstream.CONFIG,
        state: stateForReport,
        port: state.port,
        url: state.url,
        note: url.searchParams.get('reason') || '页面导出',
      })
      sendJson(res, 200, { ok: true, file: bundle.file, bytes: bundle.bytes, entries: bundle.entries })
      return finish(200)
    }

    if (url.pathname === '/api/diagnostics/download') {
      /* Rebuild on demand rather than caching a path: the point of the download is
         that it reflects the state at the moment it is asked for. */
      const bundle = await logger.buildDiagnosticBundle({
        config: upstream.CONFIG,
        state: stateForReport,
        port: state.port,
        url: state.url,
        note: url.searchParams.get('reason') || '页面下载',
      })
      const data = fs.readFileSync(bundle.file)
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': data.length,
        'content-disposition': `attachment; filename="${path.basename(bundle.file)}"`,
        'cache-control': 'no-store',
      })
      res.end(data)
      return finish(200)
    }

    if (url.pathname === '/api/exit') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return finish(405)
      }
      sendJson(res, 200, { ok: true, message: '正在退出' })
      log.info('exit requested from the page')
      state.exits += 1
      setTimeout(() => shutdown('page requested exit'), 120)
      return undefined
    }

    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.png') {
      /*
       * Chrome's `--app=` window asks the site root for /favicon.ico to draw the
       * window and taskbar icon. A `<link rel="icon">` in the head is not always
       * enough, which is why the launched window kept a generic icon even though
       * the exe file itself carried the right one.
       */
      const asset = url.pathname === '/favicon.ico' ? ASSETS.faviconIco : ASSETS.favicon
      if (asset === undefined) {
        sendText(res, 404, 'no favicon')
        return finish(404)
      }
      const match = /^data:([^;]+);base64,(.*)$/s.exec(asset)
      if (match === null) {
        sendText(res, 500, 'favicon asset is malformed')
        return finish(500)
      }
      const body = Buffer.from(match[2], 'base64')
      res.writeHead(200, {
        'content-type': match[1],
        'content-length': body.length,
        'cache-control': 'no-store',
      })
      res.end(body)
      return finish(200)
    }

    if (url.pathname === '/healthz') {
      sendText(res, 200, 'ok')
      return finish(200)
    }

    sendText(res, 404, '找不到这个地址：' + url.pathname)
    return finish(404)
  } catch (error) {
    state.errors += 1
    logger.captureCrash('request', error, { method: req.method, path: url.pathname })
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: logger.describeError(error).message })
    else res.end()
    return finish(500)
  }
}

/* ---------------------------------------------------------------- lifecycle */

let server = null

function shutdown(reason) {
  log.info('shutting down', { reason })
  logger.prune()
  if (server === null) {
    process.exit(0)
    return
  }
  server.close(() => process.exit(0))
  /* Do not hang on keep-alive sockets held by the browser window. */
  setTimeout(() => process.exit(0), 1500).unref()
}

/** Try the requested port, then a few nearby ones, then any free port. */
function listen(port, host) {
  return new Promise((resolve, reject) => {
    const attempt = (candidate, remaining) => {
      const onError = (error) => {
        if (error.code === 'EADDRINUSE' && remaining.length > 0) {
          log.warn('port in use, trying next', { port: candidate })
          server.removeListener('listening', onListening)
          attempt(remaining[0], remaining.slice(1))
          return
        }
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve(server.address().port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(candidate, host)
    }
    attempt(port, [port + 1, port + 2, port + 3, 0])
  })
}

/** Candidate browsers for a chromeless window, in preference order. */
function browserCandidates() {
  const out = []
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env.LOCALAPPDATA || ''
    out.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    )
  }
  return out.filter((candidate) => candidate && fs.existsSync(candidate))
}

/**
 * Open the page in an app window.
 *
 * `--app=` gives a plain window with no tabs or address bar, which is what makes
 * this feel like a program rather than a bookmark. With no Chromium browser
 * available the OS default handler is used instead, so the page still opens.
 */
function openWindow(url) {
  const candidates = browserCandidates()
  const args = [`--app=${url}`, '--window-size=1360,920']
  if (candidates.length === 0) {
    log.warn('no Chrome/Edge found; falling back to the default browser')
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {})
    return
  }
  const browser = candidates[0]
  log.info('opening window', { browser, url })
  execFile(browser, args, (error) => {
    if (error) {
      log.warn('app window failed, retrying as a normal tab', { error: error.message })
      execFile(browser, [url], () => {})
    }
  })
}

/** Print the addresses a person could type, so nobody has to guess. */
function addresses(port, lan) {
  const rows = [`http://127.0.0.1:${port}/`]
  if (lan) {
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const row of list || []) {
        if (row.family === 'IPv4' && !row.internal) rows.push(`http://${row.address}:${port}/   (${name}，同一 WiFi 下的手机/平板用这个)`)
      }
    }
  }
  return rows
}

const HELP = [
  'DDON 资料站 便携版',
  '',
  '用法：ddon-hub-portable.exe [选项]',
  '',
  '  --port <n>     指定端口，默认自动挑（从 8777 开始试）',
  '  --lan          允许同一局域网访问（默认只监听本机 127.0.0.1）',
  '                 加了这个之后，同一 WiFi 下的手机/平板可以用打印出来的地址打开',
  '  --no-open      启动后不自动打开窗口',
  '  --diagnose     不开窗口，直接把诊断包打好并打印路径后退出',
  '  --help         显示这段说明',
  '',
  '你改过的备注和详表数值保存在：',
  '  ' + logger.DISPLAY_DIR,
  '',
  '可用环境变量 DDON_HUB_DATA 改数据目录，DDON_HUB_PORT 改端口。',
].join('\n')

/* --------------------------------------------------------------------- main */

/**
 * Load the app's own modules.
 *
 * They are required lazily, from inside a guard: `data.js` is a generated file and
 * a bad build should leave a log entry and a readable message rather than a bare
 * stack trace with no log file, which is what a throw during module loading would
 * otherwise produce.
 */
function loadApp() {
  return {
    logger: require('./logger.js'),
    notes: require('./notes.js'),
    upstream: require('./upstream.js'),
    page: require('./page.js'),
    data: require('./data.js'),
    manifest: require('./manifest.js'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(HELP + '\n')
    return
  }

  logger.installCrashHandlers((error, file) => {
    process.stderr.write(
      `\n程序遇到未处理的错误，已写入崩溃报告：\n  ${file}\n` +
        `把这份文件（或页面上的「导出诊断包」）发给开发者即可。\n\n${error && error.stack ? error.stack : error}\n`,
    )
  })
  logger.prune()

  log.info('starting', {
    version: logger.APP.version,
    builtAt: manifest.builtAt,
    capturedAt: manifest.capturedAt,
    counts: manifest.counts,
    dataDir: logger.DATA_DIR,
    argv: process.argv.slice(2),
  })

  if (args.diagnose) {
    const bundle = await logger.buildDiagnosticBundle({
      config: upstream.CONFIG,
      state: stateForReport,
      note: '命令行 --diagnose',
    })
    process.stdout.write(`诊断包已生成：\n  ${bundle.file}\n（${(bundle.bytes / 1024).toFixed(1)} KB，含 ${bundle.entries.length} 个文件）\n`)
    return
  }

  server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      state.errors += 1
      logger.captureCrash('request-unhandled', error, { path: req.url })
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: '内部错误' })
      else res.end()
    })
  })

  const host = args.lan ? '0.0.0.0' : '127.0.0.1'
  const port = await listen(args.port || 8777, host)
  state.port = port
  state.lan = args.lan
  state.url = `http://127.0.0.1:${port}/`

  process.stdout.write(
    [
      '',
      `  DDON 资料站 已启动      ${state.url}`,
      `  你改的东西保存在        ${logger.DISPLAY_DIR}`,
      args.lan ? '  局域网访问             已开启' : '  局域网访问             未开启（加 --lan 可开启）',
      '',
      ...addresses(port, args.lan).map((row) => '  ' + row),
      '',
      '  关闭这个窗口不会退出程序；页面右上角有「退出」按钮。',
      '',
    ].join('\n'),
  )
  log.info('listening', { url: state.url, host, port, lan: args.lan })

  /* Warm the caches so the first page paint already has numbers on it. */
  upstream
    .hub({ force: false })
    .then((body) => log.info('warmup ok', { servers: body.servers.map((row) => ({ id: row.id, online: row.online })) }))
    .catch((error) => log.warn('warmup failed', { error: logger.describeError(error).message }))

  if (args.open) openWindow(state.url)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

if (require.main === module) {
  /*
   * The whole entry point runs inside one guard. `loadApp()` is what pulls in the
   * generated data file, so a broken build or a damaged exe produces a log entry
   * and a crash report instead of a stack trace with no diagnostics attached.
   */
  Promise.resolve()
    .then(() => {
      try {
        return loadApp()
      } catch (error) {
        const detail = describeErrorLite(error)
        logger.log.error('failed to load application modules', detail)
        const file = logger.captureCrash('module-load', error)
        process.stderr.write(
          `\n程序自带的文件载入失败，无法启动。\n原因：${detail.message}\n崩溃报告：${file}\n` +
            '请把上面这个文件发给开发者；程序包本身可能不完整，重新下载一份通常就能解决。\n\n',
        )
        process.exit(1)
      }
    })
    .then(() => main())
    .catch((error) => {
      const file = logger.captureCrash('startup', error)
      process.stderr.write(`启动失败：${(error && error.message) || error}\n崩溃报告：${file}\n`)
      process.exit(1)
    })
}

/** Minimal error shape for the one place that runs before the app is loaded. */
function describeErrorLite(error) {
  if (error === null || error === undefined) return { message: '未知错误' }
  if (typeof error !== 'object') return { message: String(error) }
  return { message: String(error.message || error), stack: error.stack ? String(error.stack) : undefined, code: error.code }
}

module.exports = { main, parseArgs, state, addresses, __handlerForTests: handle, __shutdownForTests: shutdown }
