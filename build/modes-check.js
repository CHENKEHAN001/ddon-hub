/**
 * Check: the two builds differ in exactly the ways they should.
 *
 * The phone build runs from a file with no server; the web build runs on a public
 * origin. They share one generator, so a regression here means the shared code
 * started leaking assumptions from one mode into the other.
 *
 * Run with: node build/modes-check.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function load(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const boot = JSON.parse(/<script id="boot"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1])
  return { html, boot, kb: Math.round(Buffer.byteLength(html) / 1024) }
}

const phone = load('dist/DDON资料站-手机版.html')
const web = load('dist/site/index.html')

const rows = [
  ['大小 (KB)', phone.kb, web.kb],
  ['boot.hosted', phone.boot.hosted, web.boot.hosted],
  ['boot.includeRevival', phone.boot.includeRevival, web.boot.includeRevival],
  ['标题含「离线可用」', phone.html.includes('离线可用'), web.html.includes('离线可用')],
  ['标题含「在线版」', phone.html.includes('在线版 · 每次打开都是最新'), web.html.includes('在线版 · 每次打开都是最新')],
  ['显示 Revival 卡片', phone.boot.includeRevival, web.boot.includeRevival],
  ['页面含 Revival 说明卡', phone.html.includes('要用电脑版'), web.html.includes('要用电脑版')],
  ['页脚「完全离线」', phone.html.includes('完全离线，可存到手机里直接打开'), web.html.includes('完全离线，可存到手机里直接打开')],
  ['页脚「出处与用途」', phone.html.includes('请勿用于商业用途'), web.html.includes('请勿用于商业用途')],
  ['页脚「你的改动不上传」', phone.html.includes('不会上传，别人也看不到'), web.html.includes('不会上传，别人也看不到')],
  ['技能数据一致', phone.boot.jobs.length, web.boot.jobs.length],
  ['入口数量一致', Object.keys(phone.boot.links).length, Object.keys(web.boot.links).length],
]

console.log('检查项'.padEnd(24) + '手机版'.padEnd(12) + '网站版')
console.log('-'.repeat(52))
for (const [label, a, b] of rows) {
  console.log(String(label).padEnd(24) + String(a).padEnd(12) + String(b))
}

const problems = []
if (phone.boot.hosted !== false) problems.push('手机版的 boot.hosted 应为 false')
if (web.boot.hosted !== true) problems.push('网站版的 boot.hosted 应为 true')
if (phone.boot.includeRevival !== true) problems.push('手机版应显示 Revival 卡片')
if (web.boot.includeRevival !== false) problems.push('网站版应隐藏 Revival 卡片')
if (!phone.html.includes('离线可用')) problems.push('手机版缺少离线文案')
if (web.html.includes('离线可用')) problems.push('网站版不应出现离线文案')
if (!web.html.includes('在线版 · 每次打开都是最新')) problems.push('网站版缺少在线文案')
if (!phone.html.includes('要用电脑版')) problems.push('手机版缺少 Revival 说明卡')
/*
 * No assertion that the hosted build's HTML lacks the card markup: both builds
 * carry the same client script, so the string is present in the source of both and
 * only the `includeRevival` flag decides whether it is used. Whether the card
 * actually renders is checked against the DOM in build/site-check.py — asserting it
 * from the raw HTML here would be a false positive, which is exactly what an
 * earlier version of this check reported.
 */
if (!phone.html.includes('完全离线，可存到手机里直接打开')) problems.push('手机版缺少"本文件"说明')
if (web.html.includes('完全离线，可存到手机里直接打开')) problems.push('网站版不应保留"存到手机里"文案')
if (!web.html.includes('请勿用于商业用途')) problems.push('网站版缺少出处与用途声明')
if (phone.boot.jobs.length !== web.boot.jobs.length) problems.push('两个版本的技能数据不一致')
if (Object.keys(phone.boot.links).length !== Object.keys(web.boot.links).length) problems.push('两个版本的链接表不一致')

console.log()
if (problems.length > 0) {
  console.error('FAIL:')
  for (const row of problems) console.error('   ' + row)
  process.exit(1)
}
console.log('OK: 手机版与网站版只在应当不同的地方不同，数据与链接表一致')
