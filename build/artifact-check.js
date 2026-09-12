/**
 * 检查：生成物本身是否符合当前策略。
 *
 * 这个脚本**不需要浏览器**，所以当 Playwright 的 CDP 连接出问题时（本机时而发生），
 * 它仍然能覆盖大部分断言：robots.txt / _headers / 页脚声明 / 数据源 / 内联脚本可解析。
 *
 * 需要浏览器的部分（DOM 渲染、交互）由 cards-check.py、site-check.py、mobile-check.py
 * 负责，那几个脚本跑不通时不要假装验证过。
 *
 * Run with: node build/artifact-check.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const WEB = path.join(ROOT, 'dist', 'site', 'index.html')
const PHONE = path.join(ROOT, 'dist', 'DDON资料站-手机版.html')
const ROBOTS = path.join(ROOT, 'dist', 'site', 'robots.txt')
const HEADERS = path.join(ROOT, 'dist', 'site', '_headers')

const problems = []
let checked = 0

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function check(label, ok, detail) {
  checked += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : '   ' + detail}`)
  if (!ok) problems.push(label)
}

function main() {
  const web = read(WEB)
  const phone = read(PHONE)
  const robots = read(ROBOTS)
  const headers = read(HEADERS)

  console.log('爬虫策略（2026-09-12 改为允许收录）\n')
  check('robots.txt 有 Allow: /', robots.includes('Allow: /'))
  check('robots.txt 没有针对 * 的 Disallow: /', !/User-agent: \*\s*\nDisallow: \//.test(robots))
  check('robots.txt 仍拒绝 AI 训练爬虫', robots.includes('GPTBot') && robots.includes('CCBot'))
  check('_headers 已去掉 X-Robots-Tag', !headers.includes('X-Robots-Tag'))
  check('_headers 保留 Referrer-Policy', headers.includes('Referrer-Policy'))

  console.log('\n页脚声明\n')
  /*
   * 两种模式的页脚按 `hosted` 走不同分支：网站版给「出处与用途」，手机版给「本文件」。
   * 所以不要断言手机版也有「仅供学习交流」——它不发布，没有出处声明，那是设计如此。
   * 要验的是**各自走对了分支**，以及两版都不再要求保密。
   */
  check('网站版含「仅供学习交流」', web.includes('仅供学习交流'))
  check('网站版不再要求保密（已删「请勿公开分发」）', !web.includes('请勿公开分发'))
  check('网站版不再写「如权利人认为不妥请联系删除」', !web.includes('请联系删除'))
  check('网站版标注版权归属', web.includes('版权归 DDON-DPS研究所'))
  check('网站版声明与官方/运营方无关', web.includes('与 Capcom 及任何私服运营方无关'))
  check('手机版走另一分支（「本文件」离线说明）', phone.includes('完全离线，可存到手机里直接打开'))
  check('手机版也不含保密要求', !phone.includes('请勿公开分发'))

  console.log('\n数据与结构\n')
  const bootMatch = /<script id="boot"[^>]*>([\s\S]*?)<\/script>/.exec(web)
  if (bootMatch === null) {
    check('boot 数据块存在', false)
  } else {
    const boot = JSON.parse(bootMatch[1])
    check('boot.links 是 18 条', Object.keys(boot.links).length === 18, `实际 ${Object.keys(boot.links).length}`)
    check('链接表含日文 wiki 入口', typeof boot.links.legacyJpWiki === 'string' && boot.links.legacyJpWiki.startsWith('https://'))
    check('boot.hosted 为 true', boot.hosted === true)
    check('职业数为 11', boot.jobs.length === 11, `实际 ${boot.jobs.length}`)
    check('没有残留 includeRevival 字段', boot.includeRevival === undefined)
  }
  check('页面含宽屏媒体查询', web.includes('min-width:900px'))
  check('卡片模板带 data-id', web.includes('data-id'))
  check('没有残留的「官网入口」区块标题', !web.includes('>官网入口<'))

  console.log('\n内联脚本可解析\n')
  const scripts = [...web.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  let parseOk = true
  scripts.forEach((body, index) => {
    try {
      if (/^\s*\{/.test(body)) JSON.parse(body)
      else new vm.Script(body, { filename: `web-${index}.js` })
    } catch (error) {
      parseOk = false
      console.log(`    第 ${index} 段解析失败: ${error.message}`)
    }
  })
  check(`${scripts.length} 段脚本全部可解析`, parseOk)

  console.log()
  if (problems.length > 0) {
    console.error('FAIL:')
    for (const row of problems) console.error('   ' + row)
    process.exit(1)
  }
  console.log(`OK: 生成物符合当前策略（${checked} 项，未使用浏览器）`)
}

try {
  main()
} catch (error) {
  console.error('artifact-check failed:', error && error.stack ? error.stack : error)
  process.exit(1)
}
