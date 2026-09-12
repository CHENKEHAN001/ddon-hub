/**
 * Check the deployed site end to end.
 *
 * Verifies what the recipient's browser will actually receive: the page is served
 * at the root, the data block is intact, the inline script parses, and the two
 * CORS-friendly status APIs are reachable from a real HTTPS origin.
 *
 * Run with: node build/live-check.js [url]
 */
'use strict'

const https = require('node:https')
const vm = require('node:vm')

const SITE = process.argv[2] || 'https://ddon-hub.3605369480.workers.dev'

function get(url, accept) {
  return new Promise((resolve) => {
    const request = https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 ddon-hub-live-check', accept: accept || 'text/html' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        get(new URL(res.headers.location, url).href, accept).then(resolve)
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.setTimeout(25000, () => request.destroy(new Error('timeout')))
    request.on('error', (e) => resolve({ status: 0, error: e.message, body: '', headers: {} }))
  })
}

async function main() {
  const problems = []

  console.log('站点:', SITE, '\n')

  /* --- 1. 根路径 --- */
  const home = await get(SITE + '/')
  console.log('1) 根路径')
  console.log('   status:', home.status, '| 字节:', home.body.length, '| type:', home.headers['content-type'])
  if (home.status !== 200) problems.push(`根路径返回 ${home.status}`)
  if (!home.body.includes('DDON 资料站')) problems.push('页面里没有标题')

  /* --- 2. 数据块与内联脚本 --- */
  console.log('\n2) 数据块与脚本')
  const bootMatch = /<script id="boot"[^>]*>([\s\S]*?)<\/script>/.exec(home.body)
  if (bootMatch === null) {
    problems.push('找不到 boot 数据块')
    console.log('   ** 找不到 boot 块')
  } else {
    let boot
    try {
      boot = JSON.parse(bootMatch[1])
    } catch (error) {
      problems.push('boot 数据块解析失败: ' + error.message)
    }
    if (boot) {
      const details = boot.jobs.reduce((n, j) => n + (j.details || []).length, 0)
      const rows = boot.jobs.reduce((n, j) => n + (j.summaryRows || []).length, 0)
      const cells = boot.jobs.reduce((n, j) => n + (j.details || []).reduce((m, d) => m + (d.cells || []).length, 0), 0)
      console.log('   职业:', boot.jobs.length, '| 详表:', details, '| 行:', rows, '| 单元格:', cells)
      console.log('   hosted:', boot.hosted, '| 入口:', Object.keys(boot.links).length)
      if (boot.jobs.length !== 11) problems.push(`职业数是 ${boot.jobs.length}，应为 11`)
      if (details !== 275) problems.push(`详表数是 ${details}，应为 275`)
      if (boot.hosted !== true) problems.push('hosted 标记不是 true')
      if (boot.includeRevival !== undefined) {
        problems.push('还有 includeRevival 字段——那张卡片现在两种模式都显示，只差措辞')
      }
    }
  }

  /*
   * 三个私服都要能出现。Revival 取不到数字是它的接口限制，但卡片必须在，
   * 否则看起来像数据不全而不是一个说清了的限制。
   */
  if (!home.body.includes('DDON Revival')) problems.push('页面里没有 DDON Revival 卡片')
  if (!home.body.includes('只允许自家网页读取')) problems.push('Revival 卡片没有说明取不到的原因')
  if (!home.body.includes('min-width:900px')) problems.push('页面没有宽屏媒体查询——电脑上会是一列卡片')

  const scripts = [...home.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  let scriptOk = true
  scripts.forEach((body, index) => {
    try {
      if (/^\s*\{/.test(body)) JSON.parse(body)
      else new vm.Script(body, { filename: `live-${index}.js` })
    } catch (error) {
      scriptOk = false
      problems.push(`线上第 ${index} 段脚本解析失败: ${error.message}`)
    }
  })
  console.log('   内联脚本:', scripts.length, '段，解析', scriptOk ? '通过' : '**失败**')

  /* --- 3. 响应头（_headers 是否生效）--- */
  console.log('\n3) 响应头')
  for (const [key, want] of [['x-robots-tag', 'noindex'], ['referrer-policy', 'no-referrer']]) {
    const value = home.headers[key]
    console.log(`   ${key}: ${value === undefined ? '**缺失**' : value}`)
    if (value === undefined || !value.includes(want)) problems.push(`${key} 没有按 _headers 下发`)
  }

  /* --- 4. robots.txt --- */
  const robots = await get(SITE + '/robots.txt', 'text/plain')
  console.log('\n4) robots.txt:', robots.status, '|', robots.body.split('\n')[0])
  if (robots.status !== 200 || !robots.body.includes('Disallow: /')) problems.push('robots.txt 内容不对')

  /* --- 5. 两个跨域友好的状态接口（模拟访客浏览器）--- */
  console.log('\n5) 访客浏览器能否取到在线人数')
  const apis = [
    ['LegacyDDON', 'https://legacyddon.com/rpc/status'],
    ['Dogma Rising', 'https://dogmarising.netlify.app/.netlify/functions/status'],
  ]
  for (const [name, url] of apis) {
    const res = await get(url, 'application/json')
    const acao = res.headers['access-control-allow-origin']
    let parsed = ''
    try {
      const j = JSON.parse(res.body)
      parsed = Array.isArray(j) ? `${j.length} 个世界` : `online=${j.online}`
    } catch {
      parsed = '(非 JSON)'
    }
    console.log(`   ${name.padEnd(13)} ${res.status}  ACAO=${acao || '(无)'}  ${parsed}`)
    if (res.status !== 200) problems.push(`${name} 接口返回 ${res.status}`)
    if (acao !== '*') problems.push(`${name} 的 ACAO 不是 *，访客浏览器会被拦`)
  }

  /* --- 6. 错误路径 --- */
  const missing = await get(SITE + '/no-such-page')
  console.log('\n6) 未知路径:', missing.status)
  if (missing.status !== 404) problems.push(`未知路径返回 ${missing.status}，应为 404`)

  console.log()
  if (problems.length > 0) {
    console.error('FAIL:')
    for (const row of problems) console.error('   ' + row)
    process.exit(1)
  }
  console.log('OK: 线上站点根路径、数据、响应头、robots.txt、在线接口全部正常')
}

main().catch((error) => {
  console.error('live-check failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
