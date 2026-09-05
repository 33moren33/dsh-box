/**
 * Starting one sandbox: pick a port, write the plugin overlay, boot the
 * chosen release, and only report success once the thing is genuinely up.
 */

import { spawn } from 'node:child_process'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { repointDownloads } from './engines.js'
import { processStartedAt, sameProcess } from './process-identity.js'
import { BoxError } from './errors.js'
import { engineRecord } from './host.js'
import { tailLines } from './logs.js'
import { t } from './messages.js'
import { cleanPath, removeTree, sandboxPaths, versionDir } from './paths.js'
import {
  claimStart, clearMainRunning, clearModuleFallback, clearRunning, noteBoot, noteMainRunning,
  noteRunning, releaseStart, rememberedPort, runningRecord, switchesEngine,
} from './sandbox.js'

/** dsh's own default. Reserved for the user's real environment. */
export const PREFERRED_PORT = 3080

/**
 * Where sandboxes start hunting. Deliberately not 3080: when the user's
 * daily dsh happens to be off, a sandbox that grabs its port ends up
 * impersonating it — wrong tab answers, and the "is the main dsh running"
 * guard reads the sandbox as the real thing. Observed, not hypothetical.
 */
export const SANDBOX_PORT = 3090

/**
 * Find a port nothing else is on.
 *
 * Availability is decided by binding a socket rather than by consulting a
 * list of ranges to avoid. On Windows, Hyper-V and Docker reserve blocks of
 * ports that change between machines and between reboots, and a bind attempt
 * is the only answer that is correct on every machine.
 * @param {object} [options]
 * @param {number} [options.from] - first port to try.
 * @param {number} [options.tries]
 * @returns {Promise<number>}
 */
