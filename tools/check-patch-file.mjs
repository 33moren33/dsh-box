/**
 * The patch editor disturbs nothing it was not asked to change.
 *
 * ⭐⭐ This is the acceptance for the one genuinely new thing in this round.
 * Upstream only ever *reads* a `cordis.patch.yml`; there is no official writer
 * to copy, so the writing half is ours, and the only promise worth making
 * about it is **byte for byte**.
 *
 * Two halves:
 *  1. **Round trip** — read a file and write it back with no edits; the result
 *     must be identical, including comments, quoting style, indentation, blank
 *     lines, CRLF and a missing final newline. Samples are embedded so this
 *     runs anywhere, and real files on this machine are added when present.
 *  2. **Surgical edits** — remove one row, and assert that every *other* line
 *     is where it was.
 *
 * ⚠️ There is a control group: a naive "parse to objects and re-emit" of the
 * same samples. If it ever starts passing, this test has stopped measuring
 * what it was written for.
 *
 * Usage: node tools/check-patch-file.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cutLines, listEntries, renderPatch, scanPatch } from '../src/patch-file.js'

const HERE = dirname(fileURLToPath(import.meta.url))

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n改一行,别的一个字节都不许动\n')

// ── 样本 ────────────────────────────────────────────────────────────────────
//
// ⛔ Every one of these is a shape seen in the wild, not one invented to pass.

/** What dsh writes into a brand-new profile. Three comments and a complete value. */
const FRESH = `# Profile patch overlay. Rows here are applied after the bundle layers.
# Edit with care: this file is read on every boot.
# See the harness docs for the patch format.
[]
`

/** The shape this tool has been writing until now, marker block and all. */
const OURS = `# >>> dsh-box: maintained automatically, rewritten whenever plugins change
- insert:
    - id: "dsh-memory-pyramid"
      name: "dsh-memory-pyramid"
      # dsh-box: link C:\\Users\\moreno\\packages\\dsh-memory-pyramid
# <<< dsh-box: end
`

/** A hand-written one: mixed quoting, a blank line, a trailing comment. */
const HAND = `- insert:
    - id: lab-ledger
      name: 'dsh-lab-ledger'

    - id: llm-claude
      name: dsh-llm-claude   # the one I actually use
    - id: lab-shell
      name: "dsh-lab"
`

/** An override row plus a `!!js` scalar — both legal in this dialect. */
const FANCY = `- id: telemetry
  disabled: true

- id: model-route
  config:
    key: !!js process.env.MY_KEY
    retries: 3
- insert:
    - id: pet
      name: '@linxin666/dsh-pet'
      config: {}
`

/** Nested group insert: the `id` form, which appends into a group's config. */
const GROUPED = `- id: tools
  insert:
    - id: extra-tool
      name: my-tool
`

const embedded = [
  ['dsh 新建 profile 时写的那份(三行注释 + [])', FRESH],
  ['我们至今在写的标记块', OURS],
  ['手写的:混引号、空行、行尾注释', HAND],
  ['覆盖行 + !!js 标量 + 嵌套 config', FANCY],
  ['往 group 里插的那种', GROUPED],
  ['空文件', ''],
  ['只有一行、结尾没有换行', '- id: x'],
  ['CRLF 行尾', OURS.replaceAll('\n', '\r\n')],
  // ⛔ Notepad's default for UTF-8. Without handling, the mark stays glued to
  // the first line and the whole file reads as one item and no rows.
  ['带 BOM(记事本存出来就是这样)', `\uFEFF${HAND}`],
  ['带 BOM ＋ CRLF', `\uFEFF${HAND.replaceAll('\n', '\r\n')}`],
]

// ── 一、往返 ────────────────────────────────────────────────────────────────

for (const [label, text] of embedded) {
  const back = renderPatch(scanPatch(text))
  check(`往返:${label}`, back === text,
    back === text ? '' : `${text.length} 字节进,${back.length} 字节出`)
}

