#!/usr/bin/env node
/**
 * Build a throwaway data directory with a stand-in for dsh, so the launcher's
 * behaviour can be exercised without downloading a 250MB release, without
 * touching the user's API key, and without spending anything.
 *
 * This exists because the first four rounds of work were verified against a
 * stand-in that was written inline and deleted afterwards each time — which
 * left every one of those results unreproducible. Whatever is claimed to have
 * been tested has to be re-runnable by the next person, or the claim is just
 * a story.
 *
 *   node tools/make-test-box.mjs <目录>            正常启动的替身
 *   node tools/make-test-box.mjs <目录> --broken   再加一个必定启动失败的版本
 *   node tools/make-test-box.mjs <目录> --guarded  再加一个「要先认证才给页面」的版本
 *   node tools/make-test-box.mjs <目录> --silent   再加一个「端口通了但永远不就绪」的版本
 *
 * Then:
 *   $env:DSH_BOX_HOME="<目录>/data"      # PowerShell
 *   node bin/cli.js start t1 --version 9.9.9-stub --no-sign-in --json
 *   node bin/cli.js stop t1 --json
 *
 * ⚠ Sandboxes copy the real credentials file in by default, exactly as they
 * would in normal use. Pass `--no-sign-in` when starting, or delete the whole
 * directory when finished — which is the point of it being throwaway.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

/** Serves the boot marker the launcher waits for, then stays up. */
const WORKING = `const { createServer } = require('node:http')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
console.log(\`stub dsh starting, port \${port}\`)
console.log(\`DSH_HOME=\${process.env.DSH_HOME}\`)
console.log(\`cwd=\${process.cwd()}\`)
console.log(\`args=\${args.join(' ')}\`)
createServer((request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<html><body><script>window.__DSH_BOOT__={}</script></body></html>')
}).listen(port, '127.0.0.1', () => {
  console.log('stub dsh listening')
  setInterval(() => console.log(\`alive \${new Date().toISOString()}\`), 5000)
})
`

/**
 * Serves the marker only after a session exists, the way newer dsh does.
 *
 * ⭐ Three behaviours, and all three are load-bearing: the index answers 401
 * until there is a cookie; the token is accepted only in the query string and
 * answered with a redirect that sets that cookie; and the address carrying the
 * token is printed once, on stdout, which is the only place it exists. A
 * launcher that fetches the index and looks for the marker — which is what ours
 * did — can never see this page, and reports a healthy dsh as one that failed
 * to start.
 */
const GUARDED = `const { createServer } = require('node:http')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
const token = 'stub-token-' + process.pid
createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.searchParams.get('token') === token) {
    response.writeHead(303, { location: '/', 'set-cookie': 'dsh-session=ok; Path=/' })
    response.end()
    return
  }
  if (!String(request.headers.cookie ?? '').includes('dsh-session=ok')) {
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('stub dsh authentication required')
    return
  }
  response.setHeader('content-type', 'text/html')
  response.end('<html><body><script>window.__DSH_BOOT__={}</script></body></html>')
}).listen(port, '127.0.0.1', () => {
  console.log(\`stub dsh web: http://127.0.0.1:\${port}/?token=\${token}\`)
  setInterval(() => console.log('alive'), 5000)
})
`

/** Listens forever and never finishes composing the page. */
const SILENT = `const { createServer } = require('node:http')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
createServer((request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<html><body>still starting</body></html>')
}).listen(port, '127.0.0.1', () => {
  console.log('stub dsh listening but never ready')
  setInterval(() => console.log('alive'), 5000)
})
`

/** Dies on startup the way a release with an unsupported flag does. */
const BROKEN = `console.log('stub dsh starting')
console.error("error: unknown option '--no-open'")
console.error('stub dsh giving up')
process.exit(1)
`

const [target, ...flags] = process.argv.slice(2)
if (target === undefined) {
  console.error('用法: node tools/make-test-box.mjs <目录> [--broken]')
  process.exit(1)
}

const root = resolve(target)
const data = join(root, 'data')
mkdirSync(join(data, 'sandboxes'), { recursive: true })
writeFileSync(join(data, '.dsh-box'), 'dsh-box\n')

/**
 * @param {string} version
 * @param {string} source
 */
function plant(version, source) {
  // The path the launcher resolves a release to; see paths.js versionEntry.
  const dir = join(data, 'versions', version, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bin.js'), source)
  return version
}

const planted = [plant('9.9.9-stub', WORKING)]
if (flags.includes('--broken')) planted.push(plant('9.9.8-broken', BROKEN))
if (flags.includes('--guarded')) planted.push(plant('9.9.7-guarded', GUARDED))
if (flags.includes('--silent')) planted.push(plant('9.9.6-silent', SILENT))

console.log(`\n  测试盒已建好: ${data}`)
console.log(`  版本: ${planted.join('、')}`)
console.log('\n  用法(PowerShell):')
console.log(`    $env:DSH_BOX_HOME="${data}"`)
// ⭐ 档案柜从「两个旗标」变成了一个值:沙箱写自己的名字,日常那台叫 main
//   (src/paths.js 的 DAILY_CABINET)。start/stop 收位置参数,所以这里没有旗标。
console.log('    node bin/cli.js start t1 --version 9.9.9-stub --no-sign-in --json')
console.log('    node bin/cli.js ls')
console.log('    node bin/cli.js stop t1 --json')
console.log(`\n  不要了就整个删掉: ${root}\n`)
