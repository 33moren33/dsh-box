/**
 * A sign-in is a property of a cabinet, and taking one out is not undoable.
 *
 * Three claims, and the third is the one worth the file:
 *
 *   1. A sandbox's sign-in can be brought in and taken out at will, because it
 *      is a copy — the worst case is copying it again.
 *   2. The daily cabinet's sign-in is **the user's own**, not one this tool
 *      imported, and nothing is backed up when it goes. So it sits behind the
 *      hard gate: refused unless the run came from the config window.
 *   3. ⛔ `set ask-on-daily off` does not open that gate. It used to open
 *      every gate, for every caller — a person ticking "stop asking me" was
 *      quietly handing the same door to anything else on the machine.
 *
 * ⛔ Never touches the real `~/.dsh`: `DSH_HOME` points at a throwaway home
 * with a fake credentials file in it, which is what `userDshHome()` reads.
 *
 * Usage:
 *   node tools/check-sign-in.mjs <一次性目录>
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, removeTree, uiSeatFile } from '../src/paths.js'
import { CREDENTIALS_FILE, claimPath, credentialsState, portableCredentials } from '../src/sandbox.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-sign-in.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
const made = spawnSync(process.execPath, [join(HERE, 'make-test-box.mjs'), root], {
  stdio: 'ignore', windowsHide: true,
})
if (made.status !== 0) throw new Error(`造不出测试盒:${root}`)
const box = join(root, 'data')
const layout = boxLayout(box)

// A stand-in for the user's own cabinet, with something that looks like a
// sign-in in it. Everything below reads this instead of the real home.
//
// ⭐ Shaped like the document dsh actually writes, not like a plausible one.
// Read off a real machine on 2026-09-01: `version: 1` at the top and the
// provider keys under `refs:`, environment-variable name to value. The old
// fixture here was a bare `apiKey:` line, which is a shape dsh has never
// produced — and a fixture we invented can only prove we understand ourselves.
const daily = join(root, 'fake-daily')
mkdirSync(daily, { recursive: true })
writeFileSync(join(daily, CREDENTIALS_FILE), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: not-a-real-key\n')

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * The real command line, one JSON line back, with the fake home in place.
 *
 * ⛔ DSH_BOX_NO_PANEL:撞上闸门时**当场拒绝**,不弹面板等六十秒。错误码仍是
 * NEEDS_APPROVAL,所以下面每一条「没人点头就拒绝」的语义一个字没变。
 */
