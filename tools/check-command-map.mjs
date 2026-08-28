/**
 * 44 条瘦成 10 条:每一条旧能力,要么有新去处,要么写明为什么删得掉。
 *
 * ⭐⭐ 这份文件是那次改造的**契约**,而且是一份能跑的契约 —— 本仓吃过亏:只给
 * 文字规范,几个人各猜一套,最后全返工。下面这张表是数据不是散文,守卫拿它跟
 * 真正的 `COMMANDS` 对表,漏一条、多一条、或者冒出一个没申报的新动词,当场变红。
 *
 * ## 为什么要瘦
 *
 * ⛔ 不是「命令多不好看」。是一个**没有读过我们任何文档的 agent** 拿 `--help`
 * 上手之后报回来的:它分不清 `plugins rm` / `plugins uninstall` /
 * `plugins disable`,也数出四个不同的「删」(`drop` 删版本、`rm` 删沙箱、
 * `packages rm` 删包体、`plugins rm` 全局注销)。**四个动词之所以存在,是因为我们
 * 内部有四层存储**,于是调用方得先学会我们的内部模型才动得了手。
 *
 * ⭐⭐ 判词:**真正让接口变深的是删掉对象,不是合并动词。** `rm 版本` /
 * `rm 沙箱` / `rm 包体` 收成一个 `rm <对象>`,表短了,而调用方要背的东西一个字
 * 没少 —— `rm` 的说明会长出四节。所以下面先删了四个**我们自己造出来的对象**
 * (登记表 / 包体仓 / 备份堆 / PATH),再谈动词。
 *
 * ## 参照系
 *
 * MathWorks 的 Simulink Agentic Toolkit:**7 个工具 + 25 个 skill**,能力与知识
 * 分开发。我们是 44 条命令 + 0 个 skill,而那 25 个 skill 的内容全塞在 `notes`
 * 里(占 `--help --json` 的 49%)。它的判据:**已有 API 能表达的只补纪律不补工具,
 * 只有需要「重新组织返回形状」的才建工具。**用它量我们这张表,结论与「删对象」
 * 撞在一处 —— 两条不同的路走到同一个答案。
 *
 * ⛔ 别把重心放在省 token:那是手段。目的是防幻觉、防错过新功能、防 agent 在
 * 老手会跳过的弯路上浪费时间。
 *
 * 用法:
 *   node tools/check-command-map.mjs
 */

import { readFileSync } from 'node:fs'
import { COMMANDS } from '../src/commands.js'

/**
 * 瘦身之后允许存在的动词,十个。
 *
 * ⛔ 加第十一个不是不行,但必须是一次明说的裁决 —— 这条上限存在的全部意义,
 * 就是让「再加一条也没什么」这件事变得必须被人看见。
 */
const VERBS = ['ls', 'get', 'rm', 'start', 'stop', 'set', 'logs', 'ui', 'agent', 'help']

/**
 * 日常档案柜在新形状里叫 `main`,而沙箱不许再叫这个名字(src/paths.js 的 DAILY_CABINET)。
 *
 * ⛔⛔ 这不是取名品味,是**命名空间**问题,而它只有在瘦身时才第一次出现。今天
 * 「哪个柜子」是两个旗标(--main / --sandbox <名>),所以那是个二选一;新形状把柜子
 * 变成一个**值**(--in <档案柜>),日常柜从此要和沙箱共用同一个命名空间 —— 而那个
 * 空间当时是敞开的:实测 main、MAIN、Main、main.1 全是合法沙箱名,保留名单里只有
 * Windows 设备名。
 *
 * ⛔⛔ 先定的是 `~`,理由是「靠构造防撞」——沙箱名字符集不含 ~。**同一小时被实测
 * 推翻**:bash 与 PowerShell 都会把裸写的 ~ 展开成家目录,于是 --in ~ 到达时已经是
 * --in C:/Users/moreno。⭐⭐ 要命的不是它会错,是它**错成一个真实存在、看着完全合理
 * 的目录路径**,不报错,而且发生在整个界面里出现最频繁的那个值上。
 * (CEO 一句「多平台是否兼容,cmd/PowerShell 是否会截断」问出来的。)
 *
 * 三种 shell 都活得下来的符号有 @ : + #,但都被否掉:这个工具的参数里满是 npm scope,
 * `--in @` 挨着 `@linxin666/dsh-pet`,一个字符两个意思。
 * ⭐ 最后选 main:三种 shell 零风险、自解释、与旧 --main 连贯,代价只是占一个保留名 ——
 * 而实测机器上现有沙箱是 box-20260827-1 与 试验台,今天代价为零。
 */
const DAILY = 'main'

