/**
 * Prove a plugin can be taken out of a cabinet whoever put it there.
 *
 * ⭐⭐ Everything before this knife could only undo this tool's own work. That
 * is not enough for what the tool is for (CEO 2026-08-23): an agent that finds a
 * plugin conflict in the daily cabinet has to be able to *do something about
 * it*, rather than be sent back to `bash` — and almost nothing in a real daily
 * cabinet was installed by us.
 *
 * Two operations, because the format offers exactly two:
 *
 * - **off** — `disabled: true` in a later layer. There is no `remove` in this
 *   format at all; a row in a layer below can only be overridden. The profile
 *   patch sits after every bundle layer, so a switch written there reaches a
 *   plugin a bundle brought in. Upstream disables its own telemetry this way.
 * - **out** — the package leaves `dsh.profile.bundles`. ⛔⛔ **And
 *   `dependencies`, or it is not out at all**: dsh's `reconcilePlugins` walks
 *   the dependency list after every `dsh plugin` command and pushes back
 *   anything still declared there that still exports a patch. The control group
 *   at the bottom is that rule, stated as the predicate upstream evaluates.
 *
 * ⛔ Never points at the real `~/.dsh`; downloads nothing; starts no dsh.
 *
 * Usage: node tools/check-bundles.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, cabinetLedgerFile, ensureBox, removeTree } from '../src/paths.js'
import { scanPatch } from '../src/patch-file.js'
import { claimPath } from '../src/sandbox.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-bundles.mjs <一次性目录>')
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

const home = join(layout.sandboxes, 'w1', 'home')
const profile = join(home, 'profiles', 'web')
const patch = join(profile, 'cordis.patch.yml')
const manifest = join(profile, 'package.json')
const readPatch = () => (existsSync(patch) ? readFileSync(patch, 'utf8') : '')
const readManifest = () => JSON.parse(readFileSync(manifest, 'utf8'))

/**
 * A cabinet as dsh's own tooling would leave one: a bundle registered in both
 * places, its package sitting in the profile's node_modules with its own patch.
 * ⭐ Both places, because that is the state that matters — a bundle in only one
 * of them is not what `dsh plugin add` produces.
 */
mkdirSync(join(profile, 'node_modules', '@vendor', 'suite', 'lib'), { recursive: true })
const suite = join(profile, 'node_modules', '@vendor', 'suite')
writeFileSync(join(suite, 'package.json'), `${JSON.stringify({
  name: '@vendor/suite', version: '2.0.0', type: 'module', main: 'lib/index.js',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}, null, 2)}\n`)
writeFileSync(join(suite, 'lib', 'index.js'), 'export function apply() {}\n')
writeFileSync(join(suite, 'cordis.patch.yml'),
  '- insert:\n    - id: suite-core\n      name: "@vendor/suite"\n'
  + '- insert:\n    - id: suite-extra\n      name: "@vendor/suite-extra"\n')
writeFileSync(manifest, `${JSON.stringify({
  name: 'profile-web',
  dependencies: { '@vendor/suite': '^2.0.0' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@vendor/suite'] } },
}, null, 2)}\n`)
writeFileSync(patch, "# 这个档案柜本来就有的\n- insert:\n    - id: theirs\n      name: 'their-plugin'\n")
const original = readFileSync(patch, 'utf8')

console.log('\nbundles 那一路:关得掉,也删得掉\n')

// 1. ⭐ A bundle is a layer, not a row. A listing that prints the package name
//    and stops prints one word where two plugins are — and the ids inside are
//    what `disable` takes, so not opening them makes the switch unusable.
const listed = await cli('plugins', '--sandbox', 'w1')
const opened = listed.inventory.bundles.find((one) => one.name === '@vendor/suite')
check('⭐⭐ bundle 被打开了,里面那两行看得见',
  (opened?.rows ?? []).length === 2, JSON.stringify((opened?.rows ?? []).map((one) => one.id)))
check('⛔ 官方基座那些不打开(干净 profile 展开就有 129 条,全打开等于把人要找的埋了)',
  (listed.inventory.bundles.find((one) => one.name === '@deepseek-ai/dsh-base')?.rows ?? []).length === 0)

