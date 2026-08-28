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
import { CREDENTIALS_FILE, claimPath } from '../src/sandbox.js'

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
const daily = join(root, 'fake-daily')
mkdirSync(daily, { recursive: true })
writeFileSync(join(daily, CREDENTIALS_FILE), 'apiKey: not-a-real-key\n')

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
