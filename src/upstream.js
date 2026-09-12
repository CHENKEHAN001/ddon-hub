/**
 * Data layer for the portable build.
 *
 * The parsing rules (channel payload → per-channel rows, world payload → per-world
 * rows, news HTML → dated cards) live in `./parsers.js`: copies of the DSH plugin's
 * functions, kept honest by `build/sync-check.js`, which compares them character
 * for character and fails the build when they drift.
 *
 * They must be copies. An earlier version imported the plugin's module at runtime
 * by absolute path, which works on the machine that has the plugin installed and
 * fails everywhere else — the exe shipped with a hard dependency on
 * `~/.dsh/plugins/...` and reported "Cannot find module" for every recipient.
 *
 * Only fetching and caching live here, because the exe has its own cache lifetime
 * and must keep working when an upstream is slow or unreachable.
 *
 * Skills come from `data.js`, baked at build time; nothing about them is fetched.
 */
'use strict'

const path = require('node:path')
const { SNAPSHOT, LEGEND, PROVENANCE } = require('./data.js')
const { parseRevivalChannels, parseLegacyWorlds, parseNews } = require('./parsers.js')

/** Upstream endpoints. The status APIs are public and need no credentials. */
const CONFIG = {
  revivalStatusUrl: 'https://api.ddon.org/api/channel-status',
  legacyStatusUrl: 'https://legacyddon.com/rpc/status',
  /**
   * Dogma Rising is a Netlify-hosted private server. Its player count comes from a
   * Netlify function and is a different shape from the other two: a single object
   * (`{ online, updated }`) rather than a list of channels or worlds. It is also
   * the only one that sends `access-control-allow-origin: *`, but the count is
   * still fetched server-side so all three cards behave the same way.
   */
  risingStatusUrl: 'https://dogmarising.netlify.app/.netlify/functions/status',
  risingSiteUrl: 'https://dogmarising.netlify.app/',
  newsSources: [
    { id: 'revival', label: 'DDON Revival', url: 'https://live.ddon.org/' },
    { id: 'legacy', label: 'LegacyDDON', url: 'https://legacyddon.com/' },
  ],
  links: {
    revival: 'https://live.ddon.org/',
    revivalLeaderboard: 'https://live.ddon.org/leaderboard.html',
    revivalWiki: 'https://live.ddon.org/wiki.html',
    revivalHowToPlay: 'https://live.ddon.org/howtoplay.html',
    legacy: 'https://legacyddon.com/',
    legacyNews: 'https://legacyddon.com/news',
    legacyMap: 'https://legacyddon.com/map',
    legacyItemSearch: 'https://legacyddon.com/itemsearch',
    legacyBoardQuests: 'https://legacyddon.com/boardquests',
    /* 与插件面板同一份链接表；日文 wiki 是这个私服自己的，公告入口另有 legacyNews */
    legacyJpWiki: 'https://wiki.legacyddon.com/jpwiki',
    legacyDiscord: 'https://discord.gg/ezxtdqfeQ6',
    rising: 'https://dogmarising.netlify.app/',
    risingNews: 'https://dogmarising.netlify.app/discord-live-news',
    risingHowToPlay: 'https://dogmarising.netlify.app/howtoplay',
    risingMap: 'https://dogmarising.netlify.app/map-selection',
    risingDiscord: 'https://discord.gg/dogmarising',
    /* Where the skill data itself comes from, plus the mod index. Listed so the
       offline phone build can offer entrances to the sources — it has no scraped
       news to show, so links are its only way out. */
    wiki: 'https://wikiwiki.jp/blacktea/',
    mods: 'https://www.nexusmods.com/games/dragonsdogmaonline',
  },
  /** Status is live data, so it is re-read often. */
  statusTtlMs: 20000,
  /** News changes a few times a month. */
  newsTtlMs: 300000,
  timeoutMs: 12000,
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

/* ------------------------------------------------------------------ fetching */

/** One HTTP GET with a hard timeout; never throws, reports failure as data. */
function getText(url, timeoutMs, accept) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    /*
     * Pick the transport from the URL. Both current upstreams are https, but
     * hard-coding the https module means an http URL fails with "Protocol http:
     * not supported" — a confusing error that looks like the site is down.
     */
    let parsed
    try {
      parsed = new URL(url)
    } catch (error) {
      finish({ ok: false, status: 0, text: '', error: '地址无法解析：' + error.message })
      return
    }
    const transport = parsed.protocol === 'http:' ? require('node:http') : require('node:https')
    const request = transport.get(
      url,
      {
        headers: {
          'user-agent': UA,
          accept: accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
        },
      },
      (response) => {
        // Follow one redirect; both sites are stable, so a chain means something changed.
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          const next = new URL(response.headers.location, url).href
          getText(next, timeoutMs, accept).then(finish)
          return
        }
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          finish({ ok: response.statusCode === 200, status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('timeout'))
    })
    request.on('error', (error) => finish({ ok: false, status: 0, text: '', error: error.message }))
  })
}

