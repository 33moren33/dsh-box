/**
 * The shape of every command, declared once.
 *
 * This is not a dispatcher and not a renderer. It holds only what more than
 * one place needs to agree on: what a command is called, what it accepts,
 * whether it changes anything, and how to write it out in full. Running a
 * command and printing it for a person both stay in `bin/cli.js`, because the
 * machine answer is a promise and the prose around it is not.
 *
 * It exists because three separate things kept having to know the same facts
 * and drifted apart when they did. The parser had its own hand-written list of
 * flags, the help text had its own hand-written list of commands, and the
 * config window had its own hand-written idea of what each button does. The
 * window's copy is the one that caused real damage — see the note on the
 * config window — but the other two were the same accident waiting.
 *
 * The third consumer is the blue-frame badge, which has to show the command
 * that is running as one fully explicit line. That line cannot be the one
 * somebody typed: `start` with nothing after it means "same as last time", and
 * last time moves. It is rebuilt from what the action actually resolved to, so
 * it produces the same result whenever it is run — which is only possible if
 * something knows which recorded value belongs to which flag. That is
 * {@link commandLine}.
 */

/** What the tool is called on the command line, for rendered lines. */
import { langOptions, t } from './messages.js'
import { KEEP_BACKUPS } from './mounts.js'
import { DAILY_CABINET } from './paths.js'

export const PROGRAM = 'dsh-box'

/**
 * How many past actions `history` shows when nobody says.
 *
 * Declared here rather than beside the command that uses it, because the help
 * text quotes it: a default documented as one number and implemented as another
 * is the small, quiet kind of lie this table exists to make impossible.
 */
export const HISTORY_LINES = 30

/**
 * @typedef {object} CommandShape
 * @property {string} usage - the left column of the help text.
 * @property {string} summary - the right column of the help text.
 * @property {boolean} mutates - whether it changes state on disk. Only
 * mutating commands are written to the journal and the numbered trail.
 * @property {string[]} [booleans] - on/off flags it accepts.
 * @property {string[]} [values] - flags that take the next token.
 * @property {(args: Record<string, any>) => (string | undefined)[]} [line] -
 * the fully explicit form, from what the action resolved to. Required for
 * mutating commands, since only those are ever recorded.
 * @property {string[]} [notes] - what people get wrong about this one, in
 * prose. Lives here rather than in the help text so `dsh-box help <命令>` and
 * the full listing cannot come to disagree; a second copy is a copy that drifts.
 */

/**
 * Every command, keyed by the name it is recorded under.
 *
 * ⭐⭐ Ten verbs and nothing else, and the second word names an **object** rather
 * than a second verb: `rm machine` / `rm sandbox` / `rm plugin` are one thing
 * done to three, which is what an agent can guess without reading us first. The
 * key keeps the dot because a record has to be one word; nobody types it.
 *
 * ⭐ Which filing cabinet is a **value** now (`--in` / `--to` / `--from`, with
 * the daily one called {@link DAILY_CABINET}), never a pair of flags to choose
 * between. The old `--main` / `--sandbox <名>` axis made "which cabinet" a
 * question with two spellings, so every caller had to carry both and every
 * direction added to a command was another flag rather than another value.
 * `start` / `stop` / `logs` take the name as a plain positional for the same
 * reason: they act on one cabinet and have nothing to say about a second.
 *
 * ⛔ No old name is kept as an alias. Two spellings for one action is the drift
 * this table was built to make impossible, and the whole point of paying the
 * rename once is not to pay it forever.
 * @type {Record<string, CommandShape>}
 */
