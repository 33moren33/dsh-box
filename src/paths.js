/**
 * Where everything this tool creates lives on disk.
 *
 * One rule drives the whole module: nothing here may contain a path baked in
 * at authoring time. Every location is derived from the process working
 * directory or from user configuration, so the same build works from a USB
 * stick, a network share, or any drive letter.
 */

import { createHash } from 'node:crypto'
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { BoxError } from './errors.js'
import { t } from './messages.js'

/**
 * Default location of the data directory, relative to wherever the tool
 * runs: a `data` folder inside the tool's own `dsh-box` folder. `dsh-box`
 * (hyphen) is the product's home, `data` is the user's things — the old
 * single `dsh_box` (underscore) name was one keystroke away from the product
 * name and confused everyone it met.
 */
export const DEFAULT_BOX_NAME = 'dsh-box/data'

/**
 * Marker file that identifies a directory as ours. Its presence is the only
 * thing that authorizes writing into an existing directory, so a user who
 * already owns a folder by our default name never has it silently absorbed.
 */
export const BOX_MARKER = '.dsh-box'

/** Environment override for the whole data directory, absolute or relative. */
export const BOX_HOME_ENV = 'DSH_BOX_HOME'

/** Environment override for just the directory name, resolved against cwd. */
export const BOX_NAME_ENV = 'DSH_BOX_NAME'

/**
 * A path that arrived from a text field, an environment variable, or a
 * drag-and-drop needs its surrounding whitespace removed before use. Windows
 * "Copy as path" wraps the value in quotes, and a trailing space in a
 * directory name is legal on POSIX but silently breaks lookups everywhere
 * else, so both are stripped.
 * @param {string} value - raw path text.
 * @returns {string} the path with quotes and edge whitespace removed.
 */
export function cleanPath(value) {
  if (typeof value !== 'string') return ''
  let out = value.trim()
  if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
    out = out.slice(1, -1).trim()
  }
  return out
}

/**
 * Turn arbitrary text into something usable as a directory name.
 *
 * Used where the name is *derived* rather than chosen — a plugin id taken
 * from a package name, for instance, where `@scope/pkg` has to become
 * something a folder can be called. Names a person picks are checked instead
 * of mangled; see {@link checkSandboxName}.
 * @param {string} value - text to derive a name from.
 * @returns {string} a filesystem-safe name, empty when nothing usable remains.
 */
export function safeName(value) {
  return cleanPath(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
}

/**
 * Characters allowed in a name someone types.
 *
 * Deliberately a whitelist of letters, marks, digits and three punctuation
 * marks. Letters means letters in any script, so 中文 names work — they pass
 * through every shell on this platform unharmed, which was measured rather
 * than assumed (PowerShell 5.1 and 7, cmd.exe and git-bash, under both the
 * UTF-8 and the GBK console code page, all deliver the same code points,
 * because Windows hands arguments to a program as wide characters and the
 * console code page only affects what is drawn).
 *
 * What the whitelist keeps out is everything with a second meaning somewhere:
 * the characters Windows forbids in a filename (`\ / : * ? " < > |`), control
 * characters, and every shell metacharacter — spaces, `&`, `;`, `$`, quotes,
 * brackets. A sandbox name is typed at a command line many times a day, and a
 * name that needs quoting to survive is a name that will one day not be.
 */
const NAME_ALLOWED = /^[\p{L}\p{M}\p{N}._-]+$/u

/** Longest a name may be, so it stays inside every platform's path limits. */
export const NAME_MAX = 64

/**
 * Names Windows refuses to give a directory, whatever the file system.
 * They are device names, and the refusal is silent enough to look like a bug
 * in this tool rather than a rule of the platform.
 */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 10 }, (_, n) => `com${n}`),
  ...Array.from({ length: 10 }, (_, n) => `lpt${n}`),
])

/**
 * Why a name cannot be used, or `null` when it can.
 *
 * Separate from the throwing version so that listing existing sandboxes can
 * skip a stray directory instead of failing outright.
 * @param {string} value
 * @returns {string | null} a reason written for a person.
 */
