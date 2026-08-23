/**
 * Prove a plugin belongs to the workspace, not to the launch.
 *
 * This is the change that made "is it installed?" a question with an answer.
 * A plugin used to be carried by a launch — written into an overlay, passed as
 * `--patch`, and on the real home taken back out on exit — so the same
 * workspace opened by hand had none of them, and nothing on disk could be
 * consulted. Now it is registered in the workspace's own profile patch, which
 * is the file dsh reads by itself.
 *
 * What is checked here is the part that has to hold for that to be safe:
 * entries this tool wrote are told apart from entries that were already there,
 * removal takes out exactly the former, and a backup exists for when the former
 * cannot be found.
 *
 * ⛔ Never points at the real `~/.dsh`: every workspace here is a throwaway
 * directory, nothing is downloaded, and no dsh is started.
 *
 * Usage:
 *   node tools/check-plugin-mounts.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, ensureBox } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-plugin-mounts.mjs <一次性目录>')
  process.exit(2)
}

rmSync(root, { recursive: true, force: true })
const box = join(root, 'data')
ensureBox(box)
const layout = boxLayout(box)

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

// ⛔ A throwaway stand-in for the daily workspace. `userDshHome()` takes
//    `DSH_HOME` from the environment, so `--main` can be exercised without ever
//    naming the real `~/.dsh` — which matters here because backups are now a
//    daily-workspace-only thing, so the only way to test them is through
//    `--main`.
const fakeDaily = join(root, 'fake-daily-home')
mkdirSync(join(fakeDaily, 'profiles', 'web'), { recursive: true })

/** Run the real command line and return its one JSON line. */
function cli(...argv) {
  return new Promise((resolve_) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_HOME: fakeDaily },
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.resume()
    child.once('close', () => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      try {
        resolve_(JSON.parse(line))
      } catch {
        resolve_({ ok: false, code: 'NO_OUTPUT', message: out })
      }
    })
  })
}

/**
 * A folder shaped like a dsh plugin: the three checks all pass on it.
 * @param {string} name - the package name.
 * @param {string} [folder] - folder to build it in, when two folders must claim
 * the same package name.
 */
function makePlugin(name, folder = name) {
  const dir = join(root, folder)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name, version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {} },
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default {}\n')
  return dir
}

const sandboxHome = join(layout.sandboxes, 'w1', 'home')
const patch = join(sandboxHome, 'profiles', 'web', 'cordis.patch.yml')
const readPatch = () => (existsSync(patch) ? readFileSync(patch, 'utf8') : '')

console.log('\n插件是工作区的属性,不是这次启动的\n')

// 0. ⛔ The line this whole knife stands on. A workspace someone wrote by hand —
//    comments, quoting style, trailing newline and all — has to come out of an
//    install-then-uninstall byte for byte identical. Measured on a real
//    `~/.dsh`: the first version left one extra blank line, which nobody would
//    see and their `git diff` would.
mkdirSync(join(sandboxHome, 'profiles', 'web'), { recursive: true })
const handWritten = "# 我自己写的,带注释\n- insert:\n    - id: mine\n      name: 'my-plugin'\n"
writeFileSync(patch, handWritten)
const roundTrip = makePlugin('gamma-plugin')
await cli('plugins', 'install', roundTrip, '--sandbox', 'w1')
await cli('plugins', 'uninstall', 'gamma-plugin', '--sandbox', 'w1')
check('⛔ 手写的配置装了又卸,逐字节回到原样', readFileSync(patch, 'utf8') === handWritten,
  JSON.stringify(readFileSync(patch, 'utf8').slice(-24)))
rmSync(join(layout.sandboxes, 'w1'), { recursive: true, force: true })

