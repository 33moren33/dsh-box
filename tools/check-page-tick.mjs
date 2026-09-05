/**
 * 整页刷新画了、每两秒的轮询漏了 —— 这道缝要自己报出来。
 *
 * 判例:命令行下载好一个版本,窗口里那一块**永远显示「未下载」**,直到人碰点
 * 什么触发一次整页刷新。`refresh()` 画六样,轮询只画五样,漏的正是版本列表。
 * 漏的原因不是粗心:那次加轮询的题目是「窗口看得见别人的**下载进度**」,于是
 * 加了 `drawDownload`,而**「已下载列表」也属于别的入口会改的东西**这件事没被
 * 想起来。
 *
 * ⭐ 这正是本仓反复吃亏的那个形状:**要靠每次记得的规则,迟早漏掉下一个**。
 * 所以判断放进这唯一的漏斗里 —— 往 `refresh()` 里加一块新画面的人,要么让它
 * 也进轮询,要么在下面写明为什么不用进。新画面白白继承这道题。
 *
 * ⛔ 它保证不了「画得对不对」,只保证「别的入口改了状态,这块画面会不会自己
 * 跟上」。画得对不对至今只有人眼看得出来 —— 那是这个仓最大的盲区,不是这道
 * 守卫能补的。
 *
 * 用法:
 *   node tools/check-page-tick.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = join(HERE, '..', 'src', 'ui', 'index.html')

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

/**
 * 整页刷新画了、而轮询**故意**不画的那些,以及为什么。
 *
 * ⛔ 写理由不是形式:它是下一个人判断「我这块该不该进轮询」的唯一依据。
 * 判据是一句话 —— **别的入口改得动这块画面背后的状态吗?**改得动就得进轮询,
 * 改不动才留在这里。
 */
const TICK_EXEMPT = {
  drawStartButton: '它只跟着 workspace 这个变量走,而轮询从不改那个变量;'
    + '它背后没有任何别的入口改得动的状态。',
}

const page = readFileSync(PAGE, 'utf8')

/**
 * 抠出一段花括号包起来的函数体,从给定的锚点往后数括号。
 *
 * ⚠️ 不用正则一把梭:函数体里有对象字面量、模板串和注释,靠正则数括号会在
 * 第一个 `}` 上停下,而那种失败是**安静**的 —— 抠到半截,后面的 `draw*` 一个
 * 都看不见,守卫于是永远通过。宁可在找不到锚点时当场报错。
 * @param {string} source
 * @param {string} anchor
 * @returns {string}
 */
function bodyAfter(source, anchor) {
  const at = source.indexOf(anchor)
  if (at === -1) throw new Error(`页面里找不到锚点:${anchor}`)
  const open = source.indexOf('{', at)
  if (open === -1) throw new Error(`锚点后面没有花括号:${anchor}`)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`锚点的花括号没有配对:${anchor}`)
}

/**
 * 一段代码里调用了哪些 `drawX()`。
 *
 * ⛔ 只认真正的调用,不认注释里提到的名字 —— 轮询那一段的注释里就写着
 * `drawVersions`,而它曾经**只**出现在注释里。一个把注释算成调用的守卫,正好
 * 会在这个 bug 上给出绿灯。
 * @param {string} code
 * @returns {Set<string>}
 */
function drawCalls(code) {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1')
  return new Set([...stripped.matchAll(/\b(draw[A-Z]\w*)\s*\(/g)].map((hit) => hit[1]))
}

console.log('\n整页刷新画的东西,轮询要么也画,要么说清为什么不画\n')

const refresh = drawCalls(bodyAfter(page, 'async function refresh('))
const tick = drawCalls(bodyAfter(page, 'const polling = setInterval('))

check('页面里抠得出 refresh() 与那段轮询', refresh.size > 0 && tick.size > 0,
  `refresh ${refresh.size} 块 / 轮询 ${tick.size} 块`)

for (const name of [...refresh].sort()) {
  if (tick.has(name)) {
    check(`${name} 进了轮询`, true)
    continue
  }
  const why = TICK_EXEMPT[name]
  check(`${name} 没进轮询,但说清了为什么`, typeof why === 'string' && why.length > 0,
    why === undefined ? '还没决定:别的入口改得动它背后的状态吗?改得动就该进轮询' : '')
}

// 反过来也查一次:免掉的那几条得真的还在页面上。名字改过之后留在表里的豁免,
// 会让一块新画面顶着旧名字白白拿到通行证。
for (const name of Object.keys(TICK_EXEMPT)) {
  check(`豁免表里的 ${name} 还在 refresh() 里`, refresh.has(name),
    refresh.has(name) ? '' : '页面上已经没有它了,这条豁免该删掉')
}

// 轮询里出现、而整页刷新里没有的,同样是接缝:两条路画的不是同一批东西。
for (const name of [...tick].sort()) {
  check(`${name} 也在整页刷新里`, refresh.has(name),
    refresh.has(name) ? '' : '只有轮询画它,人点一下反而看不到最新的')
}

/**
 * 「上一次操作的结果」显示在哪儿 —— 这些格子里的话是有保质期的。
 *
 * ⭐⭐ 判词:**结果提示是有保质期的断言,状态一变就不再成立。** 判例(2026-08-30):
 * 沙箱停掉之后按钮已经变回「启动沙箱」,而下面那条绿色横幅仍写着「已启动」并挂着
 * 一个可点的地址 —— 那个地址此刻没人在听。⛔ 过期的真话比错话更难识破:它当时
 * 确实是对的。
 *
 * ⛔ 这一条为什么不在上面那道题里:上面查的是**控件**跟不跟状态,而那次控件是
 * 对的,错的是横幅。两道题形状相同、盯的东西不同,所以并排放着。
 */
const RESULT_BANNERS = ['startOut']

console.log('')
for (const id of RESULT_BANNERS) {
  // 在哪个 draw* 里被作废的?那个 draw* 必须也在轮询里,否则「别的入口停掉了它」
  // 这件事要等人点一下才看得见 —— 而那正是判例本身。
  // ⛔⛔ 必须钉住「被清空的是**这个**元素」。这道守卫的第一版写成「函数体里出现过
  //    这个 id,而且出现过 innerHTML = ''」,于是被同一个函数体里另一句清空运行列表
  //    的 `host.innerHTML = ''` 骗过 —— 我把产品那句删掉,它照样报通过。
  //    ⭐ 本仓的判词在这里又应验一次:**一道没被证明拦得住东西的守卫,和没有守卫
  //    是一回事**;写完守卫要故意破坏一次,看它红不红。
  const clearedIn = [...tick].filter((name) => {
    const body = bodyAfter(page, `function ${name}(`)
    // 要么直接清 `$('id').innerHTML = ''`,要么先绑给一个名字再清那个名字。
    const direct = new RegExp(`\\$\\('${id}'\\)\\s*\\.innerHTML\\s*=\\s*''`)
    if (direct.test(body)) return true
    const bound = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*\\$\\('${id}'\\)`).exec(body)
    return bound !== null && new RegExp(`\\b${bound[1]}\\s*\\.innerHTML\\s*=\\s*''`).test(body)
  })
  check(`结果横幅 ${id} 会被某个进了轮询的 draw* 作废`, clearedIn.length > 0,
    clearedIn.length > 0 ? clearedIn.join('、')
      : '没有任何进了轮询的 draw* 清得掉它:状态变了它还会挂在那儿')
}

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
