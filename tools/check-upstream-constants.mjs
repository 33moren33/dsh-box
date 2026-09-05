/**
 * The path names this tool writes into somebody else's filing cabinet are the
 * same ones dsh reads out of it.
 *
 * ⭐⭐ Why a guard rather than a rewrite. This tool hardcodes `profiles`,
 * `cordis.patch.yml`, `node_modules` and `.credentials.yaml`, and every one of
 * them was checked by hand against dsh's own constants and found to agree. The
 * tempting repair — import them from dsh — is the one that must not happen: the
 * whole immunity of this tool is that it depends on nothing upstream, and
 * `dsh-app-boot` cannot be imported anyway (its top-level imports pull in the
 * whole cordis tree). So the values stay ours, and a check makes sure they stay
 * *equal*.
 *
 * ⛔ Reading the installed file as text, not importing it, for that same
 * reason. This is a guard; it may look at anything on disk, but it must not
 * make the product resolve an upstream module.
 *
 * ⛔⛔ **A guard that quietly passes when it cannot find anything to compare
 * against is worse than no guard**, because it reports "agrees" for a machine
 * where nothing was read. When no real dsh is installed anywhere this can see,
 * this says so and says it loudly, and it does not print a single 通过.
 *
 * Usage:
 *   node tools/check-upstream-constants.mjs [<装机版目录或 box 数据目录>]
 *
 *   给什么都行:一个 `versions/<版本>` 目录、一个 box 的 data 目录、或者
 *   直接给 `node_modules/@deepseek-ai`。不给就在默认数据目录里找。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CREDENTIALS_FILE } from '../src/sandbox.js'
import { DEFAULT_PROFILE } from '../src/mounts.js'
import { profileModules, profilePatchFile } from '../src/mounts.js'

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * Every `@deepseek-ai` directory under a starting point, however it was named.
 *
 * ⛔ Three shapes are accepted rather than one because the three callers hold
 * three different paths, and a guard nobody can point at is a guard nobody runs.
 * @param {string} start
 * @returns {string[]}
 */
function scopeDirs(start) {
  const found = []
  const consider = (dir) => {
    const scope = join(dir, 'node_modules', '@deepseek-ai')
    if (existsSync(scope)) found.push(scope)
  }
  if (start.endsWith('@deepseek-ai') && existsSync(start)) return [start]
  consider(start)
  const versions = join(start, 'versions')
  if (existsSync(versions)) {
    for (const name of readdirSync(versions)) {
      const dir = join(versions, name)
      if (statSync(dir).isDirectory()) consider(dir)
    }
  }
  return found
}

/**
 * One `const NAME = "value"` out of a built bundle.
 * @param {string} file
 * @param {string} name
 * @returns {string | null}
 */
function constantIn(file, name) {
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const found = new RegExp(`const ${name}\\s*=\\s*["']([^"']*)["']`).exec(text)
  return found === null ? null : found[1]
}

// ⛔ Where to look, in order, and `DSH_BOX_HOME` is in the list for a reason
// that is not convenience: without it this check finds nothing in a clean
// checkout and therefore never actually compares anything on the machine of the
// person most likely to have a real dsh — the one whose data directory is
// somewhere else entirely. A guard that only ever prints "not checked" has the
// same value as no guard, it just feels better.
const given = process.argv[2]
const roots = given !== undefined
  ? scopeDirs(resolve(given))
  : [
      ...process.env.DSH_BOX_HOME === undefined ? [] : scopeDirs(resolve(process.env.DSH_BOX_HOME)),
      ...scopeDirs(resolve('dsh-box-files', 'data')),
    ]

console.log('\n我们写的路径名,和 dsh 读的是不是同一个\n')

// ⛔ The stub dsh planted by make-test-box has no real packages, so a run that
// only ever meets stubs must not look like a clean run.
const real = roots.filter((scope) => existsSync(join(scope, 'dsh-app-boot', 'lib', 'index.js')))
if (real.length === 0) {
  console.log('  ⬜ 这一格没验:没找到可对照的装机版 dsh。')
  console.log('     这不是通过,是没做。要验就先下一个真版本,或者把装机版目录指给它:')
  console.log('       node tools/check-upstream-constants.mjs <versions/某个版本 或 box 的 data 目录>')
  console.log(`     找过的地方:${roots.length === 0 ? given ?? '默认数据目录' : roots.join('、')}\n`)
  process.exit(0)
}

const scope = real[0]
console.log(`  对照的是 ${scope}\n`)

const appBoot = join(scope, 'dsh-app-boot', 'lib', 'index.js')
const credentials = join(scope, 'dsh-credentials-local', 'lib', 'index.js')

// The three names this tool builds paths out of, and where dsh keeps each one.
const theirs = {
  profilesDir: constantIn(appBoot, 'PROFILES_DIR'),
  patchFilename: constantIn(appBoot, 'PROFILE_PATCH_FILENAME'),
  credentialsFilename: constantIn(credentials, 'CREDENTIALS_FILENAME'),
}

// ⛔ Asked of the real functions, not of a copy of the string. What matters is
// the path this tool actually builds, so the assertion is made against that —
// a constant that agrees while the function that uses it is wrong would pass a
// comparison of constants.
const home = process.platform === 'win32' ? 'C:\\pretend-home' : '/pretend-home'
const ourPatch = profilePatchFile(home, DEFAULT_PROFILE)
const ourModules = profileModules(home, DEFAULT_PROFILE)

check('官方那三个常量都读得出来(读不出来就是这道守卫自己坏了,不是它们变了)',
  Object.values(theirs).every((value) => value !== null && value !== ''),
  JSON.stringify(theirs))

if (theirs.profilesDir !== null) {
  check('⭐ profile 目录名一致',
    ourPatch.includes(`${theirs.profilesDir}`) && ourModules.includes(`${theirs.profilesDir}`),
    `官方 ${theirs.profilesDir} / 我们拼出来的 ${ourPatch}`)
}
if (theirs.patchFilename !== null) {
  check('⭐ 我们要写的那个 patch 文件名一致',
    ourPatch.endsWith(theirs.patchFilename), `官方 ${theirs.patchFilename} / 我们 ${ourPatch}`)
}
if (theirs.credentialsFilename !== null) {
  check('⭐ 凭证文件名一致', CREDENTIALS_FILE === theirs.credentialsFilename,
    `官方 ${theirs.credentialsFilename} / 我们 ${CREDENTIALS_FILE}`)
}
// ⛔ Not a constant upstream — it is Node's own directory name, and dsh joins it
// literally. Asserted anyway, because it is the one this tool would be most
// likely to typo and the least likely to notice: a wrong name here does not
// fail, it silently resolves nothing.
check('⭐ 模块兜底目录仍是 node_modules',
  ourModules.endsWith('node_modules'), ourModules)

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
