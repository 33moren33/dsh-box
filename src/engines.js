/**
 * The per-installation farm: one downloaded plugin made loadable on every dsh,
 * without a copy per cabinet.
 *
 * ## The mechanism, in one paragraph
 *
 * Node resolves a plugin's `@deepseek-ai/*` imports by walking **up from the
 * plugin's real path**, opening every `node_modules` on the way. So *where the
 * files sit decides which shelf they meet* — and a hardlink is a second real
 * path for the same bytes. This module gives each dsh installation its own
 * farm directory: the plugin's files hardlinked in (same disk blocks, new
 * address), and beside them one junction per package that installation ships,
 * aimed at that installation's own tree. A cabinet's profile junction is then
 * re-pointed at the farm matching whichever engine is about to boot, and the
 * walk from there meets version-correct parts at its very first stop.
 *
 * ## Why sandboxes only
 *
 * ⭐ A farm shelf is a ledger somebody has to keep true. Sandboxes are always
 * started through this tool, so the re-point happens on every launch and the
 * shelf can never go stale. The daily cabinet is started by the user typing
 * `dsh`, with this tool absent — so it takes the copy road instead
 * (`staging.js`), where dsh itself keeps the versions right on every boot.
 * A daily cabinet must also survive this data directory being deleted; a
 * sandbox lives inside it and goes with it, so the coupling costs nothing.
 *
 * ## What this depends on upstream
 *
 * Only data: the flat-`node_modules` layout of an installation (read with
 * `readdir`, never imported) and Node's own resolution order. The same ground
 * `healProfilesModuleFallback` builds on — this farm is that shelf's idea,
 * rebuilt on our own land.
 *
 * ⛔ Everything under `layout.engines` is derived. Deleting it costs the next
 * launch a re-stage and never loses data; nothing in here is the original of
 * anything.
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, symlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { readLedgerProfile } from './cabinet-ledger.js'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { profileModules } from './mounts.js'
import { isOurDownload, packageRoot } from './packages.js'
import { removeTree, safeName } from './paths.js'
import { packageClosure } from './staging.js'

/**
 * One directory name per installation.
 *
 * ⛔ The version number alone is not an identity — a host install and a
 * downloaded release can both be `0.1.0-rc.7` while being two different trees
 * (see `engineRecord` in `host.js`, which learned this the same way). The host
 * key therefore carries a fingerprint of the directory, so a moved or reinstalled
 * host gets a fresh farm instead of a stale one.
 * @param {import('./host.js').Engine} engine
 * @returns {string}
 */
export function engineKey(engine) {
  if (engine.kind === 'release') return `release-${safeName(engine.version ?? '')}`
  const fingerprint = createHash('sha1').update(engine.dir).digest('hex').slice(0, 8)
  return `host-${safeName(engine.version ?? 'unknown') || 'unknown'}-${fingerprint}`
}

/**
 * The farm's own `node_modules` for one installation.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {import('./host.js').Engine} engine
 * @returns {string}
 */
export function farmModules(layout, engine) {
  return join(layout.engines, engineKey(engine), 'node_modules')
}

/**
 * Every package one installation provides, name → real directory.
 *
 * Read from the installation's own tree, never from a list of ours: what an
 * installation ships is a fact about it, and a copy of the list would be wrong
 * the first release after it was written. Two layouts exist and both are real:
 * a release this tool downloaded is flat (everything beside `dsh`), while an
 * npm global install nests everything inside the `dsh` package itself. The
 * nested tree is read when it exists; otherwise the root the package sits in —
 * ⚠️ deliberately *not* both, because the global root also holds the user's
 * other global tools, and shelving those would shadow a plugin's own
 * dependencies with unrelated versions.
 * @param {import('./host.js').Engine} engine
 * @returns {Map<string, string>}
 */
