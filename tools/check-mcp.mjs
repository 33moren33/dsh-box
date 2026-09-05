/**
 * The third face says the same thing as the other two.
 *
 * Two halves. The static half reads the declaration the tool face is generated
 * from (`src/mcp.js`) and asks whether every fact in the command table reached
 * it: every command is a tool unless it says why not, every enum is an `enum`,
 * every repeatable flag is an array, nothing the face fills in itself (`--box`,
 * `--json`) is offered as an argument, and a call is written back out as the
 * argv the command line would have been given. The live half starts the real
 * server over stdio and speaks the protocol to it — `initialize`, `ping`,
 * `tools/list`, `tools/call` — against a throwaway data directory, and reads the
 * verdict tiers back out of the answers: `failed` is an answer, `error` is the
 * tool's fault, and only the second is `isError`.
 *
 * ⛔ Then the snapshot: the **structure** of the tool table (names, argument
 * names and types, enums, required, annotations, bindings) is stored on disk and
 * compared byte for byte. Descriptions are not in it — they may be reworded any
 * time. A structural change is a change to what every connected agent was
 * promised, and must be a deliberate one: confirm, then `--write-snapshot`.
 *
 * Usage: node tools/check-mcp.mjs <一次性目录> [--write-snapshot]
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { COMMANDS, GLOBAL_PARAMS } from '../src/commands.js'
import { SOURCE_CHOICES } from '../src/config.js'
import { VERDICT_EXIT } from '../src/errors.js'
import { argvOf, declaration, fitted, MAX_CHARS, offered, PROTOCOL_VERSIONS, strayArguments, toolNameOf } from '../src/mcp.js'
import { LANGS, setLang } from '../src/messages.js'
import { useFakeDaily } from './fake-daily.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cli.js')
const scratch = process.argv[2]
if (scratch === undefined || scratch.startsWith('--')) {
  console.error('用法:node tools/check-mcp.mjs <一次性目录> [--write-snapshot]')
  process.exit(2)
}
// ⛔ The server's children open a data directory and read the daily cabinet;
//    that must be a throwaway one, never the real `~/.dsh`.
useFakeDaily(scratch)
// ⛔ A refusal that wants a person must refuse at once here, not open a window
//    and wait a minute for nobody.
process.env.DSH_BOX_NO_PANEL = '1'
process.env.DSH_BOX_LANG = 'zh'

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n第三张脸:声明 → 工具表\n')

// ── 1. 每条命令都是一个工具,除非它写明了不是 ─────────────────────────────────
setLang('zh')
const doc = declaration()
const names = doc.tools.map((tool) => tool.name)
const kept = Object.entries(COMMANDS).filter(([, shape]) => offered(shape)).map(([name]) => toolNameOf(name))
const left = Object.entries(COMMANDS).filter(([, shape]) => !offered(shape)).map(([name]) => name)
check('⭐ 工具表 ＝ 命令表减去写明 mcp:false 的那几条(名字里的点写成下划线)', same(names, kept), `${names.length} 条工具,留在命令行的:${left.join('、')}`)
check('留在命令行的都是不返回的那种,一个会改状态的都没有(改状态的能力 agent 必须够得着)',
  left.every((name) => COMMANDS[name].mutates !== true), left.join('、'))
check('留在命令行的恰好是 ui 与 mcp 自己', same([...left].sort(), ['mcp', 'ui']), left.join('、'))
check('每条工具都有名字、标题、描述、schema、四个 hint', doc.tools.every((tool) => tool.name && tool.title && tool.description
  && tool.inputSchema?.type === 'object' && ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']
  .every((hint) => typeof tool.annotations?.[hint] === 'boolean')))
check('工具名只用模型侧也认的字符(没有点)', names.every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name)))
check('契约(tools)与绑定(bindings)分家,且一一对应', same(Object.keys(doc.bindings), names))

// ── 2. 声明里的每个事实都到了 schema ─────────────────────────────────────────
for (const tool of doc.tools) {
  const shape = COMMANDS[Object.keys(COMMANDS).find((key) => toolNameOf(key) === tool.name)]
  const schema = tool.inputSchema
  const props = Object.keys(schema.properties)
  const declared = shape.params.filter((one) => one.mcp !== false)
  check(`${tool.name}:schema 的参数 ＝ 声明里没标 mcp:false 的参数`, same(props, declared.map((one) => one.name)), props.join('、') || '(无)')
  check(`${tool.name}:required 的都在 properties 里,而且正是声明里的必填`,
    same(schema.required, declared.filter((one) => one.required === true).map((one) => one.name)), schema.required.join('、') || '(无)')
  check(`${tool.name}:每个参数都有一句话`, props.every((name) => typeof schema.properties[name].description === 'string' && schema.properties[name].description !== ''))
  for (const one of declared) {
    const property = schema.properties[one.name]
    if (one.enum !== undefined) check(`${tool.name}.${one.name}:枚举原样到了 schema`, same(property.enum, one.enum), one.enum.join('|'))
    if (one.repeat === true) check(`${tool.name}.${one.name}:可重复的是 array`, property.type === 'array' && property.items?.type === 'string')
    if (one.type === 'boolean') check(`${tool.name}.${one.name}:布尔是 boolean`, property.type === 'boolean')
  }
  check(`${tool.name}:不接受声明之外的名字(additionalProperties:false)`, schema.additionalProperties === false)
  check(`${tool.name}:readOnlyHint 与 mutates 相反、destructiveHint 与 mutates 相同`,
    tool.annotations.readOnlyHint === (shape.mutates !== true) && tool.annotations.destructiveHint === (shape.mutates === true))
  check(`${tool.name}:描述里没有 ⭐⛔⚠ 与 **`, !/[⭐⛔⚠*]/.test(tool.description) && !/[⭐⛔⚠*]/.test(tool.title))
  check(`${tool.name}:描述里带着命令行等价写法`, tool.description.includes(`dsh-box ${Object.keys(COMMANDS).find((key) => toolNameOf(key) === tool.name).split('.').join(' ')}`))
  const binding = doc.bindings[tool.name]
  check(`${tool.name}:绑定的位置参数按声明的顺序`,
    same(binding.positional, declared.filter((one) => one.at !== undefined).sort((a, b) => a.at - b.at).map((one) => one.name)))
}
check('⛔ 本脸自己填的旗标(--box / --json / --help)不出现在任何工具的参数里',
  doc.tools.every((tool) => GLOBAL_PARAMS.every((one) => !(one.name in tool.inputSchema.properties))))
check('start 的 --follow 不在工具表里(它让 start 不返回)', !('follow' in doc.tools.find((tool) => tool.name === 'start').inputSchema.properties))
check('set_source 的枚举就是配置那张表', same(doc.tools.find((tool) => tool.name === 'set_source').inputSchema.properties.value.enum, SOURCE_CHOICES))

// ── 3. 判词四档 → isError 两档,由声明给 ───────────────────────────────────────
check('判词表覆盖四档,且只有 error 是 isError', same(Object.keys(doc.verdicts).sort(), Object.keys(VERDICT_EXIT).sort())
  && Object.entries(doc.verdicts).every(([verdict, { isError }]) => isError === (verdict === 'error')), JSON.stringify(doc.verdicts))
check('截断提示由声明给,非空', typeof doc.truncationHint === 'string' && doc.truncationHint !== '')
check('声明自报名字与版本', doc.name === 'dsh-box' && typeof doc.version === 'string' && doc.schemaVersion === 1)

// ── 4. 一次调用怎么写回 argv ───────────────────────────────────────────────────
const plug = argvOf(doc.bindings.get_plugin, { source: 'x', to: 'a', id: 'b' })
check('get_plugin {source,to,id} → get plugin x --to a --id b', same(plug, ['get', 'plugin', 'x', '--to', 'a', '--id', 'b']), plug.join(' '))
const started = argvOf(doc.bindings.start, { new: true, plugin: ['a', 'b'], 'no-sign-in': false, version: '1.2.3' })
check('start {new:true, plugin:[a,b], no-sign-in:false} → 布尔真是裸旗标、假不写、可重复逐个写',
  same(started, ['start', '--new', '--version', '1.2.3', '--plugin', 'a', '--plugin', 'b']), started.join(' '))
check('不属于本工具的名字被挑出来(含 box / json)', same(strayArguments(doc.bindings.ls, { box: 'x', json: true, force: true }), ['box', 'json', 'force']))

// ── 4b. 答案太大不切半截,换替身 ────────────────────────────────────────────────
// ⛔ 切到一半的 JSON 不是 JSON;替身是一条完整的行,判词 partial(命令答了,本脸交不全),
//    带前一段、实际大小、上限与收窄提示。
const small = { schema: 1, box: 'x', ok: true, verdict: 'ok', a: 1 }
check('装得下的答案原样交', fitted(small, 'hint', MAX_CHARS) === small)
const big = { schema: 1, box: 'x', ok: true, verdict: 'ok', blob: 'y'.repeat(5000) }
const stand = fitted(big, '收窄提示', 1000)
check('装不下的答案换成 partial 替身:ANSWER_TOO_LARGE、带 head / chars / limit、原判词另存、提示在句子里',
  stand !== big && stand.verdict === 'partial' && stand.code === 'ANSWER_TOO_LARGE' && stand.box === 'x'
  && typeof stand.head === 'string' && stand.head.length > 0 && stand.chars > 1000 && stand.limit === 1000
  && stand.verdictOfAnswer === 'ok' && String(stand.message).includes('收窄提示'), JSON.stringify(stand).slice(0, 200))
check('替身自己装得下', JSON.stringify(stand).length <= 1000)
check('默认上限是 20000 字符(真账本 16 台的总览约 9KB,近它就该再折,不该抬它)', MAX_CHARS === 20_000)

// ── 5. 两种语言都生成得出来,而且不一样 ───────────────────────────────────────
const byLang = {}
for (const lang of LANGS) {
  setLang(lang)
  byLang[lang] = declaration().tools.find((tool) => tool.name === 'ls_plugin').description
}
setLang('zh')
check('换一种语言,描述跟着换', byLang.zh !== byLang.en && byLang.zh !== '' && byLang.en !== '')

// ── 6. 真起服务,说协议 ─────────────────────────────────────────────────────────
console.log('\n真起服务,说协议\n')
const box = join(scratch, 'box-mcp')
const server = spawn(process.execPath, [CLI, 'mcp', '--box', box], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
server.stdout.on('data', (chunk) => { stdout += chunk })
server.stderr.on('data', (chunk) => { stderr += chunk })
const exited = new Promise((done) => server.once('close', (code) => done(code)))

const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'check', version: '0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'ping' },
  { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ls_sandbox', arguments: {} } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'stop', arguments: { sandbox: 'nope' } } },
  { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'ls', arguments: { force: true } } },
  { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'set_source', arguments: { value: 'nonsense' } } },
  { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nosuch', arguments: {} } },
  { jsonrpc: '2.0', id: 9, method: 'resources/list' },
]
for (const request of requests) server.stdin.write(`${JSON.stringify(request)}\n`)
server.stdin.write('not json\n')
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'ls_plugin', arguments: { in: 'no-such-cabinet' } } })}\n`)

// Wait for every reply (10 requests + 1 parse error), then close the input.
const expected = 11
const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '')
  if (lines.length >= expected) break
  await new Promise((tick) => setTimeout(tick, 100))
}
server.stdin.end()
const exitCode = await Promise.race([exited, new Promise((tick) => setTimeout(() => tick(null), 10_000))])
if (exitCode === null) server.kill()

const lines = stdout.split('\n').filter((line) => line.trim() !== '')
const parsed = lines.map((line) => { try { return JSON.parse(line) } catch { return null } })
check('stdout 上只有协议:每一行都是 JSON', parsed.every((one) => one !== null), `${lines.length} 行`)
const byId = new Map(parsed.filter((one) => one !== null).map((one) => [one.id, one]))
check(`收到 ${expected} 条回复(通知不回)`, lines.length === expected, `${lines.length} 行`)
check('输入关掉之后服务自己退出,退出码 0', exitCode === 0, `exit=${exitCode}`)

const init = byId.get(1)?.result
check('initialize:客户端要的协议版本认识就照样回', init?.protocolVersion === '2025-03-26' && PROTOCOL_VERSIONS.includes(init?.protocolVersion), JSON.stringify(init?.protocolVersion))
check('initialize:自报 dsh-box 与版本,声明有 tools 能力,带一段 instructions',
  init?.serverInfo?.name === 'dsh-box' && typeof init?.serverInfo?.version === 'string' && init?.capabilities?.tools !== undefined
  && typeof init?.instructions === 'string' && init.instructions.includes(resolve(box)), JSON.stringify(init?.serverInfo))
check('ping 回空对象', same(byId.get(2)?.result, {}))
const listed = byId.get(3)?.result?.tools
check('tools/list 与声明逐条一致', Array.isArray(listed) && same(listed.map((tool) => tool.name), names), `${listed?.length} 条`)

/** @param {number} id */
const answer = (id) => {
  const result = byId.get(id)?.result
  let line = null
  try { line = JSON.parse(result?.content?.[0]?.text ?? '') } catch { line = null }
  return { result, line }
}
const okCall = answer(4)
check('tools/call ls_sandbox:答出来了,isError:false,verdict ok,答案里写着是哪个数据目录',
  okCall.result?.isError === false && okCall.line?.verdict === 'ok' && okCall.line?.ok === true
  && typeof okCall.line?.box === 'string' && resolve(okCall.line.box) === resolve(box), JSON.stringify(okCall.line))
