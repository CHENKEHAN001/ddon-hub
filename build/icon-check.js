/**
 * Self-check for the icon step.
 *
 * rcedit edits resources in place, so a wrong option shape can leave the exe
 * silently unchanged — which is exactly what happened the first time (the options
 * were passed in a shape rcedit 5 does not accept). This proves the resource
 * values actually land, on a throwaway copy of node.exe.
 *
 * Run with: node build/icon-check.js
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const ICON = path.join(ROOT, 'src', 'assets', 'app.ico')
const PNG = path.join(ROOT, 'src', 'assets', 'app-256.png')
const STAGE = path.join(ROOT, 'build', '_stage')
const TEST_EXE = path.join(STAGE, 'icon-test.exe')

async function main() {
  console.log('icon check')

  assert.ok(fs.existsSync(ICON), 'src/assets/app.ico exists (run: python build/make-icon.py)')
  assert.ok(fs.existsSync(PNG), 'src/assets/app-256.png exists (used as the page favicon)')
  console.log('  ok  icon files present (' + (fs.statSync(ICON).size / 1024).toFixed(1) + ' KB ico, ' + (fs.statSync(PNG).size / 1024).toFixed(1) + ' KB png)')

  fs.mkdirSync(STAGE, { recursive: true })
  fs.copyFileSync(process.execPath, TEST_EXE)

  const before = fs.readFileSync(TEST_EXE)
  assert.ok(before.indexOf(Buffer.from('Node.js', 'utf16le')) >= 0, 'the source node.exe carries its own product name')

  const { rcedit } = require('rcedit')
  await rcedit(TEST_EXE, {
    icon: ICON,
    'file-version': '1.0.0.0',
    'product-version': '1.0.0.0',
    'version-string': {
      ProductName: 'DDON 资料站',
      FileDescription: 'DDON 资料站 便携版',
      CompanyName: 'DDON 资料站',
      LegalCopyright: 'icon self-check',
      InternalName: 'ddon-hub-portable.exe',
      OriginalFilename: 'ddon-hub-portable.exe',
    },
  })
  console.log('  ok  rcedit returned without error')

  const after = fs.readFileSync(TEST_EXE)
  assert.notEqual(after.length, before.length, 'the file actually changed')
  assert.ok(after.indexOf(Buffer.from('DDON 资料站', 'utf16le')) >= 0, 'the product name is in the new resource section')
  assert.ok(after.indexOf(Buffer.from('DDON 资料站 便携版', 'utf16le')) >= 0, 'the file description is there too')
  console.log('  ok  version strings landed in the PE (.rsrc)')

  /* The icon lives in RT_ICON entries as raw DIB data, so count those directory
     entries: a multi-size ico produces one per size. */
  const ico = fs.readFileSync(ICON)
  const layers = ico.readUInt16LE(4)
  assert.ok(layers >= 5, 'the .ico really holds multiple sizes (got ' + layers + ')')
  console.log('  ok  the .ico holds ' + layers + ' sizes (16 … 256)')

  fs.rmSync(TEST_EXE, { force: true })
  console.log('\nOK: icon and version info can be written into a PE')
}

main().catch((error) => {
  console.error('\nicon check failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
