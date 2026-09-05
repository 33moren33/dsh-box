/**
 * The page and the command line, checked against each other by machine.
 *
 * The numbered frames only work because every drawable choice carries a
 * `data-mark` key and `markKeys()` turns a recorded action into the keys it
 * touched. Both halves are written by hand, per control, which is the shape of
 * rule this project has already been bitten by twice: **a rule that has to be
 * repeated for each control is a rule that will be missed by the next
 * control**, and missing it is silent — the control simply never lights up, and
 * only an eye on the screen ever notices.
 *
 * That eye found one on 2026-08-23: `--no-sign-in` is a real argument of a real
 * command, the trail renders it, and the checkbox it belongs to was never
 * marked. Nothing failed. So this check exists to make that class of gap loud:
 *
 *   1. **Every argument of every recorded command has a decision.** For each
 *      flag, {@link DECISIONS} says either which mark family covers it, or that
 *      it is deliberately off-page and why. A flag with no entry fails — the
 *      point is not that the table is right, but that adding a flag forces
 *      somebody to answer the question.
 *   2. **The keys a command emits exist on the page.** A static key (`go:…`)
 *      must appear as a `data-mark` in the HTML, or the frame points at
 *      nothing. This is the failure that has already happened twice with
 *      hand-copied id lists.
 *   3. **The page carries no dead marks.** A `data-mark` nothing can ever emit
 *      is a control that will never light up, which reads as "the agent did not
 *      touch it" and is a lie.
 *   4. **Dynamic families are still drawn.** `plugin:` / `cabinet:` / `machine:`
 *      / `run:` keys are built in the page's own script; if a family survives in
 *      `markKeys` after the code that draws it is gone, every frame of that
 *      family silently disappears.
 *
 * ⛔ It cannot tell whether a decision is *good* — `offPage` with a bad reason
 * passes. It only guarantees that no argument reaches the screen unconsidered.
 *
 * Usage:
 *   node tools/check-page-marks.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { COMMANDS, GLOBAL_PARAMS, booleansOf, positionalsOf, valuesOf } from '../src/commands.js'
import { DAILY_CABINET, removeTree } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = join(HERE, '..', 'src', 'ui', 'index.html')

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * What the page is expected to do about each argument of each recorded command.
 *
 * Keyed `<command>.<flag>`. Either:
 *   `mark`    — the family of mark key that must appear for this flag, so the
 *               frame lands on the control a person would have used;
 *   `offPage` — deliberately not drawable, with the reason, because some flags
 *               are about the call rather than about a choice on the screen;
 *   `cliOnly` — the page shows the thing but cannot choose it: the control
 *               exists with one value wired in. `get chat` is the case that
 *               named this: the button copies **this sandbox into the daily
 *               cabinet** and nothing else, while the command runs between any
 *               two cabinets. That asymmetry is allowed — the window is a subset
 *               of the command line, never the other way round — but it has to
 *               be written down, because "there is a button" and "a person could
 *               have done this" stopped being the same sentence.
 *
 * ⭐ The window fills in `--box` and `--json` itself and refuses them from the
 * page, so they are not choices at all; they never reach a recorded action.
 */
