/**
 * User configuration: which local plugins exist, and what was chosen last time.
 *
 * Everything machine-specific lives in this file rather than in the source.
 * That is what lets the tool ship without a single path baked into it: a
 * plugin's location is something the person running it points at once, and
 * the file that remembers it is theirs, not ours.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BoxError } from './errors.js'
import { withFileLock, writeAtomic } from './file-lock.js'
import { LANGS, systemLang, t } from './messages.js'
import { cleanPath, safeName } from './paths.js'

/**
 * @typedef {object} RegisteredPlugin
 * @property {string} id - patch entry id; also the key the UI checkbox uses.
 * @property {string} package - package name dsh resolves at boot.
 * @property {string} path - directory holding the plugin's package.json.
 * @property {string} label - what the config window shows.
 */

/**
 * @typedef {object} Choices
 * @property {string} version
 * @property {string} sandbox
 * @property {string[]} plugins - registered plugin ids.
 * @property {boolean} importSignIn
 */

/**
 * @typedef {object} Config
 * @property {RegisteredPlugin[]} plugins
 * @property {unknown[]} [unknownPlugins] - rows in the file's plugin list this
 * version cannot read. Carried so a write puts them back rather than dropping
 * them; never written under this name.
 * @property {Choices} last
 * @property {string} source - registry source: 'auto', 'official' or 'mirror'.
 * @property {boolean} askOnQuit - warn before closing the window stops every
 * sandbox. Kept here rather than in the page because it outlives the page.
 * @property {boolean} askOnDaily - warn before an action reaches into the daily
 * workspace. A separate switch from `askOnQuit` on purpose: the two say
 * different things, and one tick should not silence the other.
 */

/** Shipped empty on purpose: a published build must know nothing about any machine. */
export const EMPTY_CONFIG = {
  plugins: [],
  unknownPlugins: [],
  last: { version: '', sandbox: '', plugins: [], importSignIn: true },
  source: 'auto',
  askOnQuit: true,
  askOnDaily: true,
}

/** The registry choices the config accepts; anything else falls back to 'auto'. */
export const SOURCE_CHOICES = ['auto', 'official', 'mirror']

/**
 * Settings a person can change, and where each one is kept.
 *
 * Declared rather than typed out at each entrance because the config window
 * used to be the only place the registry source could be changed at all — a
 * capability the command line did not have, which is the failure this tool's
 * structure is supposed to make impossible rather than merely discouraged.
 *
 * "Ask before quitting" is here rather than remembered by the page for the
 * same reason: it survives a restart, so it is part of the model, and
 * everything in the model is reachable from a command.
 */
