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
/* 官网入口：一行一个，触摸目标够大 */
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
  .wideWrap{display:block}
  .jobs{gap:5px;margin:6px 0 10px}
  .job{padding:3px 12px;min-height:26px;font-size:12.5px}
  #search{width:240px!important;margin-top:0}
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
  var state = { job: boot.defaultJob, query: '', sort: 'dps', selected: null, hub: null, editing: null }

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
    var node = el('detail')
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'start', behavior: 'smooth' })
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

      html += '<div class="card"><div class="cardHead">'
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
      html += '<div class="cardSub">本次构建没有取到公告' + ((news.errors && news.errors.length > 0) ? '：' + esc(news.errors.join('；')) : '') + '。入口在下面的「官网入口」里。</div>'
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
    return { label: n.label, subtitle: n.subtitle, online: null, links: n.links, site: n.site, note: note }
  }

  function fetchLive(){
    var boxes = []
    var pending = NOTES.length
    renderLive(NOTES.map(function(n){ return baseBox(n, '读取中…') }))
    NOTES.forEach(function(n){
      var done = function(box){ boxes.push(box); pending -= 1; if (pending === 0) renderLive(boxes.slice()) }
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

    if (t.id === 'closeDetail'){ state.selected = null; renderDetail(); renderList(); return }
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

    /* 展开详表：手机点卡片，宽屏点表格行 */
    var card2 = t.closest ? t.closest('.skill, tbody tr') : null
    if (card2){
      var ja = card2.getAttribute('data-ja'), zh = card2.getAttribute('data-zh')
      if (state.selected !== null && state.selected.ja === ja && state.selected.zh === zh) state.selected = null
      else state.selected = { ja: ja, zh: zh }
      renderList(); renderDetail()
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
      hosted
        ? '<div class="footRow"><span>出处与用途</span><span>本项目只是把公开资料整合成一个方便查阅的界面，仅供学习交流，请勿用于商业用途。如权利人认为不妥，请联系删除。</span></div>'
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
  for (const key of ['jobs', 'links', 'legend', 'capturedAt', 'defaultJob']) {
    if (boot[key] === undefined) throw new Error(`${label}: boot data is missing "${key}"`)
  }
  if (Object.keys(boot.links).length < 8) throw new Error(`${label}: the link table looks too small to be the real one`)
  for (const id of ['live', 'links', 'jobs', 'skills', 'detail', 'sort', 'legend', 'editState']) {
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
