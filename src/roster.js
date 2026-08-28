/**
 * The short list of plugins this tool can name — worked out, never kept.
 *
 * ⛔ **This file replaces a stored list, and that is the whole point.** There
 * used to be a registry in the config: `plugins add` wrote a row, `plugins rm`
 * deleted one, and the window drew from it. It existed for exactly one reason —
 * the window needed a short list to draw — and it was the only storage layer in
 * this tool that no other part of the product needed. **A storage layer that
 * exists to serve one screen is a screen's implementation detail that everybody
 * else has to learn about.**
 *
 * ⭐⭐ It was also a second copy of a fact the cabinets already hold. Two records
 * of one thing stay equal only while nobody edits by hand, and this tool's whole
 * design says people will: the patch file is deliberately plain text, `dsh
 * plugin add` writes to the same places, and the sandboxes are somebody's own
 * disk. The registry could not be kept honest, only re-synced — so it is gone,
 * and the answer is computed from the two places that cannot drift, because
 * they are the things themselves:
 *
 *   1. **what the cabinets actually hold** — read from each cabinet's own files;
 *   2. **what we have downloaded** — read from our own package tree.
 *
 * ⭐ The union is what a person means by "the plugins around here": everything
 * installed somewhere, plus everything fetched but not yet put anywhere.
 *
 * ⭐⭐ It also decides a product question that looks unrelated. Naming a plugin
 * that lives in *another* cabinet is how a plugin moves between cabinets — the
 * daily cabinet's setup into a sandbox to reproduce something, a sandbox's into
 * the daily cabinet to keep it. With a registry, only rows somebody had
 * remembered to `add` could be named. Derived, **whatever the daily cabinet
 * holds is nameable by definition**, and moving in either direction stops being
 * a feature and becomes an argument.
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { t } from './messages.js'
import { cabinetInventory, cabinetPlugins, DEFAULT_PROFILE, profileModules } from './mounts.js'
import { listPackages, packageRoot } from './packages.js'
import { safeName, userDshHome } from './paths.js'
import { listSandboxes } from './sandbox.js'

/**
 * @typedef {object} Cabinet
 * @property {string} label - for the screen; translated, so never a key.
 * @property {string} home
 * @property {boolean} main
 * @property {string | null} sandbox - the identifier. `null` is the daily
 * cabinet, exactly as everywhere else in this tool.
 */

/**
 * @typedef {object} RosterEntry
 * @property {string} id
 * @property {string} package
 * @property {string} path - the folder to install *from*: our own copy when we
 * have one, otherwise the user's folder.
 * @property {string} label
 * @property {Cabinet[]} cabinets - where it is installed right now. Empty means
 * downloaded and put nowhere yet, which is a real and useful state.
 * @property {boolean} owned - whether **the files** are ours. ⛔ This is not
 * "may it appear in the list" — everything appears. It is the one thing that
 * decides what removing is allowed to touch: our own downloads may be deleted
 * off the disk, somebody else's folder never is, only the cabinet's config and
 * link go (CEO 2026-08-28).
 * @property {string} source - which file the row lives in: `ours` / `store` /
 * `profilePatch` / `homePatch` / `bundle`. ⛔ Load-bearing for removal: only the
 * top layer's rows can be deleted at all.
 */

/**
 * Every filing cabinet this tool knows about, daily one first.
 *
 * ⚠️ **Knows about** is the limit, and it is worth stating rather than
 * discovering: the sandboxes are ours because we made them, and the daily
 * cabinet is the one `DSH_HOME` points at. A home somebody made by hand and
 * never opened from here is invisible, so anything answering "everywhere this is
 * installed" is answering "everywhere we can see".
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {Cabinet[]}
 */
export function everyCabinet(layout) {
  return [
    { label: t('cabinet.daily'), home: userDshHome(), main: true, sandbox: null },
    ...listSandboxes(layout).map((box) => ({
      label: box.name, home: box.home, main: false, sandbox: box.name,
    })),
  ]
    // ⛔ A home that is not on disk is not a cabinet yet. The daily one is the
    // case that matters: `userDshHome()` names a path whether or not dsh has
    // ever run, and without this filter every answer about "where is this
    // installed" would walk a folder that does not exist.
    .filter((cabinet) => existsSync(cabinet.home))
}

/**
 * The short list, computed from the cabinets and our own download tree.
 *
 * ⛔ Keyed by id and merged by package name, in that order and not the other
 * way: the id is what every command takes, but one package installed into two
 * cabinets under two different ids is still one plugin to a person, and showing
 * it twice would make the list read as two things to remove.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {RosterEntry[]}
 */
