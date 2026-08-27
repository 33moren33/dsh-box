/**
 * Putting this program's folder on the user's PATH, and taking it off again.
 *
 * ⛔⛔ This is the only place in the tool that writes something the whole
 * computer reads. Everything else it owns lives inside one data directory and
 * the worst a mistake can do is spoil that directory; a mistake here can cost
 * somebody every other program they reach by name. So the rules are stricter
 * than anywhere else in the codebase:
 *
 *   - the value is read and written through the registry API, never rebuilt
 *     from `process.env.PATH` — that one is the machine's and the user's
 *     merged together and already expanded, and writing it back would move
 *     machine-wide entries into the user's own list;
 *   - the value crosses the process boundary as base64, never as text. Two
 *     traps are closed by that one choice: a console code page that mangles
 *     any non-ASCII folder name on the way out, and the quoting rule that eats
 *     the closing quote when a value ends in a backslash — which half the
 *     entries on a real PATH do;
 *   - the kind is preserved. A `REG_EXPAND_SZ` rewritten as `REG_SZ` looks
 *     identical in every viewer and silently stops expanding `%VAR%` for every
 *     program that comes after us;
 *   - what was there is written to a file before anything changes;
 *   - and the result is read back and compared character for character. Only
 *     that comparison can tell a successful write from a truncated one.
 *
 * ⭐ And one rule about scope: we add our own directory and remove our own
 * directory. Tidying up somebody's duplicated entries, however tempting the
 * sight of nine copies of the same folder is, is not a launcher's business.
 * `status` says what it sees and changes nothing.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { BoxError } from './errors.js'
import { t } from './messages.js'

/** The names this program can be called by, for spotting it in a folder. */
const OUR_EXE = ['dsh-box.exe', 'dsh-box-shell.exe']

/**
 * The folder holding the exe that started this run, or null.
 *
 * ⭐ Handed down by the desktop shell rather than worked out here, because
 * `cli.js` genuinely cannot know: it is a script, and the same script runs
 * from inside an npm package where there is no exe and PATH is npm's business,
 * not ours.
 * @returns {string | null}
 */
export function exeDir() {
  const exe = process.env.DSH_BOX_EXE
  if (typeof exe !== 'string' || exe === '') return null
  const dir = resolve(exe, '..')
  return existsSync(dir) ? dir : null
}

/**
 * Split a PATH value the way Windows does.
 * @param {string} value
 * @returns {string[]}
 */
export function entriesOf(value) {
  return value.split(';').filter((entry) => entry.trim() !== '')
}

/**
 * Whether two PATH entries name the same folder.
 *
 * Case-insensitive and blind to a trailing separator, because Windows is:
 * `C:\Tools` and `c:\tools\` are one entry wearing two spellings, and adding
 * the second when the first is already there is how a PATH grows nine copies
 * of the same folder.
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function sameEntry(left, right) {
  const plain = (text) => text.trim().replace(/[\\/]+$/, '').toLowerCase()
  return plain(left) === plain(right)
}

/**
 * Run a short PowerShell script and hand back what it printed.
 *
 * PowerShell rather than `reg.exe` for one reason: the registry API it can
 * reach reads and writes the value as text, while `reg.exe` prints it through
 * the console code page, and a PATH containing any non-ASCII folder name would
 * come back mangled — after which writing it "unchanged" would corrupt it.
 * @param {string} script
 * @returns {string}
 */
function powershell(script) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.error !== undefined) {
    throw new BoxError('PATH_NO_POWERSHELL', t('path.noPowershell', { why: result.error.message }))
  }
  if (result.status !== 0) {
    throw new BoxError('PATH_REGISTRY_REFUSED', t('path.registryRefused', {
      why: String(result.stderr || result.stdout).trim(),
    }))
  }
  return String(result.stdout ?? '').trim()
}

