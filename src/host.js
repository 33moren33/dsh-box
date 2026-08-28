/**
 * The dsh the user installed themselves — the host machine.
 *
 * This tool used to know exactly one kind of dsh: the releases it downloaded
 * itself. That made "which machine" and "which release" the same question, and
 * the answer was always ours. It is not: dsh has one machine concept and one
 * filing-cabinet concept, and `DSH_HOME` is the second one. Starting the user's
 * own home with our installation is a real choice with a real cost — the module
 * pointer layer under that home gets re-pointed at whichever installation last
 * booted it, so their daily dsh ends up depending on a folder inside this tool
 * (measured on a real home: 251 links, all written in the same second).
 *
 * So the machine is now its own axis, and its default is the one the user
 * already has. Theirs may also be a locally modified build, which ours can
 * never stand in for.
 *
 * Everything here is disk reads. No `npm ls -g`, no subprocess: `status` is
 * re-read at the start of every agent turn, and a command that sometimes costs
 * a second is a command that stops being used.
 *
 * ⚠️ Only measured on Windows. The layouts for every other platform below come
 * from the documented npm prefix rules, and their shim shapes differ (a symlink
 * into `lib/node_modules` rather than a `.cmd` sitting beside the packages).
 * Treat the unix branches as unverified until something has actually run there.
 */

import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { entryScript, looksLikePath, resolvePathEngine } from './engine-path.js'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { versionDir, versionEntry } from './paths.js'
import { verifyPinned } from './registry.js'

/** The package a dsh installation is rooted at, as path segments. */
const ROOT_PACKAGE = ['@deepseek-ai', 'dsh']

/**
 * @typedef {object} HostDsh
 * @property {boolean} found
 * @property {string | null} dir - the installed `@deepseek-ai/dsh` package.
 * @property {string | null} entry - the script to run with this Node binary.
 * @property {string | null} version
 * @property {boolean} pinned - every sibling package carries `version`.
 * @property {number} packages - siblings actually checked.
 * @property {boolean} verified - whether the pin check found anything to check.
 * @property {{name: string, found: string | null}[]} mixed - offenders, capped.
 * @property {string[]} looked - where we looked, for a failure worth acting on.
 */

/**
 * Find the dsh installed on this machine.
 *
 * Candidate locations are tried in the order that answers "which dsh would
 * typing `dsh` actually run" — the shim on PATH first, since that is the one
 * the user means, and the conventional prefixes only as a fallback.
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.platform]
 * @returns {HostDsh}
 */
export function detectHostDsh({ env = process.env, platform = process.platform } = {}) {
  const looked = []
  for (const root of installRoots(env, platform)) {
    const dir = join(root, ...ROOT_PACKAGE)
    if (looked.includes(dir)) continue
    looked.push(dir)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch {
      // A package with an unreadable manifest cannot be launched from, and
      // saying "not installed" would be a lie. Keep looking; if nothing else
      // answers, `looked` shows where this one was.
      continue
    }
    const entry = entryScript(dir, pkg)
    if (entry === null || !existsSync(entry)) continue
    const version = typeof pkg.version === 'string' ? pkg.version : null
    return { found: true, dir, entry, version, ...pinning(dir, root, version), looked }
  }
  return {
    found: false, dir: null, entry: null, version: null,
    pinned: false, packages: 0, verified: false, mixed: [], looked,
  }
}

/**
 * Every `node_modules` directory a global install could be in, best guess
 * first. Yields duplicates freely; the caller skips what it has already tried.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} platform
 * @returns {Generator<string>}
 */
