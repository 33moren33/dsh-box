/**
 * Downloading official dsh releases from npm, pinned so that the version you
 * asked for is the version you actually get.
 *
 * The whole module exists because of one npm behaviour. `@deepseek-ai/dsh`
 * declares its sixty-odd sibling packages as `^0.1.0-rc.N`, and under semver
 * that range is `>=0.1.0-rc.N <0.2.0` — every newer release candidate falls
 * inside it. So `npm install @deepseek-ai/dsh@0.1.0-rc.6` installs the rc.6
 * launcher on top of the newest plugin layer npm can find. The result looks
 * completely healthy and is completely wrong.
 *
 * The fix is to pin every package explicitly. To do that we need the exact
 * list of packages that belong to a given release, which is what
 * {@link resolveReleaseClosure} computes by walking the registry.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The one package every dsh release is rooted at. */
export const ROOT_PACKAGE = '@deepseek-ai/dsh'

/**
 * Only packages under this prefix share the release version number. The
 * framework packages (`@deepseek-ai/cordis`, `@deepseek-ai/cordis-plugin-*`)
 * are versioned independently and must be left to npm to resolve.
 */
const RELEASE_PREFIX = '@deepseek-ai/dsh'

/**
 * The two places a release can be downloaded from.
 *
 * The official registry is authoritative but hard to reach from some networks
 * in China without a proxy; npmmirror is the de-facto public mirror there and
 * needs no account. Nothing else is offered: a person who runs a private
 * corporate registry knows how to configure npm themselves and is not who
 * this tool is for.
 */
export const SOURCES = {
  official: 'https://registry.npmjs.org',
  mirror: 'https://registry.npmmirror.com',
}

const REGISTRY = SOURCES.official

/**
 * The one probe result worth remembering. 'auto' is asked on every window
 * refresh, and re-measuring the network each time would turn the state poll
 * into a network benchmark.
 */
let autoChoice = null

/**
 * Turn a source choice into a registry URL.
 *
 * 'auto' measures one small request against both registries and keeps the
 * faster one that answered. The measurement happens once per process; picking
 * a source explicitly always bypasses the memo.
 * @param {string} [source] - 'auto', 'official' or 'mirror'.
 * @param {(line: string) => void} [onLog]
 * @returns {Promise<string>} the registry base URL.
 */
export async function resolveSource(source, onLog) {
  if (source === 'official') return SOURCES.official
  if (source === 'mirror') return SOURCES.mirror
  if (autoChoice !== null) return autoChoice
  const probePath = `/${encodeURIComponent(ROOT_PACKAGE)}`
  const [official, mirror] = await Promise.all([
    timeRequest(SOURCES.official + probePath),
    timeRequest(SOURCES.mirror + probePath),
  ])
  if (official === null && mirror === null) {
    throw new Error('官方 npm 和中国镜像都连不上——请检查网络,或稍后再试')
  }
  const useMirror = official === null || (mirror !== null && mirror < official)
  autoChoice = useMirror ? SOURCES.mirror : SOURCES.official
  onLog?.(useMirror
    ? `自动选源:中国镜像更快(${mirror} 毫秒${official === null ? ',官方源不通' : ` vs 官方 ${official} 毫秒`})`
    : `自动选源:官方 npm(${official} 毫秒${mirror === null ? ',镜像不通' : ` vs 镜像 ${mirror} 毫秒`})`)
  return autoChoice
}

/**
 * Refuse anything that is not an official release coordinate. The version
 * box in the config window accepts free text so that early builds stay
 * reachable, and free text reaching a shell is how command injection starts.
 * @param {string} version - candidate version string.
 * @returns {boolean}
 */
export function isValidVersion(version) {
  return typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/.test(version.trim())
}

/**
 * Fetch one package manifest at one exact version.
 * @param {string} name - package name.
 * @param {string} version - exact version.
 * @param {string} registry - registry base URL.
 * @returns {Promise<object | null>} the manifest, or null when that package
 * does not exist at that version — which is how a package that joined the
 * project in a later release is recognized and skipped.
 */
