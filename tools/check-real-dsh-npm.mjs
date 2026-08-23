/**
 * The whole npm chain, on the real machine: download from the real registry,
 * boot the real dsh, see the plugin in the real page, take it all back out.
 *
 * ⛔⛔ **Not part of `npm test`, and further outside it than `check-real-dsh`:**
 * this one reaches the network (about 39MB / ~390 packages for the aggregate it
 * installs) and starts the dsh installed on this machine. Opt-in only.
 *
 * What it proves that nothing offline can: the farm road end to end —
 * `plugins install` fetches into our store, `start` re-points the sandbox's
 * junction at the host engine's farm, and the **served page** carries the
 * plugin's own client bundles, which means every one of the aggregate's
 * `@deepseek-ai/*` imports resolved against the running installation.
 *
 * ⭐ The exit criterion is byte honesty: after `stop` and `uninstall`, the
 * sandbox's patch file hashes identical to the moment before the install.
 *
 * ⚠️ Never touches the real `~/.dsh`; the sandbox is started with
 * `--no-sign-in`, so no credentials are copied and nothing can spend a token.
 * All child output is appended to a log file; on failure its tail is printed
 * and the directory is left in place for inspection.
 *
 * Usage: node tools/check-real-dsh-npm.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectHostDsh } from '../src/host.js'
import { boxLayout, ensureBox, removeTree } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-real-dsh-npm.mjs <一次性目录>')
  process.exit(2)
}

const host = detectHostDsh()
if (!host.found) {
  console.error('这台机器上没有装好的 dsh —— 这一套要的就是真的那一台,不跑')
  process.exit(2)
}

removeTree(root)
const box = join(root, 'data')
ensureBox(box)
const layout = boxLayout(box)
const logFile = join(root, 'run.log')

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * Run the real command line; everything it says lands in the log file, and the
 * last JSON line comes back. No timeout of our own on the download — npm is
 * the slow part and killing it half-way would leave nothing worth asserting.
 */
function cli(...argv) {
  return new Promise((done) => {
    appendFileSync(logFile, `\n$ dsh-box ${argv.join(' ')}\n`)
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      appendFileSync(logFile, String(chunk))
    })
    child.stderr.on('data', (chunk) => appendFileSync(logFile, String(chunk)))
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        done(JSON.parse(line))
      } catch {
        done({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
}

/** The last few lines of the run log, for a failure a person can act on. */
function logTail(lines = 25) {
  try {
    return readFileSync(logFile, 'utf8').split(/\r?\n/).filter((one) => one.trim() !== '').slice(-lines)
  } catch {
    return []
  }
}

const sha = (text) => createHash('sha256').update(text).digest('hex')
const seconds = (ms) => `${Math.round(ms / 100) / 10}s`

const PACKAGE = '@linxin666/dsh-web-ui-all'
const SANDBOX = 'realnpm'
const home = join(layout.sandboxes, SANDBOX, 'home')
const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')

console.log(`\n真 npm、真 dsh、真页面:一条链走到头再退回原点(dsh ${host.version})\n`)

// The file a new sandbox actually gets: dsh's own default, ending in `[]`.
// Written before anything else so "回到装前" is a hash of real bytes, not of an
// absence — and so the `[]` absorption is exercised on the real chain too.
const dshDefault = '# Your patch layer for this dsh profile, applied after every bundle layer:\n'
  + '# a top-level YAML array of loader patch entries (id-targeted config\n'
  + '# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n'
mkdirSync(dirname(patch), { recursive: true })
writeFileSync(patch, dshDefault)
const hashBefore = sha(readFileSync(patch, 'utf8'))

// 1. Download for real. Minutes, not seconds — that is the deal.
const t0 = Date.now()
const installed = await cli('plugins', 'install', PACKAGE, '--sandbox', SANDBOX)
const installTook = Date.now() - t0
const storeRoot = join(box, 'packages', 'node_modules')
const storeCount = (() => {
  try {
    let count = 0
    for (const entry of readdirSync(storeRoot)) {
      if (entry === '.bin' || entry === '.package-lock.json') continue
      if (entry.startsWith('@')) count += readdirSync(join(storeRoot, entry)).length
      else count += 1
    }
    return count
  } catch {
    return 0
  }
})()
check(`⭐ 真联网装 ${PACKAGE} 进沙箱(${seconds(installTook)},store 平铺 ${storeCount} 个包)`,
  installed.ok === true, installed.code ?? installed.message ?? 'ok')
check('聚合包整个家族都进了账', (installed.brought ?? []).length > 1,
  `${(installed.brought ?? []).length} 个成员`)

// 2. Boot the real dsh on it, signed out. `start` itself waits until the page
//    carries the boot manifest, so `ok:true` already means "served, not merely
//    listening" — the fetch below re-verifies from outside the tool.
const t1 = Date.now()
const started = await cli('start', '--sandbox', SANDBOX, '--no-sign-in')
const startTook = Date.now() - t1
check(`⭐⭐ 真 dsh 起来了(${seconds(startTook)})`, started.ok === true && typeof started.url === 'string',
  started.code ?? started.url ?? '')
check('⛔ 没有带钱包:沙箱里没有凭据文件', !existsSync(join(home, '.credentials.json')))

// 3. The page itself, from outside: 200, boot manifest, and the plugin's own
//    scope named in the HTML — which is the frontend half actually mounted.
let page = { status: 0, body: '' }
if (started.ok === true) {
  try {
    const response = await fetch(started.url, { redirect: 'follow' })
    page = { status: response.status, body: await response.text() }
  } catch (error) {
    page = { status: 0, body: String(error) }
  }
}
check('首页 200 且带 __DSH_BOOT__', page.status === 200 && page.body.includes('__DSH_BOOT__'),
  `status=${page.status}`)
check(`⭐⭐ 页面 HTML 里查得到 ${PACKAGE.split('/')[0]} —— 前端子包真挂上了`,
  page.body.includes('@linxin666'), `HTML ${page.body.length} 字节`)

// 4. Stop it — through the tool, which on Windows is taskkill /T under the hood.
const stopped = await cli('stop', SANDBOX)
check('停得下来', stopped.ok === true, stopped.code ?? `pid=${stopped.pid}`)

// 5. Take it back out, whole family at once.
const removed = await cli('plugins', 'uninstall', PACKAGE, '--sandbox', SANDBOX)
check('卸载连家族一起走', removed.ok === true && (removed.alsoRemoved ?? []).length > 0,
  removed.code ?? `另有 ${(removed.alsoRemoved ?? []).length} 行同去`)

// 6. ⭐ The whole point: the patch is byte-for-byte what it was before install.
const after = existsSync(patch) ? readFileSync(patch, 'utf8') : null
check('⭐⭐ 沙箱 patch 逐字节回到装前(hash 相同)', after !== null && sha(after) === hashBefore,
  after === null ? '文件没了' : `hash ${sha(after).slice(0, 12)} vs ${hashBefore.slice(0, 12)}`)

if (failures === 0) {
  removeTree(root)
  console.log('\n全部通过\n')
  process.exit(0)
}
console.log(`\n${failures} 项不通过,现场留在 ${root},日志尾巴:`)
for (const line of logTail()) console.log(`  ${line}`)
console.log()
process.exit(1)
