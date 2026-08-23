/**
 * Launch logs: what dsh itself said, kept on disk.
 *
 * A sandbox started from the command line outlives the command that started
 * it, so there is no longer anyone holding its output when it matters. Worse,
 * the machine-readable mode used to silence the child entirely, which meant a
 * failed launch reported an exit code and nothing else — the `--no-open` bug
 * that stopped two releases from booting at all hid behind exactly that.
 *
 * So the child writes to a file, always, and failures quote the end of it.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { clockNow, stampNow } from './clock.js'

/**
 * Add one line to a log, timestamped, without ever failing the caller.
 *
 * A log that cannot be written is a nuisance; a download that dies because its
 * log could not be written is a bug.
 * @param {string} file
 * @param {string} line
 */
export function appendLog(file, line) {
  try {
    // ⛔ The machine's own clock, not UTC. This prefix is compared against the
    // clock in the corner of somebody's screen while a download is still
    // running; `toISOString().slice(11,19)` put it eight hours in the past.
    appendFileSync(file, `${clockNow()} ${line}\n`)
  } catch {
    // Deliberately silent: see above.
  }
}

/** Launch logs kept per sandbox. Older ones are deleted, newest first. */
export const KEEP_LOGS = 20

/**
 * Path for a new launch log, with the directory made and old logs pruned.
 *
 * A directory rather than a sandbox is asked for because booting the user's
 * real home is not a sandbox and must not be made to look like one: naming a
 * sandbox to hold those logs would create it, and it would then show up in
 * every listing as a sandbox nobody made.
 *
 * Pruning happens here rather than on a timer because this is the only moment
 * the count can grow, and an unbounded log directory is a disk leak the user
 * has no reason to ever look for.
 * @param {string} dir - directory to keep the logs in.
 * @param {string} [label] - what this launch is, for the file name.
 * @returns {string} the file to write to.
 */
export function newLaunchLog(dir, label = 'start') {
  mkdirSync(dir, { recursive: true })
  prune(dir, KEEP_LOGS - 1)
  // Local as well: this name is how a person finds the launch they are thinking
  // of, and `prune`/`latestLog` still sort by it because the units descend.
  return join(dir, `${stampNow()}_${label.replace(/[^\w.-]+/g, '-')}.log`)
}

/**
 * Where the progress of downloading or deleting one release is written.
 *
 * Downloading takes about two minutes, most of it spent resolving a graph
 * without writing anything, so an entrance that simply waits has nothing to
 * show and no way to tell work from a hang. The window used to solve that with
 * job ids it polled, and the command line solved it by printing as it went —
 * two mechanisms for one question. Now there is a file, and both read it.
 *
 * Named after the release rather than the moment, so a caller that knows which
 * release it asked about knows where to look without being told. Kept in a
 * sub-directory so that `latestLog`, which does not recurse, keeps answering
 * about launches when asked about launches.
 * @param {string} boxRoot - the data directory.
 * @param {string} version
 * @returns {string}
 */
export function versionLog(boxRoot, version) {
  return join(boxRoot, 'logs', 'versions', `${version.replace(/[^\w.-]+/g, '-')}.log`)
}

/**
 * The same path, emptied and ready to be written to.
 * @param {string} boxRoot
 * @param {string} version
 * @returns {string}
 */
export function newVersionLog(boxRoot, version) {
  const file = versionLog(boxRoot, version)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '')
  return file
}

/**
 * Where the progress of downloading one plugin package is written.
 *
 * The same arrangement as {@link versionLog}, for the same reason: fetching a
 * big aggregate (390 packages) takes minutes, most of them spent by npm
 * resolving a graph in silence, so an entrance that simply waits cannot tell
 * work from a hang. Named after the package rather than the moment, so whoever
 * asked for the install already knows where to look — which is what lets the
 * config window watch a download it did not perform. Kept in its own
 * sub-directory for the same reason the version logs are.
 * @param {string} boxRoot - the data directory.
 * @param {string} name - the package name, `@scope/` and all.
 * @returns {string}
 */
export function packageLog(boxRoot, name) {
  return join(boxRoot, 'logs', 'packages', `${name.replace(/[^\w.-]+/g, '-')}.log`)
}

/**
 * The same path, emptied and ready to be written to.
 * @param {string} boxRoot
 * @param {string} name
 * @returns {string}
 */
export function newPackageLog(boxRoot, name) {
  const file = packageLog(boxRoot, name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '')
  return file
}

/**
 * Keep only the newest `keep` files in a directory.
 * @param {string} dir
 * @param {number} keep
 */
function prune(dir, keep) {
  let entries
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
  } catch {
    // An unreadable log directory must not stop a launch.
    return
  }
  for (const stale of entries.slice(Math.max(keep, 0))) {
    rmSync(join(dir, stale.name), { force: true })
  }
}

