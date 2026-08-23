/**
 * The config window: a small local HTTP server plus one page.
 *
 * A page rather than a native window because the thing being configured is
 * itself a browser application — the user ends up in a browser either way —
 * and because one implementation then works identically on Windows, macOS and
 * Linux. Packaging this into a double-clickable binary is a separate step
 * that adds no behaviour; see the README.
 *
 * ⭐ This file used to hold eighteen functions that implemented the commands a
 * second time, over HTTP. Same job, two bodies of code: each read the config,
 * filled in its own defaults, ran its own checks. They drifted, silently, and
 * the drift did damage — a sandbox started from the command line did not exist
 * as far as the window was concerned, so the guard against deleting a release
 * out from under a running sandbox found nothing to object to. The window
 * could also delete a running sandbox outright, and could change the install
 * source, which the command line had no way to do at all.
 *
 * So the window is now a projection and nothing more. It has exactly two ways
 * to touch the world:
 *
 *   **reads go to disk** — {@link snapshot} opens the same files `status`
 *   opens, in this process, with no subprocess and no cached state of its own;
 *
 *   **writes go through a command** — {@link runCommand} starts the real
 *   command line as a child process and reports what it said.
 *
 * That second one is what makes "the window cannot grow a capability the
 * command line lacks" structural rather than a rule someone has to remember.
 * It also means every click is journalled, refused with the same error codes,
 * and logged in the same place as an agent's identical action, for free.
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS, commandLine, mutates } from './commands.js'
import { partitionPlugins, readConfig, SETTINGS } from './config.js'
import { BoxError } from './errors.js'
import { detectHostDsh } from './host.js'
import { controlStatus, readSession } from './journal.js'
import { readTail } from './logs.js'
import { LANGS, messagesFor, setLang, systemLang, t } from './messages.js'
import { cabinetPlugins } from './mounts.js'
import { downloadInFlight, isOurDownload, pluginVersion } from './packages.js'
import { nameRule, uiSeatFile, userDshHome } from './paths.js'
import { listReleases } from './registry.js'
import {
  claimPath, describeClaim, hasCredentials, listSandboxes, liveClaim, mainRunningRecord,
  releasePath, runningSandboxes, suggestSandboxName,
} from './sandbox.js'
import { findFreePort } from './launch.js'
import { downloadedVersions } from './versions.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The command line this window drives. The only way it changes anything. */
const CLI = join(HERE, '..', 'bin', 'cli.js')

/**
 * The oldest release offered as a ready-made choice.
 *
 * Everything from here to whatever is newest on npm goes in the main row —
 * computed from the registry at runtime, never hardcoded, because releases
 * arrive faster than this file changes. Anything older is an early build:
 * still reachable, but folded away.
 */
export const OLDEST_FEATURED = '0.1.0-rc.6'

/**
 * The window's own preferred port. Fixed rather than OS-chosen so that the
 * address survives a restart — an OS-chosen port changes every time, and
 * every open tab and bookmark dies with it.
 */
export const UI_PORT = 10130

/**
 * Start the config window.
 *
 * ⚠ Ending this process does not stop anything it started. Sandboxes are
 * separate dsh processes that were handed off on purpose, and Ctrl+C here ends
 * one command — `ui` — not the program: there is no long-lived dsh-box process
 * for it to end. Stopping every sandbox is a thing you *do*, and it has its own
 * command, `quit`, which the window's close button calls. This used to be a
 * shutdown hook that killed whatever this process had launched, which meant
 * the same sandbox died with the window or did not, depending on nothing more
 * than which entrance had started it.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} [options]
 * @param {number} [options.port] - 0 picks the first free port from {@link UI_PORT}.
 * @param {boolean} [options.open] - launch the browser.
 * @returns {Promise<void>} resolves when the server closes.
 */
