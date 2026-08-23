/**
 * Two primitives for changing a file that more than one process may be changing.
 *
 * They were written for the configuration file and lived there. They moved here
 * when a second caller appeared — the cabinet ledger — and the reason is worth
 * stating: the two mechanisms are not interchangeable and neither covers the
 * other, so a second copy would eventually have had one of them and not the
 * other.
 *
 * - **the lock** keeps two read-alter-write cycles from interleaving, which is
 *   what stops an update from being lost;
 * - **the atomic rename** keeps a reader from ever seeing half a file, which is
 *   what stops the corruption a lock cannot prevent — a process killed mid-write.
 *
 * Not invented here: an exclusive create plus staleness, and a temp file renamed
 * into place, are what git and npm do to the same files.
 */

import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { instantNow } from './clock.js'

/**
 * Write by another name, then take the name over.
 *
 * A direct `writeFileSync` is not one step: the file is truncated, then filled.
 * Anything reading in between sees an empty or half-written file — and this
 * tool's answer to an unreadable state file is to refuse, so a reader catching
 * that window would stop rather than proceed. Rename within a directory is
 * atomic, so a reader sees either the old file or the new one.
 * @param {string} file
 * @param {string} text
 */
export function writeAtomic(file, text) {
  const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    writeFileSync(temp, text)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** How long before a lock is assumed to belong to a process that died holding it. */
export const LOCK_STALE_MS = 10_000

/** How long to wait for somebody else's turn before giving up. */
export const LOCK_WAIT_MS = 5_000

/**
 * Hold one file against this tool's other processes for the length of one change.
 *
 * ⚠️ A lock between *this tool's own processes*, and nothing more. It does not
 * stop a person editing the file in an editor, and it is not supposed to: this
 * computer is theirs. What it covers is the case the design created — since the
 * config window became a caller of the command line rather than a second
 * implementation of it, every button on that page is its own process, so two
 * writers is the ordinary case rather than a rare one.
 *
 * A stale lock is taken over rather than waited on forever, because the holder
 * may have been killed; the pid and time inside are there so a person can see
 * whose it was.
 * @template T
 * @param {string} file - the file being guarded; the lock sits beside it.
 * @param {() => T} work
 * @returns {T}
 */
export function withFileLock(file, work) {
  const lock = `${file}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      // Exclusive create is the one operation the filesystem makes indivisible
      // for us: whoever's call succeeds is the holder, with no window between
      // checking and taking.
      writeFileSync(lock, `${process.pid} ${instantNow()}\n`, { flag: 'wx' })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const held = statSync(lock, { throwIfNoEntry: false })
      if (held === undefined) continue
      if (Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        rmSync(lock, { force: true })
        continue
      }
      if (Date.now() > deadline) {
        throw new BoxError('CONFIG_BUSY', t('config.busy', { seconds: LOCK_WAIT_MS / 1000, lock }), { lock })
      }
      sleepSync(50)
    }
  }
  try {
    return work()
  } finally {
    rmSync(lock, { force: true })
  }
}

/**
 * Wait without an event loop turn — the callers here are synchronous top to
 * bottom, and making them async to sleep would change every one of them.
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
