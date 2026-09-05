/**
 * Flags belong to commands, and every answer carries a verdict.
 *
 * Two things one spawn apart, so they share a file. First the flags:
 *
 * ⛔ For a long time every flag parsed on every command: the parser checked
 * against the union of all flags, so `ls --force` ran `ls` and dropped `--force`
 * in silence. A typo produced a plausible run and nothing reported it. Now a
 * flag is checked against the command it was given to, after the command is
 * known and before anything is opened or recorded.
 *
 * Three refusals, each asserted here with a real spawn of the command line:
 *   FLAG_NOT_HERE  another command's flag — refused **by name**, saying whose
 *   FLAG_TWICE     a value flag given twice without `repeat` in the declaration
 *   UNKNOWN_FLAG   nobody's flag (unchanged; still refused by the parser)
 * And two things that must keep working: a command's own flag is accepted, and
 * a repeatable one may be given twice.
 *
 * ⭐ Also asserted: a refused flag leaves nothing behind. `--box` names a
 * directory that does not exist; after the refusal it must still not exist.
 *
 * Then the verdicts (`src/errors.js`): every JSON line carries `verdict`, and
 * the exit code is its projection — 0 ok, 1 failed (about the thing asked
 * about), 2 error (the request or this tool), 3 partial. The partial case is
 * asserted where it can be produced, in `check-daily-gate.mjs`; here the
 * other three, plus the rule that a crash is never reported as a judgement.
 *
 * Usage: node tools/check-verdicts.mjs <scratch-dir>
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA_DEFAULT } from '../src/commands.js'
import { BoxError, VERDICT_EXIT, verdictOf } from '../src/errors.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const scratch = process.argv[2]
if (scratch === undefined) {
  console.error('用法:node tools/check-verdicts.mjs <一次性目录>')
  process.exit(2)
}
// ⛔ The commands that get past the flag check open a data directory and read
//    the daily cabinet; that must be a throwaway one, never the real `~/.dsh`.
useFakeDaily(scratch)

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** @param {string[]} argv */
function cli(...argv) {
  return cliIn('box-ok', argv)
}

/**
 * @param {string} boxName - which scratch data directory to point `--box` at.
 * @param {string[]} argv
 */
function cliIn(boxName, argv) {
  const box = join(scratch, boxName)
  const ran = spawnSync(process.execPath, [CLI, ...argv, '--json', '--box', box], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, DSH_BOX_LANG: 'zh' },
  })
  const line = ran.stdout.trim().split('\n').filter((one) => one.trim() !== '').at(-1)
  let parsed = null
  try { parsed = JSON.parse(line ?? '') } catch { parsed = null }
  return { status: ran.status, out: parsed, box }
}

console.log('\n旗标归命令\n')

// ── 1. 别的命令的旗标,拒,并说出它属于谁 ───────────────────────────────────
const notHere = cliIn('never-created-flag', ['ls', '--force'])
check('ls --force 被拒,code 是 FLAG_NOT_HERE', notHere.out?.code === 'FLAG_NOT_HERE', JSON.stringify(notHere.out))
check('拒绝里点名了 --force 属于谁', Array.isArray(notHere.out?.belongsTo) && notHere.out.belongsTo.includes('get chat'),
  JSON.stringify(notHere.out?.belongsTo))
check('被拒之后 --box 指的目录没有被建出来', !existsSync(notHere.box), notHere.box)

const wrongVerb = cli('stop', '--version', '1.2.3')
check('stop --version 被拒(--version 是 start / logs 的)', wrongVerb.out?.code === 'FLAG_NOT_HERE'
  && wrongVerb.out?.belongsTo?.includes('start') && wrongVerb.out?.belongsTo?.includes('logs'), JSON.stringify(wrongVerb.out?.belongsTo))

// ── 2. 同一个取值旗标给两次,拒 ───────────────────────────────────────────────
const twice = cli('ls', 'plugin', '--in', 'a', '--in', 'b')
check('ls plugin --in a --in b 被拒,code 是 FLAG_TWICE', twice.out?.code === 'FLAG_TWICE', JSON.stringify(twice.out))
check('拒绝里带着给过的两个值', Array.isArray(twice.out?.given) && twice.out.given.join(',') === 'a,b', JSON.stringify(twice.out?.given))

