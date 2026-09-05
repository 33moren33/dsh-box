/**
 * One declaration, and everything else generated from it.
 *
 * ⭐⭐⭐ Every command carries a `params` array describing every argument — name,
 * type, whether it is positional, whether it is required, **which values are
 * legal**, and (in `messages.js`) one sentence per argument. The flag tables,
 * the usage line, the per-command help page and the tool schema are all
 * derived from it; nothing else may hold a copy. This file is what keeps the
 * declaration itself sane, since a declaration is data and has no compiler.
 *
 * (It began as the contract for a one-command-at-a-time migration, asserting
 * the derived flag tables equal to the hand-written ones while both existed.
 * The hand-written ones are gone; the remaining checks are the permanent ones.)
 *
 * ⛔⛔ Why the enums matter more than they look. Every enum in this tool used to
 * exist only inside a usage sentence — `set source <auto|official|mirror>` —
 * which means the only way to recover the legal values is to parse prose. An
 * outside report on building tool schemas out of an existing command line names
 * `enum` as the first thing that cannot be reflected out. Ours are recoverable
 * only because they stop living in the sentence.
 *
 * ⛔ Why the usage line has to be generated rather than checked. It was checked,
 * loosely, for months: `get plugin` could copy a whole cabinet, was under test
 * doing exactly that, and its usage line went on printing the positional as
 * required and never mentioned `--from`. Behaviour and its description are
 * different facts, and only one of them had a guard. A generated line cannot
 * disagree with the parser, because there is nothing left to disagree with.
 *
 * Usage: node tools/check-declaration.mjs
 */

import { COMMANDS, GLOBAL_PARAMS, booleansOf, paramKey, positionalsOf, usageOf, valuesOf } from '../src/commands.js'
import { LANGS, messagesFor, setLang } from '../src/messages.js'

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

const same = (a, b) => a.length === b.length && a.every((one, index) => one === b[index])

console.log('\n一份声明,两张脸\n')

const entries = Object.entries(COMMANDS)
const declared = entries.filter(([, shape]) => shape.params !== undefined)

// ── 1. 每条命令都带声明,而且没有第二份 ─────────────────────────────────────
// ⛔ 手写的 booleans / values 曾与声明并存过一段(迁移期的安全带),现在留一个就是
//    留一份会漂的副本。
check('⭐ 每条命令都带参数声明', declared.length === entries.length, `${declared.length}/${entries.length} 条`)
const twice = entries.filter(([, shape]) => shape.booleans !== undefined || shape.values !== undefined).map(([name]) => name)
check('没有命令还留着手写的 booleans / values', twice.length === 0, twice.join('、') || '(无)')

// ── 2. 参数本身说得通 ────────────────────────────────────────────────────────
for (const [name, shape] of declared) {
  const params = shape.params
  const names = params.map((one) => one.name)
  check(`${name}:参数名不重复`, new Set(names).size === names.length, names.join('、'))
  // ⛔ 有值的才需要一个称呼。布尔旗标和带枚举的都没有值可称呼,给它们编一个空词
  //    只会在翻译表里长出没有意义的条目 —— 而查漏译的那道守卫随后就得学会例外。
  check(`${name}:凡是有值又没枚举的参数,都说了它在帮助里怎么称呼`,
    params.every((one) => (one.type === 'string' || one.type === 'boolean')
      && (one.type === 'boolean' || one.enum !== undefined
        ? one.kind === undefined
        : typeof one.kind === 'string' && one.kind !== '')),
    JSON.stringify(params.map((one) => [one.name, one.type, one.kind ?? '(不需要)'])))
  // ⛔ 一个布尔旗标没有值,所以它不可能有枚举,也不可能是位置参数。写成那样多半是
  //    手滑,而它会静静地生出一份错的工具 schema。
  check(`${name}:布尔旗标既不带枚举也不占位置`,
    params.every((one) => one.type !== 'boolean' || (one.enum === undefined && one.at === undefined)))
  const at = positionalsOf(shape).map((one) => one.at)
  check(`${name}:位置参数从 1 开始、不跳号`,
    at.every((value, index) => value === index + 1), at.join('、') || '(没有位置参数)')
  // ⛔⛔ 可选的排在必填前面,那条必填就永远轮不到 —— 位置参数是按顺序数的。
  const positionals = positionalsOf(shape)
  const firstOptional = positionals.findIndex((one) => one.required !== true)
  check(`${name}:必填的位置参数不排在可选的后面`,
    firstOptional === -1 || positionals.slice(firstOptional).every((one) => one.required !== true),
    positionals.map((one) => `${one.name}${one.required === true ? '' : '?'}`).join(' '))
  for (const one of params) {
    if (one.enum === undefined) continue
    check(`${name} --${one.name}:枚举不为空且没有重复`,
      one.enum.length > 0 && new Set(one.enum).size === one.enum.length, one.enum.join('|'))
  }
  // ⛔ 可重复的只能是取值旗标:一个布尔旗标给两次没有第二种意思,一个位置参数按
  //    位置数、重复不了。
  check(`${name}:标了可重复的都是取值旗标`,
    params.every((one) => one.repeat !== true || (one.type === 'string' && one.at === undefined)))
}

