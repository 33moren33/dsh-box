/**
 * The per-installation farm and the copy road, proven by running Node itself.
 *
 * What is being verified is one physical claim and everything built on it:
 * Node resolves a bare import by walking up from the **real path** of the
 * importing file, so where the bytes sit decides which shelf they meet — and a
 * hardlink is a second real path for the same bytes. `src/engines.js` stakes a
 * whole mechanism on that (hardlink the plugin into a per-engine farm, junction
 * the engine's own packages beside it, re-aim the cabinet's junction on every
 * launch), and `src/staging.js` takes the opposite road for the daily cabinet
 * (a true copy inside `_local`, closure resolved nearest-first, officials and
 * shelf-provided packages never copied).
 *
 * ⛔ Resolution is verified by **writing a real file and running `node` on
 * it**, never by `import.meta.resolve` — the two-argument form of that API has
 * produced a false conclusion in this project before. A probe that prints the
 * marker of the package it actually loaded is evidence; an API answer is not.
 *
 * ⭐ Two control groups are REQUIRED to fail. The same probe run from the store
 * original must die with ERR_MODULE_NOT_FOUND, and so must a cabinet junction
 * still aimed at the store. The day either control passes, the test
 * environment itself is wrong and every green above it means nothing.
 *
 * ⛔ Never touches the real `~/.dsh`, never downloads anything: the store, the
 * engines and the cabinets are all hand-made fixtures in a throwaway directory
 * — our own inputs, which is what makes hand-writing them legitimate.
 *
 * Usage: node tools/check-engines.mjs <一次性目录>
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  dropFromFarms, dropReleaseFarm, farmModules, repointDownloads, stageForEngine,
} from '../src/engines.js'
import { claimOn, mountPlugin, profileModules } from '../src/mounts.js'
import { boxLayout, cabinetLedgerFile, ensureBox, removeTree } from '../src/paths.js'
import { stageIntoCabinet, unstageFromCabinet } from '../src/staging.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-engines.mjs <一次性目录>')
  process.exit(2)
}
void HERE

removeTree(root)
const box = join(root, 'data')
ensureBox(box)
const layout = boxLayout(box)

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/** One ESM package: a manifest and an index that names itself out loud. */
function makePackage(dir, manifest, indexSource) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ type: 'module', main: 'index.js', ...manifest }, null, 2)}\n`)
  if (indexSource !== null) writeFileSync(join(dir, 'index.js'), indexSource)
  return dir
}

// ── 夹具:假 store ───────────────────────────────────────────────────────────
// 照 npm 真会留下的样子摆:插件平铺在 store,肚里嵌着一份官方件(65 个
// `@deepseek-ai/*` 嵌在一个聚合包里是量过的真事)和一个只存在于嵌套里的依赖。
const store = join(layout.packages, 'node_modules')
const storePlugin = makePackage(join(store, 'fake-plugin'), {
  name: 'fake-plugin',
  version: '1.0.0',
  dependencies: { 'fake-dep': '1.0.0', 'fake-nested': '1.0.0', '@deepseek-ai/fake-part': '1.0.0' },
}, "export const plugin = 'fake-plugin'\n")
mkdirSync(join(storePlugin, 'lib'), { recursive: true })
writeFileSync(join(storePlugin, 'lib', 'extra.js'), "export const extra = 'extra'\n")
// 嵌套的假官方件:标记故意叫 stale —— 农场里绝不许再见到这个词。
makePackage(join(storePlugin, 'node_modules', '@deepseek-ai', 'fake-part'),
  { name: '@deepseek-ai/fake-part', version: 'nested-stale' }, "export const marker = 'nested-stale'\n")
// 只活在嵌套里的普通依赖:闭包要把它接住并压平。
makePackage(join(storePlugin, 'node_modules', 'fake-nested'),
  { name: 'fake-nested', version: '1.0.0' }, "export const nested = 'nested-ok'\n")
// 平铺的依赖。
makePackage(join(store, 'fake-dep'), { name: 'fake-dep', version: '1.0.0' }, "export const dep = 'dep-ok'\n")
// 带 scope 的下载,专门验空 scope 目录会被收走。
makePackage(join(store, '@fake', 'thing'), { name: '@fake/thing', version: '1.0.0' }, "export const thing = 'thing'\n")
// 拷贝路的占名测试要有个真在 store 里的同名包。
makePackage(join(store, 'collide-plugin'), { name: 'collide-plugin', version: '1.0.0' }, "export const c = 'c'\n")

// ── 夹具:两台假引擎,照下载版的平铺布局 ─────────────────────────────────────
// `<版本>/node_modules/@deepseek-ai/dsh` 是 engine.dir;fake-part 摆在它旁边,
// 正是 engineProvides 读平铺布局时该找到的位置。
function makeEngine(tag, version) {
  const modules = join(root, `engine-${tag}`, 'node_modules')
  const dsh = makePackage(join(modules, '@deepseek-ai', 'dsh'),
    { name: '@deepseek-ai/dsh', version, bin: { dsh: 'lib/bin.js' } },
    `export const dshMarker = 'dsh-${tag}'\n`)
  makePackage(join(modules, '@deepseek-ai', 'fake-part'),
    { name: '@deepseek-ai/fake-part', version: tag }, `export const marker = '${tag}'\n`)
  return { kind: 'release', version, dir: dsh, entry: join(dsh, 'index.js'), partDir: join(modules, '@deepseek-ai', 'fake-part') }
}
const engineV1 = makeEngine('v1', '0.0.1')
const engineV2 = makeEngine('v2', '0.0.2')

// ── 探针:真写文件、真跑 node ───────────────────────────────────────────────
// 四个裸导入,一次问全:官方件走货架、dsh 本体走货架、平铺依赖、被压平的嵌套
// 依赖。⛔ 从 store 原件跑时 `@deepseek-ai/dsh` 在任何一层 node_modules 里都
// 不存在,所以对照组必输 ERR_MODULE_NOT_FOUND。
const PROBE = [
  "import { marker } from '@deepseek-ai/fake-part'",
  "import { dshMarker } from '@deepseek-ai/dsh'",
  "import { dep } from 'fake-dep'",
  "import { nested } from 'fake-nested'",
  'console.log(`part=${marker} dsh=${dshMarker} dep=${dep} nested=${nested}`)',
  '',
].join('\n')

/** Write the probe into a directory and run it with a real node. */
function runProbe(dir) {
  writeFileSync(join(dir, 'probe.mjs'), PROBE)
  const result = spawnSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8', windowsHide: true })
  return { code: result.status, out: `${result.stdout ?? ''}`.trim(), err: `${result.stderr ?? ''}` }
}

