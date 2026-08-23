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

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS } from '../src/commands.js'
import { DEFAULT_LANG, messagesFor } from '../src/messages.js'

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
 *               exists with one value wired in. `adopt` is the case that named
 *               this: the button copies **this sandbox into the daily cabinet**
 *               and nothing else, while the command runs between any two
 *               cabinets. That asymmetry is allowed — the window is a subset of
 *               the command line, never the other way round — but it has to be
 *               written down, because "there is a button" and "a person could
 *               have done this" stopped being the same sentence.
 *
 * ⭐ The window fills in `--box` and `--json` itself and refuses them from the
 * page, so they are not choices at all; they never reach a recorded action.
 */
const DECISIONS = {
  // `@` is the verb itself: the control a person would press to perform the
  // command, as opposed to the arguments they would fill in first. Found the
  // hard way — the first version of this check only looked at flags, and
  // `adopt` sailed through it while the button that performs it had no mark at
  // all. Frames landed on the two cabinets and on nothing that acts.
  'start.@': { mark: 'go:start' },
  'pull.@': { mark: 'go:pull' },
  'drop.@': { mark: 'machine:' },
  'plugins.add.@': { mark: 'go:addPlugin' },
  'plugins.rm.@': { mark: 'plugin:' },
  // The npm box and its button (2026-08-23). The window's half of this command
  // is deliberately narrow: it downloads a package by name into the sandbox
  // selected above, and nothing else. Frames land on the button for every
  // install, `adopt`-style — the button is where the command lives on the page,
  // even for an install only the command line could have made.
  'plugins.install.@': { mark: 'go:npmInstall', cliOnly: '按钮只把 npm 包名装进当前选中的沙箱;装本地目录、已登记的 id,或装进日常档案柜(--main 带批准),只有命令行做得到' },
  'plugins.uninstall.@': { mark: 'plugin:' },
  // ⚠️ Deliberately command-line only, for now. The window's plugin list is a
  // list of the things *we* installed, one tick each; switching off a row we did
  // not install is a different idea and needs a different control. And the one
  // thing this repository knows for certain about its own window is that page
  // interaction has no automated acceptance at all — so a new control there
  // would ship unverified, on the eve of a release. Written down rather than
  // left implicit: the window may be a subset of the command line, on purpose.
  'plugins.disable.@': { offPage: '窗口的插件表列的是「我们装的」,关掉别人写的行是另一件事,还没有控件' },
  'plugins.enable.@': { offPage: '同上' },
  'plugins.backups.rm.@': { offPage: '备份那张表窗口上没有' },
  'plugins.backups.prune.@': { offPage: '同上' },
  'plugins.restore.@': { offPage: '窗口上没有还原这个动作,命令行独有' },
  'packages.rm.@': { offPage: '下载的包那张表窗口上没有' },
  'packages.prune.@': { offPage: '同上' },
  // ⭐ On the page, unlike its neighbours: the window is exactly where a stuck
  // download is *seen*, so it is where it must be stoppable. Watching one hang
  // with no way to end it is what sent us to a shell.
  'packages.cancel.@': { mark: 'go:npmCancel' },
  'workspaces.use.@': { offPage: '项目文件夹窗口只显示、不给改' },
  // The sign-in tick is one control for both directions, exactly like a plugin
  // row: ticking brings one in, unticking takes it out, and the start button is
  // where either becomes true.
  'signin.@': { mark: 'go:signIn' },
  'signin.#1': { mark: 'cabinet:' },
  'signin.sandbox': { mark: 'cabinet:' },
  'signout.@': { mark: 'go:signIn' },
  'signout.#1': { mark: 'cabinet:' },
  'signout.sandbox': { mark: 'cabinet:' },
  'signout.main': { mark: 'cabinet:' },
  'signout.approved': { offPage: '弹窗点头的结果,不是控件' },
  'stop.@': { mark: 'run:' },
  'rm.@': { offPage: '删完那台沙箱连同它的按钮都不在页面上了,没有东西可框' },
  'adopt.@': { mark: 'go:adopt' },
  'config.source.@': { mark: 'go:source' },
  'config.lang.@': { offPage: '语言开关自己就是那条命令,切完页面整个重载' },
  'config.ask-on-quit.@': { offPage: '弹窗里那个「下次不再提醒」的勾' },
  'config.ask-on-daily.@': { offPage: '同上' },
  'config.reset.@': { offPage: '设置文件读坏了才用得上,是命令行的逃生口' },
  'quit.@': { mark: 'go:quit' },

  'start.new': { mark: 'cabinet:' },
  'start.main': { mark: 'cabinet:' },
  'start.version': { mark: 'machine:' },
  'start.sandbox': { mark: 'cabinet:' },
  'start.plugin': { mark: 'plugin:' },
  'start.unplug': { mark: 'plugin:' },
  'start.no-sign-in': { mark: 'go:signIn' },
  'start.sign-in': { mark: 'go:signIn' },
  'start.sign-out': { mark: 'go:signIn' },
  'start.follow': { offPage: '只有命令行会一直看着日志跑;窗口起完就回来了' },
  'start.approved': { offPage: '不是控件,是那道闸门弹窗点头的结果' },
  'pull.#1': { mark: 'machine:' },
  'drop.#1': { mark: 'machine:' },
  'plugins.add.#1': { mark: 'go:pluginDir' },
  'plugins.add.id': { mark: 'go:addPlugin' },
  'plugins.rm.#1': { mark: 'plugin:' },
  // The name being installed: the npm input box is where a person types it.
  'plugins.install.#1': { mark: 'go:npmName' },
  'plugins.uninstall.#1': { mark: 'plugin:' },
  'plugins.backups.rm.#1': { offPage: '备份那张表窗口上没有' },
  'packages.rm.#1': { offPage: '下载的包那张表窗口上没有' },
  'workspaces.use.#1': { offPage: '项目文件夹窗口只显示、不给改' },
  'stop.#1': { mark: 'run:' },
  'rm.#1': { offPage: '删完那台沙箱和它的按钮都不在页面上了' },
  'adopt.#1': { mark: 'cabinet:', cliOnly: '按钮取的永远是当前选中那台沙箱' },
  'config.source.#1': { mark: 'go:source' },
  'config.lang.#1': { offPage: '语言开关按下去就带着值,没有单独选值这一步' },
  'config.ask-on-quit.#1': { offPage: '弹窗里那个「下次不再提醒」的勾' },
  'config.ask-on-daily.#1': { offPage: '同上' },
  'plugins.rm.approved': { offPage: '同上,弹窗点头的结果' },
  'plugins.install.main': { mark: 'cabinet:' },
  'plugins.install.sandbox': { mark: 'cabinet:' },
  'plugins.install.id': { mark: 'plugin:' },
  'plugins.uninstall.main': { mark: 'cabinet:' },
  'plugins.uninstall.sandbox': { mark: 'cabinet:' },
  'plugins.disable.#1': { offPage: '同上,整条命令窗口上都没有' },
  'plugins.disable.main': { offPage: '同上' },
  'plugins.disable.sandbox': { offPage: '同上' },
  'plugins.enable.#1': { offPage: '同上' },
  'plugins.enable.main': { offPage: '同上' },
  'plugins.enable.sandbox': { offPage: '同上' },
  'plugins.backups.rm.main': { offPage: '备份是命令行独有的一摊,窗口上没有这张表' },
  'plugins.backups.rm.sandbox': { offPage: '同上' },
  'plugins.backups.prune.main': { offPage: '同上' },
  'plugins.backups.prune.sandbox': { offPage: '同上' },
  'plugins.backups.prune.keep': { offPage: '同上' },
  'plugins.restore.main': { mark: 'cabinet:' },
  'plugins.restore.sandbox': { mark: 'cabinet:' },
  'plugins.restore.at': { offPage: '窗口只还原到最近一次,选时间戳是命令行的事' },
  'workspaces.use.main': { offPage: '项目文件夹这一格窗口上只显示、不给改' },
  'workspaces.use.sandbox': { offPage: '同上' },
  'workspaces.use.title': { offPage: '同上' },
  'stop.main': { mark: 'run:' },
  'adopt.from': { mark: 'cabinet:', cliOnly: '按钮固定是「这台沙箱 → 日常档案柜」,反向与任意两台之间只有命令行做得到' },
  'adopt.to': { mark: 'cabinet:', cliOnly: '同上' },
  'adopt.force': { offPage: '窗口那条路按 session 幂等,不需要强制' },
  'quit.main': { mark: 'go:quit' },
}

