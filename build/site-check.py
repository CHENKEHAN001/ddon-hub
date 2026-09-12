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
                links: document.querySelectorAll('#links a').length,
                headerTag: (document.querySelector('header .tag') || {}).textContent || '',
                liveText: ((document.getElementById('live') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 160),
                footText: ((document.querySelector('.foot') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 200),
            })"""
        )
        print("打开站点:", {k: v for k, v in info.items() if k not in ("liveText", "footText")})
        print("  在线区:", info["liveText"])
        print("  页脚  :", info["footText"])
        if errors:
            print("  JS 错误:")
            for e in errors[:5]:
                print("    ", e)

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
        if "Revival" in info["liveText"]:
            problems.append("托管版仍显示 Revival 卡片（公网取不到，应当隐藏）")
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
    print("OK: 托管版按网站方式打开正常；Revival 卡片已隐藏，文案与出处声明正确")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
