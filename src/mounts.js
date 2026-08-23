/**
 * Which plugins a filing cabinet has, and how one gets added or taken away.
 *
 * A plugin used to be something a launch carried: the launcher wrote an overlay
 * file, passed it as `--patch`, and the plugin existed for exactly as long as
 * that dsh ran. That made "what does this workspace have" a question with no
 * answer on disk — you could only say what the *next* launch would carry.
 *
 * Now it is registered, in the workspace's own profile patch, the file dsh
 * reads by itself. So the answer is a fact about the workspace rather than
 * about a launch, `dsh` typed by hand loads the same plugins, and the window
 * can show what is there before anything starts.
 *
 * ⭐⭐ **Nothing this tool writes into that file identifies it as ours.** A row
 * we add is spelled exactly the way a person or `dsh plugin add` would spell it,
 * and the record of which rows we added lives in our own data directory
 * (`cabinet-ledger.js`). That is a reversal — ownership used to be marker
 * comments in the file itself — and it was made on purpose (CEO 2026-08-23):
 * a patch file with no decoration in it is **a portable list of plugins**, one
 * a person can copy straight from their daily cabinet into a sandbox, and
 * decoration in these files is a common cause of plugin conflicts in the first
 * place.
 *
 * ⛔ The cost, accepted rather than solved: two copies of one fact can drift.
 * Every read here therefore treats the cabinet's file as the truth and the
 * ledger as a claim about it — "ours" is the *intersection*, so a row deleted by
 * hand is simply no longer ours to talk about, and a lost data directory leaves
 * the rows working and unattributed rather than making us guess.
 *
 * ⚠️ The parse of rows we did not write is best-effort by design. dsh's patch
 * format is not ours and a full YAML reader would be a dependency; what is
 * wanted there is only "name the plugins this home already had so the person can
 * see them and we can avoid adding a duplicate", and a name that is missed shows
 * up as an unlisted plugin rather than as a wrong action. Where the file cannot
 * be read at all, that is reported rather than treated as an empty file.
 */

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { bundleRows } from './aggregate.js'
import { readLedgerProfile, withCabinetLock, writeLedgerProfile } from './cabinet-ledger.js'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { removeTree } from './paths.js'
import { cutLines, renderPatch, scanPatch, spliceLines } from './patch-file.js'
import { instantNow, stampNow } from './clock.js'

/** The profile every launch uses. dsh's own default, and the only one offered. */
export const DEFAULT_PROFILE = 'web'

/**
 * What dsh puts in a brand-new profile patch: an empty list, and a whole document.
 *
 * ⛔⛔ It has to come out before anything can be appended, because it is not a
 * line — it is the end of the document. Anything after it is a *second* YAML
 * document and dsh refuses to parse the file at all. Measured: one brand-new
 * sandbox plus any one plugin, on Windows and on Linux, and that sandbox could
 * never boot again. Appending was safe against every fixture we had — hand
 * written, pre-populated, empty — and wrong against the only file a new user
 * actually gets. It goes back when our last row leaves; that we are holding it
 * is recorded in the ledger.
 */
const EMPTY_LIST = '[]'

/**
 * How a row of ours is indented when we have to start a fresh `- insert:` item.
 *
 * Only used for an item we create. Adding to one that already exists takes the
 * column from the row above it instead, because that file's author chose it.
 */
const ROW_INDENT = '    '

/**
 * The markers `v0.3.0` and earlier wrote around their own rows.
 *
 * ⛔ Kept solely to *clean up* after those versions, not for compatibility:
 * nothing here ever writes one again. A cabinet that still has a block gets it
 * folded into the ledger and the comments taken out the next time it is
 * written. ⭐ Verified on the machine this matters most on — the real `~/.dsh`
 * here has never had one (`grep -c dsh-box` = 0) — so this path exists for
 * other people's cabinets.
 */
const LEGACY_START = '# >>> dsh-box: maintained automatically, rewritten whenever plugins change'

/** Closed the legacy block. */
const LEGACY_END = '# <<< dsh-box: end'

/** The legacy note recording that {@link EMPTY_LIST} was being held. */
const LEGACY_EMPTY_LIST = /^[ \t]*#[ \t]*dsh-box:[ \t]*empty-list[ \t]*$/

/** The legacy per-row note saying how a name resolved. */
const LEGACY_NOTE = /^[ \t]*#[ \t]*dsh-box:[ \t]*(link|package)(?:[ \t]+(.*?))?[ \t]*$/

/**
 * @typedef {object} MountedPlugin
 * @property {string} id - the id the patch entry is keyed by.
 * @property {string} package - the package name dsh resolves.
 * @property {'link' | 'package'} kind - a folder linked in, or a package installed here.
 * @property {string | null} path - where the folder is, for linked ones.
 * @property {string | null} [via] - the aggregate package this row arrived with,
 * or null for a plugin installed on its own. The aggregate's own row names
 * itself here, which is what makes "is this the whole family" one comparison.
 */

/**
 * @typedef {object} CabinetPlugins
 * @property {MountedPlugin[]} ours - registered by this tool; these can be removed.
 * @property {string[]} theirs - package names this workspace had already; read-only to us.
 * @property {string[]} platform - the official base bundles every profile carries.
 * @property {boolean} readable - false when a file exists but could not be understood.
 * @property {string} patchFile - the profile patch this tool writes.
 */

/**
 * Packages that are the platform rather than something added to it.
 *
 * Every profile's bundle list starts with these, so listing them as "plugins
 * this workspace has" is a line of noise on every workspace that makes the two
 * or three answers a person is actually looking for harder to find. They are
 * reported separately rather than dropped: hiding a fact to tidy a list is how
 * a display starts lying, and `status` still says they are there.
 */
const PLATFORM_PREFIX = '@deepseek-ai/'

/** The profile patch dsh reads by itself, and the one this tool writes. */
export function profilePatchFile(home, profile = DEFAULT_PROFILE) {
  return join(home, 'profiles', profile, 'cordis.patch.yml')
}

/** The profile's `package.json`, where dsh keeps its bundle list. */
export function profilePackageFile(home, profile = DEFAULT_PROFILE) {
  return join(home, 'profiles', profile, 'package.json')
}

/** Where a linked folder is made resolvable. */
export function profileModules(home, profile = DEFAULT_PROFILE) {
  return join(home, 'profiles', profile, 'node_modules')
}

