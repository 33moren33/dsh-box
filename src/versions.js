/**
 * What is on disk in the version store.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { versionDir } from './paths.js'
import { verifyPinned } from './registry.js'

/**
 * @typedef {object} DownloadedVersion
 * @property {string} version
 * @property {string} dir
 * @property {boolean} pinned - every release package really is this version.
 * @property {number} packages - release packages found on disk.
 * @property {number | null} sizeMb - directory size, or null while still counting.
 */

/**
 * Every downloaded release, newest version string first.
 *
 * `pinned` is recomputed from the installed manifests rather than trusted
 * from a note written at download time, because the only failure that matters
 * here — a launcher on one release sitting on another release's plugins — is
 * invisible everywhere except in those manifests.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {DownloadedVersion[]}
 */
export function downloadedVersions(layout) {
  if (!existsSync(layout.versions)) return []
  return readdirSync(layout.versions)
    .filter((entry) => statSync(join(layout.versions, entry)).isDirectory())
    .map((version) => {
      const dir = versionDir(layout, version)
      const report = verifyPinned(dir, version)
      return { version, dir, pinned: report.ok, packages: report.checked, sizeMb: versionSizeMb(dir) }
    })
    .filter((entry) => entry.packages > 0)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} version
 * @returns {boolean}
 */
export function isDownloaded(layout, version) {
  return downloadedVersions(layout).some((entry) => entry.version === version)
}

/**
 * Delete one downloaded release entirely.
 *
 * Sandboxes are untouched — their conversations and settings live in their
 * own homes — but a sandbox that last booted this release will need it
 * downloaded again before its next start. The caller is responsible for
 * refusing while a running sandbox is on this release.
 * Deletion is async and reports a heartbeat for the same reason install
 * does: a release tree is tens of thousands of files, Windows takes its
 * time, and silence is indistinguishable from a hang.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} version
 * @param {(line: string) => void} [onLog]
 */
export async function deleteVersion(layout, version, onLog) {
  const dir = versionDir(layout, version)
  if (!existsSync(dir)) throw new Error(`${version} 本来就没下载`)
  const mb = versionSizeMb(dir)
  onLog?.(`正在删除 ${version}${mb === null ? '' : `,约 ${mb} MB`}…`)
  const started = Date.now()
  const beat = setInterval(() => {
    onLog?.(`还在删,已 ${Math.round((Date.now() - started) / 1000)} 秒`)
  }, 3000)
  try {
    await rm(dir, { recursive: true, force: true })
  } finally {
    clearInterval(beat)
  }
  onLog?.(`${version} 已删除`)
}

/** Where a version directory's measured size is remembered. */
const SIZE_CACHE = '.size.json'

/** Directories currently being measured, so a poll cannot start the walk twice. */
const sizing = new Set()

/**
 * The size of one version directory in whole megabytes.
 *
 * A release tree holds tens of thousands of files, and walking it takes
 * seconds — too slow for a state poll. So the walk happens once, in the
 * background, and the result is cached in the directory itself. That is safe
 * because an installed release never changes: it is written once by install
 * and only ever deleted whole. Until the first walk finishes this returns
 * null, and the window shows the size when it has one.
 * @param {string} dir - a downloaded release directory.
 * @returns {number | null}
 */
export function versionSizeMb(dir) {
  const cache = join(dir, SIZE_CACHE)
  if (existsSync(cache)) {
    try {
      const mb = JSON.parse(readFileSync(cache, 'utf8')).mb
      if (Number.isFinite(mb)) return mb
    } catch {
      // An unreadable cache is re-measured below.
    }
  }
  if (!sizing.has(dir)) {
    sizing.add(dir)
    directorySize(dir)
      .then((bytes) => writeFileSync(cache, `${JSON.stringify({ mb: Math.round(bytes / 1048576) })}\n`))
      .catch(() => {})
      .finally(() => sizing.delete(dir))
  }
  return null
}

/**
 * Total bytes under a directory. Symbolic links are counted as themselves
 * rather than followed — following one would count another release's files.
 * @param {string} dir
 * @returns {Promise<number>}
 */
async function directorySize(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(path)
    else if (entry.isFile()) total += (await stat(path)).size
  }
  return total
}
