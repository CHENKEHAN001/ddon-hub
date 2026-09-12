/**
 * A minimal ZIP writer.
 *
 * The diagnostic bundle has to be a real .zip that Windows Explorer can open, and
 * the exe carries no third-party dependencies (a single executable application
 * cannot load native modules and should not need a node_modules folder beside
 * it). So the archive is written straight to the spec: local file header, deflate
 * payload, central directory, end-of-central-directory.
 *
 * Only `node:zlib` is used, for the deflate stream. Every entry is stored with
 * its UTF-8 name and the UTF-8 flag set, because log paths may contain non-ASCII
 * characters (this project lives under a Chinese directory name).
 */
'use strict'

const zlib = require('node:zlib')

/** CRC-32 table, built once (IEEE 802.3 polynomial, reflected). */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

/** MS-DOS date/time pair used by both headers. */
function dosStamp(date) {
  const year = date.getFullYear()
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: time & 0xffff, date: day & 0xffff }
}

/**
 * Build a ZIP archive.
 *
 * @param entries - `[{ name, data }]`; `name` uses forward slashes, `data` is a
 *   Buffer or string. Names are stored as given, so callers control the tree.
 * @returns the archive as a Buffer.
 */
function zip(entries) {
  const now = new Date()
  const stamp = dosStamp(now)
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const crc = crc32(raw)
    /* Level 6 keeps text logs compact without spending much time; the logs are
       tens of KB, so the choice is not performance-sensitive. */
    const deflated = zlib.deflateRawSync(raw, { level: 6 })
    const useDeflate = deflated.length < raw.length
    const payload = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // no extra field
    locals.push(local, nameBytes, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // central directory signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42) // offset of the local header
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + payload.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with central directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuffer, end])
}

module.exports = { zip, crc32 }