/**
 * 旧的每一条,去哪儿了。
 *
 * `to`   —— 新形状。**它是给下一任照着实现的,所以写完整的一行,别写「同上」。**
 * `drop` —— 这条能力整个不要了,后面是**为什么它可以不存在**,不是「用不上」。
 * `open` —— 还没定的地方。⭐ 悬而未决必须是**数据**,不能只活在某段散文里:
 *           写在这儿,守卫会把它们列出来,下一任一眼看得见还欠几个裁决。
 * `before`/`done` —— ⛔⛔ **动这条之前必须先落地的事**,以及它做完没有。删掉的那些是
 *           「这件事得先自动发生」;改名的那些是「谁还在按旧名字调它」。
 *           这一栏就是刀 0。它必须是数据而不是册子里的一张表,理由是它被违反时
 *           **没有任何东西会红**:命令删了、验收全绿、而用户那边多了一堆没人收拾
 *           的垃圾,或者少了一个本来自动发生的动作。
 *           ⭐ 判例(2026-08-28,派人核查才发现的):`path add`/`path rm` 读起来像
 *           「给人敲的命令」,实际上 `installer.nsh` 装和卸的时候就在敲它们 ——
 *           **删了它们,安装器当场变成 UNKNOWN_COMMAND,而且是静默的。**
 */
/**
 * 新形状做得到、而旧形状要人自己拼出来的那几件。
 *
 * ⛔ 这一栏不是「顺手加的功能」。它存在是因为**瘦身的代价必须被写下来**:上面那张
 * 表只保证「旧的每一条都有去处」,保证不了「新的十条合起来还盖得住原来的场景」。
 * 一条要敲三次、每次换个旗标才做得完的事,在旧表里是「做得到」,在用的人眼里是
 * 「这工具没有这个功能」。
 *
 * ⭐⭐ CEO 08-28 的原话是判据本身:「依旧需要覆盖面板所有功能,而且还能做日常档案
 * 柜插件配置进沙箱的操作(面板目前是沙箱进日常档案馆仅单向),尽量组合现在 10 条
 * 命令来实现」。⭐ 关键词是**组合**:不许为它长出第 11 个动词,也不许长出新对象。
 */
const COMPOSED = {
  'get plugin [<id>] --from <档案柜> --to <档案柜>': {
    why: '把一个档案柜的插件配置搬到另一个,**两个方向同一条命令,只换旗标**。'
      + '给了 id 就搬那一个,不给就搬 --from 那一柜的全部 —— 位置参数可选,'
      + '所以「搬单个」和「整柜复刻」不是两条命令,是同一条的两种读法。',
    was: '旧形状里两个方向都做得到,但要人自己拼:先 plugins --main 看日常柜有什么,'
      + '再对每一个敲一次 plugins install <id> --sandbox X。⭐ 而「叫得出名字」这件事'
      + '当时靠的是登记表 —— 所以删登记表那一刀必须连着这一条做,'
      + '名单改成从各档案柜推导之后,日常柜有什么就叫得出什么。',
    // ⭐ 面板那半边不必同时做完,但必须**写下来它只做了哪一半** ——
    //   check-page-marks.mjs 的 cliOnly 就是这件事的现成机制,adopt 已经这么记着了。
    panel: '面板今天固定「这台沙箱 → 日常档案柜」单向(check-page-marks.mjs 的 adopt.from '
      + '已记为 cliOnly)。新形状里反向不需要新命令,面板补一个方向开关即可。',
    // ✅ 2026-08-28 落地。⛔ 记在这里而不是「做完了删掉」:一条补回来的场景没有
    //   守卫盯着,和没补是一回事 —— 而这条的守卫是 tools/check-cabinet-copy.mjs,
    //   它验的正是「不给 id 就整柜」「反方向只是换两个值」「三个插件仍然只吐一行
    //   JSON」这三件当初拍板时说出口的话。
    done: 'tools/check-cabinet-copy.mjs',
  },
}


/**
 * 刀 2 的目标表:每一条留下来的命令,**新键名叫什么、吃哪些旗标**。
 *
 * ⭐⭐ 这一栏是给**并行改造**用的地基(CEO 2026-08-28:「如果是机器重复工作,
 * 只要你地基搭好了你可以并行派 agent 处理」)。本仓吃过的亏是:只给文字规范,
 * 几个人各猜一套,最后全返工。所以这里不是规范,是**守卫拿去对表的数据** ——
 * commands.js 改完之后跟这张表对不上,当场红,不必等谁去读别人的 diff。
 *
 * 三个旗标替掉旧的那根「二选一」轴(--main / --sandbox):
 *   --in <档案柜>    在哪个柜子里看 / 改
 *   --to <档案柜>    拿进哪个柜子
 *   --from <档案柜>  从哪个柜子拿走 / 拿来
 * 值是一个沙箱名,或者日常柜的名字 `main`(见 src/paths.js 的 DAILY_CABINET)。
 */