/* ------------------------------------------------------------------- caching */

/** A cache slot: last good value, when it was read, and the last failure. */
function slot() {
  return { value: undefined, at: 0, error: undefined, http: undefined, failedAt: 0, inflight: null }
}

const cache = { revival: slot(), legacy: slot(), rising: slot(), news: slot() }

/**
 * How long a failure is remembered.
 *
 * Without this, an unreachable upstream is retried on every request, and since
 * the page polls every 30 seconds the result is a request that blocks for the full
 * timeout each time. On a network that cannot reach one of the two hosts that
 * reads as "the page is always slow". A short failure memory keeps the retry
 * cadence sane while still recovering quickly once the network comes back.
 */
const FAILURE_TTL_MS = 60000

/**
 * Read through a cache slot.
 *
 * A failed refresh keeps the previous value and only records the error, so the
 * page keeps showing the last known numbers when a server is briefly down or the
 * network blocks one of the two upstreams.
 */
function through(entry, load, ttlMs, force) {
  const age = Date.now() - entry.at
  if (!force && entry.value !== undefined && age < ttlMs) {
    return Promise.resolve({ value: entry.value, at: entry.at, stale: false, error: entry.error, http: entry.http })
  }
  /* A recent failure short-circuits: report it instead of blocking again. */
  if (!force && entry.value === undefined && entry.failedAt !== 0 && Date.now() - entry.failedAt < FAILURE_TTL_MS) {
    return Promise.resolve({ value: undefined, at: entry.at, stale: false, error: entry.error, http: entry.http, backedOff: true })
  }
  if (entry.inflight !== null) return entry.inflight
  entry.inflight = load()
    .then((result) => {
      if (result.value !== undefined) {
        entry.value = result.value
        entry.at = Date.now()
        entry.error = undefined
        entry.failedAt = 0
      } else {
        entry.error = result.error
        entry.failedAt = Date.now()
      }
      entry.http = result.http
      return { value: entry.value, at: entry.at, stale: entry.value !== undefined && result.value === undefined, error: entry.error, http: entry.http }
    })
    .catch((error) => {
      entry.error = String(error && error.message)
      entry.failedAt = Date.now()
      return { value: entry.value, at: entry.at, stale: true, error: entry.error, http: undefined }
    })
    .finally(() => {
      entry.inflight = null
    })
  return entry.inflight
}

/* ------------------------------------------------------------------ loaders */

async function loadRevival(force) {
  return through(
    cache.revival,
    async () => {
      const response = await getText(CONFIG.revivalStatusUrl, CONFIG.timeoutMs, 'application/json')
      if (!response.ok) return { value: undefined, error: response.error || `HTTP ${response.status}`, http: response.status }
      const channels = parseRevivalChannels(JSON.parse(response.text))
      return {
        value: {
          channels,
          online: channels.reduce((sum, row) => sum + row.players, 0),
          channelCount: channels.length,
        },
        http: response.status,
      }
    },
    CONFIG.statusTtlMs,
    force,
  )
}

async function loadLegacy(force) {
  return through(
    cache.legacy,
    async () => {
      const response = await getText(CONFIG.legacyStatusUrl, CONFIG.timeoutMs, 'application/json')
      if (!response.ok) return { value: undefined, error: response.error || `HTTP ${response.status}`, http: response.status }
      const worlds = parseLegacyWorlds(JSON.parse(response.text))
      return {
        value: {
          worlds,
          online: worlds.reduce((sum, row) => sum + row.players, 0),
          capacity: worlds.reduce((sum, row) => sum + (Number.isFinite(row.capacity) ? row.capacity : 0), 0),
          address: worlds.length > 0 ? worlds[0].address : '',
          port: worlds.length > 0 ? worlds[0].port : undefined,
        },
        http: response.status,
      }
    },
    CONFIG.statusTtlMs,
    force,
  )
}

/**
 * Dogma Rising's player count.
 *
 * Its payload is a single object (`{ online, updated }`), not a list, so it does
 * not go through the shared parsers. The value is validated rather than trusted:
 * a missing or non-numeric `online` is reported as an error, because a card that
 * silently shows 0 is worse than one that says why it has no number.
 */
async function loadRising(force) {
  return through(
    cache.rising,
    async () => {
      const response = await getText(CONFIG.risingStatusUrl, CONFIG.timeoutMs, 'application/json')
      if (!response.ok) return { value: undefined, error: response.error || `HTTP ${response.status}`, http: response.status }
      let payload
      try {
        payload = JSON.parse(response.text)
      } catch (error) {
        return { value: undefined, error: '返回的不是 JSON', http: response.status }
      }
      const online = Number(payload && payload.online)
      if (!Number.isFinite(online) || online < 0) {
        return { value: undefined, error: '接口里没有 online 字段', http: response.status, upstream: response.text.slice(0, 200) }
      }
      return {
        value: {
          online,
          reportedAt: typeof payload.updated === 'string' ? payload.updated : '',
        },
        http: response.status,
      }
    },
    CONFIG.statusTtlMs,
    force,
  )
}