/**
 * What this workspace has, split by who put it there.
 *
 * ⭐ `ours` is an **intersection**, and that is the whole of how two copies of
 * one fact are kept from lying. The ledger claims we wrote a row; the cabinet's
 * file says whether that row is still there. A row somebody deleted by hand
 * drops out of `ours` on the next read, which is exactly right — it is not there
 * any more, so there is nothing of ours to remove. The old marker-comment shape
 * got this for free by having only one copy; this is the price of the file being
 * plain.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @param {string} [profile]
 * @returns {CabinetPlugins}
 */
export function cabinetPlugins(layout, home, profile = DEFAULT_PROFILE) {
  const patchFile = profilePatchFile(home, profile)
  const text = readText(patchFile)
  const readable = isReadable(patchFile, text)
  const theirs = new Set(namesIn(text))
  // The machine-wide patch is the other place a home can name a plugin, and
  // this tool never writes it, so everything found there is the workspace's own.
  for (const name of namesIn(readText(join(home, 'cordis.patch.yml')))) theirs.add(name)
  // The bundle list is the third place, and this tool only ever reads it. That
  // is dsh's own tooling's file: `dsh plugin add` writes there, and so does
  // whatever the user has done by hand. Everything in it is theirs.
  for (const name of bundleNames(profilePackageFile(home, profile))) theirs.add(name)
  const scan = scanPatch(text)
  const claimed = [...readLedgerProfile(layout, home, profile).entries, ...legacyEntries(scan)]
  const ours = claimedRows(claimed, scan).map((found) => found.plugin)
  // A package cannot be in both columns. If it somehow is, ours wins: we know
  // exactly what we wrote, and the other reading is a guess from a text search.
  for (const plugin of ours) theirs.delete(plugin.package)
  const platform = [...theirs].filter((name) => name.startsWith(PLATFORM_PREFIX)).sort()
  for (const name of platform) theirs.delete(name)
  return { ours, theirs: [...theirs].sort(), platform, readable, patchFile }
}

/**
 * Which of the rows we claim are still in the file, and where each one sits.
 *
 * ⛔ The claim list is passed in rather than read here, because the two callers
 * hold different ones: a read consults the ledger on disk, while a write is
 * working from a list that also holds rows just folded in from a legacy block
 * and not yet saved. Reading it in here would have made the write path migrate
 * a cabinet and then fail to find what it had just migrated.
 * @param {import('./cabinet-ledger.js').LedgerEntry[]} claimed
 * @param {import('./patch-file.js').ScannedPatch} scan
 * @returns {{plugin: MountedPlugin, item: number, entry: number}[]}
 */
function claimedRows(claimed, scan) {
  const found = []
  const taken = new Set()
  for (const plugin of claimed) {
    scan.items.forEach((item, itemIndex) => {
      item.entries.forEach((entry, entryIndex) => {
        const key = `${itemIndex}:${entryIndex}`
        if (taken.has(key) || entry.id !== plugin.id || entry.name !== plugin.package) return
        taken.add(key)
        found.push({ plugin, item: itemIndex, entry: entryIndex })
      })
    })
  }
  return found
}

/**
 * Everything registered in one cabinet, from all three places dsh reads.
 *
 * ⭐⭐ The point is that **the user does not have to tell this tool what they
 * already have.** Whoever installed a plugin — us, `dsh plugin add`, or a hand
 * edit — followed the same protocol, so reading the protocol reads all of them.
 * Without this, a person or an agent has to re-enter, one at a time, what the
 * cabinet already knows.
 *
 * The three places, and how they differ (measured, not assumed):
 *
 * | where | what a row means |
 * |---|---|
 * | `profiles/<profile>/cordis.patch.yml` | one row, one plugin |
 * | `<home>/cordis.patch.yml` | same, but applied to every profile |
 * | `dsh.profile.bundles` in the profile's `package.json` | **a whole layer**: dsh resolves the package, reads the patch file its `dsh.bundle.patch` names, and applies all of it |
 *
 * That last row is why an aggregate package holds seventeen plugins and a patch
 * row holds one.
 *
 * ⚠️ Layer order is `bundles → profile patch → home patch → --patch`, later
 * wins — which is what makes a `disabled: true` row here able to switch off
 * something a bundle brought in.
 *
 * ⛔ Platform rows are counted, not listed. A clean `web` profile composes to
 * **129 entries, every one of them `@deepseek-ai/*`** — printing them would
 * bury the handful the person actually chose.
 * @param {string} home
 * @param {string} [profile]
 * @returns {CabinetInventory}
 */
export function cabinetInventory(home, profile = DEFAULT_PROFILE) {
  const files = {
    profilePatch: profilePatchFile(home, profile),
    homePatch: join(home, 'cordis.patch.yml'),
    profilePackage: profilePackageFile(home, profile),
  }
  /** @type {InventoryRow[]} */
  const rows = []
  for (const source of /** @type {const} */ (['profilePatch', 'homePatch'])) {
    const file = files[source]
    if (!existsSync(file)) continue
    const scan = scanPatch(readText(file))
    for (const item of scan.items) {
      if (item.kind === 'insert') {
        for (const entry of item.entries) {
          rows.push(row(source, file, 'insert', entry.id, entry.name, entry.start, null))
        }
        continue
      }
      // An override with no id cannot be applied by dsh either — it warns and
      // skips. Showing it as a plugin would invent one.
      if (item.id === null) continue
      rows.push(row(source, file, 'override', item.id, item.name, item.start, item.disabled))
    }
  }
  // ⭐ Bundles are opened rather than named. A bundle is a whole layer — dsh
  // reads the patch the package declares and applies all of it — so a list that
  // shows the package name and stops is showing one word where seventeen
  // plugins are. It is also the only way `disable` can work on them: the switch
  // is written against a row's `id`, and the ids are inside.
  // ⛔ Platform bundles are not opened. A clean `web` profile composes to 129
  // entries, every one `@deepseek-ai/*`; opening them would bury the handful
  // the person chose under the platform they did not.
  const profileDir = dirname(files.profilePackage)
  const bundles = bundleNames(files.profilePackage).map((name) => {
    const platform = name.startsWith(PLATFORM_PREFIX)
    return { name, platform, rows: platform ? [] : bundleRows(profileDir, name).rows }
  })
  const off = new Set(rows.filter((one) => one.disabled === true).map((one) => one.id))
  return {
    rows: rows.filter((one) => !one.platform),
    platform: rows.filter((one) => one.platform).length + bundles.filter((one) => one.platform).length,
    bundles: bundles.map((bundle) => ({
      ...bundle,
      // Whether a later layer has switched each row off. The YAML sits after the
      // bundle layers, so a `disabled: true` row there is exactly how upstream
      // switches off its own telemetry — and how this tool does it too.
      rows: bundle.rows.map((row) => ({ ...row, disabled: off.has(row.id) })),
    })),
    files,
  }
}

