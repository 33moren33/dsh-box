/**
 * A dsh someone points us at, rather than one we found or downloaded.
 *
 * The machine axis used to have exactly two answers: the dsh installed on this
 * computer, and the releases this tool fetched from npm. Both are found by us,
 * which quietly made "which dsh" mean "which dsh we know about" — and there are
 * real ones we do not know about. Two arrived at once: a build made from the
 * official source tree (the only way to run an alpha, which is tagged on GitHub
 * and never published to npm), and the copy of dsh that ships inside an
 * application.
 *
 * ⭐ A source of dsh is three separate answers, and they vary independently:
 * **how to find the tree**, **how to read its version**, and **which
 * interpreter starts it**. An application varies the last one — its add-ons are
 * built for its own runtime, so it is started with the binary shipped beside
 * it. Everything else varies only the first.
 *
 * ⛔⛔ The tree itself must be real files, always. dsh builds a layer of
 * filesystem links under the filing cabinet pointing at its own packages, and a
 * link is resolved by the operating system, which knows nothing about archives.
 * Measured: through such a link, the application's own Node reports the target
 * missing; by direct path into the archive, the same file is found. So a dsh
 * that exists *only* inside `app.asar` cannot boot any cabinet — not with our
 * Node, not with its own.
 *
 * ⭐ That is not the normal shape and must not be designed around. An Electron
 * application declares which paths to leave unpacked, and this one asks for
 * `node_modules/**`; a build where those files are missing from
 * `app.asar.unpacked` is a defect in that build, not a packaging style. The
 * application's own code says the same thing — it computes its installation
 * anchor by rewriting `app.asar` to `app.asar.unpacked`, i.e. it also runs from
 * the real files. So the archive is read here for **one purpose only**: when no
 * tree is on disk, to say precisely what is sealed inside, instead of reporting
 * "no dsh here".
 *
 * ⚠️ Locating the interpreter is only implemented for Windows layouts. The
 * other two platforms refuse with a sentence naming what they looked for rather
 * than guessing, on the same grounds as `host.js`: an unverified branch that
 * answers confidently is worse than one that declines.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { cleanPath } from './paths.js'
import { RELEASE_PREFIX, verifyPinned } from './registry.js'

/** The package name a dsh installation is rooted at. */
const ROOT_PACKAGE_NAME = '@deepseek-ai/dsh'

/**
 * How far below the named folder to look for an installation.
 *
 * Three covers every shape seen so far — the folder itself, a workspace package
 * (`apps/cli`), and an application's unpacked resources — while keeping this a
 * bounded read rather than a scan of whatever the user happened to point at.
 */
const MAX_DEPTH = 3

/**
 * Whether this `--version` value is a folder rather than a release number.
 *
 * ⭐ One flag, one axis. "Which dsh" has always been a single question, and
 * adding a second flag for the same question would mean writing the rule for
 * what happens when both are given. A separator settles it with no rule to
 * write: a release number cannot contain one, and a path to a folder on any
 * supported platform effectively always does.
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikePath(value) {
  const text = value.trim()
  if (text === '') return false
  if (text === '.' || text === '..') return true
  // A drive letter is the one path shape with no separator in it.
  return text.includes('/') || text.includes('\\') || /^[A-Za-z]:/.test(text)
}

/**
 * The script an installation says to run.
 *
 * Read from the manifest, never assumed to be `lib/bin.js`. A build somebody
 * made themselves is exactly the one that might have moved its entry point,
 * and those are now nameable.
 * @param {string} dir - the package directory.
 * @param {{bin?: string | Record<string, string>}} pkg
 * @returns {string | null}
 */
export function entryScript(dir, pkg) {
  const bin = pkg.bin
  const relative = typeof bin === 'string' ? bin : typeof bin === 'object' && bin !== null ? bin.dsh : undefined
  if (typeof relative !== 'string' || relative === '') return null
  return isAbsolute(relative) ? relative : resolve(dir, relative)
}

/**
 * @param {string} file
 * @returns {Record<string, unknown> | null}
 */
function readManifest(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // Unreadable is not the same as absent, but it is the same for us: nothing
    // can be launched from it either way, and the caller is told where we
    // looked rather than what the JSON parser thought.
    return null
  }
}

/**
 * The manifest at this directory, if this directory is dsh itself.
 * @param {string} dir
 * @returns {Record<string, unknown> | null}
 */
function dshManifestAt(dir) {
  const pkg = readManifest(join(dir, 'package.json'))
  return pkg !== null && pkg.name === ROOT_PACKAGE_NAME ? pkg : null
}

