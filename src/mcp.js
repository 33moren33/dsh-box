/**
 * The tool face: the same declaration, rendered for an MCP client.
 *
 * Nothing here knows what any command does. It reads `COMMANDS` and the
 * sentences in `messages.js`, and from those alone produces the two halves an
 * MCP server needs — the contract an agent can see (`tools[]`: name, description,
 * input schema, annotations) and the binding it cannot (`bindings{}`: how a call
 * is written back out as argv). Every call then runs the real command line as a
 * child with `--box … --json`, exactly as the config window does for a button,
 * and the one JSON line that comes back **is** the answer. So the third face is
 * the same promise as the other two, and a command added to the table is a tool
 * without anybody coming here.
 *
 * ⛔ Zero dependencies, on purpose. The protocol is a data format (a handful of
 * JSON-RPC messages over stdio) and is copied here; a protocol SDK is somebody
 * else's code running in our process, which is the one thing this tool has never
 * had. Four requests are enough: `initialize`, `tools/list`, `tools/call`,
 * `ping`. Anything else is answered "method not found", which the protocol
 * allows.
 *
 * ⭐ The verdict travels **in the answer**, not in `isError`. MCP has two tiers
 * (it worked / the tool errored); this tool has four, and two of them —
 * `failed` (the world said no about the thing asked) and `partial` (half was
 * done, the answer names which half) — are answers, not errors. Mapping them to
 * `isError:true` would show a correct conclusion to the model as a broken tool.
 * Which verdict is an error is stated in the declaration (`verdicts`), and this
 * file only looks it up.
 *
 * ⛔ The answer rides in the text block, once. The protocol suggests giving
 * `structuredContent` as well and repeating it serialized in `content` for
 * older clients — that is the same data sent twice, and every byte here is read
 * into a model's context. The JSON line is already structured; a client that
 * turns out to need the second field can have it behind a switch, not by default.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { COMMANDS, describeCommand, JSON_SCHEMA_DEFAULT, positionalsOf, PROGRAM, VERSION } from './commands.js'
import { VERDICT_EXIT } from './errors.js'
import { t } from './messages.js'

/** The command line this face runs for every call. */
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url))

/**
 * Longest answer handed back whole, unless `mcp --max-chars` says otherwise.
 *
 * Context is expensive, and a silent cut is the kind of false green this
 * project has been bitten by: the answer looks whole and is not. Over this, the
 * answer is **replaced**, not cut — a JSON line sliced in the middle is not
 * JSON, and a caller would be handed something it cannot parse and a note it
 * may not read. The stand-in carries the verdict `partial`, the first part of
 * the answer, how big the whole was, and which knob brings it down.
 *
 * ⭐ Sized against the real ledger: the overview of 16 sandboxes is ~9 KB, a
 * default `logs` is ≤ 4 KB. Anything near this ceiling is a shape that should
 * be folded further, not a ceiling that should be raised.
 */
export const MAX_CHARS = 20_000

/**
 * The protocol revisions this server speaks. A client naming one of these gets
 * it echoed back; any other gets the newest, which the protocol says is the
 * correct reply — the client then decides whether it can talk to us.
 */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

/**
 * Whether a command is offered as a tool.
 *
 * Everything is, unless the declaration says `mcp: false`. Only two do: the
 * server itself (a tool that starts a second server over the same stdio would be
 * calling into its own mouth) and `ui`, which never returns — a request/response
 * face has no way to hold a call open forever, and the one time a panel is
 * needed the command line opens it by itself (see `throughThePanel`).
 * @param {import('./commands.js').CommandShape} shape
 */
export function offered(shape) {
  return shape.mcp !== false
}

/**
 * Whether a parameter is accepted from a tool call.
 *
 * Same rule one level down: a parameter marked `mcp: false` is one that turns a
 * returning command into a non-returning one (`start --follow`), and so cannot be
 * honoured over a request/response channel. It stays on the command line.
 * @param {import('./commands.js').Param} one
 */
export function offeredParam(one) {
  return one.mcp !== false
}

/**
 * The two verdict tiers of the protocol, stated for each of this tool's four.
 *
 * Only `error` — the request was wrong or the tool broke — is the tool's fault.
 * The other three are answers about the thing asked, including the two refusals.
 * @returns {Record<string, {isError: boolean}>}
 */
export function verdictMap() {
  return Object.fromEntries(Object.keys(VERDICT_EXIT).map((verdict) => [verdict, { isError: verdict === 'error' }]))
}

/**
 * Sentences from the message table carry the marks people read by (⭐ ⛔ ⚠️)
 * and `**bold**`. A model should not learn them as syntax.
 * @param {string} text
 */
