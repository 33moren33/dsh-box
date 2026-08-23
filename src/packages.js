/**
 * The little package tree this tool downloads into, and how to clear it out.
 *
 * ⛔ **This file exists because that directory had exactly one visitor.**
 * `layout.packages` was written to when a plugin was fetched and never looked at
 * again — nothing listed it, nothing removed from it, and `plugins uninstall`
 * deliberately left packages behind so putting one back would be instant. The
 * result was a directory that only grew, with no way to see inside it and no way
 * to clean it, so the only way to deal with it was to open a shell and `rm`.
 *
 * That is worse than untidy. This tool's promise to a person watching the window
 * is "what is on the screen is everything", and that promise holds only while
 * every action goes through the exe. **A tool that offers a way to do something
 * but no way to undo it or look at it forces the agent outside its own
 * boundary** — and those moves are invisible to the human view.
 *
 * So the rule this file is an instance of: when counting up the commands, do not
 * count how many can *do* something. Count whether everything that can be done
 * has a matching way to undo it and to see it.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { removeTree } from './paths.js'
import { liveClaim } from './sandbox.js'

/** Where npm puts what it fetches for us. */
export function packageRoot(layout) {
  return join(layout.packages, 'node_modules')
}

/**
 * @typedef {object} DownloadedPackage
 * @property {string} name - the package name, `@scope/` and all.
 * @property {string} version
 * @property {string} dir
 * @property {number} files - how many files it brought, itself and its own
 * dependencies excluded; a rough size a person can compare.
 */

/**
 * Everything fetched into our own tree, by name.
 *
 * Scoped names live one directory deeper, so the walk goes two levels for those
 * and one for the rest — the same shape `linkPlugins` builds when it links them.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {DownloadedPackage[]}
 */
export function listPackages(layout) {
  const root = packageRoot(layout)
  if (!existsSync(root)) return []
  const found = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('@')) {
      const scope = join(root, entry.name)
      for (const inner of readdirSync(scope, { withFileTypes: true })) {
        if (inner.isDirectory()) found.push(describe(`${entry.name}/${inner.name}`, join(scope, inner.name)))
      }
      continue
    }
    // npm's own bookkeeping, not a package anybody asked for.
    if (entry.name === '.package-lock.json' || entry.name === '.bin') continue
    found.push(describe(entry.name, join(root, entry.name)))
  }
  return found.filter((one) => one !== null).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @param {string} name
 * @param {string} dir
 * @returns {DownloadedPackage | null}
 */
function describe(name, dir) {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  let version = '?'
  try {
    version = JSON.parse(readFileSync(manifest, 'utf8')).version ?? '?'
  } catch {
    // A package we cannot read the version of is still a package that is there.
  }
  return { name, version, dir, files: countFiles(dir) }
}

/**
 * @param {string} dir
 * @param {number} [budget] - stop counting past this; the number is for
 * comparison, and walking a huge tree to be exact would cost more than it says.
 * @returns {number}
 */
function countFiles(dir, budget = 5000) {
  let total = 0
  const pending = [dir]
  while (pending.length > 0 && total < budget) {
    let entries
    try {
      entries = readdirSync(pending.pop(), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(join(entry.parentPath ?? entry.path, entry.name))
      else total += 1
    }
  }
  return total
}

/**
 * Delete one downloaded package.
 *
 * ⚠️ Says nothing about whether anything is using it — that question needs to
 * know about workspaces, which this file deliberately does not. The caller asks
 * it, because the caller is where refusing can be explained.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} name
 * @returns {boolean} whether there was one to delete.
 */
export function removePackage(layout, name) {
  const dir = join(packageRoot(layout), ...name.split('/'))
  if (!existsSync(dir)) return false
  removeTree(dir)
  // A scope directory left empty is litter of exactly the kind this file is
  // about, so it goes too — but only when empty, never with anything in it.
  const [scope] = name.split('/')
  if (scope.startsWith('@')) {
    const scopeDir = join(packageRoot(layout), scope)
    if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) removeTree(scopeDir)
  }
  return true
}