export async function findFreePort({ from = PREFERRED_PORT, tries = 200 } = {}) {
  for (let port = from; port < from + tries; port += 1) {
    if (await canBind(port)) return port
  }
  throw new BoxError('NO_FREE_PORT', t('launch.noFreePort', { from, to: from + tries }))
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function canBind(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * @typedef {object} PluginChoice
 * @property {string} id - the id the patch entry is keyed by.
 * @property {string} package - the package name dsh resolves.
 */

/**
 * Make the chosen plugin packages resolvable inside the sandbox.
 *
 * The overlay refers to a plugin by its package name, and dsh resolves that
 * name the way Node does: the profile's own `node_modules` first, then the
 * flat fallback one level up that boot fills with the installed release. A
 * folder on your disk is in neither, so a link is placed in the first of
 * them. Linking rather than copying is deliberate — a copy goes stale the
 * moment you rebuild the plugin, and you would be testing yesterday's code
 * while looking at today's source.
 *
 * The plugin's own peer dependencies (`react`, the client UI packages) are
 * not linked because they are platform modules: the client loader answers
 * those imports from its module table, not from disk.
 * @param {string} home - the sandbox home.
 * @param {string} profile - profile name.
 * @param {PluginChoice[]} plugins
 * @returns {string[]} package names that were linked.
 */
export function linkPlugins(home, profile, plugins) {
  if (plugins.length === 0) return []
  const modules = join(home, 'profiles', profile, 'node_modules')
  const linked = []
  for (const plugin of plugins) {
    if (typeof plugin.path !== 'string' || plugin.path === '') continue
    const target = join(modules, ...plugin.package.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target) || lstatSafe(target) !== null) removeTree(target)
    // `junction` is the one link type Windows creates without elevation, and
    // it behaves like a directory symlink for resolution purposes.
    symlinkSync(cleanPath(plugin.path), target, 'junction')
    // Creating a link never fails for pointing at nothing, so the only way to
    // know it landed somewhere is to look. Whatever the cause — a path stored
    // before these were made absolute, a folder moved since it was registered —
    // the outcome without this check is identical and silent: dsh loads a tree
    // with one package missing and says nothing about it.
    if (!existsSync(target)) {
      throw new BoxError(
        'PLUGIN_LINK_BROKEN',
        t('launch.linkDangling', { name: plugin.package, path: plugin.path }),
        { plugin: plugin.package, path: plugin.path, link: target },
      )
    }
    linked.push(plugin.package)
  }
  return linked
}

/**
 * `existsSync` reports false for a link whose target is gone, yet the link
 * itself still occupies the name and blocks creating a new one.
 * @param {string} path
 * @returns {import('node:fs').Stats | null}
 */
function lstatSafe(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * @typedef {object} LaunchResult
 * @property {number} pid
 * @property {number | null} pidBorn
 * @property {number} port
 * @property {string} url
 * @property {import('node:child_process').ChildProcess} child
 * @property {'announced' | 'probed' | null} readyBy - which judge decided this
 * dsh was up: dsh's own post-settle line, or our probe of the page. ⛔ Not the
 * same instant, so anything reporting a duration has to say which one it timed.
 */

/**
 * Boot one home on one release.
 *
 * Usually the home is a sandbox. Passing `home` explicitly instead boots any
 * home — the real `~/.dsh` in practice, which is what makes this tool double
 * as a plain launch entry for the dsh someone uses daily. In that mode no
 * sandbox bookkeeping happens: nothing is created, imported or recorded.
 * @param {object} options
 * @param {import('./paths.js').BoxLayout} options.layout
 * @param {string} [options.sandbox] - sandbox name; ignored when `home` is given.
 * @param {string} [options.home] - boot this home directly instead of a sandbox.
 * @param {import('./host.js').Engine} options.engine - which dsh installation
 * to run: the one the user installed, or a release this tool downloaded.
 * ⭐ Nothing here is about plugins any more. A plugin is registered in the
 * workspace (see `mounts.js`), so it is already there before this runs and stays
 * after it ends — which is what makes a workspace opened by hand and one opened
 * from here the same workspace. This function used to write an overlay, pass it
 * as `--patch`, and on a directly booted home take the links back out on exit;
 * all three are gone, and the last one would now be actively wrong.
 * @param {string} [options.profile]
 * @param {(line: string) => void} [options.onLog]
 * @param {string} [options.logFile] - send dsh's own output here instead of to
 * `onLog`. Required for a launch that outlives its launcher, because a pipe
 * dies with the process holding it.
 * @param {boolean} [options.detached] - let the launcher exit without taking
 * dsh with it. Only meaningful together with `logFile`.
 * @returns {Promise<LaunchResult>}
 */
export async function launch({
  layout, sandbox, home, engine, profile = 'web', onLog,
  logFile, detached = false,
}) {
  const { entry, version } = engine
  // ⛔ Only asked of an installation lying on the filesystem. A dsh packed into
  // an application archive is invisible to this process — `existsSync` on its
  // entry is false for a tree that is perfectly fine — and it was already
  // proved present, by the only interpreter that can see it, when the folder
  // was resolved. Asking here anyway would refuse every one of them.
  if (engine.kind !== 'app' && !existsSync(entry)) {
    throw new BoxError(
      engine.kind === 'host' ? 'NO_HOST_DSH' : 'VERSION_NOT_DOWNLOADED',
      engine.kind === 'host'
        ? t('launch.noHostDshFile', { entry })
        : t('launch.versionNotDownloaded', { version }),
      { version, entry },
    )
  }

  const direct = home !== undefined
  if (!direct) {
    // One home, one dsh. Two instances on the same filing cabinet stomp on
    // each other's session files — the same class of damage as the 08-18
    // incident where a half-written session blocked a home from loading at
    // all. The ledger lives on disk and is verified against a live process,
    // so every entrance (window, CLI, agent) sees the same answer.
    const running = runningRecord(layout, sandbox)
    if (running !== null) {
      throw new BoxError(
        'SANDBOX_ALREADY_RUNNING',
        t('launch.sandboxAlreadyRunning', {
          name: sandboxPaths(layout, sandbox).name, url: running.url, pid: running.pid,
        }),
        { sandbox: sandboxPaths(layout, sandbox).name, url: running.url, pid: running.pid },
      )
    }
    home = sandboxPaths(layout, sandbox).home
  }

  // ⛔ The check above reads a ledger that does not exist yet for the launch
  // about to happen, so on its own it leaves the whole boot unguarded. From
  // here to the ledger being written the cabinet is claimed, and a second
  // launcher arriving in those seconds is told rather than allowed.
  const claimed = claimStart(layout, direct ? null : sandbox)
  if (!claimed) {
    throw direct
      ? new BoxError('MAIN_STARTING', t('launch.mainStarting'))
      : new BoxError('SANDBOX_STARTING', t('launch.sandboxStarting', {
        name: sandboxPaths(layout, sandbox).name,
      }), { sandbox: sandboxPaths(layout, sandbox).name })
  }
  try {
    if (!direct) {
      // ⭐ The moment "which version" becomes true for downloaded plugins. The
      // junction a sandbox holds for an npm-fetched plugin is aimed at the farm
      // of the engine about to boot, so its parent-walk meets parts of exactly
      // this release. Every sandbox launch comes through here, which is what
      // keeps the farm from ever being stale — and why the daily cabinet does
      // not take this road (it is booted by `dsh` typed by hand, with nobody
      // here to re-aim anything; its downloads are copies inside the cabinet).
      const repointed = repointDownloads(layout, home, profile, engine)
      if (repointed.length > 0) onLog?.(t('launch.repointedDownloads', { count: repointed.length }))
    }
    if (direct || switchesEngine(layout, sandbox, engine)) {
      // Boot re-points the flat module fallback for every package the running
      // release knows about, and leaves alone any link naming a package that
      // release has never heard of. On a normal machine those links dangle
      // harmlessly because the other installation is gone. Here every release
      // is kept side by side, so such a link still resolves — to the wrong
      // release. Between rc.6 and rc.8 that is eleven packages. A directly
      // booted home is cleared every time, because what last touched it is
      // unknown to us; boot rebuilds the whole directory either way.
      if (clearModuleFallback(home)) onLog?.(t('launch.clearedModuleLinks'))
    }

    // 3080 belongs to the user's real dsh; sandboxes hunt from their own base
    // so an idle 3080 is never squatted by something that only looks like it.
    //
    // ⭐ A sandbox asks for its old number back first. Not to reserve it — if
    // anything holds it now, the hunt below runs exactly as before — but so that
    // the address handed to a person keeps pointing at the same cabinet across
    // restarts. The reason is in `rememberedPort`: what a re-used port breaks is
    // never the program, it is the link in someone's hand.
    const wanted = direct ? null : rememberedPort(layout, sandbox)
    let port = wanted !== null && await canBind(wanted)
      ? wanted
      : await findFreePort({ from: direct ? PREFERRED_PORT : SANDBOX_PORT })

    onLog?.(t('launch.starting', { version, port }))
    // ⭐ The key to the page dsh is about to serve, which only dsh knows. It is
    // read out of whichever place dsh's output went, because the readiness
    // judge cannot see the finished page without it on a release that
    // authenticates. Kept once found: it does not change while this dsh runs.
    let token = null
    // ⭐ Ports dsh has announced itself serving on, during this `start`. A set
    // rather than a flag because a retry runs in the same log file on a
    // different number, and "it said it is up" is only an answer about the
    // attempt currently being waited on.
    const announced = new Set()
    const notice = (text) => {
      if (token === null) token = tokenFromOutput(text)
      for (const announcedPort of servingPortsFromOutput(text)) announced.add(announcedPort)
    }
    // ⛔ Read from **this launch's** log file, never from the sandbox's log
    // directory: every earlier launch left its own token in its own file, and
    // an old one would be offered forever while the current page kept refusing.
    const reread = () => {
      if (logFile !== undefined) notice(tailLines(logFile, 40).join('\n'))
    }
    const readToken = () => {
      if (token === null) reread()
      return token
    }
    // Asked on every poll until it answers yes, then never again — `port` is
    // read at call time on purpose, because a retry changes it.
    const readAnnounced = () => {
      if (!announced.has(port)) reread()
      return announced.has(port)
    }

    // ⭐ Which judge said yes, carried back out to the caller. Not decoration:
    // the two judges answer at different instants — dsh's own line comes when
    // its tree settled, the probe comes when a page happened to be complete on
    // the poll that asked — so a caller reporting how long a start took is
    // reporting two different measurements under one name unless it can tell
    // them apart. It is also the only way a test can prove which road ran.
    /** @type {'announced' | 'probed' | null} */
    let readyBy = null

    // Output goes either to a caller watching live, or to a file. A pipe is
    // owned by this process, so a detached launch must not use one: the moment
    // the launcher exits, dsh's next write hits a closed pipe. Handing the
    // child a file descriptor instead makes its output independent of us, and
    // is also what makes a failed launch explainable after the fact.
    /**
     * Start dsh once and wait until it is genuinely serving.
     * @param {string[]} nodeArgs - flags for node itself, before the entry file.
     * @returns {Promise<import('node:child_process').ChildProcess>}
     */
    const bootOnce = async (nodeArgs) => {
      // Built per attempt: a retry is a retry on a different port.
      const args = ['--profile', profile, '--port', String(port)]
      const sink = logFile === undefined ? null : openSync(logFile, 'a')
      // ⭐ The interpreter comes from the installation, not from us. For three
      // of the four kinds it is this process's own Node; for a dsh shipped
      // inside an application it is that application's binary, which is the
      // only thing able to read the archive its code lives in.
      const child = spawn(engine.exec, [...nodeArgs, entry, ...args], {
        // ⚠️ Just wherever this was typed. There used to be a `--workspace` flag
        // setting it, dropped once it was measured: not passing it did exactly what
        // passing `process.cwd()` did, and passing something else did not make dsh
        // register that folder as a workspace either — it comes up with an empty
        // list and waits to be told. Which folder dsh works in is `workspaces use`,
        // and nothing else.
        cwd: process.cwd(),
        // DSH_HOME decides which filing cabinet dsh opens. It is trimmed because
        // it can arrive from a text field or a drag-and-drop, where a trailing
        // space survives and turns into a different directory.
        env: { ...process.env, ...engine.execEnv, DSH_HOME: cleanPath(home) },
        windowsHide: true,
        ...(sink === null ? {} : { stdio: ['ignore', sink, sink], detached }),
      })
      // The child holds its own copy of the descriptor; keeping ours open would
      // pin the file for as long as this process lives.
      if (sink !== null) closeSync(sink)

      if (sink === null) {
        // Watched live, so there is no file to read the key back out of.
        child.stdout?.on('data', (chunk) => { notice(String(chunk)); onLog?.(String(chunk).trimEnd()) })
        child.stderr?.on('data', (chunk) => { notice(String(chunk)); onLog?.(String(chunk).trimEnd()) })
      }

      if (direct) {
        // The one thing a directly booted home must not be left holding.
        //
        // `profiles/node_modules` is not an installation but a layer of pointers
        // into whichever installation booted last — so booting a real home from
        // here leaves that home resolving its packages out of this tool's data
        // directory. Measured on a real one: 251 links written in a single second,
        // all aimed at a portable test folder, which the daily dsh then depended on
        // for as long as nobody looked. Clearing costs nothing, because boot
        // rebuilds the whole directory anyway — and rebuilds it from whatever starts
        // next, which for a person typing `dsh` is their own installation.
        //
        // ⭐ Plugin links are deliberately NOT cleared with it. They belong to the
        // workspace now, not to this launch, and removing them here would uninstall
        // on exit whatever was installed on purpose.
        //
        // Best-effort: a launcher killed outright leaves this undone, and the
        // pointer layer is repaired by the next boot that clears it.
        child.once('exit', () => {
          try {
            clearModuleFallback(home)
          } catch {
            // An exit handler that throws helps nobody.
          }
        })
      }

      try {
        readyBy = await waitUntilServing(port, child, onLog, { readToken, readAnnounced })
      } catch (error) {
        await abandonStart(child, error, onLog)
        throw error
      }
      return child
    }

    /**
     * Attach the end of the log to a failure.
     *
     * "Exit code 1" is not a reason. Whatever dsh said on its way down is in
     * the log, and quoting the end of it here is the difference between a
     * caller that can act and one that can only report failure.
     * @param {unknown} error
     * @returns {string[]} the same lines, for the caller to look at.
     */
    const explain = (error) => {
      if (logFile === undefined) return []
      const tail = tailLines(logFile, 30)
      if (error instanceof BoxError) error.details = { ...error.details, logFile, tail }
      return tail
    }

    const nodeArgs = await internalsReachable(engine) ? [] : ['--expose-internals']
    if (nodeArgs.length > 0) {
      onLog?.(t('launch.needsExposeInternals'))
    }
    // ⭐ The one thing here that genuinely cannot be asked in advance. A port is
    // checked by binding it and letting go, and dsh binds it a moment later —
    // the gap between those two is not removable, because we cannot hold a port
    // and hand it over. Two launches started together therefore can pick the
    // same number, and the loser dies with `EADDRINUSE` before serving anything.
    // Measured on two concurrent starts.
    //
    // ⛔ Compare `--expose-internals` a few lines up, which is the opposite case
    // and must NOT be a retry: whether this Node can reach the internals is a
    // fact that exists before the launch, so waiting for the crash would be
    // laziness. A lost race exists only after the fact. Same mechanism, opposite
    // verdict — what decides is whether the answer was knowable beforehand.
    let child
    for (let attempt = 1; ; attempt += 1) {
      try {
        child = await bootOnce(nodeArgs)
        break
      } catch (error) {
        const tail = explain(error)
        if (attempt >= 3 || !tail.some((line) => line.includes('EADDRINUSE'))) throw error
        const next = await findFreePort({ from: port + 1 })
        onLog?.(t('launch.portTaken', { port, next }))
        port = next
      }
    }
    const url = `http://127.0.0.1:${port}`
    // ⭐⭐ The identity, written at the only moment it can be trusted. A pid on
    // its own is a number the system hands out again; paired with the instant
    // that process was born it is what the operating system itself uses to
    // tell one holder of a number from the next. Everything downstream stops
    // guessing because of this one field.
    const pidBorn = processStartedAt(child.pid)
    if (direct) {
      // A main-environment launch is recorded too — in this tool's data
      // directory, never in the user's own home. The home is theirs; the process
      // we started is ours to be able to stop.
      noteMainRunning(layout, { pid: child.pid, pidBorn, port, url, version, engine: engineRecord(engine), home })
      child.once('exit', () => clearMainRunning(layout, child.pid))
    } else {
      noteBoot(layout, sandbox, engine, port)
      noteRunning(layout, sandbox, { pid: child.pid, pidBorn, port, url, version, engine: engineRecord(engine) })
      // Best-effort: when the launcher lives long enough to see dsh exit, the
      // ledger is cleared at once. A launcher killed outright leaves the entry
      // behind — harmless, because every reader verifies the pid before
      // believing it and deletes what proves dead.
      child.once('exit', () => clearRunning(layout, sandbox, child.pid))
    }
    // Released only once the sandbox is genuinely up: until then this process
    // is still the one reporting whether the launch worked.
    if (detached) child.unref()
    return { pid: child.pid, pidBorn, port, url, child, readyBy }
  } finally {
    // After the ledger, never before: releasing any earlier would re-open the
    // very gap this closes.
    releaseStart(layout, direct ? null : sandbox)
  }
}

/**
 * Give up on a dsh this process started, and leave nothing behind.
 *
 * ⛔⛔ A refusal must not leave a dsh running that nothing recorded. The ledger
 * is written only after a launch is known to have worked, so a launch that
 * fails after spawning has a live — and, when detached, orphaned — process with
 * no row naming it: `stop` cannot reach it, the window cannot see it, and the
 * next launch meets a port held by something nobody admits starting. Measured
 * twice on one afternoon: dsh serving happily on 3090 while `ls` reported
 * nothing running.
 *
 * ⭐ And it says so. A command that did half of something has to say which half,
 * or the caller assumes nothing happened and does it again.
 * @param {import('node:child_process').ChildProcess} child
 * @param {unknown} error - the failure being reported; it is annotated, not
 * replaced, because what went wrong still matters more than the cleanup.
 * @param {(line: string) => void} [onLog]
 * @returns {Promise<boolean>} whether anything was still alive to stop.
 */
export async function abandonStart(child, error, onLog) {
  const pid = child.pid
  if (pid === undefined) return false
  const stopped = await stop(pid, processStartedAt(pid)).catch(() => false)
  if (stopped) onLog?.(t('launch.stoppedAfterFailure', { pid }))
  if (error instanceof BoxError) {
    error.details = { ...error.details, startedPid: pid, stopped }
  }
  return stopped
}

/**
 * Wait until the sandbox is actually usable.
 *
 * ⭐⭐ Two judges, in this order, and the order is the whole point.
 *
 * **First: dsh's own announcement.** The host prints `dsh web: <url>` from a
 * callback hung on the loader having settled — it is published *for* whoever
 * started the process, and it knows something no outside observer can find
 * out: that the entire plugin tree finished. Read it and the question is
 * answered by the only party that can answer it. See `servingPortsFromOutput`.
 *
 * **Then, only if that never comes: the probe.** An open port proves nothing —
 * the web server starts listening the moment its own fiber activates, while
 * the rest of the tree is still loading, and until the frontend claims the
 * fallback route every request is answered 404. Even a 200 is not enough,
 * because the page is complete only once the client-modules plugin has
 * injected the boot manifest. So the probe asks for the boot manifest.
 *
 * ⛔ The probe is kept because the announcement is a config field
 * (`printUrl`), and a home whose overlay turns it off would otherwise never
 * be seen as ready at all. It is a fallback, not a second opinion: it is
 * weaker on its own terms, and it is the half of this function that has
 * already broken once without anyone noticing.
 *
 * ⭐ Either way the process must still be alive a moment later — a tree that
 * fails late exits *after* having served a page, and that is exactly the
 * failure a port check reports as success.
 * @param {number} port
 * @param {import('node:child_process').ChildProcess} child
 * @param {(line: string) => void} [onLog]
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {() => string | null} [options.readToken] - the key dsh printed, asked
 * again on every attempt because it does not exist until dsh says it.
 * @param {() => boolean} [options.readAnnounced] - whether dsh has by now said
 * it is serving **on this port**. Asked rather than passed, for the same reason
 * as the token: it does not exist until dsh says it.
 * @returns {Promise<'announced' | 'probed'>} which judge answered. Callers that
 * report timings care, because the two do not measure the same instant.
 */
export async function waitUntilServing(port, child, onLog, { timeoutMs = 120_000, readToken, readAnnounced } = {}) {
  const deadline = Date.now() + timeoutMs
  let exited = null
  child.once('exit', (code) => { exited = code ?? 0 })

  /** @param {'announced' | 'probed'} judge */
  const settle = async (judge) => {
    await sleep(1500)
    if (exited !== null) {
      throw new BoxError('BOOT_EXITED_LATE', t('launch.bootExitedLate', { code: exited }), { exitCode: exited })
    }
    onLog?.(judge === 'announced' ? t('launch.readyAnnounced', { port }) : t('launch.readyProbed'))
    return judge
  }

  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new BoxError('BOOT_EXITED', t('launch.bootExited', { code: exited }), { exitCode: exited })
    }
    if (readAnnounced?.() === true) return await settle('announced')
    if (await servesBootManifest(port, readToken?.() ?? null)) return await settle('probed')
    await sleep(400)
  }
  throw new BoxError('BOOT_TIMEOUT', t('launch.bootTimeout', { seconds: Math.round(timeoutMs / 1000) }))
}

