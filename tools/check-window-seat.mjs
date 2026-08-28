/**
 * 配置窗有「开」,也得有「关」——否则被强杀之后没人收拾得了它。
 *
 * 实测出来的死局:一个数据目录只允许一个配置窗服务,而那个服务是 exe 起的
 * **子进程**。exe 被强杀时,它在 Windows 上活得比父进程久,于是端口和座位一直
 * 被占着,`ui` 从此永远被拒。CEO 机器上就躺着一个这样的孤儿(父进程号 4836
 * 早已不在,而它还听着 10130)。
 *
 * ⛔ 在 `stop --window` 之前,这个工具里**没有任何命令**能收拾它——只能自己去找出
 * 进程号 `taskkill`。而那正是本项目自己那条判据说的病:**只给了「做」,没给
 * 配套的「撤」,于是 agent 必然掉出边界外去动手,而人视图一概看不见。**
 *
 * ⛔ 这一条不并进 `stop --all`。停「每一台档案柜」跟关「那扇配置窗」是两件事,
 * 让前者顺手把窗口也关掉的提案 08-21 被提出过又被撤回:正确方向是窗口自己去调
 * `stop --all`。所以下面第二组专门断言 **`stop --all` 不关窗口**——它不是缺陷,
 * 是裁决,写成断言免得下一任「顺手修好」它。
 * ⚠️ 08-28 之后 `--all` 的范围含日常档案柜了,但这套验收的盒子里从来没有起过
 * 日常那一台,所以它走不到那道闸门,断言的语义没变。
 *
 * ⭐⭐ 第四组是必然会输的对照组:座位上写一个**活着但已经不是它**的进程号
 * (号码对、出生时刻不对,＝号码被回收)。`stop --window` 必须**不杀它**。这一条一旦
 * 不通过,就是这条命令会杀掉用户机器上一棵与我们无关的进程树。
 *
 * ⛔ 全程不碰真 `~/.dsh`、不联网、不下载:起的是配置窗服务本身,绑在 127.0.0.1
 * 上,不开浏览器,收尾时全部停掉。
 *
 * 用法:
 *   node tools/check-window-seat.mjs <一次性目录>
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// ⛔ Not `fetch` with an undici Agent: this repository's one promise about
// dependencies is "Node 20+, nothing else", and a check that needs a package
// installed would be the first crack in it. `node:http` gives the one thing
// this needs — a client that really holds its socket open.
import { Agent, request as httpRequest } from 'node:http'
import { Socket } from 'node:net'
import { removeTree } from '../src/paths.js'
import { processStartedAt } from '../src/process-identity.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-window-seat.mjs <一次性目录>')
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

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms) })

/** 跑一条真命令,拿它那一行 JSON。 */
function cli(...argv) {
  return new Promise((done) => {
    // ⛔ DSH_BOX_NO_PANEL:撞上日常档案柜那道闸门时当场拒绝,不弹面板等一分钟。
    //   错误码仍是 NEEDS_APPROVAL,断言的语义一个字没变 —— 变的只是不会挂住。
    //   ⚠️ 对这一套还有第二层意义:弹面板会自己去起一个配置窗,而这里满篇都在
    //   数「座位上是谁」,凭空多一个窗口会把每一条都搅乱。
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true, env: { ...process.env, DSH_BOX_NO_PANEL: '1' },
    })
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

/**
 * 起一个**没人牵着**的配置窗服务。
 *
 * ⭐ 故意 `detached` 且不留句柄:这一条要测的正是「起它的那个东西已经不在了」,
 * 用 `child.kill()` 收得掉的进程根本不是本题里的那种孤儿。
 * @param {number} port
 */
function orphanWindow(port) {
  const child = spawn(process.execPath, [CLI, 'ui', '--port', String(port), '--no-open', '--box', box], {
    detached: true, stdio: 'ignore', windowsHide: true,
  })
  child.unref()
}

/** 等座位上写出这个端口,拿到那条记录。 */
async function seated(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(seat)) {
      try {
        const held = JSON.parse(readFileSync(seat, 'utf8'))
        if (typeof held.url === 'string' && held.url.includes(String(port))) return held
      } catch { /* 正在写 */ }
    }
    await sleep(100)
  }
  return null
}

