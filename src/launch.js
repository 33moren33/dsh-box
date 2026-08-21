/**
 * Starting one sandbox: pick a port, write the plugin overlay, boot the
 * chosen release, and only report success once the thing is genuinely up.
 */

import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { cleanPath, sandboxPaths, versionDir, versionEntry } from './paths.js'
import {
  clearModuleFallback, clearRunning, noteBoot, noteRunning, runningRecord, switchesRelease,
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
  throw new Error(`在 ${from} 到 ${from + tries} 之间找不到空闲端口`)
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
 * Write the patch overlay that adds the chosen plugins.
 *
 * This is an overlay, not a replacement. dsh composes its plugin list as
 * bundle layers, then the profile's own patch file, then the machine-wide
 * one, then each `--patch` in argument order — so everything official stays
 * exactly where it was and these entries are added on top. An empty selection
 * writes no file at all and the sandbox boots as plain official dsh.
 * @param {string} file - where to write the overlay.
 * @param {PluginChoice[]} plugins
 * @returns {string | null} the file path, or null when nothing was selected.
 */
export function writePluginOverlay(file, plugins) {
  if (plugins.length === 0) return null
  const lines = [
    '# Written by dsh-box for one launch. Applied on top of the official',
    '# layers, so nothing official is replaced by its presence.',
    '- insert:',
  ]
  for (const plugin of plugins) {
    lines.push(`    - id: ${JSON.stringify(plugin.id)}`)
    lines.push(`      name: ${JSON.stringify(plugin.package)}`)
  }
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

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
    if (existsSync(target) || lstatSafe(target) !== null) rmSync(target, { recursive: true, force: true })
    // `junction` is the one link type Windows creates without elevation, and
    // it behaves like a directory symlink for resolution purposes.
    symlinkSync(cleanPath(plugin.path), target, 'junction')
    linked.push(plugin.package)
  }
  return linked
}

/**
 * Which of the chosen plugins this home already loads on its own.
 *
 * "Loads on its own" means: named in one of the patch files dsh reads
 * automatically — the home-wide one and the profile's own. Detection is a
 * plain text search for the package name, which can over-match (a name in a
 * comment) but the cost of that is only a plugin not being added twice —
 * the exact outcome wanted. The launcher's own overlay file is not
 * consulted: it is rewritten on every launch and rides `--patch`, so it is
 * never "already installed".
 * @param {string} home
 * @param {string} profile
 * @param {PluginChoice[]} plugins
 * @returns {PluginChoice[]} the ones already present.
 */