export function engineProvides(engine) {
  const provided = new Map()
  const nested = join(engine.dir, 'node_modules')
  const roots = hasPackages(nested) ? [nested] : [nested, dirname(dirname(engine.dir))]
  for (const root of roots) {
    for (const { name, dir } of packagesIn(root)) {
      if (!provided.has(name)) provided.set(name, dir)
    }
  }
  // The dsh package itself: flat layouts list it, the nested layout is inside
  // it. Either way it is provided, and by this exact directory.
  if (!provided.has('@deepseek-ai/dsh')) provided.set('@deepseek-ai/dsh', engine.dir)
  return provided
}

/** @param {string} root */
function hasPackages(root) {
  return packagesIn(root).length > 0
}

/**
 * @param {string} root
 * @returns {{name: string, dir: string}[]}
 */
function packagesIn(root) {
  const found = []
  for (const entry of readdirSafe(root)) {
    if (entry === '.bin' || entry === '.package-lock.json') continue
    if (entry.startsWith('@')) {
      for (const inner of readdirSafe(join(root, entry))) {
        const dir = join(root, entry, inner)
        if (existsSync(join(dir, 'package.json'))) found.push({ name: `${entry}/${inner}`, dir })
      }
      continue
    }
    const dir = join(root, entry)
    if (existsSync(join(dir, 'package.json'))) found.push({ name: entry, dir })
  }
  return found
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
 * Make sure one farm holds these plugins and this installation's shelf.
 *
 * Idempotent and incremental: a member already staged at the right version is
 * left alone, one whose `package.json` version differs from the store's copy is
 * re-staged — which is what keeps the farm honest after `npm install` fetched a
 * newer release of a plugin over the old one (npm writes new files, and a
 * hardlink keeps pointing at the old bytes).
 * @param {import('./paths.js').BoxLayout} layout
 * @param {import('./host.js').Engine} engine
 * @param {string[]} names - the packages (aggregates included) to stage.
 * @returns {{farm: string, staged: string[]}}
 */
export function stageForEngine(layout, engine, names) {
  const farm = farmModules(layout, engine)
  mkdirSync(farm, { recursive: true })
  const store = packageRoot(layout)
  const provided = engineProvides(engine)
  const skip = (name) => provided.has(name)
  const staged = []
  for (const name of [...new Set(names)]) {
    const closure = packageClosure({ store, name, skip })
    if (closure.length === 0) {
      throw new BoxError('PACKAGE_NOT_DOWNLOADED', t('staging.notDownloaded', { package: name }), { package: name })
    }
    for (const member of closure) {
      const target = join(farm, ...member.name.split('/'))
      if (sameVersion(target, member.dir)) continue
      removeTree(target)
      hardlinkPackage(member.dir, target)
      staged.push(member.name)
    }
  }
  // The shelf: one junction per package the installation provides, exactly the
  // move dsh itself makes inside a cabinet. Wrong-target junctions are re-aimed;
  // fresh ones created; anything else left alone.
  for (const [name, dir] of provided) {
    ensureJunction(dir, join(farm, ...name.split('/')))
  }
  return { farm, staged }
}

/**
 * Whether the staged copy is the same release as the store's.
 * @param {string} staged
 * @param {string} source
 * @returns {boolean}
 */
function sameVersion(staged, source) {
  const a = versionOf(join(staged, 'package.json'))
  return a !== null && a === versionOf(join(source, 'package.json'))
}

/** @param {string} file */
function versionOf(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version ?? null
  } catch {
    return null
  }
}

/**
 * A second address for one package's files.
 *
 * Hardlinks where possible — same volume by construction, both trees live in
 * this data directory — with a plain copy as the fallback for file systems that
 * refuse (exFAT on a USB stick is a real place this tool runs from). The
 * fallback costs disk, never correctness.
 *
 * ⛔ The package's own `node_modules` is left behind here exactly as it is in
 * `staging.js`, and for the same reason: npm nests official packages inside a
 * plugin, and a nested copy would win the walk against the farm's shelf.
 * @param {string} from
 * @param {string} to
 */
