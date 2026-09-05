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
import { readFileSync } from 'node:fs'
import { SOURCE_CHOICES } from './config.js'
import { LANGS, langOptions, t } from './messages.js'
import { KEEP_BACKUPS } from './mounts.js'
import { DAILY_CABINET } from './paths.js'

export const PROGRAM = 'dsh-box'

/**
 * Which build of this tool is answering, read from its own `package.json`.
 *
 * ⛔ `--version` cannot be this: that flag already means the other axis —
 * **which dsh to run** — and it is on `start`, the most-used command here. So
 * nothing anywhere read our own manifest, and "am I running the copy I just
 * installed?" was answerable only by comparing file timestamps, which is not an
 * answer a machine can act on.
 *
 * ⭐ Read here rather than at each of the two places that report it, so the two
 * faces cannot come to disagree — the same reason the command table holds the
 * shapes and `messages.js` holds the words.
 *
 * ⚠️ `null` rather than a made-up number when the manifest cannot be read: a
 * version this tool guessed at is worse than no version, because the caller
 * comparing it against a release has no way to tell the guess apart.
 */
export const VERSION = ownVersion()

/** @returns {string | null} */
function ownVersion() {
  try {
    const raw = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof raw.version === 'string' ? raw.version : null
  } catch {
    return null
  }
}

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
 * @property {boolean} mutates - whether it changes state on disk. Only
 * mutating commands are written to the journal and the numbered trail.
 * @property {(args: Record<string, any>) => (string | undefined)[]} [line] -
 * the fully explicit form, from what the action resolved to. Required for
 * mutating commands, since only those are ever recorded.
 * @property {string[]} [notes] - what people get wrong about this one, in
 * prose. Lives here rather than in the help text so `dsh-box help <命令>` and
 * the full listing cannot come to disagree; a second copy is a copy that drifts.
 * @property {Param[]} [params] - every argument, described well enough that both
 * faces can be generated from it. See {@link Param}.
 * @property {string[][]} [forms] - the distinct ways this command is written,
 * when there is more than one. Each form lists the parameter names that define
 * that writing; a trailing `?` marks one that may be left out of it. Parameters
 * in no form are common options and are written once as `[选项]`.
 * ⛔ Only for commands whose readings really are alternatives (`stop <柜>` vs
 * `stop --all`): a command with one reading and many flags has no forms, and
 * its usage line lists every flag. Forms are how the listing stays one line
 * without a second, hand-written sentence to drift.
 * @property {false} [mcp] - set to `false` to keep this command off the tool
 * face (`dsh-box mcp`). ⛔ Default is offered: a capability the command line has
 * and the tool face does not is a capability an agent cannot discover. Only a
 * command that **cannot** be a request/response — one that never returns — is
 * kept off, and the reason is written beside it.
 */

/**
 * @typedef {object} Param
 * @property {string} name - `--name` for a flag; for a positional this is the
 * key the parser already stores it under, so nothing downstream has to change.
 * @property {'string' | 'boolean'} type
 * @property {number} [at] - 1-based position when this is a positional rather
 * than a flag. Absent means it is a flag.
 * @property {boolean} [required] - must be given. ⛔ Default is false, and the
 * default is deliberate: a required argument is a promise that the command
 * refuses without it, and a wrong `true` here would put a lie in the help and
 * in the tool schema at once.
 * @property {string[]} [enum] - the only accepted values. ⛔⛔ This is the field
 * the whole exercise turns on. Every enum in this tool used to live inside a
 * usage string — `set source <auto|official|mirror>` — where the only way to
 * recover it is to parse English (or Chinese) prose. An external report on
 * generating tool schemas from an existing command line named `enum` as the
 * first thing that cannot be recovered that way; ours are recoverable only
 * because they are declared here instead.
 * @property {string} [kind] - which word stands in for the value in the help
 * line, looked up as `param.<kind>` so it can be said in either language. ⛔ Not
 * the English word inline: the usage line is generated for both faces, and a
 * literal here would pin one of them.
 * ⛔ Absent on a boolean flag, and absent on anything with an `enum`: neither
 * has a value word to stand in for. Inventing an empty one to keep the field
 * populated is how a translation table grows entries that mean nothing, and the
 * check that finds untranslated strings then has to learn about exceptions.
 * @property {boolean} [repeat] - may be given more than once (`--plugin a
 * --plugin b`). The parser already collects repeats into an array; saying so
 * here is what lets a tool schema say `array` instead of `string`.
 * @property {false} [mcp] - same as on the command, one level down: a flag that
 * turns a returning command into one that never returns (`start --follow`) is
 * left out of the tool schema, because a tool call has no way to be held open.
 *
 * ⭐ What each parameter *means* is not here either: it is a sentence, so it
 * lives in `messages.js` as `cmd.<command>.param.<name>`, in both languages,
 * and `tools/check-messages.mjs` fails on any parameter without one. That is
 * the guard behind "help says what the capability is": a flag with no sentence
 * used to be a flag that existed only for whoever had read the source.
 */

