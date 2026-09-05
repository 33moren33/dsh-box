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

/**
 * A disposable data directory with the dsh stand-ins already in it.
 * @param {string} label
 * @param {string[]} [extra] - further stand-ins this box needs.
 */
function freshBox(label, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-box-${label}-`))
  const made = spawnSync(process.execPath, [join(HERE, 'make-test-box.mjs'), dir, '--broken', ...extra], {
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

  // Static, and it guards a change rather than the code: the 44-into-10 slim.
  // Every capability that exists today either has a new home or a written
  // reason it can stop existing — so the cut is auditable instead of
  // remembered, and nothing can be dropped by forgetting.
  if (!run('check-command-map.mjs', [])) failed.push('check-command-map')

  // Static as well, and the same shape of question one step over: the marks
  // check asks whether a control can light up, this one asks whether a section
  // of the window notices that somebody else changed the thing behind it. The
  // bug it is named after shipped — a release downloaded from the command line
  // read "not downloaded" on screen until something made the page refresh.
  if (!run('check-page-tick.mjs', [])) failed.push('check-page-tick')

  // ⭐⭐ Before any of the suites below run, ask whether they are allowed to be
  // believed. Each one is supposed to read nothing but its own scratch
  // directory; the ones that drive the command line will read **the daily
  // cabinet of whoever is running the tests** unless they say otherwise, and
  // that had gone unnoticed in one suite for as long as the plugin list was a
  // stored registry. It surfaced only when the list started being worked out
  // from the cabinets, and then as a count that differed between this machine
  // and CI. ⛔ Put here, ahead of everything it judges: a failing result from a
  // suite that was reading the wrong home is worse than no result, because it
  // sends somebody to debug the product.
  // ⚠️ A bare scratch directory, not `freshBox`: this one needs somewhere to
  // write, not a stand-in dsh to drive.
  const isolation = mkdtempSync(join(tmpdir(), 'dsh-box-isolation-'))
  disposable.push(isolation)
  if (!run('check-suite-isolation.mjs', [isolation])) failed.push('check-suite-isolation')

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

  // ⭐ Compares the path names this tool hardcodes against the ones dsh reads,
  // out of whatever real installation this machine happens to have. ⛔ On a
  // machine with none it prints "not checked" and says so — it must never be
  // read as agreement, because nothing was compared.
  if (!run('check-upstream-constants.mjs', [])) failed.push('check-upstream-constants')

  // ⭐ The one declaration every face is generated from: sane on its own terms
  // (positions, enums, forms, one sentence per parameter in both languages)
  // and with no hand-written copy left beside it. Static, and early, because
  // every face below is generated from what it guards.
  if (!run('check-declaration.mjs', [])) failed.push('check-declaration')

  // Flags belong to commands (another command's flag is refused by name, a
  // value flag given twice is refused, a refusal leaves nothing on disk), and
  // every answer carries a verdict whose exit code is 0/1/2/3 by tier. Spawns
  // the real command line, so it gets a scratch directory to point `--box` at.
  const ownership = mkdtempSync(join(tmpdir(), 'dsh-box-flags-'))
  disposable.push(ownership)
  if (!run('check-verdicts.mjs', [ownership])) failed.push('check-verdicts')

  // ⭐ The third face, right after the declaration it is generated from and the
  // verdicts it maps: every command is a tool unless it says why not, and the
  // server really speaks the protocol over stdio against a scratch directory.
  const mcp = mkdtempSync(join(tmpdir(), 'dsh-box-mcp-'))
  disposable.push(mcp)
  if (!run('check-mcp.mjs', [mcp])) failed.push('check-mcp')

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

  // ⭐⭐ The other half of the gate, in its own box because it starts a real
  // window service. `check-daily-gate` holds the seat itself, so every command
  // it runs is a child of the seat holder and the one interesting negative —
  // the window started it, but nobody agreed — cannot be built there at all.
  // Here the panel and the asker are two processes, which is what the
  // 2026-08-28 change is.
  const approval = mkdtempSync(join(tmpdir(), 'dsh-box-approval-'))
  disposable.push(approval)
  if (!run('check-approval.mjs', [approval])) failed.push('check-approval')

  // ⭐ The composed scenario the slim-down owes the old shape: a whole cabinet's
  // plugin setup moved into another, either direction, one command. Its own box
  // because it fills several cabinets with several plugins each.
  const copying = mkdtempSync(join(tmpdir(), 'dsh-box-copy-'))
  disposable.push(copying)
  if (!run('check-cabinet-copy.mjs', [copying])) failed.push('check-cabinet-copy')

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

  // Static, and about the axis rather than about any launch: a folder somebody
  // names, and which of the three questions — where the tree is, how its
  // version is read, which interpreter starts it — each shape answers
  // differently. Builds its own stand-in trees, including a stand-in
  // application, and starts nothing.
  const enginePath = mkdtempSync(join(tmpdir(), 'dsh-box-engine-path-'))
  disposable.push(enginePath)
  if (!run('check-engine-path.mjs', [enginePath])) failed.push('check-engine-path')

  // ⚠️ The slowest check here, and deliberately not made faster: one of its
  // cases waits out the real readiness timeout, because that is the only place
  // the real launch path, the real giving-up, and the cleanup afterwards meet.
  // Its own box, with two extra stand-ins: one that authenticates before it
  // will show a page, and one that answers on its port forever without ever
  // finishing.
  const bootReady = freshBox('boot-ready', ['--guarded', '--silent'])
  disposable.push(bootReady.dir)
  if (!run('check-boot-ready.mjs', [bootReady.data])) failed.push('check-boot-ready')

  // ⭐ The other half of what a launch owes a person: not "did it come up" but
  // "is it still at the same address". Its own directory, and it holds real
  // ports on purpose — it squats the low numbers so the sandbox is forced onto a
  // higher one, which is the only arrangement in which remembering a port and
  // re-scanning for one give different answers. Sharing a box with anything that
  // also launches would let the other suite's sandbox take the number this one
  // is watching.
  const portSticky = mkdtempSync(join(tmpdir(), 'dsh-box-port-'))
  disposable.push(portSticky)
  if (!run('check-port-sticky.mjs', [portSticky])) failed.push('check-port-sticky')

  // Its own box: it starts a sandbox, deletes that sandbox's ledger on purpose,
  // and leaves the sandbox behind.
  const evidence = freshBox('evidence')
  disposable.push(evidence.dir)
  if (!run('check-running-evidence.mjs', [evidence.data])) failed.push('check-running-evidence')

  // The other half of that same question. Above: "the ledger is missing — is it
  // really stopped?" Here: "the ledger names a pid — is that pid still ours?"
  // Its own box, because it writes ledger rows by hand, one of them dated
  // before the machine booted.
  const stalePid = freshBox('stale-pid')
  disposable.push(stalePid.dir)
  if (!run('check-stale-pid.mjs', [stalePid.data])) failed.push('check-stale-pid')

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

  // ⚠️ The other one that binds a port, and the only one that starts a window
  // service **nothing is holding on to** — which is the whole subject: a seat
  // held by an orphan used to lock the directory with no way out through this
  // tool. Its own directory, because it deliberately leaves seats behind.
  const windowSeat = mkdtempSync(join(tmpdir(), 'dsh-box-seat-'))
  disposable.push(windowSeat)
  if (!run('check-window-seat.mjs', [windowSeat])) failed.push('check-window-seat')
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