const DECISIONS = {
  // ── start:两根轴 ＋ 一个按钮。
  //
  // `@` is the verb itself: the control a person would press to perform the
  // command, as opposed to the arguments they would fill in first. Found the
  // hard way — the first version of this check only looked at flags, and
  // `get chat` sailed through it while the button that performs it had no mark
  // at all. Frames landed on the two cabinets and on nothing that acts.
  'start.@': { mark: 'go:start' },
  'start.#1': { mark: 'cabinet:' },
  'start.new': { mark: 'cabinet:' },
  'start.version': { mark: 'machine:' },
  'start.plugin': { mark: 'plugin:' },
  'start.unplug': { mark: 'plugin:' },
  'start.no-sign-in': { mark: 'go:signIn' },
  'start.sign-in': { mark: 'go:signIn' },
  'start.sign-out': { mark: 'go:signIn' },
  'start.follow': { offPage: '只有命令行会一直看着日志跑;窗口起完就回来了' },

  // ── get:拿进来。
  'get.machine.@': { mark: 'go:pull' },
  'get.machine.#1': { mark: 'machine:' },
  // The npm box and its button (2026-08-23). The window's half of this command
  // is deliberately narrow: it downloads a package by name into the sandbox
  // selected above, and nothing else. Frames land on the button for every
  // install, `get chat`-style — the button is where the command lives on the
  // page, even for an install only the command line could have made.
  'get.plugin.@': { mark: 'go:npmInstall', cliOnly: '按钮只把 npm 包名装进当前选中的沙箱;装本地目录、已登记的 id,或装进日常档案柜,只有命令行做得到' },
  // The name being installed: the npm input box is where a person types it.
  'get.plugin.#1': { mark: 'go:npmName' },
  'get.plugin.to': { mark: 'cabinet:' },
  // ⭐⭐ 刀 2 新长出来的那条:`get plugin --from <柜> --to <柜>` 把一个档案柜的插件配置
  // 搬到另一个,不给 id 就整柜复刻。页面上没有这个动作 —— 它的入口该长在哪儿还没定
  // (check-command-map.mjs 的 COMPOSED 那一格),所以这里如实记「命令行独有」,而不是
  // 假装 npm 那个输入框就是它的家。
  'get.plugin.from': { offPage: '「从另一个档案柜搬过来」页面上还没有入口,刀 2 新给的能力,命令行独有' },
  'get.plugin.id': { mark: 'plugin:' },
  // The sign-in tick is one control for both directions, exactly like a plugin
  // row: ticking brings one in, unticking takes it out, and the start button is
  // where either becomes true.
  'get.signin.@': { mark: 'go:signIn' },
  'get.signin.to': { mark: 'cabinet:' },
  'get.chat.@': { mark: 'go:adopt' },
  'get.chat.from': { mark: 'cabinet:', cliOnly: '按钮固定是「这台沙箱 → 日常档案柜」,反向与任意两柜之间只有命令行做得到' },
  'get.chat.to': { mark: 'cabinet:', cliOnly: '同上' },
  'get.chat.force': { offPage: '窗口那条路按 session 幂等,不需要强制' },

  // ── rm:拿走。
  'rm.machine.@': { mark: 'machine:' },
  'rm.machine.#1': { mark: 'machine:' },
  // ⛔ 页面上没有这个动作了。原来那个「不再记 / 卸载并删除」按钮发的是 `plugins rm`
  // (从**所有**柜子弄走),它随刀 1 的登记表一起没了;`rm plugin --from <柜>` 只管一个
  // 柜子,不是它的替身。页面剩下的那条路是取消勾选后按启动(`start --unplug`)。
  'rm.plugin.@': { offPage: '页面上没有这个动作:旧按钮发的是已删掉的 plugins rm,而按柜子卸载在启动按钮那条路上(--unplug)' },
  'rm.plugin.#1': { mark: 'plugin:' },
  'rm.plugin.from': { mark: 'cabinet:' },
  'rm.sandbox.@': { offPage: '删完那台沙箱连同它的按钮都不在页面上了,没有东西可框' },
  'rm.sandbox.#1': { offPage: '同上' },
  'rm.signin.@': { mark: 'go:signIn' },
  'rm.signin.from': { mark: 'cabinet:' },
  'rm.setting.@': { offPage: '设置文件读坏了才用得上,是命令行的逃生口' },

  // ── stop:四种「停」一条命令,而它们在页面上是四个不同的控件。
  'stop.@': { mark: 'run:' },
  'stop.#1': { mark: 'run:' },
  'stop.all': { mark: 'go:quit' },
  // ⭐ 这一条天生画不出来,而理由本身就是它存在的理由:用得着它的时刻,正是
  // 「那个窗口已经没人牵着了」——而画面就住在那个窗口里。窗口还好好开着时,人
  // 要关它按的是退出按钮(走 --all);窗口成了孤儿时页面根本打不开,没有屏幕可以
  // 画框。所以它只能是命令行独有的那一格,不是漏配了控件。
  'stop.window': { offPage: '用得着它的时候那个窗口已经打不开了,没有屏幕可以画框' },
  // ⭐ On the page, unlike its neighbour above: the window is exactly where a
  // stuck download is *seen*, so it is where it must be stoppable. Watching one
  // hang with no way to end it is what sent us to a shell.
  'stop.download': { mark: 'go:npmCancel' },

  // ── set:改状态。
  // ⚠️ Deliberately command-line only, for now. The window's plugin list is a
  // list of the things *we* installed, one tick each; switching off a row we did
  // not install is a different idea and needs a different control. And the one
  // thing this repository knows for certain about its own window is that page
  // interaction has no automated acceptance at all. Written down rather than
  // left implicit: the window may be a subset of the command line, on purpose.
  // ⭐ 动作本身没有控件,但它落在哪一行、哪一柜是画得出来的 —— 框说的是「这一步发生
  // 在这里」,从来不是「这里有个按钮」。
  'set.plugin.@': { offPage: '窗口的插件表列的是「我们装的」,单独开关一行(以及撤销)还没有控件' },
  'set.plugin.#1': { mark: 'plugin:' },
  'set.plugin.#2': { offPage: '同上:on|off 那一格就是那个还没有的控件' },
  'set.plugin.in': { mark: 'cabinet:' },
  'set.plugin.undo': { offPage: '窗口上没有撤销这个动作,命令行独有' },
  'set.plugin.at': { offPage: '连按几次退几步,选时间戳更是命令行的事' },
  'set.workspace.@': { offPage: '项目文件夹窗口只显示、不给改' },
  'set.workspace.#1': { offPage: '同上' },
  'set.workspace.in': { offPage: '同上' },
  'set.workspace.title': { offPage: '同上' },
  'set.source.@': { mark: 'go:source' },
  'set.source.#1': { mark: 'go:source' },
  'set.lang.@': { offPage: '语言开关自己就是那条命令,切完页面整个重载' },
  'set.lang.#1': { offPage: '语言开关按下去就带着值,没有单独选值这一步' },
  'set.ask-on-quit.@': { offPage: '退出弹窗里那个「下次不再提醒」的勾' },
  'set.ask-on-quit.#1': { offPage: '同上' },
  // ⛔ 2026-08-28 起页面上没有它的控件了:它原来的勾住在删插件那个弹窗里,而那个弹窗
  // 随它驱动的 `plugins rm` 一起删了。更要紧的是这个设置**不再有替人同意的能力** ——
  // 闸门弹窗每次都要真点击(CEO:「不留这个参数的后门」),所以它也不该再长出一个勾。
  'set.ask-on-daily.@': { offPage: '页面上没有控件了:能替人点头的勾与闸门的新形态直接冲突,只留命令行这一个开关' },
  'set.ask-on-daily.#1': { offPage: '同上' },
  // ⭐ 本表里唯一一条「改的不是这个数据目录」的动作:它动的是这台电脑的用户环境变量。
  // 窗口是数据目录的脸,把改环境的开关摆在那儿,人会以为它跟别的设置一样跟着数据
  // 目录走。而且 npm 装的那份根本没有可登记的目录,窗口却分不出自己是哪一种。
  'set.path.@': { offPage: '改的是这台电脑的 PATH,不是这个数据目录;窗口上没有这个动作' },
  'set.path.#1': { offPage: '同上' },
  'set.path.force': { offPage: '同上' },
}

