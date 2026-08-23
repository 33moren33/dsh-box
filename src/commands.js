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
 * `plugins add` and `plugins rm` are separate entries while `plugins` on its
 * own is a third: they are three different actions wearing one word, and two
 * of them change state while the other does not.
 * @type {Record<string, CommandShape>}
 */
export const COMMANDS = {
  versions: {
    mutates: false,
  },
  pull: {
    mutates: true,
    line: (args) => ['pull', args.version],
  },
  drop: {
    mutates: true,
    line: (args) => ['drop', args.version],
  },
  plugins: {
    mutates: false,
    booleans: ['main'],
    values: ['sandbox'],
  },
  'plugins.add': {
    mutates: true,
    values: ['id'],
    // The directory is what was pointed at; the id is what it became. Both are
    // written out because an id derived from a package name is not obvious
    // from the path, and re-running with only the path could land elsewhere.
    line: (args) => ['plugins', 'add', args.path ?? args.target, '--id', args.id],
  },
  'plugins.rm': {
    mutates: true,
    booleans: ['approved'],
    line: (args) => ['plugins', 'rm', args.id ?? args.target],
  },
  'plugins.install': {
    mutates: true,
    booleans: ['main'],
    values: ['sandbox', 'id'],
    line: (args) => [
      'plugins', 'install', args.source ?? args.id ?? args.target,
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
    ],
  },
  'plugins.uninstall': {
    mutates: true,
    booleans: ['main'],
    values: ['sandbox'],
    line: (args) => [
      'plugins', 'uninstall', args.id ?? args.target,
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
    ],
  },
  history: {
    mutates: false,
    booleans: ['shape'],
    values: ['lines'],
  },
  workspaces: {
    mutates: false,
    booleans: ['main'],
    values: ['sandbox'],
  },
  'workspaces.use': {
    mutates: true,
    booleans: ['main'],
    values: ['sandbox', 'title'],
    line: (args) => [
      'workspaces', 'use', args.target ?? args.path,
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
    ],
  },
  packages: {
    mutates: false,
  },
  'packages.rm': {
    mutates: true,
    line: (args) => ['packages', 'rm', args.target ?? args.name],
  },
  'packages.prune': {
    mutates: true,
    line: () => ['packages', 'prune'],
  },
  'plugins.backups': {
    mutates: false,
    booleans: ['main'],
    values: ['sandbox'],
  },
  'plugins.backups.rm': {
    mutates: true,
    booleans: ['main'],
    values: ['sandbox'],
    line: (args) => [
      'plugins', 'backups', 'rm', args.target ?? args.at,
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
    ],
  },
  'plugins.backups.prune': {
    mutates: true,
    booleans: ['main'],
    values: ['sandbox', 'keep'],
    line: (args) => [
      'plugins', 'backups', 'prune',
      ...(args.keep === undefined ? [] : ['--keep', String(args.keep)]),
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
    ],
  },
  'plugins.restore': {
    mutates: true,
    booleans: ['main'],
    values: ['sandbox', 'at'],
    line: (args) => [
      'plugins', 'restore',
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
      ...(args.at === undefined || args.at === null ? [] : ['--at', args.at]),
    ],
  },
  sandboxes: {
    mutates: false,
  },
  start: {
    mutates: true,
    booleans: ['new', 'main', 'no-sign-in', 'sign-in', 'sign-out', 'follow', 'approved'],
    values: ['version', 'sandbox', 'plugin', 'unplug'],
    // Every blank filled in: no `--new` (which names a different sandbox each
    // time it runs) and no reliance on the working directory.
    //
    // `--version` is written only when one was asked for. Its absence is not a
    // blank left unfilled — it is the answer "the machine this computer has",
    // which stays the same answer whenever the line is re-run.
    //
    // ⛔ `--approved` is deliberately never rendered. It is the one thing here
    // that is not a fact about the launch but a person's consent to it, and a
    // line that carries consent along would let one click authorise every
    // re-run. So the rendered line for that launch is refused until somebody
    // agrees again — which is the correct behaviour, not a gap.
    line: (args) => [
      'start',
      ...(args.version === undefined || args.version === null ? [] : ['--version', args.version]),
      ...(args.main === true ? ['--main'] : ['--sandbox', args.sandbox]),
      ...(args.plugins ?? []).flatMap((id) => ['--plugin', id]),
      ...(args.unplugged ?? []).flatMap((id) => ['--unplug', id]),
      ...(args.importSignIn === false ? ['--no-sign-in'] : []),
      ...(args.signIn === true ? ['--sign-in'] : []),
      ...(args.signOut === true ? ['--sign-out'] : []),
    ],
  },
  // ⭐ Sign-in is a property of a cabinet, like a plugin is — not a choice made
  // at launch. So it gets the same two shapes a plugin has: a standalone verb
  // for changing it whenever, and a flag on `start` for changing it on the way
  // in. `--no-sign-in` stays what it always was and says nothing about either:
  // it is about the moment a sandbox is *created*.
  signin: {
    mutates: true,
    values: ['sandbox'],
    line: (args) => ['signin', args.sandbox],
  },
  signout: {
    mutates: true,
    booleans: ['main', 'approved'],
    values: ['sandbox'],
    line: (args) => ['signout', ...(args.main === true ? ['--main'] : [args.sandbox])],
  },
  stop: {
    mutates: true,
    booleans: ['main'],
    line: (args) => (args.main === true ? ['stop', '--main'] : ['stop', args.sandbox]),
  },
  adopt: {
    mutates: true,
    booleans: ['force'],
    values: ['from', 'to'],
    // Always written out in the long form: the shorthand hides which direction
    // it went, and a line that has to be re-read to know what it did is not
    // the line this renders for.
    line: (args) => [
      'adopt',
      '--from', args.fromSandbox ?? 'main',
      '--to', args.toSandbox ?? 'main',
      ...(args.force === true ? ['--force'] : []),
    ],
  },
  rm: {
    mutates: true,
    line: (args) => ['rm', args.sandbox],
  },
  config: {
    mutates: false,
  },
  'config.source': {
    mutates: true,
    // `value` is what the record carries before the command has resolved
    // anything; `source` is what it carries afterwards. Reading only the
    // second one left a refused `config source` rendering without its value.
    line: (args) => ['config', 'source', args.source ?? args.value],
  },
  'config.lang': {
    mutates: true,
    line: (args) => ['config', 'lang', args.value],
  },
  'config.ask-on-quit': {
    mutates: true,
    line: (args) => ['config', 'ask-on-quit', args.value],
  },
  // ⚠️ Was missing until 2026-08-22: the setting worked, but with no entry here
  // it was absent from `--help` and its journal line rendered as nothing. A
  // command table that the help is generated from only covers what is in it.
  'config.ask-on-daily': {
    mutates: true,
    line: (args) => ['config', 'ask-on-daily', args.value],
  },
  'config.reset': {
    mutates: true,
    line: () => ['config', 'reset'],
  },
  ui: {
    mutates: false,
    booleans: ['no-open'],
    values: ['port'],
  },
  quit: {
    mutates: true,
    booleans: ['main'],
    line: (args) => ['quit', ...(args.main === true ? ['--main'] : [])],
  },
  status: {
    mutates: false,
  },
  logs: {
    mutates: false,
    booleans: ['shape', 'errors', 'all', 'main'],
    values: ['lines', 'version'],
  },
  attach: {
    mutates: false,
  },
  detach: {
    mutates: false,
    booleans: ['forced'],
  },
  memory: {
    mutates: false,
  },
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
 * @param {'usage' | 'summary' | 'notes'} part
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
 * @param {string} name - the recorded command name, e.g. `plugins.add`.
 * @param {Record<string, unknown>} args - the resolved arguments.
 * @returns {string | null} the command line, or null when the command is not
 * one that gets recorded.
 */
export function commandLine(name, args = {}) {
  const shape = COMMANDS[name]
  if (shape?.line === undefined) return null
  // ⛔ A flag and its value are one thing, and dropping blanks one token at a
  // time cannot know that: the value went and the flag stayed, so a record
  // missing its cabinet rendered as `… --sandbox` with nothing after it —
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