export async function serve(layout, { port = 0, open = true } = {}) {
  // ⛔ One data directory, one window service. Not tidiness: the window's own
  // close button runs `quit`, which stops every sandbox — so a second window is
  // a second person's world being shut down by somebody who cannot see them.
  // Two services also mean two logs of the same events and two ports for one
  // address, and the reason the second one ever started is that `ui` used to
  // answer a busy port by quietly moving to the next one.
  //
  // ⭐ Views are still free: any number of browser tabs can point at the one
  // service. What is refused is a second *service* on the same data directory.
  const seat = uiSeatFile(layout)
  const held = liveClaim(seat)
  if (held !== null || !claimPath(seat)) {
    const other = held ?? liveClaim(seat) ?? {}
    throw new BoxError('UI_ALREADY_SERVING', t('window.alreadyServing', {
      url: String(other.url ?? '?'), pid: String(other.pid ?? '?'),
    }), { url: other.url ?? null, pid: other.pid ?? null })
  }
  if (port === 0) port = await findFreePort({ from: UI_PORT })
  const server = createServer((request, response) => {
    const refused = refuse(request, port)
    if (refused !== null) return void json(response, 403, { error: refused.message, code: refused.code })
    handle(layout, request, response, () => server.close()).catch((error) => {
      json(response, 500, { ok: false, code: 'WINDOW_FAILED', message: error.message })
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`
      // Now that there is an address, put it on the claim: the next `ui` is
      // refused, and the refusal can say where the window already is instead of
      // only that there is one.
      describeClaim(seat, { url, port: server.address().port })
      console.log(`\n  ${t('window.address', { url })}\n`)
      if (open) openBrowser(url)
    })
    server.once('close', () => {
      releasePath(seat)
      resolve()
    })
  })
}


/**
 * The pass this run's page carries, minted fresh at every start.
 *
 * The header check below is what actually stops a hostile page, because a
 * browser will not let a script forge `Origin` or `Host`. This is the second
 * lock, for the case where that check is defeated: a cross-origin page cannot
 * read our page's contents, so it cannot learn this value, and without it no
 * `/api` call is answered. It is deliberately not a login — anything that can
 * read your files is already past every door this tool could close.
 */
const PASS = randomUUID()

/**
 * Why a request is refused, or null when it may proceed.
 *
 * The window is a local web service that starts processes and deletes
 * sandboxes, on a fixed, publicly known port. Any page in the same browser
 * can post to it, and a "simple" request crosses origins without asking
 * permission first — so without this, visiting the wrong site while the
 * window is open is enough to have conversations deleted or a process
 * started. `Host` is checked as well as `Origin` because DNS rebinding turns
 * an attacker's domain into a same-origin one, and the borrowed name is the
 * only place that shows.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} port - the port this window listens on.
 * @returns {string | null}
 */
function refuse(request, port) {
  const mine = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  if (!mine.has(request.headers.host ?? '')) {
    return { code: 'NOT_LOCAL', message: t('window.notLocal') }
  }
  const origin = request.headers.origin
  if (origin !== undefined && !mine.has(origin.replace(/^https?:\/\//, ''))) {
    return { code: 'CROSS_ORIGIN', message: t('window.crossOrigin') }
  }
  const path = request.url ?? ''
  if (path.startsWith('/api/')) {
    const presented = request.headers['x-dsh-box-pass']
    if (presented === undefined) {
      return { code: 'NO_PASS', message: t('window.noPass') }
    }
    // ⭐ A pass that is present but wrong is a different event from one that is
    // absent, and telling them apart is the difference between blaming the
    // request and describing what happened. Only a page this service served can
    // carry a pass at all, so a wrong one means it was served by a *previous*
    // run: the window was restarted and this tab is left over. That is not a
    // permission problem, it is a stale page, and the fix is a refresh — which
    // the page now does by itself on seeing this code.
    if (presented !== PASS) {
      return {
        code: 'STALE_PASS',
        message: t('window.stalePass'),
      }
    }
  }
  return null
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {() => void} close - stop serving; see the `quit` branch below.
 */
async function handle(layout, request, response, close) {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/') {
    // ⛔ Never cached. The page carries this run's pass baked into it, so a
    // cached copy is a page holding a pass that no longer exists — and the
    // recovery for that is "reload", which a cache would answer with the same
    // stale copy forever. The one instruction the window gives when things go
    // wrong has to actually work.
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    // The language is decided per serve, not per process start: `config lang`
    // may have run since this window opened, and the reload the switch in the
    // page's corner does is only a real switch if this read happens again.
    const lang = setLang(pageLang(layout))
    const page = readFileSync(join(HERE, 'ui', 'index.html'), 'utf8')
    // Baked in exactly like the pass: the page and the command line answering
    // it must be reading the same table. `<` is escaped so no sentence can ever
    // smuggle a `</script>` into the page, and the replacements are functions
    // so `$`-sequences inside a sentence stay text instead of becoming
    // `String.replace` patterns.
    const baked = (value) => JSON.stringify(value).replaceAll('<', '\\u003c')
    const names = Object.fromEntries(LANGS.map((one) => [one, messagesFor(one)['lang.name']]))
    return void response.end(page
      .replace('__DSH_BOX_PASS__', PASS)
      .replace('__DSH_BOX_LANG_NAMES__', () => baked(names))
      .replaceAll('__DSH_BOX_LANG__', lang)
      .replace('__DSH_BOX_MESSAGES__', () => baked(messagesFor())))
  }
  if (url.pathname === '/api/state') return json(response, 200, await snapshot(layout))
  if (request.method !== 'POST') return json(response, 404, { error: t('window.notFound') })

  const body = await readJson(request)
  // Two doors, and no third. Anything that changes something goes through the
  // command line; the only exception handles a link click, which changes
  // nothing at all.
  if (url.pathname === '/api/command') {
    const result = await command(layout, body.argv)
    json(response, 200, result)
    // A window is a view of the program. When the program has just been told
    // to quit — by this window, through the same command anyone else would
    // use — the view has nothing left to show, so it stops serving. This is
    // not the window deciding anything: `quit` did the stopping, and closing
    // is only this process ending its own life afterwards.
    if (body.argv?.[0] === 'quit' && result.ok === true) setTimeout(close, 200).unref?.()
    return
  }
  if (url.pathname === '/api/open') return json(response, 200, openLocal(body))
  return json(response, 404, { error: t('window.notFound') })
}

/**
 * Which language the page speaks: the same answer `chooseLang` in the CLI
 * gives, read the same tolerant way — the `lang` setting of this data
 * directory, or the computer's own language when nothing has been set. A
 * config this cannot parse decides nothing, because the window still has to
 * be able to open and complain about it.
 * @param {import('./paths.js').BoxLayout} layout
 * @returns {string}
 */
function pageLang(layout) {
  try {
    if (existsSync(layout.config)) {
      const chosen = JSON.parse(readFileSync(layout.config, 'utf8'))?.lang
      if (typeof chosen === 'string') return chosen
    }
  } catch {
    // Deliberately silent: this is not the place that reports a broken config.
  }
  return systemLang()
}

/**
 * The last answer from npm, kept a minute.
 *
 * The only thing this window remembers, and it remembers it about npm rather
 * than about itself: the page polls to keep its running list fresh, and that
 * poll must not become a registry request every time. Nothing about the data
 * directory is cached here — that is read from disk on every poll, which is
 * what makes the window agree with the command line by construction.
 */
let releases = { at: 0, data: null }

/**
 * Everything the window needs to draw itself, read from disk.
 *
 * The same files `status` reads, read the same way, in this process. No
 * subprocess: a poll every second must not cost one, and reading is not an
 * action — nothing here changes, so nothing here needs a command.
 * @param {import('./paths.js').BoxLayout} layout
 */
async function snapshot(layout) {
  const config = readConfig(layout)
  const { live, missing } = partitionPlugins(config)
  let available = []
  let tags = {}
  try {
    if (releases.data === null || Date.now() - releases.at > 60_000) {
      releases = { at: Date.now(), data: await listReleases({ source: config.source }) }
    }
    available = releases.data.versions
    tags = releases.data.tags
  } catch {
    // Offline is a normal state: everything already downloaded still runs.
  }
  // `available` is newest-first by publish time, so the split is a single
  // cut: everything at or after the oldest featured release goes in the main
  // row, everything older is an early build and folds away.
  const cut = available.indexOf(OLDEST_FEATURED)
  return {
    box: layout.root,
    // The machine a launch uses unless a download is named. Read from disk like
    // everything else here — no `npm ls -g`, which would turn an eight-second
    // poll into eight seconds of subprocess.
    host: detectHostDsh(),
    downloaded: downloadedVersions(layout),
    featured: cut === -1 ? [] : available.slice(0, cut + 1),
    older: cut === -1 ? [] : available.slice(cut + 1),
    available,
    tags,
    source: config.source,
    settings: Object.fromEntries(
      Object.entries(SETTINGS).map(([name, setting]) => [name, setting.read(config)]),
    ),
    // `downloaded` says whose files these are, which is the only thing that
    // decides what removing one does — so the page can word its button
    // accordingly instead of guessing from the path.
    // `version` is read from each folder's package.json at every snapshot, the
    // same way the command line answers `plugins` — never stored, so it cannot
    // go stale. Null when the folder will not say; the page shows nothing then.
    plugins: live.map((plugin) => ({
      ...plugin,
      downloaded: isOurDownload(layout, plugin.path),
      version: pluginVersion(plugin.path),
    })),
    missingPlugins: missing,
    // What the user's own filing cabinet actually has. The registry above is
    // "what this tool knows about"; this is "what will load when you type dsh",
    // and the two stopped being the same thing when plugins became a property
    // of the workspace rather than of a launch.
    mainPlugins: withVersions(cabinetPlugins(layout, userDshHome())),
    // Whether the user's own cabinet holds a sign-in. A fact about the cabinet,
    // read the same way a sandbox's is, so the tick beside it can mean the same
    // thing in both places instead of being a preference in one and a fact in
    // the other.
    mainSignedIn: hasCredentials(userDshHome()),
    sandboxes: listSandboxes(layout).map((box) => ({ ...box, plugins: withVersions(box.plugins) })),
    suggestedName: suggestSandboxName(layout),
    last: config.last,
    running: runningSandboxes(layout),
    // ⭐⭐ The npm download happening this second, whoever started it, with the
    // tail of its log riding along. This is the whole of "the window can watch a
    // download it did not perform" — §2.2's complaint that the window has
    // nothing to say while an agent spends two minutes downloading.
    //
    // ⛔ It rides the snapshot rather than being tailed the way the pull box
    // tails: `watchLog` re-runs `logs` through `/api/command` every 800ms, which
    // starts a command-line process each time. That is affordable for something
    // a person just clicked and is watching; as a standing poll for a download
    // somebody else started it would be hundreds of processes over one install.
    // Reading the file here costs nothing extra — this snapshot is already read
    // from disk, in this process, twice a second.
    download: describeDownload(layout),
    // Only ever the main environment *we* started, and only from disk. A dsh
    // the user launched themselves is deliberately absent: we could see its
    // port but not its identity, and a stop button that acts on a guess is
    // worse than no stop button.
    main: mainRunningRecord(layout),
    // Sent rather than repeated in the page, so the rule has one home. A copy
    // in the page is a copy that drifts, and the drift shows up as the window
    // accepting a name the launcher then refuses.
    nameRule: nameRule(),
    // The two files the blue frame is drawn from. Both are usually absent —
    // `agent/` does not exist until something attaches — and that is the
    // ordinary state, not a failure: it means nobody is driving and there is no
    // history. Neither is reported as an error.
    agent: controlStatus(layout),
    session: agentSession(layout),
  }
}

/**
 * A cabinet's plugin listing with each of our rows carrying its version.
 *
 * Only `ours`: those are the rows this tool linked, so their folders are known
 * and readable. `theirs` are names in somebody else's patch — there is no
 * folder to ask, and guessing one would put an invented number on the screen.
 * @param {{ours: {path?: string}[]}} mounted - a `cabinetPlugins` result.
 */
/**
 * The download in flight and the last of what it has said, or null.
 *
 * The claim answers "is anything running" — by pid, so a killed install stops
 * being reported rather than hanging on screen forever — and names the log to
 * read. Both halves come from the file the install itself wrote; nothing here
 * is invented, which is what keeps this a projection of the command line rather
 * than a second mechanism beside it.
 * @param {import('./paths.js').BoxLayout} layout
 */
function describeDownload(layout) {
  const held = downloadInFlight(layout)
  if (held === null) return null
  return { name: held.name, startedAt: held.startedAt, lines: readTail(held.log, { lines: 24 }).lines }
}

function withVersions(mounted) {
  return { ...mounted, ours: (mounted.ours ?? []).map((entry) => ({ ...entry, version: pluginVersion(entry.path ?? '') })) }
}

/**
 * The recorded session, with every action written out as a line anyone could
 * re-run.
 *
 * The line is rendered here, from the arguments the action resolved to, rather
 * than stored when the action happened. A stored line is a second copy of the
 * record and can disagree with it; a rendered one cannot. It is rendered on
 * this side because the table that knows which value belongs to which flag is
 * this side — the page has no business owning a second copy of that either.
 *
 * ⭐ A session whose actions cannot be read as a list is reported as no session
 * at all. Drawing a trail out of something misread would put operations on the
 * screen that never happened, which is worse than showing nothing.
 * @param {import('./paths.js').BoxLayout} layout
 */
function agentSession(layout) {
  const session = readSession(layout)
  if (session === null || !Array.isArray(session.actions)) return null
  return {
    ...session,
    actions: session.actions.map((action) => ({
      ...action,
      line: commandLine(action.command, action.args ?? {}),
    })),
  }
}

/**
 * Flags the window fills in itself and will not accept from the page.
 *
 * `--box` decides which data directory is being talked about, and a page that
 * could set it would be able to act on a world other than the one it is
 * showing — the mix-up this tool prints a data directory on every answer to
 * avoid. `--json` is how the answer gets back here at all.
 */
const RESERVED_FLAGS = new Set(['box', 'json'])

/**
 * Run one command and return what it said.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {unknown} argv - the command and its arguments, as typed.
 * @returns {Promise<Record<string, unknown>>}
 */
async function command(layout, argv) {
  const problem = checkArgv(argv)
  if (problem !== null) return { ok: false, code: 'BAD_COMMAND', message: problem }
  const held = heldAgainst(layout, argv)
  if (held !== null) return held
  return runCommand(layout, argv)
}

/**
 * The commands this window may still send while an agent is driving it.
 *
 * Only the way out. `detach` is the person taking the wheel back, and refusing
 * that would be refusing the one control that has to keep working.
 */
const RELEASE_COMMANDS = new Set(['detach'])

/**
 * Refuse a window command while an agent holds this data directory, or null.
 *
 * ⛔ **The lock used to exist only on the page**, as `<main>.inert`. Nothing
 * here asked whether an agent was driving, so anything that reached this
 * function ran — which made the guarantee a property of the page being correct
 * rather than a property of the program. The sister book already said 「界面锁
 * 死是纪律,不是保险」about a second agent; it was wider than that, because it
 * did not hold against this window either.
 *
 * Put here rather than spread across the controls for the same reason the
 * command table exists: a rule that has to be repeated per control is a rule
 * that will be missed by the next control. This one is inherited for free.
 *
 * ⚠️ It refuses **the window**, not the command line. An agent's own commands
 * come from its own process and never pass through here, which is what lets
 * this be a flat refusal instead of a judgement about who is asking.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string[]} argv
 * @returns {Record<string, unknown> | null}
 */
function heldAgainst(layout, argv) {
  if (RELEASE_COMMANDS.has(argv[0])) return null
  if (!mutates(argv[0]) && !mutates(`${argv[0]}.${argv[1]}`)) return null
  const held = controlStatus(layout)
  if (held === null) return null
  return {
    ok: false,
    code: 'AGENT_HOLDS_WINDOW',
    message: t('window.agentHolds'),
    session: held.session,
    since: held.startedAt,
  }
}

/**
 * Why this argument list will not be run, or null.
 *
 * Deliberately thin. The command line does the real checking — that is the
 * point of there being only one implementation — so this refuses only the two
 * things that would not reach it as a mistake: a command that does not exist,
 * and a flag the window owns. Arguments are handed over as a list, never a
 * string for a shell to re-read, so nothing here is guarding against quoting.
 * @param {unknown} argv
 * @returns {string | null}
 */
function checkArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return t('window.noCommand')
  if (argv.some((token) => typeof token !== 'string')) return t('window.nonTextToken')
  if (!(argv[0] in COMMANDS)) return t('window.unknownCommand', { name: argv[0] })
  if (argv[0] === 'ui') return t('window.noNestedUi')
  for (const token of argv) {
    const flag = token.startsWith('--') ? token.slice(2).split('=')[0] : null
    if (flag !== null && RESERVED_FLAGS.has(flag)) return t('window.reservedFlag', { flag })
  }
  return null
}

/**
 * Start the command line as a child process and read its one JSON line.
 *
 * The working directory is left alone on purpose: `start` uses it as the
 * workspace dsh opens when none is remembered, so changing it here would
 * quietly send window launches somewhere else than command-line ones.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string[]} argv
 * @returns {Promise<Record<string, unknown>>}
 */
function runCommand(layout, argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', layout.root, '--json'], {
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.once('error', (error) => resolve({
      ok: false, code: 'COMMAND_NOT_RUN', message: t('window.cannotRunCli', { error: error.message }),
    }))
    child.once('close', (code) => {
      // Success and refusal both arrive as one JSON line; the exit code only
      // says which. Anything else means the command line itself broke, and
      // saying so beats reporting a plausible failure that never happened.
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      if (line !== undefined) {
        try {
          return void resolve(JSON.parse(line))
        } catch {
          // Fall through to the no-answer case below.
        }
      }
      resolve({
        ok: false,
        code: 'COMMAND_NO_OUTPUT',
        message: err.trim() || t('window.noOutput', { code }),
        argv,
      })
    })
  })
}

/**
 * Open a local sandbox URL in the system's default browser.
 *
 * The one thing here that is not a command, because it is not an action on
 * anything this tool owns: it opens a link. Exists for the desktop shell,
 * whose webview has no tabs, so an ordinary `target="_blank"` link silently
 * does nothing there. Only loopback http URLs are accepted — this endpoint
 * must not become a general-purpose "open anything" lever.
 * @param {{url: string}} body
 */
function openLocal(body) {
  const url = String(body.url ?? '')
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}\/?$/.test(url)) throw new Error(t('window.onlyLocalUrl'))
  openBrowser(url)
  return { ok: true }
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

/**
 * @param {string} url
 */
function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['cmd.exe', '/c', 'start', '', url]
    : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url]
  try {
    // ⛔ Deliberately not `detached` on Windows. Measured: `cmd.exe` started
    // detached gets a console of its own and `windowsHide` does not apply to
    // it, so a black window flashed up every single time the config window
    // opened or a sandbox link was clicked. The same spawn without `detached`
    // creates no console at all. Nothing is lost by dropping it: both callers
    // are the long-lived window process, `start` hands the URL to the system
    // and exits immediately, and a Windows child outlives its parent anyway.
    spawn(command[0], command.slice(1), { stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    // Opening a browser is a convenience; the URL is printed either way.
  }
}