const SHAPE = {
  // —— ls:看。不给对象就是今天的 status 那张全景
  status: { key: 'ls', booleans: [], values: [] },
  versions: { key: 'ls.machine', booleans: [], values: [] },
  plugins: { key: 'ls.plugin', booleans: [], values: ['in'] },
  sandboxes: { key: 'ls.sandbox', booleans: [], values: [] },
  workspaces: { key: 'ls.workspace', booleans: [], values: ['in'] },
  history: { key: 'ls.history', booleans: ['shape'], values: ['lines'] },
  memory: { key: 'ls.memory', booleans: [], values: [] },
  // ⭐ 两条旧命令合成一格:config 看设置,path 看这一份在不在 PATH 上 ——
  //   而 PATH 从此就是一个设置(set path on|off),所以它本来就该在同一张表里。
  config: { key: 'ls.setting', booleans: [], values: [] },
  path: { key: 'ls.setting', booleans: [], values: [] },

  // —— get:拿进来
  pull: { key: 'get.machine', booleans: [], values: [] },
  'plugins.install': { key: 'get.plugin', booleans: [], values: ['to', 'from', 'id'] },
  signin: { key: 'get.signin', booleans: [], values: ['to'] },
  adopt: { key: 'get.chat', booleans: ['force'], values: ['from', 'to'] },

  // —— rm:拿走
  drop: { key: 'rm.machine', booleans: [], values: [] },
  // ⛔⛔ `--approved` 从这张表里消失了(CEO 2026-08-28「不留这个参数的后门」)。
  //   同意不再是一个可以打出来的词:命令行撞上闸门会**弹出面板**并等人点头,
  //   点头之后由面板自己把这条命令跑掉。判据见 src/approval.js。
  'plugins.uninstall': { key: 'rm.plugin', booleans: [], values: ['from'] },
  rm: { key: 'rm.sandbox', booleans: [], values: [] },
  signout: { key: 'rm.signin', booleans: [], values: ['from'] },
  'config.reset': { key: 'rm.setting', booleans: [], values: [] },

  // —— start / stop
  start: {
    key: 'start',
    booleans: ['new', 'no-sign-in', 'sign-in', 'sign-out', 'follow'],
    values: ['version', 'plugin', 'unplug'],
  },
  // ⭐ 四种「停」收进一条,靠的是它们停的东西不同而不是名字不同:
  //   stop <沙箱>  一台  ／ --all 全部(旧 quit) ／ --window 配置窗(旧 ui stop)
  //   --download 正在下的那个包(旧 packages cancel)
  stop: { key: 'stop', booleans: ['all', 'window', 'download'], values: [] },
  quit: { key: 'stop', booleans: ['all', 'window', 'download'], values: [] },
  'ui.stop': { key: 'stop', booleans: ['all', 'window', 'download'], values: [] },
  'packages.cancel': { key: 'stop', booleans: ['all', 'window', 'download'], values: [] },

  // —— set:改状态
  'plugins.disable': { key: 'set.plugin', booleans: ['undo'], values: ['in'] },
  'plugins.enable': { key: 'set.plugin', booleans: ['undo'], values: ['in'] },
  'plugins.restore': { key: 'set.plugin', booleans: ['undo'], values: ['in', 'at'] },
  'workspaces.use': { key: 'set.workspace', booleans: [], values: ['in', 'title'] },
  'config.source': { key: 'set.source', booleans: [], values: [] },
  'config.lang': { key: 'set.lang', booleans: [], values: [] },
  'config.ask-on-quit': { key: 'set.ask-on-quit', booleans: [], values: [] },
  'config.ask-on-daily': { key: 'set.ask-on-daily', booleans: [], values: [] },
  // ⛔ 改的是这台电脑不是这个数据目录,但它确实是个开关,而且**便携包的用户
  //   要自己敲一次**(README:140) —— 所以它是真·用户命令,归 set。
  'path.add': { key: 'set.path', booleans: ['force'], values: [] },
  'path.rm': { key: 'set.path', booleans: ['force'], values: [] },

  // —— 剩下三个动词
  logs: { key: 'logs', booleans: ['shape', 'errors', 'all'], values: ['lines', 'version', 'package'] },
  ui: { key: 'ui', booleans: ['no-open'], values: ['port'] },
  attach: { key: 'agent.attach', booleans: [], values: [] },
  detach: { key: 'agent.detach', booleans: ['forced'], values: [] },
}

