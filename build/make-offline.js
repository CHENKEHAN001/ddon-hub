/**
 * Build step: one self-contained HTML file for a phone.
 *
 * The exe needs a PC. This produces a single file that runs in a phone browser
 * with no server, no install and no network for the skill tables — everything is
 * inlined, exactly like the exe bakes its data in.
 *
 * What it can and cannot do is decided by the upstreams' CORS headers, measured:
 *
 *   LegacyDDON      ACAO: *                  -> fetchable from the page
 *   Dogma Rising    ACAO: *                  -> fetchable from the page
 *   DDON Revival    ACAO: https://live.ddon.org  -> blocked by the browser
 *
 * So Revival shows as "要用电脑版" instead of a wrong number. Everything else —
 * eleven jobs, 275 detail tables, search, sorting, and note editing — works
 * offline, with edits in the browser's own storage.
 *
 * Run with: node build/make-offline.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'dist', 'DDON资料站-手机版.html')

/* Reuse the desktop page's stylesheet so the two can't drift; the mobile overrides
   are appended below it. The desktop client script is not reused: that one renders
   for a mouse (hover tooltips, a five-column table, a polled payload). */
const desktop = require(path.join(ROOT, 'src', 'page.js'))
const { SNAPSHOT, LEGEND } = require(path.join(ROOT, 'src', 'data.js'))
const manifest = require(path.join(ROOT, 'src', 'manifest.js'))
const ASSETS = require(path.join(ROOT, 'src', 'assets-inline.js'))
/* The link table is the same one the desktop build uses, so an address change
   only has to be made in one place. */
const { LINKS } = require(path.join(ROOT, 'src', 'upstream.js'))
/* 公告由 build/fetch-news.js 抓取后烘入——电脑版与插件在服务端抓，网站版靠这个快照
   拿到同样的条目，四个形态的公告区块才不会一个有一个没有。 */
const NEWS = require(path.join(ROOT, 'src', 'news.js'))

/**
 * 怪物图鉴快照。
 *
 * `src/monsters.js` 是生成物（ddon-arc/build-monsters-module.py 产出），写成 ESM
 * 是为了让插件半边 `import`；这个构建脚本是 CommonJS，所以按文本取那一个 JSON
 * 字面量再解析，而不是 require 它。
 *
 * 之所以不用正则「配平括号」而是走 JSON.parse：`export const MONSTERS = ` 后面就是
 * 一个完整的 JSON 值，取到末尾分号即可。JSON.parse 自己会把括号配平，正则做这件事
 * 才是真正脆弱的地方。解析失败直接抛错——一份坏数据烘进页面，比构建失败更糟。
 */
const MONSTERS_SOURCE = path.join(ROOT, 'src', 'monsters.js')
const CODEX = (() => {
  const text = fs.readFileSync(MONSTERS_SOURCE, 'utf8')
  const marker = 'export const MONSTERS = '
  const start = text.indexOf(marker)
  if (start < 0) throw new Error(`monsters.js: 找不到 "${marker}"`)
  const from = start + marker.length
  const end = text.lastIndexOf(';')
  if (end < from) throw new Error('monsters.js: 找不到导出行末尾的分号')
  return JSON.parse(text.slice(from, end))
})()
if (CODEX.monsters === undefined || CODEX.spots === undefined) {
  throw new Error('monsters.js: 快照里没有 monsters/spots，生成器是不是改了结构？')
}

/* --------------------------------------------------------------------- styles */

/** Narrow-screen overrides: touch targets, one column, no hover-only affordances. */
const MOBILE_CSS = `
/* ---- 手机版覆盖：单列、可点区域加大、去掉只在悬停时才有的提示 ---- */
body{font-size:14px;-webkit-text-size-adjust:100%}
.wrap{padding:10px 10px 40px;max-width:720px}
header{gap:8px;margin-bottom:8px}
h1{font-size:15px}
.crest{width:26px;height:26px}
.tag{font-size:10.5px}
.grid{grid-template-columns:1fr;gap:8px}
.card{padding:10px 11px;border-radius:10px}
.big{font-size:22px}
button{padding:7px 12px;min-height:34px}
input{min-height:34px;padding:6px 10px}
#search{width:100%!important;box-sizing:border-box;margin-top:6px}
/* 怪物图鉴：和技能表同一套卡片，手机上单列、宽屏切表格 */
#codexSearch{width:100%!important;box-sizing:border-box;margin:6px 0}
.codexCard{margin-bottom:7px}
.codexPlaces{max-width:38ch;white-space:normal;line-height:1.5}
/* 详情行是展开行的附属内容，不是可点行；要盖掉 tbody tr 的 cursor:pointer */
.codexDetailRow{cursor:default}
.codexDetailRow:hover{background:transparent}
.jobs{gap:6px;margin:8px 0}
.job{padding:6px 13px;font-size:13.5px;min-height:32px;display:inline-flex;align-items:center}
.toolbar{gap:6px}
/* 技能列表改成卡片：五列表格在手机上没法看，横向滚动更没法用 */
.skill{border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:7px;background:var(--panel);cursor:pointer}
.skill.on{border-color:var(--accent)}
.skillName{font-weight:600;line-height:1.45}
.skillName .ja{display:block;color:var(--dim);font-size:12px;font-weight:400;margin-top:1px}
.skillNums{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.numChip{font-size:12px;color:var(--dim);background:var(--panel2);border-radius:6px;padding:2px 7px;font-variant-numeric:tabular-nums}
.numChip b{color:var(--fg);font-weight:600}
.skillNote{margin-top:6px;font-size:12.5px;color:var(--dim);line-height:1.5}
.skillNote.pending{color:var(--dim);opacity:.8}
.noteHint{font-size:11px;color:var(--dim);margin-top:3px;opacity:.75}
.detail{margin-top:10px;padding:11px 12px;border-radius:10px}
.detailGrid{grid-template-columns:1fr}
.kv{grid-template-columns:1fr;gap:1px 0;padding:5px 0;border-top:1px solid var(--line)}
.kv:first-child{border-top:0}
.kvKey{font-size:11.5px}
.kvVal{font-size:13px;line-height:1.55}
.kvVal.editable{padding:3px 5px;margin:-3px -5px;border-radius:6px;background:rgba(127,127,127,.10)}
.foot{font-size:11px}
.footRow{display:block}
.footRow>span:first-child{color:var(--fg);font-weight:600;margin-right:6px}
.toast{left:10px;right:10px;bottom:10px}
.toast div{font-size:13px}
.editing{display:flex;gap:6px;align-items:center;margin-top:5px}
.editing input{flex:1 1 auto}
.editing button{flex:none}
/* 旧的独立入口区块样式，已由卡片内的 a.chip 取代；留着以防有页面还在用 .links */
.links{display:flex;flex-direction:column;gap:2px;margin-top:2px}
.links a{display:block;padding:7px 2px;border-top:1px solid var(--line);font-size:13.5px}
.links a:first-child{border-top:0}
/* 公告条目：日期 + 来源 + 标题，手机上竖排，宽屏上分三列 */
.newsList{display:flex;flex-direction:column}
.newsItem{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:7px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none}
.newsItem:first-child{border-top:0}
.newsItem:hover b{color:var(--accent)}
.newsDate{color:var(--dim);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.newsSrc{color:var(--dim);font-size:11px;text-align:right;white-space:nowrap}
.newsBody2{grid-column:1 / -1;font-size:13px;line-height:1.5}
.newsSum{display:block;color:var(--dim);font-size:11.5px;margin-top:1px}

/* ---------------------------------------------------------------------------
   卡片内的频道条、元信息行与链接行，版式对齐电脑版与插件面板：
   服务器卡片自己带副标题与全部入口，不再有独立的「官网入口」区块。
   --------------------------------------------------------------------------- */
.chipRow{display:flex;flex-wrap:wrap;gap:6px}
.barChip{display:inline-flex;align-items:baseline;gap:4px;padding:2px 8px;border-radius:6px;background:var(--panel2);font-size:11.5px;font-variant-numeric:tabular-nums}
.barChip b{font-weight:600}
.meta{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px;color:var(--dim)}
.meta>span:last-child{color:var(--fg)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.cardSub.title{font-size:11.5px}
/* 卡片链接：胶囊按钮，一行一个在窄屏、自动换行在宽屏 */
a.chip{box-sizing:border-box;display:inline-flex;align-items:center;height:26px;padding:0 10px;border:1px solid var(--line);border-radius:999px;color:var(--dim);font-size:11.5px;text-decoration:none;white-space:nowrap}
a.chip:hover{border-color:var(--dim);color:var(--fg)}

/* ---------------------------------------------------------------------------
   宽屏：换成表格，卡片隐藏。
   手机上卡片好点，307 行五个数值列在电脑上还是表格好扫。两边用同一份数据、
   同一套排序，所以只有显示形式不同，不会一边有一边没有。
   --------------------------------------------------------------------------- */
.wideWrap{display:none}
@media (min-width:900px){
  .wrap{max-width:1500px;padding:14px 20px 60px}
  #skills{display:none}
  #codexList{display:none}
  .wideWrap{display:block}
  .jobs{gap:5px;margin:6px 0 10px}
  .job{padding:3px 12px;min-height:26px;font-size:12.5px}
  #search{width:240px!important;margin-top:0}
  #codexSearch{width:340px!important;margin:6px 0}
  .toolbar{margin-bottom:8px}
  table.wide{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
  table.wide thead th{position:sticky;top:0;z-index:1;background:var(--panel);border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;font-weight:600;white-space:nowrap;color:var(--dim)}
  table.wide thead th.num{text-align:right}
  table.wide thead th.sortable{cursor:pointer;user-select:none}
  table.wide thead th.sortable:hover{color:var(--fg)}
  table.wide thead th .caret{font-size:9px}
  table.wide tbody td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  table.wide tbody td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.wide tbody tr{cursor:pointer}
  table.wide tbody tr:hover{background:var(--panel2)}
  table.wide tbody tr.on{background:var(--panel2)}
  table.wide td.skillName{white-space:nowrap}
  table.wide td.skillName .ja{color:var(--dim);font-size:11.5px;margin-left:8px}
  table.wide td.skillNote{color:var(--dim);font-size:11.5px;min-width:220px;word-break:break-word}
  table.wide td.skillNote:hover{color:var(--fg)}
  /* 详表在宽屏上用两列排，读起来比一长条舒服 */
  .detailGrid{grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:6px 24px}
  .kv{grid-template-columns:max-content minmax(0,1fr);gap:2px 12px;border-top:0;padding:2px 0}
  .kvKey{font-size:11.5px}
  .kvVal{font-size:12px}
  .kvVal.editable{padding:0;margin:0;background:transparent}
  .kvVal.editable:hover{background:rgba(127,127,127,.14);border-radius:4px}
  .footRow{display:flex}
  .footRow>span:first-child{font-weight:400;color:var(--dim);margin-right:8px;flex:none;min-width:64px}
}`

