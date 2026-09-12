/**
 * Crash-path check.
 *
 * Answers one question: when something goes wrong, does a report actually reach
 * disk? The happy paths are covered by selfcheck.js; this drives the guard that
 * only runs on failure.
 *
 * The trick is the data directory: it is resolved at require time, and a path that
 * cannot be created makes the logger resolve to a real fallback instead. To force a
 * genuine crash the timer below throws outside any try/catch, which is exactly the
 * shape `uncaughtException` exists for.
 *
 * Run with: node build/crash-check.js
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SANDBOX = path.join(os.tmpdir(), 'ddon-hub-crashcheck-' + Date.now())
fs.mkdirSync(SANDBOX, { recursive: true })

/** A script that crashes on a timer, after the guard is installed. */
const TRIGGER = path.join(SANDBOX, 'trigger.js')
fs.writeFileSync(
  TRIGGER,
  [
    "'use strict'",
    "const logger = require(" + JSON.stringify(path.join(__dirname, '..', 'src', 'logger.js')) + ')',
    "logger.installCrashHandlers(function (error) { process.stderr.write('handler ran: ' + error.message + '\\n') })",
    "logger.log.info('about to crash on purpose')",
    "setTimeout(function () { throw new TypeError('故意制造的崩溃，用于验证报告落盘') }, 60)",
    'setTimeout(function () { process.exit(9) }, 3000)',
  ].join('\n'),
  'utf8',
)

const result = spawnSync(process.execPath, [TRIGGER], {
  env: { ...process.env, DDON_HUB_DATA: SANDBOX },
  encoding: 'utf8',
  timeout: 30000,
})

console.log('child exit code :', result.status)
console.log('child stdout    :', (result.stdout || '').trim().split('\n').slice(-1)[0])
console.log('child stderr    :', (result.stderr || '').trim().split('\n').slice(0, 2).join(' | '))

const crashDir = path.join(SANDBOX, 'crashes')
const reports = fs.existsSync(crashDir) ? fs.readdirSync(crashDir) : []
if (reports.length === 0) {
  console.error('\nFAIL: no crash report was written')
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(path.join(crashDir, reports[0]), 'utf8'))
console.log('report file     :', reports[0], '(' + fs.statSync(path.join(crashDir, reports[0])).size + ' bytes)')
console.log('report kind     :', report.kind)
console.log('report message  :', report.error.message)

const logFile = path.join(SANDBOX, 'logs', 'app-' + new Date().toISOString().slice(0, 10) + '.log')
const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
console.log('log has the crash line :', logText.includes('CRASH'))
console.log('log has the info line  :', logText.includes('about to crash on purpose'))

const problems = []
if (report.kind !== 'uncaughtException') problems.push('expected kind uncaughtException, got ' + report.kind)
if (!report.error.stack) problems.push('the report carries no stack')
if (!report.environment || !report.environment.platform) problems.push('the report carries no environment block')
if (!logText.includes('CRASH')) problems.push('the crash was not written to the log file')
if (problems.length > 0) {
  console.error('\nFAIL:')
  for (const row of problems) console.error('  ' + row)
  process.exit(1)
}

fs.rmSync(SANDBOX, { recursive: true, force: true })
console.log('\nOK: a crash writes both a report and a log line')
