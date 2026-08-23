#!/usr/bin/env node
/**
 * Command line entry.
 *
 * The config window is the face of this tool, but everything it does is
 * available here too — which is what makes the behaviour testable without
 * driving a browser, and what lets the whole thing be scripted.
 *
 * Two properties are load-bearing for anything but a person at a keyboard.
 * `--json` prints one parseable line and nothing else, failures included, so
 * a caller never has to read prose to find out what happened. And `start`
 * hands the sandbox over rather than babysitting it, so a caller that runs
 * one command at a time can still end up with three sandboxes running.
 */

import { spawn } from 'node:child_process'
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import {
  backupDir, boxLayout, ensureBox, pickFreeBoxDir, resolveBoxDir, sandboxPaths, userDshHome, versionDir,
} from '../src/paths.js'
import {
  claimOn, DEFAULT_PROFILE, KEEP_BACKUPS, listBackups, mountPlugin, pruneBackups, removeBackup,
  restoreBackup, unmountPlugin, cabinetPlugins,
} from '../src/mounts.js'
import { isOurDownload, listPackages, packageRoot, removePackage } from '../src/packages.js'
import { addProject, listProjects } from '../src/workspaces.js'
import {
  describePlugin, partitionPlugins, readConfig, removePlugin, SETTINGS, updateConfig, upsertPlugin,
} from '../src/config.js'
import {
  BOOLEAN_FLAGS, COMMANDS, commandLine, describeCommand, describeCommands, helpLines, HISTORY_LINES,
  PROGRAM, VALUE_FLAGS,
} from '../src/commands.js'
import { BoxError, errorCode, errorDetails } from '../src/errors.js'
import { setLang, systemLang, t } from '../src/messages.js'
import { detectHostDsh, engineLabel, engineRecord, resolveEngine } from '../src/host.js'
import {
  attach, controlStatus, detach, finishCommand, journalShape, noteCommand, readJournal, readSession, record,
} from '../src/journal.js'
import {
  appendLog, latestLog, listLogs, logShape, newLaunchLog, newVersionLog, readTail, troubleLines,
  versionLog,
} from '../src/logs.js'
import { installRelease, listReleases, npmInvocation, resolveSource } from '../src/registry.js'
import {
  adoptSessions, approvedByWindow, clearMainRunning, clearRunning, createNewSandbox, deleteSandbox,
  ensureSandbox, hasCredentials, importCredentials, listSandboxes, mainDshRunning, mainRunningRecord,
  removeCredentials, runningRecord, runningSandboxes,
} from '../src/sandbox.js'
import { launch, linkPlugins, stop } from '../src/launch.js'
import { deleteVersion, downloadedVersions } from '../src/versions.js'

/**
 * The listing: every command, one line each, and nothing else.
 *
 * Shape first, content on request — the same rule the log commands follow. What
 * each command gets wrong-footed by is real and worth saying, but saying all of
 * it here produced a wall that gets skimmed once; it now lives on the command
 * it belongs to and arrives when asked for by name.
 * @returns {string}
 */
function usageText() {
  const lines = helpLines()
  const column = Math.max(...lines.map((entry) => cellWidth(entry.usage))) + 2
  const list = lines.map((entry) => `  ${padWide(entry.usage, column)}${entry.summary}`)
  return `${t('help.title')}

${list.join('\n')}

${t('help.perCommand')}
${t('help.machineReadable')}

${t('help.common')}
`
}

/**
 * Help for one command, rendered from its declaration.
 * @param {object} described - from {@link describeCommand}.
 * @returns {string}
 */
function commandHelpText(described) {
  const lines = [`\n  ${described.usage}`, `  ${described.summary}`, '']
  const flags = [
    ...described.booleans.map((flag) => `--${flag}`),
    ...described.values.map((flag) => `--${flag} <${t('help.valuePlaceholder')}>`),
  ]
  if (flags.length > 0) lines.push(`  ${t('help.flags')}  ${flags.join('  ')}`)
  lines.push(`  ${t(described.mutates ? 'help.mutates' : 'help.readOnly')}`)
  if (described.notes.length > 0) lines.push('', ...described.notes)
  return `${lines.join('\n')}\n`
}

/**
 * Answer a request for help, for whoever asked.
 *
 * ⭐ Deliberately before any data directory is opened: asking how to use
 * something must not create anything. And deliberately generated from the
 * command table rather than written out — help that is hand-maintained beside
 * a parser is help that will one day describe a flag nobody implements.
 * @param {string | undefined} topic - a command name, or nothing for the list.
 * @param {Record<string, unknown>} opts
 */
function showHelp(topic, opts) {
  const json = opts.json === true
  if (topic === undefined) {
    if (json) {
      return void console.log(JSON.stringify({
        box: null, ok: true, action: 'help', program: PROGRAM, commands: describeCommands(),
      }))
    }
    return void process.stdout.write(usageText())
  }
  const described = describeCommand(topic)
  if (described === null) {
    throw new BoxError('UNKNOWN_COMMAND', t('help.noSuchTopic', { topic }), {
      commands: Object.keys(COMMANDS),
    })
  }
  if (json) {
    return void console.log(JSON.stringify({ box: null, ok: true, action: 'help', command: described }))
  }
  process.stdout.write(commandHelpText(described))
}

const argv = process.argv.slice(2)
// Read before parsing, because how a parse failure should be reported depends
// on it.
const wantsJson = argv.includes('--json')
/** @type {import('../src/paths.js').BoxLayout | null} */
let layout = null

/**
 * What is about to be written down, kept so a failure can be recorded too.
 * @type {{command: string, args: Record<string, unknown>} | null}
 */
let pending = null
let alreadyRecorded = false

/**
 * @param {string[]} positional
 * @param {Record<string, string | boolean | string[]>} opts
 */
async function main(positional, opts) {
  // ⛔ Before anything is printed, and in particular before `--help` — which is
  // the one screen most in need of being in the reader's language, and which
  // returns above without ever opening the data directory. Choosing the
  // language must therefore not open it either: `--help` acquiring a folder as
  // a side effect would be a worse bug than the one this fixes.
  setLang(chooseLang(opts))
  const [command, ...rest] = positional
  // `help` is a command people type, so it is answered rather than refused —
  // and `<command> --help` asks about that command, not about everything.
  if (command === undefined || command === 'help' || opts.help === true) {
    return void showHelp(command === 'help' ? rest[0] : command, opts)
  }

  layout = openBox(opts)
  pending = describeAction(command, rest, opts)
  // Every command, reading ones included: the badge answers "what is being
  // done right now", which the numbered trail deliberately does not.
  noteCommand(layout, command, { ...opts, json: undefined })

  switch (command) {
    case 'versions': return showVersions(layout, opts)
    case 'pull': return pull(layout, rest[0], opts)
    case 'drop': return drop(layout, rest[0], opts)
    case 'plugins': return plugins(layout, rest, opts)
    case 'packages': return packages(layout, rest, opts)
    case 'workspaces': return workspaces(layout, rest, opts)
    case 'sandboxes': return showSandboxes(layout, opts)
    case 'start': return start(layout, opts)
    case 'stop': return halt(layout, rest[0], opts)
    case 'signin': return signIn(layout, rest[0], opts)
    case 'signout': return signOut(layout, rest[0], opts)
    case 'adopt': return adopt(layout, rest[0], opts)
    case 'rm': return remove(layout, rest[0], opts)
    case 'config': return settings(layout, rest, opts)
    case 'ui': return openUi(layout, opts)
    case 'quit': return quit(layout, opts)
    case 'status': return showStatus(layout, opts)
    case 'logs': return showLogs(layout, rest[0], opts)
    case 'attach': return takeControl(layout, opts)
    case 'detach': return releaseControl(layout, opts)
    case 'memory': return showMemory(layout, opts)
    case 'history': return showHistory(layout, opts)
    default: throw new BoxError('UNKNOWN_COMMAND', t('help.unknownCommand', { command }))
  }
}

/**
 * What this command will be written down as, or null when it changes nothing.
 *
 * Read-only commands are left out of both the journal and the display: there
 * is nothing durable to remember, and showing "the agent looked at the list"
 * would push the last real action off the screen.
 * @param {string} command
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 * @returns {{command: string, args: Record<string, unknown>} | null}
 */
function describeAction(command, rest, opts) {
  switch (command) {
    case 'pull': case 'drop':
      return { command, args: { version: rest[0] } }
    case 'plugins':
      // `plugins` on its own and `plugins backups` only look; the rest change
      // something, and only the ones that change something are written down.
      if (rest[0] === 'backups') {
        return ['rm', 'prune'].includes(rest[1])
          ? {
            command: `plugins.backups.${rest[1]}`,
            args: { target: rest[2], main: opts.main === true, sandbox: opts.sandbox, keep: opts.keep },
          }
          : null
      }
      // ⛔ Which cabinet belongs in here too. It used to say only `target`, so
      // a command that failed before the cabinet was resolved was written down
      // without it — and the rendered line came out as `--sandbox` with
      // nothing after it, which is not a command anyone can re-run. The
      // failures are exactly the records worth having: an agent that cannot
      // see where it was stopped walks into the same wall next time.
      if (['install', 'uninstall', 'restore'].includes(rest[0])) {
        return {
          command: `plugins.${rest[0]}`,
          args: { target: rest[1], main: opts.main === true, sandbox: opts.sandbox, at: opts.at },
        }
      }
      return ['add', 'rm'].includes(rest[0])
        ? {
          command: `plugins.${rest[0]}`,
          args: { target: rest[1], id: opts.id, approved: opts.approved === true },
        }
        : null
    case 'packages':
      return ['rm', 'prune'].includes(rest[0])
        ? { command: `packages.${rest[0]}`, args: { target: rest[1] } }
        : null
    case 'workspaces':
      return rest[0] === 'use'
        ? {
          command: 'workspaces.use',
          args: { target: rest[1], main: opts.main === true, sandbox: opts.sandbox },
        }
        : null
    case 'start':
      return { command, args: { version: opts.version, sandbox: opts.sandbox, main: opts.main === true } }
    case 'stop': case 'rm': case 'signin': case 'signout':
      return { command, args: { sandbox: rest[0], main: opts.main === true } }
    case 'adopt':
      // Replaced by the resolved pair once the direction is known; this stands
      // in only for a run that fails before getting that far.
      return { command, args: { fromSandbox: rest[0] ?? opts.from ?? null, toSandbox: opts.to ?? null } }
    case 'config':
      return rest[0] === undefined ? null : { command: `config.${rest[0]}`, args: { value: rest[1] } }
    case 'quit':
      return { command, args: {} }
    default:
      return null
  }
}

/**
 * Replace the pending record with the resolved one.
 *
 * A command line says `--sandbox` sometimes and nothing other times; what is
 * worth writing down is what was actually used, which only the command knows
 * once it has filled in the blanks.
 * @param {Record<string, unknown>} args
 */
function recordResolved(args) {
  if (pending === null || layout === null) return
  record(layout, { command: pending.command, args, ok: true })
  alreadyRecorded = true
}

