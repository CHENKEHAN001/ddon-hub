/**
 * Build step: produce the single-file executable.
 *
 * Node's single-executable-application support wraps a bundled script into a copy
 * of the node binary, which is what lets recipients run this without installing
 * Node. Three stages: bundle to one CommonJS file, turn that into a SEA blob,
 * then inject the blob into a copy of node.exe.
 *
 * The result is architecturally identical to the node used to build it. That is a
 * real limitation, not an oversight: a 64-bit Windows exe has to be injected into
 * a 64-bit Windows node.exe, so this cannot cross-build.
 *
 * Run with: node build/make-exe.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const STAGE = path.join(ROOT, 'build', '_stage')
const BUNDLE = path.join(STAGE, 'app.cjs')
const BLOB = path.join(STAGE, 'app.blob')
const SEA_CONFIG = path.join(STAGE, 'sea-config.json')
const ICON = path.join(ROOT, 'src', 'assets', 'app.ico')
const EXE_NAME = 'ddon-hub-portable.exe'
const OUT_EXE = path.join(DIST, EXE_NAME)

/** Fuse string has to match the Node version's; it is stable across 20/22/24. */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function run(file, args, label) {
  process.stdout.write(`  ${label}\n`)
  try {
    execFileSync(file, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr) : ''
    /* postject and node both write progress to stderr on success, so only report
       what came back when the exit code is non-zero. */
    throw new Error(`${label} failed\n${stderr || (error && error.message)}`)
  }
}

function stageBundle() {
  fs.rmSync(STAGE, { recursive: true, force: true })
  fs.mkdirSync(STAGE, { recursive: true })
  const esbuild = require('esbuild')
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'server.js')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: BUNDLE,
    logLevel: 'warning',
    /* Only node builtins are external; everything else is in the tree. */
    external: ['node:*'],
    banner: { js: '/** Bundled by build/make-exe.js — DDON 资料站 便携版. Do not edit. */' },
  })
  const size = fs.statSync(BUNDLE).size
  console.log(`  bundle: ${(size / 1024 / 1024).toFixed(2)} MB`)
  return size
}

function checkBundle() {
  /* A CJS bundle inside a SEA has no node_modules to fall back on, so prove it
     loads with nothing but builtins before spending time on injection. */
  delete require.cache[require.resolve(BUNDLE)]
  const loaded = require(BUNDLE)
  if (typeof loaded.main !== 'function') throw new Error('bundled module does not export main()')
  console.log('  bundle loads and exports main()')
}

function stageBlob() {
  fs.writeFileSync(
    SEA_CONFIG,
    JSON.stringify(
      {
        main: BUNDLE,
        output: BLOB,
        disableExperimentalSEAWarning: true,
        /* Assets are not used: the baked data is a JS module, so nothing has to be
           read out of the executable at runtime. */
      },
      null,
      2,
    ),
  )
  run(process.execPath, ['--experimental-sea-config', SEA_CONFIG], 'sea blob')
  const size = fs.statSync(BLOB).size
  console.log(`  blob: ${(size / 1024 / 1024).toFixed(2)} MB`)
}

/** Copy node.exe and inject the SEA blob into that copy. */
function inject() {
  const postject = require.resolve('postject/dist/cli.js')
  run(
    process.execPath,
    [postject, OUT_EXE, 'NODE_SEA_BLOB', BLOB, '--sentinel-fuse', FUSE, '--macho-segment-name', 'NODE_SEA'],
    'inject blob',
  )
  const size = fs.statSync(OUT_EXE).size
  console.log(`  exe: ${(size / 1024 / 1024).toFixed(1)} MB -> ${OUT_EXE}`)
}

/**
 * Write the icon and version info into the PE resources.
 *
 * Order matters here, and getting it wrong costs a hung build rather than an
 * error message:
 *
 *   - rcedit on a **plain** node.exe finishes in about a second.
 *   - rcedit on the **injected** exe does not terminate. Measured once: 13 minutes
 *     wall clock, 800 s of CPU, before it was killed. postject rewrites the section
 *     table, and rcedit's resource walk never comes back on the result.
 *
 * So the resources go in first and the blob is injected afterwards. That order was
 * verified to keep both the resources and a working binary: the version info reads
 * back correctly and `--help` still runs.
 *
 * The option shape is rcedit 5's: display strings go under `version-string` using
 * its own fixed key names, and the version numbers are separate 4-part strings.
 * Anything else reaches the CLI as an unknown argument.
 */
async function applyResources(target) {
  if (!fs.existsSync(ICON)) throw new Error('icon missing: ' + ICON + '\nRun: python build/make-icon.py')
  const { rcedit } = require('rcedit')
  const pkg = require(path.join(ROOT, 'package.json'))
  const version = pkg.version + '.0'
  await rcedit(target, {
    icon: ICON,
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'DDON 资料站',
      FileDescription: 'DDON 资料站 便携版',
      CompanyName: 'DDON 资料站',
      LegalCopyright: '技能数据来自 DDON-DPS研究所 Wiki*，译名来自私服汉化包',
      InternalName: EXE_NAME,
      OriginalFilename: EXE_NAME,
    },
  })
  console.log('  resources: icon + version info written')
}

/** Read back what the resource section holds after injection. */
function verifyResources() {
  const buffer = fs.readFileSync(OUT_EXE)
  if (buffer.indexOf(Buffer.from('DDON 资料站', 'utf16le')) < 0) {
    throw new Error('the product name was lost during injection')
  }
  console.log('  resources survived injection')
}

function verify() {
  /* --help exercises startup, bundling, args and stdout without binding a port. */
  const out = execFileSync(OUT_EXE, ['--help'], { encoding: 'utf8', timeout: 120000 })
  if (!out.includes('DDON 资料站')) throw new Error('the exe did not print its help text')
  console.log('  exe runs (--help)')
}

function main() {
  console.log('building ' + EXE_NAME)
  console.log('  node: ' + process.version + ' (' + process.arch + ')')
  /* Assets first: the icons are inlined by a generator step, and a stale or
     missing module would silently ship a page without them. */
  run(process.execPath, [path.join(__dirname, 'make-assets.js')], 'inline assets')
  stageBundle()
  checkBundle()
  stageBlob()
  /* Copy node.exe first, write the resources into the copy, then inject. Doing
     rcedit after postject hangs, so the order is a correctness requirement. */
  fs.mkdirSync(DIST, { recursive: true })
  fs.copyFileSync(process.execPath, OUT_EXE)
  applyResources(OUT_EXE)
    .then(() => {
      inject()
      verifyResources()
      verify()
      console.log('\ndone: ' + OUT_EXE)
    })
    .catch((error) => {
      console.error('\nmake-exe failed:', error && error.stack ? error.stack : error)
      process.exit(1)
    })
}

try {
  main()
} catch (error) {
  console.error('\nmake-exe failed:', error && error.stack ? error.stack : error)
  process.exit(1)
}
