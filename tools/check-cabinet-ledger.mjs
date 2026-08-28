/**
 * Prove the plugin file is plain, and that the record of who wrote what lives
 * somewhere else.
 *
 * ⭐⭐ This is the whole of 刀 4 in one sentence: **a row this tool writes is
 * spelled exactly the way a person would spell it**, so `cordis.patch.yml`
 * stays a portable list of plugins — copyable straight from a daily cabinet
 * into a sandbox — instead of a file with our bookkeeping decorating it.
 *
 * ⛔ It replaces a guarantee with a trade. The old marker comments could not
 * drift from the file they were in; a ledger can. So what is checked here is
 * not "the two always agree" — they will not — but that **every way they can
 * disagree ends in refusing rather than guessing**:
 *
 * - the ledger is lost → the rows stay, unattributed, and `uninstall` says it
 *   cannot rather than deleting something that looks about right;
 * - the ledger is damaged → read as empty, which is the same safe answer;
 * - a row is deleted by hand → it drops out of "ours" on the next read.
 *
 * And one migration: a cabinet still carrying a `v0.3.0` marker block gets it
 * folded into the ledger and the comments taken out, by the first write, with
 * the file ending up byte for byte where it was before that block ever arrived.
 *
 * ⛔ Never points at the real `~/.dsh`: every cabinet here is a throwaway
 * directory, nothing is downloaded, and no dsh is started.
 *
 * Usage: node tools/check-cabinet-ledger.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, cabinetLedgerFile, ensureBox, removeTree } from '../src/paths.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-cabinet-ledger.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
const box = join(root, 'data')
ensureBox(box)
// ⛔⛔ 空的日常档案柜替身。不设它,这套验收读的就是**跑测试那个人真实的 ~/.dsh**,
//    于是「通过」的理由里混进了他机器上碰巧装了什么。理由全文＝ tools/fake-daily.mjs。
useFakeDaily(root)
const layout = boxLayout(box)

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

function cli(...argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      // ⛔⛔ 撞上闸门时命令行会**弹面板并等一分钟**(src/approval.js 的
      //    APPROVAL_WINDOW_MS)。这一套全程只碰沙箱,照理撞不上 —— 但「照理」正是
      //    验收挂住一分钟才被发现的那种理由。这个开关只让它**立刻拒绝**,错误码仍是
      //    NEEDS_APPROVAL,所以任何断言的语义都不受影响,它只能让工具做得更少。
      // ⚠️ DSH_HOME 由上面的 useFakeDaily 放进 process.env,在这儿一并继承下去。
      env: { ...process.env, DSH_BOX_NO_PANEL: '1' },
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

function makePlugin(name) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name, version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {} },
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default {}\n')
  return dir
}

const homeOf = (name) => join(layout.sandboxes, name, 'home')
const patchOf = (name) => join(homeOf(name), 'profiles', 'web', 'cordis.patch.yml')
const readOf = (name) => (existsSync(patchOf(name)) ? readFileSync(patchOf(name), 'utf8') : '')

console.log('\n档案柜的文件是干净的,账在我们自己家里\n')

// 1. ⭐⭐ The point of the knife. Two plugins in, and the file has to read like
//    something a person wrote — no markers, no notes, nothing naming this tool.
await cli('get', 'plugin', makePlugin('alpha-plugin'), '--to', 'a')
await cli('get', 'plugin', makePlugin('beta-plugin'), '--to', 'a')
const written = readOf('a')
check('⭐⭐ 写进去的文件里没有一个字提到 dsh-box', !written.includes('dsh-box'), JSON.stringify(written))
check('⭐ 两条并在同一个 insert 底下,不是一个插件一个块',
  (written.match(/^- insert:/gm) ?? []).length === 1, `${(written.match(/^- insert:/gm) ?? []).length} 个 insert`)
check('两条都在,拼写和别人手写的一样',
  written.includes('- id: "alpha-plugin"') && written.includes('name: "beta-plugin"'))

// 2. ⭐ Which means it can be carried. A cabinet's whole plugin file dropped
//    into another cabinet is a working plugin list there — the thing markers
//    made impossible, and the reason they were given up (CEO 2026-08-23).
mkdirSync(join(homeOf('b'), 'profiles', 'web'), { recursive: true })
writeFileSync(patchOf('b'), written)
const carried = await cli('ls', 'plugin', '--in', 'b')
check('⭐ 整份复制到别的档案柜,那边读出来就是两个插件',
  carried.inventory.rows.length === 2, JSON.stringify(carried.inventory.rows.map((one) => one.name)))
check('⛔ 但那边不认领它们——账不在那儿,所以它们不是我们的',
  carried.ours.length === 0 && carried.theirs.length === 2,
  `ours=${carried.ours.length} theirs=${carried.theirs.join('、')}`)

// 3. ⛔⛔ The control group this knife needs, because it is the cost being
//    accepted rather than a bug: with the ledger gone the rows stay and become
//    unattributed. What must not happen is a guess.
const ledger = cabinetLedgerFile(layout, homeOf('a'))
check('账确实是一柜一份,放在我们自己的数据目录里', existsSync(ledger), ledger.replace(root, '…'))
const before = readOf('a')
removeTree(ledger)
const orphaned = await cli('rm', 'plugin', 'alpha-plugin', '--from', 'a')
check('⛔⛔ 账没了就明说卸不了,而不是猜哪几行是我们的',
  orphaned.ok === false && orphaned.code === 'NOT_OURS', orphaned.code)
check('⛔ 拒绝的时候一个字节都没动', readOf('a') === before)
const unclaimed = await cli('ls', 'plugin', '--in', 'a')
check('⛔ 那两条照旧在,只是改归「本来就有的」一栏',
  unclaimed.ours.length === 0 && unclaimed.theirs.length === 2, `theirs=${unclaimed.theirs.join('、')}`)

// 4. A damaged ledger has to fail the same way an absent one does. The default
//    on this file can only be "we claim nothing" — the opposite default is the
//    single way this module could destroy something.
writeFileSync(ledger, '{ 这不是 JSON')
const damaged = await cli('rm', 'plugin', 'alpha-plugin', '--from', 'a')
check('⛔ 账读坏了也是「卸不了」,不是「按我猜的删」',
  damaged.ok === false && damaged.code === 'NOT_OURS', damaged.code)
check('⛔ 读坏之后那两条还在', readOf('a') === before)

// 5. A row taken out by hand simply stops being ours. Two copies of one fact
//    can disagree; "ours" is the intersection, so the file always wins.
removeTree(ledger)
await cli('get', 'plugin', makePlugin('gamma-plugin'), '--to', 'c')
await cli('get', 'plugin', makePlugin('delta-plugin'), '--to', 'c')
writeFileSync(patchOf('c'), readOf('c').split('\n').filter((line) => !line.includes('gamma-plugin')).join('\n'))
const handEdited = await cli('ls', 'plugin', '--in', 'c')
check('⭐ 有人手工删掉一行之后,我们就不再声称那条是我们的',
  handEdited.ours.length === 1 && handEdited.ours[0].package === 'delta-plugin',
  JSON.stringify(handEdited.ours.map((one) => one.package)))
const goneByHand = await cli('rm', 'plugin', 'gamma-plugin', '--from', 'c')
check('⛔ 卸一条已经不在的,说不知道这回事', goneByHand.ok === false, goneByHand.code)

// 6. ⛔ Migration. A cabinet still carrying a `v0.3.0` block: the rows are good
//    rows, only the decoration has to go, and what it recorded has to land in
//    the ledger before it does. The file must come out where it was before that
//    block ever arrived — byte for byte, which is the only honest way to check.
const original = "# 我自己写的,带注释\n- insert:\n    - id: mine\n      name: 'my-plugin'\n"
const legacy = `${original.trimEnd()}\n\n`
  + '# >>> dsh-box: maintained automatically, rewritten whenever plugins change\n'
  + '- insert:\n'
  + '    - id: "old-plugin"\n'
  + '      name: "old-plugin"\n'
  + '      # dsh-box: link C:\\somewhere\\old-plugin\n'
  + '# <<< dsh-box: end\n'
mkdirSync(join(homeOf('d'), 'profiles', 'web'), { recursive: true })
writeFileSync(patchOf('d'), legacy)
const seen = await cli('ls', 'plugin', '--in', 'd')
check('⭐ 旧标记块里的插件,读的时候就认得出是我们的',
  seen.ours.length === 1 && seen.ours[0].package === 'old-plugin',
  JSON.stringify(seen.ours.map((one) => one.package)))
check('⛔ 光是看不改文件', readOf('d') === legacy)

await cli('get', 'plugin', makePlugin('fresh-plugin'), '--to', 'd')
check('⛔⛔ 第一次写的时候顺手把旧标记清掉', !readOf('d').includes('dsh-box'), JSON.stringify(readOf('d')))
check('⛔ 旧那条插件本身没被清掉,它是一条好行', readOf('d').includes('"old-plugin"'))
check('别人手写的那两行照旧', readOf('d').includes("name: 'my-plugin'"))
const migrated = await cli('ls', 'plugin', '--in', 'd')
check('迁移之后两条都算我们的',
  migrated.ours.length === 2, JSON.stringify(migrated.ours.map((one) => one.package)))
await cli('rm', 'plugin', 'fresh-plugin', '--from', 'd')
await cli('rm', 'plugin', 'old-plugin', '--from', 'd')
check('⛔⛔ 全卸完之后逐字节回到「那个块从来没来过」的样子',
  readOf('d') === original, JSON.stringify(readOf('d')))

// 7. ⛔ A block with no closing marker is the one thing that makes a cabinet
//    unwritable. Guessing where it ended would take lines that are not ours.
mkdirSync(join(homeOf('e'), 'profiles', 'web'), { recursive: true })
const truncated = '# >>> dsh-box: maintained automatically, rewritten whenever plugins change\n- insert:\n'
writeFileSync(patchOf('e'), truncated)
const refused = await cli('get', 'plugin', makePlugin('late-plugin'), '--to', 'e')
check('⛔ 旧块只有开头没有收尾,就不动这个档案柜',
  refused.ok === false && refused.code === 'UNREADABLE_PATCH', refused.code)
check('⛔ 拒绝时文件没动', readOf('e') === truncated)

// 8. ⛔⛔ A patch file *we* created has to go away again with our last row.
//    Found by `tools/check-real-dsh.mjs` on its first run, and it could not have
//    been found here: dsh refuses an empty patch outright — *must be a top-level
//    YAML array of loader patch entries* — and a lone newline too, while no file
//    at all it accepts (measured on 0.1.0-rc.7). So installing one plugin into a
//    fresh cabinet and removing it left a cabinet that could never boot. The
//    same shape as the `[]` defect of the round before, at the other end.
//    ⭐ Asserted here as well because it is cheap here and this suite runs
//    everywhere, but the credit belongs to the check that has a real parser.
const fresh = 'f'
await cli('get', 'plugin', makePlugin('lone-plugin'), '--to', fresh)
check('⭐ 这个档案柜本来没有 patch 文件,是我们建的', existsSync(patchOf(fresh)))
await cli('rm', 'plugin', 'lone-plugin', '--from', fresh)
check('⛔⛔ 最后一行走掉之后,我们建的那个文件被撤掉了 —— 留一个空文件的话真 dsh 整份拒载',
  !existsSync(patchOf(fresh)), JSON.stringify(readOf(fresh)))

// 9. And the other side of it: a file we did **not** create is not ours to
//    remove, however empty it ends up.
mkdirSync(join(homeOf('g'), 'profiles', 'web'), { recursive: true })
writeFileSync(patchOf('g'), '# 我留在这儿的一句话\n')
await cli('get', 'plugin', makePlugin('guest-plugin'), '--to', 'g')
await cli('rm', 'plugin', 'guest-plugin', '--from', 'g')
check('⛔ 本来就有的文件照旧在,逐字节回到原样',
  readOf('g') === '# 我留在这儿的一句话\n', JSON.stringify(readOf('g')))

// 10. One cabinet, one ledger — the same key the backups pile uses, so a cabinet
//    has one name everywhere in this tool.
check('⭐ 每个档案柜一份账,互不相干',
  existsSync(cabinetLedgerFile(layout, homeOf('c')))
  && !existsSync(cabinetLedgerFile(layout, homeOf('b'))),
  `c=有 b=${existsSync(cabinetLedgerFile(layout, homeOf('b'))) ? '有' : '无'}`)

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
