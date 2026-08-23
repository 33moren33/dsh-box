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
 * ⭐ **Which entries are ours is written in the file, not remembered in a
 * ledger of our own.** Our entries live between two marker comments and nothing
 * outside them is ever touched. A separate ledger would be a second copy of the
 * same fact, and the two would drift the first time somebody edited the file —
 * whereas markers cannot: if the block is gone, we added nothing; if an entry
 * is in it, we added that entry. Taking a plugin away therefore means removing
 * exactly what we put in, never "everything that looks like a plugin".
 *
 * ⚠️ The parse of everything *outside* our block is best-effort by design. dsh's
 * patch format is not ours and a full YAML reader would be a dependency; what is
 * wanted there is only "name the plugins this home already had so the person can
 * see them and we can avoid adding a duplicate", and a name that is missed shows
 * up as an unlisted plugin rather than as a wrong action. Where the file cannot
 * be read at all, that is reported rather than treated as an empty file.
 */

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { BoxError } from './errors.js'
import { t } from './messages.js'

/** The profile every launch uses. dsh's own default, and the only one offered. */
export const DEFAULT_PROFILE = 'web'

/**
 * Opens the block of entries this tool maintains.
 *
 * ⛔ English in both languages, and never translated — this is a landmark in
 * somebody else's file, not a sentence to them. A marker that follows the
 * interface language would orphan every block ever written the moment a user
 * switches: we would go looking for the phrase we say today and not find the
 * one we said yesterday, and `uninstall` would answer "we never wrote that".
 * Fixed here rather than later because this block first shipped in the same
 * unreleased round, so today it costs nothing and after a release it costs a
 * compatibility branch forever.
 */
const BLOCK_START = '# >>> dsh-box: maintained automatically, rewritten whenever plugins change'

/** Closes it. */
const BLOCK_END = '# <<< dsh-box: end'

/** What dsh puts in a brand-new profile patch: an empty list, and a whole document. */
const EMPTY_LIST = '[]'

/** {@link EMPTY_LIST} as the file's last line, which is the only place it blocks us. */
const EMPTY_LIST_AT_END = /(?:^|\n)[ \t]*\[\][ \t]*$/

/**
 * Written inside our block to record that {@link EMPTY_LIST} is being held.
 *
 * Kept in the same `# dsh-box: <ascii word>` shape as the per-entry notes so
 * that a translation of this tool cannot change what an existing file means.
 */
const ABSORBED_EMPTY_LIST = '# dsh-box: empty-list'

/**
 * @typedef {object} MountedPlugin
 * @property {string} id - the id the patch entry is keyed by.
 * @property {string} package - the package name dsh resolves.
 * @property {'link' | 'package'} kind - a folder linked in, or a package installed here.
 * @property {string | null} path - where the folder is, for linked ones.
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
 * @param {string} home
 * @param {string} [profile]
 * @returns {CabinetPlugins}
 */
export function cabinetPlugins(home, profile = DEFAULT_PROFILE) {
  const patchFile = profilePatchFile(home, profile)
  const { block, rest, readable } = splitPatch(patchFile)
  const theirs = new Set(namesIn(rest))
  // The machine-wide patch is the other place a home can name a plugin, and
  // this tool never writes it, so everything found there is the workspace's own.
  for (const name of namesIn(readText(join(home, 'cordis.patch.yml')))) theirs.add(name)
  // The bundle list is the third place, and this tool only ever reads it. That
  // is dsh's own tooling's file: `dsh plugin add` writes there, and so does
  // whatever the user has done by hand. Everything in it is theirs.
  for (const name of bundleNames(profilePackageFile(home, profile))) theirs.add(name)
  const ours = entriesIn(block, home, profile)
  // A package cannot be in both columns. If it somehow is, ours wins: we know
  // exactly what we wrote, and the other reading is a guess from a text search.
  for (const plugin of ours) theirs.delete(plugin.package)
  const platform = [...theirs].filter((name) => name.startsWith(PLATFORM_PREFIX)).sort()
  for (const name of platform) theirs.delete(name)
  return { ours, theirs: [...theirs].sort(), platform, readable, patchFile }
}

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
 * @param {string} options.home
 * @param {string} [options.profile]
 * @param {string} options.package - the package name being claimed.
 * @param {string} options.path - the folder that name should resolve to.
 * @returns {{verdict: 'free'|'ours'|'same'|'taken'|'unreadable', points: string|null,
 * slot: string, patchFile: string}}
 */
