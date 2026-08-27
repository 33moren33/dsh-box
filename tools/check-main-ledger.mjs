/**
 * Prove a main-environment launch can be stopped by whoever comes next.
 *
 * ⛔ Never points at the real `~/.dsh`. Booting the user's own home is the one
 * action in this tool that cannot be undone, so the mechanics are exercised
 * against a throwaway directory instead — what is under test is the ledger,
 * and the ledger does not care whose home it is.
 *
 * The gap this closes: main launches used to be remembered only in the memory
 * of whichever window started them, so closing that window turned a dsh we
 * started into something invisible and unstoppable. It now lands on disk, in
 * *our* data directory — never in the user's home, which we write nothing to.
 *
 * Usage:
 *   node tools/make-test-box.mjs <一次性目录> --broken
 *   node tools/check-main-ledger.mjs <一次性目录>/data
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEngine } from '../src/host.js'
import { boxLayout, uiSeatFile } from '../src/paths.js'
import { claimPath } from '../src/sandbox.js'
import { launch, stop } from '../src/launch.js'
import { clearMainRunning, mainRunningRecord } from '../src/sandbox.js'
import { newLaunchLog } from '../src/logs.js'

const box = process.argv[2]
if (box === undefined || !existsSync(box)) {
  console.error('用法: node tools/check-main-ledger.mjs <测试盒>/data')
  process.exit(2)
}

const layout = boxLayout(box)
let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n从这里启动的日常档案柜,停得掉\n')

check('一开始没有日常档案柜账本', mainRunningRecord(layout) === null)

// A stand-in home, so nothing real is booted.
const home = join(box, 'pretend-main-home')
const fallback = join(home, 'profiles', 'node_modules')
mkdirSync(fallback, { recursive: true })
// A pointer of the kind boot lays down: what a real home accumulates, and what
// must not be left behind aimed at this tool's directories.
writeFileSync(join(fallback, 'pretend-package.txt'), 'points at whatever booted last\n')
const logFile = newLaunchLog(join(layout.root, 'logs'), 'main')

const result = await launch({
  layout, home, engine: resolveEngine(layout, { version: '9.9.9-stub' }), logFile, detached: true,
})
check('日常档案柜起来了', Number.isInteger(result.pid), `pid=${result.pid}`)

const held = mainRunningRecord(layout)
check('账本记下了它', held !== null && held.pid === result.pid, `账本 pid=${held?.pid}`)
check('账本落在我们自己的数据目录里,不在那个 home 里',
  existsSync(join(layout.root, 'main-running.json')) && !existsSync(join(home, 'main-running.json')))
check('账本记了它用的是哪个 home', held?.home === home, held?.home)

// The point of the ledger: a different process, one that did not start it,
// can still find and stop it. This one stands in for "the window, reopened".
const seenByStranger = mainRunningRecord(boxLayout(box))
check('另一个进程也认得出它', seenByStranger?.pid === result.pid)

check('启动时先把旧的模块指针清了(那层由 boot 重建)', !existsSync(fallback))

await stop(result.pid, result.pidBorn)
clearMainRunning(layout, result.pid)
check('停掉之后账本清了', mainRunningRecord(layout) === null)

// The other half of leaving a home the way an ordinary start would leave it.
// Boot recreates this layer pointing at whatever installation is running, so a
// home booted from here keeps pointing into this tool's data directory until
// something clears it. Measured on a real home once: 251 links into a portable
// test folder, which the daily dsh then quietly depended on.
await new Promise((resolve) => { result.child.once('exit', resolve); setTimeout(resolve, 3000) })
await new Promise((resolve) => { setTimeout(resolve, 200) })
check('退出后不再留下指向 dsh-box 的模块指针', !existsSync(fallback),
  existsSync(fallback) ? `${fallback} 还在` : '')

// ── 刀 5:唯一那道闸门 ────────────────────────────────────────────────────
//
// 判据挂在 home 上不挂在版本上:开沙箱怎么都行,用这台电脑自己装的那台 dsh 开真
// home 也就是敲 `dsh`,剩下那一格——用我们下载的版本去开真 home——才是唯一出事
// 修不回来的。⛔ 这里驱动的是真的命令行,但 DSH_HOME 指向上面那个假 home,所以
// 「真 home」在这次测试里是个一次性文件夹。
//
// ⚠️ 没有验「用本机那台开真 home」那一格:验它就得真起一台 dsh 占住 3080,
// 而它不该被拦这件事,是由闸门的条件(engine.kind === 'release')直接决定的。

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js')

/** Drive the real command line, with the "real home" pointed somewhere throwaway. */
function cli(...argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_HOME: home },
    })
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

const refused = await cli('start', '--main', '--version', '9.9.9-stub')
check('下载的版本 ＋ 真 home:没人点过头就拒绝',
  refused.ok === false && refused.code === 'NEEDS_APPROVAL', refused.code)
// ⛔ Asserted on the command name, not on the sentence around it. The sentence
// is translated, so looking for 「配置窗」 only ever passed in a Chinese locale —
// this line went red the first time the suite ran on a machine with no `LANG`
// set. `dsh-box ui` is a command name and therefore never translated, which is
// exactly why it is the right thing to look for: it is the part of the refusal
// the reader has to be able to act on.
check('拒绝里说清了去哪儿点头', String(refused.message ?? '').includes('dsh-box ui'))

const flagAlone = await cli('start', '--main', '--version', '9.9.9-stub', '--approved')
check('⛔⛔ 光带旗标不算数——不是配置窗起的,agent 自己点头无效',
  flagAlone.ok === false && flagAlone.code === 'NEEDS_APPROVAL', flagAlone.code)

// ⭐ Now play the window: it holds the seat and starts the command line as a
// child of itself, and that parentage is the whole of the evidence. This test
// process can honestly do both, which is the point — the mechanism is about
// where a run came from, not about a secret it could have leaked.
// ⛔ 座位由产品自己的写入口来写,夹具不手抄它的字段。手抄过一次:身份凭据
// (`pidBorn`)加进记录之后,手抄的那份当场失效,而失效的样子是「窗口点过头也
// 不放行」——看着像守卫坏了,其实是夹具旧了。**夹具要来自对方。**
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10130' })
const allowed = await cli('start', '--main', '--version', '9.9.9-stub', '--approved')
check('人在配置窗里点过头,同一条命令就放行', allowed.ok === true, allowed.code ?? 'ok')
rmSync(uiSeatFile(layout), { force: true })
if (allowed.ok === true) {
  await cli('stop', '--main')
  await new Promise((resolve) => { setTimeout(resolve, 300) })
}
check('放行那次也进了账本又被停掉', mainRunningRecord(layout) === null)

// ⛔ `logs --main` used to answer with `actions.log`, which lives in the same
// folder and is appended to by every command, so it is always the newest file
// there. What was wanted is what dsh said during the launch.
const said = await cli('logs', '--main', '--shape')
check('logs --main 给的是那次启动的日志,不是操作记录',
  said.ok === true && String(said.shape?.file ?? '').endsWith('_main.log'),
  said.shape?.file ?? said.code)

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
