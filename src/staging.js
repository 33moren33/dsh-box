/**
 * Put a downloaded package where dsh can actually load it — by copying it, with
 * its dependency closure, into the cabinet's own `_local`.
 *
 * ## The rule this module exists to satisfy
 *
 * ⛔⛔ **A plugin's *real* path has to be under `$DSH_HOME/profiles/`.** dsh
 * rebuilds `$DSH_HOME/profiles/node_modules` on every boot as one symlink per
 * package in its own dependency closure — 252 of them on this machine — so a
 * plugin anywhere under `profiles/` picks up `@deepseek-ai/*` by Node's
 * ordinary parent-walk. Upstream states the rule it turns on
 * (`packages/boot/app-boot/src/profile.ts`, `healProfilesModuleFallback`):
 *
 * > *"Symlinked packages resolve their own dependencies from their **real
 * > directories** (Node's default symlink-following), so each package needs
 * > only its one flat link."*
 *
 * So linking a package in from our own data directory cannot work: Node follows
 * the junction to the real path, and the walk from there never crosses
 * `profiles/`. Measured both ways on a two-file repro with no npm involved.
 *
 * ## Who takes this road
 *
 * ⭐ **The daily cabinet, and only the daily cabinet.** A copy is what makes it
 * self-sufficient: the user types `dsh`, their own installation rebuilds the
 * shelf, the plugin resolves — and none of it involves this tool's data
 * directory, which they may delete without their daily dsh ever noticing.
 * Sandboxes take the other road (`engines.js`): they are always started through
 * this tool, so a shared, engine-matched farm can serve them all without a copy
 * per cabinet.
 *
 * ## Why `_local`, and why the closure goes inside the package
 *
 * ⭐ `_local` is **upstream's own name for this**, not one we invented: on a
 * real `~/.dsh` the plugins installed the official way are junctions from
 * `<profile>/node_modules/<name>` to `<profile>/_local/<name>`, declared as
 * `"<name>": "link:…/_local/<name>"`. Copying that shape means we are following
 * a convention rather than betting on one.
 *
 * A staged plugin also needs *its own* dependencies, and those are not in the
 * fallback. They go in `<profile>/_local/<name>/node_modules/` — inside the
 * package — which is where a plain `npm install` would put them anyway. The
 * parent-walk finds its own deps first, then keeps going and finds the platform
 * in `profiles/node_modules`; and **removal is one directory**.
 *
 * ## ⛔⛔ Why the package's own `node_modules` is never copied wholesale
 *
 * npm sometimes nests dependencies inside the package it installed, and for a
 * plugin those nested copies include **official packages** — measured: 65
 * `@deepseek-ai/*` directories inside one aggregate's own `node_modules`. A
 * copy of an official package inside `_local` sits closer on the parent-walk
 * than the shelf, so it wins, and the plugin runs last month's parts on this
 * month's dsh — the two-reacts failure, self-inflicted. So the tree npm laid
 * out is not trusted: the closure is resolved member by member (a nested copy
 * first, the flat store second — the same order Node itself resolves in), each
 * member is copied **without** its own `node_modules`, and anything the shelf
 * already provides is never copied at all.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readLedgerProfile } from './cabinet-ledger.js'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { copyTree, removeTree } from './paths.js'

/**
 * Upstream's folder for plugins that live in the cabinet rather than on npm.
 *
 * ⭐ Verified safe to share: `healProfilesModuleFallback` only ever does
 * `mkdirSync` plus one `ensureSymlink` per package name it knows — no `readdir`
 * and no `rmSync` anywhere in it, and upstream's own comment says a stale link
 * "stays until its name is reused". Nothing prunes what it does not recognise.
 *
 * ⛔ Beside `profiles/node_modules`, never inside it: `ensureSymlink` throws and
 * refuses the whole boot when a name it manages is held by something that is
 * not a symlink. Measured — a real directory at
 * `profiles/node_modules/express` takes dsh down.
 */