/**
 * The user's own PATH, exactly as stored.
 *
 * ⚠️ The user's, not the process's. `process.env.PATH` is this machine's list
 * and this user's list already joined and expanded; writing that back would
 * copy every machine-wide entry into the user's registry, where an
 * administrator changing one later would no longer reach this user.
 * @returns {{value: string, kind: string}}
 */
export function readUserPath() {
  const answer = powershell([
    "$ErrorActionPreference='Stop'",
    "$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')",
    "$value=$key.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
    // No Path of one's own is a real state, not an error: a fresh account has
    // an empty user list and everything it reaches comes from the machine.
    "if ($null -eq $value) { $value=''; $kind='ExpandString' } else { $kind=[string]$key.GetValueKind('Path') }",
    "Write-Output ($kind + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value)))",
  ].join('; '))
  const [kind, encoded = ''] = answer.split(' ')
  return {
    value: Buffer.from(encoded, 'base64').toString('utf8'),
    kind: kind === 'String' ? 'String' : 'ExpandString',
  }
}

/**
 * Replace the user's PATH, then prove it took.
 *
 * ⭐ The read-back is the whole point of this function existing rather than
 * being three lines at the call site. "It returned success" is not evidence
 * that a value survived: truncation at a length limit and a silently changed
 * kind both report success. Only reading it back and comparing does.
 * @param {string} value - the complete new PATH.
 * @param {string} kind - `ExpandString` or `String`, as it was.
 */
export function writeUserPath(value, kind) {
  const encoded = Buffer.from(value, 'utf8').toString('base64')
  // Refused, never trimmed. A PATH this long is somebody's whole working
  // setup, and the one outcome worse than not adding our folder is handing
  // back a shorter list than we were given.
  if (encoded.length > 30_000) {
    throw new BoxError('PATH_TOO_LONG', t('path.tooLong', { length: value.length }), { length: value.length })
  }
  powershell([
    "$ErrorActionPreference='Stop'",
    `$value=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true)",
    `$key.SetValue('Path',$value,[Microsoft.Win32.RegistryValueKind]::${kind === 'String' ? 'String' : 'ExpandString'})`,
  ].join('; '))

  const now = readUserPath()
  if (now.value !== value) {
    throw new BoxError('PATH_WRITE_MISMATCH', t('path.mismatch', {
      wrote: value.length, read: now.value.length,
    }), { wrote: value.length, read: now.value.length })
  }
  if (now.kind !== kind) {
    throw new BoxError('PATH_KIND_CHANGED', t('path.kindChanged', { was: kind, now: now.kind }))
  }
}

/**
 * Tell the rest of the computer that the environment changed.
 *
 * Without this the new PATH is only seen by programs started after the next
 * sign-in: every terminal is a child of a shell that read the environment once
 * and keeps it. The broadcast is what makes a newly opened terminal — and only
 * a newly opened one — find the command. Failure here is not worth stopping
 * for; the write already happened and the worst case is that it takes effect
 * later than it could have.
 * @returns {boolean} whether the broadcast went out.
 */
export function announceEnvChange() {
  try {
    powershell([
      "$ErrorActionPreference='Stop'",
      "Add-Type -Namespace DshBox -Name Env -MemberDefinition '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'",
      '$answer=[UIntPtr]::Zero',
      // HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, five seconds.
      "[DshBox.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$answer) | Out-Null",
    ].join('; '))
    return true
  } catch {
    return false
  }
}

/**
 * Which folders on the user's PATH hold a copy of this program.
 *
 * Answers the question a person actually has — "how many of these things are
 * on my PATH and which one wins?" — by looking for the file rather than by
 * matching folder names, so a renamed folder still counts and a folder called
 * `dsh-box` that holds something else does not.
 * @param {string[]} entries
 * @returns {{dir: string, exe: string}[]}
 */
export function copiesOn(entries) {
  const found = []
  for (const entry of entries) {
    for (const name of OUR_EXE) {
      const candidate = join(entry.trim(), name)
      if (existsSync(candidate)) {
        found.push({ dir: entry.trim(), exe: name })
        break
      }
    }
  }
  return found
}