/**
 * Can dsh reach Node's module internals on this machine without being told to?
 *
 * ⭐ Asked of the machine, never worked out from the platform. dsh gets at the
 * internal ESM loader through a native add-on that probes V8's memory layout,
 * and that probe recognises only the official nodejs.org builds — so a
 * Nix-compiled Node, Alpine's musl, and some arm64 runtimes all fall through,
 * silently. `--expose-internals` is the documented way past it, and the
 * official docs' own workaround is exactly this flag. The add-on is an
 * optional dependency, so npm skips it without a word when no build matches:
 * install succeeds, `dsh --version` works, and nothing goes wrong until boot.
 *
 * ⛔ Two failures come out of this, not one, and only the first one says so.
 * HMR refuses to start and names the flag; the loader also silently stops
 * resolving plugin packages against the profile directory and resolves them
 * from its own instead, so an installed plugin becomes `Cannot find package`.
 * With any plugin registered, that one goes first — which is why reacting to
 * dsh's sentence was not enough, and why the question has to be asked before
 * the launch rather than read out of the wreckage afterwards.
 *
 * ⛔ Not done in this process: loading a native add-on to find out whether it
 * works is exactly the case where "it does not work" can mean a crash, and a
 * launcher that dies while checking is worse than one that waits 60ms.
 * ⭐ Put to the interpreter that is about to do the launching, not to ours.
 * They are the same runtime for three of the four kinds of installation and a
 * different one for the fourth, and asking the wrong runtime would answer a
 * question nobody asked — this is a property of the Node build, which is
 * exactly what differs there.
 * @param {import('./host.js').Engine} engine - the installation about to boot;
 * its entry file is what resolves the add-on the way dsh's own loader does.
 * @returns {Promise<boolean>}
 */
