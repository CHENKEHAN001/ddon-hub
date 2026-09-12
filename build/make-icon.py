# -*- coding: utf-8 -*-
"""把 logo 做成程序图标（透明底）。

源图是纯白底、内容 947x727（宽屏），带很淡的烟雾拖尾和投影。

做法：
  1. 从白底解混出「真实颜色 + 不透明度」（详见下面注释，直接把亮度当 alpha 是错的）
  2. **不填背景**，保留 alpha —— 图标就是透明的
  3. 抬一次中间调（gamma 0.75）：龙身是深蓝灰，在浅色背景上会糊掉
  4. 描一圈 2px 纯白边。深色 logo 做多背景适配的常规做法：
     白边在白底/浅灰底上本来就看不见，在深色任务栏上却能把龙身轮廓托出来。
     实测深底上「分辨不出的内容像素」从 74% 降到 23%，浅底从 2.9% 只涨到 22%
     （而且这 22% 主要是抗锯齿边缘，肉眼几乎无感）。
  5. 居中放进正方形画布，四周留 4% 边距
  6. 输出多尺寸 ICO（16 到 256）给 exe，另存 PNG 给网页 favicon

调参依据见 build/tune-gamma.py 与 build/tune-stroke.py，
肉眼对照见图 build/icon-compare.py 生成的 _icon_compare.png。
"""
from PIL import Image, ImageFilter
import sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SRC = r"C:\Users\chenkehan\.dsh\attachments\v1\objects\2a\2ad9ac03063684f64ace9ab442ccb581816c8c219d9691e6adccfea0226abd69"
OUT_DIR = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\src\assets")
OUT_DIR.mkdir(parents=True, exist_ok=True)

CANVAS = 1024
PAD_RATIO = 0.04
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

# 原图照着白底画：龙身中间调(~140)在白底上很清楚，放在深色或中灰背景上就糊。
# 抬中间调补偿，两端不动——金色仍是金色，暗部仍然是暗部。
GAMMA = 0.75
gamma_table = [min(255, int(round(255 * ((v / 255.0) ** GAMMA)))) for v in range(256)]

# 白描边宽度按最终画布像素算（16px 图标缩下去约 0.03px，靠重采样近似，不影响辨识）
STROKE_PX = 4
STROKE_COLOR = (255, 255, 255)

im = Image.open(SRC).convert("RGBA")
w, h = im.size
print("源图:", w, "x", h)

# 1) 从纯白背景解混。
#
# 直接把亮度当 alpha 是错的：金色 (205,170,90) 亮度约 160，那样算出来只有 0.37
# 的不透明度，背景透上来，金字就变成土黄发灰。
#
# 正确模型：看到的像素 = a*C + (1-a)*白。a 可以反解为每通道「离白多远」的最大值，
# 有了 a 就能还原真实颜色 C = (seen - (1-a)*255) / a。这样金字还原成金色、
# 不透明度接近 1，而真正半透明的烟雾和投影仍然保持半透明。
px = im.load()
alpha_ch = Image.new("L", (w, h), 0)
rgb = Image.new("RGB", (w, h))
rgb_px = rgb.load()
for y in range(h):
    for x in range(w):
        r, g, b, _a = px[x, y]
        a = max(255 - r, 255 - g, 255 - b)
        if a <= 6:
            alpha_ch.putpixel((x, y), 0)
            rgb_px[x, y] = (255, 255, 255)
            continue
        alpha_ch.putpixel((x, y), a)
        t = a / 255.0
        base = (1 - t) * 255.0
        cr = min(255, max(0, int(round((r - base) / t))))
        cg = min(255, max(0, int(round((g - base) / t))))
        cb = min(255, max(0, int(round((b - base) / t))))
        rgb_px[x, y] = (gamma_table[cr], gamma_table[cg], gamma_table[cb])

im = rgb.convert("RGBA")
im.putalpha(alpha_ch)

# 2) 用 alpha 裁掉多余白边（阈值 4 以上才算有内容，保留烟雾）
content = alpha_ch.point(lambda v: 255 if v > 4 else 0).getbbox()
print("内容框:", content)
im = im.crop(content)
cw, ch = im.size
print("裁后:", cw, "x", ch)