check('tools/call 的答案只走文本块一份,不重复到 structuredContent', okCall.result?.structuredContent === undefined && okCall.result?.content?.length === 1)
const failedCall = answer(5)
check('tools/call stop nope:关于那台的判定(failed)不是工具出错 —— isError:false,verdict failed,code 在',
  failedCall.result?.isError === false && failedCall.line?.verdict === 'failed' && typeof failedCall.line?.code === 'string', JSON.stringify(failedCall.line))
const strayCall = answer(6)
check('tools/call ls {force}:不是本工具的参数,服务这一层就拒,isError:true,code ARGUMENT_NOT_HERE,并说它收什么',
  strayCall.result?.isError === true && strayCall.line?.verdict === 'error' && strayCall.line?.code === 'ARGUMENT_NOT_HERE'
  && same(strayCall.line?.arguments, ['force']), JSON.stringify(strayCall.line))
check('服务自己写的那行与命令行的同形:也带 schema 与 box',
  strayCall.line?.schema === 1 && typeof strayCall.line?.box === 'string' && resolve(strayCall.line.box) === resolve(box))
const badValue = answer(7)
check('tools/call set_source nonsense:命令行自己拒的请求错也是 error 档,isError:true',
  badValue.result?.isError === true && badValue.line?.verdict === 'error' && typeof badValue.line?.code === 'string', JSON.stringify(badValue.line))