function hardlinkPackage(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSafe(from)) {
    if (entry === 'node_modules') continue
    linkEntry(join(from, entry), join(to, entry))
  }
}

/**
 * One file or one directory, linked across.
 * @param {string} source
 * @param {string} target
 */
function linkEntry(source, target) {
  const stat = lstatSync(source)
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSafe(source)) linkEntry(join(source, entry), join(target, entry))
    return
  }
  try {
    linkSync(source, target)
  } catch {
    // exFAT and friends have no hardlinks; the copy costs disk, never
    // correctness.
    copyFileSync(source, target)
  }
}

/**
 * A junction that points here, whatever was there before.
 * @param {string} target - the real directory.
 * @param {string} slot
 */
function ensureJunction(target, slot) {
  try {
    const stat = lstatSync(slot)
    if (stat.isSymbolicLink() && resolved(slot) === resolved(target)) return
  } catch {
    // Nothing there yet — the normal case.
  }
  removeTree(slot)
  mkdirSync(dirname(slot), { recursive: true })
  symlinkSync(target, slot, 'junction')
  if (!existsSync(slot)) {
    throw new BoxError('PLUGIN_LINK_BROKEN', t('launch.linkDangling', { name: slot, path: target }), { link: slot, path: target })
  }
}

/** @param {string} path */
function resolved(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Aim a cabinet's downloaded plugins at the farm of the engine about to boot.
 *
 * ⭐ This is the moment "which version" is decided, and the only moment it can
 * be: the download happens before anyone knows which dsh will run, the launch is
 * when it is known. Called on every sandbox launch, so switching a sandbox
 * between engines re-aims everything — the same "wrong target, re-point" move
 * dsh itself makes on its shelf.
 *
 * A plugin registered from the user's own folder is not touched: its junction
 * points at their disk, and their disk is not ours to re-route.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @param {string} profile
 * @param {import('./host.js').Engine} engine
 * @returns {string[]} package names re-aimed.
 */
export function repointDownloads(layout, home, profile, engine) {
  const entries = readLedgerProfile(layout, home, profile).entries
    .filter((entry) => entry.kind === 'link' && typeof entry.path === 'string' && isOurDownload(layout, entry.path))
  if (entries.length === 0) return []
  // Staged by family root: an aggregate's members can live nested inside it in
  // the store, where a flat lookup would miss them — the aggregate's closure
  // finds them wherever npm put them, and the farm flattens them by name.
  stageForEngine(layout, engine, entries.map((entry) => entry.via ?? entry.package))
  const farm = farmModules(layout, engine)
  const repointed = []
  for (const entry of entries) {
    const target = join(farm, ...entry.package.split('/'))
    if (!existsSync(join(target, 'package.json'))) {
      throw new BoxError('PACKAGE_NOT_DOWNLOADED', t('staging.notDownloaded', { package: entry.package }), { package: entry.package })
    }
    const slot = join(profileModules(home, profile), ...entry.package.split('/'))
    ensureJunction(target, slot)
    repointed.push(entry.package)
  }
  return repointed
}

/**
 * Take one package out of every farm.
 *
 * Called when the download itself is removed: a farm entry is hardlinks into
 * bytes that are about to be unlinked, and without the store copy it is an
 * orphan no launch can refresh.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 */
export function dropFromFarms(layout, name) {
  for (const key of readdirSafe(layout.engines)) {
    const farm = join(layout.engines, key, 'node_modules')
    removeTree(join(farm, ...name.split('/')))
    const scope = name.split('/')[0]
    if (scope.startsWith('@')) {
      const scopeDir = join(farm, scope)
      try {
        if (readdirSync(scopeDir).length === 0) removeTree(scopeDir)
      } catch {
        // Not there. Fine.
      }
    }
  }
}

/**
 * Take a whole farm away — when the release it mirrors is deleted.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} version
 */
export function dropReleaseFarm(layout, version) {
  removeTree(join(layout.engines, `release-${safeName(version)}`))
}
