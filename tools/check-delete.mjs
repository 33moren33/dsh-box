/**
 * Deleting and copying non-ASCII paths has to actually happen.
 *
 * ⛔⛔ Found by using the tool, not by reading it: `rm 演示沙箱` answered
 * `{"ok":true}` with the sandbox still sitting on disk. The cause is not in this
 * repository — on Windows, **`fs.rmSync(path, {recursive:true})` and
 * `fs.cpSync(from, to, {recursive:true})` do nothing when the path handed to
 * them contains a non-ASCII character**, and on some shapes they take the whole
 * process down (0xC0000409, no output whatsoever). The same trees named
 * `alpha/` work fine. Upstream: nodejs/node#61067 (fixed by #61108) and
 * nodejs/node#61878 (fixed by #61950); the root cause is a narrow string handed
 * to `std::filesystem::path`, which Windows reads in the ANSI code page.
 *
 * ⭐⭐ **They are two bugs in two different bands of versions, so they get two
 * control groups.** Measured with a real `node.exe` of each version:
 *
 * | | broken from | fixed in |
 * |---|---|---|
 * | `rmSync` | 23.0.0 | **24.13.1** |
 * | `cpSync` | **22.17.0 — the active LTS, still broken at 22.21.1** | **24.15.0** |
 *
 * ⛔ Reading only the first row suggests the 22 LTS is a safe harbour to send
 * users back to. It is not. That is why both rows are asserted here.
 *
 * ⚠️ It reaches much further than sandbox names. Every path this tool deletes
 * sits under the data directory, so a user whose home is `C:\Users\张三\…` would
 * find that `rm release`、卸插件时按引用计数自清的那棵包树、以及快照轮转 all
 * quietly did nothing — while saying they had.
 * ⚠️ 08-28 起后两件不再是人敲得出的命令(`packages prune`、`plugins backups prune`
 * 都在刀 1 删掉了),但它们**照样会跑**,只是改成自动发生 —— 删得掉不删得掉这件事
 * 一点没变轻,反而没人再盯着看了。
 *
 * ⭐ The control groups below are the built-in calls, on the same trees. **When
 * they start passing on every platform we support, Node has been fixed for
 * everyone and `removeTree`/`copyTree` — and `check-no-recursive-fs.mjs` — can
 * all go.** That is the exit from this workaround, and it is checked rather
 * than remembered.
 *
 * Usage:
 *   node tools/check-delete.mjs <一次性目录>
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyTree, removeTree } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-delete.mjs <一次性目录>')
  process.exit(2)
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** A sandbox-shaped tree, with a name in the language the tool allows. */
function build(name) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'home'), { recursive: true })
  mkdirSync(join(dir, 'logs'), { recursive: true })
  writeFileSync(join(dir, 'running.json'), '{"pid":1}')
  writeFileSync(join(dir, 'home', 'settings.json'), '{}')
  writeFileSync(join(dir, 'logs', 'boot.log'), 'hi')
  return dir
}

/**
 * Run a snippet in its own process, because on one shape of input the built-in
 * calls do not return — they abort.
 * @param {string} source
 * @returns {string}
 */
function inOwnProcess(source) {
  try {
    return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
    }).trim()
  } catch (error) {
    return `crashed:${error.status}`
  }
}

/**
 * Where each built-in stopped being broken. The table in this file's header is
 * these same two numbers, measured with a real `node.exe` of each version.
 */
const FIXED_IN = { rmSync: '24.13.1', cpSync: '24.15.0' }

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} -1, 0 or 1, over three numeric parts.
 */
function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    const one = left[i] ?? 0
    const two = right[i] ?? 0
    if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

/**
 * Whether the Node running these tests is past the fix for one of them.
 * @param {'rmSync' | 'cpSync'} which
 * @returns {boolean}
 */
const runsFixed = (which) => compareVersions(process.versions.node, FIXED_IN[which]) >= 0

console.log('\n中文名字的东西,删得掉、拷得动\n')

