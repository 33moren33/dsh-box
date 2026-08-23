/**
 * Nothing changes the everyday cabinet without a person in the window.
 *
 * ⭐⭐ The rule used to be "only one gate", and the reason was good: prompting
 * for reversible things trains people to click away the one that matters. What
 * changed is the power — this round gives dsh-box the ability to rewrite rows
 * it did not write, in the file the user's own `dsh` reads. CEO 2026-08-23:
 * **凡动日常档案柜都拦.**
 *
 * ⛔⛔ The gate lives in `cabinetTarget`, the one place a cabinet gets chosen,
 * rather than in each command. That is not tidiness: the per-command shape had
 * already missed two — `plugins install --main` and `plugins uninstall --main`
 * both wrote the real `~/.dsh` and answered `ok:true` with nobody asked. A rule
 * that each new command has to remember is a rule that will be skipped, so the
 * judgement goes in the funnel and new commands inherit it.
 *
 * ⚠️ Looking is never gated. An agent has to be able to read a cabinet and say
 * what it found; refusing to *look* would push it back to `cat`, which is the
 * one place this tool cannot show what happened.
 *
 * ⛔ Never touches the real `~/.dsh`: `DSH_HOME` points at a throwaway home,
 * which `userDshHome()` honours.
 *
 * Usage: node tools/check-daily-gate.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, removeTree, uiSeatFile } from '../src/paths.js'

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

/** One command, one JSON line back, against the throwaway daily home. */
function cli(argv, { asWindow = false } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      // ⭐ `--approved` is not a request but a test: approval means the config
      // window started this run. A child of this process is what the window's
      // buttons produce, so holding the seat is how the window is played.
      env: { ...process.env, DSH_HOME: fakeHome },
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        done(JSON.parse(line ?? ''))
      } catch {
        done({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
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

const install = await cli(['plugins', 'install', source, '--main'])
check('⛔⛔ 往日常档案柜装插件:拦下来了(这一条以前是不拦的)',
  install.ok === false && install.code === 'NEEDS_APPROVAL', install.code)
check('⛔ 拦下来时文件一个字节没动', readFileSync(patchFile, 'utf8') === ORIGINAL)

const uninstall = await cli(['plugins', 'uninstall', 'theirs', '--main'])
check('⛔⛔ 从日常档案柜卸插件:也拦(这一条以前也不拦)',
  uninstall.ok === false && uninstall.code === 'NEEDS_APPROVAL', uninstall.code)

const workspace = await cli(['workspaces', 'use', root, '--main'])
check('⛔ 改日常档案柜的工作区表:拦',
  workspace.ok === false && workspace.code === 'NEEDS_APPROVAL', workspace.code)

const restore = await cli(['plugins', 'restore', '--main'])
check('⛔ 往日常档案柜还原备份:拦',
  restore.ok === false && restore.code === 'NEEDS_APPROVAL', restore.code)

const flagAlone = await cli(['plugins', 'install', source, '--main', '--approved'])
check('⛔⛔ 自己带 --approved 不算数——那是判据不是请求',
  flagAlone.ok === false && flagAlone.code === 'NEEDS_APPROVAL', flagAlone.code)

// ⚠ Registered first, on purpose: an unknown id is refused as a bad argument
// long before the gate, and a test that stopped there would be asserting on the
// wrong refusal — green for a reason that has nothing to do with permission.
await cli(['plugins', 'add', source, '--id', 'gate-test'])
const startWithPlugin = await cli(['start', '--main', '--plugin', 'gate-test'])
check('⛔ start 带 --plugin 动的也是那个文件:拦',
  startWithPlugin.ok === false && startWithPlugin.code === 'NEEDS_APPROVAL', startWithPlugin.code)
// ⚠️ "A plain `start --main` is not gated" is deliberately *not* asserted here.
// Asserting it means actually starting one, and the only way to do that without
// launching the user's own dsh is with a stand-in version — which is the one
// combination that has always been gated (`--main` ＋ `--version`), so the
// assertion would pass for the wrong reason. `check-main-ledger` starts that
// path for real and covers it.
// ⭐ The first draft of this line asserted `code !== 'NEEDS_APPROVAL'` against
// a flag that does not exist; it went green on `UNKNOWN_FLAG` and proved
// nothing. An assertion whose failure case you cannot name will not fail.

// ── 读:一律不拦 ────────────────────────────────────────────────────────────

const look = await cli(['plugins', '--main'])
check('⭐⭐ 只是看:不拦——agent 得能读得出、报得了,否则它只会去用 cat',
  look.ok !== false, look.code ?? 'ok')
check('⭐ 而且真读到了别人装的那一行',
  (look.inventory?.rows ?? []).some((one) => one.id === 'theirs'),
  (look.inventory?.rows ?? []).map((one) => one.id).join('、'))

const listBackups = await cli(['plugins', 'backups', '--main'])
check('看备份列表:不拦', listBackups.ok !== false, listBackups.code ?? 'ok')

const listWorkspaces = await cli(['workspaces', '--main'])
check('看工作区表:不拦', listWorkspaces.ok !== false, listWorkspaces.code ?? 'ok')

// ── 沙箱那边:什么都不用点头 ────────────────────────────────────────────────

const sandboxInstall = await cli(['plugins', 'install', source, '--sandbox', 'gatebox'])
check('⭐ 沙箱照旧不用点头(删掉就没了,不值得一次弹窗)',
  sandboxInstall.ok === true, sandboxInstall.code ?? 'ok')

// ── 人在窗口里点过头 ──────────────────────────────────────────────────────

writeFileSync(uiSeatFile(layout), `${JSON.stringify({
  pid: process.pid, url: 'http://127.0.0.1:1', startedAt: new Date().toISOString(),
}, null, 2)}\n`)
const approved = await cli(['plugins', 'install', source, '--main', '--approved'])
check('⭐⭐ 配置窗起的那次才放行', approved.ok === true, approved.code ?? 'ok')
check('⭐ 放行之后别人那一行还在,没被顺手动掉',
  readFileSync(patchFile, 'utf8').includes('a-plugin-they-installed'))

removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