export const COMMANDS = {
  // ── ls:看。裸敲就是全景,后面跟一个对象就是那一族的名单。
  ls: {
    mutates: false,
  },
  'ls.machine': {
    mutates: false,
  },
  'ls.plugin': {
    mutates: false,
    values: ['in'],
  },
  'ls.sandbox': {
    mutates: false,
  },
  'ls.workspace': {
    mutates: false,
    values: ['in'],
  },
  'ls.history': {
    mutates: false,
    booleans: ['shape'],
    values: ['lines'],
  },
  'ls.memory': {
    mutates: false,
  },
  // ⭐ 一格里装着旧的 `config` 与旧的 `path` 两份输出。合得起来是因为 PATH 从此
  //    只是一个设置(`set path on|off`)—— 读一个设置不该另开一条命令,而分成两条
  //    的代价是「这台机器现在是什么样」要问两次才凑得齐。
  'ls.setting': {
    mutates: false,
  },

  // ── get:拿进来。`--to` 说进哪个柜子,方向从此是个值而不是一个功能。
  'get.machine': {
    mutates: true,
    line: (args) => ['get', 'machine', args.version],
  },
  'get.plugin': {
    mutates: true,
    values: ['to', 'from', 'id'],
    line: (args) => [
      'get', 'plugin', args.source ?? args.id ?? args.target,
      '--to', cabinetOf(args),
    ],
  },
  // ⭐ Sign-in is a property of a cabinet, like a plugin is — not a choice made
  // at launch. So it gets the same two shapes a plugin has: a standalone verb
  // for changing it whenever, and a flag on `start` for changing it on the way
  // in. `--no-sign-in` stays what it always was and says nothing about either:
  // it is about the moment a sandbox is *created*.
  'get.signin': {
    mutates: true,
    values: ['to'],
    line: (args) => ['get', 'signin', '--to', cabinetOf(args)],
  },
  'get.chat': {
    mutates: true,
    booleans: ['force'],
    values: ['from', 'to'],
    // Always written out in the long form: the shorthand hides which direction
    // it went, and a line that has to be re-read to know what it did is not
    // the line this renders for.
    line: (args) => [
      'get', 'chat',
      '--from', args.fromSandbox ?? DAILY_CABINET,
      '--to', args.toSandbox ?? DAILY_CABINET,
      ...(args.force === true ? ['--force'] : []),
    ],
  },

  // ── rm:拿走。
  'rm.machine': {
    mutates: true,
    line: (args) => ['rm', 'machine', args.version],
  },
  'rm.plugin': {
    mutates: true,
    values: ['from'],
    line: (args) => [
      'rm', 'plugin', args.id ?? args.bundle ?? args.target,
      '--from', cabinetOf(args),
    ],
  },
  'rm.sandbox': {
    mutates: true,
    line: (args) => ['rm', 'sandbox', args.sandbox],
  },
  'rm.signin': {
    mutates: true,
    values: ['from'],
    line: (args) => ['rm', 'signin', '--from', cabinetOf(args)],
  },
  'rm.setting': {
    mutates: true,
    line: () => ['rm', 'setting'],
  },

  // ── start / stop
  start: {
    mutates: true,
    booleans: ['new', 'no-sign-in', 'sign-in', 'sign-out', 'follow'],
    values: ['version', 'plugin', 'unplug'],
    // Every blank filled in: no `--new` (which names a different sandbox each
    // time it runs) and no reliance on the working directory.
    //
    // `--version` is written only when one was asked for. Its absence is not a
    // blank left unfilled — it is the answer "the machine this computer has",
    // which stays the same answer whenever the line is re-run.
    //
    // ⛔ Consent is deliberately not renderable, and since 2026-08-28 it is not
    // expressible at all: there is no `--approved` to leave out. A rendered line
    // re-run later is refused again and asks again, which is the correct
    // behaviour — one click authorising every future re-run was the thing to
    // avoid, and now the interface has nowhere to write it.
    line: (args) => [
      'start', cabinetOf(args),
      ...(args.version === undefined || args.version === null ? [] : ['--version', args.version]),
      ...(args.plugins ?? []).flatMap((id) => ['--plugin', id]),
      ...(args.unplugged ?? []).flatMap((id) => ['--unplug', id]),
      ...(args.importSignIn === false ? ['--no-sign-in'] : []),
      ...(args.signIn === true ? ['--sign-in'] : []),
      ...(args.signOut === true ? ['--sign-out'] : []),
    ],
  },
  // ⭐⭐ 四种「停」收进一条,靠的是它们停的**东西**不同,不是名字不同:一台沙箱
  //    / `--all` 每一台 / `--window` 那扇配置窗 / `--download` 正在下的那个包。
  //    从前是四个动词(stop、quit、ui stop、packages cancel),而调用方要先学会
  //    我们内部有四层东西才知道该敲哪一个 —— 现在只需要知道自己想停的是什么。
  // ⭐⭐ `--all` 含日常柜(CEO 2026-08-28 改判,原来是「只管沙箱」)。理由是字面意思
  //    最直:敲了「全部」还剩一台在跑,是被自己的命令绕了。⛔ 换来的保护不是「排除
  //    在外」而是闸门,而且是**部分拦**——沙箱照停,走到日常柜那一台才要人点头。
  stop: {
    mutates: true,
    booleans: ['all', 'window', 'download'],
    line: (args) => [
      'stop',
      ...(args.all === true ? ['--all'] : []),
      ...(args.window === true ? ['--window'] : []),
      ...(args.download === true ? ['--download'] : []),
      ...(args.all === true || args.window === true || args.download === true ? [] : [cabinetOf(args)]),
    ],
  },

  // ── set:改状态。
  // ⭐ 开关一个插件不是「拿走」:那一行可能根本不是我们写进去的,拿走它就越界了。
  //    `--undo` 归在同一格,因为撤销就是把这一柜的插件配置设回上一个值 ——
  //    连按 n 次退 n 步,深度靠再按一次得到,不靠读一张时间戳表。
  'set.plugin': {
    mutates: true,
    booleans: ['undo'],
    values: ['in', 'at'],
    line: (args) => (args.undo === true
      ? [
        'set', 'plugin', '--undo', '--in', cabinetOf(args),
        ...(args.at === undefined || args.at === null ? [] : ['--at', args.at]),
      ]
      // ⛔ `on` is not the answer to "which way was it set" when nobody said —
      //    a line that fills that blank in for itself is runnable and wrong,
      //    which is worse than a line that is visibly incomplete.
      : [
        'set', 'plugin', args.id ?? args.target,
        args.off === undefined ? undefined : (args.off === true ? 'off' : 'on'),
        '--in', cabinetOf(args),
      ]),
  },
  'set.workspace': {
    mutates: true,
    values: ['in', 'title'],
    line: (args) => ['set', 'workspace', args.path ?? args.target, '--in', cabinetOf(args)],
  },
  'set.source': {
    mutates: true,
    // `value` is what the record carries before the command has resolved
    // anything; `source` is what it carries afterwards. Reading only the
    // second one left a refused `set source` rendering without its value.
    line: (args) => ['set', 'source', args.source ?? args.value],
  },
  'set.lang': {
    mutates: true,
    line: (args) => ['set', 'lang', args.value],
  },
  'set.ask-on-quit': {
    mutates: true,
    line: (args) => ['set', 'ask-on-quit', args.value],
  },
  // ⚠️ Was missing until 2026-08-22: the setting worked, but with no entry here
  // it was absent from `--help` and its journal line rendered as nothing. A
  // command table that the help is generated from only covers what is in it.
  'set.ask-on-daily': {
    mutates: true,
    line: (args) => ['set', 'ask-on-daily', args.value],
  },
  // ⛔ 改的是这台电脑不是这个数据目录,但它确实是个开关,而且便携包的用户要自己
  //    敲一次 —— 文档里写着「你自己敲一次」的那一句,是代码里永远找不到的调用方。
  //    所以它是真·用户命令,归 set,不藏进安装器。
  'set.path': {
    mutates: true,
    booleans: ['force'],
    // ⛔ Same rule as `set plugin`: an unanswered on/off renders as nothing.
    line: (args) => [
      'set', 'path', args.state === 'on' || args.state === 'off' ? args.state : undefined,
      ...(args.force === true ? ['--force'] : []),
    ],
  },

  // ── 剩下三个动词
  logs: {
    mutates: false,
    booleans: ['shape', 'errors', 'all'],
    // `package` names a plugin download's log the way `version` names a
    // release's: by the thing asked about, so the asker needs no job id.
    values: ['lines', 'version', 'package'],
  },
  ui: {
    mutates: false,
    booleans: ['no-open'],
    values: ['port'],
  },
  'agent.attach': {
    mutates: false,
  },
  'agent.detach': {
    mutates: false,
    booleans: ['forced'],
  },
}

