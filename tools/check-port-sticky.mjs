/**
 * 一台沙箱的门牌号,得跟着这台沙箱走。
 *
 * ⛔⛔ 守的是什么。端口从前是「这一次启动」的东西:每次都从基准端口往上扫、
 * 靠真去 bind 一下判空,谁先起谁拿低号。于是 10:49 停掉的那台,它的号 10:53
 * 就被另一台捡走。**程序本身从来没坏过**——占用是拿 bind 判的,两台永远不会
 * 真撞在一起——坏掉的是**别人手里那个地址**:结果横幅上那条可点的链接、还开着
 * 的浏览器标签页、agent 记进笔记里的端口。三者都说了「在哪儿」,没有一个说得出
 * 「是哪一台」。2026-08-30 实测:两台沙箱在四分钟内先后握着 3092,而主人的
 * 浏览器一直在重试它。
 *
 * 现在沙箱把上次的号记进自己的 `sandbox.json`(`lastPort`),下次**优先要回**
 * 那个号。⭐ 是优先不是预留:此刻被别的东西占着,就照旧往上扫。
 *
 * ⭐⭐ 为什么值得一道守卫,以及这道守卫的难点在哪。这条行为**极容易被假绿糊弄
 * 过去**:只有一台沙箱、机器又干净时,「停掉再起」哪怕走老的重扫也会扫回同一个
 * 号——号相同不等于号被记住了。所以本册先把基准端口起头的两个空位自己占住,逼
 * 沙箱拿到一个「不是第一个空位」的号,再把占位放掉;此时老的扫法必然给出**别的**
 * 号。那一格前面还站着一个对照断言,先证明这套装置此刻分得开两种做法,再去问
 * 产品做对了没有。
 *
 * ⛔ 判据一律是行为:三次都真的把替身 dsh 起起来,读它实际听在哪个端口。不看
 * 源码里出现过什么字——查字符串的守卫,把调用删掉照样全绿,本仓已栽过。
 *
 * ⛔ 单独成册而不并进 `check-boot-ready`,理由是题目不同:那一本问的是「起好了
 * 没有」,拿两分钟去等一次真的超时;这一本问的是「号还是不是那个号」,而且要
 * 自己按住几个端口——按住端口这件事会改变同一个盒子里别的用例看到的世界,合册
 * 就得靠人记住谁先谁后。
 *
 * ⛔ 不碰真的 `~/.dsh`、不碰真 Key、不联网:dsh 是 `make-test-box.mjs` 种下的
 * 几十行替身,日常档案柜换成 `fake-daily` 的空壳,端口只按住自己找到的空号,
 * 用完就放。
 *
 * Usage:
 *   node tools/check-port-sticky.mjs <一次性目录>
 */

import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SANDBOX_PORT, findFreePort, launch, stop } from '../src/launch.js'
import { resolveEngine } from '../src/host.js'
import { boxLayout, removeTree } from '../src/paths.js'
import { rememberedPort, runningRecord } from '../src/sandbox.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-port-sticky.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
// ⛔ 在任何东西读任何东西之前。这一册会真的起 dsh,没有自己的日常档案柜就会去
// 读跑测试那个人的 `~/.dsh`。
useFakeDaily(root)
const made = spawnSync(process.execPath, [join(HERE, 'make-test-box.mjs'), root], {
  stdio: 'ignore', windowsHide: true,
})
if (made.status !== 0) throw new Error(`造不出测试盒:${root}`)
const box = join(root, 'data')
const layout = boxLayout(box)
const engine = resolveEngine(layout, { version: '9.9.9-stub' })

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * 关掉一个自己开的服务器,不等任何人。
 *
 * ⛔ `close()` 的回调要等到最后一个连接断开才来,而这几个号在真机上是**有人在
 * 敲的**——还开着的浏览器标签页、横幅上那条链接,正是这条行为存在的理由本身。
 * 本册第一版直接 `await close(cb)`,于是守卫自己被守卫的现象挂住了,卡在放占位
 * 那一步不动。所以:连上来的一律掐掉,并且等待有上限。
 */
function shut(server) {
  return new Promise((done) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      done()
    }
    server.closeAllConnections?.()
    server.close(finish)
    setTimeout(finish, 2000).unref()
  })
}

/** 按住一个端口,像别的进程那样。返回可以关掉的服务器,占不住就返回 null。 */
function hold(port) {
  return new Promise((done) => {
    const server = createServer()
    server.on('connection', (socket) => socket.destroy())
    server.once('error', () => done(null))
    server.once('listening', () => done(server))
    server.listen(port, '127.0.0.1')
  })
}

/** 放手。真的空出来由 `waitFree` 去确认,这里只负责撒手。 */
async function release(server) {
  if (server === null) return
  await shut(server)
}