// 0b. ⛔⛔ The file a new user actually gets, which is the one nobody ever tried.
//     dsh writes a fresh profile patch as three comments and `[]` — a finished
//     YAML document — so appending our block after it made a second document,
//     dsh refused to parse the profile at all, and that sandbox could never
//     boot again. One plugin into one new sandbox was enough, on Windows and
//     on Linux alike.
//
//     ⭐ Every fixture above is hand-made and not one of them ends in `[]`.
//     These tests were checking that the right text went into the file; what
//     went unchecked is whether dsh would still read the file afterwards.
mkdirSync(join(sandboxHome, 'profiles', 'web'), { recursive: true })
const dshDefault = '# Your patch layer for this dsh profile, applied after every bundle layer:\n'
  + '# a top-level YAML array of loader patch entries (id-targeted config\n'
  + '# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n'
writeFileSync(patch, dshDefault)
const outsideBlock = () => {
  const text = readPatch()
  const start = text.indexOf('# >>> dsh-box')
  const end = text.indexOf('# <<< dsh-box')
  const rest = start === -1 ? text : text.slice(0, start) + text.slice(end === -1 ? text.length : end)
  return rest.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}
await cli('plugins', 'install', makePlugin('delta-plugin'), '--sandbox', 'w1')
check('⛔⛔ 装进 dsh 自己写的默认配置后,块外不再留着那个 [](留着 dsh 就整份拒绝解析)',
  !outsideBlock().includes('[]'), JSON.stringify(outsideBlock()))
check('⭐ 块里记着这份空清单是我们收走的,所以卸的时候知道要还回去',
  readPatch().includes('# dsh-box: empty-list'))
await cli('plugins', 'install', makePlugin('epsilon-plugin'), '--sandbox', 'w1')
check('⛔ 装第二个的时候没把它漏回去', !outsideBlock().includes('[]'))
await cli('plugins', 'uninstall', 'delta-plugin', '--sandbox', 'w1')
check('⛔ 只卸掉一个的时候不还,因为块还在', !outsideBlock().includes('[]'))
await cli('plugins', 'uninstall', 'epsilon-plugin', '--sandbox', 'w1')
check('⛔⛔ 全卸掉之后逐字节回到 dsh 写的原样,不多不少一个 []',
  readPatch() === dshDefault, JSON.stringify(readPatch().slice(-16)))
rmSync(join(layout.sandboxes, 'w1'), { recursive: true, force: true })

// 1. A fresh workspace has nothing, and says so rather than failing.
const empty = await cli('plugins', '--sandbox', 'w1')
check('没装过东西的工作区报「一个都没有」而不是出错',
  empty.ok === true && empty.ours.length === 0 && empty.theirs.length === 0,
  empty.code ?? `ours=${empty.ours?.length} theirs=${empty.theirs?.length}`)

// 2. Installing writes into the workspace's own file — the one dsh reads by
//    itself, which is what makes `dsh` typed by hand load it too.
const first = makePlugin('alpha-plugin')
const installed = await cli('plugins', 'install', first, '--sandbox', 'w1')
check('装进去了', installed.ok === true, installed.code ?? 'ok')
check('写的是工作区自己的 profile 配置,不是我们的数据目录',
  readPatch().includes('"alpha-plugin"'), patch.replace(root, '…'))
check('包被链接进 profile 的 node_modules,名字解析得到',
  existsSync(join(sandboxHome, 'profiles', 'web', 'node_modules', 'alpha-plugin')))

// 3. It is reported as ours, which is what makes it removable.
const listed = await cli('plugins', '--sandbox', 'w1')
check('列出来算「dsh-box 装的」', listed.ours.length === 1 && listed.ours[0].package === 'alpha-plugin',
  JSON.stringify(listed.ours))

// 4. Something the workspace had before we arrived. Written outside our block,
//    the way anything not us would write it.
writeFileSync(patch, `# 这一段是这个工作区本来就有的\n- insert:\n    - id: "theirs"\n      name: "their-plugin"\n${readPatch()}`)
const mixed = await cli('plugins', '--sandbox', 'w1')
check('本来就有的那条被认出来,归在另一栏',
  mixed.theirs.includes('their-plugin') && mixed.ours.length === 1,
  `ours=${mixed.ours.length} theirs=${mixed.theirs.join('、')}`)