// ── 2b. 多种写法(forms)说得通 ───────────────────────────────────────────────
// forms 是给「同一条命令有几种真正不同的读法」用的。每种写法点名定义它的那几个参数,
// 没被任何写法点名的是公共选项,在 usage 里只说一次「[选项]」。
for (const [name, shape] of declared) {
  if (shape.forms === undefined) continue
  const names = new Set(shape.params.map((one) => one.name))
  const entries = shape.forms.flat()
  check(`${name}:forms 至少两种写法(只有一种就不该用 forms)`, shape.forms.length >= 2, `${shape.forms.length} 种`)
  check(`${name}:forms 点名的参数都存在`,
    entries.every((entry) => names.has(entry.replace(/\?$/, ''))), entries.join('、'))
  // ⛔ 必填的参数不能是「公共选项」:塞进 [选项] 里就等于 usage 没说它是必填的。
  const named = new Set(entries.map((entry) => entry.replace(/\?$/, '')))
  check(`${name}:必填参数不藏在 [选项] 里`,
    shape.params.every((one) => one.required !== true || named.has(one.name)),
    shape.params.filter((one) => one.required === true).map((one) => one.name).join('、') || '(没有必填)')
  // ⛔ 写法里不许出现两个位置参数却跳号:第二个位置参数出现的写法里,第一个也得在。
  for (const form of shape.forms) {
    const at = form.map((entry) => shape.params.find((one) => one.name === entry.replace(/\?$/, ''))?.at)
      .filter((value) => value !== undefined).sort((a, b) => a - b)
    check(`${name}:写法「${form.join(' ')}」里的位置参数连续`,
      at.every((value, index) => value === index + 1), at.join('、') || '(无位置参数)')
  }
}

// ── 2c. ⭐⭐ 每个参数都有一句话,两种语言都有 ─────────────────────────────────
// 「help 把能力说清楚」的守卫本体:一个没有句子的旗标,只对读过源码的人存在。
for (const lang of LANGS) {
  const table = messagesFor(lang)
  const mute = []
  for (const [name, shape] of declared) {
    for (const one of shape.params) if (table[paramKey(name, one)] === undefined) mute.push(`${name} --${one.name}`)
  }
  for (const one of GLOBAL_PARAMS) if (table[paramKey(null, one)] === undefined) mute.push(`(全局) --${one.name}`)
  check(`每个参数在 ${lang} 里都有一句话`, mute.length === 0, mute.join('、') || '一个不缺')
}
check('全局旗标的名字不与任何命令的旗标撞',
  GLOBAL_PARAMS.every((one) => entries.every(([, shape]) => (shape.params ?? []).every((p) => p.name !== one.name))))

// ── 3. usage 由声明生成,两种语言都生成得出来 ────────────────────────────────
// ⛔ 生成的那行必须**两种语言都不一样**且都非空:一个把英文写死在声明里的实现
//    也能过前一半,所以两半都要。
const before = process.env.DSH_BOX_LANG
for (const [name, shape] of declared) {
  const lines = {}
  for (const lang of LANGS) {
    setLang(lang)
    lines[lang] = usageOf(name, shape)
  }
  setLang(before === undefined ? 'zh' : before)
  check(`${name}:usage 生成得出来,而且开头就是命令自己的名字`,
    Object.values(lines).every((line) => line.startsWith(name.split('.').join(' '))),
    JSON.stringify(lines))
  // 枚举的那几个词是值不是话,两种语言里本来就该一样;有取值旗标或非枚举位置参数的,
  // 换语言就该换词。
  const translatable = shape.params.some((one) => one.type === 'string' && one.enum === undefined)
  if (translatable) {
    check(`${name}:换一种语言,那行字跟着换(说明值的名字不是写死的英文)`,
      lines.zh !== lines.en, `${lines.zh} ／ ${lines.en}`)
  }
}

// ── 4. 枚举里的每个值都还活着 ────────────────────────────────────────────────
// ⛔ 一条声明里写着的合法值,如果实现早就不认了,那是最难发现的一种谎:help 印得
//    出来、schema 生成得出来、跑起来当场被拒。这里只查它没被写空,真正的验收在
//    各自那条命令的守卫里 —— 写在这儿是为了让下一个人知道这一格是谁的责任。
check('⭐ set source 的枚举来自配置那张表,不是抄在这里的第二份',
  COMMANDS['set.source'].params[0].enum.includes('auto'),
  COMMANDS['set.source'].params[0].enum.join('|'))
check('⭐ set lang 的枚举来自语言表本身',
  same(COMMANDS['set.lang'].params[0].enum, LANGS), COMMANDS['set.lang'].params[0].enum.join('|'))

console.log(`\n${declared.length}/${entries.length} 条已带声明。${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