# 3) 等比缩放到正方形画布的可用区域内，居中贴上。
#    底色透明 —— 这就是要的透明底图标。
usable = int(CANVAS * (1 - 2 * PAD_RATIO))
scale = min(usable / cw, usable / ch)
tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
resized = im.resize((tw, th), Image.LANCZOS)

canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
ox, oy = (CANVAS - tw) // 2, (CANVAS - th) // 2

# 4) 白描边：把 alpha 膨胀一圈填白，垫在原图下面。
#    这一步只改外缘，不碰内部颜色；在白底上不可见，在深底上托出轮廓。
if STROKE_PX > 0:
    mask = Image.new("L", canvas.size, 0)
    mask.paste(resized.getchannel("A"), (ox, oy))
    grown = mask.filter(ImageFilter.MaxFilter(STROKE_PX * 2 + 1))
    ring = Image.new("RGBA", canvas.size, STROKE_COLOR + (255,))
    ring.putalpha(grown)
    canvas.alpha_composite(ring)

canvas.alpha_composite(resized, (ox, oy))

# 4) ICO
ico_path = OUT_DIR / "app.ico"
canvas.save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
print("写出:", ico_path.name, f"{ico_path.stat().st_size / 1024:.1f} KB")

# 5) favicon 与页面用图
for size, name in ((256, "app-256.png"), (512, "app-512.png")):
    path = OUT_DIR / name
    canvas.resize((size, size), Image.LANCZOS).save(path, format="PNG", optimize=True)
    print("写出:", name, f"{path.stat().st_size / 1024:.1f} KB")

# ---- 自检 ----
tiny = canvas.resize((16, 16), Image.LANCZOS)
corner = tiny.getpixel((0, 0))
print("16x16 角:", corner, " 中心:", tiny.getpixel((8, 8)))

# 覆盖率与抗锯齿用统计口径：单点取样会落在烟雾的细丝或空白处，误判。
alpha_all = list(canvas.getchannel("A").getdata())
total = len(alpha_all)
visible = sum(1 for a in alpha_all if a > 24)
partial = sum(1 for a in alpha_all if 24 < a < 232)
print(f"可见像素占比: {visible / total:.1%}   半透明边缘像素: {partial / total:.1%}")

problems = []
if corner[3] != 0:
    problems.append(f"角落不透明 (alpha={corner[3]})，图标不是透明底")
if visible / total < 0.10:
    problems.append(f"内容太少，只占 {visible / total:.1%}")
if visible / total > 0.85:
    problems.append(f"内容几乎铺满 {visible / total:.1%}，边距可能丢了")
if partial / total < 0.005:
    problems.append("几乎没有半透明像素，抗锯齿丢了")

# 龙身可见性：合到白底和深底上，看内容区平均亮度。两个背景都得能看清。
for label, bg in (("白底", (255, 255, 255)), ("深底", (20, 22, 26))):
    flat = Image.new("RGBA", canvas.size, bg + (255,))
    flat.alpha_composite(canvas)
    # 只统计真正有内容的位置，否则空白会把均值拉向背景色
    mask = canvas.getchannel("A").point(lambda v: 255 if v > 64 else 0)
    gray = flat.convert("L")
    values = [gray.getpixel((x, y)) for y in range(0, CANVAS, 4) for x in range(0, CANVAS, 4) if mask.getpixel((x, y)) > 0]
    mean = sum(values) / len(values)
    print(f"  合到{label}后，内容区平均亮度: {mean:.1f}  (背景 {bg[0]})")
    # 内容与背景的亮度差太小就说明糊在一起了
    if abs(mean - bg[0]) < 28:
        problems.append(f"合到{label}后内容与背景亮度差只有 {abs(mean - bg[0]):.0f}，看不清")

check = Image.open(ico_path)
print("ICO 图层:", sorted(check.ico.sizes()))
if len(check.ico.sizes()) < 5:
    problems.append("ICO 尺寸太少")

if problems:
    print("\nFAIL:")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print("\n图标生成完毕（透明底）")