/**
 * Everything true about this data directory right now.
 *
 * Deliberately local-only and therefore instant: an agent re-reads this at
 * the start of every turn because it remembers nothing between them, and a
 * command that sometimes waits two seconds on a registry is a command that
 * gets used less than it should be.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function showStatus(layout, opts) {
  const config = readConfig(layout)
  const boxes = listSandboxes(layout)
  const { live, missing } = partitionPlugins(config)
  const status = {
    agent: controlStatus(layout),
    // The machine axis: the dsh the user installed themselves, which is what
    // a launch uses unless `--version` names one of the downloads below.
    host: detectHostDsh(),
    downloaded: downloadedVersions(layout),
    sandboxes: boxes,
    running: boxes.filter((box) => box.running !== null).map((box) => ({ sandbox: box.name, ...box.running })),
    plugins: live,
    missingPlugins: missing,
    // Two different questions again. `plugins` above is the registry — what this
    // tool knows about. This is what the user's own filing cabinet actually has,
    // read from that home's files, and it is the only one that answers "will
    // typing `dsh` load it".
    mainPlugins: cabinetPlugins(userDshHome()),
    // The window has always shown these; this reader did not, so an agent could
    // not tell whether closing the window would ask first. Two readers of the
    // same files reporting different subsets is how they start to disagree.
    settings: Object.fromEntries(
      Object.entries(SETTINGS).map(([name, setting]) => [name, setting.read(config)]),
    ),
    last: config.last,
    // Two different questions, deliberately two fields. One is "did we start a
    // main environment, and which process is it"; the other is only "is
    // something answering on dsh's default port" — that one can be true for a
    // dsh we know nothing about and must never be acted on.
    main: mainRunningRecord(layout),
    mainDshOnDefaultPort: await mainDshRunning(),
  }
  if (opts.json === true) return void emit(status)

  // The label column is measured in terminal cells, not characters, because
  // these labels are Chinese and a Chinese character takes two of them.
  const label = (text) => padWide(text, 12)
  console.log(`\n  ${label(t('status.labelDataDir'))}${layout.root}`)
  console.log(`  ${label(t('status.labelAgent'))}${status.agent === null ? t('status.agentNone') : t('status.agentSince', { at: status.agent.startedAt })}`)
  console.log(`  ${label(t('status.labelHost'))}${hostLine(status.host)}`)
  console.log(`  ${label(t('status.labelDownloaded'))}${status.downloaded.map((v) => v.version).join('、') || t('status.none')}  ${t('status.downloadedHint')}`)
  console.log(`  ${label(t('status.labelPlugins'))}${live.map((p) => p.id).join('、') || t('status.none')}${missing.length > 0 ? `  ${t('status.foldersGone', { count: missing.length })}` : ''}`)
  console.log(`  ${label(t('status.labelMainPlugins'))}${[
    ...status.mainPlugins.ours.map((p) => t('status.oursTag', { name: p.package })),
    ...status.mainPlugins.theirs,
  ].join('、') || t('status.none')}`)
  console.log(`  ${label(t('status.labelSettings'))}${Object.entries(status.settings).map(([name, value]) => `${name}=${value}`).join('  ')}`)
  console.log(`  ${label(t('status.labelMain'))}${status.main === null
    ? (status.mainDshOnDefaultPort ? t('status.mainForeign') : t('status.mainNone'))
    : t('status.mainRunning', { url: status.main.url, pid: status.main.pid })}`)
  console.log(`\n  ${t('status.sandboxCount', { count: boxes.length, running: status.running.length })}`)
  for (const box of boxes) {
    const where = box.running === null ? t('status.boxStopped') : t('status.boxRunning', { url: box.running.url })
    console.log(`    ${padWide(box.name, 24)} ${(box.lastVersion ?? t('sandbox.neverStarted')).padEnd(14)} ${where}`)
  }
  console.log()
}

/**
 * One line describing the machine a launch will use by default.
 *
 * The pin check is reported in three states, not two: passing, failing, and
 * not having been possible. A global install laid out in a way this could not
 * walk is not a mixed one, and saying "mixed" about something never examined
 * is the self-consistent kind of wrong answer that costs the most here.
 * @param {import('../src/host.js').HostDsh} host
 * @returns {string}
 */
function hostLine(host) {
  if (!host.found) return t('status.hostMissing')
  const pins = !host.verified ? t('status.hostUnverified')
    : host.pinned ? t('status.hostPinned', { count: host.packages })
      : t('status.hostMixed', { list: host.mixed.map((w) => `${w.name}@${w.found ?? t('status.versionUnknown')}`).join('、') })
  return `${host.version}  ${pins}\n${' '.repeat(14)}${host.dir}`
}

/**
 * Show what dsh said during a sandbox's most recent launch.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
function showLogs(layout, name, opts) {
  const target = logTarget(layout, name, opts)
  const where = target.where

  if (opts.all === true && target.dir !== null) {
    const files = listLogs(target.dir, target.suffix ?? '.log')
    if (opts.json === true) return void emit({ sandbox: where, logs: files })
    console.log(`\n  ${t('logs.kept', { where, count: files.length })}`)
    for (const entry of files) {
      console.log(`    ${t('logs.fileLine', { at: entry.at, bytes: String(entry.bytes).padStart(8), file: entry.file })}`)
    }
    return void console.log()
  }

  const file = target.file
  if (file === null || logShape(file) === null) {
    throw new BoxError('NO_LOGS', t('logs.none', { where, reason: target.never }), { sandbox: where, dir: target.dir })
  }
  const shape = logShape(file)

  if (opts.shape === true) {
    if (opts.json === true) return void emit({ sandbox: where, shape })
    console.log(`\n  ${where} ${target.what}`)
    console.log(`    ${t('logs.shapeFile', { file: shape.file })}`)
    console.log(`    ${t('logs.shapeSize', { lines: shape.lines, bytes: shape.bytes, at: shape.modifiedAt })}`)
    console.log(`    ${t('logs.shapeTrouble', { count: shape.troubleLines })}`)
    console.log(`    ${t('logs.shapeLast', { line: shape.lastLine })}`)
    return void console.log()
  }

  if (opts.errors === true) {
    const lines = troubleLines(file)
    if (opts.json === true) {
      return void emit({ sandbox: where, shape, lines, filter: 'trouble', note: t('logs.troubleNote') })
    }
    console.log(`\n  ${t('logs.troublePicked', { where, total: shape.lines, count: lines.length })}`)
    console.log(`  ${t('logs.troubleNote')}`)
    for (const line of lines) console.log(`    ${line}`)
    return void console.log()
  }

  const wanted = Number(opts.lines)
  const tail = readTail(file, Number.isInteger(wanted) && wanted > 0 ? { lines: wanted } : {})
  if (opts.json === true) return void emit({ sandbox: where, shape, ...tail })
  console.log(`\n  ${t('logs.tailHeader', { where, what: target.what, total: tail.totalLines })}`)
  if (tail.omittedLines > 0) {
    console.log(`  ${t('logs.tailOmitted', {
      shown: tail.lines.length,
      omitted: tail.omittedLines,
      limit: t(tail.limitedBy === 'chars' ? 'logs.limitChars' : 'logs.limitLines'),
    })}`)
    console.log(`  ${t('logs.fullFile', { file })}`)
  }
  for (const line of tail.lines) console.log(`    ${line}`)
  console.log()
}

/**
 * Which log is being asked about.
 *
 * Three kinds, and they are not the same shape. A sandbox and the real home
 * both keep a folder of launches, so the newest one is what "the log" means
 * and `--all` can list the rest. A release has exactly one file, rewritten
 * each time it is downloaded or deleted — named after the release so that
 * whoever asked for it already knows where to look, which is what lets the
 * config window watch a download it did not start.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string | undefined} name
 * @param {Record<string, unknown>} opts
 * @returns {{where: string, what: string, file: string | null, dir: string | null, never: string}}
 */
