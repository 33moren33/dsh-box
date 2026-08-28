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

/**
 * Drive the real command line, with the "real home" pointed somewhere throwaway.
 *
 * ⛔ DSH_BOX_NO_PANEL:撞上闸门时**当场拒绝**,不去弹一个面板再等六十秒。错误码
 * 仍然是 NEEDS_APPROVAL,所以下面「没人点过头就拒绝」的语义一个字没变。
 * ⭐ `approved` 那一路走另一个函数({@link asWindow}),因为同意从 08-28 起不是
 * 一个打得出来的旗标,而是「谁起的这个进程」＋一个只有窗口设得出的环境变量。
 */
function cli(...argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_HOME: home, DSH_BOX_NO_PANEL: '1' },
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

/**
 * 同一条命令,但这次**扮演配置窗**跑它。
 *
 * ⭐⭐ 08-28 的新判据,两件缺一不可(src/sandbox.js 的 approvedByWindow):
 * **父进程正是座位上那个窗**,以及**环境里带着 DSH_BOX_APPROVAL=1** —— 后者只有
 * 服务端走在「人点了允许」那条路上时才设得出来。这个测试进程两件都做得到,而且
 * 是诚实地做到:座位是它自己占的,子进程是它自己起的。
 */
function asWindow(...argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_HOME: home, DSH_BOX_APPROVAL: '1' },
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

const refused = await cli('start', 'main', '--version', '9.9.9-stub')
check('下载的版本 ＋ 真 home:没人点过头就拒绝',
  refused.ok === false && refused.code === 'NEEDS_APPROVAL', refused.code)
// ⛔ Asserted on the command name, not on the sentence around it. The sentence
// is translated, so looking for 「配置窗」 only ever passed in a Chinese locale —
// this line went red the first time the suite ran on a machine with no `LANG`
// set. `dsh-box ui` is a command name and therefore never translated, which is
// exactly why it is the right thing to look for: it is the part of the refusal
// the reader has to be able to act on.
check('拒绝里说清了去哪儿点头', String(refused.message ?? '').includes('dsh-box ui'))

// ⭐⭐ 同一条断言,换了个更强的说法:原来问的是「自己把 --approved 打出来也不算
//    数」,而 08-28 之后**这个词根本打不出来了**(CEO:「不留这个参数的后门」)。
//    ⛔ 守的还是同一件事 —— agent 不能在参数表里给自己点头 —— 只是它现在连成
//    一条合法命令都不成立,所以拦在解析那一步。
const flagAlone = await cli('start', 'main', '--version', '9.9.9-stub', '--approved')
check('⛔⛔ 同意打不出来——`--approved` 已经不是一个旗标了',
  flagAlone.ok === false && flagAlone.code === 'UNKNOWN_FLAG', flagAlone.code)

// ⭐ Now play the window: it holds the seat and starts the command line as a
// child of itself, and that parentage is the whole of the evidence. This test
// process can honestly do both, which is the point — the mechanism is about
// where a run came from, not about a secret it could have leaked.
// ⛔ 座位由产品自己的写入口来写,夹具不手抄它的字段。手抄过一次:身份凭据
// (`pidBorn`)加进记录之后,手抄的那份当场失效,而失效的样子是「窗口点过头也
// 不放行」——看着像守卫坏了,其实是夹具旧了。**夹具要来自对方。**
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10130' })
const allowed = await asWindow('start', 'main', '--version', '9.9.9-stub')
check('人在配置窗里点过头,同一条命令就放行', allowed.ok === true, allowed.code ?? 'ok')
if (allowed.ok === true) {
  // ⛔⛔ 停日常那一台从 08-28 起也在闸门里(bin/cli.js 的 halt),所以这一步同样得
  //    扮演窗口 —— 而座位要**留到它跑完**再松手,松早了就是「窗口起的」这半边
  //    证据当场消失,收尾停不掉,下一条断言会红在一个跟它无关的理由上。
  await asWindow('stop', 'main')
  await new Promise((resolve) => { setTimeout(resolve, 300) })
}
rmSync(uiSeatFile(layout), { force: true })
check('放行那次也进了账本又被停掉', mainRunningRecord(layout) === null)

// ⛔ `logs main` used to answer with `actions.log`, which lives in the same
// folder and is appended to by every command, so it is always the newest file
// there. What was wanted is what dsh said during the launch.
const said = await cli('logs', 'main', '--shape')
check('logs main 给的是那次启动的日志,不是操作记录',
  said.ok === true && String(said.shape?.file ?? '').endsWith('_main.log'),
  said.shape?.file ?? said.code)

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
