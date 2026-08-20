/**
 * The config window: a small local HTTP server plus one page.
 *
 * A page rather than a native window because the thing being configured is
 * itself a browser application — the user ends up in a browser either way —
 * and because one implementation then works identically on Windows, macOS and
 * Linux. Packaging this into a double-clickable binary is a separate step
 * that adds no behaviour; see the README.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionDir } from './paths.js'
import {
  SOURCE_CHOICES, describePlugin, partitionPlugins, readConfig, removePlugin, upsertPlugin, writeConfig,
} from './config.js'
import { installRelease, isValidVersion, listReleases } from './registry.js'
import { userDshHome } from './paths.js'
import {
  adoptSessions, deleteSandbox, ensureSandbox, listSandboxes, mainDshRunning, suggestSandboxName,
} from './sandbox.js'
import { findFreePort, launch, stop } from './launch.js'
import { deleteVersion, downloadedVersions } from './versions.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The oldest release offered as a ready-made choice.
 *
 * Everything from here to whatever is newest on npm goes in the main row —
 * computed from the registry at runtime, never hardcoded, because releases
 * arrive faster than this file changes. Anything older is an early build:
 * still reachable, but folded away.
 */
export const OLDEST_FEATURED = '0.1.0-rc.6'

/** Running sandboxes, so the window can offer to stop them. */
const running = new Map()

/**
 * Long jobs the window watches instead of waiting on.
 *
 * Downloading a release takes about two minutes, and for most of that npm is
 * resolving the graph without writing anything, so a request that simply
 * blocks leaves the window with nothing to show and the user with no way to
 * tell work from failure. Each job keeps its own log, and the window polls.
 */
const jobs = new Map()

/**
 * Start a job and hand back its id immediately.
 *
 * Every line also lands in a file under `logs/`, because the window's copy
 * is gone after a refresh and a truncated ring buffer — while the question
 * "why did my launch with those two plugins die" is usually asked later,
 * about exactly the lines that scrolled away.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {string} label - what this job is, for the log file name.
 * @param {(log: (line: string) => void) => Promise<unknown>} work
 * @returns {string} the job id.
 */
function startJob(layout, label, work) {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = { id, state: 'running', lines: [], error: null, result: null }
  jobs.set(id, job)

  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
  const file = join(layout.root, 'logs', `${stamp}_${label.replace(/[^\w.-]+/g, '-')}.log`)
  mkdirSync(join(layout.root, 'logs'), { recursive: true })
  const persist = (line) => {
    try {
      appendFileSync(file, `${new Date().toISOString().slice(11, 19)} ${line}\n`)
    } catch {
      // A log that cannot be written must not take the job down with it.
    }
  }

  const log = (line) => {
    persist(line)
    job.lines.push(line)
    if (job.lines.length > 200) job.lines.shift()
  }
  work(log).then(
    (result) => { job.result = result; job.state = 'done'; persist('完成') },
    (error) => { job.error = error.message; job.state = 'failed'; log(`失败:${error.message}`) },
  )
  // Finished jobs are kept a while so a slow poll still sees the outcome.
  setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref?.()
  return id
}

/**
 * The window's own preferred port. Fixed rather than OS-chosen so that the
 * address survives a restart — an OS-chosen port changes every time, and
 * every open tab and bookmark dies with it.
 */
export const UI_PORT = 10130

/**
 * Start the config window.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {object} [options]
 * @param {number} [options.port] - 0 picks the first free port from {@link UI_PORT}.
 * @param {boolean} [options.open] - launch the browser.
 * @returns {Promise<void>} resolves when the server closes.
 */
