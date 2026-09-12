/**
 * 检查托管站点上的 Cloudflare Web Analytics 是否正常工作。
 *
 * 为什么单独一个脚本：Web Analytics 的开启是**面板操作**（Add a site），不在仓库里，
 * 所以它可能随时被关掉或配置错。这个脚本把它纳入可验证范围，而不是靠"我记得开过"。
 *
 * 关于断言强度：Analytics 默认**未开启**时不该让检查失败（否则每次推送都红），
 * 所以默认只报告现状；用 --require 表示"我认为它应该开着"，此时缺失即失败。
 * 开启之后建议在 live-check 里带上这个开关。
 *
 * 实测事实（官方文档 + 本机验证）：
 *   - 站点已通过 Cloudflare 代理时是"automatic setup"，Cloudflare 自动注入
 *     `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js">`，
 *     不需要我们自己往页面里加代码；
 *   - 自动注入的 beacon 上报到**本站自己的** `/cdn-cgi/rum`（手工嵌入才上报到
 *     cloudflareinsights.com），所以这个端点可以顺带探一下；
 *   - 注入的前提是响应能改：若页面带 `Cache-Control: public, no-transform`，
 *     Cloudflare 不会改页面，beacon 也就不会被注入——这条是常见的静默失效原因；
 *   - 文档写明 beacon 的 CORS 校验要求 `Referer` 头，且**明确说不能用 Referrer-Policy
 *     代替**。而本站 `_headers` 下发了 `Referrer-Policy: no-referrer`，所以这里把它列为
 *     风险项报告出来，而不是假装没这回事。
 *
 * Run with:
 *   node build/analytics-check.js                  # 只报告
 *   node build/analytics-check.js --require        # 缺失即失败
 *   node build/analytics-check.js https://别的地址
 */
'use strict'

const https = require('node:https')

const REQUIRE = process.argv.includes('--require')
const SITE = (process.argv.find((a) => a.startsWith('http')) || 'https://ddon-hub.com/').replace(/\/?$/, '/')

const BEACON_HOST = 'static.cloudflareinsights.com'
const BEACON_PATH = 'beacon.min.js'

function get(url, method) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: method || 'GET', headers: { 'user-agent': 'Mozilla/5.0 analytics-check' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(25000, () => req.destroy(new Error('timeout')))
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.message }))
    req.end()
  })
}

async function main() {
  const problems = []
  console.log('站点:', SITE, REQUIRE ? '（要求已开启）' : '（只报告）', '\n')

  /* --- 1. 页面里有没有 beacon --- */
  const home = await get(SITE)
  console.log('1) 页面里的统计脚本')
  const hasBeacon = home.body.includes(BEACON_HOST) || home.body.includes(BEACON_PATH)
  console.log('   含 beacon.min.js:', hasBeacon ? '是' : '否')
  if (hasBeacon) {
    const snippet = /<script[^>]*beacon\.min\.js[^>]*>/.exec(home.body)
    if (snippet !== null) console.log('   标签:', snippet[0].slice(0, 160))
    console.log('   含 data-cf-beacon:', home.body.includes('data-cf-beacon'))
    console.log('   含 integrity 属性:', /beacon\.min\.js[^>]*integrity/.test(home.body))
  } else if (REQUIRE) {
    problems.push('页面里没有 Web Analytics 的 beacon 脚本')
  } else {
    console.log('   -> 未开启。开启方式：账号首页左侧 Web analytics → Add a site → 选 ddon-hub.com')
  }

  /* --- 2. 自动注入的前置条件：页面可被改写 --- */
  console.log('\n2) 自动注入的前置条件')
  const cacheControl = home.headers['cache-control'] || '(无)'
  console.log('   cache-control:', cacheControl)
  const blocksTransform = /no-transform/i.test(cacheControl)
  console.log('   含 no-transform:', blocksTransform ? '**是（会导致 beacon 无法注入）**' : '否')
  if (blocksTransform) problems.push('响应头含 no-transform，Cloudflare 无法注入 beacon')

  const contentType = home.headers['content-type'] || ''
  console.log('   content-type:', contentType)
  if (!/text\/html/i.test(contentType)) problems.push('根路径不是 text/html，beacon 无法注入')

  /* --- 3. Referer 风险 --- */
  console.log('\n3) Referer 相关风险')
  const referrerPolicy = home.headers['referrer-policy'] || '(无)'
  console.log('   referrer-policy:', referrerPolicy)
  if (/no-referrer/i.test(referrerPolicy)) {
    console.log('   ** 注意 **：官方文档说 beacon 的 CORS 校验要求 Referer 头，')
    console.log('              且明确表示不能用 Referrer-Policy 代替。')
    console.log('              若开启 Analytics 后长时间没有数据，这里是首要排查点。')
  }

  /* --- 4. 上报端点 --- */
  console.log('\n4) 上报端点 /cdn-cgi/rum')
  const rum = await get(SITE + 'cdn-cgi/rum')
  console.log('   GET ->', rum.status, rum.status === 405 ? '（405 是正常的：该端点只收 POST）' : '')
  const allow = rum.headers['allow']
  if (allow !== undefined) console.log('   Allow:', allow)

  console.log()
  if (problems.length > 0) {
    console.error('FAIL:')
    for (const row of problems) console.error('   ' + row)
    process.exit(1)
  }
  console.log(hasBeacon
    ? 'OK: Web Analytics 的 beacon 已在页面上，且自动注入的前置条件满足'
    : 'OK: 未发现 beacon（Analytics 未开启，或已开启但自动注入被阻止——若你确实开了，请按上面第 2、3 点排查）')
}

main().catch((error) => {
  console.error('analytics-check failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