// 2. ⭐⭐ Switching off something we never installed. This is the whole reason
//    the knife exists.
const off = await cli('plugins', 'disable', 'suite-extra', '--sandbox', 'w1')
check('⭐⭐ 关得掉一个我们从来没装过的插件', off.ok === true && off.changed === true, off.code ?? 'ok')
const overrides = scanPatch(readPatch()).items.filter((item) => item.kind === 'override')
check('写的是一条 disabled: true 的覆盖行',
  overrides.length === 1 && overrides[0].id === 'suite-extra' && overrides[0].disabled === true,
  JSON.stringify(overrides.map((one) => [one.id, one.disabled])))
check('⛔ 别人本来那行一个字节没动', readPatch().includes("name: 'their-plugin'"))
check('⛔ 也没往 bundle 自己的文件里写字',
  readFileSync(join(suite, 'cordis.patch.yml'), 'utf8').split('disabled').length === 1)
const afterOff = await cli('plugins', '--sandbox', 'w1')
check('列表里那一行显示成关着的',
  afterOff.inventory.bundles.find((one) => one.name === '@vendor/suite')
    ?.rows.find((one) => one.id === 'suite-extra')?.disabled === true)

// 3. Idempotent, and reversible only by us.
const again = await cli('plugins', 'disable', 'suite-extra', '--sandbox', 'w1')
check('再关一次不报错也不重复写', again.ok === true && again.already === true && again.changed === false)
const on = await cli('plugins', 'enable', 'suite-extra', '--sandbox', 'w1')
check('放得回来', on.ok === true && on.changed === true, on.code ?? 'ok')
check('⛔⛔ 放回来之后逐字节回到原样', readPatch() === original, JSON.stringify(readPatch().slice(-20)))

// 4. ⛔ Somebody else's `disabled` is their decision.
writeFileSync(patch, `${original}- id: suite-core\n  disabled: true\n`)
const notOurs = await cli('plugins', 'enable', 'suite-core', '--sandbox', 'w1')
check('⛔ 别人关掉的,我们不替他打开', notOurs.ok === false && notOurs.code === 'NOT_OURS', notOurs.code)
writeFileSync(patch, original)

// 5. ⛔ An id nothing has. The format lets you write a rule against a
//    nonexistent id and it silently does nothing — upstream warns and skips —
//    so answering `ok:true` to a typo is the failure to avoid.
const typo = await cli('plugins', 'disable', 'suite-extar', '--sandbox', 'w1')
check('⛔ 对着一个不存在的 id 关,当场拒绝而不是假装做了',
  typo.ok === false && typo.code === 'UNKNOWN_ROW', typo.code)
check('⛔ 拒绝时文件没动', readPatch() === original)

// 6. ⭐⭐ The real removal, and the whole point of it: **both places**.
const beforeManifest = readFileSync(manifest, 'utf8')
const out = await cli('plugins', 'uninstall', '@vendor/suite', '--sandbox', 'w1')
check('⭐ uninstall 认得出这是 bundle,走另一条路', out.ok === true && out.bundle === '@vendor/suite', out.code ?? 'ok')
check('bundles 数组里没了', !readManifest().dsh.profile.bundles.includes('@vendor/suite'),
  JSON.stringify(readManifest().dsh.profile.bundles))
check('⛔⛔ dependencies 里也没了 —— 只摘一处等于没摘',
  readManifest().dependencies['@vendor/suite'] === undefined,
  JSON.stringify(readManifest().dependencies))
check('⭐ 官方那条基座没被顺手带走', readManifest().dsh.profile.bundles.includes('@deepseek-ai/dsh-base'))
check('⭐ 包体还在,而且这件事是说出来的 —— 我们不替官方跑包管理器',
  existsSync(join(suite, 'package.json')) && out.filesLeft !== null, out.filesLeft ?? '(没说)')
check('⭐ 沙箱照旧不留备份 —— 沙箱本来就是玩坏了整个删掉的',
  out.backup === null, out.backup ?? 'null')
check('⛔ 插件配置那个文件一个字节没动', readPatch() === original)

