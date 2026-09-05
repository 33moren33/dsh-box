/**
 * Nothing acts on the everyday cabinet without a person on the panel.
 *
 * ⭐⭐ The rule used to be "only one gate", and the reason was good: prompting
 * for reversible things trains people to click away the one that matters. What
 * changed is the power — dsh-box can rewrite rows it did not write, in the file
 * the user's own `dsh` reads. CEO 2026-08-23: **凡动日常档案柜都拦.**
 *
 * ⛔⛔ 2026-08-28, and this is the part worth reading before changing anything
 * here. The decision said **动** (act on) and what got built said **写** (write
 * to). Five writes were gated and stopping the user's own dsh was not, so the
 * shortest command in the tool could take down the machine somebody is working
 * in. Both `stop main` and `stop --all` are gated now, the latter **partially**:
 * the sandboxes are stopped first and the refusal names them.
 *
 * ⛔⛔ Consent is no longer a word you can type. `--approved` is gone (CEO:
 * 「不留这个参数的后门」); the evidence is that the run is a child of the window
 * on the seat **and** carries the mark the window only sets after somebody
 * answered a request. This file asserts the flag is really gone, because a
 * removal nothing checks for is a removal that comes back.
 *
 * ⚠️ Looking is never gated. An agent has to be able to read a cabinet and say
 * what it found; refusing to *look* would push it back to `cat`, which is the
 * one place this tool cannot show what happened.
 *
 * ⛔ Never touches the real `~/.dsh`: `DSH_HOME` points at a throwaway home,
 * which `userDshHome()` honours. And every run here carries `DSH_BOX_NO_PANEL`,
 * so a refusal is a refusal rather than a minute spent opening a window at
 * somebody who is not watching.
 *
 * Usage: node tools/check-daily-gate.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, removeTree, sandboxPaths, uiSeatFile } from '../src/paths.js'
import { claimPath, noteMainRunning, noteRunning } from '../src/sandbox.js'
import { processStartedAt } from '../src/process-identity.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-daily-gate.mjs <一次性目录>')
  process.exit(2)
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

removeTree(root)
const box = join(root, 'data')
const fakeHome = join(root, 'pretend-daily-home')
mkdirSync(join(fakeHome, 'profiles', 'web'), { recursive: true })
const patchFile = join(fakeHome, 'profiles', 'web', 'cordis.patch.yml')
// ⚠ Somebody else's file, with somebody else's row in it.
const ORIGINAL = `- insert:
    - id: theirs
      name: 'a-plugin-they-installed'
`
writeFileSync(patchFile, ORIGINAL)

const made = await new Promise((done) => {
  spawn(process.execPath, [join(HERE, 'make-test-box.mjs'), root], { stdio: 'ignore', windowsHide: true })
    .once('close', done)
})
if (made !== 0) throw new Error('造不出测试盒')
const layout = boxLayout(box)

/**
 * One command, one JSON line back, against the throwaway daily home.
 *
 * ⭐ `asWindow` is how the window is played, and it is deliberately the same two
 * things the real window does and nothing else: this process holds the seat, so
 * the child's parent is the seat holder; and the child carries the mark the
 * server sets only on the path that follows a click. There is no third thing to
 * pass, which is the property this whole change bought.
 */
function cli(argv, { asWindow = false } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: {
        ...process.env,
        DSH_HOME: fakeHome,
        // ⛔ Without this every refusal below would try to open a window and
        // then wait a minute for somebody to answer it. The switch can only
        // ever refuse faster; there is nothing anywhere that makes it allow.
        DSH_BOX_NO_PANEL: asWindow ? '0' : '1',
        ...(asWindow ? { DSH_BOX_APPROVAL: '1' } : {}),
      },
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', (status) => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        // `exitCode` rides along so the verdict's projection can be asserted
        // beside the verdict itself.
        done({ ...JSON.parse(line ?? ''), exitCode: status })
      } catch {
        done({ ok: false, code: 'NO_OUTPUT', message: out, exitCode: status })
      }
    })
  })
}

