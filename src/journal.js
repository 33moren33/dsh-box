/**
 * What the agent did, written down.
 *
 * Two different things are wanted from the same events, and keeping them in
 * one file would compromise both:
 *
 * The **journal** is the durable one. Every action that changed something
 * lands in it and stays, so a question asked next week still has an answer.
 *
 * The **session** is the throwaway one. It holds the most recent actions,
 * numbered, and it exists so the window can show what is being done to it —
 * and afterwards, so the person can ask what just happened. It is trimmed from
 * the front, which is the point: it is a display, not a record.
 *
 * ⛔⛔ Neither of them is opened by anybody declaring anything. There used to be
 * an `agent attach` a caller had to type before the window would show a thing,
 * and two agents in a row forgot it: the person sat in front of the panel while
 * sandboxes were started, stopped and their PATH rewritten, and the panel said
 * nothing. **Asking a caller to declare something the tool can already work out
 * is redundancy**, and redundancy is where the two copies drift apart. What is
 * written down now is written by the command itself, whoever ran it.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { instantNow } from './clock.js'
import { mutates } from './commands.js'
import { claimPath, liveClaim, releasePath, startedByWindow } from './sandbox.js'

/** Directory holding the agent's own state, inside the data directory. */
function agentDir(layout) {
  return join(layout.root, 'agent')
}

/**
 * One file per running command, named by the process running it.
 *
 * ⭐ A file each rather than one shared list, so two agents working at once
 * never have to lock each other out of anything: each writes only its own name
 * and reads everybody's. The old single-holder marker did the opposite — the
 * second agent's `attach` overwrote the first's with no word to either.
 */
function runsDir(layout) {
  return join(agentDir(layout), 'runs')
}

/**
 * This process's own row in that directory.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {string}
 */
function runFile(layout) {
  return join(runsDir(layout), `${process.pid}.json`)
}

/** The trail being displayed: the most recent actions, whoever did them. */
function sessionFile(layout) {
  return join(agentDir(layout), 'last-session.json')
}

/** The durable journal. */
function journalFile(layout) {
  return join(layout.root, 'logs', 'actions.log')
}

/** Journal size at which the current file is rolled over to `.1`. */
const JOURNAL_MAX_BYTES = 2 * 1024 * 1024

/**
 * Read the durable journal back, oldest first.
 *
 * ⛔ **Nothing could read this file, and that was the whole problem with it.**
 * It was defined as the durable log a person consults when something has gone
 * wrong — while no command and no screen could open it, and it drops a
 * generation of itself at 2MB. A pile nobody can read, which also throws part
 * of itself away, has no reason to exist. Worse, it left `cat` from a shell as
 * the only way to see what had happened, and a shell is precisely where the
 * window cannot follow.
 *
 * The rolled generation is included, because leaving it out would be its own
 * kind of silent truncation: the answer to "what happened" would quietly begin
 * at whenever the file last rolled over.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{entries: object[], unreadable: number, files: string[]}}
 */
export function readJournal(layout) {
  const current = journalFile(layout)
  const entries = []
  const files = []
  let unreadable = 0
  // Oldest generation first, so the result reads forwards in time.
  for (const file of [`${current}.1`, current]) {
    if (!existsSync(file)) continue
    files.push(file)
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue
      try {
        entries.push(JSON.parse(line))
      } catch {
        // Counted rather than passed over: a line that cannot be read is still
        // something that happened, and "3 lines unreadable" is the difference
        // between a stated gap and a quiet lie.
        unreadable += 1
      }
    }
  }
  return { entries, unreadable, files }
}

/**
 * How much journal there is, before deciding whether to read it.
 *
 * The first of the three log rules: a fixed-size answer, whatever the size of
 * the thing it describes.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{files: {file: string, bytes: number}[], entries: number, unreadable: number,
 * from: string | null, to: string | null, failures: number}}
 */