/**
 * Directories to examine, nearest first.
 *
 * Breadth-first so that a shallow answer always wins over a deep one: in a
 * source workspace both the installed link and the package it points at are
 * present, and the link is the one that boots the way the repository intends.
 * `node_modules` is never walked into — it is only ever checked at a known
 * offset — because walking it turns a bounded look into an unbounded one.
 * @param {string} root
 * @returns {Generator<string>}
 */
function* nearbyDirs(root) {
  const queue = [[root, 0]]
  while (queue.length > 0) {
    const [dir, depth] = /** @type {[string, number]} */ (queue.shift())
    yield dir
    if (depth >= MAX_DEPTH) continue
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      queue.push([join(dir, entry.name), depth + 1])
    }
  }
}

/**
 * Find a dsh installation lying on the filesystem.
 * @param {string} root - the folder that was named.
 * @returns {{dir: string, pkg: Record<string, unknown>} | null}
 */
function findTree(root) {
  for (const dir of nearbyDirs(root)) {
    const here = dshManifestAt(dir)
    if (here !== null) return { dir, pkg: here }
    const installed = join(dir, 'node_modules', '@deepseek-ai', 'dsh')
    const pkg = dshManifestAt(installed)
    if (pkg !== null) return { dir: installed, pkg }
  }
  return null
}

/**
 * @typedef {object} PinInfo
 * @property {boolean} verified - whether there was anything to check.
 * @property {boolean} pinned - every package carries one release number.
 * @property {number} packages
 * @property {{name: string, found: string | null}[]} mixed - offenders, capped.
 */

/** Nothing was checkable. Said as its own state, never as "mixed". */
const UNCHECKED = { verified: false, pinned: false, packages: 0, mixed: [] }

/**
 * Whether every package of a tree carries one release number.
 *
 * ⭐ Reported, never enforced. On a release we downloaded this is a hard gate,
 * because an unpinned tree is a bug in our own download path. This tree is not
 * ours: a source workspace legitimately resolves its packages somewhere we
 * cannot count, and refusing on that would refuse exactly the case this whole
 * feature exists for. What is owed to the caller is the number, not a verdict.
 * @param {string} dir - the dsh package directory.
 * @param {string | null} version
 * @returns {PinInfo}
 */
function treePinning(dir, version) {
  if (version === null) return UNCHECKED
  // npm nests the siblings under the root package; every other layout hoists
  // them beside it, one level above the `node_modules` this package sits in.
  const bases = [dir]
  if (basename(dirname(dir)) === '@deepseek-ai' && basename(dirname(dirname(dir))) === 'node_modules') {
    bases.push(dirname(dirname(dirname(dir))))
  }
  for (const base of bases) {
    const report = verifyPinned(base, version)
    // One package found is the root package finding itself, which says nothing
    // about the layer this check exists for.
    if (report.checked <= 1) continue
    return { verified: true, pinned: report.ok, packages: report.checked, mixed: report.wrong.slice(0, 5) }
  }
  return UNCHECKED
}

/**
 * The archive an application keeps its code in, if this is such an application.
 * @param {string} root
 * @returns {string | null}
 */
function appArchive(root) {
  for (const relative of [join('resources', 'app.asar'), 'app.asar']) {
    const file = join(root, relative)
    if (existsSync(file)) return file
  }
  return null
}

/**
 * The interpreter shipped with an application.
 *
 * ⚠️ Windows only, and deliberately narrow: the executable at the root that is
 * not the uninstaller. Finding two candidates refuses and names both rather
 * than picking one, because launching the wrong executable here means opening a
 * second copy of somebody's desktop application instead of starting dsh.
 * @param {string} root
 * @param {string} platform
 * @returns {string}
 */
function appInterpreter(root, platform) {
  if (platform !== 'win32') {
    throw new BoxError('ENGINE_APP_PLATFORM', t('engine.appPlatform', { platform }), { path: root, platform })
  }
  let names
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
      .map((entry) => entry.name)
      .filter((name) => !/^unins/i.test(name))
  } catch {
    names = []
  }
  if (names.length !== 1) {
    throw new BoxError(
      'ENGINE_APP_NO_EXE',
      t('engine.appNoExe', { path: root, found: names.join('、') }),
      { path: root, found: names },
    )
  }
  return join(root, names[0])
}

/** Marks our own output, so noise the runtime prints is never parsed as data. */
const PROBE_MARK = '<<<DSHBOX-PROBE>>>'