const page = readFileSync(PAGE, 'utf8')

/**
 * The choices a command takes that are not flags.
 *
 * ⛔ Found while writing this file: the first version of `COMMANDS` registered
 * flags and nothing else, so `pull <版本号>` and `stop <沙箱名>` — the values
 * people actually pick on the page — were invisible to the first version of
 * this check. A check that misses a whole class of argument is the very thing
 * it was written against.
 *
 * For a while they were read back out of the hand-written usage sentence, and
 * that broke the day `get plugin` admitted its positional is optional: two
 * structures reading one string. Now the declaration says where every
 * positional is, and this reads that. Keyed by position rather than by name so
 * that renaming a parameter cannot silently retire a decision.
 * @param {string} name
 * @returns {string[]} one entry per positional, in order.
 */
function positionals(name) {
  return positionalsOf(COMMANDS[name]).map((one) => one.name)
}

// ---- markKeys, lifted out of the page ---------------------------------------
// It is a pure function of one argument, so it can be run here without a DOM.
// Taken from the page rather than copied, because a copy is the thing this
// whole file exists to prevent.
const start = page.indexOf('function markKeys(')
let markKeys = null
if (start === -1) {
  check('页面里找得到 markKeys()', false, '整道检查失效,先修这个')
} else {
  let depth = 0
  let end = -1
  for (let i = page.indexOf('{', start); i < page.length; i += 1) {
    if (page[i] === '{') depth += 1
    else if (page[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i + 1; break }
    }
  }
  const source = page.slice(start, end)
  // ⭐ `DAILY` 是从外面递进去的,而且递的是**命令行那一份真值**(src/paths.js)。页面
  // 自己也写着一份,由下面第 7 条逐字对;这里递真值,是为了让下面这些断言测的是
  // 「柜子落在哪个 key 上」,而不是顺带把两份字面量的差异也吞掉。
  // eslint-disable-next-line no-new-func
  markKeys = new Function('DAILY', `${source}; return markKeys`)(DAILY_CABINET)
  check('页面里找得到 markKeys()', true)
}