export function sandboxNameProblem(value) {
  const name = normalizeName(value)
  if (name === '') return t('name.empty')
  if (name.length > NAME_MAX) return t('name.tooLong', { max: NAME_MAX })
  if (name === '.' || name === '..') return t('name.dots')
  // A leading dash is read as an option by this tool and by every shell, so
  // `stop -x` would never reach the sandbox called `-x`.
  if (name.startsWith('-')) return t('name.leadingDash')
  if (name.startsWith('.')) return t('name.leadingDot')
  if (name.endsWith('.')) return t('name.trailingDot')
  if (!NAME_ALLOWED.test(name)) return t('name.charset')
  // The rule covers the name with any extension: `con.log` is refused too.
  if (RESERVED_NAMES.has(name.split('.')[0].toLowerCase())) return t('name.reserved', { name })
  return null
}

/**
 * The name to use, or a failure explaining the rule.
 *
 * Checked rather than silently cleaned up. Quietly rewriting what someone
 * typed produces a sandbox under a name they did not choose and cannot guess
 * afterwards — and the previous rule, which allowed only ASCII, erased a
 * Chinese name down to nothing and then reported that the name was empty.
 * @param {string} value
 * @returns {string}
 */
export function checkSandboxName(value) {
  const problem = sandboxNameProblem(value)
  if (problem !== null) {
    throw new BoxError('BAD_SANDBOX_NAME', problem, { name: cleanPath(value), rule: nameRule() })
  }
  return normalizeName(value)
}

/**
 * Put a name into one canonical spelling.
 *
 * The same visible name can be stored as more than one sequence of code
 * points: `が` is either one character or `か` followed by a combining mark,
 * and macOS file systems have historically written the second form whatever
 * you handed them. Linux compares filenames byte for byte, so the two spell
 * different directories there and a person retyping a name gets "no such
 * sandbox" while looking straight at it.
 *
 * Composing on the way in makes what this tool creates and looks up
 * consistent everywhere. Chinese is unaffected either way — Han characters
 * have no decomposed form — but Japanese and Korean names are not, and the
 * rule costs nothing.
 * @param {string} value
 * @returns {string}
 */
export function normalizeName(value) {
  return cleanPath(value).normalize('NFC')
}

/**
 * One line stating the rule, for help text and for the config window.
 *
 * ⛔ A function, not a constant. Module-level constants are evaluated when the
 * file is imported, which happens before anything has read the config and
 * chosen a language — so a `const` here would be frozen in the default
 * language for the life of the process, and would be wrong exactly when
 * somebody has switched. Anything holding text has to be asked, not stored.
 * @returns {string}
 */
export function nameRule() {
  return t('name.rule')
}

/**
 * Locate the data directory without creating it.
 *
 * Resolution order is explicit argument, then {@link BOX_HOME_ENV}, then
 * {@link BOX_NAME_ENV} under the working directory, then the default name
 * under the working directory.
 * @param {object} [options]
 * @param {string} [options.cwd] - directory the tool was started from.
 * @param {string} [options.dir] - explicit data directory.
 * @param {string} [options.name] - explicit directory name under `cwd`.
 * @param {NodeJS.ProcessEnv} [options.env] - environment to consult.
 * @returns {string} absolute path of the data directory.
 */
export function resolveBoxDir({ cwd = process.cwd(), dir, name, env = process.env } = {}) {
  const explicit = cleanPath(dir ?? env[BOX_HOME_ENV] ?? '')
  if (explicit !== '') return isAbsolute(explicit) ? explicit : resolve(cwd, explicit)
  const chosen = safeName(name ?? env[BOX_NAME_ENV] ?? '') || DEFAULT_BOX_NAME
  return resolve(cwd, chosen)
}

/**
 * Why a directory cannot be used, or `null` when it can.
 * @param {string} dir - candidate data directory.
 * @returns {string | null} a human-readable reason, or null when usable.
 */
export function boxConflict(dir) {
  if (!existsSync(dir)) return null
  if (!statSync(dir).isDirectory()) return t('box.notADirectory', { dir })
  if (existsSync(join(dir, BOX_MARKER))) return null
  if (readdirSync(dir).length === 0) return null
  return t('box.occupied', { dir })
}

