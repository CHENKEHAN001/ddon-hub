/**
 * Worker 脚本：只做一件事——代理 DDON Revival 的在线人数。
 *
 * 为什么需要它：`api.ddon.org/api/channel-status` 只允许 `live.ddon.org` 自己读取
 * （`Access-Control-Allow-Origin: https://live.ddon.org`），所以访客浏览器直接请求会被
 * CORS 拦下。电脑版和 DSH 插件能拿到，是因为它们在**服务端**取数，服务端不受这条限制。
 *
 * 这个 Worker 就是网站的"服务端"：浏览器同源请求 `/api/revival`，由它在边缘节点去取
 * 上游，再把结果转给页面。于是网站版也能显示 Revival，和电脑版一致。
 *
 * 注意：`assets.directory` 里存在的路径由静态资源直接响应，不会进到这个脚本；
 * 只有 `/api/revival` 这种没有对应文件的请求才会走到这里。
 */

const UPSTREAM = 'https://api.ddon.org/api/channel-status'

/** 与页面轮询节奏相称：上游大约每分钟变一次，缓存 20 秒足够且不浪费。 */
const CACHE_SECONDS = 20

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname !== '/api/revival') {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }

    const headers = {
      'content-type': 'application/json; charset=utf-8',
      /* 页面每 30 秒轮询一次，这里缓存 20 秒：既不重复打上游，也不会显示太旧的数据。 */
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
    }

    try {
      const upstream = await fetch(UPSTREAM, {
        headers: { accept: 'application/json', 'user-agent': 'ddon-hub-worker' },
        /* 上游挂了就直接报错，不要拿几天前的缓存冒充实时 */
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      })

      if (!upstream.ok) {
        return new Response(JSON.stringify({ ok: false, error: `上游返回 HTTP ${upstream.status}` }), {
          status: 502,
          headers,
        })
      }

      const payload = await upstream.json()
      if (!Array.isArray(payload)) {
        return new Response(JSON.stringify({ ok: false, error: '上游返回的不是数组' }), { status: 502, headers })
      }

      /* 只在边缘做形状校验，不在这里做翻译——页面的解析函数与电脑版共用同一套语义。 */
      const channels = payload
        .map((row) => ({
          channel: Number.parseInt(String(row?.server_id ?? ''), 10),
          players: Number.parseInt(String(row?.players ?? ''), 10),
        }))
        .filter((row) => Number.isFinite(row.channel) && Number.isFinite(row.players) && row.players >= 0)

      if (channels.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: '上游没有可用频道' }), { status: 502, headers })
      }

      const online = channels.reduce((sum, row) => sum + row.players, 0)
      return new Response(JSON.stringify({ ok: true, online, channels, fetchedAt: new Date().toISOString() }), {
        status: 200,
        headers,
      })
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: String((error && error.message) || error) }), {
        status: 502,
        headers,
      })
    }
  },
}
