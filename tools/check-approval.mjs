/**
 * Consent is a click on the panel, and there is no other way to produce it.
 *
 * ⭐⭐ Why this suite exists and `check-daily-gate.mjs` is not enough. That one
 * runs the command line with the seat held by the test process itself, so every
 * child of it satisfies both halves of the check at once and the interesting
 * negative — "the window started it, but nobody agreed" — cannot be built there
 * at all. Here the window is a **real separate process** serving over HTTP, so
 * asking it to run something and answering a question it asked are two
 * different acts, which is exactly the distinction the 2026-08-28 change is.
 *
 * ⛔⛔ The hole this closes, stated plainly so it is not rediscovered: the old
 * evidence was "`--approved` was passed **and** the parent is the window". The
 * page decided when to add the flag, and *anything* that can post to
 * `/api/command` is served by that window and inherits the same parentage. So
 * one POST with the flag in the argument list was consent. Now the flag does
 * not exist, and the window only marks a run as agreed on the one code path
 * that follows an answer to a specific request.
 *
 * ⚠️ What this does **not** claim. `/api/approve` is reachable by anything that
 * can read the page's pass off the local port, so an agent determined to go
 * around the gate still can — deliberately, visibly, and in the operation
 * record. Closing that needs consent to arrive from outside HTTP, which the
 * browser face cannot offer. The property being tested is that the *ordinary*
 * route cannot be walked without a person, not that the machine is sealed.
 *
 * ⛔ Never touches the real `~/.dsh`: `DSH_HOME` points at a throwaway home.
 *
 * Usage: node tools/check-approval.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, removeTree, uiSeatFile } from '../src/paths.js'
import { liveClaim } from '../src/sandbox.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-approval.mjs <一次性目录>')
  process.exit(2)
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms) })

removeTree(root)
const box = join(root, 'data')
const fakeHome = join(root, 'pretend-daily-home')
mkdirSync(join(fakeHome, 'profiles', 'web'), { recursive: true })
const patchFile = join(fakeHome, 'profiles', 'web', 'cordis.patch.yml')
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

const source = join(root, 'a-plugin')
mkdirSync(source, { recursive: true })
writeFileSync(join(source, 'package.json'), JSON.stringify({
  name: 'approval-test-plugin', version: '1.0.0', main: 'index.js', dsh: { bundle: {} },
}))
writeFileSync(join(source, 'index.js'), 'export default {}\n')

console.log('\n同意只能来自面板上的一次点击\n')

// ── 起一扇真的窗 ───────────────────────────────────────────────────────────

// ⛔ `--no-open` because a browser opening during a test is a browser nobody
// closes; the service is the whole of what is being tested.
const window_ = spawn(process.execPath, [CLI, 'ui', '--port', '0', '--no-open', '--json', '--box', box], {
  windowsHide: true,
  env: { ...process.env, DSH_HOME: fakeHome },
})
let windowOut = ''
window_.stdout.on('data', (chunk) => { windowOut += chunk })
window_.stderr.resume()

/**
 * Where the window is, and the pass its page carries.
 *
 * ⭐ Both are taken the way anything on this machine could take them: the
 * address off the seat file the window writes, and the pass out of the page the
 * window serves. That is not a shortcut around the test — it **is** the limit
 * being documented at the top of this file, reproduced honestly rather than
 * described. A test that had privileged access to the pass would be proving
 * something no attacker and no agent has to do.
 */
const served = await (async () => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const seated = liveClaim(uiSeatFile(layout))
    if (typeof seated?.url === 'string') {
      const page = await fetch(seated.url).then((one) => one.text()).catch(() => '')
      const pass = /const PASS = '([^']+)'/.exec(page)?.[1]
      if (pass !== undefined && pass !== '__DSH_BOX_PASS__') return { url: seated.url, pass }
    }
    await sleep(150)
  }
  return null
})()
if (served === null) {
  console.error(`窗口没起来,它说的是:\n${windowOut}`)
  window_.kill()
  process.exit(2)
}