// ⭐ Real files, read-only — somebody else's handwriting, which is the only kind
// that can prove this module leaves a file alone.
//
// ⚠️ The first only exists on one machine and is skipped elsewhere; that is
// unavoidable. The second used to be the same, and should not have been: it is a
// published package's file, so **a copy lives in this repository** and the
// checkout is merely preferred, so that the day upstream changes shape this
// check changes with it. Measured on the phone — without the fallback this line
// quietly became nothing, and a check that quietly becomes nothing is worse than
// no check: it still prints a reassuring total.
const realSamples = [
  ['CEO 真机的 profile patch', join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')],
  ['web-ui 全家桶自带的 104 行', [
    join('E:', 'codecode', 'dsh_lab', 'openproject', 'dsh-web-ui', 'packages', 'dsh-web-ui-all', 'cordis.patch.yml'),
    join(HERE, 'fixtures', 'dsh-web-ui-all.cordis.patch.yml'),
  ].find((one) => existsSync(one)) ?? ''],
]
for (const [label, file] of realSamples) {
  if (!existsSync(file)) {
    console.log(`  跳过  往返:${label}(这台机器上没有)`)
    continue
  }
  const text = readFileSync(file, 'utf8')
  const back = renderPatch(scanPatch(text))
  check(`⭐ 往返:${label}`, back === text, `${text.split('\n').length} 行`)
}

// ⚠️ The control: parse to objects and re-emit, the way a YAML library would.
// It has to lose something, or the round-trip checks above prove nothing.
const naive = (text) => listEntries(scanPatch(text))
  .map((one) => `- insert:\n    - id: ${one.id}\n      name: ${one.name}\n`).join('')
check('⚠ 对照组(照解析结果重新生成)确实丢东西——证明上面那些测得到',
  naive(HAND) !== HAND && naive(FANCY) !== FANCY)

// ── 二、认得出行 ────────────────────────────────────────────────────────────

// ⛔ The rows have to be found *through* a BOM, not merely survive one: a file
// that round-trips but reads as empty would let "manage every row" act on a
// wrong picture of somebody's cabinet.
const bomRows = listEntries(scanPatch(`\uFEFF${HAND}`))
check('⛔⛔ 带 BOM 的文件,行照样认得出(不是只保住往返)', bomRows.length === 3,
  `认出 ${bomRows.length} 行`)
check('⛔ 带 BOM 时第一行没被吃掉', bomRows[0]?.id === 'lab-ledger', bomRows[0]?.id)

const handRows = listEntries(scanPatch(HAND))
check('认得出手写文件里的三行', handRows.length === 3,
  handRows.map((r) => r.id).join('、'))
check('引号被剥掉了,名字是干净的',
  handRows.map((r) => r.name).join(',') === 'dsh-lab-ledger,dsh-llm-claude,dsh-lab',
  handRows.map((r) => r.name).join(','))
check('行尾注释不会被当成名字的一部分', handRows[1].name === 'dsh-llm-claude', handRows[1].name)

const fancy = scanPatch(FANCY)
check('覆盖行与插入行分得开',
  fancy.items.map((i) => i.kind).join(',') === 'override,override,insert',
  fancy.items.map((i) => i.kind).join(','))
check('⛔ !!js 标量所在的那一行没被当成一行插入', listEntries(fancy).length === 1)

const grouped = scanPatch(GROUPED)
check('往 group 里插的那种,item 的 id 认得出', grouped.items[0].id === 'tools', grouped.items[0].id)
check('它里面那一行也认得出', listEntries(grouped)[0]?.id === 'extra-tool')

check('⛔ 新建 profile 那个 [] 被认出来了(在它后面追加会毁掉整个文件)',
  scanPatch(FRESH).emptyList === 3, String(scanPatch(FRESH).emptyList))

// ── 三、外科手术 ────────────────────────────────────────────────────────────

const scan = scanPatch(HAND)
const going = scan.items[0].entries[1]
const after = renderPatch(cutLines(scan, [{ start: going.start, end: going.end }]))
check('⛔⛔ 拿掉中间那一行,剩下两行还在', listEntries(scanPatch(after)).map((r) => r.id).join(',') === 'lab-ledger,lab-shell',
  listEntries(scanPatch(after)).map((r) => r.id).join(','))
check('⛔⛔ 没动过的行逐字节没变',
  after.includes("      name: 'dsh-lab-ledger'\n") && after.includes('      name: "dsh-lab"\n'))
check('⛔ 被拿掉的那一行连它的行尾注释一起走了', !after.includes('the one I actually use'))
check('⭐ 那个空行还在原地——它不是我们的,不该被顺手清理', after.includes("'dsh-lab-ledger'\n\n"))

// 两处同时拿掉:从后往前删,否则第二处的行号已经漂了。
const both = scanPatch(HAND)
const spans = [both.items[0].entries[0], both.items[0].entries[2]].map((e) => ({ start: e.start, end: e.end }))
const left = renderPatch(cutLines(both, spans))
check('⛔ 一次拿掉两行,剩下的正好是中间那一行',
  listEntries(scanPatch(left)).map((r) => r.id).join(',') === 'llm-claude',
  listEntries(scanPatch(left)).map((r) => r.id).join(','))

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
