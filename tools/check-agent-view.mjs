/**
 * Prove the window is told the truth about who is working in here.
 *
 * The blue frame is drawn from two files and nothing else, so what can be
 * checked mechanically is exactly that: does the window see what the command
 * line just did, at the moment it did it, and does it see the same thing the
 * `memory` command sees. Whether the frame *looks* right is not checkable here
 * and is not claimed to be — ⚠️ nothing in this repository drives the page.
 *
 * ⭐⭐ **Nothing here ever announces itself**, and that is what these assertions
 * are for since 2026-08-30. `agent attach` / `agent detach` are gone: every
 * command that changes something registers itself while it runs and the record
 * dies with the process, so the window's picture cannot be made wrong by an
 * agent that forgot a step — which is exactly how it went wrong twice.
 *
 * Uses the dsh stand-in from `make-test-box.mjs`, so it downloads nothing,
 * touches no real credentials and costs nothing to run.
 *
 * Usage:
 *   node tools/make-test-box.mjs <一次性目录> --broken
 *   node tools/check-agent-view.mjs <一次性目录>/data
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VALUE_FLAGS } from '../src/commands.js'
import { finishCommand, noteCommand } from '../src/journal.js'
import { boxLayout } from '../src/paths.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const BOX = process.argv[2]
const PORT = 10978

if (BOX === undefined || !existsSync(BOX)) {
  console.error('用法: node tools/check-agent-view.mjs <测试盒>/data')
  console.error('先跑: node tools/make-test-box.mjs <一次性目录> --broken')
  process.exit(2)
}
// ⛔⛔ 空的日常档案柜替身。不设它,这套验收读的就是**跑测试那个人真实的 ~/.dsh**,
//    于是「通过」的理由里混进了他机器上碰巧装了什么。理由全文＝ tools/fake-daily.mjs。
// ⛔ 摆在参数检查之后:BOX 还没确认存在时 dirname(undefined) 会先崩,
//    而那时报的是一句跟用法无关的类型错误。
useFakeDaily(dirname(BOX))
// ⛔ 撞上日常柜那道闸门时立刻拒绝,而不是弹一扇窗再等一分钟等一个不在场的人。
//    ⭐ 和上面一样设一次而不是每个 spawn 抄一遍:子进程继承得到,后加的命令白白继承。
//    它只会**拒得更快**——没有任何开关能让没点过头的动作跑起来(bin/cli.js 的 NO_PANEL_ENV)。
process.env.DSH_BOX_NO_PANEL = '1'

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

/** What the page would see, fetched the way the page fetches it. */
async function seen() {
  const response = await fetch(`http://127.0.0.1:${PORT}/api/state`, {
    headers: { 'x-dsh-box-pass': PASS },
  })
  return response.json()
}

console.log('\n窗口看得见外面有人在动\n')

// 1. Nothing has ever run in a fresh box, so neither file exists. That is the
//    ordinary state — the window draws itself normally — and reporting it as an
//    error would make every first run look broken.
const quiet = await seen()
check('没人在动时,窗口读到的是「没有」而不是出错',
  quiet.agent === null && quiet.session === null,
  `agent=${quiet.agent} session=${quiet.session}`)

// 2. ⛔ A read-only command leaves nothing anywhere. It changes nothing, so
//    there is nothing for the window to stand aside from and nothing worth a
//    line in the trail — and a `ls` that pushed the last real action off the
//    screen would be the display working against itself.
await cli('ls')
const afterRead = await seen()
check('⛔ 只读命令不登记,窗口不必为它让位',
  afterRead.agent === null, `agent=${JSON.stringify(afterRead.agent)}`)
check('只读命令进不了编号串', afterRead.session === null, `session=${afterRead.session}`)

// 3. ⭐⭐ 这一条是这次改造的核心:**没有人敲过任何「我要接管」**,而改了状态的动作
//    照样进了编号串。从前 record() 在没人接管时直接 return 0,于是两个忘了敲 attach
//    的 agent 干的所有事,窗口一个字都看不到。
await cli('start', 'a1', '--version', '9.9.9-stub', '--no-sign-in')
const afterStart = await seen()
check('⭐⭐ 没人声明过任何东西,改了状态的动作照样进编号串,序号从 1 起',
  afterStart.session?.actions?.length === 1 && afterStart.session.actions[0].seq === 1,
  `${afterStart.session?.actions?.length} 条`)