function plain(text) {
  return String(text).replaceAll('**', '').replace(/[⭐⛔⚠️]/g, '').trim()
}

/**
 * One tool's input schema, from the command's parameters.
 *
 * Every declared fact lands somewhere: `enum` is `enum`, `required` is
 * `required`, `repeat` makes the property an array, and the one sentence each
 * parameter has becomes its `description`. `additionalProperties:false` so a
 * client that validates refuses a stray name before anything runs; one that does
 * not is refused by the command line instead (`FLAG_NOT_HERE`).
 * @param {object} described - from {@link describeCommand}.
 * @param {import('./commands.js').CommandShape} shape
 */
function schemaOf(described, shape) {
  const properties = {}
  const required = []
  for (const one of described.params) {
    const declared = shape.params.find((param) => param.name === one.name)
    if (declared === undefined || !offeredParam(declared)) continue
    const base = one.type === 'boolean'
      ? { type: 'boolean' }
      : { type: 'string', ...(one.enum === undefined ? {} : { enum: one.enum }) }
    const property = one.repeat === true
      ? { type: 'array', items: base }
      : base
    // ⭐ The sentence first; the word that stands for the value after, so an
    //    agent knows what kind of thing to write where the sentence does not say.
    const description = [one.description, one.valueWord === undefined ? '' : `(${one.valueWord})`]
      .filter((part) => part !== '').join(' ')
    properties[one.name] = { ...property, ...(description === '' ? {} : { description }) }
    if (one.required) required.push(one.name)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/**
 * The four hints, from the one fact the declaration holds.
 *
 * `mutates` is the only thing the table says, and it is enough for two of the
 * four. The other two are stated conservatively: a command that changes state is
 * not promised idempotent (some are, but a wrong `true` here licenses a retry
 * that does the thing twice), and nothing here reaches beyond this machine.
 * @param {import('./commands.js').CommandShape} shape
 */
function annotationsOf(shape) {
  const mutates = shape.mutates === true
  return {
    readOnlyHint: !mutates,
    destructiveHint: mutates,
    idempotentHint: !mutates,
    openWorldHint: false,
  }
}

/**
 * The name a client's model actually sees.
 *
 * ⛔ The command table keys with a dot (`ls.sandbox`), and the protocol allows
 * it — but the first real client rewrote every dot to an underscore before
 * showing the model the name, because the model-facing tool-name rules do not
 * allow dots. A help page that says "the tool is called `ls.sandbox`" is then
 * describing a name nobody sees. So the underscore is written here, once, and
 * the help, the client and the declaration agree.
 * @param {string} name - the command table key.
 */
export function toolNameOf(name) {
  return name.replaceAll('.', '_')
}

/**
 * The description a model reads: what it does, what state it leaves, what
 * people get wrong, and the command line it is the same as — one per line, and
 * the notes keep their own line breaks, since some of them are small tables.
 * @param {object} described - from {@link describeCommand}.
 */
function descriptionOf(described) {
  const parts = [plain(described.summary)]
  if (described.after !== '') parts.push(`${t('mcp.after')}${plain(described.after)}`)
  if (described.notes.length > 0) parts.push(described.notes.map(plain).join('\n'))
  parts.push(`${t('mcp.cliEquivalent')}${PROGRAM} ${described.usage}`)
  return parts.join('\n')
}

/**
 * How a call to one tool is written back out as argv: which names go by
 * position and in what order, which are flags, which may repeat. Derived from
 * the same parameters the schema was, so the two cannot disagree about a name.
 * @param {string} name
 * @param {import('./commands.js').CommandShape} shape
 */
function bindingOf(name, shape) {
  const params = shape.params.filter(offeredParam)
  return {
    command: name.split('.'),
    positional: positionalsOf({ params }).map((one) => one.name),
    flags: params.filter((one) => one.at === undefined).map((one) => one.name),
    booleans: params.filter((one) => one.at === undefined && one.type === 'boolean').map((one) => one.name),
    repeat: params.filter((one) => one.repeat === true).map((one) => one.name),
  }
}

/**
 * The whole declaration, as one document: the contract (`tools`) and the
 * binding (`bindings`) side by side but apart, plus the two things a shell
 * needs that belong to the domain rather than to the protocol — which verdicts
 * are errors, and what to say when an answer had to be cut.
 *
 * ⭐ The same family of shape as the declaration files other tool servers of ours
 * use (`tools[]` / `bindings{}` / `verdicts{}` / `truncationHint`), so a shell
 * that reads one can read the other. The binding's inner fields are this tool's
 * own; the shell that is meant to read them is the one below.
 */
export function declaration() {
  const tools = []
  const bindings = {}
  for (const [name, shape] of Object.entries(COMMANDS)) {
    if (!offered(shape)) continue
    const described = describeCommand(name)
    const tool = toolNameOf(name)
    tools.push({
      name: tool,
      title: plain(described.summary),
      description: descriptionOf(described),
      inputSchema: schemaOf(described, shape),
      annotations: annotationsOf(shape),
    })
    bindings[tool] = bindingOf(name, shape)
  }
  return {
    schemaVersion: 1,
    name: PROGRAM,
    version: VERSION,
    tools,
    bindings,
    verdicts: verdictMap(),
    truncationHint: t('mcp.truncationHint'),
  }
}

/**
 * A tool call, written out as the argv the command line takes.
 *
 * Positionals in declared order, then flags. A boolean `true` is the bare flag;
 * `false` and `null` are "not given". A repeatable value is written once per
 * element. Values are stringified, not typed: the command line parses its own.
 * @param {ReturnType<typeof bindingOf>} binding
 * @param {Record<string, unknown>} args
 * @returns {string[]}
 */
export function argvOf(binding, args) {
  const argv = [...binding.command]
  for (const name of binding.positional) {
    const value = args[name]
    if (value === undefined || value === null) continue
    argv.push(String(value))
  }
  for (const name of binding.flags) {
    const value = args[name]
    if (value === undefined || value === null || value === false) continue
    if (binding.booleans.includes(name)) {
      if (value === true) argv.push(`--${name}`)
      continue
    }
    const values = binding.repeat.includes(name) && Array.isArray(value) ? value : [value]
    for (const each of values) argv.push(`--${name}`, String(each))
  }
  return argv
}

/**
 * The names a call may not carry: not a parameter of this tool, or one of the
 * flags this face fills in itself (`--box`, `--json`, `--help`). Refused here,
 * before anything runs, because a caller that could pass `box` would point one
 * call at another world and the answer would not say so.
 * @param {ReturnType<typeof bindingOf>} binding
 * @param {Record<string, unknown>} args
 * @returns {string[]}
 */
export function strayArguments(binding, args) {
  const allowed = new Set([...binding.positional, ...binding.flags])
  return Object.keys(args).filter((key) => !allowed.has(key))
}

/**
 * One tool result, from the command line's one JSON line.
 * @param {Record<string, unknown>} line - what the command printed.
 * @param {Record<string, {isError: boolean}>} verdicts
 * @param {string} truncationHint
 * @param {number} [maxChars]
 */
export function resultOf(line, verdicts, truncationHint, maxChars = MAX_CHARS) {
  const shown = fitted(line, truncationHint, maxChars)
  const verdict = typeof shown.verdict === 'string' ? shown.verdict : 'error'
  const isError = verdicts[verdict]?.isError ?? true
  return { content: [{ type: 'text', text: JSON.stringify(shown) }], isError }
}

/**
 * The line itself when it fits, otherwise a stand-in that says what it stood
 * in for: a `partial` — the command answered, this face could not hand the
 * whole answer over — with the answer's head, its size, and the hint.
 * @param {Record<string, unknown>} line
 * @param {string} hint - what to narrow, from the declaration.
 * @param {number} maxChars
 */
export function fitted(line, hint, maxChars) {
  const text = JSON.stringify(line)
  if (text.length <= maxChars) return line
  return {
    schema: line.schema ?? JSON_SCHEMA_DEFAULT,
    box: line.box ?? null,
    ok: false,
    verdict: 'partial',
    code: 'ANSWER_TOO_LARGE',
    message: t('mcp.tooLarge', { chars: String(text.length), limit: String(maxChars), hint }),
    chars: text.length,
    limit: maxChars,
    verdictOfAnswer: line.verdict ?? null,
    head: text.slice(0, Math.max(0, maxChars - 600)),
  }
}

/**
 * Run the command line once and read its answer.
 *
 * The same shape as the config window's `runCommand`: stdout is captured for
 * the one JSON line, stderr is passed through to ours (the protocol owns our
 * stdout, so a child's progress text must never reach it), and a child that
 * printed no parseable line is reported as the tool's own error — never as a
 * plausible failure about some sandbox.
 * @param {string[]} argv - the command and its arguments, without `--box`/`--json`.
 * @param {string} box - the data directory every call is about.
 * @returns {Promise<Record<string, unknown>>} the JSON line, or an `error`-tier stand-in.
 */
export function runCli(argv, box) {
  const notRun = (error) => standIn(box, 'COMMAND_NOT_RUN',
    t('mcp.cannotRun', { error: error instanceof Error ? error.message : String(error) }))
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, [CLI, ...argv, '--box', box, '--json'], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      return void resolve(notRun(error))
    }
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk; process.stderr.write(chunk) })
    child.once('error', (error) => resolve(notRun(error)))
    child.once('close', (code) => {
      const line = out.trim().split('\n').filter((text) => text.trim() !== '').at(-1)
      if (line !== undefined) {
        try {
          return void resolve(JSON.parse(line))
        } catch {
          // Fall through: whatever was printed was not the answer.
        }
      }
      resolve(standIn(box, 'COMMAND_NO_OUTPUT', err.trim() || t('mcp.noOutput', { code: String(code) }), { argv }))
    })
  })
}

