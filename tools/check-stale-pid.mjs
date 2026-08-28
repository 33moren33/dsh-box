/**
 * 账本里的进程号,不等于那个进程还是我们的。
 *
 * 实测出来的洞:一条 2026-08-21 写下的账本记录记着进程号 6772,五天后机器重启
 * 过,6772 已经被系统分给一个叫 LCD_Service 的显示服务。配置窗照样把那台沙箱
 * 画成「正在运行」,还给了「停止」按钮——而那个按钮走的是 `taskkill /T /F`,
 * **会把那个显示服务连同它的子进程一起杀掉**。
 *
 * ⛔ 病根不在某一行,在一个被写进注释的判断:`pidAlive()` 只问「这个号码上有
 * 没有进程」,并且注明这个风险「可以接受,代价是一次被拒绝的启动,不是数据丢
 * 失」。**代价被低估了整整一个数量级**——真实代价是杀掉用户机器上一棵与我们
 * 无关的进程树。
 *
 * 补的是两层:
 *   读的时候——账本记的时刻早于本次开机,那条一定是鬼影,连问都不用问(免费);
 *   杀之前——核对那个进程自己的启动时刻。冒名者**必然**晚于账本那一行被写下,
 *   因为我们的进程当时还活着,号码只能在它退出之后才轮到别人。
 *
 * ⛔ 全程不碰真沙箱、不下载、不联网:冒名的进程是本文件自己起的一个 sleep。
 *
 * 用法:
 *   node tools/check-stale-pid.mjs <make-test-box 造好的 data 目录>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processStartedAt } from '../src/process-identity.js'
import { stop } from '../src/launch.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const BOX = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (BOX === undefined) {
  console.error('用法: node tools/check-stale-pid.mjs <data 目录>')
  process.exit(2)
}
// ⛔⛔ 空的日常档案柜替身。不设它,这套验收读的就是**跑测试那个人真实的 ~/.dsh**,
//    于是「通过」的理由里混进了他机器上碰巧装了什么。理由全文＝ tools/fake-daily.mjs。
// ⛔ 摆在参数检查之后:BOX 还没确认存在时 dirname(undefined) 会先崩,
//    而那时报的是一句跟用法无关的类型错误。
useFakeDaily(dirname(BOX))

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** 跑一条命令,拿它那一行 JSON。 */
function cli(...argv) {
  return new Promise((done) => {
    // ⛔ DSH_BOX_NO_PANEL:撞上日常档案柜那道闸门时当场拒绝,不弹面板等一分钟。
    //   错误码仍是 NEEDS_APPROVAL,断言的语义一个字没变 —— 变的只是不会挂住。
    const child = spawn(process.execPath, [CLI, ...argv, '--box', BOX, '--json'], {
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

/** 一个会活一阵子的进程,用来冒充账本上那个号码。 */
function bystander() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
    stdio: 'ignore', windowsHide: true,
  })
  return child
}

/** 直接写一条账本记录,身份凭据由调用方指定。 */
function writeLedger(sandbox, pid, pidBorn) {
  const dir = join(BOX, 'sandboxes', sandbox)
  mkdirSync(join(dir, 'home'), { recursive: true })
  writeFileSync(join(dir, 'sandbox.json'), `${JSON.stringify({ name: sandbox }, null, 2)}\n`)
  const row = {
    pid, port: 3999, url: 'http://127.0.0.1:3999', version: '9.9.9-stub',
    engine: { kind: 'release', version: '9.9.9-stub', dir: null },
    startedAt: new Date().toISOString(),
  }
  // `undefined` 表示「这一行根本没有身份凭据」——上一版写下的行就是这个样子。
  if (pidBorn !== undefined) row.pidBorn = pidBorn
  writeFileSync(join(dir, 'running.json'), `${JSON.stringify(row, null, 2)}\n`)
}

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms) })

/**
 * 等一个子进程真的退出,最多等这么久。
 *
 * ⚠️ 不用固定的 sleep:第一版死等 800 毫秒,在 x86 笔记本上够,在这台 aarch64
 * 手机上不够,于是对照组报出「没杀掉」——那是机器慢,不是守卫坏。**凡是断言
 * 「某件事发生了」,等待就该等到它发生或超时,不能等一个猜出来的毫秒数。**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} within
 * @returns {Promise<boolean>} 是否已经退出。
 */
