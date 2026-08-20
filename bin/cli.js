#!/usr/bin/env node
/**
 * Command line entry.
 *
 * The config window is the face of this tool, but everything it does is
 * available here too — which is what makes the behaviour testable without
 * driving a browser, and what lets the whole thing be scripted.
 */

import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { ensureBox, pickFreeBoxDir, resolveBoxDir, versionDir } from '../src/paths.js'
import {
  describePlugin, partitionPlugins, readConfig, removePlugin, upsertPlugin, writeConfig,
} from '../src/config.js'
import { installRelease, listReleases } from '../src/registry.js'
import { userDshHome } from '../src/paths.js'
import {
  adoptSessions, deleteSandbox, ensureSandbox, inspectSandbox, listSandboxes, mainDshRunning,
  suggestSandboxName,
} from '../src/sandbox.js'
import { launch, stop } from '../src/launch.js'
import { deleteVersion, downloadedVersions } from '../src/versions.js'

const USAGE = `dsh 沙箱启动器 —— 在隔离沙箱里跑 DeepSeek Harness

  versions                     看已下载了哪些版本,以及 npm 上有哪些
  pull <版本号>                下载一个官方版本(逐包核对版本)
  drop <版本号>                删掉一个已下载的版本(约 200–260MB)
  plugins                      列出记住的本地插件
  plugins add <目录> [--id x]  记住一个插件目录
  plugins rm <id>              不再记
  sandboxes                    列出沙箱
  start [选项]                 启动一个沙箱
  adopt <沙箱名> [--force]     把沙箱的对话复制进你日常的 dsh
  rm <沙箱名>                  删掉一个沙箱及其中一切
  ui [--port n]                打开配置窗

start 的选项:
  --version <版本>   用哪个版本        --sandbox <名字>   用哪个沙箱
  --new              开全新沙箱        --plugin <id>      勾一个插件,可重复
  --workspace <目录> dsh 打开哪个目录  --no-sign-in       不导入登录
  --main             非沙箱:用真实的 ~/.dsh 启动,插件仅本次生效

通用选项: --json 以 JSON 输出结果(给脚本和 Agent 用)。
数据默认放在 ./dsh_box(可用 --box <目录> 或环境变量 DSH_BOX_HOME 改)。
`

const argv = process.argv.slice(2)
const flags = parseFlags(argv)

try {
  await main(argv.filter((a) => !a.startsWith('--')), flags)
} catch (error) {
  console.error(`\n  ${error.message}\n`)
  process.exit(1)
}

/**
 * @param {string[]} positional
 * @param {Record<string, string | boolean | string[]>} opts
 */
async function main(positional, opts) {
  const [command, ...rest] = positional
  if (command === undefined || opts.help === true) return void process.stdout.write(USAGE)

  const layout = openBox(opts)

  switch (command) {
    case 'versions': return showVersions(layout)
    case 'pull': return pull(layout, rest[0])
    case 'drop': return drop(layout, rest[0])
    case 'plugins': return plugins(layout, rest)
    case 'sandboxes': return showSandboxes(layout, opts)
    case 'start': return start(layout, opts)
    case 'adopt': return adopt(layout, rest[0], opts)
    case 'rm': return remove(layout, rest[0])
    case 'ui': return openUi(layout, opts)
    default: throw new Error(`不认识的命令「${command}」——不带参数运行可看用法`)
  }
}

/**
 * Open, and if necessary create, the data directory.
 * @param {Record<string, unknown>} opts
 * @returns {import('../src/paths.js').BoxLayout}
 */