const MAP = {
  // —— 版本
  versions: { to: 'ls release' },
  pull: { to: 'get release <版本号>' },
  drop: { to: 'rm release <版本号>' },

  // —— 沙箱(档案柜)
  sandboxes: { to: 'ls sandbox' },
  start: { to: 'start <档案柜> [--version …] [--plugin …] [--unplug …] [--no-sign-in] [--follow]' },
  stop: { to: 'stop <沙箱>' },
  rm: { to: 'rm sandbox <名>' },
  quit: { to: 'stop --all' },

  // —— 插件。⭐ 这一族是瘦身的主战场:今天六条,新形状三条。
  plugins: { to: 'ls plugin [--in <档案柜>]' },
  // ⭐⭐ 旧形状用 --main / --sandbox 说「装到哪儿」,新形状用 --to。看着只是换了个
  //    旗标名,实际上是**方向从一个功能退化成一个参数**:旧的 install 每多一个方向
  //    就要面板多接一根线,新的只是 --to 后面写哪个柜子。CEO 08-28 那句「面板目前
  //    是沙箱进日常档案馆仅单向」指的就是这个,而它在新形状里不需要被「实现」。
  'plugins.install': { to: 'get plugin <包名|目录> --to <档案柜>' },
  'plugins.uninstall': {
    to: 'rm plugin <id> --from <档案柜>',
    // ⭐⭐ CEO 2026-08-28,理由是「未来给 dsh-lab 用,所以需要完善 box 整体能力」。
    before: '⛔ 今天对「不是我们装的」那些直接报 NOT_OURS,而**真实的日常档案柜里几乎'
      + '没有一样东西是我们装的**(实测 CEO 的柜子:ours 0 条、theirs 3 条)。'
      + 'CEO 08-28 定的新边界,两层要分开:'
      + '①**配置层**(patch 里那一行 ＋ node_modules 里那根链接)—— ours 和 theirs 都删得;'
      + '②**文件层**(磁盘上的包体)—— ⛔ 只删我们自己装的那份,别人的文件夹一个字节都不动。'
      + '⚠️ 还有一条来自刀 6(b2c3b4b)的物理约束:能不能删掉那一行取决于它写在哪一层 ——'
      + 'profilePatch/homePatch 的行删得掉,**bundle 带进来的删不掉**(那个格式里没有 remove,'
      + '下层只能被上层盖掉),对它们只能写 disabled: true。cabinetInventory 每行都带 source,'
      + '照它分流即可。',
    done: false,
  },
  // ⭐ 它不是「拿走」,是把某一行关掉 —— 那一行可能根本不是我们写进去的,
  //   拿走它就越界了。所以归 set,语义是改状态,不是移除。
  'plugins.disable': { to: 'set plugin <id> off --in <档案柜>' },
  'plugins.enable': { to: 'set plugin <id> on --in <档案柜>' },
  // ⛔ 登记表这一层整个删掉。它存在的唯一理由是给窗口一张短名单,而那张名单
  //   **推得出来**:装在任何档案柜里的 ＋ 我们下载过的。一个只为界面存在的
  //   存储层,是本表里最典型的「我们自己造的对象」。
  'plugins.add': {
    drop: '登记表这一层不要了。窗口那张短名单从「各档案柜实际装着的 ＋ 下载过的包」推出来,'
      + '不再单独记一份 —— 两份记同一件事,第一次有人手改就对不上。',
    before: '名单先改成推导的(src/roster.js 的 derivedRoster),并且把 cli.js 与 server.js '
      + '两边的消费点全部换过去。⭐ 这一格还连着「日常柜插件进沙箱」:叫得出名字全靠它。'
      + '⛔⛔ **名单必须连 theirs 一起收**(CEO 08-28)。只收 ours 的版本已经写完并接线了,'
      + '但实测 CEO 的日常柜 ours 0 条、theirs 3 条 —— 也就是说那个版本在他自己机器上'
      + '一个都叫不出来,「日常柜进沙箱」当场是死的。'
      + '⚠️ theirs 解析得到真实文件夹(实测那三个是指向 E:\\codecode\\dsh_lab\\packages\\* '
      + '的链接),所以搬得动;删的边界见 plugins.uninstall 那一格。'
      + '✅ 已落地(05900a2＋25612f8):src/roster.js 立起来,ours ＋ theirs ＋ 下载过的三路合一,'
      + 'cli.js 五处与 server.js 一处消费点已换;每行带 owned(文件是谁的)与 source(写在哪一层)。'
      + '⚠️ rosterWithLegacy 那个过渡并集要跟着 plugins add 一起删。',
    done: true,
  },
  'plugins.rm': {
    drop: '登记表没了,「从登记表移除」也就没了。',
    open: '「一次把这个插件从所有档案柜弄走」是真需求,给不给 rm plugin <id> --everywhere?',
  },

  // —— 登录与对话
  signin: { to: 'get signin --to <档案柜>' },
  signout: { to: 'rm signin --from <档案柜>' },
  adopt: { to: 'get chat --from <档案柜> --to <档案柜>' },

  // —— 工作区
  workspaces: { to: 'ls workspace --in <档案柜>' },
  'workspaces.use': { to: 'set workspace <目录> --in <档案柜>' },

  // —— ⛔ 包体仓:整个对象隐形。
  packages: { drop: '下载的包体是我们的内部存放位置,不是用户世界里的东西。' },
  'packages.rm': { drop: '同上;真正该发生的是卸载时按引用计数自己清。' },
  'packages.prune': {
    drop: '把错误定义掉:没有任何档案柜在用的包,不该等人来清。'
      + '⛔ 这条要落地才能删 —— 引用计数没做之前删掉它,就是把垃圾留给用户。',
    before: '卸载时按引用计数自己清(bin/cli.js 的 sweepUnusedDownloads)。'
      + '⛔ 计数必须在行删掉之后取:早一刻问,它会拿刚刚松手的那个柜子回答'
      + '「还有人在用」,于是永远清不掉。',
    done: true,
  },
  'packages.cancel': { to: 'stop --download' },

  // —— ⛔ 备份堆:只留「撤销」,不给「选哪一份」。
  'plugins.backups': {
    drop: '不给选哪一份,所以不需要列。⭐ 这是「把错误定义掉」:一旦可以选,'
      + '就得先看懂那张表 —— 而人真正想要的从来只是「回到我改坏之前」。',
    before: '轮转已确认是自动的且有上限(mounts.js:978 KEEP_BACKUPS=5,'
      + 'backupFile 每写一份就 pruneBackups,装/卸/启停/删bundle/restore 五个写动作全覆盖)。'
      + '⚠️ 顺带查出来的两件:沙箱根本不存快照,只有日常柜有,所以 backups --sandbox 永远是空的。'
      + '⭐⭐ 「删了 backups 就再也选不了哪一份」这个缺口,由 CEO 08-28 的裁决解掉了:'
      + '深度不再靠读一张时间戳表得到,而是靠再按一次 undo —— 见 plugins.restore 那一格。',
    done: true,
  },
  // ⛔ 单独一格,因为它是**实现**上的前提而不是文案上的:今天 restore 之前会先
  //    存一份快照(mounts.js:1097),于是连按第二次拿到的正是刚存的那一份 —— 原地
  //    打转。要能连按,undo 必须消费掉栈顶那一份,而不是在栈顶再压一份。
  'plugins.restore': {
    to: 'set plugin --undo --in <档案柜>',
    before: '⭐⭐ CEO 08-28:撤销要能**连按**,按 n 次退 n 步(上限 5 份),'
      + '并在输出里说「还可再退几步」。⛔ 今天不行:restore 会先存一份再还原,'
      + '第二次按拿到的就是刚存的那份,原地打转。改法是 undo 消费掉栈顶那一份。'
      + '⚠️ 同时查出:沙箱根本不存快照(snapshotDir 传 null),所以撤销只在日常柜成立。'
      + '✅ 已落地(9d4c8af):undo 消费掉栈顶且不再压新的,输出带「还可再退几步」;'
      + '守卫在 check-plugin-mounts,并已验证它在旧实现下真的会红。',
    done: true,
    open: '⭐⭐ 这一条差点撑出第 11 个动词。放进 set 是「把插件配置设回上一个值」,'
      + '读得通但有点绕;更直白的是单独一条 undo。三条出路:①认第 11 条 undo;'
      + '②attach/detach 并进 set(set agent on|off)腾一格;③维持现在这样。CEO 未拍板。'
      + '⛔ 之所以先放进 set:一道设计上就永远红的守卫,会训练人忽略它。',
  },
  'plugins.backups.rm': { drop: '不给选哪一份,就没有哪一份可删;轮转已经是自动的。' },
  'plugins.backups.prune': { drop: '轮转本来就是自动的,这条只是替自动的那件事再按一次开关。' },

  // —— PATH。⛔⛔ 这一族的裁决在 2026-08-28 被**推翻过一次**,推翻它的是 CEO 的
  //    三个问题:面板要用吗 / 安装器为什么敲 / 绿色版有没有这个问题。
  //
  //    原判词是「归安装器,所以三条全删」。查下来:①面板确实不用(index.html 零引用);
  //    ②安装器敲它是因为写 PATH 不能交给 NSIS(1024 上限 vs 真机 2085 会静默截断),
  //    所以写 PATH 归 Node,安装器只好回头调自己的 CLI;
  //    ③⭐⭐ **而便携包根本没有安装器** —— README.md:140 白纸黑字「安装版装完会自动
  //    替你敲一次 path add;**便携包自己敲一次**」。
  //
  //    ⭐⭐ 所以「它不是给人敲的命令」只对了一半:对安装版是,对便携包不是。
  //    它是真·用户命令,只是名字没归位 —— 那就按 CEO 的办法收进已有动词,
  //    既不藏起来,也不新开一族。
  //    ⛔ 教训:判断一条命令「有没有人用」,只看调用它的代码是不够的;
  //       ⭐ 文档里写着「你自己敲一次」的那一句,是代码里永远找不到的调用方。
  path: { to: 'ls setting' },
  'path.add': {
    to: 'set path on',
    before: '⛔⛔ 改名时必须**同一笔**改掉 src-tauri/installer.nsh:62 与 :72'
      + '(挂载点 tauri.conf.json:23 installerHooks),它们现在敲的是 path add/rm --json。'
      + '漏了这一步,安装器收到 UNKNOWN_COMMAND —— 装完进不了 PATH、卸载留残条,'
      + '而且全程静默:安装器把返回值 Pop 掉就不管了(那是有意的,见 nsh 里的注释)。'
      + '⚠️ 一并改 README.md:135-136 的示例与 AGENTS.md:43-44。'
      + '⭐ 「别让 NSIS 自己写 PATH」这条硬约束现状已符合,别在改名时顺手动它:'
      + 'path-env.js 走注册表 API、保 REG_EXPAND_SZ、超长拒写不截断、写完读回逐字比对。'
      + '✅ 已落地:installer.nsh:62/72 改成 set path on/off。'
      + '⭐⭐ 同一次改动里发现了**第三处从没人记过的**:同文件 :54 的 config lang '
      + '(安装向导选的语言写进设置),同样 Pop 掉返回值 —— 漏改就是第二个静默的 '
      + 'UNKNOWN_COMMAND(装完语言不生效)。⛔ 判词:「安装器到底调了我们哪几条命令」'
      + '这件事从来没有人整份数过,只是每次撞见一条记一条。',
    done: true,
  },
  'path.rm': { to: 'set path off', before: '同 path.add,同一笔改。', done: true },

  // —— 设置
  config: { to: 'ls setting' },
  'config.source': { to: 'set source <auto|official|mirror>' },
  'config.lang': { to: 'set lang <zh|en>' },
  'config.ask-on-quit': { to: 'set ask-on-quit <on|off>' },
  'config.ask-on-daily': {
    to: 'set ask-on-daily <on|off>',
    open: '⛔⛔ 2026-08-28 起它什么都不控制了,该不该删。它唯一管着的是那条**静默同意**'
      + '路径(设成 off 就跳过弹窗、由页面自己补一个 --approved),而 CEO 当天的裁决正是'
      + '「只能面板弹窗,人来点击」—— 那条路没了,这个开关也就没有任何东西可关。'
      + '⚠️ 它现在是一条会说谎的设置:help 写着「命令行和配置窗一起按它办」,而两边都不看它。'
      + '要么删掉(那就要说清 ask-on-quit 为什么留着 —— 因为关窗真的会停掉别人的沙箱),'
      + '要么给它一件真事做。',
  },
  'config.reset': {
    to: 'rm setting',
    open: '设置文件读坏时的逃生口。rm setting 读起来像「删设置」而它其实是'
      + '「存档并从空的重来」—— 名字要不要再想一个?',
  },

  // —— 看
  status: { to: 'ls' },
  logs: { to: 'logs <档案柜> | --version <版本号> | --package <包名>' },
  history: { to: 'ls history' },
  memory: {
    to: 'ls memory',
    open: '要不要并进 ls history --last-session?两者读的是同一族记录,'
      + '差别只是「持久的全部」与「上一次接管那一轮」。',
  },

  // —— 窗口与接管
  ui: { to: 'ui' },
  'ui.stop': { to: 'stop --window' },
  attach: { to: 'agent attach' },
  detach: { to: 'agent detach' },
}