/**
 * Which cabinet a record is about, as the one value the new shape writes.
 *
 * ⛔ A record still carries `main` and `sandbox` side by side, because that is
 * what the command actually resolved — but a rendered line has room for one
 * value, and the daily cabinet's value is its name. Reading the record here
 * rather than teaching every command to store a third field keeps the fact in
 * one place; `in` / `to` / `from` are read too, so a run that failed before it
 * resolved anything still renders the cabinet it was aimed at.
 * @param {Record<string, unknown>} args
 * @returns {string | undefined}
 */
function cabinetOf(args) {
  if (args.main === true) return DAILY_CABINET
  const named = args.sandbox ?? args.in ?? args.to ?? args.from
  return named === null || named === undefined ? undefined : String(named)
}

/**
 * The words for one command, looked up by its name.
 *
 * ⛔ The table above holds no text at all any more, and that is the point: a
 * `usage` string sitting in a module-level object is evaluated when the file is
 * imported, which is before the config has been read and a language chosen. So
 * the shape of a command lives here and its words live in `messages.js`, keyed
 * off the same name — nothing has to be kept in step by hand, and a command
 * with no words is a check failure rather than a blank line on somebody's
 * screen (`tools/check-messages.mjs`).
 * @param {string} name
 * @param {'usage' | 'summary' | 'notes' | 'after'} part
 * @param {string} [fallback]
 * @returns {string}
 */