const boxTwice = spawnSync(process.execPath, [CLI, 'ls', '--json', '--box', 'a', '--box', 'b'], { encoding: 'utf8', windowsHide: true })
let boxTwiceOut = null
try { boxTwiceOut = JSON.parse(boxTwice.stdout.trim().split('\n').at(-1)) } catch { boxTwiceOut = null }
check('--box 给两次走的是同一条拒绝(FLAG_TWICE),不再有专用的第二条路', boxTwiceOut?.code === 'FLAG_TWICE', JSON.stringify(boxTwiceOut))

// ── 3. 谁的旗标都不是,还是 UNKNOWN_FLAG ───────────────────────────────────────
const nobody = cli('ls', '--approved')
check('ls --approved 仍是 UNKNOWN_FLAG(谁的都不是)', nobody.out?.code === 'UNKNOWN_FLAG', JSON.stringify(nobody.out))

// ── 4. 自己的旗标照收;标了可重复的给两次也照收 ─────────────────────────────────
// ⛔ 这两条只断言「不是旗标那三种拒绝」:命令本身会因为沙箱不存在而拒,那是别的守卫的事。
const own = cli('ls', 'plugin', '--in', 'nope')
check('ls plugin --in <x> 不因旗标被拒', !['FLAG_NOT_HERE', 'FLAG_TWICE', 'UNKNOWN_FLAG'].includes(own.out?.code), JSON.stringify(own.out?.code))
const repeat = cli('start', 'nope', '--plugin', 'a', '--plugin', 'b')
check('start --plugin a --plugin b 不因给两次被拒(声明标了可重复)', repeat.out?.code !== 'FLAG_TWICE', JSON.stringify(repeat.out?.code))

// ── 5. 全局旗标在每条命令上都认 ─────────────────────────────────────────────────
const globalOk = cli('set', 'lang', 'zh')
check('--json / --box 在任何命令上都不被当成别人的旗标', !['FLAG_NOT_HERE', 'FLAG_TWICE'].includes(globalOk.out?.code), JSON.stringify(globalOk.out?.code))

// ── 6. 判词与退出码 ───────────────────────────────────────────────────────────
console.log('\n判词四档,退出码是它的投影\n')
check('请求的错(FLAG_NOT_HERE)是 error 档,退出码 2', notHere.out?.verdict === 'error' && notHere.status === 2,
  `verdict=${notHere.out?.verdict} exit=${notHere.status}`)
const unknownVerb = cliIn('never-created-verb', ['bogus'])
check('不认识的命令是 error 档,退出码 2,而且没有建出数据目录',
  unknownVerb.out?.verdict === 'error' && unknownVerb.status === 2 && !existsSync(unknownVerb.box),
  `verdict=${unknownVerb.out?.verdict} exit=${unknownVerb.status}`)
const notRunning = cli('stop', 'nope')
check('关于那台沙箱的判定(NOT_RUNNING)是 failed 档,退出码 1',
  notRunning.out?.verdict === 'failed' && notRunning.status === 1, `verdict=${notRunning.out?.verdict} exit=${notRunning.status}`)
const answered = cli('ls')
check('答出来了是 ok 档,退出码 0,verdict 字段也在成功那行里',
  answered.out?.ok === true && answered.out?.verdict === 'ok' && answered.status === 0,
  `verdict=${answered.out?.verdict} exit=${answered.status}`)
// ⛔ 装置的故障不能占用被测对象的档位:一个不是 BoxError 的异常(工具自己的 bug、
//    文件系统错)映射到 error,永远不是 failed。
check('不是 BoxError 的异常一律 error 档(工具的 bug 不许变成关于沙箱的判定)',
  verdictOf(new Error('boom')) === 'error' && verdictOf(Object.assign(new Error('x'), { code: 'ENOENT' })) === 'error')
check('BoxError 默认是 failed 档,标了 partial 的是 partial 档',
  verdictOf(new BoxError('NO_SUCH_SANDBOX', 'x')) === 'failed'
  && verdictOf(new BoxError('NEEDS_APPROVAL', 'x', {}, { partial: true })) === 'partial')
