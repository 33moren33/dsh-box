/**
 * Read and edit a `cordis.patch.yml` **without reformatting it**.
 *
 * ⛔⛔ This is not a YAML library and must never become one. It answers exactly
 * two questions — *where does each row start and end*, and *what are its `id`
 * and `name`* — and every edit is a splice of whole lines. Anything it does not
 * understand is carried through byte for byte, which is the only promise that
 * matters here: **this file belongs to the user, and most of it was not written
 * by us.**
 *
 * ⭐ Why hand-rolled rather than copied from upstream: upstream only ever
 * *reads*. `applyEntryPatches` parses the file, applies the patches in memory
 * and boots — it never writes one back. There is no official editor to copy,
 * so the reading half is copied from the definition (see below) and the
 * writing half is ours, built to disturb nothing.
 *
 * ## The dialect (copied from the definition, not from a sample)
 *
 * Source: `@deepseek-ai/cordis-plugin-include@1.0.6`, which ships its
 * TypeScript (`src/index.ts`). Measured 2026-08-23: only three versions have
 * ever been published (`1.0.5-rc.1`, `1.0.6-rc.4`, `1.0.6`), `1.0.6-rc.4` and
 * `1.0.6` are byte-identical, and both `PatchOptions` and `applyEntryPatches`
 * hash the same across all three. **The format has never changed.**
 *
 * The file is a YAML sequence of `PatchOptions`:
 *
 * ```
 * interface PatchOptions {
 *   id?: string; insert?: EntryOptions[]; name?: string; config?: any
 *   group?: boolean | null; disabled?: boolean | null
 *   inject?: any; intercept?: any; isolate?: any; [key: string]: any
 * }
 * ```
 *
 * ⭐ The dialect is **narrower than YAML**: `yaml.JSON_SCHEMA` extended with a
 * single `!!js` scalar tag. No anchors, no aliases, no multi-document — which
 * is what makes a line scanner honest rather than reckless.
 *
 * Semantics, for the two operations that exist:
 * - **`insert`** — with an `id`, appends into that row's `config` (the row must
 *   already exist *and* be a group, else it warns and skips); without an `id`,
 *   appends to the top level.
 * - **no `insert`** — `id` is required and names an existing row; every other
 *   key **replaces** that key on the row (whole values, never a deep merge).
 *   ⭐ If `name` is given it is an *assertion*: a mismatch makes upstream warn
 *   and skip rather than write to the wrong row.
 * - A patch that matches nothing warns and is skipped. Nothing throws.
 *
 * ⚠️ There is no `remove`. **Taking a plugin out of somebody else's layer is
 * spelled `disabled: true`** — upstream does exactly that for its own telemetry
 * switch. Deleting the row is only possible in a layer we own.
 */

/** One `- ` item at the top level of the document. */
/**
 * @typedef {object} PatchItem
 * @property {number} start - first line index of the item, inclusive.
 * @property {number} end - last line index, inclusive.
 * @property {'insert' | 'override' | 'unknown'} kind
 * @property {PatchEntry[]} entries - rows carried by an `insert:` item.
 * @property {string | null} id - the `id:` of an override item.
 * @property {string | null} name - the `name:` of an override item.
 * @property {boolean | null} disabled - the `disabled:` of an override item.
 * ⭐ Worth its own field because it is how the format spells "remove": there is
 * no remove operation, so switching a row off in a later layer is the only way
 * to take out something a layer below put in.
 */

/**
 * One row inside an `insert:` list — a plugin, as far as this tool is concerned.
 * @typedef {object} PatchEntry
 * @property {number} start
 * @property {number} end
 * @property {string | null} id
 * @property {string | null} name
 * @property {number} indent - the column its `- ` sits at, so new siblings line up.
 */

/**
 * @typedef {object} ScannedPatch
 * @property {string[]} lines - the file split on newlines, verbatim.
 * @property {string} newline - the line ending this file uses.
 * @property {string} bom - a byte-order mark, kept aside and put back.
 * @property {boolean} endsWithNewline
 * @property {PatchItem[]} items
 * @property {number | null} emptyList - line index of a lone `[]`, if the
 * document is one. ⛔ It is a complete YAML value: appending after it makes a
 * second document and dsh refuses to parse the file at all.
 */