async function gone(child, within = 8000) {
  const deadline = Date.now() + within
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true
    await sleep(100)
  }
  return child.exitCode !== null || child.signalCode !== null
}

console.log('\n账本里的进程号,不等于那个进程还是我们的\n')

// —— 一、冒名者:进程确实活着,但账本记下的出生时刻不是它的。
//    这正是「号码被回收」在盘上的样子:行还在,人已经换了。
const impostor = bystander()
await sleep(300)
const trueBorn = processStartedAt(impostor.pid)
writeLedger('冒名', impostor.pid, trueBorn === null ? 1 : trueBorn - 1000)

const refused = await cli('stop', '冒名')
// ⭐ 连杀那一步都走不到:读的那一侧先认出出生时刻对不上,把这一行判成「没在跑」。
// 拦在更早的地方是更好的结果,所以这里等的是 NOT_RUNNING,不是「杀了但没杀成」。
check('⛔⛔ 没有杀它 —— 号码对得上,出生时刻对不上,读的那一侧就先拦下了',
  refused.ok === false && refused.code === 'NOT_RUNNING', refused.code ?? `killed=${refused.killed}`)
// ⭐ 反过来等:给它一秒钟去死,证明它**没有**死。
await sleep(1000)
check('⛔⛔ 那个无关进程还活着(这条一旦不通过,就是真的杀错了人)',
  impostor.exitCode === null && impostor.signalCode === null,
  `exitCode=${impostor.exitCode} signal=${impostor.signalCode}`)

// —— 二、读的那一侧也不许显示它。杀得对,但界面上照画一台「正在运行」,
//    人还是会去按那个按钮。
const stillThere = await cli('ls', 'sandbox')
const ghost = (stillThere.sandboxes ?? []).find((entry) => entry.name === '冒名')
check('⛔⛔ 界面这一侧也不认它 —— 不显示成正在运行',
  ghost === undefined || ghost.running === null,
  ghost === undefined ? '(记录已清)' : JSON.stringify(ghost.running))
// ⭐ 再单独验一次杀的那一侧本身。上面那条被读的一侧提前拦住了,而 stop 里的
//    那道证明是给一个更窄的缝准备的:读完之后、动手之前,进程正好死掉且号码
//    被人接手。直接调它,才测得到那道防线。
const raceProof = await stop(impostor.pid, (processStartedAt(impostor.pid) ?? 0) - 1000)
check('⛔⛔ 直接调 stop 也不动手 —— 凭据对不上就是不杀', raceProof === false, `返回 ${raceProof}`)
await sleep(600)
check('⛔ 它仍然活着', impostor.exitCode === null && impostor.signalCode === null,
  `exitCode=${impostor.exitCode} signal=${impostor.signalCode}`)
impostor.kill()

// —— 三、对照组:同一套路,但这次把真的出生时刻写进去。
//    ⭐ 它必须被杀掉。这一组要是也「没杀」,上面两条通过就毫无意义——
//    只能证明这个功能坏了,不能证明它认得出冒名者。
const ours = bystander()
await sleep(300)
writeLedger('自己的', ours.pid, processStartedAt(ours.pid))

const killed = await cli('stop', '自己的')
check('⭐ 对照组:出生时刻逐值相等 —— 认得出是自己的,照杀', killed.killed === true, `killed=${killed.killed}`)
check('⭐ 对照组真的死了', await gone(ours),
  `exitCode=${ours.exitCode} signal=${ours.signalCode}`)
ours.kill()

// —— 四、没有身份凭据的行(上一版写下的那种)。⛔ 不给「大概是吧」这个选项。
const nameless = bystander()
await sleep(300)
writeLedger('旧格式', nameless.pid, undefined)
const oldRow = await cli('ls', 'sandbox')
const older = (oldRow.sandboxes ?? []).find((entry) => entry.name === '旧格式')
check('⛔ 行里没有身份凭据 —— 一律当没在跑,不去猜',
  older !== undefined && older.running === null,
  older === undefined ? '没找到这台沙箱' : JSON.stringify(older.running))
nameless.kill()

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
