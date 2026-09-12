"""对比托管网站与电脑版(Directory exe)的界面结构。

用户要求"把 UI 做成跟插件一样，或者跟电脑版一样"。要做这件事得先看清差距，
不能凭印象。这个脚本把两边的 DOM 结构、样式关键值和可见区块列出来并排比较。
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
SITE_DIR = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\site")
PHONE = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\DDON资料站-手机版.html")
PORT = 8896

PROBE = """() => {
    const vis = (el) => el && getComputedStyle(el).display !== 'none'
    const txt = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''
    const root = document.querySelector('.wrap') || document.body
    const cs = getComputedStyle(root)
    return {
        宽度: window.innerWidth,
        正文最大宽度: cs.maxWidth,
        正文字号: getComputedStyle(document.body).fontSize,
        背景: getComputedStyle(document.body).backgroundColor,
        区块标题: [...document.querySelectorAll('h2')].map(txt),
        页头: txt(document.querySelector('header')).slice(0, 120),
        状态卡数: document.querySelectorAll('#live .card').length,
        状态卡有数字: [...document.querySelectorAll('#live .card .big')].map(txt),
        入口链接数: document.querySelectorAll('#links a').length,
        表格行数: document.querySelectorAll('#skillsTable tbody tr').length,
        卡片数: document.querySelectorAll('#skills .skill').length,
        表头: [...document.querySelectorAll('#skillsTable thead th')].map(t => t.textContent.replace('▼','').trim()),
        页脚行数: document.querySelectorAll('.foot .footRow').length,
        排序按钮: [...document.querySelectorAll('#sort .job')].map(txt),
        职业按钮: [...document.querySelectorAll('#jobs .job')].map(txt),
    }
}"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

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

        page = ctx.new_page()
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(6000)
        web = page.evaluate(PROBE)

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(800)
        web_narrow = page.evaluate(PROBE)
        page.close()

        page2 = ctx.new_page()
        page2.set_viewport_size({"width": 1440, "height": 900})
        page2.goto(PHONE.as_uri(), wait_until="domcontentloaded", timeout=60000)
        page2.wait_for_timeout(5000)
        phone_wide = page2.evaluate(PROBE)
        page2.set_viewport_size({"width": 390, "height": 844})
        page2.wait_for_timeout(800)
        phone_narrow = page2.evaluate(PROBE)
        page2.close()

    server.shutdown()

    def show(label, data):
        print(f"\n=== {label} ===")
        for k, v in data.items():
            text = str(v)
            if len(text) > 110:
                text = text[:110] + "…"
            print(f"  {k:<12} {text}")

    show("网站版 @1440", web)
    show("网站版 @390", web_narrow)
    show("手机版 @1440（同一份文件）", phone_wide)
    show("手机版 @390", phone_narrow)

    print("\n=== 关键差异 ===")
    for k in web:
        a, b, c = web.get(k), phone_wide.get(k), web_narrow.get(k)
        if isinstance(a, list) and isinstance(b, list):
            if a != b:
                print(f"  {k}: 网站@1440={a}  手机版@1440={b}")
        elif a != b:
            print(f"  {k}: 网站@1440={a!r}  手机版@1440={b!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