const INDENT = /^[ \t]*/
const DASH = /^[ \t]*-[ \t]+/
const BARE_DASH = /^[ \t]*-[ \t]*$/
const KEY = /^[ \t]*(?:-[ \t]+)?([A-Za-z_][\w-]*)[ \t]*:(.*)$/
const BLANK_OR_COMMENT = /^[ \t]*(?:#.*)?$/
const LONE_EMPTY_LIST = /^[ \t]*\[\][ \t]*$/

/** @param {string} line */
function indentOf(line) {
  return INDENT.exec(line)?.[0].length ?? 0
}

/**
 * Take the value out of `key: value`, minus quoting and minus a trailing comment.
 *
 * ⛔ The comment rule is YAML's, not "cut at the first `#`": a `#` only opens a
 * comment when whitespace comes before it, and never inside a quoted scalar.
 * `name: a#b` is the name `a#b`; `name: a  # b` is the name `a`. Getting this
 * wrong reads a package called `dsh-llm-claude   # the one I actually use`,
 * which is how this was caught — a real row out of a real `~/.dsh`.
 *
 * ⚠️ Deliberately shallow otherwise: the dialect is JSON-schema plus `!!js`, so
 * a value is a plain scalar, `'single'`, or `"double"`. Anything stranger is
 * handed back untouched rather than guessed at — this result is only ever
 * compared, never written back.
 * @param {string} value
 */
export function unquoteScalar(value) {
  const text = stripComment(value).trim()
  if (text.length < 2) return text
  const first = text[0]
  if ((first === '"' || first === "'") && text.endsWith(first)) {
    const inner = text.slice(1, -1)
    return first === "'" ? inner.replaceAll("''", "'") : inner.replaceAll('\\"', '"')
  }
  return text
}

/**
 * Cut a trailing comment off one value, honouring quotes.
 * @param {string} value
 */
function stripComment(value) {
  let quote = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote !== null) {
      // A doubled quote inside a single-quoted scalar is an escaped quote, and
      // a backslash escapes the next character inside a double-quoted one.
      if (char === '\\' && quote === '"') { index += 1; continue }
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") { index += 1; continue }
        quote = null
      }
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '#' && (index === 0 || /[ \t]/.test(value[index - 1]))) return value.slice(0, index)
  }
  return value
}

/**
 * Walk the file and record where everything is.
 *
 * ⛔ Nothing here interprets values. A line is either the start of an item, the
 * start of an entry, a key this tool recognises, or *something else that gets
 * carried along* — and the last case is the common one.
 * @param {string} text
 * @returns {ScannedPatch}
 */