function* installRoots(env, platform) {
  const windows = platform === 'win32'
  // The shim on PATH is the definitive answer to "what does `dsh` run", so it
  // comes first. On Windows npm writes the shims straight into the prefix, next
  // to `node_modules`; everywhere else they go in `<prefix>/bin` and the
  // packages in `<prefix>/lib/node_modules`.
  for (const dir of pathDirs(env)) {
    if (!hasShim(dir, windows)) continue
    yield join(dir, 'node_modules')
    yield join(dirname(dir), 'lib', 'node_modules')
  }
  const configured = env.npm_config_prefix ?? ''
  if (configured !== '') {
    yield join(configured, 'node_modules')
    yield join(configured, 'lib', 'node_modules')
  }
  if (windows && (env.APPDATA ?? '') !== '') yield join(env.APPDATA, 'npm', 'node_modules')
  if (!windows) {
    yield '/usr/local/lib/node_modules'
    yield '/usr/lib/node_modules'
    if ((env.HOME ?? '') !== '') yield join(env.HOME, '.npm-global', 'lib', 'node_modules')
  }
  // Last resort: alongside the Node binary running this. Correct for a Node
  // installed without a separate prefix, wrong for a version manager — hence
  // last rather than first.
  const nodeDir = dirname(process.execPath)
  yield windows ? join(nodeDir, 'node_modules') : join(dirname(nodeDir), 'lib', 'node_modules')
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
function pathDirs(env) {
  const raw = env.PATH ?? env.Path ?? ''
  return raw.split(delimiter).map((dir) => dir.trim().replace(/^"|"$/g, '')).filter((dir) => dir !== '')
}

/**
 * Whether this directory holds the `dsh` launcher shim.
 *
 * On Windows npm writes three of them (`dsh`, `dsh.cmd`, `dsh.ps1`) and which
 * one runs depends on the shell, so any is proof enough. The shim is never
 * executed — it exists only to locate the installation; the entry script is
 * then run with this process's own Node, so how the user's PATH is arranged
 * cannot change what gets launched.
 * @param {string} dir
 * @param {boolean} windows
 * @returns {boolean}
 */
function hasShim(dir, windows) {
  const names = windows ? ['dsh.cmd', 'dsh.ps1', 'dsh'] : ['dsh']
  return names.some((name) => existsSync(join(dir, name)))
}

/**
 * Whether every package of this installation carries one release number.
 *
 * The same check the download path gates on, run here for free. Where the
 * siblings live depends on how the install was flattened: npm nests them under
 * the root package, other layouts hoist them beside it. Both are tried, and
 * finding neither is reported as "could not check" rather than as a failure —
 * announcing "versions are mixed" when nothing was examined is the kind of
 * self-consistent wrong answer this project keeps paying for.
 * @param {string} dir - the installed root package.
 * @param {string} root - the `node_modules` it sits in.
 * @param {string | null} version
 * @returns {{pinned: boolean, packages: number, verified: boolean, mixed: object[]}}
 */
function pinning(dir, root, version) {
  if (version === null) return { pinned: false, packages: 0, verified: false, mixed: [] }
  for (const base of [dir, dirname(root)]) {
    const report = verifyPinned(base, version)
    // One package found is the root package finding itself, which says nothing
    // about the layer the check exists for: a launcher on one release sitting
    // on another release's plugins is invisible anywhere but in the siblings.
    if (report.checked <= 1) continue
    return {
      pinned: report.ok, packages: report.checked, verified: true, mixed: report.wrong.slice(0, 5),
    }
  }
  return { pinned: false, packages: 0, verified: false, mixed: [] }
}

/**
 * @typedef {object} Engine
 * @property {'host' | 'release' | 'tree' | 'app'} kind - where this
 * installation came from. The first two we find ourselves; the last two are
 * folders somebody named (`engine-path.js`).
 * @property {string | null} version
 * @property {string} dir - the installation root.
 * @property {string} entry - the script to run.
 * @property {string} exec - the interpreter to run it with. Ours for every
 * kind but one: a dsh packed into an application archive is readable only by
 * the interpreter shipped beside it.
 * @property {Record<string, string>} execEnv - what that interpreter needs in
 * its environment to behave as a plain Node.
 * @property {import('./engine-path.js').PinInfo} [pin] - present only for a
 * tree somebody named, where the pin check reports instead of gating.
 */

/**
 * Which dsh installation to launch.
 *
 * One axis, and now four answers on it. No version named means the machine the
 * user already has. A release number means one this tool downloaded. **A folder
 * means that folder** — a source build, or an application carrying its own dsh.
 *
 * ⭐ A folder rides the same flag rather than getting its own. "Which dsh" is
 * one question, and a second flag would create a case where both are answered;
 * a path separator tells them apart with no rule to write, because a release
 * number cannot contain one.
 *
 * Nothing is inherited from a previous launch: a command that answers
 * differently depending on what was run last is a command whose written form
 * cannot be trusted, and both entrances render these back as explicit lines.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} [options]
 * @param {string} [options.version] - a downloaded release, a folder, or nothing.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Engine}
 */
export function resolveEngine(layout, { version, env } = {}) {
  if (typeof version === 'string' && version.trim() !== '') {
    const wanted = version.trim()
    if (looksLikePath(wanted)) return resolvePathEngine(wanted)
    const entry = versionEntry(layout, wanted)
    if (!existsSync(entry)) {
      throw new BoxError('VERSION_NOT_DOWNLOADED', t('host.versionNotDownloaded', { version: wanted }), { version: wanted })
    }
    return {
      kind: 'release', version: wanted, dir: versionDir(layout, wanted), entry,
      exec: process.execPath, execEnv: {},
    }
  }
  const host = detectHostDsh({ env })
  if (!host.found) {
    throw new BoxError(
      'NO_HOST_DSH',
      t('host.noHostDsh'),
      { looked: host.looked },
    )
  }
  return {
    kind: 'host', version: host.version, dir: host.dir, entry: host.entry,
    exec: process.execPath, execEnv: {},
  }
}

/**
 * What is stored to say which installation this was.
 *
 * The version number alone is not an identity: a host install and a downloaded
 * release can both be `0.1.0-rc.7` while being two different trees on disk.
 * Told apart by the number alone, deleting our rc.7 would be refused because a
 * sandbox is "using it" when it is using theirs, and switching between the two
 * would skip clearing the module pointer layer that exists precisely to stop a
 * home from resolving packages out of the wrong installation.
 * @param {Engine} engine
 * @returns {{kind: string, version: string | null, dir: string}}
 */
export function engineRecord(engine) {
  return { kind: engine.kind, version: engine.version ?? null, dir: engine.dir }
}

/**
 * Whether two installations are the same one.
 * @param {{kind?: string, version?: string | null, dir?: string} | null} a
 * @param {{kind?: string, version?: string | null, dir?: string} | null} b
 * @returns {boolean}
 */
export function sameEngine(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return false
  return a.kind === b.kind && a.version === b.version && a.dir === b.dir
}

/** What each kind of installation is called when a person is reading. */
const ENGINE_LABELS = {
  host: 'engine.host',
  release: 'engine.release',
  tree: 'engine.tree',
  app: 'engine.app',
}

/**
 * One line naming an installation, for a person.
 *
 * ⭐ A named folder says where it is, not just what version it is. That is the
 * whole difference between it and the other two: there can be several of them,
 * they can carry the same number, and the number alone would not tell anyone
 * which one this launch used.
 * @param {{kind?: string, version?: string | null, dir?: string} | null} engine
 * @returns {string}
 */
export function engineLabel(engine) {
  if (engine === null || engine === undefined) return t('engine.unknown')
  const version = engine.version ?? t('engine.versionUnreadable')
  const key = ENGINE_LABELS[engine.kind ?? ''] ?? 'engine.release'
  return t(key, { version, path: engine.dir ?? '' })
}
