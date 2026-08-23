/**
 * Prove one npm package that is really seventeen plugins arrives as seventeen.
 *
 * ⛔⛔ The failure this exists to stop is silent. A row in a patch names one
 * package for dsh to import; dsh's own bundle list resolves the package, reads
 * the patch its `dsh.bundle.patch` points at, and applies **all of it**. So
 * `@linxin666/dsh-web-ui-all` through our door was one plugin, through the
 * official door seventeen — and the sandbox booted perfectly either way, with
 * one row in the list and no warning anywhere.
 *
 * ⭐⭐ **The fixture is upstream's own file**, not one written here: the real
 * `packages/dsh-web-ui-all/cordis.patch.yml` out of that repository, copied in
 * byte for byte when it is on this machine. A hand-made aggregate would only
 * prove we can read our own handwriting — and the round before this one was
 * caught out by exactly that (a fixture we invented, against a format we do not
 * own). Where the checkout is absent the same bytes are used from a copy kept
 * beside this script, so the check never silently turns into nothing.
 *
 * ⛔ Never points at the real `~/.dsh`, downloads nothing, starts no dsh.
 *
 * Usage: node tools/check-aggregate.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, ensureBox, removeTree } from '../src/paths.js'
import { scanPatch } from '../src/patch-file.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-aggregate.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
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
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], { windowsHide: true })
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

/** A folder shaped like a dsh plugin. */
function plainPlugin(dir, name, extra = {}) {
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name, version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {}, ...extra.dsh },
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default {}\n')
  return dir
}

// ⭐ Upstream's own aggregate patch. Read from the checkout when it is here, so
// the day that file changes shape this check changes with it.
const UPSTREAM = 'E:/codecode/dsh_lab/openproject/dsh-web-ui/packages/dsh-web-ui-all/cordis.patch.yml'
const FALLBACK = join(HERE, 'fixtures', 'dsh-web-ui-all.cordis.patch.yml')
const source = existsSync(UPSTREAM) ? UPSTREAM : FALLBACK
const aggregatePatch = readFileSync(source, 'utf8')
const upstreamRows = scanPatch(aggregatePatch).items.flatMap((item) => item.entries)

console.log('\n一个包其实是十七个插件\n')
check('⭐ 夹具来自对方,不是我们写的', existsSync(source), source.replace(/.*[\\/]/, '…/'))
check('那份 patch 里有十七行', upstreamRows.length === 17, `${upstreamRows.length} 行`)

// Build the aggregate as npm would leave it: the package itself, its patch, and
// every member resolvable from beside it.
const AGGREGATE = '@linxin666/dsh-web-ui-all'
const tree = join(root, 'packages', 'node_modules')
const aggregateDir = join(tree, ...AGGREGATE.split('/'))
plainPlugin(aggregateDir, AGGREGATE, { dsh: { bundle: { patch: './cordis.patch.yml' } } })
writeFileSync(join(aggregateDir, 'cordis.patch.yml'), aggregatePatch)
const members = upstreamRows.map((row) => row.name).filter((name) => name !== AGGREGATE)
for (const name of members) plainPlugin(join(tree, ...name.split('/')), name)

// 1. ⭐⭐ The whole knife: seventeen rows, seventeen links.
const installed = await cli('plugins', 'install', aggregateDir, '--sandbox', 'w1')
check('装得上', installed.ok === true, installed.code ?? 'ok')
check('⭐⭐ 十七个全进去了,不是只进去一个',
  (installed.brought ?? []).length === 17, `${(installed.brought ?? []).length} 个`)

const home = join(layout.sandboxes, 'w1', 'home')
const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
const rows = scanPatch(readFileSync(patch, 'utf8')).items.flatMap((item) => item.entries)
check('写进档案柜的行数与上游那份对得上', rows.length === 17, `${rows.length} 行`)
check('⭐ 逐行照抄:id 与 name 与上游一字不差',
  JSON.stringify(rows.map((one) => [one.id, one.name]))
  === JSON.stringify(upstreamRows.map((one) => [one.id, one.name])),
  JSON.stringify(rows.slice(0, 2).map((one) => [one.id, one.name])))

// 2. ⛔ Expanding is only half. dsh resolves a row's `name:` through the
//    profile's own node_modules — a row whose package is not linked there loads
//    on the server and never appears in the browser, and that negative result
//    is cached by name and not retried.
const modules = join(home, 'profiles', 'web', 'node_modules')
const unlinked = rows.map((one) => one.name).filter((name) => !existsSync(join(modules, ...name.split('/'))))
check('⛔⛔ 每一个子包都链进了 profile 的 node_modules', unlinked.length === 0, unlinked.join('、'))
check('带 @scope 的落在嵌套目录里', existsSync(join(modules, '@linxin666', 'dsh-pet')))

// 3. The list has to say seventeen too, or the window and the file disagree.
const listed = await cli('plugins', '--sandbox', 'w1')
check('列出来也是十七个', listed.ours.length === 17, `${listed.ours.length} 个`)
check('⭐ 每一条都记着是随谁进来的',
  listed.ours.every((one) => one.via === AGGREGATE), JSON.stringify(listed.ours[3] ?? null))

// 4. ⭐ One command in, one command out. Sixteen of these are rows the person
//    never named, so leaving them behind would be litter with no command for it.
const removed = await cli('plugins', 'uninstall', AGGREGATE, '--sandbox', 'w1')
check('一条命令整家拿掉', removed.ok === true, removed.code ?? 'ok')
check('⭐ 顺带拿掉的十六个是说出来的,不是默默做掉的',
  (removed.alsoRemoved ?? []).length === 16, `${(removed.alsoRemoved ?? []).length} 个`)