/* ------------------------------------------------------------------ client JS */

/**
 * The page logic.
 *
 * Written separately from the desktop client rather than shared: the desktop one
 * renders for a mouse (hover tooltips, a five-column table, a footer built from a
 * polled payload) and this one for a thumb. What is shared is the data and the
 * stylesheet.
 */
const JS = String.raw`
(function(){
  'use strict'
  var boot = JSON.parse(document.getElementById('boot').textContent)
  var KEY_NOTES = 'ddon-hub-notes-v1'
  var state = { job: boot.defaultJob, query: '', sort: 'dps', selected: null, hub: null, editing: null,
    codexView: 'monster', codexSort: 'spots', codexQuery: '', codexOpen: null, codexIndex: null }

  function el(id){ return document.getElementById(id) }
  function esc(v){ return String(v === null || v === undefined ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
  var KANA = /[\u3040-\u30fa\u30fc-\u30ff]/
  function hasKana(v){ return KANA.test(String(v === undefined || v === null ? '' : v)) }
  function cellText(c){ var zh = (c && c.zhValue) || ''; return zh !== '' && !hasKana(zh) ? zh : '' }
  function cellSource(c){ if(!c) return ''; var raw = c.value === '-' ? '—' : c.value; return raw === undefined || raw === null ? '' : String(raw) }
  function noteText(row){ var zh = (row && row.zhNote) || ''; return hasKana(zh) ? '' : zh }
  function firstNumber(t){ var m = String(t === undefined || t === null ? '' : t).match(/-?\d+(?:\.\d+)?/); return m === null ? null : Number(m[0]) }
  function fmt(v, d){ return v === null || v === undefined ? '—' : Number(v).toFixed(d === undefined ? 0 : d) }

  /* ---- 本地存储：手机上没有服务端，改动就存在浏览器里 ---- */
  var store = { notes: {}, cells: {} }
  function loadStore(){
    try {
      var raw = localStorage.getItem(KEY_NOTES)
      if (raw){ var p = JSON.parse(raw); store.notes = p.notes || {}; store.cells = p.cells || {} }
    } catch(e){ /* 隐私模式下 localStorage 可能不可用，静默降级为只读 */ }
  }
  function saveStore(){
    try { localStorage.setItem(KEY_NOTES, JSON.stringify(store)) } catch(e){ toast('浏览器不允许保存，改动只在本次会话有效', true) }
  }
  function cellKey(job, skill, label, source){ return [job, skill, label, source].join('\u0001') }
  function editedCount(){ return Object.keys(store.notes).length + Object.keys(store.cells).length }

  function toast(msg, isErr){
    var box = el('toast')
    var node = document.createElement('div')
    if (isErr) node.className = 'err'
    node.textContent = msg
    box.appendChild(node)
    setTimeout(function(){ if (node.parentNode) node.parentNode.removeChild(node) }, isErr ? 6000 : 2600)
  }

  /* ---- 备注覆盖：按原文匹配，与电脑版同一套键 ---- */
  function applyOverrides(jobs){
    return jobs.map(function(job){
      var rows = (job.summaryRows || []).map(function(row){
        var src = String(row.note || '').trim()
        var custom = src === '' ? undefined : store.notes[src]
        return custom === undefined ? row : Object.assign({}, row, { zhNote: custom, noteEdited: true })
      })
      function localize(cells){
        return (cells || []).map(function(c){
          var custom = store.cells[cellKey(job.ja, c.skill || '', c.label, c.value)]
          return custom === undefined ? c : Object.assign({}, c, { zhValue: custom, valueEdited: true })
        })
      }
      var details = (job.details || []).map(function(d){
        return Object.assign({}, d, {
          cells: localize(d.cells), attributes: localize(d.attributes), detail: localize(d.detail),
        })
      })
      return Object.assign({}, job, { summaryRows: rows, details: details })
    })
  }

  function jobs(){ return applyOverrides(boot.jobs) }
  function currentJob(){
    var list = jobs()
    for (var i = 0; i < list.length; i++) if (list[i].zh === state.job) return list[i]
    return list.length > 0 ? list[0] : null
  }

  /* ------------------------------------------------------------ 渲染 */

  /* ---- 怪物图鉴 ----
   * 和插件面板同一份数据、同一个问题：一只怪物出现在哪些地点、多少级；
   * 反过来的「这个地点有什么」也走同一张表。索引只建一次，因为每次按键都扫
   * 2000 条生成记录正是让手机输入法看起来像坏了的原因。
   * 手机上用卡片、宽屏用表格，和技能表一样由 CSS 媒体查询切换。
   */
  function codexData(){ return boot.codex || null }

  function codexName(dict, id, fallback){
    var row = dict ? dict[id] : null
    if (!row) return fallback === undefined ? '' : fallback
    return row.zh || row.ja || row.en || (fallback === undefined ? '' : fallback)
  }

  /*
   * 中文 + 日文原文：「法拉納平原 ファーラナ平原」。
   *
   * 图鉴要回答的就是「游戏里看到的那串日文对应什么」，只给中文等于只答一半。
   * 两者相同（没有中文译名的条目）时只显示一个，免得出现「モロー樹林 モロー樹林」。
   * 注意：这段注释也在这个 String.raw 模板里，正文里不能出现反引号——见文件头说明。
   */
  function namePair(dict, id, fallback){
    var zh = codexName(dict, id, fallback)
    var row = dict ? dict[id] : null
    var ja = row ? (row.ja || '') : ''
    if (ja === '' || ja === zh) return zh
    return zh + ' ' + ja
  }

  function codexKeys(map){
    var out = []
    for (var key in map) if (Object.prototype.hasOwnProperty.call(map, key)) out.push(key)
    return out
  }

  function codexIndex(){
    if (state.codexIndex) return state.codexIndex
    var codex = codexData()
    var byMonster = {}, byStage = {}
    if (codex){
      for (var i = 0; i < codex.spots.length; i++){
        var spot = codex.spots[i]
        var monster = codex.monsters[spot.m]
        var stage = codex.stages[spot.s]
        if (!monster || !stage) continue
        var m = byMonster[spot.m]
        if (!m){ m = { id: spot.m, row: monster, places: {}, n: 0, min: spot.min, max: spot.max, rows: [] }; byMonster[spot.m] = m }
        m.n += spot.n
        m.places[spot.s] = 1
        if (spot.min < m.min) m.min = spot.min
        if (spot.max > m.max) m.max = spot.max
        m.rows.push(spot)
        var s = byStage[spot.s]
        if (!s){ s = { id: spot.s, row: stage, kinds: {}, n: 0, min: spot.min, max: spot.max, rows: [] }; byStage[spot.s] = s }
        s.n += spot.n
        s.kinds[spot.m] = 1
        if (spot.min < s.min) s.min = spot.min
        if (spot.max > s.max) s.max = spot.max
        s.rows.push(spot)
      }
    }
    var out = { byMonster: [], byStage: [] }
    for (var key in byMonster) if (Object.prototype.hasOwnProperty.call(byMonster, key)) out.byMonster.push(byMonster[key])
    for (var key2 in byStage) if (Object.prototype.hasOwnProperty.call(byStage, key2)) out.byStage.push(byStage[key2])

    /*
     * 每个条目附带一份「掉落物名称」的合并文本，供搜索用。
     *
     * 玩家常拿着一个素材找"去哪刷"（搜「抗侵薬」「裂縫水晶的碎片」），所以掉落物
     * 也要能搜。搜索时如果每条都遍历掉落表，300 多条 × 每次按键会有点浪费；
     * 索引本来就只建一次，在这里顺手合并成字符串最省事。
     */
    var collectItems = function (entry){
      var seen = {}
      var parts = []
      for (var i = 0; i < entry.rows.length; i++){
        var tables = entry.rows[i].d || []
        for (var j = 0; j < tables.length; j++){
          var table = codex.drops[String(tables[j])]
          if (!table) continue
          for (var k = 0; k < table.items.length; k++){
            var iid = table.items[k][0]
            if (seen[iid]) continue
            seen[iid] = 1
            var named = codex.itemNames ? codex.itemNames[iid] : null
            if (named){
              if (named.zh) parts.push(named.zh)
              if (named.ja) parts.push(named.ja)
              if (named.en) parts.push(named.en)
            }
          }
        }
      }
      entry.itemText = parts.join(' ')
    }
    for (var a = 0; a < out.byMonster.length; a++) collectItems(out.byMonster[a])
    for (var b = 0; b < out.byStage.length; b++) collectItems(out.byStage[b])

    state.codexIndex = out
    return out
  }

  function codexLevel(min, max){ return min === max ? 'Lv' + min : 'Lv' + min + '-' + max }

  /*
   * 把繁体字换成简体，好让简体键盘也能搜到。
   *
   * 汉化包用的是繁体（戰士 / 骷髏騎士 / 獵人），而大多数人用简体输入。
   * 快照自带 charMap（由生成器按数据里出现过的字生成），这里把「用户输入」和
   * 「数据里的名字」都规范化到简体再比。方向只做繁 -> 简：查得到的字必然在
   * 表里，反过来把简体变成繁体反而会碰到一对多（干 <- 乾/幹）。
   */
  function codexFold(text){
    if (!text) return ''
    var codex = codexData()
    var map = codex && codex.charMap
    if (!map) return String(text).toLowerCase()
    var out = ''
    for (var i = 0; i < text.length; i++){
      var ch = text.charAt(i)
      out += (map[ch] || ch)
    }
    return out.toLowerCase()
  }

  /*
   * 当前视图下过滤结果。
   *
   * 搜索跨视图：搜的是地名而当前在「按怪物」，或者反过来，都会自动切过去。
   * 早先只在当前视图里过滤，于是搜「黑咒迷宫」在按怪物视图下是空的——用户看到
   * 的就是"搜不到"，而他并不知道要先切视图。查询词本身就能说明该看哪一边。
   * 掉落物名称也参与匹配（见 codexIndex 里的 itemText）。
   */
  function matchesItemName(text, needle){
    if (!needle || !text) return false
    return codexFold(text).indexOf(needle) >= 0
  }

  /** 掉落物名称显示成「中文 日文」；没译文时退回日文。 */
  function itemPair(named, fallbackId){
    if (!named) return fallbackId
    var zh = named.zh || ''
    var ja = named.ja || ''
    if (zh === '') return ja || named.en || fallbackId
    return ja === '' || ja === zh ? zh : zh + ' ' + ja
  }

  function codexRows(){
    var codex = codexData()
    if (!codex) return []
    var index = codexIndex()
    var needle = codexFold(state.codexQuery.trim())

    function matches(entries){
      if (needle === '') return entries.slice()
      return entries.filter(function(entry){
        var row = entry.row
        if (entry.id.toLowerCase().indexOf(needle) >= 0) return true
        if (row.zh && codexFold(row.zh).indexOf(needle) >= 0) return true
        if (row.ja && row.ja.toLowerCase().indexOf(needle) >= 0) return true
        if (row.en && row.en.toLowerCase().indexOf(needle) >= 0) return true
        /* 掉落物也算命中：玩家常常是拿着一个素材找"去哪刷" */
        if (matchesItemName(entry.itemText, needle)) return true
        return false
      })
    }

    var rows = matches(state.codexView === 'stage' ? index.byStage : index.byMonster)
    if (needle !== '' && rows.length === 0){
      var otherView = state.codexView === 'stage' ? 'monster' : 'stage'
      var otherHits = matches(otherView === 'stage' ? index.byStage : index.byMonster)
      if (otherHits.length > 0){
        state.codexView = otherView
        renderCodexTabs()
        rows = otherHits
      }
    }

    var dict = state.codexView === 'stage' ? codex.stages : codex.monsters
    var sort = state.codexSort
    rows.sort(function(a, b){
      if (sort === 'name') return codexName(dict, a.id, a.id).localeCompare(codexName(dict, b.id, b.id), 'zh')
      if (sort === 'level') return (b.max - a.max) || (a.min - b.min)
      return (b.n - a.n) || 0
    })
    return rows
  }

  /* 掉落率：上游这一列多数是 0..1 的小数（含 1，即 100%），少数直接是 100
     （已是百分比）。单位必须推断而不是假定——一律乘 100 会让 100 变 10000%，
     而把 1 当百分比又会把 100% 读成 1%。分界取 1.5，上游没有落在这中间的取值。 */
  function chanceText(value){
    var chance = Number(value)
    if (!isFinite(chance) || chance <= 0) return '0%'
    return chance <= 1.5 ? String(Math.round(chance * 1000) / 10) + '%' : String(chance) + '%'
  }

  /** 一只怪物（或一个地点）身上的全部掉落，去重后按掉落表原顺序列出。 */
  function codexDrops(entry){
    var codex = codexData()
    var ids = []
    for (var i = 0; i < entry.rows.length; i++){
      var list = entry.rows[i].d || []
      for (var j = 0; j < list.length; j++) if (ids.indexOf(list[j]) < 0) ids.push(list[j])
    }
    if (ids.length === 0) return '<span class="tag">该生成点没有掉落表</span>'
    var html = ''
    for (var k = 0; k < ids.length; k++){
      var table = codex.drops[String(ids[k])]
      if (!table) continue
      for (var y = 0; y < table.items.length; y++){
        var item = table.items[y]
        var named = codex.itemNames ? codex.itemNames[item[0]] : null
        var label = itemPair(named, item[0])
        html += '<span class="numChip">' + esc(label) + ' <b>' + esc(chanceText(item[3])) + '</b>'
        if (item[1] !== item[2]) html += ' ×' + esc(item[1]) + '-' + esc(item[2])
        html += '</span>'
      }
    }
    return html
  }

  function renderCodexTabs(){
    var host = el('codexTabs')
    if (!host) return
    var views = [['monster', '按怪物'], ['stage', '按地点']]
    var sorts = [['spots', '生成点'], ['level', '等级'], ['name', '名称']]
    var html = ''
    for (var i = 0; i < views.length; i++){
      html += '<div class="job' + (state.codexView === views[i][0] ? ' on' : '') + '" data-view="' + views[i][0] + '">' + views[i][1] + '</div>'
    }
    for (var j = 0; j < sorts.length; j++){
      html += '<div class="job' + (state.codexSort === sorts[j][0] ? ' on' : '') + '" data-csort="' + sorts[j][0] + '">' + sorts[j][1] + '</div>'
    }
    host.innerHTML = html
  }

  function renderCodex(){
    if (!codexData()) return
    renderCodexTabs()
    var codex = codexData()
    var rows = codexRows()
    var isMonster = state.codexView !== 'stage'
    var html = ''
    for (var i = 0; i < rows.length; i++){
      var entry = rows[i]
      var label = isMonster ? codexName(codex.monsters, entry.id, entry.id) : codexName(codex.stages, entry.id, entry.id)
      var ids = isMonster ? codexKeys(entry.places) : codexKeys(entry.kinds)
      var others = []
      for (var k = 0; k < ids.length; k++){
        /* 出现地点带日文原文；按地点看时列的是怪物，怪物名已有独立列，不重复贴 */
        others.push(isMonster ? namePair(codex.stages, ids[k], ids[k]) : codexName(codex.monsters, ids[k], ids[k]))
      }
      var open = state.codexOpen === (state.codexView + ':' + entry.id)
      html += '<div class="skill codexCard' + (open ? ' on' : '') + '" data-codex="' + esc(state.codexView + ':' + entry.id) + '">'
      html += '<div class="skillName">' + esc(label) + '<span class="ja">' + esc(entry.row.ja || '') + '</span></div>'
      html += '<div class="skillNums">'
      html += '<span class="numChip">等级 <b>' + esc(codexLevel(entry.min, entry.max)) + '</b></span>'
      html += '<span class="numChip">' + (isMonster ? '地点' : '怪物') + ' <b>' + ids.length + '</b></span>'
      html += '<span class="numChip">生成点 <b>' + entry.n + '</b></span>'
      html += '</div>'
      html += '<div class="skillNote">' + (isMonster ? '出现地点：' : '出现怪物：') + esc(others.join('、')) + '</div>'
      /* 展开内容就长在这张卡片里；早先写到页面底部的独立面板再 scrollIntoView，
         实测点第一行会把视口甩出 19471 px。 */
      if (open) html += codexDetailHtml(state.codexView + ':' + entry.id)
      html += '</div>'
    }
    el('codexList').innerHTML = rows.length === 0 ? '<div class="empty">没有匹配的怪物或地点</div>' : html

    var host = el('codexTable')
    if (host){
      var table = '<table class="wide"><thead><tr>'
      table += '<th>' + (isMonster ? '怪物' : '地点') + '</th><th>日文原名</th>'
      table += '<th>' + (isMonster ? '出现地点' : '出现怪物') + '</th>'
      table += '<th class="num">等级</th><th class="num">' + (isMonster ? '地点数' : '怪物数') + '</th><th class="num">生成点</th>'
      table += '</tr></thead><tbody>'
      for (var t = 0; t < rows.length; t++){
        var item = rows[t]
        var name = isMonster ? codexName(codex.monsters, item.id, item.id) : codexName(codex.stages, item.id, item.id)
        var refs = isMonster ? codexKeys(item.places) : codexKeys(item.kinds)
        var refNames = []
        for (var r = 0; r < refs.length; r++){
          refNames.push(isMonster ? namePair(codex.stages, refs[r], refs[r]) : codexName(codex.monsters, refs[r], refs[r]))
        }
        var isOpen = state.codexOpen === (state.codexView + ':' + item.id)
        table += '<tr class="' + (isOpen ? 'on' : '') + '" data-codex="' + esc(state.codexView + ':' + item.id) + '">'
        table += '<td>' + esc(name) + '</td><td>' + esc(item.row.ja || '') + '</td>'
        table += '<td class="codexPlaces">' + esc(refNames.join('、')) + '</td>'
        table += '<td class="num">' + esc(codexLevel(item.min, item.max)) + '</td>'
        table += '<td class="num">' + refs.length + '</td><td class="num">' + item.n + '</td>'
        table += '</tr>'
        /* 详情紧跟在那一行下面，不跳到页面别处 */
        if (isOpen){
          table += '<tr class="codexDetailRow"><td colspan="6">' + codexDetailHtml(state.codexView + ':' + item.id) + '</td></tr>'
        }
      }
      table += '</tbody></table>'
      host.innerHTML = rows.length === 0 ? '' : table
    }

    var stats = codex.stats || {}
    if (el('codexMeta')) el('codexMeta').textContent = rows.length + ' 行 · ' + (stats.monsters || 0) + ' 种怪物 · ' + (stats.locations || 0) + ' 个地点 · ' + (stats.spots || 0) + ' 条生成记录 · 译名来自汉化包'
  }

  /** 一行的展开内容；返回空串表示这一行没有可展开的东西。 */
  function codexDetailHtml(key){
    if (!codexData() || !key) return ''
    var codex = codexData()
    var parts = key.split(':')
    var isMonster = parts[0] !== 'stage'
    var id = parts.slice(1).join(':')
    var index = codexIndex()
    var list = isMonster ? index.byMonster : index.byStage
    var entry = null
    for (var i = 0; i < list.length; i++) if (list[i].id === id){ entry = list[i]; break }
    if (entry === null) return ''

    var html = '<div class="detail">'
    html += '<div class="detailGrid">'
    html += '<div class="kv"><span class="kvKey">' + (isMonster ? '怪物' : '地点') + '</span><span class="kvVal">'
    html += esc(isMonster ? codexName(codex.monsters, id, id) : codexName(codex.stages, id, id))
    html += ' <span class="tag">' + esc(entry.row.ja || '') + '</span></span></div>'
    html += '<div class="kv"><span class="kvKey">生成点</span><span class="kvVal">'
    var spots = entry.rows.slice().sort(function(a, b){ return a.min - b.min })
    for (var j = 0; j < spots.length; j++){
      var where = isMonster ? namePair(codex.stages, spots[j].s, spots[j].s) : codexName(codex.monsters, spots[j].m, spots[j].m)
      html += '<span class="numChip">' + esc(where) + ' <b>' + esc(codexLevel(spots[j].min, spots[j].max)) + '</b></span>'
    }
    html += '</span></div>'
    html += '<div class="kv"><span class="kvKey">掉落</span><span class="kvVal">' + codexDrops(entry) + '</span></div>'
    html += '</div>'
    html += '<div class="foot" style="margin-top:8px"><div class="footRow"><span>数据来源</span><span>' + esc(codex.legend || '') + '</span></div></div>'
    html += '</div>'
    return html
  }

  function onCodexClick(event){
    var target = event.target
    if (!target || !target.closest) return
    var viewNode = target.closest('[data-view]')
    if (viewNode){
      state.codexView = viewNode.getAttribute('data-view')
      state.codexOpen = null
      renderCodex()
      return
    }
    var sortNode = target.closest('[data-csort]')
    if (sortNode){
      state.codexSort = sortNode.getAttribute('data-csort')
      renderCodex()
      return
    }
    var rowNode = target.closest('[data-codex]')
    if (rowNode){
      toggleCodexRow(rowNode)
    }
  }

  /*
   * 展开/收起一行，同时保持这一行在屏幕上的位置不变。
   *
   * 展开的内容长在被点行的下面，把这一行自己往下挤——实测同一行在视口里会下滑
   * 38~300px，看起来就像"点一下页面跳到下面去了"。页面本身其实没有被滚走。
   *
   * 两个坑：
   *   1. 必须选主行 tr[data-codex]；只写 [data-codex] 会匹配到详情行，算出来的
   *      基准点直接偏掉。
   *   2. 不能只靠 scrollBy——浏览器的滚动锚定会在 innerHTML 重建时自己调滚动，
   *      实测请求 -495 却只移动了一部分还被反向拉。所以先临时关掉 overflow-anchor，
   *      再用 scrollTo 精确落位。
   */
  function toggleCodexRow(node){
    var key = node.getAttribute('data-codex')
    if (key === null) return
    var mainRow = findCodexRow(key)
    if (!mainRow) return
    /*
     * 锚点取「该行的顶边」。用 bottom 是错的：行高随展开/收起变化，bottom 会跟着
     * 变，于是补偿量里混进了行高差——实测关闭时该行被往上顶 56~169px，行越高偏得
     * 越多。保持 top 不动才符合视觉直觉：点开的行留在原地，只在它下面长内容。
     */
    var anchorTop = mainRow.getBoundingClientRect().top
    var next = state.codexOpen === key ? null : key
    var root = document.documentElement
    var previousAnchor = root.style.overflowAnchor
    root.style.overflowAnchor = 'none'
    state.codexOpen = next
    renderCodex()
    requestAnimationFrame(function(){
      /* 补两次：第一次修主位移，第二次收掉布局在该帧之后才定型的残余 */
      var fresh = findCodexRow(key)
      if (fresh){
        var delta = fresh.getBoundingClientRect().top - anchorTop
        if (Math.abs(delta) > 1) window.scrollTo(0, window.scrollY + delta)
      }
      requestAnimationFrame(function(){
        var again = findCodexRow(key)
        if (again){
          var rest = again.getBoundingClientRect().top - anchorTop
          if (Math.abs(rest) > 1) window.scrollTo(0, window.scrollY + rest)
        }
        root.style.overflowAnchor = previousAnchor
      })
    })
  }

  /*
   * 找一行图鉴元素。
   *
   * 同一个 key 在 DOM 里有两个元素：宽屏的表格行和窄屏的卡片，其中一个
   * display:none。直接 querySelector 会撞上隐藏的那个，getBoundingClientRect()
   * 全返回 0——早先就是拿这个 0 当锚点，于是"补偿"补了个寂寞，用户看到的跳动
   * 一直没被修掉。所以挑第一个真正可见的。
   */
  function findCodexRow(key){
    var nodes = document.querySelectorAll('[data-codex="' + key + '"]')
    for (var i = 0; i < nodes.length; i++){
      var rect = nodes[i].getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return nodes[i]
    }
    return nodes.length > 0 ? nodes[0] : null
  }

  function mountCodex(){
    if (!codexData()) return
    renderCodex()
    var box = el('codexSearch')
    if (box) box.addEventListener('input', function(event){
      state.codexQuery = event.target.value
      renderCodex()
    })
    var host = el('codexList')
    if (host) host.addEventListener('click', onCodexClick)
    var wide = el('codexTable')
    if (wide) wide.addEventListener('click', onCodexClick)
    var tabs = el('codexTabs')
    if (tabs) tabs.addEventListener('click', onCodexClick)
  }

  function renderJobs(){
    var list = boot.jobs
    var html = ''
    for (var i = 0; i < list.length; i++){
      html += '<div class="job' + (list[i].zh === state.job ? ' on' : '') + '" data-job="' + esc(list[i].zh) + '">' + esc(list[i].zh) + '</div>'
    }
    el('jobs').innerHTML = html
  }

  /** 当前职业、按搜索词过滤、按当前排序键排好的行。两种视图共用。 */
  function visibleRows(){
    var job = currentJob()
    if (job === null) return null
    var rows = (job.summaryRows || []).slice()
    var needle = state.query.trim().toLowerCase()
    if (needle !== ''){
      rows = rows.filter(function(r){
        return (r.ja || '').toLowerCase().indexOf(needle) >= 0
          || (r.zh || '').toLowerCase().indexOf(needle) >= 0
          || noteText(r).toLowerCase().indexOf(needle) >= 0
          || (r.note || '').toLowerCase().indexOf(needle) >= 0
      })
    }
    if (state.sort === 'name'){
      rows.sort(function(a, b){ return String(a.ja || '').localeCompare(String(b.ja || ''), 'ja') })
    } else {
      rows.sort(function(a, b){
        var av = firstNumber(a[state.sort]), bv = firstNumber(b[state.sort])
        var aok = av !== null && isFinite(av), bok = bv !== null && isFinite(bv)
        if (!aok && !bok) return 0
        if (!aok) return 1
        if (!bok) return -1
        return bv - av
      })
    }
    return { job: job, rows: rows }
  }

  /** 备注单元格的内容，卡片和表格共用。 */
  function noteHtml(r){
    var shown = noteText(r)
    if (shown !== '') return esc(shown) + (r.noteEdited ? ' <span class="tag ok">改</span>' : '')
    if ((r.note || '') !== '') return '<span class="pending">待译</span>'
    return ''
  }

  /** 技时间：能取出数字就统一成「1.08s」这种形式。注释里也不能用反引号，见文件头说明。 */
  function castText(r){
    var secs = firstNumber(r.cast)
    return secs === null ? esc(r.cast || '—') : fmt(secs, 2) + 's'
  }

  function renderSkills(){
    var view = visibleRows()
    if (view === null){ el('skills').innerHTML = '<div class="empty">没有职业数据</div>'; return }
    var rows = view.rows

    var html = ''
    for (var i = 0; i < rows.length; i++){
      var r = rows[i]
      var isOpen = state.selected !== null && (state.selected.ja === r.ja || state.selected.zh === r.zh)
      var note = noteHtml(r)
      html += '<div class="skill' + (isOpen ? ' on' : '') + '" data-ja="' + esc(r.ja) + '" data-zh="' + esc(r.zh) + '" data-note="' + esc(r.note || '') + '">'
      html += '<div class="skillName">' + esc(r.zh || r.ja) + '<span class="ja">' + esc(r.ja) + '</span></div>'
      html += '<div class="skillNums">'
      html += '<span class="numChip">DPS <b>' + esc(r.dps || '—') + '</b></span>'
      html += '<span class="numChip">倍率 <b>' + esc(r.mult || '—') + '</b></span>'
      html += '<span class="numChip">技时间 <b>' + castText(r) + '</b></span>'
      html += '</div>'
      if (note !== '') html += '<div class="skillNote">' + note + '</div>'
      if ((r.note || '') !== '') html += '<div class="noteHint">点这里可改备注</div>'
      html += '</div>'
    }
    el('skills').innerHTML = rows.length === 0 ? '<div class="empty">没有匹配的技能</div>' : html
    el('jobMeta').textContent = view.job.zh + ' · ' + rows.length + ' 行 · 详表 ' + (view.job.details || []).length + ' 张'
  }

  /**
   * 宽屏表格。
   *
   * 手机上卡片好用，307 行、五个数值列在电脑上还是表格好扫。两边用同一份
   * 数据与同一套排序，靠 CSS 媒体查询决定显示哪个——所以不存在"某一边没更新"。
   */
  function renderTable(){
    var view = visibleRows()
    var host = el('skillsTable')
    if (host === null) return
    if (view === null){ host.innerHTML = ''; return }
    var rows = view.rows

    var caret = function(key){ return state.sort === key ? ' <span class="caret">▼</span>' : '' }
    var html = '<table class="wide"><thead><tr>'
    html += '<th class="sortable" data-sort="name">技能' + caret('name') + '</th>'
    html += '<th class="sortable num" data-sort="mult">倍率合计' + caret('mult') + '</th>'
    html += '<th class="sortable num" data-sort="cast">技时间' + caret('cast') + '</th>'
    html += '<th class="sortable num" data-sort="dps">DPS 性能' + caret('dps') + '</th>'
    html += '<th>备注（点一下可改）</th>'
    html += '</tr></thead><tbody>'
    for (var i = 0; i < rows.length; i++){
      var r = rows[i]
      var isOpen = state.selected !== null && (state.selected.ja === r.ja || state.selected.zh === r.zh)
      html += '<tr class="' + (isOpen ? 'on' : '') + '" data-ja="' + esc(r.ja) + '" data-zh="' + esc(r.zh) + '" data-note="' + esc(r.note || '') + '">'
      html += '<td class="skillName">' + esc(r.zh || r.ja)
      if (r.zh && r.zh !== r.ja) html += '<span class="ja">' + esc(r.ja) + '</span>'
      html += '</td>'
      html += '<td class="num">' + esc(r.mult || '—') + '</td>'
      html += '<td class="num">' + castText(r) + '</td>'
      html += '<td class="num">' + esc(r.dps || '—') + '</td>'
      html += '<td class="skillNote">' + noteHtml(r) + '</td>'
      html += '</tr>'
    }
    html += '</tbody></table>'
    host.innerHTML = rows.length === 0 ? '<div class="empty">没有匹配的技能</div>' : html
  }

  /** 两种视图一起刷新，避免只更新一个导致切屏时看到旧数据。 */
  function renderList(){
    renderSkills()
    renderTable()
  }

  function blockHtml(cells){
    var html = ''
    for (var i = 0; i < cells.length; i++){
      var c = cells[i]
      var label = c.zhLabel || c.label || ''
      var shown = cellText(c)
      var raw = cellSource(c)
      if (shown === '' && raw === '') continue
      html += '<div class="kv"><span class="kvKey">' + esc(label) + '</span>'
      html += '<span class="kvVal' + (raw !== '' ? ' editable' : '') + '"'
      if (raw !== '') html += ' data-cell="' + esc(raw) + '" data-label="' + esc(c.label || '') + '"'
      html += '>' + (shown === '' ? '<span class="pending">待译</span>' : esc(shown)) + (c.valueEdited ? ' <span class="tag ok">改</span>' : '') + '</span></div>'
    }
    return html
  }

  function renderDetail(){
    if (state.selected === null){ el('detail').innerHTML = ''; return }
    var job = currentJob()
    if (job === null){ el('detail').innerHTML = ''; return }
    var names = [state.selected.ja, state.selected.zh]
    var rows = (job.details || []).filter(function(d){ return names.indexOf(d.ja) >= 0 || names.indexOf(d.zh) >= 0 })
    if (rows.length === 0){
      var base = String(state.selected.ja || '').split('+')[0].replace(/【.*?】/g, '').replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '')
      rows = (job.details || []).filter(function(d){
        var l = String(d.ja || '').replace(/\s+/g, ''), r = String(d.zh || '').replace(/\s+/g, '')
        return base !== '' && (l.indexOf(base) === 0 || r.indexOf(base) === 0)
      })
    }
    var html = '<div class="detailHead"><b>' + esc(state.selected.zh || state.selected.ja) + '</b>'
    html += '<span class="spacer" style="flex:1 1 auto"></span><button id="closeDetail">收起</button></div>'
    html += '<div class="detailGrid">'
    if (rows.length === 0){
      html += '<div class="empty">这个技能没有独立详表（只有汇总行）。</div>'
    } else {
      for (var i = 0; i < rows.length; i++){
        html += blockHtml(rows[i].cells || []) + blockHtml(rows[i].attributes || []) + blockHtml(rows[i].detail || [])
      }
    }
    html += '</div>'
    el('detail').innerHTML = html
    /* 这里不再 scrollIntoView：技能详表在页面下方，展开那一行的动作本身已经把它
       撑开了，再强行滚过去就是"点一下跳到下面"——图鉴那边是同一个毛病。
       展开时用 keepViewportAround 把被点的行钉在原位。 */
  }

  /**
   * 技能行按 data-ja 找，只挑**真正可见**的那个。
   *
   * 和 findCodexRow 同一个坑：同名技能行有两份——手机卡片在 #skills、宽屏表格行在
   * #skillsTable，其中一个 display:none。谁先被 querySelector 撞上就可能是隐藏的，
   * rect 全返回 0，拿它当锚点算出来的补偿量就是错的（实测技能行被顶走 406px，
   * diag 里 freshTop=0 就是证据）。
   */
  function findSkillRow(key){
    if (key === null || key === undefined) return null
    var visible = function (nodes){
      for (var i = 0; i < nodes.length; i++){
        var rect = nodes[i].getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) return nodes[i]
      }
      return nodes.length > 0 ? nodes[0] : null
    }
    var table = visible(document.querySelectorAll('#skillsTable tbody tr[data-ja="' + key + '"]'))
    if (table !== null) return table
    return visible(document.querySelectorAll('#skills .skill[data-ja="' + key + '"]'))
  }

  /**
   * 展开/收起技能详表，同时保持被点的那一行在屏幕上的位置不变。
   *
   * 详表面板在页面底部，展开和收起都会让它下面的内容整体移动，于是被点的行相对
   * 视口滑动，看起来就是"点一下跳到下面"。锚点用**行的顶边**：bottom 会随行高变，
   * 补偿量里会混进行高差（图鉴那边实测关闭时被顶走 56~169px 就是这么来的）。
   * 开和关都要补——之前只在展开时补，收起那一半漏了。
   */
  function renderDetailKeeping(row){
    var anchorTop = row ? row.getBoundingClientRect().top : null
    var key = row ? row.getAttribute('data-ja') : null
    var root = document.documentElement
    var previousAnchor = root.style.overflowAnchor
    /* 补偿期间必须关掉滚动锚定：它会在 innerHTML 重建时自己调滚动，和补偿抢位置
       （之前实测请求 -495、实际没走到，就是它干的）。 */
    root.style.overflowAnchor = 'none'
    /* 两个容器都要刷：手机看 #skills 卡片、宽屏看 #skillsTable 表格。
       只调 renderList 会让宽屏表格不更新——选中态没跟上，补偿也就量错了对象
       （实测技能行被顶走 406/1218px 就是这么来的）。 */
    renderList(); renderTable(); renderDetail()
    if (anchorTop === null || key === null){ root.style.overflowAnchor = previousAnchor; return }
    requestAnimationFrame(function(){
      var fresh = findSkillRow(key)
      if (fresh){
        var freshTop = fresh.getBoundingClientRect().top
        var shift = freshTop - anchorTop
        if (Math.abs(shift) > 1) window.scrollTo(0, window.scrollY + shift)
      }
      root.style.overflowAnchor = previousAnchor
    })
  }

  /* ------------------------------------------------------------ 在线人数 */

  /*
   * 在线人数的来源。
   *
   * Revival 的接口只允许 live.ddon.org 自己读取，访客浏览器直连会被 CORS 拦。
   * 电脑版和 DSH 插件是在服务端取数所以不受影响；网站版靠 worker/index.js 那个
   * 代理拿到同样的数据。本地文件版没有服务端可用，只能直连并接受取不到。
   *
   * 每张卡片自己带副标题与官网链接，不再有独立的「官网入口」区块——
   * 电脑版和插件的布局就是这样，链接跟着服务器走比单列一排更好找。
   */
  var NOTES = [
    { id: 'legacy', label: 'LegacyDDON', subtitle: 'legacyddon.com · 现代化重制',
      url: 'https://legacyddon.com/rpc/status', type: 'worlds', site: boot.links.legacy,
      links: [['官网', boot.links.legacy], ['公告', boot.links.legacyNews], ['地图', boot.links.legacyMap],
              ['物品检索', boot.links.legacyItemSearch], ['板任务', boot.links.legacyBoardQuests],
              ['日文 wiki', boot.links.legacyJpWiki]] },
    { id: 'rising', label: 'Dogma Rising', subtitle: 'dogmarising.netlify.app · 新私服',
      url: 'https://dogmarising.netlify.app/.netlify/functions/status', type: 'single', site: boot.links.rising,
      links: [['官网', boot.links.rising], ['Live News（Discord 实时）', boot.links.risingNews],
              ['怎么玩', boot.links.risingHowToPlay], ['地图', boot.links.risingMap], ['Discord', boot.links.risingDiscord]] },
  ]
  if (boot.hosted){
    NOTES.unshift({ id: 'revival', label: 'DDON Revival', subtitle: 'live.ddon.org · 最大私服',
      url: '/api/revival', type: 'proxy', site: boot.links.revival,
      links: [['官网', boot.links.revival], ['排行榜', boot.links.revivalLeaderboard],
              ['官方 Wiki', boot.links.revivalWiki], ['怎么玩', boot.links.revivalHowToPlay]] })
  }
  /* 取不到时这张卡片仍然要出现（说明原因），所以单独记下它的位置 */
  var REVIVAL_INDEX = boot.hosted ? 0 : -1

  /* 资料与社区：不属于任何一台服务器，收在页面底部一行小链接里 */
  var RESOURCE_LINKS = [
    ['DDON-DPS研究所 Wiki（技能表来源）', boot.links.wiki],
    ['Nexus Mods', boot.links.mods],
  ]

  function legacyRows(payload){
    if (!Array.isArray(payload)) return []
    return payload.map(function(r){
      return { name: String(r.Name || 'World'), brief: String(r.Brief || '').trim(), players: Number(r.LoginNum) || 0,
               capacity: Number(r.MaxLoginNum) || 0, traffic: String(r.TrafficName || '').trim(),
               address: String(r.Addr || ''), port: Number(r.Port) || 0 }
    })
  }

  /** 一张卡片的链接行；没有链接就返回空串。 */
  function cardLinks(links){
    if (!links || links.length === 0) return ''
    var html = '<div class="chipRow">'
    for (var i = 0; i < links.length; i++){
      if (!links[i][1]) continue
      html += '<a class="chip" href="' + esc(links[i][1]) + '" target="_blank" rel="noreferrer">' + esc(links[i][0]) + ' ↗</a>'
    }
    return html + '</div>'
  }

  /** 一行「键 值」的元信息，与插件的 ddonHub_meta 同一版式。 */
  function metaRow(key, value){
    if (!value) return ''
    return '<div class="meta"><span class="metaKey">' + esc(key) + '</span><span>' + value + '</span></div>'
  }

  function renderLive(boxes){
    var html = ''
    for (var i = 0; i < boxes.length; i++){
      var b = boxes[i]
      /*
       * 卡片的链接行原样渲染，不做取舍。
       *
       * 这里曾经调用过 links.shift()，本意是"官网已经在副标题里出现了，别重复"。
       * 但那是渲染层替用户删数据——插件的每张卡片第一项就是官网，去掉反而少了一个入口。
       */
      var links = b.links || []

      html += '<div class="card" data-id="' + esc(b.id || '') + '"><div class="cardHead">'
      html += '<span class="cardName">' + esc(b.label) + '</span>'
      html += '<span class="cardSub">' + esc(b.subtitle || '') + '</span>'
      html += b.online === null ? '<span class="tag err">取不到</span>' : '<span class="tag ok">实时</span>'
      html += '</div>'

      if (b.online === null){
        html += '<div class="cardSub">' + esc(b.note || '读取失败') + '</div>'
      } else {
        html += '<div><span class="big">' + esc(String(b.online)) + '</span><span class="unit">人在线</span></div>'
        if (b.chips && b.chips.length > 0){
          html += '<div class="chipRow">'
          for (var k = 0; k < b.chips.length; k++) html += '<span class="barChip">' + b.chips[k] + '</span>'
          html += '</div>'
        }
        if (b.meta && b.meta.length > 0){
          for (var m = 0; m < b.meta.length; m++) html += metaRow(b.meta[m][0], b.meta[m][1])
        }
        if (b.note) html += metaRow(b.noteKey || '上游更新于', esc(b.note))
      }
      html += cardLinks(links)
      html += '</div>'
    }
    /*
     * Revival 卡片在两种模式下都要出现——早先网站版把它整张删了，结果看起来像
     * "少了一个私服、数据不全"。
     *
     * 网站版走 /api/revival 代理，能拿到数字（电脑版和插件也是服务端取数，不受 CORS 限制）；
     * 本地文件版没有服务端可用，只能直连，因此这张卡片用来说明取不到的原因。
     */
    if (REVIVAL_INDEX < 0){
      html += '<div class="card"><div class="cardHead">'
      html += '<span class="cardName">DDON Revival</span><span class="cardSub">live.ddon.org · 最大私服</span>'
      html += '<span class="tag warn">要用电脑版</span></div>'
      html += '<div class="cardSub">它的接口只允许自家网页读取（CORS），本页取不到。技能表不受影响，照常可查。</div>'
      html += cardLinks([['官网', boot.links.revival], ['排行榜', boot.links.revivalLeaderboard],
                         ['官方 Wiki', boot.links.revivalWiki], ['怎么玩', boot.links.revivalHowToPlay]])
      html += '</div>'
    }
    el('live').innerHTML = html
  }

  /**
   * 官方公告。
   *
   * 条目是构建时抓的快照（build/fetch-news.js），所以每条都带抓取时间，
   * 页面上也写明——电脑版和插件是运行时抓的，网站版做不到，得说清楚。
   */
  function renderNews(){
    var host = el('news')
    if (host === null) return
    var news = boot.news || { entries: [], errors: [], fetchedAt: '' }
    var entries = news.entries || []
    var html = '<div class="card">'
    html += '<div class="cardHead"><span class="cardName">官方公告</span>'
    html += '<span class="spacer" style="flex:1 1 auto"></span>'
    html += '<span class="cardSub">' + (news.fetchedAt ? new Date(news.fetchedAt).toLocaleDateString() + ' 抓取' : '') + '</span></div>'
    if (entries.length === 0){
      html += '<div class="cardSub">本次构建没有取到公告' + ((news.errors && news.errors.length > 0) ? '：' + esc(news.errors.join('；')) : '') + '。各服务器的入口在下面「私服在线」的卡片里。</div>'
    } else {
      html += '<div class="newsList">'
      for (var i = 0; i < entries.length; i++){
        var e = entries[i]
        html += '<a class="newsItem" href="' + esc(e.url) + '" target="_blank" rel="noreferrer">'
        html += '<span class="newsDate">' + esc(e.date || '') + '</span>'
        html += '<span class="newsSrc">' + esc(e.sourceLabel || '') + '</span>'
        html += '<span class="newsBody2"><b>' + esc(e.title || '') + '</b>'
        if (e.summary && e.summary !== e.title) html += '<span class="newsSum">' + esc(e.summary) + '</span>'
        html += '</span></a>'
      }
      html += '</div>'
    }
    html += '</div>'
    host.innerHTML = html
  }

  /*
   * 资料与社区。
   *
   * 各服务器自己的入口已经放进对应卡片的链接行（与电脑版、插件一致），
   * 所以这里只剩不属于任何一台服务器的两个：技能表的来源 wiki，和 Mod 站。
   * 它们落在页脚那一行，不再单独占一个区块。
   */
  function renderLinks(){
    var host = el('links')
    if (host === null) return
    var html = ''
    for (var i = 0; i < RESOURCE_LINKS.length; i++){
      if (!RESOURCE_LINKS[i][1]) continue
      if (html !== '') html += '　'
      html += '<a class="chip" href="' + esc(RESOURCE_LINKS[i][1]) + '" target="_blank" rel="noreferrer">' + esc(RESOURCE_LINKS[i][0]) + ' ↗</a>'
    }
    host.innerHTML = html
  }

  /* 各卡片共用的底：标签、副标题、官网链接组，取到数字后再补 chips / meta。 */
  function baseBox(n, note){
    return { id: n.id, label: n.label, subtitle: n.subtitle, online: null, links: n.links, site: n.site, note: note }
  }

  function fetchLive(){
    /*
     * 按 NOTES 的顺序收结果，不能按谁先返回谁排前面。
     *
     * 早先是 boxes.push(box)，于是卡片顺序取决于三个接口的响应速度——
     * 同一份页面刷新几次可能看到 Revival / Legacy / Dogma，也可能看到
     * Revival / Dogma / Legacy。用下标写入就固定了顺序。
     */
    var boxes = new Array(NOTES.length)
    var pending = NOTES.length
    renderLive(NOTES.map(function(n){ return baseBox(n, '读取中…') }))
    NOTES.forEach(function(n, index){
      var done = function(box){ boxes[index] = box; pending -= 1; if (pending === 0) renderLive(boxes.slice()) }
      fetch(n.url, { cache: 'no-store' }).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).then(function(payload){
        if (n.type === 'worlds'){
          var rows = legacyRows(payload)
          var total = rows.reduce(function(s, r){ return s + r.players }, 0)
          var box = baseBox(n)
          box.online = total
          /* 与插件同一版式：世界 / 服务器 / 负载 各一行 */
          box.meta = [
            ['世界', rows.map(function(r){
              return esc(r.name + r.brief.replace(/^World\s*/i, ' ')) + ' · ' + r.players + '/' + r.capacity + ' 人'
            }).join('　')],
          ]
          var first = rows[0]
          if (first && first.address){
            box.meta.push(['服务器', '<span class="mono">' + esc(first.address + (first.port ? ':' + first.port : '')) + '</span>'])
          }
          var traffic = rows.map(function(r){ return r.traffic }).filter(function(t){ return t !== '' })
          if (traffic.length > 0) box.meta.push(['负载', esc(traffic.join('　'))])
          done(box)
        } else if (n.type === 'proxy'){
          /* Worker 代理已经校验过形状，这里只取总数与各频道 */
          if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || '代理返回失败')
          var online = Number(payload.online)
          if (!isFinite(online)) throw new Error('代理返回里没有 online')
          var box2 = baseBox(n)
          box2.online = online
          box2.chips = (payload.channels || []).map(function(c){ return 'CH' + c.channel + ' <b>' + c.players + '</b>' })
          done(box2)
        } else {
          var online2 = Number(payload && payload.online)
          if (!isFinite(online2)) throw new Error('接口里没有 online 字段')
          var box3 = baseBox(n)
          box3.online = online2
          if (payload.updated) box3.note = payload.updated
          done(box3)
        }
      }).catch(function(e){
        /* 代理不可用时要说清原因：Revival 的接口只允许自家网页读取，这个页面靠
           服务端代理才拿得到；代理挂了就只剩浏览器直连，那必然被 CORS 拦。
           只显示一句 "HTTP 404" 看不出这层意思。 */
        var note = e.message
        if (n.type === 'proxy'){
          note = '取不到（' + e.message + '）——它的接口只允许自家网页读取，本页靠服务端代理取数'
        }
        var box4 = baseBox(n, note)
        box4.noteKey = n.type === 'proxy' ? '取数失败' : '读取失败'
        done(box4)
      })
    })
  }

  /* ------------------------------------------------------------ 编辑 */

  function beginEdit(host, current, onSave){
    if (state.editing !== null){ renderList() }
    state.editing = true
    var wrap = document.createElement('div')
    wrap.className = 'editing'
    var input = document.createElement('input')
    input.value = current
    input.setAttribute('enterkeyhint', 'done')
    var ok = document.createElement('button'); ok.textContent = '保存'
    var no = document.createElement('button'); no.textContent = '取消'
    wrap.appendChild(input); wrap.appendChild(ok); wrap.appendChild(no)
    host.innerHTML = ''
    host.appendChild(wrap)
    input.focus()
    var finished = false
    function finish(save){
      if (finished) return
      finished = true
      state.editing = null
      if (save) { onSave(input.value); saveStore() }
      renderList(); renderDetail()
    }
    ok.addEventListener('click', function(e){ e.stopPropagation(); finish(true) })
    no.addEventListener('click', function(e){ e.stopPropagation(); finish(false) })
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter'){ e.preventDefault(); finish(true) }
      else if (e.key === 'Escape'){ e.preventDefault(); finish(false) }
    })
  }

  function exportEdits(){
    var text = JSON.stringify(store, null, 2)
    var name = 'ddon-hub-notes-' + new Date().toISOString().slice(0, 10) + '.json'
    try {
      var blob = new Blob([text], { type: 'application/json' })
      var a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      toast('已导出 ' + name)
    } catch(e){
      toast('导出失败，可手动复制：' + text.slice(0, 120), true)
    }
  }

  function importEdits(file){
    var reader = new FileReader()
    reader.onload = function(){
      try {
        var parsed = JSON.parse(String(reader.result))
        store.notes = parsed.notes || {}
        store.cells = parsed.cells || {}
        saveStore(); renderList(); renderDetail(); renderFooter()
        toast('已导入 ' + editedCount() + ' 条改动')
      } catch(e){ toast('文件格式不对：' + e.message, true) }
    }
    reader.readAsText(file)
  }

  /* ------------------------------------------------------------ 事件 */

  document.addEventListener('click', function(event){
    var t = event.target
    var inEditor = t.closest && t.closest('.editing')
    /*
     * 正在编辑时，点到编辑框以外的地方应当关掉编辑框——但这**不能吃掉这次点击**。
     * 之前的写法在这里直接 return，于是关编辑框用掉了第一次点击，排序按钮要点两下才生效。
     * 现在只清状态，然后继续按点击目标正常处理。
     *
     * 注意：这段注释也在这个模板字符串里面，所以正文里不能出现反引号——
     * 一个反引号就会把 JS 提前闭合，生成出来的文件脚本全废。
     */
    if (state.editing !== null && !inEditor){ state.editing = null }

    /*
     * 职业标签和排序按钮都用 .job 这个类做样式。判断顺序很重要：
     * 排序按钮同样匹配 closest('.job')，所以必须先判排序——否则点排序会走到
     * 「切职业」那条分支里，列表看起来变了（其实换的是职业），排序和职业都不对。
     */
    var sortNode = t.closest ? t.closest('.sortChip') : null
    if (sortNode){ state.sort = sortNode.getAttribute('data-sort'); renderSort(); renderList(); return }

    /* 宽屏表格的表头也能点着排序，和上面的筛选按钮效果一样 */
    var thNode = t.closest ? t.closest('th.sortable') : null
    if (thNode){ state.sort = thNode.getAttribute('data-sort'); renderSort(); renderList(); return }

    var jobNode = t.closest ? t.closest('.job') : null
    if (jobNode){ state.job = jobNode.getAttribute('data-job'); state.selected = null; state.editing = null; renderJobs(); renderSort(); renderList(); renderDetail(); return }

    if (t.id === 'closeDetail'){
      /* 收起同样要补偿：详表缩回去会把被点的行往上顶 */
      var closingKey = state.selected === null ? null : state.selected.ja
      state.selected = null
      renderDetailKeeping(findSkillRow(closingKey))
      return
    }
    if (t.id === 'refresh'){ fetchLive(); toast('已刷新在线人数'); return }
    if (t.id === 'export'){ exportEdits(); return }

    /*
     * 备注：手机上点备注文字或下面那行提示，宽屏上点表格里那一格。
     * 两者的共同祖先是带 data-note 的元素——手机上它是 .skill 卡片，宽屏上是 <tr>，
     * 所以用 closest('[data-note]') 一次覆盖两种视图。
     */
    var card = t.closest ? t.closest('[data-note]') : null
    var hitNote = t.closest ? t.closest('.skillNote') : null
    var hitHint = t.closest ? t.closest('.noteHint') : null
    if ((hitNote || hitHint) && card){
      event.stopPropagation()
      var src = card.getAttribute('data-note') || ''
      if (src === ''){ toast('这条没有原文，无法作为键保存', true); return }
      var host = hitNote || card.querySelector('.skillName') || card
      var job = currentJob()
      var row = null
      for (var i = 0; i < (job.summaryRows || []).length; i++) if ((job.summaryRows[i].note || '') === src){ row = job.summaryRows[i]; break }
      beginEdit(host, row ? noteText(row) : '', function(value){
        if (value.trim() === '') delete store.notes[src]
        else store.notes[src] = value.trim()
        renderFooter()
      })
      return
    }

    var cellNode = t.closest ? t.closest('.kvVal.editable') : null
    if (cellNode){
      event.stopPropagation()
      var source = cellNode.getAttribute('data-cell') || ''
      var label = cellNode.getAttribute('data-label') || ''
      var skill = state.selected === null ? '' : state.selected.ja
      var job2 = currentJob()
      beginEdit(cellNode, cellNode.textContent.indexOf('待译') >= 0 ? '' : cellNode.textContent.replace(/改\s*$/, '').trim(), function(value){
        var key = cellKey(job2 ? job2.ja : '', skill, label, source)
        if (value.trim() === '') delete store.cells[key]
        else store.cells[key] = value.trim()
        renderFooter()
      })
      return
    }

    /*
     * 展开技能详表：手机点卡片，宽屏点表格行。
     *
     * 必须限定在技能区里。早先这里只写 closest('.skill, tbody tr')，而怪物图鉴
     * 的每一行也是 tbody tr —— 点图鉴行会被当成技能行，data-ja/data-zh 取回 null，
     * 于是选中一个空技能并调 renderDetail()，那个面板一 scrollIntoView 就把视口
     * 甩到页面底部（实测 0 -> 20249 px）。表现就是"点有的怪物会跳过头"。
     */
    var card2 = t.closest ? t.closest('#skills .skill, #skillsTable tbody tr') : null
    if (card2){
      var ja = card2.getAttribute('data-ja'), zh = card2.getAttribute('data-zh')
      /* 开和关都走补偿版：详表撑开/收起都会让这一行相对视口滑动 */
      if (state.selected !== null && state.selected.ja === ja && state.selected.zh === zh) state.selected = null
      else state.selected = { ja: ja, zh: zh }
      renderDetailKeeping(card2)
      return
    }
  })

  document.addEventListener('input', function(event){
    if (event.target.id === 'search'){ state.query = event.target.value; renderList() }
  })

  el('importFile').addEventListener('change', function(event){
    if (event.target.files && event.target.files[0]) importEdits(event.target.files[0])
    event.target.value = ''
  })

  function renderSort(){
    var chips = [['dps','DPS'],['mult','倍率'],['cast','技时间'],['name','名称']]
    var html = ''
    for (var i = 0; i < chips.length; i++){
      /* 独立的类名 sortChip：早期版本复用 .job，导致点击时被"切职业"那条分支先接走 */
      html += '<div class="job sortChip' + (state.sort === chips[i][0] ? ' on' : '') + '" data-sort="' + chips[i][0] + '">' + chips[i][1] + '</div>'
    }
    el('sort').innerHTML = html
  }

  function renderFooter(){
    var edited = editedCount()
    var text = edited === 0
      ? '改动存在这台手机的浏览器里，清缓存会丢。'
      : '已改 ' + edited + ' 条，存在这台手机的浏览器里。'
    el('editState').textContent = text
  }

  /* ------------------------------------------------------------ 启动 */

  loadStore()
  renderJobs()
  renderSort()
  renderList()
  renderNews()
  renderLinks()
  renderFooter()
  mountCodex()
  el('legend').textContent = boot.legend
  el('captured').textContent = '技能表 ' + boot.capturedAt + ' 抓取'
  fetchLive()
})()
`

