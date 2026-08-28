/**
 * Prove the third answer on the machine axis: a dsh somebody points at.
 *
 * Until now "which dsh" meant "which dsh we found ourselves" — the one on this
 * computer, or one we downloaded. Both are ours to locate, which quietly made
 * every dsh we did not know about unusable: a build made from source (the only
 * way to run a release that is tagged but never published) and the copy that
 * ships inside an application.
 *
 * ⭐ What this suite is really guarding is that **three questions stay
 * separate**: where the tree is, how its version is read, and which interpreter
 * starts it. They were one question while there were only two kinds, and the
 * cheapest way to break this feature is to answer any of them with a guess
 * derived from another.
 *
 * ⛔ Nothing real is touched. Every tree below is built inside the throwaway
 * directory it is given, including a stand-in application — a folder with an
 * archive file, an executable, and unpacked resources. The Windows branch is
 * driven by passing the platform in, so it is exercised on every machine
 * rather than only on the one it was written for.
 *
 * Usage:
 *   node tools/check-engine-path.mjs <一次性目录>
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { looksLikePath, resolvePathEngine } from '../src/engine-path.js'
import { boxLayout, sandboxPaths } from '../src/paths.js'
import { forgetEngine, noteRunning } from '../src/sandbox.js'
import { processStartedAt } from '../src/process-identity.js'
import { resolveEngine } from '../src/host.js'

const box = process.argv[2]
if (box === undefined || !existsSync(box)) {
  console.error('用法: node tools/check-engine-path.mjs <一次性目录>')
  process.exit(2)
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** What a pin report looks like when there is no engine to report on. */
const UNRESOLVED = { verified: false, pinned: false, packages: -1, mixed: [] }

/** Whatever it threw, as a code. Returning the code makes a wrong refusal visible. */
const refusal = (run) => {
  try {
    run()
    return null
  } catch (error) {
    return error.code ?? 'THREW_WITHOUT_CODE'
  }
}

/**
 * Resolve one that is supposed to succeed, and say so as a line rather than a
 * stack trace when it does not.
 *
 * ⭐ Found by breaking this suite on purpose: with the resolver made to prefer
 * the archive over the files on disk, the application case threw, the script
 * died on the spot, and what came out was a Node stack — no failing assertion,
 * and none of the twenty checks below it ran. A guard that dies instead of
 * going red still fails the run, but it fails it without saying which promise
 * was broken.
 * @param {string} what
 * @param {() => import('../src/engine-path.js').PathEngine} run
 * @returns {import('../src/engine-path.js').PathEngine | null}
 */
const mustResolve = (what, run) => {
  try {
    return run()
  } catch (error) {
    check(`${what}:应该认得出来,却被拒了`, false, error.code ?? String(error))
    return null
  }
}

/** Stand-in for the fields of an engine that could not be resolved at all. */
const NOTHING = { kind: null, version: null, dir: null, entry: '', exec: '', execEnv: {}, pin: UNRESOLVED }

console.log('\n给一个文件夹,认出里面那台 dsh\n')

// ── 1. A release number and a folder are told apart with no rule to write ────
// ⛔ This is the whole reason there is one flag rather than two. If it ever
// stops holding, the fix is a second flag, not a longer regular expression.
for (const version of ['0.1.1-rc.2', '0.1.2-alpha.1', '1.0.0', 'latest']) {
  check(`「${version}」当版本号`, looksLikePath(version) === false)
}
for (const path of ['E:\\a\\b', '/home/me/dsh', './build', '../dsh', 'C:\\dsh', '.']) {
  check(`「${path}」当文件夹`, looksLikePath(path) === true)
}

// ── 2. The three shapes a tree comes in ──────────────────────────────────────
/**
 * Write a dsh package, with siblings, the way one layout would leave it.
 * @param {string} dir - the package directory itself.
 * @param {string} version
 * @param {string} entryRel - deliberately not `lib/bin.js` everywhere: the
 * entry is read from the manifest, and a guess would pass only by luck.
 * @param {string} siblingBase - directory whose `node_modules/@deepseek-ai` the
 * pin check should find.
 * @param {number} siblings
 * @param {string | null} odd - a sibling on a different version, or nothing.
 */