// ⛔ Gone, not empty. This cabinet had no patch until we wrote one, and dsh
// refuses an empty patch file outright — see `check-cabinet-ledger` §8.
check('⛔ 我们建的那个文件跟着最后一行一起撤掉了', !existsSync(patch))
check('⛔ 链接也一个不剩', !existsSync(join(modules, '@linxin666', 'dsh-pet')))
// ⛔ 连我们为了放链接而建的那个 @scope 目录也要收走。发现于真的从 npm 装一次
//    web-ui 全家桶再卸掉:@linxin666/ 和 @mlgbnb/ 两个空壳留在 profile 里,谁的
//    命令都收拾不到——正是「只给了做,没给撤」那条判据。
check('⛔⛔ 为了放链接建的 @scope 空目录也收走了', !existsSync(join(modules, '@linxin666')))

// 5. And the other direction: one member out, the other sixteen stay. Somebody
//    who wants sixteen of them must not have to give up the aggregate.
await cli('plugins', 'install', aggregateDir, '--sandbox', 'w2')
const onlyPet = await cli('plugins', 'uninstall', 'web-ui-pet', '--sandbox', 'w2')
check('单独拿掉一个成员,不牵连别的',
  onlyPet.ok === true && (onlyPet.alsoRemoved ?? []).length === 0, `${(onlyPet.alsoRemoved ?? []).length} 个`)
const left = await cli('plugins', '--sandbox', 'w2')
check('剩下十六个还在', left.ours.length === 16, `${left.ours.length} 个`)

// 6. ⛔⛔ The refusal. Upstream applies each bundle as its own layer *before* the
//    profile patch; we inline into the profile patch, which comes after. Rows
//    that only add are unaffected by that; a row aimed at an existing id lands
//    on something else at a different layer. Refused, with the reason.
const targeted = join(root, 'targeted')
plainPlugin(targeted, 'targeted-aggregate', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
writeFileSync(join(targeted, 'cordis.patch.yml'),
  '- insert:\n    - id: a-row\n      name: "some-plugin"\n- id: someone-elses-row\n  disabled: true\n')
const refusedTargeted = await cli('plugins', 'install', targeted, '--sandbox', 'w3')
check('⛔⛔ 带「冲着已有 id 去」的行的聚合包被拒,不硬展开',
  refusedTargeted.ok === false && refusedTargeted.code === 'AGGREGATE_NOT_INLINEABLE', refusedTargeted.code)
check('⛔ 而且说得出是哪几行',
  (refusedTargeted.ids ?? []).includes('someone-elses-row'), JSON.stringify(refusedTargeted.ids))
check('⛔ 拒绝时什么都没写', !existsSync(join(layout.sandboxes, 'w3', 'home', 'profiles', 'web', 'cordis.patch.yml')))

// 7. ⛔ A member the aggregate names but did not ship. This is the live case:
//    the `@linxin666/*` packages declare their official runtime imports in
//    devDependencies, which consumers never install. The message has to send
//    the person upstream rather than leave them auditing their own machine.
const incomplete = join(root, 'incomplete')
plainPlugin(incomplete, 'incomplete-aggregate', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
writeFileSync(join(incomplete, 'cordis.patch.yml'),
  '- insert:\n    - id: missing-one\n      name: "never-shipped-plugin"\n')
const missing = await cli('plugins', 'install', incomplete, '--sandbox', 'w4')
check('⛔ 点名了却没随包发出来的成员,当场拒绝',
  missing.ok === false && missing.code === 'AGGREGATE_MEMBER_MISSING', missing.code)
check('⛔ 而且指名道姓说是哪个包的问题',
  missing.member === 'never-shipped-plugin' && missing.package === 'incomplete-aggregate',
  `${missing.package} → ${missing.member}`)

// 8. An ordinary plugin that happens to register through its own patch is not an
//    aggregate, and must not go down this road at all.
const solo = join(root, 'solo')
plainPlugin(solo, 'solo-plugin', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
writeFileSync(join(solo, 'cordis.patch.yml'), '- insert:\n    - id: solo-plugin\n      name: "solo-plugin"\n')
const soloed = await cli('plugins', 'install', solo, '--sandbox', 'w5')
check('⭐ 只登记自己的普通插件不当聚合包处理',
  soloed.ok === true && (soloed.brought ?? []).length === 0, JSON.stringify(soloed.brought))

// 9. ⛔ Half an aggregate is a state nobody can clean up, so a member name
//    already held by something else stops the whole install.
const w6 = join(layout.sandboxes, 'w6', 'home', 'profiles', 'web')
mkdirSync(w6, { recursive: true })
writeFileSync(join(w6, 'cordis.patch.yml'), "- insert:\n    - id: mine\n      name: '@linxin666/dsh-pet'\n")
const clash = await cli('plugins', 'install', aggregateDir, '--sandbox', 'w6')
check('⛔ 有一个成员名被占着,整包都不装',
  clash.ok === false && clash.code === 'AGGREGATE_MEMBER_TAKEN', clash.code)
check('⛔ 拒绝时别人那行没动',
  readFileSync(join(w6, 'cordis.patch.yml'), 'utf8').includes("- id: mine"))

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