export function claimOn({ home, profile = DEFAULT_PROFILE, package: name, path }) {
  const current = cabinetPlugins(home, profile)
  const slot = join(profileModules(home, profile), ...name.split('/'))
  const at = { slot, patchFile: current.patchFile }
  // An unreadable patch has to stop the install here rather than at the write,
  // for the same reason as everything else in this function: by the write, the
  // link has already replaced something.
  if (!current.readable) return { verdict: 'unreadable', points: null, ...at }
  if (current.ours.some((entry) => entry.package === name)) {
    return { verdict: 'ours', points: null, ...at }
  }
  const namedByThem = current.theirs.includes(name)
  const occupied = lstatSync(slot, { throwIfNoEntry: false }) !== undefined
  if (!namedByThem && !occupied) return { verdict: 'free', points: null, ...at }
  const points = resolvedPath(slot)
  const wanted = resolvedPath(path)
  if (points !== null && points === wanted) {
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
 * Add one plugin to a workspace, for good.
 *
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.profile
 * @param {MountedPlugin} options.plugin
 * @param {string} options.backupDir - where the untouched original is kept.
 * @returns {{added: boolean, backup: string | null, patchFile: string}}
 */
export function mountPlugin({ home, profile = DEFAULT_PROFILE, plugin, backupDir }) {
  const current = cabinetPlugins(home, profile)
  if (!current.readable) {
    throw new BoxError(
      'UNREADABLE_PATCH',
      t('mounts.unreadablePatch', { file: current.patchFile }),
      { file: current.patchFile },
    )
  }
  // Registering the same adapter twice makes dsh refuse to load the entire
  // plugin tree (DUPLICATE_ADAPTER, exit 1). Found the hard way on a real home.
  if (current.theirs.includes(plugin.package)) {
    return { added: false, backup: null, patchFile: current.patchFile }
  }
  const kept = current.ours.filter((entry) => entry.package !== plugin.package)
  const backup = writeOurBlock({ home, profile, entries: [...kept, plugin], backupDir })
  return { added: true, backup, patchFile: current.patchFile }
}

/**
 * Take one plugin back out.
 *
 * Removes exactly the entry this tool wrote and nothing else — a plugin the
 * workspace had before we arrived is not ours to remove, and says so instead of
 * quietly doing it.
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.profile
 * @param {string} options.id
 * @param {string} options.backupDir
 * @returns {{removed: MountedPlugin | null, backup: string | null, theirs: boolean}}
 */
export function unmountPlugin({ home, profile = DEFAULT_PROFILE, id, backupDir }) {
  const current = cabinetPlugins(home, profile)
  const going = current.ours.find((entry) => entry.id === id || entry.package === id)
  if (going === undefined) {
    return { removed: null, backup: null, theirs: current.theirs.includes(id) }
  }
  const kept = current.ours.filter((entry) => entry !== going)
  const backup = writeOurBlock({ home, profile, entries: kept, backupDir })
  // The link goes with the entry. Leaving it would be a folder resolvable by a
  // name nothing loads — harmless today, and exactly the kind of leftover that
  // makes the next question ("is this plugin installed?") unanswerable.
  if (going.kind === 'link') {
    try {
      rmSync(join(profileModules(home, profile), ...going.package.split('/')), { recursive: true, force: true })
    } catch {
      // A link that will not go away is worth less than the removal succeeding.
    }
  }
  return { removed: going, backup, theirs: false }
}

/**
 * Rewrite our block, keeping every line outside it byte for byte — with one
 * named exception, {@link EMPTY_LIST}, which is given back when we leave.
 * @returns {string | null} the backup taken first, or null when there was no
 * file to back up.
 */
function writeOurBlock({ home, profile, entries, backupDir }) {
  const file = profilePatchFile(home, profile)
  const backup = backupFile(file, backupDir)
  const { block: had, rest } = splitPatch(file)
  let before = rest.trimEnd()
  mkdirSync(dirname(file), { recursive: true })
  // ⚠️ Only the note says we are holding it. "The file has an empty list" and
  // "we took the empty list out" are different facts, and an earlier version of
  // this function read the first where it meant the second — so removing the
  // last plugin from a file that still had its own `[]` handed back a second
  // one. Give back only what the note says we took.
  const held = had.includes(ABSORBED_EMPTY_LIST)
  // ⛔ Taking the last entry away has to leave the file exactly as it was before
  // the first one went in. Measured on a real `~/.dsh`: an earlier version left
  // one extra blank line — invisible to a person, visible in their `git diff`,
  // and enough to make "it goes back to how it was" quietly untrue.
  if (entries.length === 0) {
    if (held) before = before === '' ? EMPTY_LIST : `${before}\n${EMPTY_LIST}`
    writeFileSync(file, before === '' ? '' : `${before}\n`)
    return backup
  }
  const absorbed = held || EMPTY_LIST_AT_END.test(before)
  // ⛔⛔ The one thing outside our block that has to move, and the reason is
  // that it is not a line — it is the end of the document. dsh writes a new
  // profile patch as three comments and `[]`, which is a complete YAML value;
  // anything appended after it is a second document, and dsh refuses to parse
  // the file at all. Measured: a brand-new sandbox plus any one plugin, on
  // both Windows and Linux, and the sandbox could never boot again. Appending
  // was safe against every file we had tried — a hand-written one, a
  // pre-populated one, an empty one — and wrong against the only one a new
  // user actually gets.
  //
  // So it comes out, and a note in our block records that we hold it. Removing
  // our last entry puts it back in the same place, which keeps the byte-exact
  // promise the file-level tests check.
  if (absorbed) before = before.replace(EMPTY_LIST_AT_END, '').trimEnd()
  const lines = [BLOCK_START]
  if (absorbed) lines.push(ABSORBED_EMPTY_LIST)
  lines.push('- insert:')
  for (const entry of entries) {
    lines.push(`    - id: ${JSON.stringify(entry.id)}`)
    lines.push(`      name: ${JSON.stringify(entry.package)}`)
    // A comment because it is ours to remember, not dsh's to read: it says
    // whether the name resolves through a link we made or a package installed
    // here, which is what taking it away later needs to know.
    lines.push(`      # dsh-box: ${entry.kind}${entry.path === null || entry.path === undefined ? '' : ` ${entry.path}`}`)
  }
  const block = `${lines.join('\n')}\n${BLOCK_END}\n`
  writeFileSync(file, before === '' ? block : `${before}\n\n${block}`)
  return backup
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(backupDir, stamp)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'cordis.patch.yml')
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
  for (const entry of going) rmSync(entry.dir, { recursive: true, force: true })
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
  rmSync(going.dir, { recursive: true, force: true })
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
 * Split a patch file into our block and everything else.
 * @param {string} file
 * @returns {{block: string, rest: string, readable: boolean}}
 */
function splitPatch(file) {
  const text = readText(file)
  if (text === '') return { block: '', rest: '', readable: true }
  const start = text.indexOf(BLOCK_START)
  if (start === -1) return { block: '', rest: text, readable: true }
  const end = text.indexOf(BLOCK_END, start)
  // A start without an end means somebody edited into the middle of our block.
  // Guessing where it should have ended would delete lines that are not ours,
  // so nothing is written until a person has looked.
  if (end === -1) return { block: '', rest: text, readable: false }
  return {
    block: text.slice(start, end),
    rest: `${text.slice(0, start)}${text.slice(end + BLOCK_END.length)}`,
    readable: true,
  }
}

/**
 * The entries inside our block.
 * @param {string} block
 * @param {string} home
 * @param {string} profile
 * @returns {MountedPlugin[]}
 */
function entriesIn(block, home, profile) {
  const found = []
  const lines = block.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index].match(/^\s*-\s*id:\s*(.+?)\s*$/)
    if (id === null) continue
    const name = lines[index + 1]?.match(/^\s*name:\s*(.+?)\s*$/)
    if (name === undefined || name === null) continue
    const note = lines[index + 2]?.match(/^\s*#\s*dsh-box:\s*(link|package)(?:\s+(.*?))?\s*$/)
    found.push({
      id: unquote(id[1]),
      package: unquote(name[1]),
      kind: /** @type {'link' | 'package'} */ (note?.[1] ?? 'link'),
      path: note?.[2] ?? null,
    })
  }
  return found
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
 * The bundle list, read only.
 *
 * ⛔ This tool never writes here, and the reason is worth keeping. Registering a
 * package as a bundle is what dsh's own `plugin add` does, and it would have
 * been the natural home for anything fetched from npm — but doing that requires
 * running a package manager inside the profile, and **measured on a real
 * `~/.dsh`**, a profile dsh's tooling has touched holds `link:` dependencies,
 * a pnpm protocol npm refuses outright. So npm-fetched plugins are kept in this
 * tool's own tree and linked in like any folder, and this file stays theirs.
 * @param {string} file
 * @returns {string[]}
 */
function bundleNames(file) {
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
