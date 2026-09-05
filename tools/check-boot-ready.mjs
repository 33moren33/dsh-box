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
 * ⭐⭐⭐ And then the whole question turned out to be answerable by asking dsh.
 * It prints `dsh web: <url>` from a callback hung on its loader having settled,
 * expressly for whoever supervises it — a stronger fact than any outside probe
 * can establish, and one we were already reading, for its token only. So there
 * are now two judges, and **every case below has to say which one answered**:
 * an assertion that only checks "it started" would pass either way, and that is
 * exactly how a road goes dark without anyone being told.
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

import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { abandonStart, launch, servingPortsFromOutput, stop, tokenFromOutput, waitUntilServing } from '../src/launch.js'
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

// ── 1b. Reading dsh's own readiness line ─────────────────────────────────────
// ⭐⭐ 这才是就绪的第一判据:它挂在 loader settle 之后才打,我们从外面探不出这件事。
const ports = (text) => servingPortsFromOutput(text).join(',')
check('⭐ 认得出真机上那行的样子(今天现场抄的,没有斜杠没有令牌)',
  ports('dsh web: http://127.0.0.1:3090') === '3090')
check('带令牌的那种也认(新版会带)',
  ports('dsh web: http://127.0.0.1:3090/?token=Hzc8fmV2_6cZ') === '3090')
check('⚠️ 后面跟着局域网地址时,只取前面那个本机的',
  ports('dsh web: http://127.0.0.1:3090 (LAN: http://192.168.1.7:3090)') === '3090')
check('⛔ 「正在打开浏览器」那行不算——它也是树跑完才打的,但它没有端口,认了就分不出是哪一次',
  ports('dsh web: opening the default browser; pass --no-open to disable') === '')
// ⛔ 这一条是重试留下的坑:一次 start 的两次尝试写同一个日志文件,而重试恰恰是因为
//    上一次抢端口输了。只认那几个字就会把上一次的宣告当成这一次的。
check('⛔⛔ 一次 start 里两次尝试,两行都留着,要按端口分得开',
  ports('dsh web: http://127.0.0.1:3090\nalive\ndsh web: http://127.0.0.1:3091') === '3090,3091')
check('没说过就是没说过', ports('stub dsh listening\nalive') === '')

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
  // ⭐ 判的是「哪个判据答的」,不只是「答了」。这台会印那行,所以必须走 dsh 自己那条;
  //   要是它悄悄退回去探页面,上面那条断言照样通过,而我们就白改了。
  check('⭐⭐ 而且是听 dsh 自己说的,不是我们探出来的',
    started.readyBy === 'announced', String(started.readyBy))
  check('就绪之后账上有它', runningRecord(layout, 'ready-guarded') !== null)
  await stop(started.pid, started.pidBorn)
}

// ── 2b. A release that authenticates and never announces ─────────────────────
// ⛔⛔ 对照组,也是覆盖面的补丁:`printUrl` 是个配置项,关掉之后那行永远不来,
//    探页面就从「第二判据」变成唯一的路。上面那台一印那行就把这条路遮住了——
//    没有这一节,401→令牌→cookie 那一整套从今天起就再没有东西驱动过了。
const quiet = resolveEngine(layout, { version: '9.9.5-quiet' })
let quietStarted = null
try {
  quietStarted = await launch({
    layout,
    sandbox: 'ready-quiet',
    engine: quiet,
    logFile: join(box, 'quiet.log'),
    detached: false,
  })
} catch (error) {
  check('⭐⭐ 不印那行、又要认证的 dsh:探页面这条路还得通', false, error.code ?? String(error))
}
if (quietStarted !== null) {
  check('⭐⭐ 不印那行、又要认证的 dsh:探页面这条路还得通', true, `端口 ${quietStarted.port}`)
  check('⭐ 而且确实是探出来的(证明令牌换 cookie 那一套还活着)',
    quietStarted.readyBy === 'probed', String(quietStarted.readyBy))
  await stop(quietStarted.pid, quietStarted.pidBorn)
}

// ── 2c. A stale announcement from an earlier attempt ─────────────────────────
// ⛔⛔ 这条是补一格实测出来的假绿:把「按端口对上」删掉,上面每一条照样全通过。
//    现场是这样来的——一次 start 的重试和它的第一次写同一个日志文件,而重试恰恰
//    发生在抢端口输了的时候,所以文件里躺着的正是一个端口不同的宣告。
//    只认那几个字,就会拿上一次的宣告宣布这一次已经就绪。
const staleLog = join(box, 'stale.log')
writeFileSync(staleLog, 'dsh web: http://127.0.0.1:59998\nalive\n')
let stale = null
try {
  stale = await launch({
    layout,
    sandbox: 'ready-stale',
    engine: quiet,
    logFile: staleLog,
    detached: false,
  })
} catch (error) {
  stale = { readyBy: error.code ?? String(error), pid: null }
}
check('⛔⛔ 日志里躺着上一次尝试的宣告(端口不同),不许拿它当这一次的',
  stale.readyBy === 'probed', `readyBy=${stale.readyBy}`)
if (stale.pid !== null) await stop(stale.pid, stale.pidBorn)

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

// ⭐⭐ 正对照:同一个端口、同样没人应答,只把「dsh 说了」这一条改成真,就该当场就绪。
//    ⛔ 上面那条(必输)与这条(必赢)差别只有这一个输入,所以它证明的是这条捷径本身,
//    而不是「反正都会通过」。
const stillUp = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
await new Promise((resolve) => { stillUp.once('spawn', resolve) })
let shortcut = null
try {
  shortcut = await waitUntilServing(59_999, stillUp, undefined, {
    timeoutMs: 8000,
    readAnnounced: () => true,
  })
} catch (error) {
  shortcut = error.code ?? String(error)
}
check('⭐⭐ dsh 自己说了在服务,就不必再去探页面(59999 上没有任何东西在听)',
  shortcut === 'announced', String(shortcut))
await stop(stillUp.pid, processStartedAt(stillUp.pid))

await stop(stubborn.pid, processStartedAt(stubborn.pid))

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