let failures = 0
const check = (what, passed, detail = '') => {
  if (!passed) failures += 1
  console.log(`  ${passed ? '通过' : '不通过'}  ${what}${detail === '' ? '' : `  —— ${detail}`}`)
}

console.log('\n44 条瘦成 10 条:每一条旧能力都要有交代\n')

const old = Object.keys(COMMANDS)
const mapped = Object.keys(MAP)

// 1. 一条不落。⛔ 这是整份守卫的理由:能力是一件一件挣来的,删掉可以,
//    但必须是有人写下理由的删,不能是改到一半忘了。
// ⭐ 改名落地之后,命令表上是**新**键名,而这两张表是按旧名索引的。一条只在改名
//   之前才成立的守卫,会在改名那一刻集体变红 —— 而那正是最需要它说话的时候,
//   于是下一个人只会把它关掉。所以两边都认。
const newKeys = new Set(Object.values(SHAPE).map((row) => row.key))
const unaccounted = old.filter((name) => MAP[name] === undefined && !newKeys.has(name))
check('每一条现有命令都有交代(去哪儿了,或为什么删得掉)',
  unaccounted.length === 0, unaccounted.join('、'))

// 2. ⛔⛔ 刀序本身,由机器执行:**前提没落地的,那条命令不许已经消失。**
//
//    这一条原来写的是「表里不许有已经不存在的命令」,而刀 1 一动手它就红了 ——
//    因为一个 drop 条目指向一个已经没了的命令,**正是它成功的样子**,那条目
//    从那一刻起是墓碑,不是待办。⭐ 判词:一道会在正确行为发生时变红的守卫,
//    下一个人只会把它删掉,连同它本来想保护的东西一起。
//
//    真正还需要被守住的是刀序:§3.1 那张表里每一条「删之前必须先自动发生的事」,
//    都可能被一句「反正命令删了也没人用」跳过去,而跳过去的代价是**用户那边
//    多了一堆没人收拾的垃圾,同时没有任何东西变红**。所以改成守这个。
// ⛔ 只管**删掉**的那些(drop),不管改名的(to)。改名之后旧键名当然不在命令表里,
//    把那读成「跳过了前提」会让这道守卫在刀 2 落地那一刻集体误报 —— 而一道会在
//    正确行为发生时变红的守卫,下一个人只会把它关掉,连同它本来要保护的东西。
const jumped = mapped.filter((name) => MAP[name].before !== undefined
  && MAP[name].done !== true && MAP[name].drop !== undefined && COMMANDS[name] === undefined)
