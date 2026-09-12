# -*- coding: utf-8 -*-
"""把拟定的图标方案合到三种背景上，出一张对照图肉眼确认。

方案：gamma 0.75 提亮 + 2px 纯白不透明描边（描边只改动 alpha 外缘，
在浅底上不可见，在深底上把深色龙身托出轮廓）。
"""
from PIL import Image, ImageDraw, ImageFilter
import sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = r"C:\Users\chenkehan\.dsh\attachments\v1\objects\2a\2ad9ac03063684f64ace9ab442ccb581816c8c219d9691e6adccfea0226abd69"
OUT = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\build\_icon_compare.png")
CANVAS = 512

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


def build(gamma, stroke_px, stroke_color):
    table = [min(255, int(round(255 * ((v / 255.0) ** gamma)))) for v in range(256)]
    lifted = base_im.convert("RGB").point(table * 3).convert("RGBA")
    lifted.putalpha(base_alpha)
    small = lifted.resize((tw, th), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ox, oy = (CANVAS - tw) // 2, (CANVAS - th) // 2
    if stroke_px > 0:
        mask = Image.new("L", canvas.size, 0)
        mask.paste(small.getchannel("A"), (ox, oy))
        grown = mask.filter(ImageFilter.MaxFilter(stroke_px * 2 + 1))
        ring = Image.new("RGBA", canvas.size, stroke_color + (255,))
        ring.putalpha(grown)
        canvas.alpha_composite(ring)
    canvas.alpha_composite(small, (ox, oy))
    return canvas


# 两列：不加描边 / 加 2px 白描边；三行：白底、浅灰底(资源管理器)、深灰底(任务栏)
BACKGROUNDS = [("白底 255", (255, 255, 255)), ("浅灰 240", (240, 240, 240)), ("深底 32", (32, 32, 32))]
variants = [("无描边 gamma0.75", build(0.75, 0, (255, 255, 255))), ("白描边2px gamma0.75", build(0.75, 2, (255, 255, 255)))]

PAD = 16
CELL = CANVAS // 2
sheet = Image.new("RGB", (len(variants) * (CELL + PAD) + PAD, len(BACKGROUNDS) * (CELL + PAD) + PAD), (90, 90, 90))
draw = ImageDraw.Draw(sheet)

for col, (vname, canvas) in enumerate(variants):
    for row, (bname, bg) in enumerate(BACKGROUNDS):
        cell = Image.new("RGBA", (CELL, CELL), bg + (255,))
        thumb = canvas.resize((CELL, CELL), Image.LANCZOS)
        cell.alpha_composite(thumb)
        x = PAD + col * (CELL + PAD)
        y = PAD + row * (CELL + PAD)
        sheet.paste(cell.convert("RGB"), (x, y))
        draw.text((x + 6, y + 4), f"{vname} / {bname}", fill=(255, 90, 90))

sheet.save(OUT)
print("对照图:", OUT, sheet.size)
print("左列 = 无描边，右列 = 2px 白描边；自上而下：白底 / 浅灰底 / 深底")
