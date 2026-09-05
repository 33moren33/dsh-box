/**
 * A cabinet's plugin setup can be copied into another, in either direction.
 *
 * ⭐⭐ Why this is one command and not two. The old shape said where a plugin
 * was going with `--main` / `--sandbox`, so *direction* was a feature: the panel
 * grew a wire for each one, and it only ever had the sandbox→daily half. The new
 * shape says it with two names, `--from` and `--to`, so the reverse needs no
 * implementation — it is the same command with the values swapped. Both are
 * asserted here, because "the reverse is free" is a claim about the code that is
 * only true while somebody keeps checking.
 *
 * ⭐⭐ And why the id is optional rather than there being a second command:
 * `get plugin <id> --from … --to …` moves one, `get plugin --from … --to …`
 * moves the lot. One command read two ways.
 *
 * ⛔⛔ For a long time everything below passed while the whole-cabinet form was
 * **unreachable by anybody reading `--help`**: the usage line printed the
 * positional as required and never mentioned `--from`. Behaviour guarded,
 * documentation not, and the two are different facts. A capability that cannot
 * be discovered is, to every reader who only has the help, not there — so the
 * last section here holds the help to the same standard as the code.
 *
 * ⛔ This is the one place that proves deleting the stored registry was not
 * optional. The plugins in another cabinet are nameable **only** because the
 * list is worked out from what the cabinets hold; with a registry, only rows
 * somebody had remembered to `add` could be copied, and the measured daily
 * cabinet on this machine had 0 of those and 3 of the other kind.
 *
 * ⛔ Never touches the real `~/.dsh`: `DSH_HOME` points at a throwaway home.
 *
 * Usage: node tools/check-cabinet-copy.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeTree } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-cabinet-copy.mjs <一次性目录>')
  process.exit(2)
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

removeTree(root)
const box = join(root, 'data')
const fakeHome = join(root, 'pretend-daily-home')
mkdirSync(fakeHome, { recursive: true })

const made = await new Promise((done) => {
  spawn(process.execPath, [join(HERE, 'make-test-box.mjs'), root], { stdio: 'ignore', windowsHide: true })
    .once('close', done)
})
if (made !== 0) throw new Error('造不出测试盒')

function cli(argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      // ⛔ Both are mandatory in every suite here: the home so nothing reaches
      // the real `~/.dsh`, and the panel switch so a refusal is a refusal
      // rather than a minute spent waiting for somebody to click.
      env: { ...process.env, DSH_HOME: fakeHome, DSH_BOX_NO_PANEL: '1' },
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        done(JSON.parse(line ?? ''))
      } catch {
        done({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
}

/** A folder that really is a loadable plugin. */
function plugin(name) {
  const dir = join(root, 'sources', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name, version: '1.0.0', main: 'index.js', dsh: { bundle: {} },
  }))
  writeFileSync(join(dir, 'index.js'), 'export default {}\n')
  return dir
}

console.log('\n一整柜的插件配置搬到另一柜,两个方向同一条命令\n')

// ── 摆好一柜三个插件 ──────────────────────────────────────────────────────

const names = ['copy-one', 'copy-two', 'copy-three']
for (const name of names) {
  const put = await cli(['get', 'plugin', plugin(name), '--to', 'left'])
  if (put.ok !== true) throw new Error(`摆不进去: ${put.code} ${put.message}`)
}
const before = await cli(['ls', 'plugin', '--in', 'left'])
check('起点那一柜确实有三个', (before.inventory?.rows ?? []).length >= 3,
  String((before.inventory?.rows ?? []).length))

// ── ① 不给 id ＝ 整柜搬 ───────────────────────────────────────────────────

const bulk = await cli(['get', 'plugin', '--from', 'left', '--to', 'right'])
check('⭐⭐ 不给 id,只给 --from:整柜搬过去了', bulk.ok === true, bulk.code ?? 'ok')
check('⭐ 三个都到了',
  names.every((name) => (bulk.copied ?? []).some((one) => one.package === name)),
  JSON.stringify((bulk.copied ?? []).map((one) => one.package)))

const after = await cli(['ls', 'plugin', '--in', 'right'])
check('⭐ 而且是真的到了那一柜里,不只是答复里说到了',
  names.every((name) => (after.inventory?.rows ?? []).some((row) => row.name === name)),
  JSON.stringify((after.inventory?.rows ?? []).map((row) => row.name)))

// ⛔ `--json` 承诺一行。整柜搬装了三个插件,而每个插件的安装本来各自会打一行。
const bulkLines = await new Promise((done) => {
  const child = spawn(process.execPath, [
    CLI, 'get', 'plugin', '--from', 'left', '--to', 'third', '--box', box, '--json',
  ], { windowsHide: true, env: { ...process.env, DSH_HOME: fakeHome, DSH_BOX_NO_PANEL: '1' } })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.resume()
  child.once('close', () => done(out.trim().split('\n').filter((text) => text.trim() !== '')))
})
check('⛔⛔ 搬三个插件仍然只吐一行 JSON —— 每行都像一个完整答复才是最坏的情形',
  bulkLines.length === 1, `${bulkLines.length} 行`)

