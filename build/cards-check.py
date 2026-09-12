"""逐卡片列出实际渲染出的状态、元信息与全部链接，确认一个都没漏。

用户的明确要求："不要只是官网网址，把这些全部整合进对应的卡片"——
所以必须核对每张卡片里的链接数量与名称，而不是只看"有个链接行"。
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
PORT = 8897

# 期望：每张卡片应带的入口（不含官网，官网在链接行里也会出现但这里单列）
EXPECT = {
    "DDON Revival": ["官网", "排行榜", "官方 Wiki", "怎么玩"],
    "LegacyDDON": ["官网", "公告", "地图", "物品检索", "板任务", "日文 wiki"],
    "Dogma Rising": ["官网", "Live News", "怎么玩", "地图", "Discord"],
}


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

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333", timeout=60000)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(7000)

        cards = page.evaluate(
            """() => [...document.querySelectorAll('#live .card')].map(card => ({
                name: (card.querySelector('.cardName') || {}).textContent || '',
                subtitle: (card.querySelector('.cardSub') || {}).textContent || '',
                tag: (card.querySelector('.tag') || {}).textContent || '',
                big: (card.querySelector('.big') || {}).textContent || '',
                chips: [...card.querySelectorAll('.barChip')].map(c => c.textContent.replace(/\\s+/g,' ').trim()),
                meta: [...card.querySelectorAll('.meta')].map(m => m.textContent.replace(/\\s+/g,' ').trim()),
                links: [...card.querySelectorAll('a.chip')].map(a => a.textContent.replace('↗','').trim()),
            }))"""
        )

        footer = page.evaluate(
            """() => [...document.querySelectorAll('.foot .chip')].map(a => a.textContent.replace('↗','').trim())"""
        )
        sections = page.evaluate("""() => [...document.querySelectorAll('h2')].map(h => h.textContent)""")

    server.shutdown()

    problems: list[str] = []
    print("卡片布局:\n")
    for card in cards:
        print(f"  ┌ {card['name']}  ［{card['subtitle']}］  [{card['tag']}]")
        if card["big"]:
            print(f"  │ {card['big']} 人在线")
        if card["chips"]:
            print(f"  │ 频道: {' '.join(card['chips'])}")
        for m in card["meta"]:
            print(f"  │ {m}")
        print(f"  └ 链接({len(card['links'])}): {' / '.join(card['links']) or '(无)'}")
        print()

    print("页脚「资料与社区」:", footer)
    print("页面区块:", sections, "\n")

    for card in cards:
        want = EXPECT.get(card["name"])
        if want is None:
            continue
        for label in want:
            if not any(label in got for got in card["links"]):
                problems.append(f"{card['name']} 卡片缺少入口「{label}」（现有：{card['links']}）")

    if "官网入口" in sections:
        problems.append("「官网入口」区块还在——链接应当只出现在卡片里")
    if len(footer) < 2:
        problems.append(f"页脚的资料与社区链接不足：{footer}")
    if any(len(c["links"]) < 4 for c in cards):
        problems.append("有卡片链接少于 4 个")

    if problems:
        print("FAIL:")
        for row in problems:
            print("   " + row)
        return 1
    print("OK: 每张卡片都带全部入口，独立的「官网入口」区块已移除")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
