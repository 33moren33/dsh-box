/**
 * Prove the window is told the truth about who is driving it.
 *
 * The blue frame is drawn from two files and nothing else, so what can be
 * checked mechanically is exactly that: does the window see what the command
 * line just did, at the moment it did it, and does it see the same thing the
 * `memory` command sees. Whether the frame *looks* right is not checkable here
 * and is not claimed to be — ⚠️ nothing in this repository drives the page.
 *
 * Uses the dsh stand-in from `make-test-box.mjs`, so it downloads nothing,
 * touches no real credentials and costs nothing to run.
 *
 * Usage:
 *   node tools/make-test-box.mjs <一次性目录> --broken
 *   node tools/check-agent-view.mjs <一次性目录>/data
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const BOX = process.argv[2]
const PORT = 10978

if (BOX === undefined || !existsSync(BOX)) {
  console.error('用法: node tools/check-agent-view.mjs <测试盒>/data')
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

console.log('\n窗口看得见谁在驾驶\n')

// 1. Nothing has ever attached in a fresh box, so neither file exists. That is
//    the ordinary state — the window draws itself normally — and reporting it
//    as an error would make every first run look broken.
const quiet = await seen()
check('没人接管时,窗口读到的是「没有」而不是出错',
  quiet.agent === null && quiet.session === null,
  `agent=${quiet.agent} session=${quiet.session}`)

// 2. Taking control shows up in the window immediately, under the same session
//    id the command line just handed out. The window has no second opinion to
//    consult: it reads the file the command wrote.
const held = await cli('attach')
const driving = await seen()
check('接管之后,窗口当场认得出是哪一次会话',
  driving.agent?.session === held.session, driving.agent?.session)

// 3. A read-only command moves the badge and nothing else. Conflating these two
//    was a real mistake: making read-only commands leave no trace at all left
//    the badge blank while an agent spent two minutes downloading, and letting
//    them into the trail meant one `status` wiped the last run worth showing.
await cli('status')
const afterRead = await seen()
check('只读命令进得了角标', afterRead.agent?.lastCommand?.name === 'status',
  afterRead.agent?.lastCommand?.name)
check('只读命令进不了编号串', afterRead.session === null, `session=${afterRead.session}`)

// 4. An action that changed something is numbered, from one.
await cli('start', '--version', '9.9.9-stub', '--sandbox', 'a1', '--no-sign-in')
const afterStart = await seen()
check('改了状态的动作进编号串,序号从 1 起',
  afterStart.session?.actions?.length === 1 && afterStart.session.actions[0].seq === 1,
  `${afterStart.session?.actions?.length} 条`)

// 5. ⭐ The rendered line is filled in, including the parts nobody typed. It is
//    rebuilt from what the launch resolved to rather than from what was typed,
//    because `start` with blanks means "whatever is current" and current moves.
const line = afterStart.session?.actions?.[0]?.line ?? ''
check('等价命令行每个空都填满了,拿去重跑得到同一台',
  line.includes('--sandbox a1') && line.includes('--version 9.9.9-stub') && line.includes('--no-sign-in'),
  line)

// 6. A refusal is worth writing down precisely because it was refused: an agent
//    that cannot see where it was stopped walks into the same wall next time.
const refused = await cli('rm', 'a1')
const afterRefusal = await seen()
const second = afterRefusal.session?.actions?.[1]
check('被拒的动作也留在串里,带着代号',
  second?.ok === false && second.code === refused.code, `${second?.code} / ${refused.code}`)

// 6b. ⛔⛔ And that line has to be re-runnable, which is the entire point of
//     writing a refusal down. Measured: a `plugins uninstall` that failed
//     before its cabinet had been resolved came out as `… --sandbox` with
//     nothing after it — a line that looks runnable and is not. Two separate
//     things had to be wrong for that, and either one alone brings it back:
//     the record left the cabinet out, and the renderer dropped blanks one
//     token at a time, so the value went while its flag stayed.
const refusedPlugin = await cli('plugins', 'uninstall', '没装过这个', '--sandbox', 'a1')
const afterPluginRefusal = await seen()
const third = afterPluginRefusal.session?.actions?.[2]
check('⛔ 被拒的插件命令也记下了是在哪个档案柜上被拦的',
  third?.ok === false && third.code === refusedPlugin.code, `${third?.code} / ${refusedPlugin.code}`)
check('⛔⛔ 它的等价命令行拿去能重跑,不是一个空着的 --sandbox',
  String(third?.line ?? '').includes('--sandbox a1'), third?.line)
check('⛔ 串里没有任何一条命令行把旗标孤零零地留在末尾',
  (afterPluginRefusal.session?.actions ?? []).every(({ line }) => {
    const tokens = String(line ?? '').trim().split(/\s+/)
    return !tokens.some((token, at) => token.startsWith('--')
      && ['--sandbox', '--version', '--id', '--at', '--plugin', '--unplug'].includes(token)
      && (tokens[at + 1] === undefined || tokens[at + 1].startsWith('--')))
  }), JSON.stringify((afterPluginRefusal.session?.actions ?? []).map((action) => action.line)))

// 7. The one control that reaches through the glass. What it ends is the hold
//    on the window, and the record says who ended it — an agent told "you
//    finished" where it was actually stopped has been misinformed about the one
//    thing it most needs to know.
await cli('detach', '--forced')
const released = await seen()
check('人按停止之后,窗口不再显示接管中', released.agent === null, `agent=${released.agent}`)
check('记录说得出是被人收回的,不是自己交还的',
  released.session?.endedBy === 'forced', released.session?.endedBy)

// 8. The trail outlives the run: the frames go, the data stays, which is what
//    the recall control opens. Someone who was not watching can still find out.
check('交还之后记录还在,回忆控件有东西可点',
  released.session?.actions?.length === 3, `${released.session?.actions?.length} 条`)

// 9. Both entrances read the same two files, so they cannot disagree.
const memory = await cli('memory')
check('窗口与 memory 命令读的是同一份记录',
  memory.session?.session === released.session?.session
  && memory.session?.actions?.length === released.session?.actions?.length,
  `${memory.session?.actions?.length} / ${released.session?.actions?.length}`)

// 10. ⛔⛔ 持久记录终于读得到了。
//     它一直被定义成「持久 log,人排查时读」,而**没有任何命令或界面打得开它**,
//     自己还会到 2MB 就顶掉一代——攒着一份没人看、又会自己丢的东西。而唯一能看
//     它的办法是开 shell 去 cat,那正是窗口跟不到的地方。
//     ⚠️ 与 memory 是两样:memory 是上一轮接管的显示、下一轮会覆盖;这是只增的记录。
// 先攒够几条,否则「截断说得清不清楚」那一条会因为没东西可截而空转 —— 一个
// 不会失败的断言什么都没证明。
await cli('config', 'source', 'official')
await cli('config', 'source', 'mirror')
await cli('config', 'source', 'auto')

const shape = await cli('history', '--shape')
check('⭐ 记录的形状问得出来,无论多长回答都是固定几行',
  shape.ok !== false && Number.isInteger(shape.entries) && shape.files.length > 0,
  `${shape.entries} 条,失败 ${shape.failures} 条`)
check('形状里说得出时间范围', typeof shape.from === 'string' && typeof shape.to === 'string',
  `${shape.from} → ${shape.to}`)

const recent = await cli('history', '--lines', '2')
check('⭐ 默认只给一小段,而且当场说清共有多少、省了多少',
  recent.entries.length === 2 && recent.total === shape.entries && recent.omitted === shape.entries - 2,
  `给 ${recent.entries.length} 条,共 ${recent.total},省 ${recent.omitted}`)
check('⛔ 绝不安静截断:省略数目与全文路径都在数据里,不是一句提示语',
  recent.omitted > 0 && recent.files.length > 0, recent.files.join('、'))

const everything = await cli('history', '--lines', '0')
check('要全部就给全部', everything.entries.length === shape.entries && everything.omitted === 0,
  `${everything.entries.length} 条`)
check('⭐ 记下的都是改过状态的命令,只读的不占地方',
  everything.entries.every((entry) => typeof entry.command === 'string')
  && !everything.entries.some((entry) => entry.command === 'status'),
  everything.entries.map((entry) => entry.command).join('、'))

await cli('quit')
await cli('rm', 'a1')
ui.kill()

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