/**
 * Every command, keyed by the name it is recorded under.
 *
 * ⭐⭐ Nine verbs and nothing else, and the second word names an **object** rather
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
    params: [],
  },
  'ls.machine': {
    mutates: false,
    params: [],
  },
  'ls.plugin': {
    mutates: false,
    params: [{ name: 'in', type: 'string', kind: 'cabinet' }],
  },
  'ls.sandbox': {
    mutates: false,
    params: [],
  },
  'ls.workspace': {
    mutates: false,
    params: [{ name: 'in', type: 'string', required: true, kind: 'cabinet' }],
  },
  'ls.history': {
    mutates: false,
    params: [
      { name: 'lines', type: 'string', kind: 'count' },
      { name: 'shape', type: 'boolean' },
    ],
  },
  'ls.memory': {
    mutates: false,
    params: [],
  },
  // ⭐ 一格里装着旧的 `config` 与旧的 `path` 两份输出。合得起来是因为 PATH 从此
  //    只是一个设置(`set path on|off`)—— 读一个设置不该另开一条命令,而分成两条
  //    的代价是「这台机器现在是什么样」要问两次才凑得齐。
  'ls.setting': {
    mutates: false,
    params: [],
  },

  // ── get:拿进来。`--to` 说进哪个柜子,方向从此是个值而不是一个功能。
  'get.machine': {
    mutates: true,
    params: [{ name: 'version', at: 1, type: 'string', required: true, kind: 'release' }],
    line: (args) => ['get', 'machine', args.version],
  },
  // ⭐⭐ The worked example for an optional positional. Leaving the name out is
  // a real reading of this command — it copies everything `--from` holds — and
  // while the usage line was hand-written it said the opposite for months.
  'get.plugin': {
    mutates: true,
    params: [
      { name: 'source', at: 1, type: 'string', kind: 'pluginSource' },
      { name: 'to', type: 'string', required: true, kind: 'cabinet' },
      { name: 'from', type: 'string', kind: 'cabinet' },
      { name: 'id', type: 'string', kind: 'pluginId' },
    ],
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
    params: [{ name: 'to', type: 'string', required: true, kind: 'sandbox' }],
    line: (args) => ['get', 'signin', '--to', cabinetOf(args)],
  },
  'get.chat': {
    mutates: true,
    params: [
      { name: 'from', type: 'string', required: true, kind: 'cabinet' },
      { name: 'to', type: 'string', required: true, kind: 'cabinet' },
      { name: 'force', type: 'boolean' },
    ],
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
    params: [{ name: 'version', at: 1, type: 'string', required: true, kind: 'releaseOrFolder' }],
    line: (args) => ['rm', 'machine', args.version],
  },
  'rm.plugin': {
    mutates: true,
    params: [
      { name: 'target', at: 1, type: 'string', required: true, kind: 'pluginRef' },
      { name: 'from', type: 'string', required: true, kind: 'cabinet' },
    ],
    line: (args) => [
      'rm', 'plugin', args.id ?? args.bundle ?? args.target,
      '--from', cabinetOf(args),
    ],
  },
  'rm.sandbox': {
    mutates: true,
    params: [{ name: 'sandbox', at: 1, type: 'string', required: true, kind: 'sandbox' }],
    line: (args) => ['rm', 'sandbox', args.sandbox],
  },
  'rm.signin': {
    mutates: true,
    params: [{ name: 'from', type: 'string', required: true, kind: 'cabinet' }],
    line: (args) => ['rm', 'signin', '--from', cabinetOf(args)],
  },
  'rm.setting': {
    mutates: true,
    params: [],
    line: () => ['rm', 'setting'],
  },

  // ── start / stop
  start: {
    mutates: true,
    // ⭐ Two readings — name a cabinet, or ask for a new one — and everything
    //    else is common to both, so the listing says `[选项]` once and the
    //    per-command page spells the options out.
    params: [
      { name: 'sandbox', at: 1, type: 'string', kind: 'cabinet' },
      { name: 'new', type: 'boolean' },
      { name: 'version', type: 'string', kind: 'releaseOrFolder' },
      { name: 'plugin', type: 'string', kind: 'pluginId', repeat: true },
      { name: 'unplug', type: 'string', kind: 'pluginId', repeat: true },
      { name: 'no-sign-in', type: 'boolean' },
      { name: 'sign-in', type: 'boolean' },
      { name: 'sign-out', type: 'boolean' },
      // ⛔ Not on the tool face: with it, `start` never returns, and a tool call
      //    cannot be held open. The agent reads `logs` afterwards instead.
      { name: 'follow', type: 'boolean', mcp: false },
    ],
    forms: [['sandbox'], ['new', 'version?']],
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
    params: [
      { name: 'sandbox', at: 1, type: 'string', kind: 'cabinet' },
      { name: 'all', type: 'boolean' },
      { name: 'window', type: 'boolean' },
      { name: 'download', type: 'boolean' },
    ],
    forms: [['sandbox'], ['all'], ['window'], ['download']],
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
    params: [
      { name: 'target', at: 1, type: 'string', kind: 'pluginId' },
      { name: 'state', at: 2, type: 'string', enum: ['on', 'off'] },
      { name: 'undo', type: 'boolean' },
      { name: 'in', type: 'string', required: true, kind: 'cabinet' },
      { name: 'at', type: 'string', kind: 'timestamp' },
    ],
    forms: [['target', 'state', 'in'], ['undo', 'in', 'at?']],
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
    params: [
      { name: 'path', at: 1, type: 'string', required: true, kind: 'folder' },
      { name: 'in', type: 'string', required: true, kind: 'cabinet' },
      { name: 'title', type: 'string', kind: 'title' },
    ],
    line: (args) => ['set', 'workspace', args.path ?? args.target, '--in', cabinetOf(args)],
  },
  // ⭐⭐ The worked example for enums. These three values used to exist only
  // inside the usage sentence, where recovering them means parsing prose — and
  // that is exactly the thing an outside report on generating tool schemas from
  // an existing command line said could not be recovered. Declared, they reach
  // the help line, the argument check and a tool schema without being written
  // down three times.
  'set.source': {
    mutates: true,
    params: [{ name: 'value', at: 1, type: 'string', required: true, enum: SOURCE_CHOICES }],
    // `value` is what the record carries before the command has resolved
    // anything; `source` is what it carries afterwards. Reading only the
    // second one left a refused `set source` rendering without its value.
    line: (args) => ['set', 'source', args.source ?? args.value],
  },
  'set.lang': {
    mutates: true,
    params: [{ name: 'value', at: 1, type: 'string', required: true, enum: LANGS }],
    line: (args) => ['set', 'lang', args.value],
  },
  'set.ask-on-quit': {
    mutates: true,
    params: [{ name: 'value', at: 1, type: 'string', required: true, enum: ['on', 'off'] }],
    line: (args) => ['set', 'ask-on-quit', args.value],
  },
  // ⚠️ Was missing until 2026-08-22: the setting worked, but with no entry here
  // it was absent from `--help` and its journal line rendered as nothing. A
  // command table that the help is generated from only covers what is in it.
  'set.ask-on-daily': {
    mutates: true,
    params: [{ name: 'value', at: 1, type: 'string', required: true, enum: ['on', 'off'] }],
    line: (args) => ['set', 'ask-on-daily', args.value],
  },
  // ⛔ 改的是这台电脑不是这个数据目录,但它确实是个开关,而且便携包的用户要自己
  //    敲一次 —— 文档里写着「你自己敲一次」的那一句,是代码里永远找不到的调用方。
  //    所以它是真·用户命令,归 set,不藏进安装器。
  'set.path': {
    mutates: true,
    params: [
      { name: 'state', at: 1, type: 'string', required: true, enum: ['on', 'off'] },
      { name: 'force', type: 'boolean' },
    ],
    // ⛔ Same rule as `set plugin`: an unanswered on/off renders as nothing.
    line: (args) => [
      'set', 'path', args.state === 'on' || args.state === 'off' ? args.state : undefined,
      ...(args.force === true ? ['--force'] : []),
    ],
  },

  // ── 剩下三个动词
  logs: {
    mutates: false,
    // `package` names a plugin download's log the way `version` names a
    // release's: by the thing asked about, so the asker needs no job id.
    params: [
      { name: 'sandbox', at: 1, type: 'string', kind: 'cabinet' },
      { name: 'shape', type: 'boolean' },
      { name: 'errors', type: 'boolean' },
      { name: 'lines', type: 'string', kind: 'count' },
      { name: 'all', type: 'boolean' },
      { name: 'version', type: 'string', kind: 'release' },
      { name: 'package', type: 'string', kind: 'packageName' },
    ],
    forms: [['sandbox'], ['version'], ['package']],
  },
  // ⛔ Not on the tool face: it serves until stopped, so a tool call to it would
  //    never come back. The one moment an agent needs the panel — a refusal that
  //    wants a person — the command line opens it by itself (`throughThePanel`).
  ui: {
    mutates: false,
    mcp: false,
    params: [
      { name: 'no-open', type: 'boolean' },
      { name: 'port', type: 'string', kind: 'port' },
    ],
  },
  // ⭐ The third face. Speaks MCP over stdio and, for every tool call, runs the
  //    same command line the config window runs for a button — one declaration,
  //    three projections. Details and the hook-up line are in its help page.
  // ⛔ Not itself a tool: a server offering a tool that starts another server on
  //    the same stdio would be calling into its own mouth.
  mcp: {
    mutates: false,
    mcp: false,
    // ⭐ The one knob: how big an answer may be before it is replaced by a
    //    `partial` stand-in. A default is allowed here for the same reason
    //    `--format` may have one — not giving it errs on the small side, never
    //    towards "dump everything".
    params: [{ name: 'max-chars', type: 'string', kind: 'chars' }],
  },
  // ⛔⛔ `agent attach` / `agent detach` 曾经在这里,2026-08-30 整个删掉。它们要求
  //    调用方**声明**一件这个程序自己已经知道的事(有没有命令正在跑、是不是配置窗
  //    自己起的),而判据一直都在(src/sandbox.js 的 startedByWindow)。判例:两个
  //    互不知情的 agent 先后都忘了敲,于是人开着面板,看着沙箱被起被停、PATH 被改,
  //    面板一个字都没有。现在由 src/journal.js 的 noteCommand 在漏斗上自动登记。
}

/**
 * The on/off flags a command takes, worked out from its parameters.
 *
 * ⭐ Derived rather than declared alongside, because two lists of the same
 * thing is the defect this whole table exists against.
 * @param {CommandShape} shape
 * @returns {string[]}
 */