console.log('\n画面认的东西,和命令行认的东西,是同一批\n')

/**
 * Arguments filled in so every branch of `markKeys` has something to return.
 *
 * ⚠️ Deliberately not a realistic record: `stop` now covers four different
 * stops, and a decision written for each of them has to have something to match
 * against. So every switch is on at once. This is a test of the wiring — which
 * mark key a flag lands on — never of what a real record looks like.
 */
const SAMPLE = {
  version: '9.9.9-stub',
  sandbox: 'box-1',
  main: false,
  plugins: ['p1'],
  unplugged: ['p2'],
  id: 'p1',
  target: 'p1',
  path: 'C:/tmp/p1',
  fromSandbox: 'box-1',
  toSandbox: null,
  importSignIn: false,
  all: true,
  window: true,
  download: true,
  stopped: ['box-1'],
}

const keysOf = (command) => (markKeys === null ? [] : markKeys({ command, args: SAMPLE }).filter((key) => key !== null))

/** Everything one command lets somebody choose: the verb, its positionals, its flags. */
const argumentsOf = (name, shape) => [
  '@',
  ...positionals(name).map((_, index) => `#${index + 1}`),
  ...booleansOf(shape),
  ...valuesOf(shape),
]

// 1. Every argument of every recorded command has been decided about.
const undecided = []
const wrong = []
for (const [name, shape] of Object.entries(COMMANDS)) {
  if (shape.mutates !== true) continue
  const flags = argumentsOf(name, shape)
  const emitted = keysOf(name)
  for (const flag of flags) {
    const decision = DECISIONS[`${name}.${flag}`]
    if (decision === undefined) { undecided.push(flag === '@' ? `${name}(动作本身)` : `${name} --${flag}`); continue }
    if (decision.mark === undefined) continue
    if (!emitted.some((key) => key.startsWith(decision.mark))) {
      wrong.push(`${name} --${flag} 该落在 ${decision.mark}…,但这条命令画的是 ${emitted.join('、') || '(什么都没画)'}`)
    }
  }
}
check('每个会被记账的旗标都有过决定(画框 / 明说不画)', undecided.length === 0,
  undecided.length === 0 ? `${Object.keys(DECISIONS).length} 条决定` : `还没决定:${undecided.join('、')}`)
check('说要画框的,markKeys 真的画得出来', wrong.length === 0, wrong.join(' ／ '))

// A decision about a flag that no longer exists is the same rot in the other
// direction: the table looks complete while describing a command that changed
// under it. Cheap to catch, and it keeps the listing below honest.
const real = new Set()
for (const [name, shape] of Object.entries(COMMANDS)) {
  if (shape.mutates !== true) continue
  for (const flag of argumentsOf(name, shape)) real.add(`${name}.${flag}`)
}
const stale = Object.keys(DECISIONS).filter((key) => !real.has(key))
check('表里没有已经不存在的旗标', stale.length === 0, stale.join('、'))

// 2 & 3. Static keys on both sides line up.
const onPage = new Set()
for (const match of page.matchAll(/data-mark="([^"]+)"/g)) {
  for (const key of match[1].split(/\s+/)) onPage.add(key)
}
// Rows built in script carry theirs the other way. Only the fixed strings are
// collectable here; the ones built from a name are the dynamic families below.
for (const match of page.matchAll(/dataset\.mark\s*=\s*'([^']+)'/g)) {
  for (const key of match[1].split(/\s+/)) onPage.add(key)
}
const emittedStatic = new Set()
for (const name of Object.keys(COMMANDS)) {
  if (COMMANDS[name].mutates !== true) continue
  for (const key of keysOf(name)) if (key.startsWith('go:')) emittedStatic.add(key)
}
const pointingAtNothing = [...emittedStatic].filter((key) => !onPage.has(key))
const neverLit = [...onPage].filter((key) => key.startsWith('go:') && !emittedStatic.has(key))
check('画框指到的静态控件,页面上真的有', pointingAtNothing.length === 0, pointingAtNothing.join('、'))
check('页面上的静态标记,都有命令点得亮', neverLit.length === 0, neverLit.join('、'))