/** 这个号此刻空着吗。 */
function free(port) {
  return new Promise((done) => {
    const probe = createServer()
    probe.on('connection', (socket) => socket.destroy())
    probe.once('error', () => done(false))
    probe.once('listening', () => { shut(probe).then(() => done(true)) })
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * ⚠️ 杀进程是异步的,端口不会在 `taskkill` 返回的那一刻就空出来。不等这一下,
 * 下一次启动会看见号还被占着而合法地换号——那是一条为了错误理由亮起的红灯。
 */
async function waitFree(port, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await free(port)) return true
    await new Promise((done) => setTimeout(done, 100))
  }
  return false
}

/** 起一台替身沙箱,走真的 `launch()`。 */
function start(name, tag) {
  return launch({
    layout, sandbox: name, engine, logFile: join(box, `${tag}.log`), detached: false,
  })
}

/** 停掉并等号交还。 */
async function shutDown(started) {
  await stop(started.pid, started.pidBorn)
  await waitFree(started.port)
}

console.log('\n沙箱的门牌号跟着沙箱走\n')

// ── 0. 一台从没起过的沙箱,没有号可记 ────────────────────────────────────────
// 先钉住起点:后面「还是那个号」若从一开始就有个号躺在那儿,就什么也没证明。
check('没起过的沙箱不记得任何号', rememberedPort(layout, 'sticky') === null)

// ── 1. 把低位空号按住,逼沙箱拿一个「不是第一个空位」的号 ──────────────────
// ⭐⭐ 这一步就是这册的全部难点。少了它,老的重扫做法也会扫回同一个号,断言
// 照样全绿,而端口其实一点没被记住。
const lowFirst = await findFreePort({ from: SANDBOX_PORT })
const heldFirst = await hold(lowFirst)
const lowSecond = await findFreePort({ from: lowFirst + 1 })
const heldSecond = await hold(lowSecond)
check('⚠️ 先按住基准端口起头的两个空位', heldFirst !== null && heldSecond !== null,
  `${lowFirst}、${lowSecond}`)

let first = null
try {
  first = await start('sticky', 'first')
} catch (error) {
  check('替身沙箱起得来', false, error.code ?? String(error))
}
check('低位被占时,沙箱往上拿到了别的号', first !== null && first.port > lowSecond,
  first === null ? '没起来' : `端口 ${first.port}`)
// 号写进沙箱自己的档案,而不是只活在这次启动的内存里。
check('⭐ 起完之后这台沙箱记下了自己的号',
  first !== null && rememberedPort(layout, 'sticky') === first.port,
  `记的是 ${rememberedPort(layout, 'sticky')}`)

if (first !== null) await shutDown(first)
await release(heldFirst)
await release(heldSecond)
await waitFree(lowFirst)

// ── 2. 停掉再起,还是那个号 ──────────────────────────────────────────────────
// ⚠️ 对照断言。先证明此刻两种做法给的答案不一样,再去问产品给了哪一个;这一条
// 不成立的话,下面那条无论红绿都没测到东西。
const wouldScan = await findFreePort({ from: SANDBOX_PORT })
check('⚠️ 对照:老的「每次重扫」此刻会给出另一个号 —— 证明这一格分得开两种做法',
  first !== null && wouldScan !== first.port, `重扫会拿 ${wouldScan},上次是 ${first?.port}`)

let second = null
try {
  second = await start('sticky', 'second')
} catch (error) {
  check('⭐⭐ 同一台沙箱停掉再起,还是那个号', false, error.code ?? String(error))
}
check('⭐⭐ 同一台沙箱停掉再起,还是那个号',
  second !== null && first !== null && second.port === first.port,
  `${first?.port} → ${second?.port}`)
// 手里那个地址是账上这一行,不是返回值——横幅、窗口、agent 都读它。
check('⭐ 账上写的也是这个号(手里那条链接读的就是它)',
  second !== null && runningRecord(layout, 'sticky')?.port === second.port,
  `账上 ${runningRecord(layout, 'sticky')?.port}`)

if (second !== null) await shutDown(second)

// ── 3. 号被别人占着,照旧换一个,而且不会因此崩掉 ────────────────────────────
// ⭐ 优先不是预留。这里的占位是一个真的 listen,跟被别的沙箱、别的程序占住没有
// 区别——沙箱不该为了要回自己的号而等待、报错或者去抢。
const squatter = await hold(first === null ? SANDBOX_PORT : first.port)
check('⚠️ 先确认占位真的把这个号按住了', squatter !== null, `占住 ${first?.port}`)
check('确认过之后这个号确实不空', !(await free(first === null ? SANDBOX_PORT : first.port)))

let third = null
let thirdError = null
try {
  third = await start('sticky', 'third')
} catch (error) {
  thirdError = error.code ?? String(error)
}
check('⭐⭐ 想要的号被占着时照旧起得来,不会因此崩掉',
  third !== null, thirdError ?? '')
check('⭐ 并且换了一个号,没有去抢别人手里那个',
  third !== null && first !== null && third.port !== first.port,
  `被占的是 ${first?.port},实际拿到 ${third?.port}`)
check('⭐ 换到的号是真在服务的那一个(账上、返回值、地址三处一致)',
  third !== null
    && runningRecord(layout, 'sticky')?.port === third.port
    && third.url === `http://127.0.0.1:${third.port}`,
  third === null ? '' : `${third.url} / 账上 ${runningRecord(layout, 'sticky')?.port}`)
// ⛔ 记的号必须跟着换。否则这台沙箱会一辈子去要一个别人握着的号,每次都落回重扫
// ——功能看着还在,承诺已经名存实亡。
check('⛔ 记下的号跟着换成新的,而不是死抱着要不回来的那个',
  third !== null && rememberedPort(layout, 'sticky') === third.port,
  `记的是 ${rememberedPort(layout, 'sticky')}`)

if (third !== null) await shutDown(third)
await release(squatter)

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