/**
 * The version a plugin folder claims, read off the disk at the moment of asking.
 *
 * Never stored anywhere: a version written into the config would be a second
 * copy that goes stale the moment the folder is updated, and the folder's own
 * `package.json` is already the one place the answer lives. `null` — not `'?'`
 * — when there is nothing to read: a listing prints nothing for it, because a
 * placeholder on the screen reads as a fact about the plugin.
 * @param {string} dir
 * @returns {string | null}
 */
export function pluginVersion(dir) {
  // ⛔ An empty or missing path must answer null here, not fall through: with
  // `dir` empty, `join('', 'package.json')` names a file in the *working
  // directory*, and the number on screen would be whatever package the tool
  // happens to be running from — dsh-box's own version, presented as a plugin's.
  if (typeof dir !== 'string' || dir === '') return null
  try {
    const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
    return typeof version === 'string' && version !== '' ? version : null
  } catch {
    return null
  }
}

/**
 * The one file that says a download is happening right now, and which one.
 *
 * ⛔ **It exists because two npm runs in this tree break each other**, measured:
 * a second `plugins install` started while the first was still resolving died on
 * `EBUSY … rename 'node_modules/cloudflared'`, because both were writing the
 * same dependency. npm takes no cross-process lock of its own, and this tree is
 * shared by every cabinet by design, so the exclusion has to live here.
 *
 * ⭐ One claim for the whole tree, not one per package: the collisions are
 * between *dependencies*, which two unrelated plugins can easily share — so
 * per-package exclusion would have let through exactly the case that was
 * measured. It also removes, rather than patches, the reason two writers could
 * ever land in one package log: with no concurrency there is nothing to interleave.
 *
 * ⭐ It answers a second question for free. Because the claim names the package
 * and its log, whoever holds it is also the answer to "is a download in flight,
 * and where do I watch it" — which is what lets the window show a download it
 * did not start, without inventing a job id the command line knows nothing about.
 *
 * Kept beside the tree it guards rather than in the data directory's root, for
 * the same reason a sandbox's running mark sits inside the sandbox: a file next
 * to the thing it describes gets deleted together with it, or not at all.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {string}
 */
export function installClaimFile(layout) {
  return join(layout.packages, 'installing.json')
}

/**
 * The download in flight this second, or null.
 *
 * ⛔ Liveness is the holder's pid, never the age of the log. A heartbeat in the
 * log says "still working" to a reader; it cannot say "nobody is working" — a
 * process killed between beats leaves a file that reads as three seconds fresh
 * forever. This tool settled that question once already, for running sandboxes,
 * and settles it the same way here.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {{name: string, log: string, startedAt: string} | null}
 */
export function downloadInFlight(layout) {
  const file = installClaimFile(layout)
  // ⛔⛔ Two pids, and either one alive means the tree is busy. The claim holder
  // is the command line; `npm` is the process actually writing, and it is a
  // *child* — on Windows, killing a parent leaves its children running, which
  // was measured twice in one day. Trusting only the holder's pid would let the
  // claim go stale while npm was still unpacking, and wave the next install
  // straight into the collision this file exists to prevent.
  const held = liveClaim(file)
  if (held === null || typeof held.name !== 'string' || held.name === '') return null
  return {
    name: held.name,
    log: typeof held.log === 'string' ? held.log : '',
    startedAt: typeof held.startedAt === 'string' ? held.startedAt : '',
  }
}

/**
 * Whether a path lands inside our own package tree.
 *
 * This is how a plugin registered from a download is told apart from one
 * registered from a folder of the user's own: same shape in every record, and
 * the only difference that matters is whose disk it is. **Ours we may delete;
 * theirs we must never touch.**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} path
 * @returns {boolean}
 */
export function isOurDownload(layout, path) {
  if (typeof path !== 'string' || path === '') return false
  const rel = relative(packageRoot(layout), path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