export function booleansOf(shape) {
  return (shape.params ?? []).filter((one) => one.at === undefined && one.type === 'boolean').map((one) => one.name)
}

/**
 * The flags that take the next token.
 * @param {CommandShape} shape
 * @returns {string[]}
 */
export function valuesOf(shape) {
  return (shape.params ?? []).filter((one) => one.at === undefined && one.type === 'string').map((one) => one.name)
}

/**
 * The arguments that are given by position, in order.
 * @param {CommandShape} shape
 * @returns {Param[]}
 */
export function positionalsOf(shape) {
  return (shape.params ?? []).filter((one) => one.at !== undefined).sort((a, b) => a.at - b.at)
}

/**
 * The usage line, written out from the parameters.
 *
 * ⛔⛔ Generated, never hand-written, and the reason is a measured one rather
 * than tidiness: `get plugin` grew the ability to copy a whole cabinet, the
 * hand-written usage line went on printing its positional as required and never
 * mentioned `--from`, and so a capability that worked and was under test was
 * unreachable by anybody reading the help. **Behaviour and its description are
 * different facts, and only one of them had a guard.**
 *
 * ⚠️ Two more things it is not allowed to be: a second place enums live (they
 * come from the parameter), and English (the value words are looked up per
 * language, so both faces are generated from the one declaration).
 * @param {string} name
 * @param {CommandShape} shape
 * @returns {string}
 */