/**
 * Ask an application's own interpreter what it is carrying.
 *
 * ⛔ The one subprocess on this path, and unavoidable: everything about a
 * packed tree — its version, its entry script, whether its packages agree — is
 * behind a filesystem only that interpreter has. It is asked once, and answers
 * every question at the same time, because the alternative is one launch of a
 * 100MB binary per question.
 * @param {string} exe
 * @param {string} archive
 * @returns {{version: string | null, entry: string | null, entryExists: boolean,
 * packages: number, mixed: {name: string, found: string | null}[], node: string}}
 */
function probeArchive(exe, archive) {
  const script = fileURLToPath(new URL('./asar-probe.cjs', import.meta.url))
  const result = spawnSync(exe, [script, archive, RELEASE_PREFIX], {
    // The switch that turns an Electron binary into a plain Node. It is theirs,
    // not a trick of ours: their own tooling runs this way.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  const stdout = result.stdout ?? ''
  const at = stdout.lastIndexOf(PROBE_MARK)
  if (at === -1) {
    throw new BoxError(
      'ENGINE_APP_UNREADABLE',
      t('engine.appUnreadable', { path: archive }),
      {
        exe,
        archive,
        status: result.status,
        // Whatever it said on the way down is the only thing that can explain
        // this, and "it did not answer" on its own cannot be acted on.
        stderr: String(result.stderr ?? '').trim().split('\n').slice(-10),
      },
    )
  }
  return JSON.parse(stdout.slice(at + PROBE_MARK.length))
}

/**
 * @typedef {object} PathEngine
 * @property {'tree' | 'app'} kind
 * @property {string | null} version
 * @property {string} dir - the folder that was named; the identity of this
 * machine as far as anything storing or displaying it is concerned.
 * @property {string} entry - the script to run.
 * @property {string} exec - the interpreter to run it with.
 * @property {Record<string, string>} execEnv - what that interpreter needs.
 * @property {PinInfo} pin
 */

/**
 * Resolve a folder someone named into an installation that can be launched.
 * @param {string} given - a folder, absolute or relative to the working dir.
 * @param {object} [options]
 * @param {string} [options.platform]
 * @returns {PathEngine}
 */
export function resolvePathEngine(given, { platform = process.platform } = {}) {
  const root = resolve(cleanPath(given))
  if (!existsSync(root)) {
    throw new BoxError('ENGINE_PATH_MISSING', t('engine.pathMissing', { path: root }), { path: root })
  }

  // Which interpreter, decided first and on its own: an application's add-ons
  // are compiled against the runtime it ships, so its tree is started with that
  // runtime whether the files sit in `app.asar.unpacked` or anywhere else.
  const archive = appArchive(root)
  const application = archive !== null
  const exec = application ? appInterpreter(root, platform) : process.execPath
  const execEnv = application ? { ELECTRON_RUN_AS_NODE: '1' } : {}

  // Where the tree is, decided second and always on the real filesystem —
  // including an application's unpacked resources, which is an ordinary folder.
  const found = findTree(root)
  if (found !== null) {
    const entry = entryScript(found.dir, /** @type {{bin?: string}} */ (found.pkg))
    if (entry === null || !existsSync(entry)) {
      throw new BoxError(
        'ENGINE_ENTRY_MISSING',
        t('engine.entryMissing', { path: found.dir }),
        { path: found.dir, entry },
      )
    }
    const version = typeof found.pkg.version === 'string' ? found.pkg.version : null
    return {
      kind: application ? 'app' : 'tree',
      version,
      dir: root,
      entry,
      exec,
      execEnv,
      pin: treePinning(found.dir, version),
    }
  }

  if (application) {
    // ⭐ Refused here rather than 120 seconds later. Starting this would build a
    // cabinet full of links into the archive, every one of them dead, and end
    // in a module-not-found naming a package instead of the reason.
    //
    // ⛔ Three outcomes, kept apart. The archive is opened only to make the
    // refusal specific, and what it says decides which refusal this is —
    // "sealed inside" is a claim about a dsh we have seen, so it is never said
    // on the strength of a probe that did not answer.
    const sealed = probeArchive(exec, archive)
    if (sealed.version === null && sealed.entry === null) {
      throw new BoxError('NO_DSH_IN_PATH', t('engine.noDshInApp', { path: root }), { path: root, archive })
    }
    throw new BoxError(
      'ENGINE_INSIDE_ARCHIVE',
      t('engine.insideArchive', {
        path: root,
        version: sealed.version ?? t('engine.versionUnreadable'),
        packages: sealed.packages,
      }),
      { path: root, archive, version: sealed.version, packages: sealed.packages, node: sealed.node },
    )
  }
  throw new BoxError('NO_DSH_IN_PATH', t('engine.noDshInPath', { path: root }), { path: root, depth: MAX_DEPTH })
}
