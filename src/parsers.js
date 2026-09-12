/**
 * Parsing rules for the two status APIs and the two news pages.
 *
 * These are copies of the functions the DSH plugin uses. The exe cannot import
 * the plugin — recipients do not have it installed — so the rules have to travel
 * with this project. `build/sync-check.js` compares each function against its
 * counterpart in `lib/index.js` character for character and fails the build when
 * they differ, so the copies cannot drift silently. When that check fails, copy
 * the plugin's version over the one here rather than editing both.
 *
 * Copied from: dsh-plugin-ddon-hub/lib/index.js
 * Functions:   textOf, normalizeDate, parseNews, parseRevivalChannels, parseLegacyWorlds
 */
'use strict'

/* --------------------------------------------------------------- scraping */

/** Strip tags and collapse whitespace. */
function textOf(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** One date label out of a news item, normalized to `YYYY-MM-DD` when possible. */
function normalizeDate(label) {
  const raw = textOf(label)
  const iso = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(raw)
  if (iso !== null) {
    return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
  }
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const en = /([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(raw)
  if (en !== null) {
    const month = months.indexOf(en[1].toLowerCase())
    if (month >= 0) return `${en[3]}-${String(month + 1).padStart(2, '0')}-${String(en[2]).padStart(2, '0')}`
  }
  return ''
}

/**
 * Pull a news feed out of a server landing page.
 *
 * Two markup shapes are handled, because the two sites differ:
 *
 *   - LegacyDDON publishes `<a class="news-clipping" href="/news/...">` cards
 *     holding `<time datetime="…">`, `<h3 class="news-headline">` and
 *     `<p class="news-body">`. The `datetime` attribute is authoritative, the
 *     three fields are distinct, and that shape is parsed first.
 *   - DDON Revival has no news markup at all beyond a section heading, so the
 *     generic anchor pass runs as well: an anchor is a story only when it
 *     carries a date of its own. That rule is what drops the section label
 *     (`<a href="#news">News</a>`) instead of showing it as a headline.
 *
 * Entries are keyed by resolved URL so a card is never listed twice, and a
 * card that repeats its headline in the body shows it once.
 */
function parseNews(html, base, source) {
  const byUrl = new Map()
  /** URLs a structured card already claimed; the generic pass must not shadow those. */
  const structured = new Set()
  const add = (raw) => {
    let url
    try {
      url = new URL(raw.href, base).toString()
    } catch {
      return
    }
    const previous = byUrl.get(url)
    if (previous === undefined || previous.title.length < raw.title.length) {
      byUrl.set(url, {
        source: source.id,
        sourceLabel: source.label,
        date: raw.date,
        title: raw.title,
        summary: raw.summary,
        url,
      })
    }
  }

  /* --- shape 1: LegacyDDON news cards ------------------------------------ */
  const card = /<a\b[^>]*class\s*=\s*["'][^"']*news-clipping[^"']*["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const cardHrefFirst = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["'][^"']*news-clipping[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
  const scanCards = (pattern) => {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const href = match[1]
      const body = match[2]
      const time = /<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/i.exec(body)
      const headline = /<h3\b[^>]*class\s*=\s*["'][^"']*news-headline[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(body)
      const summary = /<p\b[^>]*class\s*=\s*["'][^"']*news-body[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(body)
      const date = time !== null ? normalizeDate(time[1]) : normalizeDate(textOf(body))
      const title = headline !== null ? textOf(headline[1]) : ''
      /* The card owns this URL even when it turns out to be unusable: a raw
         anchor over the same URL would only glue headline and body together. */
      try {
        structured.add(new URL(href, base).toString())
      } catch {
        continue
      }
      if (date === '' || title === '') continue
      add({ href, date, title, summary: summary === null ? '' : textOf(summary[1]) })
    }
  }
  scanCards(card)
  scanCards(cardHrefFirst)

  /* --- shape 2: any dated anchor not already covered by a card ----------- */
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = anchor.exec(html)) !== null) {
    const href = match[1].trim()
    /* An in-page anchor is a section label, not a story. */
    if (href.startsWith('#')) continue
    if (!/\/news\/|[?&]news=/i.test(href)) continue
    let resolved
    try {
      resolved = new URL(href, base).toString()
    } catch {
      continue
    }
    /* A card already described this story in full; a raw anchor body would only
       glue headline and body back together. */
    if (structured.has(resolved)) continue
    const raw = textOf(match[2])
    const dateMatch = /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|[A-Z][a-z]+\s+\d{1,2},\s*\d{4})/.exec(raw)
    const date = normalizeDate(dateMatch === null ? '' : dateMatch[1])
    /* Undated anchors are navigation, not news. */
    if (date === '') continue
    let title = raw.replace(textOf(dateMatch[1]), ' ').replace(/\s+/g, ' ').trim()
    if (title === '' || title.length > 220) continue
    /* A card-style anchor repeats its own headline before the body: keep one. */
    const doubled = /^(.{8,}?)\s*\1$/.exec(title)
    if (doubled !== null) title = doubled[1].trim()
    add({ href, date, title, summary: doubled === null ? title : '' })
  }

  const entries = [...byUrl.values()]
  entries.sort((left, right) => String(right.date).localeCompare(String(left.date)))
  return entries
}

/* ------------------------------------------------------------- live status */

/** One Revival channel row: `{ server_id, players }` with players as a string. */
function parseRevivalChannels(payload) {
  if (!Array.isArray(payload)) return []
  return payload
    .map((row) => ({
      channel: Number.parseInt(String(row?.server_id ?? ''), 10),
      players: Number.parseInt(String(row?.players ?? ''), 10),
    }))
    .filter((row) => Number.isFinite(row.channel) && Number.isFinite(row.players) && row.players >= 0)
}

/** One Legacy world row, flattened to the fields the panel shows. */
function parseLegacyWorlds(payload) {
  if (!Array.isArray(payload)) return []
  return payload
    .map((row) => ({
      id: Number.parseInt(String(row?.Id ?? ''), 10),
      name: typeof row?.Name === 'string' ? row.Name : 'World',
      brief: typeof row?.Brief === 'string' ? row.Brief.trim() : '',
      players: Number.parseInt(String(row?.LoginNum ?? ''), 10),
      capacity: Number.parseInt(String(row?.MaxLoginNum ?? ''), 10),
      traffic: typeof row?.TrafficName === 'string' ? row.TrafficName : '',
      address: typeof row?.Addr === 'string' ? row.Addr : '',
      port: Number.parseInt(String(row?.Port ?? ''), 10),
      rpcPort: Number.parseInt(String(row?.RpcPort ?? ''), 10),
      preventLogin: row?.PreventLogin === true,
    }))
    .filter((row) => Number.isFinite(row.players))
}

module.exports = { textOf, normalizeDate, parseNews, parseRevivalChannels, parseLegacyWorlds }
