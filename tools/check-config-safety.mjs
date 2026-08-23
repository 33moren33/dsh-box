/**
 * 配置文件不会被自己弄丢。
 *
 * 两个洞都是实测出来的,不是担心出来的,所以这里照原样复现它们:
 *
 * 一、**读不懂就退回空配置**——`readConfig` 解析失败时返回一份空的,而调用方
 *    下一步改一个字段就把整份写回去,于是登记过的插件全没了,命令还回 ok。
 *    削掉文件末尾三个字符就能复现。
 * 二、**多进程写会丢更新**——`writeConfig` 直接整份覆盖。刀 3.5 之后窗口每个
 *    按钮都是一个新进程,所以两个写者是常态而不是稀奇事。
 *
 * ⛔ 全程一次性数据目录,不碰真 ~/.dsh、不起 dsh、不联网。
 *
 * 用法:
 *   node tools/check-config-safety.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, ensureBox, removeTree } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-config-safety.mjs <一次性目录>')
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

/** Run the real command line and return its one JSON line. */
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
function makePlugin(name) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name, version: '1.0.0', main: 'lib/index.js', dsh: { bundle: {} },
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default {}\n')
  return dir
}

const readRaw = () => readFileSync(layout.config, 'utf8')

console.log('\n配置文件不会被自己弄丢\n')

// 1. 先有个正常的登记表。
await cli('plugins', 'add', makePlugin('keep-me'))
const healthy = await cli('plugins')
check('登记得上,先有个正常状态', healthy.plugins?.length === 1, `${healthy.plugins?.length} 条`)

// 2. ⛔ 原样复现那个洞:削掉末尾三个字符,再记一个插件。
//    从前的结果是「第一个消失,命令回 ok:true,零警告」。
const good = readRaw()
writeFileSync(layout.config, good.slice(0, -3))
const broken = readRaw()
const refused = await cli('plugins', 'add', makePlugin('should-not-land'))
check('⛔ 读不懂配置就拒绝,而不是拿空的覆盖回去',
  refused.ok === false && refused.code === 'CONFIG_UNREADABLE', refused.code)
check('⛔⛔ 拒绝的时候那个坏文件一个字节都没动', readRaw() === broken)
check('⛔ 也没有留下写了一半的临时文件',
  readdirSync(box).filter((name) => name.includes('.tmp-')).length === 0,
  readdirSync(box).join('、'))

// 3. 连只读的命令也应当拒绝,而不是报告一份不存在的空登记表。
const listing = await cli('plugins')
check('坏着的时候连列表都不谎报「一个都没有」',
  listing.ok === false && listing.code === 'CONFIG_UNREADABLE', listing.code)

// 4. 逃生口:存档重来。旧文件必须还在——它记着登记过哪些目录,别处找不回来。
const reset = await cli('config', 'reset')
check('config reset 存档得掉', reset.ok === true, reset.code ?? 'ok')
check('⛔ 旧文件是改名存档,不是删掉', reset.archived !== undefined && existsSync(reset.archived))
check('存档里就是那份坏的原文', readFileSync(reset.archived, 'utf8') === broken)
const afterReset = await cli('plugins')
check('存档之后工具又能用了', afterReset.ok === true && afterReset.plugins.length === 0,
  afterReset.code ?? `${afterReset.plugins?.length} 条`)

// 5. ⛔ 多进程同时写。
//
//    ⚠️ **先放一个必然会输的对照组,这一条比实验组本身更重要。**头一版直接放八个
//    真命令出去,八个全活了下来 —— 而把旧的「读整份→整份覆盖」写法照样放八个
//    出去,也是八个全活。**一个在旧代码上同样通过的测试什么都没证明**:那些进程
//    各自太快,天然就错开了,竞态根本没发生。
//    所以这里把读与写之间的空隙撑开到 300 毫秒(真实代码里那段空隙是 describePlugin
//    在读磁盘),让两个写者必然都在对方写之前读完。对照组必须丢,实验组必须不丢;
//    对照组哪天不丢了,说明这套装置已经测不到东西了,该来修的是测试。
const worker = join(root, 'race-worker.mjs')
const configUrl = new URL('../src/config.js', import.meta.url).href
writeFileSync(worker, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { updateConfig } from ${JSON.stringify(configUrl)}
import { boxLayout } from ${JSON.stringify(new URL('../src/paths.js', import.meta.url).href)}

const [mode, box, name] = process.argv.slice(2)
const layout = boxLayout(box)
const hold = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)