function say(name, part, fallback = '') {
  const key = `cmd.${name}.${part}`
  // The two constants that appear inside help text. Passed to every lookup
  // rather than to the two that need them: a note that grows a third one
  // should not also have to remember to come back here.
  const line = t(key, { historyLines: HISTORY_LINES, keepBackups: KEEP_BACKUPS, options: langOptions() })
  return line === key ? fallback : line
}

/**
 * Flags that are on or off, across all commands.
 *
 * Collected from the declarations rather than typed out again, so a flag added
 * to a command is one a caller can actually pass. Listing them at all is what
 * stops `--json versions` from swallowing the command as if it were a value —
 * a parser that guesses from the next token gets that wrong in silence, and
 * the JSON branch then never runs while the command still appears to work.
 *
 * Deliberately one set for every command rather than one per command: today
 * any flag parses anywhere and is ignored where it means nothing, and turning
 * that into a refusal is a behaviour change that belongs in its own change.
 */
export const BOOLEAN_FLAGS = new Set([
  // Understood everywhere, so declared here rather than on each command.
  'json', 'help',
  ...Object.values(COMMANDS).flatMap((shape) => shape.booleans ?? []),
])

/** Flags that take the token after them, across all commands. */
export const VALUE_FLAGS = new Set([
  // The data directory can be pointed anywhere, for any command.
  'box',
  ...Object.values(COMMANDS).flatMap((shape) => shape.values ?? []),
])

/**
 * Commands as they appear in the help text, in the order declared above.
 *
 * ⛔ A function, not a constant. Built at import time it would capture whatever
 * language was current before the config had been read — which is to say, the
 * default one, always. `BOOLEAN_FLAGS` and `VALUE_FLAGS` above are safe to keep
 * as constants because nothing in them is text.
 * @returns {{usage: string, summary: string}[]}
 */
