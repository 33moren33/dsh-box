/**
 * An empty stand-in for the daily filing cabinet, for suites to point at.
 *
 * ⛔⛔ **Why this exists at all.** `userDshHome()` answers `~/.dsh` unless
 * `DSH_HOME` says otherwise, so any suite that does not say otherwise is reading
 * **the cabinet belonging to whoever is running the tests**. That was harmless
 * for as long as the plugin list was a registry stored in the box's own config —
 * nothing looked outside. The moment the list became something *worked out from
 * the cabinets* (2026-08-28), those suites started counting whatever plugins the
 * developer happens to have: 3 on the machine it was found on, 0 on CI.
 *
 * ⭐⭐ The judgement this file exists to remove from human memory: **a suite that
 * reads anything outside its own scratch directory is a suite that passes for a
 * reason nobody wrote down.** It had already bitten this repository twice —
 * three assertions that only held on a Chinese machine (`21a5f45`), and six in
 * `check-aggregate` that only failed on a machine which happened to have a
 * particular git checkout on it. Both were read as platform differences.
 *
 * ⭐ One line, not per-spawn. The child processes here are started without an
 * `env` of their own, so they inherit this one — setting it once at the top of a
 * suite covers every command that suite will ever run, including ones added
 * later. Per-spawn wiring would be the same shape of rule this repository has
 * been bitten by before: one that has to be repeated, and so will be missed.
 *
 * ⛔ Call it **after** the suite wipes its scratch root, or the directory made
 * here goes with it.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Point this process — and everything it spawns — at an empty daily cabinet.
 * @param {string} root - the suite's disposable directory.
 * @returns {string} the fake home, for suites that want to look inside it.
 */
export function useFakeDaily(root) {
  const home = join(root, 'daily-home')
  mkdirSync(home, { recursive: true })
  // ⛔ `DSH_HOME` is read through `process.env` at the moment of asking, never
  // captured at import time, so setting it here reaches code already loaded.
  process.env.DSH_HOME = home
  return home
}
