/**
 * Prove the two halves of "did it start" — the yes, and the giving up.
 *
 * ⭐⭐ Readiness is not a port. dsh binds its port the moment the web server's
 * own fiber activates, while the plugin tree is still loading, so the judge
 * reads the index and looks for the marker the page carries once it is
 * composed. That much was already true. What changed underneath it: **newer dsh
 * answers the index with 401** until a session exists, and a session comes from
 * a token dsh prints exactly once, on its own stdout. Against such a release the
 * old judge could never say yes — it reported a healthy dsh, serving happily,
 * as one that failed to start within two minutes. Measured on `0.1.2-alpha.1`.
 *
 * ⛔ And the giving-up path has to leave nothing behind. The ledger is written
 * only after a launch is known to have worked, so a launch that fails after
 * spawning leaves a live process no row names — `stop` cannot reach it, the
 * window cannot see it, and the next launch meets a taken port. Measured twice
 * in one afternoon on a real machine.
 *
 * ⛔ Nothing real is touched: every dsh here is a stand-in of a few lines,
 * planted by `make-test-box.mjs`, and every port is one the test found free.
 *
 * Usage — ⚠️ 需要带 --guarded --silent 的盒子:
 *   node tools/make-test-box.mjs <一次性目录> --guarded --silent
 *   node tools/check-boot-ready.mjs <一次性目录>/data
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { abandonStart, launch, stop, tokenFromOutput, waitUntilServing } from '../src/launch.js'
import { resolveEngine } from '../src/host.js'
import { boxLayout } from '../src/paths.js'
import { processStartedAt } from '../src/process-identity.js'
import { runningRecord } from '../src/sandbox.js'
import { useFakeDaily } from './fake-daily.mjs'

const box = process.argv[2]
if (box === undefined || !existsSync(box)) {
  console.error('用法: node tools/check-boot-ready.mjs <测试盒>/data')
  process.exit(2)
}

// ⛔ Before anything reads anything. Nothing here means to touch the daily
// cabinet, but "means to" is not a property a suite has — the one that read the
// real `~/.dsh` for weeks did not mean to either, and passed the whole time.
useFakeDaily(dirname(box))

const layout = boxLayout(box)
let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

const alive = (pid) => processStartedAt(pid) !== null

console.log('\n「起好了没有」这件事的两半\n')

// ── 1. Reading the key out of what dsh said ──────────────────────────────────
// ⛔ Taken from dsh's own line, never constructed: it is a different value every
// launch and exists nowhere else.
check('从 dsh 打印的那行里取得出令牌',
  tokenFromOutput('dsh web: http://127.0.0.1:3090/?token=Hzc8fmV2_6cZ') === 'Hzc8fmV2_6cZ')
check('没有令牌的输出就说没有',
  tokenFromOutput('dsh web: opening the default browser') === null)
check('⚠️ 别把别的查询参数当令牌',
  tokenFromOutput('http://127.0.0.1:3090/?theme=dark') === null)

// ── 2. A release that authenticates ──────────────────────────────────────────
// ⭐⭐ The case the old judge could not pass. Driven through `launch`, not
// through the judge alone, because the key has to travel from dsh's stdout,
// into the log file, back out again — and every one of those steps is a place
// it can silently stop arriving.
const guarded = resolveEngine(layout, { version: '9.9.7-guarded' })
let started = null
try {
  started = await launch({
    layout,
    sandbox: 'ready-guarded',
    engine: guarded,
    logFile: join(box, 'guarded.log'),
    detached: false,
  })
  check('⭐⭐ 要认证才给页面的 dsh:照样判得出「已就绪」', true, `端口 ${started.port}`)
} catch (error) {
  check('⭐⭐ 要认证才给页面的 dsh:照样判得出「已就绪」', false, error.code ?? String(error))
}
if (started !== null) {
  check('就绪之后账上有它', runningRecord(layout, 'ready-guarded') !== null)
  await stop(started.pid, started.pidBorn)
}

// ── 3. A release that listens but never finishes ─────────────────────────────
// The judge must say no to this, and it is the exact shape a port check calls
// success: the socket answers, with a page that is not the finished one.
const silent = resolveEngine(layout, { version: '9.9.6-silent' })
let waited = null
let child = null
let abandonedPid = null
try {
  await launch({
    layout,
    sandbox: 'ready-silent',
    engine: silent,
    logFile: join(box, 'silent.log'),
    detached: false,
  })
  waited = 'STARTED_ANYWAY'
} catch (error) {
  waited = error.code ?? String(error)
  abandonedPid = error.details?.startedPid ?? null
}
check('⭐ 端口通了、页面不是成品 → 不算起好了', waited !== 'STARTED_ANYWAY', String(waited))
// ⭐⭐ The whole reason this case is allowed to cost two minutes: it is the only
// place the real launch path, the real timeout, and the cleanup meet. Asserted
// on the process, not on a returned flag — the defect being guarded was a dsh
// still serving while `ls` reported nothing running.
check('⭐⭐ 超时之后没给谁留下一台还在跑的 dsh',
  abandonedPid !== null && !alive(abandonedPid), `pid ${abandonedPid}`)
check('账上也没留下它', runningRecord(layout, 'ready-silent') === null)

// ── 4. Giving up leaves nothing running ──────────────────────────────────────
// ⭐ Driven against a live process on purpose. A cleanup proven only against a
// process that had already died proves nothing: that is the case where doing
// nothing also passes.
const { spawn } = await import('node:child_process')
child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
await new Promise((resolve) => { child.once('spawn', resolve) })
check('先确认这个替身真的活着', alive(child.pid), `pid ${child.pid}`)

const failure = Object.assign(new Error('假装没起来'), { code: 'BOOT_TIMEOUT', details: {} })
failure.constructor = undefined
const said = []
// ⚠️ A plain Error, not a BoxError: what is being proved is the killing and the
// saying, and those must not depend on the error's class.
const stopped = await abandonStart(child, failure, (line) => said.push(line))
check('⭐⭐ 放弃时把自己起的那台停掉', stopped === true && !alive(child.pid))
check('⭐ 并且说出来了(否则调用方以为什么都没发生,会再敲一次)',
  said.some((line) => line.includes(String(child.pid))), said.join(' / '))

// ── 5. The judge's own timeout, on a process that stays up ───────────────────
const stubborn = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
await new Promise((resolve) => { stubborn.once('spawn', resolve) })
let timedOut = null
try {
  // Nothing is listening on this port at all, which is the strongest form of
  // "not ready" and must not be confused with "the process died".
  await waitUntilServing(59_999, stubborn, undefined, { timeoutMs: 1200 })
} catch (error) {
  timedOut = error.code
}
check('没人应答时,超时报的是超时,不是「它退出了」', timedOut === 'BOOT_TIMEOUT', String(timedOut))
await stop(stubborn.pid, processStartedAt(stubborn.pid))

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
