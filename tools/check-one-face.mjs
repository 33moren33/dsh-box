/**
 * Prove the config window has stopped being a second implementation.
 *
 * Every check here drives the window the way the page does — over HTTP, with
 * the pass the page carries — and compares the result against the command line
 * doing the same thing. The point is not that each action works; it is that
 * the two entrances now agree, because there is only one of them left.
 *
 * Uses the dsh stand-in from `make-test-box.mjs`, so it downloads nothing,
 * touches no real credentials and costs nothing to run.
 *
 * Usage:
 *   node tools/make-test-box.mjs <一次性目录> --broken
 *   node tools/check-one-face.mjs <一次性目录>/data
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const BOX = process.argv[2]
const PORT = 10977

if (BOX === undefined || !existsSync(BOX)) {
  console.error('用法: node tools/check-one-face.mjs <测试盒>/data')
  console.error('先跑: node tools/make-test-box.mjs <一次性目录> --broken')
  process.exit(2)
}

let failures = 0

/**
 * @param {string} what
 * @param {boolean} passed
 * @param {string} [detail]
 */
function check(what, passed, detail = '') {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** Every action written down so far, whichever entrance did it. */
function readJournal() {
  const file = join(BOX, 'logs', 'actions.log')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/** Run the command line and return its one JSON line. */
function cli(...argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', BOX, '--json'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
}

const ui = spawn(process.execPath, [CLI, 'ui', '--no-open', '--port', String(PORT), '--box', BOX], {
  windowsHide: true,
})
ui.stdout.resume()
ui.stderr.resume()

/** Wait until the window answers, so the checks do not race its startup. */
async function waitForWindow() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`)
      if (response.ok) return (await response.text()).match(/const PASS = '([^']+)'/)?.[1]
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('配置窗没起来')
}

const PASS = await waitForWindow()

/** Drive the window exactly as its page does. */
async function window_(path, body) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, body === undefined
    ? { headers: { 'x-dsh-box-pass': PASS } }
    : {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-box-pass': PASS },
      body: JSON.stringify(body),
    })
  return response.json()
}

const run = (...argv) => window_('/api/command', { argv })

console.log('\n窗口与命令行是同一个门面\n')

// 1. The window can no longer delete a running sandbox. This is the hole that
//    was live before this change: the guard existed only in the command line.
await cli('start', '--version', '9.9.9-stub', '--sandbox', 'w1', '--no-sign-in')
const refusedRm = await run('rm', 'w1')
check('窗口删不掉正在跑的沙箱', refusedRm.code === 'SANDBOX_RUNNING', refusedRm.code)

// 2. The same refusal, same code, from the command line.
const cliRm = await cli('rm', 'w1')
check('命令行给出同一个错误代号', cliRm.code === refusedRm.code, `${cliRm.code} / ${refusedRm.code}`)

// 3. A sandbox the window started is visible to the command line, and vice
//    versa. The window used to answer this from its own memory.
const started = await run('start', '--version', '9.9.9-stub', '--sandbox', 'w2', '--no-sign-in')
const seenByCli = await cli('status')
check('窗口起的沙箱,命令行看得见',
  seenByCli.running.some((entry) => entry.sandbox === 'w2'),
  seenByCli.running.map((entry) => entry.sandbox).join('、'))
const seenByWindow = await window_('/api/state')
check('命令行起的沙箱,窗口看得见',
  seenByWindow.running.some((entry) => entry.sandbox === 'w1'),
  seenByWindow.running.map((entry) => entry.sandbox).join('、'))

// 4. A window launch writes its log where `logs <名字>` looks for it. It used
//    to go to the data directory instead, so this answered NO_LOGS.
const windowLog = await cli('logs', 'w2', '--shape')
check('窗口起的沙箱有自己的启动日志', windowLog.ok === true && windowLog.shape.lines > 0,
  windowLog.ok === true ? `${windowLog.shape.lines} 行` : windowLog.code)

// 5. A window launch is journalled, and handed off rather than held. Both used
//    to be false: the window wrote nothing down, and kept the child, so its
//    sandboxes died with it while the command line's outlived everything.
const journalled = readJournal().filter((entry) => entry.command === 'start' && entry.args?.sandbox === 'w2')
check('窗口起的沙箱进了操作记录', journalled.length === 1,
  `actions.log 里 ${journalled.length} 条`)
check('窗口起的沙箱也是放手的', started.detached === true, `detached=${started.detached}`)

// 6. The window cannot point itself at another data directory, or open a
//    window inside the window.
const otherBox = await run('status', '--box', 'C:/somewhere-else')
check('窗口不能改数据目录', otherBox.ok === false && otherBox.code === 'BAD_COMMAND', otherBox.code)
const nested = await run('ui')
check('窗口里开不了第二个窗口', nested.ok === false && nested.code === 'BAD_COMMAND', nested.code)
const nonsense = await run('rm -rf /')
check('不认识的命令被挡在外面', nonsense.ok === false && nonsense.code === 'BAD_COMMAND', nonsense.code)

// 7. Settings the window changes are the ones the command line reads. Changing
//    the install source used to be something only the window could do.
await run('config', 'source', 'mirror')
const afterSet = await cli('config')
check('窗口改的设置,命令行读得到', afterSet.settings.source === 'mirror', afterSet.settings.source)

// 7b. ⛔⛔ 有人在开车时,窗口发出的命令一律不执行。
//     从前这把锁只存在于页面上(<main>.inert),服务端一句都没问过 —— 那个保证
//     因此是「页面写对了」的推论,不是程序的性质:页面漏掉哪个控件,那个控件就
//     会在 agent 开车时照样写盘,而且不报错。⭐ 现在判断在服务端,一处规则,新
//     控件白白继承;页面上的置灰退化成装饰,标错也变不成损害。
await cli('attach')
const blocked = await run('config', 'source', 'official')
check('⛔⛔ agent 接管时,窗口发的命令被服务端挡下',
  blocked.ok === false && blocked.code === 'AGENT_HOLDS_WINDOW', blocked.code)
const untouched = await cli('config')
check('⛔ 挡下来时是真的什么都没做', untouched.settings.source === 'mirror', untouched.settings.source)

// ⭐ 唯一还放行的是交还那条:拦住它就等于拦住了人夺回控制权的唯一开关。
const release = await run('detach', '--forced')
check('⭐ 但「停止并收回」照样发得出去', release.ok === true, release.code ?? 'ok')
const freed = await run('config', 'source', 'official')
check('收回之后窗口又能用了', freed.ok === true, freed.code ?? 'ok')

await cli('config', 'source', 'auto')

// 8. Quitting stops every sandbox, whichever entrance started it, and the
//    window stops serving afterwards.
const quit = await run('quit')
check('总退出停下了两台沙箱', quit.ok === true && quit.stopped.length === 2,
  (quit.stopped ?? []).map((entry) => entry.sandbox).join('、'))
const afterQuit = await cli('status')
check('退出后没有沙箱还在跑', afterQuit.running.length === 0, `${afterQuit.running.length} 台`)
check('退出后沙箱本身还在(只是停了,没被删)', afterQuit.sandboxes.length >= 2,
  `${afterQuit.sandboxes.length} 个`)

await new Promise((r) => setTimeout(r, 1200))
let windowGone = false
try {
  await fetch(`http://127.0.0.1:${PORT}/`)
} catch {
  windowGone = true
}
check('退出后配置窗自己也停了', windowGone)

ui.kill()

// 9. Closing the window is not quitting. A sandbox is a separate dsh that was
//    handed off on purpose, so ending the one long-running command — `ui` —
//    leaves it alone. The window used to stop whatever it had personally
//    started on the way out, which is why the same sandbox died with the
//    window or did not, depending only on which entrance had pressed start.
//    (On Windows that hook never actually fired; on mac and Linux it did. It
//    is gone now, so the answer no longer depends on the platform.)
const second = spawn(process.execPath, [CLI, 'ui', '--no-open', '--port', String(PORT), '--box', BOX], {
  windowsHide: true,
})
second.stdout.resume()
second.stderr.resume()
await waitForWindow()
await cli('start', '--version', '9.9.9-stub', '--sandbox', 'w3', '--no-sign-in')
second.kill()
await new Promise((r) => setTimeout(r, 1500))
const survived = await cli('status')
check('关掉配置窗,沙箱照跑', survived.running.some((entry) => entry.sandbox === 'w3'),
  survived.running.map((entry) => entry.sandbox).join('、') || '一台都没了')

// Clean up whatever is left, so the box can be re-run against.
await cli('quit')
await cli('rm', 'w1')
await cli('rm', 'w2')
await cli('rm', 'w3')

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
