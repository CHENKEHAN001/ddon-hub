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
`

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

  function renderSkills(){
    var job = currentJob()
    if (job === null){ el('skills').innerHTML = '<div class="empty">没有职业数据</div>'; return }
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

    var html = ''
    for (var i = 0; i < rows.length; i++){
      var r = rows[i]
      var shown = noteText(r)
      var isOpen = state.selected !== null && (state.selected.ja === r.ja || state.selected.zh === r.zh)
      var note = ''
      if (shown !== ''){
        note = esc(shown) + (r.noteEdited ? ' <span class="tag ok">改</span>' : '')
      } else if ((r.note || '') !== ''){
        note = '<span class="pending">待译</span>'
      }
      html += '<div class="skill' + (isOpen ? ' on' : '') + '" data-ja="' + esc(r.ja) + '" data-zh="' + esc(r.zh) + '" data-note="' + esc(r.note || '') + '">'
      html += '<div class="skillName">' + esc(r.zh || r.ja) + '<span class="ja">' + esc(r.ja) + '</span></div>'
      html += '<div class="skillNums">'
      html += '<span class="numChip">DPS <b>' + esc(r.dps || '—') + '</b></span>'
      html += '<span class="numChip">倍率 <b>' + esc(r.mult || '—') + '</b></span>'
      var secs = firstNumber(r.cast)
      html += '<span class="numChip">技时间 <b>' + (secs === null ? esc(r.cast || '—') : fmt(secs, 2) + 's') + '</b></span>'
      html += '</div>'
      if (note !== '') html += '<div class="skillNote">' + note + '</div>'
      if ((r.note || '') !== '') html += '<div class="noteHint">点这里可改备注</div>'
      html += '</div>'
    }
    el('skills').innerHTML = rows.length === 0 ? '<div class="empty">没有匹配的技能</div>' : html
    el('jobMeta').textContent = job.zh + ' · ' + rows.length + ' 行 · 详表 ' + (job.details || []).length + ' 张'
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

  var NOTES = [
    { id: 'legacy', label: 'LegacyDDON', url: 'https://legacyddon.com/rpc/status', type: 'worlds', site: boot.links.legacy },
    { id: 'rising', label: 'Dogma Rising', url: 'https://dogmarising.netlify.app/.netlify/functions/status', type: 'single', site: boot.links.rising },
  ]

  function legacyRows(payload){
    if (!Array.isArray(payload)) return []
    return payload.map(function(r){
      return { name: String(r.Name || 'World'), brief: String(r.Brief || '').trim(), players: Number(r.LoginNum) || 0, capacity: Number(r.MaxLoginNum) || 0 }
    })
  }

  function renderLive(boxes){
    var html = ''
    for (var i = 0; i < boxes.length; i++){
      var b = boxes[i]
      html += '<div class="card"><div class="cardHead"><span class="cardName">' + esc(b.label) + '</span>'
      html += '<span class="spacer" style="flex:1 1 auto"></span>'
      html += b.online === null ? '<span class="tag err">取不到</span>' : '<span class="tag ok">实时</span>'
      html += '</div>'
      if (b.online === null){
        html += '<div class="cardSub">' + esc(b.note || '读取失败') + '</div>'
      } else {
        html += '<div><span class="big">' + esc(String(b.online)) + '</span><span class="unit">人在线</span></div>'
        if (b.bars && b.bars.length > 0){
          html += '<div class="bars">'
          for (var k = 0; k < b.bars.length; k++) html += '<span class="bar">' + esc(b.bars[k]) + '</span>'
          html += '</div>'
        }
        if (b.note) html += '<div class="cardSub">' + esc(b.note) + '</div>'
      }
      if (b.url) html += '<div class="cardSub" style="margin-top:6px"><a href="' + esc(b.url) + '" target="_blank" rel="noreferrer">打开官网 ↗</a></div>'
      html += '</div>'
    }
    /*
     * Revival 的接口只允许自家网页读取（CORS），任何第三方页面都取不到它的数字。
     * 本机文件版保留一张说明卡；托管版干脆不显示——在公网上给一个永远取不到数据的
     * 卡片没有意义，链接已经在「官网入口」里了。
     */
    if (boot.includeRevival){
      html += '<div class="card"><div class="cardHead"><span class="cardName">DDON Revival</span>'
      html += '<span class="spacer" style="flex:1 1 auto"></span><span class="tag warn">要用电脑版</span></div>'
      html += '<div class="cardSub">它的接口只允许自家网页读取（CORS），本页取不到。'
      html += '技能表不受影响，照常可查。</div>'
      html += '<div class="cardSub" style="margin-top:6px"><a href="' + esc(boot.links.revival) + '" target="_blank" rel="noreferrer">打开官网 ↗</a>'
      html += '　<a href="' + esc(boot.links.revivalWiki) + '" target="_blank" rel="noreferrer">官方 Wiki</a>'
      html += '　<a href="' + esc(boot.links.revivalHowToPlay) + '" target="_blank" rel="noreferrer">怎么玩</a></div>'
      html += '</div>'
    }
    el('live').innerHTML = html
  }

  /* 官网入口：三台私服各一行，外加 Discord 与 wiki。
     手机版取不到公号，所以对这些站点的入口只能靠链接。 */
  function renderLinks(){
    var groups = [
      { name: 'DDON Revival', items: [
        ['官网', boot.links.revival], ['排行榜', boot.links.revivalLeaderboard],
        ['官方 Wiki', boot.links.revivalWiki], ['怎么玩', boot.links.revivalHowToPlay],
      ] },
      { name: 'LegacyDDON', items: [
        ['官网', boot.links.legacy], ['公告', boot.links.legacyNews], ['地图', boot.links.legacyMap],
        ['物品检索', boot.links.legacyItemSearch], ['板任务', boot.links.legacyBoardQuests],
      ] },
      { name: 'Dogma Rising', items: [
        ['官网', boot.links.rising], ['Live News（Discord）', boot.links.risingNews],
        ['怎么玩', boot.links.risingHowToPlay], ['地图', boot.links.risingMap], ['Discord', boot.links.risingDiscord],
      ] },
      { name: '资料与社区', items: [
        ['DDON-DPS研究所 Wiki（技能表来源）', boot.links.wiki],
        ['Mod（Nexus）', boot.links.mods],
      ] },
    ]
    var html = ''
    for (var i = 0; i < groups.length; i++){
      var g = groups[i]
      html += '<div class="card"><div class="cardHead"><span class="cardName">' + esc(g.name) + '</span></div>'
      html += '<div class="links">'
      for (var k = 0; k < g.items.length; k++){
        if (!g.items[k][1]) continue
        html += '<a href="' + esc(g.items[k][1]) + '" target="_blank" rel="noreferrer">' + esc(g.items[k][0]) + ' ↗</a>'
      }
      html += '</div></div>'
    }
    el('links').innerHTML = html
  }

  function fetchLive(){
    var boxes = []
    var pending = NOTES.length
    renderLive(NOTES.map(function(n){ return { label: n.label, online: null, note: '读取中…' } }))
    NOTES.forEach(function(n){
      var done = function(box){ boxes.push(box); pending -= 1; if (pending === 0) renderLive(boxes.slice()) }
      fetch(n.url, { cache: 'no-store' }).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).then(function(payload){
        if (n.type === 'worlds'){
          var rows = legacyRows(payload)
          var total = rows.reduce(function(s, r){ return s + r.players }, 0)
          done({ label: n.label, online: total, bars: rows.map(function(r){ return r.name + r.brief.replace(/^World\s*/i, ' ') + ' ' + r.players + '/' + r.capacity }) })
        } else {
          var online = Number(payload && payload.online)
          if (!isFinite(online)) throw new Error('接口里没有 online 字段')
          done({ label: n.label, online: online, note: payload.updated ? '上游更新于 ' + payload.updated : '' })
        }
      }).catch(function(e){
        done({ label: n.label, online: null, note: e.message + '（离线打开时属正常）' })
      })
    })
  }

  /* ------------------------------------------------------------ 编辑 */

  function beginEdit(host, current, onSave){
    if (state.editing !== null){ renderSkills(); renderDetail() }
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
      renderSkills(); renderDetail()
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
        saveStore(); renderSkills(); renderDetail(); renderFooter()
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
    if (sortNode){ state.sort = sortNode.getAttribute('data-sort'); renderSort(); renderSkills(); return }

    var jobNode = t.closest ? t.closest('.job') : null
    if (jobNode){ state.job = jobNode.getAttribute('data-job'); state.selected = null; state.editing = null; renderJobs(); renderSort(); renderSkills(); renderDetail(); return }

    if (t.id === 'closeDetail'){ state.selected = null; renderDetail(); renderSkills(); return }
    if (t.id === 'refresh'){ fetchLive(); toast('已刷新在线人数'); return }
    if (t.id === 'export'){ exportEdits(); return }

    /* 备注：点备注文字或下面那行提示都能进编辑。
       提示行和备注文字是兄弟节点，所以要显式找到要替换成编辑框的那个元素。 */
    var card = t.closest ? t.closest('.skill') : null
    var hitNote = t.closest ? t.closest('.skillNote') : null
    var hitHint = t.closest ? t.closest('.noteHint') : null
    if ((hitNote || hitHint) && card){
      event.stopPropagation()
      var src = card.getAttribute('data-note') || ''
      if (src === ''){ toast('这条没有原文，无法作为键保存', true); return }
      var host = hitNote || card.querySelector('.skillNote') || card.querySelector('.skillName')
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

    var card2 = t.closest ? t.closest('.skill') : null
    if (card2){
      var ja = card2.getAttribute('data-ja'), zh = card2.getAttribute('data-zh')
      if (state.selected !== null && state.selected.ja === ja && state.selected.zh === zh) state.selected = null
      else state.selected = { ja: ja, zh: zh }
      renderSkills(); renderDetail()
      return
    }
  })

  document.addEventListener('input', function(event){
    if (event.target.id === 'search'){ state.query = event.target.value; renderSkills() }
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
  renderSkills()
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
 * `build/make-web.js` writes the hosted variant with `hosted: true` and without
 * the Revival card (see below). Keeping one generator means the two builds cannot
 * drift.
 *
 * @param options.hosted - true when the page will be served from an http(s) origin.
 * @param options.includeRevival - false to omit the Revival card entirely.
 */
function buildPage(options) {
  const hosted = options.hosted === true
  const includeRevival = options.includeRevival !== false
  const boot = {
    jobs: SNAPSHOT.jobs,
    legend: LEGEND,
    capturedAt: manifest.capturedAt,
    defaultJob: SNAPSHOT.jobs.some((job) => job.zh === '獵人') ? '獵人' : SNAPSHOT.jobs[0].zh,
    counts: manifest.counts,
    links: LINKS,
    hosted,
    includeRevival,
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14161a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>DDON 资料站 · 手机版</title>
${ASSETS.favicon === null ? '' : `<link rel="icon" type="image/png" href="${ASSETS.favicon}">`}
${ASSETS.favicon === null ? '' : `<link rel="apple-touch-icon" href="${ASSETS.favicon}">`}
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

  <h2>官方公告 / 官网入口</h2>
  <div class="grid" id="live"></div>
  <div class="grid" id="links"></div>

  <h2>职业技能数据</h2>
  <input id="search" placeholder="搜索技能名、中文名或备注">
  <div class="jobs" id="jobs"></div>
  <div class="toolbar"><span class="tag" id="jobMeta"></span></div>
  <div class="jobs" id="sort"></div>
  <div id="skills"></div>
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
    <div class="footRow"><span>在线人数</span><span>LegacyDDON 与 Dogma Rising 由你的浏览器直接读取${
      includeRevival ? '；DDON Revival 的接口禁止跨站读取，本页取不到。' : '。'
    }</span></div>
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
  const html = buildPage({ hosted: false, includeRevival: true })
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
