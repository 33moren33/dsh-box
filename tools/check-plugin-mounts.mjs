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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPROVAL_ENV, claimPath } from '../src/sandbox.js'
import { backupDir, boxLayout, cabinetLedgerFile, ensureBox, removeTree, uiSeatFile } from '../src/paths.js'
import { KEEP_BACKUPS } from '../src/mounts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-plugin-mounts.mjs <一次性目录>')
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

// ⛔ A throwaway stand-in for the daily workspace. `userDshHome()` takes
//    `DSH_HOME` from the environment, so the cabinet named `main` can be
//    exercised without ever naming the real `~/.dsh` — which matters here
//    because backups are now a daily-workspace-only thing, so the only way to
//    test them is through `main`.
const fakeDaily = join(root, 'fake-daily-home')
mkdirSync(join(fakeDaily, 'profiles', 'web'), { recursive: true })

/**
 * Run the real command line and return its one JSON line.
 *
 * ⛔⛔ `DSH_BOX_NO_PANEL` on every single run, without exception. Since
 * 2026-08-28 a command that hits the gate **opens a panel and blocks for a
 * minute** waiting for a person (src/approval.js) — so a suite that does not
 * say otherwise does not fail, it hangs, once per gated assertion. This switch
 * can only ever make the tool refuse *sooner*: the code stays `NEEDS_APPROVAL`,
 * so nothing an assertion says about a refusal changes meaning.
 * @param {string[]} argv
 * @param {Record<string, string>} [extraEnv]
 */
