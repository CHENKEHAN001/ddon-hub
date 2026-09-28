/**
 * Build step: prove the portable build and the plugin still agree.
 *
 * Two things are compared:
 *
 *   1. `src/parsers.js` against the plugin's own definitions. The portable build
 *      cannot import the plugin at runtime, so those five functions are copied; a
 *      copy that silently diverges would make the exe and the in-app panel
 *      disagree about the same server payload, which is worse than a failed
 *      build.
 *   2. `src/monsters.js` against the plugin's `lib/monsters.js`. The monster
 *      codex is one generated snapshot that both halves ship by design, and the
 *      two files are meant to be byte-identical: a divergence means the panel and
 *      the website answer the same question about the same monster differently.
 *
 * The comparison splits both files into blocks at each top-level `function`
 * keyword and compares block by block after stripping comments and whitespace.
 * Counting braces instead would need a full JS tokenizer: `parseNews` holds regex
 * literals and string literals containing `{`, `}` and `</h3>`.
 *
 * Run with: node build/sync-check.js
 */
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PLUGIN_DIR = 'C:\\Users\\chenkehan\\.dsh\\plugins\\dsh-plugin-ddon-hub'
const PLUGIN_INDEX = path.join(PLUGIN_DIR, 'lib', 'index.js')
const LOCAL = path.join(ROOT, 'src', 'parsers.js')
/* The generated snapshot both halves ship. Not imported (the plugin half is ESM
   and this build is CommonJS) — the bytes are what has to match. */
const MONSTERS_LOCAL = path.join(ROOT, 'src', 'monsters.js')
const MONSTERS_PLUGIN = path.join(PLUGIN_DIR, 'lib', 'monsters.js')

const NAMES = ['textOf', 'normalizeDate', 'parseNews', 'parseRevivalChannels', 'parseLegacyWorlds']

/** Drop comments so a reworded doc block is not mistaken for a code change. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/** Collapse layout: indentation and line breaks are not the contract. */
function canonical(text) {
  return stripComments(text).replace(/\s+/g, ' ').trim()
}

/**
 * Index a source file's top-level functions by name.
 *
 * A block runs from `function name(` to the next line that starts with
 * `function ` at column zero, which is how this codebase (and the plugin) format
 * every top-level declaration. Anything nested is indented and never matches.
 *
 * The last block would otherwise swallow whatever follows it, so a trailing
 * `module.exports = ...` is cut off before comparison.
 */
function functionBlocks(source) {
  const blocks = new Map()
  const pattern = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm
  const hits = []
  let match
  while ((match = pattern.exec(source)) !== null) hits.push({ name: match[1], start: match.index })
  for (let i = 0; i < hits.length; i += 1) {
    const end = i + 1 < hits.length ? hits[i + 1].start : source.length
    let body = source.slice(hits[i].start, end)
    const tail = /^module\.exports\s*=/m.exec(body)
    if (tail !== null) body = body.slice(0, tail.index)
    blocks.set(hits[i].name, body)
  }
  return blocks
}

/** The first place two normalized bodies differ, with a window around it. */
function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length)
  let i = 0
  while (i < limit && left[i] === right[i]) i += 1
  const from = Math.max(0, i - 60)
  return {
    offset: i,
    left: left.slice(from, i + 100),
    right: right.slice(from, i + 100),
  }
}

function main() {
  const plugin = functionBlocks(fs.readFileSync(PLUGIN_INDEX, 'utf8'))
  const local = functionBlocks(fs.readFileSync(LOCAL, 'utf8'))

  const problems = []
  for (const name of NAMES) {
    const a = plugin.get(name)
    const b = local.get(name)
    if (a === undefined) problems.push({ name, reason: 'not found in the plugin' })
    else if (b === undefined) problems.push({ name, reason: 'not found in src/parsers.js' })
    else {
      const left = canonical(a)
      const right = canonical(b)
      if (left !== right) problems.push({ name, reason: "differs from the plugin's definition", diff: firstDifference(left, right) })
      else console.log(`  ok  ${name}`)
    }
  }

  if (problems.length > 0) {
    console.error('\nsync-check failed:')
    for (const row of problems) {
      console.error(`  ${row.name}: ${row.reason}`)
      if (row.diff) {
        console.error(`    first difference at char ${row.diff.offset}`)
        console.error(`    plugin: …${row.diff.left}…`)
        console.error(`    local : …${row.diff.right}…`)
      }
    }
    console.error('\nCopy the plugin function over the copy in src/parsers.js (do not edit both).')
    process.exit(1)
  }
  console.log('  parsers.js is in sync with the plugin')

  /* --- the generated monster codex -------------------------------------- */
  const codexLocal = fs.readFileSync(MONSTERS_LOCAL)
  const codexPlugin = fs.readFileSync(MONSTERS_PLUGIN)
  const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
  if (codexLocal.equals(codexPlugin)) {
    console.log(`  ok  monsters.js is byte-identical (${(codexLocal.length / 1024).toFixed(0)} KB, sha256 ${digest(codexLocal).slice(0, 12)})`)
  } else {
    console.error('\nsync-check failed:')
    console.error('  src/monsters.js and the plugin\'s lib/monsters.js differ.')
    console.error(`    src    : ${codexLocal.length} bytes, sha256 ${digest(codexLocal).slice(0, 16)}`)
    console.error(`    plugin : ${codexPlugin.length} bytes, sha256 ${digest(codexPlugin).slice(0, 16)}`)
    console.error('\nDo not patch either by hand. Regenerate both from the source data:')
    console.error('  python ddon-arc/build-monsters-module.py')
    process.exit(1)
  }
}

main()
