/**
 * Prove a scoped package name survives the trip into a sandbox.
 *
 * Every plugin this tool had ever linked was unscoped (`dsh-memory-pyramid`),
 * so the code path that turns `@scope/name` into a nested directory had been
 * read but never run. It matters now: the dsh-web-ui family is entirely
 * `@linxin666/*`, and getting this wrong fails the way dsh always fails —
 * the plugin simply is not there, with nothing logged.
 *
 * Checks the two halves that have to agree: the link lands at
 * `node_modules/@scope/name` (with the scope directory created), and the patch
 * entry names the package exactly as dsh will resolve it.
 *
 * Usage: node tools/check-scoped-link.mjs <一次性目录>
 */

import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { linkPlugins } from '../src/launch.js'
import { mountPlugin, profilePatchFile } from '../src/mounts.js'
import { removeTree } from '../src/paths.js'

// Resolved, because a link is created with the path it is handed and a
// relative one resolves against the link's own folder rather than against here.
// Running this with `..\probe\x` used to fail three checks for that reason
// alone, which said nothing about the scoped-name handling under test.
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-scoped-link.mjs <一次性目录>')
  process.exit(2)
}

removeTree(root)
const home = join(root, 'home')
const source = join(root, 'pretend-plugin')
mkdirSync(source, { recursive: true })

const plugins = [
  { id: 'web-ui-pet', package: '@linxin666/dsh-pet', path: source },
  { id: 'dsh-memory-pyramid', package: 'dsh-memory-pyramid', path: source },
]

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n带 @scope 的包名能不能挂上\n')

const linked = linkPlugins(home, 'web', plugins)
check('两个都报告链上了', linked.length === 2, linked.join('、'))

const modules = join(home, 'profiles', 'web', 'node_modules')
const scoped = join(modules, '@linxin666', 'dsh-pet')
check('scope 目录被建出来了', existsSync(join(modules, '@linxin666')))
check('链接落在 @linxin666/dsh-pet 而不是一个叫「@linxin666%dsh-pet」的目录',
  existsSync(scoped), scoped.replace(root, '…'))
check('它是个链接不是拷贝',
  existsSync(scoped) && lstatSync(scoped).isSymbolicLink())
check('不带 scope 的照旧', existsSync(join(modules, 'dsh-memory-pyramid')))

for (const plugin of plugins) {
  mountPlugin({ home, plugin: { ...plugin, kind: 'link' }, backupDir: join(root, 'backups') })
}
const patch = readFileSync(profilePatchFile(home), 'utf8')
// dsh resolves the row by this exact string, so a mangled name here is a
// plugin that never loads and never complains.
check('配置里写的是完整包名', patch.includes('"@linxin666/dsh-pet"'))
check('形状与上游 bundle 自带的 patch 一致（insert / id / name）',
  /- insert:\s*\n\s+- id: /.test(patch))
check('两个都写进去了,不是后一个盖掉前一个',
  patch.includes('"dsh-memory-pyramid"') && patch.includes('"@linxin666/dsh-pet"'))

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}`)
console.log(`\n写进工作区的配置:\n${patch}`)
process.exit(failures === 0 ? 0 : 1)