/**
 * Pick a data directory name that is free, appending `-2`, `-3`, ... only as
 * needed. Used when the default collides with something the user owns.
 * @param {string} cwd - directory to search in.
 * @param {string} [base] - preferred name.
 * @returns {string} absolute path of a usable directory.
 */
export function pickFreeBoxDir(cwd, base = DEFAULT_BOX_NAME) {
  const first = resolve(cwd, base)
  if (boxConflict(first) === null) return first
  for (let n = 2; n < 100; n += 1) {
    const candidate = resolve(cwd, `${base}-${n}`)
    if (boxConflict(candidate) === null) return candidate
  }
  throw new Error(t('box.noFreeName', { cwd }))
}

/**
 * Create the data directory and its fixed subtree, and stamp it as ours.
 *
 * The generated `.gitignore` is not a courtesy. Importing existing sign-in
 * copies a real credentials file into every sandbox home, and a repository
 * that swallows one cannot be cleaned afterwards, so the ignore rule is
 * written before anything else can land here.
 * @param {string} dir - absolute path of the data directory.
 * @returns {BoxLayout} the resolved layout.
 */
export function ensureBox(dir) {
  const conflict = boxConflict(dir)
  if (conflict !== null) throw new Error(conflict)
  const layout = boxLayout(dir)
  for (const path of [layout.root, layout.versions, layout.sandboxes]) mkdirSync(path, { recursive: true })
  if (!existsSync(layout.marker)) writeFileSync(layout.marker, 'dsh-box\n')
  if (!existsSync(layout.gitignore)) writeFileSync(layout.gitignore, BOX_GITIGNORE)
  return layout
}

const BOX_GITIGNORE = `# Everything in this directory is reproducible except one thing: a sandbox
# home can hold a copy of your API key. Ignore all of it.
*
`

/**
 * @typedef {object} BoxLayout
 * @property {string} root - the data directory itself.
 * @property {string} versions - downloaded official releases, one per version.
 * @property {string} sandboxes - sandbox directories, one per name.
 * @property {string} config - user configuration file.
 * @property {string} marker - the ownership marker.
 * @property {string} gitignore - the generated ignore file.
 * @property {string} backups - untouched copies of workspace config, before we changed it.
 * @property {string} packages - plugins fetched from npm, kept in our own tree.
 * @property {string} cabinets - one ledger per filing cabinet: which rows in its
 * plugin config this tool wrote.
 * @property {string} engines - one derived tree per dsh installation: hardlinks
 * of downloaded plugins with a version-matched shelf of official packages beside
 * them. Entirely rebuildable from `packages` and the installation, so deleting
 * it costs a re-stage and never data.
 * @property {string} envPath - copies of the user's PATH from before this tool
 * changed it. The one thing it writes that lives outside this folder, so the way
 * back has to be readable by a person with a text editor.
 */

/**
 * Fixed subtree of a data directory. Pure path arithmetic, no filesystem access.
 * @param {string} dir - absolute path of the data directory.
 * @returns {BoxLayout}
 */
export function boxLayout(dir) {
  const root = resolve(cleanPath(dir))
  return {
    root,
    versions: join(root, 'versions'),
    sandboxes: join(root, 'sandboxes'),
    config: join(root, 'config.json'),
    marker: join(root, BOX_MARKER),
    gitignore: join(root, '.gitignore'),
    backups: join(root, 'backups'),
    packages: join(root, 'packages'),
    cabinets: join(root, 'cabinets'),
    engines: join(root, 'engines'),
    envPath: join(root, 'env-path'),
  }
}

/**
 * One filing cabinet's name in this tool's own directories.
 *
 * ⛔ The readable part is truncated to 64 characters, and two homes can differ
 * in the middle of a long path — so on names alone they can collide, and then
 * one cabinet's records would be read as another's. The digest is what actually
 * keeps them apart; the readable part is only so a person can tell whose file
 * they are looking at.
 * @param {string} home - the `DSH_HOME` being named.
 * @returns {string}
 */