/**
 * @param {'profilePatch' | 'homePatch'} source
 * @param {string} file
 * @param {'insert' | 'override'} kind
 * @param {string | null} id
 * @param {string | null} name
 * @param {number} line
 * @param {boolean | null} disabled
 * @returns {InventoryRow}
 */
function row(source, file, kind, id, name, line, disabled) {
  const packageName = name ?? id ?? ''
  return {
    id, name, kind, source, file, line: line + 1, disabled,
    platform: packageName.startsWith(PLATFORM_PREFIX),
  }
}

/**
 * @typedef {object} InventoryRow
 * @property {string | null} id
 * @property {string | null} name - the package. Absent on an override that only
 * changes an existing row, which is legal: the id is the identity there.
 * @property {'insert' | 'override'} kind
 * @property {'profilePatch' | 'homePatch'} source
 * @property {string} file
 * @property {number} line - 1-based, so a person can go look.
 * @property {boolean | null} disabled
 * @property {boolean} platform
 */

/**
 * @typedef {object} CabinetInventory
 * @property {InventoryRow[]} rows - everything but the platform's own.
 * @property {number} platform - how many platform rows were folded away.
 * @property {{name: string, platform: boolean,
 * rows: {id: string, package: string, disabled: boolean}[]}[]} bundles - each
 * one opened, because a bundle is a layer rather than a row.
 * @property {{profilePatch: string, homePatch: string, profilePackage: string}} files
 */

/**
 * Who holds a package name in this workspace, asked *before* anything is written.
 *
 * ⭐ The order is the whole point. Linking is what destroys the evidence:
 * `linkPlugins` replaces whatever sits under that name without looking at it, so
 * a collision check that runs afterwards can only report a loss that has already
 * happened. That was the old shape — the workspace's own package was swapped out,
 * and *then* `mountPlugin` said "it was already there, skipped", a sentence whose
 * premise is that nothing was done. Nothing was recorded either, so `uninstall`
 * had nothing to undo. Asking here is the only place the answer can still change
 * what happens.
 *
 * "Is it the same folder?" is asked of the resolved path rather than of the name,
 * because pointing at a folder that is already linked from exactly there is
 * genuinely nothing to do, and refusing it would turn a no-op into an error.
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} options.home
 * @param {string} [options.profile]
 * @param {string} options.package - the package name being claimed.
 * @param {string} options.path - the folder that name should resolve to.
 * @returns {{verdict: 'free'|'ours'|'same'|'taken'|'unreadable', points: string|null,
 * linked?: boolean, slot: string, patchFile: string}} `linked` comes only with
 * `ours`, and says whether the link still lands where the row promises.
 */
export function claimOn({ layout, home, profile = DEFAULT_PROFILE, package: name, path }) {
  const current = cabinetPlugins(layout, home, profile)
  const slot = join(profileModules(home, profile), ...name.split('/'))
  const at = { slot, patchFile: current.patchFile }
  // An unreadable patch has to stop the install here rather than at the write,
  // for the same reason as everything else in this function: by the write, the
  // link has already replaced something.
  if (!current.readable) return { verdict: 'unreadable', points: null, ...at }
  if (current.ours.some((entry) => entry.package === name)) {
    // ⛔ `linked` matters here, it is not decoration. A caller that only learns
    // "it is ours" cannot tell an install that is complete from one whose row
    // survived but whose link did not, and that difference decides whether there
    // is anything left to do. Answering neither once let `plugins install` run
    // twice and append a second identical row to the patch — measured, and
    // visible in the window as the same plugin listed twice.
    //
    // The comparison is the one used for `same` below, kept here rather than in
    // the caller: where a link really lands, and whether the farm copy counts as
    // the same folder, is this file's question and should be asked in one place.
    const held = resolvedPath(slot)
    const asked = resolvedPath(path)
    return {
      verdict: 'ours',
      points: held,
      linked: held !== null && (held === asked || storeTwin(layout, held) === asked),
      ...at,
    }
  }
  const namedByThem = current.theirs.includes(name)
  const occupied = lstatSync(slot, { throwIfNoEntry: false }) !== undefined
  if (!namedByThem && !occupied) return { verdict: 'free', points: null, ...at }
  const points = resolvedPath(slot)
  const wanted = resolvedPath(path)
  if (points !== null && (points === wanted || storeTwin(layout, points) === wanted)) {
    // Resolving to the same folder only settles the *link*. It is installed
    // only if something also names it in the patch; otherwise what is there is
    // an orphan link dsh never loads, and there is still work to do.
    return { verdict: namedByThem ? 'same' : 'free', points, ...at }
  }
  return { verdict: 'taken', points, ...at }
}

/**
 * Where a path really lands, or null when it lands nowhere.
 *
 * A junction whose target is gone resolves to nothing, and that is an answer:
 * whatever it is, it is not the folder being installed, so the name is taken by
 * something this tool did not put there and must not replace.
 * @param {string} target
 * @returns {string | null}
 */
function resolvedPath(target) {
  try {
    return realpathSync(target)
  } catch {
    return null
  }
}

/**
 * The store original a farm entry mirrors, or null for anything else.
 *
 * A sandbox's junction for a downloaded plugin is re-aimed at the engine farm
 * on every launch (`engines.js`), so by the next install the slot resolves to
 * `engines/<key>/node_modules/<pkg>` while the folder being installed is
 * `packages/node_modules/<pkg>` — the same download at another address.
 * Without this translation, reinstalling after a ledger loss would be refused
 * as "taken by something else", which is a lie about our own hardlinks.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} real - an already-resolved path.
 * @returns {string | null}
 */
function storeTwin(layout, real) {
  const rel = relative(layout.engines, real)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  const parts = rel.split(sep)
  if (parts[1] !== 'node_modules') return null
  return resolvedPath(join(layout.packages, 'node_modules', ...parts.slice(2)))
}