/**
 * A line this face writes itself when the command line gave none, in the same
 * shape as the line it stands in for: `schema` and `box` first, then the error
 * tier. A caller reading answers should not need a second parser for the cases
 * where the tool itself was the problem.
 * @param {string} box
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
function standIn(box, code, message, details = {}) {
  return { schema: JSON_SCHEMA_DEFAULT, box, ok: false, verdict: 'error', code, message, ...details }
}

/**
 * Serve the tool face over stdio until stdin closes.
 *
 * One JSON-RPC message per line, both ways. Requests carry an `id` and get a
 * reply; notifications carry none and get nothing. Nothing but protocol goes to
 * stdout — the reason every child's stderr is forwarded to ours, and the reason
 * this function itself never logs to stdout.
 *
 * ⛔ The data directory is resolved once, here, and written into every call as
 * `--box`. A tool that resolved it per call against the working directory could
 * answer about two different worlds in one session without saying so.
 * @param {object} options
 * @param {string} options.box - the resolved data directory.
 * @param {number} [options.maxChars] - longest answer handed over whole.
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @returns {Promise<void>} resolves when the input ends.
 */
export function serve({ box, maxChars = MAX_CHARS, input = process.stdin, output = process.stdout }) {
  const doc = declaration()
  const tools = new Map(doc.tools.map((tool) => [tool.name, tool]))
  const send = (message) => output.write(`${JSON.stringify(message)}\n`)
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
  const refuse = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  /**
   * @param {{id?: unknown, method?: unknown, params?: any}} request
   */
  async function handle(request) {
    const { id, method, params } = request
    const isRequest = id !== undefined && id !== null
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion
        return reply(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: doc.name, version: doc.version ?? '0.0.0' },
          instructions: t('mcp.instructions', { program: PROGRAM, box }),
        })
      }
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, { tools: doc.tools })
      case 'tools/call': {
        const name = params?.name
        const tool = tools.get(name)
        if (tool === undefined) {
          return refuse(id, -32602, t('mcp.unknownTool', { name: String(name), tools: [...tools.keys()].join(', ') }))
        }
        const args = params?.arguments !== null && typeof params?.arguments === 'object' ? params.arguments : {}
        const binding = doc.bindings[name]
        const stray = strayArguments(binding, args)
        if (stray.length > 0) {
          const allowed = [...binding.positional, ...binding.flags]
          const message = allowed.length === 0
            ? t('mcp.strayArgumentNone', { tool: name, names: stray.join(', ') })
            : t('mcp.strayArgument', { tool: name, names: stray.join(', '), allowed: allowed.join(', ') })
          return reply(id, resultOf(standIn(box, 'ARGUMENT_NOT_HERE', message, { arguments: stray }), doc.verdicts, doc.truncationHint, maxChars))
        }
        const line = await runCli(argvOf(binding, args), box)
        return reply(id, resultOf(line, doc.verdicts, doc.truncationHint, maxChars))
      }
      default:
        // Notifications (`notifications/initialized`, `notifications/cancelled`)
        // are heard and not answered; an unknown *request* is told so.
        if (isRequest) refuse(id, -32601, `Method not found: ${String(method)}`)
    }
  }

  return new Promise((resolve) => {
    const lines = createInterface({ input, crlfDelay: Infinity })
    lines.on('line', (raw) => {
      const text = raw.trim()
      if (text === '') return
      let request
      try {
        request = JSON.parse(text)
      } catch {
        return void refuse(null, -32700, 'Parse error')
      }
      if (request === null || typeof request !== 'object' || Array.isArray(request)) {
        return void refuse(null, -32600, 'Invalid Request')
      }
      handle(request).catch((error) => {
        if (request.id !== undefined && request.id !== null) {
          refuse(request.id, -32603, error instanceof Error ? error.message : String(error))
        }
      })
    })
    lines.once('close', () => resolve())
  })
}