export function homeKey(home) {
  const full = resolve(cleanPath(home))
  const fingerprint = createHash('sha1').update(full).digest('hex').slice(0, 8)
  return `${safeName(full) || 'home'}-${fingerprint}`
}

/**
 * Where the untouched originals of one workspace's config are kept.
 *
 * Inside this tool's data directory rather than beside the file it copies:
 * scattering `.bak` files through somebody's `~/.dsh` is the coupling this tool
 * exists to avoid, and a backup that lives in the sandbox is gone the moment
 * the sandbox is. Named after the home, so two workspaces never share a pile.
 * @param {BoxLayout} layout
 * @param {string} home - the `DSH_HOME` being backed up.
 * @returns {string}
 */
export function backupDir(layout, home) {
  return join(layout.backups, homeKey(home))
}

/**
 * Where this tool's record of one cabinet lives.
 *
 * ⭐⭐ **The record is here rather than in the cabinet's own file**, and that is
 * a decision rather than a detail (CEO 2026-08-23). Ownership used to be written
 * into `cordis.patch.yml` as marker comments, which had the property that the
 * two could never drift. What it cost was that the file stopped being a plain
 * list of plugins: our comments were in it, and a great many plugin conflicts
 * out there are caused by exactly that kind of decoration. Without markers the
 * YAML is a portable name-list — **the same file can be copied straight from a
 * daily cabinet into a sandbox** — and that is worth more than the guarantee.
 *
 * ⛔ The accepted cost, stated plainly so nobody re-litigates it later: **lose
 * this directory and the rows stay behind, unattributed.** They keep working;
 * this tool simply no longer claims them, and `uninstall` says so instead of
 * guessing. It is not this tool's job to recover from its own data directory
 * being deleted.
 *
 * ⚠️ Named by the same key as {@link backupDir}, so one cabinet has one name
 * everywhere in here.
 * @param {BoxLayout} layout
 * @param {string} home
 * @returns {string}
 */
export function cabinetLedgerFile(layout, home) {
  return join(layout.cabinets, `${homeKey(home)}.json`)
}

/**
 * Delete a file, a link, or a whole directory — without `fs.rmSync`.
 *
 * ⛔⛔ **On Windows, `rmSync(path, {recursive:true})` is broken on a wide band
 * of Node versions when `path` itself contains a non-ASCII character.** A
 * directory with anything in it returns cheerfully and deletes nothing; an
 * empty one **takes the process down** (0xC0000409, no output at all). The same
 * tree named `alpha/` deletes fine, and so does a Chinese *child* under an ASCII
 * parent — it is the path handed to the call that decides.
 *
 * Upstream cause (nodejs/node#61067, fixed by #61108): the C++ rewrite built a
 * `std::filesystem::path` from a narrow string, which Windows reads in the ANSI
 * code page rather than UTF-8, so the path became a name that does not exist and
 * the "does it exist" test said no. See {@link copyTree} for the sister defect.
 *
 * **Measured range (real node.exe of each version, not inferred):** broken from
 * **23.0.0 through 24.13.0**, fixed in **24.13.1**. The 20, 21 and 22 lines are
 * unaffected *for this call*.
 *
 * It reaches much further than sandbox names, which are allowed to be Chinese
 * and usually are: a user called 张三 has non-ASCII in **every** path this tool
 * owns, so dropping a release, pruning packages and clearing backups would all
 * quietly do nothing. Silently, which is the worst part — `rm` said `ok:true`
 * with the sandbox still on disk.
 *
 * ⭐ The walk below is what `rmSync` does internally, minus whatever is broken:
 * every primitive it uses was measured working on a broken build.
 * ⛔ It must never follow a link: a sandbox contains junctions pointing at the
 * user's own plugin folders, and walking into one would delete their source
 * instead of the link.
 * @param {string} target
 * @returns {boolean} whether there was something there to remove.
 */
export function removeTree(target) {
  let stat
  try {
    stat = lstatSync(target)
  } catch {
    return false
  }
  // `isDirectory()` is true for a Windows junction as well, so the link test
  // has to come first or the walk goes through it.
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of readdirSync(target)) removeTree(join(target, entry))
    rmdirSync(target)
    return true
  }
  removeEntry(target)
  return true
}

