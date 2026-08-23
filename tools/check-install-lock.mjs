/**
 * Only one npm may write the package tree, and the window can see whose.
 *
 * ⛔ **This exists because two of them were measured breaking each other.** A
 * second `plugins install` fired while the first was still resolving died with
 * `EBUSY … rename 'node_modules/cloudflared'` — a dependency *neither* command
 * had been asked for, which is why the exclusion covers the whole tree rather
 * than one package name. The same run also showed the two writing interleaved
 * heartbeats into one log, so a person watching saw the elapsed time jump
 * between 3 seconds and 370.
 *
 * ⭐ **Two control groups are REQUIRED to fail**, or this file proves nothing:
 *
 *   1. a claim left behind by a **dead** process must NOT stop an install —
 *      otherwise one crash makes the tool permanently refuse to install
 *      anything, and the check would pass just as well against `existsSync`;
 *   2. `newPackageLog` on its own must **still wipe** the log — that is what
 *      makes "the refused run left the log alone" a statement about the order
 *      of the gate rather than about the logger being harmless.
 *
 * The day either control passes, this test environment is wrong and every green
 * above it means nothing.
 *
 * ⛔ Never touches the real `~/.dsh`, never runs npm, never opens a socket. The
 * gate is reached long before anything is downloaded, which is exactly why it
 * can be checked offline: what is under test is the order of the first three
 * lines of `installPackage`, not the download.
 *
 * ⚠️ Only the **refused** path may be driven through the real command line —
 * that one returns before `resolveSource`. A run that gets *past* the gate goes
 * straight on to npm, and the first draft of this file did exactly that: it went
 * online, `spawnSync`'s timeout killed the child but not npm underneath it, and
 * the orphan left behind made the cleanup fail with the very `EBUSY` this whole
 * feature exists to prevent. Anything about getting past the gate asks
 * `claimPath` directly.
 *
 * Usage: node tools/check-install-lock.mjs <一次性目录>
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLog, newPackageLog, packageLog } from '../src/logs.js'
import { downloadInFlight, installClaimFile } from '../src/packages.js'
import { boxLayout, ensureBox, removeTree } from '../src/paths.js'
import { claimPath, ensureSandbox, releasePath } from '../src/sandbox.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-install-lock.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
const box = join(root, 'data')
ensureBox(box)
const layout = boxLayout(box)
ensureSandbox(layout, 'lockbox', { importSignIn: false, env: { ...process.env, DSH_HOME: join(root, 'nowhere') } })

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * Run `plugins install` and give back what it said, without letting it near the
 * network: every path here is refused at the gate or fails resolving a name
 * that does not exist, and both answers arrive as JSON.
 * @param {string} name
 */
function install(name) {
  const result = spawnSync(process.execPath,
    [CLI, 'plugins', 'install', name, '--sandbox', 'lockbox', '--box', box, '--json'],
    { windowsHide: true, encoding: 'utf8', timeout: 60_000 })
  const line = (result.stdout ?? '').trim().split('\n').filter((row) => row.startsWith('{')).pop()
  try {
    return JSON.parse(line ?? '{}')
  } catch {
    return {}
  }
}

/** A process id that is certainly nobody: born, watched, and buried. */
function deadPid() {
  const corpse = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true })
  return corpse.pid
}

const claim = installClaimFile(layout)
const log = packageLog(layout.root, 'dsh-memory-pyramid')

console.log('\n一次只许一个 npm 写这棵包树\n')

// ── 闸门本身 ────────────────────────────────────────────────────────────────
check('还没人装的时候,没有「正在下载」', downloadInFlight(layout) === null)

// 这个测试进程自己占住 —— 它当然活着,所以子进程该被拒。
check('占得下', claimPath(claim, { name: 'dsh-memory-pyramid', log }))
check('⭐ 占住之后,窗口读得到是谁在装', downloadInFlight(layout)?.name === 'dsh-memory-pyramid')