removeTree(root)
mkdirSync(root, { recursive: true })

// ── 删除 ────────────────────────────────────────────────────────────────────

// 1. ⚠ The control, on a tree of its own.
//
// ⛔ Only asserted on Windows. This is a Windows defect, and on Linux the
// built-in works — so demanding that the control *fail* would turn a healthy
// platform into a red suite. (Caught while writing this: the phone would have
// failed the whole run.)
//
// ⛔⛔ And it gets its own tree rather than sharing one with the check below,
// because on a healthy platform **the control succeeds** — it really deletes
// what it is pointed at. Sharing meant the next check was handed a tree that
// was already gone, so `removeTree` answered "there was nothing here" and the
// run went red on Linux for a reason that had nothing to do with the code
// under test. ⭐ The earlier platform skip covered the control's *assertion*
// and missed its *side effect*; only a real run on Linux showed the
// difference.
const control = build('对照-中文')
const builtInDelete = inOwnProcess(`import { rmSync, existsSync } from 'node:fs'
rmSync(${JSON.stringify(control)}, { recursive: true, force: true }) // dsh-box:allow-builtin-recursive 这就是对照组本身
console.log(existsSync(${JSON.stringify(control)}) ? 'still-there' : 'gone')`)
// 一个对照组只能在缺陷真的存在的地方被要求失败,而有两件不同的事会让它够不着:
// 平台(这是 Windows 的缺陷),以及**跑测试这台 Node 的版本**。上游把两个 bug 都
// 修了,所以在新 Node 上自带的那个真的删得掉——再要求它失败,就是把「人家修好了」
// 变成一片红。
// 但对照组正是「这道检查测不测得到东西」的唯一证明,所以它跑不了的时候要**说出来**,
// 不能悄悄跳过。在那期间守住这套变通的,是文件末尾那条出口断言。
if (process.platform !== 'win32') {
  console.log(`  跳过  ⚠ 删除对照组只在 Windows 上成立(这台是 ${process.platform},自带的那个是好的:${builtInDelete})`)
} else if (runsFixed('rmSync')) {
  console.log(`  说明  ⚠ 跑测试这台 Node 是 ${process.versions.node},已过 ${FIXED_IN.rmSync} 的修复,`
    + `所以对照组在这儿证明不了「这道检查测得到东西」(自带的那个:${builtInDelete})`)
} else {
  check('⚠ 对照组(Node 自带的 rmSync)确实办不到——证明这道检查测得到东西',
    builtInDelete !== 'gone', builtInDelete)
}
removeTree(control)

// 2. Ours, on a tree of the same shape.
const victim = build('我们的-中文')
check('⛔⛔ 我们的删除:中文名照样删得掉', removeTree(victim) && !existsSync(victim))

// 3. And on the shapes that crashed or no-opped, one at a time.
const empty = join(root, '空的中文')
mkdirSync(empty, { recursive: true })
check('⛔ 空的中文目录也删得掉(自带的那个在这里会让进程直接崩)',
  removeTree(empty) && !existsSync(empty))

const ascii = build('plain-ascii')
check('ASCII 名字照旧', removeTree(ascii) && !existsSync(ascii))

check('本来就不在的,回 false 而不是报错', removeTree(join(root, '没有这个')) === false)

// 4. ⛔ A link must lose the link, never what it points at. A sandbox holds
//    junctions into the user's own plugin folders, so a walk that followed them
//    would delete somebody's source code.
const real = join(root, '真的源码')
mkdirSync(real, { recursive: true })
writeFileSync(join(real, 'index.js'), 'export default {}')
const holder = join(root, '装着链接的')
mkdirSync(holder, { recursive: true })
const link = join(holder, 'linked')
try {
  const { symlinkSync } = await import('node:fs')
  symlinkSync(real, link, 'junction')
  removeTree(holder)
  check('⛔⛔ 删掉带链接的目录,链接指向的真目录一根毫毛没动',
    !existsSync(holder) && existsSync(join(real, 'index.js')))
} catch (error) {
  check('⛔⛔ 删掉带链接的目录,链接指向的真目录一根毫毛没动', false, `建链接就失败了:${error.code}`)
}