/**
 * Copy a file or a whole directory — without `fs.cpSync`.
 *
 * ⛔⛔ The same root cause as {@link removeTree} (nodejs/node#61878, fixed by
 * #61950) but **a different bug in a different set of versions**, which is the
 * part that matters: a non-ASCII **destination** copies nothing and reports
 * success, a non-ASCII **source** takes the process down. `adopt` is the caller
 * that matters — copying conversations into a cabinet whose name is Chinese
 * would have said "copied 12" and copied none.
 *
 * **Measured range:** broken from **22.17.0 onwards in the 22 line — including
 * 22.21.1, which is the current LTS and still has it** — and again from some
 * point in the 24 line through **24.14.1**, fixed in **24.15.0**.
 *
 * ⛔⛔ **Do not collapse the two ranges into one sentence.** Reading only the
 * delete defect suggests "the 22 LTS is a safe harbour"; it is not, and advising
 * anyone to fall back to it would hand them this one instead. That mistake was
 * live in this file until both calls were measured separately.
 * @param {string} from
 * @param {string} to
 */
export function copyTree(from, to) {
  const stat = lstatSync(from)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    return
  }
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) copyTree(join(from, entry), join(to, entry))
}

/**
 * Remove one file or one link, whatever the platform calls it.
 * @param {string} target
 */
function removeEntry(target) {
  try {
    unlinkSync(target)
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code
    // A directory junction on Windows unlinks as a directory; a read-only file
    // needs the bit cleared first, which is the one thing `rmSync`'s `force`
    // did for us that plain `unlinkSync` does not.
    if (code === 'EPERM' || code === 'EISDIR') {
      try {
        rmdirSync(target)
        return
      } catch {
        chmodSync(target, 0o666)
        unlinkSync(target)
        return
      }
    }
    throw error
  }
}

/**
 * The seat the one config window of this data directory holds.
 *
 * Two callers, for two different questions: the window takes it so a second
 * window cannot start, and the command line reads it to tell whether the
 * process asking for approval was started **by** that window — which is the
 * only evidence this tool has that a person was present.
 * @param {BoxLayout} layout
 * @returns {string}
 */
export function uiSeatFile(layout) {
  return join(layout.root, 'ui.json')
}

/**
 * Directory holding one downloaded official release.
 * @param {BoxLayout} layout
 * @param {string} version - exact version, for example `0.1.0-rc.7`.
 * @returns {string}
 */
export function versionDir(layout, version) {
  return join(layout.versions, safeName(version))
}

/**
 * Path of the `dsh` entry script inside a downloaded release. The tool always
 * invokes this file with the current Node binary rather than the shell
 * wrapper, so it never depends on how the user's PATH is set up.
 * @param {BoxLayout} layout
 * @param {string} version
 * @returns {string}
 */
export function versionEntry(layout, version) {
  return join(versionDir(layout, version), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

/**
 * @typedef {object} SandboxPaths
 * @property {string} name - the sanitized sandbox name.
 * @property {string} root - the sandbox directory.
 * @property {string} home - value handed to dsh as `DSH_HOME`.
 * @property {string} state - this tool's own record for the sandbox.
 * @property {string} logs - directory holding one file per launch.
 */

/**
 * Paths of one sandbox. A sandbox is exactly one `DSH_HOME`, which is what
 * makes deleting the directory a complete uninstall.
 * @param {BoxLayout} layout
 * @param {string} name
 * @returns {SandboxPaths}
 */
export function sandboxPaths(layout, name) {
  const clean = checkSandboxName(name)
  const root = join(layout.sandboxes, clean)
  return {
    name: clean,
    root,
    home: join(root, 'home'),
    state: join(root, 'sandbox.json'),
    logs: join(root, 'logs'),
  }
}

/**
 * The user's own dsh home, the one this tool exists to keep out of harm's way.
 * Read only ever for the credentials file.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function userDshHome(env = process.env) {
  const override = cleanPath(env.DSH_HOME ?? '')
  return override !== '' ? override : join(homedir(), '.dsh')
}
