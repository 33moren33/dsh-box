/**
 * A cabinet that has never met this tool still reads correctly.
 *
 * ⭐⭐ The point of the inventory: **nobody should have to tell dsh-box what
 * they already have.** Whoever registered a plugin — us, `dsh plugin add`, or
 * somebody's own editor — had to follow the same format, so reading the format
 * finds all of them. Without this, a person or an agent re-enters, one at a
 * time, what the cabinet already knows.
 *
 * The three places a cabinet can name a plugin, all of them exercised here:
 * the profile's `cordis.patch.yml`, the home-level one that every profile
 * reads, and `dsh.profile.bundles` in the profile's `package.json` — where a
 * single name stands for a whole layer, which is why an aggregate package
 * holds seventeen plugins and a patch row holds one.
 *
 * ⛔ Nothing here writes to a cabinet. The fixtures are built by hand in a
 * throwaway directory, on purpose: a cabinet built by dsh-box would only prove
 * we can read our own handwriting.
 *
 * Usage: node tools/check-inventory.mjs <一次性目录>
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cabinetInventory } from '../src/mounts.js'
import { removeTree } from '../src/paths.js'

const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-inventory.mjs <一次性目录>')
  process.exit(2)
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n一个从没见过 dsh-box 的档案柜,也读得全\n')

removeTree(root)
const home = join(root, 'home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })

// ⚠ Hand-built to look like somebody else's cabinet: two rows in the profile
// patch (one an override), one row in the home-level patch, and a bundle that
// is not ours — plus the two the profile template always carries.
writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
  name: 'dsh-profile-web',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@linxin666/dsh-web-ui-all'] } },
}, null, 2)}\n`)

writeFileSync(join(profile, 'cordis.patch.yml'), `# somebody's own file
- insert:
    - id: hand-written
      name: 'somebody-elses-plugin'
- id: telemetry
  disabled: true
`)

writeFileSync(join(home, 'cordis.patch.yml'), `- insert:
    - id: everywhere
      name: applies-to-every-profile
`)

const inventory = cabinetInventory(home)
const byId = Object.fromEntries(inventory.rows.map((one) => [one.id, one]))

check('⛔⛔ 三处都读到了,一处不漏', inventory.rows.length === 3,
  inventory.rows.map((one) => one.id).join('、'))
check('profile 那份里手写的那行', byId['hand-written']?.name === 'somebody-elses-plugin',
  byId['hand-written']?.name)
check('⭐ 档案柜根上那份也读了(每个 profile 都吃,漏掉就少算)',
  byId.everywhere?.source === 'homePatch', byId.everywhere?.source)
check('⛔ 覆盖行没被当成「装了一个插件」', byId.telemetry?.kind === 'override', byId.telemetry?.kind)
check('⛔ 被关掉的那行看得出是关着的', byId.telemetry?.disabled === true)
check('每行都说得出在哪个文件第几行——人能去核',
  inventory.rows.every((one) => one.line > 0 && one.file !== ''),
  inventory.rows.map((one) => one.line).join('、'))

check('⭐⭐ bundles 里那个第三方的没被漏掉(它代表的是一整层)',
  inventory.bundles.some((one) => one.name === '@linxin666/dsh-web-ui-all' && !one.platform))
check('⛔ 官方基座折起来算个数,不铺一屏(一个干净 profile 展开就是 129 条)',
  inventory.platform === 2, String(inventory.platform))
check('⭐ 平台的行不混进第三方那张表',
  inventory.rows.every((one) => !(one.name ?? '').startsWith('@deepseek-ai/')))

// A cabinet with nothing in it must read as nothing, not as a crash.
const bare = join(root, 'bare')
mkdirSync(join(bare, 'profiles', 'web'), { recursive: true })
const empty = cabinetInventory(bare)
check('空档案柜读出来是空的,不是报错', empty.rows.length === 0 && empty.bundles.length === 0)

// ⛔ The shape a brand-new profile actually gets. Appending after that `[]`
// makes a second YAML document and dsh refuses the whole file.
const fresh = join(root, 'fresh')
mkdirSync(join(fresh, 'profiles', 'web'), { recursive: true })
writeFileSync(join(fresh, 'profiles', 'web', 'cordis.patch.yml'), '# new profile\n[]\n')
check('dsh 新建的那份([] 结尾)读出来是零行,而不是读歪',
  cabinetInventory(fresh).rows.length === 0)

removeTree(root)
console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
