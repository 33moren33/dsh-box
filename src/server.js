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
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { versionDir } from './paths.js'
import {
  SOURCE_CHOICES, describePlugin, partitionPlugins, readConfig, removePlugin, upsertPlugin, writeConfig,
} from './config.js'
import { installRelease, isValidVersion, listReleases } from './registry.js'
import {
  adoptSessions, deleteSandbox, ensureSandbox, listSandboxes, suggestSandboxName,
} from './sandbox.js'
import { findFreePort, launch, stop } from './launch.js'
import { downloadedVersions } from './versions.js'

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
 * @param {(log: (line: string) => void) => Promise<unknown>} work
 * @returns {string} the job id.
 */
function startJob(work) {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = { id, state: 'running', lines: [], error: null, result: null }
  jobs.set(id, job)
  const log = (line) => {
    job.lines.push(line)
    if (job.lines.length > 200) job.lines.shift()
  }
  work(log).then(
    (result) => { job.result = result; job.state = 'done' },
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
    case '/api/pull': return json(response, 200, { jobId: startJob((log) => pull(layout, body, log)) })
    case '/api/source': return json(response, 200, setSource(layout, body))
    case '/api/plugin/add': return json(response, 200, addPlugin(layout, body))
    case '/api/plugin/remove': return json(response, 200, dropPlugin(layout, body))
    case '/api/start': return json(response, 200, { jobId: startJob((log) => start(layout, body, log)) })
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