/**
 * Add one plugin to a workspace, for good.
 *
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} options.home
 * @param {string} options.profile
 * @param {MountedPlugin} options.plugin
 * @param {MountedPlugin[]} [options.brings] - the other rows an aggregate
 * package carries. Written the same way and in the given order, each recorded
 * as having arrived `via` the package named above, so one `uninstall` takes the
 * family back out. Empty for an ordinary plugin, which is nearly all of them.
 * @param {string} options.backupDir - where the untouched original is kept.
 * @returns {{added: boolean, backup: string | null, patchFile: string}}
 */
export function mountPlugin({ layout, home, profile = DEFAULT_PROFILE, plugin, brings = [], backupDir }) {
  const patchFile = profilePatchFile(home, profile)
  return withCabinetLock(layout, home, () => {
    const current = cabinetPlugins(layout, home, profile)
    if (!current.readable) {
      throw new BoxError('UNREADABLE_PATCH', t('mounts.unreadablePatch', { file: patchFile }), { file: patchFile })
    }
    // Registering the same adapter twice makes dsh refuse to load the entire
    // plugin tree (DUPLICATE_ADAPTER, exit 1). Found the hard way on a real home.
    // ⭐ Every row is asked, not just the first: an aggregate brings sixteen more
    // names with it, and one of them colliding is the same failure.
    const arriving = brings.length === 0 ? [plugin] : brings
    const clash = arriving.find((one) => current.theirs.includes(one.package))
    if (clash !== undefined) {
      if (clash === plugin) return { added: false, backup: null, patchFile }
      throw new BoxError(
        'AGGREGATE_MEMBER_TAKEN',
        t('aggregate.memberTaken', { aggregate: plugin.package, member: clash.package }),
        { package: plugin.package, member: clash.package },
      )
    }
    const backup = backupFile(patchFile, backupDir)
    const record = readLedgerProfile(layout, home, profile)
    let { scan, entries, absorbedEmptyList, createdFile } = adoptLegacy(layout, home, profile, record)
    const replacing = new Set(arriving.map((one) => one.package))
    // Our own rows are found *after* the legacy fold, so the positions below are
    // against the file as it will be written.
    const mine = claimedRows(entries, scan).filter((found) => !replacing.has(found.plugin.package))
    // ⛔⛔ Out before anything is appended; see {@link EMPTY_LIST}.
    if (scan.emptyList !== null) {
      scan = cutLines(scan, [{ start: scan.emptyList, end: scan.emptyList }])
      absorbedEmptyList = true
    }
    const last = mine.at(-1)
    const row = last === undefined ? null : scan.items[last.item].entries[last.entry]
    const indent = row === null ? ROW_INDENT : ' '.repeat(row.indent)
    const rows = arriving.flatMap((one) => [
      `${indent}- id: ${JSON.stringify(one.id)}`,
      `${indent}  name: ${JSON.stringify(one.package)}`,
    ])
    // Beside the last row we already own when there is one, so a cabinet ends up
    // with one `- insert:` item rather than one per install; otherwise a fresh
    // item at the end of the file, which is the only place that cannot disturb
    // anything already in it.
    scan = row === null
      ? spliceLines(scan, scan.lines.length, ['- insert:', ...rows])
      : spliceLines(scan, row.end + 1, rows)
    writePatch(patchFile, scan)
    const at = instantNow()
    writeLedgerProfile(layout, home, profile, {
      absorbedEmptyList,
      createdFile,
      disabled: record.disabled,
      entries: [
        ...entries.filter((entry) => !replacing.has(entry.package)),
        ...arriving.map((one) => ({
          id: one.id,
          package: one.package,
          kind: one.kind,
          path: one.path ?? null,
          // ⭐ The aggregate's own row carries `via` pointing at itself, so the
          // rule for "did this come as part of a family" is one comparison
          // rather than two cases.
          via: brings.length === 0 ? null : plugin.package,
          at,
        })),
      ],
    })
    return { added: true, backup, patchFile }
  })
}

/**
 * Take one plugin back out.
 *
 * Removes exactly the row this tool wrote and nothing else — a plugin the
 * workspace had before we arrived is not ours to remove, and says so instead of
 * quietly doing it.
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} options.home
 * @param {string} options.profile
 * @param {string} options.id
 * @param {string} options.backupDir
 * @returns {{removed: MountedPlugin | null, alsoRemoved: MountedPlugin[],
 * backup: string | null, theirs: boolean}}
 */
export function unmountPlugin({ layout, home, profile = DEFAULT_PROFILE, id, backupDir }) {
  const patchFile = profilePatchFile(home, profile)
  return withCabinetLock(layout, home, () => {
    const current = cabinetPlugins(layout, home, profile)
    const group = familyOf(current.ours, id)
    const going = group[0]
    if (going === undefined) {
      // ⭐ Two different nothings, and the caller says different things about
      // them: a row somebody else wrote, or no such row at all. A cabinet whose
      // ledger has been lost lands in the first, which is the honest answer —
      // the row is there and we can no longer show it was ours.
      return { removed: null, alsoRemoved: [], backup: null, theirs: current.theirs.includes(id) }
    }
    const backup = backupFile(patchFile, backupDir)
    const record = readLedgerProfile(layout, home, profile)
    let { scan, entries, absorbedEmptyList, createdFile } = adoptLegacy(layout, home, profile, record)
    const leaving = new Set(group.map((one) => one.id))
    // ⛔ Every span at once, and `cutLines` removes them back to front for
    // exactly this reason: taking out the first row would move all the others.
    // Seventeen rows is where a one-at-a-time loop stops being survivable.
    const spans = []
    for (const found of claimedRows(entries, scan).filter((one) => leaving.has(one.plugin.id))) {
      const item = scan.items[found.item]
      // Taking every row out of an item leaves `- insert:` with nothing under
      // it, which dsh reads as an insert of nothing. The item goes with them —
      // but only when the item is entirely ours, which for an item we created is
      // the same thing.
      if (item.entries.every((row) => leaving.has(row.id)) && ownsWholeItem(scan, item, found.item, entries)) {
        spans.push({ start: item.start, end: item.end })
        continue
      }
      const row = item.entries[found.entry]
      spans.push({ start: row.start, end: row.end })
    }
    if (spans.length > 0) scan = cutLines(scan, dedupe(spans))
    const left = entries.filter((entry) => !leaving.has(entry.id))
    // ⛔ The last row leaving has to put the file back exactly as it was before
    // the first one arrived. Measured on a real `~/.dsh`: an earlier version
    // left one extra blank line — invisible to a person, visible in their
    // `git diff`, and enough to make "it goes back to how it was" untrue.
    const done = left.length === 0 && record.disabled.length === 0
    if (done && absorbedEmptyList) {
      scan = spliceLines(scan, scan.lines.length, [EMPTY_LIST])
      absorbedEmptyList = false
    }
    writePatch(patchFile, scan, done && createdFile)
    writeLedgerProfile(layout, home, profile, {
      absorbedEmptyList, createdFile, entries: left, disabled: record.disabled,
    })
    // The link goes with the row. Leaving it would be a folder resolvable by a
    // name nothing loads — harmless today, and exactly the kind of leftover that
    // makes the next question ("is this plugin installed?") unanswerable.
    for (const one of group) {
      if (one.kind !== 'link') continue
      try {
        removeTree(join(profileModules(home, profile), ...one.package.split('/')))
        pruneScopeDir(home, profile, one.package)
      } catch {
        // A link that will not go away is worth less than the removal succeeding.
      }
    }
    return { removed: going, alsoRemoved: group.slice(1), backup, theirs: false }
  })
}