// ── ② 给了 id ＝ 只搬那一个 ───────────────────────────────────────────────

const single = await cli(['get', 'plugin', 'copy-two', '--from', 'left', '--to', 'fourth'])
check('⭐ 给了 id:只搬那一个', single.ok === true, single.code ?? 'ok')
const fourth = await cli(['ls', 'plugin', '--in', 'fourth'])
const inFourth = (fourth.inventory?.rows ?? []).map((row) => row.name)
check('⭐ 那一柜里只有它,没有把兄弟顺手带过来',
  inFourth.includes('copy-two') && !inFourth.includes('copy-one'), JSON.stringify(inFourth))

// ── ③ 反方向不需要被实现 ─────────────────────────────────────────────────

const back = await cli(['get', 'plugin', '--from', 'fourth', '--to', 'fifth'])
check('⭐⭐ 反方向是同一条命令换两个值,不是另一件功能', back.ok === true, back.code ?? 'ok')

// ── ④ 重复搬:不算失败,但要说清楚哪些本来就有 ─────────────────────────────

const twice = await cli(['get', 'plugin', '--from', 'left', '--to', 'right'])
check('再搬一次:不报错', twice.ok === true, twice.code ?? 'ok')
check('⭐ 而且它说清了「这几个那边本来就有」,没有假装又搬了一遍',
  (twice.copied ?? []).length === 0 && (twice.alreadyThere ?? []).length >= 3,
  `搬了 ${(twice.copied ?? []).length},本来就有 ${(twice.alreadyThere ?? []).length}`)

// ── ⑤ 说不通的话要被拒绝 ─────────────────────────────────────────────────

const itself = await cli(['get', 'plugin', '--from', 'left', '--to', 'left'])
check('⛔ 从一柜搬到同一柜:拒绝', itself.ok === false && itself.code === 'SAME_WORKSPACE', itself.code)

const nowhere = await cli(['get', 'plugin', '--from', 'no-such-cabinet', '--to', 'right'])
check('⛔ 起点那一柜不存在:说没有这一柜,而不是「搬了 0 个」',
  nowhere.ok === false && nowhere.code === 'NO_SUCH_SANDBOX', nowhere.code)

const neither = await cli(['get', 'plugin', '--to', 'right'])
check('⛔ 既不给 id 也不给 --from:说不清要搬什么',
  neither.ok === false && neither.code === 'MISSING_ARGUMENT', neither.code)

// ── ⑥ 闸门照旧管着日常柜那一头 ───────────────────────────────────────────

const toDaily = await cli(['get', 'plugin', '--from', 'left', '--to', 'main'])
check('⛔ 整柜搬进日常档案柜:一样要人点头',
  toDaily.ok === false && toDaily.code === 'NEEDS_APPROVAL', toDaily.code)

const fromDaily = await cli(['ls', 'plugin', '--in', 'main'])
check('⭐ 而从日常柜**读**不用点头 —— 否则「日常→沙箱」这条路根本走不通',
  fromDaily.ok !== false, fromDaily.code ?? 'ok')

// ── ⑦ ⛔⛔ help 得承认上面这些是做得到的 ─────────────────────────────────────
// 上面每一条都通过、而 help 把位置参数印成必填、`--from` 一个字不提 —— 这个状态
// 真的存在过。**行为有守卫,说明没有,而它们是两件事。**
// ⭐ 判据不是「help 里有没有这几个字」,是**照 help 印出来的形状真的跑一遍**:
//    字面量没有任何东西给它背书,而它恰恰是承诺的最强形式。

const page = await cli(['help', 'get', 'plugin'])
const usage = String(page.command?.usage ?? '')
check('⭐ usage 把「不点名」这条读法印出来了(位置参数是可选的)',
  /\[.*\]/.test(usage) && usage.includes('--from'), usage)

// ⛔ 照着 usage 里那两种形状各跑一次。help 说得出、跑不通,和跑得通、help 不说,
//    是同一种病的两面。
const bothCabinets = await cli(['get', 'plugin', '--from', 'left', '--to', 'right'])
check('⛔⛔ help 印的「--from 柜A --to 柜B」真的跑得通',
  bothCabinets.ok === true, bothCabinets.code ?? 'ok')

const notes = String(page.command?.notes?.join('\n') ?? '')
check('⭐ 细则里说清了方向是参数不是功能(否则「推回日常柜」会被当成还没做)',
  notes.includes('--from') && /全搬|whole|everything/.test(notes), `notes ${notes.length} 字`)

removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
