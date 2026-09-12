/**
 * Probe: how does the Live News page load its feed?
 *
 * The server-rendered HTML for that page has no news items, so they arrive from a
 * widget at runtime. This finds the widget URL (usually a Discord widget or a
 * third-party iframe) so the app can either read the same source or link to it.
 */
'use strict'

const https = require('node:https')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const BASE = 'https://dogmarising.netlify.app'

function get(url, accept) {
  return new Promise((resolve) => {
    const request = https.get(url, { headers: { 'user-agent': UA, accept: accept || 'text/html,*/*' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.setTimeout(20000, () => request.destroy(new Error('timeout')))
    request.on('error', (e) => resolve({ status: 0, error: e.message, body: '' }))
  })
}

async function main() {
  const page = await get(BASE + '/discord-live-news')
  const html = page.body

  console.log('=== 页面里的 iframe / widget ===')
  for (const m of html.matchAll(/<iframe[^>]*>/gi)) console.log('  ' + m[0].slice(0, 300))
  for (const m of html.matchAll(/(?:src|href|data-\w+)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const url = m[1]
    if (!/fonts\.|gstatic|netlify\.app\/?$/.test(url)) console.log('  外链: ' + url)
  }

  console.log('\n=== 内联脚本全文 ===')
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim()
    if (body !== '') console.log('  ---\n  ' + body.replace(/\n/g, '\n  ').slice(0, 1200))
  }

  console.log('\n=== 引用的 js 文件 ===')
  for (const m of html.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) console.log('  ' + m[1])

  /* Discord widget: a public JSON endpoint if the server has it enabled. */
  console.log('\n=== Discord widget 试探 ===')
  const guildId = (/(?:guild|server)[_-]?id["'\s:=]+(\d{15,25})/i.exec(html) || [])[1]
  console.log('  HTML 里的 guild id:', guildId || '(未找到)')
  const invite = (/discord\.gg\/([A-Za-z0-9]+)/.exec(html) || [])[1]
  console.log('  邀请码:', invite || '(未找到)')
  if (guildId) {
    const w = await get(`https://discord.com/api/guilds/${guildId}/widget.json`, 'application/json')
    console.log('  widget.json:', w.status, w.body.slice(0, 200))
  }

  console.log('\n=== /about 与 /contact 用到的接口 ===')
  for (const p of ['/about', '/contact', '/']) {
    const res = await get(BASE + p)
    const calls = [...res.body.matchAll(/fetch\(['"]([^'"]+)['"]/g)].map((m) => m[1])
    console.log(`  ${p}: ${[...new Set(calls)].join(', ') || '(无)'}`)
  }

  console.log('\n=== 状态接口的完整响应与响应头 ===')
  const st = await get(BASE + '/.netlify/functions/status', 'application/json')
  console.log('  status:', st.status)
  console.log('  headers:', JSON.stringify({
    'content-type': st.headers['content-type'],
    'cache-control': st.headers['cache-control'],
    'access-control-allow-origin': st.headers['access-control-allow-origin'] || '(无)',
  }))
  console.log('  body:', st.body)
}

main().catch((error) => {
  console.error('probe failed:', error && error.stack ? error.stack : error)
  process.exit(1)
})
