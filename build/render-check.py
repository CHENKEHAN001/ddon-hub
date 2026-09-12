"""给运行中的实例截图，验证页面真的渲染出来了（不只是能解析）。

页面"活着但不动"这类问题，解析通过也不代表渲染正确——必须看实际画面。
复用 launch_chrome_cdp.ps1 起的那套 CDP Chrome（端口 9333）。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LAUNCHER = r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\..\ddon-arc\launch_chrome_cdp.ps1"
OUT = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\build\_render_check.png")
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8777/"


def main() -> int:
    r = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    print("launcher:", (r.stdout or "").strip()[:120], flush=True)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333", timeout=60000)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text) if m.type == "error" else None)

        page.goto(URL, wait_until="load", timeout=60000)
        page.wait_for_timeout(6000)

        # 用 DOM 里的实际数量判断渲染是否成功，而不是靠肉眼
        counts = page.evaluate(
            """() => ({
                jobs: document.querySelectorAll('#jobs .job').length,
                rows: document.querySelectorAll('#tableWrap tbody tr').length,
                cards: document.querySelectorAll('#servers .card').length,
                news: document.querySelectorAll('#news .card').length,
                foot: document.querySelectorAll('#foot .footRow').length,
                liveTag: (document.getElementById('liveTag') || {}).textContent || '',
                meta: (document.getElementById('jobMeta') || {}).textContent || '',
            })"""
        )
        print("渲染统计:", counts, flush=True)
        if errors:
            print("页面错误:", flush=True)
            for e in errors[:8]:
                print("   ", e, flush=True)

        page.set_viewport_size({"width": 1440, "height": 900})
        page.screenshot(path=str(OUT))
        print("截图:", OUT, flush=True)

        problems = []
        if counts["jobs"] < 11:
            problems.append(f"职业按钮只有 {counts['jobs']} 个，应为 11")
        if counts["rows"] < 30:
            problems.append(f"技能表只有 {counts['rows']} 行，应至少 30")
        if counts["cards"] < 2:
            problems.append(f"在线卡片只有 {counts['cards']} 张，应为 2")
        if counts["foot"] < 3:
            problems.append(f"页脚只有 {counts['foot']} 行，应至少 3")
        if errors:
            problems.append(f"页面有 {len(errors)} 条 JS 错误")

        if problems:
            print("\nFAIL:", flush=True)
            for row in problems:
                print("   " + row, flush=True)
            return 1
        print("\nOK: 页面实际渲染出了职业按钮、技能表、在线卡片和页脚", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
