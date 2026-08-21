/**
 * Where everything this tool creates lives on disk.
 *
 * One rule drives the whole module: nothing here may contain a path baked in
 * at authoring time. Every location is derived from the process working
 * directory or from user configuration, so the same build works from a USB
 * stick, a network share, or any drive letter.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

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
 * Names that become directory names must survive both Windows and POSIX. The
 * conservative set below is narrower than either platform allows, which is
 * the point: a sandbox name also appears in shell commands and in the URL of
 * the config window.
 * @param {string} value - user-supplied name.
 * @returns {string} a filesystem-safe name, empty when nothing usable remains.
 */
export function safeName(value) {
  return cleanPath(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
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
  if (!statSync(dir).isDirectory()) return `${dir} 已存在,而且不是文件夹`
  if (existsSync(join(dir, BOX_MARKER))) return null
  if (readdirSync(dir).length === 0) return null
  return `${dir} 已存在、非空,而且不是本工具建的`
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
  throw new Error(`在 ${cwd} 旁边找不到可用的数据目录名`)
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
  }
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
 */

/**
 * Paths of one sandbox. A sandbox is exactly one `DSH_HOME`, which is what
 * makes deleting the directory a complete uninstall.
 * @param {BoxLayout} layout
 * @param {string} name
 * @returns {SandboxPaths}
 */
export function sandboxPaths(layout, name) {
  const clean = safeName(name)
  if (clean === '') throw new Error('去掉不能用的字符后,沙箱名字就空了')
  const root = join(layout.sandboxes, clean)
  return { name: clean, root, home: join(root, 'home'), state: join(root, 'sandbox.json') }
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