if (mode === 'naive') {
  // 旧写法:读整份 → (空隙) → 整份覆盖。
  const config = existsSync(layout.config) ? JSON.parse(readFileSync(layout.config, 'utf8')) : { plugins: [] }
  hold()
  config.plugins.push({ id: name, package: name, path: name })
  writeFileSync(layout.config, JSON.stringify(config, null, 2) + '\\n')
} else {
  updateConfig(layout, (current) => {
    hold()
    return { ...current, plugins: [...current.plugins, { id: name, package: name, path: name }] }
  })
}
`)

/** 放两个写者同时出去,回报最后活下来几个。 */
async function race(mode, tag) {
  writeFileSync(layout.config, `${JSON.stringify({ plugins: [] }, null, 2)}\n`)
  const names = [`${tag}-甲`, `${tag}-乙`]
  await Promise.all(names.map((name) => new Promise((done) => {
    spawn(process.execPath, [worker, mode, box, name], { windowsHide: true })
      .once('close', done)
  })))
  const landed = JSON.parse(readFileSync(layout.config, 'utf8')).plugins.map((row) => row.id)
  return { names, landed, lost: names.filter((name) => !landed.includes(name)) }
}

const control = await race('naive', '对照')
check('⚠ 对照组(旧写法)确实丢了更新——证明这套装置测得到东西',
  control.lost.length > 0, `活下来 ${control.landed.length}/2,丢的是 ${control.lost.join('、') || '无'}`)

const guarded = await race('locked', '实验')
check('⛔⛔ 同样的空隙下,现在两个都在',
  guarded.lost.length === 0, `活下来 ${guarded.landed.length}/2,丢的是 ${guarded.lost.join('、') || '无'}`)
check('抢完之后没有锁文件留在原地', !existsSync(`${layout.config}.lock`))

// 顺带:真命令并发跑一轮也不该出事(它测不到竞态,但测得到别的东西坏没坏)。
writeFileSync(layout.config, `${JSON.stringify({ plugins: [] }, null, 2)}\n`)
const many = Array.from({ length: 8 }, (_, index) => `racer-${index}`)
const results = await Promise.all(many.map((name) => cli('plugins', 'add', makePlugin(name))))
const registered = new Set(((await cli('plugins')).plugins ?? []).map((entry) => entry.package))
check('八条真命令同时跑,八个都记上了',
  many.every((name) => registered.has(name)) && results.every((one) => one.ok === true),
  `${registered.size}/${many.length}`)

// 6. ⛔ 读得懂但形状不对的那一行,不许静默丢掉。
//    同一个病的小号版本:我看不懂你这一行,所以我把它扔了。
const withJunk = JSON.parse(readRaw())
withJunk.plugins.push({ id: '缺了 path 的一行' })
writeFileSync(layout.config, `${JSON.stringify(withJunk, null, 2)}\n`)
await cli('plugins', 'add', makePlugin('after-junk'))
const kept = JSON.parse(readRaw()).plugins
check('⛔ 形状不对的那一行还在,没有被顺手丢掉',
  kept.some((row) => row.id === '缺了 path 的一行'),
  `现在 ${kept.length} 行`)
const shown = await cli('plugins')
check('但它不混进正经名单里',
  !(shown.plugins ?? []).some((row) => row.id === '缺了 path 的一行'),
  `名单 ${shown.plugins?.length} 条`)

removeTree(root)
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
