/**
 * Self-check for the ZIP writer.
 *
 * A zip built by hand is only useful if other tools accept it, so this writes a
 * sample archive and reports the CRC-32 of the standard check vector. The
 * companion PowerShell step extracts the result with Expand-Archive, which is the
 * decoder that actually matters here (Windows Explorer's).
 *
 * Run with: node build/zip-check.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { zip, crc32 } = require('../src/zip.js')

const OUT = path.join(__dirname, '_zip_test.zip')

const manifest = JSON.stringify({ name: 'ddon-hub-portable', ok: true }, null, 2)
const log = Array.from({ length: 200 }, (_row, i) => `2026-09-11T00:00:${String(i % 60).padStart(2, '0')}Z  请求 /api/hub 200 中文日志行 ${i}`).join('\n')
const crash = 'TypeError: example crash\n    at somewhere (src/server.js:1:1)\n'

const archive = zip([
  { name: 'manifest.json', data: manifest },
  { name: 'logs/app-2026-09-11.log', data: log },
  { name: 'crashes/crash-2026-09-11T00-00-00Z.txt', data: crash },
])
fs.writeFileSync(OUT, archive)

const check = crc32(Buffer.from('123456789'))
console.log('archive bytes :', archive.length)
console.log('crc32("123456789") :', check.toString(16), check === 0xcbf43926 ? '(ok)' : '(WRONG, expect cbf43926)')
console.log('wrote         :', OUT)
if (check !== 0xcbf43926) process.exit(1)