function cli(...argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      env: { ...process.env, DSH_HOME: daily, DSH_BOX_NO_PANEL: '1' }, windowsHide: true,
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
 * 同一条命令,但这次**扮演配置窗**跑它。
 *
 * ⭐⭐ 08-28 换了机制:同意不再是一个打得出来的词,判据是**父进程正是座位上那个
 * 窗** ＋ 环境里带着 DSH_BOX_APPROVAL=1(src/sandbox.js 的 approvedByWindow)。
 * 这个测试进程两件都做得到而且是诚实的 —— 座位是它自己占的,子进程是它自己起的。
 */
function asWindow(...argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      env: { ...process.env, DSH_HOME: daily, DSH_BOX_APPROVAL: '1' }, windowsHide: true,
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

const sandboxCreds = (name) => join(layout.sandboxes, name, 'home', CREDENTIALS_FILE)

console.log('\n登录是档案柜的属性,拿掉了就没有备份\n')

// ── 0. 「有没有登录」这个判据本身 ─────────────────────────────────────────────
// ⛔⛔ 这一整节是补一个说了两年谎的判据:它原来是 existsSync。而**这个文件是 dsh
//    自己会写的** —— 它每次给浏览器签会话都记在这儿(kind: grant),于是一台从没
//    给过 key 的沙箱,起过一次之后文件就在了。后果有两个,都在下面钉住:
//    start 会承诺「真实计费」,而 --sign-in 会认为已经有了、**一声不响地不干活**。
// ⭐ 四份夹具全部照 dsh 真写出来的形状,⛔ 不是我们觉得合理的形状。
const shapes = join(root, 'shapes')
const shaped = (name, text) => {
  const home = join(shapes, name)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, CREDENTIALS_FILE), text)
  return home
}
check('⭐ refs 里有 provider key → 有登录',
  credentialsState(shaped('refs', 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: x\n')) === 'keys')
check('⛔⛔ 只有 dsh 给自己签的浏览器会话 → 没有登录(这就是那句「真实计费」的假话)',
  credentialsState(shaped('grant', 'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: x\n')) === 'session-only')
check('⭐ records 里的 api-key 算登录,grant 不算',
  credentialsState(shaped('apikey', 'version: 1\nrecords:\n  deepseek/default:\n    kind: api-key\n    key: x\n')) === 'keys')
check('文件不在 → 没有登录', credentialsState(join(shapes, '压根没有这个目录')) === 'none')
check('⭐ 上一代的扁平版式也算有(dsh 不拒它,它会就地改写成 refs)',
  credentialsState(shaped('flat', 'DEEPSEEK_API_KEY: x\n')) === 'keys')
// ⛔ 「读不懂」必须和「没有」分开:把一个有 key 的柜子说成没有,人会照着去配第二个;
//    而这个工具没有 YAML 库,一定存在它看不懂的写法。
check('⛔⛔ 看不懂的文档说看不懂,不说「没有」',
  credentialsState(shaped('multi', 'version: 1\nrefs:\n  A: x\n---\nversion: 1\n')) === 'unreadable')
check('⛔ 顶层出现官方不认的键,也算看不懂(dsh 自己会当场抛)',
  credentialsState(shaped('alien', 'version: 1\napiKey: x\n')) === 'unreadable')
check('⚠️ 注释不算条目',
  credentialsState(shaped('comment', 'version: 1\nrefs:\n  # DEEPSEEK_API_KEY: x\n')) === 'none')

// ── 0b. 搬过去的是钥匙,不是那份文档 ──────────────────────────────────────────
// ⛔⛔ 一份凭证文档里装着两种东西:**内容**(refs 与 api-key 记录,那是用户的钥匙)
//    和**身份**(kind: grant —— dsh 给**那一台**签浏览器 cookie 用的密钥)。
//    整文件复制会把身份也搬过去,于是两个档案柜共用一把签名密钥,一边签的 cookie
//    在另一边也验得过。⭐ 这条规矩是 dsh 自己的:它复制 agent preset 时会重写
//    复制品的元数据,**丢掉源的 name 与名册 order、只留 description**
//    (packages/preset/agent-presets/src/authoring.ts:153-162)。一份复制品不该
//    继承原件的身份 —— 同一条道理,换一个文件。
const mixedDaily = shaped('mixed-daily',
  'version: 1\nrefs:\n  DEEPSEEK_API_KEY: real-key\nrecords:\n'
  + '  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: cookie-signing-secret\n'
  + '  deepseek/spare:\n    kind: api-key\n    key: spare-key\n')
const carried = portableCredentials(mixedDaily)
check('⭐ refs 里的钥匙搬过去了', carried !== null && carried.text.includes('DEEPSEEK_API_KEY: real-key'), String(carried?.refs))
check('⭐ records 里的 api-key 也搬过去了', carried !== null && carried.text.includes('spare-key'), String(carried?.apiKeys))
check('⛔⛔ 而那把 cookie 签名密钥没有跟着走',
  carried !== null && !carried.text.includes('cookie-signing-secret') && carried.droppedGrants === 1,
  `droppedGrants=${carried?.droppedGrants}`)
check('⭐ 搬完的仍是 dsh 读得懂的形状(版本位在,而且判回 keys)',
  carried !== null && carried.text.startsWith('version: 1\n')
  && credentialsState(shaped('carried', carried.text)) === 'keys')
// ⛔ 上一代扁平版式:搬过去时顺手升级成 refs —— 与 dsh 自己那次就地升级同一个结果,
//    ⛔ 不是我们发明的形状。
const flatCarried = portableCredentials(shaped('flat-src', 'DEEPSEEK_API_KEY: x\n'))
check('⭐ 扁平版式搬过去时升级成 version:1 + refs',
  flatCarried !== null && flatCarried.text === 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: x\n', JSON.stringify(flatCarried?.text))
check('⛔ 源那边只有浏览器会话时,没东西可搬,说没有',
  portableCredentials(shaped('grant-src', 'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      secret: s\n')) === null)
check('⛔ 读不懂的源不许硬搬(半份凭证比没有更坏)',
  portableCredentials(shaped('bad-src', 'version: 1\napiKey: x\n')) === null)

// 1. A sandbox born without one, then given one, then relieved of it.
await cli('start', 'plain', '--version', '9.9.9-stub', '--no-sign-in')
await cli('stop', 'plain')
check('新沙箱带 --no-sign-in:里面没有登录', !existsSync(sandboxCreds('plain')))

const brought = await cli('get', 'signin', '--to', 'plain')
check('get signin 之后有了', brought.ok === true && existsSync(sandboxCreds('plain')), brought.code ?? 'ok')

const again = await cli('get', 'signin', '--to', 'plain')
check('再来一次不报错,只说本来就有', again.ok === true && again.imported === false, String(again.imported))

const gone = await cli('rm', 'signin', '--from', 'plain')
check('rm signin 之后没了', gone.ok === true && !existsSync(sandboxCreds('plain')), gone.code ?? 'ok')
check('沙箱那一侧不需要任何人点头', gone.removed === true)

// 1b. ⛔⛔ 2026-08-30 的判例,也是这一族此前唯一没被盯住的一格:**重开**一台已经
//     存在、而且里面没有登录的沙箱。不写任何登录旗标时必须什么都不改。
//     此前它会顺手补一份进去 —— 于是配置窗里那个明明没勾的勾,启动之后自己变回
//     勾上,而人接着据此排查,前提是假的。
// ⭐ 出生那一刻仍然默认带上,两者不是一回事:新柜没有「原本的样子」可以保。
//    这一格与上面 `plain` 那一格合起来才是完整的规则。
await cli('start', 'born', '--version', '9.9.9-stub')
await cli('stop', 'born')
check('新沙箱不写旗标:出生时带上登录', existsSync(sandboxCreds('born')))

await cli('rm', 'signin', '--from', 'born')
await cli('start', 'born', '--version', '9.9.9-stub')
await cli('stop', 'born')
check('⛔⛔ 重开一台没有登录的旧沙箱,不写旗标就不会凭空出现一份',
  !existsSync(sandboxCreds('born')))

await cli('start', 'born', '--version', '9.9.9-stub', '--sign-in')
await cli('stop', 'born')
check('⭐ 明说 --sign-in,才拿得到', existsSync(sandboxCreds('born')))

// 2. The daily cabinet is the source, so importing into it means nothing.
const silly = await cli('get', 'signin', '--to', 'main')
check('⛔ 往日常档案柜「导入它自己」被明确拒绝,而不是默默点头',
  silly.ok === false && silly.code === 'MAIN_IS_THE_SOURCE', silly.code)

// 3. The hard gate, three ways round it that must all fail.
const bare = await cli('rm', 'signin', '--from', 'main')
check('⛔⛔ 拿掉日常档案柜的登录:没人点头就拒绝',
  bare.ok === false && bare.code === 'NEEDS_APPROVAL', bare.code)
check('⛔ 拒绝时那份登录一个字节都没动', existsSync(join(daily, CREDENTIALS_FILE)))

// ⭐⭐ 同一条断言,换了个更强的说法。原来问的是「自己把 --approved 打出来也不
//    算数」;08-28 之后**这个词根本打不出来了**(CEO:「不留这个参数的后门」),
//    所以它现在连命令都不成立。语义没变、而且变严了:同意从「写了不算数」变成
//    「写不出来」。⛔ 断言换的是命令,不是它要守的那件事。
const flagAlone = await cli('rm', 'signin', '--from', 'main', '--approved')
check('⛔⛔ 同意打不出来——`--approved` 已经不是一个旗标了',
  flagAlone.ok === false && flagAlone.code === 'UNKNOWN_FLAG', flagAlone.code)
check('⛔ 那一步没走到登录那儿去', existsSync(join(daily, CREDENTIALS_FILE)))

await cli('set', 'ask-on-daily', 'off')
const quieted = await cli('rm', 'signin', '--from', 'main')
check('⛔⛔ 关掉「下次不再提醒」也不算数——那是窗口的偏好,不是通行证',
  quieted.ok === false && quieted.code === 'NEEDS_APPROVAL', quieted.code)
check('⛔ 三次都被拒之后,登录还在', existsSync(join(daily, CREDENTIALS_FILE)))

// 4. And now as the window: hold the seat, run the command line as a child.
// ⛔ 座位走产品自己的写入口,夹具不手抄它的字段。
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10130' })
const byWindow = await asWindow('rm', 'signin', '--from', 'main')
check('⭐ 人在配置窗里点过头,才真的拿掉',
  byWindow.ok === true && !existsSync(join(daily, CREDENTIALS_FILE)), byWindow.code ?? 'ok')
rmSync(uiSeatFile(layout), { force: true })

const empty = await cli('rm', 'signin', '--from', 'plain')
check('⭐ 已经没有的再拿一次,不报错也不假装做了事',
  empty.ok === true && empty.removed === false, String(empty.removed))

removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
