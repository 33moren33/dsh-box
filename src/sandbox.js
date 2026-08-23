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
import { dirname, join } from 'node:path'
import { BoxError } from './errors.js'
import { engineRecord, sameEngine } from './host.js'
import { t } from './messages.js'
import { cabinetPlugins } from './mounts.js'
import { boxLayout, sandboxNameProblem, sandboxPaths, safeName, userDshHome } from './paths.js'

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
 * @property {string | null} lastVersion - version last booted here, for display.
 * @property {{kind: string, version: string | null, dir: string} | null} lastEngine -
 * which installation that was. Kept apart from the version because two
 * different installations can carry the same number.
 * @property {string | null} lastUsed - ISO timestamp of the last boot.
 * @property {boolean} hasCredentials
 * @property {number} sessionGroups - workspaces that have conversations here.
 * @property {number} sessions - conversations in this home, across all workspaces.
 * @property {RunningRecord | null} running - the live dsh on this home, if any.
 * @property {import('./mounts.js').CabinetPlugins} plugins - what is registered
 * in this home right now, split by who registered it. Read from the home's own
 * files rather than from anything this tool remembers, so it stays true when a
 * plugin is added by some other route.
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
    lastEngine: lastEngine(state),
    lastUsed: state.lastUsed ?? null,
    hasCredentials: existsSync(join(paths.home, CREDENTIALS_FILE)),
    sessionGroups: countSessionGroups(paths.home),
    sessions: countSessions(paths.home),
    running: runningRecord(layout, name),
    plugins: cabinetPlugins(paths.home),
  }
}

/**
 * @typedef {object} RunningRecord
 * @property {number} pid
 * @property {number} port
 * @property {string} url
 * @property {string | null} version
 * @property {{kind: string, version: string | null, dir: string}} [engine] -
 * which installation is running. Absent on records written before there was
 * more than one kind, all of which were downloaded releases.
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
  const record = readState(runningFile(layout, name))
  if (aliveRecord(record) !== null) return /** @type {RunningRecord} */ (record)
  // ⛔ The ledger being gone is not evidence that nothing is running, and
  // treating it as such is how two dsh processes ended up on one home: delete
  // the file by hand and the same sandbox starts a second time, on the next
  // port, both pointed at the same `DSH_HOME` — the shape of the 08-18 incident.
  // The daily workspace has a second answer for this (something is answering on
  // 3080), but a sandbox's port is handed out at launch, so there is nothing to
  // knock on. Hence a mark left inside the home itself: it lives with the thing
  // it protects, so it is unlikely to be deleted separately, and it is the only
  // evidence left when the ledger is not there.
  //
  // ⛔ Measured, not assumed: dsh keeps no lock of its own in a `DSH_HOME` —
  // a home has the same files while a dsh is serving it as after that dsh is
  // killed, and nothing in it is named like a lock. So there was nothing here
  // to read instead of writing our own.
  const mark = readState(homeMarkFile(layout, name))
  const alive = aliveRecord(mark)
  if (alive !== null) {
    // Put the ledger back rather than only answering this one question: every
    // other reader goes to the ledger, and leaving it missing would mean
    // answering "yes, running" here and "no" everywhere else.
    writeFileSync(runningFile(layout, name), `${JSON.stringify(mark, null, 2)}\n`)
    return /** @type {RunningRecord} */ (mark)
  }
  clearRunning(layout, name)
  return null
}

/**
 * A record whose process is still there, or null.
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown> | null}
 */
function aliveRecord(record) {
  const { pid } = record
  return Number.isInteger(pid) && Number(pid) > 0 && pidAlive(Number(pid)) ? record : null
}

/**
 * Record a successful boot in the sandbox's running ledger.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {{pid: number, port: number, url: string, version: string | null,
 * engine: {kind: string, version: string | null, dir: string}}} record
 */
