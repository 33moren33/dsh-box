/**
 * One data directory, one config window — and a stale seat must not lock it.
 *
 * Found by using it: double-clicking the desktop build twice produced two
 * shells, two Node services (10130 and 10131) and two windows onto one data
 * directory. Nothing was corrupted — reads come from disk and writes go through
 * a locked config file — but the window's close button runs `quit`, which stops
 * every sandbox. So the second window is somebody else's world being shut down
 * by a person who cannot see them.
 *
 * The cause is the same one as the sandbox race next door: `ui` answered a busy
 * port by moving to the next one, which is check-then-act wearing a different
 * hat. The seat is now claimed by an exclusive create before the port is even
 * chosen.
 *
 * ⚠️ This starts a real window service, so it binds a port on 127.0.0.1. It
 * never opens a browser and it stops what it started.
 *
 * Usage:
 *   node tools/check-one-window.mjs <一次性目录>
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeTree } from '../src/paths.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-one-window.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
// ⛔⛔ 空的日常档案柜替身。不设它,这套验收读的就是**跑测试那个人真实的 ~/.dsh**,
//    于是「通过」的理由里混进了他机器上碰巧装了什么。理由全文＝ tools/fake-daily.mjs。
useFakeDaily(root)
const made = spawnSync(process.execPath, [join(HERE, 'make-test-box.mjs'), root], {
  stdio: 'ignore', windowsHide: true,
})
if (made.status !== 0) throw new Error(`造不出测试盒:${root}`)
const box = join(root, 'data')
const seat = join(box, 'ui.json')

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** The real command line, one JSON line back. */
function cli(...argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
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

console.log('\n一个数据目录,一个配置窗\n')

// The first window, left running in the background while the rest asks about it.
const first = spawn(process.execPath, [CLI, 'ui', '--port', '10177', '--no-open', '--box', box], {
  windowsHide: true,
})
first.stdout.resume()
first.stderr.resume()

/**
 * Wait until the seat names the address being waited for.
 *
 * ⚠️ Waiting for "any url" is not enough, and getting that wrong cost one
 * confusing red: the stale seat written below already carries a url, so the
 * next window looked like it had failed to take the seat when it had simply
 * not got there yet.
 * @param {string} want - the port expected in the seat's address.
 */
async function seated(want) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (existsSync(seat)) {
      try {
        const held = JSON.parse(readFileSync(seat, 'utf8'))
        if (typeof held.url === 'string' && held.url.includes(want)) return held
      } catch { /* being written this instant */ }
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  return null
}

const held = await seated('10177')
check('⭐ 窗口起来之后,座位上写着它的地址', held !== null && held.url.includes('10177'), held?.url ?? '(没写)')

const second = await cli('ui', '--port', '10178', '--no-open')
check('⛔⛔ 同一个数据目录再开一个,被拒',
  second.ok === false && second.code === 'UI_ALREADY_SERVING', second.code)
check('⛔ 拒绝时说得出已经开在哪儿——不然人只会再试一次',
  typeof second.url === 'string' && second.url.includes('10177'), String(second.url))

first.kill()
await new Promise((done) => first.once('exit', done))

// A seat left behind by a window that was killed must not lock the directory:
// nobody should have to delete a file they have never heard of.
writeFileSync(seat, `${JSON.stringify({ pid: 999_999, url: 'http://127.0.0.1:10177' })}\n`)
const third = spawn(process.execPath, [CLI, 'ui', '--port', '10179', '--no-open', '--box', box], {
  windowsHide: true,
})
third.stdout.resume()
third.stderr.resume()
const after = await seated('10179')
check('⭐ 上一个窗口被杀掉,下一个照样开得起来',
  after !== null && after.url.includes('10179'), after?.url ?? '(没写)')
third.kill()
await new Promise((done) => third.once('exit', done))

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
