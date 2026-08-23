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
 *
 * Then:
 *   $env:DSH_BOX_HOME="<目录>/data"      # PowerShell
 *   node bin/cli.js start --version 9.9.9-stub --sandbox t1 --no-sign-in --json
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

console.log(`\n  测试盒已建好: ${data}`)
console.log(`  版本: ${planted.join('、')}`)
console.log('\n  用法(PowerShell):')
console.log(`    $env:DSH_BOX_HOME="${data}"`)
console.log('    node bin/cli.js start --version 9.9.9-stub --sandbox t1 --no-sign-in --json')
console.log('    node bin/cli.js status')
console.log('    node bin/cli.js stop t1 --json')
console.log(`\n  不要了就整个删掉: ${root}\n`)