check('⛔ 前提还没落地的,那条命令不许已经删掉(刀 0 必须在刀 1 之前)',
  jumped.length === 0, jumped.join('、'))

const migrated = mapped.filter((name) => COMMANDS[name] === undefined)

// 3. 每条要么有 to 要么有 drop,不能两个都没有,也不能两个都有。
const vague = mapped.filter((name) => {
  const entry = MAP[name]
  return (entry.to === undefined) === (entry.drop === undefined)
})
check('每条要么给了新形状,要么给了删得掉的理由(不能既是又是)', vague.length === 0, vague.join('、'))

// 4. ⭐ 删掉的必须给理由,而且不能是一句「用不上」。理由要答的是
//    **为什么这件事可以不存在**,通常是「它被自动做掉了」或「它本来不属于这里」。
const unexplained = mapped.filter((name) => MAP[name].drop !== undefined && MAP[name].drop.length < 12)
check('每个删掉的都写了为什么它可以不存在', unexplained.length === 0, unexplained.join('、'))

// 5. ⛔ 新形状只许用申报过的那十个动词。这条是这份表的上限本身 ——
//    没有它,瘦身会以「再加一条也没什么」的方式慢慢长回去。
const strayVerbs = mapped
  .filter((name) => MAP[name].to !== undefined)
  .map((name) => ({ name, verb: MAP[name].to.split(' ')[0] }))
  .filter((row) => !VERBS.includes(row.verb))
