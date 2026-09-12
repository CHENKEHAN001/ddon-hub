"""按真实网站的方式实测托管版：起本地服务 + 手机视口打开。

和手机版的关键差别要看三件事：
  1. hosted 文案而非"离线可用"
  2. Revival 卡片不再出现（公网取不到，留着是噪音）
  3. 两个 ACAO:* 的接口在 http 源下仍能取到
"""
from __future__ import annotations

import http.server
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LAUNCHER = r"C:\Users\chenkehan\Desktop\工作区\ddon-arc\launch_chrome_cdp.ps1"
SITE = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\site")
SHOT = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\build\_site_check.png")
PORT = 8893


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def log_message(self, *args):
        pass


def main() -> int:
    server = socketserver.TCPServer(("127.0.0.1", PORT), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")

    problems: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333", timeout=60000)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": 390, "height": 844})

        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6000)

        info = page.evaluate(
            """() => ({
                jobs: document.querySelectorAll('#jobs .job').length,
                skills: document.querySelectorAll('#skills .skill').length,
                liveCards: document.querySelectorAll('#live .card').length,
                newsItems: document.querySelectorAll('#news .newsItem').length,
                sections: [...document.querySelectorAll('h2')].map(h => h.textContent),
                links: document.querySelectorAll('#links a').length,
                headerTag: (document.querySelector('header .tag') || {}).textContent || '',
                liveText: ((document.getElementById('live') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 200),
                newsText: ((document.getElementById('news') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 200),
                footText: ((document.querySelector('.foot') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 200),
            })"""
        )
        print("打开站点:", {k: v for k, v in info.items() if k not in ("liveText", "newsText", "footText")})
        print("  在线区:", info["liveText"])
        print("  公告区:", info["newsText"])
        if errors:
            print("  JS 错误:")
            for e in errors[:5]:
                print("    ", e)

        # 公告区块必须真的有条目——电脑版和插件都有，缺了就是形态间不一致
        if info["newsItems"] < 1:
            problems.append("公告区没有条目（电脑版与插件都有抓取到的公告）")
        if "官方公告" not in info["sections"]:
            problems.append("缺少「官方公告」区块标题")

        # 三个私服都要出现：Revival 取不到数字，但卡片必须在，
        # 否则看起来像"少了一个私服"而不是"这个源读不了"。
        if info["liveCards"] < 3:
            problems.append(f"在线卡片只有 {info['liveCards']} 张，三个私服都应出现")
        if "Revival" not in info["liveText"]:
            problems.append("在线区没有 DDON Revival——它取不到数字，但卡片不应缺席")

        # 宽屏：媒体查询生效后应显示表格、隐藏卡片
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(800)
        wide = page.evaluate(
            """() => {
                const cards = document.getElementById('skills')
                const table = document.getElementById('skillsTable')
                const rows = document.querySelectorAll('#skillsTable table.wide tbody tr')
                const ths = [...document.querySelectorAll('#skillsTable table.wide thead th')].map(t => t.textContent.replace('▼','').trim())
                return {
                    cardsHidden: cards ? getComputedStyle(cards).display === 'none' : null,
                    tableShown: table ? getComputedStyle(table).display !== 'none' : null,
                    rows: rows.length,
                    headers: ths,
                }
            }"""
        )
        print("  宽屏 1440px:", wide)
        if wide["cardsHidden"] is not True:
            problems.append("宽屏下卡片列表没有隐藏")
        if wide["tableShown"] is not True:
            problems.append("宽屏下表格没有显示")
        if wide["rows"] < 20:
            problems.append(f"宽屏表格只有 {wide['rows']} 行")
        for want in ("倍率合计", "技时间", "DPS 性能", "备注"):
            if not any(want in h for h in wide["headers"]):
                problems.append(f"宽屏表格缺少「{want}」列")

        # 宽屏下点表头排序，和手机端点筛选按钮应当等效
        page.evaluate(
            """() => {
                const th = [...document.querySelectorAll('#skillsTable thead th.sortable')]
                    .find(t => t.getAttribute('data-sort') === 'name')
                if (th) th.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            }"""
        )
        page.wait_for_timeout(600)
        sorted_wide = page.evaluate(
            """() => {
                const on = document.querySelector('#sort .job.on')
                const first = document.querySelector('#skillsTable tbody tr td.skillName')
                return { sort: on ? on.getAttribute('data-sort') : null, first: first ? first.textContent.slice(0, 18) : null }
            }"""
        )
        print("  点宽屏表头「名称」:", sorted_wide)
        if sorted_wide["sort"] != "name":
            problems.append(f"宽屏点表头排序没生效：{sorted_wide['sort']}")

        # 回到手机视口，确认卡片回来
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(600)
        narrow = page.evaluate(
            """() => ({
                cardsShown: getComputedStyle(document.getElementById('skills')).display !== 'none',
                tableHidden: getComputedStyle(document.getElementById('skillsTable')).display === 'none',
            })"""
        )
        print("  回到 390px:", narrow)
        if narrow["cardsShown"] is not True or narrow["tableHidden"] is not True:
            problems.append("回到窄屏后没有切回卡片列表")

        try:
            page.locator(".wrap").screenshot(path=str(SHOT), timeout=20000, animations="disabled")
            print("截图:", SHOT)
        except Exception as exc:
            print("截图失败（不影响结论）:", str(exc).split("\n")[0])

        # robots.txt / _headers 也要能取到
        robots = page.evaluate(
            """async () => {
                const r = await fetch('/robots.txt')
                return { status: r.status, text: (await r.text()).slice(0, 60) }
            }"""
        )
        print("robots.txt:", robots)

        if info["jobs"] < 11: problems.append(f"职业按钮只有 {info['jobs']} 个")
        if info["skills"] < 20: problems.append(f"技能卡片只有 {info['skills']} 张")
        if info["links"] < 10: problems.append(f"官网入口只有 {info['links']} 条")
        if errors: problems.append(f"有 {len(errors)} 条 JS 错误")
        if "离线" in info["headerTag"]:
            problems.append("托管版仍在显示「离线可用」文案")
        if "手机版" in info["headerTag"]:
            problems.append("托管版仍在显示「手机版」文案")
        if "Revival" in info["liveText"] and "只允许自家网页读取" not in info["liveText"] and "服务端代理" not in info["liveText"]:
            problems.append("Revival 卡片在，但没有说明取不到的原因")
        if "要用电脑版" in info["liveText"]:
            problems.append("网站版出现了手机专属措辞「要用电脑版」")
        # 本地静态服务器没有 Worker，所以代理必然 404——这是预期的，
        # 线上由 worker/index.js 提供。这里只要求它把原因说清楚。
        if "代理" in info["liveText"] and "HTTP 404" in info["liveText"]:
            print("  （本地无 Worker，代理 404 属预期；线上由 worker/index.js 提供）")
        if "抓取" not in info["footText"] and "2026-09-10" not in info["footText"]:
            problems.append("页脚没有标注数据抓取时间")
        if robots["status"] != 200:
            problems.append("robots.txt 取不到")

    server.shutdown()
    print()
    if problems:
        print("FAIL:")
        for row in problems:
            print("   " + row)
        return 1
    print("OK: 托管版按网站方式打开正常；三个私服都在、宽屏走表格窄屏走卡片、文案与出处声明正确")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