/** Post to the window the way its own page does, pass and all. */
async function toWindow(path, body) {
  const response = await fetch(`${served.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-box-pass': served.pass },
    body: JSON.stringify(body),
  })
  return response.json()
}

async function windowState() {
  const response = await fetch(`${served.url}/api/state`, { headers: { 'x-dsh-box-pass': served.pass } })
  return response.json()
}

/** Wait for a request to appear in the window's own view of the world. */
async function pendingIn(seconds) {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    const state = await windowState()
    if ((state.approvals ?? []).length > 0) return state.approvals[0]
    await sleep(150)
  }
  return null
}

/** A command line run the way an agent's own terminal runs one. */
function cli(argv, { noPanel = false } = {}) {
  const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
    windowsHide: true,
    env: {
      ...process.env,
      DSH_HOME: fakeHome,
      ...(noPanel ? { DSH_BOX_NO_PANEL: '1' } : {}),
    },
  })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.resume()
  const done = new Promise((resolveWith) => {
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        resolveWith(JSON.parse(line ?? ''))
      } catch {
        resolveWith({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
  return { child, done }
}

// ── ① 命令行撞闸门 → 面板上真的出现一条待批 ────────────────────────────────

const asking = cli(['get', 'plugin', source, '--to', 'main'])
const request = await pendingIn(20)
check('⭐⭐ 命令行撞上闸门后,这扇窗自己看见了一条待批请求',
  request !== null && Array.isArray(request?.argv), request === null ? '一直没出现' : request.what)
check('⭐ 待批请求带着要跑的那条命令原样,不是一句转述',
  request?.argv?.[0] === 'get' && request?.argv?.includes('--to') && request?.argv?.includes('main'),
  JSON.stringify(request?.argv ?? null))
check('⛔ 人还没点头之前,文件一个字节没动', readFileSync(patchFile, 'utf8') === ORIGINAL)

// ── ② 点「拒绝」→ 什么都没做 ──────────────────────────────────────────────

const denied = await toWindow('/api/approve', { id: request.id, decision: 'deny' })
check('点拒绝:面板确认收到', denied.ok === true && denied.decision === 'deny', JSON.stringify(denied))
const askedResult = await asking.done
check('⭐ 命令行当场拿到「被拒绝」,不是等满一分钟',
  askedResult.ok === false && askedResult.code === 'APPROVAL_DENIED', askedResult.code)
check('⛔ 拒绝之后文件仍然一个字节没动', readFileSync(patchFile, 'utf8') === ORIGINAL)

// ── ③ ⛔⛔ 直接把这条命令 POST 给窗口,不算同意 ─────────────────────────────

// 这是这一整轮改动要证明的那一条:旧机制下,谁能 POST 到 /api/command,谁就自动
// 满足「父进程是窗口」,于是在 argv 里补一个 --approved 就成了同意。
const posted = toWindow('/api/command', { argv: ['rm', 'plugin', 'theirs', '--from', 'main'] })
const second = await pendingIn(20)
check('⭐⭐ 直接 POST 一条动日常柜的命令,窗口没有替它同意,而是也变成一条待批',
  second !== null, second === null ? '没有待批,说明它自己跑掉了' : second.what)
check('⛔ 而且那一行还在,没被那条 POST 删掉', readFileSync(patchFile, 'utf8').includes('a-plugin-they-installed'))
if (second !== null) await toWindow('/api/approve', { id: second.id, decision: 'deny' })
const postedResult = await posted
check('那条 POST 最后拿到的是拒绝',
  postedResult.ok === false && postedResult.code === 'APPROVAL_DENIED', postedResult.code)

// ── ④ 点「允许」→ 事情真的发生了 ──────────────────────────────────────────

const wanting = cli(['get', 'plugin', source, '--to', 'main'])
const third = await pendingIn(20)
check('第三条待批也出现了', third !== null)
const allowed = await toWindow('/api/approve', { id: third.id, decision: 'allow' })
check('点允许:面板把它跑掉了',
  allowed.ok === true && allowed.decision === 'allow' && allowed.result?.ok === true,
  JSON.stringify(allowed.result?.code ?? allowed))
const wantedResult = await wanting.done
check('⭐⭐ 等着的那条命令行拿到了成功,而这活是面板干的',
  wantedResult.ok === true && wantedResult.approvedInWindow === true, wantedResult.code ?? 'ok')
check('⭐ 插件真的进了那个档案柜', readFileSync(patchFile, 'utf8').includes('approval-test-plugin'))
check('⛔ 别人原来那一行没被顺手动掉', readFileSync(patchFile, 'utf8').includes('a-plugin-they-installed'))

// ── ⑤ 同一条请求不能被回答两次 ────────────────────────────────────────────

const again = await toWindow('/api/approve', { id: third.id, decision: 'allow' })
check('⛔ 已经答过的请求再答一次:不再执行第二遍',
  again.ok === false && again.code === 'ALREADY_ANSWERED', again.code ?? JSON.stringify(again).slice(0, 80))

// ── ⑥ 没有面板可弹时,当场报错,不等一分钟 ─────────────────────────────────

// CEO 2026-08-28:「如果是弹出窗弹不出问题 就不用等 1min 当场报错」。
// ⛔ 这里把窗口关掉,并把 exe 指向一个存在但根本跑不起来的文件,于是「弹出面板」
//   这一步必定失败 —— 而失败必须立刻说,不能变成一分钟的沉默。
window_.kill()
await sleep(500)
const notAnExe = join(root, 'not-an-exe.txt')
writeFileSync(notAnExe, 'this is not a program\n')
const began = Date.now()
const noPanel = await new Promise((done) => {
  const child = spawn(process.execPath, [CLI, 'rm', 'plugin', 'theirs', '--from', 'main', '--box', box, '--json'], {
    windowsHide: true,
    env: { ...process.env, DSH_HOME: fakeHome, DSH_BOX_EXE: notAnExe },
  })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.resume()
  child.once('close', () => {
    try {
      done(JSON.parse(out.trim().split('\n').filter((t) => t.trim() !== '').at(-1) ?? ''))
    } catch {
      done({ ok: false, code: 'NO_OUTPUT', message: out })
    }
  })
})
const took = Date.now() - began
check('⛔⛔ 面板弹不出来:当场报错,不是拒绝',
  noPanel.ok === false && noPanel.code === 'NO_PANEL', noPanel.code)
// ⭐ 这一条测的是「多久」,不是「什么」。旧行为下它会安静地等满六十秒,而那六十秒
//   正是调用方最会误读成「挂死了」的东西。
check('⭐⭐ 而且没有等满那一分钟', took < 30_000, `${Math.round(took / 1000)} 秒`)

removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
