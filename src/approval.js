/**
 * The approval queue: how a person says yes to something that touches the
 * daily filing cabinet.
 *
 * ⭐⭐ What changed on 2026-08-28, and why. Consent used to be a **flag**:
 * `--approved` on the command line, added by the config window's page after a
 * dialog was answered. The flag alone never counted — the run also had to be a
 * child of the window — but the page was trusted to decide when to add it, and
 * anything that can post to `/api/command` is served by the same window and
 * inherits the same parentage. So the evidence chain ended at "the page said
 * so", and a page is not a person.
 *
 * Now consent is a **decision recorded against a specific request**. The
 * command line files a request naming the exact argv it wants run and waits;
 * the window draws it and a person answers it; on yes the **window itself runs
 * that argv**, which is what makes the parentage test evidence again rather
 * than a formality. There is no flag to pass, which is the point: the interface
 * no longer has a place to put a lie.
 *
 * ⛔ Honest limits, stated so nobody re-derives them as a discovery:
 *   - This guards the tool's own path, not the machine. Anything running as the
 *     user can edit the same files with a text editor. What it buys is that the
 *     ordinary route cannot be walked without a person, and that going around
 *     it is visibly going around it — the request, the decision and the run are
 *     each written down.
 *   - A person in their own terminal still cannot approve from there. From here
 *     they are indistinguishable from an agent, so they answer in the window —
 *     which is now opened for them rather than merely named in a refusal.
 *   - `/api/approve` is reachable by anything that can already read the page's
 *     pass off the local port. That is one deliberate, named call rather than a
 *     word added to an argument list, and it lands in the operation record.
 *     Closing it completely needs consent to arrive from outside HTTP, which
 *     the browser face cannot offer.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { uiSeatFile } from './paths.js'
import { liveClaim } from './sandbox.js'

/**
 * How long a person has to answer before the request is withdrawn.
 *
 * ⭐ One minute, decided by the CEO on 2026-08-28. It is short on purpose: the
 * caller is blocked for the whole of it, and a command line that can hang for
 * five minutes waiting for somebody who has walked away is a command line that
 * gets wrapped in a timeout by every caller anyway.
 */
export const APPROVAL_WINDOW_MS = 60_000

/**
 * How long the approved run itself may take before the waiting side gives up.
 *
 * Separate from the window above and much longer, because these are two
 * different waits: one is for a person, the other is for work that person
 * agreed to. Installing a plugin fetches from npm.
 */
const RUN_CEILING_MS = 15 * 60_000

/** How often the waiting command line looks for an answer. */
const POLL_MS = 200

/** How long an answered request stays on disk, so the window can still draw it. */
const KEEP_MS = 10 * 60_000

/**
 * How long to give a window we just started to take its seat.
 *
 * ⛔⛔ Its existence is the point, not its value (CEO 2026-08-28: "弹不出来就
 * 当场报错，不用等一分钟"). Spawning a process that fails to start is not an
 * error the spawn reports — the call succeeds and the window never appears — so
 * without this the caller would wait out the full minute for a person who was
 * never shown anything, and then be told "nobody answered". Two very different
 * failures wearing one sentence.
 */
const PANEL_START_MS = 15_000

/**
 * @typedef {object} ApprovalRequest
 * @property {string} id
 * @property {string[]} argv - exactly what to run if the answer is yes.
 * @property {string} what - one line naming the action, for the dialog.
 * @property {string} why - the refusal's own sentence: what will be touched,
 * where the backup goes, what cannot be undone. ⭐⭐ Carried because a dialog
 * that shows only the command line asks somebody to agree to a string. The
 * command line is the *what* and must be verbatim; this is the *what it does to
 * you*, and it is the half a person actually decides on.
 * @property {string} code - the refusal that caused the ask.
 * @property {Record<string, unknown>} details - what the refusal carried.
 * @property {number} askedAt
 * @property {number} expiresAt
 * @property {number} askedByPid
 * @property {'allow' | 'deny' | null} decision
 * @property {number | null} decidedAt
 * @property {Record<string, unknown> | null} result - what the approved run printed.
 */

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {string}
 */
export function approvalsDir(layout) {
  return join(layout.root, 'approvals')
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} id
 * @returns {string}
 */
function fileOf(layout, id) {
  return join(approvalsDir(layout), `${id}.json`)
}

/**
 * @param {string} file
 * @returns {ApprovalRequest | null}
 */
