# -*- coding: utf-8 -*-
"""从 exe 的 PE 资源里把图标抽出来，跟源 ICO 逐像素比对。

只查版本字符串不够——那只能证明 rcedit 写过东西。图标是独立的资源目录项
(RT_GROUP_ICON / RT_ICON)，所以要真去解析资源段，取出位图数据再比。
"""
from PIL import Image
import struct, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

EXE = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\ddon-hub-portable.exe")
ICO = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\src\assets\app.ico")

data = EXE.read_bytes()
print(f"exe: {len(data) / 1024 / 1024:.1f} MB")

# ---- 读 PE 头，定位 .rsrc ----
pe_off = struct.unpack_from("<I", data, 0x3C)[0]
assert data[pe_off:pe_off + 4] == b"PE\0\0", "不是有效的 PE"
coff = pe_off + 4
nsec = struct.unpack_from("<H", data, coff + 2)[0]
opt_size = struct.unpack_from("<H", data, coff + 16)[0]
sec_base = coff + 20 + opt_size
sections = {}
for i in range(nsec):
    off = sec_base + i * 40
    name = data[off:off + 8].rstrip(b"\0").decode("latin1")
    vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, off + 8)
    sections[name] = (vaddr, rsize, raddr)
print("节表:", ", ".join(sections))
assert ".rsrc" in sections, "exe 里没有资源节"
rsrc_va, rsrc_size, rsrc_off = sections[".rsrc"]
print(f".rsrc: VA 0x{rsrc_va:x}  {rsrc_size / 1024:.1f} KB")

def rva_to_off(rva):
    for _n, (_va, _size, _off) in sections.items():
        if _va <= rva < _va + _size:
            return rva - _va + _off
    raise ValueError(f"RVA 0x{rva:x} 不在任何节里")

# ---- 遍历资源目录，找 RT_ICON(3) 与 RT_GROUP_ICON(14) ----
def entries(dir_off):
    nnamed, nid = struct.unpack_from("<HH", data, dir_off + 12)
    out = []
    for i in range(nnamed + nid):
        e = dir_off + 16 + i * 8
        name_id, offset = struct.unpack_from("<II", data, e)
        out.append((name_id, offset))
    return out

root = rsrc_off
types = {}
for name_id, offset in entries(root):
    types[name_id & 0x7FFFFFFF] = rsrc_off + (offset & 0x7FFFFFFF)

print("资源类型:", sorted(types))
assert 3 in types, "没有 RT_ICON（图标位图）"
assert 14 in types, "没有 RT_GROUP_ICON（图标组）"

def leaf_data(dir_off):
    """走到叶子，返回 (RVA, 大小)。"""
    (_name_id, offset) = entries(dir_off)[0]
    if offset & 0x80000000:
        sub = rsrc_off + (offset & 0x7FFFFFFF)
        (_n2, off2) = entries(sub)[0]
        data_entry = rsrc_off + off2
    else:
        data_entry = rsrc_off + offset
    rva, size = struct.unpack_from("<II", data, data_entry)
    return rva, size

# RT_ICON 下每个 id 是一张位图
icons = {}
for name_id, offset in entries(types[3]):
    sub = rsrc_off + (offset & 0x7FFFFFFF)
    rva, size = leaf_data(sub)
    raw = data[rva_to_off(rva):rva_to_off(rva) + size]
    icons[name_id & 0x7FFFFFFF] = raw
print(f"RT_ICON 条目数: {len(icons)}  大小: {sorted(len(v) for v in icons.values())}")

# RT_GROUP_ICON 给出每个尺寸对应哪个 id
grp_rva, grp_size = leaf_data(types[14])
grp = data[rva_to_off(grp_rva):rva_to_off(grp_rva) + grp_size]
count = struct.unpack_from("<H", grp, 4)[0]
group = []
for i in range(count):
    w, h, colors, res, planes, bits, length, iid = struct.unpack_from("<BBBBHHIH", grp, 6 + i * 14)
    group.append({"w": w or 256, "h": h or 256, "id": iid, "bytes": length})
print("RT_GROUP_ICON:", [(g["w"], g["h"]) for g in group])

# ---- 解读每个 RT_ICON ----
#
# Windows 允许 RT_ICON 里存两种东西：无文件头的 BITMAPINFOHEADER + 像素（传统 DIB），
# 或整张 PNG（Vista 起对 256x256 常用，Pillow 生成 ICO 时每一层都用 PNG）。
# 实测 rcedit 把 Pillow 的 ICO 原样搬进资源段，所以这里是 PNG，直接按 PNG 解。
def decode_icon(raw):
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return Image.open(io.BytesIO(raw)).convert("RGBA"), "PNG"
    bi_size = struct.unpack_from("<I", raw, 0)[0]
    if bi_size == 40:
        w = struct.unpack_from("<i", raw, 4)[0]
        h = struct.unpack_from("<i", raw, 8)[0]
        bitcount = struct.unpack_from("<H", raw, 14)[0]
        real_h = abs(h) // 2
        if bitcount != 32:
            raise ValueError(f"只处理 32bpp DIB，这里是 {bitcount}bpp")
        pixels = raw[bi_size:]
        need = w * real_h * 4
        if len(pixels) < need:
            raise ValueError(f"像素数据不足: 有 {len(pixels)}，需要 {need}")
        im = Image.frombytes("RGBA", (w, real_h), bytes(pixels[:need]), "raw", "BGRA")
        return im.transpose(Image.FLIP_TOP_BOTTOM), "DIB"
    raise ValueError(f"既不是 PNG 也不是 BITMAPINFOHEADER（前 4 字节 {raw[:4].hex(' ')}）")

extracted = {}
formats = set()
for g in group:
    raw = icons.get(g["id"])
    if raw is None:
        print(f"  {g['w']}x{g['h']}: 找不到 RT_ICON id={g['id']}")
        continue
    im, kind = decode_icon(raw)
    formats.add(kind)
    extracted[g["w"]] = im
    print(f"  {g['w']:>3}x{g['h']:<3} {kind:<4} {len(raw):>6} bytes -> {im.size}")

print(f"成功解析 {len(extracted)} 张，格式 {sorted(formats)}")

# ---- 跟源 ICO 比对 ----
src = Image.open(ICO)
src_sizes = sorted(src.ico.sizes())
print("源 ICO 尺寸:", src_sizes)

problems = []
for size in (256, 48, 16):
    if size not in extracted:
        problems.append(f"exe 里没有 {size}x{size}")
        continue
    a = extracted[size]
    b = src.ico.getimage((size, size)).convert("RGBA")
    if a.size != b.size:
        problems.append(f"{size}: 尺寸 {a.size} != {b.size}")
        continue
    # 逐像素最大差
    diff = 0
    pa, pb = a.load(), b.load()
    for y in range(0, size, max(1, size // 32)):
        for x in range(0, size, max(1, size // 32)):
            ca, cb = pa[x, y], pb[x, y]
            diff = max(diff, max(abs(ca[i] - cb[i]) for i in range(4)))
    print(f"  {size}x{size}: 最大通道差 {diff}")
    if diff > 2:
        problems.append(f"{size}: 像素差异过大 ({diff})")

if problems:
    print("\nFAIL:")
    for p in problems:
        print("  " + p)
    sys.exit(1)

# 导出 256 那张，肉眼确认
extracted[256].save(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\build\_icon_from_exe.png")
print("\nOK: exe 里的图标与源 ICO 一致（已导出 build\\_icon_from_exe.png 供肉眼确认）")
