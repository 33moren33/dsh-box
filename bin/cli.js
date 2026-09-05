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

import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import {
  backupDir, boxLayout, DAILY_CABINET, ensureBox, pickFreeBoxDir, resolveBoxDir, sandboxPaths, uiSeatFile,
  userDshHome, versionDir,
} from '../src/paths.js'
import {
  bundleNames, claimOn, DEFAULT_PROFILE, mountPlugin, profilePackageFile,
  removeBundle, restoreBackup, setDisabled, unmountPlugin, cabinetInventory,
  cabinetPlugins,
} from '../src/mounts.js'
import { aggregateOf } from '../src/aggregate.js'
import { stageIntoCabinet, unstageFromCabinet } from '../src/staging.js'
import { dropFromFarms } from '../src/engines.js'
import {
  downloadInFlight, installClaimFile, isOurDownload, listPackages, packageRoot, pluginVersion,
  removePackage,
} from '../src/packages.js'
import { addProject, listProjects } from '../src/workspaces.js'
import {
  announceEnvChange, copiesOn, entriesOf, exeDir, readUserPath, sameEntry, writeUserPath,
} from '../src/path-env.js'
import { processStartedAt } from '../src/process-identity.js'
import {
  describePlugin, readConfig, SETTINGS, updateConfig,
} from '../src/config.js'
import { everyCabinet, derivedRoster, partitionRoster } from '../src/roster.js'
import {
  BOOLEAN_FLAGS, COMMANDS, commandLine, describeCommand, describeCommands, describeParam, GLOBAL_PARAMS, helpLines, HISTORY_LINES, JSON_SCHEMA_DEFAULT, JSON_SCHEMAS,
  PROGRAM, VALUE_FLAGS, VERSION,
} from '../src/commands.js'
import { BoxError, errorCode, errorDetails, VERDICT_EXIT, verdictOf } from '../src/errors.js'
import { serve as serveMcp } from '../src/mcp.js'
import { setLang, systemLang, t } from '../src/messages.js'
import { detectHostDsh, engineLabel, engineRecord, resolveEngine } from '../src/host.js'
import { looksLikePath } from '../src/engine-path.js'
import {
  finishCommand, journalShape, noteCommand, readJournal, readSession, record, runningCommands,
} from '../src/journal.js'
import {
  appendLog, latestLog, listLogs, logShape, newLaunchLog, newPackageLog, newVersionLog, packageLog, readTail,
  troubleLines,
  versionLog,
} from '../src/logs.js'
import {
  installRelease, listReleases, missingFromRegistry, npmInvocation, resolveSource, SOURCES,
} from '../src/registry.js'
import { showInstant } from '../src/clock.js'
import {
  APPROVAL_WINDOW_MS, askApproval, ensurePanel, waitForApproval,
} from '../src/approval.js'
import {
  adoptSessions, APPROVAL_ENV, approvedByWindow, claimPath, clearMainRunning, clearRunning, createNewSandbox,
  credentialsState, deleteSandbox, describeClaim, ensureSandbox, forgetEngine,
  importCredentials, listSandboxes, liveClaim, mainDshRunning, mainRunningRecord, releasePath,
  removeCredentials, runningRecord, runningSandboxes,
} from '../src/sandbox.js'

/**
 * The four answers about a cabinet's sign-in, in the two places they are said.
 *
 * ⭐ A table rather than a chain of ternaries, and one table per face, because
 * the failure this whole change is repairing was a missing answer: two states
 * were being squeezed into a yes/no, and the one that got lost — a document
 * holding nothing but the browser session dsh signed for itself — was reported
 * as "signed in". A table makes a new state impossible to forget: it comes out
 * `undefined` here rather than silently landing in whichever branch was `else`.
 */
const CREDENTIALS_LABEL = {
  keys: 'sandboxes.signedIn',
  'session-only': 'sandboxes.sessionOnly',
  none: 'sandboxes.notSignedIn',
  unreadable: 'sandboxes.credsUnreadable',
}
const CREDENTIALS_SENTENCE = {
  keys: 'launch.realKey',
  'session-only': 'launch.sessionOnlyKey',
  none: 'launch.noKey',
  unreadable: 'launch.unreadableKey',
}
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
  // ⭐ The column is set by the longest usage that still fits; a usage wider
  //    than that gets its summary on the next line instead of pushing every
  //    other summary off the right edge. Generated usage lines are honest about
  //    every writing, so a few of them are long.
  const cap = 56
  const column = Math.min(cap, Math.max(...lines.map((entry) => cellWidth(entry.usage)))) + 2
  const list = lines.map((entry) => (cellWidth(entry.usage) > cap
    ? `  ${entry.usage}\n  ${' '.repeat(column)}${entry.summary}`
    : `  ${padWide(entry.usage, column)}${entry.summary}`))
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
  // ⭐ One row per parameter, from the declaration: what to write, what it
  //    means, whether it may be left out. The listing above says `[选项]` for
  //    the common ones; this is where they are spelled out — so a reader who
  //    reached this page has every argument in front of them, with a sentence
  //    each, and nothing is only in the source.
  const rows = described.params.map((one) => {
    const value = one.enum !== undefined ? `<${one.enum.join('|')}>` : one.valueWord === undefined ? '' : `<${one.valueWord}>`
    const head = one.at === undefined ? `--${one.name}${value === '' ? '' : ` ${value}`}` : value
    return { head: `${head}${one.repeat === true ? ' ...' : ''}`, tail: `${one.required ? `${t('help.required')}  ` : ''}${one.description}` }
  })
  if (rows.length > 0) {
    const column = Math.max(...rows.map((row) => cellWidth(row.head))) + 2
    lines.push(`  ${t('help.flags')}`, ...rows.map((row) => `    ${padWide(row.head, column)}${row.tail}`), '')
  }
  // ⭐ Above the read/write line and above the notes, because it is the part a
  // caller acts on. A reader who stops here should still know whether to wait,
  // what now exists, and what to type next.
  if (described.after !== '') lines.push(`  ${t('help.after')}  ${described.after}`)
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
/**
 * The command a help request is about, from the words as they were typed.
 *
 * Longest match first, so `plugins backups rm` finds its own page rather than
 * stopping at `plugins backups`. Anything that matches nothing comes back as
 * the words joined the way the table writes them, which is what the "no such
 * command" message should quote.
 * @param {string[]} words
 * @returns {string | undefined}
 */
function topicOf(words) {
  // ⛔ Split on whitespace before joining, because a shell hands `help "set
  // ask-on-quit"` across as **one** word. Joining the argv tokens with a dot
  // then produced `set ask-on-quit` — a name no table has — and the reader was
  // told there is no such command while looking straight at it in the listing.
  // Quoting a two-word topic is the natural thing to do, so it has to work.
  const given = words
    .filter((word) => word !== undefined)
    .flatMap((word) => String(word).split(/\s+/))
    .filter((word) => word !== '')
  if (given.length === 0) return undefined
  for (let take = given.length; take > 0; take -= 1) {
    const name = given.slice(0, take).join('.')
    if (COMMANDS[name] !== undefined) return name
  }
  return given.join('.')
}

/**
 * Every command sitting under one bare verb, e.g. `set` → `set.plugin`, ….
 *
 * ⭐⭐ The table is verb + object in two words, so the first thing anyone types
 * is `help set` — and `set` is not itself a command, so that used to answer
 * "there is no command called set". Three of the nine verbs (`get` / `rm` /
 * `set`) exist only as a first word, which means a third of the interface had
 * no way in but knowing the second word already. ⛔ A caller who knew the
 * second word did not need the help.
 * @param {string} topic
 * @returns {string[]}
 */
function familyOf(topic) {
  return Object.keys(COMMANDS).filter((name) => name.startsWith(`${topic}.`))
}

/**
 * @param {string | undefined} topic
 * @param {Record<string, unknown>} opts
 */
function showHelp(topic, opts) {
  const json = opts.json === true
  if (topic === undefined) {
    if (json) {
      return void console.log(JSON.stringify({
        // ⭐ Which build is answering. Here because `--help --json` is the one
        // request a caller makes before it has decided anything, and "am I
        // talking to the copy I just installed" has to be answerable then.
        schema: jsonSchema, box: null, ok: true, verdict: 'ok', action: 'help', program: PROGRAM, boxVersion: VERSION,
        // ⭐ The flags every command takes, described the same way each
        //    command's own are — so a tool schema can be built without knowing
        //    that `--box` exists.
        globals: GLOBAL_PARAMS.map((one) => describeParam(null, one)),
        // ⭐ The four verdicts and the exit code each projects to, as data —
        //    the same table a tool face maps onto `isError`.
        verdicts: VERDICT_EXIT,
        commands: describeCommands(),
      }))
    }
    return void process.stdout.write(usageText())
  }
  const described = describeCommand(topic)
  if (described === null) {
    // ⭐ A bare verb is not an unknown command, it is an incomplete one — so it
    // gets the short list of what can follow it rather than a refusal.
    const family = familyOf(topic)
    if (family.length === 0) {
      throw new BoxError('UNKNOWN_COMMAND', t('help.noSuchTopic', { topic }), {
        commands: Object.keys(COMMANDS),
      })
    }
    const under = family.map((name) => describeCommand(name))
    if (json) {
      return void console.log(JSON.stringify({
        schema: jsonSchema, box: null, ok: true, verdict: 'ok', action: 'help', topic, commands: under,
      }))
    }
    return void process.stdout.write(familyHelpText(topic, under))
  }
  if (json) {
    return void console.log(JSON.stringify({ schema: jsonSchema, box: null, ok: true, verdict: 'ok', action: 'help', command: described }))
  }
  process.stdout.write(commandHelpText(described))
}

/**
 * The listing for one verb, laid out like the full listing it is a slice of.
 * @param {string} topic
 * @param {object[]} under - from {@link describeCommand}, one per sub-command.
 * @returns {string}
 */
function familyHelpText(topic, under) {
  const column = Math.max(...under.map((one) => cellWidth(one.usage))) + 2
  const list = under.map((one) => `    ${padWide(one.usage, column)}${one.summary}`)
  return `\n  ${t('help.familyTitle', { verb: topic, count: under.length })}\n\n${list.join('\n')}\n\n  ${t('help.perCommand')}\n`
}

const argv = process.argv.slice(2)
// Read before parsing, because how a parse failure should be reported depends
// on it.
const wantsJson = argv.some((token) => token === '--json' || token.startsWith('--json='))
/** Which shape of machine answer was asked for; set by `parseArgs`. */
let jsonSchema = JSON_SCHEMA_DEFAULT
/** @type {import('../src/paths.js').BoxLayout | null} */
let layout = null

/**
 * The data directory the caller named, when it could not be used and another
 * one was substituted. `null` on every ordinary run.
 * @type {string | null}
 */
let boxAsked = null

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
    // ⭐ Sub-commands are asked about the way they are typed. The table keys
    // them with a dot (`plugins.install`) because that is what a record needs
    // to be one word, but nobody types a dot — and `help plugins install`
    // silently fell back to the `plugins` page, which answers a different
    // question and looks like a complete answer. Found by handing the help to
    // an agent that had read nothing else: it could not ask about two thirds of
    // the table. Both spellings work now; `describeCommand` still sees one name.
    const asked = command === 'help' ? rest : [command, ...rest]
    return void showHelp(topicOf(asked), opts)
  }
  // ⛔ Before the data directory is opened and before anything is recorded: a
  //    refused request — unknown verb, somebody else's flag — must leave
  //    nothing behind. `bogus` used to create the data directory and then say
  //    it did not know the word.
  if (!Object.keys(COMMANDS).some((name) => name === command || name.startsWith(`${command}.`))) {
    throw new BoxError('UNKNOWN_COMMAND', t('help.unknownCommand', { command }))
  }
  checkFlagsBelong(topicOf([command, ...rest]) ?? command, opts)

  // ⭐ The tool face does not open the data directory itself and writes nothing
  //    down: every call it receives runs this same program as a child, and that
  //    child opens, records and closes exactly as a typed command does. The
  //    directory is resolved here once so every call in the session is about
  //    the same world, whatever the working directory does meanwhile.
  if (command === 'mcp') {
    const maxChars = opts['max-chars'] === undefined ? undefined : Number(opts['max-chars'])
    if (maxChars !== undefined && !(Number.isInteger(maxChars) && maxChars > 0)) {
      throw new BoxError('BAD_FLAG', t('flag.needsPositiveInteger', { flag: 'max-chars', given: String(opts['max-chars']) }), { flag: 'max-chars' })
    }
    return void await serveMcp({ box: resolveBoxDir({ dir: typeof opts.box === 'string' ? opts.box : undefined }), maxChars })
  }

  layout = openBox(opts)
  pending = describeAction(command, rest, opts)
  // ⭐⭐ The one funnel every command passes through, which is why the answer to
  // "is anything being done to this data directory right now" is written here
  // and nowhere else. Nobody has to declare it: the record is opened by the
  // command and closed when the process leaves, both exits below.
  // ⛔ The recorded name (`get.plugin`), not the verb — that is the key the
  // command table declares `mutates` against, and only mutating commands leave
  // a record at all.
  noteCommand(layout, pending?.command ?? command, { ...opts, json: undefined })

  switch (command) {
    case 'ls': return look(layout, rest, opts)
    case 'get': return bringIn(layout, rest, opts)
    case 'rm': return takeAway(layout, rest, opts)
    case 'set': return change(layout, rest, opts)
    case 'start': return start(layout, rest[0], opts)
    case 'stop': return halt(layout, rest[0], opts)
    case 'logs': return showLogs(layout, rest[0], opts)
    case 'ui': return openUi(layout, opts)
    default: throw new BoxError('UNKNOWN_COMMAND', t('help.unknownCommand', { command }))
  }
}

/**
 * The second word, refused rather than ignored.
 *
 * ⛔ Every family used to spell this refusal for itself, and the most-used one
 * was the one that had forgotten to: `plugins instal <名>` fell through to the
 * listing and **exited 0** with a plausible table. A rule written once per
 * family is a rule the next family will be missing, so it is written once.
 * @param {string} verb
 * @param {string | undefined} what
 * @returns {never}
 */