// 5. ⛔ The one that matters: removal takes out exactly what we wrote.
const removed = await cli('plugins', 'uninstall', 'alpha-plugin', '--sandbox', 'w1')
check('卸得掉我们装的那条', removed.ok === true, removed.code ?? 'ok')
check('⛔ 别人写进去的那条一个字没动', readPatch().includes('their-plugin'))
check('我们那条真的没了', !readPatch().includes('alpha-plugin'))
check('链接也跟着撤了', !existsSync(join(sandboxHome, 'profiles', 'web', 'node_modules', 'alpha-plugin')))

// 6. And we refuse to remove theirs, rather than doing it quietly.
const refused = await cli('plugins', 'uninstall', 'their-plugin', '--sandbox', 'w1')
check('不许卸别人写进去的,而且说得出为什么',
  refused.ok === false && refused.code === 'NOT_OURS', refused.code)

// 7. The backup is the answer for when precise removal cannot find anything.
//    ⭐ Only the daily workspace keeps them (CEO 2026-08-22): a sandbox is a
//    clean start you throw away, so a snapshot of one protects nothing.
check('⭐ 沙箱一份备份都不留', (await cli('plugins', 'backups', '--sandbox', 'w1')).backups.length === 0)

const dailyPatch = join(fakeDaily, 'profiles', 'web', 'cordis.patch.yml')
const readDaily = () => (existsSync(dailyPatch) ? readFileSync(dailyPatch, 'utf8') : '')
writeFileSync(dailyPatch, "# 假装这是日常档案柜\n- insert:\n    - id: theirs\n      name: 'their-plugin'\n")
await cli('plugins', 'install', makePlugin('daily-plugin'), '--main')
const backups = await cli('plugins', 'backups', '--main')
check('日常档案柜改过配置就有备份可还原', backups.backups.length > 0, `${backups.backups.length} 份`)
const restored = await cli('plugins', 'restore', '--main')
check('还原回得去', restored.ok === true, restored.code ?? restored.from)
check('还原之后回到装之前', !readDaily().includes('daily-plugin'))
check('还原也不会弄丢别人那条', readDaily().includes('their-plugin'))

// ⛔ 半自动清理半只涨不减是这个工具里没写在任何地方的一条规矩。日志每沙箱留
//    二十份,备份从前不设上限也没有任何命令删得掉——于是 agent 只能伸手去 rm,
//    而窗口对那个动作一无所知。
for (let round = 0; round < 8; round += 1) {
  await cli('plugins', 'install', makePlugin(`churn-${round}`), '--main')
}
const capped = await cli('plugins', 'backups', '--main')
check('⭐ 备份不会只涨不减,到上限就丢最老的',
  capped.backups.length === capped.keep, `${capped.backups.length} 份,上限 ${capped.keep}`)
const oldest = capped.backups.at(-1).at
const dropped = await cli('plugins', 'backups', 'rm', oldest, '--main')
check('⭐ 删得掉某一份,不必自己去 rm', dropped.ok === true, dropped.code ?? oldest)
check('删完真的少了一份', (await cli('plugins', 'backups', '--main')).backups.length === capped.keep - 1)
const pruned = await cli('plugins', 'backups', 'prune', '--keep', '0', '--main')
check('⭐ 也清得干净', pruned.ok === true && (await cli('plugins', 'backups', '--main')).backups.length === 0,
  `清掉 ${pruned.removed?.length} 份`)

// 8. The bundle list is read and never written. ⛔ It was written, briefly, and
//    a real `~/.dsh` said no: a profile dsh's own tooling has touched holds
//    `link:` dependencies, which npm refuses outright (EUNSUPPORTEDPROTOCOL) —
//    so running npm in a profile is not a thing that works out there, and with
//    it went the reason to write that file at all. What must hold now is that
//    everything in it reads as the workspace's own, with the official base
//    bundles kept out of the plugin list so they stop being noise on every row.
const profilePackage = join(sandboxHome, 'profiles', 'web', 'package.json')
writeFileSync(profilePackage, `${JSON.stringify({
  name: 'profile-web',
  dependencies: { 'their-plugin': 'link:./_local/their-plugin' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@someone/theirs'] } },
}, null, 2)}\n`)
const { cabinetPlugins } = await import('../src/mounts.js')
const withBundles = cabinetPlugins(sandboxHome)
check('bundles 里的都算这个工作区自己的,我们不认领',
  withBundles.theirs.includes('@someone/theirs')
  && !withBundles.ours.some((entry) => entry.package === '@someone/theirs'),
  withBundles.theirs.join('、'))
