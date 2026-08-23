/**
 * This repository never calls `fs.rmSync({recursive})` or `fs.cpSync({recursive})`.
 *
 * ⛔⛔ Both are broken on Windows for paths containing a non-ASCII character, on
 * bands of Node versions wide enough that there is **no safe currently-supported
 * release line to send people to**: the delete is broken from 23.0.0 through
 * 24.13.0, and the copy from 22.17.0 onwards in the 22 line — which is the
 * active LTS and still has it — and again up to 24.14.1. Every version was
 * measured with a real `node.exe`, not read off a changelog.
 *
 * ⭐ Why this file exists rather than a note in a handover: the two calls were
 * replaced one at a time, each after a user hit it, and a third caller added
 * next month would be broken again in exactly the same way. A rule that has to
 * be remembered is a rule that will be skipped, so the judgement lives here
 * instead — new code inherits it for free, and this is the only place anyone
 * has to argue with.
 *
 * ⭐ The way out is {@link ../tools/check-delete.mjs}: it keeps a control group
 * that runs the built-in call on the same tree. When those controls start
 * passing everywhere, Node has been fixed for everyone we support and
 * `removeTree`/`copyTree` — and this check — can all go.
 *
 * A line that genuinely wants the built-in (the control groups do) says so:
 *   // dsh-box:allow-builtin-recursive <为什么>
 *
 * Usage: node tools/check-no-recursive-fs.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LOOK_IN = ['src', 'bin', 'tools']
const ALLOW = 'dsh-box:allow-builtin-recursive'

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  /** @type {string[]} */
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full))
    else if (/\.(js|mjs|cjs)$/.test(entry)) out.push(full)
  }
  return out
}

// ⚠ Deliberately blunt: one line, both halves on it. Every call in this
// repository is written that way, and a pattern that tried to follow the call
// across lines would be the kind of cleverness that quietly stops matching.
const CALL = /\b(rmSync|cpSync)\s*\([^\n]*recursive\s*:\s*(true|!0)/

const offenders = []
for (const dir of LOOK_IN) {
  for (const file of filesUnder(join(ROOT, dir))) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      const hit = CALL.exec(line)
      if (hit === null) return
      // Prose about the defect names the call constantly — this very file does
      // it eight times. Only code counts.
      if (/^\s*(\*|\/\/)/.test(line)) return
      const previous = index === 0 ? '' : lines[index - 1]
      if (line.includes(ALLOW) || previous.includes(ALLOW)) return
      offenders.push({ file: relative(ROOT, file), line: index + 1, call: hit[1], text: line.trim() })
    })
  }
}

console.log('\n没有人再直接调用递归的 rmSync / cpSync\n')
if (offenders.length === 0) {
  console.log('  通过  全仓 0 处;要删树用 removeTree(),要拷树用 copyTree()')
  console.log('\n全部通过\n')
  process.exit(0)
}
for (const one of offenders) {
  console.log(`  不通过  ${one.file}:${one.line}  ${one.call}`)
  console.log(`          ${one.text.slice(0, 100)}`)
}
console.log(`\n${offenders.length} 处直接调用。改用 src/paths.js 的 removeTree()/copyTree(),`)
console.log(`真要用自带的那个就在行尾或上一行写 ${ALLOW} 并说明理由\n`)
process.exit(1)