// ⭐ 谁干的要记下来:多个 agent 同时在一个数据目录上干活时,一串分不出人的步骤
//    正好答不出它存在的那个问题。
check('⭐ 每一步都记得下是哪个进程干的(多 agent 要分得开)',
  Number.isInteger(afterStart.session?.actions?.[0]?.by?.pid),
  JSON.stringify(afterStart.session?.actions?.[0]?.by))

// 5. ⭐ The rendered line is filled in, including the parts nobody typed. It is
//    rebuilt from what the launch resolved to rather than from what was typed,
//    because `start` with blanks means "whatever is current" and current moves.
// ⭐ 档案柜从旗标变成了位置参数,所以「哪个柜子」现在读的是 `start a1` 而不是
//    `--sandbox a1`。断言问的还是同一件事:三个空都填满了没有。
const line = afterStart.session?.actions?.[0]?.line ?? ''
check('等价命令行每个空都填满了,拿去重跑得到同一台',
  line.includes('start a1') && line.includes('--version 9.9.9-stub') && line.includes('--no-sign-in'),
  line)

// 6. A refusal is worth writing down precisely because it was refused: an agent
//    that cannot see where it was stopped walks into the same wall next time.
const refused = await cli('rm', 'sandbox', 'a1')
const afterRefusal = await seen()
const second = afterRefusal.session?.actions?.[1]
check('被拒的动作也留在串里,带着代号',
  second?.ok === false && second.code === refused.code, `${second?.code} / ${refused.code}`)

// 6b. ⛔⛔ And that line has to be re-runnable, which is the entire point of
//     writing a refusal down. Measured: a `rm plugin` that failed before its
//     cabinet had been resolved came out as `… --from` with nothing after it —
//     a line that looks runnable and is not. Two separate things had to be
//     wrong for that, and either one alone brings it back: the record left the
//     cabinet out, and the renderer dropped blanks one token at a time, so the
//     value went while its flag stayed.
const refusedPlugin = await cli('rm', 'plugin', '没装过这个', '--from', 'a1')
const afterPluginRefusal = await seen()
const third = afterPluginRefusal.session?.actions?.[2]
check('⛔ 被拒的插件命令也记下了是在哪个档案柜上被拦的',
  third?.ok === false && third.code === refusedPlugin.code, `${third?.code} / ${refusedPlugin.code}`)
check('⛔⛔ 它的等价命令行拿去能重跑,不是一个空着的 --from',
  String(third?.line ?? '').includes('--from a1'), third?.line)
// ⭐ 名单不再手抄:带值的旗标 `VALUE_FLAGS` 已经在 src/commands.js 里申报过一次,
//    再抄一份就是「下一个新旗标这道守卫看不见」——那正是这条断言防的那类事。
//    ⛔ `--box` 与 `--json` 不进等价命令行,留在集合里也碰不到。
const CARRIES_VALUE = new Set([...VALUE_FLAGS].map((flag) => `--${flag}`))
check('⛔ 串里没有任何一条命令行把旗标孤零零地留在末尾',
  (afterPluginRefusal.session?.actions ?? []).every(({ line }) => {
    const tokens = String(line ?? '').trim().split(/\s+/)
    return !tokens.some((token, at) => token.startsWith('--')
      && CARRIES_VALUE.has(token)
      && (tokens[at + 1] === undefined || tokens[at + 1].startsWith('--')))
  }), JSON.stringify((afterPluginRefusal.session?.actions ?? []).map((action) => action.line)))

// 7. ⭐⭐ 让位只管一条命令的执行期间,而且是自动的两头。
//
//    ⛔ 这里扮的正是「另一个终端里的 agent」:这个测试进程用命令行漏斗调的同一个
//    函数登记一条「正在跑」的记录(bin/cli.js 的 noteCommand),它活着、又不是配置窗
//    的子进程,所以窗口该让位;调 finishCommand 之后**没有人敲过任何交还**,窗口
//    自己就松开了。这两头正是从前要人记得敲 attach / detach 的那两下。
const layout = boxLayout(BOX)
noteCommand(layout, 'start', { sandbox: '另一个终端' })
const busy = await seen()
check('⭐⭐ 外面一开始跑命令,窗口当场就看得见(没人声明过)',
  busy.agent?.runs?.length === 1 && busy.agent.runs[0].command === 'start',
  JSON.stringify(busy.agent))