export function usageOf(name, shape) {
  const words = name.split('.').join(' ')
  const params = shape.params ?? []
  if (shape.forms === undefined) {
    return [words, ...params.map((one) => usageWord(one, one.required === true))].join(' ')
  }
  // ⭐ Forms: each writing lists what defines it; whatever no form names is a
  //    common option and is said once, as one word, so the listing stays one
  //    line. The per-command page lists every option in full.
  const named = new Set(shape.forms.flat().map((entry) => entry.replace(/\?$/, '')))
  const hasOptions = params.some((one) => !named.has(one.name))
  return shape.forms.map((form) => {
    const byName = new Map(params.map((one) => [one.name, one]))
    const parts = form.map((entry) => {
      const optional = entry.endsWith('?')
      return usageWord(byName.get(entry.replace(/\?$/, '')), !optional)
    })
    return [words, ...parts, ...(hasOptions ? [`[${t('param.options')}]`] : [])].join(' ')
  }).join(' | ')
}

/**
 * One parameter as it appears in a usage line.
 * @param {Param} one
 * @param {boolean} required - in this writing, not in general.
 * @returns {string}
 */
function usageWord(one, required) {
  const value = one.enum === undefined ? t(`param.${one.kind}`) : one.enum.join('|')
  const body = one.at !== undefined
    ? (required ? `<${value}>` : `[${value}]`)
    : one.type === 'boolean' ? `--${one.name}` : `--${one.name} <${value}>`
  const tail = one.repeat === true ? ' ...' : ''
  if (one.at !== undefined) return `${body}${tail}`
  return required ? `${body}${tail}` : `[${body}${tail}]`
}