export const SETTINGS = {
  // ⛔ Getters, not values. This object is built when the file is imported,
  // which is before anything has read the config and picked a language — a
  // plain string here would be frozen in the default language forever. A
  // getter is read at the moment it is displayed, so every caller stays
  // exactly as it was and still gets the right language.
  source: {
    get summary() { return t('settings.source.summary') },
    choices: SOURCE_CHOICES,
    read: (config) => config.source,
    write: (config, value) => ({ ...config, source: value }),
  },
  'ask-on-quit': {
    get summary() { return t('settings.askOnQuit.summary') },
    choices: ['on', 'off'],
    read: (config) => (config.askOnQuit ? 'on' : 'off'),
    write: (config, value) => ({ ...config, askOnQuit: value === 'on' }),
  },
  // ⚠️ Separate from `ask-on-quit` deliberately (CEO 2026-08-22): that one says
  // "quitting stops the processes behind this window"; this one says "removing
  // this plugin will also take it out of the workspace you use every day".
  // Two different sentences, so silencing one must not silence the other.
  'ask-on-daily': {
    get summary() { return t('settings.askOnDaily.summary') },
    choices: ['on', 'off'],
    read: (config) => (config.askOnDaily ? 'on' : 'off'),
    write: (config, value) => ({ ...config, askOnDaily: value === 'on' }),
  },
  // ⭐ A setting of this data directory, not a preference of the page. The
  // switch in the window's corner runs this command, which is what stops the
  // window from having an ability the command line lacks — and it is why the
  // terminal and the window can never end up in two different languages.
  //
  // Unset means "whatever this computer is set to", so a first run abroad
  // comes up in English with nobody configuring anything. Once it has been
  // set, the environment stops being consulted: a choice someone made is not
  // something to second-guess on the next machine the folder is copied to.
  lang: {
    get summary() { return t('settings.lang.setting') },
    choices: LANGS,
    read: (config) => config.lang ?? systemLang(),
    write: (config, value) => ({ ...config, lang: value }),
  },
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {Config}
 */
export function readConfig(layout) {
  return parseConfig(layout, existsSync(layout.config) ? readFileSync(layout.config, 'utf8') : null)
}

/**
 * Turn the file's bytes into a Config, or refuse.
 *
 * ⛔ **Refuses rather than falling back to an empty config, and that reversal is
 * the whole point.** This used to answer an unparseable file with `EMPTY_CONFIG`,
 * reasoning that a bad config should not stop the tool from starting and the
 * worst case was re-picking some options. The reasoning missed what the caller
 * does next: it changes one field and writes the whole thing back, so the empty
 * stand-in became the file, and every registered plugin was gone — with the
 * command still reporting `"ok": true`. Measured, not imagined: trim three
 * characters off the end, register one plugin, and the earlier ones are gone.
 *
 * "Fall back to a default and carry on" reads as robustness and is really *I
 * cannot understand your data, so I threw it away*. **Nothing here writes over
 * something it could not read.**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string | null} text
 * @returns {Config}
 */
function parseConfig(layout, text) {
  if (text === null) return structuredClone(EMPTY_CONFIG)
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new BoxError(
      'CONFIG_UNREADABLE',
      t('config.unreadable', { file: layout.config, error: error.message }),
      { file: layout.config },
    )
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BoxError(
      'CONFIG_UNREADABLE',
      t('config.notAnObject', { file: layout.config }),
      { file: layout.config },
    )
  }
  const rows = Array.isArray(raw.plugins) ? raw.plugins : []
  return {
    // Spread first so fields this version does not know about survive a write.
    // A newer build's key, or something typed in by hand, is not ours to drop.
    ...raw,
    plugins: rows.filter(isPluginShaped),
    // Rows that are not plugin-shaped are kept aside rather than dropped, for
    // the same reason as above: they are written back untouched. Silently
    // shrinking a list the user wrote is the small version of the bug this
    // function exists to prevent.
    unknownPlugins: rows.filter((row) => !isPluginShaped(row)),
    last: { ...EMPTY_CONFIG.last, ...(raw.last ?? {}) },
    source: SOURCE_CHOICES.includes(raw.source) ? raw.source : 'auto',
    askOnQuit: raw.askOnQuit !== false,
    askOnDaily: raw.askOnDaily !== false,
  }
}

/**
 * Change the configuration as one indivisible step: read, alter, write.
 *
 * ⛔ **Every write goes through here, because read-alter-write is exactly the
 * shape that loses other people's changes.** Since the config window became a
 * caller of the command line rather than a second implementation of it, every
 * button on that page is its own process — so two writers is the ordinary case,
 * not a rare one. Two processes that each read `{甲}`, one adding 乙 and the
 * other 丙, both wrote the whole file back and one of the two additions was
 * gone, with both commands reporting success.
 *
 * The lock and the atomic rename it stands on live in `file-lock.js`; the
 * cabinet ledger is the other caller.
 * @template T
 * @param {import('./paths.js').BoxLayout} layout
 * @param {(config: Config) => Config} change
 * @returns {Config} what was written.
 */