/** 这个号码上还有进程吗。 */
function numberInUse(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 等一个进程号真的空出来,而不是等一个猜出来的毫秒数。 */
async function vacated(pid, within = 8000) {
  const deadline = Date.now() + within
  while (Date.now() < deadline) {
    if (!numberInUse(pid)) return true
    await sleep(100)
  }
  return !numberInUse(pid)
}

/** 一个会活一阵子的无关进程,用来冒充座位上那个号码。 */
function bystander() {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
    stdio: 'ignore', windowsHide: true,
  })
}

console.log('\n配置窗有开,也得有关\n')

// —— 一、什么都没开的时候,如实说没有,而不是假装停掉了什么。
const nothing = await cli('stop', '--window')
check('⭐ 没有窗口时:说没有,不假装停了什么',
  nothing.ok === false && nothing.code === 'NO_WINDOW_SERVING', nothing.code)

// —— 二、死局本身:一个没人牵着的服务占着座位。
orphanWindow(10181)
const held = await seated(10181)
check('⭐ 孤儿服务起来了,座位上写着它', held !== null, held?.url ?? '(座位是空的)')

const refused = await cli('ui', '--port', '10182', '--no-open')
check('⛔⛔ 这就是那个死局:座位被活着的孤儿占着,再开一个永远被拒',
  refused.ok === false && refused.code === 'UI_ALREADY_SERVING', refused.code)

// ⛔ 裁决,不是缺陷:`stop --all` 停的是档案柜,不关窗口。写成断言,免得下一任把它
//    「顺手修好」——那会让一个人的命令关掉另一个人正在看的视图。
const quitted = await cli('stop', '--all')
await sleep(500)
check('⛔ stop --all 不关窗口(这是裁决,不是漏做):它之后座位照旧',
  quitted.ok === true && numberInUse(held.pid), `stop --all 的 ok=${quitted.ok}`)

// —— 三、缺掉的那个「撤」。
const stopped = await cli('stop', '--window')
check('⭐⭐ stop --window 关得掉它', stopped.ok === true && stopped.killed === true, stopped.code ?? `killed=${stopped.killed}`)
// ⚠️ 细节只在没通过时才说得出口:写死一句「还在」会让通过的那一行自相矛盾。
check('⭐ 它真的死了', await vacated(held.pid), numberInUse(held.pid) ? `进程号 ${held.pid} 还占着` : '')
check('⭐ 座位跟着松手', !existsSync(seat))

orphanWindow(10183)
const again = await seated(10183)
check('⭐⭐ 收拾完之后,窗口重新开得起来(死局解开了)', again !== null, again?.url ?? '(座位是空的)')
await cli('stop', '--window')
await vacated(again?.pid ?? 0)

// —— 四、座位上那个进程已经不在:那不是窗口,是强杀留下的垃圾。
writeFileSync(seat, `${JSON.stringify({ pid: 999_999, pidBorn: 1, url: 'http://127.0.0.1:10184' })}\n`)
const litter = await cli('stop', '--window')
check('⛔ 遗留座位:说没有开着的窗口,并顺手清掉那份记录',
  litter.ok === false && litter.code === 'NO_WINDOW_SERVING' && litter.cleared === true,
  `${litter.code} cleared=${litter.cleared}`)
check('⭐ 那份记录确实清掉了', !existsSync(seat))

// —— 五、⭐⭐ 必然会输的对照组:号码被回收。座位上那个号码有进程在,
//    但它的出生时刻对不上,所以**不是我们的窗口**。
const impostor = bystander()
await sleep(300)
const trueBorn = processStartedAt(impostor.pid)
writeFileSync(seat, `${JSON.stringify({
  pid: impostor.pid, pidBorn: trueBorn === null ? 1 : trueBorn - 1000, url: 'http://127.0.0.1:10185',
})}\n`)
const stranger = await cli('stop', '--window')
check('⛔⛔ 号码对、出生时刻不对:一律当没有窗口,不动它',
  stranger.ok === false && stranger.code === 'NO_WINDOW_SERVING', stranger.code)
