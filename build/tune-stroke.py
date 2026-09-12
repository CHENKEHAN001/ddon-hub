# -*- coding: utf-8 -*-
"""比较几种描边方案（宽度 × 不透明度 × 颜色），找两个背景都低的那组。

上一轮：纯白不透明 2px 描边把深底从 74% 降到 23%，但浅底从 2.9% 涨到 22%——
白边铺在白底上等于没有边界。所以试半透明与浅灰，让描边在浅底上只留下很淡的轮廓，
在深底上仍然足够把深色龙身托出来。
"""
from PIL import Image, ImageFilter
import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = r"C:\Users\chenkehan\.dsh\attachments\v1\objects\2a\2ad9ac03063684f64ace9ab442ccb581816c8c219d9691e6adccfea0226abd69"
CANVAS = 512
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

GAMMA = 0.75
table = [min(255, int(round(255 * ((v / 255.0) ** GAMMA)))) for v in range(256)]
lifted = base_im.convert("RGB").point(table * 3).convert("RGBA")
lifted.putalpha(base_alpha)
small = lifted.resize((tw, th), Image.LANCZOS)
ox, oy = (CANVAS - tw) // 2, (CANVAS - th) // 2


def build(stroke_px, color, opacity):
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    if stroke_px > 0:
        mask = Image.new("L", canvas.size, 0)
        mask.paste(small.getchannel("A"), (ox, oy))
        grown = mask.filter(ImageFilter.MaxFilter(stroke_px * 2 + 1))
        if opacity < 255:
            grown = grown.point(lambda v: int(v * opacity / 255))
        ring = Image.new("RGBA", canvas.size, color + (255,))
        ring.putalpha(grown)
        canvas.alpha_composite(ring)
    canvas.alpha_composite(small, (ox, oy))
    return canvas


def unreadable(canvas, bg_lum):
    mask = canvas.getchannel("A").point(lambda v: 255 if v > 64 else 0)
    pts = [(x, y) for y in range(0, CANVAS, 3) for x in range(0, CANVAS, 3) if mask.getpixel((x, y)) > 0]
    flat = Image.new("RGBA", canvas.size, (bg_lum, bg_lum, bg_lum, 255))
    flat.alpha_composite(canvas)
    gray = flat.convert("L")
    return sum(1 for p in pts if abs(gray.getpixel(p) - bg_lum) < THRESHOLD) / len(pts)


print(f"{'描边':>4} {'颜色':>7} {'不透明':>6}  {'浅底':>7}  {'深底':>7}  {'最差':>7}  {'平均':>7}")
print("-" * 62)
rows = []
for stroke in (2, 3):
    for color, cname in (((255, 255, 255), "白"), ((232, 236, 244), "浅灰"), ((210, 218, 232), "灰蓝")):
        for opacity in (90, 140, 190, 255):
            c = build(stroke, color, opacity)
            light, dark = unreadable(c, 240), unreadable(c, 32)
            worst = max(light, dark)
            mean = (light + dark) / 2
            rows.append((worst, mean, stroke, cname, opacity, light, dark))
            print(f"{stroke:>4} {cname:>7} {opacity:>6}  {light:>6.1%}  {dark:>6.1%}  {worst:>6.1%}  {mean:>6.1%}")

rows.sort()
print()
print("按「最差」排序前三:")
for worst, mean, stroke, cname, opacity, light, dark in rows[:3]:
    print(f"  描边 {stroke}px {cname} 不透明度 {opacity}: 浅底 {light:.1%}  深底 {dark:.1%}  最差 {worst:.1%}")

print()
rows.sort(key=lambda r: r[1])
print("按「平均」排序前三:")
for worst, mean, stroke, cname, opacity, light, dark in rows[:3]:
    print(f"  描边 {stroke}px {cname} 不透明度 {opacity}: 浅底 {light:.1%}  深底 {dark:.1%}  平均 {mean:.1%}")