check('官方基座单列,不混进插件名单',
  withBundles.platform.includes('@deepseek-ai/dsh-base')
  && !withBundles.theirs.includes('@deepseek-ai/dsh-base'),
  withBundles.platform.join('、'))
const untouched = readFileSync(profilePackage, 'utf8')
await cli('plugins', 'install', makePlugin('beta-plugin'), '--sandbox', 'w1')
await cli('plugins', 'uninstall', 'beta-plugin', '--sandbox', 'w1')
check('⛔ 装了又卸一轮,profile 的 package.json 一个字节没动',
  readFileSync(profilePackage, 'utf8') === untouched)

// 9. Conversations copy in both directions now. The window only offers one, the
//    command line does not need that restriction.
mkdirSync(join(layout.sandboxes, 'w2', 'home', 'sessions', 'group-a', 'session-1'), { recursive: true })
writeFileSync(join(layout.sandboxes, 'w2', 'home', 'sessions', 'group-a', 'session-1', 'session.jsonl'), '{}\n')
const copied = await cli('adopt', '--from', 'w2', '--to', 'w1')
check('沙箱之间也复制得动', copied.ok === true && copied.adopted === 1, copied.code ?? `${copied.adopted} 条`)
check('原件留在来源那边,是复制不是搬走',
  existsSync(join(layout.sandboxes, 'w2', 'home', 'sessions', 'group-a', 'session-1')))
const again = await cli('adopt', '--from', 'w2', '--to', 'w1')
check('重复跑是安全的,已有的跳过', again.ok === true && again.skipped === 1 && again.adopted === 0,
  `复制 ${again.adopted} 跳过 ${again.skipped}`)
const sameBoth = await cli('adopt', '--from', 'w2', '--to', 'w2')
check('从哪儿到哪儿是同一个工作区会被拦下', sameBoth.code === 'SAME_WORKSPACE', sameBoth.code)

// 10. ⛔⛔ The one that used to be unrecoverable: another package already holds
//     this name. The link is what does the damage — it replaces whatever is
//     under that name without looking — so the refusal has to land above it.
//     Before the fix the order was link-then-check, which swapped the
//     workspace's own package out and then reported "already there, skipped",
//     recording nothing, leaving `uninstall` with nothing to undo.
const theirSource = makePlugin('victim-plugin', 'their-copy')
const w3Home = join(layout.sandboxes, 'w3', 'home')
const w3Patch = join(w3Home, 'profiles', 'web', 'cordis.patch.yml')
const w3Slot = join(w3Home, 'profiles', 'web', 'node_modules', 'victim-plugin')
mkdirSync(join(w3Home, 'profiles', 'web', 'node_modules'), { recursive: true })
writeFileSync(w3Patch, "- insert:\n    - id: victim\n      name: 'victim-plugin'\n")
symlinkSync(theirSource, w3Slot, 'junction')
const theirPatch = readFileSync(w3Patch, 'utf8')

const ourCopy = makePlugin('victim-plugin', 'our-copy')
const collided = await cli('plugins', 'install', ourCopy, '--sandbox', 'w3')
check('⛔ 包名被别人占着时拒绝,而且说得出为什么',
  collided.ok === false && collided.code === 'PLUGIN_NAME_TAKEN', collided.code)
check('⛔⛔ 拒绝时一个字节都没动过——链接还指着人家的源码',
  existsSync(join(w3Slot, 'package.json')) && realpathSync(w3Slot) === realpathSync(theirSource),
  realpathSync(w3Slot) === realpathSync(theirSource) ? '仍指向 their-copy' : '⚠ 被换掉了')
