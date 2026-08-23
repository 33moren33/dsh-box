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
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeTree } from '../src/paths.js'

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

  // Also static, also needs nothing on disk: the page's marks against the
  // command table. Second for the same reason the first one is first — a
  // control that will never light up should not be found after nine slow checks.
  if (!run('check-page-marks.mjs', [])) failed.push('check-page-marks')

  // Static too, and third for the same reason: a clock that renders in the wrong
  // timezone makes every log and every filename below it misleading, and none of
  // those checks would notice — they compare bytes, never meaning.
  if (!run('check-clock.mjs', [])) failed.push('check-clock')

  // Static as well: nobody has gone back to the built-in recursive calls. Runs
  // before the ones that need a disk, because every check below cleans up with
  // the replacement — a new caller of the built-in would make their cleanup a
  // lie rather than a failure.
  if (!run('check-no-recursive-fs.mjs', [])) failed.push('check-no-recursive-fs')

  // Reads embedded samples and, where they exist, real files on this machine —
  // but writes nothing anywhere. Early because everything that edits a user's
  // patch file stands on it.
  if (!run('check-patch-file.mjs', [])) failed.push('check-patch-file')

  // Builds a cabinet by hand — never with dsh-box — and reads it back, because
  // a cabinet this tool built would only prove we can read our own handwriting.
  const inventory = mkdtempSync(join(tmpdir(), 'dsh-box-inventory-'))
  disposable.push(inventory)
  if (!run('check-inventory.mjs', [inventory])) failed.push('check-inventory')

  // Its own box and its own throwaway `DSH_HOME`, because it drives commands
  // that would otherwise write the real one.
  const gate = mkdtempSync(join(tmpdir(), 'dsh-box-gate-'))
  disposable.push(gate)
  if (!run('check-daily-gate.mjs', [gate])) failed.push('check-daily-gate')

  // Needs a directory and nothing else. Third because a broken delete makes
  // every check after it lie about what it cleaned up.
  const deleting = mkdtempSync(join(tmpdir(), 'dsh-box-delete-'))
  disposable.push(deleting)
  if (!run('check-delete.mjs', [deleting])) failed.push('check-delete')

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

  // The other half of the same subject: the file above stays plain, and the
  // record of who wrote what is somewhere else. Deletes and corrupts that
  // record on purpose, so it gets a directory of its own.
  const ledgers = mkdtempSync(join(tmpdir(), 'dsh-box-ledger-'))
  disposable.push(ledgers)
  if (!run('check-cabinet-ledger.mjs', [ledgers])) failed.push('check-cabinet-ledger')

  // The per-installation farm and the copy road: hardlinks, junction shelves,
  // per-launch re-pointing and the `_local` copy, all on a hand-made store and
  // hand-made engines. Resolution is proven by running a real `node` on a real
  // probe file — never by asking an API.
  const engines = mkdtempSync(join(tmpdir(), 'dsh-box-engines-'))
  disposable.push(engines)
  if (!run('check-engines.mjs', [engines])) failed.push('check-engines')

  // The gate standing in front of that tree: one npm at a time, and a window
  // that can see whose. Its own directory because it deliberately leaves a claim
  // from a dead pid lying about for a while.
  const installLock = mkdtempSync(join(tmpdir(), 'dsh-box-lock-'))
  disposable.push(installLock)
  if (!run('check-install-lock.mjs', [installLock])) failed.push('check-install-lock')

  // One npm package that is really seventeen plugins. Its fixture is upstream's
  // own patch file, so this is the one check here that reads something outside
  // the repository when that checkout is present.
  const aggregate = mkdtempSync(join(tmpdir(), 'dsh-box-aggregate-'))
  disposable.push(aggregate)
  if (!run('check-aggregate.mjs', [aggregate])) failed.push('check-aggregate')

  // The third place a cabinet names a plugin, and the only one this tool can
  // act on without having installed it. Builds a cabinet as dsh's own tooling
  // would leave one, and its own throwaway `DSH_HOME` for the daily half.
  const bundles = mkdtempSync(join(tmpdir(), 'dsh-box-bundles-'))
  disposable.push(bundles)
  if (!run('check-bundles.mjs', [bundles])) failed.push('check-bundles')

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

  // Its own box too, and it starts the stand-in three times over: the sister
  // race to the one above, on a sandbox that already has a name.
  const sameName = mkdtempSync(join(tmpdir(), 'dsh-box-same-'))
  disposable.push(sameName)
  if (!run('check-same-sandbox.mjs', [sameName])) failed.push('check-same-sandbox')

  // Its own box and its own throwaway `DSH_HOME`, because it deletes the
  // sign-in inside it.
  const signIn = mkdtempSync(join(tmpdir(), 'dsh-box-signin-'))
  disposable.push(signIn)
  if (!run('check-sign-in.mjs', [signIn])) failed.push('check-sign-in')

  // ⚠️ The only check that binds a port for a window service. It never opens a
  // browser and stops both services it starts.
  const oneWindow = mkdtempSync(join(tmpdir(), 'dsh-box-window-'))
  disposable.push(oneWindow)
  if (!run('check-one-window.mjs', [oneWindow])) failed.push('check-one-window')
} finally {
  // ⛔ Not `rmSync({recursive})`. Every box below lives under `tmpdir()`, which
  // on Windows is `C:\Users\<名字>\AppData\Local\Temp` — so on the machine of
  // anyone called 张三 or Müller the built-in call would silently leave all
  // fourteen of them on disk. ⭐ The suite written to catch that defect was
  // cleaning up with it.
  for (const dir of disposable) removeTree(dir)
}

console.log(failed.length === 0
  ? '\n全部验收通过\n'
  : `\n不通过:${failed.join('、')}\n`)
process.exit(failed.length === 0 ? 0 : 1)
