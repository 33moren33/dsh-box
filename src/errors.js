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
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'BoxError'
    this.code = code
    this.details = details
  }
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
