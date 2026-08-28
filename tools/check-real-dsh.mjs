/**
 * Hand everything this tool writes to a **real dsh** and see if it agrees.
 *
 * ⛔⛔ **Not part of `npm test`, on purpose.** That suite drives a few-line
 * stand-in and touches no real installation, which is what makes it safe to run
 * anywhere. This one needs a real dsh and starts it, so it is opt-in — and it is
 * the only check here that can catch the failure mode this project keeps
 * meeting: *installing is one thing, booting is another, and the gap between
 * them is where the bugs live.*
 *
 * The judgement it exists to make is one sentence: **everything below was
 * verified by upstream's own parser and loader, not by ours.** Three rounds of
 * this project have produced a conclusion that read correctly and ran wrong.
 *
 * ⭐ It carries its own losing arm. With one member's link removed, dsh must
 * refuse the whole plugin tree — because if it did not, the passing arm above
 * would prove nothing about whether those packages were ever really loaded.
 *
 * ⚠️ It creates a sandbox in a throwaway data directory, never touches the real
 * `~/.dsh`, and the sandbox holds no credentials — so nothing here spends a
 * token or reaches the network.
 *
 * Usage: node tools/check-real-dsh.mjs <一次性目录>
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectHostDsh } from '../src/host.js'
import { boxLayout, ensureBox, removeTree } from '../src/paths.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-real-dsh.mjs <一次性目录>')
  process.exit(2)
}

const host = detectHostDsh()
if (!host.found) {
  console.error('这台机器上没有找到装好的 dsh —— 这一套要的就是真的那一台,跳过没有意义,所以不跑')
  process.exit(2)
}

removeTree(root)
// ⛔⛔ 空的日常档案柜替身。下面 `cli()` 起的每一条命令都会去问 `userDshHome()`,
//    不设它读的就是跑测试那个人真实的 ~/.dsh。⚠️ 真 dsh 那两次 spawn 自己带
//    DSH_HOME(指向沙箱),不受这里影响。理由全文＝ tools/fake-daily.mjs。
useFakeDaily(root)
const box = join(root, 'data')
ensureBox(box)
const layout = boxLayout(box)

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

function cli(...argv) {
  return new Promise((done) => {
    // ⛔ DSH_BOX_NO_PANEL:撞上日常档案柜那道闸门时当场拒绝,不弹面板等一分钟。
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true, env: { ...process.env, DSH_BOX_NO_PANEL: '1' },
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => {
      try {
        done(JSON.parse(out.trim().split('\n').at(-1)))
      } catch {
        done({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
}

const home = join(layout.sandboxes, 'real', 'home')

/** Ask the real dsh to compose this cabinet's config. Its parser, not ours. */
function dumpConfig() {
  const result = spawnSync(process.execPath, [host.entry, '--profile', 'web', '--dump-config'], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true,
  })
  return { code: result.status, text: `${result.stdout}${result.stderr}` }
}

/** Start the real dsh and report how it went. Its loader, not ours. */
function boot(port) {
  const result = spawnSync(process.execPath, [host.entry, 'web', '--port', String(port)], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true, timeout: 90_000,
  })
  const text = `${result.stdout}${result.stderr}`
  // ⭐ A boot that reaches "dsh web: http://…" has loaded the whole plugin tree;
  // one that fails says so and exits. The timeout is the success case — it is
  // still serving when we take it away.
  return { served: text.includes('dsh web:'), text }
}

/** A minimal but genuinely loadable Cordis plugin. */
function plugin(dir, name, extra = {}) {
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name, version: '1.0.0', type: 'module', main: 'lib/index.js', dsh: { bundle: {}, ...extra },
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'lib', 'index.js'),
    `export const name = ${JSON.stringify(name.replace(/[@/]/g, '-'))}\nexport function apply(ctx) {}\n`)
  return dir
}

console.log(`\n真 dsh 认不认我们写的东西(${host.version})\n`)

// An aggregate exactly as npm would leave one: the package, its patch, and its
// members resolvable from beside it. One member is scoped, because the scoped
// path is the one that had never been run before this year.
const tree = join(root, 'tree', 'node_modules')
const MEMBERS = ['probe-alpha', '@probe/beta', 'probe-gamma']
for (const name of MEMBERS) plugin(join(tree, ...name.split('/')), name)
const AGGREGATE = 'probe-suite'
const aggregate = plugin(join(tree, AGGREGATE), AGGREGATE, { bundle: { patch: './cordis.patch.yml' } })
writeFileSync(join(aggregate, 'cordis.patch.yml'),
  [AGGREGATE, ...MEMBERS].map((name) => `# from ${name}\n- insert:\n    - id: row-${name.replace(/[@/]/g, '-')}\n      name: '${name}'\n`).join('\n'))

const installed = await cli('get', 'plugin', aggregate, '--to', 'real')
check('聚合包装得上,四行全进去', installed.ok === true && (installed.brought ?? []).length === 4,
  installed.code ?? `${(installed.brought ?? []).length} 行`)

