/**
 * What the agent did, written down.
 *
 * Two different things are wanted from the same events, and keeping them in
 * one file would compromise both:
 *
 * The **journal** is the durable one. Every action that changed something
 * lands in it and stays, so a question asked next week still has an answer.
 *
 * The **session** is the throwaway one. It holds the actions of the current
 * run of agent control, numbered, and it exists so the window can show what
 * is being done to it — and, after the agent leaves, so the person can ask
 * what just happened. It is overwritten by the next run, which is the point:
 * it is a display, not a record.
 *
 * The two are also separated because the session must survive a run that
 * changed nothing. An agent that attaches, reads the state and leaves has not
 * replaced anything worth showing, and wiping the previous session for it
 * would throw away the answer to "what did it do last time" in favour of
 * "nothing".
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Directory holding the agent's own state, inside the data directory. */
function agentDir(layout) {
  return join(layout.root, 'agent')
}

/** Marker saying an agent currently holds control. Verified against a pid. */
function activeFile(layout) {
  return join(agentDir(layout), 'active.json')
}

/** The session being displayed: the last run that changed anything. */
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
 * @typedef {object} ActiveControl
 * @property {string} startedAt - ISO timestamp.
 * @property {string} session - id of the session this control opened.
 */

/**
 * Take control, announcing it on disk so the window can show it.
 *
 * The marker does not expire. It was tempting to make it — an agent that
 * crashes never releases anything — but expiry means guessing whether an
 * agent is still there, and a wrong guess hands the window back while it is
 * still being driven. Nothing has to be guessed: while an agent drives, the
 * person's only action is to stop it, and that button is always there. A
 * forgotten release therefore costs one click, not a collision.
 *
 * The previous session's display is deliberately left alone: it is replaced
 * by the first action that changes something, not by the mere fact that
 * someone attached.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {ActiveControl}
 */
export function attach(layout) {
  mkdirSync(agentDir(layout), { recursive: true })
  const record = {
    startedAt: new Date().toISOString(),
    session: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
  writeFileSync(activeFile(layout), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/**
 * Give control back.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} [reason] - recorded on the session so the person can see
 * whether the agent finished or was stopped.
 * @returns {ActiveControl | null} what was released, or null if nothing was held.
 */
export function detach(layout, reason = 'done') {
  const held = activeControl(layout)
  rmSync(activeFile(layout), { force: true })
  if (held === null) return null
  const session = readSession(layout)
  if (session !== null && session.session === held.session) {
    writeSession(layout, { ...session, endedAt: new Date().toISOString(), endedBy: reason })
  }
  return held
}

/**
 * Who holds control right now, or null.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {ActiveControl | null}
 */
export function activeControl(layout) {
  return readJson(activeFile(layout))
}

/**
 * Say what is being run, right now.
 *
 * Two different questions are being answered by two different records, and
 * conflating them was a mistake worth naming: the numbered trail is *what
 * this session did* and only changes when something changes, while this is
 * *what is happening at this moment* and changes for every command, reading
 * ones included. Without it the window has nothing to put on the badge while
 * an agent spends two minutes downloading a release, or runs a command that
 * has no control to highlight.
 *
 * This writes on every command, which is what the deleted heartbeat did too —
 * but a heartbeat existed to guess whether the agent was still there, and
 * this exists to state what it is doing. One was inventing, this is
 * reporting.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name - the command as typed.
 * @param {Record<string, unknown>} [flags]
 */
export function noteCommand(layout, name, flags = {}) {
  const held = activeControl(layout)
  if (held === null) return
  const lastCommand = { name, flags, at: new Date().toISOString(), finishedAt: null, ok: null }
  writeFileSync(activeFile(layout), `${JSON.stringify({ ...held, lastCommand }, null, 2)}\n`)
}

/**
 * Close off the command {@link noteCommand} opened, so the badge can stop
 * saying something is in progress once it is not.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {boolean} ok
 * @param {string} [code] - failure code, when it failed.
 */
export function finishCommand(layout, ok, code) {
  const held = activeControl(layout)
  if (held === null || held.lastCommand === undefined || held.lastCommand === null) return
  const lastCommand = { ...held.lastCommand, finishedAt: new Date().toISOString(), ok, code: code ?? null }
  writeFileSync(activeFile(layout), `${JSON.stringify({ ...held, lastCommand }, null, 2)}\n`)
}

/**
 * Control, plus when it was last heard from.
 *
 * The window reports this instead of deciding what it means. "Held since
 * 14:02, last action 45 minutes ago" is something a person can act on; "the
 * agent has gone" is a guess, and the honest-reporting rule this project runs
 * on says to show the fact and let the person judge.
 *
 * There is no separate heartbeat: the journal's last entry already says when
 * something happened, so recording the same thing twice would only create a
 * second place for it to be wrong.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{session: string, startedAt: string, lastCommand: object | null, lastActionAt: string | null, actions: number} | null}
 */
export function controlStatus(layout) {
  const held = activeControl(layout)
  if (held === null) return null
  const session = readSession(layout)
  const mine = session !== null && session.session === held.session ? session : null
  return {
    session: held.session,
    startedAt: held.startedAt,
    lastCommand: held.lastCommand ?? null,
    lastActionAt: mine?.actions.at(-1)?.at ?? null,
    actions: mine?.actions.length ?? 0,
  }
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
 * Write down one action that changed something.
 *
 * Read-only commands are not passed here at all: they belong to neither the
 * journal (nothing changed) nor the display (see the module note).
 * @param {import('./paths.js').BoxLayout} layout
 * @param {ActionEntry} entry
 * @returns {number} the sequence number within the current session, or 0 when
 * no agent holds control.
 */
export function record(layout, entry) {
  appendJournal(layout, entry)
  const held = activeControl(layout)
  if (held === null) return 0

  const previous = readSession(layout)
  const session = previous !== null && previous.session === held.session
    ? previous
    : { session: held.session, startedAt: held.startedAt, endedAt: null, endedBy: null, actions: [] }
  const seq = session.actions.length + 1
  session.actions.push({ seq, at: new Date().toISOString(), ...entry })
  writeSession(layout, session)
  return seq
}

/**
 * The session the window should be showing: the last run that did something.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{session: string, startedAt: string, endedAt: string | null, endedBy: string | null, actions: object[]} | null}
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
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
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