async function fetchManifest(name, version, registry) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`查 ${name}@${version} 时 npm 返回 ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

/**
 * List the official releases, newest first, with their npm dist-tags.
 * @param {object} [options]
 * @param {string} [options.source] - registry source choice.
 * @returns {Promise<{versions: string[], tags: Record<string, string>}>}
 */
export async function listReleases({ source } = {}) {
  const registry = await resolveSource(source)
  const response = await fetch(`${registry}/${encodeURIComponent(ROOT_PACKAGE)}`)
  if (!response.ok) throw new Error(`连不上 npm:仓库返回 ${response.status}`)
  const packument = await response.json()
  const times = packument.time ?? {}
  const versions = Object.keys(packument.versions ?? {})
    .sort((a, b) => Date.parse(times[b] ?? 0) - Date.parse(times[a] ?? 0))
  return { versions, tags: packument['dist-tags'] ?? {}, times }
}

/**
 * Walk the release's dependency graph and collect every package that carries
 * the release version number.
 *
 * Each package is fetched at the exact target version rather than at its
 * declared range. A package that does not answer at that version did not
 * exist in that release, so it drops out of the closure on its own — which is
 * what keeps the pin list correct across releases that add or remove packages.
 * @param {string} version - exact release version.
 * @param {object} [options]
 * @param {number} [options.concurrency] - parallel registry requests.
 * @param {(done: number, queued: number) => void} [options.onProgress]
 * @param {string} [options.registry] - registry base URL.
 * @returns {Promise<string[]>} sorted package names belonging to the release.
 */
export async function resolveReleaseClosure(version, { concurrency = 12, onProgress, registry = REGISTRY } = {}) {
  if (!isValidVersion(version)) throw new Error(`不是合法的版本号:${version}`)
  const found = new Set()
  const seen = new Set([ROOT_PACKAGE])
  const pending = [ROOT_PACKAGE]
  let done = 0
  let busy = 0

  // Workers must outlive a momentarily empty queue: the graph starts as a
  // single root, and a worker that exited on "nothing to do" would leave one
  // worker to fetch the whole release one package at a time. A worker only
  // stops once the queue is empty AND no peer is still fetching, because only
  // then can no further work appear.
  async function worker() {
    for (;;) {
      const name = pending.shift()
      if (name === undefined) {
        if (busy === 0) return
        await new Promise((r) => setTimeout(r, 15))
        continue
      }
      busy += 1
      try {
        const manifest = await fetchManifest(name, version, registry)
        done += 1
        onProgress?.(done, done + pending.length)
        if (manifest !== null) {
          found.add(name)
          const declared = { ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}) }
          for (const dep of Object.keys(declared)) {
            if (!dep.startsWith(RELEASE_PREFIX) || seen.has(dep)) continue
            seen.add(dep)
            pending.push(dep)
          }
        }
      } finally {
        busy -= 1
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  return [...found].sort()
}

/**
 * Build the `package.json` that installs one release with every member pinned.
 *
 * Pinning is done by naming every release package as a direct dependency at
 * its exact version, not through npm `overrides`. Both produce the same tree,
 * but overrides made npm recompute conflicting override sets across the whole
 * transitive graph — including the very large SDK dependencies dsh pulls in —
 * and the install did not finish. Direct dependencies need no such
 * computation: the exact version sits at the top level, it satisfies the
 * `^0.1.0-rc.N` range every sibling declares, and npm reuses it.
 *
 * This is the cheap route, not the certain one, so {@link installRelease}
 * always proves the result afterwards rather than assuming it.
 * @param {string} version - exact release version.
 * @param {string[]} closure - package names from {@link resolveReleaseClosure}.
 * @returns {object} the manifest to write.
 */
export function buildInstallManifest(version, closure) {
  const dependencies = { [ROOT_PACKAGE]: version }
  for (const name of closure) dependencies[name] = version
  return {
    name: `dsh-release-${version.replace(/[^0-9a-z.-]/gi, '-')}`,
    private: true,
    version: '0.0.0',
    description: 'One pinned DeepSeek Harness release, downloaded by dsh-box.',
    dependencies,
  }
}

/**
 * Read back what actually landed on disk.
 * @param {string} dir - a downloaded release directory.
 * @returns {Record<string, string>} installed version by package name.
 */
export function readInstalledVersions(dir) {
  const scope = join(dir, 'node_modules', '@deepseek-ai')
  if (!existsSync(scope)) return {}
  const out = {}
  for (const entry of readdirSync(scope)) {
    const manifest = join(scope, entry, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      out[`@deepseek-ai/${entry}`] = JSON.parse(readFileSync(manifest, 'utf8')).version
    } catch {
      // A package without a readable manifest cannot be checked; the verifier
      // below reports it as a mismatch rather than pretending it passed.
      out[`@deepseek-ai/${entry}`] = null
    }
  }
  return out
}

/**
 * @typedef {object} PinReport
 * @property {boolean} ok - true only when every release package is on `version`.
 * @property {number} checked - packages carrying the release version number.
 * @property {{name: string, found: string | null}[]} wrong - offenders.
 */

/**
 * Prove that the plugin layer really is the requested release.
 *
 * This is the acceptance test for the whole download path, and it must stay a
 * hard gate: an unpinned install produces a tree that behaves normally, boots
 * normally, and reports the requested version on the launcher — the mismatch
 * is only visible by reading the siblings' manifests.
 * @param {string} dir - a downloaded release directory.
 * @param {string} version - the version that was requested.
 * @returns {PinReport}
 */
export function verifyPinned(dir, version) {
  const installed = readInstalledVersions(dir)
  const wrong = []
  let checked = 0
  for (const [name, found] of Object.entries(installed)) {
    if (!name.startsWith(RELEASE_PREFIX)) continue
    checked += 1
    if (found !== version) wrong.push({ name, found })
  }
  return { ok: checked > 0 && wrong.length === 0, checked, wrong }
}

/**
 * Download one official release into its own directory.
 * @param {string} dir - target directory, created by the caller.
 * @param {string} version - exact release version.
 * @param {object} [options]
 * @param {(line: string) => void} [options.onLog]
 * @param {(done: number, queued: number) => void} [options.onProgress]
 * @param {string} [options.source] - registry source choice.
 * @returns {Promise<PinReport>} the verification result; installation is only
 * considered successful when it passes.
 */
export async function installRelease(dir, version, { onLog, onProgress, source } = {}) {
  if (!isValidVersion(version)) throw new Error(`不是合法的版本号:${version}`)
  let registry = await resolveSource(source, onLog)
  onLog?.(`正在向 npm 查 ${version} 包含哪些包`)
  let announced = 0
  const walk = (reg) => resolveReleaseClosure(version, {
    registry: reg,
    onProgress: (done, queued) => {
      onProgress?.(done, queued)
      // Every twentieth package, so the log moves without being a wall.
      if (done - announced >= 20) {
        announced = done
        onLog?.(`已查过 ${done} 个包(共约 ${queued} 个)`)
      }
    },
  })
  let closure = await walk(registry)
  // The mirror trails the official registry by minutes to hours after a
  // release. A version it has not synced yet must not read as "does not
  // exist" — that would be this tool lying about npm. Fall back loudly.
  if (closure.length === 0 && registry !== SOURCES.official) {
    onLog?.(`镜像上还没同步到 ${version},改用官方源再查一次`)
    registry = SOURCES.official
    closure = await walk(registry)
  }
  if (closure.length === 0) throw new Error(`npm 上没有叫 ${version} 的版本`)
  onLog?.(`${version} 共 ${closure.length} 个包,逐个钉死版本`)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(buildInstallManifest(version, closure), null, 2)}\n`)

  await runNpmInstall(dir, onLog, registry)

  const report = verifyPinned(dir, version)
  if (!report.ok) {
    const sample = report.wrong.slice(0, 5).map((w) => `${w.name}@${w.found ?? '读不出版本'}`).join('、')
    throw new Error(
      `钉版失败:${report.checked} 个包里有 ${report.wrong.length} 个不是 ${version}(${sample})。`
      + '装成这样会是几个版本混在一起,所以本次下载判为失败。',
    )
  }
  onLog?.(`已核对:${report.checked} 个包全部是 ${version}`)
  return report
}