check('⭐ 看得见是哪个进程在跑', busy.agent?.runs?.[0]?.pid === process.pid,
  `${busy.agent?.runs?.[0]?.pid} / ${process.pid}`)
finishCommand(layout)
const freed = await seen()
check('⭐⭐ 那条命令一跑完,窗口自己就松开了(没有交还这个动作)',
  freed.agent === null, JSON.stringify(freed.agent))

// 8. The trail outlives the run: the frames go, the data stays, which is what
//    the recall control opens. Someone who was not watching can still find out.
check('跑完之后记录还在,回忆控件有东西可点',
  freed.session?.actions?.length === 3, `${freed.session?.actions?.length} 条`)

// 9. Both entrances read the same two files, so they cannot disagree.
const memory = await cli('ls', 'memory')
check('窗口与 ls memory 读的是同一份记录',
  memory.session?.session === freed.session?.session
  && memory.session?.actions?.length === freed.session?.actions?.length,
  `${memory.session?.actions?.length} / ${freed.session?.actions?.length}`)

// 9b. ⛔⛔ 上面第 7 条是直接调那两个函数,证明的是**机制**;这一条证明的是**接线**:
//     一条真的命令行命令,在它自己跑的那段时间里,窗口真的看得见。两者缺一不可 ——
//     漏斗上少调一次 noteCommand,第 7 条照样全绿。
const running = cli('start', 'a2', '--version', '9.9.9-stub', '--no-sign-in')
let stillRunning = true
running.then(() => { stillRunning = false })
let caught = null
// ⛔ 中间不睡:间隙越小越不容易错过,而 start 本身要跑好几百毫秒(它一直等到 dsh
//    真的在服务才返回)。
while (caught === null && stillRunning) {
  const now = await seen()
  caught = (now.agent?.runs ?? []).find((one) => one.command === 'start') ?? null
}
await running
check('⛔⛔ 一条真的 start 在跑的时候,窗口看得见它(漏斗上真的接了线)',
  caught !== null && caught.fromWindow !== true, JSON.stringify(caught))
const afterRunning = await seen()
check('⭐ 它一结束,窗口又空了(失败路径也一样会松,见 bin/cli.js 两个出口)',
  afterRunning.agent === null, JSON.stringify(afterRunning.agent))

// 10. ⛔⛔ 持久记录终于读得到了。
//     它一直被定义成「持久 log,人排查时读」,而**没有任何命令或界面打得开它**,
//     自己还会到 2MB 就顶掉一代——攒着一份没人看、又会自己丢的东西。而唯一能看
//     它的办法是开 shell 去 cat,那正是窗口跟不到的地方。
//     ⚠️ 与 ls memory 是两样:那个是上一轮接管的显示、下一轮会覆盖;这是只增的记录。
// 先攒够几条,否则「截断说得清不清楚」那一条会因为没东西可截而空转 —— 一个
// 不会失败的断言什么都没证明。
await cli('set', 'source', 'official')
await cli('set', 'source', 'mirror')
await cli('set', 'source', 'auto')

const shape = await cli('ls', 'history', '--shape')
check('⭐ 记录的形状问得出来,无论多长回答都是固定几行',
  shape.ok !== false && Number.isInteger(shape.entries) && shape.files.length > 0,
  `${shape.entries} 条,失败 ${shape.failures} 条`)
check('形状里说得出时间范围', typeof shape.from === 'string' && typeof shape.to === 'string',
  `${shape.from} → ${shape.to}`)

const recent = await cli('ls', 'history', '--lines', '2')
check('⭐ 默认只给一小段,而且当场说清共有多少、省了多少',
  recent.entries.length === 2 && recent.total === shape.entries && recent.omitted === shape.entries - 2,
  `给 ${recent.entries.length} 条,共 ${recent.total},省 ${recent.omitted}`)