function internalsReachable(engine) {
  // Mirrors `ModuleLoader.fromInternal` in @deepseek-ai/cordis-plugin-loader:
  // the handle has to come back, not merely the module.
  const probe = 'const {createRequire}=require("node:module");'
    + 'let ok=false;'
    + 'try{ok=!!createRequire(process.argv[1])("node-addon-require-builtin")'
    + '.requireBuiltin("internal/modules/esm/loader")?.getOrInitializeCascadedLoader()}catch{}'
    + 'process.exit(ok?0:3)'
  return new Promise((resolve) => {
    const child = spawn(engine.exec, ['-e', probe, engine.entry], {
      env: { ...process.env, ...engine.execEnv },
      stdio: 'ignore',
      windowsHide: true,
    })
    // An unanswerable probe is treated as "reachable", which is the shape the
    // tool had before this check existed: it changes nothing on a machine
    // where the question cannot be put, instead of adding a flag on a guess.
    child.once('error', () => resolve(true))
    child.once('exit', (code) => resolve(code === 0))
  })
}

/** The marker the host injects into the index page once the client graph is composed. */
const BOOT_MARKER = '__DSH_BOOT__'

/**
 * The one-time key dsh prints for the page it just started serving.
 *
 * Taken from dsh's own output rather than invented: it is the only place the
 * value exists, and it is different on every launch.
 */