export function derivedRoster(layout) {
  /** @type {Map<string, RosterEntry>} */
  const byId = new Map()
  const stored = storedPaths(layout)

  for (const cabinet of everyCabinet(layout)) {
    // ⭐⭐ **Everything the cabinet holds, not only what we put there** (CEO
    // 2026-08-28). Measured on the machine this tool is built on: the daily
    // cabinet had **0 rows we installed and 3 we did not** — so a roster of
    // "ours" alone is empty exactly where it matters most, and "take the daily
    // cabinet's setup into a sandbox" has nothing to name.
    //
    // ⛔ Being in the list does **not** mean we may delete their files. What it
    // means is that the row is nameable: it can be copied elsewhere, switched
    // off, or taken out of *this cabinet's config*. Whose disk the folder is on
    // still decides what removal is allowed to touch — see `owned`.
    for (const entry of cabinetEntries(layout, cabinet)) {
      const found = byId.get(entry.id)
      if (found !== undefined) {
        found.cabinets.push(cabinet)
        continue
      }
      byId.set(entry.id, {
        id: entry.id,
        package: entry.package,
        owned: entry.owned,
        source: entry.source,
        // ⛔⛔ Our own copy wins over the path the cabinet loads from, and this
        // is load-bearing rather than cosmetic. The daily cabinet gets a *copy*
        // staged into its own `_local` so that deleting this tool cannot break
        // it — so the path it loads from is inside the user's home, and
        // `isOurDownload` says no about it. Answering with that path would make
        // a package we downloaded look like a folder of the user's own, and the
        // one thing that decides what removing it does is whose files they are.
        path: stored.get(entry.package) ?? entry.path ?? '',
        label: entry.package,
        cabinets: [cabinet],
      })
    }
  }

  // Downloaded and put nowhere yet. ⭐ These are the reason the list is a union
  // rather than just a walk of the cabinets: fetching a package and installing
  // it are two steps, and between them the package exists and is nowhere.
  const known = new Set([...byId.values()].map((entry) => entry.package))
  for (const [name, dir] of stored) {
    if (known.has(name)) continue
    const id = safeName(name)
    if (id === '' || byId.has(id)) continue
    byId.set(id, {
      id, package: name, path: dir, label: name, cabinets: [], owned: true, source: 'store',
    })
  }

  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * One cabinet's rows, ours and theirs alike, in one shape.
 *
 * ⭐ The two are read from different places for a reason that is worth keeping
 * straight. `ours` comes from the intersection of our ledger and the cabinet's
 * file, so it carries what we recorded — the id we chose, the folder we linked.
 * `theirs` has no record of ours behind it at all, so everything about it has to
 * be read off the cabinet: the id and the package name from the patch row, and
 * the folder by asking the filesystem where the link goes.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {Cabinet} cabinet
 * @returns {{id: string, package: string, path: string, owned: boolean, source: string}[]}
 */
function cabinetEntries(layout, cabinet) {
  const mounted = cabinetPlugins(layout, cabinet.home)
  const rows = mounted.ours.map((entry) => ({
    id: entry.id,
    package: entry.package,
    path: entry.path ?? '',
    // ⭐ "Ours" here means we fetched or linked the files, which is what decides
    // whether removing may delete anything. It is not the same question as "is
    // this row in the list".
    owned: true,
    source: 'ours',
  }))
  const seen = new Set(rows.map((row) => row.package))
  for (const row of cabinetInventory(cabinet.home).rows) {
    // ⛔ `platform` rows are the base itself — 129 of them in a clean profile.
    // They are not plugins anybody chose, and listing them buries the few that
    // were chosen, which is the reason `cabinetInventory` folds them already.
    if (row.platform === true || typeof row.name !== 'string' || seen.has(row.name)) continue
    rows.push({
      id: typeof row.id === 'string' && row.id !== '' ? row.id : safeName(row.name),
      package: row.name,
      path: linkTarget(cabinet.home, row.name),
      owned: false,
      // ⛔⛔ Which file the row lives in, carried because it decides whether the
      // row can be **deleted** at all. A row in the profile's own patch is in
      // the top layer and can go; a row a bundle brought in cannot — that format
      // has no `remove`, lower layers can only be overridden from above, so the
      // only way to take one of those out is to write `disabled: true`
      // (established by 刀 6, `b2c3b4b`).
      source: typeof row.source === 'string' ? row.source : 'unknown',
    })
  }
  return rows
}

/**
 * Where a cabinet's link for this package actually points.
 *
 * ⚠️ Resolved rather than remembered, and empty when it resolves to nothing: a
 * row can name a package whose link was never made or has since been broken, and
 * a path invented for it would be a folder this tool would then try to copy.
 * @param {string} home
 * @param {string} name
 * @returns {string}
 */
function linkTarget(home, name) {
  const slot = join(profileModules(home, DEFAULT_PROFILE), ...name.split('/'))
  try {
    return realpathSync(slot)
  } catch {
    return ''
  }
}

/**
 * Where our own copy of each downloaded package sits, by package name.
 *
 * ⚠️ Only the top level of the store, which is what {@link listPackages}
 * answers. A member of an aggregate lives nested inside its family root, and a
 * nested member is not a thing anybody installs on its own.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {Map<string, string>}
 */
function storedPaths(layout) {
  return new Map(listPackages(layout).map((one) => [one.name, one.dir]))
}

/**
 * The entries whose folder is still there, and the ones whose is not.
 *
 * A plugin whose folder has been moved or deleted is reported rather than
 * dropped: silently losing a row the user is still looking at is how a launch
 * quietly stops including something.
 * @param {RosterEntry[]} roster
 * @returns {{live: RosterEntry[], missing: RosterEntry[]}}
 */
export function partitionRoster(roster) {
  const live = []
  const missing = []
  for (const entry of roster) {
    (entry.path !== '' && existsSync(join(entry.path, 'package.json')) ? live : missing).push(entry)
  }
  return { live, missing }
}

/**
 * Whether our download tree has anything in it at all.
 *
 * ⚠️ Cheaper than {@link listPackages}, which counts files inside every package
 * to give a person something to compare. This answers only "is there a tree",
 * which is all a poll needs.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {boolean}
 */
export function hasDownloads(layout) {
  const root = packageRoot(layout)
  try {
    return readdirSync(root).some((entry) => entry !== '.package-lock.json' && entry !== '.bin')
  } catch {
    return false
  }
}
