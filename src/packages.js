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
  rmSync(dir, { recursive: true, force: true })
  // A scope directory left empty is litter of exactly the kind this file is
  // about, so it goes too — but only when empty, never with anything in it.
  const [scope] = name.split('/')
  if (scope.startsWith('@')) {
    const scopeDir = join(packageRoot(layout), scope)
    if (existsSync(scopeDir) && readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true })
  }
  return true
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