/**
 * Flags every command understands, declared once rather than on each.
 *
 * `--box` points the data directory anywhere; `--json` asks for the machine
 * answer; `--help` asks about the command instead of running it. The config
 * window fills the first two in itself. Declared here so that a per-command
 * flag check can tell "not this command's flag" from "not anybody's flag", and
 * so a tool schema can say where the data directory goes.
 * @type {Param[]}
 */
export const GLOBAL_PARAMS = [
  { name: 'box', type: 'string', kind: 'folder' },
  { name: 'json', type: 'boolean' },
  { name: 'help', type: 'boolean' },
]

/**
 * The shapes of the machine answer this build can produce.
 *
 * ⭐ A bare `--json` is a promise with no exit: once callers have written it,
 * the shape it returns can never change without breaking all of them, and it
 * cannot be versioned later because bare `--json` is already, to everyone, the
 * first version. So the first version is named on day one — `--json=1` is the
 * explicit spelling, bare `--json` means 1 for good, and every JSON line says
 * which shape it is in `schema`. A second shape is `--json=2`, and asking for
 * one this build does not have is refused rather than answered in the old
 * shape.
 */
export const JSON_SCHEMAS = [1]
export const JSON_SCHEMA_DEFAULT = 1

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
 * @param {'summary' | 'notes' | 'after'} part - ⛔ not `usage`: that line is
 * generated by {@link usageOf}, and a stored sentence beside it would be the
 * second copy this table exists to make impossible.
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
  ...GLOBAL_PARAMS.filter((one) => one.type === 'boolean').map((one) => one.name),
  ...Object.values(COMMANDS).flatMap((shape) => booleansOf(shape)),
])

/** Flags that take the token after them, across all commands. */
export const VALUE_FLAGS = new Set([
  ...GLOBAL_PARAMS.filter((one) => one.type === 'string').map((one) => one.name),
  ...Object.values(COMMANDS).flatMap((shape) => valuesOf(shape)),
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
  return Object.entries(COMMANDS).map(([name, shape]) => ({ usage: usageOf(name, shape), summary: say(name, 'summary') }))
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
    usage: usageOf(name, shape),
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
    booleans: booleansOf(shape),
    values: valuesOf(shape),
    // ⭐ The parameters with their words filled in for the current language:
    //    what stands in for the value, what it means, which values are legal.
    //    This is the part a tool schema is built from, and the part a per-command
    //    help page prints as a table — the same list, two faces.
    params: (shape.params ?? []).map((one) => describeParam(name, one)),
    notes: notes === '' ? [] : notes.split('\n'),
  }
}

/**
 * Where a parameter's sentence lives in the message table.
 * @param {string | null} command - `null` for one of {@link GLOBAL_PARAMS}.
 * @param {Param} one
 * @returns {string}
 */
export function paramKey(command, one) {
  return command === null ? `global.param.${one.name}` : `cmd.${command}.param.${one.name}`
}

/**
 * One parameter, with its words looked up.
 * @param {string | null} command - `null` for one of {@link GLOBAL_PARAMS}.
 * @param {Param} one
 */
export function describeParam(command, one) {
  const key = paramKey(command, one)
  const sentence = t(key, { historyLines: HISTORY_LINES, keepBackups: KEEP_BACKUPS })
  return {
    name: one.name,
    type: one.type,
    ...(one.at === undefined ? {} : { at: one.at }),
    required: one.required === true,
    ...(one.enum === undefined ? {} : { enum: one.enum }),
    ...(one.repeat === true ? { repeat: true } : {}),
    // The word that stands in for the value in a usage line, already translated.
    ...(one.type === 'boolean' || one.enum !== undefined ? {} : { valueWord: t(`param.${one.kind}`) }),
    description: sentence === key ? '' : sentence,
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
  const carriesValue = new Set(valuesOf(shape).map((flag) => `--${flag}`))
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
