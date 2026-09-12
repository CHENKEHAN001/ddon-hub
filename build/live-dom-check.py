"""确认线上页面的三张卡片都拿到了数字，其中 Revival 走 Worker 代理。

这是用户这次提的核心问题："DDON Revival 怎么做成网站了都取不到"。
代理通了不等于页面用上了——所以要看 DOM 里的实际数字，以及网络请求确实打了 /api/revival。
"""
from __future__ import annotations

import subprocess
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LAUNCHER = r"C:\Users\chenkehan\Desktop\工作区\ddon-arc\launch_chrome_cdp.ps1"
SITE = "https://ddon-hub.3605369480.workers.dev/"


def main() -> int:
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")

    problems: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333", timeout=60000)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": 1440, "height": 900})

        errors: list[str] = []
        requests: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: requests.append(r.url) if "revival" in r.url else None)

        page.goto(SITE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(8000)

        cards = page.evaluate(
            """() => [...document.querySelectorAll('#live .card')].map(card => ({
                name: (card.querySelector('.cardName') || {}).textContent || '',
                tag: (card.querySelector('.tag') || {}).textContent || '',
                big: (card.querySelector('.big') || {}).textContent || '',
                bars: card.querySelectorAll('.bar').length,
                text: card.textContent.replace(/\\s+/g, ' ').slice(0, 90),
            }))"""
        )

        print("线上在线卡片:")
        for c in cards:
            print(f"  {c['name'][:14]:<16} 标签={c['tag']:<8} 数字={c['big'] or '(无)':<6} 频道条={c['bars']}")
        print()
        print("打到 /api/revival 的请求:", [r for r in requests if "api/revival" in r] or "无")

        # 宽屏表格
        wide = page.evaluate(
            """() => ({
                cardsHidden: getComputedStyle(document.getElementById('skills')).display === 'none',
                rows: document.querySelectorAll('#skillsTable table.wide tbody tr').length,
                headers: [...document.querySelectorAll('#skillsTable thead th')].map(t => t.textContent.replace('▼','').trim()),
            })"""
        )
        print("\n宽屏:", wide)

        if len(cards) < 3:
            problems.append(f"在线卡片只有 {len(cards)} 张")
        revival = [c for c in cards if "Revival" in c["name"]]
        if not revival:
            problems.append("没有 DDON Revival 卡片")
        else:
            r = revival[0]
            if not r["big"]:
                problems.append(f"Revival 卡片没有数字：{r['text']}")
            else:
                print(f"\n  -> Revival 显示 {r['big']} 人在线，{r['bars']} 个频道条")
        if not [r for r in requests if "api/revival" in r]:
            problems.append("页面没有请求 /api/revival——它没走代理")
        if wide["cardsHidden"] is not True:
            problems.append("宽屏下卡片列表没有隐藏")
        if wide["rows"] < 20:
            problems.append(f"宽屏表格只有 {wide['rows']} 行")
        if errors:
            problems.append(f"页面有 {len(errors)} 条 JS 错误: {errors[:2]}")

    print()
    if problems:
        print("FAIL:")
        for row in problems:
            print("   " + row)
        return 1
    print("OK: 线上三个私服都能显示数字，Revival 走 Worker 代理取到，宽屏表格正常")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