/**
 * Switch one row off, or back on, wherever in the cabinet it came from.
 *
 * ⭐⭐ **This is the only way to take out something we did not put in.** The
 * patch format has no `remove`: a row in a layer below can be overridden but
 * never deleted, and `disabled: true` in a later layer is what "remove" is
 * spelled as. The profile patch sits after every bundle layer, so a switch
 * written here reaches a row a bundle brought in — which is exactly how
 * upstream switches off its own telemetry.
 *
 * ⭐ It is what makes the tool usable for the job it was restarted for (CEO
 * 2026-08-23): finding a plugin conflict in the daily cabinet and *doing
 * something about it* rather than sending an agent back to `bash`. Most of what
 * conflicts there was never installed by us.
 *
 * ⛔ Ours to take back out only if we wrote it. A row somebody else disabled is
 * their decision, and switching it back on would be us overruling them silently.
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} options.home
 * @param {string} [options.profile]
 * @param {string} options.id - the row's id, from any of the three places.
 * @param {boolean} options.off
 * @param {string | null} options.backupDir
 * @returns {{changed: boolean, already: boolean, theirs: boolean, backup: string | null, patchFile: string}}
 */
export function setDisabled({ layout, home, profile = DEFAULT_PROFILE, id, off, backupDir }) {
  const patchFile = profilePatchFile(home, profile)
  return withCabinetLock(layout, home, () => {
    const text = readText(patchFile)
    if (!isReadable(patchFile, text)) {
      throw new BoxError('UNREADABLE_PATCH', t('mounts.unreadablePatch', { file: patchFile }), { file: patchFile })
    }
    const record = readLedgerProfile(layout, home, profile)
    const ours = record.disabled.includes(id)
    let scan = scanPatch(text)
    const mine = scan.items.find((item) => item.kind !== 'insert' && item.id === id && item.disabled === true)
    if (off) {
      if (mine !== undefined) return { changed: false, already: true, theirs: !ours, backup: null, patchFile }
      const backup = backupFile(patchFile, backupDir)
      const adopted = adoptLegacy(layout, home, profile, record)
      scan = adopted.scan
      let absorbed = adopted.absorbedEmptyList
      if (scan.emptyList !== null) {
        scan = cutLines(scan, [{ start: scan.emptyList, end: scan.emptyList }])
        absorbed = true
      }
      // ⛔ Its own item at the end of the file, never folded into the `- insert:`
      // we maintain: this is an override, not an insert, and the two are
      // different shapes at the top level of the document.
      scan = spliceLines(scan, scan.lines.length, [`- id: ${JSON.stringify(id)}`, '  disabled: true'])
      writePatch(patchFile, scan)
      writeLedgerProfile(layout, home, profile, {
        absorbedEmptyList: absorbed,
        createdFile: adopted.createdFile,
        entries: adopted.entries,
        disabled: [...record.disabled, id],
      })
      return { changed: true, already: false, theirs: false, backup, patchFile }
    }
    if (mine === undefined) return { changed: false, already: true, theirs: false, backup: null, patchFile }
    if (!ours) return { changed: false, already: false, theirs: true, backup: null, patchFile }
    const backup = backupFile(patchFile, backupDir)
    const adopted = adoptLegacy(layout, home, profile, record)
    scan = adopted.scan
    const row = scan.items.find((item) => item.kind !== 'insert' && item.id === id && item.disabled === true)
    if (row !== undefined) scan = cutLines(scan, [{ start: row.start, end: row.end }])
    let absorbed = adopted.absorbedEmptyList
    const left = record.disabled.filter((one) => one !== id)
    const done = left.length === 0 && adopted.entries.length === 0
    if (done && absorbed) {
      scan = spliceLines(scan, scan.lines.length, [EMPTY_LIST])
      absorbed = false
    }
    writePatch(patchFile, scan, done && adopted.createdFile)
    writeLedgerProfile(layout, home, profile, {
      absorbedEmptyList: absorbed, createdFile: adopted.createdFile, entries: adopted.entries, disabled: left,
    })
    return { changed: true, already: false, theirs: false, backup, patchFile }
  })
}

/**
 * Take a package out of the profile's bundle list, for real.
 *
 * ⛔⛔ **Two places, and removing only one is not durable.** dsh's own
 * `reconcilePlugins` (`<dsh>/lib/plugin-*.js`) walks `dependencies` after every
 * `dsh plugin` command and pushes back anything that is still a dependency and
 * still declares `dsh.bundle` — so a package taken out of `dsh.profile.bundles`
 * alone comes back the next time that command runs, and the person is left
 * believing they removed something. Both go, or it says so.
 *
 * ⛔ **Not by running pnpm on upstream's behalf** (CEO). `dsh plugin` is a thin
 * pnpm forwarder, and "the only thing you need is Node 20+" is one of the few
 * things this tool can claim over the alternatives. So the package's files stay
 * in the profile's `node_modules` — declared by nothing, loaded by nothing, and
 * said out loud rather than left as a surprise.
 *
 * ⚠️ This is the only file outside the patch this tool has ever written. It is
 * backed up first, and JSON has no comments, so who removed what can only be
 * recorded in the ledger.
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} options.home
 * @param {string} [options.profile]
 * @param {string} options.name - the package named in `dsh.profile.bundles`.
 * @param {string | null} options.backupDir
 * @returns {{removed: boolean, fromBundles: boolean, fromDependencies: boolean,
 * stillADependency: boolean, filesLeft: string | null, backup: string | null, file: string}}
 */