check('⛔ 绝不安静截断:省略数目与全文路径都在数据里,不是一句提示语',
  recent.omitted > 0 && recent.files.length > 0, recent.files.join('、'))

const everything = await cli('ls', 'history', '--lines', '0')
check('要全部就给全部', everything.entries.length === shape.entries && everything.omitted === 0,
  `${everything.entries.length} 条`)
check('⭐ 记下的都是改过状态的命令,只读的不占地方',
  everything.entries.every((entry) => typeof entry.command === 'string')
  && !everything.entries.some((entry) => entry.command === 'ls'),
  everything.entries.map((entry) => entry.command).join('、'))

// 11. ⭐⭐ 同一个读者的另一半:窗口看得见外面在动,而**外面那个 agent 读到的答复
//     本身也得是真的**。这三条查的是 `start --json` 上那两个字段名与那一个数字 ——
//     它们是路过的 agent 拿去下判断的原料,而下面这一条判例正是从那里来的。
//
//     ⛔⛔ 从前这里叫 `plugins`,报的却是「这次 --plugin 传了什么」。同一台沙箱:
//     带旗标那次 `[{"id":…}]`,不带那次 `[]`,而插件一直装着 —— 于是读的人判
//     「没装上」而多做一步,或者判「装丢了」。**这正撞在这条命令自己那句说明的
//     反面**:不写 --plugin 不是一个都不装,是什么都不改。说明写对了,机器答复
//     把「没改动」印成了「空的」,而机器答复才是 agent 真正拿去用的那一份。
const pluginDir = join(dirname(BOX), 'a-plugin')
mkdirSync(join(pluginDir, 'lib'), { recursive: true })
writeFileSync(join(pluginDir, 'package.json'), `${JSON.stringify({
  name: 'view-plugin', version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {} },
}, null, 2)}\n`)
writeFileSync(join(pluginDir, 'lib', 'index.js'), 'export default {}\n')

const withFlag = await cli('start', 'a3', '--plugin', pluginDir, '--version', '9.9.9-stub', '--no-sign-in')
await cli('stop', 'a3')
const without = await cli('start', 'a3', '--version', '9.9.9-stub', '--no-sign-in')
await cli('stop', 'a3')

check('⛔⛔ 「这次改了什么」叫 pluginsChanged,而且不写 --plugin 时它是空的',
  withFlag.pluginsChanged?.length === 1 && without.pluginsChanged?.length === 0
  && withFlag.plugins === undefined && without.plugins === undefined,
  `带旗标 ${JSON.stringify(withFlag.pluginsChanged)} / 不带 ${JSON.stringify(without.pluginsChanged)}`)
// ⭐ 这一条才是判例本身:**同一台沙箱、没写 --plugin 的那一次**,答复里必须
//    如实列出它现在装着什么。空的那个字段旁边没有这一份,读的人只能猜。
check('⭐⭐ 不写 --plugin 的那一次,答复照样如实列出这个档案柜装着什么',
  (without.cabinetPlugins?.ours ?? []).some((one) => one.package === 'view-plugin'),
  JSON.stringify(without.cabinetPlugins))
// ⭐ 从接到命令到 dsh 真在服务,只有 box 知道这个边界:外面掐表连 node 起进程、
//   读这个文件的时间一起算了进去。help 里那两个约数是给人看的,agent 该读这个。
check('⭐ 答复里有 elapsedMs,是这一次真花的毫秒数(不是 help 里那个约数)',
  Number.isInteger(without.elapsedMs) && without.elapsedMs > 0 && without.elapsedMs < 120000,
  `${without.elapsedMs}`)

// 12. ⭐ 每轮醒来第一条命令就答得出「我在驱动的是哪一版」。另一个入口是
//     `--help --json`(调用方还没有数据目录时读的那一份),守在 check-command-map。
const version = await cli('ls')
check('⭐ ls 报得出这个工具自己的版本号', typeof version.boxVersion === 'string' && version.boxVersion !== '',
  `${version.boxVersion}`)

await cli('stop', '--all')
await cli('rm', 'sandbox', 'a1')
await cli('rm', 'sandbox', 'a2')
await cli('rm', 'sandbox', 'a3')
ui.kill()

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