/** A process that will still be alive when the ledger row about it is read. */
function bystander() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], {
    stdio: 'ignore', windowsHide: true,
  })
  return { pid: child.pid, pidBorn: processStartedAt(child.pid), child }
}

console.log('\n凡动日常档案柜都拦\n')

// A folder that really is a plugin, so a refusal is about the gate and not
// about the argument.
const source = join(root, 'a-plugin')
mkdirSync(source, { recursive: true })
writeFileSync(join(source, 'package.json'), JSON.stringify({
  name: 'gate-test-plugin', version: '1.0.0', main: 'index.js', dsh: { bundle: {} },
}))
writeFileSync(join(source, 'index.js'), 'export default {}\n')

// ── 写:一律拦 ──────────────────────────────────────────────────────────────

const install = await cli(['get', 'plugin', source, '--to', 'main'])
check('⛔⛔ 往日常档案柜装插件:拦',
  install.ok === false && install.code === 'NEEDS_APPROVAL', install.code)
check('⛔ 拦下来时文件一个字节没动', readFileSync(patchFile, 'utf8') === ORIGINAL)

const uninstall = await cli(['rm', 'plugin', 'theirs', '--from', 'main'])
check('⛔⛔ 从日常档案柜卸插件:也拦',
  uninstall.ok === false && uninstall.code === 'NEEDS_APPROVAL', uninstall.code)

const workspace = await cli(['set', 'workspace', root, '--in', 'main'])
check('⛔ 改日常档案柜的工作区表:拦',
  workspace.ok === false && workspace.code === 'NEEDS_APPROVAL', workspace.code)

const undo = await cli(['set', 'plugin', '--undo', '--in', 'main'])
check('⛔ 往日常档案柜撤销插件配置:拦',
  undo.ok === false && undo.code === 'NEEDS_APPROVAL', undo.code)

const signOut = await cli(['rm', 'signin', '--from', 'main'])
check('⛔ 拿掉日常档案柜的登录:拦',
  signOut.ok === false && signOut.code === 'NEEDS_APPROVAL', signOut.code)

// ⚠ Named by its folder, on purpose: an unknown id is refused as a bad argument
// long before the gate, and a test that stopped there would be asserting on the
// wrong refusal — green for a reason that has nothing to do with permission.
const startWithPlugin = await cli(['start', 'main', '--plugin', source])
check('⛔ start 带 --plugin 动的也是那个文件:拦',
  startWithPlugin.ok === false && startWithPlugin.code === 'NEEDS_APPROVAL', startWithPlugin.code)

// ── ⛔⛔ 停机也拦(2026-08-28 补上的那道缺口) ───────────────────────────────

const daily = bystander()
noteMainRunning(layout, {
  pid: daily.pid,
  pidBorn: daily.pidBorn,
  port: 3080,
  url: 'http://127.0.0.1:3080',
  version: null,
  engine: { kind: 'host', version: null, dir: fakeHome },
  home: fakeHome,
})

const stopMain = await cli(['stop', 'main'])
check('⛔⛔ 停日常档案柜那台:拦(这一条以前零阻拦)',
  stopMain.ok === false && stopMain.code === 'NEEDS_APPROVAL', stopMain.code)
// ⭐ The refusal has to be a refusal. A gate that says no and kills it anyway is
// the failure this suite exists to catch, and asserting only on the code would
// not see it.
check('⛔ 拦下来时那个进程还活着',
  processStartedAt(daily.pid) !== null && processStartedAt(daily.pid) === daily.pidBorn)

// ── ⭐⭐ --all 是部分拦:沙箱照停,日常柜那一台才要点头 ──────────────────────

const guest = bystander()
mkdirSync(sandboxPaths(layout, 'guestbox').root, { recursive: true })
noteRunning(layout, 'guestbox', {
  pid: guest.pid, pidBorn: guest.pidBorn, port: 4000, url: 'http://127.0.0.1:4000', version: null,
})

const all = await cli(['stop', '--all'])
check('⛔⛔ stop --all 现在含日常柜,所以走到那一台会被拦',
  all.ok === false && all.code === 'NEEDS_APPROVAL', all.code)