// 3b. Anything that sends a command carries `data-cmd`.
//
// ⛔ The third blind spot of the same family, and the third one a person found
// by eye rather than this file finding it: the × that deletes a release sends
// `drop` and was never marked, so it looked fully alive while an agent drove.
// No damage — the service refuses it — but "looks clickable, is not" is the
// failure this marking exists to prevent, and it is invisible until somebody
// tries it.
//
// ⚠️ Heuristic, deliberately: it reads the page's script rather than running
// it. Elements built in code are matched by the variable they are assigned to,
// which is the shape this file happens to use everywhere.
/**
 * Controls that send a command and must **not** grey out, with the reason.
 *
 * ⭐ Written down rather than silently skipped. Each of these is defensible, and
 * that is exactly why they need a sentence: the next control that "obviously"
 * belongs here will be added by somebody in a hurry.
 */
const NEVER_GREYED = {
  // ⛔ stopAgentBtn 曾经在这里(「收回控制权的那一个」),2026-08-30 随 agent detach
  //   一起删掉:让位改成只管一条命令的执行期间,跑完自己就松,没有要收回的东西。
  //   豁免条目留着比控件留着更坏 —— 它会替一个将来同名的新控件白白免掉这道题。
  quitConfirm: '弹窗里的确定。弹窗只会由人点出来,灰掉它等于让弹窗没法回答',
  // ⛔ 闸门那两个按钮(approveAllow / approveDeny)不在这张表里,因为它们根本不发命令
  // ——「允许」是 POST /api/approve,由**服务端**去跑那条 argv。这正是它们必须不带
  // data-cmd 的原因:agent 撞上闸门才有它们,跟着置灰等于把闸门焊成永远没人点。
}

