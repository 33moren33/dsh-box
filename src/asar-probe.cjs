/**
 * Read a dsh packed inside an `app.asar`, using the interpreter that shipped
 * with it.
 *
 * ⛔ Never run by this tool's own Node — it would fail on every line. `asar` is
 * a virtual filesystem Electron patches into its own Node build, so these paths
 * only exist for that binary. Started as:
 *
 *   ELECTRON_RUN_AS_NODE=1 "<the app>.exe" src/asar-probe.cjs <app.asar> <prefix>
 *
 * The prefix is handed in rather than written here, because it is the rule that
 * decides which packages are supposed to share the release number, and a second
 * copy of that rule drifts from the first.
 *
 * CommonJS on purpose: this package is ESM, and a `.js` file here would be read
 * as a module by a runtime that has no reason to share our conventions.
 *
 * Everything the caller needs comes back from this one launch. Answering one
 * question per run would mean starting a 100MB binary four times to fill in a
 * single line of output.
 */

'use strict'

const fs = require('fs')

/** Marks our own output, so noise the runtime prints is never parsed as data. */
const MARK = '<<<DSHBOX-PROBE>>>'

const archive = process.argv[2]
const releasePrefix = process.argv[3]
const scope = `${archive}/node_modules/@deepseek-ai`

const out = {
  node: process.version,
  version: null,
  entry: null,
  entryExists: false,
  packages: 0,
  mixed: [],
}

/**
 * @param {string} path
 * @returns {Record<string, unknown> | null}
 */
const manifest = (path) => {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const dsh = manifest(`${scope}/dsh/package.json`)
if (dsh !== null) {
  out.version = typeof dsh.version === 'string' ? dsh.version : null
  // Read from the manifest rather than assumed, for the same reason as
  // everywhere else: an entry point is something a build is allowed to move.
  const bin = typeof dsh.bin === 'string' ? dsh.bin : dsh.bin && dsh.bin.dsh
  if (typeof bin === 'string' && bin !== '') {
    out.entry = `${scope}/dsh/${bin.replace(/^\.\//, '')}`
    try {
      fs.statSync(out.entry)
      out.entryExists = true
    } catch {
      // Reported as false, which the caller turns into "no dsh in there" —
      // a manifest naming an entry that is not present is not a launchable
      // installation, whatever else it is.
    }
  }
}

// The pin check, run here because the sibling manifests are behind the same
// virtual filesystem. Counted and listed, never judged: the caller decides what
// a mixed tree means, and for somebody else's application the answer is
// "say so and start it anyway".
//
// ⛔ Only the packages the prefix covers. The framework packages sharing this
// scope carry their own version numbers by design, and counting them makes
// every correct installation look mixed.
try {
  for (const name of fs.readdirSync(scope)) {
    const full = `@deepseek-ai/${name}`
    if (!full.startsWith(releasePrefix)) continue
    const sibling = manifest(`${scope}/${name}/package.json`)
    out.packages += 1
    const found = sibling === null || typeof sibling.version !== 'string' ? null : sibling.version
    if (found !== out.version) out.mixed.push({ name: full, found })
  }
} catch {
  // No scope directory at all leaves `packages` at 0, which the caller reads as
  // "could not check" rather than as "nothing matched".
}

process.stdout.write(MARK + JSON.stringify(out))