function noSuchObject(verb, what) {
  throw new BoxError(
    what === undefined ? 'MISSING_ARGUMENT' : 'UNKNOWN_COMMAND',
    t('help.unknownCommand', { command: what === undefined ? verb : `${verb} ${what}` }),
  )
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function look(layout, rest, opts) {
  const [what] = rest
  // ⭐ Nothing after `ls` is not a missing argument: "everything true about this
  // data directory right now" is the answer an agent re-reads every turn, and
  // making it type a word for it would be a toll on the most frequent question.
  if (what === undefined) return showStatus(layout, opts)
  if (what === 'machine') return showVersions(layout, opts)
  if (what === 'plugin') return showPlugins(layout, opts)
  if (what === 'sandbox') return showSandboxes(layout, opts)
  if (what === 'workspace') return showWorkspaces(layout, opts)
  if (what === 'history') return showHistory(layout, opts)
  if (what === 'memory') return showMemory(layout, opts)
  if (what === 'setting') return showSettings(layout, opts)
  return noSuchObject('ls', what)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function bringIn(layout, rest, opts) {
  const [what, value] = rest
  if (what === 'machine') return pull(layout, value, opts)
  if (what === 'plugin') return installPlugin(layout, value, opts)
  if (what === 'signin') return signIn(layout, opts)
  if (what === 'chat') return adopt(layout, opts)
  return noSuchObject('get', what)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function takeAway(layout, rest, opts) {
  const [what, value] = rest
  if (what === 'machine') return drop(layout, value, opts)
  if (what === 'plugin') return uninstallPlugin(layout, value, opts)
  if (what === 'sandbox') return remove(layout, value, opts)
  if (what === 'signin') return signOut(layout, opts)
  if (what === 'setting') return resetConfig(layout, opts)
  return noSuchObject('rm', what)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 * @param {Record<string, unknown>} opts
 */
function change(layout, rest, opts) {
  const [what, value, state] = rest
  if (what === undefined) return noSuchObject('set', undefined)
  if (what === 'plugin') return setPlugin(layout, value, state, opts)
  if (what === 'workspace') return useWorkspace(layout, value, opts)
  if (what === 'path') return setPath(layout, value, opts)
  // ⭐ Everything else under `set` is a stored setting, and they are looked up
  // rather than listed here: a setting added to `SETTINGS` is one this verb can
  // already change, which is the whole reason that table exists.
  return changeSetting(layout, what, value, opts)
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
  const [what, value, state] = rest
  switch (command) {
    // ⛔ Which cabinet belongs in these records too. They used to say only
    // `target`, so a command that failed before the cabinet was resolved was
    // written down without it — and the rendered line came out as `--to` with
    // nothing after it, which is not a command anyone can re-run. The failures
    // are exactly the records worth having: an agent that cannot see where it
    // was stopped walks into the same wall next time.
    case 'get':
      if (what === 'machine') return { command: 'get.machine', args: { version: value } }
      if (what === 'plugin') return { command: 'get.plugin', args: { target: value, id: opts.id, to: opts.to } }
      if (what === 'signin') return { command: 'get.signin', args: { to: opts.to } }
      // Replaced by the resolved pair once the direction is known; this stands
      // in only for a run that fails before getting that far.
      if (what === 'chat') {
        return { command: 'get.chat', args: { fromSandbox: opts.from ?? null, toSandbox: opts.to ?? null } }
      }
      return null
    case 'rm':
      if (what === 'machine') return { command: 'rm.machine', args: { version: value } }
      if (what === 'plugin') return { command: 'rm.plugin', args: { target: value, from: opts.from } }
      if (what === 'sandbox') return { command: 'rm.sandbox', args: { sandbox: value } }
      if (what === 'signin') return { command: 'rm.signin', args: { from: opts.from } }
      if (what === 'setting') return { command: 'rm.setting', args: {} }
      return null
    case 'set':
      if (what === undefined) return null
      if (what === 'plugin') {
        return {
          command: 'set.plugin',
          // ⛔ `undefined` rather than `false` when nobody said which way: the
          // rendered line reads it back, and a blank filled in with a default
          // is the one thing a re-runnable line must never contain.
          args: {
            target: value,
            off: state === 'on' || state === 'off' ? state === 'off' : undefined,
            undo: opts.undo === true,
            in: opts.in,
            at: opts.at,
          },
        }
      }
      if (what === 'workspace') return { command: 'set.workspace', args: { target: value, in: opts.in } }
      if (what === 'path') return { command: 'set.path', args: { state: value, force: opts.force === true } }
      return { command: `set.${what}`, args: { value } }
    // ⭐ The cabinet is the positional now, and `main` is a name like any other
    // — so what gets written down is read off the same word a person typed.
    case 'start':
      return { command, args: { version: opts.version, sandbox: what, main: what === DAILY_CABINET } }
    // ⛔ The three switches are recorded even though the resolved record will
    // overwrite them: without one of them the line renders as a bare `stop`,
    // which reads as "stopped a sandbox" and is the one thing it did not do.
    case 'stop':
      return {
        command,
        args: {
          sandbox: what,
          main: what === DAILY_CABINET,
          all: opts.all === true,
          window: opts.window === true,
          download: opts.download === true,
        },
      }
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
  const { live, missing } = partitionRoster(derivedRoster(layout))
  const status = {
    // ⭐ Which build is answering. `ls` is the command an agent runs first in
    // every turn, so it is the one place a version has to be for the question
    // "am I driving the copy I just installed" to be answerable without
    // comparing file timestamps. The other entrance is `--help --json`, which
    // is what a caller reads before it has a data directory at all.
    boxVersion: VERSION,
    // ⭐ Every command running against this data directory at this instant,
    // including this reader's own siblings in another terminal. No longer "has
    // somebody announced themselves": nobody has to, so an agent that reads this
    // first thing in a turn finds out it is not alone whether or not the other
    // one was polite about it.
    runningCommands: runningCommands(layout),
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
    mainPlugins: cabinetPlugins(layout, userDshHome()),
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
    // ⭐ Whether this copy can be reached by typing its name. Here rather than
    // only under `path` because this is the reader an agent already calls
    // first: one that can see the answer fixes it in one command, while one
    // that cannot has no way to know the question exists.
    onPath: reachableByName(),
  }
  // ⭐⭐ The machine answer is the overview, not the dump. Measured on a real
  //    ledger: 16 sandboxes came to 30 KB, of which 21 KB was the sandboxes —
  //    each carrying every absolute path and the full list of platform packages
  //    (136 on one of them). A caller that reads `ls` first thing in every turn
  //    was paying ten thousand tokens for a question whose answer is a table
  //    with one line per sandbox. So containers give counts here; the paths are
  //    on `ls sandbox`, and what one cabinet holds is on `ls plugin --in <柜>`.
  //    The human face below has always been shaped this way.
  if (opts.json === true) {
    return void emit({
      ...status,
      sandboxes: boxes.map((box) => sandboxRow(box)),
      plugins: live.map(pluginRow),
      missingPlugins: missing.map(pluginRow),
      mainPlugins: pluginCounts(status.mainPlugins),
    })
  }

  // The label column is measured in terminal cells, not characters, because
  // these labels are Chinese and a Chinese character takes two of them.
  const label = (text) => padWide(text, 12)
  console.log(`\n  ${label(t('status.labelBoxVersion'))}${status.boxVersion ?? t('status.none')}`)
  console.log(`  ${label(t('status.labelDataDir'))}${layout.root}`)
  // ⛔ Reads `runningCommands`, which is the field that replaced `agent` when
  // `agent attach` / `agent detach` were deleted. This line was still asking for
  // `status.agent` — undefined rather than null, so the `=== null` test missed
  // and the whole human `ls` died on "Cannot read properties of undefined". Only
  // the `--json` face was covered, and it does not go through here.
  console.log(`  ${label(t('status.labelAgent'))}${status.runningCommands.length === 0
    ? t('status.agentNone')
    : status.runningCommands
      .map((run) => t('memory.runningNow', { command: run.command, pid: run.pid, at: showInstant(run.startedAt) }))
      .join('  ')}`)
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
 * A sandbox as one row of a listing: what it is, whether it runs, and what it
 * holds **by count**. The full inspection is what the window and the launch
 * path read; this is the view a caller reads to decide which sandbox to ask
 * about next.
 *
 * `running` keeps its full shape: it is the field other tools already read off
 * this answer, and it is small. Paths are given only when asked (`ls sandbox`),
 * never in the overview — every one of them is derivable from the data
 * directory and the name.
 * @param {ReturnType<typeof listSandboxes>[number]} box
 * @param {{paths?: boolean}} [options]
 */
function sandboxRow(box, { paths = false } = {}) {
  const { root, home, lastEngine, plugins, ...rest } = box
  return {
    ...rest,
    engine: lastEngine === null || lastEngine === undefined ? null : lastEngine.kind,
    ...(paths ? { root, home, lastEngine, patchFile: plugins.patchFile } : {}),
    plugins: pluginCounts(plugins),
  }
}

/**
 * What a cabinet holds, as three numbers and whether it could be read.
 *
 * The platform list is dsh's own — over a hundred names on a full profile —
 * and is the same in every cabinet of the same version; listing it per sandbox
 * was most of the overview's weight. `ls plugin --in <柜>` still gives the
 * names.
 * @param {{ours: unknown[], theirs: unknown[], platform: unknown[], readable: boolean}} plugins
 */
function pluginCounts(plugins) {
  return { ours: plugins.ours.length, theirs: plugins.theirs.length, platform: plugins.platform.length, readable: plugins.readable }
}

/**
 * A machine-wide plugin as one row: where it lives, and **which** cabinets have
 * it, by name. The daily cabinet is named as {@link DAILY_CABINET}, the same
 * value every `--in` / `--to` takes, so a row can be turned into a command
 * without a second lookup.
 * @param {{cabinets: {main: boolean, sandbox: string | null}[]}} plugin
 */
function pluginRow(plugin) {
  const { cabinets, ...rest } = plugin
  return { ...rest, cabinets: cabinets.map((one) => (one.main ? DAILY_CABINET : one.sandbox)) }
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
      console.log(`    ${t('logs.fileLine', { at: showInstant(entry.at), bytes: String(entry.bytes).padStart(8), file: entry.file })}`)
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
  // A plugin download's log, named by the package the same way a release's is
  // named by the version — so the window can watch an install it asked for
  // without a job id, exactly as it watches a `pull`.
  if (typeof opts.package === 'string') {
    return {
      where: t('logs.wherePackage', { name: opts.package }),
      what: t('logs.whatPackage'),
      file: packageLog(layout.root, opts.package),
      dir: null,
      never: t('logs.neverPackage'),
    }
  }
  if (name === DAILY_CABINET) {
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
function showMemory(layout, opts) {
  const session = readSession(layout)
  // ⭐ What is running right now rides along, because the first question an
  // agent waking up has is not only "what was done" but "is somebody else in
  // here at this moment" — and under the automatic scheme that is a thing it can
  // now be told without anybody having announced themselves.
  const running = runningCommands(layout)
  if (opts.json === true) return void emit({ session, running })
  if (session === null) return void console.log(`\n  ${t('memory.none')}\n`)
  console.log(`\n  ${t('memory.header', { session: session.session, at: showInstant(session.startedAt) })}`)
  for (const entry of session.actions) {
    const how = entry.ok ? t('memory.ok') : t('memory.refused', { code: entry.code })
    const who = entry.by === undefined || entry.by === null ? '' : `  ${t('run.byProcess', { pid: entry.by.pid })}`
    console.log(`    ${String(entry.seq).padEnd(3)} ${entry.command.padEnd(14)} ${how}${who}`)
    if (!entry.ok) console.log(`        ${entry.message}`)
  }
  for (const run of running) {
    console.log(`  ${t('memory.runningNow', { command: run.command, pid: run.pid, at: showInstant(run.startedAt) })}`)
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
  console.log(JSON.stringify({ schema: jsonSchema, box: layout?.root ?? null, ...boxSwap(), ok: true, verdict: 'ok', ...payload }))
}

/**
 * Where the caller pointed, when that is not where the answer is about.
 *
 * ⛔ Only present when the two differ. A field that is always there says
 * nothing on the ordinary run and would be read past; a field that appears only
 * when a substitution happened is the substitution, stated. `box` remains what
 * it always was — the directory actually used.
 * @returns {{boxAsked?: string}}
 */
function boxSwap() {
  return boxAsked === null ? {} : { boxAsked }
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
  // ⛔ `--box A --box B` is refused before this runs (`checkFlagsBelong`): a
  //    repeated flag arrives as an array, `typeof … === 'string'` read that as
  //    "not given", and the command once acted on the default directory —
  //    neither of the two named — in silence, exit code 0.
  const requested = resolveBoxDir({ dir: typeof opts.box === 'string' ? opts.box : undefined })
  try {
    return ensureBox(requested)
  } catch (error) {
    // Someone already owns a folder by that name. Taking it over silently is
    // the one failure mode that loses data belonging to another program.
    //
    // ⛔⛔ Beside the folder that was **asked for**, never beside the working
    // directory. It used to be `pickFreeBoxDir(process.cwd())`, which throws the
    // `--box` value away entirely and rebuilds a path from the default name —
    // and that read as "it used the data folder under the one I named" only
    // because the default name happens to end in `data` and the caller happened
    // to be standing in the parent. From anywhere else the same command lands in
    // an unrelated directory, quietly, and still exits 0.
    const near = basename(requested)
    const free = near === '' ? pickFreeBoxDir(requested) : pickFreeBoxDir(dirname(requested), near)
    // ⭐ Kept so the answer can say it. The red line below goes to stderr and
    // `--json` promises one parseable line on stdout — so to a caller reading
    // the JSON this substitution did not exist, and the command it just ran was
    // reported against a directory it never asked for.
    boxAsked = requested
    console.error(`  ${error.message}`)
    console.error(`  ${t('box.usingInstead', { dir: free })}\n`)
    return ensureBox(free)
  }
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
/**
 * The folders this box has been pointed at, worked out from the sandboxes.
 *
 * Not a stored list, on purpose. Each sandbox already records the installation
 * that last booted it, so this is a consequence of what has been run rather
 * than a second thing to keep in step with it — which is also why
 * `rm machine <folder>` is "forget" and not "unregister": there is no registry.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @returns {{dir: string, version: string | null, kind: string, sandboxes: string[]}[]}
 */
function namedMachines(layout) {
  const found = new Map()
  for (const info of listSandboxes(layout)) {
    const engine = info.lastEngine
    if (engine === null || engine === undefined) continue
    if (engine.kind !== 'tree' && engine.kind !== 'app') continue
    const seen = found.get(engine.dir)
    if (seen === undefined) {
      found.set(engine.dir, {
        dir: engine.dir, version: engine.version ?? null, kind: engine.kind, sandboxes: [info.name],
      })
    } else {
      seen.sandboxes.push(info.name)
    }
  }
  return [...found.values()]
}

async function showVersions(layout, opts) {
  const downloaded = downloadedVersions(layout)
  let releases = null
  let registryError = null
  try {
    releases = await listReleases({ source: readConfig(layout).source })
  } catch (error) {
    registryError = error.message
  }

  // The third kind of machine, worked out rather than kept: which folders the
  // sandboxes were last started on. Listed here because the summary of this
  // command promises all three, and a listing that quietly shows two of them is
  // how somebody concludes a folder "is not registered" and goes looking for a
  // command to register it.
  const named = namedMachines(layout)

  if (opts.json === true) {
    return void emit({
      downloaded,
      named,
      available: releases?.versions ?? [],
      tags: releases?.tags ?? {},
      registryError,
    })
  }

  console.log(`
  ${t('versions.named')}`)
  if (named.length === 0) console.log(`    ${t('versions.noneNamed')}`)
  for (const entry of named) {
    console.log(`    ${entry.dir}`)
    console.log(`      ${entry.version ?? ''} ${t('versions.namedBy', { list: entry.sandboxes.join('、') })}`)
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
  if (quiet) return void emit({ action: 'get.machine', version, packages: report.checked, log: lines, logFile })
  console.log(`\n  ${t('pull.ready', { version })}\n`)
}

/**
 * Take one machine out.
 *
 * ⭐⭐ One rule with two outcomes, and what decides is **whose it is** — the
 * same rule as taking out a plugin, so it is learned once instead of twice. A
 * release is ours, because we downloaded it, and it really goes from the disk.
 * A folder is theirs: only this tool's own record of it goes, and not one file
 * of theirs is touched.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} version - a release number, or a folder.
 * @param {Record<string, unknown>} opts
 */
async function drop(layout, version, opts) {
  if (version === undefined) throw new BoxError('MISSING_ARGUMENT', t('drop.which'))
  if (looksLikePath(version)) return forget(layout, version, opts)
  const logFile = newVersionLog(layout.root, version)
  const lines = []
  const quiet = opts.json === true
  if (!quiet) console.log()
  await deleteVersion(layout, version, (line) => {
    appendLog(logFile, line)
    if (quiet) lines.push(line)
    else console.log(`  ${line}`)
  })
  if (quiet) return void emit({ action: 'rm.machine', version, log: lines, logFile })
  console.log(`  ${t('drop.redownload')}\n`)
}

/**
 * Forget a folder this tool was pointed at, without touching it.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} dir
 * @param {Record<string, unknown>} opts
 */
function forget(layout, dir, opts) {
  const { forgotten, cleared, running } = forgetEngine(layout, dir)
  // ⛔ Refused before anything was written, and it says which sandbox is in the
  // way: clearing a pointer layer under a live dsh is the damage this record
  // exists to prevent, done sooner.
  if (running.length > 0) {
    throw new BoxError('MACHINE_IN_USE', t('forget.running', { list: running.join('、') }), { running, path: dir })
  }
  // ⭐ Nothing to forget is said as its own answer rather than as success. A
  // path typed with a typo would otherwise report "done" and leave the chip
  // exactly where it was.
  if (forgotten.length === 0) {
    throw new BoxError('MACHINE_NOT_KNOWN', t('forget.unknown', { path: dir }), { path: dir })
  }
  if (opts.json === true) {
    return void emit({ action: 'rm.machine', path: dir, forgotten, cleared, deleted: false })
  }
  console.log(`\n  ${t('forget.done', { path: dir, list: forgotten.join('、') })}`)
  console.log(`  ${t('forget.keptOnDisk', { path: dir })}`)
  if (cleared.length > 0) console.log(`  ${t('forget.cleared', { list: cleared.join('、') })}`)
  console.log()
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

/**
 * Which filing cabinet a command was aimed at.
 *
 * ⭐⭐ One value, read from whichever of `--in` / `--to` / `--from` this command
 * asks with. It used to be a choice between two flags, and "both given at once"
 * had to be refused — a refusal that cannot exist now, because a cabinet is a
 * name and the daily one's name is {@link DAILY_CABINET}. What is left is the
 * part that was always the point: this is the one place a cabinet gets chosen,
 * so a command added next month inherits the gate below without anybody
 * remembering it.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 * @param {boolean} [writes] - whether the caller is about to change the cabinet.
 * @param {'in' | 'to' | 'from'} [flag] - which flag names it, for this command.
 */
function cabinetTarget(layout, opts, writes = false, flag = 'in') {
  const named = opts[flag]
  if (typeof named !== 'string' || named === '') {
    throw new BoxError('MISSING_ARGUMENT', t('cabinet.which'))
  }
  if (named === DAILY_CABINET) {
    // ⚠️ `writes` is the whole distinction. Looking is never gated: an agent
    // must be able to read a cabinet and report what it found, and a refusal to
    // *look* would push it straight back to `cat`, which is the one place this
    // tool cannot show what happened. Each caller used to decide, and
    // installing and uninstalling into the real `~/.dsh` were both missed —
    // measured, not supposed: it answered `ok:true` with nobody asked.
    if (writes && !approvedByWindow(layout)) {
      throw new BoxError('NEEDS_APPROVAL', t('cabinet.dailyNeedsApproval'), { main: true })
    }
    return { main: true, label: t('cabinet.daily'), home: userDshHome(), sandbox: null }
  }
  const paths = sandboxPaths(layout, named)
  return { main: false, label: paths.name, home: paths.home, sandbox: paths.name }
}

/**
 * How to name this cabinet back to whoever asked, in the new shape.
 *
 * ⭐ Error messages quote the flags to type next, and a quoted flag that no
 * longer exists is worse than no hint at all — it is a hint that fails.
 * @param {{main: boolean, sandbox: string | null}} target
 * @param {'in' | 'to' | 'from'} [flag]
 * @returns {string}
 */
function cabinetFlag(target, flag = 'in') {
  return `--${flag} ${target.sandbox ?? DAILY_CABINET}`
}

/**
 * What plugins there are, or what one cabinet actually holds.
 *
 * ⭐ Two questions, and `--in` is which one is being asked: without it, "what
 * can this tool name at all"; with it, "what does that filing cabinet actually
 * have". Two layers, two answers, and conflating them is what made "is it
 * installed?" unanswerable.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function showPlugins(layout, opts) {
  if (typeof opts.in === 'string') {
    const target = cabinetTarget(layout, opts)
    const mounted = cabinetPlugins(layout, target.home)
    // ⭐ Read from the protocol rather than from our own bookkeeping: whoever
    // put a plugin here — us, `dsh plugin add`, or a hand edit — had to follow
    // the same format, so one reader finds all of them. Nobody has to re-enter
    // what the cabinet already knows.
    const inventory = cabinetInventory(target.home)
    const ours = new Set(mounted.ours.map((plugin) => plugin.id))
    if (opts.json === true) {
      return void emit({ cabinet: target.label, home: target.home, ...mounted, inventory })
    }
    console.log(`\n  ${t('plugins.cabinetHeader', { cabinet: target.label })}`)
    if (!mounted.readable) console.log(`    ${t('plugins.unreadableWarn')}`)
    if (inventory.rows.length === 0 && inventory.bundles.every((one) => one.platform)) {
      console.log(`    ${t('plugins.cabinetEmpty')}`)
    }
    for (const one of inventory.rows) {
      const note = one.kind === 'override'
        ? t('plugins.overrideLine', { id: one.id })
        : (ours.has(one.id ?? '')
          ? t('plugins.oursLine', { package: one.name })
          : t('plugins.theirsLine', { name: one.name }))
      const marks = [
        one.disabled === true ? t('plugins.offLine') : '',
        one.source === 'homePatch' ? t('plugins.fromHome') : '',
      ].filter((mark) => mark !== '').join(' ')
      console.log(`    ${padWide(one.id ?? '', 24)} ${note}${marks === '' ? '' : ` ${marks}`}`)
    }
    for (const one of inventory.bundles.filter((bundle) => !bundle.platform)) {
      console.log(`    ${padWide('', 24)} ${t('plugins.bundleLine', { name: one.name })}`)
      // ⭐ Opened, not named. A bundle is a whole layer — one line saying
      // `@linxin666/dsh-web-ui-all` is one word standing where seventeen
      // plugins are, and the ids under it are what `disable` takes.
      for (const row of one.rows) {
        console.log(`    ${padWide(row.id, 24)} ${t('plugins.viaBundleLine', { name: row.package })}`
          + `${row.disabled ? ` ${t('plugins.offLine')}` : ''}`)
      }
    }
    if (inventory.platform > 0) console.log(`\n  ${t('plugins.platformFolded', { count: inventory.platform })}`)
    return void console.log(`\n  ${t('plugins.patchAt', { file: mounted.patchFile })}\n`)
  }

  const { live, missing } = partitionRoster(derivedRoster(layout))
  // The version is read off each folder's own package.json at the moment of
  // asking, never stored: the registry row is a pointer, and what it points at
  // is where the truth about the version lives. `null` prints as nothing — a
  // folder without a readable version is not a fact worth a placeholder.
  const rows = live.map((plugin) => ({ ...plugin, version: pluginVersion(plugin.path) }))
  if (opts.json === true) return void emit({ plugins: rows.map(pluginRow), missingPlugins: missing.map(pluginRow) })
  console.log(`\n  ${t('plugins.registryHeader')}`)
  if (rows.length === 0 && missing.length === 0) console.log(`    ${t('plugins.registryEmpty')}`)
  for (const plugin of rows) {
    console.log(`    ${plugin.id.padEnd(24)} ${plugin.package}${plugin.version === null ? '' : ` ${plugin.version}`}`)
  }
  for (const plugin of missing) console.log(`    ${plugin.id.padEnd(24)} ${t('plugins.missingLine', { package: plugin.package })}`)
  console.log(`\n  ${t('plugins.installHint')}`)
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
  return everyCabinet(layout).filter((workspace) => cabinetPlugins(layout, workspace.home).ours
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
  const from = typeof opts.from === 'string' && opts.from !== '' ? opts.from : null
  // ⭐⭐ The positional is optional **only** when a cabinet is named to take
  // from, and that is the whole of "copy a whole cabinet": name one and that one
  // moves, name none and the cabinet's contents do. Two readings of one command
  // rather than two commands, so nothing in here has to know about directions.
  // ⛔ Whether the help says so is a separate fact from whether it works, and
  // for a while only the second was true — the usage line showed the positional
  // as required, so the whole-cabinet form existed and was unreachable by
  // anybody reading `--help`. A capability that cannot be discovered is, to
  // everything that only reads the help, not there.
  if (source === undefined) {
    if (from === null) throw new BoxError('MISSING_ARGUMENT', t('plugins.installWhich'))
    return copyCabinet(layout, from, opts)
  }
  const target = cabinetTarget(layout, opts, true, 'to')
  const config = readConfig(layout)
  // ⭐⭐ Looked up in the derived roster, not in a stored registry — which is
  // what makes "take what the daily cabinet has into a sandbox" work by name:
  // whatever a cabinet holds is nameable, without anybody having remembered to
  // register it first.
  // ⭐ `--from` narrows that lookup to one cabinet. Two cabinets can hold two
  // different folders under one id, and answering with whichever came first
  // would copy the wrong one while reporting the right name.
  const roster = from === null ? derivedRoster(layout) : rosterOf(layout, from)
  const known = roster.find((entry) => entry.id === source)
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
 * What one named cabinet holds, out of the roster everything else reads.
 *
 * ⛔ A cabinet that is not there is said so rather than answered with an empty
 * list. "Nothing to copy" and "there is no such cabinet" are different facts,
 * and a copy that quietly did nothing is the failure a caller does not notice.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name - a sandbox name, or {@link DAILY_CABINET}.
 * @returns {import('../src/roster.js').RosterEntry[]}
 */
function rosterOf(layout, name) {
  const known = everyCabinet(layout).some((one) => (one.sandbox ?? DAILY_CABINET) === name)
  if (!known) {
    throw new BoxError('NO_SUCH_SANDBOX', t('sandbox.noSuch', { name }), { sandbox: name })
  }
  return derivedRoster(layout)
    .filter((entry) => entry.cabinets.some((one) => (one.sandbox ?? DAILY_CABINET) === name))
}

/**
 * Copy every plugin one cabinet holds into another.
 *
 * ⭐⭐ **The direction is an argument here, not a feature.** The old shape said
 * where a plugin was going with `--main` / `--sandbox`, so the window grew a
 * wire per direction and "the daily cabinet's setup into a sandbox" was a thing
 * somebody had to build. With `--from` and `--to` both being names, the reverse
 * needs no implementation at all — which is also why deleting the stored
 * registry was not optional: the daily cabinet's plugins are nameable only
 * because the list is worked out from what the cabinets hold.
 *
 * ⛔ One failure does not stop the rest. A cabinet holds plugins of several
 * kinds — one whose folder has been moved, one whose name is already taken over
 * there — and abandoning the copy at the first would leave the target half
 * filled with no statement of where it stopped. Every one is attempted and the
 * answer says which did what.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} from
 * @param {Record<string, unknown>} opts
 */
async function copyCabinet(layout, from, opts) {
  const target = cabinetTarget(layout, opts, true, 'to')
  if ((target.sandbox ?? DAILY_CABINET) === from) {
    throw new BoxError('SAME_WORKSPACE', t('plugins.copySameCabinet', { name: from }), { cabinet: from })
  }
  const { live, missing } = partitionRoster(rosterOf(layout, from))
  /** @type {object[]} */
  const collect = []
  /** @type {object[]} */
  const refused = []
  for (const entry of live) {
    try {
      installFromFolder(layout, entry.path, target, opts, { id: entry.id, source: entry.id, collect })
    } catch (error) {
      // ⭐ Kept as the code, not as prose: this list is what a caller decides
      // what to do next from, and `PLUGIN_NAME_TAKEN` is a different next step
      // from `UNREADABLE_PATCH`.
      refused.push({ id: entry.id, package: entry.package, code: errorCode(error), message: error.message })
    }
  }
  const copied = collect.filter((one) => one.added === true)
  const already = collect.filter((one) => one.alreadyThere === true)
  recordResolved({ from, main: target.main, sandbox: target.sandbox, brought: copied.length })
  if (opts.json === true) {
    return void emit({
      action: 'get.plugin',
      from,
      cabinet: target.label,
      home: target.home,
      copied: copied.map((one) => ({ id: one.plugin.id, package: one.plugin.package })),
      alreadyThere: already.map((one) => ({ id: one.plugin.id, package: one.plugin.package })),
      // A row whose folder is gone is not a failure of the copy — it is a fact
      // about the cabinet being copied, and one the caller may want to fix.
      missing: missing.map((one) => ({ id: one.id, package: one.package })),
      refused,
    })
  }
  console.log(`\n  ${t('plugins.copyDone', { from, cabinet: target.label, count: copied.length })}`)
  for (const one of copied) console.log(`    ${one.plugin.package}`)
  if (already.length > 0) console.log(`  ${t('plugins.copyAlready', { count: already.length })}`)
  for (const one of missing) console.log(`  ${t('plugins.copyMissing', { package: one.package })}`)
  for (const one of refused) console.log(`  ${t('plugins.copyRefused', { package: one.package, why: one.message })}`)
  console.log()
}

/**
 * Put one folder into one workspace. The single road every plugin takes.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} dir
 * @param {{main: boolean, label: string, home: string, sandbox: string | null}} target
 * @param {Record<string, unknown>} opts
 * @param {{id?: string, source?: string, store?: string, logFile?: string}} [about] - `store` is
 * where our own copy of a downloaded package lives, when the cabinet got a
 * staged copy instead. The registry records the store — it is one list across
 * every cabinet, and `isOurDownload` (which decides whether `plugins rm` may
 * delete the package) reads exactly that field — while `dir` is what dsh loads.
 * `logFile` is where the download that preceded this was journalled, when there
 * was one; it rides into the `--json` answer so a caller knows where to look.
 * @param {object[]} [about.collect] - when given, the outcome is pushed here
 * instead of being printed. ⛔ This exists for one caller and one reason:
 * copying a whole cabinet installs many plugins, and `--json` promises **one**
 * parseable line. Without it a twelve-plugin copy answers with twelve lines,
 * each of which looks like a complete answer to the command that was typed.
 */
function installFromFolder(layout, dir, target, opts, { id, source, store, logFile, collect } = {}) {
  const quiet = Array.isArray(collect)
  // Described afresh even when it is already registered: what was checked when
  // it was added was that folder as it was then, and "is this still a loadable
  // plugin" is only true at the moment it is asked.
  const plugin = describePlugin(dir, { id })
  // ⭐⭐ One npm package can be seventeen plugins. Read before anything is
  // checked or linked, because what follows has to be checked and linked for
  // every one of the seventeen — `@linxin666/dsh-web-ui-all` installed as one
  // row boots a healthy dsh with one plugin in it and warns about nothing.
  // Refusals for an aggregate that cannot be inlined are thrown from in here,
  // above every write, which is where they belong.
  const family = aggregateOf(plugin.path, plugin.package)
  // ⭐ Every refusal has to happen here, above the link. `linkPlugins` replaces
  // whatever holds that name without looking at it, so any check placed after it
  // can only describe a loss already taken.
  const claim = claimOn({ layout, home: target.home, package: plugin.package, path: plugin.path })
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
  // ⛔ Nothing is written down here any more. Installing used to also add a row
  // to a registry in our own config; that registry is gone, and the reason it
  // could go is visible right here — **every fact it held is a consequence of
  // the write that happens below.** The cabinet's own file says the plugin is
  // there, our store says we fetched it, and the roster is worked out from those
  // two. A record kept alongside them could only ever agree or drift.
  // ⚠️ `store` still matters, but as an argument rather than a stored field: it
  // is where our copy lives when the cabinet got a staged copy instead.
  // ⛔⛔ Already ours in this cabinet. Without this branch the verdict fell
  // through to the link and the mount below, and `mountPlugin` appends — so
  // installing the same plugin twice wrote a **second identical row** into the
  // patch, which is what the window showed as one plugin listed twice. The row
  // is already there; the only thing that can still be missing is the link.
  if (claim.verdict === 'ours') {
    if (claim.linked !== true) {
      // The row survived but the link did not, so there is real work — and it is
      // only the link. ⭐ Said out loud rather than folded into "already there":
      // the premise of "nothing done" is that nothing was done.
      linkPlugins(target.home, DEFAULT_PROFILE, [plugin])
      const relinked = {
        action: 'get.plugin',
        cabinet: target.label,
        home: target.home,
        plugin,
        added: false,
        alreadyThere: true,
        relinked: true,
        backup: null,
        logFile: logFile ?? null,
      }
      if (quiet) return void collect.push(relinked)
      if (opts.json === true) return void emit(relinked)
      console.log(`\n  ${t('plugins.relinked', { cabinet: target.label, package: plugin.package })}\n`)
      return
    }
    const already = {
      action: 'get.plugin',
      cabinet: target.label,
      home: target.home,
      plugin,
      added: false,
      alreadyThere: true,
      relinked: false,
      backup: null,
      logFile: logFile ?? null,
    }
    if (quiet) return void collect.push(already)
    if (opts.json === true) return void emit(already)
    console.log(`\n  ${t('plugins.alreadyOurs', { cabinet: target.label, package: plugin.package })}`)
    console.log(`  ${t('plugins.nothingDone')}\n`)
    return
  }

  // Already resolving to this very folder, and already named in the workspace's
  // patch: there is nothing to do, and this is the one branch entitled to say so
  // — nothing has been touched at the point it is said.
  if (claim.verdict === 'same') {
    const same = {
      action: 'get.plugin',
      cabinet: target.label,
      home: target.home,
      plugin,
      added: false,
      alreadyThere: true,
      backup: null,
      logFile: logFile ?? null,
    }
    if (quiet) return void collect.push(same)
    if (opts.json === true) return void emit(same)
    console.log(`\n  ${t('plugins.alreadyThere', { cabinet: target.label, package: plugin.package, points: claim.points })}`)
    console.log(`  ${t('plugins.nothingDone')}\n`)
    return
  }

  // ⛔ Every member gets its own link, and that half is not optional: dsh
  // resolves a row's `name:` through `profiles/<profile>/node_modules`, so a row
  // whose package is not linked there loads on the server and never appears in
  // the browser — silently, and the negative result is cached by name and not
  // retried.
  const brings = family === null
    ? []
    : family.rows.map((row) => ({ id: row.id, package: row.package, kind: 'link', path: row.path }))
  linkPlugins(target.home, DEFAULT_PROFILE, brings.length === 0 ? [plugin] : brings)
  const result = mountPlugin({
    layout,
    home: target.home,
    plugin: { id: plugin.id, package: plugin.package, kind: 'link', path: plugin.path },
    brings,
    backupDir: snapshotDir(layout, target),
  })
  recordResolved({
    id: plugin.id, package: plugin.package, source: source ?? plugin.path, main: target.main, sandbox: target.sandbox,
    brought: brings.length,
  })

  const done = {
    action: 'get.plugin',
    cabinet: target.label,
    home: target.home,
    plugin,
    added: result.added,
    backup: result.backup,
    // Named, not counted: an aggregate is the one install where what arrived
    // is not what was asked for, so the answer has to list it.
    brought: brings.map((one) => ({ id: one.id, package: one.package })),
    // Where the download before this was journalled — null for a local
    // folder, which downloads nothing and writes no log.
    logFile: logFile ?? null,
  }
  if (quiet) return void collect.push(done)
  if (opts.json === true) return void emit(done)
  // Reachable only if something else claimed this name between the check above
  // and this line. Said plainly rather than as "it was already there, skipped",
  // which is the sentence that used to hide a replaced package: by here the link
  // has been made, so "skipped" would not be true.
  if (!result.added) {
    console.log(`\n  ${t('plugins.raceTaken', { package: plugin.package, cabinet: target.label })}`)
    console.log(`  ${t('plugins.raceCheck')}`)
    console.log(`  ls plugin --in ${target.sandbox ?? DAILY_CABINET}\n`)
    return
  }
  console.log(`\n  ${t('plugin.installed', { name: plugin.package, where: target.label })}`)
  if (brings.length > 0) {
    console.log(`  ${t('aggregate.expanded', { name: plugin.package, count: brings.length, file: family.file })}`)
    for (const one of brings) console.log(`    ${padWide(one.id, 30)} ${one.package}`)
  }
  console.log(`  ${t('plugin.installedWhere', { file: result.patchFile })}`)
  if (result.backup !== null) console.log(`  ${t('backup.saved', { file: result.backup })}`)
  console.log(`  ${t('plugin.removeHint', { id: plugin.id, cabinet: cabinetFlag(target, 'from') })}\n`)
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
  // Our own little package tree, shared by every workspace: a plugin fetched
  // once is linked wherever it is wanted, and its dependencies resolve from
  // beside it because Node resolves through a link to where the folder really is.
  mkdirSync(layout.packages, { recursive: true })
  // ⛔⛔ Only one npm may be writing this tree. Two of them break each other for
  // real — measured, `EBUSY … rename 'node_modules/cloudflared'` — because the
  // dependency they collide over need not be one either of them was asked for.
  //
  // Taken before the log is opened, and that order is the point: opening the log
  // truncates it, so a refused second run must not reach that line, or it would
  // wipe the progress of the run it just lost to. Ask, then act, with nothing in
  // between — `claimPath` creates with `wx`, so the question and the taking are
  // one operation.
  const claim = installClaimFile(layout)
  const busy = downloadInFlight(layout)
  if (!claimPath(claim, { name, log: packageLog(layout.root, name) })) {
    throw new BoxError('INSTALL_IN_FLIGHT', t('plugins.installInFlight', {
      other: busy === null ? name : busy.name,
    }), { other: busy?.name ?? null })
  }
  try {
    return await downloadThenInstall(layout, name, target, opts)
  } finally {
    // Released however this ended, including a crash on the way out: a claim
    // outliving its process is only survivable because the next reader checks
    // the pid, and leaning on that would turn a safety net into the mechanism.
    releasePath(claim)
  }
}

/**
 * The download itself, with the tree already claimed for this process.
 *
 * Split out only so the claim above can be released on every exit — there are
 * four, counting the two refusals npm's answer can produce.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {{main: boolean, label: string, home: string, sandbox: string | null}} target
 * @param {Record<string, unknown>} opts
 */
async function downloadThenInstall(layout, name, target, opts) {
  // Every progress line goes to a file as well as to the console, exactly as a
  // release download's does: the file is what lets another entrance — the
  // window, a second terminal — watch a download it did not perform. In
  // `--json` mode the console stays silent and the file is the only witness.
  const logFile = newPackageLog(layout.root, name)
  const say = (line) => {
    appendLog(logFile, line.trim())
    if (opts.json !== true) console.log(line)
  }
  if (!existsSync(join(layout.packages, 'package.json'))) {
    writeFileSync(join(layout.packages, 'package.json'), `${JSON.stringify({
      name: 'dsh-box-plugins', private: true, description: t('packages.treeDescription'),
    }, null, 2)}\n`)
  }
  const chosen = readConfig(layout).source
  const registry = await resolveSource(chosen, say)
  // npm says almost nothing while it resolves the graph — minutes, for a big
  // aggregate — so the log gets a heartbeat, the same one deleting a release
  // has: a watcher tells "still working" from "hung" by whether the file moves.
  //
  // ⛔⛔ **A timer alone cannot tell working from stuck**, which is the one job
  // it was added for. Measured: an install sat at "still downloading" for
  // eighteen minutes while every package was already on disk and a dependency's
  // postinstall hung on an unreachable GitHub — the number climbed the whole
  // time and said nothing. So the beat also counts what has landed: **a number
  // that stops moving is the signal**, and it costs one shallow `readdir`.
  const started = Date.now()
  const beat = setInterval(() => {
    appendLog(logFile, t('plugins.stillDownloading', {
      seconds: Math.round((Date.now() - started) / 1000),
      packages: listPackages(layout).length,
    }))
  }, 3000)
  /** @param {string} from */
  const fetchFrom = async (from) => {
    say(`\n  ${t('plugins.downloading', { registry: from, name })}`)
    // ⭐ `--foreground-scripts` because npm hides lifecycle output by default,
    // and that is exactly where the eighteen minutes went: a `postinstall`
    // downloading a binary, invisible. Noisier, and worth it — a log that omits
    // the part that hangs is a log that cannot explain the hang.
    await runNpm(layout.packages,
      ['install', name, '--no-audit', '--no-fund', '--foreground-scripts', '--registry', from], say,
      // ⛔ The birth instant travels with the pid, always. A second process in
      // the same row needs its own, or that row answers "is this still npm"
      // with nothing, and every reader concludes the download is over.
      (npm) => describeClaim(installClaimFile(layout), { npm, npmBorn: processStartedAt(npm) }))
  }
  try {
    try {
      await fetchFrom(registry)
    } catch (error) {
      // ⛔⛔ **One missing tarball must not throw away a three-minute install.**
      // Measured: `@linxin666/dsh-web-ui-all` resolved 314 packages against the
      // mirror and then died on a single 404 from `cdn.npmmirror.com` — for a
      // tarball that answered 200 twenty minutes later. A mirror that has the
      // metadata but not yet the file is a *transient* state, and npm treats 404
      // as final because from where it stands it is.
      //
      // ⭐ The retry is only legitimate because the mirror was never asked for:
      // `auto` picked it, on speed alone, and speed was never the same question
      // as completeness. Somebody who wrote `config source mirror` gets told
      // instead — overriding an explicit choice would make the same command mean
      // different things on different days.
      //
      // ⛔⛔ **And only when npm said the source was the problem.** The first
      // edition of this retried on *any* failure, and the very first time it
      // fired for real it threw away twenty-three minutes to start the same 314
      // packages over: the install had actually been killed, npm had printed
      // nothing at all, and the true blocker was a dependency's postinstall
      // fetching a binary from GitHub — which no registry can fix. **"npm
      // failed" is not "the registry was wrong."** Silence is not evidence, and
      // a retry on no evidence is just the same wait twice.
      if (chosen !== 'auto' || registry === SOURCES.official || !missingFromRegistry(error)) throw error
      say(`\n  ${t('plugins.retryOfficial', { mirror: registry })}`)
      appendLog(logFile, error.message)
      await fetchFrom(SOURCES.official)
    }
  } catch (error) {
    // The one line the log must not be missing: whoever is tailing it watches
    // the download stop, and deserves to read why in the same place.
    appendLog(logFile, error.message)
    if (chosen === 'mirror') say(`\n  ${t('plugins.mirrorHint')}`)
    throw error
  } finally {
    clearInterval(beat)
  }

  const dir = join(layout.packages, 'node_modules', ...name.split('/'))
  if (!existsSync(join(dir, 'package.json'))) {
    appendLog(logFile, t('npm.saidOkButEmpty', { name, dir }))
    throw new BoxError('NPM_FAILED', t('npm.saidOkButEmpty', { name, dir }), { name, dir })
  }
  say(`  ${t('plugins.downloaded', { dir })}`)
  if (target.main) {
    // ⛔⛔ The daily cabinet gets a **copy inside itself**, because where the
    // files physically sit decides which shelf their imports meet: a package
    // left in our tree resolves its `@deepseek-ai/*` imports from its real
    // directory, the walk from there never crosses `$DSH_HOME/profiles/`, and
    // dsh refuses the whole plugin tree. The copy is also what makes the daily
    // cabinet self-sufficient — `dsh` typed by hand loads it, and deleting this
    // tool's data directory costs it nothing. Upstream's own shape: junctions
    // into `<profile>/_local/`.
    const staged = stageIntoCabinet({ layout, home: target.home, profile: DEFAULT_PROFILE, package: name })
    if (staged.copied.length > 1) say(`  ${t('plugins.staged', { count: staged.copied.length })}`)
    return finishInstall(layout, staged.dir, target, opts, { source: name, store: dir, logFile }, name)
  }
  // A sandbox keeps the junction aimed at our tree for now; every launch
  // re-aims it at the farm of the engine about to boot (`src/engines.js`),
  // which is what lets one download serve every version without a copy.
  return finishInstall(layout, dir, target, opts, { source: name, logFile }, name)
}

/**
 * The linking half of a package install, with its ending written to the log.
 *
 * A wrapper and nothing more: the download's log has to say how the story
 * ended, whichever way it ended, because a tail that just stops reads as a
 * hang — and the refusals `installFromFolder` throws (name taken, unreadable
 * patch) happen after the minutes-long part a watcher has been staring at.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} dir
 * @param {{main: boolean, label: string, home: string, sandbox: string | null}} target
 * @param {Record<string, unknown>} opts
 * @param {{source: string, store?: string, logFile: string}} about
 * @param {string} name
 */
function finishInstall(layout, dir, target, opts, about, name) {
  try {
    const done = installFromFolder(layout, dir, target, opts, about)
    appendLog(about.logFile, t('plugins.installReady', { name, cabinet: target.label }))
    return done
  } catch (error) {
    appendLog(about.logFile, error.message)
    throw error
  }
}

/**
 * How long a single npm run may take before it is ended.
 *
 * Whole, not idle-based: the same command has to mean the same thing every time,
 * and "idle" would need a definition of progress npm does not offer. Fifteen
 * minutes against a measured five for 389 packages leaves room for a bad line
 * without leaving room for a hang that never ends.
 */
const NPM_TIMEOUT_MS = 15 * 60 * 1000

/** How many lines of somebody else's install script this log will carry. */
const SCRIPT_LINES = 200

/**
 * End a process **and everything it started**.
 *
 * ⛔⛔ `child.kill()` is not enough and the difference is not academic — it has
 * cost three separate hours today. Killing a parent leaves its children running:
 * an interrupted command left an npm behind that kept writing the package tree;
 * a test's `spawnSync` timeout left one that made the cleanup fail; and the
 * install this timeout exists for hangs **two levels down**, in a dependency's
 * script, not in npm itself. Ending only the top would report a timeout while
 * the thing that hangs kept the directory busy.
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (typeof child.pid === 'number') killPidTree(child.pid, child)
}

/**
 * The same, for a pid read off disk — a process this run never started.
 *
 * ⚠️ No process-group trick available here: the group only holds if *we* spawned
 * it detached, and `packages cancel` is a different run entirely. Windows still
 * gets the whole tree from `taskkill /T`; elsewhere the group id equals the pid
 * for a leader, so the negative signal is tried first and a plain one is the
 * fallback.
 * @param {number} pid
 * @param {import('node:child_process').ChildProcess} [child] - when we own it.
 */
function killPidTree(pid, child) {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    // The one dependable way on Windows; `/T` is the whole point of the call.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    // Negative pid = the process group, which a child we spawned detached leads.
    // ⚠️ Without that spawn option this would signal *our own* group and kill the
    // launcher too — which is why only a leader's pid is ever passed here.
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      if (child !== undefined) child.kill('SIGKILL')
      else process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone is the outcome asked for.
    }
  }
}

/**
 * Run npm somewhere and pass its own words along.
 * @param {string} dir
 * @param {string[]} args
 * @param {(line: string) => void} say
 * @param {(pid: number) => void} [born] - told the child's pid as soon as it has one.
 * @returns {Promise<void>}
 */
function runNpm(dir, args, say, born = () => {}) {
  const [command, ...rest] = npmInvocation(args)
  return new Promise((resolve, reject) => {
    // Arguments go across as a vector, never as one string for a shell to
    // re-read — the package name came from a caller.
    //
    // ⛔ Its own process group off Windows, so the timeout below can end the
    // whole tree. npm is a parent too — the thing that actually hangs is a
    // dependency's install script two levels down, and signalling only the top
    // leaves it running against the same directory this tool has just declared
    // free.
    const child = spawn(command, rest, {
      cwd: dir,
      windowsHide: true,
      ...(process.platform === 'win32' ? {} : { detached: true }),
    })
    // ⛔⛔ **A download that never ends is worse than one that fails.** Measured:
    // eighteen minutes at "still downloading" with every package already on
    // disk, because a dependency's `postinstall` was fetching a binary from a
    // GitHub host this machine cannot reach — it would have waited all night.
    // Fifteen minutes, whole, chosen by the person who owns the tool; a real
    // install of 389 packages took five.
    let timedOut = false
    let scripts = 0
    const alarm = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, NPM_TIMEOUT_MS)
    // ⛔⛔ Who is *actually* writing the tree is this process, not us. Killing a
    // process does not kill its children on Windows, so this one outlives its
    // parent whenever the parent is killed rather than interrupted — measured
    // twice in one day, once on this tool's own acceptance script. A claim that
    // only knew the parent's pid would go stale while npm was still writing, and
    // the next install would be waved through into exactly the collision the
    // claim exists to prevent.
    if (typeof child.pid === 'number') born(child.pid)
    const tail = []
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const text = line.trim()
          if (text === '') continue
          tail.push(text)
          if (tail.length > 30) tail.shift()
          // ⛔ Lifecycle output gets through now. The old filter passed npm's own
          // errors and its closing summary and nothing else, so the eighteen
          // minutes an install script spent hanging were not merely unexplained
          // — they were unrepresented. `>` is npm's header naming the package
          // and script; the lines after it are that script talking, and are the
          // only place a stuck download says where it is stuck.
          // ⚠️ Capped, because "everything npm says" is unbounded and this goes
          // into a file somebody tails.
          const lifecycle = text.startsWith('>') || !/^npm /i.test(text)
          if (/^npm (error|warn)/i.test(text) || /^added |^changed |^removed /.test(text)) say(`  ${text}`)
          else if (lifecycle && scripts < SCRIPT_LINES) { scripts += 1; say(`  ${text}`) }
        }
      })
    }
    child.once('error', (error) => {
      clearTimeout(alarm)
      reject(new BoxError('NPM_FAILED', t('npm.cannotStart', { error: error.message }), { tail }))
    })
    child.once('close', (code) => {
      clearTimeout(alarm)
      if (timedOut) {
        // ⛔ Its own code, and deliberately not `NPM_FAILED`: a caller deciding
        // whether to retry elsewhere must be able to tell "this source lacks the
        // package" from "this took too long", and only the first is a statement
        // about the source.
        return void reject(new BoxError('NPM_TIMEOUT',
          t('npm.timedOut', { minutes: Math.round(NPM_TIMEOUT_MS / 60_000) }), { tail }))
      }
      if (code === 0) return void resolve()
      // npm's own last words, not just its exit code: the exit code alone is
      // the least useful half of what it printed.
      reject(new BoxError('NPM_FAILED', t('npm.installExit', { code, last: tail.at(-1) ?? t('npm.saidNothing') }), { tail }))
    })
  })
}

/**
 * Switch one row off, or back on.
 *
 * ⭐⭐ The one action that reaches something this tool did not install, and the
 * reason it exists: the format has no `remove`, so `disabled: true` in a later
 * layer is what "take that out" is spelled as — and the profile patch sits after
 * every bundle layer, which is what lets it reach a row a bundle brought in.
 * Upstream switches off its own telemetry exactly this way.
 *
 * Without it, an agent that finds a plugin conflict in the daily cabinet has
 * nothing to do about it but open a shell, which is the one place this tool
 * cannot show what happened.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} id
 * @param {boolean} off
 * @param {Record<string, unknown>} opts
 */
/**
 * The ways one cabinet's plugin rows get changed, behind one word.
 *
 * ⭐ `--undo` sits here rather than in a verb of its own because undoing is
 * setting those rows back to their previous value — the same object, the same
 * cabinet. Pressing it again goes one step further back; the depth is reached
 * by asking again rather than by reading a table of timestamps.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string | undefined} id
 * @param {string | undefined} state - `on` or `off`.
 * @param {Record<string, unknown>} opts
 */
function setPlugin(layout, id, state, opts) {
  if (opts.undo === true) return restoreCabinet(layout, opts)
  if (id === undefined) throw new BoxError('MISSING_ARGUMENT', t('plugins.disableWhich'))
  if (state !== 'on' && state !== 'off') {
    throw new BoxError('MISSING_ARGUMENT', t('settings.whichValue', { key: `plugin ${id}`, choices: 'on | off' }))
  }
  return switchPlugin(layout, id, state === 'off', opts)
}

function switchPlugin(layout, id, off, opts) {
  if (id === undefined) throw new BoxError('MISSING_ARGUMENT', t(off ? 'plugins.disableWhich' : 'plugins.enableWhich'))
  const target = cabinetTarget(layout, opts, true)
  // ⛔ Refused for an id nothing in this cabinet has. Writing an override
  // against a row that is not there is legal in the format and does nothing at
  // all — upstream warns and skips — so it would answer `ok:true` for a typo.
  const inventory = cabinetInventory(target.home)
  const known = [
    ...inventory.rows.map((row) => row.id),
    ...inventory.bundles.flatMap((bundle) => bundle.rows.map((row) => row.id)),
  ]
  if (!known.includes(id)) {
    throw new BoxError(
      'UNKNOWN_ROW',
      t('plugins.noSuchRow', { id, cabinet: target.label, flags: cabinetFlag(target) }),
      { row: id, cabinet: target.sandbox, main: target.main },
    )
  }
  const result = setDisabled({
    layout, home: target.home, id, off, backupDir: snapshotDir(layout, target),
  })
  if (!result.changed && result.theirs) {
    throw new BoxError(
      'NOT_OURS',
      t('plugins.enableNotOurs', { id, cabinet: target.label }),
      { row: id, cabinet: target.sandbox, main: target.main },
    )
  }
  recordResolved({ id, off, main: target.main, sandbox: target.sandbox })
  if (opts.json === true) {
    return void emit({
      action: off ? 'plugins.disable' : 'plugins.enable',
      cabinet: target.label,
      home: target.home,
      row: id,
      changed: result.changed,
      already: result.already,
      backup: result.backup,
    })
  }
  console.log(`\n  ${result.already
    ? t(off ? 'plugins.alreadyOff' : 'plugins.alreadyOn', { id, cabinet: target.label })
    : t(off ? 'plugins.switchedOff' : 'plugins.switchedOn', { id, cabinet: target.label })}`)
  if (result.changed && off) console.log(`  ${t('plugins.switchedOffWhere', { file: result.patchFile })}`)
  if (result.backup !== null) console.log(`  ${t('backup.saved', { file: result.backup })}`)
  console.log()
}

/**
 * Take one back out of a workspace.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} id
 * @param {Record<string, unknown>} opts
 */
function uninstallPlugin(layout, id, opts) {
  if (id === undefined) throw new BoxError('MISSING_ARGUMENT', t('plugins.uninstallWhich'))
  const target = cabinetTarget(layout, opts, true, 'from')
  const backups = snapshotDir(layout, target)
  const result = unmountPlugin({ layout, home: target.home, id, backupDir: backups })
  // ⭐ A bundle is the third place a cabinet can name a plugin, and taking one
  // out is a different edit to a different file — so it is tried here rather
  // than made a separate command. "Take this out of that cabinet" is one thing
  // to a person, and which of the three files it lives in is our problem.
  if (result.removed === null && bundleNames(profilePackageFile(target.home)).includes(id)) {
    return dropBundle(layout, target, id, backups, opts)
  }
  if (result.removed === null) {
    // Two different nothings, and telling them apart is the whole point of
    // keeping track of who put what there.
    throw new BoxError(
      result.theirs ? 'NOT_OURS' : 'UNKNOWN_PLUGIN',
      result.theirs
        ? t('plugins.notOurs', { id, cabinet: target.label })
        : t('plugins.notInstalled', {
          id, cabinet: target.label, flags: cabinetFlag(target, 'from'),
        }),
      { plugin: id, cabinet: target.label },
    )
  }
  // The staged copy goes with the row that owns it. Keyed by the package that
  // was asked for, so taking one member out of an aggregate finds nothing and
  // leaves the family's subtree alone — only removing the aggregate itself
  // takes the whole thing. A no-op for sandboxes, whose downloads are junctions.
  const unstaged = unstageFromCabinet(target.home, DEFAULT_PROFILE, result.removed.package)
  // ⭐ The last cabinet to let go takes the download with it. Nothing else in
  // this tool has to remember that a store exists, and nobody has to come back
  // later and tidy it — see {@link sweepUnusedDownloads}.
  const swept = sweepUnusedDownloads(layout, [
    result.removed.package, result.removed.via,
    ...result.alsoRemoved.flatMap((one) => [one.package, one.via]),
  ])
  recordResolved({
    id: result.removed.id, main: target.main, sandbox: target.sandbox, alsoRemoved: result.alsoRemoved.length, unstaged,
  })
  if (opts.json === true) {
    return void emit({
      action: 'rm.plugin',
      cabinet: target.label,
      home: target.home,
      plugin: result.removed,
      // What went off the disk as well, so a caller is never told less than
      // happened. Empty whenever the package was the user's own folder, or
      // another cabinet still points at it.
      deletedPackages: swept,
      // ⭐ Naming an aggregate takes its whole family, so what left has to be
      // said rather than counted — an answer of `ok:true` after sixteen rows
      // silently went is the shape of every bug this tool has had.
      alsoRemoved: result.alsoRemoved.map((one) => ({ id: one.id, package: one.package })),
      backup: result.backup,
    })
  }
  console.log(`\n  ${t('plugin.uninstalled', { name: result.removed.package, where: target.label })}`)
  if (result.alsoRemoved.length > 0) {
    console.log(`  ${t('aggregate.alsoRemoved', { count: result.alsoRemoved.length })}`)
    for (const one of result.alsoRemoved) console.log(`    ${padWide(one.id, 30)} ${one.package}`)
  }
  if (swept.length > 0) console.log(`  ${t('plugin.downloadSwept', { list: swept.join('、') })}`)
  if (result.backup !== null) console.log(`  ${t('backup.saved', { file: result.backup })}`)
  console.log()
}

/**
 * Take a bundle out of the profile's own package list, for real.
 *
 * ⛔⛔ Two places, because one is not durable: dsh's `reconcilePlugins` walks
 * `dependencies` after every `dsh plugin` command and pushes back anything still
 * declared there that still exports a patch. Removing only from
 * `dsh.profile.bundles` therefore removes nothing that lasts, and the person is
 * left believing otherwise.
 *
 * ⛔ The files stay on disk. Deleting them means running the package manager
 * inside somebody's profile, which is the dependency this tool exists without —
 * so what is left is said plainly instead of being cleaned up by surprise.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {{main: boolean, label: string, home: string, sandbox: string | null}} target
 * @param {string} name
 * @param {string | null} backups
 * @param {Record<string, unknown>} opts
 */
function dropBundle(layout, target, name, backups, opts) {
  const result = removeBundle({ layout, home: target.home, name, backupDir: backups })
  recordResolved({ bundle: name, main: target.main, sandbox: target.sandbox })
  if (opts.json === true) {
    return void emit({
      action: 'rm.plugin',
      cabinet: target.label,
      home: target.home,
      bundle: name,
      ...result,
    })
  }
  console.log(`\n  ${t('bundles.removed', { name, cabinet: target.label })}`)
  console.log(`  ${t(result.fromDependencies ? 'bundles.bothPlaces' : 'bundles.bundlesOnly', { file: result.file })}`)
  if (result.filesLeft !== null) console.log(`  ${t('bundles.filesLeft', { dir: result.filesLeft })}`)
  if (result.backup !== null) console.log(`  ${t('backup.saved', { file: result.backup })}`)
  console.log()
}



// ⛔ `pruneOldBackups` lived here until 2026-08-28 and was deleted with nothing
// put in its place: 刀 1 removed the `plugins backups` family, and rotation is
// automatic (`mounts.js` keeps the last `KEEP_BACKUPS` on every write). What was
// left behind was a function nothing called, still emitting an `action` naming a
// command that no longer exists — the kind of leftover that answers a search for
// "does this tool prune backups" with a yes.

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function restoreCabinet(layout, opts) {
  const target = cabinetTarget(layout, opts, true)
  const result = restoreBackup({
    home: target.home,
    backupDir: backupDir(layout, target.home),
    at: typeof opts.at === 'string' ? opts.at : undefined,
  })
  // ⛔ `undo` goes into the record because the line renders from the record, and
  //    without it `set plugin` renders as the other thing it can do.
  recordResolved({ undo: true, at: result.from, main: target.main, sandbox: target.sandbox })
  if (opts.json === true) {
    return void emit({ action: 'set.plugin', cabinet: target.label, ...result })
  }
  console.log(`\n  ${t('restore.done', { where: target.label, at: result.from })}`)
  for (const file of result.restored) console.log(`    ${file}`)
  // ⭐⭐ How much further back this can go, said every time. It is what replaces
  // the `plugins backups` listing: the depth is reached by pressing again, so
  // nobody has to read a table of timestamps to find out that they can.
  if (opts.at === undefined) {
    console.log(`  ${result.remaining === 0
      ? t('restore.noneLeft')
      : t('restore.stepsLeft', { count: result.remaining })}`)
  }
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
    const at = showInstant(entry.at)
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
 * other one. `--in` names a **machine workspace** — a `DSH_HOME`, holding
 * conversations and settings. This lists and changes the **project workspaces**
 * registered inside one: the folders dsh actually works in.
 *
 * ⛔ Command line only, no control in the window (CEO 2026-08-22): a person
 * picks a project inside dsh itself, where the picker already is, and building a
 * second one here would be a second thing to keep in step for no gain. It exists
 * because an agent cannot use that picker — and without it, an agent that starts
 * a sandbox is left at a screen it cannot get past.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} where - the project folder to put in front.
 * @param {Record<string, unknown>} opts
 */
function useWorkspace(layout, where, opts) {
  if (where === undefined) {
    throw new BoxError('MISSING_ARGUMENT', t('workspaces.useWhich'))
  }
  // This rewrites dsh's own workspace table inside the cabinet, so it goes
  // through the same door as every other write.
  const target = cabinetTarget(layout, opts, true)
  const result = addProject({
    home: target.home,
    path: where,
    title: typeof opts.title === 'string' ? opts.title : undefined,
  })
  recordResolved({ path: result.path, main: target.main, sandbox: target.sandbox, added: result.added })
  if (opts.json === true) return void emit({ action: 'set.workspace', cabinet: target.label, ...result })
  console.log(`\n  ${t('workspaces.next', { cabinet: target.label, path: result.path })}`)
  console.log(`    ${t(result.added ? 'workspaces.addedNew' : result.moved ? 'workspaces.movedFront' : 'workspaces.alreadyFront')}`)
  console.log(`  ${t('workspaces.writtenTo', { file: result.file })}\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function showWorkspaces(layout, opts) {
  const target = cabinetTarget(layout, opts)
  const listed = listProjects(target.home)
  if (opts.json === true) return void emit({ cabinet: target.label, home: target.home, ...listed })
  console.log(`\n  ${t('workspaces.header', { cabinet: target.label })}`)
  if (!listed.exists) console.log(`    ${t('workspaces.neverStarted')}`)
  if (listed.exists && listed.projects.length === 0) console.log(`    ${t('workspaces.emptyList')}`)
  for (const one of listed.projects) {
    console.log(`    ${one.current ? '→' : ' '} ${padWide(one.title, 22)} ${t('sessions.count', { count: one.sessions })}  ${one.path}`)
  }
  console.log(`\n  ${t('workspaces.switchHint', { where: cabinetFlag(target) })}`)
  console.log(`  ${t('workspaces.atFile', { file: listed.file })}\n`)
}

/**
 * Stopping a download that is running.
 *
 * ⛔⛔ **All that is left of a family of four**, and the three that went are the
 * clearest case in this whole slim of an *object* being deleted rather than a
 * verb being merged. Listing the store, deleting from it, pruning it — every one
 * of those existed because we keep a store, and every one of them made the
 * caller learn that we keep a store. Nothing needed it except our own
 * housekeeping, and the housekeeping now happens by itself the moment the last
 * cabinet lets go (`sweepUnusedDownloads`).
 *
 * ⭐ Cancel survived because it is not about the store at all: it is about
 * **work happening right now**. The rule it answers to is older than this slim —
 * a thing this tool can start is a thing it must be able to stop, or the agent
 * it was built for goes outside and does it with `taskkill`, where the human
 * view cannot see it. That is also why it is now spelled `stop --download`: it
 * is asked for by what it stops, not by which of our layers holds it.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function cancelDownload(layout, opts) {
  // ⛔⛔ **The way out of a download that will not end.** Until this existed the
  // only way to stop one was `taskkill` in a shell — and this tool's own rule is
  // that a thing it can start is a thing it must be able to stop and to look at,
  // or the agent it is built for falls out of its boundary and does it with `rm`
  // where no human view can see it. Measured tonight: an install hung eighteen
  // minutes on a dependency's script and had to be killed from bash.
  //
  // ⭐ Both recorded pids, and the tree under each. The one that hangs is not
  // the one holding the claim — it is npm's own grandchild — so signalling the
  // holder alone would report success and leave the tree being written.
  const going = downloadInFlight(layout)
  if (going === null) {
    if (opts.json === true) return void emit({ action: 'stop', cancelled: null })
    return void console.log(`\n  ${t('packages.nothingDownloading')}\n`)
  }
  for (const pid of going.pids) killPidTree(pid)
  // ⛔ Cleared here rather than left for the pid check to age out: the claim is
  // also what the window reads to draw a download in flight, and a person who
  // just cancelled should not watch a ghost keep beating.
  rmSync(installClaimFile(layout), { force: true })
  appendLog(packageLog(layout.root, going.name), t('packages.cancelled', { name: going.name }))
  recordResolved({ download: true, name: going.name })
  if (opts.json === true) return void emit({ action: 'stop', cancelled: going.name, pids: going.pids })
  console.log(`\n  ${t('packages.cancelled', { name: going.name })}\n`)
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
    for (const entry of cabinetPlugins(layout, workspace.home).ours) {
      if (!isOurDownload(layout, entry.path ?? '')) continue
      users.set(entry.package, [...(users.get(entry.package) ?? []), workspace.label])
    }
  }
  return users
}

/**
 * Delete downloads that nothing points at any more.
 *
 * ⭐⭐ **This is what makes `packages prune` unnecessary rather than missing.**
 * Leaving a download behind after the last cabinet let go of it was a deliberate
 * choice once — putting the plugin back would be instant — but the price was a
 * store that only ever grew, and a person who wanted it back could only find out
 * by learning that we keep one. **An internal storage layer the caller has to
 * know about is the same information leak as an extra command.**
 *
 * ⛔ The count is taken **after** the row is gone, never before: asked a moment
 * too early it answers "one cabinet still uses this" about the very cabinet that
 * just let go, and nothing is ever swept.
 *
 * ⛔ Only top-level entries in our own store are eligible, which is what
 * {@link listPackages} answers. An aggregate's members live nested inside their
 * family root, so they are not in that list and cannot be swept out from under
 * the family — the family root itself is, and takes them with it.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {(string | null | undefined)[]} candidates - package names that just
 * lost a reference, `via` roots included.
 * @returns {string[]} names actually deleted.
 */
function sweepUnusedDownloads(layout, candidates) {
  const wanted = new Set(candidates.filter((name) => typeof name === 'string' && name !== ''))
  if (wanted.size === 0) return []
  const users = packageUsers(layout)
  const stored = new Set(listPackages(layout).map((one) => one.name))
  const swept = []
  for (const name of wanted) {
    if (!stored.has(name) || (users.get(name) ?? []).length > 0) continue
    removePackage(layout, name)
    // The farms hold hardlinks into the bytes just deleted; without the store
    // copy they are orphans no launch can refresh.
    dropFromFarms(layout, name)
    swept.push(name)
  }
  return swept
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} [opts]
 */
function showSandboxes(layout, opts = {}) {
  const all = listSandboxes(layout)
  // The list with its paths, one row each; plugins still by count — the
  // names of one cabinet are `ls plugin --in <柜>`.
  if (opts.json === true) return void emit({ sandboxes: all.map((box) => sandboxRow(box, { paths: true })) })
  console.log(`\n  ${t('sandboxes.header')}`)
  if (all.length === 0) console.log(`    ${t('sandboxes.none')}`)
  for (const box of all) {
    const bits = [
      box.lastVersion ?? t('sandbox.neverStarted'),
      t('sessions.count', { count: box.sessions }),
      t(CREDENTIALS_LABEL[box.credentials]),
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
async function adopt(layout, opts) {
  // ⭐ One spelling, both directions. It used to have a shorthand
  // (`adopt <sandbox>` meaning "into my daily workspace") and a long form, and
  // the shorthand could only say one of the two directions — so the direction
  // was half a feature and half a flag. Now it is two values, and the daily
  // cabinet is a name like any other.
  if (opts.from === undefined && opts.to === undefined) {
    throw new BoxError('MISSING_ARGUMENT', t('adopt.which'))
  }
  // `null` is how the core names the daily cabinet, which is the one thing this
  // layer still has to translate.
  const side = (value) => (value === undefined || value === DAILY_CABINET ? null : String(value))
  const result = await adoptSessions(layout, {
    from: side(opts.from),
    to: side(opts.to),
    force: opts.force === true,
  })
  recordResolved({
    fromSandbox: result.fromSandbox,
    toSandbox: result.toSandbox,
    adopted: result.adopted,
    skipped: result.skipped,
    force: opts.force === true,
  })
  if (opts.json === true) return void emit({ action: 'get.chat', ...result })
  console.log(`\n  ${t('adopt.copied', { from: result.from, to: result.to, adopted: result.adopted, skipped: result.skipped })}`)
  console.log(`  ${t('adopt.originalsStay', { from: result.from })}`)
  console.log(`  ${t('adopt.visibleNextStart', { to: result.to })}`)
  // ⛔ Only when there is something to say about, and never as a verdict: this
  // is the one property of the copy that cannot be checked from here, so it is
  // reported when the two sides are known to differ or when one is unknown, and
  // stays quiet when they are known to agree.
  if (result.sameVersion === false) {
    console.log(`  ${t('adopt.versionDiffers', {
      from: result.from, fromVersion: result.fromVersion, to: result.to, toVersion: result.toVersion,
    })}`)
  } else if (result.sameVersion === null) {
    console.log(`  ${t('adopt.versionUnknown')}`)
  }
  console.log()
}

/**
 * One line saying whether a named tree's packages agree on a release number.
 *
 * Three outcomes, not two. "Could not check" is its own sentence: announcing
 * that versions are mixed when nothing was examined is the self-consistent
 * wrong answer this project keeps paying for, and a source workspace reaches
 * that state honestly.
 * @param {import('../src/engine-path.js').PinInfo} pin
 * @returns {string}
 */
function pinReport(pin) {
  if (!pin.verified) return t('engine.pinUnchecked')
  if (pin.pinned) return t('engine.pinOk', { packages: pin.packages })
  return t('engine.pinMixed', {
    packages: pin.packages,
    list: pin.mixed.map((one) => `${one.name}@${one.found ?? '?'}`).join('、'),
  })
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
 * this function's — a sandbox, or {@link DAILY_CABINET} for the real `~/.dsh`.
 * Inheriting either used to save a little typing and cost the property that
 * matters more: a written command that produces the same result whenever it is
 * run. The same line is what the badge renders and what a person copies out of a
 * log, so a command whose meaning depends on history is one neither can trust.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string | undefined} name - which cabinet, by name.
 * @param {Record<string, unknown>} opts
 */
async function start(layout, name, opts) {
  // ⭐⭐ The clock starts here, at the moment the command was received, and stops
  // when dsh is answering. Nobody outside can measure that span: a caller timing
  // the child process also times node starting up and this file being read, and
  // one that times its own turn also times itself. So the only place the real
  // boundary is known is inside, and it costs one field to say it.
  const began = Date.now()
  const config = readConfig(layout)
  const last = config.last

  const main = name === DAILY_CABINET
  const brandNew = opts.new === true
  // ⭐ A brand-new sandbox has no name yet, so naming one alongside `--new` is
  // two answers to one question rather than a shorthand for either.
  if (brandNew && typeof name === 'string') {
    throw new BoxError('BAD_FLAG', t('start.bothFlags'))
  }
  if (!brandNew && (name === undefined || name === '')) {
    throw new BoxError('MISSING_ARGUMENT', t('start.whichCabinet'))
  }
  const engine = resolveEngine(layout, { version: opts.version })
  const version = engine.version

  // Plugins are deliberately not inherited. Carrying the last selection
  // forward once had someone believing they were looking at plain official
  // dsh while a plugin from the previous run was loaded — silently, because
  // nothing in the command said so. Saying nothing now means nothing extra.
  const wanted = new Set(asList(opts.plugin))
  const { live, missing } = partitionRoster(derivedRoster(layout))
  const gone = missing.filter((p) => wanted.has(p.id)).map((p) => p.id)
  const chosen = live.filter((p) => wanted.has(p.id))
  let unknown = [...wanted].filter((id) => !live.some((p) => p.id === id) && !gone.includes(id))
  // ⭐⭐ A folder is a name too, and after the registry went it is the **only**
  // way to name a plugin that is not installed anywhere yet. Before, you said
  // `plugins add <目录>` first and used the id it gave you; there is no such step
  // now, so `--plugin` learns the same three-way reading `plugins install`
  // already had — an id, or a folder that is one.
  // ⛔ Tried only for names that failed as ids, and never the other way round: a
  // folder named the same as an installed plugin must not quietly outrank it.
  const fromFolders = unknown
    .filter((name) => existsSync(join(name, 'package.json')))
    .map((dir) => describePlugin(dir))
  chosen.push(...fromFolders)
  unknown = unknown.filter((name) => !existsSync(join(name, 'package.json')))
  if (unknown.length > 0) {
    throw new BoxError('UNKNOWN_PLUGIN', t('start.unknownPlugins', { list: unknown.join('、') }), { unknown })
  }

  const quiet = opts.json === true
  const say = quiet ? () => {} : (line) => console.log(line)
  for (const id of gone) say(`  ${t('start.pluginGone', { id })}`)

  const importSignIn = opts['no-sign-in'] !== true
  let boxName = t('cabinet.daily')
  // What the cabinet about to be opened actually holds, which is what decides
  // whether this launch can spend money.
  // ⛔ Not the same as `importSignIn`: `--no-sign-in` on a sandbox that was
  // signed in yesterday still opens a cabinet with a key in it.
  // ⛔ And not "is there a credentials file": dsh writes that file itself to
  // keep the browser session it signed, so a cabinet that never had a key ends
  // up with one after its first launch. Four answers, not two — `session-only`
  // is exactly that case, and it used to be reported as signed in.
  /** @type {'keys' | 'session-only' | 'none' | 'unreadable'} */
  let credState = 'keys'
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
    // ⛔ Every machine except the user's own. The rule was written when there
    // were two kinds and said "release", which read as a list but was always a
    // statement about the remaining square: opening the real home on the dsh
    // this computer already has is what typing `dsh` does, and opening it on
    // any *other* dsh carries both dangers that outlive the launch. A folder
    // somebody named is another dsh. Saying `!== 'host'` rather than naming the
    // kinds is what stops the next kind from being let through by default.
    if (engine.kind !== 'host' && !approvedByWindow(layout)) {
      throw new BoxError('NEEDS_APPROVAL', t('start.mainNeedsApproval'), { main: true, version, machine: engine.kind })
    }
    if (await mainDshRunning()) {
      throw new BoxError('MAIN_DSH_RUNNING', t('start.mainAlreadyRunning'))
    }
    // ⭐ Asked, not assumed. This used to be hardcoded to "the real home always
    // has one", which is true of every real home anybody has met and still is
    // not something this tool knows — and the cost of being wrong is the one
    // sentence a person acts on before spending money.
    credState = credentialsState(userDshHome())
    say(`\n  ${t('start.notSandbox')}`)
    if (engine.kind !== 'host') {
      say(`  ${t('start.releaseOnMain')}`)
      say(`    ${t('start.releaseOnMainDetails')}`)
    }
  } else {
    // ⛔ A brand-new sandbox is taken in one step, never suggested and then
    // created: two of these fired at once used to agree on the same name.
    const { info, created, signInImported } = brandNew
      ? createNewSandbox(layout, { importSignIn })
      : ensureSandbox(layout, String(name ?? ''), { importSignIn })
    boxName = info.name
    credState = info.credentials
    say(`\n  ${t(created ? 'sandbox.created' : 'sandbox.reused', { name: info.name })}${signInImported ? t('start.signInSuffix') : ''}`)
    if (!created) say(`  ${t('sandbox.ownConversations')}`)
  }
  // ⭐ Sign-in changed on the way in, the same shape as `--plugin` / `--unplug`:
  // saying neither changes nothing, because what a cabinet holds is a fact
  // about the cabinet rather than a setting of this launch.
  const cabinetHome = main ? userDshHome() : sandboxPaths(layout, boxName).home
  if (opts['sign-out'] === true) {
    if (main && !approvedByWindow(layout)) {
      throw new BoxError('NEEDS_APPROVAL', t('signOut.mainNeedsApproval'), { main: true })
    }
    if (removeCredentials(cabinetHome)) {
      credState = 'none'
      say(`  ${t('signOut.done', { name: boxName })}`)
    }
  } else if (opts['sign-in'] === true && credState !== 'keys') {
    if (main) throw new BoxError('MAIN_IS_THE_SOURCE', t('signIn.mainIsSource'))
    // ⭐ Reachable now in a way it was not before. While "has credentials" meant
    // "the file is there", a cabinet that had ever served a page was treated as
    // signed in, so this branch never ran on one and never met an existing
    // document. It does now — and the import writes the whole file, so what was
    // in it goes. That is survivable (dsh mints a new browser secret next
    // launch, at the price of logging out the tabs holding the old one) but it
    // is not something to do without saying so.
    const replaced = credState !== 'none'
    const carried = importCredentials(cabinetHome)
    if (carried !== null) {
      credState = 'keys'
      say(`  ${t('signIn.done', { name: boxName })}`)
      if (replaced) say(`  ${t('signIn.replacedSession')}`)
      if (carried.droppedGrants > 0) say(`  ${t('signIn.grantNotCarried', { count: carried.droppedGrants })}`)
    }
  }
  say(`  ${t('start.usingEngine', { engine: engineLabel(engine) })}`)
  // ⭐ Said out loud, never acted on. On a release we downloaded, a tree whose
  // packages disagree is a bug in our own download path and the download is
  // failed outright. A tree somebody named is not ours to fail: a source
  // workspace legitimately keeps its packages somewhere this check cannot count
  // them, and refusing on that would refuse the exact case folders exist for.
  // So the count is reported and the launch continues — what is owed here is
  // the number, not a verdict.
  if (engine.pin !== undefined) say(`  ${pinReport(engine.pin)}`)

  // ⭐ Plugins are registered in the workspace, not carried by the launch. So
  // this is not "install these" but "add these, remove those" — and saying
  // nothing means changing nothing, rather than starting with none. A workspace
  // that has a plugin keeps it, exactly as it would if `dsh` were typed by hand.
  //
  // Done before the launch, deliberately: everything here can refuse (a folder
  // that moved, a config we cannot read), and refusing before a dsh exists is
  // the difference between "nothing happened" and "something is half done".
  const home = main ? userDshHome() : sandboxPaths(layout, boxName).home
  // ⛔ Starting the daily cabinet is not a change to it — it is what typing
  // `dsh` does, and gating that would be absurd. **Carrying a `--plugin` or an
  // `--unplug` is a change**, and it lands in the file the person's own `dsh`
  // reads afterwards, so it goes through the same door as every other write.
  if (main && (chosen.length > 0 || asList(opts.unplug).length > 0)
    && !approvedByWindow(layout)) {
    throw new BoxError('NEEDS_APPROVAL', t('cabinet.dailyNeedsApproval'), { main: true })
  }
  const backups = snapshotDir(layout, { main, home })
  for (const id of asList(opts.unplug)) {
    const dropped = unmountPlugin({ layout, home, id, backupDir: backups })
    if (dropped.removed !== null) say(`  ${t('start.unplugged', { package: dropped.removed.package })}`)
    else if (dropped.theirs) say(`  ${t('start.unplugTheirs', { id })}`)
    else say(`  ${t('start.unplugMissing', { id })}`)
  }
  if (chosen.length > 0) {
    linkPlugins(home, DEFAULT_PROFILE, chosen)
    for (const plugin of chosen) {
      const added = mountPlugin({
        layout,
        home,
        plugin: { id: plugin.id, package: plugin.package, kind: 'link', path: plugin.path },
        backupDir: backups,
      })
      say(`  ${t(added.added ? 'start.pluginAdded' : 'start.pluginAlready', { package: plugin.package })}`)
    }
  }
  const mounted = cabinetPlugins(layout, home)
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
    // Only what was actually asked for is written down, because this record is
    // what the rendered line has to reproduce. `--version` names one of our
    // downloads or a folder; using the machine the user already has is what
    // happens when nothing names anything, so that renders as an absence rather
    // than as a value.
    version: engine.kind === 'host' ? undefined : engine.kind === 'release' ? version : engine.dir,
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
      // ⛔⛔ `pluginsChanged`, not `plugins`. Under the old name this field said
      // "what `--plugin` asked for this time" while reading as "what this
      // cabinet holds" — so the same sandbox answered `[{"id":"dsh-lab"}]` on
      // the run that carried the flag and `[]` on the next one, with the plugin
      // installed the whole time. That is the exact inverse of the rule this
      // command's own help states: saying no `--plugin` is **not** "load none",
      // it is "change nothing". The prose had it right and the machine answer
      // printed "unchanged" as "empty", which is the copy an agent acts on.
      pluginsChanged: chosen.map((p) => ({ id: p.id, package: p.package })),
      // ⭐ And the question the old field looked like it was answering, answered
      // for real. The listing was already being read a few lines above — the
      // `--json` face simply threw it away, because `say` is a no-op here.
      cabinetPlugins: mounted,
      missingPlugins: gone,
      logFile,
      detached: !follow,
      // ⭐ How long the wait actually was, so the caller does not have to guess
      // a timeout from a sentence in the help.
      elapsedMs: Date.now() - began,
      // ⭐⭐ And what that duration is a duration *of*. Two judges can end the
      // wait: `announced` means dsh said so itself, from a callback that runs
      // only once its whole plugin tree has settled; `probed` means it never
      // said so — its `printUrl` is off — and we asked its page instead. They
      // do not fire at the same instant, so a caller comparing `elapsedMs`
      // across runs is comparing two different measurements unless it can see
      // which one it got.
      readyBy: result.readyBy,
    })
  } else {
    console.log(`\n  ${t('launch.open', { url: result.url })}`)
    console.log(`  ${t(CREDENTIALS_SENTENCE[credState])}`)
    console.log(`  ${t('launch.logAt', { file: logFile })}`)
    if (follow) console.log(`  ${t('launch.followStop', { pid: result.pid })}\n`)
    else console.log(`  ${t('launch.detached', { pid: result.pid, name: boxName })}\n`)
  }

  if (!follow) return
  const shutdown = async () => {
    console.log(`\n  ${t('launch.stopping')}`)
    await stop(result.pid, result.pidBorn)
    if (!main) clearRunning(layout, boxName, result.pid)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  await tail(logFile)
}

/**
 * Stop something. Which something is the argument.
 *
 * ⭐⭐ Four things that used to be four verbs, and what separates them is not a
 * name but **what gets stopped**: one sandbox, every sandbox, the config window,
 * the download that is running. A caller who knows what they want stopped can
 * now say it without first learning which of our layers holds it.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string | undefined} name
 * @param {Record<string, unknown>} opts
 */
async function halt(layout, name, opts) {
  if (opts.window === true) return stopUi(layout, opts)
  if (opts.download === true) return cancelDownload(layout, opts)
  if (opts.all === true) return quit(layout, opts)
  // ⛔ The daily cabinet's launch has no sandbox name, so it answers to
  // {@link DAILY_CABINET} — which is safe to reserve because a sandbox is no
  // longer allowed to be called that (src/paths.js).
  if (name === DAILY_CABINET) {
    const held = mainRunningRecord(layout)
    if (held === null) {
      throw new BoxError('NOT_RUNNING', t('stop.mainNotRunning'), {
        note: t('stop.mainNote'),
      })
    }
    // ⛔⛔ Added 2026-08-28, and the gap it closes was precise: the decision was
    // always "anything that **acts on** the daily cabinet is gated", and what
    // got built was "anything that **writes to** it". Five writes were stopped
    // and stopping the user's own dsh was not — the shortest command in the
    // tool could take down the machine somebody is working in, and another
    // agent's dsh with it. Stopping is not reversible in the way that matters:
    // whatever was in that session is gone.
    if (!approvedByWindow(layout)) {
      throw new BoxError('NEEDS_APPROVAL', t('stop.mainNeedsApproval'), { main: true })
    }
    const killed = await stop(held.pid, held.pidBorn)
    clearMainRunning(layout, held.pid)
    recordResolved({ main: true, pid: held.pid, killed })
    if (opts.json === true) return void emit({ action: 'stop', main: true, pid: held.pid, killed })
    return void console.log(`\n  ${t(killed ? 'stop.mainStopped' : 'stop.staleRow', { pid: held.pid })}\n`)
  }
  if (name === undefined) throw new BoxError('MISSING_ARGUMENT', t('stop.which'))
  const record = runningRecord(layout, name)
  if (record === null) {
    throw new BoxError('NOT_RUNNING', t('stop.notRunning', { name }), { sandbox: name })
  }
  // ⭐ `killed === false` is not a failure: the row named a pid that now
  // belongs to somebody else, so it was left alone and the row thrown away.
  // Saying so plainly matters more than the tidier sentence — a person who is
  // told "stopped" when nothing was stopped will go looking for the sandbox.
  const killed = await stop(record.pid, record.pidBorn)
  clearRunning(layout, name, record.pid)
  if (opts.json === true) return void emit({ action: 'stop', sandbox: name, pid: record.pid, killed })
  console.log(`\n  ${t(killed ? 'stop.stopped' : 'stop.staleRow', { name, pid: record.pid })}\n`)
}

/**
 * Copy the user's sign-in into a sandbox that has none.
 *
 * ⛔ Only into a sandbox. The daily cabinet is where a sign-in comes *from*, so
 * "import it into itself" is not a smaller version of this — it is a sentence
 * that does not mean anything, and answering it with a shrug would leave
 * somebody believing they had done something.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function signIn(layout, opts) {
  const target = String(opts.to ?? '')
  if (target === DAILY_CABINET) throw new BoxError('MAIN_IS_THE_SOURCE', t('signIn.mainIsSource'))
  if (target === '') throw new BoxError('MISSING_ARGUMENT', t('signIn.which'))
  const home = sandboxPaths(layout, target).home
  if (!existsSync(home)) throw new BoxError('NO_SUCH_SANDBOX', t('sandbox.noSuch', { name: target }), { sandbox: target })
  const before = credentialsState(home)
  if (before === 'keys') {
    if (opts.json === true) return void emit({ action: 'get.signin', sandbox: target, imported: false, credentials: before })
    return void console.log(`\n  ${t('signIn.already', { name: target })}\n`)
  }
  // ⛔ The import writes the whole document, so anything already in it goes.
  // Reachable only since "has a sign-in" stopped meaning "the file exists" —
  // before that, a cabinet dsh had written a browser session into looked signed
  // in and this line was never reached with a document present.
  const replaced = before !== 'none'
  const carried = importCredentials(home)
  if (carried === null) {
    throw new BoxError('NO_SIGN_IN_TO_COPY', t('signIn.nothingToCopy'), { sandbox: target })
  }
  recordResolved({ sandbox: target })
  if (opts.json === true) {
    return void emit({
      action: 'get.signin',
      sandbox: target,
      imported: true,
      replacedSession: replaced,
      // ⭐ What was carried and what was deliberately left behind, because
      // "copied the sign-in" is now a smaller claim than it used to be and a
      // caller comparing the two files would otherwise find them different
      // with nothing to say why.
      carried: { refs: carried.refs, apiKeys: carried.apiKeys },
      droppedGrants: carried.droppedGrants,
    })
  }
  console.log(`\n  ${t('signIn.done', { name: target })}`)
  if (replaced) console.log(`  ${t('signIn.replacedSession')}`)
  if (carried.droppedGrants > 0) console.log(`  ${t('signIn.grantNotCarried', { count: carried.droppedGrants })}`)
  console.log()
}

/**
 * Take the sign-in out of a cabinet.
 *
 * ⛔ The daily cabinet's copy is the user's own and there is no backup, so this
 * is the second thing behind the hard gate: it only runs when the config window
 * started this process. See {@link approvedByWindow}.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function signOut(layout, opts) {
  const named = String(opts.from ?? '')
  if (named === '') throw new BoxError('MISSING_ARGUMENT', t('signOut.which'))
  const main = named === DAILY_CABINET
  const target = main ? null : named
  const home = main ? userDshHome() : sandboxPaths(layout, target).home
  if (!existsSync(home)) {
    throw new BoxError('NO_SUCH_SANDBOX', t('sandbox.noSuch', { name: target }), { sandbox: target })
  }
  if (main && !approvedByWindow(layout)) {
    throw new BoxError('NEEDS_APPROVAL', t('signOut.mainNeedsApproval'), { main: true })
  }
  const label = main ? t('cabinet.daily') : target
  if (!removeCredentials(home)) {
    if (opts.json === true) return void emit({ action: 'rm.signin', cabinet: label, removed: false })
    return void console.log(`\n  ${t('signOut.none', { name: label })}\n`)
  }
  recordResolved({ sandbox: target, main })
  if (opts.json === true) return void emit({ action: 'rm.signin', cabinet: label, removed: true })
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
  if (opts.json === true) return void emit({ action: 'rm.sandbox', sandbox: gone.name })
  console.log(`\n  ${t('rm.removed', { name: gone.name })}\n`)
}

/**
 * Whether typing this program's name finds this copy.
 *
 * Costs a subprocess, so it is only asked when there is an exe behind this run
 * — the npm install has no folder of its own to register, and npm has already
 * put a shim where one belongs.
 * @returns {{dir: string | null, present: boolean | null, copies: string[]}}
 */
function reachableByName() {
  const dir = exeDir()
  if (dir === null || process.platform !== 'win32') return { dir, present: null, copies: [] }
  try {
    const entries = entriesOf(readUserPath().value)
    return {
      dir,
      present: entries.some((entry) => sameEntry(entry, dir)),
      copies: copiesOn(entries).map((copy) => copy.dir),
    }
  } catch {
    // `null` rather than `false`: not knowing and knowing it is not there are
    // different answers, and a caller acting on the wrong one would add an
    // entry that is already present.
    return { dir, present: null, copies: [] }
  }
}

/**
 * Whether a person can reach this program by typing its name, and the command
 * that changes the answer.
 *
 * ⭐ This exists because being on PATH and being usable from a terminal are two
 * different things, and only the second one is about the program itself. The
 * exe learned to take arguments so that a full path works everywhere; this is
 * the smaller, purely clerical half — so that the name works too. The npm
 * package needs none of it: npm puts its own shim on PATH, which is why this
 * refuses politely when there is no exe behind it rather than inventing a
 * folder to register.
 *
 * ⛔ It is a real user command, not installer plumbing: the installer does call
 * it, but the portable build has no installer and its user types it themselves.
 * A command "nobody uses" that a line of documentation tells people to type is
 * a caller no code search will ever find.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string | undefined} state - `on` or `off`.
 * @param {Record<string, unknown>} opts
 */
function setPath(layout, state, opts) {
  if (state !== 'on' && state !== 'off') {
    throw new BoxError('MISSING_ARGUMENT', t('settings.whichValue', { key: 'path', choices: 'on | off' }))
  }
  if (process.platform !== 'win32') throw new BoxError('PATH_UNSUPPORTED', t('path.windowsOnly'))
  const dir = exeDir()
  if (dir === null) throw new BoxError('PATH_NO_EXE', t('path.noExe'))
  return state === 'on' ? addToPath(layout, dir, opts) : removeFromPath(layout, dir, opts)
}

/**
 * What is true about PATH right now, as data.
 *
 * ⭐ Separated from the printing because it is one row of `ls setting` now, not
 * a command of its own: PATH is a setting (`set path on|off`), so reading it
 * belongs where every other setting is read. Two commands to answer "what is
 * this machine like" meant nobody ever had the whole answer at once.
 * @returns {{supported: boolean, dir: string | null, present: boolean, entries: number,
 *   copies: {dir: string}[], dead: string[]}}
 */
function pathFacts() {
  const dir = exeDir()
  if (process.platform !== 'win32') {
    return { supported: false, dir, present: false, entries: 0, copies: [], dead: [] }
  }
  const entries = entriesOf(readUserPath().value)
  const copies = copiesOn(entries)
  return {
    supported: true,
    dir,
    present: dir !== null && entries.some((entry) => sameEntry(entry, dir)),
    entries: entries.length,
    copies,
    dead: entries.filter((entry) => !existsSync(entry.trim())),
  }
}

/**
 * Put this program's folder on the user's PATH.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} dir
 * @param {Record<string, unknown>} opts
 */
function addToPath(layout, dir, opts) {
  const { value, kind } = readUserPath()
  const entries = entriesOf(value)
  if (entries.some((entry) => sameEntry(entry, dir))) {
    // Saying "nothing to do" rather than adding a second copy: a command run
    // twice should leave one entry, and a PATH is the last place to learn that
    // lesson the other way.
    recordResolved({ state: 'on', dir, changed: false })
    if (opts.json === true) return void emit({ action: 'set.path', dir, changed: false })
    return void console.log(`\n  ${t('path.already', { dir })}\n`)
  }
  // ⛔ Refused rather than silently decided: with two copies registered, which
  // one the name reaches depends on their order, and quietly picking a winner
  // for somebody is how a person ends up debugging the wrong installation.
  const others = copiesOn(entries).filter((copy) => !sameEntry(copy.dir, dir))
  if (others.length > 0 && opts.force !== true) {
    throw new BoxError('PATH_ANOTHER_COPY', t('path.anotherCopy', { dir: others[0].dir }), { copies: others })
  }
  const kept = keepPathBackup(layout, value)
  // Last, so nothing that was already reachable stops being reachable — except
  // with `--force`, which is a person saying they want this copy to win.
  const next = opts.force === true ? [dir, ...entries].join(';') : [...entries, dir].join(';')
  writeUserPath(next, kind)
  const announced = announceEnvChange()
  recordResolved({ state: 'on', dir, changed: true, backup: kept })
  if (opts.json === true) {
    return void emit({ action: 'set.path', dir, changed: true, backup: kept, first: opts.force === true, announced })
  }
  console.log(`\n  ${t('path.added', { dir })}`)
  console.log(`  ${t('path.reopen')}\n`)
}

/**
 * Take this program's folder back off the user's PATH.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} dir
 * @param {Record<string, unknown>} opts
 */
function removeFromPath(layout, dir, opts) {
  const { value, kind } = readUserPath()
  const entries = entriesOf(value)
  const left = entries.filter((entry) => !sameEntry(entry, dir))
  if (left.length === entries.length) {
    recordResolved({ state: 'off', dir, changed: false })
    if (opts.json === true) return void emit({ action: 'set.path', dir, changed: false })
    return void console.log(`\n  ${t('path.notThere', { dir })}\n`)
  }
  const kept = keepPathBackup(layout, value)
  writeUserPath(left.join(';'), kind)
  const announced = announceEnvChange()
  recordResolved({ state: 'off', dir, changed: true, backup: kept })
  if (opts.json === true) {
    return void emit({ action: 'set.path', dir, changed: true, backup: kept, announced })
  }
  console.log(`\n  ${t('path.removed', { dir })}`)
  console.log(`  ${t('path.reopen')}\n`)
}

/**
 * Keep a copy of the PATH as it is right now.
 *
 * Written before every change, never overwritten, named by the moment. The
 * journal already records that a change happened, but a journal entry is not
 * something a person can paste back into the environment editor at two in the
 * morning — this file is.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} value
 * @returns {string} the file written.
 */
function keepPathBackup(layout, value) {
  mkdirSync(layout.envPath, { recursive: true })
  const file = join(layout.envPath, `before-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.txt`)
  writeFileSync(file, value, 'utf8')
  return file
}

/**
 * Everything this data directory is set to, and whether this copy is on PATH.
 *
 * These used to be reachable only by clicking in the config window, which made
 * the window able to do something the command line could not — the exact shape
 * of drift this tool is built to rule out.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
function showSettings(layout, opts) {
  const config = readConfig(layout)
  const current = Object.fromEntries(
    Object.entries(SETTINGS).map(([name, setting]) => [name, setting.read(config)]),
  )
  const path = pathFacts()
  if (opts.json === true) return void emit({ settings: current, path })
  console.log(`\n  ${t('settings.header')}`)
  for (const [name, setting] of Object.entries(SETTINGS)) {
    console.log(`    ${name.padEnd(14)} ${String(setting.read(config)).padEnd(10)} ${setting.summary}`)
    console.log(`    ${' '.repeat(14)} ${t('settings.choicesLine', { choices: setting.choices.join(' | ') })}`)
  }
  // ⭐ Below the stored settings rather than mixed in with them, because it is
  // the one line here that is about this computer instead of this data
  // directory — and saying so by where it sits costs no words.
  if (!path.supported) {
    console.log(`\n  ${t('path.windowsOnly')}`)
    return void console.log()
  }
  console.log(`\n  ${path.dir === null
    ? t('path.noExeShort')
    : t(path.present ? 'path.hereOn' : 'path.hereOff', { dir: path.dir })}`)
  console.log(`  ${t('path.copies', { count: path.copies.length })}`)
  for (const copy of path.copies) console.log(`    ${copy.dir}`)
  if (path.dead.length > 0) console.log(`  ${t('path.dead', { count: path.dead.length })}`)
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string | undefined} key
 * @param {string | undefined} value
 * @param {Record<string, unknown>} opts
 */
function changeSetting(layout, key, value, opts) {
  const config = readConfig(layout)
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
  recordResolved({ archived })
  if (opts.json === true) return void emit({ action: 'rm.setting', file: layout.config, archived })
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
 * ⭐⭐ "All" means all, including the daily cabinet (CEO 2026-08-28, reversing
 * the earlier "sandboxes only"). The reason given was that the plain reading of
 * the word is the right one: a person who types `--all` and is left with a dsh
 * still running has been surprised by their own command. What used to protect
 * the daily one was that it was excluded; what protects it now is the gate.
 *
 * ⭐ And the gate is applied **partially**, which is the whole design here: the
 * sandboxes are stopped first and unconditionally, then the daily one is asked
 * about. The common path — an agent tidying up after itself — never meets a
 * dialog, and the one dangerous step in it does. A refusal therefore arrives
 * after real work has been done, so it has to say how much: `stopped` is in the
 * error's own details, not only in the success case.
 *
 * ⛔ Only a daily dsh *this tool started* can be stopped at all, because only
 * that one has a recorded pid. One the user launched themselves answers on its
 * port and has no identity we could act on.
 *
 * ⛔ Only a main environment *this tool started* is even visible as a process,
 * because only that one has a recorded pid. A dsh the user launched themselves
 * answers on its port but has no identity we could act on, and killing
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
  const stale = []
  for (const entry of live) {
    const killed = await stop(entry.pid, entry.pidBorn)
    clearRunning(layout, entry.sandbox, entry.pid)
    ;(killed ? stopped : stale).push({ sandbox: entry.sandbox, pid: entry.pid })
  }

  const held = mainRunningRecord(layout)
  const mainUp = await mainDshRunning()
  /** @type {{pid: number} | null} */
  let main = null
  if (held !== null) {
    if (!approvedByWindow(layout)) {
      recordResolved({ all: true, stopped: stopped.map((entry) => entry.sandbox) })
      // Everything already done is named in the refusal. A caller told only
      // "not allowed" would reasonably believe nothing happened and run it
      // again, and the second run is the one that reads as a bug.
      // ⛔ `stopped` and `stale` are the same shape here as in the success case
      // below, deliberately. One field name carrying objects on one path and
      // bare names on the other means a caller reading `.sandbox` off a string
      // — and this is the path reached less often, so it is the one that would
      // be found in the wild rather than in a test.
      // ⭐ Half done when any sandbox went down before the gate: the verdict
      //    says so (exit 3), and `stopped` is the half.
      throw new BoxError('NEEDS_APPROVAL', t('quit.mainNeedsApproval', {
        count: stopped.length,
      }), { main: true, stopped, stale }, { partial: stopped.length > 0 })
    }
    const killed = await stop(held.pid, held.pidBorn)
    clearMainRunning(layout, held.pid)
    if (killed) main = { pid: held.pid }
  }
  recordResolved({ all: true, stopped: stopped.map((entry) => entry.sandbox), main: main !== null })

  if (opts.json === true) {
    return void emit({
      action: 'stop', stopped, stale, main, mainStartedHere: held !== null, mainDshOnDefaultPort: mainUp,
    })
  }
  if (stopped.length === 0) console.log(`\n  ${t('quit.nothingRunning')}`)
  else console.log(`\n  ${t('quit.stopped', { count: stopped.length, names: stopped.map((entry) => entry.sandbox).join('、') })}`)
  if (stale.length > 0) console.log(`  ${t('quit.staleRows', { count: stale.length })}`)
  if (main !== null) console.log(`  ${t('quit.mainStopped', { pid: main.pid })}`)
  // `held` with no `main` is the one case left: the row named a pid that now
  // belongs to somebody else, so nothing was killed and the row was cleared.
  else if (held !== null) console.log(`  ${t('quit.mainStale', { pid: held.pid })}`)
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
 * End the window service holding this data directory's seat.
 *
 * ⛔⛔ The missing "undo". One data directory allows one window service, and the
 * service lets go of its seat when it closes — which covers every way a window
 * is *meant* to end. It does not cover the exe being killed: the Node service is
 * a child, it outlives that on Windows, and it goes on holding the seat and the
 * port with its parent gone. From then on `ui` is refused forever and there was
 * nothing in this tool to say otherwise, so the only way out was to find the pid
 * by hand and `taskkill` it — the tool's own boundary rule ("what the screen
 * shows is everything") broken in the usual way, by an action that had a *do*
 * and no *undo*.
 *
 * ⛔ Deliberately its own switch rather than something `--all` sweeps up.
 * Folding windows into "stop everything" was proposed once and withdrawn on
 * purpose: a window closing itself after asking for a stop is the direction that
 * works, and a sweep that reached back into windows would let one person's
 * command shut down a view somebody else is reading. Asking for it by name is
 * the point.
 *
 * ⭐ A seat whose process is gone is not a window — it is litter left by a kill,
 * and the honest answer is "there is nothing serving here" plus quietly clearing
 * it, not pretending to stop something.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function stopUi(layout, opts) {
  const seat = uiSeatFile(layout)
  const held = liveClaim(seat)
  if (held === null) {
    const littered = existsSync(seat)
    if (littered) rmSync(seat, { force: true })
    throw new BoxError('NO_WINDOW_SERVING', t('window.noneServing'), { cleared: littered })
  }
  // The same proof every other kill in this tool needs: a pid on its own names
  // whatever holds that number now, which after a reboot is a stranger.
  const killed = await stop(Number(held.pid), held.pidBorn)
  // Whether or not the kill landed, the record is no longer true — `stop`
  // returns false precisely when that pid is somebody else now.
  rmSync(seat, { force: true })
  recordResolved({ window: true, pid: held.pid, url: held.url ?? null })
  if (opts.json === true) {
    return void emit({ action: 'stop', pid: held.pid, url: held.url ?? null, killed })
  }
  console.log(`\n  ${killed
    ? t('window.stopped', { pid: String(held.pid), url: String(held.url ?? '?') })
    : t('window.gone', { pid: String(held.pid) })}\n`)
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
    // ⭐ `--json` is the one boolean that may carry a number: which shape of
    //    machine answer is wanted. Bare means the first shape, for good.
    if (key === 'json') {
      const asked = equals === -1 ? JSON_SCHEMA_DEFAULT : Number(token.slice(equals + 1))
      if (!JSON_SCHEMAS.includes(asked)) {
        throw new BoxError('JSON_SCHEMA_UNKNOWN', t('flag.jsonSchema', {
          asked: token.slice(equals + 1), known: JSON_SCHEMAS.join('、'),
        }), { asked: token.slice(equals + 1), known: JSON_SCHEMAS })
      }
      flags.json = true
      jsonSchema = asked
      continue
    }
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
 * Every flag given belongs to this command, and none was given twice.
 *
 * ⛔ `parseArgs` above can only say "nobody's flag": it runs before the command
 * is known, against the union of every command's flags. So for a long time any
 * flag parsed anywhere and was dropped in silence where it meant nothing —
 * `ls --force`, `stop --version 1.2` — which is a typo producing a plausible
 * run. This is the half that knows which command it is.
 *
 * ⭐ A flag that belongs to another command is refused **by name**, saying
 * whose it is: the caller mis-remembered where the flag lives, and "unknown"
 * would send them to the wrong page. A value flag given twice is refused
 * unless the declaration says `repeat`: first-wins and last-wins are both
 * guesses, and this tool's whole job is knowing which cabinet it is acting on.
 * @param {string} name - the command as the table keys it, e.g. `get.plugin`.
 * @param {Record<string, string | boolean | string[]>} flags
 */
function checkFlagsBelong(name, flags) {
  const shape = COMMANDS[name]
  if (shape === undefined) return
  const own = new Map(shape.params.filter((one) => one.at === undefined).map((one) => [one.name, one]))
  const globals = new Set(GLOBAL_PARAMS.map((one) => one.name))
  const spoken = name.split('.').join(' ')
  for (const [key, value] of Object.entries(flags)) {
    const param = globals.has(key) ? GLOBAL_PARAMS.find((one) => one.name === key) : own.get(key)
    if (param === undefined) {
      const owners = Object.entries(COMMANDS)
        .filter(([, other]) => other.params.some((one) => one.at === undefined && one.name === key))
        .map(([other]) => other.split('.').join(' '))
      throw new BoxError('FLAG_NOT_HERE', t('flag.notHere', { flag: key, command: spoken, owners: owners.join(' / ') }), {
        flag: key, command: name, belongsTo: owners,
      })
    }
    if (Array.isArray(value) && param.repeat !== true) {
      throw new BoxError('FLAG_TWICE', t('flag.twice', { flag: key, count: value.length, list: value.join('、') }), {
        flag: key, given: value,
      })
    }
  }
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

/**
 * This run's own command line, as the window would have to type it.
 *
 * Two things are taken out and nothing is added. `--json` is how *this* caller
 * wanted to be answered and says nothing about the action; `--box` is supplied
 * by the window from the data directory it is already serving. Everything else
 * goes across untouched, because the whole point is that the person is agreeing
 * to **this** command and not to a reconstruction of it.
 * @returns {string[]}
 */
function argvForApproval() {
  const out = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--json') continue
    if (token === '--box') {
      i += 1
      continue
    }
    if (token.startsWith('--box=')) continue
    out.push(token)
  }
  return out
}

/**
 * Ask a person on the panel, and let the panel run it if they agree.
 *
 * ⭐⭐ One funnel, at the very top, deliberately. Every refusal that says
 * `NEEDS_APPROVAL` — the five writes, `start main --version`, and stopping the
 * daily cabinet, which was added the same day — arrives here without its own
 * code knowing this exists, and so will the next one somebody adds. The
 * alternative is each gate learning to open a window, which is the shape this
 * repository has been burned by before: a rule that has to be written once per
 * site is a rule the next site will not have.
 *
 * ⛔ It runs **after** the action was refused, so whatever the command already
 * did before reaching its gate has been done. That is intended for the one
 * caller where it matters (`stop --all` stops the sandboxes, then asks about the
 * daily one), and it is why the refusal carries what it got through.
 *
 * ⚠️ The approved run is the panel's child, not this process's work. This
 * process only reports what the panel got back — which is also why there is
 * nothing here that could pretend to be an approval.
 * @param {import('../src/paths.js').BoxLayout} box
 * @param {Error} error - the refusal that sent us here.
 */
async function throughThePanel(box, error) {
  const line = argvForApproval()
  const seconds = Math.round(APPROVAL_WINDOW_MS / 1000)
  // Progress goes to stderr in both faces: `--json` promises one parseable line
  // on stdout, and a caller waiting a minute with nothing on the screen is the
  // other half of the same promise.
  console.error(`\n  ${error.message}`)
  console.error(`  ${t('approval.opening', { seconds })}`)
  // ⛔⛔ Proved, not assumed (CEO 2026-08-28: "弹不出来就当场报错"). Spawning a
  // window that never appears is not an error the spawn reports, so without
  // this the caller would wait out the whole minute and then be told nobody
  // answered — which is a different failure wearing the same sentence.
  if (!await ensurePanel(box)) {
    throw new BoxError('NO_PANEL', `${error.message}\n  ${t('approval.noPanel')}`, {
      ...errorDetails(error), panel: false,
    })
  }
  const asking = askApproval(box, {
    argv: line,
    what: `${PROGRAM} ${line.join(' ')}`,
    // ⭐ The refusal's own sentence, carried across as it is. It already says
    // what will be touched, where the backup goes and what has no way back —
    // written once, for the gate, and the dialog is exactly where a person
    // needs it. Rewording it for the panel would be a second copy that drifts.
    why: error.message,
    code: errorCode(error),
    details: errorDetails(error),
  })
  console.error(`  ${t('approval.waiting')}`)
  const outcome = await waitForApproval(box, asking.id)
  if (outcome.decision === 'deny') {
    throw new BoxError('APPROVAL_DENIED', t('approval.denied'), errorDetails(error))
  }
  if (outcome.decision === 'timeout') {
    throw new BoxError('NEEDS_APPROVAL', t('approval.timedOut', { seconds }), {
      ...errorDetails(error), asked: true,
    })
  }
  if (outcome.decision === 'gone') {
    throw new BoxError('NEEDS_APPROVAL', t('approval.gone'), { ...errorDetails(error), asked: true })
  }
  const result = outcome.result ?? {}
  // The panel's run is the real one, so its failure is the answer — repeating it
  // here rather than wrapping it keeps the `code` a caller reads unchanged.
  if (result.ok !== true) {
    throw new BoxError(
      typeof result.code === 'string' ? result.code : 'APPROVED_RUN_FAILED',
      typeof result.message === 'string' ? result.message : t('approval.denied'),
      { approvedInWindow: true },
    )
  }
  // The window already wrote its own line in the operation record; a second one
  // from here would make one action look like two.
  alreadyRecorded = true
  if (wantsJson) return void console.log(JSON.stringify({ ...result, approvedInWindow: true }))
  console.error(`  ${t('approval.granted')}\n`)
}

/**
 * Whether a refusal is one a person could lift, in a run that may ask.
 *
 * ⛔ The environment test is what stops the loop: the panel's own run carries
 * the mark, so if that run is refused too, it is refused for a reason a second
 * dialog cannot fix.
 * @param {unknown} error
 * @returns {boolean}
 */
function needsAPerson(error) {
  return errorCode(error) === 'NEEDS_APPROVAL'
    && layout !== null
    && process.env[APPROVAL_ENV] !== '1'
    && process.env[NO_PANEL_ENV] !== '1'
}

/**
 * Say no straight away instead of opening a window and waiting for a person.
 *
 * ⭐ It exists for the case where there is nobody to ask and everyone knows it:
 * a headless machine, a CI run, an agent on the Linux phone. Waiting out a
 * minute for a dialog that cannot be displayed is not caution, it is a hang.
 *
 * ⛔⛔ It can only ever **refuse faster**. There is deliberately no setting
 * anywhere that can make an unapproved action run — that is the whole of the
 * 2026-08-28 decision, and a switch that reduces what the tool will do does not
 * touch it. Read that direction carefully before adding anything beside it.
 */
const NO_PANEL_ENV = 'DSH_BOX_NO_PANEL'

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
  try {
    await main(positional, flags)
  } catch (error) {
    if (!needsAPerson(error)) throw error
    await throughThePanel(layout, error)
  }
  if (pending !== null && !alreadyRecorded && layout !== null) {
    record(layout, { command: pending.command, args: pending.args, ok: true })
  }
  if (layout !== null) finishCommand(layout)
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
  // ⛔⛔ On the failing path too, and this is the line that keeps the automatic
  // lock from leaking: a command that threw would otherwise leave its "running"
  // record behind, and the window would stand aside for a process that is gone.
  if (layout !== null) finishCommand(layout)
  // ⭐ The verdict travels with the answer; the exit code below is its
  //    projection. `partial` is still `ok:false` — the command did not do all
  //    of what was asked — but its details name what was done.
  const verdict = verdictOf(error)
  if (wantsJson) {
    console.log(JSON.stringify({
      schema: jsonSchema,
      box: layout?.root ?? null,
      ...boxSwap(),
      ok: false,
      verdict,
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
  process.exit(VERDICT_EXIT[verdict])
}
