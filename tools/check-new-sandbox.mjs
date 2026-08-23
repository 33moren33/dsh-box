/**
 * Two `--new` at the same moment must give two sandboxes, not one.
 *
 * Measured before this was fixed: two `start --new` fired together both wrote
 * `box-<date>-3`, into one directory, with one log file and two dsh processes
 * on the same `DSH_HOME`. The user asked for two cabinets and got one, being
 * written by two engines — the shape of the 08-18 incident, arrived at without
 * anybody deleting anything.
 *
 * The cause was not the port. It was that picking a name and taking it were
 * two steps: `suggestSandboxName` reads what exists, `ensureSandbox` creates
 * with `recursive: true`, and `recursive` does not object to a directory that
 * is already there — so both halves succeed for every racer.
 *
 * ⛔ This check runs a control group that must fail. The old pair is still
 * exported, so the losing behaviour can be reproduced side by side rather than
 * described: if the control ever stops colliding, the harness has stopped
 * measuring and it is the harness that needs fixing, not the celebration.
 * (The same lesson as the config-write check, which was written twice for
 * exactly this reason — the first version passed on the broken code too.)
 *
 * ⛔ No dsh is started, nothing is downloaded, the real `~/.dsh` is not read.
 *
 * Usage:
 *   node tools/check-new-sandbox.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boxLayout, ensureBox } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-new-sandbox.mjs <一次性目录>')
  process.exit(2)
}

rmSync(root, { recursive: true, force: true })

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

const SANDBOX = pathToFileURL(join(HERE, '..', 'src', 'sandbox.js')).href
const PATHS = pathToFileURL(join(HERE, '..', 'src', 'paths.js')).href

/**
 * One racer, in its own process so the race is between processes rather than
 * between two calls in one event loop.
 *
 * The control group holds the gap open on purpose. Left to itself the old
 * code often wins by being fast — which is how a race stays invisible until
 * the day the machine is busy — so the interval between reading the names and
 * creating the directory is widened until the collision is certain. A test
 * that only fails on an unlucky machine is a test nobody believes.
 */
const RACER = `
import { boxLayout } from '${PATHS}'
import { createNewSandbox, ensureSandbox, suggestSandboxName } from '${SANDBOX}'
const [box, mode] = process.argv.slice(1)
const layout = boxLayout(box)
if (mode === 'new') {
  console.log(createNewSandbox(layout, { importSignIn: false }).info.name)
} else {
  const name = suggestSandboxName(layout)
  await new Promise((done) => setTimeout(done, 250))
  console.log(ensureSandbox(layout, name, { importSignIn: false }).info.name)
}
`

/**
 * @param {string} box
 * @param {'new' | 'old'} mode
 * @param {number} racers
 * @returns {Promise<string[]>} the name each racer ended up with.
 */
function race(box, mode, racers) {
  return Promise.all(Array.from({ length: racers }, () => new Promise((done) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', RACER, box, mode], {
      windowsHide: true,
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => done(out.trim().split('\n').at(-1) ?? ''))
  })))
}

console.log('\n同时开两台新沙箱,就得是两台\n')

const RACERS = 6

// 1. ⚠ The control: the old two-step, with the gap held open. It has to lose.
const before = join(root, 'control')
ensureBox(before)
const oldNames = await race(before, 'old', RACERS)
const oldDistinct = new Set(oldNames.filter((name) => name !== ''))
check('⚠ 对照组(旧的两步走)确实撞了——证明这套装置测得到东西',
  oldDistinct.size < RACERS, `${RACERS} 个各自去开,只开出 ${oldDistinct.size} 台`)

// 2. The fix: taking the name and owning it are one step.
const after = join(root, 'atomic')
ensureBox(after)
const newNames = await race(after, 'new', RACERS)
const newDistinct = new Set(newNames.filter((name) => name !== ''))
check('⛔⛔ 同样的并发下,要几台就是几台',
  newDistinct.size === RACERS, `${RACERS} 个各自去开,开出 ${newDistinct.size} 台`)
check('⛔ 每个人拿到的都是自己那台,没有两个人共用一个名字',
  newNames.length === RACERS && newNames.every((name) => name !== ''), newNames.join('、'))

// 3. And the directories agree with what was reported: a name handed back but
//    never created would satisfy the counts above and nothing else.
const onDisk = readdirSync(boxLayout(after).sandboxes).sort()
check('⛔ 磁盘上确实就是那几台,不多不少', onDisk.length === RACERS && onDistinctMatch(onDisk, newDistinct),
  onDisk.join('、'))

/**
 * @param {string[]} dirs
 * @param {Set<string>} reported
 * @returns {boolean}
 */
function onDistinctMatch(dirs, reported) {
  return dirs.every((dir) => reported.has(dir)) && reported.size === dirs.length
}

// 4. Numbering keeps going rather than restarting: a second wave must not
//    collide with the first, which is the same claim one day later.
const second = await race(after, 'new', 2)
check('⭐ 第二波接着往下编号,不跟第一波撞',
  new Set([...newDistinct, ...second]).size === RACERS + 2, second.join('、'))

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
