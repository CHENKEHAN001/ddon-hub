/**
 * Debug helper: does the standalone build's inline script still parse?
 *
 * The phone build writes its browser script through a template literal. A stray
 * backtick or an `${` inside it ends the literal early and the file is generated
 * with broken JavaScript — the page then renders its markup and does nothing,
 * because the script never runs. String assertions do not catch that.
 *
 * Run with: node build/_dbg-offline.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const FILE = path.join(__dirname, '..', 'dist', 'DDON资料站-手机版.html')

const html = fs.readFileSync(FILE, 'utf8')
console.log('文件字节:', html.length)

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1])
console.log('内联脚本块数:', scripts.length)

let bad = 0
scripts.forEach((body, index) => {
  if (/^\s*\{/.test(body)) {
    try {
      JSON.parse(body)
      console.log(`  #${index} JSON OK (${(body.length / 1024).toFixed(0)} KB)`)
    } catch (error) {
      bad += 1
      console.error(`  #${index} JSON 失败: ${error.message}`)
    }
    return
  }
  try {
    new vm.Script(body, { filename: `offline-${index}.js` })
    console.log(`  #${index} JS OK (${(body.length / 1024).toFixed(0)} KB)`)
  } catch (error) {
    bad += 1
    console.error(`  #${index} JS 失败: ${error.message}`)
    const lines = body.split('\n')
    const at = Number((/offline-\d+\.js:(\d+)/.exec(error.stack || '') || [])[1] || 0)
    for (let i = Math.max(0, at - 4); i < Math.min(lines.length, at + 2); i += 1) {
      console.error(`      ${i + 1}: ${lines[i]}`)
    }
  }
})

/* The rendered markup must carry the pieces the script binds to. */
for (const id of ['live', 'links', 'jobs', 'skills', 'detail', 'sort', 'legend', 'editState']) {
  if (!html.includes(`id="${id}"`)) {
    bad += 1
    console.error(`  缺少容器 #${id}`)
  }
}
if (!html.includes('boot.links')) {
  bad += 1
  console.error('  脚本没有引用 boot.links（官网入口需要它）')
}
if (!/"links":\{/.test(html)) {
  bad += 1
  console.error('  boot 数据里没有 links')
}

if (bad > 0) {
  console.error(`\nFAIL: ${bad} 个问题`)
  process.exit(1)
}
console.log('\nOK: 手机版的 HTML、内联脚本与数据块都完整')