/* ------------------------------------------------------------------ document */

/**
 * Generate one self-contained page.
 *
 * Two callers share this: `main()` writes the phone file, and
 * `build/make-web.js` writes the hosted variant with `hosted: true`. Keeping one
 * generator means the two builds cannot drift.
 *
 * The same markup serves both, with one responsive breakpoint: a card list on
 * narrow screens and a sortable table on wide ones. An earlier version rendered
 * cards unconditionally, which made the website look like a phone app on a
 * desktop.
 *
 * @param options.hosted - true when the page will be served from an http(s) origin.
 *   Only changes wording; the content is identical, Revival card included.
 */
function buildPage(options) {
  const hosted = options.hosted === true
  const boot = {
    jobs: SNAPSHOT.jobs,
    legend: LEGEND,
    capturedAt: manifest.capturedAt,
    defaultJob: SNAPSHOT.jobs.some((job) => job.zh === '獵人') ? '獵人' : SNAPSHOT.jobs[0].zh,
    counts: manifest.counts,
    links: LINKS,
    news: NEWS,
    hosted,
    /* 怪物图鉴：和技能表一样烘进页面，因为这份产物的定位就是「离线可用」。
       它是 boot 里唯一一块 ~250 KB 的数据，也正因如此手机版打开时不需要联网。 */
    codex: CODEX,
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14161a">
${
  /*
   * 这几个 meta 只对"存到手机里打开"有意义（Safari 的独立窗口与状态栏样式）。
   * 网站版不加：它是给浏览器打开的，带上这些会让 iOS 把它当成一个可安装的应用。
   * 标题同理——早先写死了"· 手机版"，网站版也照搬，浏览器标签上就一直显示手机版。
   */
  hosted
    ? '<title>DDON 资料站</title>'
    : '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<title>DDON 资料站 · 手机版</title>'
}
${ASSETS.favicon === null ? '' : `<link rel="icon" type="image/png" href="${ASSETS.favicon}">`}
${ASSETS.favicon === null || hosted ? '' : `<link rel="apple-touch-icon" href="${ASSETS.favicon}">`}
<style>${desktop.CSS}</style>
<style>${MOBILE_CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    ${ASSETS.crest === null ? '' : `<img class="crest" src="${ASSETS.crest}" alt="" width="26" height="26">`}
    <h1>DDON 资料站</h1>
    <span class="tag">${hosted ? '在线版 · 每次打开都是最新' : '手机版 · 离线可用'}</span>
    <span class="tag" id="captured"></span>
    <span class="spacer"></span>
    <button type="button" id="refresh">刷新人数</button>
  </header>

  <h2>官方公告</h2>
  <div class="grid" id="news"></div>

  <h2>私服在线</h2>
  <div class="grid" id="live"></div>

  <h2>怪物图鉴 · 出现地点与等级</h2>
  <input id="codexSearch" placeholder="查怪物或地点（中/日/英文，或 0x… 编号）">
  <div class="jobs" id="codexTabs"></div>
  <div class="toolbar"><span class="tag" id="codexMeta"></span></div>
  <div id="codexList"></div>
  <div id="codexTable" class="wideWrap"></div>

  <h2>职业技能数据</h2>
  <input id="search" placeholder="搜索技能名、中文名或备注">
  <div class="jobs" id="jobs"></div>
  <div class="toolbar"><span class="tag" id="jobMeta"></span></div>
  <div class="jobs" id="sort"></div>
  <div id="skills"></div>
  <div id="skillsTable" class="wideWrap"></div>
  <div id="detail"></div>

  <h2>你的改动</h2>
  <div class="card">
    <div class="cardSub" id="editState"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button type="button" id="export">导出一份</button>
      <label class="job" style="cursor:pointer">导入
        <input type="file" id="importFile" accept="application/json,.json" style="display:none">
      </label>
    </div>
  </div>

  <h2>记号说明</h2>
  <div class="card"><div class="cardSub" id="legend"></div></div>

  <div class="foot">
    <div class="footRow"><span>技能表</span><span>来自 <a href="${esc(LINKS.wiki)}" target="_blank" rel="noreferrer">DDON-DPS研究所 Wiki*</a>（wikiwiki.jp/blacktea）作者整理，抓取于 ${esc(manifest.capturedAt)}${
      hosted ? '，本站内容随作者更新，刷新页面即为最新。' : '，烘在本文件里，不会自动更新。'
    }</span></div>
    <div class="footRow"><span>译名</span><span>来自私服汉化包索引，非官方译名；版权归原汉化组所有。</span></div>
    <div class="footRow"><span>资料与社区</span><span id="links"></span></div>
    <div class="footRow"><span>在线人数</span><span>LegacyDDON 与 Dogma Rising 由你的浏览器直接读取；DDON Revival 的接口禁止跨站读取，本页取不到。</span></div>
    <div class="footRow"><span>你的改动</span><span>只存在你这台设备的浏览器里，不会上传，别人也看不到。</span></div>
    ${
      /*
       * 出处声明。早先这里写的是「请勿公开分发或用于商业用途」，隐含"这是私下传阅的东西"。
       * 用户否掉了那个立场：技能表来自公开 wiki、译名来自流传中的汉化包，**原始资料本就是公开的**，
       * 把整合结果藏起来没有根据。现在只保留署名与非商业声明，不再要求保密。
       */
      hosted
        ? '<div class="footRow"><span>出处与用途</span><span>非官方粉丝站点，与 Capcom 及任何私服运营方无关。技能表版权归 DDON-DPS研究所 Wiki* 作者，译名版权归原汉化组，本站只是整合与呈现。仅供学习交流，请勿用于商业用途。</span></div>'
        : '<div class="footRow"><span>本文件</span><span>完全离线，可存到手机里直接打开，不需要电脑、不需要联网。</span></div>'
    }
  </div>
</div>
<div class="toast" id="toast"></div>
<script id="boot" type="application/json">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script>${JS}</script>
</body>
</html>
`
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Check a generated page before it is written anywhere.
 *
 * The browser script is emitted through a template literal, so a stray backtick or
 * `${` inside it ends the literal early and produces a file whose markup renders
 * and whose script never runs — the page looks alive and does nothing. That
 * happened twice, so the parse check is part of generation, not a separate step.
 */
function checkPage(html, label) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  if (scripts.length < 2) throw new Error(`${label}: expected two inline script blocks, found ${scripts.length}`)
  scripts.forEach((body, index) => {
    try {
      if (/^\s*\{/.test(body)) JSON.parse(body)
      else new vm.Script(body, { filename: `${label}-inline-${index}.js` })
    } catch (error) {
      throw new Error(`${label}: inline script #${index} does not parse: ${error.message}`)
    }
  })

  const boot = JSON.parse(scripts[0])
  for (const key of ['jobs', 'links', 'legend', 'capturedAt', 'defaultJob', 'codex']) {
    if (boot[key] === undefined) throw new Error(`${label}: boot data is missing "${key}"`)
  }
  if (Object.keys(boot.links).length < 8) throw new Error(`${label}: the link table looks too small to be the real one`)
  if (!boot.codex.spots || boot.codex.spots.length < 100) {
    throw new Error(`${label}: the monster codex looks too small to be the real one`)
  }
  for (const id of ['live', 'links', 'jobs', 'skills', 'detail', 'sort', 'legend', 'editState',
                    'codexSearch', 'codexList', 'codexTable', 'codexMeta']) {
    if (!html.includes(`id="${id}"`)) throw new Error(`${label}: the page has no #${id} container`)
  }
  return boot
}

function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const html = buildPage({ hosted: false })
  const boot = checkPage(html, 'phone')
  fs.writeFileSync(OUT, html, 'utf8')
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
  console.log(`  ${path.basename(OUT)}  ${kb} KB`)
  console.log('  jobs: ' + SNAPSHOT.jobs.length + ', details: ' + manifest.counts.details + ', cells: ' + manifest.counts.cells)
  console.log('  codex: ' + CODEX.stats.monsters + ' 种怪物, ' + CODEX.stats.locations + ' 个地点, ' + CODEX.stats.spots + ' 条生成记录')
  console.log('  links: ' + Object.keys(boot.links).length + ', 内联脚本解析通过')
  console.log('  -> ' + OUT)
}

module.exports = { buildPage, checkPage, OUT }

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error('make-offline failed:', error && error.stack ? error.stack : error)
    process.exit(1)
  }
}
