/**
 * 每一套验收都只读自己那个一次性目录,不读跑测试那个人真实的 ~/.dsh。
 *
 * ⛔⛔ **这道守卫存在,是因为同一个形状在三天里咬了三次,而三次都被当成别的东西:**
 *
 * - `21a5f45` —— 三条断言只在**中文机器**上成立(读的是界面语言)。
 * - `check-aggregate` 六项 —— 册子记成「Windows 上红、Linux 上过」,像平台差异;
 *   真相是那台 Linux 上**没有某个 git checkout**,于是回落到备份夹具就过了。
 * - `check-config-safety` —— 从没设过 `DSH_HOME`,读的是 CEO 真实的 `~/.dsh`。
 *   它一直「通过」,直到插件名单从「配置里的登记表」改成「从各档案柜算出来」,
 *   计数当场变成「这台机器上碰巧装了几个插件」:本机 3 个、CI 0 个。
 *
 * ⭐⭐ 判词:**一个会读到自己那个一次性目录之外的验收,是一个「通过的理由没人
 * 写下来」的验收。**它不会以「测试失败」的形式出现,而是以「在别人机器上失败」
 * 或者更糟 ——「一直通过,直到某天被测物开始往外看」。
 *
 * ⭐ 所以这里查两件事,缺一不可:
 *   1. **覆盖面(静态)** —— 凡是会驱动命令行的验收,都得把日常档案柜指到别处去。
 *      光有机制没人用,等于没有。
 *   2. **机制(运行时)** —— 真起两个进程比一比:不隔离时它确实看向真 home,
 *      隔离后确实看向替身。⛔ 只有静态扫描的守卫,会在 `useFakeDaily` 哪天悄悄
 *      失效时**继续全绿** —— 那正是它要防的那种「通过的理由没人写下来」。
 *
 * 用法: node tools/check-suite-isolation.mjs [一次性目录]
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = resolve(process.argv[2] ?? join(tmpdir(), `box-isolation-${process.pid}`))
mkdirSync(root, { recursive: true })

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n验收只读自己那个一次性目录\n')

// ---- 1. 覆盖面 --------------------------------------------------------------
// ⛔ 判据是「会不会驱动命令行」,不是「叫什么名字」:命令行是那个会去读
//    userDshHome() 的东西,所以凡是起得动它的验收都在管辖范围内。
//    ⚠️ check-all 自己不算 —— 它是调度器,给每一套发目录,不做断言。
const SELF = 'check-suite-isolation.mjs'
const CONDUCTOR = 'check-all.mjs'
const suites = readdirSync(HERE)
  .filter((name) => name.startsWith('check-') && name.endsWith('.mjs'))
  .filter((name) => name !== SELF && name !== CONDUCTOR)

const drivesCli = []
const unisolated = []
for (const name of suites) {
  const text = readFileSync(join(HERE, name), 'utf8')
  // ⭐⭐ 判据只有一个:这套验收会不会走到 `userDshHome()`。
  //
  // ⛔ 第一版写的是「import 了 ../src/ 就算」,当场多扫出九套 —— 而那九套
  //    没有一套真的够得着日常柜:它们调的每个函数都是**被告知** home 是哪个
  //    (`cabinetInventory(home)`),夹具自己造。**`userDshHome()` 是唯一一个
  //    不问就自己回答的**,所以它才是那扇门,别的都不是。
  //    ⚠️ 那一版还把注释里提到函数名的当成了调用(check-command-map 的散文里
  //    写着 derivedRoster)—— 判据宽一点带来的不是「更安全」,是九条要人逐个
  //    去否掉的假警报,而假警报最后总是靠加白名单解决的。
  const drives = /spawn(Sync)?\(process\.execPath/.test(text) || /\buserDshHome\s*\(/.test(text)
  if (!drives) continue
  drivesCli.push(name)
  // ⭐ 认两种交代:**真的调了** useFakeDaily,或者自己显式安排 DSH_HOME。
  //   后者是给 check-config-safety 这类「每个 spawn 单独给 env」的写法留的门。
  //
  // ⛔⛔ import 那一行要先扔掉再找。第一版直接 `text.includes('useFakeDaily')`,
  //    而把调用删掉之后 `import { useFakeDaily } …` 还留在文件里 —— 于是守卫
  //    照样全绿。**这是拿「提到过」冒充「做了」**,而它只在我故意删掉一次去试
  //    的时候才现形。⭐ 一道没被证明拦得住东西的守卫,和没有守卫是一回事。
  //
  // ⛔⛔ 08-28 第二次收紧,同一个形状的第二条腿:`useFakeDaily` 那边已经改成查
  //    **调用**了,而 `DSH_HOME` 这边还是 `includes` 一个字符串 —— 于是一套只在
  //    **注释里**提过 DSH_HOME、一次都没设过的验收(check-running-evidence,它开头
  //    那段散文里写着「两个进程同时指着同一个 DSH_HOME」)照样全绿。⭐ 判词还是
  //    那一句:**拿「提到过」冒充「做了」**。所以注释也要先扔掉,而且要求它出现在
  //    赋值位置(`DSH_HOME:` 或 `DSH_HOME =`),散文里写不出这个形状。
  const body = text.split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
  if (!/useFakeDaily\s*\(/.test(body) && !/\bDSH_HOME\b\s*[:=]/.test(body)) unisolated.push(name)
}

check(`会驱动命令行的验收都把日常档案柜指到了别处(共 ${drivesCli.length} 套)`,
  unisolated.length === 0, unisolated.join('、'))

// ⛔ 反过来也查一次:一套都没扫到,说明上面那两条正则跟代码脱节了,
//    而那时这道守卫会「全绿」地什么都不做。
check('扫得到东西(否则这道守卫本身已经失效)', drivesCli.length > 5, `${drivesCli.length} 套`)

// ---- 2. 机制,带一个必然会输的对照组 ----------------------------------------
// ⭐⭐ 静态扫描只证明「大家都写了那行字」。这一节证明那行字有用。
const realHome = join(homedir(), '.dsh')
const fake = join(root, 'daily-home')
mkdirSync(fake, { recursive: true })

/**
 * 问命令行:你现在把哪儿当日常档案柜?
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function homeSeenBy(env) {
  // ⭐ 只是「看」,所以不过闸门 —— 读日常档案柜从来不需要有人点头(bin/cli.js 的
  //   cabinetTarget:writes 才是那道分界)。⛔ 仍然带上 DSH_BOX_NO_PANEL,免得哪天
  //   有人把读也收进闸门时,这道守卫变成弹窗等一分钟而不是当场红。
  const result = spawnSync(process.execPath, [
    CLI, 'ls', 'plugin', '--in', 'main', '--json', '--box', join(root, 'data'),
  ], {
    encoding: 'utf8', windowsHide: true, env: { ...env, DSH_BOX_NO_PANEL: '1' },
  })
  const line = `${result.stdout ?? ''}`.trim().split('\n').filter((one) => one.trim() !== '').at(-1)
  try {
    return JSON.parse(line ?? '').home ?? ''
  } catch {
    return ''
  }
}

const { DSH_HOME: _dropped, ...bare } = process.env
const without = homeSeenBy(bare)
const With = homeSeenBy({ ...bare, DSH_HOME: fake })

// ⚠️ 对照组。它一旦不通过,说明「不隔离就会读到真 home」这个前提没了 ——
//    那么上面整套覆盖面检查就是在防一件不会发生的事,该重新想,而不是删掉。
check('⚠ 对照组:不隔离时,命令行看的确实是你真实的 ~/.dsh',
  without === realHome, without === '' ? '(问不出来)' : without)
check('⭐⭐ 隔离之后它看的是替身,不是真 home', With === fake, With === '' ? '(问不出来)' : With)
check('⛔ 两者确实不同(否则上面两条可能在同一个答案上双双通过)', without !== With)

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
