/**
 * 一个进程的身份 —— 进程号，加上它自己出生的那一刻。
 *
 * ⛔⛔ 为什么需要这个文件:**进程号不是身份**。号码会被系统回收,重启更是一次
 * 全部回收。一条 2026-08-21 写下的账本记着 6772,五天后 6772 已经是一个叫
 * LCD_Service 的显示服务;配置窗照样把那台沙箱画成「正在运行」并给出「停止」
 * 按钮,而那个按钮走 `taskkill /T /F`——会把那个服务连同它的子进程一起杀掉。
 *
 * ⭐ `(进程号, 启动时刻)` 这一对不是我们发明的启发式,**是操作系统自己认定进程
 * 身份的方式**:Windows 内部用 PID + CreationTime,Linux 用 PID + starttime,
 * 都是拿它区分被回收的号码。
 *
 * ⭐⭐ 用法上只有一条规矩,但它是全部:**启动那一刻把它记下来,动手之前再读一次,
 * 逐值相等才算同一个进程。**先前那一版是拿账本的写入时刻去和进程的出生时刻比
 * 大小,于是带着两个宽容度常数——那是在猜身份。相等比对没有常数可调。
 *
 * ⚠️ 有的平台答不出来(见下)。答不出来时两边都是 `null`,`null === null` 仍然
 * 成立——**降级成和从前一样,不会更糟**,而且降级这件事是写在账本里的,不是藏在
 * 判断里的。
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

/**
 * 这个进程号上的进程是什么时候起来的,毫秒时间戳;这台机器答不出来就是 null。
 *
 * ⛔ 返回值只该拿来做**相等比对**,不要拿去和别的时钟比大小:Linux 那一路是
 * 从开机时刻加运行滴答算出来的,与墙上时钟并非同一个量。
 * @param {number} pid
 * @returns {number | null}
 */
export function processStartedAt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === 'linux') return fromProc(pid)
  if (process.platform === 'win32') return fromPowershell(pid)
  // mac 与其余平台:没有便宜的问法。留 null,让相等比对自然降级。
  return null
}

/**
 * 两个身份是不是同一个。
 * @param {number | null | undefined} recorded - 账本里记下的那一刻。
 * @param {number | null} now - 此刻读到的那一刻。
 * @returns {boolean}
 */
export function sameProcess(recorded, now) {
  // ⛔ 记的时候没有这个字段,就是无从证明。不给它「大概是吧」这个选项。
  if (recorded === undefined) return false
  return (recorded ?? null) === now
}

/**
 * Linux:两个文件,不起子进程。
 * @param {number} pid
 * @returns {number | null}
 */
function fromProc(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // ⛔ 不能从左往右按空格切:第 2 个字段是括号里的可执行文件名,它自己可能
    // 含空格、也可能含括号。最后一个 `)` 是唯一可靠的地标。
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    // 第 22 个字段(从 1 数起);`rest` 是从第 3 个字段开始的。
    const ticks = Number(rest[19])
    const boot = /^btime (\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'))
    if (!Number.isFinite(ticks) || boot === null) return null
    // USER_HZ 在这个工具会跑到的每一台 Linux 上都是 100——它是内核常量,
    // 不是时钟的属性。
    return (Number(boot[1]) + ticks / 100) * 1000
  } catch {
    return null
  }
}

/**
 * Windows:一次短的 PowerShell 调用。
 *
 * ⚠️ 这是本文件唯一贵的一处(约几百毫秒),所以调用点要节制:只在**声称正在运行
 * 的那几行**上问,以及真要动手之前。Node 没有读别人进程启动时刻的接口。
 * @param {number} pid
 * @returns {number | null}
 */
function fromPowershell(pid) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().ToString('o') }`,
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return null
  const when = Date.parse(String(result.stdout ?? '').trim())
  return Number.isFinite(when) ? when : null
}