// 7. ⛔⛔ The control group, and it is the predicate upstream actually
//    evaluates. `reconcilePlugins` pushes a package back when it is still in
//    `dependencies` **and** still exports a patch:
//
//      const isBundle = exportsPatch(packageName, profileDir)
//      if (isBundle && !plugins.includes(packageName)) plugins.push(packageName)
//
//    So "removed" means that predicate is false. Removing only from `bundles`
//    leaves it true — which is the losing arm below, and it has to lose.
const reconcileWouldRestore = (state) => {
  const deps = Object.keys(state.dependencies ?? {})
  const bundles = state.dsh?.profile?.bundles ?? []
  return deps.filter((name) => existsSync(join(profile, 'node_modules', ...name.split('/'), 'package.json'))
    && !bundles.includes(name))
}
check('⭐⭐ 两处都摘之后,官方那套对账不会把它加回来',
  !reconcileWouldRestore(readManifest()).includes('@vendor/suite'),
  JSON.stringify(reconcileWouldRestore(readManifest())))
const bundlesOnly = JSON.parse(beforeManifest)
bundlesOnly.dsh.profile.bundles = bundlesOnly.dsh.profile.bundles.filter((one) => one !== '@vendor/suite')
check('⛔⛔ 必然会输的对照组:只摘 bundles 不摘 dependencies,那条对账规则会把它加回来',
  reconcileWouldRestore(bundlesOnly).includes('@vendor/suite'),
  '这一条哪天不成立了,说明官方改了对账逻辑,该修的是我们对它的理解')

// 8. Restore puts the profile's own package.json back, not just the patch.
writeFileSync(patch, original)
const back = await cli('plugins', 'restore', '--sandbox', 'w1')
check('⛔ 沙箱不留备份,所以还原也无从谈起', back.ok === false && back.code === 'NO_BACKUP', back.code)

// 9. The whole thing again on a cabinet with backups, so restore is exercised
//    on the file this knife taught the tool to write.
const daily = join(root, 'daily')
mkdirSync(join(daily, 'profiles', 'web'), { recursive: true })
writeFileSync(join(daily, 'profiles', 'web', 'package.json'), beforeManifest)
mkdirSync(join(daily, 'profiles', 'web', 'node_modules', '@vendor'), { recursive: true })
writeFileSync(join(daily, 'profiles', 'web', 'cordis.patch.yml'), original)
const seat = join(layout.root, 'ui.json')
// ⛔ 座位走产品自己的写入口,夹具不手抄它的字段。
claimPath(seat, { url: 'http://127.0.0.1:10140' })
const dropped = await new Promise((done) => {
  const child = spawn(process.execPath, [
    CLI, 'plugins', 'uninstall', '@vendor/suite', '--main', '--approved', '--box', box, '--json',
  ], { windowsHide: true, env: { ...process.env, DSH_HOME: daily } })
  let out_ = ''
  child.stdout.on('data', (chunk) => { out_ += chunk })
  child.stderr.resume()
  child.once('close', () => {
    try {
      done(JSON.parse(out_.trim().split('\n').at(-1)))
    } catch {
      done({ ok: false, code: 'NO_OUTPUT', message: out_ })
    }
  })
})
removeTree(seat)
check('⛔ 日常档案柜那边动这个从来不写的文件之前先备份了',
  dropped.ok === true && dropped.backup !== null && existsSync(dropped.backup), dropped.code ?? dropped.backup)
// ⛔ `backupFile` used to name every copy `cordis.patch.yml`. With two files
// backed up into the same pile that would restore one file's contents over the
// other — and `listBackups`/`restoreBackup` had been looking for both by name
// since before there was a second file to find.
check('⛔⛔ 备份按它本来的名字存,不会把一个文件还原到另一个头上',
  (dropped.backup ?? '').endsWith('package.json'), dropped.backup ?? '')
const restored = JSON.parse(readFileSync(dropped.backup, 'utf8'))
check('⛔ 备份里存的是改之前那份 package.json,不是别的文件',
  restored.dsh.profile.bundles.includes('@vendor/suite'),
  JSON.stringify(restored.dsh?.profile?.bundles))

// 10. One cabinet's ledger records what it switched off, and only that.
const ledger = JSON.parse(readFileSync(cabinetLedgerFile(layout, home), 'utf8'))
check('⭐ 关过又放回来之后,账里不留残条',
  (ledger.profiles.web?.disabled ?? []).length === 0, JSON.stringify(ledger.profiles.web ?? null))

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