// 先往日志里写点东西,一会儿要证明被拒的那条没碰它。
newPackageLog(layout.root, 'dsh-memory-pyramid')
appendLog(log, '第一条正在下载的进度,不许被第二条抹掉')
const before = readFileSync(log, 'utf8')

const refused = install('@linxin666/dsh-web-ui-all')
check('⛔⛔ 有人在装的时候,第二条被拒', refused.code === 'INSTALL_IN_FLIGHT', refused.code ?? '没拒绝')
check('⛔ 拒绝时说得出正在装的是哪个 —— 不然人只会再试一次',
  refused.other === 'dsh-memory-pyramid', String(refused.other))
check('⛔⛔ 被拒的那条没把第一条的进度抹掉(闸门排在开日志之前)',
  readFileSync(log, 'utf8') === before)

// ── 对照组二:日志器本身照样会抹 ──────────────────────────────────────────────
// ⭐ 上面那条断言只有在「日志器本来会抹」时才有意义。这里当场证明它会。
newPackageLog(layout.root, 'dsh-memory-pyramid')
check('⭐ 对照组:newPackageLog 单独调用**依然**清空日志 —— 上一条才算数',
  readFileSync(log, 'utf8') === '')

releasePath(claim)
check('松手之后没有「正在下载」了', downloadInFlight(layout) === null)
check('松手之后占位文件也没了', !existsSync(claim))

// ── 对照组一:死掉的占位不许挡路 ─────────────────────────────────────────────
// ⛔ 这一段**不许**再去 spawn 一条真的 install。第一版就是那么写的,结果它越过闸门
// 之后照样往下走到 resolveSource + npm,真的联了网 —— 而 spawnSync 的 timeout 杀
// 得掉子进程、杀不掉 npm 那个孙进程,于是留下一个还在写 packages 的孤儿,收尾
// removeTree 当场 EBUSY。⭐ 闸门就是 claimPath 本身,直接问它,离线且确定。
const ghost = deadPid()
writeFileSync(claim, `${JSON.stringify({ pid: ghost, name: '早就死了', log }, null, 2)}\n`)
check('⭐ 对照组:死进程留下的占位,窗口不当成「正在下载」',
  downloadInFlight(layout) === null, `ghost pid ${ghost}`)
check('⭐⭐ 对照组:上一次装到一半被杀,下一次照样占得到 —— 一次崩溃不许把工具永久锁死',
  claimPath(claim, { name: '新来的', log }) === true)
check('⭐ 占位换成了新来的那个,不是把死的留在那儿',
  downloadInFlight(layout)?.name === '新来的')
releasePath(claim)
check('⛔ 松手之后占位不留', !existsSync(claim))

// ── ⛔⛔ 真正在写树的是 npm,不是拿着占位的那个 ────────────────────────────────
// 命令行被杀、npm 活着,是 Windows 上的常态(杀父不杀子)。只认持有者 pid 的话,
// 占位当场作废,下一条安装被放行 —— 而那个孤儿 npm 还在写同一棵树。
const liveNpm = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { windowsHide: true })
writeFileSync(claim, `${JSON.stringify({ pid: deadPid(), npm: liveNpm.pid, name: '孤儿的活儿', log }, null, 2)}\n`)
check('⛔⛔ 持有者已死、npm 还活着 —— 照样算「正在下载」',
  downloadInFlight(layout)?.name === '孤儿的活儿')
const stillRefused = install('@linxin666/dsh-web-ui-all')
check('⛔⛔ 这种时候第二条仍然被拒 —— 不然孤儿 npm 和新 npm 会撞在一起',
  stillRefused.code === 'INSTALL_IN_FLIGHT', stillRefused.code ?? '没拒绝')
// ⛔ 等它真的没了再断言,别跟操作系统赛跑:kill() 只是把信号送出去。
await new Promise((done) => {
  liveNpm.once('exit', () => done(null))
  liveNpm.kill()
})
check('⭐ 对照组:那个 npm 也死了之后,占位不再挡路',
  downloadInFlight(layout) === null && claimPath(claim, { name: '接着来', log }) === true)
releasePath(claim)

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