const TOKEN_PATTERN = /[?&]token=([A-Za-z0-9._~-]+)/

/**
 * @param {string} text - anything dsh has said so far.
 * @returns {string | null}
 */
export function tokenFromOutput(text) {
  const found = TOKEN_PATTERN.exec(text)
  return found === null ? null : found[1]
}

/**
 * dsh's own readiness announcement.
 *
 * ⭐⭐ This is the signal the host publishes *for a supervising process*, and it
 * is stronger than anything we can ask from outside: read from the installed
 * `dsh-web-app`, the announcement is hung on `ctx.get('loader')?.await()` and
 * re-checks that `webServer` is still there before printing — so the line only
 * appears once the whole plugin tree has settled. An HTTP probe cannot learn
 * that; it can only learn that some fiber is answering.
 *
 * ⛔ Why this used to be ignored: the line was read for its token and nothing
 * else, while readiness was decided by a probe of our own. That probe is grown
 * on somebody else's authentication shape, and it silently stopped working once
 * that shape changed — see `servesBootManifest`, which still carries the scar.
 * A judge that has to be repaired every time the host changes an unrelated part
 * of itself is a judge that will be wrong again.
 *
 * ⛔ It is not enough to see the words. Two launches of one `start` share a log
 * file (a retry appends to it), and a retry happens precisely because the first
 * attempt lost a port race — so the number in the line is what tells this
 * announcement apart from the previous one's. **Every caller must match the
 * port**, never merely the phrase.
 *
 * ⚠️ Not always printed: the shipped `web` bundle pins `printUrl: true`, but it
 * is a config field, so a home with its own overlay can turn it off. Absence
 * therefore means "ask the other way", never "not ready" — which is why the
 * probe below stays as the fallback rather than being deleted.
 * @param {string} text - anything dsh has said so far.
 * @returns {number[]} every port dsh has announced itself serving on, oldest
 * first. Empty when it has not said it yet.
 */