function openBox(opts) {
  const requested = resolveBoxDir({ dir: typeof opts.box === 'string' ? opts.box : undefined })
  try {
    return ensureBox(requested)
  } catch (error) {
    // Someone already owns a folder by that name. Taking it over silently is
    // the one failure mode that loses data belonging to another program.
    const free = pickFreeBoxDir(process.cwd())
    console.error(`  ${error.message}`)
    console.error(`  改用 ${free} —— 想自己指定就加 --box <目录>\n`)
    return ensureBox(free)
  }
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 */
async function showVersions(layout) {
  const local = downloadedVersions(layout)
  console.log('\n  已下载')
  if (local.length === 0) console.log('    (还没有 —— 试试: pull 0.1.0-rc.7)')
  for (const entry of local) {
    console.log(`    ${entry.version.padEnd(14)} ${entry.pinned ? '版本已逐包核对' : '版本混杂 —— 请重新下载'}`)
  }
  try {
    const { versions, tags } = await listReleases({ source: readConfig(layout).source })
    console.log('\n  npm 上可选')
    const tagName = { latest: '官方稳定版', next: '官方尝鲜版' }
    for (const version of versions.slice(0, 10)) {
      const label = Object.entries(tags)
        .filter(([, v]) => v === version)
        .map(([tag]) => tagName[tag] ?? tag)
        .join('、')
      console.log(`    ${version.padEnd(14)} ${label}`)
    }
  } catch (error) {
    console.log(`\n  (连不上 npm: ${error.message})`)
  }
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} version
 */
async function pull(layout, version) {
  if (version === undefined) throw new Error('要哪个版本? 例如: pull 0.1.0-rc.7')
  const dir = versionDir(layout, version)
  mkdirSync(dir, { recursive: true })
  console.log()
  await installRelease(dir, version, {
    onLog: (line) => console.log(`  ${line}`),
    source: readConfig(layout).source,
  })
  console.log(`\n  ${version} 已就绪\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} version
 */
async function drop(layout, version) {
  if (version === undefined) throw new Error('要删哪个版本? 用 versions 查看')
  console.log()
  await deleteVersion(layout, version, (line) => console.log(`  ${line}`))
  console.log('  已用它的沙箱下次启动前要重新下载\n')
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string[]} rest
 */
function plugins(layout, rest) {
  const config = readConfig(layout)
  const [action, value] = rest
  if (action === 'add') {
    if (value === undefined) throw new Error('哪个目录? 例如: plugins add ../my-plugin')
    const plugin = describePlugin(value, { id: typeof flags.id === 'string' ? flags.id : undefined })
    writeConfig(layout, upsertPlugin(config, plugin))
    return void console.log(`\n  已记住 ${plugin.package},id 为「${plugin.id}」\n`)
  }
  if (action === 'rm') {
    if (value === undefined) throw new Error('哪个 id? 用 plugins 查看')
    writeConfig(layout, removePlugin(config, value))
    return void console.log(`\n  已忘记「${value}」\n`)
  }
  const { live, missing } = partitionPlugins(config)
  console.log('\n  记住的插件')
  if (live.length === 0 && missing.length === 0) console.log('    (没有 —— 试试: plugins add <目录>)')
  for (const plugin of live) console.log(`    ${plugin.id.padEnd(24)} ${plugin.package}`)
  for (const plugin of missing) console.log(`    ${plugin.id.padEnd(24)} ${plugin.package}  ← 文件夹已不在`)
  console.log()
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} [opts]
 */
function showSandboxes(layout, opts = {}) {
  const all = listSandboxes(layout)
  if (opts.json === true) return void console.log(JSON.stringify(all, null, 2))
  console.log('\n  沙箱                每个都是一台独立的 dsh,彼此看不到对方的对话')
  if (all.length === 0) console.log('    (还没有)')
  for (const box of all) {
    const bits = [
      box.lastVersion ?? '还没启动过',
      `${box.sessions} 条对话`,
      box.hasCredentials ? '已登录' : '未登录',
    ]
    console.log(`    ${box.name.padEnd(24)} ${bits.join('  ·  ')}`)
  }
  console.log()
}

/**
 * Copy a sandbox's conversations into the user's real dsh home.
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 * @param {Record<string, unknown>} opts
 */
async function adopt(layout, name, opts) {
  if (name === undefined) throw new Error('哪个沙箱? 用 sandboxes 查看')
  const result = await adoptSessions(layout, name, { force: opts.force === true })
  if (opts.json === true) return void console.log(JSON.stringify(result))
  console.log(`\n  已并入 ${result.adopted} 条对话到 ${result.home},跳过 ${result.skipped} 条重复`)
  console.log('  下次打开 dsh 即可看到\n')
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function start(layout, opts) {
  const config = readConfig(layout)
  const last = config.last
  const version = pick(opts.version, last.version, downloadedVersions(layout)[0]?.version)
  if (version === undefined) throw new Error('还没下载任何版本 —— 试试: pull 0.1.0-rc.7')

  const name = opts.new === true
    ? suggestSandboxName(layout)
    : pick(opts.sandbox, last.sandbox) ?? suggestSandboxName(layout)

  const wanted = new Set(asList(opts.plugin).length > 0 ? asList(opts.plugin) : last.plugins)
  const { live, missing } = partitionPlugins(config)
  for (const gone of missing.filter((p) => wanted.has(p.id))) {
    console.error(`  注意:「${gone.id}」被勾着但文件夹已不在,这次不装它`)
  }
  const chosen = live.filter((p) => wanted.has(p.id))

  const quiet = opts.json === true
  const say = quiet ? () => {} : (line) => console.log(line)
  const main = opts.main === true
  const importSignIn = opts['no-sign-in'] !== true
  let boxName = '主环境'
  if (main) {
    if (await mainDshRunning()) throw new Error('主环境已经开着一台(端口 3080),先关掉它再启动')
    say('\n  非沙箱:用你真实的 ~/.dsh 启动,勾选的插件仅本次生效')
  } else {
    const { info, created, signInImported } = ensureSandbox(layout, name, { importSignIn })
    boxName = info.name
    say(`\n  沙箱「${info.name}」${created ? '已新建' : '已复用'}${signInImported ? ',登录已导入' : ''}`)
    if (!created) say(`  它的对话只属于它,别的沙箱看不到`)
    if (chosen.length === 0) say('  没勾额外插件:这是纯官方的 dsh')
  }

  const result = await launch({
    layout,
    ...(main ? { home: userDshHome() } : { sandbox: boxName }),
    version,
    plugins: chosen,
    workspace: typeof opts.workspace === 'string' ? opts.workspace : last.workspace || process.cwd(),
    onLog: (line) => say(`  ${line}`),
  })

  writeConfig(layout, {
    ...config,
    last: {
      version,
      sandbox: main ? last.sandbox : boxName,
      plugins: chosen.map((p) => p.id),
      importSignIn,
      workspace: typeof opts.workspace === 'string' ? opts.workspace : last.workspace,
    },
  })

  if (opts.json === true) {
    console.log(JSON.stringify({
      url: result.url, pid: result.pid, port: result.port, sandbox: boxName, version,
    }))
  } else {
    console.log(`\n  打开 ${result.url}`)
    console.log(`  用的是你真实的 API Key,这里的对话真实计费`)
    console.log(`  按 Ctrl+C 停止(进程号 ${result.pid})\n`)
  }

  const shutdown = async () => {
    console.log('\n  正在停止…')
    await stop(result.pid)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  await new Promise(() => {})
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {string} name
 */
function remove(layout, name) {
  if (name === undefined) throw new Error('哪个沙箱? 用 sandboxes 查看')
  const info = inspectSandbox(layout, name)
  if (!info.exists) throw new Error(`没有叫「${name}」的沙箱`)
  deleteSandbox(layout, name)
  console.log(`\n  已删除「${info.name}」—— 那台 dsh 不复存在\n`)
}

/**
 * @param {import('../src/paths.js').BoxLayout} layout
 * @param {Record<string, unknown>} opts
 */
async function openUi(layout, opts) {
  const { serve } = await import('../src/server.js')
  await serve(layout, { port: Number(opts.port) || 0, open: opts['no-open'] !== true })
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean | string[]>}
 */
function parseFlags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    const value = next !== undefined && !next.startsWith('--') ? next : true
    if (key in out) out[key] = [...asList(out[key]), value]
    else out[key] = value
    if (value !== true) i += 1
  }
  return out
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asList(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string')
  return typeof value === 'string' ? [value] : []
}

/**
 * @param {...unknown} candidates
 * @returns {string | undefined}
 */
function pick(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return undefined
}
