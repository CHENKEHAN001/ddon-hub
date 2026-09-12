# -*- coding: utf-8 -*-
"""看看从 RT_ICON 里取出来的字节到底是什么，修正数据定位。"""
from pathlib import Path
import struct, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

EXE = Path(r"C:\Users\chenkehan\Desktop\工作区\ddon-hub-portable\dist\ddon-hub-portable.exe")
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
    vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, off + 8)
    sections[name] = (vaddr, rsize, raddr)

rsrc_va, rsrc_size, rsrc_off = sections[".rsrc"]

def rva_to_off(rva):
    for _va, _size, _off in sections.values():
        if _va <= rva < _va + _size:
            return rva - _va + _off
    return None

def dir_entries(dir_off):
    nnamed, nid = struct.unpack_from("<HH", data, dir_off + 12)
    out = []
    for i in range(nnamed + nid):
        e = dir_off + 16 + i * 8
        name_id, offset = struct.unpack_from("<II", data, e)
        out.append((name_id, offset))
    return out

root = rsrc_off
types = {}
for name_id, offset in dir_entries(root):
    types[name_id & 0x7FFFFFFF] = rsrc_off + (offset & 0x7FFFFFFF)
print("资源类型:", sorted(types))

print("\n=== RT_ICON 每个条目的三层结构 ===")
for name_id, off1 in dir_entries(types[3]):
    lang_dir = rsrc_off + (off1 & 0x7FFFFFFF)
    for lang_id, off2 in dir_entries(lang_dir):
        # off2 此时应当已经是叶子（最高位为 0）
        print(f"  icon id={name_id & 0x7FFFFFFF:<4} lang=0x{lang_id:x}  off2=0x{off2:x}  最高位={off2 >> 31}")
        if off2 >> 31:
            continue
        entry_off = rsrc_off + off2
        rva, size = struct.unpack_from("<II", data, entry_off)
        print(f"      -> RVA 0x{rva:x} size={size}  文件偏移 0x{rva_to_off(rva):x}")
        raw = data[rva_to_off(rva):rva_to_off(rva) + size]
        print(f"      前 16 字节: {raw[:16].hex(' ')}")
        print(f"      前 8 字节 ASCII: {raw[:8]!r}")
        if raw[:8] == b"\x89PNG\r\n\x1a\n":
            print("      => 这是 PNG")
        elif struct.unpack_from("<I", raw, 0)[0] == 40:
            print("      => 这是 BITMAPINFOHEADER")
        break