export function pluginsAlreadyInHome(home, profile, plugins) {
  if (plugins.length === 0) return []
  const text = [join(home, 'cordis.patch.yml'), join(home, 'profiles', profile, 'cordis.patch.yml')]
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  if (text === '') return []
  return plugins.filter((plugin) => text.includes(plugin.package))
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
 * @property {number} port
 * @property {string} url
 * @property {import('node:child_process').ChildProcess} child
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
 * @param {string} options.version - release to boot.
 * @param {PluginChoice[]} [options.plugins]
 * @param {string} [options.profile]
 * @param {string} [options.workspace] - directory dsh treats as the workspace.
 * @param {(line: string) => void} [options.onLog]
 * @returns {Promise<LaunchResult>}
 */
export async function launch({
  layout, sandbox, home, version, plugins = [], profile = 'web', workspace, onLog,
}) {
  const entry = versionEntry(layout, version)
  if (!existsSync(entry)) throw new Error(`版本 ${version} 还没下载`)

  const direct = home !== undefined
  if (!direct) {
    // One home, one dsh. Two instances on the same filing cabinet stomp on
    // each other's session files — the same class of damage as the 08-18
    // incident where a half-written session blocked a home from loading at
    // all. The ledger lives on disk and is verified against a live process,
    // so every entrance (window, CLI, agent) sees the same answer.
    const running = runningRecord(layout, sandbox)
    if (running !== null) {
      throw new Error(
        `沙箱「${sandboxPaths(layout, sandbox).name}」已经开着:${running.url}(进程 ${running.pid})。`
        + '同一个沙箱同时只能跑一台,两台会互踩同一份档案柜——要并行就换个沙箱,要重启就先停掉它',
      )
    }
    home = sandboxPaths(layout, sandbox).home
  }
  if (direct || switchesRelease(layout, sandbox, version)) {
    // Boot re-points the flat module fallback for every package the running
    // release knows about, and leaves alone any link naming a package that
    // release has never heard of. On a normal machine those links dangle
    // harmlessly because the other installation is gone. Here every release
    // is kept side by side, so such a link still resolves — to the wrong
    // release. Between rc.6 and rc.8 that is eleven packages. A directly
    // booted home is cleared every time, because what last touched it is
    // unknown to us; boot rebuilds the whole directory either way.
    if (clearModuleFallback(home)) onLog?.('已清掉可能指错版本的模块链接,启动时会重建')
  }

  // A home is not a blank sheet — the real ~/.dsh in particular already has
  // plugins written into its own patch files. Adding one of those again
  // registers the same adapter twice, and dsh answers by refusing to load
  // the entire plugin tree (DUPLICATE_ADAPTER, exit 1) — found the hard way
  // on a main-environment launch. Already-present plugins are skipped, and
  // said out loud so the "why wasn't it added twice" question answers itself.
  const present = pluginsAlreadyInHome(home, profile, plugins)
  for (const plugin of present) {
    onLog?.(`「${plugin.package}」这个环境里已经装着,跳过——装两份会让 dsh 拒绝启动`)
  }
  const adding = plugins.filter((plugin) => !present.includes(plugin))

  const linked = linkPlugins(home, profile, adding)
  if (linked.length > 0) onLog?.(`已把 ${linked.length} 个插件包链接进${direct ? '主环境(退出时会清走)' : '沙箱'}`)

  // The overlay for a directly booted home lives in our own data directory,
  // not in that home: the real ~/.dsh is someone's daily environment, and a
  // launcher that scatters files into it is exactly the coupling this tool
  // exists to prevent. Sandbox homes are ours, so theirs stays put.
  const overlay = writePluginOverlay(
    direct ? join(layout.root, 'main.clean-boot.patch.yml') : join(home, 'clean-boot.patch.yml'),
    adding,
  )
  // 3080 belongs to the user's real dsh; sandboxes hunt from their own base
  // so an idle 3080 is never squatted by something that only looks like it.
  const port = await findFreePort({ from: direct ? PREFERRED_PORT : SANDBOX_PORT })

  const args = ['--profile', profile]
  if (overlay !== null) args.push('--patch', overlay)
  args.push('--port', String(port))

  onLog?.(`正在启动 ${version},端口 ${port}`)
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: cleanPath(workspace ?? process.cwd()),
    // DSH_HOME decides which filing cabinet dsh opens. It is trimmed because
    // it can arrive from a text field or a drag-and-drop, where a trailing
    // space survives and turns into a different directory.
    env: { ...process.env, DSH_HOME: cleanPath(home) },
    windowsHide: true,
  })

  child.stdout?.on('data', (chunk) => onLog?.(String(chunk).trimEnd()))
  child.stderr?.on('data', (chunk) => onLog?.(String(chunk).trimEnd()))

  if (direct && linked.length > 0) {
    // Links planted in a real home are cleaned up when that dsh exits.
    // Best-effort: if the launcher dies first the links stay — inert, since
    // nothing loads a plugin that no patch names — but tidy is the default.
    child.once('exit', () => {
      for (const name of linked) {
        try {
          rmSync(join(home, 'profiles', profile, 'node_modules', ...name.split('/')), { recursive: true, force: true })
        } catch {
          // Leaving a dangling link beats crashing an exit handler.
        }
      }
    })
  }

  await waitUntilServing(port, child, onLog)
  const url = `http://127.0.0.1:${port}`
  if (!direct) {
    noteBoot(layout, sandbox, version)
    noteRunning(layout, sandbox, { pid: child.pid, port, url, version })
    // Best-effort: when the launcher lives long enough to see dsh exit, the
    // ledger is cleared at once. A launcher killed outright leaves the entry
    // behind — harmless, because every reader verifies the pid before
    // believing it and deletes what proves dead.
    child.once('exit', () => clearRunning(layout, sandbox, child.pid))
  }
  return { pid: child.pid, port, url, child }
}

/**
 * Wait until the sandbox is actually usable.
 *
 * An open port proves nothing: the web server starts listening the moment its
 * own fiber activates, while the rest of the plugin tree is still loading,
 * and until the frontend claims the fallback route every request is answered
 * 404. Even a 200 is not enough, because the page is only complete once the
 * client-modules plugin has injected the boot manifest into it. So readiness
 * is defined as: the index response carries the boot manifest, and the
 * process is still alive a moment later — a tree that fails late exits after
 * having served a page.
 * @param {number} port
 * @param {import('node:child_process').ChildProcess} child
 * @param {(line: string) => void} [onLog]
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<void>}
 */
export async function waitUntilServing(port, child, onLog, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let exited = null
  child.once('exit', (code) => { exited = code ?? 0 })

  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`dsh 还没启动完就退出了,退出码 ${exited}`)
    if (await servesBootManifest(port)) {
      // A plugin tree that throws during a later stage can take the process
      // down after the page is already being served, which is exactly the
      // failure a port check reports as success.
      await sleep(1500)
      if (exited !== null) throw new Error(`dsh 服务完页面之后退出了,退出码 ${exited}`)
      onLog?.('已就绪:页面带着启动清单,且进程稳定')
      return
    }
    await sleep(400)
  }
  throw new Error(`dsh 在 ${Math.round(timeoutMs / 1000)} 秒内没有启动完成`)
}

/** The marker the host injects into the index page once the client graph is composed. */
const BOOT_MARKER = '__DSH_BOOT__'

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function servesBootManifest(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'follow' })
    if (!response.ok) return false
    return (await response.text()).includes(BOOT_MARKER)
  } catch {
    return false
  }
}

/**
 * Stop a sandbox by process id.
 *
 * Named explicitly rather than matched by command line: a pattern like
 * "anything mentioning dsh" also matches the user's own running dsh, and
 * killing that is not a recoverable mistake.
 * @param {number} pid
 * @returns {Promise<void>}
 */
export async function stop(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`拒绝停止进程号 ${pid}`)
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      // The launcher starts a tree; /T reaches the children it spawned.
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).once('exit', resolve)
    })
    return
  }
  process.kill(pid, 'SIGTERM')
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { versionDir }