export function removeBundle({ layout, home, profile = DEFAULT_PROFILE, name, backupDir }) {
  const file = profilePackageFile(home, profile)
  return withCabinetLock(layout, home, () => {
    const text = readText(file)
    let manifest
    try {
      manifest = JSON.parse(text)
    } catch {
      throw new BoxError('UNREADABLE_PROFILE_PACKAGE', t('bundles.unreadable', { file }), { file })
    }
    const bundles = manifest?.dsh?.profile?.bundles
    const fromBundles = Array.isArray(bundles) && bundles.includes(name)
    const fromDependencies = typeof manifest?.dependencies?.[name] === 'string'
    if (!fromBundles && !fromDependencies) {
      return {
        removed: false,
        fromBundles: false,
        fromDependencies: false,
        stillADependency: false,
        filesLeft: null,
        backup: null,
        file,
      }
    }
    const backup = backupFile(file, backupDir)
    if (fromBundles) manifest.dsh.profile.bundles = bundles.filter((one) => one !== name)
    if (fromDependencies) delete manifest.dependencies[name]
    // The file's own indentation, not ours. It is dsh's file and a person may
    // have edited it; reformatting somebody else's JSON is the same discourtesy
    // as reformatting their YAML, which cost a whole knife to stop doing.
    writeFileSync(file, `${JSON.stringify(manifest, null, indentOf(text))}\n`)
    const left = join(profileModules(home, profile), ...name.split('/'))
    return {
      removed: true,
      fromBundles,
      fromDependencies,
      // ⛔ False now by construction — kept as a field because the day upstream
      // changes how it reconciles, this is the answer that has to change with it.
      stillADependency: typeof manifest?.dependencies?.[name] === 'string',
      filesLeft: existsSync(left) ? left : null,
      backup,
      file,
    }
  })
}

/**
 * How many spaces one JSON file indents by, so it can be written back the same.
 * @param {string} text
 * @returns {number | string}
 */
function indentOf(text) {
  const first = /\n([ \t]+)"/.exec(text)
  if (first === null) return 2
  return first[1].includes('\t') ? '\t' : first[1].length
}

/**
 * Take away the `@scope` folder a link needed, once nothing is in it.
 *
 * ⛔ Only when it is empty, and never for an unscoped package. The folder is
 * created by us on the way in (`linkPlugins` makes the parent), so leaving it
 * behind on the way out is litter with no command to clean it — the same
 * complaint that produced `packages prune`. Measured on the real thing:
 * installing `@linxin666/dsh-web-ui-all` from npm and removing it left
 * `@linxin666/` and `@mlgbnb/` sitting empty in the profile.
 *
 * ⚠️ `readdirSync` failing is the answer "somebody else's folder, or gone" —
 * either way, not ours to remove.
 * @param {string} home
 * @param {string} profile
 * @param {string} name
 */
function pruneScopeDir(home, profile, name) {
  if (!name.startsWith('@') || !name.includes('/')) return
  const scope = join(profileModules(home, profile), name.split('/')[0])
  try {
    if (readdirSync(scope).length === 0) removeTree(scope)
  } catch {
    // Not there, or not readable. Both mean there is nothing for us to do.
  }
}

/**
 * What one name takes with it.
 *
 * ⭐ Naming an aggregate takes the family; naming one member takes that member.
 * Both are wanted: a person who installed seventeen plugins with one command
 * should be able to remove them with one, and a person who wants sixteen of
 * them should be able to drop the seventeenth without giving up the rest.
 *
 * The aggregate's own row carries `via` pointing at itself, so "is this the
 * aggregate" is one comparison rather than a second field.
 * @param {MountedPlugin[]} ours
 * @param {string} id - an id or a package name.
 * @returns {MountedPlugin[]} the principal first, then the rest of its family.
 */
function familyOf(ours, id) {
  const named = ours.find((entry) => entry.id === id || entry.package === id)
  // An aggregate named by a package that has no row of its own in its own patch.
  if (named === undefined) return ours.filter((entry) => entry.via === id)
  if (named.via === null || named.via !== named.package) return [named]
  return [named, ...ours.filter((entry) => entry !== named && entry.via === named.via)]
}

/**
 * Drop spans that name the same lines twice.
 *
 * ⛔ Every row of an item resolves to that item's own span, so removing a whole
 * family produces one duplicate per member — and `cutLines` splices, so a
 * duplicate would take a second, innocent chunk of the file with it.
 * @param {{start: number, end: number}[]} spans
 */
