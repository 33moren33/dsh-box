/**
 * Sandboxes: one `DSH_HOME` each.
 *
 * `DSH_HOME` is the entire filing cabinet of one dsh installation — which
 * plugins are installed, the profile configuration, the workspace registry,
 * and every conversation. Point dsh at a fresh one and you have a brand new
 * dsh; delete the directory and that dsh never existed, with no uninstall
 * step in between.
 *
 * Two consequences worth stating out loud, because both surprise people:
 * conversations live in the home, so two sandboxes never see each other's
 * history even when opened on the same folder of code; and a sandbox is worth
 * keeping rather than recreating, because a sandbox that has been used has
 * real data in it and real data is what makes a test meaningful.
 */

import {
  copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { boxLayout, sandboxPaths, safeName, userDshHome } from './paths.js'

/**
 * The only file copied out of the user's real dsh home.
 *
 * Copying the whole home is not a heavier version of this — it is broken.
 * A real home is mostly symlinks into the installation, and a recursive copy
 * turns them into real files, after which dsh refuses to load the plugin tree
 * at all. One file, by name, on purpose.
 */
export const CREDENTIALS_FILE = '.credentials.yaml'

/**
 * Machine-wide preferences shared by every profile. Deliberately NOT copied:
 * a sandbox exists to show what the software does without your adjustments,
 * and carrying them in would quietly invalidate exactly the comparison the
 * sandbox was created to make.
 */
export const HOME_PATCH_FILE = 'cordis.patch.yml'

/**
 * @typedef {object} SandboxInfo
 * @property {string} name
 * @property {string} root - the sandbox directory.
 * @property {string} home - the value handed to dsh as `DSH_HOME`.
 * @property {boolean} exists
 * @property {string | null} lastVersion - release last booted here.
 * @property {string | null} lastUsed - ISO timestamp of the last boot.
 * @property {boolean} hasCredentials
 * @property {number} sessionGroups - workspaces that have conversations here.
 * @property {number} sessions - conversations in this home, across all workspaces.
 * @property {RunningRecord | null} running - the live dsh on this home, if any.
 */

/**
 * Describe one sandbox without changing anything.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @returns {SandboxInfo}
 */
export function inspectSandbox(layout, name) {
  const paths = sandboxPaths(layout, name)
  const state = readState(paths.state)
  return {
    name: paths.name,
    root: paths.root,
    home: paths.home,
    exists: existsSync(paths.home),
    lastVersion: state.lastVersion ?? null,
    lastUsed: state.lastUsed ?? null,
    hasCredentials: existsSync(join(paths.home, CREDENTIALS_FILE)),
    sessionGroups: countSessionGroups(paths.home),
    sessions: countSessions(paths.home),
    running: runningRecord(layout, name),
  }
}

/**
 * @typedef {object} RunningRecord
 * @property {number} pid
 * @property {number} port
 * @property {string} url
 * @property {string} version
 * @property {string} startedAt - ISO timestamp.
 */

/**
 * The live dsh on this sandbox, if any — read from the on-disk ledger and
 * verified against a real process before being believed.
 *
 * The ledger lives on disk rather than in anyone's memory so that every
 * entrance — the config window, the CLI, an agent's one-shot command — sees
 * the same answer. A record whose process is gone is deleted on sight: a
 * ledger that is only cleaned by the process that wrote it goes stale the
 * first time that process is killed instead of exiting.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @returns {RunningRecord | null}
 */
export function runningRecord(layout, name) {
  const file = runningFile(layout, name)
  if (!existsSync(file)) return null
  const record = readState(file)
  if (Number.isInteger(record.pid) && record.pid > 0 && pidAlive(record.pid)) {
    return /** @type {RunningRecord} */ (record)
  }
  rmSync(file, { force: true })
  return null
}

/**
 * Record a successful boot in the sandbox's running ledger.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {{pid: number, port: number, url: string, version: string}} record
 */
export function noteRunning(layout, name, record) {
  writeFileSync(
    runningFile(layout, name),
    `${JSON.stringify({ ...record, startedAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

/**
 * Clear the running ledger, but only for the process that owns the entry —
 * a late exit event from a previous dsh must not erase the record of the
 * one currently running.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {number} [pid] - only clear if the ledger names this process.
 */
export function clearRunning(layout, name, pid) {
  const file = runningFile(layout, name)
  if (pid !== undefined && readState(file).pid !== pid) return
  rmSync(file, { force: true })
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @returns {string}
 */
function runningFile(layout, name) {
  return join(sandboxPaths(layout, name).root, 'running.json')
}

/**
 * Whether a process id currently names a live process. Signal 0 performs the
 * permission check without delivering anything; EPERM therefore still means
 * "alive". A recycled pid can in principle impersonate a dead dsh, which is
 * accepted: the cost is one refused launch, not lost data.
 * @param {number} pid
 * @returns {boolean}
 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM'
  }
}

/**
 * Every sandbox in the data directory, most recently used first.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {SandboxInfo[]}
 */
export function listSandboxes(layout) {
  if (!existsSync(layout.sandboxes)) return []
  return readdirSync(layout.sandboxes)
    .filter((entry) => statSync(join(layout.sandboxes, entry)).isDirectory())
    .map((entry) => inspectSandbox(layout, entry))
    .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''))
}

/**
 * A sandbox name that is not in use yet, for the "brand new sandbox" option.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} [prefix]
 * @returns {string}
 */
export function suggestSandboxName(layout, prefix = 'box') {
  const taken = new Set(listSandboxes(layout).map((s) => s.name))
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  for (let n = 1; ; n += 1) {
    const candidate = safeName(`${prefix}-${stamp}-${n}`)
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Create a sandbox, or return the existing one under that name untouched.
 *
 * Reuse is the default on purpose. A sandbox that has been used holds real
 * conversations and real settings, and recreating it throws away the only
 * thing that made it useful for checking anything.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {object} [options]
 * @param {boolean} [options.importSignIn] - copy the credentials file when the
 * sandbox is first created and the user's real home has one.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{info: SandboxInfo, created: boolean, signInImported: boolean}}
 */
export function ensureSandbox(layout, name, { importSignIn = true, env = process.env } = {}) {
  const paths = sandboxPaths(layout, name)
  const created = !existsSync(paths.home)
  mkdirSync(paths.home, { recursive: true })
  let signInImported = false
  if (importSignIn && !existsSync(join(paths.home, CREDENTIALS_FILE))) {
    signInImported = importCredentials(paths.home, env)
  }
  return { info: inspectSandbox(layout, paths.name), created, signInImported }
}

/**
 * Copy the user's credentials file into a sandbox so it starts signed in.
 * @param {string} home - the sandbox home.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether a file was copied.
 */
export function importCredentials(home, env = process.env) {
  const source = join(userDshHome(env), CREDENTIALS_FILE)
  if (!existsSync(source)) return false
  copyFileSync(source, join(home, CREDENTIALS_FILE))
  return true
}

/**
 * Remove the derived module fallback so the next boot rebuilds it.
 *
 * `profiles/node_modules` is a flat directory of symlinks into whichever
 * installation last booted this home. Boot re-points every package the
 * running release knows about, but a package that only exists in some other
 * release keeps its old link — harmless on a normal machine where the old
 * installation is gone, and not harmless here, because this tool keeps every
 * downloaded release side by side. The link would still resolve, to the wrong
 * release. Deleting the directory costs nothing: boot regenerates all of it.
 * @param {string} home - the sandbox home.
 * @returns {boolean} whether anything was removed.
 */
export function clearModuleFallback(home) {
  const fallback = join(home, 'profiles', 'node_modules')
  if (!existsSync(fallback)) return false
  rmSync(fallback, { recursive: true, force: true })
  return true
}

/**
 * Record which release was booted, so the next launch can tell whether the
 * module fallback needs clearing.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {string} version
 */
export function noteBoot(layout, name, version) {
  const paths = sandboxPaths(layout, name)
  const state = readState(paths.state)
  writeFileSync(paths.state, `${JSON.stringify({ ...state, lastVersion: version, lastUsed: new Date().toISOString() }, null, 2)}\n`)
}

/**
 * Whether launching this sandbox on `version` crosses a release boundary.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {string} version
 * @returns {boolean}
 */
export function switchesRelease(layout, name, version) {
  const last = readState(sandboxPaths(layout, name).state).lastVersion
  return typeof last === 'string' && last !== version
}

/**
 * Delete a sandbox and everything in it.
 *
 * Offered as an ordinary button rather than something hidden. dsh states that
 * its on-disk formats are pre-release with no migration path, so a home that
 * a newer release has written may simply stop loading. Throwing one away and
 * starting again is the expected repair, not a last resort.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 */
export function deleteSandbox(layout, name) {
  rmSync(sandboxPaths(layout, name).root, { recursive: true, force: true })
}

/**
 * Count the workspaces that have conversations in this home. Used by the
 * config window to show that history belongs to the sandbox, not to the
 * folder of code being worked on.
 * @param {string} home
 * @returns {number}
 */
function countSessionGroups(home) {
  const sessions = join(home, 'sessions')
  if (!existsSync(sessions)) return 0
  try {
    return readdirSync(sessions).filter((entry) => statSync(join(sessions, entry)).isDirectory()).length
  } catch {
    return 0
  }
}

/**
 * Count the conversations in a home. One conversation is one `session-*`
 * folder; dsh finds them by scanning these directories (verified against a
 * live instance — the workspace index file plays no part in listing), which
 * is the same fact {@link adoptSessions} relies on.
 * @param {string} home
 * @returns {number}
 */
function countSessions(home) {
  const sessions = join(home, 'sessions')
  if (!existsSync(sessions)) return 0
  let count = 0
  try {
    for (const group of readdirSync(sessions)) {
      const dir = join(sessions, group)
      if (!statSync(dir).isDirectory()) continue
      count += readdirSync(dir).filter((entry) => entry.startsWith('session-')).length
    }
  } catch {
    // A half-readable sessions tree still yields a usable partial count.
  }
  return count
}

/** The marker dsh injects into its index page once booted; how a live dsh is recognized. */
const BOOT_MARKER = '__DSH_BOOT__'

/** dsh's default port — where the user's own dsh answers if it is running. */
const MAIN_DSH_PORT = 3080

/**
 * Whether a dsh is serving on the given port right now.
 *
 * Only dsh's default port is checked, because that is where the user's daily
 * instance lives. A dsh moved to a custom port goes undetected — acceptable,
 * because adoption only ever adds new folders and a running dsh simply does
 * not show them until its next start.
 * @param {number} [port]
 * @returns {Promise<boolean>}
 */
export async function mainDshRunning(port = MAIN_DSH_PORT) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: 'follow', signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return false
    return (await response.text()).includes(BOOT_MARKER)
  } catch {
    return false
  }
}

/**
 * Copy every conversation of one sandbox into the user's real dsh home.
 *
 * This is a pure folder copy, verified sufficient against a live instance:
 * dsh lists conversations by scanning `sessions/`, so nothing else needs to
 * change hands — no index is written, and the one failure mode left is a
 * half-copied folder, which dsh treats as one broken session, not a broken
 * home. Copies, never moves: the sandbox keeps its originals, and a session
 * id that already exists in the real home is skipped, so running this twice
 * is harmless.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name - sandbox name.
 * @param {object} [options]
 * @param {boolean} [options.force] - proceed even while a dsh is running;
 * the conversations then appear on its next start.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{adopted: number, skipped: number, home: string}>}
 */
export async function adoptSessions(layout, name, { force = false, env = process.env } = {}) {
  const paths = sandboxPaths(layout, name)
  const source = join(paths.home, 'sessions')
  if (!existsSync(source)) throw new Error(`「${paths.name}」里还没有任何对话`)
  if (!force && await mainDshRunning()) {
    throw new Error(
      '检测到端口 3080 上正跑着一台 dsh(多半是你天天用的那台)。'
      + '请先把它关掉再导入——dsh 只在启动时扫描对话目录,开着的时候导进去它也看不见。',
    )
  }
  const home = userDshHome(env)
  let adopted = 0
  let skipped = 0
  for (const group of readdirSync(source)) {
    const groupDir = join(source, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const session of readdirSync(groupDir)) {
      if (!session.startsWith('session-')) continue
      const target = join(home, 'sessions', group, session)
      if (existsSync(target)) {
        skipped += 1
        continue
      }
      cpSync(join(groupDir, session), target, { recursive: true })
      adopted += 1
    }
  }
  return { adopted, skipped, home }
}

/**
 * @param {string} file
 * @returns {Record<string, unknown>}
 */
function readState(file) {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export { boxLayout }
