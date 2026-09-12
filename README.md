# DDON 资料站

把 DDON（龙之信条 Online）三个私服的数据整合成一个能查阅的界面。同一份数据做成三种交付形态：

| 产物 | 形态 | 给谁用 |
|---|---|---|
| `dist\ddon-hub-portable.exe` | 单文件 Windows exe，89 MB | 电脑上用，双击即开，不需要装任何东西 |
| `dist\DDON资料站-手机版.html` | 单个 HTML 文件，756 KB | 存进手机，浏览器打开，离线可用 |
| `dist\site\` | 静态站点（3 个文件） | 传到 Cloudflare / Netlify，所有人打开网址即最新 |

## 数据来源

| 内容 | 来源 | 更新方式 |
|---|---|---|
| 技能表（11 职业 / 307 行 / 275 张详表） | [DDON-DPS研究所 Wiki*](https://wikiwiki.jp/blacktea/) 作者整理 | 抓取后烘进产物，不自动更新 |
| 中文译名 | 私服汉化包的文本索引（`gmd.csv`） | 同上 |
| 在线人数 | `api.ddon.org`、`legacyddon.com/rpc/status`、`dogmarising.netlify.app/.netlify/functions/status` | 实时抓取 |
| 公告 | `live.ddon.org`、`legacyddon.com` 首页 | 抓取，缓存 5 分钟 |

**技能表按设计不自刷**：wikiwiki 有 Cloudflare 拦截，程序化抓取会 403；而这份数据本身也基本不变。

**DDON Revival 的人数在浏览器里取不到**——它的接口只允许自家网页读取（`Access-Control-Allow-Origin: https://live.ddon.org`）。所以手机版和网站版都收不到它，电脑版能（服务端抓取，不受 CORS 限制）。

## 目录

```
src/          程序源码（三种形态共用）
  data.js          技能表快照（生成物，已提交）
  parsers.js       解析函数副本，与 DSH 插件逐字比对保持一致
  upstream.js      取数与缓存
  notes.js         备注覆盖的读写
  logger.js        日志、崩溃转储、诊断包
  zip.js           手写 ZIP 写入器（不依赖第三方库）
  page.js          桌面/网页版页面
build/        构建与检查脚本
  bake.js              把 wiki 快照烘进 src/data.js
  make-assets.js       图标转 base64 内嵌
  make-icon.py         生成透明底图标
  make-exe.js          打包 exe
  make-offline.js      生成手机版 HTML
  make-web.js          生成 dist/site
  sync-check.js        解析函数与插件是否同步
  selfcheck.js         21 项自检
  offline-check.js     上游全挂时的降级
  crash-check.js       崩溃报告是否落盘
  modes-check.js       手机版与网站版的差异
  offline-html-check.js 生成物内联脚本能否解析
  mobile-check.py      file:// 实测手机版交互
  site-check.py        HTTP 实测网站版
  render-check.py      CDP 截图与 DOM 计数
  e2e.js               对运行中的 exe 做编辑往返
  icon-check.js / verify-exe-icon.py / verify-icon-structure.py   图标相关
dist/         交付物
```

## 构建

```bash
# 数据（需要本机的 DSH 插件与 ddon-arc 管线，见「依赖」）
node build/bake.js

# 三种产物
python build/make-icon.py     # 图标（仅在换图标时需要）
node build/make-assets.js     # 图标内嵌
node build/make-offline.js    # 手机版 HTML
node build/make-web.js        # dist/site（上传用）
node build/make-exe.js        # exe（约 3 分钟）

# 检查
node build/selfcheck.js
node build/modes-check.js
python build/site-check.py
```

## 部署（Cloudflare Pages，走 Git）

Cloudflare 侧配置：

| 项 | 值 |
|---|---|
| Build command | **留空** |
| Build output directory | `dist/site` |

产物已经在仓库里，所以**不需要任何构建命令**。每次更新只需本地重新生成、提交、推送，Cloudflare 自动发布，地址不变。

## 依赖（构建期，不是运行期）

- **Node 24**——打包 exe 用的是 SEA（单文件可执行），产出与构建机的架构绑定
- **Python 3 + Pillow**——只用于图标，不装也能构建其他产物
- **本机的 DSH 插件 `dsh-plugin-ddon-hub`**——`bake.js` 从它读技能表快照。**没有它就无法重新生成 `src/data.js`**，但仓库里已有提交好的版本，所以只克隆仓库仍能构建出 exe 和页面
- `esbuild`、`postject`、`rcedit` 是 npm 依赖，`npm install` 即可

## 版权

- 技能表来自 **DDON-DPS研究所 Wiki\*** 作者整理，版权归其所有
- 中文译名来自私服汉化包，版权归汉化组所有
- 本项目只是把这两份内容整合成一个便于查阅的界面

**自己人之间传阅没问题，请勿公开分发或用于商业用途。** `dist/site/robots.txt` 与 `_headers` 只是请求搜索引擎不要收录，不等于授权。

## 几个踩过的坑（改代码前值得看一眼）

1. **别在运行时引用项目外的路径。** 早期版本用绝对路径 `import` 本机 DSH 插件来复用解析函数，作者机上所有测试通过，收件人每个请求都报 `Cannot find module`。现在 `selfcheck.js` 会扫源码**和真正打进 exe 的 bundle**，发现外部依赖即失败。
2. **打包顺序：先写 PE 资源，再注入 SEA blob。** 反过来 rcedit 在注入过的 exe 上永不收敛（实测 13 分钟、800 秒 CPU 仍未结束）。
3. **内联脚本里不能出现反引号。** 页面脚本放在 `String.raw\`...\`` 里，正文或注释里一个反引号就会提前闭合，生成出来的文件标记正常、脚本全废。`make-offline.js` 会在写盘前解析一遍。
4. **排序按钮不能复用职业标签的类名。** 点击处理先判 `.job`，而排序按钮当时也带这个类，于是点排序被"切职业"分支接走——表现为"点一次就不灵了"。
