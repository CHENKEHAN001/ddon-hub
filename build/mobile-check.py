"""渲染并实测手机版 HTML（走 file://，即实际用法）。

file:// 才是真实场景（文件存到手机里直接打开），也是跨域最严的情形：
Origin 变成 null，Legacy 与 Rising 的 ACAO:* 仍应放行，Revival 本就取不到。

除了渲染，这里还盯着三件曾经出过问题的事：
  1. 内联脚本语法——有错时标记照样渲染，整页却不动
  2. 排序逐次生效且不篡改职业——曾经排序按钮和职业标签共用 .job 类，
     点击被"切职业"分支先接走，表现为"点一次就不灵了"
  3. 备注编辑能落盘、能回显
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LAUNCHER = r"C:\Users\chenkehan\Desktop\工作区\ddon-arc\launch_chrome_cdp.ps1"
FILE = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\DDON资料站-手机版.html")
SHOT = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\build\_mobile_check.png")

SNAPSHOT = """() => {
    const names = [...document.querySelectorAll('#skills .skill')].slice(0, 4).map(s => {
        const n = s.querySelector('.skillName')
        return (n ? n.textContent : '').slice(0, 18)
    })
    const job = document.querySelector('#jobs .job.on')
    const chip = document.querySelector('#sort .job.on')
    return {
        job: job ? job.getAttribute('data-job') : null,
        sort: chip ? chip.getAttribute('data-sort') : null,
        names: names,
    }
}"""


def main() -> int:
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )

    problems: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333", timeout=60000)
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": 390, "height": 844})

        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(FILE.as_uri(), wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(7000)

        counts = page.evaluate(
            """() => ({
                jobs: document.querySelectorAll('#jobs .job').length,
                skills: document.querySelectorAll('#skills .skill').length,
                live: document.querySelectorAll('#live .card').length,
                links: document.querySelectorAll('#links a').length,
                sort: document.querySelectorAll('#sort .job').length,
                meta: (document.getElementById('jobMeta') || {}).textContent || '',
                liveText: ((document.getElementById('live') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 140),
            })"""
        )
        print("file:// 打开:", counts)
        if errors:
            print("  JS 错误:")
            for e in errors[:5]:
                print("    ", e)

        try:
            page.locator(".wrap").screenshot(path=str(SHOT), timeout=25000, animations="disabled")
            print("截图:", SHOT)
        except Exception as exc:
            print("截图失败（不影响结论）:", str(exc).split("\n")[0])

        # 基本交互：切职业、搜索、展开详表
        page.click("#jobs .job:nth-child(7)")
        page.wait_for_timeout(400)
        switched = page.evaluate("() => document.querySelectorAll('#skills .skill').length")
        page.click("#jobs .job:nth-child(1)")  # 戰士
        page.wait_for_timeout(300)
        page.fill("#search", "跳")
        page.wait_for_timeout(450)
        searched = page.evaluate("() => document.querySelectorAll('#skills .skill').length")
        page.fill("#search", "")
        page.wait_for_timeout(300)
        page.click("#jobs .job:nth-child(3)")  # 獵人
        page.wait_for_timeout(400)
        page.evaluate("() => document.querySelector('#skills .skill').click()")
        page.wait_for_timeout(600)
        detail_rows = page.evaluate("() => document.querySelectorAll('#detail .kv').length")
        print(f"  切到鬥士 {switched} 行 | 戰士搜「跳」{searched} 行 | 详表 {detail_rows} 个字段")

        # 备注编辑
        page.evaluate("() => { const h = document.querySelector('.noteHint'); if (h) h.click() }")
        page.wait_for_timeout(500)
        editing = page.evaluate("() => document.querySelectorAll('.editing input').length")
        if editing > 0:
            page.fill(".editing input", "手机版测试写入")
            page.evaluate("() => document.querySelector('.editing button').click()")
            page.wait_for_timeout(600)
        stored = page.evaluate("() => { const r = localStorage.getItem('ddon-hub-notes-v1'); return r ? Object.keys(JSON.parse(r).notes).length : 0 }")
        shown = page.evaluate("() => (document.body.textContent || '').includes('手机版测试写入')")
        print(f"  备注编辑框 {editing > 0} | localStorage {stored} 条 | 页面回显 {shown}")

        # 排序：连打四个选项，每次都要立即生效，且不能动职业
        page.click("#jobs .job:nth-child(3)")
        page.wait_for_timeout(400)
        seen = []
        for index, label in ((3, "名称"), (1, "倍率"), (2, "技时间"), (0, "DPS")):
            page.evaluate(
                "i => { const c = document.querySelectorAll('#sort .job')[i]; c.dispatchEvent(new MouseEvent('click', {bubbles:true})) }",
                index,
            )
            page.wait_for_timeout(450)
            snap = page.evaluate(SNAPSHOT)
            seen.append(snap)
            print(f"  点「{label}」→ 排序={snap['sort']} 职业={snap['job']} 首行={snap['names'][0]!r}")

        page.click("#jobs .job:nth-child(7)")
        page.wait_for_timeout(400)
        page.evaluate("() => document.querySelectorAll('#sort .job')[3].dispatchEvent(new MouseEvent('click',{bubbles:true}))")
        page.wait_for_timeout(450)
        after = page.evaluate(SNAPSHOT)
        print(f"  切到鬥士后点「名称」→ 排序={after['sort']} 职业={after['job']} 首行={after['names'][0]!r}")

        # 官网入口
        links = page.evaluate(
            """() => [...document.querySelectorAll('#links a')].map(a => [a.textContent.replace(' ↗',''), a.getAttribute('href')])"""
        )
        print(f"  官网入口 {len(links)} 条，前 3:", links[:3])

        # ---- 判定 ----
        if counts["jobs"] < 11: problems.append(f"职业按钮只有 {counts['jobs']} 个")
        if counts["skills"] < 20: problems.append(f"技能卡片只有 {counts['skills']} 张")
        if counts["live"] < 3: problems.append(f"在线卡片只有 {counts['live']} 张")
        if counts["sort"] < 4: problems.append(f"排序按钮只有 {counts['sort']} 个")
        if switched < 20: problems.append(f"切换职业后只有 {switched} 行")
        if searched == 0: problems.append("搜索没有结果")
        if detail_rows < 3: problems.append(f"详表只有 {detail_rows} 个字段")
        if errors: problems.append(f"file:// 下有 {len(errors)} 条 JS 错误")
        if editing > 0 and not shown: problems.append("备注写入后页面没回显")

        got = [s["sort"] for s in seen]
        if got != ["name", "mult", "cast", "dps"]:
            problems.append(f"排序没有逐次生效：{got}")
        if any(s["job"] != "獵人" for s in seen):
            problems.append(f"点排序把职业改掉了：{[s['job'] for s in seen]}")
        if len({tuple(s["names"]) for s in seen}) < 3:
            problems.append("不同排序下前四行几乎一样，顺序没变")
        if after["job"] != "鬥士":
            problems.append(f"切职业后点排序把职业改成了 {after['job']}")
        if after["sort"] != "name":
            problems.append(f"切职业后排序没生效：{after['sort']}")
        if len(links) < 8: problems.append(f"官网入口只有 {len(links)} 条")
        for name, url in links:
            if not url.startswith("http"): problems.append(f"入口「{name}」的地址不对: {url}")

    print()
    if problems:
        print("FAIL:")
        for row in problems:
            print("   " + row)
        return 1
    print("OK: 手机版在 file:// 下离线可用；排序、搜索、详表、备注编辑、官网入口全部正常")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
