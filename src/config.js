/**
 * User configuration: which local plugins exist, and what was chosen last time.
 *
 * Everything machine-specific lives in this file rather than in the source.
 * That is what lets the tool ship without a single path baked into it: a
 * plugin's location is something the person running it points at once, and
 * the file that remembers it is theirs, not ours.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
 * @property {string} workspace - folder dsh opens as the workspace.
 */

/**
 * @typedef {object} Config
 * @property {RegisteredPlugin[]} plugins
 * @property {Choices} last
 * @property {string} source - registry source: 'auto', 'official' or 'mirror'.
 */

/** Shipped empty on purpose: a published build must know nothing about any machine. */
export const EMPTY_CONFIG = {
  plugins: [],
  last: { version: '', sandbox: '', plugins: [], importSignIn: true, workspace: '' },
  source: 'auto',
}

/** The registry choices the config accepts; anything else falls back to 'auto'. */
export const SOURCE_CHOICES = ['auto', 'official', 'mirror']

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {Config}
 */
export function readConfig(layout) {
  if (!existsSync(layout.config)) return structuredClone(EMPTY_CONFIG)
  try {
    const raw = JSON.parse(readFileSync(layout.config, 'utf8'))
    return {
      plugins: Array.isArray(raw.plugins) ? raw.plugins.filter(isPluginShaped) : [],
      last: { ...EMPTY_CONFIG.last, ...(raw.last ?? {}) },
      source: SOURCE_CHOICES.includes(raw.source) ? raw.source : 'auto',
    }
  } catch {
    // A configuration file that cannot be parsed must not stop the tool from
    // starting; the worst case is the user re-picking their options once.
    return structuredClone(EMPTY_CONFIG)
  }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {Config} config
 */
export function writeConfig(layout, config) {
  writeFileSync(layout.config, `${JSON.stringify(config, null, 2)}\n`)
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
  const path = cleanPath(dir)
  const manifestPath = join(path, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`${path} 里没有 package.json`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`读不了 ${manifestPath}:${error.message}`)
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`${manifestPath} 里没写包名`)
  }
  const entryId = safeName(id ?? manifest.name)
  if (entryId === '') throw new Error(`无法从 ${manifest.name} 推出 id`)
  return { id: entryId, package: manifest.name, path, label: manifest.name }
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