check('⭐⭐ 而沙箱是真停了 —— 拦在后面,不是拦在前面',
  processStartedAt(guest.pid) === null || processStartedAt(guest.pid) !== guest.pidBorn)
// ⭐ 一条「做了一半」的命令必须自己说做了哪一半。只说「不允许」会让调用方以为
//   什么都没发生,于是再敲一次 —— 而第二次才是读起来像 bug 的那次。
// ⭐ 形状也一起验:成功那条路与拒绝这条路的 `stopped` 必须是同一种东西,
//   否则调用方会在字符串上读 `.sandbox`。
check('⭐⭐ 拒绝里写明了已经停掉哪几台,而且形状和成功时一样',
  Array.isArray(all.stopped) && all.stopped.some((one) => one?.sandbox === 'guestbox'),
  JSON.stringify(all.stopped ?? null))
check('⛔ 日常柜那台还活着',
  processStartedAt(daily.pid) !== null && processStartedAt(daily.pid) === daily.pidBorn)
// ⭐ 做了一半的判词是 partial,退出码 3 —— 不是 1:拿 `== 1` 判「被拒」的调用方
//   会把「沙箱都停了」读成「什么都没停」。
check('⭐⭐ 判词是 partial,退出码 3(做了一半,不是没做)',
  all.verdict === 'partial' && all.exitCode === 3, `verdict=${all.verdict} exit=${all.exitCode}`)

// ── ⛔⛔ 那个旗标必须真的不存在 ────────────────────────────────────────────

const flagAlone = await cli(['get', 'plugin', source, '--to', 'main', '--approved'])
check('⛔⛔ --approved 已经不是这个程序认识的词了(不留这个参数的后门)',
  flagAlone.ok === false && flagAlone.code === 'UNKNOWN_FLAG', flagAlone.code)
check('⭐ 请求本身的错是 error 档,退出码 2(不是关于任何沙箱的判定)',
  flagAlone.verdict === 'error' && flagAlone.exitCode === 2, `verdict=${flagAlone.verdict} exit=${flagAlone.exitCode}`)

// ── 读:一律不拦 ────────────────────────────────────────────────────────────

const look = await cli(['ls', 'plugin', '--in', 'main'])
check('⭐⭐ 只是看:不拦——agent 得能读得出、报得了,否则它只会去用 cat',
  look.ok !== false, look.code ?? 'ok')
check('⭐ 而且真读到了别人装的那一行',
  (look.inventory?.rows ?? []).some((one) => one.id === 'theirs'),
  (look.inventory?.rows ?? []).map((one) => one.id).join('、'))

const listWorkspaces = await cli(['ls', 'workspace', '--in', 'main'])
check('看工作区表:不拦', listWorkspaces.ok !== false, listWorkspaces.code ?? 'ok')

// ── 沙箱那边:什么都不用点头 ────────────────────────────────────────────────

const sandboxInstall = await cli(['get', 'plugin', source, '--to', 'gatebox'])
check('⭐ 沙箱照旧不用点头(删掉就没了,不值得一次弹窗)',
  sandboxInstall.ok === true, sandboxInstall.code ?? 'ok')

// ── 人在面板上点过头 ──────────────────────────────────────────────────────

// ⛔ 座位走产品自己的写入口,夹具不手抄字段。
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:1' })
const approved = await cli(['get', 'plugin', source, '--to', 'main'], { asWindow: true })
check('⭐⭐ 面板起的、且带着「人点过头」那个印记的那次才放行',
  approved.ok === true, approved.code ?? 'ok')
check('⭐ 放行之后别人那一行还在,没被顺手动掉',
  readFileSync(patchFile, 'utf8').includes('a-plugin-they-installed'))

// ⛔ 「印记单独不算数」不在这里验:这个进程正坐在座位上,所以它的每一个子进程
//   都同时满足两条判据,断言无论怎么写都会通过。⭐ 一条它的失败情形在本文件里
//   根本构造不出来的断言,不是一条弱断言,是一条空转的断言。那一条归
//   `check-approval.mjs` —— 那边有真的服务端,面板与请求方是两个进程。

daily.child.kill()
guest.child.kill()
removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