/** @param {string} path */
function realpathSafe(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

console.log('\n分版本农场与拷贝路:文件坐在哪儿,决定它见到哪一版零件\n')

// 1. 农场铺设:硬链接进来、闭包压平、嵌套官方件不落地、货架是 junction。
const staged1 = stageForEngine(layout, engineV1, ['fake-plugin'])
const farm1 = farmModules(layout, engineV1)
check('农场里有 fake-plugin,是实体目录不是链接',
  existsSync(join(farm1, 'fake-plugin', 'package.json'))
  && !lstatSync(join(farm1, 'fake-plugin')).isSymbolicLink())
check('闭包把平铺依赖 fake-dep 带进来了', existsSync(join(farm1, 'fake-dep', 'package.json')))
check('只活在嵌套里的 fake-nested 被闭包接住并压平', existsSync(join(farm1, 'fake-nested', 'package.json')))
check('⛔ 插件肚里的 node_modules 没被整个搬进农场', !existsSync(join(farm1, 'fake-plugin', 'node_modules')))
const partSlot = join(farm1, '@deepseek-ai', 'fake-part')
check('⛔ 嵌套来的假官方件没有实体落进农场 —— 那个位置是指向引擎的 junction',
  lstatSync(partSlot).isSymbolicLink() && realpathSafe(partSlot) === realpathSafe(engineV1.partDir),
  realpathSafe(partSlot) ?? '(解析不到)')
check('dsh 本体也上了货架', realpathSafe(join(farm1, '@deepseek-ai', 'dsh')) === realpathSafe(engineV1.dir))
const inoOf = (path) => statSync(path, { bigint: true }).ino
check('⭐ 农场里的文件和 store 原件是同一份字节(硬链接,不是拷贝)',
  inoOf(join(farm1, 'fake-plugin', 'index.js')) === inoOf(join(storePlugin, 'index.js')),
  `staged=${staged1.staged.join('、')}`)

// 2. 解析真跑:硬链接的 realpath 认新地址 —— 这是整个农场成立的前提。
const fromFarm1 = runProbe(join(farm1, 'fake-plugin'))
check('⭐⭐ 从农场跑探针,四个裸导入全解析,官方件拿到的是引擎 v1 的标记',
  fromFarm1.code === 0 && fromFarm1.out.includes('part=v1') && fromFarm1.out.includes('dsh=dsh-v1')
  && fromFarm1.out.includes('dep=dep-ok') && fromFarm1.out.includes('nested=nested-ok'),
  fromFarm1.out || fromFarm1.err.split('\n')[0])
check('⛔ 拿到的绝不是插件肚里那份过期官方件', !fromFarm1.out.includes('stale'), fromFarm1.out)
const fromStore = runProbe(storePlugin)
check('⛔⛔ 必输对照组:同一份探针从 store 原件跑,必须 ERR_MODULE_NOT_FOUND',
  fromStore.code !== 0 && fromStore.err.includes('ERR_MODULE_NOT_FOUND'),
  fromStore.code === 0 ? '⚠ 它居然跑通了 —— 测试环境错了,上面的绿全都不算数' : 'ERR_MODULE_NOT_FOUND')
check('⛔ 而且输在该输的地方:store 向上找不到 @deepseek-ai/dsh', fromStore.err.includes('@deepseek-ai/dsh'))

// 3. 多版本各对各:两个农场并排活着,各自见到各自引擎的零件。
stageForEngine(layout, engineV2, ['fake-plugin'])
const farm2 = farmModules(layout, engineV2)
const fromFarm2 = runProbe(join(farm2, 'fake-plugin'))
check('⭐ 第二台引擎的农场,同一个下载,探针打出 v2',
  fromFarm2.code === 0 && fromFarm2.out.includes('part=v2') && fromFarm2.out.includes('dsh=dsh-v2'), fromFarm2.out)
const farm1Again = runProbe(join(farm1, 'fake-plugin'))
check('v1 的农场没被 v2 弄脏,照旧打出 v1', farm1Again.code === 0 && farm1Again.out.includes('part=v1'), farm1Again.out)

// 4. 重指:沙箱门牌 junction 在每次启动时指向对版农场。账本由真调
//    mountPlugin 产生,和 CLI 装下载插件走的是同一条路。
const home = join(layout.sandboxes, 'w1', 'home')
mkdirSync(profileModules(home, 'web'), { recursive: true })
const slot = join(profileModules(home, 'web'), 'fake-plugin')
symlinkSync(storePlugin, slot, 'junction')
const mounted = mountPlugin({
  layout, home, profile: 'web',
  plugin: { id: 'fake-plugin', package: 'fake-plugin', kind: 'link', path: storePlugin },
  backupDir: null,
})
check('账入了(mountPlugin 记下这是我们从下载装的)', mounted.added === true)
const beforeRepoint = runProbe(slot)
check('⛔⛔ 必输对照组:不重指、门牌还指着 store 时,从门牌跑必失败',
  realpathSafe(slot) === realpathSafe(storePlugin)
  && beforeRepoint.code !== 0 && beforeRepoint.err.includes('ERR_MODULE_NOT_FOUND'),
  beforeRepoint.code === 0 ? '⚠ 指着 store 也能跑 —— 那重指就没有存在的理由了' : 'ERR_MODULE_NOT_FOUND')
const repointed1 = repointDownloads(layout, home, 'web', engineV1)
const slotRun1 = runProbe(slot)
check('⭐⭐ repointDownloads 后门牌 realpath 落在 v1 农场,探针打出 v1',
  repointed1.includes('fake-plugin') && realpathSafe(slot) === realpathSafe(join(farm1, 'fake-plugin'))
  && slotRun1.code === 0 && slotRun1.out.includes('part=v1'),
  slotRun1.out || slotRun1.err.split('\n')[0])
repointDownloads(layout, home, 'web', engineV2)
const slotRun2 = runProbe(slot)
check('⭐ 换引擎再启动一次,同一块门牌改指 v2 农场,探针打出 v2',
  realpathSafe(slot) === realpathSafe(join(farm2, 'fake-plugin'))
  && slotRun2.code === 0 && slotRun2.out.includes('part=v2'),
  slotRun2.out || slotRun2.err.split('\n')[0])

// 5. 新鲜度:npm 更新是「写新文件」,旧硬链接还攥着旧字节 —— 版本对比要把
//    这一课修掉。unlink 后重写正是 npm 换文件的方式(同名新 inode)。
const manifestFile = join(storePlugin, 'package.json')
const fresh = { ...JSON.parse(readFileSync(manifestFile, 'utf8')), version: '2.0.0' }
removeTree(manifestFile)
writeFileSync(manifestFile, `${JSON.stringify(fresh, null, 2)}\n`)
const staleVersion = JSON.parse(readFileSync(join(farm1, 'fake-plugin', 'package.json'), 'utf8')).version
check('⛔ 病灶是真的:store 换了新文件后,农场的硬链接还指着 1.0.0 的旧字节',
  staleVersion === '1.0.0', `farm=${staleVersion}`)
stageForEngine(layout, engineV1, ['fake-plugin'])
check('⭐ 再 stage 一次,版本对比发现不一致,农场跟上 2.0.0',
  JSON.parse(readFileSync(join(farm1, 'fake-plugin', 'package.json'), 'utf8')).version === '2.0.0')

// 6. claimOn 等价:门牌指着农场时,再装同一个下载不许被误判成「被别人占了」。
const withLedger = claimOn({ layout, home, profile: 'web', package: 'fake-plugin', path: storePlugin })
check('账还在时,claimOn 认得这是我们自己的', withLedger.verdict === 'ours', withLedger.verdict)
const ledgerFile = cabinetLedgerFile(layout, home)
const ledgerText = readFileSync(ledgerFile, 'utf8')
removeTree(ledgerFile)
const afterLoss = claimOn({ layout, home, profile: 'web', package: 'fake-plugin', path: storePlugin })
check('⭐ 账丢了、门牌 realpath 落在农场时,storeTwin 认出「农场地址=同一份下载」,不判 taken',
  afterLoss.verdict !== 'taken' && afterLoss.verdict === 'same', afterLoss.verdict)
writeFileSync(ledgerFile, ledgerText)

// 7. 清理:删下载连带清农场,空 scope 收走,删版本整个农场跟着走。
stageForEngine(layout, engineV1, ['@fake/thing'])
check('带 scope 的下载也铺得进农场', existsSync(join(farm1, '@fake', 'thing', 'package.json')))
dropFromFarms(layout, 'fake-plugin')
check('dropFromFarms 把两个农场里的 fake-plugin 都清了',
  !existsSync(join(farm1, 'fake-plugin')) && !existsSync(join(farm2, 'fake-plugin')))
dropFromFarms(layout, '@fake/thing')
check('⭐ 清掉 scope 下最后一个包,空的 @fake 目录也被收走', !existsSync(join(farm1, '@fake')))
check('引擎自己的货架没被顺手拆掉(@deepseek-ai 里还有 junction)',
  existsSync(join(farm1, '@deepseek-ai', 'fake-part')))
dropReleaseFarm(layout, engineV2.version)
check('dropReleaseFarm 整删 v2 农场', !existsSync(join(layout.engines, 'release-0.0.2')))

// 8. 拷贝路:日常档案柜拿的是真拷贝,官方件与货架已提供的一律不拷。
const daily = join(root, 'daily-home')
mkdirSync(join(daily, 'profiles', 'web'), { recursive: true })
// 档案柜的平铺货架:fake-dep 已由 dsh 自己上架 —— 那就不该再拷一份。
mkdirSync(join(daily, 'profiles', 'node_modules', 'fake-dep'), { recursive: true })
const copied = stageIntoCabinet({ layout, home: daily, profile: 'web', package: 'fake-plugin' })
const local = join(daily, 'profiles', 'web', '_local', 'fake-plugin')
check('_local 里有了真拷贝,版本是 store 现在的 2.0.0',
  copied.dir === local && JSON.parse(readFileSync(join(local, 'package.json'), 'utf8')).version === '2.0.0')
check('闭包成员 fake-nested 拷进了包自己的 node_modules',
  existsSync(join(local, 'node_modules', 'fake-nested', 'package.json')))
check('⛔⛔ 拷贝里没有任何 @deepseek-ai/*(嵌套官方件被拦在外面)',
  !existsSync(join(local, 'node_modules', '@deepseek-ai')))
check('⛔ 货架已提供的 fake-dep 一份没拷', !existsSync(join(local, 'node_modules', 'fake-dep')),
  `copied=${copied.copied.join('、')}`)
// 占名:_local 是和用户自己的插件共用的,账里没记的名字一个字节不许动。
const squatter = join(daily, 'profiles', 'web', '_local', 'collide-plugin')
mkdirSync(squatter, { recursive: true })
writeFileSync(join(squatter, 'mine.txt'), '用户自己的东西\n')
let refusal = null
try {
  stageIntoCabinet({ layout, home: daily, profile: 'web', package: 'collide-plugin' })
} catch (error) {
  refusal = error
}
check('⛔⛔ _local 里已有账外同名目录时拒绝,代码是 LOCAL_NAME_TAKEN',
  refusal !== null && refusal.code === 'LOCAL_NAME_TAKEN', refusal?.code ?? '没拒绝')
check('⛔ 拒绝时一个字节没动:用户的文件还在,目录里没多出任何东西',
  readFileSync(join(squatter, 'mine.txt'), 'utf8') === '用户自己的东西\n'
  && readdirSync(squatter).length === 1)
check('unstageFromCabinet 删得干净', unstageFromCabinet(daily, 'web', 'fake-plugin') === true && !existsSync(local))
// 带 scope 的那份:走完一来一回,空 scope 目录不留在别人家里。
stageIntoCabinet({ layout, home: daily, profile: 'web', package: '@fake/thing' })
check('scope 包也拷得进', existsSync(join(daily, 'profiles', 'web', '_local', '@fake', 'thing', 'package.json')))
unstageFromCabinet(daily, 'web', '@fake/thing')
check('⭐ 卸掉后空的 @fake 目录也收走了', !existsSync(join(daily, 'profiles', 'web', '_local', '@fake')))

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