check('四档的退出码是 0/1/2/3', VERDICT_EXIT.ok === 0 && VERDICT_EXIT.failed === 1 && VERDICT_EXIT.error === 2 && VERDICT_EXIT.partial === 3)
const helpJson = spawnSync(process.execPath, [CLI, '--help', '--json'], { encoding: 'utf8', windowsHide: true })
let helpOut = null
try { helpOut = JSON.parse(helpJson.stdout.trim().split('\n').at(-1)) } catch { helpOut = null }
check('--help --json 里带着判词表(verdicts),给工具那张脸照着映射',
  JSON.stringify(helpOut?.verdicts) === JSON.stringify(VERDICT_EXIT), JSON.stringify(helpOut?.verdicts))

// ── 7. JSON 的形状有版本位 ──────────────────────────────────────────────────
// ⭐ 裸 --json 是一个没有出口的承诺:写下它的人已经把它当成第 1 版,所以第 1 版
//    必须从第一天就有名字,每一行都自报 schema,要一个没有的版本当场拒。
console.log('\nJSON 形状带版本位\n')
check('成功那行带 schema:1', answered.out?.schema === JSON_SCHEMA_DEFAULT, JSON.stringify(answered.out?.schema))
check('拒绝那行也带 schema:1', notHere.out?.schema === JSON_SCHEMA_DEFAULT, JSON.stringify(notHere.out?.schema))
check('--help --json 带 schema:1', helpOut?.schema === JSON_SCHEMA_DEFAULT, JSON.stringify(helpOut?.schema))
const explicit = cliIn('never-created', ['ls', '--json=1'])
check('--json=1 是裸 --json 的明写,答案一样', explicit.out?.ok === true && explicit.out?.schema === 1, JSON.stringify(explicit.out?.schema))
const future = spawnSync(process.execPath, [CLI, 'ls', '--json=9'], { encoding: 'utf8', windowsHide: true })
let futureOut = null
try { futureOut = JSON.parse(future.stdout.trim().split('\n').at(-1)) } catch { futureOut = null }
check('要一个没有的版本被拒(JSON_SCHEMA_UNKNOWN),是 error 档、退出码 2,不用旧形状凑数',
  futureOut?.code === 'JSON_SCHEMA_UNKNOWN' && futureOut?.verdict === 'error' && future.status === 2
  && Array.isArray(futureOut?.known) && futureOut.known.includes(1), JSON.stringify(futureOut))

// ── 8. ⛔ schema 快照闸:第 1 版的形状存了盘,变了就红 ───────────────────────
// 快照记的是 --help --json 的**结构**(顶层键、每条命令的键、每个参数的名·型·位·必填·
// 枚举·可重复),不记句子:句子随时可改,结构一改就是给所有调用方的破坏性变更。
// 真要改形状:加第 2 版(JSON_SCHEMAS 里加号、每处按 jsonSchema 分岔),快照另存一份;
// 不许改第 1 版的快照 —— 那等于改了裸 --json 对所有人的意思。
const SNAPSHOT = join(HERE, 'fixtures', 'json-schema-1.json')
const shapeOf = (doc) => ({
  top: Object.keys(doc).sort(),
  globals: doc.globals.map((one) => [one.name, one.type, one.required]),
  verdicts: doc.verdicts,
  commands: doc.commands.map((cmd) => ({
    name: cmd.name,
    keys: Object.keys(cmd).sort(),
    mutates: cmd.mutates,
    params: cmd.params.map((one) => [one.name, one.type, one.at ?? null, one.required, one.enum ?? null, one.repeat ?? false]),
  })),
})
const current = JSON.stringify(shapeOf(helpOut), null, 2)
if (process.argv.includes('--write-snapshot')) {
  writeFileSync(SNAPSHOT, `${current}\n`)
  console.log(`  已写快照 ${SNAPSHOT}`)
}
const stored = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT, 'utf8').trim() : null
check('⛔ 第 1 版 JSON 形状的快照在盘上(缺快照直接红,不算通过)', stored !== null, SNAPSHOT)
check('⛔ 当前 --help --json 的结构与第 1 版快照逐字相同(变了就是破坏性变更,该开第 2 版)',
  stored === current, stored === current ? '' : '结构变了;确认是有意的再跑 --write-snapshot')

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