check(`新形状只用申报过的十个动词(${VERBS.join(' ')})`,
  strayVerbs.length === 0, strayVerbs.map((row) => `${row.name}→${row.verb}`).join('、'))

// 6. 十个动词每个都得真的用得上。一个没有任何旧能力落到它头上的动词,
//    要么是忘了映射,要么它根本不该在名单里。
const usedVerbs = new Set(mapped
  .filter((name) => MAP[name].to !== undefined)
  .map((name) => MAP[name].to.split(' ')[0]))
const idleVerbs = VERBS.filter((verb) => verb !== 'help' && !usedVerbs.has(verb))
check('申报的动词都真的接住了东西(help 除外)', idleVerbs.length === 0, idleVerbs.join('、'))

// 7. ⛔ 补回来的场景也受同一条上限管。这道守卫的全部意义:「盖不住的场景」是瘦身
//    唯一会真正伤到人的地方,而修补它最省事的做法永远是新加一条命令 ——
//    那样瘦身就在自己的补丁里长回去了,而且是以「这是必要的」的名义。
const strayComposed = Object.keys(COMPOSED).filter((shape) => !VERBS.includes(shape.split(' ')[0]))
check('补回来的场景也只用那十个动词,没有为它新开一条', strayComposed.length === 0, strayComposed.join('、'))

// 8. 每个补回来的场景都要说清「旧形状里这件事是怎么做的」。⭐ 没有这一句就分不清
//    它是**瘦身补回来的**还是**顺手加的新功能** —— 后者不属于这一刀。
const noHistory = Object.entries(COMPOSED).filter(([, one]) => (one.was ?? '').length < 12)
check('每个补回来的场景都写了旧形状里它是怎么做的', noHistory.length === 0,
  noHistory.map(([shape]) => shape).join('、'))

// —— 不是断言,是把还欠的裁决摆到台面上。⭐ 悬而未决写成数据而不是散文,
//    下一任才不会「读到一半以为都定了」。
const open = mapped.filter((name) => MAP[name].open !== undefined)
const dropped = mapped.filter((name) => MAP[name].drop !== undefined)
console.log(`\n  账:原有 ${mapped.length} 条 → 删 ${dropped.length} 条,收进 ${VERBS.length} 个动词`)
console.log(`  进度:${migrated.length}/${mapped.length} 条已经动过刀,命令表上还剩 ${old.length} 条`)
if (open.length > 0) {
  console.log(`\n  ⬜ 还欠 ${open.length} 个裁决(不算不通过,但动手前要先定):`)
  for (const name of open) console.log(`     ${name}:${MAP[name].open}`)
}

// —— ⛔⛔ 刀 0:删掉一条之前,必须先让哪件事自动发生。
//    ⭐ 这一栏之所以要打印而不是写在册子里:它被违反时**没有任何东西会红**。
//    命令删了、验收全绿,而用户那边多了一堆没人收拾的垃圾,或者少了一件本来
//    会自动发生的事。唯一能拦住它的,是有人在删之前看见这张单子。
const prereq = mapped.filter((name) => MAP[name].before !== undefined)
const pending = prereq.filter((name) => MAP[name].done !== true)
console.log(`\n  ⛔ 刀 0(动这条之前必须先落地的):${prereq.length - pending.length}/${prereq.length} 已完成`)
for (const name of prereq) {
  console.log(`     ${MAP[name].done === true ? '✅' : '⬜'} ${name}:${MAP[name].before}`)
}
if (pending.length > 0) {
  console.log(`\n  ⛔⛔ 上面 ${pending.length} 条还没落地,这几条命令**现在还不能动**:${pending.join('、')}`)
}

