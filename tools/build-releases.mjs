/**
 * 一键出货:从当前源码构建 Windows 安装包与便携包,更新 Releases/。
 *
 * 双击仓根的 build-releases.bat 即可;也可直接 `node tools/build-releases.mjs`。
 * 产出两个文件(版本号取自 package.json):
 *   Releases/dsh-box_<版本>_x64-setup.exe     NSIS 安装包
 *   Releases/dsh-box_<版本>_x64-portable.zip  便携包(exe + dsh-box-files 文件夹)
 *
 * 便携包顶层就两样:dsh-box.exe 和 dsh-box-files/。后者里 boot 是程序、
 * data 是家当(启动后才长出来)。覆盖解压=升级:exe 与 boot 换新,data 一字不动。
 * ⛔ 那个文件夹不能叫 dsh-box:它和 exe 同处一层,而没有扩展名的平台上
 * 同名的文件与文件夹不能共存——0.3.5 的 Linux 与 mac 构建就是这么红的。
 *
 * `--skip-build`:壳已经构建好,只做归位与压缩。CI 用这条——它自己跑 tauri
 * build,再借这里的布局定义出便携包,于是便携包的布局与本地打的完全一致,
 * 而 exe 是 CI 产的。⛔ 发布用的 Windows 产物必须来自 CI:本地构建会把构建
 * 机的用户名写进 Rust 的 panic 路径(`C:\Users\<用户名>\.cargo\...`)。
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { copyTree, removeTree } from '../src/paths.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
process.chdir(root)

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
console.log(`\n== dsh-box v${version} 打包(源码:${root})\n`)

// 1. Tauri 构建:先编译壳,再打 NSIS 安装包。进度直接透传到本窗口。
//    经由 cmd.exe 起 npx:Windows 上直接 spawn npm.cmd/npx.cmd 会返回 EINVAL。
if (!process.argv.includes('--skip-build')) {
  run('cmd.exe', ['/c', 'npx', 'tauri', 'build'], 'tauri build')
}

// 2. 安装包归位。
const setupBuilt = join(
  'src-tauri', 'target', 'release', 'bundle', 'nsis', `dsh-box_${version}_x64-setup.exe`,
)
if (!existsSync(setupBuilt)) fail(`构建完成但没找到安装包:${setupBuilt}`)
mkdirSync('Releases', { recursive: true })
copyFileSync(setupBuilt, join('Releases', `dsh-box_${version}_x64-setup.exe`))

// 3. 便携包:顶层 exe + dsh-box-files/(内含 boot);data 由首次启动在里面长出。
// ⭐ The binary is named by `[[bin]]` in Cargo.toml, not by the crate: the file
// people double-click and the word they type in a terminal are the same word as
// the product. Up to 0.3.4 it shipped as `dsh-box-shell.exe` in both forms —
// which would have put a `dsh-box-shell` command on PATH for a tool called
// dsh-box.
const exeBuilt = join('src-tauri', 'target', 'release', 'dsh-box.exe')
if (!existsSync(exeBuilt)) fail(`没找到壳:${exeBuilt}`)
const stage = join(tmpdir(), `dsh-box-portable-${version}`)
const boot = join(stage, 'dsh-box-files', 'boot')
// ⛔ Not `rmSync({recursive})` / `cpSync({recursive})`: the staging directory
// sits under `tmpdir()`, which on Windows is `C:\Users\<用户名>\AppData\Local\
// Temp`. On the machine of anyone called 张三 or Müller the copies would report
// success and put **nothing** in `boot/` — shipping a portable zip with an
// empty program inside it, and no error anywhere to say so.
removeTree(stage)
mkdirSync(boot, { recursive: true })
copyFileSync(exeBuilt, join(stage, 'dsh-box.exe'))
copyTree('bin', join(boot, 'bin'))
copyTree('src', join(boot, 'src'))
copyFileSync('package.json', join(boot, 'package.json'))

const zip = join(root, 'Releases', `dsh-box_${version}_x64-portable.zip`)
rmSync(zip, { force: true })
run('powershell.exe', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}'`,
], '压缩便携包')
removeTree(stage)

// 4. 交卷:报出两个产物与大小,让人一眼核对。
console.log('\n  Releases/ 已更新:')
for (const name of [`dsh-box_${version}_x64-setup.exe`, `dsh-box_${version}_x64-portable.zip`]) {
  const size = statSync(join('Releases', name)).size / 1048576
  console.log(`    ${name}  ${size.toFixed(1)} MB`)
}
console.log('\n  完成。旧版本号的产物不动,要清理请手动删。\n')

/**
 * 跑一步,失败就带着原因停下——绝不静默。
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} label
 */
function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.error) fail(`${label} 起不来:${result.error.message}`)
  if (result.status !== 0) fail(`${label} 失败,退出码 ${result.status}`)
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`\n  打包失败:${message}\n`)
  process.exit(1)
}