function dedupe(spans) {
  const seen = new Set()
  return spans.filter((span) => {
    const key = `${span.start}:${span.end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Whether every row of one item is ours, so the item itself can go with them.
 * @param {import('./patch-file.js').ScannedPatch} scan
 * @param {import('./patch-file.js').PatchItem} item
 * @param {number} itemIndex
 * @param {import('./cabinet-ledger.js').LedgerEntry[]} entries
 */
function ownsWholeItem(scan, item, itemIndex, entries) {
  return item.kind === 'insert'
    && item.entries.every((row) => entries.some((entry) => entry.id === row.id && entry.package === row.name))
    // ⛔ And the item must have nothing else on it. An `- insert:` that also
    // carries an `id:` is somebody's group, and cutting it would take their
    // configuration with our row.
    && item.id === null && item.name === null
    && scan.items[itemIndex] === item
}

/**
 * Fold anything a previous version wrote into the file into the ledger, and take
 * its comments out.
 *
 * ⛔ Not compatibility — cleanup. `v0.3.0` and earlier wrapped their rows in
 * `# >>> dsh-box` markers and hung a `# dsh-box: link <path>` note under each.
 * Those rows are perfectly good rows; only the decoration has to go, and the
 * facts it carried have to land in the ledger before it does. Called from both
 * write paths so a cabinet is cleaned by the first change made to it, and never
 * by a read.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @param {string} profile
 * @param {import('./cabinet-ledger.js').LedgerProfile} record
 * @returns {{scan: import('./patch-file.js').ScannedPatch,
 * entries: import('./cabinet-ledger.js').LedgerEntry[], absorbedEmptyList: boolean}}
 */
function adoptLegacy(layout, home, profile, record) {
  const file = profilePatchFile(home, profile)
  const text = readText(file)
  const scan = text === '' ? { ...scanPatch(text), endsWithNewline: true } : scanPatch(text)
  // ⛔⛔ Whether this cabinet had a patch at all. A file we made has to go away
  // again with our last row: dsh refuses an empty patch outright, so leaving one
  // behind is a cabinet that can never boot. See `createdFile` in the ledger.
  const createdFile = record.createdFile || !existsSync(file)
  const marks = legacyMarks(scan)
  if (marks === null) {
    return { scan, entries: record.entries, absorbedEmptyList: record.absorbedEmptyList, createdFile }
  }
  const known = new Set(record.entries.map((entry) => entry.id))
  const at = instantNow()
  return {
    scan: cutLines(scan, marks.cuts),
    entries: [...record.entries, ...legacyEntries(scan).filter((entry) => !known.has(entry.id)).map((entry) => ({ ...entry, at }))],
    absorbedEmptyList: record.absorbedEmptyList || marks.absorbedEmptyList,
    createdFile,
  }
}

/**
 * Where a legacy block's comment lines are, or null when there is no block.
 * @param {import('./patch-file.js').ScannedPatch} scan
 * @returns {{cuts: {start: number, end: number}[], absorbedEmptyList: boolean} | null}
 */
function legacyMarks(scan) {
  const start = scan.lines.indexOf(LEGACY_START)
  if (start === -1) return null
  const end = scan.lines.indexOf(LEGACY_END, start)
  if (end === -1) return null
  const cuts = [{ start, end: start }, { start: end, end }]
  let absorbedEmptyList = false
  for (let index = start + 1; index < end; index += 1) {
    if (LEGACY_EMPTY_LIST.test(scan.lines[index])) {
      absorbedEmptyList = true
      cuts.push({ start: index, end: index })
      continue
    }
    if (LEGACY_NOTE.test(scan.lines[index])) cuts.push({ start: index, end: index })
  }
  // The blank line the old writer put between the file and its block goes too,
  // or removing the last plugin would leave one behind — the exact leftover the
  // byte-for-byte check exists to catch.
  if (start > 0 && scan.lines[start - 1].trim() === '') cuts.push({ start: start - 1, end: start - 1 })
  return { cuts, absorbedEmptyList }
}

/**
 * Rows a legacy block claims, read out of the file itself.
 * @param {import('./patch-file.js').ScannedPatch} scan
 * @returns {MountedPlugin[]}
 */
function legacyEntries(scan) {
  const start = scan.lines.indexOf(LEGACY_START)
  if (start === -1) return []
  const end = scan.lines.indexOf(LEGACY_END, start)
  if (end === -1) return []
  const found = []
  for (const item of scan.items) {
    if (item.start < start || item.end > end) continue
    for (const row of item.entries) {
      if (row.id === null) continue
      const note = LEGACY_NOTE.exec(scan.lines[row.end] ?? '') ?? LEGACY_NOTE.exec(scan.lines[row.end + 1] ?? '')
      found.push({
        id: row.id,
        package: row.name ?? row.id,
        kind: /** @type {'link' | 'package'} */ (note?.[1] ?? 'link'),
        path: note?.[2] ?? null,
        // Those versions could not install an aggregate at all, so nothing they
        // wrote was ever part of a family.
        via: null,
      })
    }
  }
  return found
}

/**
 * Put an edited scan back on disk — or take the file away, if it is one we made
 * and there is nothing left in it.
 *
 * ⛔⛔ The second half is not tidiness. dsh refuses an empty patch file (*must
 * be a top-level YAML array of loader patch entries*) and refuses a file holding
 * only a newline; **no file at all it accepts**. Measured against 0.1.0-rc.7, by
 * `tools/check-real-dsh.mjs`, on its first run. Before that, installing one
 * plugin into a fresh cabinet and then removing it left a cabinet that could
 * never boot — the same shape as the `[]` defect from the previous round, at the
 * other end, and **370 acceptance items missed it** because not one of them ever
 * handed the file to a real dsh.
 * @param {string} file
 * @param {import('./patch-file.js').ScannedPatch} scan
 * @param {boolean} [oursToRemove] - whether we are the ones who created it.
 */
function writePatch(file, scan, oursToRemove = false) {
  if (oursToRemove && scan.items.length === 0 && scan.emptyList === null
    && scan.lines.every((line) => line.trim() === '')) {
    removeTree(file)
    return
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, renderPatch(scan))
}

/** How many snapshots one workspace keeps. */
export const KEEP_BACKUPS = 5

/**
 * Copy a file somewhere safe before changing it.
 *
 * The backup is the answer to the case the precise removal cannot cover: a file
 * edited into a shape this tool no longer recognises, where removing "exactly
 * what we wrote" finds nothing to remove. It is kept in this tool's own data
 * directory rather than beside the original — scattering `.bak` files through
 * somebody's home is the coupling this tool exists to avoid.
 *
 * ⭐ **Only the daily workspace gets one** (CEO 2026-08-22): a sandbox is a
 * clean start you throw away, so a snapshot of one protects nothing that was
 * worth protecting. Callers say so by passing `null` — the decision belongs
 * where main and sandbox are told apart, not here.
 * @param {string} file
 * @param {string | null} backupDir - where to keep it, or null for "do not".
 * @returns {string | null}
 */
export function backupFile(file, backupDir) {
  if (backupDir === null || !existsSync(file)) return null
  // ⛔ Local and already legible, because this name **is** the display: it is
  // what `plugins backups` lists and what `plugins restore --at` is given, so a
  // form needing conversion before it can be read is a form nobody can type.
  // Milliseconds stay — two backups inside one second would otherwise merge into
  // one directory and lose the older. No offset: a name is a label, not a stored
  // instant, and `listBackups` sorts these as strings.
  const stamp = `${stampNow()}-${String(new Date().getMilliseconds()).padStart(3, '0')}`
  const dir = join(backupDir, stamp)
  mkdirSync(dir, { recursive: true })
  // ⛔ Named after what it is a copy of. There are two files now — the patch and,
  // since bundles became removable, the profile's `package.json` — and
  // `listBackups`/`restoreBackup` have always looked for both by name. A fixed
  // filename here would have quietly restored one file's contents into the
  // other's place.
  const target = join(dir, basename(file))
  copyFileSync(file, target)
  pruneBackups(backupDir)
  return target
}

/**
 * Drop all but the newest few.
 *
 * ⚠️ Added because half this tool's own leavings tidied themselves and half only
 * ever grew, and that split was written down nowhere: logs rotate at twenty per
 * sandbox, while snapshots had no ceiling and no way to remove one. A tool where
 * some things are cleaned automatically and others never is a tool nobody can
 * predict the disk usage of.
 * @param {string} backupDir
 * @param {number} [keep]
 * @returns {string[]} what was removed.
 */
export function pruneBackups(backupDir, keep = KEEP_BACKUPS) {
  const going = listBackups(backupDir).slice(keep)
  for (const entry of going) removeTree(entry.dir)
  return going.map((entry) => entry.at)
}

/**
 * Remove one snapshot by its timestamp.
 * @param {string} backupDir
 * @param {string} at
 * @returns {boolean} whether there was one to remove.
 */
export function removeBackup(backupDir, at) {
  const going = listBackups(backupDir).find((entry) => entry.at === at)
  if (going === undefined) return false
  removeTree(going.dir)
  return true
}

/**
 * Every backup taken for one workspace, newest first.
 * @param {string} backupDir
 * @returns {{at: string, dir: string, file: string}[]}
 */
export function listBackups(backupDir) {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .map((entry) => ({
      at: entry,
      dir: join(backupDir, entry),
      // A moment in time can have touched either file or both, because the two
      // routes a plugin arrives by write different ones. Whichever were copied
      // are what goes back.
      files: ['cordis.patch.yml', 'package.json'].filter((name) => existsSync(join(backupDir, entry, name))),
    }))
    .filter((entry) => entry.files.length > 0)
    .sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Put one back, whole.
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.profile
 * @param {string} options.backupDir
 * @param {string} [options.at] - which one; the newest when not said.
 * @returns {{restored: string, from: string, backup: string | null}}
 */
export function restoreBackup({ home, profile = DEFAULT_PROFILE, backupDir, at }) {
  const backups = listBackups(backupDir)
  const wanted = at === undefined ? backups[0] : backups.find((entry) => entry.at === at)
  if (wanted === undefined) {
    throw new BoxError(
      'NO_BACKUP',
      backups.length === 0
        ? t('backup.none')
        : t('backup.noSuch', { at, list: backups.map((entry) => entry.at).join('、') }),
      { backups: backups.map((entry) => entry.at) },
    )
  }
  const targets = {
    'cordis.patch.yml': profilePatchFile(home, profile),
    'package.json': profilePackageFile(home, profile),
  }
  // Backing up the current state before overwriting it: restoring is itself a
  // change, and a restore to the wrong timestamp must not be the end of the road.
  const backup = backupFile(targets['cordis.patch.yml'], backupDir)
  const restored = []
  for (const name of wanted.files) {
    mkdirSync(dirname(targets[name]), { recursive: true })
    copyFileSync(join(wanted.dir, name), targets[name])
    restored.push(targets[name])
  }
  return { restored, from: wanted.at, backup }
}

/**
 * Whether this file can be changed safely.
 *
 * ⛔ Only one thing makes it false, and it is not "we do not understand the
 * YAML" — the scanner carries anything it does not understand through
 * untouched, so not understanding is the normal case and never dangerous. What
 * is dangerous is a **legacy block with an opening marker and no closing one**:
 * somebody edited into the middle of a block a previous version wrote, and
 * guessing where it should have ended would take lines that are not ours. So
 * nothing is written to that cabinet until a person has looked.
 * @param {string} file
 * @param {string} text
 * @returns {boolean}
 */
function isReadable(file, text) {
  if (text === '' && existsSync(file)) {
    // Empty and existing are different things, and `readText` cannot tell them
    // apart. It only matters when the read itself failed — a file that is
    // genuinely empty is fine.
    try {
      readFileSync(file, 'utf8')
    } catch {
      return false
    }
  }
  const start = text.indexOf(LEGACY_START)
  return start === -1 || text.indexOf(LEGACY_END, start) !== -1
}

/**
 * Package names named anywhere in a patch text.
 *
 * ⚠️ A text scan, not a parse. It can name something that is only mentioned in
 * a comment, and can miss a form it has not seen. Both are acceptable here
 * because this list is shown to a person and used to avoid adding a duplicate —
 * never to decide what to delete.
 * @param {string} text
 * @returns {string[]}
 */
function namesIn(text) {
  return [...text.matchAll(/^\s*(?:-\s*)?name:\s*(.+?)\s*$/gm)]
    .map((match) => unquote(match[1]))
    .filter((name) => name !== '' && !name.startsWith('#'))
}

/**
 * The bundle list.
 *
 * ⛔ **Nothing is ever added here**, and the reason is worth keeping. Registering
 * a package as a bundle is what dsh's own `plugin add` does, and it would have
 * been the natural home for anything fetched from npm — but doing that requires
 * running a package manager inside the profile, and **measured on a real
 * `~/.dsh`**, a profile dsh's tooling has touched holds `link:` dependencies,
 * a pnpm protocol npm refuses outright. So npm-fetched plugins are kept in this
 * tool's own tree and linked in like any folder.
 *
 * ⚠️ Removing from it is a different question and the answer changed (CEO
 * 2026-08-23): a box that is supposed to fix a plugin conflict has to be able to
 * take one out, whoever put it there. See {@link removeBundle}.
 * @param {string} file
 * @returns {string[]}
 */
export function bundleNames(file) {
  const text = readText(file)
  if (text === '') return []
  try {
    const bundles = JSON.parse(text)?.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((name) => typeof name === 'string') : []
  } catch {
    return []
  }
}

/** @param {string} file */
function readText(file) {
  if (!existsSync(file)) return ''
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** @param {string} value */
function unquote(value) {
  const text = value.trim()
  if (text.length > 1 && (text.startsWith('"') || text.startsWith("'"))) {
    try {
      return JSON.parse(text.replaceAll("'", '"'))
    } catch {
      return text.slice(1, -1)
    }
  }
  return text
}