// ⭐ 反过来等:给它一秒钟去死,证明它**没有**死。
await sleep(1000)
check('⛔⛔ 那个无关进程还活着(这条一旦不通过,就是真的杀错了人)',
  impostor.exitCode === null && impostor.signalCode === null,
  `exitCode=${impostor.exitCode} signal=${impostor.signalCode}`)
impostor.kill()

// —— 六、⛔⛔ 「关闭 box」要真的关掉,而不只是宣布关掉。
//    实测出来的:浏览器一直挂着一条 keep-alive 长连接,而 `server.close()` 只停
//    「接受新连接」,然后等所有连接自己结束。于是端口放了、进程不退、座位不清,
//    下一次启动被一个「活着但已经不在听」的座位拦下,而它指的地址没人应答。
//    从外面看就是「我点了关闭,它没关,而且从此双击一直没反应」。
const port = 10186
orphanWindow(port)
const serving = await seated(port)
check('⭐ 起了一台用来验退出的窗口', serving !== null, serving?.url ?? '(座位是空的)')

// ⭐ 夹具必须是真的挂着一条连接的客户端 —— 这个 bug 只在有人握着长连接时出现,
//    用一次性的 fetch 去测,它会永远通过。
const keepAlive = new Agent({ keepAlive: true, maxSockets: 4 })

/** One request over a socket that stays open afterwards, the way a tab does. */
function overOneSocket(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const call = httpRequest(
      { host: '127.0.0.1', port, path, method, headers, agent: keepAlive },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { text += chunk })
        response.once('end', () => done(text))
      },
    )
    call.once('error', fail)
    call.end(body)
  })
}

const pass = (await overOneSocket('/')).match(/const PASS = '([^']+)'/)?.[1]
check('⭐ 拿到了页面带的通行证(下一步要照页面那条路发命令)', typeof pass === 'string')

// ⛔⛔ 这一条是整段的要害,而且**第一版没有它,于是在旧代码上照样通过**——
// 按本仓的规矩,那样的测试什么都没证明。
//
// 为什么普通的长连接测不出来:Node 的服务器有 5 秒空闲超时,会自己把闲着的连接
// 掐掉;`close()` 之后的应答又带 `Connection: close`。所以一条「乖乖的」连接
// 顶多让退出慢几秒。⭐ 真正会卡死的是**服务器自己结束不了的那种连接** ——
// 真现场里它是浏览器(实测:改之前 8 秒后进程与座位都还在,改之后 1 秒内全清),
// 这里用一条**只发了一半请求头、再也不往下发**的裸连接当它的替身:确定性、
// 不需要浏览器,而且撞的是同一条规矩 —— `close()` 只是不再收新连接,它管不着
// 已经在手上的这一条。
const stalled = new Socket()
await new Promise((done, fail) => {
  stalled.once('error', fail)
  stalled.connect(port, '127.0.0.1', done)
})
stalled.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`)
await sleep(300)

const quit = JSON.parse(await overOneSocket('/api/command', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-dsh-box-pass': pass ?? '' },
  body: JSON.stringify({ argv: ['stop', '--all'] }),
}))
check('⭐ 页面那条「关闭 box」发出去了', quit.ok === true, quit.code ?? '')

const wentAway = await vacated(serving?.pid ?? 0, 10_000)
check('⛔⛔ 说了关闭就真的退出 —— 有一条它自己结束不了的连接挂着也照退', wentAway,
  wentAway ? '' : `进程号 ${serving?.pid} 还占着(那条半截连接把它焊住了)`)
check('⭐ 座位跟着松手 —— 否则下一次启动会被一个不在听的座位拦下', !existsSync(seat))
stalled.destroy()
keepAlive.destroy()

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
