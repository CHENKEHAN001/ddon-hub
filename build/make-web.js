/**
 * Build step: the deployable website.
 *
 * Same page as the phone build, three differences that only matter once it lives
 * on a public origin:
 *
 *   1. It is `index.html` in a folder ready to upload, not a file to carry around.
 *   2. `robots.txt` and `_headers` ask search engines not to index it. The skill
 *      table is someone else's work and the translations are a fan group's; a
 *      public URL is a different thing from a file passed around in private.
 *   3. `includeRevival: false` — Revival's API only accepts its own origin, so a
 *      card that can never show a number is worse than no card. Its links stay in
 *      the 官网入口 block.
 *
 * Run with: node build/make-web.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { buildPage, checkPage } = require('./make-offline.js')
const manifest = require(path.join(__dirname, '..', 'src', 'manifest.js'))

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'dist', 'site')

/**
 * Crawler policy.
 *
 * Deliberately permissive for people and closed for indexers: the point is that a
 * friend who has the URL can open it, not that it shows up in a search result for
 * someone else's content.
 */
const ROBOTS = `# 不要收录本站：技能表来自第三方整理，译名来自汉化组，属于二次分发。
# 有链接的人可以正常访问，但不希望出现在搜索结果里。
User-agent: *
Disallow: /

# 常见的 AI 训练爬虫也一并拒绝
User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /
`

/**
 * Netlify / Cloudflare Pages both read this file.
 *
 * `X-Robots-Tag` is the header equivalent of the robots.txt rule and also covers
 * crawlers that fetch a page without reading robots.txt first.
 */
const HEADERS = `/*
  X-Robots-Tag: noindex, nofollow, noarchive
  Referrer-Policy: no-referrer
`

/** Netlify and Cloudflare Pages both accept a `_redirects` file for 404 handling. */
const README = `# DDON 资料站 · 网站版

这个目录就是可以直接上传的静态站点，只有三个文件：

- \`index.html\` —— 整站，数据、样式、脚本全在里面（${(fs.existsSync(path.join(ROOT, 'dist', 'DDON资料站-手机版.html')) ? (fs.statSync(path.join(ROOT, 'dist', 'DDON资料站-手机版.html')).size / 1024).toFixed(0) : '?')} KB 左右）
- \`robots.txt\` —— 请求搜索引擎不要收录
- \`_headers\` —— 加上 \`X-Robots-Tag\`，防止不读 robots.txt 的爬虫

## 部署（三种任选，都不需要域名）

### Cloudflare Pages（免费版不计流量，更新次数不限）

1. 登录 https://dash.cloudflare.com → Workers & Pages → Create → Pages
2. 选 **Upload assets**（不用连 Git，直接把文件拖上去）
3. 项目名随便起（会变成 \`<项目名>.pages.dev\`）
4. 把这个目录里的三个文件拖进去 → Deploy
5. 拿到形如 \`https://xxxx.pages.dev\` 的地址，发给别人即可

之后每次更新：重新上传一次 \`index.html\` 即可，地址不变。

### Netlify（2025-09-04 起新账号改为积分制，注意用量）

1. 登录 https://app.netlify.com → Add new site → **Deploy manually**
2. 把整个目录拖到上传区域
3. 拿到形如 \`https://xxxx.netlify.app\` 的地址

**积分账**（免费版每月 300 积分，硬上限，不会产生费用）：

| 用量 | 消耗 |
|---|---|
| 每次「发布到生产」（更新一次） | 15 积分 |
| 带宽 | 20 积分 / GB |
| 访问请求 | 2 积分 / 万次 |
| 预览部署、分支部署、构建失败 | 0 |

按这个站点算：每次访问约 0.75 MB，所以 **100 GB 文件 ≈ 13.5 万次页面访问**；
一万次访问合计约 15 + 2 = 17 积分。也就是说流量几乎用不完，
**300 积分真正的限制是「每月最多更新 20 次」**（20 × 15 = 300）。

积分用尽后不是扣费，而是**所有项目暂停**，访客看到 \`Site not available\`，
下个月重置后恢复。所以别把更新次数刷满。

### GitHub Pages

1. 建一个仓库，把三个文件传进去
2. Settings → Pages → Source 选 \`main\` 分支的 \`/\` 根目录
3. 地址形如 \`https://<用户名>.github.io/<仓库名>/\`

## 更新流程

改完数据后重新生成再上传：

\`\`\`bash
node build/bake.js          # 把最新技能表烘进 src/data.js
node build/make-web.js      # 重新生成 dist/site/
\`\`\`

然后只把 \`index.html\` 重新上传/覆盖一次。**地址不变，别人不用做任何事，刷新就是最新。**

## 几点说明

- **在线人数**：LegacyDDON 与 Dogma Rising 由访客的浏览器直接读取。
  DDON Revival 的接口只允许自家网页读取，任何第三方站点都取不到，所以这里不显示它。
- **每个人的备注改动**只存在各自的浏览器里，不会上传，互相看不到。
  想共用一份需要后端和账号，是另一个量级的东西。
- **出处**：技能表来自 DDON-DPS研究所 Wiki*（wikiwiki.jp/blacktea）作者整理，
  译名来自私服汉化包。这两份都不是本项目的版权内容，**公网分发前请自行确认是否合适**。
  \`robots.txt\` 只是请求不被收录，不等于授权。
`

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const html = buildPage({ hosted: true, includeRevival: false })
  const boot = checkPage(html, 'web')

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), ROBOTS, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, '_headers'), HEADERS, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, '部署说明.md'), README, 'utf8')

  const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
  console.log(`  index.html  ${kb} KB   (技能表 ${manifest.capturedAt})`)
  console.log(`  robots.txt / _headers / 部署说明.md`)
  console.log(`  jobs ${boot.jobs.length}, links ${Object.keys(boot.links).length}, Revival 卡片: ${boot.includeRevival ? '有' : '已隐藏'}, hosted=${boot.hosted}`)
  console.log('  -> ' + OUT_DIR)
}

try {
  main()
} catch (error) {
  console.error('make-web failed:', error && error.stack ? error.stack : error)
  process.exit(1)
}