const notRunningPlugin = answer(10)
check('tools/call ls_plugin --in 不存在的柜:命令行的判定原样到达(不是旗标那三种拒绝)',
  notRunningPlugin.line !== null && !['FLAG_NOT_HERE', 'UNKNOWN_FLAG', 'FLAG_TWICE', 'ARGUMENT_NOT_HERE'].includes(notRunningPlugin.line?.code), JSON.stringify(notRunningPlugin.line?.code))
check('tools/call 不存在的工具:协议错 -32602,并列出有哪些', byId.get(8)?.error?.code === -32602 && String(byId.get(8)?.error?.message).includes('ls_sandbox'))
check('不认识的方法:协议错 -32601', byId.get(9)?.error?.code === -32601)
const parseError = parsed.find((one) => one?.error?.code === -32700)
check('不是 JSON 的一行:协议错 -32700,id 为 null', parseError !== undefined && parseError.id === null)
check('服务自己不往 stdout 写别的(子进程的 stderr 转到了服务的 stderr)', lines.every((line) => line.trimStart().startsWith('{')), stderr.trim().split('\n').slice(0, 2).join(' / '))

// ── 6b. --max-chars 真管用:上限压到 200,`ls` 就回替身 ───────────────────────────
console.log('\n--max-chars\n')
const tiny = spawn(process.execPath, [CLI, 'mcp', '--box', box, '--max-chars', '200'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let tinyOut = ''
tiny.stdout.on('data', (chunk) => { tinyOut += chunk })
tiny.stderr.resume()
const tinyExit = new Promise((done) => tiny.once('close', (code) => done(code)))
tiny.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ls', arguments: {} } })}\n`)
const tinyDeadline = Date.now() + 30_000
while (Date.now() < tinyDeadline && tinyOut.split('\n').filter((line) => line.trim() !== '').length < 1) {
  await new Promise((tick) => setTimeout(tick, 100))
}
tiny.stdin.end()
if (await Promise.race([tinyExit, new Promise((tick) => setTimeout(() => tick(null), 10_000))]) === null) tiny.kill()
let tinyLine = null
try { tinyLine = JSON.parse(JSON.parse(tinyOut.trim().split('\n')[0]).result.content[0].text) } catch { tinyLine = null }
check('mcp --max-chars 200 下调 ls:回 partial 替身(ANSWER_TOO_LARGE),limit 是 200',
  tinyLine?.verdict === 'partial' && tinyLine?.code === 'ANSWER_TOO_LARGE' && tinyLine?.limit === 200, JSON.stringify(tinyLine)?.slice(0, 200))
const badKnob = spawnSync(process.execPath, [CLI, 'mcp', '--max-chars', 'abc', '--json', '--box', box], { encoding: 'utf8', windowsHide: true })
let badKnobOut = null
try { badKnobOut = JSON.parse(badKnob.stdout.trim().split('\n').at(-1)) } catch { badKnobOut = null }
check('mcp --max-chars abc 当场拒(BAD_FLAG,error 档,退出码 2)', badKnobOut?.code === 'BAD_FLAG' && badKnob.status === 2, JSON.stringify(badKnobOut))

// ── 7. ⛔ 工具表结构快照 ───────────────────────────────────────────────────────
console.log('\n工具表结构的快照\n')
const SNAPSHOT = join(HERE, 'fixtures', 'mcp-declaration-1.json')
const shapeOf = (document) => ({
  top: Object.keys(document).sort(),
  schemaVersion: document.schemaVersion,
  verdicts: document.verdicts,
  tools: document.tools.map((tool) => ({
    name: tool.name,
    keys: Object.keys(tool).sort(),
    annotations: tool.annotations,
    required: tool.inputSchema.required,
    properties: Object.fromEntries(Object.entries(tool.inputSchema.properties)
      .map(([name, property]) => [name, [property.type, property.items?.type ?? null, property.enum ?? null]])),
    binding: document.bindings[tool.name],
  })),
})
const current = JSON.stringify(shapeOf(doc), null, 2)
if (process.argv.includes('--write-snapshot')) {
  writeFileSync(SNAPSHOT, `${current}\n`)
  console.log(`  已写快照 ${SNAPSHOT}`)
}
const stored = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT, 'utf8').trim() : null
check('⛔ 工具表第 1 版结构的快照在盘上(缺快照直接红)', stored !== null, SNAPSHOT)
check('⛔ 当前工具表结构与快照逐字相同(变了就是对每个已接入的 agent 的破坏性变更)',
  stored === current, stored === current ? '' : '结构变了;确认是有意的再跑 --write-snapshot')

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
