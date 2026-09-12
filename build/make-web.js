/**
 * Build step: the deployable website.
 *
 * Same page as the phone build, with three differences that only matter once it
 * lives on a public origin:
 *
 *   1. It is `index.html` in a folder ready to deploy, not a file to carry around.
 *   2. `robots.txt` and `_headers` ask search engines not to index it. The skill
 *      table is someone else's work and the translations are a fan group's; a
 *      public URL is a different thing from a file passed around in private.
 *   3. Wording differs — the phone build talks about carrying a file around, this
 *      one about always being current.
 *
 * The content is identical, Revival card included. An earlier version dropped that
 * card here on the grounds that its API can never be read from a third-party origin;
 * the result looked like a missing server rather than an explained limitation, so it
 * is back with a "本站取不到" label.
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
 * 爬虫策略：欢迎收录，只挡 AI 训练爬虫。
 *
 * 这份 `robots.txt` 会和 Cloudflare 的「AI Crawl Control」托管段落合并下发——
 * 实测线上是 Cloudflare 那段在前、这段在后。两段的意图必须一致，否则同一个
 * `User-agent: *` 出现两条相反规则，行为不确定。
 *
 * 曾经这里写的是 `Disallow: /`（整站不收录），理由是"技能表是别人的、译名是汉化组的，
 * 不该被索引"。用户否掉了这个判断，并且是对的：**这些原始资料本来就是公开的**——
 * DDON-DPS研究所 wiki 是公开站点，汉化包的译名也早已在流传。把公开内容私有化没有根据，
 * 而整合与翻译恰恰是应该被检索到的。
 *
 * 所以现在的立场是：搜索引擎随便收，AI 训练爬虫拒绝（`ai-train=no`，与 Cloudflare 的
 * 默认策略同向，那一段还会顺手挡掉 Amazonbot / Bytespider / ClaudeBot 等）。
 */
const ROBOTS = `# 欢迎搜索引擎收录：本站只是把公开资料整合成一个便于查阅的界面。
# 技能表来自 DDON-DPS研究所 Wiki*（公开站点），译名来自流传中的汉化包。
User-agent: *
Allow: /

# 唯一拒绝的是拿内容去训练模型的爬虫。
# 说明：Cloudflare 的 AI Crawl Control 会在本文件前面追加一段托管内容，
# 同样声明 ai-train=no，两者一致。
User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: ClaudeBot
Disallow: /
`

/**
 * 自定义响应头。
 *
 * 曾经这里下发 `X-Robots-Tag: noindex, nofollow, noarchive`，用来强制不收录。
 * 那个策略已按用户要求推翻（理由见上面 ROBOTS 的注释），所以这一条去掉了——
 * 留着它会和 `Allow: /` 直接矛盾，而且响应头优先级高于 robots.txt。
 *
 * `Referrer-Policy` 保留：它只影响跳转到第三方站点时带不带来源页地址，
 * 与收录无关，属于纯粹的隐私最小化。
 */
const HEADERS = `/*
  Referrer-Policy: no-referrer
`

/** Netlify and Cloudflare Pages both accept a `_redirects` file for 404 handling. */
const README = `# DDON 资料站 · 网站版

这个目录就是可以直接上传的静态站点，只有三个文件：

- \`index.html\` —— 整站，数据、样式、脚本全在里面（${(fs.existsSync(path.join(ROOT, 'dist', 'DDON资料站-手机版.html')) ? (fs.statSync(path.join(ROOT, 'dist', 'DDON资料站-手机版.html')).size / 1024).toFixed(0) : '?')} KB 左右）
- \`robots.txt\` —— 欢迎搜索引擎收录，但拒绝 AI 训练爬虫
- \`_headers\` —— 只下发 \`Referrer-Policy\`（收录策略已改为允许，故不再有 X-Robots-Tag）

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

  const html = buildPage({ hosted: true })
  const boot = checkPage(html, 'web')

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'), ROBOTS, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, '_headers'), HEADERS, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, '部署说明.md'), README, 'utf8')

  const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
  console.log(`  index.html  ${kb} KB   (技能表 ${manifest.capturedAt})`)
  console.log(`  robots.txt / _headers / 部署说明.md`)
  console.log(`  jobs ${boot.jobs.length}, links ${Object.keys(boot.links).length}, hosted=${boot.hosted}`)
  console.log('  -> ' + OUT_DIR)
}

try {
  main()
} catch (error) {
  console.error('make-web failed:', error && error.stack ? error.stack : error)
  process.exit(1)
}