const page = readFileSync(PAGE, 'utf8')
const usages = messagesFor(DEFAULT_LANG)

/**
 * The choices a command takes that are not flags.
 *
 * ⛔ Found while writing this file: `COMMANDS` registers flags and nothing
 * else, so `pull <版本号>` and `stop <沙箱名>` — the values people actually pick
 * on the page — were invisible to the first version of this check. A check that
 * misses a whole class of argument is the very thing it was written against.
 *
 * They are read off the usage line instead, positionally, skipping any `<…>`
 * that follows a flag because those are already covered. Keyed by position
 * rather than by name so that rewording the help cannot silently retire a
 * decision.
 * @param {string} name
 * @returns {string[]} one entry per positional, in order.
 */
function positionals(name) {
  const usage = usages[`cmd.${name}.usage`] ?? ''
  const tokens = usage.split(/\s+/)
  const found = []
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i].startsWith('<')) continue
    // `[--version <版本号>]` — the bracket belongs to the notation, not to the
    // flag, and leaving it on made an optional flag's value look positional.
    const before = (tokens[i - 1] ?? '').replace(/^[[(]+/, '')
    if (before.startsWith('--')) continue
    found.push(tokens[i])
  }
  return found
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
  // eslint-disable-next-line no-new-func
  markKeys = new Function(`${source}; return markKeys`)()
  check('页面里找得到 markKeys()', true)
}

console.log('\n画面认的东西,和命令行认的东西,是同一批\n')

/** Arguments filled in so every branch of `markKeys` has something to return. */
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
}

const keysOf = (command) => (markKeys === null ? [] : markKeys({ command, args: SAMPLE }).filter((key) => key !== null))

/** Everything one command lets somebody choose: the verb, its positionals, its flags. */
const argumentsOf = (name, shape) => [
  '@',
  ...positionals(name).map((_, index) => `#${index + 1}`),
  ...(shape.booleans ?? []),
  ...(shape.values ?? []),
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
  stopAgentBtn: '收回控制权的那一个。它要是也灰了,人就没有出口了',
  dropConfirm: '弹窗里的确定。弹窗只会由人点出来,灰掉它等于让弹窗没法回答',
  quitConfirm: '同上',
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
