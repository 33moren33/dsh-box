/**
 * Run every acceptance script, on throwaway data, in one command.
 *
 * These checks existed but `npm test` pointed at a `tests/` directory that has
 * never existed — so the repository shipped with a test command that fails on
 * sight, and the checks only ever ran when somebody remembered their argument
 * conventions. Both of those are the same problem: a thing that has to be
 * remembered is a thing that will be skipped.
 *
 * ⛔ Nothing here touches the real `~/.dsh`, the installed dsh, or the network.
 * Every check drives a few-line stand-in for dsh; the one that needs a real
 * installation only ever reads one it builds itself. Boxes are made fresh
 * because two of the checks consume what they are given: `check-host-dsh`
 * deletes a version on purpose, and `check-one-face` leaves sandboxes behind.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {boolean} whether it passed.
 */
function run(script, args) {
  const result = spawnSync(process.execPath, [join(HERE, script), ...args], {
    cwd: ROOT, stdio: 'inherit', windowsHide: true,
  })
  return result.status === 0
}

/** A disposable data directory with the dsh stand-ins already in it. */
function freshBox(label) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-box-${label}-`))
  const made = spawnSync(process.execPath, [join(HERE, 'make-test-box.mjs'), dir, '--broken'], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
  })
  if (made.status !== 0) throw new Error(`造不出测试盒:${dir}`)
  return { dir, data: join(dir, 'data') }
}

const disposable = []
const failed = []

try {
  // Reads only the message table, so it needs nothing on disk and is put
  // first: a missing translation should be the first thing anyone hears
  // about, not something found after nine slower checks.
  if (!run('check-messages.mjs', [])) failed.push('check-messages')

  // One box for the two that can share it, in the order that leaves the
  // consuming one last.
  const shared = freshBox('face')
  disposable.push(shared.dir)
  if (!run('check-one-face.mjs', [shared.data])) failed.push('check-one-face')
  if (!run('check-main-ledger.mjs', [shared.data])) failed.push('check-main-ledger')
  if (!run('check-host-dsh.mjs', [shared.data])) failed.push('check-host-dsh')

  // Its own box: it starts a sandbox, deletes that sandbox's ledger on purpose,
  // and leaves the sandbox behind.
  const evidence = freshBox('evidence')
  disposable.push(evidence.dir)
  if (!run('check-running-evidence.mjs', [evidence.data])) failed.push('check-running-evidence')

  // Its own box: it asserts on a data directory nothing has ever attached to,
  // which is only true the first time.
  const agent = freshBox('agent')
  disposable.push(agent.dir)
  if (!run('check-agent-view.mjs', [agent.data])) failed.push('check-agent-view')

  const scoped = mkdtempSync(join(tmpdir(), 'dsh-box-scoped-'))
  disposable.push(scoped)
  if (!run('check-scoped-link.mjs', [scoped])) failed.push('check-scoped-link')

  // Makes its own workspaces and cleans up after itself; needs a directory
  // rather than a box, because it is what puts the box there.
  const mounts = mkdtempSync(join(tmpdir(), 'dsh-box-mounts-'))
  disposable.push(mounts)
  if (!run('check-plugin-mounts.mjs', [mounts])) failed.push('check-plugin-mounts')

  // Also builds its own box, and breaks the config inside it on purpose, so it
  // cannot be handed one anything else is still reading.
  const config = mkdtempSync(join(tmpdir(), 'dsh-box-config-'))
  disposable.push(config)
  if (!run('check-config-safety.mjs', [config])) failed.push('check-config-safety')

  // Also builds its own box and its own throwaway `DSH_HOME`, and corrupts the
  // latter on purpose.
  const cabinets = mkdtempSync(join(tmpdir(), 'dsh-box-workspaces-'))
  disposable.push(cabinets)
  if (!run('check-workspaces.mjs', [cabinets])) failed.push('check-workspaces')

  // Builds two boxes of its own, one of which it deliberately drives with the
  // losing implementation, so it cannot share with anything.
  const newborn = mkdtempSync(join(tmpdir(), 'dsh-box-newborn-'))
  disposable.push(newborn)
  if (!run('check-new-sandbox.mjs', [newborn])) failed.push('check-new-sandbox')
} finally {
  for (const dir of disposable) rmSync(dir, { recursive: true, force: true })
}

console.log(failed.length === 0
  ? '\n全部验收通过\n'
  : `\n不通过:${failed.join('、')}\n`)
process.exit(failed.length === 0 ? 0 : 1)
