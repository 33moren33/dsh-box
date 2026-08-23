/**
 * Times are the machine's own, and a stored one can still say which moment.
 *
 * ⛔ **This exists because `toISOString()` was used to render.** It always
 * answers in UTC; the code sliced the time out of it and printed it bare, so on
 * a machine at UTC+8 a download begun at 22:11 wrote `14:11` into its own
 * progress log and filed the launch log under `..._13-39-26_start.log`. A person
 * reading a log found it eight hours in the past, which is how it was caught —
 * 407 automated checks never look at what a timestamp *means*.
 *
 * ⭐ **The control group is REQUIRED to fail**: every rendering here must differ
 * from the UTC rendering of the same instant. On a machine actually set to UTC
 * there is nothing to tell apart, and this file says so out loud rather than
 * reporting a green it did not earn — a check that cannot fail is not evidence.
 *
 * ⛔ Touches no disk and no network: rendering a fixed instant is the whole of it.
 *
 * Usage: node tools/check-clock.mjs
 */

import { clockNow, dateNow, instantNow, showInstant, stampNow } from '../src/clock.js'

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n时间按这台机器的时区写,存下来的还说得出是哪一瞬\n')

// A fixed instant, so the assertions do not depend on when this is run.
const at = new Date('2026-08-23T14:11:06.276Z')
const offsetMinutes = -at.getTimezoneOffset()
const pad = (n, w = 2) => String(n).padStart(w, '0')

// ── 渲染跟着系统时区 ────────────────────────────────────────────────────────
check('时间是这台机器的钟,不是 UTC',
  clockNow(at) === `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
  clockNow(at))
check('文件名用的也是本机日期时间',
  stampNow(at) === `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + `_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`,
  stampNow(at))
check('沙箱名里的日期也是本机的那一天', dateNow(at)
  === `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`, dateNow(at))

// ── ⭐ 必输的对照组 ─────────────────────────────────────────────────────────
if (offsetMinutes === 0) {
  console.log('  跳过  ⚠ 这台机器就在 UTC,分不出本地和 UTC —— 对照组这次没法成立')
} else {
  const utcClock = at.toISOString().slice(11, 19)
  check('⭐⭐ 对照组:本机不在 UTC 时,渲染必须和 UTC 不一样',
    clockNow(at) !== utcClock, `本机 ${clockNow(at)} vs UTC ${utcClock}`)
  check('⭐ 对照组:文件名同理',
    stampNow(at) !== at.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-'),
    stampNow(at))
}

// ── 存下来的那一份仍然说得出是哪一瞬 ────────────────────────────────────────
const stored = instantNow(at)
check('⛔⛔ 存进记录的带偏移量 —— 换时区/夏令时之后还原得回来',
  /[+-]\d{2}:\d{2}$/.test(stored) || stored.endsWith('Z'), stored)
check('⛔⛔ 而且解析回去正好是同一瞬 —— 可读没有换来不准',
  new Date(stored).getTime() === at.getTime(), stored)
check('存的那个字符串本身就是墙上的钟,不用换算',
  stored.startsWith(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`), stored)

// ── 显示:新旧两种存法要在屏幕上对得齐 ──────────────────────────────────────
// ⭐ 盘里还躺着改之前写的 `…Z`,dsh 自己的表也一直是那种。两种都得渲染成本地。
check('⭐ 旧的 Z 记录和新的带偏移记录,显示出来是同一个时间',
  showInstant('2026-08-23T14:11:06.276Z') === showInstant(stored),
  `${showInstant('2026-08-23T14:11:06.276Z')} / ${showInstant(stored)}`)
check('显示的形状是给人读的', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(showInstant(stored)),
  showInstant(stored))
check('⚠️ 读不懂的原样奉还,不显示 Invalid Date',
  showInstant('人手改坏的') === '人手改坏的' && showInstant('') === '' && showInstant(null) === '')

// ── 文件名要按名字排序就等于按时间排序 ─────────────────────────────────────
// latestLog / prune / listBackups 都靠这条,所以它是个契约不是巧合。
const earlier = stampNow(new Date(at.getTime() - 3600_000))
check('⭐ 按名字排 ＝ 按时间排(latestLog / prune / listBackups 都靠这条)',
  earlier < stampNow(at), `${earlier} < ${stampNow(at)}`)

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项不通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
