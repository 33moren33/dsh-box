/**
 * Two `start <the same name>` at once must give one dsh, not two.
 *
 * The sister case of `check-new-sandbox`, and the last one of its family left
 * open. `--new` was fixed by taking the name atomically; this one was not, for
 * a reason that is easy to miss: **the ledger is written after dsh is serving**,
 * because until then there is no pid or port to write. So the check «is this
 * sandbox running?» reads a file that the launch about to happen has not
 * created yet, and two launchers arriving inside those seconds both read "no".
 * Two dsh then share one `DSH_HOME` — the 08-18 shape, and the only failure in
 * this tool that damages data instead of annoying somebody.
 *
 * ⛔ Part one runs a control group that must lose. The naive "look, then write"
 * is reproduced here with its gap held open, so the harness is shown to be
 * capable of catching the bug before the fix is credited with anything. A test
 * that passes on the broken code has measured nothing — twice learned, on the
 * config writes and on `--new`.
 *
 * ⚠️ Part two starts the dsh stand-in for real, so it is slower than the rest
 * and it is the only part that proves the claim is wired into `launch()` rather
 * than merely existing.
 *
 * Usage:
 *   node tools/check-same-sandbox.mjs <一次性目录>
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boxLayout, removeTree } from '../src/paths.js'
import { claimStart, releaseStart } from '../src/sandbox.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-same-sandbox.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
// ⛔ Before anything spawns. This suite races real command lines, and without a
// home of its own every one of them resolves `userDshHome()` to the real
// `~/.dsh` of whoever is running the tests — which on this project's own machine
// is the cabinet the whole tool exists to keep out of harm's way.
useFakeDaily(root)
const made = spawnSync(process.execPath, [join(HERE, 'make-test-box.mjs'), root], {
  stdio: 'ignore', windowsHide: true,
})
if (made.status !== 0) throw new Error(`造不出测试盒:${root}`)
const box = join(root, 'data')
const layout = boxLayout(box)

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

const SANDBOX = pathToFileURL(join(HERE, '..', 'src', 'sandbox.js')).href
const PATHS = pathToFileURL(join(HERE, '..', 'src', 'paths.js')).href

/**
 * One racer trying to take the same cabinet.
 *
 * The control widens the gap between looking and writing on purpose: left to
 * itself the naive version often wins by being quick, which is exactly how this
 * class of bug stays invisible until the machine is busy.
 */
const RACER = `
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boxLayout } from '${PATHS}'
import { claimStart } from '${SANDBOX}'
const [box, mode] = process.argv.slice(1)
const layout = boxLayout(box)
if (mode === 'claim') {
  const won = claimStart(layout, 'shared')
  // ⚠️ Hold it, the way a real launcher does while dsh boots. Without this the
  // winner exits instantly, its pid dies, and everybody after it correctly
  // takes over a claim nobody is holding — which is the intended behaviour for
  // a crashed launcher and a useless measurement here. (Cost me one confusing
  // red: four winners out of six, all of them right.)
  if (won) await new Promise((done) => setTimeout(done, 600))
  console.log(won ? 'won' : 'lost')
} else {
  const file = join(layout.root, 'naive.json')
  const taken = existsSync(file)
  await new Promise((done) => setTimeout(done, 250))
  if (taken) console.log('lost')
  else {
    writeFileSync(file, JSON.stringify({ pid: process.pid }))
    console.log('won')
  }
}
`

/**
 * @param {'claim' | 'naive'} mode
 * @param {number} racers
 * @returns {Promise<string[]>}
 */
function race(mode, racers) {
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

/** The real command line, one JSON line back. */
function cli(...argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        done(JSON.parse(line))
      } catch {
        done({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
}

console.log('\n同一台沙箱,同时开只能开出一台\n')

const RACERS = 6

// 1. ⚠ The control: look-then-write, gap held open. It has to produce more
//    than one winner, or this harness cannot see the bug it was written for.
const naive = await race('naive', RACERS)
const naiveWins = naive.filter((line) => line === 'won').length
check('⚠ 对照组(先看一眼再写)确实撞了——证明这套装置测得到东西',
  naiveWins > 1, `${RACERS} 个里有 ${naiveWins} 个都以为自己拿到了`)

// 2. The claim itself: one exclusive create, so the filesystem picks the winner.
const claimed = await race('claim', RACERS)
const claimWins = claimed.filter((line) => line === 'won').length
check('⛔⛔ 同样的并发下,认领只可能有一个人拿到',
  claimWins === 1, `${RACERS} 个里 ${claimWins} 个拿到`)

// 3. A claim whose launcher is gone must not lock the cabinet forever: nobody
//    should have to delete a file they have never heard of.
releaseStart(layout, 'shared')
writeFileSync(join(layout.sandboxes, 'shared', 'starting.json'),
  `${JSON.stringify({ pid: 999_999, startedAt: new Date().toISOString() })}\n`)
check('⭐ 认领它的进程死了,下一个人拿得走', claimStart(layout, 'shared') === true)
releaseStart(layout, 'shared')
check('⭐ 松手之后文件不留', !existsSync(join(layout.sandboxes, 'shared', 'starting.json')))

// 4. End to end, through the real command line and the dsh stand-in: the claim
//    is only worth anything if `launch()` actually consults it.
const together = await Promise.all([
  cli('start', 'twice', '--version', '9.9.9-stub', '--no-sign-in'),
  cli('start', 'twice', '--version', '9.9.9-stub', '--no-sign-in'),
  cli('start', 'twice', '--version', '9.9.9-stub', '--no-sign-in'),
])
const started = together.filter((answer) => answer.ok === true)
const refused = together.filter((answer) => answer.ok === false)
check('⛔⛔ 三条同时发,只有一条真的起了 dsh',
  started.length === 1, together.map((answer) => (answer.ok === true ? 'ok' : answer.code)).join('、'))
check('⛔ 被拦下的说得出是为什么',
  refused.every((answer) => ['SANDBOX_STARTING', 'SANDBOX_ALREADY_RUNNING'].includes(answer.code)),
  refused.map((answer) => answer.code).join('、'))
check('⛔ 磁盘上只有一台在跑的账本',
  readdirSync(join(layout.sandboxes, 'twice')).includes('running.json'))
check('⭐ 起完之后认领已经松手,不会挡住下一次',
  !existsSync(join(layout.sandboxes, 'twice', 'starting.json')))

const pid = started[0]?.pid
if (Number.isInteger(pid)) await cli('stop', 'twice')

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
