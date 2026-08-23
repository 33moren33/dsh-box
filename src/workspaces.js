/**
 * The project folders a machine workspace has seen, and how to add one.
 *
 * ⚠️ **Two things are called a workspace, and they are not the same thing**
 * (CEO 2026-08-22). A *machine workspace* is a `DSH_HOME` — conversations,
 * settings, credentials — and it is what `--main` and `--sandbox` name. A
 * *project workspace* is the folder dsh actually works in, and dsh's own README
 * calls that one "workspace" too. They are not siblings: the machine workspace
 * holds a list of project workspaces it has been pointed at.
 *
 * ⛔ **Why this file exists at all**, measured rather than assumed:
 *   1. `dsh web` has no flag for it. That layer's whole flag family is
 *      `--host` / `--port` / `--trusted-host`, so the command line cannot say
 *      which project to open.
 *   2. dsh does **not** register the current directory by itself. Booting a
 *      fresh home leaves this list empty, so the person has to pick one in the
 *      browser — which is exactly what an agent cannot do.
 *   3. Writing one row here before boot makes dsh come up in that project,
 *      already selected. Verified on a real dsh, by eye.
 *
 * ⛔⛔ And the reason every write here is careful: a row dsh cannot parse takes
 * the whole program down. The first attempt left out `createdAt`/`updatedAt`
 * and dsh exited 1 with `invalid-record` before serving anything. **The shape
 * below is copied from dsh's own schema, not from a sample of somebody's
 * data** — a sample is only ever the fields that happened to be in view.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { BoxError } from './errors.js'
import { t } from './messages.js'
import { cleanPath } from './paths.js'

/**
 * The storage unit dsh writes this list into, and the version of its shape.
 *
 * ⛔ Checked before every write and never assumed. This is somebody else's file
 * in somebody else's format; when they change it, the honest move is to refuse
 * and say so, not to write the old shape into a new world.
 */
const UNIT = { name: 'workspace', version: 2 }

/** @param {string} home @returns {string} */
export function projectsFile(home) {
  return join(home, 'storages', 'workspace.json')
}

/**
 * @typedef {object} ProjectList
 * @property {{id: string, path: string, title: string, sessions: number, current: boolean}[]} projects
 * @property {string} file
 * @property {boolean} exists
 */

/**
 * What project folders this machine workspace knows, in dsh's own order.
 *
 * The first is the one dsh opens, which is why order is a fact worth reporting
 * rather than an implementation detail.
 * @param {string} home
 * @returns {ProjectList}
 */
export function listProjects(home) {
  const file = projectsFile(home)
  const raw = read(file)
  if (raw === null) return { projects: [], file, exists: false }
  const table = raw.tables?.workspaces ?? {}
  const order = Array.isArray(raw.global?.workspaceIds) ? raw.global.workspaceIds : []
  // dsh's own order, with anything the order forgot appended rather than
  // dropped: a row missing from the order is dsh's business to reconcile, and
  // hiding it here would make this list disagree with the file it read.
  const ids = [...order.filter((id) => id in table), ...Object.keys(table).filter((id) => !order.includes(id))]
  return {
    file,
    exists: true,
    projects: ids.map((id, index) => ({
      id,
      path: table[id].path,
      title: table[id].title,
      sessions: (table[id].sessionIds ?? []).length,
      current: index === 0,
    })),
  }
}

/**
 * Add a project folder, or move one that is already there to the front.
 *
 * ⛔ Only ever adds and reorders. Deleting a row would orphan the conversations
 * accounted under it, and dsh has its own rules about that — rules this tool
 * has not read and has no business guessing at.
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.path - the project folder.
 * @param {string} [options.title]
 * @param {boolean} [options.front] - put it first, so dsh opens it.
 * @returns {{id: string, path: string, title: string, added: boolean, moved: boolean, file: string}}
 */
export function addProject({ home, path, title, front = true }) {
  const file = projectsFile(home)
  const dir = resolve(cleanPath(path))
  if (!existsSync(dir)) {
    throw new BoxError('DIR_NOT_FOUND', t('workspaces.dirNotFound', { dir }), { path: dir })
  }
  const raw = read(file) ?? fresh()
  checkUnit(raw, file)
  const table = raw.tables.workspaces
  const order = raw.global.workspaceIds
  const same = (value) => resolve(cleanPath(String(value ?? ''))).toLowerCase() === dir.toLowerCase()
  const existing = Object.keys(table).find((id) => same(table[id].path))
  const now = new Date().toISOString()

  const id = existing ?? randomUUID()
  if (existing === undefined) {
    table[id] = { path: dir, title: title ?? dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir, sessionIds: [], createdAt: now, updatedAt: now }
  } else if (title !== undefined && table[id].title !== title) {
    table[id] = { ...table[id], title, updatedAt: now }
  }
  const was = order.indexOf(id)
  const moved = front && was !== 0
  const rest = order.filter((one) => one !== id)
  raw.global.workspaceIds = front ? [id, ...rest] : [...rest, id]
  raw.global.initialized = true

  write(file, raw)
  return { id, path: dir, title: table[id].title, added: existing === undefined, moved, file }
}

/** An empty list in the shape dsh writes when it makes one itself. */
function fresh() {
  return {
    unit: { ...UNIT },
    global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
    tables: { workspaces: {} },
  }
}

/**
 * Refuse a file whose shape is not the one this was written against.
 *
 * ⛔ The version is dsh's promise about the fields, so writing our shape into a
 * file that no longer claims it is how a plugin list gets replaced by something
 * that boots to `invalid-record`. Refusing is recoverable; writing is not.
 * @param {Record<string, any>} raw
 * @param {string} file
 */
function checkUnit(raw, file) {
  const found = raw.unit ?? {}
  if (found.name !== UNIT.name || found.version !== UNIT.version) {
    throw new BoxError(
      'PROJECT_LIST_UNKNOWN',
      t('workspaces.unknownVersion', {
        file, name: found.name ?? '?', version: found.version ?? '?',
        wantName: UNIT.name, wantVersion: UNIT.version,
      }),
      { file, found, expected: UNIT },
    )
  }
}

/**
 * @param {string} file
 * @returns {Record<string, any> | null}
 */
function read(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    // Same rule as everywhere else here: what cannot be read is not overwritten.
    throw new BoxError(
      'PROJECT_LIST_UNREADABLE',
      t('workspaces.unreadable', { file, error: error.message }),
      { file },
    )
  }
}

/**
 * Write by another name, then take the name over.
 *
 * ⛔ Doubly so here, because a half-written file is not a degraded experience:
 * dsh fails loud on a row it cannot parse and does not start at all.
 * @param {string} file
 * @param {Record<string, any>} data
 */
function write(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}