export function scanPatch(text) {
  // ⛔ A byte-order mark comes off before anything else and goes back on at the
  // end. Notepad and a good many Windows editors put one on a UTF-8 file, and
  // with it still attached the first line reads `\uFEFF- insert:` — the dash
  // never matches, so the *whole file* is misread: measured as one item and
  // zero rows on a file that has one of each. ⭐ This tool edits other people's
  // files, so a misreading is not a cosmetic bug; it is the dangerous one.
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const rest = bom === '' ? text : text.slice(1)
  const newline = rest.includes('\r\n') ? '\r\n' : '\n'
  const endsWithNewline = rest.endsWith('\n')
  const body = endsWithNewline ? rest.slice(0, -newline.length) : rest
  const lines = body === '' && rest === '' ? [] : body.split(newline)

  /** @type {PatchItem[]} */
  const items = []
  let emptyList = null
  /** @type {PatchItem | null} */
  let item = null
  /** @type {PatchEntry | null} */
  let entry = null
  let itemIndent = 0
  let insertIndent = -1

  const closeEntry = (at) => {
    if (entry === null) return
    entry.end = at
    entry = null
  }
  const closeItem = (at) => {
    closeEntry(at)
    if (item === null) return
    item.end = at
    items.push(item)
    item = null
    insertIndent = -1
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (LONE_EMPTY_LIST.test(line) && item === null) {
      emptyList = index
      continue
    }
    // Blank and comment lines belong to whatever is open; they never open or
    // close anything. A comment above a row is that row's, and stays with it.
    if (BLANK_OR_COMMENT.test(line)) continue

    const indent = indentOf(line)
    const isDash = DASH.test(line) || BARE_DASH.test(line)

    if (isDash && (item === null || indent <= itemIndent)) {
      closeItem(index - 1)
      itemIndent = indent
      item = { start: index, end: index, kind: 'unknown', entries: [], id: null, name: null, disabled: null }
      // fall through: a `- id: x` line is both the item start and its first key
    }

    if (item === null) continue

    // Inside an `insert:` list, a `- ` deeper than the item opens a row.
    if (insertIndent >= 0 && isDash && indent >= insertIndent && index !== item.start) {
      closeEntry(index - 1)
      entry = { start: index, end: index, id: null, name: null, indent }
      item.entries.push(entry)
    }

    const key = KEY.exec(line)
    if (key === null) continue
    const [, name, rest] = key
    const value = rest.trim()

    if (name === 'insert' && entry === null) {
      item.kind = 'insert'
      // The rows sit deeper than the key. Their exact column is taken from the
      // first one rather than assumed, because two files in this repository's
      // own history indent them differently.
      insertIndent = indent + 1
      continue
    }
    if (entry !== null) {
      if (name === 'id') entry.id = unquoteScalar(value)
      if (name === 'name') entry.name = unquoteScalar(value)
      continue
    }
    if (name === 'id') { item.id = unquoteScalar(value); if (item.kind === 'unknown') item.kind = 'override' }
    if (name === 'name') item.name = unquoteScalar(value)
    if (name === 'disabled') item.disabled = unquoteScalar(value) === 'true'
  }
  closeItem(lines.length - 1)

  return { lines, newline, bom, endsWithNewline, items, emptyList }
}

/**
 * Put a scan back together.
 *
 * ⭐ The point of the whole module: with no edits this returns the input,
 * byte for byte, whatever was in it.
 * @param {ScannedPatch} scan
 * @returns {string}
 */
export function renderPatch(scan) {
  const bom = scan.bom ?? ''
  if (scan.lines.length === 0) return `${bom}${scan.endsWithNewline ? scan.newline : ''}`
  const body = scan.lines.join(scan.newline)
  return `${bom}${scan.endsWithNewline ? `${body}${scan.newline}` : body}`
}

/**
 * Every plugin row in the file, in the order it appears.
 * @param {ScannedPatch} scan
 * @returns {{id: string | null, name: string | null, item: number, entry: number}[]}
 */
export function listEntries(scan) {
  const out = []
  scan.items.forEach((item, itemIndex) => {
    item.entries.forEach((one, entryIndex) => {
      out.push({ id: one.id, name: one.name, item: itemIndex, entry: entryIndex })
    })
  })
  return out
}

/**
 * Cut whole lines out, keeping every other byte where it was.
 *
 * ⛔ Given several spans it removes them back to front, because removing the
 * first would move the rest — the kind of bug that only shows up when a caller
 * happens to remove two things at once.
 * @param {ScannedPatch} scan
 * @param {{start: number, end: number}[]} spans - inclusive line ranges.
 * @returns {ScannedPatch}
 */
export function cutLines(scan, spans) {
  const lines = [...scan.lines]
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    lines.splice(span.start, span.end - span.start + 1)
  }
  return scanPatch(renderPatch({ ...scan, lines }))
}

/**
 * Put whole lines in, keeping every other byte where it was.
 *
 * ⛔ The sibling of {@link cutLines}, and the only other way this module changes
 * a file. Between them every edit is "these lines go, those lines arrive" —
 * which is what makes the promise in the header check out: the file is never
 * re-rendered from a parse, because there is no parse to re-render from.
 * @param {ScannedPatch} scan
 * @param {number} at - line index the new lines land at; the length of the file
 * appends.
 * @param {string[]} lines
 * @returns {ScannedPatch}
 */
export function spliceLines(scan, at, lines) {
  const next = [...scan.lines]
  next.splice(at, 0, ...lines)
  return scanPatch(renderPatch({ ...scan, lines: next }))
}