/**
 * Run `npm install` and keep saying something while it works.
 *
 * npm is silent for the first minute or so: it resolves the whole dependency
 * graph before writing a single file, so the target folder stays empty and
 * the install looks dead. That silence is indistinguishable from a failure
 * unless something says otherwise, so a heartbeat reports elapsed time, the
 * current phase, and how many packages have actually landed.
 *
 * A failure carries npm's own last words. `execFile` would reject with a
 * message that says only which exit code came back, which is the least
 * useful half of what npm printed.
 * npm is told the registry explicitly rather than left to read `.npmrc`.
 * The closure above was resolved against one registry; letting npm resolve
 * against a different one configured on this machine would make the two
 * halves of the download disagree about what exists.
 * @param {string} dir - the release directory.
 * @param {(line: string) => void} [onLog]
 * @param {string} registry - registry base URL.
 * @returns {Promise<void>}
 */
async function runNpmInstall(dir, onLog, registry = REGISTRY) {
  const bypassProxy = await preferDirect(onLog, registry)
  const [command, ...args] = npmInvocation(['install', '--no-audit', '--no-fund', '--registry', registry])
  const started = Date.now()
  const errors = []
  onLog?.('正在执行 npm install。解析依赖期间磁盘上不会有变化,解析完才开始落包。')

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: dir, windowsHide: true, env: npmEnv(bypassProxy, registry) })

    const beat = setInterval(() => {
      const seconds = Math.round((Date.now() - started) / 1000)
      const landed = Object.keys(readInstalledVersions(dir)).length
      onLog?.(landed === 0
        ? `npm 仍在解析依赖,已 ${seconds} 秒(这个阶段磁盘上看不到变化,属正常)`
        : `npm 正在写入,已 ${seconds} 秒,已落盘 ${landed} 个包`)
    }, 5000)

    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const text = line.trim()
          if (text === '') continue
          errors.push(text)
          if (errors.length > 40) errors.shift()
          if (/^npm (error|warn)/i.test(text) || /^added |^changed |^removed /.test(text)) onLog?.(text)
        }
      })
    }

    child.once('error', (error) => {
      clearInterval(beat)
      reject(new Error(`起不了 npm:${error.message}。请确认 npm 已安装并在 PATH 里。`))
    })

    child.once('close', (code) => {
      clearInterval(beat)
      if (code === 0) return resolve()
      const tail = errors.slice(-12).join('\n')
      reject(new Error(`npm install 失败(退出码 ${code})。npm 最后的输出:\n${tail}`))
    })
  })
}

