/**
 * Times, written once, in a form both a person and a program can read.
 *
 * ⛔⛔ **This file exists because `toISOString()` was being used to render.**
 * That method always answers in UTC, and the code sliced the time out of it and
 * printed it bare — so on a machine at UTC+8 a download begun at 22:11 wrote
 * `14:11` into its own progress log, and the launch log for it was filed under
 * `2026-08-23_13-39-26_start.log`. Nothing was wrong with the clock; the eight
 * hours were shaved off on the way to the screen.
 *
 * ⭐⭐ **UTC was never the requirement — being unambiguous was.** A stored
 * instant has to survive a machine changing timezone, a daylight-saving step,
 * and being read somewhere else; that needs the offset written down, not the
 * offset being zero. `2026-08-23T22:11:06+08:00` says exactly one moment *and*
 * says what the wall clock read, so the thing a program parses and the thing a
 * person reads are the same characters. Storing `…14:11:06Z` and then printing
 * something else was two representations of one fact, which is the shape most of
 * this tool's bugs have had.
 *
 * ⛔ **One exception, and it is not ours to decide.** `src/workspaces.js` writes
 * dsh's own `workspace.json`. Its schema is only `z.string()` — checked, it would
 * accept anything — but **dsh itself writes `new Date().toISOString()`** there,
 * and a table where half the rows carry an offset and half do not is a table we
 * made inconsistent. Same rule as everywhere else here: follow the data format,
 * not the code.
 *
 * ⛔ Built from `Date` fields rather than `toLocaleString`: locale forms differ by
 * machine and by language setting, so one data directory would read differently
 * on two computers, and stamps that end up in filenames have to keep sorting the
 * way they read.
 */

/**
 * @param {number} value
 * @param {number} [width]
 * @returns {string}
 */
function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

/**
 * This machine's offset from UTC, as ISO writes it: `+08:00`, `-05:00`, `Z`.
 *
 * ⚠️ `getTimezoneOffset` counts the other way round — minutes to *add* to local
 * time to reach UTC — so UTC+8 answers -480. The sign is flipped here once, on
 * purpose, rather than at each call site.
 * @param {Date} at
 * @param {string} [separator]
 * @returns {string}
 */
function offsetOf(at, separator = ':') {
  const minutes = -at.getTimezoneOffset()
  if (minutes === 0) return 'Z'
  const sign = minutes < 0 ? '-' : '+'
  const size = Math.abs(minutes)
  return `${sign}${pad(Math.floor(size / 60))}${separator}${pad(size % 60)}`
}

/**
 * The moment, written down: `2026-08-23T22:11:06.276+08:00`.
 *
 * What goes into a record on disk. Valid ISO 8601, so `new Date()` parses it
 * exactly, and legible without conversion because it is the local wall clock.
 * @param {Date} [at]
 * @returns {string}
 */
export function instantNow(at = new Date()) {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
    + `.${pad(at.getMilliseconds(), 3)}${offsetOf(at)}`
}

/**
 * The wall-clock time of day, to the second: `22:11:06`.
 *
 * The prefix on every line of a progress log — read while something is still
 * running, and compared against the clock in the corner of the screen. No offset
 * here: nothing parses these, and a date nobody asked for is noise.
 * @param {Date} [at]
 * @returns {string}
 */
export function clockNow(at = new Date()) {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * A local moment safe inside a filename, still sorted by name:
 * `2026-08-23_22-11-06`.
 *
 * ⭐ Units descend from largest to smallest, so listing alphabetically is
 * listing chronologically — which `latestLog` relies on.
 * @param {Date} [at]
 * @returns {string}
 */
export function stampNow(at = new Date()) {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + `_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
}

/**
 * The local calendar date, digits only: `20260823`.
 *
 * For a date that becomes part of a name a person says out loud — a new sandbox
 * is `box-<this>-1`. ⛔ Local, because otherwise for the eight hours after
 * midnight in UTC+8 a sandbox made today is named yesterday.
 * @param {Date} [at]
 * @returns {string}
 */
export function dateNow(at = new Date()) {
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
}

/**
 * A stored instant, laid out for reading: `2026-08-23 22:11:06`.
 *
 * Works on both forms — the offset ones this tool writes now, and the `…Z` ones
 * already on disk from before, plus whatever dsh's own files carry — because all
 * three are ISO and `Date` knows what to do with them. The rendering is local
 * either way, which is the point: an old record and a new one line up on screen.
 *
 * ⚠️ Anything unparseable comes back untouched. These strings arrive from files a
 * person may have edited, and text that cannot be read as a date is more useful
 * on screen than `Invalid Date` — it is the only clue left.
 * @param {unknown} instant
 * @returns {string}
 */
export function showInstant(instant) {
  if (typeof instant !== 'string' || instant === '') return ''
  const at = new Date(instant)
  if (Number.isNaN(at.getTime())) return instant
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + ` ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}
