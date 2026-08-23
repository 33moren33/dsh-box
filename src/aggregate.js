/**
 * Aggregate packages: one package on npm that is really seventeen plugins.
 *
 * ## The hole this closes
 *
 * A row in a patch file names **one package for dsh to import**. dsh's own
 * bundle list does something else entirely: it resolves the package, reads the
 * patch file the package's `dsh.bundle.patch` points at, and applies **all of
 * it**. So a package whose patch carries seventeen rows is seventeen plugins
 * through that door and exactly one through ours.
 *
 * ⛔ Measured, and the bad part is that it is silent: `@linxin666/dsh-web-ui-all`
 * installed as a single row boots a perfectly healthy dsh with **one** plugin in
 * the list and no warning anywhere. CEO 2026-08-23, on why this is not a
 * one-vendor problem: *「如果 npm 很多都是这种聚合包，岂不是我们 box 都下载不
 * 了。」*
 *
 * ## What is done about it
 *
 * The package's own patch is read and its rows are written into the target
 * cabinet **verbatim** — same ids, same names, same order. ⭐ Verbatim is not
 * laziness: those rows are what upstream would have applied, so copying them is
 * the one expansion that cannot be wrong about the vendor's intent. It also
 * gets the awkward cases right for free — an asset-only package like
 * `@linxin666/dsh-skins` is a *dependency* of the aggregate but has no row in
 * its patch, and naming it in a row is what took a whole dsh down once
 * (`ERR_MODULE_NOT_FOUND`, nothing to import).
 *
 * ⚠️ **The layer is not the same layer, and that is why some of these are
 * refused.** dsh applies each bundle as its own layer *before* the profile
 * patch; we inline into the profile patch, which comes after. For rows that
 * only `insert`, being later changes nothing — they add, and adding is
 * order-free. For a row that targets an existing `id` (an override, a
 * `disabled: true`, or an `insert` *into* a group) it changes everything: at a
 * different layer it lands on a different thing. Those are refused with the
 * reason, rather than expanded into something that looks right and is not.
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { scanPatch } from './patch-file.js'

/**
 * @typedef {object} AggregateRow
 * @property {string} id
 * @property {string} package
 * @property {string | null} path - where that package really is, once resolved
 * from the aggregate. Null for the aggregate's own row, which is handled by the
 * ordinary install road.
 */

/**
 * What one package brings with it, or null when it brings only itself.
 *
 * @param {string} dir - the aggregate's folder.
 * @param {string} name - its package name.
 * @returns {{rows: AggregateRow[], file: string} | null}
 * @throws {BoxError} `AGGREGATE_NOT_INLINEABLE` when a row depends on the layer
 * it sits in; `AGGREGATE_MEMBER_MISSING` when a row names a package the
 * aggregate did not bring.
 */
export function aggregateOf(dir, name) {
  const file = bundlePatchFile(dir)
  if (file === null) return null
  const scan = scanPatch(readFileSync(file, 'utf8'))
  // ⛔ Refused before anything is read out of it. An item carrying an `id:` of
  // its own is aimed at a row somebody else wrote — upstream applies it one
  // layer earlier than we would, at which point it can be aimed at something
  // else entirely. There is no honest inlining of that, so it says so.
  const targeted = scan.items.filter((item) => item.id !== null)
  if (targeted.length > 0) {
    throw new BoxError(
      'AGGREGATE_NOT_INLINEABLE',
      t('aggregate.notInlineable', { name, file, ids: targeted.map((item) => item.id).join('、') }),
      { package: name, file, ids: targeted.map((item) => item.id) },
    )
  }
  const rows = scan.items.flatMap((item) => item.entries)
    .filter((entry) => entry.id !== null && entry.name !== null)
    .map((entry) => ({ id: entry.id, package: entry.name, path: null }))
  // One row, and it is the package itself: an ordinary plugin that happens to
  // register through its own patch. Nothing to expand, so it takes the normal
  // road and this module stays out of it.
  if (rows.every((row) => row.package === name)) return null
  return { rows: rows.map((row) => ({ ...row, path: row.package === name ? dir : memberPath(dir, row.package, name) })), file }
}