export function noteRunning(layout, name, record) {
  const written = `${JSON.stringify({ ...record, startedAt: new Date().toISOString() }, null, 2)}\n`
  writeFileSync(runningFile(layout, name), written)
  // The same fact, kept beside what it is about. ⚠️ Only ever for sandboxes:
  // the daily workspace is the user's own home and this tool writes nothing
  // into it — which is also why that side needed a different answer.
  const mark = homeMarkFile(layout, name)
  if (existsSync(dirname(mark))) writeFileSync(mark, written)
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
  rmSync(homeMarkFile(layout, name), { force: true })
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
 * The copy that lives inside the home being used.
 *
 * Dotted so it sorts out of the way and reads as bookkeeping rather than as
 * something dsh put there.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @returns {string}
 */
function homeMarkFile(layout, name) {
  return join(sandboxPaths(layout, name).home, '.dsh-box-running.json')
}

/**
 * The ledger for a main-environment launch.
 *
 * Kept in this tool's own data directory rather than in the user's real home,
 * which we write nothing into — that home is theirs, and the one rule this
 * whole area runs on is that we only touch what came through here.
 *
 * There used to be no ledger at all for these, on the grounds that a real home
 * is not ours to manage. That was half right: the *home* is not ours, but a
 * process this tool started is, and without a record of it the stop button in
 * the window only worked for launches made by that particular window process —
 * close it and reopen, and a dsh we started became unstoppable and invisible.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {string}
 */
function mainRunningFile(layout) {
  return join(layout.root, 'main-running.json')
}

/**
 * The live main-environment dsh this tool started, if any.
 *
 * ⚠️ Only ever reports one we started. A dsh the user launched themselves has
 * no entry here and must not get one: we would have to guess its process from
 * a port, and guessing wrong means killing something they are using. That case
 * is answered by {@link mainDshRunning}, which only says whether the port is
 * serving — a fact, not an identity.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {(RunningRecord & {home: string}) | null}
 */
export function mainRunningRecord(layout) {
  const file = mainRunningFile(layout)
  if (!existsSync(file)) return null
  const record = readState(file)
  if (Number.isInteger(record.pid) && record.pid > 0 && pidAlive(record.pid)) {
    return /** @type {RunningRecord & {home: string}} */ (record)
  }
  rmSync(file, { force: true })
  return null
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{pid: number, port: number, url: string, version: string | null,
 * engine: {kind: string, version: string | null, dir: string}, home: string}} record
 */
export function noteMainRunning(layout, record) {
  writeFileSync(
    mainRunningFile(layout),
    `${JSON.stringify({ ...record, startedAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {number} [pid] - only clear if the ledger names this process.
 */
export function clearMainRunning(layout, pid) {
  const file = mainRunningFile(layout)
  if (pid !== undefined && readState(file).pid !== pid) return
  rmSync(file, { force: true })
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
    // A directory that could not have been named by this tool was put there
    // by someone else. Skipping it beats failing the whole listing, which is
    // what inspecting it would do.
    .filter((entry) => sandboxNameProblem(entry) === null)
    .map((entry) => inspectSandbox(layout, entry))
    .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''))
}

/**
 * Every sandbox with a live dsh on it, whichever entrance started it.
 *
 * The on-disk ledger is the only answer to this question that every entrance
 * agrees on. A caller that keeps its own list can only see its own launches,
 * and then acts on a world where half the sandboxes do not exist.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{sandbox: string, pid: number, port: number, url: string, version: string, startedAt: string}[]}
 */
export function runningSandboxes(layout) {
  return listSandboxes(layout)
    .filter((box) => box.running !== null)
    .map((box) => ({ sandbox: box.name, ...box.running }))
}

/**
 * Take a brand-new sandbox: pick the name and own it in one indivisible step.
 *
 * ⛔ Not `suggestSandboxName` followed by `ensureSandbox`. That pair is
 * check-then-use, and `mkdirSync(…, {recursive: true})` does not complain
 * about a directory that already exists, so both halves succeed for everyone.
 * Measured: two `start --new` fired at the same moment produced **one**
 * sandbox — same name, same log file, two dsh processes on one `DSH_HOME`,
 * which is the shape of the 08-18 incident. The user asked for two cabinets
 * and got one, with two engines writing into it.
 *
 * Creating a directory *without* `recursive` is the indivisible operation the
 * filesystem gives us: it throws `EEXIST` rather than shrugging, so whoever's
 * call returns is the owner and the loser simply tries the next number. Same
 * idiom as the `wx` flag the config lock uses — no lock file, no new state.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} [options]
 * @param {string} [options.prefix]
 * @param {boolean} [options.importSignIn]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{info: SandboxInfo, created: boolean, signInImported: boolean}}
 */
export function createNewSandbox(layout, { prefix = 'box', importSignIn = true, env = process.env } = {}) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  mkdirSync(layout.sandboxes, { recursive: true })
  for (let n = 1; n <= 999; n += 1) {
    const paths = sandboxPaths(layout, safeName(`${prefix}-${stamp}-${n}`))
    try {
      mkdirSync(paths.root)
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') continue
      throw error
    }
    mkdirSync(paths.home, { recursive: true })
    const signInImported = importSignIn ? importCredentials(paths.home, env) : false
    return { info: inspectSandbox(layout, paths.name), created: true, signInImported }
  }
  throw new BoxError('NO_FREE_SANDBOX_NAME', t('sandbox.noFreeName', { prefix, stamp }))
}

/**
 * A sandbox name that is not in use yet, for showing in a field.
 *
 * ⛔ A suggestion only. Acting on it means racing whoever else read it — use
 * {@link createNewSandbox} to actually take one.
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
 * Record which installation was booted, so the next launch can tell whether the
 * module fallback needs clearing.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {import('./host.js').Engine} engine
 */
export function noteBoot(layout, name, engine) {
  const paths = sandboxPaths(layout, name)
  const state = readState(paths.state)
  writeFileSync(paths.state, `${JSON.stringify({
    ...state,
    // Kept for the listing, which shows a number rather than an identity.
    lastVersion: engine.version ?? null,
    lastEngine: engineRecord(engine),
    lastUsed: new Date().toISOString(),
  }, null, 2)}\n`)
}

/**
 * What this sandbox last booted on, including sandboxes written before
 * installations were told apart. Back then everything was a downloaded
 * release, so an old record is read as one rather than discarded — discarding
 * it would silently skip the module-fallback clear on the next launch.
 * @param {Record<string, unknown>} state
 * @returns {{kind: string, version: string | null, dir: string | null} | null}
 */
function lastEngine(state) {
  if (state.lastEngine !== null && typeof state.lastEngine === 'object') {
    return /** @type {{kind: string, version: string | null, dir: string}} */ (state.lastEngine)
  }
  if (typeof state.lastVersion !== 'string') return null
  return { kind: 'release', version: state.lastVersion, dir: null }
}

/**
 * Whether launching this sandbox would change which installation it resolves
 * packages from.
 *
 * Asked about the installation, not the version number: the user's own dsh and
 * a release we downloaded can both be `0.1.0-rc.7` and still be two separate
 * trees, and `profiles/node_modules` is a layer of pointers into whichever one
 * booted last. Comparing numbers would leave those pointers aimed at the other
 * installation, which is the failure this clear exists to prevent.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @param {import('./host.js').Engine} engine
 * @returns {boolean}
 */
export function switchesEngine(layout, name, engine) {
  const last = lastEngine(readState(sandboxPaths(layout, name).state))
  if (last === null) return false
  // A pre-engine record has no directory to compare, so the number is all
  // there is; anything but the same release is a switch.
  if (last.dir === null) return !(engine.kind === 'release' && engine.version === last.version)
  return !sameEngine(last, engineRecord(engine))
}

/**
 * Delete a sandbox and everything in it.
 *
 * Offered as an ordinary button rather than something hidden. dsh states that
 * its on-disk formats are pre-release with no migration path, so a home that
 * a newer release has written may simply stop loading. Throwing one away and
 * starting again is the expected repair, not a last resort.
 *
 * Both refusals live here rather than in the callers. They used to live in the
 * command line only, so the window deleted a running sandbox out from under a
 * live dsh and reported success — the same shape of hole `deleteVersion` had,
 * for the same reason: a guard that each entrance has to remember is a guard
 * one entrance will be missing. Now that sandboxes outlive the command that
 * started them, meeting a running one here is ordinary rather than unlikely.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @returns {{name: string, root: string}} what was deleted, name as resolved.
 */
export function deleteSandbox(layout, name) {
  const info = inspectSandbox(layout, name)
  if (!info.exists) throw new BoxError('NO_SUCH_SANDBOX', t('sandbox.noSuch', { name }), { sandbox: name })
  if (info.running !== null) {
    throw new BoxError(
      'SANDBOX_RUNNING',
      t('sandbox.runningCannotDelete', { name: info.name, pid: info.running.pid }),
      { sandbox: info.name, pid: info.running.pid },
    )
  }
  rmSync(info.root, { recursive: true, force: true })
  return { name: info.name, root: info.root }
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
 * Which home a copy is coming from or going to.
 *
 * `null` names the user's own `~/.dsh`, a string names a sandbox — the same two
 * answers `--main` and `--sandbox` give everywhere else in this tool.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string | null} which
 * @param {NodeJS.ProcessEnv} env
 * @returns {{label: string, home: string, sandbox: string | null}}
 */
function sessionSide(layout, which, env) {
  if (which === null) return { label: t('cabinet.daily'), home: userDshHome(env), sandbox: null }
  const paths = sandboxPaths(layout, which)
  return { label: paths.name, home: paths.home, sandbox: paths.name }
}

/**
 * Copy conversations from one filing cabinet into another.
 *
 * ⭐ Copies, never moves — the source keeps its originals, and a session id that
 * already exists at the destination is skipped, so running this twice is
 * harmless and running it half-way is recoverable by running it again.
 *
 * A pure folder copy, verified sufficient against a live instance: dsh lists
 * conversations by scanning `sessions/`, so nothing else needs to change hands —
 * no index is written, and the one failure mode left is a half-copied folder,
 * which dsh treats as one broken session rather than a broken home.
 *
 * ⭐ Any direction, because there is no direction in the mechanism: a home is a
 * home. The window only ever offers sandbox → daily, which is the case people
 * ask for; the command line does not need that restriction and an agent
 * setting up a sandbox from real history needs the other one.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} [options]
 * @param {string | null} [options.from] - sandbox name, or null for `~/.dsh`.
 * @param {string | null} [options.to] - sandbox name, or null for `~/.dsh`.
 * @param {boolean} [options.force] - proceed even while a dsh is running there;
 * the conversations then appear on its next start.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{adopted: number, skipped: number, home: string, from: string, to: string}>}
 */
export async function adoptSessions(layout, { from = null, to = null, force = false, env = process.env } = {}) {
  const source = sessionSide(layout, from, env)
  const destination = sessionSide(layout, to, env)
  if (source.home === destination.home) {
    throw new BoxError('SAME_WORKSPACE', t('adopt.sameCabinet'), {
      cabinet: source.label,
    })
  }
  const dir = join(source.home, 'sessions')
  if (!existsSync(dir)) {
    throw new BoxError('NO_SESSIONS', t('adopt.noSessions', { label: source.label }), { cabinet: source.label })
  }
  // ⛔ The guard protects the *destination*, because that is where the files
  // land and dsh only scans this directory at startup. It used to check port
  // 3080 whatever the destination was, which is the right question only when
  // the destination is the real home.
  if (!force) {
    const busy = destination.sandbox === null
      ? await mainDshRunning()
      : runningRecord(layout, destination.sandbox) !== null
    if (busy) {
      throw new BoxError(
        'MAIN_DSH_RUNNING',
        t('adopt.destinationRunning', { label: destination.label }),
        { cabinet: destination.label },
      )
    }
  }
  let adopted = 0
  let skipped = 0
  for (const group of readdirSync(dir)) {
    const groupDir = join(dir, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const session of readdirSync(groupDir)) {
      if (!session.startsWith('session-')) continue
      const target = join(destination.home, 'sessions', group, session)
      if (existsSync(target)) {
        skipped += 1
        continue
      }
      cpSync(join(groupDir, session), target, { recursive: true })
      adopted += 1
    }
  }
  return {
    adopted,
    skipped,
    home: destination.home,
    from: source.label,
    to: destination.label,
    // The names as flags would spell them, so the recorded action can render a
    // line that says which direction it went instead of relying on a shorthand.
    fromSandbox: source.sandbox,
    toSandbox: destination.sandbox,
  }
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