async function loadNews(force) {
  return through(
    cache.news,
    async () => {
      const results = await Promise.all(
        CONFIG.newsSources.map(async (source) => {
          const response = await getText(source.url, CONFIG.timeoutMs)
          if (!response.ok) return { source, error: response.error || `HTTP ${response.status}`, entries: [] }
          return { source, entries: parseNews(response.text, source.url, source) }
        }),
      )
      const groups = results
        .filter((row) => row.entries.length > 0)
        .map((row) => ({ id: row.source.id, label: row.source.label, url: row.source.url, entries: row.entries.slice(0, 6) }))
      const errors = results.filter((row) => row.entries.length === 0).map((row) => `${row.source.label}: ${row.error || '未取到条目'}`)
      if (groups.length === 0) return { value: undefined, error: errors.join('；') || '三个来源都没有新闻' }
      return { value: { groups, errors }, http: 200 }
    },
    CONFIG.newsTtlMs,
    force,
  )
}

/* -------------------------------------------------------------------- payload */

/** Server cards, shaped exactly like the DSH payload so the UI reads one format. */
function serverCards(revival, legacy, rising) {
  const revivalDetail = revival.value === undefined ? null : { channels: revival.value.channels, channelCount: revival.value.channelCount }
  const legacyDetail =
    legacy.value === undefined
      ? null
      : { worlds: legacy.value.worlds, capacity: legacy.value.capacity, address: legacy.value.address, port: legacy.value.port }
  return [
    {
      id: 'revival',
      label: 'DDON Revival',
      subtitle: 'live.ddon.org',
      url: CONFIG.links.revival,
      live: revival.value !== undefined,
      stale: revival.stale === true,
      error: revival.error ?? null,
      online: revival.value === undefined ? null : revival.value.online,
      at: revival.at || null,
      detail: revivalDetail,
    },
    {
      id: 'legacy',
      label: 'LegacyDDON',
      subtitle: 'legacyddon.com',
      url: CONFIG.links.legacy,
      live: legacy.value !== undefined,
      stale: legacy.stale === true,
      error: legacy.error ?? null,
      online: legacy.value === undefined ? null : legacy.value.online,
      at: legacy.at || null,
      detail: legacyDetail,
    },
    {
      id: 'rising',
      label: 'Dogma Rising',
      subtitle: 'dogmarising.netlify.app',
      url: CONFIG.links.rising,
      live: rising.value !== undefined,
      stale: rising.stale === true,
      error: rising.error ?? null,
      online: rising.value === undefined ? null : rising.value.online,
      at: rising.at || null,
      /* No per-channel breakdown exists upstream, so the card carries links
         instead: this server's news is a Discord feed rendered by a third-party
         widget, which cannot be read server-side. */
      detail: null,
      reportedAt: rising.value === undefined ? null : rising.value.reportedAt || null,
      extraLinks: [
        { label: 'Live News（Discord 实时）', url: CONFIG.links.risingNews },
        { label: 'Discord', url: CONFIG.links.risingDiscord },
        { label: '怎么玩', url: CONFIG.links.risingHowToPlay },
      ],
    },
  ]
}

/** The whole body the page polls. `force` bypasses every TTL. */
async function hub(options) {
  const force = Boolean(options && options.force)
  const [revival, legacy, rising, news] = await Promise.all([
    loadRevival(force),
    loadLegacy(force),
    loadRising(force),
    loadNews(force),
  ])
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    legend: LEGEND,
    provenance: PROVENANCE,
    links: CONFIG.links,
    servers: serverCards(revival, legacy, rising),
    news: news.value === undefined ? null : { groups: news.value.groups, errors: news.value.errors, at: news.at, stale: news.stale === true, error: news.error ?? null },
    jobs: { ...SNAPSHOT, source: 'baked' },
  }
}

/** Cache state for the diagnostic bundle: ages and errors, never the payloads. */
function cacheSnapshot() {
  const view = (entry) => ({
    loaded: entry.value !== undefined,
    ageSeconds: entry.at === 0 ? null : Math.round((Date.now() - entry.at) / 1000),
    lastError: entry.error ?? null,
    lastHttp: entry.http ?? null,
  })
  return { revival: view(cache.revival), legacy: view(cache.legacy), rising: view(cache.rising), news: view(cache.news) }
}

module.exports = { hub, CONFIG, cacheSnapshot, LINKS: CONFIG.links }