function logTarget(layout, name, opts) {
  if (typeof opts.version === 'string') {
    return {
      where: t('logs.whereVersion', { version: opts.version }),
      what: t('logs.whatVersion'),
      file: versionLog(layout.root, opts.version),
      dir: null,
      never: t('logs.neverVersion'),
    }
  }
  if (opts.main === true) {
    // Only the launch logs. This directory also holds `actions.log`, which is
    // appended to by every command and so is always the newest file in it.
    const dir = join(layout.root, 'logs')
    return {
      where: t('cabinet.daily'),
      what: t('logs.whatLaunch'),
      file: latestLog(dir, '_main.log'),
      dir,
      suffix: '_main.log',
      never: t('logs.neverMain'),
    }
  }
  if (name === undefined) {
    throw new BoxError('MISSING_ARGUMENT', t('logs.which'))
  }
  const paths = sandboxPaths(layout, name)
  return {
    where: paths.name,
    what: t('logs.whatLaunch'),
    file: latestLog(paths.logs),
    dir: paths.logs,
    never: t('logs.neverSandbox'),
  }
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function takeControl(layout, opts) {
  const held = attach(layout)
  if (opts.json === true) return void emit({ action: 'attach', ...held })
  console.log(`\n  ${t('attach.done')}`)
  console.log(`  ${t('attach.session', { session: held.session })}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function releaseControl(layout, opts) {
  // Who ended it is part of the record, not decoration: an agent that reads
  // back "I finished" where it was actually stopped has been told the one thing
  // it most needs to know is not true.
  const released = detach(layout, opts.forced === true ? 'forced' : 'done')
  if (opts.json === true) return void emit({ action: 'detach', released })
  if (released === null) console.log(`\n  ${t('detach.nobody')}\n`)
  else if (opts.forced === true) console.log(`\n  ${t('detach.forced')}\n`)
  else console.log(`\n  ${t('detach.done')}\n`)
}

/** How a session ended, said in words rather than in its recorded token. */
function endedWords(reason) {
  if (reason === 'forced') return t('session.endedForced')
  if (reason === 'done') return t('session.endedDone')
  return String(reason)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function showMemory(layout, opts) {
  const session = readSession(layout)
  const holding = controlStatus(layout)
  if (opts.json === true) return void emit({ session, active: holding })
  if (session === null) return void console.log(`\n  ${t('memory.none')}\n`)
  console.log(`\n  ${t('memory.header', { session: session.session, at: session.startedAt })}`)
  console.log(`  ${session.endedAt === null ? t('memory.stillOpen') : t('memory.endedAt', { at: session.endedAt, how: endedWords(session.endedBy) })}`)
  for (const entry of session.actions) {
    const how = entry.ok ? t('memory.ok') : t('memory.refused', { code: entry.code })
    console.log(`    ${String(entry.seq).padEnd(3)} ${entry.command.padEnd(14)} ${how}`)
    if (!entry.ok) console.log(`        ${entry.message}`)
  }
  console.log()
}

/**
 * Print one machine-readable line.
 *
 * The data directory comes first in every answer on purpose: this tool keeps
 * every sandbox, release and setting inside one folder, and a caller pointed
 * at a different folder than the window is showing gets answers that are
 * correct, self-consistent, and about another world. Saying which world every
 * time is cheaper than trying to prevent the mix-up.
 * @param {Record<string, unknown>} payload
 */
function emit(payload) {
  console.log(JSON.stringify({ box: layout?.root ?? null, ok: true, ...payload }))
}

/**
 * Which language this run speaks.
 *
 * Read straight off the settings file rather than through `readConfig`, because
 * this runs before the data directory has been opened and must not open it.
 * Anything unreadable — no file yet, a broken file, a directory that is not
 * ours — decides nothing and leaves the computer's own language in charge: a
 * config this cannot parse still has to be able to complain, and complaining is
 * itself a sentence.
 * @param {Record<string, unknown>} opts
 * @returns {string}
 */
function chooseLang(opts) {
  try {
    const file = boxLayout(resolveBoxDir({ dir: typeof opts.box === 'string' ? opts.box : undefined })).config
    if (existsSync(file)) {
      const chosen = JSON.parse(readFileSync(file, 'utf8'))?.lang
      if (typeof chosen === 'string') return chosen
    }
  } catch {
    // Deliberately silent: this is not the place that reports a broken config.
  }
  return systemLang()
}

/**
 * Open, and if necessary create, the data directory.
 * @param {Record<string, unknown>} opts
 * @returns {import('../src/paths.js').BoxLayout}
 */
function openBox(opts) {
  const requested = resolveBoxDir({ dir: typeof opts.box === 'string' ? opts.box : undefined })
  try {
    return ensureBox(requested)
  } catch (error) {
    // Someone already owns a folder by that name. Taking it over silently is
    // the one failure mode that loses data belonging to another program.
    const free = pickFreeBoxDir(process.cwd())
    console.error(`  ${error.message}`)
    console.error(`  ${t('box.usingInstead', { dir: free })}\n`)
    return ensureBox(free)
  }
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function showVersions(layout, opts) {
  const downloaded = downloadedVersions(layout)
  let releases = null
  let registryError = null
  try {
    releases = await listReleases({ source: readConfig(layout).source })
  } catch (error) {
    registryError = error.message
  }

  if (opts.json === true) {
    return void emit({
      downloaded,
      available: releases?.versions ?? [],
      tags: releases?.tags ?? {},
      registryError,
    })
  }

  console.log(`\n  ${t('versions.downloaded')}`)
  if (downloaded.length === 0) console.log(`    ${t('versions.noneDownloaded')}`)
  for (const entry of downloaded) {
    console.log(`    ${entry.version.padEnd(14)} ${entry.pinned ? t('versions.pinned') : t('versions.mixed')}`)
  }
  if (releases === null) {
    console.log(`\n  ${t('versions.registryDown', { error: registryError })}\n`)
    return
  }
  console.log(`\n  ${t('versions.available')}`)
  const tagName = { latest: t('versions.tagLatest'), next: t('versions.tagNext') }
  for (const version of releases.versions.slice(0, 10)) {
    const label = Object.entries(releases.tags)
      .filter(([, v]) => v === version)
      .map(([tag]) => tagName[tag] ?? tag)
      .join('、')
    console.log(`    ${version.padEnd(14)} ${label}`)
  }
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} version
 * @param {Record<string, unknown>} opts
 */
async function pull(layout, version, opts) {
  if (version === undefined) throw new BoxError('MISSING_ARGUMENT', t('pull.which'))
  const dir = versionDir(layout, version)
  mkdirSync(dir, { recursive: true })
  // In machine-readable mode nothing may reach stdout before the final line,
  // so progress is collected and handed over with the result instead. It also
  // goes to a file the whole time, which is the only way anyone watching —
  // the config window, or a person in another terminal — sees it happening
  // rather than waiting two minutes on silence.
  const logFile = newVersionLog(layout.root, version)
  const lines = []
  const quiet = opts.json === true
  if (!quiet) console.log()
  const report = await installRelease(dir, version, {
    onLog: (line) => {
      appendLog(logFile, line)
      if (quiet) lines.push(line)
      else console.log(`  ${line}`)
    },
    source: readConfig(layout).source,
  })
  appendLog(logFile, t('pull.ready', { version }))
  if (quiet) return void emit({ action: 'pull', version, packages: report.checked, log: lines, logFile })
  console.log(`\n  ${t('pull.ready', { version })}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} version
 * @param {Record<string, unknown>} opts
 */
async function drop(layout, version, opts) {
  if (version === undefined) throw new BoxError('MISSING_ARGUMENT', t('drop.which'))
  const logFile = newVersionLog(layout.root, version)
  const lines = []
  const quiet = opts.json === true
  if (!quiet) console.log()
  await deleteVersion(layout, version, (line) => {
    appendLog(logFile, line)
    if (quiet) lines.push(line)
    else console.log(`  ${line}`)
  })
  if (quiet) return void emit({ action: 'drop', version, log: lines, logFile })
  console.log(`  ${t('drop.redownload')}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
/**
 * Which filing cabinet a plugin command is talking about.
 *
 * The same two words the launcher uses, for the same reason: a workspace is a
 * `DSH_HOME`, and `--main` versus `--sandbox <name>` is how one is named. Nothing
 * is inherited here either — not saying which workspace is an error, never a
 * guess at the last one.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 * @returns {{main: boolean, label: string, home: string, sandbox: string | null}}
 */
/**
 * Where snapshots of this workspace's plugin config go, or null for "nowhere".
 *
 * ⭐ Only the daily workspace gets them (CEO 2026-08-22): a sandbox exists to be
 * thrown away, so keeping a copy of its config before every edit protects
 * nothing. The rule lives here because this is where main and sandbox are told
 * apart; `backupFile` just does as it is told.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {{main: boolean, home: string}} target
 * @returns {string | null}
 */
function snapshotDir(layout, target) {
  return target.main ? backupDir(layout, target.home) : null
}

function cabinetTarget(layout, opts) {
  const main = opts.main === true
  if (main && typeof opts.sandbox === 'string') {
    throw new BoxError('BAD_FLAG', t('cabinet.bothFlags'))
  }
  if (main) return { main: true, label: t('cabinet.daily'), home: userDshHome(), sandbox: null }
  if (typeof opts.sandbox !== 'string' || opts.sandbox === '') {
    throw new BoxError('MISSING_ARGUMENT', t('cabinet.which'))
  }
  const paths = sandboxPaths(layout, opts.sandbox)
  return { main: false, label: paths.name, home: paths.home, sandbox: paths.name }
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function plugins(layout, rest, opts) {
  const config = readConfig(layout)
  const [action, value] = rest
  if (action === 'install') return installPlugin(layout, value, opts)
  if (action === 'uninstall') return uninstallPlugin(layout, value, opts)
  if (action === 'backups') return showBackups(layout, rest.slice(1), opts)
  if (action === 'restore') return restoreCabinet(layout, opts)
  if (action === 'add') {
    if (value === undefined) throw new BoxError('MISSING_ARGUMENT', t('plugins.addWhich'))
    const plugin = describePlugin(value, { id: typeof opts.id === 'string' ? opts.id : undefined })
    // Registering is an upsert, so an entry can vanish without anyone seeing
    // it happen. A person watching the list notices; a caller does not.
    const replaced = config.plugins.some((p) => p.id === plugin.id)
    updateConfig(layout, (current) => upsertPlugin(current, plugin))
    recordResolved({ id: plugin.id, package: plugin.package, path: plugin.path, replaced })
    if (opts.json === true) return void emit({ action: 'plugins.add', plugin, replaced })
    console.log(`\n  ${t(replaced ? 'plugins.rememberedReplaced' : 'plugins.remembered', { package: plugin.package, id: plugin.id })}\n`)
    return
  }
  if (action === 'rm') return removeEverywhere(layout, value, opts)
  // Naming a workspace asks a different question: not "what does this tool know
  // about" but "what does that filing cabinet actually have". Two layers, two
  // answers, and conflating them is what made "is it installed?" unanswerable.
  if (opts.main === true || typeof opts.sandbox === 'string') {
    const target = cabinetTarget(layout, opts)
    const mounted = cabinetPlugins(target.home)
    if (opts.json === true) {
      return void emit({ cabinet: target.label, home: target.home, ...mounted })
    }
    console.log(`\n  ${t('plugins.cabinetHeader', { cabinet: target.label })}`)
    if (!mounted.readable) console.log(`    ${t('plugins.unreadableWarn')}`)
    if (mounted.ours.length === 0 && mounted.theirs.length === 0) console.log(`    ${t('plugins.cabinetEmpty')}`)
    for (const plugin of mounted.ours) console.log(`    ${padWide(plugin.id, 24)} ${t('plugins.oursLine', { package: plugin.package })}`)
    for (const name of mounted.theirs) console.log(`    ${padWide('', 24)} ${t('plugins.theirsLine', { name })}`)
    if (mounted.platform.length > 0) console.log(`\n  ${t('plugins.platform', { names: mounted.platform.join('、') })}`)
    return void console.log(`\n  ${t('plugins.patchAt', { file: mounted.patchFile })}\n`)
  }

  const { live, missing } = partitionPlugins(config)
  if (opts.json === true) return void emit({ plugins: live, missingPlugins: missing })
  console.log(`\n  ${t('plugins.registryHeader')}`)
  if (live.length === 0 && missing.length === 0) console.log(`    ${t('plugins.registryEmpty')}`)
  for (const plugin of live) console.log(`    ${plugin.id.padEnd(24)} ${plugin.package}`)
  for (const plugin of missing) console.log(`    ${plugin.id.padEnd(24)} ${t('plugins.missingLine', { package: plugin.package })}`)
  console.log(`\n  ${t('plugins.installHint')}`)
  console.log()
}

/**
 * Get rid of a plugin: out of every workspace, out of the registry, and — when
 * we were the ones who fetched it — off the disk.
 *
 * ⛔ **This used to be `plugins rm`, which only deleted a row from our own
 * registry.** The button above it said "stop remembering" and the row disappeared, so it
 * read as "this plugin is gone" while the workspaces it had been installed into
 * carried on loading it, and the downloaded copy stayed on disk. Getting rid of
 * one actually took three steps across two kinds of state, and nothing on
 * screen or in the help said so.
 *
 * ⭐ **What it does depends on where the files came from, and only on that**
 * (CEO 2026-08-22, the line being: whoever owns the files is responsible for
 * them). A folder of the user's own is unlinked and forgotten, never touched;
 * something we downloaded into our own tree is deleted outright, because
 * leaving it would be the litter nobody has a command for.
 *
 * ⚠️ The command stays one command. The two faces differ in wording, not in
 * capability — a second command would be a second thing to keep in step.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} id
 * @param {Record<string, unknown>} opts
 */
function removeEverywhere(layout, id, opts) {
  if (id === undefined) throw new BoxError('MISSING_ARGUMENT', t('plugins.rmWhich'))
  const config = readConfig(layout)
  const known = config.plugins.find((entry) => entry.id === id)
  const places = pluginPlaces(layout, id, known?.package)
  if (known === undefined && places.length === 0) {
    throw new BoxError('UNKNOWN_PLUGIN', t('plugins.rmUnknown', { id }), { id })
  }
  const ours = known !== undefined && isOurDownload(layout, known.path)
  const daily = places.find((place) => place.main)

  // ⚠️ A gate rather than a warning, because the person named a row in a list
  // and the consequence reaches into a cabinet they did not name.
  //
  // ⭐⭐ What counts as approval is a person in the window, not the flag: see
  // {@link approvedByWindow}. `ask-on-daily` no longer takes part in this
  // decision at all — it now means only "the window need not ask me twice",
  // which is a preference of somebody who is sitting there. It used to switch
  // the gate off for every caller, so a person turning off their own prompt was
  // quietly handing the same door to anything else running on the machine.
  if (daily !== undefined && !approvedByWindow(layout, opts.approved === true)) {
    throw new BoxError(
      'NEEDS_APPROVAL',
      t(ours ? 'plugins.rmApprovalDownloaded' : 'plugins.rmApprovalYours', {
        package: known?.package ?? id,
        daily: daily.label,
        places: places.map((place) => place.label).join('、'),
      }),
      // ⛔ Identifiers, not labels. `place.label` for the daily cabinet is a
      // translated phrase, so a caller reading `--json` used to get
      // 「日常档案柜」 or "your everyday cabinet" depending on whose machine it
      // ran on — the command line is the interface, and an interface whose
      // values move with the display language is not one. `sandbox: null` is
      // the daily cabinet, exactly as everywhere else here.
      // ⭐ Found by running the acceptance suite on a machine with no `LANG`
      // set: the assertion about this field was written against the Chinese
      // text and had never left a Chinese locale.
      {
        id,
        package: known?.package ?? null,
        places: places.map((place) => ({ sandbox: place.sandbox, main: place.main })),
        downloaded: ours,
      },
    )
  }

  const detached = []
  for (const place of places) {
    const result = unmountPlugin({ home: place.home, id, backupDir: snapshotDir(layout, place) })
    if (result.removed !== null) detached.push({ cabinet: place.label, backup: result.backup })
  }
  updateConfig(layout, (current) => removePlugin(current, id))
  // Deleted last, and only after every link to it is gone: a package removed
  // while something still names it leaves that workspace resolving to nothing,
  // which dsh answers by refusing to load the whole plugin tree.
  const deleted = ours && removePackage(layout, known.package)

  recordResolved({
    id, package: known?.package ?? null, cabinets: detached.map((one) => one.cabinet), deleted,
  })
  if (opts.json === true) {
    return void emit({
      action: 'plugins.rm', id, package: known?.package ?? null, detached, deletedPackage: deleted,
    })
  }
  console.log(`\n  ${t('plugins.rmHeader', { package: known?.package ?? id })}`)
  if (detached.length === 0) console.log(`    ${t('plugins.rmNowhere')}`)
  for (const one of detached) console.log(`    ${t('plugins.rmDetached', { cabinet: one.cabinet })}`)
  console.log(`    ${t(known === undefined ? 'plugins.rmUnregisteredNever' : 'plugins.rmUnregistered')}`)
  console.log(deleted
    ? `    ${t('plugins.rmPackageDeleted')}`
    : `    ${ours ? '' : t('plugins.rmFolderUntouched')}`)
  console.log()
}

/**
 * Everywhere a plugin is currently installed, read from the workspaces
 * themselves.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} id
 * @param {string | undefined} name - the package name, for entries registered
 * under a different id than the one being asked about.
 * @returns {{label: string, home: string, main: boolean, sandbox: string | null}[]}
 */
function pluginPlaces(layout, id, name) {
  return everyCabinet(layout).filter((workspace) => cabinetPlugins(workspace.home).ours
    .some((entry) => entry.id === id || (name !== undefined && entry.package === name)))
}

/**
 * Put a plugin into one workspace, for good.
 *
 * The order is load-bearing: the link is made first, because making it is what
 * proves the folder is really there and really a plugin. Writing the patch entry
 * first and failing afterwards would leave a workspace naming a package that
 * resolves to nothing — and dsh answers that by refusing to load the whole
 * plugin tree, which is a far worse failure than the one being prevented.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} source - a registered id, or a directory.
 * @param {Record<string, unknown>} opts
 */
async function installPlugin(layout, source, opts) {
  if (source === undefined) {
    throw new BoxError('MISSING_ARGUMENT', t('plugins.installWhich'))
  }
  const target = cabinetTarget(layout, opts)
  const config = readConfig(layout)
  const known = config.plugins.find((entry) => entry.id === source)
  // Three kinds of thing can be named, and they are told apart by what they
  // are, not by a flag: a folder that exists, an id this tool has registered,
  // or — failing both — a package name to fetch. Guessing wrong is cheap and
  // visible: a mistyped folder becomes a package npm will say it cannot find.
  if (known === undefined && !existsSync(join(source, 'package.json'))) {
    return installPackage(layout, source, target, opts)
  }
  return installFromFolder(layout, known?.path ?? source, target, opts, {
    id: typeof opts.id === 'string' ? opts.id : known?.id,
    source,
  })
}

/**
 * Put one folder into one workspace. The single road every plugin takes.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} dir
 * @param {{main: boolean, label: string, home: string, sandbox: string | null}} target
 * @param {Record<string, unknown>} opts
 * @param {{id?: string, source?: string}} [about]
 */
function installFromFolder(layout, dir, target, opts, { id, source } = {}) {
  // Described afresh even when it is already registered: what was checked when
  // it was added was that folder as it was then, and "is this still a loadable
  // plugin" is only true at the moment it is asked.
  const plugin = describePlugin(dir, { id })
  // ⭐ Every refusal has to happen here, above the link. `linkPlugins` replaces
  // whatever holds that name without looking at it, so any check placed after it
  // can only describe a loss already taken.
  const claim = claimOn({ home: target.home, package: plugin.package, path: plugin.path })
  if (claim.verdict === 'unreadable') {
    throw new BoxError(
      'UNREADABLE_PATCH',
      t('plugins.unreadablePatch', { cabinet: target.label, file: claim.patchFile }),
      { file: claim.patchFile },
    )
  }
  if (claim.verdict === 'taken') {
    throw new BoxError(
      'PLUGIN_NAME_TAKEN',
      claim.points === null
        ? t('plugins.nameTakenGone', { package: plugin.package, cabinet: target.label, wanted: plugin.path })
        : t('plugins.nameTakenAt', {
          package: plugin.package, cabinet: target.label, points: claim.points, wanted: plugin.path,
        }),
      { plugin: plugin.package, wanted: plugin.path, points: claim.points, slot: claim.slot },
    )
  }
  updateConfig(layout, (current) => (current.plugins.some((entry) => entry.id === plugin.id)
    ? current
    : upsertPlugin(current, plugin)))
  // Already resolving to this very folder, and already named in the workspace's
  // patch: there is nothing to do, and this is the one branch entitled to say so
  // — nothing has been touched at the point it is said.
  if (claim.verdict === 'same') {
    if (opts.json === true) {
      return void emit({
        action: 'plugins.install',
        cabinet: target.label,
        home: target.home,
        plugin,
        added: false,
        alreadyThere: true,
        backup: null,
      })
    }
    console.log(`\n  ${t('plugins.alreadyThere', { cabinet: target.label, package: plugin.package, points: claim.points })}`)
    console.log(`  ${t('plugins.nothingDone')}\n`)
    return
  }

  linkPlugins(target.home, DEFAULT_PROFILE, [plugin])
  const result = mountPlugin({
    home: target.home,
    plugin: { id: plugin.id, package: plugin.package, kind: 'link', path: plugin.path },
    backupDir: snapshotDir(layout, target),
  })
  recordResolved({
    id: plugin.id, package: plugin.package, source: source ?? plugin.path, main: target.main, sandbox: target.sandbox,
  })

  if (opts.json === true) {
    return void emit({
      action: 'plugins.install',
      cabinet: target.label,
      home: target.home,
      plugin,
      added: result.added,
      backup: result.backup,
    })
  }
  // Reachable only if something else claimed this name between the check above
  // and this line. Said plainly rather than as "it was already there, skipped",
  // which is the sentence that used to hide a replaced package: by here the link
  // has been made, so "skipped" would not be true.
  if (!result.added) {
    console.log(`\n  ${t('plugins.raceTaken', { package: plugin.package, cabinet: target.label })}`)
    console.log(`  ${t('plugins.raceCheck')}`)
    console.log(`  plugins --${target.main ? 'main' : `sandbox ${target.label}`}\n`)
    return
  }
  console.log(`\n  ${t('plugin.installed', { name: plugin.package, where: target.label })}`)
  console.log(`  ${t('plugin.installedWhere', { file: result.patchFile })}`)
  if (result.backup !== null) console.log(`  ${t('backup.saved', { file: result.backup })}`)
  console.log(`  ${t('plugin.removeHint', { id: plugin.id, cabinet: target.main ? '--main' : `--sandbox ${target.label}` })}\n`)
}

/**
 * Fetch a published plugin into this tool's own tree.
 *
 * ⛔ Downloaded here rather than into the workspace's profile, and that is not
 * a preference. **Measured on a real `~/.dsh`:** a profile that dsh's own
 * tooling has touched contains `link:` dependencies — a pnpm protocol npm
 * refuses outright — so `npm install` run there dies with EUNSUPPORTEDPROTOCOL
 * before it fetches anything. Reading the code would never have shown this.
 *
 * ⛔ And not by calling `dsh plugin add` either: that is a thin forwarder to
 * pnpm, so using it would make pnpm a requirement, and "the only thing you need
 * is Node 20+" is one of the few things this tool can claim over the
 * alternatives.
 *
 * So a downloaded package becomes an ordinary folder on disk, and takes the
 * same road every local plugin takes: the shape checks, the link, the entry in
 * the workspace's patch. One road means one set of failure modes — including
 * the refusal that matters here, an asset-only package with nothing to import,
 * which registered the wrong way once brought a whole dsh down.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {{main: boolean, label: string, home: string, sandbox: string | null}} target
 * @param {Record<string, unknown>} opts
 */
async function installPackage(layout, name, target, opts) {
  // What npm allows a package to be called. Checked before it becomes an
  // argument — arguments already travel as a vector, so this is for the sake of
  // a clear refusal rather than for safety.
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new BoxError('BAD_PACKAGE_NAME', t('plugins.badPackageName', { name }), { name })
  }
  const say = opts.json === true ? () => {} : (line) => console.log(line)
  // Our own little package tree, shared by every workspace: a plugin fetched
  // once is linked wherever it is wanted, and its dependencies resolve from
  // beside it because Node resolves through a link to where the folder really is.
  mkdirSync(layout.packages, { recursive: true })
  if (!existsSync(join(layout.packages, 'package.json'))) {
    writeFileSync(join(layout.packages, 'package.json'), `${JSON.stringify({
      name: 'dsh-box-plugins', private: true, description: t('packages.treeDescription'),
    }, null, 2)}\n`)
  }
  const registry = await resolveSource(readConfig(layout).source, say)
  say(`\n  ${t('plugins.downloading', { registry, name })}`)
  await runNpm(layout.packages, ['install', name, '--no-audit', '--no-fund', '--registry', registry], say)

  const dir = join(layout.packages, 'node_modules', ...name.split('/'))
  if (!existsSync(join(dir, 'package.json'))) {
    throw new BoxError('NPM_FAILED', t('npm.saidOkButEmpty', { name, dir }), { name, dir })
  }
  say(`  ${t('plugins.downloaded', { dir })}`)
  // From here it is a folder like any other, checks and all.
  return installFromFolder(layout, dir, target, opts, { source: name })
}

/**
 * Run npm somewhere and pass its own words along.
 * @param {string} dir
 * @param {string[]} args
 * @param {(line: string) => void} say
 * @returns {Promise<void>}
 */
function runNpm(dir, args, say) {
  const [command, ...rest] = npmInvocation(args)
  return new Promise((resolve, reject) => {
    // Arguments go across as a vector, never as one string for a shell to
    // re-read — the package name came from a caller.
    const child = spawn(command, rest, { cwd: dir, windowsHide: true })
    const tail = []
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const text = line.trim()
          if (text === '') continue
          tail.push(text)
          if (tail.length > 30) tail.shift()
          if (/^npm (error|warn)/i.test(text) || /^added |^changed |^removed /.test(text)) say(`  ${text}`)
        }
      })
    }
    child.once('error', (error) => reject(new BoxError(
      'NPM_FAILED', t('npm.cannotStart', { error: error.message }), { tail },
    )))
    child.once('close', (code) => {
      if (code === 0) return void resolve()
      // npm's own last words, not just its exit code: the exit code alone is
      // the least useful half of what it printed.
      reject(new BoxError('NPM_FAILED', t('npm.installExit', { code, last: tail.at(-1) ?? t('npm.saidNothing') }), { tail }))
    })
  })
}

/**
 * Take one back out of a workspace.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} id
 * @param {Record<string, unknown>} opts
 */
function uninstallPlugin(layout, id, opts) {
  if (id === undefined) throw new BoxError('MISSING_ARGUMENT', t('plugins.uninstallWhich'))
  const target = cabinetTarget(layout, opts)
  const backups = snapshotDir(layout, target)
  const result = unmountPlugin({ home: target.home, id, backupDir: backups })
  if (result.removed === null) {
    // Two different nothings, and telling them apart is the whole point of
    // keeping track of who put what there.
    throw new BoxError(
      result.theirs ? 'NOT_OURS' : 'UNKNOWN_PLUGIN',
      result.theirs
        ? t('plugins.notOurs', { id, cabinet: target.label })
        : t('plugins.notInstalled', {
          id, cabinet: target.label, flags: target.main ? '--main' : `--sandbox ${target.label}`,
        }),
      { plugin: id, cabinet: target.label },
    )
  }
  recordResolved({ id: result.removed.id, main: target.main, sandbox: target.sandbox })
  if (opts.json === true) {
    return void emit({
      action: 'plugins.uninstall',
      cabinet: target.label,
      home: target.home,
      plugin: result.removed,
      backup: result.backup,
    })
  }
  console.log(`\n  ${t('plugin.uninstalled', { name: result.removed.package, where: target.label })}`)
  if (result.backup !== null) console.log(`  ${t('backup.saved', { file: result.backup })}`)
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function showBackups(layout, rest, opts) {
  const target = cabinetTarget(layout, opts)
  const dir = backupDir(layout, target.home)
  const [action, at] = rest
  if (action === 'rm') return void dropBackup(layout, target, dir, at, opts)
  if (action === 'prune') return void pruneOldBackups(layout, target, dir, opts)
  if (action !== undefined) {
    throw new BoxError('UNKNOWN_ACTION', t('backups.unknownAction', { action }), { action })
  }

  const backups = listBackups(dir)
  if (opts.json === true) {
    return void emit({ cabinet: target.label, home: target.home, dir, keep: KEEP_BACKUPS, backups })
  }
  console.log(`\n  ${t('backups.header', { cabinet: target.label })}`)
  if (backups.length === 0) {
    console.log(`    ${t(target.main ? 'backups.noneMain' : 'backups.noneSandbox')}`)
    return void console.log()
  }
  for (const entry of backups) console.log(`    ${entry.at}   ${entry.files.join('、')}   ${entry.dir}`)
  const where = target.main ? '--main' : `--sandbox ${target.label}`
  console.log(`\n  ${t('backups.limit', { keep: KEEP_BACKUPS })}`)
  console.log(`  ${t('backups.restoreHint', { where })}`)
  console.log(`  ${t('backups.rmHint', { where })}`)
  console.log(`  ${t('backups.pruneHint', { where })}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {{main: boolean, label: string, sandbox: string | null}} target
 * @param {string} dir
 * @param {string | undefined} at
 * @param {Record<string, unknown>} opts
 */
function dropBackup(layout, target, dir, at, opts) {
  if (at === undefined) {
    throw new BoxError('MISSING_ARGUMENT', t('backups.rmWhich'), {
      backups: listBackups(dir).map((entry) => entry.at),
    })
  }
  if (!removeBackup(dir, at)) {
    throw new BoxError('NO_BACKUP', t('backups.noSuch', { at }), { at, backups: listBackups(dir).map((one) => one.at) })
  }
  recordResolved({ action: 'plugins.backups.rm', at, main: target.main, sandbox: target.sandbox })
  if (opts.json === true) return void emit({ action: 'plugins.backups.rm', cabinet: target.label, removed: [at] })
  console.log(`\n  ${t('backups.removed', { cabinet: target.label, at, count: listBackups(dir).length })}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {{main: boolean, label: string, sandbox: string | null}} target
 * @param {string} dir
 * @param {Record<string, unknown>} opts
 */
function pruneOldBackups(layout, target, dir, opts) {
  const keep = opts.keep === undefined ? KEEP_BACKUPS : Number(opts.keep)
  if (!Number.isInteger(keep) || keep < 0) {
    throw new BoxError('BAD_FLAG', t('flag.keepInteger', { value: String(opts.keep) }), { keep: opts.keep })
  }
  const removed = pruneBackups(dir, keep)
  recordResolved({ action: 'plugins.backups.prune', keep, removed: removed.length, main: target.main })
  if (opts.json === true) {
    return void emit({ action: 'plugins.backups.prune', cabinet: target.label, keep, removed })
  }
  console.log(`\n  ${t('backups.pruned', { cabinet: target.label, keep, count: removed.length })}`)
  for (const at of removed) console.log(`    ${at}`)
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function restoreCabinet(layout, opts) {
  const target = cabinetTarget(layout, opts)
  const result = restoreBackup({
    home: target.home,
    backupDir: backupDir(layout, target.home),
    at: typeof opts.at === 'string' ? opts.at : undefined,
  })
  recordResolved({ at: result.from, main: target.main, sandbox: target.sandbox })
  if (opts.json === true) {
    return void emit({ action: 'plugins.restore', cabinet: target.label, ...result })
  }
  console.log(`\n  ${t('restore.done', { where: target.label, at: result.from })}`)
  for (const file of result.restored) console.log(`    ${file}`)
  if (result.backup !== null) console.log(`  ${t('restore.preRestoreBackup', { file: result.backup })}`)
  // Said out loud because the two halves can now disagree: the file no longer
  // names a plugin whose folder is still linked in, which loads nothing but does
  // leave a name resolvable. Harmless, and worth knowing about.
  console.log(`  ${t('restore.linksNotRolledBack')}\n`)
}

/**
 * Everything this tool has been asked to do, as far back as it goes.
 *
 * ⛔ Distinct from `memory`, and the two are easy to confuse: `memory` is the
 * *display* of the last run of agent control and is overwritten by the next
 * one; this is the durable record and is only ever added to.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function showHistory(layout, opts) {
  const shape = journalShape(layout)
  if (opts.shape === true) {
    if (opts.json === true) return void emit({ box: layout.root, ...shape })
    console.log(`\n  ${t('history.shapeHeader')}`)
    console.log(`    ${shape.unreadable > 0
      ? t('history.shapeCountUnreadable', { count: shape.entries, unreadable: shape.unreadable })
      : t('history.shapeCount', { count: shape.entries })}`)
    console.log(`    ${t('history.shapeFailures', { count: shape.failures })}`)
    console.log(`    ${t('history.shapeRange', { from: shape.from ?? t('history.notYet'), to: shape.to ?? t('history.notYet') })}`)
    for (const one of shape.files) console.log(`    ${t('history.fileBytes', { file: one.file, bytes: one.bytes })}`)
    return void console.log()
  }

  const want = opts.lines === undefined ? HISTORY_LINES : Number(opts.lines)
  if (!Number.isInteger(want) || want < 0) {
    throw new BoxError('BAD_FLAG', t('flag.linesInteger', { value: String(opts.lines) }), { lines: opts.lines })
  }
  const { entries, unreadable, files } = readJournal(layout)
  const shown = want === 0 ? entries : entries.slice(-want)
  const omitted = entries.length - shown.length

  if (opts.json === true) {
    // ⛔ The count and the omission travel with the data, never as a note in
    // prose the caller has to notice. A truncation nobody is told about is how
    // a confident wrong answer gets built on top of it.
    return void emit({
      box: layout.root, entries: shown, total: entries.length, omitted, unreadable, files,
    })
  }
  console.log(`\n  ${omitted > 0
    ? t('history.headerTail', { count: entries.length, shown: shown.length })
    : t('history.header', { count: entries.length })}`)
  if (entries.length === 0) console.log(`    ${t('history.empty')}`)
  for (const entry of shown) {
    const at = String(entry.at ?? '').replace('T', ' ').slice(0, 19)
    const line = commandLine(entry.command, entry.args ?? {}) ?? entry.command
    console.log(`    ${at}  ${entry.ok === false ? '✗' : ' '} ${line}`)
    if (entry.ok === false && entry.code !== undefined) console.log(`    ${' '.repeat(19)}    ${entry.code}`)
  }
  if (omitted > 0) console.log(`\n  ${t('history.omitted', { count: omitted })}`)
  if (unreadable > 0) console.log(`  ${t('history.unreadable', { count: unreadable })}`)
  console.log(`  ${t('history.fullAt', { files: files.join('、') || t('history.noFile') })}\n`)
}

/**
 * The project folders a machine workspace has been pointed at.
 *
 * ⚠️ Two different things are called a workspace, and this command is about the
 * other one. `--main` / `--sandbox` name a **machine workspace** — a `DSH_HOME`,
 * holding conversations and settings. This lists and changes the **project
 * workspaces** registered inside one: the folders dsh actually works in.
 *
 * ⛔ Command line only, no control in the window (CEO 2026-08-22): a person
 * picks a project inside dsh itself, where the picker already is, and building a
 * second one here would be a second thing to keep in step for no gain. It exists
 * because an agent cannot use that picker — and without it, an agent that starts
 * a sandbox is left at a screen it cannot get past.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function workspaces(layout, rest, opts) {
  const target = cabinetTarget(layout, opts)
  const [action, where] = rest

  if (action === 'use') {
    if (where === undefined) {
      throw new BoxError('MISSING_ARGUMENT', t('workspaces.useWhich'))
    }
    const result = addProject({
      home: target.home,
      path: where,
      title: typeof opts.title === 'string' ? opts.title : undefined,
    })
    recordResolved({ path: result.path, main: target.main, sandbox: target.sandbox, added: result.added })
    if (opts.json === true) return void emit({ action: 'workspaces.use', cabinet: target.label, ...result })
    console.log(`\n  ${t('workspaces.next', { cabinet: target.label, path: result.path })}`)
    console.log(`    ${t(result.added ? 'workspaces.addedNew' : result.moved ? 'workspaces.movedFront' : 'workspaces.alreadyFront')}`)
    return void console.log(`  ${t('workspaces.writtenTo', { file: result.file })}\n`)
  }
  if (action !== undefined) {
    throw new BoxError('UNKNOWN_ACTION', t('workspaces.unknownAction', { action }), { action })
  }

  const listed = listProjects(target.home)
  if (opts.json === true) return void emit({ cabinet: target.label, home: target.home, ...listed })
  console.log(`\n  ${t('workspaces.header', { cabinet: target.label })}`)
  if (!listed.exists) console.log(`    ${t('workspaces.neverStarted')}`)
  if (listed.exists && listed.projects.length === 0) console.log(`    ${t('workspaces.emptyList')}`)
  for (const one of listed.projects) {
    console.log(`    ${one.current ? '→' : ' '} ${padWide(one.title, 22)} ${t('sessions.count', { count: one.sessions })}  ${one.path}`)
  }
  console.log(`\n  ${t('workspaces.switchHint', { where: target.main ? '--main' : `--sandbox ${target.label}` })}`)
  console.log(`  ${t('workspaces.atFile', { file: listed.file })}\n`)
}

/**
 * What has been downloaded, who is using it, and how to get rid of it.
 *
 * ⛔ The listing leads with who uses each one because that is the question that
 * decides whether deleting is safe, and a list that made a person go and check
 * five workspaces by hand would send them back to the shell — which is the very
 * thing this command exists to stop.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function packages(layout, rest, opts) {
  const [action, name] = rest
  const used = packageUsers(layout)
  const all = listPackages(layout).map((one) => ({ ...one, usedBy: used.get(one.name) ?? [] }))

  if (action === 'rm') {
    if (name === undefined) {
      throw new BoxError('MISSING_ARGUMENT', t('packages.rmWhich'), { packages: all.map((one) => one.name) })
    }
    const going = all.find((one) => one.name === name)
    if (going === undefined) {
      throw new BoxError('NO_SUCH_PACKAGE', t('packages.noSuch', { name }), { name, packages: all.map((one) => one.name) })
    }
    // Refused rather than forced, because the workspace on the other end has a
    // link pointing here: deleting the folder would leave a name that resolves
    // to nothing, and dsh answers that by refusing to load the whole plugin
    // tree. The way out is named instead of hinted at.
    if (going.usedBy.length > 0) {
      throw new BoxError(
        'PACKAGE_IN_USE',
        t('packages.inUse', { name, usedBy: going.usedBy.join('、') }),
        { name, usedBy: going.usedBy },
      )
    }
    removePackage(layout, name)
    recordResolved({ action: 'packages.rm', name })
    if (opts.json === true) return void emit({ action: 'packages.rm', removed: [name] })
    return void console.log(`\n  ${t('packages.removed', { name })}\n`)
  }

  if (action === 'prune') {
    const going = all.filter((one) => one.usedBy.length === 0)
    for (const one of going) removePackage(layout, one.name)
    recordResolved({ action: 'packages.prune', removed: going.length })
    if (opts.json === true) {
      return void emit({ action: 'packages.prune', removed: going.map((one) => one.name) })
    }
    console.log(`\n  ${t('packages.pruned', { count: going.length })}`)
    for (const one of going) console.log(`    ${one.name}`)
    return void console.log()
  }

  if (action !== undefined) {
    throw new BoxError('UNKNOWN_ACTION', t('packages.unknownAction', { action }), { action })
  }

  if (opts.json === true) return void emit({ dir: packageRoot(layout), packages: all })
  console.log(`\n  ${t('packages.header')}`)
  if (all.length === 0) console.log(`    ${t('packages.empty')}`)
  for (const one of all) {
    const who = one.usedBy.length === 0 ? t('packages.nobodyUses') : t('packages.usedBy', { list: one.usedBy.join('、') })
    console.log(`    ${padWide(one.name, 32)} ${one.version.padEnd(12)} ${t('packages.filesCount', { count: String(one.files).padStart(5) })}  ${who}`)
  }
  console.log(`\n  ${t('packages.at', { dir: packageRoot(layout) })}`)
  if (all.length > 0) {
    console.log(`  ${t('packages.hints')}`)
  }
  console.log()
}

/**
 * Which workspaces have a plugin resolving into our download tree.
 *
 * Read from each workspace's own files rather than from anything remembered,
 * for the same reason the mount records live in the patch file: a second copy
 * of the same fact drifts the first time somebody edits by hand.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @returns {Map<string, string[]>}
 */
function packageUsers(layout) {
  const users = new Map()
  for (const workspace of everyCabinet(layout)) {
    for (const entry of cabinetPlugins(workspace.home).ours) {
      if (!isOurDownload(layout, entry.path ?? '')) continue
      users.set(entry.package, [...(users.get(entry.package) ?? []), workspace.label])
    }
  }
  return users
}

/**
 * Every filing cabinet this tool knows about, daily one first.
 *
 * ⚠️ **Knows about** is the limit, and it is worth stating rather than
 * discovering: the sandboxes are ours because we made them, and the daily
 * workspace is the one `DSH_HOME` points at. A home somebody made by hand and
 * never opened from here is invisible, so anything answering "everywhere this
 * is installed" is answering "everywhere we can see".
 * @param {import('../src/paths.js').BoxLayout} layout
 * @returns {{label: string, home: string, main: boolean, sandbox: string | null}[]}
 */
function everyCabinet(layout) {
  return [
    { label: t('cabinet.daily'), home: userDshHome(), main: true, sandbox: null },
    ...listSandboxes(layout).map((box) => ({
      label: box.name, home: box.home, main: false, sandbox: box.name,
    })),
  ].filter((workspace) => existsSync(workspace.home))
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} [opts]
 */
function showSandboxes(layout, opts = {}) {
  const all = listSandboxes(layout)
  if (opts.json === true) return void emit({ sandboxes: all })
  console.log(`\n  ${t('sandboxes.header')}`)
  if (all.length === 0) console.log(`    ${t('sandboxes.none')}`)
  for (const box of all) {
    const bits = [
      box.lastVersion ?? t('sandbox.neverStarted'),
      t('sessions.count', { count: box.sessions }),
      box.hasCredentials ? t('sandboxes.signedIn') : t('sandboxes.notSignedIn'),
    ]
    if (box.running !== null) bits.unshift(t('sandboxes.runningAt', { url: box.running.url }))
    console.log(`    ${padWide(box.name, 24)} ${bits.join('  ·  ')}`)
  }
  console.log()
}

/**
 * Pad to a column width measured in character cells, not code points.
 *
 * A terminal draws a Chinese character twice as wide as a Latin one, so
 * `padEnd` — which counts characters — leaves a column of Chinese names
 * visibly ragged. Nobody noticed while names could only be ASCII.
 * @param {string} text
 * @param {number} width - target width in cells.
 * @returns {string}
 */
function padWide(text, width) {
  return text + ' '.repeat(Math.max(width - cellWidth(text), 0))
}

/**
 * @param {string} text
 * @returns {number} how many terminal cells the text occupies.
 */
function cellWidth(text) {
  let cells = 0
  for (const character of text) cells += isWide(character.codePointAt(0)) ? 2 : 1
  return cells
}

/**
 * Whether a code point is drawn double-width. The ranges are the East Asian
 * Wide and Fullwidth blocks; anything a sandbox name is allowed to contain
 * falls inside or outside them cleanly.
 * @param {number} code
 * @returns {boolean}
 */
function isWide(code) {
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x20000 && code <= 0x3fffd)
}

/**
 * Copy a sandbox's conversations into the user's real dsh home.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
async function adopt(layout, name, opts) {
  // Three ways to say the same thing, and the shortest one is what the window
  // and every existing script use: `adopt <sandbox>` means "into my daily
  // workspace". `--from`/`--to` say it in full, and are the only way to say the
  // other direction. Giving both a name and `--from` is two answers to one
  // question, so it is refused rather than silently resolved.
  const explicit = opts.from !== undefined || opts.to !== undefined
  if (name !== undefined && explicit) {
    throw new BoxError('BAD_FLAG', t('adopt.bothForms'))
  }
  if (name === undefined && !explicit) {
    throw new BoxError('MISSING_ARGUMENT', t('adopt.which'))
  }
  const side = (value, fallback) => {
    if (value === undefined) return fallback
    return value === 'main' ? null : String(value)
  }
  const result = await adoptSessions(layout, {
    from: name === undefined ? side(opts.from, null) : name,
    to: name === undefined ? side(opts.to, null) : null,
    force: opts.force === true,
  })
  recordResolved({
    fromSandbox: result.fromSandbox,
    toSandbox: result.toSandbox,
    adopted: result.adopted,
    skipped: result.skipped,
    force: opts.force === true,
  })
  if (opts.json === true) return void emit({ action: 'adopt', ...result })
  console.log(`\n  ${t('adopt.copied', { from: result.from, to: result.to, adopted: result.adopted, skipped: result.skipped })}`)
  console.log(`  ${t('adopt.originalsStay', { from: result.from })}`)
  console.log(`  ${t('adopt.visibleNextStart', { to: result.to })}\n`)
}

/**
 * Start one dsh and hand the command line back.
 *
 * Handing it back is the whole point: a caller that runs one command at a
 * time cannot manage three sandboxes if the first command never returns.
 * `--follow` restores the old behaviour for a person who would rather watch.
 *
 * ⭐ Two independent choices, and nothing is carried over from last time.
 * Which installation to run is {@link resolveEngine}'s question — the user's
 * own dsh unless `--version` names one of ours. Which filing cabinet to open is
 * this function's — a sandbox, or `--main` for the real `~/.dsh`. Inheriting
 * either used to save a little typing and cost the property that matters more:
 * a written command that produces the same result whenever it is run. The same
 * line is what the badge renders and what a person copies out of a log, so a
 * command whose meaning depends on history is one neither can trust.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function start(layout, opts) {
  const config = readConfig(layout)
  const last = config.last

  const main = opts.main === true
  const brandNew = opts.new === true
  // One axis, one answer. These used to co-exist by having `--main` quietly
  // win, which reads as "it took my sandbox name into the real home".
  if (main && (typeof opts.sandbox === 'string' || brandNew)) {
    throw new BoxError('BAD_FLAG', t('start.bothFlags'))
  }
  if (!main && !brandNew && typeof opts.sandbox !== 'string') {
    throw new BoxError('MISSING_ARGUMENT', t('start.whichCabinet'))
  }
  const engine = resolveEngine(layout, { version: opts.version })
  const version = engine.version

  // Plugins are deliberately not inherited. Carrying the last selection
  // forward once had someone believing they were looking at plain official
  // dsh while a plugin from the previous run was loaded — silently, because
  // nothing in the command said so. Saying nothing now means nothing extra.
  const wanted = new Set(asList(opts.plugin))
  const { live, missing } = partitionPlugins(config)
  const gone = missing.filter((p) => wanted.has(p.id)).map((p) => p.id)
  const chosen = live.filter((p) => wanted.has(p.id))
  const unknown = [...wanted].filter((id) => !live.some((p) => p.id === id) && !gone.includes(id))
  if (unknown.length > 0) {
    throw new BoxError('UNKNOWN_PLUGIN', t('start.unknownPlugins', { list: unknown.join('、') }), { unknown })
  }

  const quiet = opts.json === true
  const say = quiet ? () => {} : (line) => console.log(line)
  for (const id of gone) say(`  ${t('start.pluginGone', { id })}`)

  const importSignIn = opts['no-sign-in'] !== true
  let boxName = t('cabinet.daily')
  // Whether the cabinet about to be opened actually holds a sign-in, which is
  // what decides whether the launch can spend money. The real home always does;
  // a sandbox only does if one was imported now or by an earlier launch.
  // ⛔ Not the same as `importSignIn`: `--no-sign-in` on a sandbox that was
  // signed in yesterday still opens a cabinet with a key in it.
  let hasCredentials = true
  if (main) {
    // ⭐ The gate, and the only one in this tool. Checked before anything else
    // about the world, so that the refusal is the same answer every time and
    // costs nothing to reach. What decides is which filing
    // cabinet is being opened, not which machine — opening a sandbox on any
    // machine is free, and opening the real home on the machine this computer
    // already has is simply what typing `dsh` does. The dangerous square is the
    // remaining one, and it is dangerous for two reasons that outlive the
    // launch: dsh states its on-disk formats have no migration path between
    // versions, and while that dsh runs, this home's module pointers aim into
    // dsh-box's folder.
    //
    // ⛔ Still not a lock on the machine — an agent can go around this tool
    // entirely — but no longer a plea either: the flag counts only when the run
    // was started by the config window, which is the one thing an agent cannot
    // be without a person being there. Locking the user out of their own
    // computer remains off the table (see §9.2).
    if (engine.kind === 'release' && !approvedByWindow(layout, opts.approved === true)) {
      throw new BoxError('NEEDS_APPROVAL', t('start.mainNeedsApproval'), { main: true, version, machine: 'release' })
    }
    if (await mainDshRunning()) {
      throw new BoxError('MAIN_DSH_RUNNING', t('start.mainAlreadyRunning'))
    }
    say(`\n  ${t('start.notSandbox')}`)
    if (engine.kind === 'release') {
      say(`  ${t('start.releaseOnMain')}`)
      say(`    ${t('start.releaseOnMainDetails')}`)
    }
  } else {
    // ⛔ A brand-new sandbox is taken in one step, never suggested and then
    // created: two of these fired at once used to agree on the same name.
    const { info, created, signInImported } = brandNew
      ? createNewSandbox(layout, { importSignIn })
      : ensureSandbox(layout, String(opts.sandbox ?? ''), { importSignIn })
    boxName = info.name
    hasCredentials = info.hasCredentials
    say(`\n  ${t(created ? 'sandbox.created' : 'sandbox.reused', { name: info.name })}${signInImported ? t('start.signInSuffix') : ''}`)
    if (!created) say(`  ${t('sandbox.ownConversations')}`)
  }
  // ⭐ Sign-in changed on the way in, the same shape as `--plugin` / `--unplug`:
  // saying neither changes nothing, because what a cabinet holds is a fact
  // about the cabinet rather than a setting of this launch.
  const cabinetHome = main ? userDshHome() : sandboxPaths(layout, boxName).home
  if (opts['sign-out'] === true) {
    if (main && !approvedByWindow(layout, opts.approved === true)) {
      throw new BoxError('NEEDS_APPROVAL', t('signOut.mainNeedsApproval'), { main: true })
    }
    if (removeCredentials(cabinetHome)) {
      hasCredentials = false
      say(`  ${t('signOut.done', { name: boxName })}`)
    }
  } else if (opts['sign-in'] === true && !hasCredentials) {
    if (main) throw new BoxError('MAIN_IS_THE_SOURCE', t('signIn.mainIsSource'))
    if (importCredentials(cabinetHome)) {
      hasCredentials = true
      say(`  ${t('signIn.done', { name: boxName })}`)
    }
  }
  say(`  ${t('start.usingEngine', { engine: engineLabel(engine) })}`)

  // ⭐ Plugins are registered in the workspace, not carried by the launch. So
  // this is not "install these" but "add these, remove those" — and saying
  // nothing means changing nothing, rather than starting with none. A workspace
  // that has a plugin keeps it, exactly as it would if `dsh` were typed by hand.
  //
  // Done before the launch, deliberately: everything here can refuse (a folder
  // that moved, a config we cannot read), and refusing before a dsh exists is
  // the difference between "nothing happened" and "something is half done".
  const home = main ? userDshHome() : sandboxPaths(layout, boxName).home
  const backups = snapshotDir(layout, { main, home })
  for (const id of asList(opts.unplug)) {
    const dropped = unmountPlugin({ home, id, backupDir: backups })
    if (dropped.removed !== null) say(`  ${t('start.unplugged', { package: dropped.removed.package })}`)
    else if (dropped.theirs) say(`  ${t('start.unplugTheirs', { id })}`)
    else say(`  ${t('start.unplugMissing', { id })}`)
  }
  if (chosen.length > 0) {
    linkPlugins(home, DEFAULT_PROFILE, chosen)
    for (const plugin of chosen) {
      const added = mountPlugin({
        home,
        plugin: { id: plugin.id, package: plugin.package, kind: 'link', path: plugin.path },
        backupDir: backups,
      })
      say(`  ${t(added.added ? 'start.pluginAdded' : 'start.pluginAlready', { package: plugin.package })}`)
    }
  }
  const mounted = cabinetPlugins(home)
  if (mounted.ours.length === 0 && mounted.theirs.length === 0) say(`  ${t('sandbox.plain')}`)
  else say(`  ${t('sandbox.holds', { names: [...mounted.ours.map((p) => p.package), ...mounted.theirs].join('、') })}`)

  // A sandbox keeps its own logs; a main-environment launch is not a sandbox
  // and its logs go to the data directory instead.
  const logFile = main
    ? newLaunchLog(join(layout.root, 'logs'), 'main')
    : newLaunchLog(sandboxPaths(layout, boxName).logs, 'start')
  const follow = opts.follow === true
  const result = await launch({
    layout,
    ...(main ? { home: userDshHome() } : { sandbox: boxName }),
    engine,
    // Nothing to carry: the cabinet already has whatever it has. This used to
    // be `chosen`, and that is what made a plugin exist only while dsh-box had
    // started the dsh — the same cabinet opened by hand had none of them.
    plugins: [],
    onLog: (line) => say(`  ${line}`),
    logFile,
    detached: !follow,
  })

  // What is remembered here is no longer what the next launch inherits — it is
  // what the window puts in its fields before anyone types. So a launch on the
  // user's own machine leaves the remembered download alone: it was never
  // chosen, and overwriting the last chosen one with it would move a control
  // nobody touched.
  updateConfig(layout, (current) => ({
    ...current,
    last: {
      version: engine.kind === 'release' ? version : last.version,
      sandbox: main ? last.sandbox : boxName,
      plugins: chosen.map((p) => p.id),
      importSignIn,
    },
  }))

  recordResolved({
    sandbox: boxName,
    main,
    // Only what was actually asked for is written down. `--version` names one
    // of our downloads; using the machine the user already has is what happens
    // when nothing names anything, so it renders as an absence, not as a value.
    version: engine.kind === 'release' ? version : undefined,
    engine: engineRecord(engine),
    plugins: chosen.map((p) => p.id),
    unplugged: asList(opts.unplug),
    // ⭐ Written down because the rendered line has to reproduce the launch, and
    // this is the one thing about it that outlives the launch: it decides
    // whether a sandbox created here has the real credentials copied in. Left
    // out, the line rendered from this record would re-run *with* sign-in.
    // Found by running it, not by reading it.
    importSignIn,
    url: result.url,
    port: result.port,
  })

  if (quiet) {
    emit({
      action: 'start',
      sandbox: boxName,
      main,
      version,
      engine: engineRecord(engine),
      url: result.url,
      pid: result.pid,
      port: result.port,
      plugins: chosen.map((p) => ({ id: p.id, package: p.package })),
      missingPlugins: gone,
      logFile,
      detached: !follow,
    })
  } else {
    console.log(`\n  ${t('launch.open', { url: result.url })}`)
    console.log(`  ${t(hasCredentials ? 'launch.realKey' : 'launch.noKey')}`)
    console.log(`  ${t('launch.logAt', { file: logFile })}`)
    if (follow) console.log(`  ${t('launch.followStop', { pid: result.pid })}\n`)
    else console.log(`  ${t('launch.detached', { pid: result.pid, name: boxName })}\n`)
  }

  if (!follow) return
  const shutdown = async () => {
    console.log(`\n  ${t('launch.stopping')}`)
    await stop(result.pid)
    if (!main) clearRunning(layout, boxName, result.pid)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  await tail(logFile)
}

/**
 * Stop one running sandbox.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
async function halt(layout, name, opts) {
  // `--main` names the one launch that has no sandbox name. It is a flag
  // rather than a reserved name so that a sandbox someone actually called
  // after the daily cabinet cannot be confused with it.
  if (opts.main === true) {
    const held = mainRunningRecord(layout)
    if (held === null) {
      throw new BoxError('NOT_RUNNING', t('stop.mainNotRunning'), {
        note: t('stop.mainNote'),
      })
    }
    await stop(held.pid)
    clearMainRunning(layout, held.pid)
    recordResolved({ main: true, pid: held.pid })
    if (opts.json === true) return void emit({ action: 'stop', main: true, pid: held.pid })
    return void console.log(`\n  ${t('stop.mainStopped', { pid: held.pid })}\n`)
  }
  if (name === undefined) throw new BoxError('MISSING_ARGUMENT', t('stop.which'))
  const record = runningRecord(layout, name)
  if (record === null) {
    throw new BoxError('NOT_RUNNING', t('stop.notRunning', { name }), { sandbox: name })
  }
  await stop(record.pid)
  clearRunning(layout, name, record.pid)
  if (opts.json === true) return void emit({ action: 'stop', sandbox: name, pid: record.pid })
  console.log(`\n  ${t('stop.stopped', { name, pid: record.pid })}\n`)
}

/**
 * Copy the user's sign-in into a sandbox that has none.
 *
 * ⛔ Only into a sandbox. The daily cabinet is where a sign-in comes *from*, so
 * "import it into itself" is not a smaller version of this — it is a sentence
 * that does not mean anything, and answering it with a shrug would leave
 * somebody believing they had done something.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
function signIn(layout, name, opts) {
  if (opts.main === true) throw new BoxError('MAIN_IS_THE_SOURCE', t('signIn.mainIsSource'))
  const target = name ?? String(opts.sandbox ?? '')
  if (target === '') throw new BoxError('MISSING_ARGUMENT', t('signIn.which'))
  const home = sandboxPaths(layout, target).home
  if (!existsSync(home)) throw new BoxError('NO_SUCH_SANDBOX', t('sandbox.noSuch', { name: target }), { sandbox: target })
  if (hasCredentials(home)) {
    if (opts.json === true) return void emit({ action: 'signin', sandbox: target, imported: false })
    return void console.log(`\n  ${t('signIn.already', { name: target })}\n`)
  }
  if (!importCredentials(home)) {
    throw new BoxError('NO_SIGN_IN_TO_COPY', t('signIn.nothingToCopy'), { sandbox: target })
  }
  recordResolved({ sandbox: target })
  if (opts.json === true) return void emit({ action: 'signin', sandbox: target, imported: true })
  console.log(`\n  ${t('signIn.done', { name: target })}\n`)
}

/**
 * Take the sign-in out of a cabinet.
 *
 * ⛔ The daily cabinet's copy is the user's own and there is no backup, so this
 * is the second thing behind the hard gate: it only runs when the config window
 * started this process. See {@link approvedByWindow}.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
function signOut(layout, name, opts) {
  const main = opts.main === true
  const target = main ? null : (name ?? String(opts.sandbox ?? ''))
  if (!main && target === '') throw new BoxError('MISSING_ARGUMENT', t('signOut.which'))
  const home = main ? userDshHome() : sandboxPaths(layout, target).home
  if (!existsSync(home)) {
    throw new BoxError('NO_SUCH_SANDBOX', t('sandbox.noSuch', { name: target }), { sandbox: target })
  }
  if (main && !approvedByWindow(layout, opts.approved === true)) {
    throw new BoxError('NEEDS_APPROVAL', t('signOut.mainNeedsApproval'), { main: true })
  }
  const label = main ? t('cabinet.daily') : target
  if (!removeCredentials(home)) {
    if (opts.json === true) return void emit({ action: 'signout', cabinet: label, removed: false })
    return void console.log(`\n  ${t('signOut.none', { name: label })}\n`)
  }
  recordResolved({ sandbox: target, main })
  if (opts.json === true) return void emit({ action: 'signout', cabinet: label, removed: true })
  console.log(`\n  ${t('signOut.done', { name: label })}`)
  console.log(`  ${t('signOut.noWayBack')}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
function remove(layout, name, opts) {
  if (name === undefined) throw new BoxError('MISSING_ARGUMENT', t('rm.which'))
  // The "does it exist" and "is it running" refusals are the core module's, so
  // that they apply to every entrance rather than to whichever one remembered.
  const gone = deleteSandbox(layout, name)
  if (opts.json === true) return void emit({ action: 'rm', sandbox: gone.name })
  console.log(`\n  ${t('rm.removed', { name: gone.name })}\n`)
}

/**
 * Read or change a setting.
 *
 * These used to be reachable only by clicking in the config window, which made
 * the window able to do something the command line could not — the exact shape
 * of drift this tool is built to rule out. Nothing here is new behaviour; it
 * is the same two settings, now with a door on this side as well.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function settings(layout, rest, opts) {
  const [key, value] = rest
  // ⭐ Above `readConfig`, because this is the way out of a config `readConfig`
  // refuses to read. A refusal with no named way past it is a tool that can be
  // bricked by one stray character, which is how "never overwrite what you
  // could not read" would turn from a safeguard into a trap.
  if (key === 'reset') return resetConfig(layout, opts)

  const config = readConfig(layout)
  if (key === undefined) {
    const current = Object.fromEntries(
      Object.entries(SETTINGS).map(([name, setting]) => [name, setting.read(config)]),
    )
    if (opts.json === true) return void emit({ settings: current })
    console.log(`\n  ${t('settings.header')}`)
    for (const [name, setting] of Object.entries(SETTINGS)) {
      console.log(`    ${name.padEnd(14)} ${String(setting.read(config)).padEnd(10)} ${setting.summary}`)
      console.log(`    ${' '.repeat(14)} ${t('settings.choicesLine', { choices: setting.choices.join(' | ') })}`)
    }
    return void console.log()
  }

  const setting = SETTINGS[key]
  if (setting === undefined) {
    throw new BoxError('UNKNOWN_SETTING', t('settings.unknown', { key }), {
      setting: key, known: Object.keys(SETTINGS),
    })
  }
  if (value === undefined) {
    throw new BoxError('MISSING_ARGUMENT', t('settings.whichValue', { key, choices: setting.choices.join(' | ') }))
  }
  if (!setting.choices.includes(value)) {
    throw new BoxError('BAD_SETTING_VALUE', t('settings.badValue', { key, value, choices: setting.choices.join(' | ') }), {
      setting: key, value, choices: setting.choices,
    })
  }

  const was = setting.read(config)
  updateConfig(layout, (current) => setting.write(current, value))
  recordResolved({ setting: key, value, was })
  if (opts.json === true) return void emit({ action: `config.${key}`, setting: key, value, was })
  console.log(`\n  ${t('settings.changed', { key, from: was, to: value })}\n`)
}

/**
 * Put the current settings file aside and start a fresh one.
 *
 * The counterpart to refusing to read a broken config: the old file is renamed,
 * never deleted, because what is in it — which plugin folders were registered —
 * is the part that cannot be reconstructed by looking anywhere else.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function resetConfig(layout, opts) {
  if (!existsSync(layout.config)) {
    throw new BoxError('NOTHING_TO_RESET', t('config.nothingToReset', { file: layout.config }), { file: layout.config })
  }
  const archived = `${layout.config}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`
  renameSync(layout.config, archived)
  recordResolved({ action: 'config.reset', archived })
  if (opts.json === true) return void emit({ action: 'config.reset', file: layout.config, archived })
  console.log(`\n  ${t('config.archived', { file: archived })}`)
  console.log(`  ${t('config.freshStart')}\n`)
}

/**
 * Stop every sandbox and let the program end.
 *
 * Closing the config window means quitting, not hiding a view, so it needs an
 * action on this side to correspond to — this is it. It is deliberately not
 * "whatever process was serving the window exits": there is no long-lived
 * dsh-box process to end. Every command is its own short-lived process, and
 * the sandboxes are separate dsh processes that were handed off on purpose.
 * So quitting can only be a thing that is *done*, and this is the doing of it.
 *
 * Sandboxes always. The main environment only when asked — it is the user's
 * own dsh, and someone quitting a sandbox manager does not necessarily mean
 * to close the thing they work in. `--main` is what the window's checkbox
 * calls, so the choice exists identically on both sides.
 *
 * ⛔ Only a main environment *this tool started* can be stopped, because only
 * that one has a recorded process. A dsh the user launched themselves is
 * visible (the port answers) but has no identity we could act on, and killing
 * something identified only by a port number is how you kill the wrong thing.
 *
 * ⚠ Each process is stopped exactly the way `stop` stops one, which on
 * Windows means `taskkill /T /F` — there is no way to ask another console
 * process to shut down politely there. Saying that plainly beats promising a
 * graceful exit this platform cannot deliver.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function quit(layout, opts) {
  const live = runningSandboxes(layout)
  const stopped = []
  for (const entry of live) {
    await stop(entry.pid)
    clearRunning(layout, entry.sandbox, entry.pid)
    stopped.push({ sandbox: entry.sandbox, pid: entry.pid })
  }

  const held = mainRunningRecord(layout)
  let main = null
  if (opts.main === true && held !== null) {
    await stop(held.pid)
    clearMainRunning(layout, held.pid)
    main = { pid: held.pid }
  }
  const mainUp = await mainDshRunning()
  recordResolved({ stopped: stopped.map((entry) => entry.sandbox), main: opts.main === true })

  if (opts.json === true) {
    return void emit({
      action: 'quit', stopped, main, mainStartedHere: held !== null, mainDshOnDefaultPort: mainUp,
    })
  }
  if (stopped.length === 0) console.log(`\n  ${t('quit.nothingRunning')}`)
  else console.log(`\n  ${t('quit.stopped', { count: stopped.length, names: stopped.map((entry) => entry.sandbox).join('、') })}`)
  if (main !== null) console.log(`  ${t('quit.mainStopped', { pid: main.pid })}`)
  else if (held !== null) console.log(`  ${t('quit.mainLeft')}`)
  else if (mainUp) console.log(`  ${t('quit.mainForeign')}`)
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function openUi(layout, opts) {
  const { serve } = await import('../src/server.js')
  await serve(layout, { port: Number(opts.port) || 0, open: opts['no-open'] !== true })
}

/**
 * Print a file's new content as it arrives, forever.
 *
 * Polling rather than watching: file watchers on Windows report changes for
 * a directory reliably and for an append-only file much less so, and a log
 * being tailed by a person does not need sub-second latency.
 * @param {string} file
 * @returns {Promise<never>}
 */
function tail(file) {
  let offset = 0
  const pump = () => {
    let size
    try {
      size = statSync(file).size
    } catch {
      return
    }
    if (size <= offset) return
    const fd = openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(size - offset)
      const read = readSync(fd, buffer, 0, buffer.length, offset)
      offset += read
      process.stdout.write(buffer.subarray(0, read).toString('utf8'))
    } finally {
      closeSync(fd)
    }
  }
  return new Promise(() => {
    pump()
    setInterval(pump, 400)
  })
}

/**
 * Split arguments into positionals and flags.
 *
 * Values are consumed here rather than filtered out later, so a value that
 * happens to look like a command — `--sandbox start` — cannot be mistaken for
 * one. An unrecognised flag is refused instead of ignored: a typo that is
 * quietly dropped produces a launch that is subtly not the one that was
 * asked for, and nothing reports it.
 * @param {string[]} argv
 * @returns {{positional: string[], flags: Record<string, string | boolean | string[]>}}
 */
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const key = equals === -1 ? token.slice(2) : token.slice(2, equals)
    if (BOOLEAN_FLAGS.has(key)) {
      if (equals !== -1) throw new BoxError('BAD_FLAG', t('flag.noValue', { flag: key }))
      flags[key] = true
      continue
    }
    if (!VALUE_FLAGS.has(key)) {
      throw new BoxError('UNKNOWN_FLAG', t('flag.unknown', { flag: key }), { flag: key })
    }
    if (equals !== -1) {
      addFlag(flags, key, token.slice(equals + 1))
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new BoxError('MISSING_VALUE', t('flag.needsValue', { flag: key }), { flag: key })
    }
    addFlag(flags, key, next)
    i += 1
  }
  return { positional, flags }
}

/**
 * @param {Record<string, string | boolean | string[]>} flags
 * @param {string} key
 * @param {string} value
 */
function addFlag(flags, key, value) {
  if (key in flags) flags[key] = [...asList(flags[key]), value]
  else flags[key] = value
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asList(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string')
  return typeof value === 'string' ? [value] : []
}

// ─────────────────────────────────────────────────────────────────────────────
//
// ⛔ Everything above is a declaration; this is the only thing that runs, and it
// runs last on purpose. It used to sit near the top, which put every `const`
// declared below it in the temporal dead zone at the moment a command needed
// one — so a command line that read perfectly died with "Cannot access X before
// initialization", and only on the branches that happened to touch such a
// constant. Two of them were live at once and neither was covered by a test.
// Running the program after everything it can reach has been defined removes
// the whole class of failure rather than the two instances of it.

try {
  // A parse error is thrown before `main` has chosen the language, so the
  // computer's own language stands in until then. `main` still decides for
  // real — a `config lang` setting read there wins over this seed.
  setLang(systemLang())
  const { positional, flags } = parseArgs(argv)
  await main(positional, flags)
  if (pending !== null && !alreadyRecorded && layout !== null) {
    record(layout, { command: pending.command, args: pending.args, ok: true })
  }
  if (layout !== null) finishCommand(layout, true)
} catch (error) {
  // A refused action is worth writing down precisely because it was refused:
  // an agent that cannot see where it was stopped walks into the same wall
  // next time.
  if (pending !== null && !alreadyRecorded && layout !== null) {
    record(layout, {
      command: pending.command,
      args: pending.args,
      ok: false,
      code: errorCode(error),
      message: error.message,
    })
  }
  if (layout !== null) finishCommand(layout, false, errorCode(error))
  if (wantsJson) {
    console.log(JSON.stringify({
      box: layout?.root ?? null,
      ok: false,
      code: errorCode(error),
      message: error.message,
      ...errorDetails(error),
    }))
  } else {
    console.error(`\n  ${error.message}`)
    // The tail was collected at the throw site and handed to `--json`, but the
    // person reading the screen was left with "exit code 1" and no reason —
    // and being sent to run `logs` to find out why is the same failure the
    // tail was added to prevent, one face later.
    const details = errorDetails(error)
    const tail = Array.isArray(details.tail) ? details.tail : []
    if (tail.length > 0) {
      console.error(`\n  ${t('error.lastLines', { count: tail.length })}`)
      for (const line of tail) console.error(`    ${line}`)
      if (typeof details.logFile === 'string') console.error(`\n  ${t('logs.fullFile', { file: details.logFile })}`)
    }
    console.error()
  }
  process.exit(1)
}