/**
 * The newest log in a directory, or null.
 *
 * ⛔ The suffix is not decoration. A main-environment launch writes its log into
 * the data directory, beside `actions.log` — which every single command appends
 * to, so it is always the newest `.log` there and `logs --main` answered with
 * the journal instead of with what dsh said. **Found by running it**; nothing in
 * the code suggested those two files would ever share a folder.
 * @param {string} dir
 * @param {string} [suffix] - narrow it to one kind of log.
 * @returns {string | null}
 */
export function latestLog(dir, suffix = '.log') {
  if (!existsSync(dir)) return null
  try {
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith(suffix))
      .map((name) => ({ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0]
    return newest?.path ?? null
  } catch {
    return null
  }
}

/**
 * Every log in a directory, newest first.
 * @param {string} dir
 * @param {string} [suffix] - narrow it to one kind of log.
 * @returns {{file: string, bytes: number, at: string}[]}
 */
export function listLogs(dir, suffix = '.log') {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(suffix))
      .map((name) => {
        const stats = statSync(join(dir, name))
        return { file: join(dir, name), bytes: stats.size, at: new Date(stats.mtimeMs).toISOString() }
      })
      .sort((a, b) => b.at.localeCompare(a.at))
  } catch {
    return []
  }
}

/**
 * Lines that look like something went wrong.
 *
 * A guess, and said to be one wherever it is reported: this tool does not
 * control what dsh writes, so there is no marker to rely on. Being a guess is
 * acceptable because it only decides what gets shown first — the whole file
 * stays one flag away.
 */
const TROUBLE = /error|exception|fail|refus|cannot|unable|EADDRINUSE|ENOENT|错误|失败|拒绝|无法/i

/**
 * Describe a log without reading it out.
 *
 * The answer is a few hundred characters whatever the file weighs, which is
 * the point: a caller decides whether the contents are worth its attention
 * before spending any of it. A dsh that has served for hours has written more
 * than anyone wants to receive by accident.
 * @param {string | null} file
 * @returns {{file: string, bytes: number, lines: number, modifiedAt: string, troubleLines: number, lastLine: string} | null}
 */
export function logShape(file) {
  if (file === null || !existsSync(file)) return null
  const stats = statSync(file)
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  return {
    file,
    bytes: stats.size,
    lines: lines.length,
    modifiedAt: new Date(stats.mtimeMs).toISOString(),
    troubleLines: lines.filter((line) => TROUBLE.test(line)).length,
    lastLine: lines.at(-1) ?? '',
  }
}

/**
 * Lines that look like trouble, each with a little of what surrounded it.
 * @param {string} file
 * @param {number} [context] - lines to keep either side.
 * @returns {string[]}
 */
export function troubleLines(file, context = 3) {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const keep = new Set()
  lines.forEach((line, index) => {
    if (!TROUBLE.test(line)) return
    for (let n = index - context; n <= index + context; n += 1) {
      if (n >= 0 && n < lines.length) keep.add(n)
    }
  })
  return [...keep].sort((a, b) => a - b).map((n) => lines[n]).filter((line) => line.trim() !== '')
}

/** Lines returned when a caller does not say how many it wants. */
export const DEFAULT_LINES = 50

/**
 * Characters returned when a caller does not say otherwise.
 *
 * A budget in characters as well as lines because a line has no maximum: one
 * line of serialized state can be longer than fifty ordinary ones, and a
 * limit that only counts lines does not limit anything.
 */
export const DEFAULT_CHARS = 4000

/**
 * Read the end of a log, within a budget, saying what was left out.
 *
 * Never truncates quietly. A tool of ours once cut a list off at fifty
 * entries with no marker of any kind, and every conclusion drawn from it was
 * wrong while nothing anywhere reported a problem. Silence is the failure
 * mode; an ugly notice is not.
 * @param {string} file
 * @param {object} [options]
 * @param {number} [options.lines]
 * @param {number} [options.chars]
 * @returns {{lines: string[], totalLines: number, omittedLines: number, limitedBy: string | null}}
 */
export function readTail(file, { lines = DEFAULT_LINES, chars = DEFAULT_CHARS } = {}) {
  const all = existsSync(file)
    ? readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '')
    : []
  let kept = all.slice(-lines)
  let limitedBy = kept.length < all.length ? 'lines' : null
  while (kept.length > 1 && kept.join('\n').length > chars) {
    kept = kept.slice(1)
    limitedBy = 'chars'
  }
  return { lines: kept, totalLines: all.length, omittedLines: all.length - kept.length, limitedBy }
}

/** How much of a log file's end is ever read into memory. */
const TAIL_BYTES = 256 * 1024

/**
 * The last lines of a log file.
 *
 * Only the end of the file is read: a dsh that has been serving for hours has
 * written far more than anyone wants in memory, and the interesting part of a
 * failure is always at the end.
 * @param {string} file
 * @param {number} [count]
 * @returns {string[]} lines, oldest first; empty when there is no file.
 */
export function tailLines(file, count = 30) {
  if (!existsSync(file)) return []
  let text
  try {
    const size = statSync(file).size
    const from = Math.max(size - TAIL_BYTES, 0)
    const buffer = readFileSync(file)
    text = buffer.subarray(from).toString('utf8')
  } catch {
    return []
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  return lines.slice(-count)
}
