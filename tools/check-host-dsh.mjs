/**
 * Prove the machine axis: which dsh installation a launch runs on.
 *
 * There are two kinds now — the one the user installed themselves, and the
 * releases this tool downloads — and telling them apart is not cosmetic. They
 * can carry the same version number while being different trees on disk, so a
 * ledger that records only the number makes two separate mistakes: it refuses
 * to delete our download because a sandbox is "using it" when the sandbox is
 * using theirs, and it skips clearing the module pointer layer when switching
 * between them, leaving a home resolving packages out of the wrong tree.
 *
 * ⛔ Nothing here touches the dsh actually installed on this machine, and
 * nothing is launched. Detection is driven with an injected environment
 * pointing at a stand-in install built inside the test box, so the result is
 * the same on a machine with no dsh at all.
 *
 * ⚠️ The stand-in is laid out for whichever platform this runs on (npm puts the
 * shims beside the packages on Windows and in `bin/` elsewhere). Running it on
 * Linux or macOS therefore exercises those branches for the first time — they
 * are written from documentation, not from having been used.
 *
 * Usage — ⚠️ 每次都要新盒子,最后一项会把 `9.9.8-broken` 删掉:
 *   node tools/make-test-box.mjs <一次性目录> --broken
 *   node tools/check-host-dsh.mjs <一次性目录>/data
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectHostDsh, engineRecord, resolveEngine, sameEngine } from '../src/host.js'
import { boxLayout, sandboxPaths } from '../src/paths.js'
import { switchesEngine } from '../src/sandbox.js'
import { deleteVersion } from '../src/versions.js'

const box = process.argv[2]
if (box === undefined || !existsSync(box)) {
  console.error('用法: node tools/check-host-dsh.mjs <测试盒>/data')
  process.exit(2)
}

const layout = boxLayout(box)
let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n机器这一轴:探得到、认得出、不混淆\n')

// ── A stand-in for "the dsh the user installed" ──────────────────────────────
const windows = process.platform === 'win32'
const prefix = join(box, 'pretend-npm-prefix')
const shimDir = windows ? prefix : join(prefix, 'bin')
const modules = windows ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
const pkgDir = join(modules, '@deepseek-ai', 'dsh')

// The entry is deliberately NOT at `lib/bin.js`: the reason for preferring the
// user's own installation is that it might be a build they changed, and a
// changed build is the one that would move its entry point. Reading the
// manifest is what makes that work; guessing the path would pass this test
// only by accident.
const ENTRY_REL = 'cli/entry.js'
const HOST_VERSION = '0.1.0-rc.9-pretend'

mkdirSync(shimDir, { recursive: true })
mkdirSync(join(pkgDir, 'cli'), { recursive: true })
for (const name of windows ? ['dsh', 'dsh.cmd', 'dsh.ps1'] : ['dsh']) {
  writeFileSync(join(shimDir, name), '# stand-in shim, never executed\n')
}
writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({
  name: '@deepseek-ai/dsh', version: HOST_VERSION, bin: { dsh: ENTRY_REL },
}, null, 2)}\n`)
writeFileSync(join(pkgDir, ENTRY_REL), '// stand-in entry, never executed\n')

/** Write a sibling package into the stand-in's nested modules, npm's layout. */
const sibling = (name, version) => {
  const dir = join(pkgDir, 'node_modules', '@deepseek-ai', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: `@deepseek-ai/${name}`, version })}\n`)
}

const env = { PATH: shimDir, Path: shimDir }

// ── 1. Nothing installed ─────────────────────────────────────────────────────
const nowhere = detectHostDsh({ env: { PATH: join(box, 'definitely-not-here') } })
check('没装的时候说没装', nowhere.found === false)
check('说得出去哪儿找过了', nowhere.looked.length > 0, `${nowhere.looked.length} 处`)

// ── 2. Found, and read rather than guessed ───────────────────────────────────
let host = detectHostDsh({ env })
check('从 PATH 上的 shim 找到了那台', host.found === true, host.dir ?? '')
check('版本是读出来的', host.version === HOST_VERSION, String(host.version))
check('入口是从 package.json 的 bin 读的,不是猜 lib/bin.js',
  host.entry === join(pkgDir, ENTRY_REL), String(host.entry))

// ── 3. The pin check, in three states rather than two ────────────────────────
check('没有兄弟包时报「核对不了」,而不是报「混杂」',
  host.verified === false && host.pinned === false, `packages=${host.packages}`)

sibling('dsh-alpha', HOST_VERSION)
sibling('dsh-beta', HOST_VERSION)
host = detectHostDsh({ env })
check('兄弟包版本一致时核对通过',
  host.verified === true && host.pinned === true && host.packages === 2, `packages=${host.packages}`)

sibling('dsh-gamma', '0.1.0-rc.1-other')
host = detectHostDsh({ env })
check('掺进一个别的版本就报混杂,并指名道姓',
  host.pinned === false && host.mixed.some((w) => w.name === '@deepseek-ai/dsh-gamma'),
  host.mixed.map((w) => `${w.name}@${w.found}`).join('、'))

// ── 4. Which installation a launch resolves to ───────────────────────────────
const hostEngine = resolveEngine(layout, { env })
check('不给版本号就是你自己那台', hostEngine.kind === 'host' && hostEngine.entry === host.entry)

const releaseEngine = resolveEngine(layout, { version: '9.9.9-stub', env })
check('给了版本号就是我们下载的那份', releaseEngine.kind === 'release' && releaseEngine.version === '9.9.9-stub')

let refused = null
try {
  resolveEngine(layout, { version: '0.0.0-never-downloaded', env })
} catch (error) {
  refused = error.code
}
check('要一个没下载过的版本会被拒绝', refused === 'VERSION_NOT_DOWNLOADED', String(refused))

// ── 5. Same number, different machine ────────────────────────────────────────
const twinHost = { kind: 'host', version: '9.9.9-stub', dir: pkgDir }
const twinRelease = engineRecord(releaseEngine)
check('同一个版本号、两套安装,认得出不是同一台',
  sameEngine(twinHost, twinRelease) === false && twinHost.version === twinRelease.version)

const twinBox = sandboxPaths(layout, 'engine-twin')
mkdirSync(twinBox.home, { recursive: true })
writeFileSync(twinBox.state, `${JSON.stringify({ lastEngine: twinHost, lastVersion: '9.9.9-stub' }, null, 2)}\n`)
check('换台但版本号没变,仍然算换了(所以会清模块指针)',
  switchesEngine(layout, 'engine-twin', releaseEngine) === true)
check('同一台再启动一次不算换',
  switchesEngine(layout, 'engine-twin', { kind: 'host', version: '9.9.9-stub', dir: pkgDir }) === false)

writeFileSync(twinBox.state, `${JSON.stringify({ lastVersion: '9.9.9-stub' }, null, 2)}\n`)
check('老沙箱没有机器记录,按「当年只有下载版」解读',
  switchesEngine(layout, 'engine-twin', releaseEngine) === false
  && switchesEngine(layout, 'engine-twin', hostEngine) === true)

// ── 6. The delete guard must object to the right thing ───────────────────────
// A live process is needed for a running record to be believed; this script is
// one, and it is never signalled — only read.
const running = (engine) => writeFileSync(
  join(twinBox.root, 'running.json'),
  `${JSON.stringify({
    pid: process.pid, port: 3099, url: 'http://127.0.0.1:3099', version: '9.9.8-broken', engine,
  }, null, 2)}\n`,
)

running({ kind: 'release', version: '9.9.8-broken', dir: join(layout.versions, '9.9.8-broken') })
let blocked = null
try {
  await deleteVersion(layout, '9.9.8-broken')
} catch (error) {
  blocked = error.code
}
check('沙箱正用着我们这份下载 → 不许删', blocked === 'VERSION_IN_USE', String(blocked))

running({ kind: 'host', version: '9.9.8-broken', dir: pkgDir })
let deleted = true
try {
  await deleteVersion(layout, '9.9.8-broken')
} catch (error) {
  deleted = false
  check('沙箱用的是别人那台 → 我们这份该删得掉', false, error.code)
}
if (deleted) {
  check('沙箱用的是别人那台、只是版本号撞了 → 我们这份删得掉',
    !existsSync(join(layout.versions, '9.9.8-broken')))
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