export function updateConfig(layout, change) {
  return withFileLock(layout.config, () => {
    const next = change(readConfig(layout))
    writeConfig(layout, next)
    return next
  })
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {Config} config
 */
export function writeConfig(layout, config) {
  const { unknownPlugins = [], ...rest } = config
  // `unknownPlugins` is this module's bookkeeping, not a field of the file: the
  // rows go back where they came from, and the helper key never lands on disk.
  const body = { ...rest, plugins: [...config.plugins, ...unknownPlugins] }
  writeAtomic(layout.config, `${JSON.stringify(body, null, 2)}\n`)
}

/**
 * Read a directory that claims to be a dsh plugin and turn it into a
 * registry entry.
 *
 * The package name is taken from the plugin's own `package.json` rather than
 * typed in, because that name is what dsh resolves at boot and a typo there
 * produces the least helpful failure dsh has: the plugin simply does not
 * appear, with nothing logged.
 * @param {string} dir - directory the user pointed at.
 * @param {object} [options]
 * @param {string} [options.id] - override the patch entry id.
 * @returns {RegisteredPlugin}
 */
export function describePlugin(dir, { id } = {}) {
  // Made absolute here, where the working directory still means something.
  // What gets stored is used much later, by a launch that may run from
  // anywhere — and on Windows a link created with a relative target does not
  // resolve against that later working directory either: it resolves against
  // the link's own folder, deep inside a sandbox home, where nothing is. The
  // result is a link that exists, points nowhere, and produces dsh's worst
  // failure: the plugin is simply absent, with nothing logged.
  const path = resolve(cleanPath(dir))
  const manifestPath = join(path, 'package.json')
  // "The folder is not there" and "the folder is there but holds no package"
  // read alike to a person and call for opposite next moves: check the path
  // you typed, versus look one level down. They are reported apart.
  if (!existsSync(path)) throw new BoxError('DIR_NOT_FOUND', t('plugin.dirNotFound', { path }), { path })
  if (!existsSync(manifestPath)) {
    throw new BoxError('NO_PACKAGE_JSON', t('plugin.noPackageJson', { path }), { path })
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new BoxError('UNREADABLE_MANIFEST', t('plugin.unreadableManifest', { file: manifestPath, error: error.message }), { path })
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new BoxError('NO_PACKAGE_NAME', t('plugin.noPackageName', { file: manifestPath }), { path })
  }
  // A package.json with a name was the whole test, once, and it let through
  // the one input that fails worst: a folder that is not a plugin. dsh loads
  // what it is given, finds no plugin declaration, and says nothing — the
  // launch simply comes up without it. Refusing here, loudly, is the only
  // place this can still be a sentence rather than a silence.
  if (manifest.dsh === undefined || manifest.dsh === null || typeof manifest.dsh !== 'object') {
    throw new BoxError('NOT_A_DSH_PLUGIN', notAPluginMessage(path, manifest), {
      path, package: manifest.name, ...monorepoHint(path),
    })
  }
  // Workspace links are resolved by the package manager at install time. This
  // tool links one folder and installs nothing, so a package whose siblings
  // were never installed is a package dsh cannot load — and, again, would not
  // complain about.
  const unmet = workspaceDeps(manifest)
  if (unmet.length > 0 && !existsSync(join(path, 'node_modules'))) {
    throw new BoxError(
      'PLUGIN_DEPS_MISSING',
      t('plugin.workspaceDepsMissing', { name: manifest.name, count: unmet.length }),
      { path, package: manifest.name, workspaceDependencies: unmet },
    )
  }
  // Source that was never built is the third way to be registered and then
  // quietly not loaded. Plugins in this ecosystem compile to `lib/`, which is
  // git-ignored, so a fresh clone points at an entry file that is not there
  // yet — and looks completely fine in a listing.
  if (typeof manifest.main === 'string' && !existsSync(join(path, manifest.main))) {
    throw new BoxError(
      'PLUGIN_NOT_BUILT',
      t('plugin.entryMissing', { name: manifest.name, main: manifest.main, path }),
      { path, package: manifest.name, main: manifest.main },
    )
  }
  // A row in the overlay names a package for dsh to *import*, so a package
  // with no code at all cannot be one — however plugin-shaped it looks.
  //
  // Found by booting rather than by reading: `@linxin666/dsh-skins` declares
  // `dsh.bundle.patch` like every other plugin in that family, and passed
  // every check above, and took the whole launch down with
  // `ERR_MODULE_NOT_FOUND`. It is an asset package whose own patch pulls in
  // the package that does have code. Installed the official way it works,
  // because `dsh plugin add` reads that patch; named directly in an overlay
  // it cannot, because there is nothing to import.
  if (!isImportable(path, manifest)) {
    throw new BoxError(
      'PLUGIN_HAS_NO_ENTRY',
      t('plugin.noEntry', { name: manifest.name }),
      { path, package: manifest.name },
    )
  }
  const entryId = safeName(id ?? manifest.name)
  if (entryId === '') throw new BoxError('BAD_PLUGIN_ID', t('plugin.badId', { name: manifest.name }), { path })
  return { id: entryId, package: manifest.name, path, label: manifest.name }
}

/**
 * Whether Node could import this package by name.
 *
 * The three ways a package says where its code is, in the order Node tries
 * them. `exports` is enough on its own because it is a map — if it is there at
 * all, something is exported.
 * @param {string} path
 * @param {Record<string, any>} manifest
 * @returns {boolean}
 */
function isImportable(path, manifest) {
  if (typeof manifest.main === 'string' && manifest.main !== '') return true
  if (manifest.exports !== undefined && manifest.exports !== null) return true
  return existsSync(join(path, 'index.js')) || existsSync(join(path, 'index.mjs'))
}

/**
 * Sibling packages this one expects the package manager to have linked.
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
function workspaceDeps(manifest) {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, range]) => typeof range === 'string' && range.startsWith('workspace:'))
    .map(([name]) => name)
}

/**
 * Whether the folder looks like the root of a multi-package repository, and
 * what is in it. Pointing at such a root is the likeliest way to arrive here:
 * it is the folder you get when you clone, and it does hold a package.json.
 * @param {string} path
 * @returns {{packagesDir?: string, candidates?: string[]}}
 */
function monorepoHint(path) {
  const packages = join(path, 'packages')
  if (!existsSync(packages)) return {}
  let candidates = []
  try {
    candidates = readdirSync(packages)
      .filter((entry) => existsSync(join(packages, entry, 'package.json')))
  } catch {
    // An unreadable folder just means no hint.
  }
  return { packagesDir: packages, candidates }
}

/**
 * @param {string} path
 * @param {Record<string, any>} manifest
 * @returns {string}
 */
function notAPluginMessage(path, manifest) {
  const { candidates } = monorepoHint(path)
  const head = t('plugin.notADshPlugin', { path })
  if (candidates === undefined || candidates.length === 0) return head
  return `${head}${t('plugin.monorepoHint', { count: candidates.length })}`
    + `\n  ${candidates.slice(0, 6).join('、')}${candidates.length > 6 ? ' …' : ''}`
    + t('plugin.monorepoPick')
}

/**
 * Add or replace a plugin in the registry, keyed by id.
 * @param {Config} config
 * @param {RegisteredPlugin} plugin
 * @returns {Config}
 */
export function upsertPlugin(config, plugin) {
  const plugins = config.plugins.filter((p) => p.id !== plugin.id)
  plugins.push(plugin)
  plugins.sort((a, b) => a.label.localeCompare(b.label))
  return { ...config, plugins }
}

/**
 * @param {Config} config
 * @param {string} id
 * @returns {Config}
 */
export function removePlugin(config, id) {
  return { ...config, plugins: config.plugins.filter((p) => p.id !== id) }
}

/**
 * Registered plugins whose directory is still there.
 *
 * A plugin registered from a folder that has since been moved or deleted is
 * reported rather than dropped: silently removing a checkbox the user ticked
 * last time is how a launch quietly stops including something.
 * @param {Config} config
 * @returns {{live: RegisteredPlugin[], missing: RegisteredPlugin[]}}
 */
export function partitionPlugins(config) {
  const live = []
  const missing = []
  for (const plugin of config.plugins) {
    (existsSync(join(plugin.path, 'package.json')) ? live : missing).push(plugin)
  }
  return { live, missing }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPluginShaped(value) {
  return Boolean(value)
    && typeof value.id === 'string'
    && typeof value.package === 'string'
    && typeof value.path === 'string'
}