export async function serve(layout, { port = 0, open = true } = {}) {
  if (port === 0) port = await findFreePort({ from: UI_PORT })
  const server = createServer((request, response) => {
    handle(layout, request, response).catch((error) => {
      json(response, 500, { error: error.message })
    })
  })
  // When this process is told to stop, the sandboxes it started must not
  // outlive it as orphans nobody can see. On Windows the desktop shell uses
  // a tree kill and this handler never fires; on mac and Linux a plain
  // SIGTERM is all the shell sends, and this is what makes it sufficient.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      for (const entry of running.values()) await stop(entry.pid).catch(() => {})
      process.exit(0)
    })
  }
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`
      console.log(`\n  配置窗地址 ${url}\n`)
      if (open) openBrowser(url)
    })
    server.once('close', resolve)
  })
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function handle(layout, request, response) {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return void response.end(readFileSync(join(HERE, 'ui', 'index.html')))
  }
  if (url.pathname === '/api/state') return json(response, 200, await state(layout))
  if (url.pathname === '/api/job') {
    const job = jobs.get(url.searchParams.get('id'))
    if (job === undefined) return json(response, 404, { error: '没有这个任务(可能已过期)' })
    return json(response, 200, { state: job.state, lines: job.lines, error: job.error, result: job.result })
  }
  if (request.method !== 'POST') return json(response, 404, { error: '找不到' })

  const body = await readJson(request)
  switch (url.pathname) {
    case '/api/pull': return json(response, 200, { jobId: startJob(layout, `pull-${body.version}`, (log) => pull(layout, body, log)) })
    case '/api/source': return json(response, 200, setSource(layout, body))
    case '/api/open': return json(response, 200, openLocal(body))
    case '/api/version/delete': return json(response, 200, { jobId: startJob(layout, `drop-${body.version}`, (log) => dropVersion(layout, body, log)) })
    case '/api/plugin/add': return json(response, 200, addPlugin(layout, body))
    case '/api/plugin/remove': return json(response, 200, dropPlugin(layout, body))
    case '/api/start': return json(response, 200, { jobId: startJob(layout, `start-${body.sandbox || 'new'}`, (log) => start(layout, body, log)) })
    case '/api/main/start': return json(response, 200, { jobId: startJob(layout, 'start-main', (log) => startMain(layout, body, log)) })
    case '/api/stop': return json(response, 200, await halt(body))
    case '/api/sandbox/delete': return json(response, 200, dropSandbox(layout, body))
    case '/api/sandbox/adopt': return json(response, 200, await adoptSessions(layout, String(body.name ?? '')))
    default: return json(response, 404, { error: '找不到' })
  }
}

/**
 * The last answer from npm, kept a minute. The window polls state to keep
 * its running list fresh, and that poll must not become an npm request each
 * time.
 */
let releases = { at: 0, data: null }

/**
 * Everything the window needs to draw itself.
 * @param {import('./paths.js').BoxLayout} layout
 */
async function state(layout) {
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
    downloaded: downloadedVersions(layout),
    featured: cut === -1 ? [] : available.slice(0, cut + 1),
    older: cut === -1 ? [] : available.slice(cut + 1),
    available,
    tags,
    source: config.source,
    plugins: live,
    missingPlugins: missing,
    sandboxes: listSandboxes(layout),
    suggestedName: suggestSandboxName(layout),
    last: config.last,
    running: [...running.values()].map(({ child, ...rest }) => rest),
  }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{version: string}} body
 */
async function pull(layout, body, log) {
  const version = String(body.version ?? '').trim()
  if (!isValidVersion(version)) throw new Error(`「${version}」不是版本号`)
  const dir = versionDir(layout, version)
  mkdirSync(dir, { recursive: true })
  const report = await installRelease(dir, version, { onLog: log, source: readConfig(layout).source })
  return { version, packages: report.checked }
}

/**
 * Open a local sandbox URL in the system's default browser.
 *
 * Exists for the desktop shell: its webview has no tabs, so an ordinary
 * `target="_blank"` link silently does nothing there. The page routes link
 * clicks here instead, which lands the user in a real browser in both
 * worlds. Only loopback http URLs are accepted — this endpoint must not be
 * a general-purpose "open anything" lever.
 * @param {{url: string}} body
 */
function openLocal(body) {
  const url = String(body.url ?? '')
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}\/?$/.test(url)) throw new Error('只开本机沙箱地址')
  openBrowser(url)
  return { ok: true }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{version: string}} body
 * @param {(line: string) => void} log
 */
async function dropVersion(layout, body, log) {
  const version = String(body.version ?? '').trim()
  if (!isValidVersion(version)) throw new Error(`「${version}」不是版本号`)
  for (const entry of running.values()) {
    if (entry.version === version) throw new Error(`「${entry.sandbox}」正用着 ${version},先停掉它再删`)
  }
  await deleteVersion(layout, version, log)
  return { version }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{source: string}} body
 */
function setSource(layout, body) {
  const source = String(body.source ?? '')
  if (!SOURCE_CHOICES.includes(source)) throw new Error(`没有叫「${source}」的安装源`)
  writeConfig(layout, { ...readConfig(layout), source })
  releases = { at: 0, data: null } // the version list may differ per source
  return { source }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{dir: string, id?: string}} body
 */
function addPlugin(layout, body) {
  const plugin = describePlugin(String(body.dir ?? ''), { id: body.id })
  writeConfig(layout, upsertPlugin(readConfig(layout), plugin))
  return { plugin }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{id: string}} body
 */
function dropPlugin(layout, body) {
  writeConfig(layout, removePlugin(readConfig(layout), String(body.id ?? '')))
  return { ok: true }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{version: string, sandbox?: string, brandNew?: boolean, plugins?: string[], importSignIn?: boolean, workspace?: string}} body
 */
async function start(layout, body, log) {
  const config = readConfig(layout)
  const version = String(body.version ?? '')
  if (!isValidVersion(version)) throw new Error('先选一个版本')

  const name = body.brandNew === true ? suggestSandboxName(layout) : String(body.sandbox ?? '').trim()
  if (name === '') throw new Error('给沙箱起个名字')

  const wanted = new Set(Array.isArray(body.plugins) ? body.plugins : [])
  const chosen = partitionPlugins(config).live.filter((p) => wanted.has(p.id))
  const importSignIn = body.importSignIn !== false

  const workspace = String(body.workspace ?? '').trim()
  const { info, created, signInImported } = ensureSandbox(layout, name, { importSignIn })
  log(`沙箱「${info.name}」${created ? '已新建' : '已复用'}${signInImported ? ',登录已导入' : ''}`)
  if (chosen.length === 0) log('没勾额外插件:这是纯官方的 dsh')
  const result = await launch({
    layout,
    sandbox: info.name,
    version,
    plugins: chosen,
    workspace: workspace === '' ? undefined : workspace,
    onLog: log,
  })

  running.set(result.pid, {
    pid: result.pid, port: result.port, url: result.url, sandbox: info.name, version, child: result.child,
  })
  result.child.once('exit', () => running.delete(result.pid))

  writeConfig(layout, {
    ...config,
    last: {
      version,
      sandbox: info.name,
      plugins: chosen.map((p) => p.id),
      importSignIn,
      workspace,
    },
  })
  return { url: result.url, pid: result.pid, sandbox: info.name, created, signInImported }
}

/**
 * Boot the user's real dsh home — no sandbox — with the ticked plugins.
 *
 * This exists to answer one question a sandbox cannot: what does a plugin
 * look like inside the environment someone actually lives in, with their
 * real conversations, settings and patches around it. The plugins ride on a
 * per-launch `--patch`, so a normally started dsh is not affected by having
 * used this entry. Refused while a dsh already serves on its default port:
 * two processes writing one home is how storage files get corrupted.
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{version: string, plugins?: string[], workspace?: string}} body
 * @param {(line: string) => void} log
 */
async function startMain(layout, body, log) {
  const config = readConfig(layout)
  const version = String(body.version ?? '')
  if (!isValidVersion(version)) throw new Error('先选一个版本')
  if (await mainDshRunning()) throw new Error('主环境已经开着一台(端口 3080),先关掉它再从这里启动')
  if ([...running.values()].some((entry) => entry.main === true)) {
    throw new Error('主环境已经从这里启动过一台了,在「正在运行」里停掉它先')
  }

  const wanted = new Set(Array.isArray(body.plugins) ? body.plugins : [])
  const chosen = partitionPlugins(config).live.filter((p) => wanted.has(p.id))
  const workspace = String(body.workspace ?? '').trim()
  log(`用 ${version} 启动主环境(非沙箱)${chosen.length > 0 ? `,附加 ${chosen.length} 个插件(仅本次启动生效)` : ''}`)

  const result = await launch({
    layout,
    home: userDshHome(),
    version,
    plugins: chosen,
    workspace: workspace === '' ? undefined : workspace,
    onLog: log,
  })
  running.set(result.pid, {
    pid: result.pid, port: result.port, url: result.url, sandbox: '主环境', version, main: true, child: result.child,
  })
  result.child.once('exit', () => running.delete(result.pid))
  return { url: result.url, pid: result.pid }
}

/**
 * @param {{pid: number}} body
 */
async function halt(body) {
  const pid = Number(body.pid)
  await stop(pid)
  running.delete(pid)
  return { ok: true }
}

/**
 * @param {import('./paths.js').BoxLayout} layout
 * @param {{name: string}} body
 */
function dropSandbox(layout, body) {
  deleteSandbox(layout, String(body.name ?? ''))
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
    spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    // Opening a browser is a convenience; the URL is printed either way.
  }
}