// ── 拷贝 ────────────────────────────────────────────────────────────────────
//
// ⭐ This half did not exist until the two calls were measured separately. The
// copy is broken in a *different* band of versions from the delete — including
// the current LTS — so a suite that only tested the delete would have gone
// green on a machine where `attach` copies zero conversations and says twelve.

const source = build('plain-source')
const cnTarget = join(root, '中文目标')

// 5. ⚠ The control, again in its own process: with a non-ASCII destination the
//    built-in copies nothing, and with a non-ASCII source it aborts.
const builtInCopy = inOwnProcess(`import { cpSync, existsSync } from 'node:fs'
cpSync(${JSON.stringify(source)}, ${JSON.stringify(join(root, '自带的目标'))}, { recursive: true }) // dsh-box:allow-builtin-recursive 这就是对照组本身
console.log(existsSync(${JSON.stringify(join(root, '自带的目标', 'running.json'))}) ? 'copied' : 'nothing')`)
if (process.platform !== 'win32') {
  console.log(`  跳过  ⚠ 拷贝对照组只在 Windows 上成立(这台是 ${process.platform},自带的那个是好的:${builtInCopy})`)
} else if (runsFixed('cpSync')) {
  console.log(`  说明  ⚠ 跑测试这台 Node 是 ${process.versions.node},已过 ${FIXED_IN.cpSync} 的修复,`
    + `所以这条对照组同样证明不了什么(自带的那个:${builtInCopy})`)
} else {
  check('⚠ 对照组(Node 自带的 cpSync)确实办不到——删除那条好了不代表这条也好',
    builtInCopy !== 'copied', builtInCopy)
}

// 6. Ours, same source, non-ASCII destination.
copyTree(source, cnTarget)
check('⛔⛔ 我们的拷贝:目标是中文名,东西真到了',
  existsSync(join(cnTarget, 'running.json')) && existsSync(join(cnTarget, 'home', 'settings.json')))
check('⛔ 拷过去的内容一字不差',
  readFileSync(join(cnTarget, 'logs', 'boot.log'), 'utf8') === 'hi')

// 7. And the shape that aborts the process: a non-ASCII source.
const cnSource = build('中文源')
const asciiTarget = join(root, 'plain-target')
copyTree(cnSource, asciiTarget)
check('⛔ 源是中文名也拷得动(自带的那个在这里会让进程直接崩)',
  existsSync(join(asciiTarget, 'home', 'settings.json')))

// 8. A single file, which `adopt` also does, and a nested destination that does
//    not exist yet — the caller relies on it being made.
const oneFile = join(root, '中文源', 'running.json')
const deepTarget = join(root, '深一点', '再深一点', 'running.json')
copyTree(oneFile, deepTarget)
check('单个文件拷到还不存在的深目录里,目录自己会长出来', existsSync(deepTarget))

// -- exit -------------------------------------------------------------------
//
// 这套变通什么时候整个删掉,是被**检查**的,不是被记住的。判据不是「跑测试这台
// 机器好了」——那只是一台机器——而是「我们声明支持的最低 Node 也已经修好」。
// 只看删除那一行会得出相反结论:它在 24.13.1 就修了,而拷贝那条要到 24.15.0,
// 且 22 LTS 到 22.21.1 仍然坏着,而 22 正在我们声明支持的范围里。
const declared = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).engines.node
const supportedFloor = declared.replace(/[^0-9.]/g, '')
check('⭐⭐ 变通还不能撤:我们支持的最低 Node 仍在坏的那一档',
  compareVersions(supportedFloor, FIXED_IN.cpSync) < 0,
  `engines.node=${declared};两条分别修于 ${FIXED_IN.rmSync} 与 ${FIXED_IN.cpSync}。`
  + '这条一旦变红,就是可以删掉 removeTree/copyTree 与 check-no-recursive-fs 的那天')

removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