export function journalShape(layout) {
  const { entries, unreadable, files } = readJournal(layout)
  return {
    files: files.map((file) => ({ file, bytes: statSync(file).size })),
    entries: entries.length,
    unreadable,
    from: entries[0]?.at ?? null,
    to: entries.at(-1)?.at ?? null,
    failures: entries.filter((entry) => entry.ok === false).length,
  }
}

/**
 * @typedef {object} RunRecord
 * @property {number} pid - the process running the command.
 * @property {number | null} pidBorn - the moment that process started.
 * @property {string} startedAt - ISO timestamp.
 * @property {string} command - the recorded command name, e.g. `get.plugin`.
 * @property {Record<string, unknown>} flags - what it was asked to do.
 * @property {boolean} fromWindow - whether the config window started it.
 */

/**
 * Say that this process is running a command, for as long as it is.
 *
 * ⭐⭐ **The scope is one command's execution and nothing longer.** A mark that
 * outlives the process it describes has to be released by somebody, and the
 * whole reason this exists is that somebody forgets. A mark that dies with the
 * process cannot leak: the record names a pid and a birth moment, and when that
 * pair stops matching it stops counting — no expiry to tune, no button to press.
 * The other half of the same choice: a person typing in their own terminal never
 * has to take the window back either, which matters because from here a person
 * and an agent are indistinguishable, and this file admits it.
 *
 * ⛔ Only commands that change something. `ls` / `logs` / `help` leave nothing
 * behind and so nothing has to stand aside for them; which commands those are is
 * declared once, in `src/commands.js`, and read from there rather than listed
 * again here.
 *
 * ⭐ The liveness proof is not invented here either: {@link claimPath} creates
 * the file exclusively, writes the pid with its birth moment, and clears a dead
 * record on the way — the same mechanism a launch and the window's own seat use.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name - the recorded command name, e.g. `get.plugin`.
 * @param {Record<string, unknown>} [flags]
 * @returns {boolean} whether a record was written.
 */
export function noteCommand(layout, name, flags = {}) {
  if (!mutates(name)) return false
  // ⚠️ Worked out once, here, and read back by {@link record} instead of asked
  // again: on Windows the parentage question and the birth moment each cost a
  // subprocess, and one command must not pay for them twice.
  return claimPath(runFile(layout), {
    command: name, flags, fromWindow: startedByWindow(layout),
  })
}

/**
 * Close off the record {@link noteCommand} opened.
 *
 * ⛔⛔ Must be reached on the failing path too. A record left behind by a command
 * that threw would hold the window aside until that pid is reused — which is
 * exactly the leak this design exists to make impossible, reintroduced by hand.
 * Both exits of `bin/cli.js` call it for that reason.
 * @param {import('./paths.js').BoxLayout} layout
 */
export function finishCommand(layout) {
  releasePath(runFile(layout))
}

/**
 * Every command running right now, whoever started it.
 *
 * ⚠️ Costs one liveness question per record, and on Windows that is a
 * subprocess. Affordable because the directory is empty whenever nothing is
 * running, which is nearly always — the price is paid only while somebody is
 * actually working.
 *
 * A record whose process is gone is deleted rather than reported: it is not a
 * fact about anything any more, and leaving it would make the next reader pay
 * for it again.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {RunRecord[]}
 */
export function runningCommands(layout) {
  let names = []
  try {
    names = readdirSync(runsDir(layout))
  } catch {
    // Nothing has ever run here. Not a failure — it is the ordinary state.
    return []
  }
  const live = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(runsDir(layout), name)
    const held = liveClaim(file)
    if (held === null) rmSync(file, { force: true })
    else live.push(/** @type {RunRecord} */ (held))
  }
  return live.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
}

/**
 * The ones the config window has to stand aside for.
 *
 * ⭐ Its own children are excluded, and that is the whole of the distinction the
 * caller used to have to declare: a command the window started is the window
 * acting, and a window that locked itself out of its own click would be the
 * feature working backwards. See `startedByWindow` in `src/sandbox.js` for why
 * parentage answers this on its own.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {RunRecord[]}
 */
export function outsideCommands(layout) {
  return runningCommands(layout).filter((run) => run.fromWindow !== true)
}

