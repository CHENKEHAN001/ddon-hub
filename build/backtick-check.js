/**
 * 检查生成器里的内联脚本模板有没有嵌套反引号。
 *
 * 为什么需要：页面脚本放在模板字面量里，区里任何一个反引号都会提前闭合它，
 * 生成出来的是「标记正常、脚本全废」的文件——页面看起来活着却什么都不动。
 * 这个错已经犯了四次，每次都要从"页面为什么不动"倒查回去，太费事。
 *
 * 实现说明（前两版都错在这里）：起点是「整行就是一个赋值加反引号」，
 * 终点是「反引号出现在行尾」——生成器里 CSS 区的闭合写成 `}` 加反引号，
 * 反引号并不独占一行。要求独占领一行会把 CSS 模板判成永不闭合，
 * 于是后面所有反引号都被误报成体内违规。
 *
 * Run with: node build/backtick-check.js
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const FILES = ['make-offline.js']

/** 起点：整行形如 `const NAME = \`` 或 `const NAME = String.raw\``。 */
const OPEN = /^const\s+(\w+)\s*=\s*(?:String\.raw)?`$/

/**
 * 从 `from` 行之后找模板的闭合位置。
 * 闭合 = 某行的最后一个字符是反引号。返回行号与行尾那段文字。
 */
function findClose(lines, from) {
  for (let i = from + 1; i < lines.length; i += 1) {
    const text = lines[i].replace(/\s+$/, '')
    if (text.endsWith('`')) return { line: i, tail: text.slice(-40) }
  }
  return null
}

function checkFile(file) {
  const full = path.join(__dirname, file)
  const lines = fs.readFileSync(full, 'utf8').split('\n')
  const problems = []
  let checked = 0

  for (let i = 0; i < lines.length; i += 1) {
    const match = OPEN.exec(lines[i].trim())
    if (match === null) continue

    const name = match[1]
    const close = findClose(lines, i)
    if (close === null) {
      problems.push({ name, start: i + 1, line: lines.length, text: '(模板没有闭合)' })
      break
    }

    /* 体内不允许出现反引号——闭合行的那个除外 */
    for (let k = i + 1; k <= close.line; k += 1) {
      const body = lines[k]
      const isCloseLine = k === close.line
      const hits = isCloseLine ? body.slice(0, body.lastIndexOf('`')) : body
      if (hits.includes('`')) {
        problems.push({ name, start: i + 1, line: k + 1, text: lines[k].trim().slice(0, 90) })
      }
    }

    checked += 1
    console.log(`  ok  ${name}（第 ${i + 1}–${close.line + 1} 行）内无嵌套反引号`)
    i = close.line
  }

  if (checked === 0) problems.push({ name: '(无)', start: 0, line: 0, text: '一个模板字面量都没找到，检查器的起点规则可能过时了' })
  return problems
}

function main() {
  const problems = []
  for (const file of FILES) problems.push(...checkFile(file))

  if (problems.length > 0) {
    console.error('\nFAIL:')
    for (const p of problems) {
      console.error(`  ${p.name}（从第 ${p.start} 行开始）第 ${p.line} 行:`)
      console.error(`      ${p.text}`)
    }
    console.error('\n把那个反引号改成「」或去掉。注释里出现也算。')
    process.exit(1)
  }
  console.log('  内联脚本模板干净')
}

try {
  main()
} catch (error) {
  console.error('backtick-check failed:', error && error.stack ? error.stack : error)
  process.exit(1)
}