export function servingPortsFromOutput(text) {
  const ports = []
  // ⛔ A fresh regex per call: a `g` pattern carries `lastIndex` between calls,
  // and this one is asked repeatedly about a growing string.
  const pattern = /dsh web:\s+(https?:\/\/\S+)/g
  for (const [, href] of text.matchAll(pattern)) {
    // The line can carry a LAN address after the canonical URL; `\S+` stops at
    // the space before it, so only the local one is read. A trailing `?token=`
    // is part of the URL and parses fine.
    try {
      const port = new URL(href).port
      // No port in the URL means the scheme's own, which dsh never serves on.
      if (port !== '') ports.push(Number(port))
    } catch {
      // Something shaped like a URL that is not one. Skipped rather than
      // guessed at.
    }
    // ⚠️ The other line dsh prints here — "dsh web: opening the default
    // browser; pass --no-open to disable" — never reaches this loop, because
    // the pattern demands a URL. That is deliberate: it is published by the
    // same post-settle callback and so is just as true, but it names no port,
    // and a readiness signal that cannot be tied to a port cannot be told
    // apart from the previous attempt's.
  }
  return ports
}

/**
 * @param {Response} response
 * @returns {string | null}
 */
function sessionCookie(response) {
  const all = response.headers.getSetCookie?.() ?? []
  if (all.length > 0) return all.map((one) => one.split(';')[0]).join('; ')
  const single = response.headers.get('set-cookie')
  return single === null ? null : single.split(';')[0]
}

