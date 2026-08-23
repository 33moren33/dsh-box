/**
 * This tool's record of which plugin rows it put in a filing cabinet.
 *
 * ## Why there is a ledger at all
 *
 * Every row this tool writes goes into a file that is not ours — the cabinet's
 * `cordis.patch.yml`, which dsh reads by itself and which a person, `dsh plugin
 * add`, and any number of other tools also write. Removing a plugin therefore
 * has to remove *exactly what we put in*, and nothing that looks similar. Some
 * record of "these ones are ours" is unavoidable.
 *
 * The record used to be in that file, as `# >>> dsh-box` marker comments around
 * our own block. That shape had one real virtue — two copies of a fact can
 * drift and one copy cannot — and it was given up on purpose (CEO 2026-08-23):
 * with the markers gone the YAML is a plain, portable list of plugins that can
 * be copied wholesale from a daily cabinet into a sandbox, and it stops being
 * one more piece of decoration in a file where decoration is already a common
 * cause of plugin conflicts.
 *
 * ⛔ **The cost is accepted, not solved: if this directory is lost, the rows
 * stay in the cabinet and become unattributed.** They keep loading; this tool
 * simply stops claiming them, and `uninstall` says it cannot rather than
 * guessing which rows were once ours. Guessing is the failure this whole module
 * exists to prevent — the rows we write are indistinguishable, by design, from
 * the rows anybody else writes.
 *
 * ## What the ledger is not
 *
 * ⛔ It is not the answer to "is this plugin installed". The cabinet's own file
 * is, always. The ledger only answers "did we put it there", and a row that has
 * since been deleted by hand is simply not ours to talk about any more — see
 * `cabinetPlugins` in `mounts.js`, which intersects the two.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { withFileLock, writeAtomic } from './file-lock.js'
import { cabinetLedgerFile } from './paths.js'

/** Bumped only if the shape changes in a way a previous build cannot read. */
const VERSION = 1

/**
 * @typedef {object} LedgerEntry
 * @property {string} id - the `id:` of the row we wrote.
 * @property {string} package - the `name:`, which is what dsh resolves.
 * @property {'link' | 'package'} kind - a folder linked in, or a package we
 * fetched into our own tree. This is what removal needs to know: only the first
 * has a link of ours to take away.
 * @property {string | null} path - where the folder is, for linked ones.
 * @property {string | null} [via] - the aggregate package this row came in with.
 * One npm package can be seventeen plugins, and this is what lets one
 * `uninstall` take the seventeen back out. The aggregate's own row names itself
 * here rather than holding null, so the family test is one comparison.
 * @property {string} at - ISO timestamp, so a person reading the file can tell
 * what happened when.
 */

/**
 * @typedef {object} LedgerProfile
 * @property {LedgerEntry[]} entries
 * @property {string[]} disabled - ids this tool has switched off with an
 * override row. ⭐ Kept apart from {@link LedgerEntry} because they are a
 * different kind of thing: an entry says "we put this row here", a disable says
 * "we wrote a row *against* somebody else's". Only what is listed here may be
 * switched back on — a row somebody else disabled is their decision, and
 * undoing it silently would be us overruling them.
 * @property {boolean} absorbedEmptyList - whether the `[]` dsh writes into a
 * brand-new profile patch is currently being held by us.
 * ⛔⛔ Not a detail. `[]` is a complete YAML document, so anything appended
 * after it makes a second one and dsh refuses to parse the file at all —
 * measured on a fresh sandbox plus any one plugin, on Windows and on Linux
 * alike, and the sandbox could never boot again. So it comes out while we have
 * rows in there and goes back when the last one leaves, and **the fact that we
 * are the ones holding it has to be written down somewhere**. It used to be a
 * comment in the file; this field is where it went.
 * @property {boolean} createdFile - whether the cabinet had no profile patch at
 * all until we wrote one.
 * ⛔⛔ The sister of the field above, and found the same way — by handing the
 * result to a real dsh. Removing our last row from a file **we** created left an
 * empty file behind, and dsh refuses an empty patch outright (*must be a
 * top-level YAML array of loader patch entries*), so that cabinet could never
 * boot again. Measured on 0.1.0-rc.7: an empty file exits 1, a file holding one
 * newline exits 1, **no file at all exits 0**. So a file we made goes away with
 * our last row — which is also the honest reading of "put it back the way it
 * was", since the way it was is that there was no file.
 */

/**
 * Everything recorded for one cabinet.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @returns {{version: number, home: string, profiles: Record<string, LedgerProfile>}}
 */
export function readLedger(layout, home) {
  const file = cabinetLedgerFile(layout, home)
  const blank = { version: VERSION, home, profiles: {} }
  if (!existsSync(file)) return blank
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return blank
    return { ...blank, ...raw, profiles: raw.profiles ?? {} }
  } catch {
    // ⚠️ An unreadable ledger reads as an empty one rather than as an error, and
    // the asymmetry is deliberate: empty means "we claim nothing", which makes
    // `uninstall` refuse and leaves every row where it is. The opposite default
    // — treating a damaged ledger as authority to delete — is the only way this
    // module could destroy something.
    return blank
  }
}

/**
 * What this tool put into one profile of one cabinet.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @param {string} profile
 * @returns {LedgerProfile}
 */
export function readLedgerProfile(layout, home, profile) {
  const record = readLedger(layout, home).profiles[profile]
  return {
    entries: Array.isArray(record?.entries) ? record.entries : [],
    disabled: Array.isArray(record?.disabled) ? record.disabled.filter((one) => typeof one === 'string') : [],
    absorbedEmptyList: record?.absorbedEmptyList === true,
    createdFile: record?.createdFile === true,
  }
}

/**
 * Change one profile's record, and the cabinet's plugin file, as one step.
 *
 * ⭐ The lock covers **both** files, not just this one. Registering a plugin is
 * read-patch, edit-patch, write-patch, write-ledger; two of those running
 * interleaved is how the ledger ends up describing a file that no longer
 * matches it. Every button in the config window is its own process, so two
 * writers is the ordinary case here rather than a rare one.
 * @template T
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @param {() => T} work
 * @returns {T}
 */
export function withCabinetLock(layout, home, work) {
  const file = cabinetLedgerFile(layout, home)
  mkdirSync(dirname(file), { recursive: true })
  return withFileLock(file, work)
}

/**
 * Write one profile's record back.
 *
 * ⛔ Must be called inside {@link withCabinetLock}: it is a read-alter-write of
 * a file the other profiles of the same cabinet share.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} home
 * @param {string} profile
 * @param {LedgerProfile} record
 */
export function writeLedgerProfile(layout, home, profile, record) {
  const file = cabinetLedgerFile(layout, home)
  const current = readLedger(layout, home)
  const profiles = { ...current.profiles }
  const disabled = record.disabled ?? []
  // A profile with nothing in it and nothing held is removed rather than left as
  // an empty object, so an untouched cabinet's file says so at a glance — and so
  // that "we have no record of this cabinet" and "we have an empty record of it"
  // stay the same thing.
  if (record.entries.length === 0 && disabled.length === 0 && !record.absorbedEmptyList) delete profiles[profile]
  else {
    profiles[profile] = {
      absorbedEmptyList: record.absorbedEmptyList,
      createdFile: record.createdFile === true,
      entries: record.entries,
      disabled,
    }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeAtomic(file, `${JSON.stringify({ ...current, version: VERSION, home, profiles }, null, 2)}\n`)
}