function run(argv, extraEnv = {}) {
  return new Promise((resolve_) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_HOME: fakeDaily, DSH_BOX_NO_PANEL: '1', ...extraEnv },
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

/** An ordinary run: an agent's own command line, with nobody having agreed. */
const cli = (...argv) => run(argv)

/**
 * A run the config window started **because a person clicked yes**.
 *
 * ⭐⭐ Consent stopped being a word you can type on 2026-08-28 (CEO:「不留这个
 * 参数的后门」). `approvedByWindow` now wants two things at once, and this plays
 * exactly both of them — nothing more, so the fixture cannot be greener than
 * the product: **whose child this run is** (the caller holds the ui seat, and
 * the seat's pid is this process, so the child's ppid matches) ⭐ **and why the
 * window started it** (`DSH_BOX_APPROVAL`, set only on the code path that
 * follows a person answering a request — which is why merely POSTing a command
 * to the window is a child of it and still not approval).
 * ⛔ The caller must be holding the seat. The env alone is half the test, and
 * asserting with half of it is how a guard goes green for the wrong reason.
 * @param {...string} argv
 */
const asWindow = (...argv) => run(argv, { [APPROVAL_ENV]: '1' })

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
await cli('get', 'plugin', roundTrip, '--to', 'w1')
await cli('rm', 'plugin', 'gamma-plugin', '--from', 'w1')
check('⛔ 手写的配置装了又卸,逐字节回到原样', readFileSync(patch, 'utf8') === handWritten,
  JSON.stringify(readFileSync(patch, 'utf8').slice(-24)))
removeTree(join(layout.sandboxes, 'w1'))

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
const patchLines = () => readPatch().split('\n').map((line) => line.trim()).filter((line) => line !== '')
const ledgerOf = (home) => {
  const file = cabinetLedgerFile(layout, home)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { profiles: {} }
}
await cli('get', 'plugin', makePlugin('delta-plugin'), '--to', 'w1')
check('⛔⛔ 装进 dsh 自己写的默认配置后,文件里不再留着那个 [](留着 dsh 就整份拒绝解析)',
  !patchLines().includes('[]'), JSON.stringify(patchLines()))
check('⭐ 账里记着这份空清单是我们收走的,所以卸的时候知道要还回去',
  ledgerOf(sandboxHome).profiles.web?.absorbedEmptyList === true,
  JSON.stringify(ledgerOf(sandboxHome).profiles.web ?? null))
await cli('get', 'plugin', makePlugin('epsilon-plugin'), '--to', 'w1')
check('⛔ 装第二个的时候没把它漏回去', !patchLines().includes('[]'))
await cli('rm', 'plugin', 'delta-plugin', '--from', 'w1')
check('⛔ 只卸掉一个的时候不还,因为还有我们的行在', !patchLines().includes('[]'))
await cli('rm', 'plugin', 'epsilon-plugin', '--from', 'w1')
check('⛔⛔ 全卸掉之后逐字节回到 dsh 写的原样,不多不少一个 []',
  readPatch() === dshDefault, JSON.stringify(readPatch().slice(-16)))
// ⭐⭐ 这一条是刀 4 的整个理由:文件里从头到尾没有一个字是 dsh-box 写给自己看的,
//    所以它是一份可以整份复制到别的档案柜去的插件名单。
check('⭐⭐ 全程没往别人的文件里写过任何 dsh-box 标记', !readPatch().includes('dsh-box'))
removeTree(join(layout.sandboxes, 'w1'))

// 1. A fresh workspace has nothing, and says so rather than failing.
const empty = await cli('ls', 'plugin', '--in', 'w1')
check('没装过东西的工作区报「一个都没有」而不是出错',
  empty.ok === true && empty.ours.length === 0 && empty.theirs.length === 0,
  empty.code ?? `ours=${empty.ours?.length} theirs=${empty.theirs?.length}`)

// 2. Installing writes into the workspace's own file — the one dsh reads by
//    itself, which is what makes `dsh` typed by hand load it too.
const first = makePlugin('alpha-plugin')
const installed = await cli('get', 'plugin', first, '--to', 'w1')
check('装进去了', installed.ok === true, installed.code ?? 'ok')
check('写的是工作区自己的 profile 配置,不是我们的数据目录',
  readPatch().includes('"alpha-plugin"'), patch.replace(root, '…'))
check('包被链接进 profile 的 node_modules,名字解析得到',
  existsSync(join(sandboxHome, 'profiles', 'web', 'node_modules', 'alpha-plugin')))

// 3. It is reported as ours, which is what makes it removable.
const listed = await cli('ls', 'plugin', '--in', 'w1')
check('列出来算「dsh-box 装的」', listed.ours.length === 1 && listed.ours[0].package === 'alpha-plugin',
  JSON.stringify(listed.ours))

// 4. Something the workspace had before we arrived. Written outside our block,
//    the way anything not us would write it.
writeFileSync(patch, `# 这一段是这个工作区本来就有的\n- insert:\n    - id: "theirs"\n      name: "their-plugin"\n${readPatch()}`)
const mixed = await cli('ls', 'plugin', '--in', 'w1')
check('本来就有的那条被认出来,归在另一栏',
  mixed.theirs.includes('their-plugin') && mixed.ours.length === 1,
  `ours=${mixed.ours.length} theirs=${mixed.theirs.join('、')}`)

// 5. ⛔ The one that matters: removal takes out exactly what we wrote.
const removed = await cli('rm', 'plugin', 'alpha-plugin', '--from', 'w1')
check('卸得掉我们装的那条', removed.ok === true, removed.code ?? 'ok')
check('⛔ 别人写进去的那条一个字没动', readPatch().includes('their-plugin'))
check('我们那条真的没了', !readPatch().includes('alpha-plugin'))
check('链接也跟着撤了', !existsSync(join(sandboxHome, 'profiles', 'web', 'node_modules', 'alpha-plugin')))

// 6. And we refuse to remove theirs, rather than doing it quietly.
const refused = await cli('rm', 'plugin', 'their-plugin', '--from', 'w1')
check('不许卸别人写进去的,而且说得出为什么',
  refused.ok === false && refused.code === 'NOT_OURS', refused.code)

// 7. The backup is the answer for when precise removal cannot find anything.
//    ⭐ Only the daily workspace keeps them (CEO 2026-08-22): a sandbox is a
//    clean start you throw away, so a snapshot of one protects nothing.
// ⛔ 从磁盘上数,不再问命令 —— 列备份那条命令随刀 1 删了(不给选哪一份,
//    所以不需要列)。⭐ 这几条断言本来问的就是磁盘状态,少了一层转述反而更直接。
const backupsOf = (home) => {
  const dir = backupDir(layout, home)
  return existsSync(dir) ? readdirSync(dir) : []
}
check('⭐ 沙箱一份备份都不留', backupsOf(join(layout.sandboxes, 'w1', 'home')).length === 0)

const dailyPatch = join(fakeDaily, 'profiles', 'web', 'cordis.patch.yml')
const readDaily = () => (existsSync(dailyPatch) ? readFileSync(dailyPatch, 'utf8') : '')
writeFileSync(dailyPatch, "# 假装这是日常档案柜\n- insert:\n    - id: theirs\n      name: 'their-plugin'\n")
// ⭐ From here on the daily cabinet is being written, and **every** write to it
// now needs a person in the window (`check-daily-gate` is where that rule is
// asserted). So the seat is held for this stretch — which is also the honest
// picture: this is what the window does when somebody clicks.
// ⛔ 座位走产品自己的写入口,夹具不手抄它的字段。
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10130' })
await asWindow('get', 'plugin', makePlugin('daily-plugin'), '--to', 'main')
check('日常档案柜改过配置就有备份可还原', backupsOf(fakeDaily).length > 0, `${backupsOf(fakeDaily).length} 份`)
const restored = await asWindow('set', 'plugin', '--undo', '--in', 'main')
check('还原回得去', restored.ok === true, restored.code ?? restored.from)
check('还原之后回到装之前', !readDaily().includes('daily-plugin'))
check('还原也不会弄丢别人那条', readDaily().includes('their-plugin'))

// 7b. ⭐⭐ 撤销要能**连按**,一步一步往回走(CEO 2026-08-28)。
//     ⛔ 这一组里第二次那条断言就是「必然会输的对照组」:旧实现在还原之前会先把
//     现在这份压进备份堆,于是第二次按拿到的正是第一次按之前的状态 —— 在两个状态
//     之间来回跳,而每一次单独看都像成功了。**只测一次撤销,永远发现不了它。**
await asWindow('get', 'plugin', makePlugin('step-one'), '--to', 'main')
await asWindow('get', 'plugin', makePlugin('step-two'), '--to', 'main')
check('两步都装上了', readDaily().includes('step-one') && readDaily().includes('step-two'))

const back1 = await asWindow('set', 'plugin', '--undo', '--in', 'main')
check('⭐ 退一步:第二个没了,第一个还在',
  !readDaily().includes('step-two') && readDaily().includes('step-one'),
  `two=${readDaily().includes('step-two')} one=${readDaily().includes('step-one')}`)

const back2 = await asWindow('set', 'plugin', '--undo', '--in', 'main')
check('⭐⭐ 再按一次真的**再退一步**,而不是跳回刚才那个状态',
  !readDaily().includes('step-one') && !readDaily().includes('step-two'),
  `one=${readDaily().includes('step-one')} two=${readDaily().includes('step-two')}`)
check('⛔ 退过头也不会把别人那条弄丢', readDaily().includes('their-plugin'))
check('⭐ 每退一步,「还能再退几步」都要变小(它是替代备份列表的那句话)',
  typeof back1.remaining === 'number' && back2.remaining < back1.remaining,
  `${back1.remaining} → ${back2.remaining}`)
// ⛔ 退到头要说得出来,而不是报错或者假装又退了一步。
let guard = 0
let last = back2
while (last.ok === true && guard < 10) { last = await asWindow('set', 'plugin', '--undo', '--in', 'main'); guard += 1 }
check('⭐ 一直按到底,最后诚实地说没有更早的了',
  last.ok === false && last.code === 'NO_BACKUP', last.code ?? 'ok')

// ⛔ 半自动清理半只涨不减是这个工具里没写在任何地方的一条规矩。日志每沙箱留
//    二十份,备份从前不设上限也没有任何命令删得掉——于是 agent 只能伸手去 rm,
//    而窗口对那个动作一无所知。
for (let round = 0; round < 8; round += 1) {
  await asWindow('get', 'plugin', makePlugin(`churn-${round}`), '--to', 'main')
}
check('⭐ 备份不会只涨不减,到上限就丢最老的',
  backupsOf(fakeDaily).length === KEEP_BACKUPS, `${backupsOf(fakeDaily).length} 份,上限 ${KEEP_BACKUPS}`)
// ⛔⛔ 这里原来还有三条:删掉某一份 / 按上限清一次 / 清得干净。它们随刀 1 一起删了,
//    而理由不是「不重要」,是**这个问题被定义掉了**:一旦可以选哪一份,人就得先看懂
//    那张时间戳表 —— 而人真正想要的从来只是「回到我改坏之前」,那件事现在靠连按
//    plugins restore 完成(守卫在本册 7b 节)。轮转本来就是自动的,所以没有东西会涨。
// ⛔ Give the seat back. Everything below asserts that the gate holds when
// nobody has agreed, and that only means anything while the seat is empty —
// leaving it held would turn those checks green for the opposite reason.
rmSync(uiSeatFile(layout), { force: true })

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
const withBundles = cabinetPlugins(layout, sandboxHome)
check('bundles 里的都算这个工作区自己的,我们不认领',
  withBundles.theirs.includes('@someone/theirs')
  && !withBundles.ours.some((entry) => entry.package === '@someone/theirs'),
  withBundles.theirs.join('、'))
check('官方基座单列,不混进插件名单',
  withBundles.platform.includes('@deepseek-ai/dsh-base')
  && !withBundles.theirs.includes('@deepseek-ai/dsh-base'),
  withBundles.platform.join('、'))
const untouched = readFileSync(profilePackage, 'utf8')
await cli('get', 'plugin', makePlugin('beta-plugin'), '--to', 'w1')
await cli('rm', 'plugin', 'beta-plugin', '--from', 'w1')
check('⛔ 装了又卸一轮,profile 的 package.json 一个字节没动',
  readFileSync(profilePackage, 'utf8') === untouched)

// 9. Conversations copy in both directions now. The window only offers one, the
//    command line does not need that restriction.
mkdirSync(join(layout.sandboxes, 'w2', 'home', 'sessions', 'group-a', 'session-1'), { recursive: true })
writeFileSync(join(layout.sandboxes, 'w2', 'home', 'sessions', 'group-a', 'session-1', 'session.jsonl'), '{}\n')
const copied = await cli('get', 'chat', '--from', 'w2', '--to', 'w1')
check('沙箱之间也复制得动', copied.ok === true && copied.adopted === 1, copied.code ?? `${copied.adopted} 条`)
check('原件留在来源那边,是复制不是搬走',
  existsSync(join(layout.sandboxes, 'w2', 'home', 'sessions', 'group-a', 'session-1')))
const again = await cli('get', 'chat', '--from', 'w2', '--to', 'w1')
check('重复跑是安全的,已有的跳过', again.ok === true && again.skipped === 1 && again.adopted === 0,
  `复制 ${again.adopted} 跳过 ${again.skipped}`)
const sameBoth = await cli('get', 'chat', '--from', 'w2', '--to', 'w2')
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
const collided = await cli('get', 'plugin', ourCopy, '--to', 'w3')
check('⛔ 包名被别人占着时拒绝,而且说得出为什么',
  collided.ok === false && collided.code === 'PLUGIN_NAME_TAKEN', collided.code)
check('⛔⛔ 拒绝时一个字节都没动过——链接还指着人家的源码',
  existsSync(join(w3Slot, 'package.json')) && realpathSync(w3Slot) === realpathSync(theirSource),
  realpathSync(w3Slot) === realpathSync(theirSource) ? '仍指向 their-copy' : '⚠ 被换掉了')
check('⛔ 拒绝时配置文件也没动', readFileSync(w3Patch, 'utf8') === theirPatch)

// The other half of the same decision: pointing at the very folder already
// linked there is not a collision, it is nothing to do — and saying "already
// installed" is only honest because this branch runs before anything is written.
const sameFolder = await cli('get', 'plugin', theirSource, '--to', 'w3')
check('指向同一份东西时当作已完成,不当成冲突',
  sameFolder.ok === true && sameFolder.alreadyThere === true, sameFolder.code ?? 'ok')
check('「已完成」那条路也确实什么都没写', readFileSync(w3Patch, 'utf8') === theirPatch)

// 10b. ⛔⛔ 我们**自己**装过的那一份,再装一遍。
//      `claimOn` 一直认得这一种(判决 `ours`),但命令行只处理了 unreadable /
//      taken / same 三种,`ours` 一路掉进下面的 link + mount —— 而 mountPlugin 是
//      追加,于是 patch 里多出一行一模一样的 insert。实测撞到过:窗口里同一个插件
//      列了两次,而登记表里只有一个。
//      ⭐ 这两条在修之前必然失败,在修之后必然通过 —— 旧套件全绿是因为它从没装过第二遍。
const w5Patch = join(layout.sandboxes, 'w5', 'home', 'profiles', 'web', 'cordis.patch.yml')
const w5Slot = join(layout.sandboxes, 'w5', 'home', 'profiles', 'web', 'node_modules', 'twice-plugin')
const twice = makePlugin('twice-plugin')
await cli('get', 'plugin', twice, '--to', 'w5')
const afterFirst = readFileSync(w5Patch, 'utf8')
const rows = (text) => (text.match(/name:\s*"?twice-plugin"?/g) ?? []).length
check('装第一遍:patch 里有它,一行', rows(afterFirst) === 1, `${rows(afterFirst)} 行`)

const twiceAgain = await cli('get', 'plugin', twice, '--to', 'w5')
check('⛔⛔ 装第二遍:说「已经装着」,而不是默默再装一次',
  twiceAgain.ok === true && twiceAgain.alreadyThere === true && twiceAgain.relinked === false,
  twiceAgain.code ?? JSON.stringify(twiceAgain.relinked))
check('⛔⛔ patch 逐字节没变 —— 没有第二行', readFileSync(w5Patch, 'utf8') === afterFirst,
  `${rows(readFileSync(w5Patch, 'utf8'))} 行`)

// 10c. 另一半:行还在、链接断了。⭐ 这一条防的是"一刀切跳过"——那样断链永远修不回来,
//      而且工具会一边说「已经装好了」一边让 dsh 加载不到它。
removeTree(w5Slot)
const repaired = await cli('get', 'plugin', twice, '--to', 'w5')
check('⭐ 行还在但链接断了:重新指好,并且说出来了',
  repaired.ok === true && repaired.alreadyThere === true && repaired.relinked === true,
  repaired.code ?? JSON.stringify(repaired.relinked))
check('⭐ 链接真的回来了', existsSync(join(w5Slot, 'package.json')))
check('⛔ 修链接也没有往 patch 里多加一行', rows(readFileSync(w5Patch, 'utf8')) === 1,
  `${rows(readFileSync(w5Patch, 'utf8'))} 行`)

// 11. An unreadable patch must stop the install above the link too — that check
//     used to live in `mountPlugin`, one line after the damage was done.
//     ⛔ Since 刀 4 there is exactly one thing that makes a patch unreadable, and
//     this is it: a block a *previous version* wrote, opened and never closed.
//     Not understanding the YAML is not it — the scanner carries anything it
//     does not understand through byte for byte, so that case is the normal one.
const w4Home = join(layout.sandboxes, 'w4', 'home')
const w4Patch = join(w4Home, 'profiles', 'web', 'cordis.patch.yml')
mkdirSync(join(w4Home, 'profiles', 'web'), { recursive: true })
writeFileSync(w4Patch, '# >>> dsh-box: maintained automatically, rewritten whenever plugins change\n(没有收尾那一行)\n')
const unreadable = await cli('get', 'plugin', makePlugin('delta-plugin'), '--to', 'w4')
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

// ⛔⛔ 从磁盘上看,不再问命令。列包体 / 删包体 / 清没人用的三条随刀 1 删了 ——
//    ⭐ 它们伺候的是「我们内部有个包体仓」这件事,而调用方本来不该知道它存在。
//    这一节因此从「命令说得对不对」变成「磁盘上发生了什么」,而后者才是断言真正
//    关心的东西:少了一层转述,也就少了一个可以骗过自己的地方。
const onDisk = (name) => existsSync(join(downloaded, name, 'package.json'))
check('⭐ 两个包都在下载仓里', onDisk('fetched-plugin') && onDisk('unused-plugin'))

await cli('get', 'plugin', fakeDownload, '--to', 'w5')
check('装进工作区之后它还在(有人用着,不该被清)', onDisk('fetched-plugin'))
// ⛔ 没有任何档案柜引用的那个,也不会被顺手清掉 —— 自清只在「有人松手」那一刻发生,
//    不是每条命令都去扫一遍。⭐ 这条是必然会输的对照组的反面:它保证自清没有变成
//    「见到没人用的就删」,那种实现会在下载完成、还没来得及装的那几秒里删掉刚下的包。
check('⛔ 从没被装过的那个也还在(自清只在松手那一刻发生)', onDisk('unused-plugin'))

// ⭐⭐ 最后一个工作区松手,下载的那份就跟着走 —— 不必谁回头来收拾。
//     ⛔ 这条断言以前测的是反面(「卸掉之后就**删得动**了」),而那正是把「我们内部
//     有个包体仓」变成调用方的功课:先卸,再记得回来删。真正该发生的是它自己没了,
//     packages 那一族命令因此整个不需要存在。
const letGo = await cli('rm', 'plugin', 'fetched-plugin', '--from', 'w5')
check('⭐⭐ 最后一个工作区卸掉它,下载的那份自己就没了',
  letGo.deletedPackages?.includes('fetched-plugin') === true, JSON.stringify(letGo.deletedPackages))
check('包真的没了', !existsSync(join(downloaded, 'fetched-plugin')))
// ⛔ 说过删了就要真删干净。一个留下的空壳会让下一次「装回来」以为已经下载过而跳过
//    下载,然后 dsh 指着一个没有内容的包名启动 —— 那是它拒绝加载整棵插件树的样子。
check('⛔ 连它那层 @scope/空壳都没留下', !existsSync(join(downloaded, 'fetched-plugin')))

// 13. ⛔⛔ 这里原来测的是 plugins rm ——「一条命令把这个插件从每个档案柜弄走」。
//     那条命令随刀 1 删了(登记表没了,「从登记表移除」也就没了),而**「一次从所有
//     档案柜弄走」是不是真需求、要不要做成 rm plugin <id> --everywhere,CEO 还没拍板**
//     (契约 check-command-map 的 open 栏里列着)。
//     ⭐ 所以这一节不是被删,是**在等一个裁决**:裁决落下来之前留着一个测不存在
//     命令的验收,只会在每次跑测试时假装这件事还有人管。
//     ⚠️ 它守过的那条原则没有作废,而且已经在别处守着:做什么只取决于文件是谁的 ——
//     自己的文件夹只去链接,下载的连包一起删(本册第 12 节 deletedPackages 那几条)。

const asDownload = makePlugin('grabbed-plugin', join('data', 'packages', 'node_modules', 'grabbed-plugin'))
await cli('get', 'plugin', asDownload, '--to', 'w6')
const goneDl = await cli('rm', 'plugin', 'grabbed-plugin', '--from', 'w6')
check('⭐ 下载的那种,连包体一起删',
  goneDl.ok === true && (goneDl.deletedPackages ?? []).includes('grabbed-plugin'),
  JSON.stringify(goneDl.deletedPackages))
check('包真的从磁盘上没了',
  !existsSync(join(box, 'packages', 'node_modules', 'grabbed-plugin')))

// ⛔ 那道闸门:人指的是登记表里的一行,而动作伸到了他没点名的日常档案柜。
const reaching = makePlugin('reaching-plugin')
// ⚠ Putting it there is itself a change to the daily cabinet, so the seat is
// held for that one step and given straight back — the checks below need it
// empty, since what they assert is that the gate holds with nobody having agreed.
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10131' })
await asWindow('get', 'plugin', reaching, '--to', 'main')
rmSync(uiSeatFile(layout), { force: true })
// ⭐ Named by id rather than by folder, and that only works because the roster
//    is **derived** now (src/roster.js): whatever the daily cabinet holds is
//    nameable, so "take what main has into a sandbox" needs nothing registered.
await cli('get', 'plugin', 'reaching-plugin', '--to', 'w6')
const halted = await cli('rm', 'plugin', 'reaching-plugin', '--from', 'main')
check('⛔ 会动到日常档案柜时先拦下来',
  halted.ok === false && halted.code === 'NEEDS_APPROVAL', halted.code)
check('⛔ 拦下来时是真的什么都没做',
  readFileSync(dailyPatch, 'utf8').includes('reaching-plugin'))
// ⛔ Asserted on identity, not on the label. `places` used to carry the
// translated name of the daily cabinet, so this line only passed in a Chinese
// locale — and worse, an agent reading `--json` got a different value depending
// on whose machine it ran on. Both were fixed together: the field now names
// cabinets the way everything else here does (`sandbox: null` is the daily one).
// ⛔ 原来断言的是 places ——「这一下会动到哪几个档案柜」,那是 plugins rm 才需要
//    回答的问题:它一条命令伸向所有柜子。rm plugin 只动被点名的那一个,所以它要
//    答的是**「哪一个」**,而不是「哪几个」。⭐ 断言跟着命令的语义走,不跟着字段名走。
check('⛔ 拒绝时说得出动的是日常档案柜(而不是只丢一句人读的话)',
  halted.main === true, JSON.stringify(halted))

// ⛔⛔ 这一条的语义在 2026-08-28 翻了个面,而它守的性质**没变**。
//    从前 `--approved` 是个存在的旗标,守卫问的是「光带它算不算数」(答:不算,
//    还得是配置窗起的);现在 CEO 定了「不留这个参数的后门」—— 同意不再是一个
//    **打得出来的词**,判据整个搬去了环境变量 ＋ 父进程(src/sandbox.js 的
//    approvedByWindow)。⭐ 所以现在唯一能守住那条性质的问法是:这个旗标**根本
//    不该被认得**。答 UNKNOWN_FLAG 才对 —— 要是哪天它又被谁加回去,哪怕加成
//    「不充分」的那种,这一条也会当场红。
const flagGone = await cli('rm', 'plugin', 'reaching-plugin', '--from', 'main', '--approved')
check('⛔⛔ --approved 这个旗标已经不存在了——同意不是一个打得出来的词',
  flagGone.ok === false && flagGone.code === 'UNKNOWN_FLAG', flagGone.code)

// ⭐ Play the window, both halves of it: hold its seat so the run is a child of
// the process on that seat, and carry `DSH_BOX_APPROVAL` — which the window
// sets only after a person has answered a request. Neither half alone is
// approval, and this is exactly what the server does on the click path.
// ⛔ 座位走产品自己的写入口,夹具不手抄它的字段。
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10130' })
const approved = await asWindow('rm', 'plugin', 'reaching-plugin', '--from', 'main')
// ⛔ 断言从 detached(「从哪几个柜子拿掉了」)改成 plugin ——
//    前者是 plugins rm 的答案形状,rm plugin 只动被点名的那一个柜子。
check('人在配置窗里点过头,照做',
  approved.ok === true && approved.plugin?.id === 'reaching-plugin',
  approved.code ?? JSON.stringify(approved.plugin ?? null))
rmSync(uiSeatFile(layout), { force: true })
check('日常档案柜里真的没了', !readFileSync(dailyPatch, 'utf8').includes('reaching-plugin'))
check('⛔ 别人本来就有的那条照旧没动', readFileSync(dailyPatch, 'utf8').includes('their-plugin'))

// ⛔⛔ 这个开关的意思变了。它曾经把闸门对**所有调用者**关掉,于是一个人为了
// 自己少点一次而勾的框,顺带把同一扇门交给了机器上跑着的任何东西。现在它只
// 说一件事:窗口不必再问我。命令行这一侧照拦不误。
await cli('set', 'ask-on-daily', 'off')
// ⚠ Same as above: getting it in there needs the seat; taking it out is what
// this checks, and that has to happen with the seat empty.
claimPath(uiSeatFile(layout), { url: 'http://127.0.0.1:10132' })
await asWindow('get', 'plugin', makePlugin('quiet-plugin'), '--to', 'main')
rmSync(uiSeatFile(layout), { force: true })
const quiet = await cli('rm', 'plugin', 'quiet-plugin', '--from', 'main')
check('⛔⛔ 关掉「再问一次」之后,命令行照样拦——那是窗口的偏好,不是给外面的通行证',
  quiet.ok === false && quiet.code === 'NEEDS_APPROVAL', quiet.code ?? 'ok')

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
