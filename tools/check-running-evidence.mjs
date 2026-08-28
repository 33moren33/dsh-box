/**
 * 账本不在,不等于没在跑。
 *
 * 实测出来的洞:起一台沙箱 → 手动删掉 `running.json` → 同一个沙箱能起第二台,
 * 两个进程同时指着同一个 `DSH_HOME`。**这正是 08-18 那次把整台 dsh 弄到起不
 * 来的形状。**
 *
 * 病根不是「守卫会猜错」,是**猜错的方向反了**:现在的默认是「没有证据＝安全,
 * 放行」,而这件事的正确默认是「没有证据＝我还得再确认一次」。
 *
 * 日常档案柜那边本来就有第二条路(去敲 3080 看有没有人应答),沙箱没有——它的
 * 端口是启动时现分配的,事先不知道该敲哪儿。所以补的是一份留在 home 里的印记:
 * 它跟它保护的东西住在一起。
 * ⛔ 另一条路已经排除:实测过 dsh 自己**不在** `DSH_HOME` 里留任何锁(跑着和
 * 停掉文件数一样,没有任何只在运行期存在的东西),所以没有现成的可读。
 *
 * ⛔ 用的是几十行的 dsh 替身,不下载真版本、不碰真 Key、不联网。
 *
 * 用法:
 *   node tools/check-running-evidence.mjs <make-test-box 造好的 data 目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const BOX = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (BOX === undefined) {
  console.error('用法: node tools/check-running-evidence.mjs <data 目录>')
  process.exit(2)
}
// ⛔⛔ 空的日常档案柜替身。⭐ 这一套是「查字符串冒充查调用」的活判例:开头那段
//    散文里写着 DSH_HOME,而它一次都没设过 —— 隔离守卫因此一直全绿,直到
//    08-28 把判据从 includes 收紧成「出现在赋值位置」。理由全文＝ tools/fake-daily.mjs。
// ⛔ 摆在参数检查之后:BOX 还没确认时 dirname(undefined) 会先崩。
useFakeDaily(dirname(BOX))

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** Run the command line and return its one JSON line. */
function cli(...argv) {
  return new Promise((done) => {
    // ⛔ DSH_BOX_NO_PANEL:撞上日常档案柜那道闸门时**当场拒绝**,不弹面板等一分钟。
    //   错误码仍是 NEEDS_APPROVAL,所以断言的语义一个字没变 —— 变的只是不会挂住。
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

const sandbox = 'evidence'
const ledger = join(BOX, 'sandboxes', sandbox, 'running.json')
const mark = join(BOX, 'sandboxes', sandbox, 'home', '.dsh-box-running.json')

console.log('\n账本不在,不等于没在跑\n')

const started = await cli('start', sandbox, '--version', '9.9.9-stub', '--no-sign-in')
check('起得来', started.ok === true, started.code ?? started.url)
check('账本写下了', existsSync(ledger))
check('⭐ home 里也留了一份印记', existsSync(mark))

// ⛔ 原样复现那个洞。
rmSync(ledger, { force: true })
check('(把账本删掉了)', !existsSync(ledger))

const blocked = await cli('start', sandbox, '--version', '9.9.9-stub', '--no-sign-in')
check('⛔⛔ 账本没了也拦得住第二台',
  blocked.ok === false && blocked.code === 'SANDBOX_ALREADY_RUNNING', blocked.code)
check('⭐ 而且顺手把账本补回来了——不然别处仍然会说「没在跑」', existsSync(ledger))

const seen = await cli('ls', 'sandbox')
check('列表里照旧看得见它在跑',
  (seen.sandboxes ?? []).some((one) => one.name === sandbox && one.running !== null),
  (seen.sandboxes ?? []).map((one) => `${one.name}:${one.running === null ? '停' : '跑'}`).join('、'))

// 停下来之后两份都要走,否则下次就是反过来的假警报。
const stopped = await cli('stop', sandbox)
check('停得掉', stopped.ok === true, stopped.code ?? 'ok')
check('账本清了', !existsSync(ledger))
check('⭐ 印记也清了,不会留下一个假的「还在跑」', !existsSync(mark))

const again = await cli('start', sandbox, '--version', '9.9.9-stub', '--no-sign-in')
check('停掉之后能正常再起', again.ok === true, again.code ?? again.url)
await cli('stop', sandbox)

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