const senders = new Set()
for (const match of page.matchAll(/(\w+)\.onclick\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\{([\s\S]{0,1600}?)\n\s*\}/g)) {
  if (/\brun\(\[/.test(match[2])) senders.add(match[1])
}
const unmarked = []
for (const name of senders) {
  if (name === '$') continue // `$('id').onclick` — checked through the HTML below
  if (!new RegExp(`${name}\\.dataset\\.cmd`).test(page)) unmarked.push(name)
}
// The ones written straight into the HTML: `$('someId').onclick = … run([…`.
for (const match of page.matchAll(/\$\('([a-zA-Z]+)'\)\.onclick\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\{([\s\S]{0,1600}?)\n\s*\}/g)) {
  if (!/\brun\(\[/.test(match[2])) continue
  const id = match[1]
  if (id in NEVER_GREYED) continue
  const declared = new RegExp(`id="${id}"[^>]*data-cmd`).test(page)
    || new RegExp(`\\$\\('${id}'\\)\\.dataset\\.cmd`).test(page)
  if (!declared) unmarked.push(`#${id}`)
}
check('会发命令的控件都标了 data-cmd(agent 开车时该置灰的)', unmarked.length === 0, unmarked.join('、'))

// 4. Dynamic families are still being drawn somewhere in the page script.
const families = new Set()
for (const name of Object.keys(COMMANDS)) {
  if (COMMANDS[name].mutates !== true) continue
  for (const key of keysOf(name)) {
    const prefix = key.split(':')[0]
    if (prefix !== 'go' && key.includes(':')) families.add(`${prefix}:`)
  }
}
const undrawn = [...families].filter((family) => !page.includes(`${family}\${`) && !page.includes(`'${family}`))
check('动态标记(插件 / 档案柜 / 机器 / 运行中)还有人画', undrawn.length === 0, undrawn.join('、'))

// 5. ⛔⛔ 那段脚本本身语法通不通。
//
// 这一条便宜到不像一道守卫,而它挡的是这个仓最难看见的一种坏法:`<script
// type="module">` 里有一个语法错,整段脚本一个处理器都不注册,**而页面照样渲染出
// 来** —— 卡片、按钮、文案全在,只是按下去什么也不发生。上面那四条读的是文本,一条
// 都看不出来;人眼看截图也看不出来。
//
// 用真的 `node --check`,不用正则、也不用 `new Function`:后两者认得的语法和浏览器
// 认的不是同一套(模块里的 import / 顶层 await 就是现成的分歧),而一道"差不多能查"
// 的守卫比没有守卫更坏 —— 它会让人不再自己看。
const scriptAt = page.indexOf('<script type="module">')
const scriptEnd = page.indexOf('</script>', scriptAt)
if (scriptAt === -1 || scriptEnd === -1) {
  check('页面里抠得出那段 <script type="module">', false, '抠不出来,下面两条就都是假的绿灯')
} else {
  const source = page.slice(page.indexOf('>', scriptAt) + 1, scriptEnd)
  // 服务端塞值的三个占位符不是合法字面量(`__DSH_BOX_MESSAGES__` 是个裸标识符,
  // 而 `'__DSH_BOX_PASS__'` 本来就是字符串),换成同形状的假值再送去解析:查的是
  // 我们写的那些行,不是那三个洞。
  const filled = source
    .replaceAll('__DSH_BOX_LANG_NAMES__', '{}')
    .replaceAll('__DSH_BOX_MESSAGES__', '{}')
    .replaceAll('__DSH_BOX_LANG__', 'zh')
  const scratch = join(mkdtempSync(join(tmpdir(), 'dsh-box-page-')), 'page.mjs')
  writeFileSync(scratch, filled)
  let problem = ''
  try {
    execFileSync(process.execPath, ['--check', scratch], { stdio: 'pipe' })
  } catch (error) {
    problem = String(error.stderr ?? error.message).split('\n').slice(0, 3).join(' ')
  }
  // ⛔ `removeTree`,不是 `rmSync(…, {recursive:true})`。这个仓测过:Windows 上一整
  //   段 Node 版本里,那个调用碰到路径里有非 ASCII 字符时,有内容的目录会**报成功而
  //   什么都不删**,空目录直接把进程带走。`check-no-recursive-fs` 就是拦这个的,而它
  //   刚刚拦住了这一行 —— 一道守卫在自己人身上生效,才说明它不是摆设。
  removeTree(dirname(scratch))
  check('页面脚本语法通得过 node --check(语法错会让整页处理器一个都不注册,而页面照样画出来)',
    problem === '', problem)

  // 6. ⛔ `$('someId')` 指到的元素页面上真的有。
  //
  // 同一族的第二种安静坏法:`$('quitMain')` 返回 null,读它的属性当场抛错,而那一抛
  // 发生在某个 onclick 里 —— 于是**别的按钮都还好好的**,只有这一个从此不响应,谁也
  // 不会想到去看控制台。改名或删控件时最容易留下这种尸体。
  const wanted = new Set([...filled.matchAll(/\$\('([\w-]+)'\)/g)].map((hit) => hit[1]))
  const present = new Set([...page.matchAll(/id="([\w-]+)"/g)].map((hit) => hit[1]))
  const missing = [...wanted].filter((id) => !present.has(id))
  check('页面脚本点名的 element id,HTML 里都有', missing.length === 0, missing.join('、'))

  // 7. ⛔⛔ 页面写死的那个日常档案柜名字,和命令行认的是同一个。
  //
  // 刀 2 之后「哪个柜子」是一个值,于是日常柜也有了名字,而页面必须把这个名字原样发
  // 出去。对不上不会报错:每一条命令都会打到一个**名字合法、只是不存在**的沙箱上,
  // 而页面看着一切正常 —— 正是本仓一再吃亏的那种坏法。
  const declared = /const DAILY = '([^']+)'/.exec(filled)?.[1] ?? null
  check('页面里的日常档案柜名字与 DAILY_CABINET 一致', declared === DAILY_CABINET,
    declared === DAILY_CABINET ? DAILY_CABINET : `页面写的是 ${declared ?? '(找不到)'},命令行认的是 ${DAILY_CABINET}`)

  // 8. ⛔⛔ 页面发出去的每一条 argv,命令行认得。
  //
  // ⭐⭐ 这道守卫是刀 2 的**判例**换来的:命令表、派发器、文案、文档、安装器全改成了
  // 新形状,而 index.html 一个字没动 —— 于是配置窗上每一个按钮发的都是已经不存在的
  // 名字,按下去只拿到 BAD_COMMAND。上面七条**没有一条**看得见这件事:标记对得上、
  // 语法通得过、id 都在,页面画得完好无损。
  //
  // ⚠️ 只看数组字面量开头那一两个字符串。变量拼出来的(`run(argv)`)看不见,这里不装
  // 作看得见 —— 但那条路上的动词今天也是写死的字面量,而这道题真正常错的正是动词。
  const known = new Set(Object.keys(COMMANDS))
  const strange = []
  for (const hit of filled.matchAll(/(^|[^.\w])\[\s*'([a-z][a-z-]*)'((?:\s*,\s*'[^']*')*)/g)) {
    const verb = hit[2]
    const next = /'([^']*)'/.exec(hit[3] ?? '')?.[1] ?? ''
    const pair = next === '' || next.startsWith('--') ? null : `${verb}.${next}`
    if (known.has(verb) || (pair !== null && known.has(pair))) continue
    strange.push(pair === null ? verb : `${verb} ${next}`)
  }
  check('页面发出去的命令名,命令表里都有(改名那一刀漏掉页面,就是这里红)',
    strange.length === 0, [...new Set(strange)].join('、'))

  // 9. ⛔⛔ 页面发出去的每一个旗标,归它发给的那条命令。
  //
  // 命令行从此按命令认旗标:不是这条命令的旗标当场拒(FLAG_NOT_HERE)。页面是命令行的
  // 第一个程序调用方,它发的旗标要是不归那条命令,每个按钮都会在这一刀之后当场坏掉,
  // 而页面自己看不出来 —— 按钮还在、只是按下去被拒。
  // 两层:① 同一个数组字面量里带动词又带 '--x' 的,逐条按那条命令核;② 页面里出现的
  // 每一个 '--x' 字面量(含在别处拼 argv 的),至少得是某条命令或全局的旗标。
  const flagsOf = (name) => new Set([
    ...GLOBAL_PARAMS.map((one) => one.name),
    ...(COMMANDS[name]?.params ?? []).filter((one) => one.at === undefined).map((one) => one.name),
  ])
  const misplaced = []
  for (const hit of filled.matchAll(/\[\s*'([a-z][a-z-]*)'((?:\s*,\s*(?:'[^']*'|[^,\]]+))*)\]/g)) {
    const verb = hit[1]
    const items = [...(hit[2] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1])
    const name = items[0] !== undefined && known.has(`${verb}.${items[0]}`) ? `${verb}.${items[0]}` : verb
    if (!known.has(name)) continue
    for (const item of items) {
      if (!item.startsWith('--')) continue
      if (!flagsOf(name).has(item.slice(2))) misplaced.push(`${name.split('.').join(' ')} ${item}`)
    }
  }
  check('页面在字面量里发给某条命令的旗标,都归那条命令', misplaced.length === 0, [...new Set(misplaced)].join('、'))
  const anyFlag = new Set(Object.keys(COMMANDS).flatMap((name) => [...flagsOf(name)]))
  const orphan = [...filled.matchAll(/'--([a-z][a-z-]*)'/g)].map((m) => m[1]).filter((flag) => !anyFlag.has(flag))
  check('页面里出现的每个旗标字面量,至少是某条命令的旗标(死旗标会让按钮静默被拒)',
    orphan.length === 0, [...new Set(orphan)].join('、'))
}

// The whole surface, in one place, for a person who wants to read it rather
// than be told it is fine. ⭐ Asked for by name (CEO 2026-08-23): the gap that
// started this file was found by eye, and "found by eye" does not scale — but
// neither does a check that only ever answers yes or no, because the decisions
// themselves are what deserve arguing with.
if (process.argv.includes('--list')) {
  console.log('命令行的每个选择,画面上落在哪里\n')
  for (const [name, shape] of Object.entries(COMMANDS)) {
    if (shape.mutates !== true) continue
    console.log(`  ${name}`)
    for (const flag of argumentsOf(name, shape)) {
      const decision = DECISIONS[`${name}.${flag}`] ?? {}
      const label = flag === '@' ? '(动作本身)'
        : flag.startsWith('#') ? positionals(name)[Number(flag.slice(1)) - 1]
          : `--${flag}`
      const where = decision.mark !== undefined ? `框在 ${decision.mark}…`
        : decision.offPage !== undefined ? `不画框:${decision.offPage}`
          : '⛔ 还没决定'
      const only = decision.cliOnly === undefined ? '' : `　⚠️ 只有命令行给得出:${decision.cliOnly}`
      console.log(`    ${label.padEnd(16)}${where}${only}`)
    }
  }
  console.log('')
}

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
