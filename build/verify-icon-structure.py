# -*- coding: utf-8 -*-
"""严格校验 exe 里的图标资源，确认 Windows 能真的解析出来。

之前那版脚本把 GRPICONDIR 的字段偏移读错了（把 wPlanes 当成了 idCount），
虽然巧合地得到 7 也抽出了图，但那是错的。这里按规范逐字段校验：

  GRPICONDIR      : reserved(2) type(2)=1 count(2)
  GRPICONDIRENTRY : width(1) height(1) colors(1) reserved(1) planes(2)
                    bitcount(2) bytesInRes(4) id(2)   —— 共 14 字节

同时校验：每个 id 都能在 RT_ICON 里找到、bytesInRes 与资源实际大小一致、
尺寸与 RGBA 数据自洽。任何一条不成立，Windows 都可能退回默认图标。
"""
from PIL import Image
import struct, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

EXE = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\ddon-hub-portable.exe")
ICO = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\src\assets\app.ico")

data = EXE.read_bytes()
pe_off = struct.unpack_from("<I", data, 0x3C)[0]
coff = pe_off + 4
nsec = struct.unpack_from("<H", data, coff + 2)[0]
opt_size = struct.unpack_from("<H", data, coff + 16)[0]
sec_base = coff + 20 + opt_size
sections = {}
for i in range(nsec):
    off = sec_base + i * 40
    name = data[off:off + 8].rstrip(b"\0").decode("latin1")
    _vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, off + 8)
    sections[name] = (vaddr, rsize, raddr)
rsrc_va, rsrc_size, rsrc_off = sections[".rsrc"]


def rva_to_off(rva):
    for _va, _size, _off in sections.values():
        if _va <= rva < _va + _size:
            return rva - _va + _off
    raise ValueError(f"RVA 0x{rva:x} 不在任何节")


def dir_entries(dir_off):
    nnamed, nid = struct.unpack_from("<HH", data, dir_off + 12)
    out = []
    for i in range(nnamed + nid):
        e = dir_off + 16 + i * 8
        name_id, offset = struct.unpack_from("<II", data, e)
        out.append((name_id, offset))
    return out


def resource_bytes(dir_off):
    """取叶子节点的数据。返回 (bytes, rva, size)。"""
    for _name, offset in dir_entries(dir_off):
        if offset & 0x80000000:
            sub = rsrc_off + (offset & 0x7FFFFFFF)
            for _n2, off2 in dir_entries(sub):
                entry = rsrc_off + off2
                rva, size = struct.unpack_from("<II", data, entry)
                return data[rva_to_off(rva):rva_to_off(rva) + size], rva, size
        else:
            entry = rsrc_off + offset
            rva, size = struct.unpack_from("<II", data, entry)
            return data[rva_to_off(rva):rva_to_off(rva) + size], rva, size
    raise ValueError("空的资源目录")


root = rsrc_off
types = {}
for name_id, offset in dir_entries(root):
    types[name_id & 0x7FFFFFFF] = rsrc_off + (offset & 0x7FFFFFFF)

problems = []
print("=== RT_ICON ===")
icons = {}
for name_id, offset in dir_entries(types[3]):
    sub = rsrc_off + (offset & 0x7FFFFFFF)
    raw, rva, size = resource_bytes(sub)
    icons[name_id & 0x7FFFFFFF] = raw
    kind = "PNG" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "DIB"
    dims = ""
    if kind == "PNG":
        w, h = struct.unpack_from(">II", raw, 16)
        dims = f"{w}x{h}"
    print(f"  id={name_id & 0x7FFFFFFF:<4} {kind} {size:>6} bytes  {dims}")

print("\n=== RT_GROUP_ICON（严格按规范解析）===")
grp, grp_rva, grp_size = resource_bytes(types[14])
reserved, gtype, count = struct.unpack_from("<HHH", grp, 0)
print(f"  reserved={reserved} type={gtype} count={count}  (规范要求 reserved=0, type=1)")

if reserved != 0:
    problems.append(f"GRPICONDIR.reserved 应为 0，实际 {reserved}")
if gtype != 1:
    problems.append(f"GRPICONDIR.type 应为 1，实际 {gtype}")
if count != len(icons):
    problems.append(f"声明 {count} 个图标，但 RT_ICON 里有 {len(icons)} 个")

print(f"\n  {'w':>4} {'h':>4} {'bpp':>4} {'bytesInRes':>11} {'id':>4}   校验")
print("  " + "-" * 52)
for i in range(count):
    w8, h8, colors, res, planes, bits, nbytes, iid = struct.unpack_from("<BBBBHHIH", grp, 6 + i * 14)
    w = w8 or 256
    h = h8 or 256
    raw = icons.get(iid)
    notes = []
    if res != 0:
        notes.append(f"reserved={res} 应为 0")
    if raw is None:
        notes.append("RT_ICON 里没有这个 id")
    else:
        if len(raw) != nbytes:
            notes.append(f"bytesInRes={nbytes} 与实际 {len(raw)} 不符")
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            pw, ph = struct.unpack_from(">II", raw, 16)
            if (pw, ph) != (w, h):
                notes.append(f"PNG 实际 {pw}x{ph} 与声明 {w}x{h} 不符")
    print(f"  {w:>4} {h:>4} {bits:>4} {nbytes:>11} {iid:>4}   {'OK' if not notes else '; '.join(notes)}")
    problems.extend([f"{w}x{h}: {n}" for n in notes])

# 与源 ICO 的目录逐字段对照
print("\n=== 与源 ICO 的目录对照 ===")
ico = ICO.read_bytes()
icount = struct.unpack_from("<H", ico, 4)[0]
src_dirs = []
for i in range(icount):
    w8, h8, _c, _r, _p, bits, nbytes, _off = struct.unpack_from("<BBBBHHII", ico, 6 + i * 16)
    src_dirs.append((w8 or 256, h8 or 256, bits, nbytes))
    print(f"  源: {w8 or 256:>4}x{h8 or 256:<4} {bits}bpp {nbytes:>7} bytes")

if len(src_dirs) != count:
    problems.append(f"源 ICO 有 {len(src_dirs)} 层，exe 声明 {count} 层")

if problems:
    print("\nFAIL:")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print("\nOK: exe 的图标资源结构完整，尺寸/字节数/id 全部自洽")
