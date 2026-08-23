/**
 * 工作区那条命令写出来的东西,dsh 认不认。
 *
 * ⛔ 这一条的价值全在「真 dsh 会不会照它开」,所以纯读盘的断言证明不了什么。
 * 但真起一台 dsh 要有一台装好的 dsh,那不是这套验收该假设的东西 —— 于是分成
 * 两半,各自诚实:
 *   **这里**只验形状与纪律(能加、能提到最前、不删东西、版本号不认就拒绝、
 *   写坏文件不覆盖),不需要任何 dsh。
 *   **真 dsh 那一半**在 `probe/probe-workspace-preseed.mjs`(自动跑两阶段)
 *   与 `probe/probe-workspace-live.mjs`(起一台留着给人看),已经跑过并由 CEO
 *   亲眼确认:预写一条之后 dsh 直接进那个工作区、勾选的就是它。
 *
 * ⛔ 一次性目录,不碰真 ~/.dsh、不起 dsh、不联网。
 *
 * 用法:
 *   node tools/check-workspaces.mjs <一次性目录>
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boxLayout, ensureBox } from '../src/paths.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const root = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (root === undefined) {
  console.error('用法: node tools/check-workspaces.mjs <一次性目录>')
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

// 一次性的「日常档案柜」,以及两个一次性的项目目录。
const daily = join(root, 'fake-daily')
mkdirSync(daily, { recursive: true })
const table = join(daily, 'storages', 'workspace.json')
const projectA = join(root, '项目甲')
const projectB = join(root, '项目乙')
for (const dir of [projectA, projectB]) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# 一次性\n')
}

function cli(...argv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
      windowsHide: true,
      env: { ...process.env, DSH_HOME: daily },
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

const read = () => JSON.parse(readFileSync(table, 'utf8'))

console.log('\n工作区:能指给 agent,而且不会写坏 dsh 的表\n')

// 1. 一张都没有的时候,是「一个都没有」而不是出错 —— 这正是 dsh 新起一台时的
//    真实状态(实测:它不会自己登记当前目录)。
const empty = await cli('workspaces', '--main')
check('还没有表时报「一个都没有」而不是出错',
  empty.ok !== false && empty.projects.length === 0, empty.code ?? `${empty.projects?.length} 条`)

// 2. 指一个,文件按 dsh 的 schema 长出来。⛔ 字段是照 dsh-workspace 的 zod
//    schema 抄的,不是照别人的数据抄的 —— 头一版漏了 createdAt/updatedAt,真
//    dsh 当场 exit 1 报 invalid-record。
const first = await cli('workspaces', 'use', projectA, '--main')
check('指得上', first.ok === true && first.added === true, first.code ?? 'ok')
const raw = read()
check('外层是 dsh 认的那个 unit',
  raw.unit?.name === 'workspace' && raw.unit?.version === 2, JSON.stringify(raw.unit))
const only = Object.values(raw.tables.workspaces)[0]
check('⛔ 五个字段一个不少(漏一个真 dsh 就起不来)',
  ['path', 'title', 'sessionIds', 'createdAt', 'updatedAt'].every((key) => key in only),
  Object.keys(only).join('、'))
check('顺序表里也有它,而且 initialized 是真',
  raw.global.initialized === true && raw.global.workspaceIds.length === 1)

// 3. 再指一个,新的排在最前 —— dsh 打开的就是第一条。
await cli('workspaces', 'use', projectB, '--main')
const two = await cli('workspaces', '--main')
check('⭐ 后指的那个排在最前,也就是下次打开进的那个',
  two.projects[0].path === projectB && two.projects[0].current === true, two.projects[0]?.path)
check('先指的那个还在,没被顶掉', two.projects.length === 2)

// 4. 切回去:同一个目录不重复登记,只是提到最前。
const back = await cli('workspaces', 'use', projectA, '--main')
check('⭐ 切回已登记的那个,是提到最前而不是加一条',
  back.added === false && back.moved === true, `added=${back.added} moved=${back.moved}`)
check('总数没变,一条都没多', (await cli('workspaces', '--main')).projects.length === 2)

// 5. ⛔ 从不删。别人的行、别人的对话归属,一律原样留着。
const withSessions = read()
const idA = Object.keys(withSessions.tables.workspaces)
  .find((id) => withSessions.tables.workspaces[id].path === projectA)
withSessions.tables.workspaces[idA].sessionIds = ['session-别动我']
writeFileSync(table, `${JSON.stringify(withSessions, null, 2)}\n`)
await cli('workspaces', 'use', projectB, '--main')
check('⛔ 对话归属一个字没动', read().tables.workspaces[idA].sessionIds[0] === 'session-别动我')

// 6. ⛔⛔ 版本号不认识就拒绝,绝不硬写。dsh 升过级、这张表换了形状时,写进旧
//    形状就是让整台 dsh 起不来;拒绝是可恢复的,写坏不是。
const future = read()
future.unit.version = 99
writeFileSync(table, `${JSON.stringify(future, null, 2)}\n`)
const refusedVersion = await cli('workspaces', 'use', projectA, '--main')
check('⛔⛔ 表的版本不认识就拒绝',
  refusedVersion.ok === false && refusedVersion.code === 'PROJECT_LIST_UNKNOWN', refusedVersion.code)
check('⛔ 拒绝时那个文件一个字节没动', read().unit.version === 99)

// 7. 读不懂也一样:不覆盖看不懂的东西 —— 这是全项目同一条纪律。
writeFileSync(table, '{ 这不是 JSON')
const refusedBroken = await cli('workspaces', 'use', projectA, '--main')
check('⛔ 读不懂就拒绝,不拿新的盖回去',
  refusedBroken.ok === false && refusedBroken.code === 'PROJECT_LIST_UNREADABLE', refusedBroken.code)
check('⛔ 那份坏的原样留着', readFileSync(table, 'utf8') === '{ 这不是 JSON')

// 8. 指一个不存在的目录,当场说清楚。
rmSync(table, { force: true })
const missing = await cli('workspaces', 'use', join(root, '根本没有这个目录'), '--main')
check('目录不存在就拒绝', missing.ok === false && missing.code === 'DIR_NOT_FOUND', missing.code)
check('⛔ 而且没有因此造出一张空表', !existsSync(table))

rmSync(root, { recursive: true, force: true })
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