/**
 * Whether the page being served is the finished one.
 *
 * ⛔ Two requests, not one, and the second cannot be skipped. Newer dsh answers
 * the index with 401 until a session exists, and a session is not obtained by
 * putting the token in the URL — that request answers 303 and sets a cookie.
 * `fetch` follows the redirect but does not keep cookies, so the "obvious" one
 * request with `?token=` lands back on the same 401. Measured on
 * `0.1.2-alpha.1`: no token 401, token with redirect followed 401, token
 * exchanged for a cookie 200.
 *
 * ⭐ Why this matters more than it looks: without it the judge cannot ever say
 * yes on such a release, so a dsh that is up and healthy is reported as "did
 * not start within 120 seconds". The check was written against a release that
 * served the index to anybody, and it silently became a check that only that
 * release can pass.
 * @param {number} port
 * @param {string | null} token - what dsh printed, when it has printed it yet.
 * @returns {Promise<boolean>}
 */
async function servesBootManifest(port, token) {
  const index = `http://127.0.0.1:${port}/`
  try {
    let response = await fetch(index, { redirect: 'follow' })
    if (response.status === 401) {
      if (token === null) return false
      const handshake = await fetch(`${index}?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
      const cookie = sessionCookie(handshake)
      if (cookie === null) return false
      response = await fetch(index, { headers: { cookie }, redirect: 'follow' })
    }
    if (!response.ok) return false
    return (await response.text()).includes(BOOT_MARKER)
  } catch {
    return false
  }
}

/**
 * Stop a sandbox by process id — after proving the process holding that id now
 * is the one the ledger meant.
 *
 * Named explicitly rather than matched by command line: a pattern like
 * "anything mentioning dsh" also matches the user's own running dsh, and
 * killing that is not a recoverable mistake. ⛔ That is not a hypothetical —
 * `pkill -f "cli.js ui"`, typed to stop one service, also matched the ssh
 * command that contained the same words and killed it.
 *
 * ⛔⛔ And a pid alone is not enough either. The line below reaches for
 * `taskkill /T`, which takes the target's children with it; a five-day-old
 * ledger row naming pid 6772 met a machine where 6772 had become a display
 * service. **Nothing is killed until the process is shown to be the one we
 * started**, and shown by equality — the instant it was born, written down at
 * launch, read again now.
 * @param {number} pid
 * @param {number | null} pidBorn - the instant recorded when this process was
 * started. Every caller has one: readers take it from the ledger, and a caller
 * stopping the child it just started takes it from what `launch` returned.
 * @returns {Promise<boolean>} whether anything was killed. `false` means the id
 * now belongs to somebody else and was deliberately left alone.
 */
export async function stop(pid, pidBorn) {
  if (!Number.isInteger(pid) || pid <= 0) throw new BoxError('BAD_PID', t('launch.badPid', { pid }))
  // ⛔⛔ Loud, never silent. "No proof" means "do not kill", so a caller that
  // merely *forgot* the second argument would get a quiet no-op — and that is
  // exactly what happened: one `stop(result.pid)` left in the acceptance suite
  // stopped stopping anything, a stub dsh kept port 3080 for the rest of the
  // run, and three later assertions failed while pointing at something else
  // entirely. A caller who genuinely cannot know passes `null` and says so.
  if (pidBorn === undefined) {
    throw new BoxError('NO_PROCESS_PROOF', t('launch.noProcessProof', { pid }), { pid })
  }
  if (!sameProcess(pidBorn, processStartedAt(pid))) return false
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      // The launcher starts a tree; /T reaches the children it spawned.
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).once('exit', resolve)
    })
    return true
  }
  process.kill(pid, 'SIGTERM')
  return true
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { versionDir }
