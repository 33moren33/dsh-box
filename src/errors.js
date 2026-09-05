/**
 * Failures that carry a code alongside their sentence.
 *
 * The sentence is written for a person and is expected to be reworded,
 * translated, or softened at any time. A script reading that sentence to work
 * out what went wrong therefore breaks on a copy edit, silently, and the only
 * alternative left to it is to treat every failure the same — which is what
 * this tool did before: one exit code, one line of prose, and no way to tell
 * "that folder holds no plugin" from "that sandbox is already running", even
 * though the right next move is completely different.
 *
 * So each failure carries a short constant as well. The constant is the
 * promise; the sentence is free to change.
 */

/** Failure with a stable machine-readable code. */
export class BoxError extends Error {
  /**
   * @param {string} code - stable identifier, never translated or reworded.
   * @param {string} message - the sentence shown to a person.
   * @param {Record<string, unknown>} [details] - extra fields worth reporting.
   * @param {{partial?: boolean}} [how] - `partial` when real work was done
   * before the refusal: the caller must not read this as "nothing happened",
   * and `details` must say what was done.
   */
  constructor(code, message, details = {}, { partial = false } = {}) {
    super(message)
    this.name = 'BoxError'
    this.code = code
    this.details = details
    this.partial = partial
  }
}

/**
 * The four verdicts, and the exit code each one projects to.
 *
 * ⭐ The verdict is the answer; the exit code is one view of it. The same
 * verdict travels in the `--json` line as `verdict`, and later in a tool
 * response, so a caller never has to infer the tier from a code list.
 *
 *   ok       0  answered
 *   failed   1  a judgement **about the thing asked about** — the sandbox is
 *               not there, dsh did not boot, the gate refused; the request was
 *               fine and the world said no
 *   error    2  this tool, or the request: unknown command, wrong flag, a
 *               crash, something it cannot reach. ⛔ Says nothing about any
 *               sandbox or cabinet
 *   partial  3  answered half: work was done, then a refusal; the answer
 *               names what was done
 *
 * ⛔ Why `1` and `2` must not share: an uncaught bug used to exit 1, and 1 in
 * a caller's table meant "the sandbox failed". A bug in this tool produced a
 * verdict about somebody else's software.
 */
export const VERDICT_EXIT = { ok: 0, failed: 1, error: 2, partial: 3 }

/**
 * Codes that are about the request or this tool, never about a sandbox.
 *
 * Everything else a {@link BoxError} carries is a judgement about the thing
 * asked about, so the default tier for a BoxError is `failed`. Listed here
 * rather than tagged at each throw site so the split can be read in one place.
 */
const REQUEST_CODES = new Set([
  'UNKNOWN_COMMAND', 'MISSING_ARGUMENT', 'MISSING_VALUE', 'BAD_FLAG', 'UNKNOWN_FLAG',
  'FLAG_NOT_HERE', 'FLAG_TWICE', 'JSON_SCHEMA_UNKNOWN', 'UNKNOWN_SETTING', 'BAD_SETTING_VALUE',
  'BAD_SANDBOX_NAME', 'BAD_PLUGIN_ID', 'BAD_PACKAGE_NAME', 'BAD_PID', 'NO_PACKAGE_NAME',
  'MAIN_IS_THE_SOURCE', 'SAME_WORKSPACE',
  // This tool cannot reach what it needs on this machine.
  'PATH_NO_POWERSHELL', 'PATH_REGISTRY_REFUSED', 'PATH_WRITE_MISMATCH', 'PATH_KIND_CHANGED',
  'PATH_UNSUPPORTED', 'PATH_NO_EXE', 'NO_PANEL', 'CONFIG_BUSY',
])

/**
 * Which verdict a thrown value stands for.
 *
 * Anything that is not a {@link BoxError} is a bug or a system failure and is
 * `error`: it must never be reported as a judgement about a sandbox.
 * @param {unknown} error
 * @returns {'failed' | 'error' | 'partial'}
 */
export function verdictOf(error) {
  if (!(error instanceof BoxError)) return 'error'
  if (error.partial === true) return 'partial'
  return REQUEST_CODES.has(error.code) ? 'error' : 'failed'
}

/**
 * The code to report for any thrown value.
 *
 * Anything that did not come from {@link BoxError} — a failed file read, a
 * bug in this tool — is reported as `ERROR` rather than being given a guessed
 * code. A wrong code is worse than a vague one, because a caller acts on it.
 * @param {unknown} error
 * @returns {string}
 */
export function errorCode(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code
  return typeof code === 'string' && code !== '' ? code : 'ERROR'
}

/**
 * Extra fields a failure wants reported, if it carries any.
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
export function errorDetails(error) {
  const details = /** @type {{details?: unknown}} */ (error)?.details
  return details !== null && typeof details === 'object' ? /** @type {Record<string, unknown>} */ (details) : {}
}