export const LOCAL_DIR = '_local'

/** The prefix that marks a package as the platform's own, wherever it is met. */
const PLATFORM_PREFIX = '@deepseek-ai/'

/**
 * Where one package sits inside a cabinet.
 * @param {string} home
 * @param {string} profile
 * @param {string} name
 */
export function stagedDir(home, profile, name) {
  return join(home, 'profiles', profile, LOCAL_DIR, ...name.split('/'))
}

/**
 * A package and everything it needs, resolved the way Node would.
 *
 * @typedef {object} ClosureMember
 * @property {string} name
 * @property {string} dir - where the resolved copy really is.
 * @property {boolean} root - whether this is the package that was asked for.
 */

/**
 * Walk one package's dependency closure through the store.
 *
 * ⭐ Resolution is **nearest-first**: a dependency is looked for inside the
 * requiring package's own `node_modules` before the flat store — the same order
 * Node resolves in, which matters exactly when npm nested a conflicting version
 * on purpose. Whatever copy Node would have used is the copy that travels.
 *
 * ⚠️ A member that resolves nowhere is skipped rather than fatal: optional
 * dependencies for other platforms are simply absent from the store.
 * @param {object} options
 * @param {string} options.store - the flat `node_modules` packages were fetched into.
 * @param {string} options.name - the package the closure is rooted at.
 * @param {(name: string) => boolean} options.skip - names the destination
 * already provides; they are neither included nor walked into.
 * @returns {ClosureMember[]} the root first — or empty when the root is not in
 * the store at all.
 */
export function packageClosure({ store, name, skip }) {
  const members = []
  const seen = new Set()
  /** @type {{name: string, parent: string | null}[]} */
  const queue = [{ name, parent: null }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next.name)) continue
    seen.add(next.name)
    if (next.name !== name && skip(next.name)) continue
    const dir = resolveMember(store, next.parent, next.name)
    if (dir === null) continue
    members.push({ name: next.name, dir, root: next.name === name })
    for (const dep of declaredDeps(join(dir, 'package.json'))) queue.push({ name: dep, parent: dir })
  }
  return members.length > 0 && members[0].root ? members : []
}

/**
 * Where one member really is: nested inside its requirer first, then the store.
 * @param {string} store
 * @param {string | null} parent - the requiring package's directory.
 * @param {string} name
 * @returns {string | null}
 */
function resolveMember(store, parent, name) {
  const candidates = parent === null
    ? [join(store, ...name.split('/'))]
    : [join(parent, 'node_modules', ...name.split('/')), join(store, ...name.split('/'))]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return null
}

/**
 * Copy one package's own files — its `node_modules` stays behind.
 *
 * The closure walker delivers dependencies separately, each resolved to the
 * copy Node would use; carrying the nested tree as well would smuggle in the
 * official packages this module exists to keep out.
 * @param {string} from
 * @param {string} to
 */
export function copyPackageDir(from, to) {
  for (const entry of readdirSync(from)) {
    if (entry === 'node_modules') continue
    copyTree(join(from, entry), join(to, entry))
  }
}

/**
 * Copy a downloaded package and its closure into the cabinet.
 *
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} options.home
 * @param {string} options.profile
 * @param {string} options.package - what was asked for.
 * @returns {{dir: string, copied: string[]}} `dir` is where the package now is —
 * the path everything downstream should use.
 */