check('⛔ 拒绝时配置文件也没动', readFileSync(w3Patch, 'utf8') === theirPatch)

// The other half of the same decision: pointing at the very folder already
// linked there is not a collision, it is nothing to do — and saying "already
// installed" is only honest because this branch runs before anything is written.
const sameFolder = await cli('plugins', 'install', theirSource, '--sandbox', 'w3')
check('指向同一份东西时当作已完成,不当成冲突',
  sameFolder.ok === true && sameFolder.alreadyThere === true, sameFolder.code ?? 'ok')
check('「已完成」那条路也确实什么都没写', readFileSync(w3Patch, 'utf8') === theirPatch)

// 11. An unreadable patch must stop the install above the link too — that check
//     used to live in `mountPlugin`, one line after the damage was done.
const w4Home = join(layout.sandboxes, 'w4', 'home')
const w4Patch = join(w4Home, 'profiles', 'web', 'cordis.patch.yml')
mkdirSync(join(w4Home, 'profiles', 'web'), { recursive: true })
writeFileSync(w4Patch, '# >>> dsh-box: maintained automatically, rewritten whenever plugins change\n(没有收尾那一行)\n')
const unreadable = await cli('plugins', 'install', makePlugin('delta-plugin'), '--sandbox', 'w4')
check('⛔ 配置读不懂就不装,而不是装完再抱怨',
  unreadable.ok === false && unreadable.code === 'UNREADABLE_PATCH', unreadable.code)
check('⛔ 读不懂时链接也没建',
  !existsSync(join(w4Home, 'profiles', 'web', 'node_modules', 'delta-plugin')))

// 12. ⛔⛔ 下载的包得有人管得着。
//     `layout.packages` 从前全仓只有一个访问者:下载的时候往里写,之后再没有
//     任何代码看过它一眼。既列不出来也删不掉,`plugins uninstall` 还故意不删包
//     (为的是装回来是瞬间的事),于是唯一的办法是开个 shell 去 rm ——而那个动作
//     窗口一概看不见。**只给了「做」,没给「撤」和「看」。**
//
//     这里不联网:下载过的包落在磁盘上就是一个普通文件夹,手工造一个,后面整条
//     路(登记、链接、拒绝删、清理)与真下载的完全同一条。
const downloaded = join(box, 'packages', 'node_modules')
mkdirSync(downloaded, { recursive: true })
const fakeDownload = makePlugin('fetched-plugin', join('data', 'packages', 'node_modules', 'fetched-plugin'))
makePlugin('unused-plugin', join('data', 'packages', 'node_modules', 'unused-plugin'))

const shelf = await cli('packages')
check('⭐ 下载过的包列得出来了', (shelf.packages ?? []).length === 2,
  (shelf.packages ?? []).map((one) => one.name).join('、'))
check('没人用的就说没人用',
  (shelf.packages ?? []).every((one) => one.usedBy.length === 0))

await cli('plugins', 'install', fakeDownload, '--sandbox', 'w5')
const inUse = await cli('packages')
check('⭐ 装进工作区之后,列表直接说出是谁在用',
  inUse.packages.find((one) => one.name === 'fetched-plugin')?.usedBy.includes('w5'),
  JSON.stringify(inUse.packages.map((one) => `${one.name}:${one.usedBy.join(',') || '无'}`)))

const busy = await cli('packages', 'rm', 'fetched-plugin')
check('⛔ 还有工作区在用就不许删,而且说得出是哪几个',
  busy.ok === false && busy.code === 'PACKAGE_IN_USE', busy.code)
check('⛔ 被拒绝时那个包还在', existsSync(join(downloaded, 'fetched-plugin', 'package.json')))

const swept = await cli('packages', 'prune')
check('⭐ prune 只清没人用的,在用的一个不碰',
  swept.removed?.length === 1 && swept.removed[0] === 'unused-plugin', JSON.stringify(swept.removed))
check('在用的那个还在', existsSync(join(downloaded, 'fetched-plugin', 'package.json')))