/**
 * Where the aggregate's copy of one member really is.
 *
 * ⭐ Asked of Node, with `createRequire` rooted at the aggregate's own manifest
 * — which is the same mechanism dsh's client loader uses (`createRequire(ctx.baseUrl)`
 * then `require.resolve(`${spec}/package.json`)`). Same question, same answer:
 * if this cannot find it, neither will dsh.
 *
 * ⛔ A member that cannot be resolved *from the aggregate* is the aggregate's
 * problem, not the user's, and the message says so: it named a package it did
 * not ship.
 *
 * ⛔⛔ **Do not confuse that with a member whose own `@deepseek-ai/*` imports go
 * missing at boot — that one is ours.** A plugin declaring those in
 * `devDependencies` is not broken packaging; it is exactly what upstream's
 * design supports. dsh maintains `$DSH_HOME/profiles/node_modules` as a flat
 * directory of links to its own dependency closure, so any plugin whose **real
 * path** sits under `$DSH_HOME/profiles/` picks them up by Node's ordinary
 * parent-walk (`packages/boot/app-boot/src/profile.ts`,
 * `healProfilesModuleFallback`). Upstream states the rule it turns on: *"Symlinked
 * packages resolve their own dependencies from their real directories (Node's
 * default symlink-following)"* — so a package we keep in our own tree and link
 * in has a real path outside `profiles/`, and the walk never reaches the
 * fallback. Measured both ways on a two-file repro with no npm involved.
 * ⚠️ An earlier round wrote this up as "that family's packaging is broken and
 * cannot be installed from npm". That was wrong, and it was wrong because
 * nobody had installed it the official way to compare.
 * @param {string} dir
 * @param {string} member
 * @param {string} aggregate - for the message.
 * @returns {string}
 */
function memberPath(dir, member, aggregate) {
  try {
    return dirname(createRequire(join(dir, 'package.json')).resolve(`${member}/package.json`))
  } catch {
    throw new BoxError(
      'AGGREGATE_MEMBER_MISSING',
      t('aggregate.memberMissing', { aggregate, member, dir }),
      { package: aggregate, member, dir },
    )
  }
}

/**
 * The rows one entry of `dsh.profile.bundles` actually brings in.
 *
 * ⭐ Same capability as {@link aggregateOf}, asked from the other end. A bundle
 * is **a whole layer**, not a row: dsh resolves the package, reads the patch its
 * `dsh.bundle.patch` names, and applies all of it. So "what is in this cabinet"
 * cannot be answered without opening them, and neither can "switch that one
 * off" — the switch is written against a row's `id`, and the ids are in there.
 *
 * ⛔ Best-effort on purpose, and never throws: this runs on every listing, and a
 * bundle naming a package that is not installed is a thing that happens. An
 * unopenable bundle shows up as a bundle with no rows, which is what it looks
 * like to a person too.
 * @param {string} profileDir - the profile, which is where dsh resolves from.
 * @param {string} name - the package named in `dsh.profile.bundles`.
 * @returns {{rows: {id: string, package: string}[], file: string | null, dir: string | null}}
 */
export function bundleRows(profileDir, name) {
  const blank = { rows: [], file: null, dir: null }
  let dir
  try {
    dir = dirname(createRequire(join(profileDir, 'package.json')).resolve(`${name}/package.json`))
  } catch {
    return blank
  }
  const file = bundlePatchFile(dir)
  if (file === null) return { ...blank, dir }
  try {
    const scan = scanPatch(readFileSync(file, 'utf8'))
    return {
      dir,
      file,
      rows: scan.items.flatMap((item) => item.entries)
        .filter((entry) => entry.id !== null)
        .map((entry) => ({ id: entry.id, package: entry.name ?? entry.id })),
    }
  } catch {
    return { ...blank, dir }
  }
}

/**
 * The patch file a package declares as its bundle, or null.
 *
 * ⚠️ Relative to the package folder and checked for existence, because
 * `dsh.bundle.patch` naming a file that is not in `files:` is a thing that
 * happens: the package publishes, dsh finds no patch, and the plugin is quietly
 * one row instead of seventeen.
 * @param {string} dir
 * @returns {string | null}
 */
export function bundlePatchFile(dir) {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  let patch
  try {
    patch = JSON.parse(readFileSync(manifest, 'utf8'))?.dsh?.bundle?.patch
  } catch {
    return null
  }
  if (typeof patch !== 'string' || patch === '') return null
  const file = resolve(dir, patch)
  return existsSync(file) ? file : null
}