export function helpLines() {
  return Object.keys(COMMANDS).map((name) => ({ usage: say(name, 'usage', name), summary: say(name, 'summary') }))
}

/**
 * One command, described for a machine.
 *
 * The same declaration the parser and the window read, handed out as data. Help
 * that is generated from the thing it documents cannot describe a flag that
 * does not exist, or miss one that does — which is the entire reason the table
 * exists. A caller can also tell from `mutates` whether running it will change
 * anything before deciding to.
 * @param {string} name
 * @returns {object | null}
 */
export function describeCommand(name) {
  const shape = COMMANDS[name]
  if (shape === undefined) return null
  const notes = say(name, 'notes')
  return {
    name,
    usage: say(name, 'usage', name),
    summary: say(name, 'summary'),
    // ⭐⭐ The one sentence a caller who has never read anything about this
    // program still needs: **what state am I in when this returns.** Did it
    // return at all, what did it leave behind, what is the next thing to type.
    // `summary` answers "what does this do" and `notes` answers "what do people
    // get wrong"; neither answers this, and its absence cost a real user 2
    // minutes 36 seconds of waiting on a command that had already finished.
    // ⛔ Not a place to restate the handbook. One sentence, about the state.
    after: say(name, 'after'),
    mutates: shape.mutates === true,
    booleans: shape.booleans ?? [],
    values: shape.values ?? [],
    notes: notes === '' ? [] : notes.split('\n'),
  }
}

/** Every command, described for a machine. */
export function describeCommands() {
  return Object.keys(COMMANDS).map((name) => describeCommand(name))
}

/**
 * Whether a command changes anything on disk.
 * @param {string} name
 * @returns {boolean}
 */
export function mutates(name) {
  return COMMANDS[name]?.mutates === true
}

/**
 * One recorded action, written out as a command anyone can re-run.
 *
 * Built from the resolved arguments rather than stored as text, so it cannot
 * disagree with the record it came from — it is a view of that record, not a
 * second copy of it.
 * @param {string} name - the recorded command name, e.g. `get.plugin`.
 * @param {Record<string, unknown>} args - the resolved arguments.
 * @returns {string | null} the command line, or null when the command is not
 * one that gets recorded.
 */
export function commandLine(name, args = {}) {
  const shape = COMMANDS[name]
  if (shape?.line === undefined) return null
  // ⛔ A flag and its value are one thing, and dropping blanks one token at a
  // time cannot know that: the value went and the flag stayed, so a record
  // missing its cabinet rendered as `… --in` with nothing after it —
  // worse than incomplete, because it looks runnable and is not. Which flags
  // carry a value is already declared right here in `values`, so the pair can
  // be dropped as a pair.
  //
  // ⭐ This is the guard, not the fix: the record should have the value in it
  // (see `describeAction`). Keeping both means the next argument somebody
  // forgets costs a line that says less, never a line that lies.
  const carriesValue = new Set((shape.values ?? []).map((flag) => `--${flag}`))
  const raw = shape.line(args)
  const tokens = []
  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index]
    if (token === undefined || token === '') continue
    if (!carriesValue.has(token)) {
      tokens.push(token)
      continue
    }
    const value = raw[index + 1]
    index += 1
    if (value === undefined || value === '') continue
    tokens.push(token, value)
  }
  return [PROGRAM, ...tokens.map(quote)].join(' ')
}

/**
 * Wrap a token in quotes when a shell would otherwise split it.
 *
 * Sandbox names cannot contain spaces — the naming rule keeps them out — but
 * the directory a plugin was registered from can, and a rendered line that
 * cannot be pasted back is not worth rendering.
 * @param {string} token
 * @returns {string}
 */
function quote(token) {
  const text = String(token)
  return /[\s"']/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text
}
