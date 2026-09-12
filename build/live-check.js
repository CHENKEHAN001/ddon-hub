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
  /* 在块外声明：下面第 2b 段还要用它，放块里会取不到 */
  let boot
  if (bootMatch === null) {
    problems.push('找不到 boot 数据块')
    console.log('   ** 找不到 boot 块')
  } else {
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
  if (!home.body.includes('min-width:900px')) problems.push('页面没有宽屏媒体查询——电脑上会是一列卡片')

  /*
   * 卡片入口的数据源。
   *
   * 不要去 grep 渲染后的链接——卡片与页脚里的 `<a class="chip" href="...">` 都是
   * 运行时由 JS 拼出来的，HTML 里只有生成它们的代码，正则永远匹配不到 0 条以上。
   * 这个错在本项目里犯过好几次（同样的道理：客户端脚本共用、措辞靠三目运算选择、
   * 统计口径与实际渲染无关），所以这里只查"数据在不在"，渲染结果交给
   * build/cards-check.py（走 DOM）与 build/site-check.py 验证。
   */
  const linksInBoot = Object.keys(boot === undefined ? {} : boot.links || {}).length
  console.log('\n2b) 入口数据')
  console.log('   boot.links 条目:', linksInBoot)
  console.log('   （渲染出的链接数由 cards-check.py 走 DOM 验证，此处不重复）')
  if (linksInBoot < 18) problems.push(`boot.links 只有 ${linksInBoot} 条，应有 18 条`)
  if (!home.body.includes('data-id')) problems.push('页面脚本里没有 data-id——卡片模板可能没生成')
  if (home.body.includes('>官网入口<')) problems.push('「官网入口」区块还在——入口应当只出现在卡片里')

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

  /* --- 3. 响应头 --- */
  console.log('\n3) 响应头')
  /*
   * 这里只查 Referrer-Policy。
   *
   * 早先还查 `X-Robots-Tag: noindex`，那是"整站不收录"策略的一部分；该策略已按用户要求
   * 推翻（原始资料本就公开，不该私有化），所以这条断言必须一起去掉——留着它会让检查
   * 反过来逼着我们保持不收录。
   */
  const referrer = home.headers['referrer-policy']
  console.log(`   referrer-policy: ${referrer === undefined ? '**缺失**' : referrer}`)
  if (referrer === undefined || !referrer.includes('no-referrer')) problems.push('referrer-policy 没有按 _headers 下发')
  if (home.headers['x-robots-tag'] !== undefined) {
    problems.push(`x-robots-tag 还在（${home.headers['x-robots-tag']}）——那会阻止收录，与 Allow: / 矛盾`)
  }

  /* --- 4. robots.txt --- */
  const robots = await get(SITE + '/robots.txt', 'text/plain')
  console.log('\n4) robots.txt:', robots.status)
  if (robots.status !== 200) problems.push('robots.txt 取不到')
  if (!robots.body.includes('Allow: /')) problems.push('robots.txt 没有 Allow: /（搜索引擎应被允许收录）')
  if (/^User-agent: \*\s*\nDisallow: \/\s*$/m.test(robots.body)) {
    problems.push('robots.txt 里还有针对 * 的 Disallow: /，与 Allow: / 矛盾')
  }
  if (!robots.body.includes('ai-train=no') && !robots.body.includes('GPTBot')) {
    problems.push('robots.txt 没有拒绝 AI 训练爬虫')
  }
  console.log('   AI 训练爬虫:', robots.body.includes('ai-train=no') ? '已拒绝（Cloudflare 托管段）' : (robots.body.includes('GPTBot') ? '已拒绝（本文件）' : '**未拒绝**'))

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

  /* --- 6. Web Analytics 的统计脚本 --- */
  /*
   * 断言强度经过一次反转：起初以为 Analytics 没开，所以设计成"只报告、不判失败"；
   * 实测线上页面**已经带 beacon**（带 integrity 的版本化路径），且面板里已有数据，
   * 于是这里改成**硬断言**——既然它在工作，坏掉就该被发现。
   *
   * 用 --no-analytics 可以跳过（例如临时关掉统计时）。
   */
  if (!process.argv.includes('--no-analytics')) {
    console.log('\n6) Web Analytics 统计脚本')
    const hasBeacon = home.body.includes('beacon.min.js') || home.body.includes('static.cloudflareinsights.com')
    console.log('   beacon.min.js:', hasBeacon ? '在' : '**缺失**')
    if (!hasBeacon) problems.push('页面里没有 Web Analytics 的 beacon 脚本')
    if (hasBeacon) {
      const hasIntegrity = /beacon\.min\.js[^>]*integrity/.test(home.body)
      const hasToken = home.body.includes('data-cf-beacon')
      console.log('   integrity 属性:', hasIntegrity ? '有' : '无', '| data-cf-beacon:', hasToken ? '有' : '无')
      if (!hasToken) problems.push('beacon 脚本缺少 data-cf-beacon，统计不会上报')
    }
    /* 自动注入的前提：Cloudflare 要能改写响应体 */
    const cc = home.headers['cache-control'] || ''
    if (/no-transform/i.test(cc)) problems.push('响应头含 no-transform，Cloudflare 无法注入 beacon（统计会静默失效）')
    console.log('   cache-control:', cc, /no-transform/i.test(cc) ? '**含 no-transform**' : '(不含 no-transform，可注入)')
  }

  /* --- 7. 错误路径 --- */
  const missing = await get(SITE + '/no-such-page')
  console.log('\n7) 未知路径:', missing.status)
  if (missing.status !== 404) problems.push(`未知路径返回 ${missing.status}，应为 404`)

  console.log()
  if (problems.length > 0) {
    console.error('FAIL:')
    for (const row of problems) console.error('   ' + row)
    process.exit(1)
  }
  console.log('OK: 线上站点根路径、数据、响应头、robots.txt、在线接口、统计脚本全部正常')
}

main().catch((error) => {
  console.error('live-check failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
