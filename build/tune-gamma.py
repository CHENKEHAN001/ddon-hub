# -*- coding: utf-8 -*-
"""为透明底图标选提亮系数（按「辨识不出的像素占比」判，不看均值）。

均值会被图标本身的近黑烟雾和投影拉低——那些本来就该是暗的。真正要回答的是：
合到某个背景上之后，有多少内容像素与背景的亮度差小于可辨阈值。占比越低越好。
"""
from PIL import Image
import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = r"C:\Users\chenkehan\.dsh\attachments\v1\objects\2a\2ad9ac03063684f64ace9ab442ccb581816c8c219d9691e6adccfea0226abd69"
CANVAS = 512
# 亮度差小于这个值，人眼基本分不出来（在浅底与深底上各取一个保守值）
THRESHOLD = 26

raw = Image.open(SRC).convert("RGBA")
w, h = raw.size
px = raw.load()

alpha_ch = Image.new("L", (w, h), 0)
rgb = Image.new("RGB", (w, h))
rgb_px = rgb.load()
for y in range(h):
    for x in range(w):
        r, g, b, _ = px[x, y]
        a = max(255 - r, 255 - g, 255 - b)
        if a <= 6:
            alpha_ch.putpixel((x, y), 0)
            rgb_px[x, y] = (255, 255, 255)
            continue
        alpha_ch.putxel = None  # 防手滑，下面用正规调用
        alpha_ch.putpixel((x, y), a)
        t = a / 255.0
        base = (1 - t) * 255.0
        rgb_px[x, y] = tuple(min(255, max(0, int(round((v - base) / t)))) for v in (r, g, b))

content = alpha_ch.point(lambda v: 255 if v > 4 else 0).getbbox()
base_im = rgb.convert("RGBA").crop(content)
base_alpha = alpha_ch.crop(content)
cw, ch = base_im.size

usable = int(CANVAS * 0.92)
scale = min(usable / cw, usable / ch)
tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))

print(f"{'gamma':>6}  {'浅底不可辨':>12}  {'深底不可辨':>12}   {'最差':>7}")
print("-" * 52)

best = None
for gamma in (1.0, 0.85, 0.75, 0.68, 0.62, 0.55, 0.48, 0.42):
    table = [min(255, int(round(255 * ((v / 255.0) ** gamma)))) for v in range(256)]
    lifted = base_im.convert("RGB").point(table * 3).convert("RGBA")
    lifted.putalpha(base_alpha)
    small = lifted.resize((tw, th), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(small, ((CANVAS - tw) // 2, (CANVAS - th) // 2))

    mask = canvas.getchannel("A").point(lambda v: 255 if v > 64 else 0)
    points = [(x, y) for y in range(0, CANVAS, 3) for x in range(0, CANVAS, 3) if mask.getpixel((x, y)) > 0]

    bad = []
    for bg_lum in (240, 32):
        flat = Image.new("RGBA", canvas.size, (bg_lum, bg_lum, bg_lum, 255))
        flat.alpha_composite(canvas)
        gray = flat.convert("L")
        unreadable = sum(1 for p in points if abs(gray.getpixel(p) - bg_lum) < THRESHOLD)
        bad.append(unreadable / len(points))

    worst = max(bad)
    print(f"{gamma:>6.2f}  {bad[0]:>11.1%}  {bad[1]:>11.1%}   {worst:>6.1%}")
    if best is None or worst < best[0]:
        best = (worst, gamma, bad)

print()
print(f"最差情况最好的: gamma={best[1]}  "
      f"浅底不可辨 {best[2][0]:.1%}，深底不可辨 {best[2][1]:.1%}")
print(f"（阈值：亮度差 < {THRESHOLD} 视为分辨不出；统计范围为 alpha>64 的内容像素）")
