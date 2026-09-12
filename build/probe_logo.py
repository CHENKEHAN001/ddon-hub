# -*- coding: utf-8 -*-
"""量一下这张 logo：实际内容范围、边缘颜色，决定图标怎么裁、黑边填什么色。"""
from PIL import Image
import collections, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = r"C:\Users\chenkehan\.dsh\attachments\v1\objects\2a\2ad9ac03063684f64ace9ab442ccb581816c8c219d9691e6adccfea0226abd69"

im = Image.open(SRC).convert("RGBA")
print("size      :", im.size)
print("mode      :", im.mode)

# 角落与四边中点的颜色，判断是不是纯白底
w, h = im.size
probe = {
    "左上": (2, 2),
    "右上": (w - 3, 2),
    "左下": (2, h - 3),
    "右下": (w - 3, h - 3),
    "上中": (w // 2, 2),
    "下中": (w // 2, h - 3),
    "左中": (2, h // 2),
    "右中": (w - 3, h // 2),
}
for name, (x, y) in probe.items():
    print(f"  {name}: {im.getpixel((x, y))}")

# 非白内容的外接框（阈值放宽一点，半透明阴影也算内容）
gray = im.convert("L")
mask = gray.point(lambda v: 255 if v < 246 else 0)
print("bbox(阈值246):", mask.getbbox())
mask2 = gray.point(lambda v: 255 if v < 250 else 0)
print("bbox(阈值250):", mask2.getbbox())

# 内容占比
bb = mask2.getbbox()
if bb:
    cw, ch = bb[2] - bb[0], bb[3] - bb[1]
    print(f"内容尺寸   : {cw}x{ch}  占画布 {cw / w:.1%} x {ch / h:.1%}")

# 主色统计（取内容区域）
if bb:
    crop = im.crop(bb).convert("RGB")
    small = crop.resize((80, 80))
    counts = collections.Counter(small.getdata())
    print("内容区主色 top8:")
    for color, n in counts.most_common(8):
        print(f"    {color}  x{n}")