console.log(`\n  ⭐ 瘦身要补回来的场景 ${Object.keys(COMPOSED).length} 个(旧形状盖得住,新形状不许盖不住):`)
for (const [shape, one] of Object.entries(COMPOSED)) {
  console.log(`     ${shape}\n        为什么:${one.why}\n        旧形状:${one.was}`)
  if (one.panel !== undefined) console.log(`        面板:${one.panel}`)
}

// 9. ⛔⛔ 新形状里不许再出现 --main / --sandbox。它们是旧的那根「二选一」轴,而新
//    形状把柜子变成了一个值(--in / --to / --from 后面跟一个名字,日常柜叫 main)。
//    留一个下来,调用方就得同时背两套写法,而「哪个柜子」会分裂成「看情况」——
//    那正是这次瘦身要消灭的东西。
const oldAxis = mapped.filter((name) => MAP[name].to !== undefined && /--main(?![\w-])|--sandbox(?![\w-])/.test(MAP[name].to))
check(`新形状里不再有 --main / --sandbox(日常柜叫 ${DAILY})`,
  oldAxis.length === 0, oldAxis.join('、'))

// 10. ⛔ 每一条还在的命令,都要在目标表里有新键名与新旗标。⭐ 这是并行改造的地基:
//     几个人各改各的文件,而对不对不靠谁去读别人的 diff,靠这一条当场红。
const noShape = old.filter((name) => SHAPE[name] === undefined && !newKeys.has(name))
check('每条还在的命令都申报了新键名与新旗标', noShape.length === 0, noShape.join('、'))

// 11. 刀 2 做完之后,COMMANDS 必须与目标表逐字对上。
//     ⭐ 两种状态都要能跑:还没动手时报进度,动过手之后当断言 ——
//     一道只在终点才有意义的守卫,在路上就是关掉的,而路上正是会出错的地方。
const want = new Map()
for (const row of Object.values(SHAPE)) {
  const seen = want.get(row.key)
  want.set(row.key, {
    booleans: new Set([...(seen?.booleans ?? []), ...row.booleans]),
    values: new Set([...(seen?.values ?? []), ...row.values]),
  })
}
if (old.every((name) => want.has(name))) {
  const wrong = []
  for (const [key, shape] of want) {
    const real = COMMANDS[key]
    if (real === undefined) { wrong.push(`${key} 不见了`); continue }
    const gap = [...[...shape.booleans].filter((f) => !(real.booleans ?? []).includes(f)),
      ...[...shape.values].filter((f) => !(real.values ?? []).includes(f))]
    if (gap.length > 0) wrong.push(`${key} 少了 ${gap.join(' ')}`)
  }
  const extra = Object.keys(COMMANDS).filter((k) => !want.has(k) && k !== 'help')
  check('⭐ 刀 2 已完成:命令表与目标表逐字对上',
    wrong.length === 0 && extra.length === 0, [...wrong, ...extra.map((k) => `多出 ${k}`)].join('、'))
} else {
  console.log(`
  ⬜ 刀 2 未做:命令表上还是旧键名(${old.length} 条),目标是 ${want.size} 个键`)
}

// 12. ⭐⭐ 每条 `--json` 答复里的 `action` 都得是命令表上真有的键。
//     ⛔ 这一条是被判例逼出来的:刀 2 改完命令表之后,派发器里还留着十六处
//     `action: 'plugins.uninstall'` / `'quit'` / `'path.add'` —— 全是已经不存在
//     的命令名。⭐ 调用方读的就是这个字段:它没坏、没报错、看着完全正常,只是在
//     报告一个这个程序里已经没有的东西。**没有任何东西会为此变红**,直到有人
//     恰好去数一遍。
//     ⚠️ 这里查的确实是源码里的字符串字面量,而这一次那是对的 —— 被查的东西
//     本身就是一个字符串字面量。
const dispatcher = readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8')
const emitted = [...dispatcher.matchAll(/action: '([^']+)'/g)].map((one) => one[1])
// ⚠️ `help` answers with its own name and has no row in the table — it is the
//   one command whose subject is the table rather than something in it.
const strayAction = [...new Set(emitted)].filter((name) => !(name in COMMANDS) && name !== 'help')
check('⭐⭐ --json 里的每个 action 都是命令表上真有的键(不是某条已经删掉的命令的名字)',
  strayAction.length === 0, strayAction.join('、'))

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项不通过\n`)
process.exit(failures === 0 ? 0 : 1)