function readRecord(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed?.id === 'string' ? parsed : null
  } catch {
    // A half-written or unreadable request decides nothing, and it must not be
    // able to stop the window from drawing the rest.
    return null
  }
}

/**
 * Write a request whole or not at all.
 *
 * Rename rather than write-in-place for the same reason every other state file
 * here does it: the reader polls, and a reader that catches a half-written file
 * would see a request with no decision in it and answer "still waiting" forever.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {ApprovalRequest} record
 * @returns {ApprovalRequest}
 */
function writeRecord(layout, record) {
  mkdirSync(approvalsDir(layout), { recursive: true })
  const file = fileOf(layout, record.id)
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(temp, file)
  return record
}

/**
 * Throw away requests nobody can act on any more.
 * @param {import('./paths.js').BoxLayout} layout
 */
function sweep(layout) {
  const dir = approvalsDir(layout)
  if (!existsSync(dir)) return
  const now = Date.now()
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    const record = readRecord(join(dir, entry))
    const stale = record === null || now - record.askedAt > KEEP_MS
    if (stale) rmSync(join(dir, entry), { force: true })
  }
}

/**
 * Every request on disk, newest first.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {ApprovalRequest[]}
 */
function allRecords(layout) {
  const dir = approvalsDir(layout)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readRecord(join(dir, entry)))
    .filter((record) => record !== null)
    .sort((left, right) => right.askedAt - left.askedAt)
}

/**
 * File a request and return it. The caller then waits.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} ask
 * @param {string[]} ask.argv
 * @param {string} ask.what
 * @param {string} [ask.why]
 * @param {string} [ask.code]
 * @param {Record<string, unknown>} [ask.details]
 * @returns {ApprovalRequest}
 */
export function askApproval(layout, { argv, what, why = '', code = 'NEEDS_APPROVAL', details = {} }) {
  sweep(layout)
  const now = Date.now()
  return writeRecord(layout, {
    id: randomUUID(),
    argv,
    what,
    why,
    code,
    details,
    askedAt: now,
    expiresAt: now + APPROVAL_WINDOW_MS,
    askedByPid: process.pid,
    decision: null,
    decidedAt: null,
    result: null,
  })
}

/**
 * The requests a person still has time to answer. What the window draws.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {ApprovalRequest[]}
 */
export function pendingApprovals(layout) {
  const now = Date.now()
  return allRecords(layout).filter((record) => record.decision === null && record.expiresAt > now)
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} id
 * @returns {ApprovalRequest | null}
 */
export function readApproval(layout, id) {
  return typeof id === 'string' && id !== '' ? readRecord(fileOf(layout, id)) : null
}

/**
 * Record a person's answer.
 *
 * ⛔ An expired request cannot be answered late. The command line that filed it
 * has already given up and told its caller so, and running the action after
 * that would be doing something nobody is waiting for and nobody was told about.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} id
 * @param {'allow' | 'deny'} decision
 * @returns {ApprovalRequest | null} null when there is nothing answerable.
 */
export function decideApproval(layout, id, decision) {
  const record = readApproval(layout, id)
  if (record === null) return null
  if (record.decision !== null) return record
  if (record.expiresAt <= Date.now()) return null
  return writeRecord(layout, { ...record, decision, decidedAt: Date.now() })
}

/**
 * Attach the outcome of the approved run, which is what the waiting side reads.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} id
 * @param {Record<string, unknown>} result
 * @returns {ApprovalRequest | null}
 */
export function settleApproval(layout, id, result) {
  const record = readApproval(layout, id)
  return record === null ? null : writeRecord(layout, { ...record, result })
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    // ⛔⛔ Deliberately **not** `unref`'d, and this cost a debugging round.
    // While a command line is waiting for a person, this timer is the only
    // thing left in its event loop — so unreferencing it means Node decides
    // there is nothing to wait for and exits. The symptom is the worst kind:
    // exit code 0, no output at all, and the request still sitting on the panel
    // for somebody to answer at a process that is already gone.
    setTimeout(resolve, ms)
  })
}

/**
 * Block until a person answers, or until the minute is up.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} id
 * @returns {Promise<{decision: 'allow' | 'deny' | 'timeout' | 'gone', result: Record<string, unknown> | null}>}
 */
