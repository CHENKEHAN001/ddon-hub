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
  ['宽屏媒体查询', phone.html.includes('@media (min-width:900px)'), web.html.includes('@media (min-width:900px)')],
  ['宽屏表格容器', phone.html.includes('id="skillsTable"'), web.html.includes('id="skillsTable"')],
  ['标题含「离线可用」', phone.html.includes('离线可用'), web.html.includes('离线可用')],
  ['标题含「在线版」', phone.html.includes('在线版 · 每次打开都是最新'), web.html.includes('在线版 · 每次打开都是最新')],
  ['Revival 卡片：手机措辞', phone.html.includes('要用电脑版'), web.html.includes('要用电脑版')],
  ['Revival 卡片：网站措辞', phone.html.includes('本站取不到'), web.html.includes('本站取不到')],
  ['页脚「完全离线」', phone.html.includes('完全离线，可存到手机里直接打开'), web.html.includes('完全离线，可存到手机里直接打开')],
  ['页脚「出处与用途」', phone.html.includes('仅供学习交流'), web.html.includes('仅供学习交流')],
  ['页脚「你的改动不上传」', phone.html.includes('不会上传，别人也看不到'), web.html.includes('不会上传，别人也看不到')],
  ['技能数据一致', phone.boot.jobs.length, web.boot.jobs.length],
  ['入口数量一致', Object.keys(phone.boot.links).length, Object.keys(web.boot.links).length],
]

console.log('检查项'.padEnd(26) + '手机版'.padEnd(10) + '网站版')
console.log('-'.repeat(50))
for (const [label, a, b] of rows) {
  console.log(String(label).padEnd(26) + String(a).padEnd(10) + String(b))
}

const problems = []
if (phone.boot.hosted !== false) problems.push('手机版的 boot.hosted 应为 false')
if (web.boot.hosted !== true) problems.push('网站版的 boot.hosted 应为 true')

/*
 * 内容必须完全一致，只有措辞和部署形态不同。
 * 早先网站版删掉了 Revival 卡片（理由是从第三方源永远取不到数字），结果看起来
 * 像"少了一个私服"。现在两种模式都显示那张卡片，只是标签不同。
 */
for (const [label, a, b] of [
  ['宽屏媒体查询', phone.html.includes('@media (min-width:900px)'), web.html.includes('@media (min-width:900px)')],
  ['宽屏表格容器', phone.html.includes('id="skillsTable"'), web.html.includes('id="skillsTable"')],
  ['Revival 卡片正文', phone.html.includes('只允许自家网页读取'), web.html.includes('只允许自家网页读取')],
  ['表格渲染函数', phone.html.includes('function renderTable'), web.html.includes('function renderTable')],
]) {
  if (a !== true || b !== true) problems.push(`${label}：两个版本都应有（手机 ${a} / 网站 ${b}）`)
}

if (phone.html.includes('includeRevival') || web.html.includes('includeRevival')) {
  problems.push('还有 includeRevival 残留——那张卡片现在两种模式都显示，只差措辞')
}
if (!phone.html.includes('离线可用')) problems.push('手机版缺少离线文案')
if (web.html.includes('离线可用')) problems.push('网站版不应出现离线文案')
if (!web.html.includes('在线版 · 每次打开都是最新')) problems.push('网站版缺少在线文案')
if (!phone.html.includes('要用电脑版')) problems.push('手机版缺少 Revival 的手机措辞')
/*
 * 不断言"网站版 HTML 里没有手机措辞"。客户端脚本两个版本共用，两句措辞都在源码里，
 * 由 boot.hosted 的三目运算选择，所以从原始 HTML 判断渲染结果是假阳性——早先的
 * 检查就在这里误报过。真实渲染由 build/site-check.py（走 DOM）与
 * build/mobile-check.py（走 file://）分别验证。
 */
if (!phone.html.includes('完全离线，可存到手机里直接打开')) problems.push('手机版缺少"本文件"说明')
if (web.html.includes('完全离线，可存到手机里直接打开')) problems.push('网站版不应保留"存到手机里"文案')
if (!web.html.includes('仅供学习交流')) problems.push('网站版缺少出处与用途声明')
if (phone.boot.jobs.length !== web.boot.jobs.length) problems.push('两个版本的技能数据不一致')
if (Object.keys(phone.boot.links).length !== Object.keys(web.boot.links).length) problems.push('两个版本的链接表不一致')

console.log()
if (problems.length > 0) {
  console.error('FAIL:')
  for (const row of problems) console.error('   ' + row)
  process.exit(1)
}
console.log('OK: 手机版与网站版只在应当不同的地方不同，数据与链接表一致')