export function stageIntoCabinet({ layout, home, profile, package: name }) {
  const store = join(layout.packages, 'node_modules')
  const dir = stagedDir(home, profile, name)
  // ⛔⛔ `_local` is shared with the user's own plugins — on a real `~/.dsh` it
  // holds folders somebody is actively developing. Replacing one because a
  // package on npm happens to have the same name would destroy their work.
  // Ours to replace only if the ledger says we put it there.
  const ours = readLedgerProfile(layout, home, profile).entries.some((entry) => entry.package === name)
  if (existsSync(dir) && !ours) {
    throw new BoxError('LOCAL_NAME_TAKEN', t('staging.nameTaken', { package: name, dir }), { package: name, dir })
  }
  // A repeat install replaces its own copy rather than merging into it. Merging
  // would leave the previous version's files behind, and "which of these two is
  // loaded" is not a question anybody should have to answer.
  removeTree(dir)
  const provided = providedByFallback(home)
  // ⭐ The prefix rule backs up the shelf reading: on a cabinet whose shelf has
  // not been built yet the directory answers nothing, and copying official
  // packages on that evidence is exactly the defect this module was reworked to
  // fix. The platform is never ours to copy, shelf or no shelf.
  const skip = (member) => provided.has(member) || member.startsWith(PLATFORM_PREFIX)
  const closure = packageClosure({ store, name, skip })
  if (closure.length === 0) {
    throw new BoxError('PACKAGE_NOT_DOWNLOADED', t('staging.notDownloaded', { package: name }), { package: name })
  }
  const copied = []
  for (const member of closure) {
    const target = member.root ? dir : join(dir, 'node_modules', ...member.name.split('/'))
    // Two requirers can deliver the same name; the first (nearest the root) wins,
    // which is the same tie-break npm's own hoisting makes.
    if (!member.root && existsSync(join(target, 'package.json'))) continue
    copyPackageDir(member.dir, target)
    copied.push(member.name)
  }
  return { dir, copied }
}

/**
 * Take one staged package away again.
 * @param {string} home
 * @param {string} profile
 * @param {string} name
 * @returns {boolean} whether there was one.
 */
export function unstageFromCabinet(home, profile, name) {
  const gone = removeTree(stagedDir(home, profile, name))
  // A scoped name leaves its `@scope` folder behind; take it too, but only
  // when empty — the folder may hold the user's own things.
  const scope = name.split('/')[0]
  if (scope.startsWith('@')) {
    const scopeDir = join(home, 'profiles', profile, LOCAL_DIR, scope)
    try {
      if (readdirSync(scopeDir).length === 0) removeTree(scopeDir)
    } catch {
      // Not there, or not ours to read. Either way nothing to do.
    }
  }
  return gone
}

/**
 * Every package name the cabinet's flat fallback already answers.
 *
 * Read from the directory rather than from any list of ours: dsh rebuilds it on
 * every boot from *its* dependency closure, so what is in there is a fact about
 * the installation that will run — and a copy of the list kept here would be
 * wrong the first time that installation is upgraded.
 * @param {string} home
 * @returns {Set<string>}
 */
function providedByFallback(home) {
  const dir = join(home, 'profiles', 'node_modules')
  const names = new Set()
  for (const entry of readdirSafe(dir)) {
    if (!entry.startsWith('@')) {
      names.add(entry)
      continue
    }
    for (const inner of readdirSafe(join(dir, entry))) names.add(`${entry}/${inner}`)
  }
  return names
}

/** @param {string} dir */
function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * The names one package says it needs at run time.
 *
 * Three kinds, and each is here for a reason found the hard way:
 * - `dependencies` — the obvious one.
 * - `peerDependencies` — how this ecosystem names a package the host supplies;
 *   dsh's own fallback walk includes them for the same reason.
 * - ⛔⛔ `optionalDependencies` — **where native binaries live.** `lightningcss`
 *   ships one package per platform and picks at run time; leaving these out
 *   staged 158 packages that booted straight into
 *   `Cannot find module '../lightningcss.win32-x64-msvc.node'`. Measured, on the
 *   first real run after this module was written.
 *
 * ⛔ `devDependencies` are not included: a consumer never installs them, so
 * they are not in the store to copy, and the ones that matter here
 * (`@deepseek-ai/*`) come from the fallback anyway.
 * @param {string} file
 * @returns {string[]}
 */
export function declaredDeps(file) {
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    return [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]
  } catch {
    return []
  }
}