/**
 * @typedef {object} ActionEntry
 * @property {string} command - the command name, e.g. `start`.
 * @property {Record<string, unknown>} [args] - what it was asked to do.
 * @property {boolean} ok
 * @property {string} [code] - failure code, when it failed.
 * @property {string} [message] - failure sentence, when it failed.
 */

/**
 * How many actions the display keeps. The journal keeps all of them.
 *
 * There has to be a number now that nothing closes the trail: it used to be
 * emptied when the next agent took over, and nothing takes over any more. Fifty
 * is one screen of scrolling — past that the panel stops being "what just
 * happened to my settings" and becomes a log, which the journal already is.
 */
const TRAIL_LENGTH = 50

/**
 * Write down one action that changed something.
 *
 * Read-only commands are not passed here at all: they belong to neither the
 * journal (nothing changed) nor the display (see the module note).
 *
 * ⛔⛔ Unconditional. It used to return here without writing anything unless an
 * agent had announced itself first, so an agent that never typed `agent attach`
 * — twice in a row, in practice — did all of its work behind a window that had
 * nothing to show. Whether somebody said "watch me" is not a property of what
 * happened.
 *
 * ⭐ Every entry names the process that did it, so two agents working at once
 * are told apart in the trail rather than blurred into one column of steps.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {ActionEntry} entry
 * @returns {number} the sequence number within the current trail.
 */
export function record(layout, entry) {
  // ⭐ Who did it belongs in the durable one as well, not only on the screen:
  // "which of the two agents started that sandbox" is a question asked days
  // later, and by then the display has scrolled past it.
  const who = whoRan(layout)
  appendJournal(layout, { by: who, ...entry })
  const previous = readSession(layout)
  const session = previous !== null && Array.isArray(previous.actions)
    ? previous
    : { session: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, startedAt: instantNow(), actions: [] }
  // ⛔ Counted from the last number given out, not from the length: the trail is
  // trimmed from the front, and numbering by length would start handing out
  // numbers that are already on the screen against a different action.
  const seq = (session.actions.at(-1)?.seq ?? 0) + 1
  session.actions.push({ seq, at: instantNow(), by: who, ...entry })
  session.actions = session.actions.slice(-TRAIL_LENGTH)
  writeSession(layout, session)
  return seq
}

/**
 * Who is doing this, as the running record already worked it out.
 *
 * Read back rather than asked again — {@link noteCommand} paid for the birth
 * moment and the parentage at the start of this command, and both cost a
 * subprocess on Windows.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{pid: number, pidBorn: number | null, fromWindow: boolean}}
 */
function whoRan(layout) {
  const mine = readJson(runFile(layout))
  return {
    pid: process.pid,
    pidBorn: mine?.pidBorn ?? null,
    fromWindow: mine?.fromWindow === true,
  }
}

/**
 * The trail the window should be showing: the most recent actions, whoever did
 * them.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{session: string, startedAt: string, actions: object[]} | null}
 */
export function readSession(layout) {
  return readJson(sessionFile(layout))
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} session
 */
function writeSession(layout, session) {
  mkdirSync(agentDir(layout), { recursive: true })
  writeFileSync(sessionFile(layout), `${JSON.stringify(session, null, 2)}\n`)
}

/**
 * Append to the durable journal, rolling the file over when it gets large.
 *
 * One previous generation is kept. Keeping none loses the context of whatever
 * happened just before the rollover; keeping many turns a log into an archive
 * nobody prunes.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {ActionEntry} entry
 */
function appendJournal(layout, entry) {
  const file = journalFile(layout)
  mkdirSync(join(layout.root, 'logs'), { recursive: true })
  try {
    if (existsSync(file) && statSync(file).size > JOURNAL_MAX_BYTES) {
      renameSync(file, `${file}.1`)
    }
    appendFileSync(file, `${JSON.stringify({ at: instantNow(), ...entry })}\n`)
  } catch {
    // Losing a journal line must never be the reason a command fails.
  }
}

/**
 * @param {string} file
 * @returns {any | null}
 */
function readJson(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