// 1. ⭐⭐ Upstream's parser, on the file we wrote with our own line editor. It
//    is the one thing we cannot check ourselves: there is no YAML library in
//    this tool, by design.
const dumped = dumpConfig()
check('⭐⭐ 真 dsh 解析得了我们写的 patch', dumped.code === 0, `exit=${dumped.code}`)
const present = [AGGREGATE, ...MEMBERS].filter((name) => dumped.text.includes(`name: ${name}`)
  || dumped.text.includes(`name: '${name}'`))
check('四行都在它合成出来的配置里', present.length === 4, present.join('、'))

// 2. ⭐⭐ And its loader. Parsing proves the file is legal; only booting proves
//    every one of those names actually resolves.
const good = boot(3191)
check('⭐⭐ 起得来,整棵插件树都加载了', good.served, good.text.split('\n').filter((l) => l.trim() !== '').at(-1) ?? '')

// 3. ⛔⛔ The losing arm. Take one member's link away and dsh must refuse the
//    whole tree — otherwise the arm above proves nothing about whether those
//    packages were ever loaded at all.
const slot = join(home, 'profiles', 'web', 'node_modules', '@probe', 'beta')
check('那个链接本来在', existsSync(slot))
removeTree(slot)
const broken = boot(3192)
check('⛔⛔ 必然会输的对照组:拆掉一个子包的链接,整棵插件树拒载',
  !broken.served && broken.text.includes('ERR_MODULE_NOT_FOUND'),
  broken.served ? '⚠ 它照样起来了 —— 说明上面那次成功不能证明子包被加载过' : 'ERR_MODULE_NOT_FOUND')
check('⛔ 而且错里点得出是哪个包', broken.text.includes('@probe/beta'))

// 4. Knife 6 through the same door: a row switched off has to be switched off in
//    what dsh composes, not just in what we wrote.
await cli('rm', 'plugin', AGGREGATE, '--from', 'real')
mkdirSync(join(home, 'profiles', 'web', 'node_modules'), { recursive: true })
await cli('get', 'plugin', join(tree, 'probe-alpha'), '--to', 'real')
const offed = await cli('set', 'plugin', 'probe-alpha', 'off', '--in', 'real')
check('关得掉', offed.ok === true && offed.changed === true, offed.code ?? 'ok')
const afterOff = dumpConfig()
check('⭐ 真 dsh 合成出来的配置里,那一行确实是关着的',
  afterOff.code === 0 && /- id: probe-alpha[\s\S]{0,120}?disabled: true/.test(afterOff.text),
  `exit=${afterOff.code}`)
const stillBoots = boot(3193)
check('⛔ 关掉一行之后照样起得来(关不等于把文件写坏)', stillBoots.served,
  stillBoots.text.split('\n').filter((l) => l.trim() !== '').at(-1) ?? '')

// 5. ⛔⛔ The round trip, and the defect this whole script found on its first
//    run. Removing our last row from a patch **we created** used to leave an
//    empty file, and dsh refuses one outright — *must be a top-level YAML array
//    of loader patch entries*. Measured on this dsh: empty exits 1, a lone
//    newline exits 1, **no file exits 0**. So the file we made goes away with
//    our last row, which is also what "put it back the way it was" means when
//    the way it was is that there was no file.
//
//    ⭐ 370 acceptance items missed it, and could not have caught it: not one of
//    them ever handed the result to something that parses YAML.
await cli('set', 'plugin', 'probe-alpha', 'on', '--in', 'real')
const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
await cli('rm', 'plugin', 'probe-alpha', '--from', 'real')
check('⛔⛔ 我们建的那个文件,最后一行走掉之后被撤掉了(不是留一个空文件)', !existsSync(patch))
check('⛔⛔ 于是这个档案柜照样起得来 —— 留空文件的话真 dsh 整份拒载', dumpConfig().code === 0)

// 6. The other shape of the same promise: a patch **dsh** wrote, which ends in
//    `[]`. That file is not ours to remove, so it comes back byte for byte.
const dshDefault = '# Your patch layer for this dsh profile, applied after every bundle layer:\n'
  + '# a top-level YAML array of loader patch entries (id-targeted config\n'
  + '# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n'
mkdirSync(dirname(patch), { recursive: true })
writeFileSync(patch, dshDefault)
await cli('get', 'plugin', join(tree, 'probe-gamma'), '--to', 'real')
check('⛔ 装进 dsh 自己写的那份之后,真 dsh 解析得了', dumpConfig().code === 0)
await cli('rm', 'plugin', 'probe-gamma', '--from', 'real')
check('⛔⛔ 卸完逐字节回到 dsh 写的原样', readFileSync(patch, 'utf8') === dshDefault,
  JSON.stringify(readFileSync(patch, 'utf8').slice(-16)))
check('⛔ 而且它还是解析得了的', dumpConfig().code === 0)

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
