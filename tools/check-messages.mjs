/**
 * The guards that make a 600-line translation survivable.
 *
 * Moving every sentence out of the code and into one table is not a risky
 * change to the logic — it is a risky change to the *coverage*. Nothing
 * crashes when a line is missed; it simply keeps speaking the wrong language,
 * in some corner nobody visits, until a user finds it. So the coverage is
 * checked mechanically rather than by reading, and checked from the first
 * commit of the migration rather than at the end of it: a guard added last
 * only tells you how much you already got wrong.
 *
 * ⛔ These are static checks on the table. They cannot see a sentence that is
 * still hard-coded in the source — that one is caught by running the tool
 * with `lang=en` and refusing any Chinese in its output, which lives with the
 * command checks because it needs the command line.
 *
 * Usage:
 *   node tools/check-messages.mjs
 */

import { COMMANDS } from '../src/commands.js'
import { DEFAULT_LANG, LANGS, messageKeys, messagesFor } from '../src/messages.js'

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n两种语言说的是同一批话\n')

const tables = Object.fromEntries(LANGS.map((lang) => [lang, messagesFor(lang)]))
const base = Object.keys(tables[DEFAULT_LANG]).sort()

// 1. Same keys everywhere. `messagesFor` falls back to the default language,
//    so a missing entry would silently render as Chinese to an English user —
//    which is the exact failure this whole check exists for. It has to be read
//    from the raw table, not through the fallback.
for (const lang of LANGS) {
  if (lang === DEFAULT_LANG) continue
  const own = new Set(Object.keys(rawTable(lang)))
  const missing = base.filter((key) => !own.has(key))
  const extra = [...own].filter((key) => !base.includes(key))
  check(`${lang}:一条不落,${base.length} 条都在`, missing.length === 0,
    missing.length === 0 ? `${base.length} 条` : `缺 ${missing.length} 条:${missing.slice(0, 6).join('、')}`)
  check(`${lang}:没有多出来的孤条`, extra.length === 0, extra.slice(0, 6).join('、'))
}

// 2. Nothing empty. An empty string is how a half-finished translation hides:
//    it renders as a blank line rather than as an obvious gap.
for (const lang of LANGS) {
  const blank = Object.entries(rawTable(lang)).filter(([, line]) => String(line).trim() === '')
  check(`${lang}:没有空条`, blank.length === 0, blank.map(([key]) => key).join('、'))
}

// 3. The blanks have to match. `{name}` in one language and `{who}` in the
//    other leaves a literal `{who}` on somebody's screen, and it is the kind
//    of mistake that reads fine in review.
const mismatched = base.filter((key) => {
  const shape = (lang) => [...String(rawTable(lang)[key] ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  return LANGS.some((lang) => shape(lang) !== shape(DEFAULT_LANG))
})
check('每一条的占位符两边一致', mismatched.length === 0, mismatched.slice(0, 6).join('、'))

// 4. No Chinese left in the English table. This is the one that catches a
//    key that was copied across and never translated — the commonest way a
//    bilingual table rots, and invisible to every other check here.
const leftover = Object.entries(rawTable('en')).filter(([, line]) => /[\u4e00-\u9fff]/.test(String(line)))
check('en 里没有漏译的中文', leftover.length === 0, leftover.map(([key]) => key).join('、'))

// 5. ⭐⛔⚠ belong to `notes.*` only (CEO 2026-08-22): short lines report, and a
//    report with a warning sign in it makes the signs mean less everywhere.
const marked = []
for (const lang of LANGS) {
  for (const [key, line] of Object.entries(rawTable(lang))) {
    // "A notes entry" means one whose key ends in `.notes` — that is where the
    // command table's explanatory text lives. Everything else is a short line.
    if (!key.endsWith('.notes') && /[⭐⛔⚠]/.test(String(line))) marked.push(`${lang}:${key}`)
  }
}
check('短句里没有 ⭐⛔⚠(它们只留在 notes)', marked.length === 0, marked.slice(0, 6).join('、'))

/**
 * One language's own entries, without the default-language fallback that
 * {@link messagesFor} applies for rendering.
 * @param {string} lang
 * @returns {Record<string, string>}
 */
function rawTable(lang) {
  const merged = messagesFor(lang)
  if (lang === DEFAULT_LANG) return merged
  const fallback = messagesFor(DEFAULT_LANG)
  // An entry identical to the default language is either untranslated or a
  // word that is the same in both; the Chinese check below tells them apart.
  return Object.fromEntries(Object.entries(merged).filter(([key, line]) => line !== fallback[key] || !/[\u4e00-\u9fff]/.test(String(line))))
}

// 6. Every command has words. The command table holds no text any more — the
//    words are found by name — so a command whose keys were never written does
//    not fail, it just shows up in the help list with a blank beside it. That
//    is the failure mode this whole arrangement introduced, so it gets its own
//    check rather than an eye.
//    ⛔ `usage` is not looked for: that line is generated from the declaration
//    (`usageOf`), and a stored one beside it would be the second copy.
const speechless = Object.keys(COMMANDS).filter((name) => messagesFor(DEFAULT_LANG)[`cmd.${name}.summary`] === undefined)
check('每条命令都有 summary(表里已经不存文本,少一条就是屏幕上一片空白)',
  speechless.length === 0, speechless.join('、'))
const strayUsage = messageKeys().filter((key) => /^cmd\..+\.usage$/.test(key))
check('表里没有手写的 usage(那行由声明生成,存一份就是第二份真相)', strayUsage.length === 0, strayUsage.join('、'))

// 7. ⭐⭐ 每条命令都答得出「做完之后我处在什么状态」。
//    不是文档洁癖,是产品要求:`--help` 是路过的 agent 的唯一入口,只写在 md 里
//    的用法对它等于不存在。判例是一个真实使用者盯着一条早已完成的 `start` 等了
//    2 分 36 秒 —— 「立即返回」当时只写在 AGENTS.md 里,help 一个字没有。
//    ⛔ 它查不出这句话说得对不对,只保证没有一条命令在这个问题上沉默。与本仓别处
//    同一个手法:把判断放进唯一的漏斗,新命令白白继承这道题。
//
//    ⭐⭐ 只对**会改状态**的命令强制。只读的那些,`mutates:false` 已经把这个问题
//    答完了 —— 再补一句「只看了一眼」是零信息,而这张表 agent 会整个读进去。
//    判例:第一版我给 44 条全写了,其中 8 条正是这种填充,CEO 当场问「这样是不是
//    要读的东西反而多了」。**只读命令仍然可以有 after**(`ui` 不返回、`logs` 会
//    截断,都值得说),只是不强制 —— 强制会把「没什么可说」逼成一句废话。
const silentAfter = Object.keys(COMMANDS).filter((name) => {
  if (COMMANDS[name].mutates !== true) return false
  const table = messagesFor(DEFAULT_LANG)
  const line = table[`cmd.${name}.after`]
  return line === undefined || String(line).trim() === ''
})
check('每条会改状态的命令都答得出「完成后我处在什么状态」(返回了没有 / 留下了什么 / 下一步敲什么)',
  silentAfter.length === 0, silentAfter.join('、'))

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