const writeTree = (dir, version, entryRel, siblingBase, siblings, odd = null) => {
  mkdirSync(join(dir, entryRel, '..'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh', version, bin: { dsh: entryRel },
  }, null, 2)}\n`)
  writeFileSync(join(dir, entryRel), '// stand-in entry, never executed\n')
  for (let i = 0; i < siblings; i += 1) {
    const sibling = join(siblingBase, 'node_modules', '@deepseek-ai', `dsh-part-${i}`)
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, 'package.json'), `${JSON.stringify({ name: `@deepseek-ai/dsh-part-${i}`, version })}\n`)
  }
  if (odd !== null) {
    const stray = join(siblingBase, 'node_modules', '@deepseek-ai', 'dsh-stray')
    mkdirSync(stray, { recursive: true })
    writeFileSync(join(stray, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-stray', version: odd })}\n`)
  }
  // The base framework, which is versioned independently on purpose. It must
  // never be counted: counting it reports every correct installation as mixed.
  // ⛔ Measured on a real desktop build — 190 packages agreeing, five "offenders",
  // all of them this.
  const base = join(siblingBase, 'node_modules', '@deepseek-ai', 'cordis')
  mkdirSync(base, { recursive: true })
  writeFileSync(join(base, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/cordis', version: '4.0.1' })}\n`)
}

// (a) A source workspace: the package sits two levels down and is not installed.
const workspace = join(box, 'source-workspace')
const workspacePkg = join(workspace, 'apps', 'cli')
writeTree(workspacePkg, '9.9.1-source', join('lib', 'bin.js'), workspacePkg, 3)
const fromWorkspace = mustResolve('源码工作树', () => resolvePathEngine(workspace)) ?? NOTHING
check('源码工作树:往下找得到那个包', fromWorkspace.version === '9.9.1-source', String(fromWorkspace.version))
check('源码工作树:算普通树,用我们自己的 node',
  fromWorkspace.kind === 'tree' && fromWorkspace.exec === process.execPath, fromWorkspace.kind)
check('源码工作树:记下的是你给的那个文件夹,不是包的深路径',
  fromWorkspace.dir === workspace, fromWorkspace.dir)
check('源码工作树:入口是读出来的', fromWorkspace.entry === join(workspacePkg, 'lib', 'bin.js'))
check('源码工作树:钉版数得到,且不把基座算进去',
  fromWorkspace.pin.verified && fromWorkspace.pin.pinned && fromWorkspace.pin.packages === 3,
  `packages=${fromWorkspace.pin.packages}`)

// (b) An ordinary install: the package is under `node_modules`, siblings hoisted.
const installed = join(box, 'installed')
writeTree(join(installed, 'node_modules', '@deepseek-ai', 'dsh'), '9.9.2-installed', join('lib', 'bin.js'), installed, 2)
const fromInstalled = mustResolve('装机树', () => resolvePathEngine(installed)) ?? NOTHING
check('装机树:认得出', fromInstalled.version === '9.9.2-installed' && fromInstalled.kind === 'tree')
// ⚠️ Three, not two: in this layout the root package sits in the same
// `node_modules` as its siblings, so it counts itself. In the workspace above it
// does not, because it lives outside the directory being counted.
check('装机树:兄弟包在上一层也数得到',
  fromInstalled.pin.packages === 3, `packages=${fromInstalled.pin.packages}`)

// (c) An application: an archive, an executable, and the real files unpacked.
/**
 * @param {string} dir
 * @param {boolean} withTree - whether this build unpacked what it declared.
 */
const writeApp = (dir, withTree) => {
  mkdirSync(join(dir, 'resources'), { recursive: true })
  writeFileSync(join(dir, 'resources', 'app.asar'), 'not really an archive\n')
  writeFileSync(join(dir, 'Some App.exe'), 'stand-in executable, never run\n')
  // The uninstaller must not be mistaken for the application itself.
  writeFileSync(join(dir, 'Uninstall Some App.exe'), 'stand-in uninstaller\n')
  if (!withTree) return
  const unpacked = join(dir, 'resources', 'app.asar.unpacked')
  writeTree(join(unpacked, 'node_modules', '@deepseek-ai', 'dsh'), '9.9.3-app', join('lib', 'bin.js'), unpacked, 4)
}

const app = join(box, 'good-app')
writeApp(app, true)
const fromApp = mustResolve('应用', () => resolvePathEngine(app, { platform: 'win32' })) ?? NOTHING
check('应用:在 app.asar.unpacked 里找到真文件', fromApp.version === '9.9.3-app', String(fromApp.version))
check('⭐⭐ 应用:用它自带的程序跑,不是我们的 node',
  fromApp.exec === join(app, 'Some App.exe') && fromApp.exec !== process.execPath, fromApp.exec)
check('⭐ 应用:卸载器没被当成它自己', !fromApp.exec.includes('Uninstall'))
check('应用:环境里带着「当普通 node 用」那个开关',
  fromApp.execEnv.ELECTRON_RUN_AS_NODE === '1', JSON.stringify(fromApp.execEnv))
check('⭐⭐ 应用:入口仍然是硬盘上的真文件,不是档案里的路径',
  fromApp.entry !== '' && existsSync(fromApp.entry) && !fromApp.entry.includes('app.asar' + (process.platform === 'win32' ? '\\' : '/')),
  fromApp.entry)
check('应用:算 app 这一档', fromApp.kind === 'app', fromApp.kind)

// ── 3. Refusals, each naming its own reason ──────────────────────────────────
check('文件夹不存在 → 说不存在',
  refusal(() => resolvePathEngine(join(box, 'nowhere-at-all'))) === 'ENGINE_PATH_MISSING')

const empty = join(box, 'empty')
mkdirSync(empty, { recursive: true })
check('文件夹在但没有 dsh → 说没找到',
  refusal(() => resolvePathEngine(empty)) === 'NO_DSH_IN_PATH')

const unbuilt = join(box, 'unbuilt')
mkdirSync(unbuilt, { recursive: true })
writeFileSync(join(unbuilt, 'package.json'), `${JSON.stringify({
  name: '@deepseek-ai/dsh', version: '9.9.4-unbuilt', bin: { dsh: 'lib/bin.js' },
}, null, 2)}\n`)
check('⭐ 声明了入口但那个文件不在(源码没构建)→ 说的是这件事,不是「没找到 dsh」',
  refusal(() => resolvePathEngine(unbuilt)) === 'ENGINE_ENTRY_MISSING')

const noExe = join(box, 'app-without-exe')
mkdirSync(join(noExe, 'resources'), { recursive: true })
writeFileSync(join(noExe, 'resources', 'app.asar'), 'not really an archive\n')
check('像应用但认不出该跑哪个程序 → 说这件事',
  refusal(() => resolvePathEngine(noExe, { platform: 'win32' })) === 'ENGINE_APP_NO_EXE')

check('⚠️ 认应用只在 Windows 上做过 → 别的平台明说,不猜',
  refusal(() => resolvePathEngine(app, { platform: 'linux' })) === 'ENGINE_APP_PLATFORM')

// ⭐⭐ The one that must refuse rather than start: an application whose build
// left the tree inside the archive. Starting it would fill a cabinet with links
// into the archive — every one dead, because links are resolved by the
// operating system, which cannot see inside one — and fail two minutes later
// naming a package instead of the reason. Here the stand-in executable cannot
// answer, which is its own refusal; what is guarded is that it never resolves.
const sealed = join(box, 'sealed-app')
writeApp(sealed, false)
const sealedCode = refusal(() => resolvePathEngine(sealed, { platform: 'win32' }))
check('⭐⭐ 树只在档案里的应用 → 一定被拒,绝不放行',
  sealedCode !== null && ['ENGINE_INSIDE_ARCHIVE', 'NO_DSH_IN_PATH', 'ENGINE_APP_UNREADABLE'].includes(sealedCode),
  String(sealedCode))

// ── 4. The pin check reports; it never refuses ───────────────────────────────
// ⛔ The opposite of the download path, and deliberately so. An unpinned tree we
// downloaded is a bug in our own code; somebody else's tree is not ours to fail,
// and a workspace legitimately keeps its packages where this cannot count them.
const mixed = join(box, 'mixed-tree')
writeTree(join(mixed, 'node_modules', '@deepseek-ai', 'dsh'), '9.9.5-mixed', join('lib', 'bin.js'), mixed, 2, '0.0.0-other')
const fromMixed = mustResolve('版本混杂的树', () => resolvePathEngine(mixed)) ?? NOTHING
check('⭐ 版本混杂:照样起得来(报告,不拒绝)', fromMixed.version === '9.9.5-mixed')
check('版本混杂:如实说不一致,并指名道姓',
  fromMixed.pin.verified && !fromMixed.pin.pinned
  && fromMixed.pin.mixed.some((one) => one.name === '@deepseek-ai/dsh-stray'),
  fromMixed.pin.mixed.map((one) => `${one.name}@${one.found}`).join('、'))

const lonely = join(box, 'lonely-tree')
writeTree(join(lonely, 'node_modules', '@deepseek-ai', 'dsh'), '9.9.6-lonely', join('lib', 'bin.js'), lonely, 0)
const fromLonely = mustResolve('没有兄弟包的树', () => resolvePathEngine(lonely)) ?? NOTHING
check('⭐ 数不到兄弟包:说「证实不了」,不说「混杂」',
  fromLonely.pin.verified === false && fromLonely.pin.pinned === false,
  `packages=${fromLonely.pin.packages}`)

// ── 5. The same flag carries both, and the axis stays one axis ───────────────
const layout = boxLayout(join(box, 'data'))
const viaFlag = mustResolve('--version 收路径', () => resolveEngine(layout, { version: workspace })) ?? NOTHING
check('⭐⭐ --version 收到路径就走这条路', viaFlag.kind === 'tree' && viaFlag.version === '9.9.1-source')
check('⭐ 版本号那条老路没被改坏',
  refusal(() => resolveEngine(layout, { version: '0.0.0-never-downloaded' })) === 'VERSION_NOT_DOWNLOADED')

// ⛔ Every engine handed to `launch` must carry an interpreter, or the launch
// falls back to whatever the previous line happened to leave — which is exactly
// how a dsh gets started with the wrong Node and fails somewhere unrelated.
for (const [name, engine] of [['源码树', fromWorkspace], ['应用', fromApp], ['路径经 --version', viaFlag]]) {
  check(`${name}:带着解释器和它要的环境`,
    typeof engine.exec === 'string' && engine.exec !== '' && typeof engine.execEnv === 'object')
}

// -- 6. 拿走一台机器:规则只有一条,后果看它是谁的 ------------------------------
// 和拿走一个插件同一条规则,这正是重点:我们下载的真删(我们放的),别人的只抹掉
// 我们自己那条记录。而抹记录必须连着清模块指针层——switchesEngine 在**没有记录**
// 时回答「没换机器」,所以只抹不清,会让下一次换树启动跳过清理,那个档案柜就从
// 上一棵树的残留里解析包。
const dataDir = join(box, 'forget-data')
const forgetLayout = boxLayout(dataDir)
mkdirSync(join(dataDir, 'sandboxes'), { recursive: true })

/**
 * 摆一个「用过某台机器」的沙箱:状态文件 + 一层假的模块指针。
 * @param {string} name
 * @param {{kind: string, version: string, dir: string}} engine
 */
const sandboxUsing = (name, engine) => {
  const paths = sandboxPaths(forgetLayout, name)
  mkdirSync(paths.home, { recursive: true })
  mkdirSync(join(paths.home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-part-0'), { recursive: true })
  writeFileSync(paths.state, JSON.stringify({
    lastVersion: engine.version, lastEngine: engine, lastUsed: '2026-08-28T00:00:00.000Z',
  }, null, 2) + '\n')
  return paths
}

const pointedAt = join(box, 'good-app')
const usedA = sandboxUsing('used-it-a', { kind: 'app', version: '9.9.3-app', dir: pointedAt })
const usedB = sandboxUsing('used-it-b', { kind: 'app', version: '9.9.3-app', dir: pointedAt })
const untouched = sandboxUsing('used-something-else', { kind: 'tree', version: '9.9.1-source', dir: workspace })

const gone = forgetEngine(forgetLayout, pointedAt)
check('忘掉一个文件夹:用过它的沙箱都被清了记录',
  gone.forgotten.slice().sort().join('、') === 'used-it-a、used-it-b', gone.forgotten.join('、'))
check('⭐⭐ 连模块指针层一起清掉(只抹记录会让下次启动跳过清理)',
  gone.cleared.length === 2
  && !existsSync(join(usedA.home, 'profiles', 'node_modules'))
  && !existsSync(join(usedB.home, 'profiles', 'node_modules')),
  gone.cleared.join('、'))
check('⛔⛔ 你指的那个文件夹一个字节都没动',
  existsSync(pointedAt) && existsSync(join(pointedAt, 'resources', 'app.asar')))
check('没用过它的沙箱不受影响',
  existsSync(join(untouched.home, 'profiles', 'node_modules'))
  && JSON.parse(readFileSync(untouched.state, 'utf8')).lastEngine !== undefined)

const again = forgetEngine(forgetLayout, pointedAt)
check('再忘一次:没有可忘的就说没有,不假装做了事', again.forgotten.length === 0)

const live = sandboxUsing('running-on-it', { kind: 'tree', version: '9.9.1-source', dir: workspace })
noteRunning(forgetLayout, 'running-on-it', {
  pid: process.pid, pidBorn: processStartedAt(process.pid),
  port: 3099, url: 'http://127.0.0.1:3099', version: '9.9.1-source',
  engine: { kind: 'tree', version: '9.9.1-source', dir: workspace },
})
const blocked = forgetEngine(forgetLayout, workspace)
check('⛔ 有沙箱正跑在这台上 → 拒绝', blocked.running.includes('running-on-it'), blocked.running.join('、'))
check('⛔⛔ 而且一个都没动过(不是做一半再拒)',
  blocked.forgotten.length === 0
  && JSON.parse(readFileSync(untouched.state, 'utf8')).lastEngine !== undefined
  && existsSync(join(live.home, 'profiles', 'node_modules')))

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
