/**
 * What is on disk in the version store.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { removeTree, versionDir } from './paths.js'
import { verifyPinned } from './registry.js'
import { runningSandboxes } from './sandbox.js'

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
      return {
        version, dir, pinned: report.ok, packages: report.checked,
        sizeMb: versionSizeMb(dir, report.checked),
      }
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
 * downloaded again before its next start.
 *
 * Refusing while a sandbox is running on this release is done here rather
 * than left to the caller. It used to say "the caller is responsible", and
 * one of the two callers was not: the window checked and the command line did
 * not, so deleting a release out from under a running sandbox worked and
 * reported success. A guard that has to be remembered in every entrance is a
 * guard that will be missing from one of them.
 *
 * Deletion is async and reports a heartbeat for the same reason install
 * does: a release tree is tens of thousands of files, Windows takes its
 * time, and silence is indistinguishable from a hang.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} version
 * @param {(line: string) => void} [onLog]
 */
export async function deleteVersion(layout, version, onLog) {
  const dir = versionDir(layout, version)
  if (!existsSync(dir)) {
    throw new BoxError('VERSION_NOT_DOWNLOADED', t('version.notDownloadedAlready', { version }), { version })
  }
  // Only a sandbox running *this* download blocks the delete. One running on
  // the user's own installation may well report the same version number while
  // having nothing to do with this directory, and refusing then would be a
  // guard objecting to something that is not happening. Records written before
  // installations were told apart were all downloads, so they still count.
  const busy = runningSandboxes(layout).find((entry) => (
    entry.version === version && (entry.engine === undefined || entry.engine.kind === 'release')
  ))
  if (busy !== undefined) {
    throw new BoxError(
      'VERSION_IN_USE',
      t('version.inUse', { sandbox: busy.sandbox, version, pid: busy.pid }),
      { version, sandbox: busy.sandbox, pid: busy.pid },
    )
  }
  const mb = versionSizeMb(dir, verifyPinned(dir, version).checked)
  onLog?.(mb === null ? t('version.deleting', { version }) : t('version.deletingSized', { version, mb }))
  const started = Date.now()
  const beat = setInterval(() => {
    onLog?.(t('version.stillDeleting', { seconds: Math.round((Date.now() - started) / 1000) }))
  }, 3000)
  try {
    // ⛔ Not `fs.rm` — see {@link removeTree}. A data directory under a path
    // with any non-ASCII character in it (a user called 张三 is enough) makes
    // the built-in recursive delete do nothing at all, and say nothing.
    removeTree(dir)
  } finally {
    clearInterval(beat)
  }
  onLog?.(t('version.deleted', { version }))
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
 * background, and the result is cached in the directory itself.
 *
 * Caching only holds while the release is finished, and a download is not:
 * the directory is created a full minute before npm writes the first file,
 * so a poll landing in that gap measured nothing and remembered zero for
 * good — observed on a real rc.6 whose cache was written one second after
 * the directory and 34 seconds before its first package. The package count
 * is what says which release this is a measurement of; when it no longer
 * matches, the old number is not this tree's and the walk runs again. A tree
 * with no packages in it yet is not measured at all.
 * @param {string} dir - a downloaded release directory.
 * @param {number} [packages] - release packages found in it just now.
 * @returns {number | null}
 */
export function versionSizeMb(dir, packages = 0) {
  const cache = join(dir, SIZE_CACHE)
  if (existsSync(cache)) {
    try {
      const remembered = JSON.parse(readFileSync(cache, 'utf8'))
      if (Number.isFinite(remembered.mb) && remembered.packages === packages) return remembered.mb
    } catch {
      // An unreadable cache is re-measured below.
    }
  }
  if (packages > 0 && !sizing.has(dir)) {
    sizing.add(dir)
    directorySize(dir)
      .then((bytes) => {
        const mb = Math.round(bytes / 1048576)
        writeFileSync(cache, `${JSON.stringify({ mb, packages })}\n`)
      })
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
