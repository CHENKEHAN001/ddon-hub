/**
 * Note overrides for the portable build.
 *
 * The DSH plugin stores notes beside the plugin, because that folder is the
 * plugin's own. The exe has no such home: it may be run from a read-only share or
 * a downloads folder, so notes go to the writable data directory, next to the
 * logs. The shape matches the plugin's `notes-zh.json` so an edit can be carried
 * between the two.
 *
 * Edits are applied on top of the baked snapshot at request time, which keeps the
 * data file immutable and makes an edit visible on the next refresh rather than
 * requiring a rebuild.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { DATA_DIR, DISPLAY_DIR, log } = require('./logger.js')

const NOTES_FILE = path.join(DATA_DIR, 'notes.json')
const LOG_FILE = path.join(DATA_DIR, 'notes.log.jsonl')

/**
 * On-disk shape.
 *
 * `notes` is keyed by the wiki's own Japanese wording, exactly like the plugin's
 * map. `cells` is the portable build's addition: a detail value has no stable
 * key of its own, so it is addressed by job + skill + label + the original value.
 */
function emptyStore() {
  return { version: 1, notes: {}, cells: {} }
}

function readStore() {
  try {
    const text = fs.readFileSync(NOTES_FILE, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return emptyStore()
    return {
      version: 1,
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      cells: parsed.cells && typeof parsed.cells === 'object' ? parsed.cells : {},
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyStore()
    log.warn('notes file unreadable, starting empty', { file: NOTES_FILE, error: String(error && error.message) })
    return emptyStore()
  }
}

/**
 * Write atomically: a temp file in the same directory, then a rename.
 *
 * A half-written notes file would lose every edit the user has made, and this
 * app has no other copy of them.
 */
function writeStore(store) {
  const tmp = `${NOTES_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, NOTES_FILE)
}

function appendLog(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch (error) {
    log.warn('could not append note log', { error: String(error && error.message) })
  }
}

function readLog(limit) {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter((line) => line.trim() !== '')
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return { at: '', action: 'unparsable', raw: line.slice(0, 200) }
        }
      })
      .reverse()
  } catch {
    return []
  }
}

/** Key for one detail value: stable as long as the wiki wording does not change. */
function cellKey(job, skill, label, source) {
  return [job, skill, label, source].join('\u0001')
}
/**
 * Save one override.
 *
 * @param kind - `'note'` for a 备注 cell, `'cell'` for a detail value.
 * @returns `{ ok, kind, source, target }` and throws on an unusable request.
 */
function save(body) {
  const kind = body && body.kind === 'cell' ? 'cell' : 'note'
  const source = String((body && body.source) || '').trim()
  const target = String((body && body.target) || '').trim()
  if (source === '') throw new Error('source 不能为空')

  const store = readStore()
  if (kind === 'note') {
    if (target === '') delete store.notes[source]
    else store.notes[source] = target
  } else {
    const job = String((body && body.job) || '').trim()
    const skill = String((body && body.skill) || '').trim()
    const label = String((body && body.label) || '').trim()
    if (job === '' || skill === '' || label === '') throw new Error('cell 需要 job/skill/label')
    const key = cellKey(job, skill, label, source)
    if (target === '') delete store.cells[key]
    else store.cells[key] = target
  }
  writeStore(store)
  appendLog({ action: target === '' ? 'clear' : 'set', kind, source: source.slice(0, 120), target: target.slice(0, 120) })
  return { ok: true, kind, source, target }
}

/** Coverage summary for the panel footer, plus where the file lives. */
function stats(jobs, overrides) {
  let total = 0
  let edited = 0
  let missing = 0
  const untranslated = new Map()
  const kana = /[\u3040-\u30fa\u30fc-\u30ff]/

  for (const job of jobs) {
    for (const row of job.summaryRows || []) {
      const source = String(row.note || '').trim()
      if (source === '') continue
      total += 1
      const custom = overrides.notes[source]
      if (custom !== undefined) edited += 1
      else if (!row.zhNote || kana.test(row.zhNote)) {
        missing += 1
        const entry = untranslated.get(source)
        if (entry === undefined) untranslated.set(source, { source, jobs: [job.zh], count: 1 })
        else {
          entry.count += 1
          if (!entry.jobs.includes(job.zh)) entry.jobs.push(job.zh)
        }
      }
    }
  }

  return {
    total,
    overridden: edited,
    editedCells: Object.keys(overrides.cells).length,
    untranslated: [...untranslated.values()].sort((a, b) => b.count - a.count),
    missing,
    file: NOTES_FILE,
    logFile: LOG_FILE,
    /* `dir` is the readable form for the UI; `dataDir` stays as the process sees
       it, which is the 8.3 short path on some accounts. */
    dir: DISPLAY_DIR,
    dataDir: DATA_DIR,
    log: readLog(12),
  }
}

/**
 * Apply the overrides to the baked snapshot.
 *
 * Takes and returns the whole snapshot object (`{ site, jobs, … }`), because the
 * caller needs the untouched metadata as well. Returns a new tree; the baked
 * snapshot is never mutated, so a bad override can only affect the one field it
 * names.
 */
function applyOverrides(snapshot, overrides) {
  const rows = snapshot.jobs.map((job) => {
    const summaryRows = (job.summaryRows || []).map((row) => {
      const source = String(row.note || '').trim()
      const custom = source === '' ? undefined : overrides.notes[source]
      return custom === undefined ? row : { ...row, zhNote: custom, noteEdited: true }
    })
    /* Each cell carries its skill name from the bake step, so an override can be
       looked up without rebuilding the tree or leaking markers into the payload. */
    const localize = (cells) =>
      (cells || []).map((cell) => {
        const custom = overrides.cells[cellKey(job.ja, cell.skill || '', cell.label, cell.value)]
        return custom === undefined ? cell : { ...cell, zhValue: custom, valueEdited: true }
      })
    const details = (job.details || []).map((detail) => ({
      ...detail,
      cells: localize(detail.cells),
      attributes: localize(detail.attributes),
      detail: localize(detail.detail),
    }))
    return { ...job, summaryRows, details }
  })
  return { ...snapshot, jobs: rows }
}

module.exports = { NOTES_FILE, LOG_FILE, DATA_DIR, readStore, save, stats, applyOverrides, readLog, cellKey }