await cli('plugins', 'uninstall', 'fetched-plugin', '--sandbox', 'w5')
const freed = await cli('packages', 'rm', 'fetched-plugin')
check('⭐ 从工作区卸掉之后就删得动了', freed.ok === true, freed.code ?? 'ok')
check('包真的没了', !existsSync(join(downloaded, 'fetched-plugin')))

// 13. ⛔⛔ 「弄走一个插件」以前只做了三件事里的一件。
//     那个按钮叫「不再记」,按下去登记表里那行就没了,读起来像「这个插件弄走了」
//     ——而装过它的工作区照旧加载它,下载的那份包也还在磁盘上。真要清干净得跨
//     两种状态走三步,界面上和 help 里都没有任何地方说明这一点。
//     ⭐ 现在做什么只取决于文件是谁的:自己的文件夹只去链接与登记,下载的连包一起删。
const myFolder = makePlugin('mine-plugin')
await cli('plugins', 'add', myFolder)
await cli('plugins', 'install', 'mine-plugin', '--sandbox', 'w6')
await cli('plugins', 'install', 'mine-plugin', '--sandbox', 'w7')
const goneMine = await cli('plugins', 'rm', 'mine-plugin')
check('⭐ 一条命令从每个装过它的工作区都卸掉了',
  goneMine.ok === true && goneMine.detached.length === 2,
  (goneMine.detached ?? []).map((one) => one.workspace).join('、'))
check('登记表里也没了',
  !((await cli('plugins')).plugins ?? []).some((one) => one.id === 'mine-plugin'))
check('⛔⛔ 我自己的文件夹一个字节没动 —— 那是我的东西',
  existsSync(join(myFolder, 'package.json')) && goneMine.deletedPackage === false)

const asDownload = makePlugin('grabbed-plugin', join('data', 'packages', 'node_modules', 'grabbed-plugin'))
await cli('plugins', 'install', asDownload, '--sandbox', 'w6')
const goneDl = await cli('plugins', 'rm', 'grabbed-plugin')
check('⭐ 下载的那种,连包体一起删',
  goneDl.ok === true && goneDl.deletedPackage === true, `deletedPackage=${goneDl.deletedPackage}`)
check('包真的从磁盘上没了',
  !existsSync(join(box, 'packages', 'node_modules', 'grabbed-plugin')))

// ⛔ 那道闸门:人指的是登记表里的一行,而动作伸到了他没点名的日常档案柜。
const reaching = makePlugin('reaching-plugin')
await cli('plugins', 'install', reaching, '--main')
await cli('plugins', 'install', 'reaching-plugin', '--sandbox', 'w6')
const halted = await cli('plugins', 'rm', 'reaching-plugin')
check('⛔ 会动到日常档案柜时先拦下来',
  halted.ok === false && halted.code === 'NEEDS_APPROVAL', halted.code)
check('⛔ 拦下来时是真的什么都没做',
  readFileSync(dailyPatch, 'utf8').includes('reaching-plugin'))
check('而且说得出会动哪几处',
  (halted.places ?? []).includes('日常档案柜'), (halted.places ?? []).join('、'))

const approved = await cli('plugins', 'rm', 'reaching-plugin', '--approved')
check('点过头之后照做', approved.ok === true && approved.detached.length === 2,
  (approved.detached ?? []).map((one) => one.workspace).join('、'))
check('日常档案柜里真的没了', !readFileSync(dailyPatch, 'utf8').includes('reaching-plugin'))
check('⛔ 别人本来就有的那条照旧没动', readFileSync(dailyPatch, 'utf8').includes('their-plugin'))

// 关掉那个开关之后,两边都不再拦 —— 一个开关,两种投影。
await cli('config', 'ask-on-daily', 'off')
await cli('plugins', 'install', makePlugin('quiet-plugin'), '--main')
const quiet = await cli('plugins', 'rm', 'quiet-plugin')
check('⭐ 关掉「再问一次」之后直接执行', quiet.ok === true, quiet.code ?? 'ok')

rmSync(root, { recursive: true, force: true })
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