/**
 * The environment npm runs in.
 *
 * npm honours `HTTPS_PROXY`, and on a machine running a local proxy that
 * variable is usually set for everything. Reaching the npm registry through
 * one is measurably worse than reaching it directly — three times the
 * latency, and connections that occasionally fail outright — and npm makes
 * thousands of small requests while resolving, so the difference is minutes,
 * not milliseconds.
 *
 * Going direct is not a gamble here: the release closure is resolved first,
 * over a direct connection, and if that had failed there would be nothing to
 * install. Direct reachability is therefore already proven by the time npm
 * starts. Only the registry host is excluded; anything else npm reaches keeps
 * whatever proxy the user configured.
 * @returns {NodeJS.ProcessEnv}
 */
function npmEnv(bypassProxy, registry = REGISTRY) {
  if (!bypassProxy) return { ...process.env }
  const host = new URL(registry).host
  const existing = process.env.NO_PROXY ?? process.env.no_proxy ?? ''
  const merged = existing === '' ? host : `${existing},${host}`
  return { ...process.env, NO_PROXY: merged, no_proxy: merged }
}

/**
 * Decide whether npm should reach the registry directly or through the
 * proxy the machine is configured to use.
 *
 * There is no answer that is right everywhere. Outside a restricted network
 * direct is simply correct. Behind a local proxy, direct is often several
 * times faster and drops fewer connections — but on a network where the
 * registry is unreachable without the proxy, going direct does not make the
 * download slow, it makes it impossible. Picking either one in advance
 * would be choosing on behalf of a machine we have never seen.
 *
 * So both are timed, once, on one small request, and the winner is used.
 * @param {(line: string) => void} [onLog]
 * @param {string} [registry] - registry base URL.
 * @returns {Promise<boolean>} whether to bypass the proxy.
 */
export async function preferDirect(onLog, registry = REGISTRY) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
  if (proxy === '') return true
  const probe = `${registry}/${encodeURIComponent(ROOT_PACKAGE)}`
  const direct = await timeRequest(probe)
  if (direct === null) {
    onLog?.('直连 npm 不通,改走你系统里配置的代理')
    return false
  }
  onLog?.(`直连 npm 用时 ${direct} 毫秒,下载走直连(绕开代理,只对 npm 这一个域名生效)`)
  return true
}

/**
 * @param {string} url
 * @returns {Promise<number | null>} milliseconds, or null when unreachable.
 */
async function timeRequest(url) {
  const started = Date.now()
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    return response.ok ? Date.now() - started : null
  } catch {
    return null
  }
}

/**
 * Build the argv for running npm.
 *
 * On Windows npm is a batch file, and Node refuses to spawn one directly
 * since the fix for batch-file argument injection. The usual workaround is
 * `shell: true`, but that concatenates arguments into a command line — safe
 * for the fixed flags used here, unsafe the moment anyone adds a value that
 * came from a user. Going through `cmd.exe /c` with a real argument vector
 * keeps arguments separate, so this stays correct if the argument list ever
 * grows.
 * @param {string[]} args - npm arguments.
 * @returns {string[]} command followed by its arguments.
 */
export function npmInvocation(args) {
  return process.platform === 'win32' ? ['cmd.exe', '/c', 'npm', ...args] : ['npm', ...args]
}