export async function waitForApproval(layout, id) {
  for (;;) {
    const record = readApproval(layout, id)
    // Somebody swept it, or the data directory went away underneath us. Not an
    // approval, and saying "denied" would name a person who never spoke.
    if (record === null) return { decision: 'gone', result: null }
    if (record.decision === 'deny') return { decision: 'deny', result: null }
    if (record.decision === 'allow') {
      if (record.result !== null) return { decision: 'allow', result: record.result }
      if (Date.now() - (record.decidedAt ?? record.askedAt) > RUN_CEILING_MS) {
        return { decision: 'gone', result: null }
      }
    } else if (Date.now() >= record.expiresAt) {
      rmSync(fileOf(layout, id), { force: true })
      return { decision: 'timeout', result: null }
    }
    await sleep(POLL_MS)
  }
}

/**
 * Make sure there is a window for the person to answer in.
 *
 * ⭐⭐ The three shapes this tool ships in need three different answers, and the
 * environment already carries the one fact that tells them apart:
 *   - **installed** and **portable** both run behind an exe, and the shell sets
 *     `DSH_BOX_EXE` when it hands arguments to this script. Starting that exe
 *     with no arguments is the double-click face — a real window.
 *   - **npx** has no exe at all. `ui` is the whole of the window there: it
 *     serves the same page and opens the browser at it.
 * ⚠️ `DSH_BOX_HOME` is passed explicitly because the window must open **this**
 * data directory. Without it the exe would resolve its own default and draw a
 * different box's requests, which is the failure that looks like "the dialog
 * never appeared".
 * ⭐ Returns a live object rather than a verdict, because the verdict is not
 * available yet: `spawn` reports a missing or unrunnable program through an
 * `error` event **after** returning. A function that answered immediately could
 * only ever answer "the call did not throw", and the caller would then sit out
 * its whole timeout waiting for a window that failed a millisecond in.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{kind: 'already' | 'exe' | 'served' | 'failed', broke: boolean}}
 */
export function openPanel(layout) {
  if (liveClaim(uiSeatFile(layout)) !== null) return { kind: 'already', broke: false }
  const env = { ...process.env, DSH_BOX_HOME: layout.root }
  // ⛔ Not detached on Windows, measured: a detached child gets a console of its
  // own there and `windowsHide` does not reach it, so a black box flashes up.
  // A Windows child outlives its parent without being detached; a POSIX one
  // does not, and this parent exits in a minute.
  const away = { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true, env }
  const exe = process.env.DSH_BOX_EXE
  const useExe = typeof exe === 'string' && exe !== '' && existsSync(exe)
  const opened = { kind: useExe ? 'exe' : 'served', broke: false }
  try {
    const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url))
    const child = useExe
      ? spawn(exe, [], away)
      : spawn(process.execPath, [cli, 'ui', '--box', layout.root], away)
    loose(child, opened)
    return opened
  } catch {
    // Not being able to open a window is not a reason to lose the request: it
    // is on disk, and a window opened by hand will find it.
    return { kind: 'failed', broke: true }
  }
}

/**
 * Let a child go, without its failures taking this process down with them.
 *
 * ⛔ `spawn` reports a bad executable through an `error` event rather than by
 * throwing, and an `error` event nobody listens for is an uncaught exception.
 * So a `try` around the call catches the case that cannot happen and misses the
 * one that does — measured elsewhere in this repo, and the reason the listener
 * is here rather than a comment saying it is not needed.
 * @param {import('node:child_process').ChildProcess} child
 * @param {{broke: boolean}} opened - marked so the waiter can stop early.
 */
function loose(child, opened) {
  child.on('error', () => { opened.broke = true })
  child.unref()
}

/**
 * Whether a window is actually serving this data directory now.
 *
 * ⭐ The seat is the proof, and it is the same proof for all three shapes: exe
 * or npx, whatever starts the window ends up holding this one file. "We spawned
 * something" is not evidence — {@link openPanel} returning `exe` only means the
 * call did not throw.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {boolean}
 */
export function panelServing(layout) {
  return liveClaim(uiSeatFile(layout)) !== null
}

/**
 * Open a window if there is none, and wait until it is really up.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {Promise<boolean>} whether there is a window to answer in.
 */
export async function ensurePanel(layout) {
  const opened = openPanel(layout)
  if (opened.kind === 'already') return true
  const deadline = Date.now() + PANEL_START_MS
  while (Date.now() < deadline) {
    if (panelServing(layout)) return true
    // ⛔ Waiting out the ceiling for something already known to have failed is
    // the small version of the mistake the ceiling itself exists to avoid.
    if (opened.broke) return false
    await sleep(POLL_MS)
  }
  return panelServing(layout)
}
