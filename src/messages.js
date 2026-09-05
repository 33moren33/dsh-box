/**
 * Every word this tool says, in one file, in both languages.
 *
 * Two properties are worth the indirection, and they are the same two an
 * earlier version of this file was written for. Translating no longer means
 * rewriting code, so one language cannot be destroyed by editing the other —
 * which is exactly what happens when text lives inline. And because every
 * entry is a plain string with `{name}` placeholders rather than a function,
 * the table travels to the config window unchanged: the terminal and the
 * window say the same sentence because they read the same line.
 *
 * ⛔ Three kinds of text are deliberately NOT in here, because they are data
 * rather than speech and a language switch must never move them:
 *   - error `code`s (`PLUGIN_NAME_TAKEN` and friends), which are the promise
 *     a script reads while the sentence beside them is free to be reworded;
 *   - the marker comments written into a user's `cordis.patch.yml`, which are
 *     how this tool finds its own block again — translate those and a user who
 *     switches language has orphaned everything we ever wrote for them;
 *   - flag and command names, which are the interface.
 *
 * Tone, decided 2026-08-22:
 *   - short lines (progress, results, refusals) are plain and carry no ⭐⛔⚠;
 *     they say what happened and what to do next, and nothing else;
 *   - `notes` in help keep the marks and the judgements, because their job is
 *     to explain rather than to report.
 * In both languages a conclusion is stated as the behaviour it describes, not
 * as a maxim about it.
 */

/** Language used when nothing has said otherwise. */
export const DEFAULT_LANG = 'zh'

/** Languages this tool speaks, in the order a picker should show them. */
export const LANGS = ['zh', 'en']

/**
 * The language this process is speaking.
 *
 * Module state rather than a parameter threaded through every call: the
 * language is a property of the data directory, read once at startup, and
 * passing it down to each of several hundred call sites would be the same
 * value written several hundred times.
 */
let speaking = DEFAULT_LANG

/**
 * @param {string} lang
 * @returns {string} the language actually adopted.
 */
export function setLang(lang) {
  speaking = LANGS.includes(lang) ? lang : DEFAULT_LANG
  return speaking
}

/** @returns {string} */
export function currentLang() {
  return speaking
}

/**
 * The language this computer appears to be set to.
 *
 * Only ever a starting point for a data directory that has never been told —
 * once `set lang` has been used, that answer wins, because a setting the
 * user chose must not be second-guessed by an environment variable.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function systemLang(env = process.env) {
  const declared = env.DSH_BOX_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? ''
  if (declared !== '') return declared.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  // Windows sets none of those. `Intl` reports what the OS is configured for,
  // and is present in every Node this tool supports.
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return DEFAULT_LANG
  }
}

/**
 * One sentence, in the current language, with its blanks filled.
 *
 * A missing key returns the key itself rather than an empty string or a
 * throw: a screen that says `plugin.installed` is obviously broken and still
 * usable, while a blank line hides the fault and an exception turns a wording
 * mistake into a failed command.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function t(key, vars = {}) {
  const table = MESSAGES[speaking] ?? MESSAGES[DEFAULT_LANG]
  const line = table[key] ?? MESSAGES[DEFAULT_LANG][key]
  if (line === undefined) return key
  return line.replaceAll(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}

/**
 * The whole table for one language, for the config window to render with.
 * @param {string} [lang]
 * @returns {Record<string, string>}
 */
export function messagesFor(lang = speaking) {
  return { ...MESSAGES[DEFAULT_LANG], ...(MESSAGES[lang] ?? {}) }
}

/** Every key, for the check that both languages carry all of them. */
export function messageKeys() {
  return Object.keys(MESSAGES[DEFAULT_LANG])
}

const MESSAGES = {
  zh: {
    'lang.name': '中文',
    'cmd.ls.summary': '此刻的全景:数据目录、版本、沙箱、谁在跑',
    'cmd.ls.machine.summary': '看能用哪些 dsh:本机装的、已下载的、你指过的文件夹',
    'cmd.ls.sandbox.summary': '列出沙箱',
    'cmd.ls.memory.summary': '看上次接管期间做了哪些操作(含被拒绝的)',
    'cmd.ls.plugin.summary': '给了档案柜就列它实际装着什么;不给就列这台电脑上叫得出名字的全部',
    'cmd.ls.plugin.notes': `--in 后面写沙箱名,或者写 main 指你日常那个档案柜。
不给 --in 问的是另一件事:不是「那个柜子装着什么」,而是「这台电脑上叫得出名字的插件有哪些」——
各档案柜里实际装着的,加上我们下载过的,合成一张名单。
⭐ 这张名单就是 get plugin 能直接按 id 搬东西的来源:日常柜里有什么,就搬得动什么。
⭐ 给了 --in 时读的是那个档案柜自己的配置,不是我们的账:谁写进去的都列出来,
   并注明是我们装的、还是它本来就有的。`,
    'cmd.get.machine.summary': '下载一个官方版本(逐包核对版本)。文件夹不用下载,直接在 start 里给路径',
    'cmd.get.plugin.summary': '把插件装进某个档案柜(一直在,直到你拿掉);不点名就把 --from 那个柜子装着的全搬过去',
    'cmd.get.plugin.notes': `点不点名,是两种读法,同一条命令:
  get plugin <名字> --to <柜>              搬那一个
  get plugin --from <柜A> --to <柜B>       把 A 装着的插件全部在 B 也装一遍

⭐ 全搬是单搬的重复,不是另一件事:同一道闸门、同一份备份、一个都不落下地逐个报。
   ⛔ 方向是参数不是功能——两边都写名字,所以「日常柜搬进沙箱」和「沙箱推回日常柜」
   是同一条命令,反过来那次不需要任何额外实现。
   ⛔ 搬过去的是「装了哪些」这份配置,不是解析出来的那堆文件:目标柜按它自己那台
   dsh 重新解析一遍,所以两边 dsh 版本不同也不会把对方的软链带过去。
   ⚠️ 一个都装不上不会中途停下——每一个都试,答案里分成 copied / alreadyThere /
   missing(源那边文件夹已经不在了) / refused(各带自己的 code)。

点名时,位置上那个词是什么由它自己决定,不必再给旗标:
  一个存在的目录          从磁盘上装
  ls plugin 列得出的 id   这台电脑上已经有的那一份,直接装进 --to
  其余                    当成 npm 包名去下载

⭐ 第二种就是「把日常柜里那个插件也装进沙箱」的走法:名字从 ls plugin 那张名单来,
   而那张名单是从各档案柜实际装着的东西推出来的,不必先登记。
⭐ 两个柜子各有一个同 id 的插件时,加 --from 指明拿哪一个;不加就在全机名单里找。
--to 写沙箱名,或者写 main 指你日常那个;给一个还不存在的沙箱名会顺手建一台。
装进去的东西写在那个档案柜自己的 profile 配置里,所以你自己敲 dsh 也在,
不是只在从这里启动时才有。要拿掉用 rm plugin。
⭐ 改这个文件之前会先整份备份,改坏了用 set plugin --undo 一步步退回去。
⛔ --to main 会被拒(NEEDS_APPROVAL):那是你自己敲 dsh 时读的档案柜,要人在配置窗里点过头。
⚠️ 一次只装得了一个 npm 包 —— 两个 npm 同时写同一个包目录会把它写坏。`,
    'cmd.rm.machine.summary': '把一台 dsh 从这儿去掉:我们下载的真删,你指的文件夹只忘掉记录',
    'cmd.rm.plugin.summary': '把插件从某个档案柜拿掉',
    'cmd.rm.plugin.notes': `一个档案柜有三处能写插件,这条命令三处都管:
  · 我们写进 profile 配置的行 —— 整行删掉
  · 聚合包 —— 它带进来的十几行一起拿掉
  · profile 的 dsh.profile.bundles —— 从 bundles 和 dependencies **两处**摘掉

⛔ 只摘 bundles 是白摘:dsh 每跑一条 dsh plugin 命令都会照 dependencies 对账,
   还在那儿又还声明 dsh.bundle 的包会被加回来。所以两处一起,不然等于没删。
⛔ 你自己文件夹里的插件只断开链接,文件一个字节不动。我们下载的那份,等到没有任何
   档案柜还在用它时才跟着删——不必也不该由人来清。
⚠️ 不是我们装的、也不是 bundle 的行,拿不掉——那是别人写进去的。用 set plugin <id> off
   把它关掉,那是这个格式里「删」唯一的拼法。
⛔ --from main 会被拒(NEEDS_APPROVAL),要人在配置窗里点过头。`,
    'cmd.set.plugin.summary': '把某一行开关掉,或者把这个档案柜的插件配置退回上一步',
    'cmd.set.plugin.notes': `⭐⭐ 关掉是这个格式里「删」的拼法,也是唯一能动「不是我们装的东西」的办法:
   patch 里根本没有 remove,下层的行只能被上层盖掉,盖不掉就删不掉。
   profile 配置排在所有 bundle 层之后,所以这里写一行 disabled: true 关得掉
   bundle 带进来的插件——官方关自己的遥测用的就是这一招。
⛔ 只放得回我们自己关的。别人写的 disabled 是别人的决定,悄悄给他打开就是替他做主。
⭐⭐ --undo 每敲一次退一步,最多五步,敲完会告诉你还能再退几步;退过的那一步会被消费掉。
   写 --at <时间戳> 是「跳到某个时刻」,那是另一回事:历史留着,而且会先给现在这份留一份备份。
⭐ --undo 是「精确拿掉」够不着时的后路:文件被别处改成我们认不出的形状,
   逐条删就找不到东西可删,那时整份还原。
⚠️ 只有日常档案柜存快照。沙箱是用完就扔的,不存,所以对沙箱 --undo 永远说没有备份。
⛔ --in main 会被拒(NEEDS_APPROVAL),要人在配置窗里点过头。`,
    'cmd.ls.history.summary': '看这个数据目录里做过的所有事(持久记录)',
    'cmd.ls.history.notes': `⛔ 跟 ls memory 是两样东西,别混:
  ls memory   上一轮 agent 接管期间做了什么,是给窗口看的显示,下一轮会覆盖掉
  ls history  这个数据目录做过的所有事,持久记录,只增不改

不写 --lines 就是最近 {historyLines} 条。省略了多少会当场说出来,全文路径也会给。
--lines 0 是全部;--shape 只回答「有多大、从什么时候到什么时候、失败几条」,
  无论记录多长这个回答都是固定几行。

⚠ 只有会改变状态的命令才记。到 2MB 会转一代(.1),更早的那一代会被顶掉。`,
    'cmd.ls.workspace.summary': '看这个档案柜见过哪些工作区(第一条就是打开时进的那个)',
    'cmd.ls.workspace.notes': `⚠ 两个词别混,它们不是并列关系:
  档案柜  一个 DSH_HOME,装对话、配置与登录,就是 --in 后面写的那个
  工作区  dsh 实际干活的那个项目文件夹,本条命令管的是它,这也是 dsh 官方的叫法
  一个档案柜里装着一张「这台见过哪些工作区」的名单,本条命令看的就是那张名单。

⛔ dsh 不会自己把启动目录登记成工作区,实测过:新起一台那张表是空的,
  所以人得在 dsh 的网页里选一次。而 dsh web 那层没有任何参数能指定它
  (只有 --host / --port / --trusted-host),这正是本命令存在的理由。
⛔ 配置窗里没有这个控件,也不会加:人直接在 dsh 里选就行,这条是给 agent 的。`,
    'cmd.set.workspace.summary': '让这个档案柜下次打开时进这个工作区',
    'cmd.set.workspace.notes': `已经登记过的会被提到最前面;没登记过的会加一条。⛔ 从不删、也不动对话归属。
⚠ 改的是 dsh 自己的文件($DSH_HOME/storages/workspace.json)。写之前会核对
  它的版本号,不认识就拒绝:那张表写错一个字段,整台 dsh 起不来(实测过)。
⛔ --in main 会被拒(NEEDS_APPROVAL),要人在配置窗里点过头。`,
    'cmd.stop.summary': '停下一件正在跑的东西:一台 dsh、全部沙箱、配置窗,或正在下的那个包',
    'cmd.stop.notes': `⛔ 只停得掉从这里启动的那台日常档案柜,它有进程号可认。你自己在别处开的那台,
   我们只知道 3080 在应答,认不出是哪个进程,不去动它。
⛔ 停日常档案柜那台要有人在面板上点头(stop main,或 --all 走到它那一步):
   那是你正在用的东西,停掉之后那次对话就没了,而且可能还有别人在用它。
⭐ --all 是**先停沙箱、再问日常柜**:沙箱一律照停,拒绝只发生在最后那一台,
   而且拒绝里会写明已经停掉了哪几台。收拾自己起的沙箱这条常路上没有弹窗。
⭐ 沙箱只是停下,不会被删,下次同名启动接着用。
⭐ --window 平时用不着:配置窗自己关的时候会松手。用得着的是另一种情形——exe 被强杀,
   而它起的那个 Node 服务是子进程,在 Windows 上活得比它久,座位和端口一直被占着,
   ui 从此永远被拒。座位上那个进程已经不在时,如实说没有开着的配置窗,并把那份记录清掉。
⛔ --download 停的是整棵进程树 —— 真正卡住的往往不是 npm 自己,是某个依赖的安装脚本。
   正在下什么用 logs --package <包名> 看。
⚠ 四件事互不牵连:--all 不关窗口,--window 不停沙箱,--download 只管下载那棵进程树。
⚠ 没有一个常驻的 dsh-box 进程可关:每条命令都是自己的小进程,跑完就退。所以「全停」
  只能是一件做出来的事。ui 那个进程被 Ctrl+C 掉也不算,那只结束了 ui 这一条命令。`,
    'cmd.start.summary': '启动:不写 --version 就用你自己装的那台 dsh',
    'cmd.start.notes': `start ＝ 选两样东西:用哪台 dsh(机器) × 开哪个档案柜(DSH_HOME)
  机器    不写            你自己装的那台 dsh
          --version <版本号>   dsh-box 下载的那一个
          --version <文件夹>   你指的那一份 dsh(带 / 或 \\ 就按文件夹读)
  档案柜  写沙箱名开那一台 | --new 开一台新的 | 写 main 开你日常的 ~/.dsh

⚠ 什么都不沿用上次:不写档案柜会被拒绝,不写 --version 就是你自己那台。
  同一条命令永远得到同一个结果。
⚠ 这里不说 dsh 打开哪个「工作区」(项目文件夹),那是 set workspace 管的,
  而且 dsh 不会因为启动目录就登记一个工作区,实测过。
⭐ 插件是档案柜的属性,不是这次启动的:不写 --plugin 不是「一个都不装」,是「什么都不改」,
  这个档案柜之前装过的照样加载,你自己敲 dsh 也一样。要纯官方就开一个新沙箱。
沙箱名可用:字母(中文也可以)、数字、_ . - ,不能有空格,不能以 - 或 . 开头,
也不能叫 main —— 那是日常档案柜占着的名字。

⭐ --version 给文件夹时,往下找三层认这两种:摊在硬盘上的 dsh(源码构建出来的、
  普通装机的),以及某个应用自带的 dsh(整棵树打包在 app.asar 里,只有它自带的
  那个程序读得动,所以就用那个程序来起)。
  钉版核对会照实报一句,但不拦 —— 那棵树不是 dsh-box 装的。

main 只说档案柜,不说机器。main 配上任何一台不是你自己装的 dsh(下载的、或你指的
文件夹),是唯一「出事修不回来」的组合:磁盘格式跨版本无迁移路径,且那台 dsh 在跑
期间,这个 home 的模块指针指着那份安装。
⛔ 所以只有那一格会被拒(NEEDS_APPROVAL),要人在配置窗里亲手点过。没有旗标可以
  绕开:被拒时 dsh-box 会自己把配置窗弹出来等人点,人点了之后由那扇窗把这条命令跑掉。`,
    'cmd.get.chat.summary': '把对话从一个档案柜复制到另一个(复制,不是搬走)',
    'cmd.get.chat.notes': `两头都写档案柜名:沙箱名,或者写 main 指你日常那个。
最常用的一条是把沙箱里的对话收进日常柜:
  get chat --from <沙箱名> --to main
反过来、以及两个沙箱之间,都是同一条命令换个写法。

⭐ 只复制不搬走:原件留在来源那边,目标已经有的同一条会跳过,所以重复跑是安全的。
⛔ 目标那台 dsh 正跑着会被拒绝:dsh 只在启动时扫描对话目录,开着的时候复制进去它看不见。
  确认无碍可加 --force,那些对话会在它下次启动时出现。`,
    'cmd.rm.sandbox.summary': '删掉一个沙箱及其中一切',
    'cmd.ls.setting.summary': '看当前设置,以及这一份在不在 PATH 上、PATH 上有几份',
    'cmd.ls.setting.notes': `每一项都有一条改它的命令:set source / set lang / set ask-on-quit / set ask-on-daily。
PATH 也是一个设置,开关是 set path on|off,所以它和别的设置列在同一张表里。
⚠️ PATH 那一段只在 Windows 上有意义:别的系统上 PATH 归 shell 的配置文件管,
  不该由一个启动器代改,所以那里只报「这条命令用不上」。
⛔ 设置文件读不懂的时候这条也读不出来。那时用 rm setting 把它存档、从空的重来。`,
    'cmd.set.source.summary': '换安装源:auto | official | mirror',
    'cmd.set.lang.summary': '换语言:{options}',
    'cmd.set.lang.notes': `语言是这个数据目录的设置,不是页面的偏好:命令行和配置窗跟着一起变,
所以两边永远说同一种语言。配置窗右上角那个开关跑的就是这条命令。

没设过就跟这台电脑的语言走;设过之后就以设的为准,不再看环境变量。
⛔ 错误代号(PLUGIN_NAME_TAKEN 之类)和写进你配置文件里的标记不翻译:
  它们是数据不是话,跟着语言变会让脚本和我们自己都认不出来。`,
    'cmd.set.ask-on-quit.summary': '关配置窗前提不提醒「会停掉所有沙箱」',
    'cmd.set.ask-on-daily.summary': '动到日常档案柜之前提不提醒',
    'cmd.rm.setting.summary': '设置文件读不懂时:把它存档,从空的重来',
    'cmd.rm.setting.notes': `只在别的命令报 CONFIG_UNREADABLE 时才需要它。
⛔ 旧文件是改名存档,不是删掉:它记着你上次选过什么,存档之后还找得回来看。
存档之后设置回到出厂,但档案柜里已经装着的插件一个都不受影响:那些写在档案柜自己的配置里。`,
    'cmd.set.path.summary': '把这个 exe 所在的目录加进你自己的 PATH,或者去掉',
    'cmd.set.path.notes': `on 之后新开的终端里敲 dsh-box 就能用,已经开着的终端要重开一次;off 是反过来。
只写你自己的 PATH(HKCU\\Environment),不动系统的,也不要管理员权限。
⭐ 只加这一条,不整理你 PATH 里别的东西;改之前把原样存一份在数据目录的 env-path 里。
⛔ npm 装的那份用不着它:npm 自己会把垫片放进全局目录,那个目录本来就在 PATH 上。
⚠️ PATH 上已经有另一份 dsh-box 时会拒绝——两份都在,敲名字命中哪一份取决于顺序。要这一份赢就加 --force。
⭐ 这一条改的是这台电脑,不是这个数据目录。它归 set 是因为它确实是个开关,
  而且便携包的用户装完要自己敲一次(安装版由安装器代敲)。`,

    'path.windowsOnly': '这条命令只在 Windows 上有意义。别的系统上 PATH 归 shell 的配置文件管,不该由一个启动器代改。',
    'path.noExe': '这条命令要由 dsh-box 的 exe 自己来跑。npm 装的那份不需要它:npm 已经把垫片放好了。',
    'path.noExeShort': '这一份不是 exe 起的,没有可登记的目录。',
    'path.hereOn': '这一份:{dir}(在 PATH 上)',
    'path.hereOff': '这一份:{dir}(不在 PATH 上)',
    'path.copies': 'PATH 上的 dsh-box:{count} 份',
    'path.dead': '另有 {count} 条 PATH 条目指向已不存在的目录(不归本工具管,只报给你看)',
    'path.already': '已经在 PATH 上了,什么都没做:{dir}',
    'path.notThere': '本来就不在 PATH 上,什么都没做:{dir}',
    'path.anotherCopy': 'PATH 上已经有另一份 dsh-box:{dir}。两份都在,敲名字命中哪一份取决于顺序。确定要这一份赢就加 --force。',
    'path.added': '已加进 PATH:{dir}',
    'path.removed': '已从 PATH 去掉:{dir}',
    'path.reopen': '新开一个终端才生效,已经开着的那些读的是旧的。',
    'path.noPowershell': '起不了 PowerShell,没法读写 PATH:{why}',
    'path.registryRefused': '读写 PATH 被拒绝:{why}',
    'path.tooLong': '你的 PATH 有 {length} 个字符,太长了,这条命令不敢动它——改坏一个人的 PATH 比少一条命令严重得多。请自己把这个目录加进去。',
    'path.mismatch': '写完再读回来对不上:写进去 {wrote} 个字符,读出来 {read} 个。原样那份在数据目录的 env-path 里。',
    'path.kindChanged': '写完再读回来,值的类型从 {was} 变成了 {now}。原样那份在数据目录的 env-path 里。',
    'cmd.ui.summary': '打开配置窗',
    'cmd.ui.notes': `一个数据目录只开一个配置窗服务。它自己关掉的时候会松手,所以正常关窗不必做别的;
要从命令行关掉它是 stop --window。
⛔ 已经开着的时候再敲一次不会开第二个:它会把现成那个地址报给你。要多开一个视图,
  用浏览器再打开一次那个地址就行。`,
    'cmd.logs.summary': '看某个档案柜最近一次启动说了什么;--package 看某个 npm 插件的下载进度',
    'cmd.logs.notes': `⭐ 先 --shape 再决定读不读:无论日志多大,那个回答都是固定几百字符。
默认只给最后 50 行或 4000 字符,并且会明说省略了多少、全文在哪。`,
    // ⭐⭐ 「完成后」——每条命令回答同一个问题:**做完之后我处在什么状态**。
    // 返回了没有、留下了什么、下一步敲什么。summary 答的是「它做什么」,notes
    // 答的是「人们会在哪儿栽」,都不答这一个;而这一个才是照着用的人真正要的。
    // 判例:一个真实使用者盯着一条早已完成的 start 等了 2 分 36 秒,因为「立即
    // 返回」这件事只写在 AGENTS.md 里,help 一个字都没有。
    // ⛔ 不是把册子抄一遍:一句话,只说状态。这一整张表 --help --json 会整个吐给
    //   agent,多写的每个字都是它要读进去的。
    // ⛔ 短句体裁,不带 ⭐⛔⚠(守卫会查),该说的分寸用「会被拒」「要先…」说出来。
    'cmd.ls.after': '只看了一眼;永不联网,所以永远快。这是总览:每台沙箱一行,插件只给数目(ours / theirs / platform);要路径看 ls sandbox,要某个档案柜装了什么看 ls plugin --in <档案柜>',
    'cmd.ls.sandbox.after': '只看了一眼。每台一行带路径(root / home / patchFile),插件仍只给数目;某一台装了什么看 ls plugin --in <沙箱>',
    'cmd.ls.machine.after': '只看了一眼,什么都没变。要下载用 get machine <版本号>',
    'cmd.ls.plugin.after': '只看了一眼。要真装进某个档案柜是 get plugin',
    'cmd.ls.setting.after': '只看了一眼。每一项都有一条对应的 set 去改它',
    'cmd.get.machine.after': '下完才返回,可能要几分钟;完成后 start <档案柜> --version <版本号> 就能选它,中途看进度用 logs --version <版本号>',
    'cmd.get.plugin.after': '那个档案柜从此一直装着它,你自己敲 dsh 也会加载;--to 给一个还不存在的沙箱名会顺手建一台沙箱;那台 dsh 已经在跑的话要重启才生效。装的是别处已有的那一份时,原来那个档案柜一条不少',
    'cmd.get.signin.after': '那台沙箱里有登录了;本来就有的话什么都不做(imported 为 false),换 key 要先 rm signin',
    'cmd.get.chat.after': '目标档案柜多出那些对话,来源那边一条不少;目标那台正跑着会被拒,加 --force 的话那些对话要等它下次启动才看得见。两边跑的 dsh 不是同一版时会多印一句提醒:会话日志带着格式版本,对面不认就整份拒收,而日志是压缩的、我们看不进去,所以那是提醒不是判定',
    'cmd.rm.machine.after': '给版本号:那份从磁盘上没了,有沙箱正用着会被拒。给文件夹:只是我们不再记得它,你的文件夹一个字节没动,用过它的沙箱同时清掉模块指针层(下次启动 dsh 自己会重建);没有沙箱用过它会被拒,免得一句「已完成」骗人',
    'cmd.rm.plugin.after': '从这个档案柜拿掉;要是没有别的档案柜还在用它,我们下载的那份包也一并删掉(deletedPackages 会列出来),再装就要重新下载。你自己文件夹里的插件只断开链接,文件一个字节不动',
    'cmd.rm.sandbox.after': '那台沙箱连同它的档案柜一起没了,撤不回来;正在跑会被拒,先 stop',
    'cmd.rm.signin.after': '那个档案柜没有登录了,里面的对话一条不动',
    'cmd.rm.setting.after': '坏掉的设置文件改名存档,设置回到出厂;档案柜里已经装着的插件一个都不受影响',
    'cmd.start.after': '会挡住你:一直等到 dsh 真的开始服务才返回。重开一台已有的沙箱约 5 秒,新建一台约 25 秒(要现铺一个档案柜),上限都是 120 秒(超时报 BOOT_TIMEOUT)。返回之后 dsh 留在后台跑,这条命令不守着它。输出里有 sandbox(这台叫什么,配 --new 时就靠它知道)、url、pid、port、logFile,以及 elapsedMs ——这一次从接到命令到 dsh 真在服务用了多少毫秒,拿它定自己的等待上限,别照抄上面那两个约数。还有 cabinetPlugins(这个档案柜现在装着什么)与 pluginsChanged(这一次改动了哪几个,通常是空的)。要在里面真的发出消息,还得用 set workspace 给这个档案柜一个项目工作区,否则模型菜单是空的。停它用 stop <档案柜>,想守着日志加 --follow(那就再也不返回了,Ctrl+C 停)',
    'cmd.stop.after': '被点名的那件停了,东西都还在:沙箱连同它的档案柜留着(要再起用 start),半截的下载留在原地、下次装同一个包会盖过去,配置窗的座位和端口放开、要再开窗口用 ui',
    'cmd.set.plugin.after': 'off 之后那一行还在文件里,但下次启动不再加载;on 之后又会加载。--undo 让整份插件配置回到上一步的样子,并告诉你还能再退几步,再敲一次就再退一步',
    'cmd.set.workspace.after': '写完就返回;那个档案柜下次打开时进这个工作区,已经在跑的那台不受影响',
    'cmd.set.source.after': '下一次下载就走新的源',
    'cmd.set.lang.after': '命令行和配置窗一起换了语言;已经开着的页面要重载一次',
    'cmd.set.ask-on-quit.after': '开关变了,配置窗下次按退出时照它办',
    'cmd.set.ask-on-daily.after': '开关变了,命令行和配置窗一起按它办',
    'cmd.set.path.after': 'on 之后新开的终端里裸敲 dsh-box 就能用,已经开着的终端读的还是旧的 PATH;off 之后 PATH 上那一条没了。改之前的原样存在数据目录的 env-path 里',
    'cmd.ui.after': '不返回,一直服务到它被停掉;地址印在上面,别的终端照常可以敲命令。要停它用 stop --window',
    'cmd.logs.after': '只看了一眼;默认最多给最后 50 行或 4000 字符,并说明省略了多少、全文在哪',

    // ── 第三张脸:MCP。工具表、绑定、判词映射全部由声明生成(src/mcp.js),这里只有话。
    'cmd.mcp.summary': '以 MCP 服务的形式把这里的每条命令交给 Agent(stdio 上一行一条 JSON-RPC)',
    'cmd.mcp.after': '不返回,一直服务到客户端关掉输入。每次工具调用都在后台跑一次同名命令行(带 --json 与 --box),答案就是那一行 JSON;除 ui 与 mcp 自己以外,每条命令都是一个同名工具',
    'cmd.mcp.notes': `挂法(Claude Code 等客户端的 .mcp.json):
  {"mcpServers":{"dsh-box":{"command":"dsh-box","args":["mcp","--box","<数据目录>"]}}}
  ⭐ --box 就是命令行那个 --box:这台服务的每次调用都对着这一个数据目录。建议明写,因为客户端起
  服务时的工作目录不一定是你以为的那个;不写就按上面通用选项里的默认规则去找。
工具名就是命令名,两个词之间用下划线:ls_sandbox、get_plugin、start、stop(客户端给模型看的名字
  不许有点,所以源头就写下划线,你看到的就是声明的)。
参数名:旗标去掉 --(to、no-sign-in);位置参数用声明里的名字,以工具的 inputSchema 为准,
  也就是 --help --json 里 params 的 name(例:get.plugin 的位置参数叫 source,rm.sandbox 的叫 sandbox)。
  布尔旗标传 true;标了可重复(...)的旗标传数组:{"plugin":["a","b"]}。
判词:每个答案里都有 verdict(ok / failed / partial / error);只有 error 会标成工具出错(isError),
  failed 与 partial 是关于你问的那台的判定,不是工具坏了。
⛔ 一条规则:凡是不返回的都不上工具表,不论它是一条命令还是一个旗标 —— ui(一直服务)、
  mcp 自己、start 的 --follow(一直看日志)。需要面板的时候不必调 ui:需要人点头的动作
  (动日常档案柜)由后台那条命令行自己弹配置窗、等一分钟,人点了才继续。`,
    'mcp.after': '完成后:',
    'mcp.cliEquivalent': '命令行等价写法:',
    'mcp.truncationHint': '用 --lines 收窄行数,或先 --shape 看形状再决定读哪一段。',
    'mcp.instructions': '每个工具就是同名的 {program} 命令行(工具名里的点换成空格),对着数据目录 {box} 跑。答案是一行 JSON,里面的 verdict 分四档:ok 答出来了 / failed 关于你问的那台的判定 / partial 做了一半,答案写着做了哪一半 / error 请求或工具的问题。只有 error 会标成 isError。',
    'mcp.unknownTool': '没有叫 {name} 的工具。有的是:{tools}',
    'mcp.strayArgument': '{tool} 不收这些参数:{names}。它收的是:{allowed}',
    'mcp.strayArgumentNone': '{tool} 不收这些参数:{names}。它不收任何参数',
    'mcp.noOutput': '命令行退出码 {code},却没有打出那一行 JSON',
    'mcp.cannotRun': '起不了命令行:{error}',
    'mcp.tooLarge': '命令答出来了,但答案有 {chars} 个字符,超过这台服务的上限 {limit};head 里是前一段。{hint}',
    'cmd.mcp.param.max-chars': '一次答案最多交多少个字符;超过就换成一条 partial 的替身行(带前一段与实际大小)。不写是 20000',

    'help.title': 'dsh 沙箱启动器 —— 在隔离沙箱里跑 DeepSeek Harness',
    'help.perCommand': '某一条的细则: help <命令> 或 <命令> --help(例如 help start)。用法行里的 [选项] 指那一页参数表里其余的旗标',
    'help.machineReadable': '机器可读的一份: --help --json,给出的就是驱动这个命令行的那张表',
    'help.common': `通用选项: --json 以 JSON 输出结果(给脚本和 Agent 用)。
  成功是一行 {"box":…,"ok":true,…},失败是一行 {"box":…,"ok":false,"code":…}。
  code 是不会变的标识,message 是给人看的、随时可能改写。
判词与退出码:每一行 JSON 都带 verdict,退出码只是它的投影。
  ok 0 答出来了 ／ failed 1 关于你问的那台的判定(沙箱不在、dsh 没起来、闸门拒了;
  请求本身没错,是世界说了不)／ error 2 请求或本工具的问题(不认识的命令或选项、
  工具崩了、够不着;不是关于任何沙箱的判定)／ partial 3 做了一半再被拒,答案里
  写着做了哪一半(如 stop --all:沙箱都停了、日常柜那台被闸门拦下)。
数据默认放在 ./dsh-box-files/data(可用 --box <目录> 或环境变量 DSH_BOX_HOME 改)。
  指到的目录已经是别人的时,会改用它旁边一个空的,JSON 里多一个 boxAsked
  (你要的是哪儿)挨着 box(实际用的是哪儿),退出码仍是 0。
--help --json 里还有 boxVersion:回答你的是本工具的哪一版。
JSON 的形状有版本:每一行都带 schema。裸写 --json 永远是第 1 版,--json=1 是它的
  明写;要一个本工具没有的版本会被拒(JSON_SCHEMA_UNKNOWN),不会用旧形状凑数。
选项归命令:一条命令只认 help <命令> 列出的那些 ＋ --json / --box / --help。
  别的命令的选项写到这儿会被拒(FLAG_NOT_HERE,并说明它属于谁);同一个取值选项
  写两次也拒(FLAG_TWICE),除非它标了可重复。`,
    'help.flags': '参数',
    'help.after': '完成后',
    'help.required': '必填',
    'help.mutates': '会改变状态,所以会记进操作记录',
    'help.readOnly': '只读,不改任何东西',
    'help.noSuchTopic': '没有叫「{topic}」的命令,不带参数运行可看全部',
    'help.unknownCommand': '不认识的命令「{command}」,不带参数运行可看用法',
    'help.familyTitle': '「{verb}」后面可以跟这 {count} 个对象',

    'sandbox.created': '沙箱「{name}」已新建',
    'sandbox.reused': '沙箱「{name}」已复用',
    'sandbox.ownConversations': '它的对话只属于它,别的沙箱看不到',
    'sandbox.signInImported': '登录已导入',
    'sandbox.plain': '这个档案柜一个插件都没有:纯官方的 dsh',
    'sandbox.holds': '这个档案柜装着:{names}',

    'launch.starting': '正在启动 {version},端口 {port}',
    'launch.readyAnnounced': '已就绪:dsh 自己宣告在 {port} 端口服务了(它插件树跑完才会说这句),且进程稳定',
    'launch.readyProbed': '已就绪:dsh 没印出那行,改由我们探页面确认(页面带着启动清单),且进程稳定',
    'launch.portTaken': '端口 {port} 这一刻被别人占了,多半是同时启动的另一台;改用 {next} 再试一次',
    'launch.needsExposeInternals': '这台 Node 拿不到内部加载器,启动补上 --expose-internals;否则 dsh 起不来,插件也解析不到',
    'launch.noProcessProof': '不能停进程 {pid}:没有给出它的身份凭据。进程号会被回收,没有凭据就无从证明它还是我们那个,所以拒绝动手。',
    'launch.clearedModuleLinks': '已清掉可能指错版本的模块链接,启动时会重建',
    'launch.open': '打开 {url}',
    'launch.realKey': '用的是你真实的 API Key,这里的对话真实计费',
    'launch.noKey': '这个档案柜没有登录,要对话得先在里面配一个 API Key',
    'launch.sessionOnlyKey': '这个档案柜里那份凭证只是 dsh 自己签的浏览器会话,不是 API Key —— 要对话还得配一个(起 --sign-in 可以从你日常那台拷一份)',
    'launch.unreadableKey': '这个档案柜有一份凭证文件,但我们读不懂它的格式,所以说不好有没有 API Key —— 没有下结论,你自己看一眼',
    'launch.logAt': '日志 {file}',
    'launch.detached': '在后台跑着(进程号 {pid}),停它: stop {name}',
    'window.alreadyServing': '这个数据目录已经开着配置窗:{url}(进程号 {pid})。要开第二个视图,用浏览器再打开一次那个地址。它是上次强杀留下的孤儿就用 stop --window 收掉',
    'window.noneServing': '这个数据目录没有开着的配置窗',
    'window.stopped': '已关掉配置窗:{url}(进程号 {pid})',
    'window.gone': '座位上记的进程号 {pid} 现在已经不是它了,没有动它;那份记录已清掉',
    'launch.sandboxStarting': '沙箱「{name}」正被另一个进程启动,等它起完再说',
    'launch.mainStarting': '日常档案柜正被另一个进程启动,等它起完再说',
    'launch.noFreePort': '在 {from} 到 {to} 之间找不到空闲端口',
    'launch.linkDangling': '「{name}」链上去之后指向了不存在的地方,记着的路径是 {path}。用完整路径重新装一次这个插件目录',
    'launch.noHostDshFile': '你自己装的 dsh 里没有 {entry} 这个文件,它可能刚被卸载,或者升级到一半',
    'launch.versionNotDownloaded': '版本 {version} 还没下载',
    'launch.sandboxAlreadyRunning': '沙箱「{name}」已经开着:{url}(进程 {pid})。同一个沙箱同时只能跑一台,两台会互踩同一份档案柜。要并行就换个沙箱,要重启就先停掉它',
    'launch.bootExited': 'dsh 还没启动完就退出了,退出码 {code}',
    'launch.bootExitedLate': 'dsh 服务完页面之后退出了,退出码 {code}',
    'launch.bootTimeout': 'dsh 在 {seconds} 秒内没有启动完成',
    'launch.stoppedAfterFailure': '这次起的那台(进程号 {pid})已经停掉了,没给你留在后台',
    'launch.badPid': '拒绝停止进程号 {pid}',

    // ⭐ 参数在 usage 那行里怎么称呼。⛔ 只能住这儿:usage 现在是由声明生成的,
    //    而声明是一份不认识语言的数据 —— 把「档案柜」写进声明,英文那张脸当场作废。
    'param.cabinet': '档案柜',
    'param.pluginSource': 'id|目录|包名',
    'param.pluginId': 'id',
    'param.pluginRef': 'id|包名',
    'param.port': '端口号',
    'param.release': '版本号',
    'param.releaseOrFolder': '版本号|文件夹',
    'param.sandbox': '沙箱',
    'param.folder': '目录',
    'param.title': '名字',
    'param.count': '条数',
    'param.chars': '字符数',
    'param.packageName': '包名',
    'param.timestamp': '时间戳',
    'param.options': '选项',

    // ⭐ 每个参数一句话:它是什么、给了会怎样。⛔ 每个声明了的参数都必须有一句
    //    (tools/check-messages.mjs 守着),因为没有这一句的旗标只对读过源码的人存在。
    //    写「它是什么」不写「怎么用」:怎么用归 notes。
    'cmd.ls.plugin.param.in': '看这个档案柜实际装着什么;不给就列这台电脑上叫得出名字的全部',
    'cmd.ls.workspace.param.in': '看哪个档案柜的工作区名单',
    'cmd.ls.history.param.lines': '要最近几条;0 是全部;不写就是 {historyLines} 条',
    'cmd.ls.history.param.shape': '只报大小、起止时间与失败几条,不吐正文',
    'cmd.get.machine.param.version': '要下载的官方版本号',
    'cmd.get.plugin.param.source': '装哪一个:一个存在的目录、ls plugin 列得出的 id,或 npm 包名;不写就把 --from 那个柜子装着的全搬过去',
    'cmd.get.plugin.param.to': '装进哪个档案柜;沙箱名,或 main;不存在的沙箱名会顺手建一台',
    'cmd.get.plugin.param.from': '从哪个档案柜拿;两柜有同 id 的插件时指明拿哪一个,不点名时决定搬整柜',
    'cmd.get.plugin.param.id': '装目录时给它登记的 id;不写就用目录自己报的',
    'cmd.get.signin.param.to': '把日常档案柜的登录导进哪个沙箱;main 不行,它是来源',
    'cmd.get.chat.param.from': '对话从哪个档案柜来',
    'cmd.get.chat.param.to': '对话复制到哪个档案柜',
    'cmd.get.chat.param.force': '目标那台 dsh 正跑着也照复制;它下次启动才看得见',
    'cmd.rm.machine.param.version': '去掉哪一台:我们下载的写版本号,你指过的写文件夹(带 / 或 \\ 就按文件夹读)',
    'cmd.rm.plugin.param.target': '拿掉哪个插件:登记 id 或包名',
    'cmd.rm.plugin.param.from': '从哪个档案柜拿掉',
    'cmd.rm.sandbox.param.sandbox': '删哪个沙箱',
    'cmd.rm.signin.param.from': '把哪个档案柜的登录去掉',
    'cmd.start.param.sandbox': '开哪个档案柜:沙箱名,或 main 开你日常那个',
    'cmd.start.param.new': '开一台新沙箱,名字自动起',
    'cmd.start.param.version': '用哪台 dsh:dsh-box 下载的写版本号,你自己那份写文件夹;不写就是本机装的那台',
    'cmd.start.param.plugin': '顺路把这个插件装进这个档案柜,以后一直在;写 id 或一个插件目录;可重复;柜子是 main 时要过闸门(NEEDS_APPROVAL)',
    'cmd.start.param.unplug': '顺路把这个插件从这个档案柜拿掉;可重复;柜子是 main 时要过闸门(NEEDS_APPROVAL)',
    'cmd.start.param.no-sign-in': '新建沙箱时不导入登录',
    'cmd.start.param.sign-in': '起之前把登录导进这个档案柜',
    'cmd.start.param.sign-out': '起之前把这个档案柜的登录去掉',
    'cmd.start.param.follow': '不立即返回,留在这里看日志滚,Ctrl+C 停掉它',
    'cmd.stop.param.sandbox': '停哪一台:沙箱名,或 main 停从这里起的日常档案柜',
    'cmd.stop.param.all': '停所有沙箱,最后再问日常柜那一台',
    'cmd.stop.param.window': '关掉这个数据目录的配置窗服务',
    'cmd.stop.param.download': '停掉正在进行的那个下载,连它起的整棵进程树',
    'cmd.set.plugin.param.target': '开关哪个插件',
    'cmd.set.plugin.param.state': 'on 放回来,off 关掉',
    'cmd.set.plugin.param.undo': '整份插件配置退一步,可以连按',
    'cmd.set.plugin.param.in': '在哪个档案柜里改',
    'cmd.set.plugin.param.at': '不是退一步而是跳到这个时刻的那份备份',
    'cmd.set.workspace.param.path': '让它下次打开进这个项目文件夹',
    'cmd.set.workspace.param.in': '改哪个档案柜',
    'cmd.set.workspace.param.title': '这个工作区在 dsh 里显示的名字',
    'cmd.set.source.param.value': '装包从哪里拿:auto 自动挑,official 官方源,mirror 镜像',
    'cmd.set.lang.param.value': '命令行与配置窗一起说的语言',
    'cmd.set.ask-on-quit.param.value': 'on 提醒,off 不提醒',
    'cmd.set.ask-on-daily.param.value': 'on 提醒,off 不提醒',
    'cmd.set.path.param.state': 'on 加进 PATH,off 去掉',
    'cmd.set.path.param.force': 'PATH 上已有另一份 dsh-box 时仍然加,让这一份赢',
    'cmd.logs.param.sandbox': '看哪个档案柜最近一次启动的日志:沙箱名,或 main',
    'cmd.logs.param.shape': '只报形状:多少行、多大、几行像出错、最后一行',
    'cmd.logs.param.errors': '只要像出错的行,各带前后三行',
    'cmd.logs.param.lines': '要多少行;不写是 50 行或 4000 字符,谁先到算谁',
    'cmd.logs.param.all': '列出这个档案柜留着的所有日志文件',
    'cmd.logs.param.version': '改看下载或删除这个版本时的日志;下载中也能看',
    'cmd.logs.param.package': '改看这个 npm 插件下载装入时的日志;下载中也能看',
    'cmd.ui.param.no-open': '起服务但不弹浏览器,只把地址印出来',
    'cmd.ui.param.port': '固定听这个端口;不写就随机挑一个空的',
    'global.param.box': '数据目录在哪;不写就用默认的那个',
    'global.param.json': '答机器读的 JSON,一行;--json=1 指明要第几版形状,裸写就是第 1 版',
    'global.param.help': '只讲这条命令怎么用,不跑它',

    'cabinet.daily': '日常档案柜',
    'sandbox.noFreeName': '{prefix}-{stamp}-1 到 -999 都被占着了,给它起个名字吧',
    'sandbox.noSuch': '没有叫「{name}」的沙箱',
    'sandbox.runningCannotDelete': '「{name}」正在跑(进程 {pid}),先 stop {name} 再删',

    'adopt.sameCabinet': '从哪儿复制到哪儿是同一个档案柜,没什么可做的',
    'adopt.noSessions': '{label}里还没有任何对话',
    'adopt.destinationRunning': '{label} 上正跑着一台 dsh,先把它关掉再复制。dsh 只在启动时扫描对话目录,开着的时候复制进去它看不见。确认无碍可以加 --force,那些对话会在它下次启动时出现',

    'plugin.installed': '已把「{name}」装进{where}',
    'plugin.installedWhere': '写在 {file}——你自己敲 dsh 也会加载它',
    'plugin.removeHint': '要拿掉: rm plugin {id} {cabinet}',
    'plugin.uninstalled': '已把「{name}」从{where}拿掉',
    'plugin.downloadSwept': '没有别的档案柜还在用它,下载的那份也一并删了: {list}',
    'plugin.folderUntouched': '没有改动你那个文件夹',

    'restore.done': '{where} 的插件配置已还原到 {at} 那一份',
    'restore.stepsLeft': '再敲一次还能往回退 {count} 步',
    'restore.noneLeft': '已经退到头了,没有更早的了',
    'restore.linksNotRolledBack': '只还原了配置,链接没有跟着回滚。少了的插件不会被加载,多出来的链接是空占位',

    'version.notDownloadedAlready': '{version} 本来就没下载',
    'version.inUse': '「{sandbox}」正用着 {version}(进程 {pid}),先 stop {sandbox} 再删',
    'version.deleting': '正在删除 {version}…',
    'version.deletingSized': '正在删除 {version},约 {mb} MB…',
    'version.stillDeleting': '还在删,已 {seconds} 秒',
    'version.deleted': '{version} 已删除',

    'host.versionNotDownloaded': '版本 {version} 还没下载,试试: get release {version}',
    'host.noHostDsh': '没找到你自己装的 dsh。两条路:装一台(npm i -g @deepseek-ai/dsh),或者用 --version <版本号> 指定一个 dsh-box 已经下载的版本',
    'engine.unknown': '不知道用的哪台',
    'engine.versionUnreadable': '版本读不出',
    'engine.host': '你自己装的 {version}',
    'engine.release': 'dsh-box 下载的 {version}',
    'engine.tree': '你指的那份 {version}({path})',
    'engine.app': '应用自带的 {version}({path})',

    'engine.pathMissing': '这个文件夹不存在:{path}',
    'engine.noDshInPath': '{path} 里没找到 dsh。往下找了三层,要么是这个文件夹不对,要么是源码还没装依赖、没构建',
    'engine.noDshInApp': '{path} 是个应用,但它里面没有 dsh',
    'engine.insideArchive': '{path} 里的 dsh({version},{packages} 个包)整棵树封在 app.asar 里,硬盘上一个文件都没有,所以起不来:dsh 启动时要在档案柜里建一层指向自己那棵树的链接,而链接是操作系统解析的,它进不了 asar。这是那一版打包漏解了(它自己声明过要把 node_modules 解出来),换一版产物就好',
    'engine.entryMissing': '{path} 里的 dsh 声明了一个启动文件,而那个文件不在',
    'engine.appPlatform': '认「应用自带的 dsh」目前只在 Windows 上实现过,这台是 {platform}。可以改指一个摊在硬盘上的 dsh 文件夹',
    'engine.appNoExe': '{path} 看着像个应用,但认不出该用它里面哪个程序来跑(找到:{found})',
    'engine.appUnreadable': '读不到 {path} 里的东西——它自带的那个程序没有回话',

    'engine.pinOk': '钉版核对:{packages} 个包,版本全一致',
    'engine.pinMixed': '钉版核对:{packages} 个包里混着别的版本({list})。这棵树不是我们装的,所以只说一声,照样启动',
    'engine.pinUnchecked': '钉版核对:数不到兄弟包,证实不了。照样启动',

    'mounts.unreadablePatch': '读不懂这个档案柜的插件配置({file}),所以不会去改它。先看看那个文件出了什么事,或者从备份还原',
    'backup.none': '这个档案柜还没有备份,备份是在改插件配置时才产生的',
    'backup.noSuch': '没有 {at} 这一份。有的是:{list}',

    'workspaces.dirNotFound': '找不到目录 {dir}',
    'workspaces.unknownVersion': '{file} 是 {name} 第 {version} 版,而 dsh-box 只认得 {wantName} 第 {wantVersion} 版。没有动它。\n  dsh 大概升级过,这张表的形状变了;写错一个字段整台 dsh 就起不来,所以这里宁可不写。\n  在 dsh 的界面里选一次工作区,效果一样。',
    'workspaces.unreadable': '读不懂 {file}:{error}。没有动它,这是 dsh 自己的文件,里面记着它见过哪些工作区',

    'name.empty': '沙箱名不能是空的',
    'name.tooLong': '沙箱名最多 {max} 个字符',
    'name.dots': '「.」和「..」是目录本身的意思,不能当名字',
    'name.leadingDash': '沙箱名不能以「-」开头,命令行会把它当成选项',
    'name.leadingDot': '沙箱名不能以「.」开头,那是隐藏文件的写法',
    'name.trailingDot': '沙箱名不能以「.」结尾,Windows 会悄悄去掉它',
    'name.charset': '沙箱名只能用字母(中文、日文等也算)、数字、下划线「_」、点「.」和连字符「-」,不能有空格和标点符号',
    'name.reserved': '「{name}」撞上了 Windows 的保留设备名,系统不允许用它建文件夹',
    'name.reservedDaily': '「main」是日常档案柜的名字,沙箱不能叫它 —— 否则 --in main 就说不清指的是哪一个。换个名字,别的都行',
    'name.rule': '字母(中文也可以)、数字、_ . - ,不能有空格,不能以 - 或 . 开头',

    'box.notADirectory': '{dir} 已存在,而且不是文件夹',
    'box.occupied': '{dir} 已存在、非空,而且不是本工具建的',
    'box.noFreeName': '在 {cwd} 旁边找不到可用的数据目录名',

    'npm.bothUnreachable': '官方 npm 和中国镜像都连不上,请检查网络,或稍后再试',
    'npm.sourceMirror': '自动选源:中国镜像更快({mirror} 毫秒{versus})',
    'npm.sourceOfficial': '自动选源:官方 npm({official} 毫秒{versus})',
    'npm.versusOfficialDown': ',官方源不通',
    'npm.versusMirrorDown': ',镜像不通',
    'npm.versusOfficial': ' vs 官方 {official} 毫秒',
    'npm.versusMirror': ' vs 镜像 {mirror} 毫秒',
    'npm.queryFailed': '查 {name}@{version} 时 npm 返回 {status}',
    'npm.registryFailed': '连不上 npm:仓库返回 {status}',
    'npm.badVersion': '不是合法的版本号:{version}',
    'npm.askingClosure': '正在向 npm 查 {version} 包含哪些包',
    'npm.askedSoFar': '已查过 {done} 个包(共约 {queued} 个)',
    'npm.mirrorBehind': '镜像上还没同步到 {version},改用官方源再查一次',
    'npm.noSuchVersion': 'npm 上没有叫 {version} 的版本',
    'npm.closureSize': '{version} 共 {count} 个包,逐个钉死版本',
    'npm.versionUnreadable': '读不出版本',
    'npm.pinFailed': '钉版失败:{checked} 个包里有 {wrong} 个不是 {version}({sample})。装成这样会是几个版本混在一起,所以本次下载判为失败。',
    'npm.pinOk': '已核对:{checked} 个包全部是 {version}',
    'npm.installing': '正在执行 npm install。解析依赖期间磁盘上不会有变化,解析完才开始落包。',
    'npm.resolving': 'npm 仍在解析依赖,已 {seconds} 秒(这个阶段磁盘上看不到变化,属正常)',
    'npm.writing': 'npm 正在写入,已 {seconds} 秒,已落盘 {landed} 个包',
    'npm.cannotStart': '起不了 npm:{error}。请确认 npm 已安装并在 PATH 里。',
    'npm.installFailed': 'npm install 失败(退出码 {code})。npm 最后的输出:\n{tail}',
    'npm.directBlocked': '直连 npm 不通,改走你系统里配置的代理',
    'npm.direct': '直连 npm 用时 {ms} 毫秒,下载走直连(绕开代理,只对 npm 这一个域名生效)',

    'window.address': '配置窗地址 {url}',
    'window.notLocal': '这个地址不是本机配置窗',
    'window.crossOrigin': '这个请求来自别的网页,已拒绝',
    'window.noPass': '这个请求没带本次配置窗的通行证,已拒绝',
    'window.stalePass': '这个页面是上一次打开的配置窗留下的。配置窗重开过,通行证跟着换了新的,刷新一下页面就好。',
    'window.notFound': '找不到',
    'window.agentHolds': '外面有一条命令正跑在这个数据目录上,窗口暂时不发命令。等它跑完再点一次',
    'window.noCommand': '没说要跑哪条命令',
    'window.nonTextToken': '命令里有不是文字的东西',
    'window.unknownCommand': '不认识的命令「{name}」',
    'window.noNestedUi': '配置窗里不能再开一个配置窗',
    'window.reservedFlag': '--{flag} 由配置窗自己填,不接受传入',
    'window.cannotRunCli': '起不来命令行:{error}',
    'window.noOutput': '命令没有给出结果(退出码 {code})',
    'window.onlyLocalUrl': '只开本机沙箱地址',

    'settings.changed': '{key} 已从 {from} 改成 {to}',
    'settings.lang.summary': '换语言:{options}',
    'settings.source.summary': '从哪儿下载官方版本',
    'settings.askOnQuit.summary': '关配置窗前提不提醒「会停掉所有沙箱」',
    'settings.askOnDaily.summary': '动到日常档案柜之前提不提醒',
    'settings.lang.setting': '界面与命令行说哪种语言',

    'config.unreadable': '读不懂 {file}:{error}\n  没有动它。这个文件记着你上次的选择,覆盖掉就找不回来了。\n  自己修好它,或者 rm setting 把它存档、从空的重来。',
    'config.notAnObject': '{file} 里不是一个对象,读不懂。没有动它;rm setting 可以存档重来',
    'config.busy': '另一个 dsh-box 进程正在改配置,等了 {seconds} 秒还没轮到。\n  过一会儿再试。若确认没有别的进程在跑,删掉 {lock}',

    'plugin.dirNotFound': '找不到目录 {path}',
    'plugin.noPackageJson': '{path} 里没有 package.json',
    'plugin.unreadableManifest': '读不了 {file}:{error}',
    'plugin.noPackageName': '{file} 里没写包名',
    'plugin.workspaceDepsMissing': '{name} 依赖同仓的 {count} 个包(workspace:*),但它自己的 node_modules 还没装。\n  先在那个仓里跑一次安装与构建,或者改从 npm 装这个包。',
    'plugin.entryMissing': '{name} 的入口 {main} 还不存在,这个仓还没构建过。\n  在 {path} 里跑一次构建再来。',
    'plugin.noEntry': '{name} 没有可导入的入口(既没有 main / exports,也没有 index.js)。\n  它多半是个「只带 patch 的包」:自己不含代码,靠自己的 cordis.patch.yml 把真正有代码的包引进来。挂它没用,该挂的是它引的那些。',
    'plugin.badId': '无法从 {name} 推出 id',
    'plugin.notADshPlugin': '{path} 不是 dsh 插件:它的 package.json 里没有 dsh 字段,装上去 dsh 会一声不吭地忽略它。',
    'plugin.monorepoHint': '\n  这看起来是个多包仓库,插件在 packages/ 里,共 {count} 个:',
    'plugin.monorepoPick': '\n  指到其中某一个,而不是仓库根目录。',

    'status.labelBoxVersion': '本工具版本',
    'status.labelDataDir': '数据目录',
    'status.labelAgent': '在跑的命令',
    'status.labelHost': '本机 dsh',
    'status.labelDownloaded': '已下载',
    'status.labelPlugins': '叫得出的插件',
    'status.labelMainPlugins': '日常装着',
    'status.labelSettings': '设置',
    'status.labelMain': '日常档案柜',
    'status.agentNone': '没有',
    'status.agentSince': '是,自 {at}',
    'status.none': '(无)',
    'status.downloadedHint': '(不写 --version 就不会用到这些)',
    'status.foldersGone': '({count} 个文件夹已不在)',
    'status.oursTag': '{name}(dsh-box 装的)',
    'status.mainForeign': '3080 上有一台在跑,但不是从这里启动的',
    'status.mainNone': '没有从这里启动的,3080 也空着',
    'status.mainRunning': '从这里启动着 {url}(进程 {pid}),停它: stop main',
    'status.sandboxCount': '沙箱 {count} 个,其中 {running} 个在跑',
    'status.boxStopped': '停着',
    'status.boxRunning': '跑在 {url}',
    'sandbox.neverStarted': '还没启动过',
    'status.hostMissing': '没找到(装一台: npm i -g @deepseek-ai/dsh,或每次用 --version 指定已下载的版本)',
    'status.hostUnverified': '这套安装的形状没见过,核对不了版本',
    'status.hostPinned': '{count} 个包已核对',
    'status.hostMixed': '版本混杂({list}),建议重装',
    'status.versionUnknown': '读不出',

    'logs.kept': '{where} 留着 {count} 份日志',
    'logs.fileLine': '{at}  {bytes} 字节  {file}',
    'logs.none': '{where} 还没有日志——{reason}',
    'logs.shapeFile': '文件      {file}',
    'logs.shapeSize': '{lines} 行 / {bytes} 字节 / 最后写于 {at}',
    'logs.shapeTrouble': '像出错的  {count} 行',
    'logs.shapeLast': '最后一行  {line}',
    'logs.troublePicked': '{where}:{total} 行里挑出像出错的 {count} 行(含前后各三行)',
    'logs.troubleNote': '(靠关键词猜的,dsh 没有统一的错误标记;拿不准就看全文)',
    'logs.tailHeader': '{where} {what},共 {total} 行',
    'logs.tailOmitted': '以下是最后 {shown} 行,省略前面 {omitted} 行(受限于{limit})',
    'logs.limitChars': '字数',
    'logs.limitLines': '行数',
    'logs.fullFile': '全文 {file}',
    'logs.whereVersion': '版本 {version}',
    'logs.whatVersion': '最近一次下载或删除',
    'logs.neverVersion': '它还没被下载或删除过',
    'logs.whatLaunch': '最近一次启动',
    'logs.neverMain': '它还没从这里启动过',
    'logs.neverSandbox': '它还没被启动过',
    'logs.which': '看哪个档案柜的日志? 给沙箱名,或者写 main 看日常档案柜;看下载用 --version <版本号> 或 --package <包名>',

    'run.byProcess': '进程 {pid}',
    'memory.none': '这个数据目录上还没有人做过会改状态的事',
    'memory.header': '最近的操作 {session}  从 {at} 起',
    'memory.runningNow': '此刻还在跑: {command}(进程 {pid},{at} 开始)',
    'memory.ok': '成功',
    'memory.refused': '被拒:{code}',

    'box.usingInstead': '改用 {dir} —— 想自己指定就加 --box <目录>',
    'flag.twice': '--{flag} 给了 {count} 次({list})。挑哪一个都是猜 —— 请只写一个。',
    'flag.notHere': '「--{flag}」不是 {command} 的选项;它属于 {owners}。help {command} 看这条命令认哪些。',

    'versions.downloaded': '已下载',
    'versions.named': '你指过的文件夹',
    'versions.noneNamed': '(还没有 —— 起沙箱时 --version 给一个文件夹就会出现在这里)',
    'versions.namedBy': '{list} 用过',
    'versions.noneDownloaded': '(还没有 —— 试试: get machine 0.1.0-rc.7)',
    'versions.pinned': '版本已逐包核对',
    'versions.mixed': '版本混杂 —— 请重新下载',
    'versions.registryDown': '(连不上 npm: {error})',
    'versions.available': 'npm 上可选',
    'versions.tagLatest': '官方稳定版',
    'versions.tagNext': '官方尝鲜版',
    'pull.which': '要哪个版本? 例如: get release 0.1.0-rc.7',
    'pull.ready': '{version} 已就绪',
    'drop.which': '要去掉哪一台? 给版本号或文件夹,用 ls machine 查看',
    'drop.redownload': '用过它的沙箱,下次启动前要重新下载',
    'forget.done': '已经不再记得 {path}(它出现在这些沙箱的记录里:{list})',
    'forget.keptOnDisk': '你的文件夹一个字节都没动:{path} 还在原地,随时可以再指给它',
    'forget.cleared': '顺手清掉了这些沙箱的模块指针层:{list}。下次启动 dsh 自己会重建',
    'forget.running': '{list} 正跑在这台上,先停掉它再来。这条不是洁癖:清掉一台正在跑的 dsh 脚下的模块指针,就是这条记录本来要防的那种事',
    'forget.unknown': '没有任何沙箱用过 {path},所以这儿没有关于它的记录可忘。用 ls machine 看现在记得哪些',

    'cabinet.bothFlags': '哪个档案柜只能有一个答案,这里给了两个',
    'cabinet.which': '哪个档案柜? 后面写沙箱名,或者写 main 指你日常的 ~/.dsh',
    'cabinet.dailyNeedsApproval': '这一步会动你日常的 ~/.dsh —— 你自己敲 dsh 时读的就是它,所以要有人在面板上点过头才执行。\n  没有哪个旗标能替代那一下:面板会自己弹出来,请到面板里点「允许」。沙箱这边不用点头,删掉就没了。',

    // ── 闸门:一次请求、一次点击、一次执行
    'approval.opening': '这一步要人点头。正在打开面板,请在里面点「允许」({seconds} 秒内)',
    'approval.waiting': '等你在面板里点头……',
    'approval.granted': '面板里已点头,这条命令由面板执行完了',
    'approval.denied': '面板里点了「拒绝」,什么都没做',
    'approval.timedOut': '{seconds} 秒内没有人点头,这一步没做。\n  要么让人到面板里点「允许」,要么别动日常档案柜 —— 在沙箱里复刻一份来验证(get plugin --from main --to <沙箱>)。',
    'approval.noPanel': '打不开面板,而这一步必须有人在面板上点头,所以当场停在这里,没有等。\n  手动开一个再试:dsh-box ui。npx 用户是 npx dsh-box ui。',
    'approval.gone': '这条请求已经不在了(过期或被清掉),没有执行',
    'approval.alreadyAnswered': '这条请求已经答过了,不会再执行第二遍',
    'approval.what': '{line}',
    'approval.ranInWindow': '面板执行完了:{line}',

    'plugins.cabinetHeader': '{cabinet} 现在装着的插件',
    'plugins.unreadableWarn': '这个档案柜的插件配置读不懂,下面这份可能不全',
    'plugins.cabinetEmpty': '(一个都没有 —— 纯官方 dsh)',
    'plugins.oursLine': '{package}  ← dsh-box 装的,卸得掉',
    'plugins.theirsLine': '{name}  ← 这个档案柜本来就有,不归这里动',
    'plugins.platform': '官方基座(每个 profile 都有):{names}',
    'plugins.patchAt': '配置在 {file}',
    'plugins.bundleLine': '{name}  ← 一整层,里面可能不止一个插件',
    'plugins.offLine': '(已关)',
    'plugins.overrideLine': '{id}  ← 改的是已有的这一行,不是装一个插件',
    'plugins.fromHome': '(来自档案柜根上那份 patch,每个 profile 都吃)',
    'plugins.platformFolded': '另有 {count} 处官方基座,没列出来',
    'plugins.installWhich': '装哪个插件? 给一个插件目录、一个 npm 包名,或者别的档案柜里已有的 id(配 --from)。只给 --from 不给 id,就是把那一柜整个搬过来',
    'plugins.copySameCabinet': '「{name}」既是搬出的那一柜也是搬进的那一柜,这样说没有意思',
    'plugins.copyDone': '从「{from}」搬进「{cabinet}」{count} 个:',
    'plugins.copyAlready': '另有 {count} 个那边本来就有,没动',
    'plugins.copyMissing': '{package} 的文件夹已经不在了,没搬',
    'plugins.copyRefused': '{package} 没搬成:{why}',
    'plugins.unreadablePatch': '读不懂{cabinet}的插件配置({file}),所以不会去改它——先看看那个文件出了什么事,或者从备份还原',
    'plugins.nameTakenAt': '「{package}」这个名字在{cabinet}里已经被别的东西占着了,指向 {points}。\n  没有动它——那不是 dsh-box 装的,换掉就撤不回来了。\n  真要换成 {wanted},得先由装它的人把原来那个卸掉。',
    'plugins.nameTakenGone': '「{package}」这个名字在{cabinet}里已经被别的东西占着了,而它指向的地方已经不在了。\n  没有动它——那不是 dsh-box 装的,换掉就撤不回来了。\n  真要换成 {wanted},得先由装它的人把原来那个卸掉。',
    'plugins.alreadyThere': '{cabinet}里已经装着「{package}」,而且指的就是 {points}',
    'plugins.alreadyOurs': '{cabinet} 里已经装着「{package}」了,是我们装的那一份',
    'plugins.relinked': '{cabinet} 里本来就登记着「{package}」,只是链接断了 —— 已经重新指好,没有多加一行',
    'plugins.nothingDone': '什么都没做',
    'plugins.raceTaken': '「{package}」在这中间被别的东西登记进{cabinet}了',
    'plugins.raceCheck': 'patch 没有改动,但链接已经建了。核对一下这个名字现在指向哪:',
    'backup.saved': '改之前那份已备份到 {file}',
    'plugins.badPackageName': '「{name}」既不是存在的目录,也不像一个 npm 包名。目录要有 package.json;包名只能是小写字母、数字和 . _ -,可以带 @scope/',
    'packages.treeDescription': 'dsh-box 替你下载的插件都放在这儿',
    'plugins.downloading': '正在从 {registry} 下载 {name}',
    'plugins.stillDownloading': '还在下载,已 {seconds} 秒;包树里已经有 {packages} 个 —— 这个数不动了就不是在下包了',
    'plugins.installInFlight': '这会儿正在装「{other}」。一次只能装一个——两个 npm 同时写同一个包目录会把它写坏。等它装完再来,或者先看看它到哪了:logs --package {other}',
    'plugins.retryOfficial': '{mirror} 没给全,换官方源重来一次(镜像是按快慢选的,快不等于全)',
    'plugins.mirrorHint': '你把源固定成镜像了。镜像可能缺包或还没同步完,换回来试试:set source auto',
    'plugins.installReady': '{name} 已装进「{cabinet}」',
    'logs.wherePackage': '插件包 {name}',
    'logs.whatPackage': '最近一次下载安装',
    'logs.neverPackage': '它还没从 npm 下载过',
    'npm.saidOkButEmpty': 'npm 说装好了,但 {dir} 里没有东西',
    'plugins.downloaded': '下载好了,在 {dir}',
    'npm.installExit': 'npm 装不上(退出码 {code})——{last}',
    'npm.timedOut': 'npm 跑了超过 {minutes} 分钟还没完,已经把它和它起的所有进程一起停掉了。多半不是网速慢 —— 看看日志最后几行是哪个包的安装脚本卡住了',
    'npm.saidNothing': '它什么也没说',
    'plugins.uninstallWhich': '拿掉哪个? 用 ls plugin --in <档案柜> 看这个档案柜装着什么',
    'plugins.notOurs': '「{id}」是{cabinet}本来就装着的,不是 dsh-box 装的——我们不动别人写进去的东西。要拿掉它请用装它的那个办法,或者用 set plugin 把它关掉',
    'plugins.notInstalled': '{cabinet}里没有 dsh-box 装的「{id}」——用 ls plugin --in <档案柜> 看看有什么',

    'aggregate.expanded': '「{name}」是聚合包,按它自带的 {file} 展开成 {count} 个:',
    'aggregate.alsoRemoved': '它带进来的 {count} 个也一起拿掉了:',
    'aggregate.notInlineable': '「{name}」这个聚合包不能展开进 profile 配置:它自带的 {file} 里有冲着已有 id 去的行({ids})。\n  官方把每个 bundle 当独立一层、放在 profile 配置之前,我们展开进去就落在后面——同一行在两个位置盖到的不是同一个东西。\n  只加不改的聚合包可以展开,这一种不行,所以宁可不装也不装成看着对的样子。',
    'aggregate.memberMissing': '「{aggregate}」点名了「{member}」,但从 {dir} 解析不到它。\n  这是那个包自己的问题:它把成员写进了名单却没随包发出来(常见写法是放进 devDependencies,而 devDependencies 对下游是不装的)。\n  dsh 用的是同一套解析方式,所以它也找不到。请找那个包的作者。',
    'aggregate.memberTaken': '「{aggregate}」要带进来的「{member}」,这个档案柜里已经被别的东西占着了。整包都没装——装一半会留下一个没人收拾得了的状态。',

    'plugins.staged': '连它需要的依赖一共 {count} 个包,已放进这个档案柜的 _local —— dsh 只加载得了住在 profiles 里面的插件',
    'staging.nameTaken': '这个档案柜的 _local 里已经有一个叫「{package}」的东西了({dir}),而且不是 dsh-box 放的。没有动它——那可能是你自己在开发的插件。要装这个 npm 包,先把那个挪走或改名',
    'staging.notDownloaded': '「{package}」不在下载仓里 —— 最后一个用它的档案柜卸掉时就跟着删了。重新 get plugin 一次就有',
    'launch.repointedDownloads': '{count} 个 npm 插件已对准这台 dsh 的零件',

    'plugins.disableWhich': '关掉哪一行? 用 ls plugin --in <档案柜> 看有哪些 id',
    'plugins.enableWhich': '放回哪一行? 用 ls plugin --in <档案柜> 看有哪些 id',
    'plugins.noSuchRow': '{cabinet}里没有 id 是「{id}」的行。这个格式允许你冲着一个不存在的 id 写规则,它什么也不会做,所以宁可现在拒绝——用 ls plugin {flags} 看看有哪些',
    'plugins.enableNotOurs': '「{id}」在{cabinet}里是别人关掉的,不是 dsh-box 关的。替他打开就是替他做主,所以不动——要开请用当初关它的那个办法',
    'plugins.switchedOff': '{cabinet}里的「{id}」已关掉',
    'plugins.switchedOffWhere': '写的是 {file} 里的一行 disabled: true —— 下层那一行本身没动,这个格式里没有「删」',
    'plugins.switchedOn': '{cabinet}里的「{id}」已放回来',
    'plugins.alreadyOff': '{cabinet}里的「{id}」本来就是关的,什么都没做',
    'plugins.alreadyOn': '{cabinet}里的「{id}」本来就是开的,什么都没做',
    'plugins.viaBundleLine': '{name}(随上面那个包进来的)',
    'bundles.unreadable': '读不懂 {file},所以不去改它。JSON 坏了的话先看看那个文件',
    'bundles.removed': '已把「{name}」从{cabinet}的 bundles 里拿掉',
    'bundles.bothPlaces': 'bundles 和 dependencies 两处都摘了({file})—— 只摘一处的话,下次任何一条 dsh plugin 命令都会把它加回来',
    'bundles.bundlesOnly': '从 bundles 里摘了({file});它本来就不在 dependencies 里,所以不会被加回来',
    'bundles.filesLeft': '包体还留在 {dir} —— 现在没有任何东西声明它、也没有任何东西加载它。要腾地方请自己删,我们不替官方跑包管理器',

    'backups.noneMain': '(还没有 —— 备份是改插件配置时才产生的)',
    'backups.noneSandbox': '(沙箱不留备份 —— 它本来就是干净启动的,玩坏了删掉就是)',
    'backups.limit': '最多留 {keep} 份,多的会自动丢掉最老的',
    'backups.restoreHint': '退回上一步: set plugin --undo {where}',
    'restore.preRestoreBackup': '还原前那份也备着:{file}',

    'history.shapeHeader': '操作记录的形状',
    'history.shapeCount': '共 {count} 条',
    'history.shapeCountUnreadable': '共 {count} 条,另有 {unreadable} 行读不出来',
    'history.shapeFailures': '其中失败 {count} 条',
    'history.shapeRange': '从 {from} 到 {to}',
    'history.notYet': '(还没有)',
    'history.fileBytes': '{file}  {bytes} 字节',
    'flag.linesInteger': '--lines 要一个不小于 0 的整数,给的是「{value}」',
    'history.header': '操作记录    共 {count} 条',
    'history.headerTail': '操作记录    共 {count} 条,这里是最后 {shown} 条',
    'history.empty': '(还没有 —— 只有会改变状态的命令才记)',
    'history.omitted': '省略了前面 {count} 条 —— 要全部: ls history --lines 0',
    'history.unreadable': '另有 {count} 行读不出来,没有算进上面的数目',
    'history.fullAt': '全文在 {files}',
    'history.noFile': '(还没有这个文件)',

    'workspaces.useWhich': '用哪个目录? 例如: set workspace E:\\code\\my-repo --in 甲',
    'workspaces.next': '{cabinet} 下次打开的工作区:{path}',
    'workspaces.addedNew': '这是新登记的一条',
    'workspaces.movedFront': '本来就登记着,提到了最前面',
    'workspaces.alreadyFront': '本来就在最前面,没有改动',
    'workspaces.writtenTo': '写在 {file}',
    'workspaces.header': '{cabinet} 见过的工作区    第一条就是打开时进的那个',
    'workspaces.neverStarted': '(这个档案柜还没启动过,或者一个项目都没选过)',
    'workspaces.emptyList': '(一个都没有 —— dsh 不会自己登记当前目录)',
    'sessions.count': '{count} 条对话',
    'workspaces.switchHint': '换一个: set workspace <目录> {where}',
    'workspaces.atFile': '在 {file}',

    'packages.nothingDownloading': '现在没有正在进行的下载,没什么可停的',
    'packages.cancelled': '已经停掉「{name}」的下载,连它起的所有进程一起。半截的包留在原地,下次装同一个包会盖过去',

    'sandboxes.header': '沙箱                每个都是一台独立的 dsh,彼此看不到对方的对话',
    'sandboxes.none': '(还没有)',
    'sandboxes.signedIn': '已登录',
    'sandboxes.notSignedIn': '未登录',
    'sandboxes.sessionOnly': '未登录(只有浏览器会话)',
    'sandboxes.credsUnreadable': '登录状态读不出来',
    'sandboxes.runningAt': '正在跑 {url}',

    'adopt.bothForms': '来源和去处各只能给一个答案,这里给了两个',
    'adopt.which': '从哪儿复制到哪儿? 两头都要写: --from <沙箱名|main> --to <沙箱名|main>',
    'adopt.copied': '已从{from}复制 {adopted} 条对话到{to},跳过 {skipped} 条重复',
    'adopt.originalsStay': '原件都还在{from},这是复制不是搬走',
    'adopt.visibleNextStart': '{to} 下次启动即可看到',
    'adopt.versionDiffers': '提醒一句(不是判定):{from} 上次跑的是 {fromVersion},{to} 是 {toVersion}。会话日志头里带着格式版本,读到不认的版本会整份拒收;而且加新事件类型不会改那个版本号,所以号一样也不保证收得下。日志是压缩的,我们看不进去,搬没搬成要看那台起来之后列不列得出',
    'adopt.versionUnknown': '提醒一句(不是判定):有一边上次跑的是哪一版我们不知道,所以说不好这些对话对面收不收得下。会话日志带格式版本,不认就整份拒收——那台起来之后看列不列得出',

    'start.bothFlags': '开哪个档案柜只能有一个答案:给了名字就别再给 --new',
    'start.whichCabinet': '要开哪个档案柜? 写沙箱名用那一台,--new 开一台新的,写 main 用你日常的 ~/.dsh。不写不再沿用上次——同一条命令应当永远得到同一个结果',
    'start.unknownPlugins': '这几个插件 id 叫不出来:{list} —— 用 ls plugin 看看有哪些',
    'start.pluginGone': '注意:「{id}」被勾着但文件夹已不在,这次不装它',
    'start.mainNeedsApproval': '要用 dsh-box 下载的那个版本去开你真实的 ~/.dsh。两样单独都不危险,凑在一起是唯一一个出事修不回来的组合:\n  1. 磁盘格式跨版本没有迁移路径 —— 用它打开之后,你本机那台 dsh 可能就打不开这个档案柜了。\n  2. 档案柜里有一层链接记着上次用的是哪个本体,这次会指到 dsh-box;非正常退出的话,原来那层链接就失效了。\n  3. 你要是同时用别的方式起了本机 dsh,那就是两台 dsh 指着同一个档案柜。\n  要有人在面板上点「允许」才执行。面板会自己弹出来;没弹出来就手动开一个:dsh-box ui。',
    'start.mainAlreadyRunning': '日常档案柜已经开着一台(端口 3080),先关掉它再启动',
    'start.notSandbox': '非沙箱:开的是你真实的 ~/.dsh',
    'start.releaseOnMain': '用的不是你自己装的那台,而是 dsh-box 下载的版本。两件事要知道:',
    'start.releaseOnMainDetails': '磁盘格式跨版本没有迁移路径;这台 dsh 退出前,这个 home 的模块指针指着 dsh-box 的目录',
    'start.signInSuffix': ',登录已导入',
    'start.usingEngine': '用的是{engine}',
    'start.unplugged': '已把「{package}」从这个档案柜拿掉',
    'start.unplugTheirs': '「{id}」是这个档案柜本来就有的,不归这里动,没碰',
    'start.unplugMissing': '这个档案柜里没有 dsh-box 装的「{id}」,没什么可拿掉',
    'start.pluginAdded': '已把「{package}」装进这个档案柜——以后启动都会加载它',
    'start.pluginAlready': '「{package}」这个档案柜本来就装着,没有重复加',
    'launch.followStop': '按 Ctrl+C 停止(进程号 {pid})',
    'launch.stopping': '正在停止…',
    'cmd.get.signin.summary': '把你的登录复制进这台沙箱(它本来没有的话)',
    'cmd.get.signin.notes': `⛔ --to 只能是沙箱。日常档案柜就是登录的来源,没有「导入它自己」这回事。`,
    'cmd.rm.signin.summary': '把登录从一个档案柜里拿掉',
    'cmd.rm.signin.notes': `⛔ 没有备份,拿掉就是拿掉,要用得重新登录。不备份是有意的:备份等于你的 Key 在硬盘上
  多一份明文副本,而这个工具的数据目录本来就是可以整个拷走的。
  ⛔ --from main 那份是你自己的,不是我们导进去的,所以要人在配置窗里点过头才执行。`,
    'signIn.which': '给哪台沙箱导入登录? 用 ls sandbox 查看',
    'signIn.mainIsSource': '日常档案柜就是登录的来源,没有「导入它自己」这回事',
    'signIn.nothingToCopy': '你自己的 ~/.dsh 里没有登录可复制——先在 dsh 里登录一次',
    'signIn.already': '沙箱「{name}」本来就有登录,没动',
    'signIn.done': '已把你的登录复制进「{name}」——这里的对话从此真实计费',
    'signIn.replacedSession': '它原来那份凭证被整个盖掉了(里面只有 dsh 给自己签的浏览器会话)——这台下次启动会重签一份,已经开着的页面要重新用地址里的令牌进一次',
    'signIn.grantNotCarried': '搬过去的只有钥匙:源那边 {count} 条浏览器会话记录没有跟着走。那是 dsh 给它自己那台签 cookie 用的密钥,两个档案柜共用一把就等于一边签的 cookie 在另一边也认;这台下次启动会自己签一把新的',
    'signOut.which': '把哪个档案柜的登录拿掉? --from 后面写沙箱名,或者写 main',
    'signOut.none': '「{name}」本来就没有登录',
    'signOut.done': '已把登录从「{name}」拿掉',
    'signOut.noWayBack': '没有备份:要再用得重新登录一次',
    'signOut.mainNeedsApproval': '要拿掉的是你自己那份登录,不留备份。之后在 dsh 里重新登录一次就能恢复,但这个工具帮不了你。\n  要有人在面板上点「允许」才执行。面板会自己弹出来;没弹出来就手动开一个:dsh-box ui。',
    'stop.mainNotRunning': '日常档案柜现在没有从这里启动的实例在跑',
    'stop.mainNote': '3080 上若有一台,那是你自己开的,不归这里管',
    'stop.mainStopped': '已停掉日常档案柜(进程号 {pid})——它的 home 是你日常那个,数据都还在',
    'stop.mainNeedsApproval': '要停的是你自己在用的那台 dsh,里面那次对话停掉就没了,而且可能还有别人在用它。这一步要有人在面板上点头。',
    'stop.which': '停什么? 给档案柜名(用 ls sandbox 查看,日常那个写 main),或者用 --all / --window / --download',
    'stop.notRunning': '沙箱「{name}」现在没有在跑',
    'stop.stopped': '已停掉「{name}」(进程号 {pid})',
    'stop.staleRow': '账本上那条是旧的:进程号 {pid} 现在属于别的程序,没有动它。那条记录已经清掉。',
    'rm.which': '哪个沙箱? 用 ls sandbox 查看',
    'rm.removed': '已删除「{name}」—— 那台 dsh 不复存在',

    'settings.header': '设置',
    'settings.choicesLine': '可选:{choices}',
    'settings.unknown': '没有叫「{key}」的设置 —— 用 ls setting 可看全部',
    'settings.whichValue': '把 {key} 设成什么? 可选:{choices}',
    'settings.badValue': '{key} 不能设成「{value}」——可选:{choices}',
    'config.nothingToReset': '{file} 本来就不在,没什么可重置的',
    'config.archived': '旧的设置存到了 {file}——没有删,里面记着你上次选过什么',
    'config.freshStart': '下一条命令会从空的重新开始',

    'quit.nothingRunning': '没有沙箱在跑,不用停什么',
    'quit.staleRows': '另有 {count} 条旧记录:它们记的进程号现在属于别的程序,没有动,记录已清掉。',
    'quit.stopped': '已停下 {count} 台沙箱:{names}',
    'quit.mainStopped': '日常档案柜也停了(进程号 {pid})——它的 home 是你日常那个,数据都还在',
    'quit.mainStale': '日常档案柜那条记录记的进程号({pid})现在属于别的程序,没有动,记录已清掉',
    'quit.mainForeign': '3080 上有一台 dsh,但不是从这里启动的,动不了也不该动',
    'quit.mainNeedsApproval': '沙箱已经停了 {count} 台。剩下日常档案柜那一台是你自己在用的,停它要有人在面板上点头。',

    'flag.noValue': '--{flag} 是开关,不接受取值',
    'flag.jsonSchema': '--json={asked}:本工具没有这一版 JSON 形状,有的是 {known}。裸写 --json 就是第 1 版。',
    'flag.unknown': '不认识的选项「--{flag}」——不带参数运行可看用法',
    'flag.needsValue': '--{flag} 后面要跟一个值',
    'flag.needsPositiveInteger': '--{flag} 要一个正整数,给的是「{given}」',
    'error.lastLines': '它最后说的 {count} 行:',

    'ui.title': 'dsh 沙箱启动器',
    'ui.intro': '隔离沙箱里试版本、试插件,不影响日常档案柜。也可让 agent 通过 CLI 选择要启动的 dsh 本体与沙箱档案柜环境。',
    'ui.booting': '正在读取…',
    'ui.bootingSlow': '版本清单要问一次 npm,慢的是这一步',
    'ui.machineCard': 'dsh 本体',
    'ui.pull': '下载',
    'ui.customVersionPh': '或直接填版本号,例如 0.0.1-rc.1',
    'ui.enginePathPh': '或者贴一个文件夹:自己构建的 dsh,或某个自带 dsh 的应用',
    'ui.usePath': '用这个文件夹',
    'ui.pathNeeded': '先把文件夹路径贴进左边那个框',
    'ui.pullNotAPath': '这是个文件夹,不用下载——它已经在你机器上了。点上面那一格就能用它',
    'ui.pathChipUnstarted': '还没起过',
    'ui.forgetTitle': '从这儿去掉(不会删你的文件夹)',
    'ui.forgetAsk': '把「{where}」从这儿去掉?',
    'ui.forgetBody': '只是 dsh-box 不再记得它。<b>你的文件夹不会被删</b> —— {path} 原地不动,随时可以再贴一次路径。用过它的沙箱会同时清掉模块指针层,下次启动 dsh 自己会重建。',
    'ui.forget': '去掉',
    'ui.forgotMsg': '已不再记得 {path};那个文件夹没有动过',
    'ui.sourceLabel': '安装源',
    'ui.sourceAuto': '自动',
    'ui.sourceOfficial': '官方 npm',
    'ui.sourceMirror': '中国镜像',
    'ui.olderVersions': '更早的内测版本',
    'ui.cabinetCard': '档案柜',
    'ui.newSandboxPh': '新沙箱档案柜的名字',
    'ui.newSandbox': '新建',
    'ui.ghostDeleted': '这一场里被删掉了',
    'ui.signInHave': '已登录',
    'ui.signInNone': '未登录',
    'ui.signInGoing': '将拿掉',
    'ui.signInWillImport': '将导入',
    'ui.signInDailyNote': '这是你自己的登录;取消勾选会把它拿掉,没有备份',
    'ui.signInSandboxNote': '勾上＝把你的登录复制进来;取消＝从这台沙箱拿掉',
    'ui.importSignIn': '导入登录凭据',
    'ui.importSignInNote': '只对新建的沙箱档案柜有意义',
    'ui.pluginsCard': '这个档案柜的插件',
    'ui.pluginDirPh': '插件目录路径(里面要有 package.json)',
    'ui.browse': '浏览…',
    'ui.addPlugin': '添加',
    'ui.npmNamePh': 'npm 包名(如 dsh-memory-pyramid)',
    'ui.npmInstall': '从 npm 装入',
    'ui.npmCancel': '停止下载',
    'ui.npmCancelled': '已经停掉「{name}」的下载。',
    'ui.npmNote': '从 npm 下载并装进上面选中的沙箱档案柜。日常档案柜走命令行:get plugin <包名> --to main',
    'ui.npmBadName': '「{name}」不是合法的 npm 包名,没有发出命令。',
    'ui.npmInstallingHead': '正在从 npm 下载并装入 {name}…(可能要几分钟)',
    'ui.npmInstalled': '「{name}」已装进「{cabinet}」。',
    'ui.npmBrought': '这个包带来了 {count} 个插件。',
    'ui.runningCard': '正在运行',
    'ui.quit': '退出 dsh-box',
    'ui.lockedHint': '外面有命令正在跑,这个操作暂不执行 —— 等它跑完再按一次',
    'ui.cancel': '取消',
    'ui.ok': '确定',
    'ui.notice': '提示',
    'ui.approvalTitle': '有一步要你点头',
    'ui.approvalAllow': '允许',
    'ui.approvalDeny': '拒绝',
    'ui.dontAskAgain': '下次不再提醒',
    'ui.dropDontAskNote': '之后动到日常档案柜时直接执行',
    'ui.dropConfirm': '卸下并移除',
    'ui.quitDontAskNote': '之后关闭时直接按这次的选择执行',
    'ui.quitConfirm': '停下并退出',
    'ui.staleStuck': '刷新过一次还是对不上通行证。请手动重新打开配置窗(命令行:dsh-box ui)。',
    'ui.requestFailed': '请求失败({status})',
    'ui.commandFailed': '命令失败({code})',
    'ui.unknown': '未知',
    'ui.boxPath': '数据目录 {box} · 过程日志在其 logs 子目录',
    'ui.dailyCabinet': '日常档案柜',
    'ui.runMainNote': '非沙箱,用的是你日常的 ~/.dsh',
    'ui.engineHost': '本机',
    'ui.engineRelease': 'dsh-box 下载的',
    'ui.stop': '停止',
    'ui.notDownloaded': '未下载',
    'ui.pinnedShort': '{count} 包已核对',
    'ui.mixedShort': '版本混杂,请重新下载',
    'ui.deleteVersionTitle': '删除这个版本',
    'ui.deleteVersionAsk': '删除 {version}?',
    'ui.deleteVersionBody': '约 200–260MB。用过它的沙箱下次启动前要重新下载。',
    'ui.delete': '删除',
    'ui.deletingHead': '正在删除 {version}…',
    'ui.deletedMsg': '{version} 已删除。',
    'ui.hostChip': '本机 {version}',
    'ui.machineHintHost': '默认用本机这台。下载的版本用来试新版或旧版。',
    'ui.machineHintNoHost': '这台电脑上没有装 dsh,所以只能用下载的版本。',
    'ui.pluginHintMain': '装进日常档案柜就一直在,你自己敲 dsh 也会加载。想试一下就用沙箱。',
    'ui.pluginHintSandbox': '装进这个沙箱就一直在,不是只有这次启动才有。想要纯官方的就新建一个沙箱。',
    'ui.unreadableWarn': '这个档案柜的插件配置读不懂,下面这份可能不全。在有人看过之前不会去动它——命令行可以整份退回上一步:set plugin --undo',
    'ui.willRemoveNote': '按下启动时会从这个档案柜拿掉',
    'ui.installedHereNote': '已经装在这个档案柜里',
    'ui.tagGoing': '要拿掉',
    'ui.tagHave': '已装',
    'ui.tagAdd': '这次装上',
    'ui.tagNot': '没装',
    'ui.tagTheirs': '本来就有',
    'ui.theirsNote': '这个档案柜本来就有的,不是 dsh-box 装的,这里动不了',
    'ui.missingPlugin': '{label} —— 文件夹已经不在了,装不上',
    'ui.noPlugins': '这个档案柜一个插件都没有,是纯官方的 dsh。',
    'ui.dailyNote': '你天天用的 ~/.dsh',
    'ui.lastVersion': '上次 {version}',
    'ui.hostSuffix': '(本机)',
    'ui.freshNote': '还没建,启动时建',
    'ui.cabinetHintMain': '日常档案柜只有一个,所以同时只能有一台 dsh 指向它。',
    'ui.cabinetHintSandbox': '沙箱档案柜各有自己的对话与配置,彼此看不到对方的。',
    'ui.adoptBtn': '对话并入日常档案柜',
    'ui.adoptAskTitle': '并入日常档案柜?',
    'ui.adoptAskBody': '把「{name}」的 {sessions} 条对话复制进你日常的 ~/.dsh。',
    'ui.adoptAskNote': '沙箱里的原件保留,已经存在的对话会跳过,所以重复执行是安全的。',
    'ui.adoptOk': '并入',
    'ui.adoptDone': '已并入 {adopted} 条,跳过 {skipped} 条重复。下次打开 dsh 即可看到。',
    'ui.deleteSandboxBtn': '删除这个沙箱',
    'ui.deleteSandboxAsk': '删除「{name}」?',
    'ui.deleteSandboxBody': '连同它的 {sessions} 条对话、配置和登录一起删掉,删了就没有了。',
    'ui.startMain': '正常启动',
    'ui.startSandbox': '启动沙箱',
    'ui.recallLiveOpen': '收起外面正在做的 {count} 步',
    'ui.recallLiveClosed': '展开外面正在做的 {count} 步',
    'ui.recallPastOpen': '收起最近的 {count} 步操作',
    'ui.recallPastClosed': '回看最近的 {count} 步操作',
    'ui.refusedLine': '被拒 {code}:{message}',
    'ui.trailHead': '这个数据目录最近的 {count} 步',
    'ui.outsideBusy': '外面有人在动',
    'ui.outsideRun': '进程 {pid} 正在 <b>{name}</b>({ago})',
    'ui.secondsAgo': '{count} 秒前',
    'ui.minutesAgo': '{count} 分钟前',
    'ui.hoursAgo': '{count} 小时前',
    'ui.pullNeedsVersion': '先填一个版本号,或在上面选一个要下载的版本——「你自己装的那台」不是从 npm 下的,没法下载。',
    'ui.pullingHead': '正在下载 {version}…',
    'ui.pullDone': '{version} 已就绪:{packages} 个包已核对。',
    'ui.startingHead': '正在启动…',
    'ui.sandboxQuoted': '沙箱「{name}」',
    'ui.startedMsg': '{where}已启动,用的是{engine} {version}。',
    'ui.openUrl': '打开 {url}',
    'ui.nameRule': '名字可用:{rule}',
    'ui.quitRowSandboxNone': '沙箱　　　没有在跑的',
    'ui.quitRowSandbox': '沙箱　　　{count} 台在跑:{names}',
    'ui.quitRowMainHere': '档案柜　　本机档案柜从这里启动着(进程 {pid}),也会停 —— 停它要你再点一次头',
    'ui.quitRowMainForeign': '档案柜　　3080 上有一台,不是从这里启动的,认不出进程,不会去动',
    'ui.quitRowMainNone': '档案柜　　没有从这里启动的',
    'ui.quitPoint1': '1. <b>沙箱只是停下</b>,对话与配置都还在,下次启动同名的接着用。',
    'ui.quitAlsoMain': ',日常档案柜也停了(进程 {pid})',
    'ui.quitDoneTitle': '已退出',
    'ui.quitDoneBody': '已停下 {count} 台沙箱{alsoMain}。这个页面可以关掉了。',
    'ui.partialStopped': '做了一半:已停下 {names};日常档案柜那台还在,等你在闸门那儿点头。',
    'ui.stateUnreadable': '读不到状态:{error}',
    'ui.dropRowPlugin': '插件    {label}',
    'ui.dropRowPlaces': '装在    {places}',
    'ui.dropPoint1': '1. <b>连日常档案柜一起卸</b>,改的是那个档案柜自己的配置,所以你直接敲 dsh 也会跟着变。',
    'ui.dropPoint2Downloaded': '2. <b>下载的那份包也会删掉</b>,要用再下一次。',
    'ui.dropPoint2Yours': '2. <b>你自己那个文件夹不动</b>,只去掉链接与登记。',
  },

  en: {
    'lang.name': 'English',
    'cmd.ls.summary': 'The whole picture right now: data directory, releases, sandboxes, what is running',
    'cmd.ls.machine.summary': 'Which dsh can be used: the one installed here, the downloads, the folders you named',
    'cmd.ls.sandbox.summary': 'List the sandboxes',
    'cmd.ls.memory.summary': 'What was done during the last takeover, refusals included',
    'cmd.ls.plugin.summary': 'With a cabinet, what it actually has; without one, everything this computer can name',
    'cmd.ls.plugin.notes': `After --in write a sandbox name, or main for your everyday cabinet.
Without --in the question is a different one: not "what does that cabinet have"
but "which plugins can this computer name at all" — what the cabinets actually
hold, plus what we have downloaded, as one list.
⭐ That list is where get plugin gets its ids: whatever the daily cabinet holds
   is something you can move by name.
⭐ With --in, the answer is read from that cabinet's own config rather than from
   our books: every row shows up, whoever wrote it, marked as ours or as one the
   cabinet already had.`,
    'cmd.get.machine.summary': 'Download an official release (every package version checked). A folder needs no download; give its path to start',
    'cmd.get.plugin.summary': 'Install a plugin into one cabinet, for good, until you take it out; name none and everything --from holds is installed there instead',
    'cmd.get.plugin.notes': `Naming one or naming none is two readings of one command:
  get plugin <name> --to <cabinet>            that one
  get plugin --from <A> --to <B>              install everything A holds into B as well

⭐ The whole-cabinet form is the single one repeated, not a second feature: one
   gate, one backup, and every plugin attempted and accounted for.
   ⛔ Direction is an argument, not a feature — both ends are names, so "the daily
   cabinet's setup into a sandbox" and "push it back the other way" are the same
   command, and the reverse needed no implementation at all.
   ⛔ What travels is the configuration — which plugins — not the resolved files.
   The destination resolves them again against its own dsh, so two cabinets on
   different dsh versions never inherit each other's links.
   ⚠️ One that cannot be installed does not stop the rest: every one is attempted,
   and the answer splits into copied / alreadyThere / missing (the source's folder
   is gone) / refused (each with its own code).

When one is named, what the word after the verb is decides how it is read; no
flag says which:
  an existing folder      installed from disk
  an id ls plugin lists   the copy this computer already has, put into --to
  anything else           an npm package name to download

⭐ The second reading is how a plugin the daily cabinet holds gets into a sandbox:
   the name comes from the ls plugin list, and that list is derived from what the
   cabinets actually hold, so nothing has to be registered first.
⭐ When two cabinets hold different folders under one id, --from says which one to
   take; without it the lookup is across the whole machine.
After --to write a sandbox name, or main for your everyday cabinet; a name that
does not exist yet creates that sandbox on the way past.
What goes in is written into that cabinet's own profile config, so typing dsh
yourself loads it too, not only when the launch came from here. Take it back out
with rm plugin.
⭐ The file is backed up in full before it is touched; set plugin --undo walks
  back through those copies one step at a time.
⛔ --to main is refused (NEEDS_APPROVAL): that is the cabinet your own dsh reads,
  so a person has to agree in the config window first.
⚠️ One npm package at a time — two npm runs writing the same package directory
  corrupt it.`,
    'cmd.rm.machine.summary': 'Take one dsh out of here: a release we downloaded is really deleted, a folder you named is only forgotten',
    'cmd.rm.plugin.summary': 'Take a plugin out of one cabinet',
    'cmd.rm.plugin.notes': `A cabinet names plugins in three places, and this covers all three:
  · a row we wrote into the profile patch — the row is removed
  · an aggregate — the dozen-odd rows it brought go with it
  · dsh.profile.bundles in the profile — taken out of **both** bundles and dependencies

⛔ Out of bundles alone is out of nothing: dsh reconciles against dependencies
   after every dsh plugin command and puts back anything still declared there
   that still exports a patch. So both, or it did not happen.
⛔ A plugin from a folder of your own is only unlinked; its files are untouched.
   The copy we downloaded goes only once no cabinet is using it any more — that
   is not a tidy-up anybody should have to run.
⚠️ A row that is neither ours nor a bundle cannot be taken out — somebody else
   wrote it. Use set plugin <id> off, which is how "remove" is spelled here.
⛔ --from main is refused (NEEDS_APPROVAL) until a person has agreed in the
   config window.`,
    'cmd.set.plugin.summary': 'Switch a row on or off, or take the whole plugin config one step back',
    'cmd.set.plugin.notes': `⭐⭐ Switching off is how "remove" is spelled in this format, and the only way to
   act on something this tool did not install: the patch format has no remove at
   all. A row in a lower layer can be overridden and never deleted. The profile
   patch sits after every bundle layer, so a disabled: true row here reaches a
   plugin a bundle brought in — exactly how upstream switches off its own telemetry.
⛔ Only what we switched off can be switched back on. A disabled row somebody else
   wrote is their decision, and undoing it quietly is overruling them.
⭐⭐ --undo goes back one step each time it is run, up to five, and says how many
   are left; a step walked back over is used up.
   --at <timestamp> is "jump to that moment" instead: the history stays, and the
   current file is backed up first.
⭐ --undo is the way out when precise removal cannot reach: if the file has been
  edited elsewhere into a shape we no longer recognise, removing our entries one
  by one finds nothing to remove, and the whole file goes back instead.
⚠️ Only the daily cabinet keeps snapshots. A sandbox is a clean start you throw
  away, so --undo on one always answers "no backup".
⛔ --in main is refused (NEEDS_APPROVAL) until a person has agreed in the config
   window.`,
    'cmd.ls.history.summary': 'Everything ever done in this data directory (the permanent record)',
    'cmd.ls.history.notes': `⛔ Not the same thing as ls memory. Do not mix them up:
  ls memory   what an agent did while it last held the window: a display, and the
              next session overwrites it
  ls history  everything this data directory has ever done: permanent, append-only

Without --lines you get the last {historyLines}. How much was left out is said
out loud, and the path to the whole file comes with it.
--lines 0 is everything; --shape answers only "how big, from when to when, how
  many failed", and that answer is a few lines however long the record is.

⚠ Only commands that change something are recorded. At 2MB it rotates (.1), and
the generation before that is dropped.`,
    'cmd.ls.workspace.summary': 'Which workspaces this cabinet has seen (the first one is what it opens into)',
    'cmd.ls.workspace.notes': `⚠ Two words, and they are not two of a kind:
  cabinet    one DSH_HOME, holding conversations, config and sign-in. That is
             what goes after --in.
  workspace  the project folder dsh actually works in. That is what this
             command manages, and it is dsh's own word for it.
  A cabinet holds a list of "workspaces this one has seen", and that list is
  what this command shows.

⛔ dsh does not register its startup directory as a workspace. Measured: a
  freshly started one has an empty list, so somebody has to pick a workspace
  once inside dsh's page. And dsh web has no flag for it (only --host / --port
  / --trusted-host), which is exactly why this command exists.
⛔ There is no control for this in the config window and there will not be: a
  person can pick it inside dsh. This one is for agents.`,
    'cmd.set.workspace.summary': 'Make this cabinet open into this workspace next time',
    'cmd.set.workspace.notes': `One already on the list moves to the front; one that is not gets added.
⛔ Nothing is ever removed, and which conversation belongs where is not touched.
⚠ This writes dsh's own file ($DSH_HOME/storages/workspace.json). Its version is
  checked first and an unfamiliar one is refused: one wrong field in that table
  and dsh will not start at all (measured).
⛔ --in main is refused (NEEDS_APPROVAL) until a person has agreed in the config
   window.`,
    'cmd.stop.summary': 'Stop one running thing: a dsh, every sandbox, the config window, or the download',
    'cmd.stop.notes': `⛔ Only an everyday cabinet started from here can be stopped; that one has a
   process id we can name. One you started elsewhere yourself is something we
   only see as "3080 answers", so we leave it alone.
⛔ Stopping the everyday cabinet needs a person on the panel (stop main, or --all
   when it reaches that one): it is the thing you work in, whatever that session
   held is gone once it stops, and somebody else may be using it too.
⭐ --all stops the sandboxes first and asks about the everyday one last. Sandboxes
   always stop; the refusal happens only at that final step, and it names which
   ones were already stopped. The common path — tidying up after yourself — never
   meets a dialog.
⭐ Sandboxes are only stopped, never deleted; starting the same name continues them.
⭐ --window is not needed for an ordinary close: the window lets go of its seat
   itself. It is for the other case — the exe is killed while the Node service it
   started outlives it on Windows, the seat and port stay taken, and ui is refused
   from then on. When the process on the seat is gone it says there is no window
   open and clears the leftover record, rather than pretending to have stopped
   something.
⛔ --download takes the whole process tree: what hangs is usually not npm itself
   but a dependency's install script. To see what it is doing: logs --package <name>.
⚠ The four are unrelated: --all closes no window, --window stops no sandbox, and
  --download touches only that download's process tree.
⚠ There is no long-running dsh-box process to close: every command is its own
  small process that exits when it is done, so "stop everything" can only be
  something done. Ctrl+C on the ui process is not it either; that ends one command.`,
    'cmd.start.summary': 'Start. Without --version this uses the dsh you installed yourself',
    'cmd.start.notes': `start = picking two things: which dsh (the machine) × which cabinet (DSH_HOME)
  machine  unset               the dsh you installed yourself
           --version <release>  the one dsh-box downloaded
           --version <folder>   the dsh you point at (a / or \\ in it means folder)
  cabinet  a sandbox name for that one | --new a fresh one | main for your own ~/.dsh

⚠ Nothing carries over from last time: omitting the cabinet is refused, and
  omitting --version means the machine this computer has.
  The same command always gives the same result.
⚠ This says nothing about which workspace (project folder) dsh opens. That is
  what set workspace is for, and dsh does not register a workspace just
  because it was started in one. Measured.
⭐ A plugin is a property of the cabinet, not of this launch: leaving out
  --plugin does not mean "install none", it means "change nothing". Whatever
  this cabinet already had still loads, and it loads when you type dsh too.
  For plain official dsh, make a new sandbox.
Sandbox names may use letters (Chinese is fine), digits, _ . - ; no spaces, not
starting with - or ., and not main — that name belongs to the everyday cabinet.

⭐ Given a folder, --version looks three levels down for either of two things: a
  dsh lying on disk (built from source, or an ordinary install), and a dsh that
  ships inside an application (its whole tree packed into app.asar, readable
  only by the program shipped beside it — so that program is what starts it).
  The pin check reports what it finds and does not refuse: that tree is not one
  dsh-box installed.

main names a cabinet, not a machine. main together with any dsh other than the
one you installed yourself — a download, or a folder you point at — is the one
combination that cannot be undone: on-disk formats have no migration path
between releases, and while that dsh runs, this home's module pointers aim into
that installation.
⛔ So that one square is refused (NEEDS_APPROVAL) until a person has clicked
  through it in the config window. No flag gets around it: on refusal dsh-box
  opens the config window itself and waits, and once a person allows it, that
  window is what runs the command.`,
    'cmd.get.chat.summary': 'Copy conversations from one cabinet into another (a copy, not a move)',
    'cmd.get.chat.notes': `Both ends are cabinets: a sandbox name, or main for your everyday one.
The common one is collecting a sandbox's conversations into the daily cabinet:
  get chat --from <sandbox> --to main
The other direction, and sandbox to sandbox, are the same command written differently.

⭐ Copied, not moved: the originals stay where they were, and anything the
  destination already has is skipped, so running it again is safe.
⛔ Refused while a dsh is running on the destination: dsh scans the conversation
  directory only at startup, so anything copied in while it runs stays invisible
  to it. Add --force if you are sure; they appear the next time it starts.`,
    'cmd.rm.sandbox.summary': 'Delete a sandbox and everything in it',
    'cmd.ls.setting.summary': 'The current settings, and whether this copy is on PATH and how many copies are',
    'cmd.ls.setting.notes': `Every row has a command that changes it: set source / set lang / set ask-on-quit
/ set ask-on-daily. PATH is a setting too — the switch is set path on|off — which
is why it belongs in the same table as the rest.
⚠️ The PATH part only means anything on Windows. Elsewhere PATH belongs to your
  shell config, which is not a launcher's to edit, so it says so and stops.
⛔ When the settings file cannot be read this cannot read it either. That is what
  rm setting is for: archive it and start from empty.`,
    'cmd.set.source.summary': 'Change where releases come from: auto | official | mirror',
    'cmd.set.lang.summary': 'Change the language: {options}',
    'cmd.set.lang.notes': `The language is a setting of this data directory, not a preference of the page:
the command line and the config window change together, so the two can never be
in different languages. The switch in the window's corner runs this command.

Unset means "whatever this computer is set to". Once it has been set, that
setting wins and the environment is no longer consulted.
⛔ Error codes (PLUGIN_NAME_TAKEN and the like) and the markers written into your
  config files are not translated: they are data rather than speech, and moving
  them with the language would leave both scripts and this tool unable to
  recognise what they wrote.`,
    'cmd.set.ask-on-quit.summary': 'Whether closing the config window warns that it stops every sandbox',
    'cmd.set.ask-on-daily.summary': 'Whether to warn before touching your everyday cabinet',
    'cmd.rm.setting.summary': 'When the settings file cannot be read: archive it and start from empty',
    'cmd.rm.setting.notes': `Only needed when another command reports CONFIG_UNREADABLE.
⛔ The old file is renamed and kept, not deleted: it records what you picked last
time, and the archive is where to go looking for it.
Afterwards the settings are back to factory, but plugins already installed in
cabinets are entirely unaffected: those live in each cabinet's own config.`,
    'cmd.set.path.summary': "Put this exe's folder on your own PATH, or take it back off",
    'cmd.set.path.notes': `After on, typing dsh-box works in newly opened terminals; already open ones have
to be reopened. off is the reverse.
Only your own PATH is written (HKCU\\Environment), never the machine's, and no
administrator rights are needed.
⭐ Only this one entry is added, and nothing else in your PATH is tidied up; a copy
of it as it was goes into env-path in the data directory first.
⛔ The npm install does not need this: npm puts its own shim in its global folder,
which is already on PATH.
⚠️ Refused when another dsh-box is already on PATH — with two of them there, which
one the name reaches depends on the order. Pass --force to make this one win.
⭐ This one changes the computer, not this data directory. It belongs to set
  because it really is a switch, and because a portable copy has to run it once
  itself (the installer does it for the installed build).`,

    'path.windowsOnly': 'This command only means anything on Windows. Elsewhere PATH belongs to your shell config, which is not a launcher\'s to edit.',
    'path.noExe': 'This command has to be run by the dsh-box exe itself. The npm install does not need it: npm has already put its shim in place.',
    'path.noExeShort': 'This run did not come from the exe, so there is no folder to register.',
    'path.hereOn': 'This copy: {dir} (on PATH)',
    'path.hereOff': 'This copy: {dir} (not on PATH)',
    'path.copies': 'dsh-box copies on PATH: {count}',
    'path.dead': '{count} more PATH entries point at folders that no longer exist (not this tool\'s business, just telling you)',
    'path.already': 'Already on PATH, nothing done: {dir}',
    'path.notThere': 'Was not on PATH, nothing done: {dir}',
    'path.anotherCopy': 'Another dsh-box is already on PATH: {dir}. With both there, which one the name reaches depends on the order. Pass --force if you want this one to win.',
    'path.added': 'Added to PATH: {dir}',
    'path.removed': 'Removed from PATH: {dir}',
    'path.reopen': 'Open a new terminal for this to take effect; the ones already open still have the old value.',
    'path.noPowershell': 'PowerShell would not start, so PATH cannot be read or written: {why}',
    'path.registryRefused': 'Reading or writing PATH was refused: {why}',
    'path.tooLong': 'Your PATH is {length} characters, which is long enough that this command will not touch it — breaking somebody\'s PATH is far worse than being one command short. Please add this folder yourself.',
    'path.mismatch': 'Reading it back does not match what was written: {wrote} characters in, {read} out. The original is in env-path in the data directory.',
    'path.kindChanged': 'Reading it back, the value kind changed from {was} to {now}. The original is in env-path in the data directory.',
    'cmd.ui.summary': 'Open the config window',
    'cmd.ui.notes': `One data directory has one window service. It lets go of its seat when it closes,
so an ordinary close needs nothing else; to close it from the command line, use
stop --window.
⛔ Running it again while one is open does not open a second: it reports the
  address of the one already serving. For a second view, open that address in a
  browser again.`,
    'cmd.logs.summary': 'What a cabinet said the last time it started; --package shows an npm plugin download',
    'cmd.logs.notes': `⭐ Ask --shape first and then decide whether to read: however big the log is,
that answer is a few hundred characters.
By default you get the last 50 lines or 4000 characters, and it says how much
was left out and where the whole file is.`,
    // See the note on the Chinese block: one sentence per command, about the
    // state a caller is in when it returns.
    'cmd.ls.after': 'This only looked, and it never goes to the network, so it is always fast. It is the overview: one row per sandbox, plugins as counts only (ours / theirs / platform); paths are on ls sandbox, what one cabinet holds is on ls plugin --in <cabinet>',
    'cmd.ls.sandbox.after': 'This only looked. One row per sandbox with its paths (root / home / patchFile), plugins still as counts; what one holds is on ls plugin --in <sandbox>',
    'cmd.ls.machine.after': 'Nothing changed; this only looked. To download one, use get machine <release>',
    'cmd.ls.plugin.after': 'This only looked. To really put one into a cabinet, use get plugin',
    'cmd.ls.setting.after': 'This only looked. Every row here has a set command that changes it',
    'cmd.get.machine.after': 'Returns only when the download is done, which can take minutes. After that, start <cabinet> --version <release> can choose it; to watch it meanwhile, use logs --version <release>',
    'cmd.get.plugin.after': 'That cabinet now keeps it, so plain dsh loads it too. A name after --to that does not exist yet creates that sandbox on the way past. A dsh already running has to be restarted for this to take effect. When the copy came from somewhere this computer already had it, that other cabinet loses nothing',
    'cmd.get.signin.after': 'That sandbox has a sign-in. If it already had one, nothing is done (imported is false); to swap keys, rm signin first',
    'cmd.get.chat.after': 'The target cabinet has those conversations and the source still has all of its own. Refused while the target is running; with --force they appear at its next start. When the two sides last ran different dsh versions one more line is printed: a session log carries a format version, an unknown one is refused whole, and the logs are compressed so this tool cannot look — which makes that a heads-up rather than a verdict',
    'cmd.rm.machine.after': 'Given a release: it is off the disk, and refused while a sandbox is using it. Given a folder: only our record of it goes — not one byte of yours is touched — and the sandboxes that used it have their module pointer layer cleared (dsh rebuilds it at the next boot). Refused when no sandbox ever used it, so a hollow "done" cannot mislead',
    'cmd.rm.plugin.after': 'Taken out of this cabinet; if no other cabinet is still using it, the copy we downloaded is deleted too (listed in deletedPackages), so putting it back means downloading again. A plugin from a folder of your own is only unlinked — its files are untouched',
    'cmd.rm.sandbox.after': 'That sandbox and its cabinet are gone, and it cannot be undone. Refused while it is running, so stop it first',
    'cmd.rm.signin.after': 'That cabinet has no sign-in; not one conversation inside it is touched',
    'cmd.rm.setting.after': 'The unreadable settings file is renamed aside and the settings are back to factory. Plugins already installed in cabinets are untouched',
    'cmd.start.after': 'This blocks: it waits until dsh is really serving before returning. Re-opening a sandbox that already exists takes about 5 seconds; creating one takes about 25, because a cabinet has to be laid out first. The ceiling is 120s for both (BOOT_TIMEOUT past that). Once it returns, dsh is left running in the background and this command does not babysit it. The output carries sandbox (what this one is called, which is how --new tells you), url, pid, port and logFile, plus elapsedMs — how many milliseconds this run took from receiving the command to dsh answering. Set your own timeout from that, not from the two round numbers above. It also carries cabinetPlugins (what this cabinet holds now) and pluginsChanged (what this run altered, usually nothing). To actually send a message inside it, the cabinet also needs a project workspace via set workspace, or the model menu is empty. Stop it with stop <cabinet>; add --follow to stay and watch the log instead (which never returns — Ctrl+C to stop)',
    'cmd.stop.after': 'The named thing is stopped and nothing is lost: a sandbox and its cabinet stay (start brings it back), a half-finished download stays where it is and the next install of the same package writes over it, and the config window releases its seat and port (ui opens one again)',
    'cmd.set.plugin.after': 'After off the row is still in the file but the next start will not load it; after on it loads again. --undo puts the whole plugin config back as it was one step ago and says how many steps remain; run it again to go back one more',
    'cmd.set.workspace.after': 'Returns as soon as it is written. That cabinet opens in this workspace next time; a dsh already running is unaffected',
    'cmd.set.source.after': 'The next download uses the new source',
    'cmd.set.lang.after': 'Command line and config window changed language together; a page already open needs one reload',
    'cmd.set.ask-on-quit.after': 'The switch changed; the config window follows it the next time quit is pressed',
    'cmd.set.ask-on-daily.after': 'The switch changed; command line and config window both follow it',
    'cmd.set.path.after': 'After on, a newly opened terminal can type dsh-box on its own while terminals already open still read the old PATH; after off that entry is gone. The value from before the change is kept in env-path under the data directory',
    'cmd.ui.after': 'Does not return: it serves until something stops it. The address is printed above, and other terminals can keep running commands. To stop it, use stop --window',
    'cmd.logs.after': 'This only looked. At most the last 50 lines or 4000 characters by default, saying how much was left out and where the whole file is',

    // ── The third face: MCP. Tool table, bindings and verdict mapping are all generated (src/mcp.js); only the words live here.
    'cmd.mcp.summary': 'Offer every command here to an agent as an MCP server (one JSON-RPC message per line over stdio)',
    'cmd.mcp.after': 'Does not return: it serves until the client closes its input. Every tool call runs the command of the same name in the background (with --json and --box), and that one JSON line is the answer; every command except ui and mcp itself is a tool of the same name',
    'cmd.mcp.notes': `Hooking it up (.mcp.json for Claude Code and similar clients):
  {"mcpServers":{"dsh-box":{"command":"dsh-box","args":["mcp","--box","<data directory>"]}}}
  ⭐ --box is the command line's --box: every call this server takes is about that one data directory. Spell it out, because
  the working directory a client starts the server in is not always the one you expect; without it the default rules under common options apply.
Tool names are command names with an underscore between the two words: ls_sandbox, get_plugin, start, stop (the name a client
  shows its model may not contain a dot, so the underscore is written at the source and what you see is what was declared).
Argument names: flags without the -- (to, no-sign-in); positionals use their declared names, as the tool's inputSchema states them —
  the same as params[].name in --help --json (e.g. get_plugin's positional is source, rm_sandbox's is sandbox).
  Boolean flags take true; a flag marked repeatable (...) takes an array: {"plugin":["a","b"]}.
Verdicts: every answer carries verdict (ok / failed / partial / error); only error is marked as a tool error (isError).
  failed and partial are judgements about the thing you asked about, not a broken tool.
⛔ One rule: whatever never returns is not a tool, whether it is a command or a flag — ui (serves forever),
  mcp itself, start's --follow (watches the log forever). There is no need to call ui for the panel: actions that need
  a person (touching the daily cabinet) make the command line behind the call open the config window and wait a minute for a click.`,
    'mcp.after': 'Afterwards: ',
    'mcp.cliEquivalent': 'Command-line equivalent: ',
    'mcp.truncationHint': 'Narrow with --lines, or ask --shape first and decide which part to read.',
    'mcp.instructions': 'Every tool is the {program} command of the same name (dots in the tool name become spaces), run against the data directory {box}. The answer is one JSON line whose verdict has four tiers: ok answered / failed a judgement about the thing you asked about / partial half done, the answer says which half / error the request or this tool. Only error is marked isError.',
    'mcp.unknownTool': 'No tool called {name}. Available: {tools}',
    'mcp.strayArgument': '{tool} does not take these arguments: {names}. It takes: {allowed}',
    'mcp.strayArgumentNone': '{tool} does not take these arguments: {names}. It takes no arguments at all',
    'mcp.noOutput': 'The command line exited with code {code} without printing its JSON line',
    'mcp.cannotRun': 'Could not start the command line: {error}',
    'mcp.tooLarge': 'The command answered, but the answer is {chars} characters, over this server\'s limit of {limit}; head holds the first part. {hint}',
    'cmd.mcp.param.max-chars': 'Longest answer handed over whole; anything bigger is replaced by a partial stand-in line (with the first part and the real size). Default 20000',

    'help.title': 'dsh-box — run DeepSeek Harness in an isolated sandbox',
    'help.perCommand': 'Detail on one: help <command> or <command> --help (for example, help start). [options] in a usage line means the rest of the argument table on that page',
    'help.machineReadable': 'Machine-readable: --help --json gives the table this command line is driven by',
    'help.common': `Common options: --json prints the result as JSON, for scripts and agents.
  Success is one line {"box":…,"ok":true,…}, failure is one line {"box":…,"ok":false,"code":…}.
  The code is a fixed identifier; the message is for people and may be reworded at any time.
Verdict and exit code: every JSON line carries verdict; the exit code is its projection.
  ok 0 answered / failed 1 a judgement about the thing you asked about (sandbox not there,
  dsh did not boot, the gate refused; the request was fine, the world said no) / error 2
  the request or this tool (unknown command or option, a crash, something unreachable;
  says nothing about any sandbox) / partial 3 half done, then refused; the answer names
  what was done (stop --all: sandboxes down, the everyday cabinet held by the gate).
Data goes in ./dsh-box-files/data by default (change it with --box <folder> or DSH_BOX_HOME).
  If that folder is already somebody else's, a free one beside it is used instead and the
  JSON carries boxAsked (what you named) next to box (what was used). Exit code stays 0.
--help --json also reports boxVersion: which build of this tool answered.
The JSON shape is versioned: every line carries schema. Bare --json is shape 1 for good,
  --json=1 spells it out; asking for a shape this build lacks is refused (JSON_SCHEMA_UNKNOWN)
  rather than answered in an older one.
Options belong to commands: a command takes only what help <command> lists, plus
  --json / --box / --help. Another command's option is refused (FLAG_NOT_HERE, naming
  whose it is); a value option given twice is refused too (FLAG_TWICE) unless it is
  marked repeatable.`,
    'help.flags': 'Arguments',
    'help.after': 'When it returns',
    'help.required': 'required',
    'help.mutates': 'Changes something, so it goes into the record',
    'help.readOnly': 'Read-only; changes nothing',
    'help.noSuchTopic': 'There is no command called "{topic}". Run with no arguments to see them all',
    'help.unknownCommand': 'Unknown command "{command}". Run with no arguments to see how it is used',
    'help.familyTitle': '"{verb}" takes one of these {count} objects',

    'sandbox.created': 'Sandbox "{name}" created',
    'sandbox.reused': 'Sandbox "{name}" reused',
    'sandbox.ownConversations': 'Its conversations belong to it alone; no other sandbox can see them',
    'sandbox.signInImported': 'sign-in imported',
    'sandbox.plain': 'Nothing extra in this cabinet: plain official dsh',
    'sandbox.holds': 'This cabinet holds: {names}',

    'launch.starting': 'Starting {version} on port {port}',
    'launch.readyAnnounced': 'Ready: dsh announced it is serving on port {port} (it only says that once its plugin tree is through) and the process is still up',
    'launch.readyProbed': 'Ready: dsh never printed that line, so this was settled by probing the page (boot manifest present) and the process is still up',
    'launch.portTaken': 'Port {port} was taken just now, most likely by another launch starting at the same moment. Retrying on {next}',
    'launch.needsExposeInternals': 'This Node cannot reach the internal loader, so it starts with --expose-internals. Without it dsh will not come up and plugins will not resolve',
    'launch.noProcessProof': 'Refusing to stop process {pid}: no identity was given for it. Process ids get recycled, so without one there is no way to show it is still ours.',
    'launch.clearedModuleLinks': 'Cleared module links that could point at the wrong release; boot rebuilds them',
    'launch.open': 'Open {url}',
    'launch.realKey': 'This uses your real API key, so conversations here are billed',
    'launch.noKey': 'This cabinet has no sign-in; add an API key inside it before it can talk to a model',
    'launch.sessionOnlyKey': 'The credentials in this cabinet are only a browser session dsh signed for itself, not an API key — add one before it can talk to a model (start --sign-in copies one from your daily cabinet)',
    'launch.unreadableKey': 'This cabinet has a credentials document in a shape this tool cannot read, so whether it holds an API key is not something it will claim either way — go and look',
    'launch.logAt': 'Log {file}',
    'launch.detached': 'Running in the background (process {pid}). To stop it: stop {name}',
    'window.alreadyServing': 'This data directory already has a config window at {url} (process {pid}). For a second view, open that address in a browser again. If it is an orphan left by a kill, clear it with stop --window',
    'window.noneServing': 'This data directory has no config window open',
    'window.stopped': 'Config window closed: {url} (process {pid})',
    'window.gone': 'Process {pid} on the seat is somebody else now, so nothing was stopped. The record has been cleared',
    'launch.sandboxStarting': 'Another process is starting sandbox "{name}"; wait for it to come up',
    'launch.mainStarting': 'Another process is starting the daily cabinet; wait for it to come up',
    'launch.noFreePort': 'No free port between {from} and {to}',
    'launch.linkDangling': '{name} links to somewhere that does not exist; the recorded path is {path}. Install that plugin folder again, using a full path',
    'launch.noHostDshFile': 'The dsh you installed yourself has no file at {entry}. It may have just been uninstalled, or an upgrade is half done',
    'launch.versionNotDownloaded': 'Release {version} has not been downloaded',
    'launch.sandboxAlreadyRunning': 'Sandbox "{name}" is already open: {url} (process {pid}). Only one dsh at a time per sandbox; two of them write over each other in the same cabinet. Use another sandbox to run both, or stop this one first',
    'launch.bootExited': 'dsh exited before it finished starting, exit code {code}',
    'launch.bootExitedLate': 'dsh exited after serving the page, exit code {code}',
    'launch.bootTimeout': 'dsh did not finish starting within {seconds} seconds',
    'launch.stoppedAfterFailure': 'The dsh this launch started (pid {pid}) has been stopped, not left running in the background',
    'launch.badPid': 'Refusing to stop process {pid}',

    'param.cabinet': 'cabinet',
    'param.pluginSource': 'id|folder|package',
    'param.pluginId': 'id',
    'param.pluginRef': 'id|package',
    'param.port': 'port',
    'param.release': 'release',
    'param.releaseOrFolder': 'release|folder',
    'param.sandbox': 'sandbox',
    'param.folder': 'folder',
    'param.title': 'title',
    'param.count': 'count',
    'param.chars': 'chars',
    'param.packageName': 'package',
    'param.timestamp': 'timestamp',
    'param.options': 'options',

    'cmd.ls.plugin.param.in': 'Which cabinet to list what is actually installed in; without it, every plugin this computer can name',
    'cmd.ls.workspace.param.in': 'Which cabinet\'s workspace list to show',
    'cmd.ls.history.param.lines': 'How many recent entries; 0 is all; default {historyLines}',
    'cmd.ls.history.param.shape': 'Only size, time span and failure count, no entries',
    'cmd.get.machine.param.version': 'The official release to download',
    'cmd.get.plugin.param.source': 'What to install: an existing folder, an id that ls plugin lists, or an npm package name; leave it out to copy everything --from holds',
    'cmd.get.plugin.param.to': 'Which cabinet to install into; a sandbox name, or main; an unknown sandbox name is created on the way',
    'cmd.get.plugin.param.from': 'Which cabinet to take from; picks between two cabinets holding the same id, and with no name given it makes this a whole-cabinet copy',
    'cmd.get.plugin.param.id': 'The id to register a folder under; default is what the folder calls itself',
    'cmd.get.signin.param.to': 'Which sandbox to import the everyday cabinet\'s sign-in into; not main, that is the source',
    'cmd.get.chat.param.from': 'Which cabinet the chats come from',
    'cmd.get.chat.param.to': 'Which cabinet the chats are copied into',
    'cmd.get.chat.param.force': 'Copy even while the target dsh is running; it sees them at its next start',
    'cmd.rm.machine.param.version': 'Which one to remove: a release number for one we downloaded, a folder for one you pointed at (a / or \\ in it means folder)',
    'cmd.rm.plugin.param.target': 'Which plugin to remove: its id or package name',
    'cmd.rm.plugin.param.from': 'Which cabinet to remove it from',
    'cmd.rm.sandbox.param.sandbox': 'Which sandbox to delete',
    'cmd.rm.signin.param.from': 'Which cabinet to remove the sign-in from',
    'cmd.start.param.sandbox': 'Which cabinet to open: a sandbox name, or main for your everyday one',
    'cmd.start.param.new': 'Open a fresh sandbox, named automatically',
    'cmd.start.param.version': 'Which dsh to run: a release number for one dsh-box downloaded, a folder for your own; default is the one installed on this machine',
    'cmd.start.param.plugin': 'Install this plugin into the cabinet on the way, permanently; an id or a plugin folder; repeatable; on main it goes through the gate (NEEDS_APPROVAL)',
    'cmd.start.param.unplug': 'Remove this plugin from the cabinet on the way; repeatable; on main it goes through the gate (NEEDS_APPROVAL)',
    'cmd.start.param.no-sign-in': 'Do not import the sign-in when creating a sandbox',
    'cmd.start.param.sign-in': 'Import the sign-in into this cabinet before starting',
    'cmd.start.param.sign-out': 'Remove this cabinet\'s sign-in before starting',
    'cmd.start.param.follow': 'Do not return; stay and stream the log, Ctrl+C to stop it',
    'cmd.stop.param.sandbox': 'Which one to stop: a sandbox name, or main for the everyday cabinet started from here',
    'cmd.stop.param.all': 'Stop every sandbox, then ask about the everyday cabinet last',
    'cmd.stop.param.window': 'Close this data directory\'s config window service',
    'cmd.stop.param.download': 'Stop the download in progress, with the whole process tree it started',
    'cmd.set.plugin.param.target': 'Which plugin to switch',
    'cmd.set.plugin.param.state': 'on puts it back, off switches it off',
    'cmd.set.plugin.param.undo': 'Step the whole plugin configuration back once; repeatable',
    'cmd.set.plugin.param.in': 'Which cabinet to change',
    'cmd.set.plugin.param.at': 'Jump to the backup taken at this moment instead of stepping back once',
    'cmd.set.workspace.param.path': 'The project folder it opens next time',
    'cmd.set.workspace.param.in': 'Which cabinet to change',
    'cmd.set.workspace.param.title': 'The name dsh shows for this workspace',
    'cmd.set.source.param.value': 'Where packages come from: auto picks, official is the official registry, mirror is the mirror',
    'cmd.set.lang.param.value': 'The language the command line and the config window speak together',
    'cmd.set.ask-on-quit.param.value': 'on asks, off does not',
    'cmd.set.ask-on-daily.param.value': 'on asks, off does not',
    'cmd.set.path.param.state': 'on adds to PATH, off removes',
    'cmd.set.path.param.force': 'Add even when another dsh-box is already on PATH, so this one wins',
    'cmd.logs.param.sandbox': 'Whose last start to read: a sandbox name, or main',
    'cmd.logs.param.shape': 'Only the shape: line count, size, lines that look like errors, the last line',
    'cmd.logs.param.errors': 'Only lines that look like errors, each with three lines around it',
    'cmd.logs.param.lines': 'How many lines; default 50 lines or 4000 characters, whichever comes first',
    'cmd.logs.param.all': 'List every log file this cabinet keeps',
    'cmd.logs.param.version': 'Read the log of downloading or removing this release instead; readable mid-download',
    'cmd.logs.param.package': 'Read the log of fetching this npm plugin instead; readable mid-download',
    'cmd.ui.param.no-open': 'Start the service without opening a browser; just print the address',
    'cmd.ui.param.port': 'Listen on this port; default is a free one picked at random',
    'global.param.box': 'Where the data directory is; default is the usual one',
    'global.param.json': 'Answer as one line of JSON for a machine; --json=1 names the shape, bare means shape 1',
    'global.param.help': 'Explain this command instead of running it',

    'cabinet.daily': 'your everyday cabinet',
    'sandbox.noFreeName': '{prefix}-{stamp}-1 through -999 are all taken. Give this one a name',
    'sandbox.noSuch': 'There is no sandbox named "{name}"',
    'sandbox.runningCannotDelete': '{name} is running (process {pid}). Stop it first: stop {name}',

    'adopt.sameCabinet': 'Copying from a cabinet to itself; there is nothing to do',
    'adopt.noSessions': '{label} has no conversations yet',
    'adopt.destinationRunning': 'A dsh is running on {label}. Stop it before copying. dsh scans the conversation directory only at startup, so anything copied in while it runs stays invisible to it. Add --force if you are sure; those conversations appear the next time it starts',

    'plugin.installed': 'Installed {name} into {where}',
    'plugin.installedWhere': 'Written to {file} — typing dsh yourself loads it too',
    'plugin.removeHint': 'To take it out: rm plugin {id} {cabinet}',
    'plugin.uninstalled': 'Removed {name} from {where}',
    'plugin.downloadSwept': 'No other cabinet was using it, so the download went too: {list}',
    'plugin.folderUntouched': 'Your folder was not changed',

    'restore.done': 'Plugin config for {where} restored to the copy from {at}',
    'restore.stepsLeft': 'Run it again to go back {count} more step(s)',
    'restore.noneLeft': 'That was the earliest one — there is nothing further back',
    'restore.linksNotRolledBack': 'Only the config was restored; links were not rolled back. Plugins that are gone will not load, and the extra links are empty placeholders',

    'version.notDownloadedAlready': '{version} was not downloaded in the first place',
    'version.inUse': '{sandbox} is using {version} (process {pid}). Stop it first: stop {sandbox}',
    'version.deleting': 'Deleting {version}…',
    'version.deletingSized': 'Deleting {version}, about {mb} MB…',
    'version.stillDeleting': 'Still deleting, {seconds}s so far',
    'version.deleted': '{version} deleted',

    'host.versionNotDownloaded': 'Release {version} has not been downloaded. Try: get release {version}',
    'host.noHostDsh': 'No dsh of your own was found. Either install one (npm i -g @deepseek-ai/dsh), or name a release dsh-box has already downloaded with --version <release>',
    'engine.unknown': 'machine unknown',
    'engine.versionUnreadable': 'version unreadable',
    'engine.host': 'the {version} you installed yourself',
    'engine.release': 'the {version} dsh-box downloaded',
    'engine.tree': 'the {version} you pointed at ({path})',
    'engine.app': "an application's own {version} ({path})",

    'engine.pathMissing': 'No such folder: {path}',
    'engine.noDshInPath': 'No dsh under {path}. Three levels down were searched, so either that is the wrong folder, or a source tree whose dependencies have not been installed yet',
    'engine.noDshInApp': '{path} is an application, but it carries no dsh',
    'engine.insideArchive': 'The dsh in {path} ({version}, {packages} packages) is sealed inside app.asar with no files on disk, so it cannot start: at boot dsh builds a layer of links in the filing cabinet pointing at its own tree, and links are resolved by the operating system, which cannot see into an asar. That build failed to unpack what it declared (it asks for node_modules to be unpacked); another build of it works',
    'engine.entryMissing': 'The dsh in {path} names a startup file that is not there',
    'engine.appPlatform': "Reading a dsh out of an application has only been implemented for Windows, and this is {platform}. Point at a dsh folder lying on disk instead",
    'engine.appNoExe': '{path} looks like an application, but which program inside it to run is not clear (found: {found})',
    'engine.appUnreadable': 'Cannot read what is inside {path} — the program shipped with it did not answer',

    'engine.pinOk': 'Pin check: {packages} packages, all on one version',
    'engine.pinMixed': 'Pin check: {packages} packages, some on other versions ({list}). This tree is not one we installed, so this is said rather than acted on, and the launch continues',
    'engine.pinUnchecked': 'Pin check: no sibling packages to count, nothing proved. Starting anyway',

    'mounts.unreadablePatch': "This cabinet's plugin config ({file}) cannot be read, so it will not be changed. Look at what happened to that file, or restore it from a backup",
    'backup.none': 'This cabinet has no backups yet; one is made when the plugin config is changed',
    'backup.noSuch': 'There is no copy from {at}. Available: {list}',

    'workspaces.dirNotFound': 'No such directory: {dir}',
    'workspaces.unknownVersion': '{file} is {name} version {version}, and dsh-box only knows {wantName} version {wantVersion}. It was left alone.\n  dsh has probably been upgraded and the shape of this table changed; one wrong field stops dsh from starting at all, so nothing is written here.\n  Picking a workspace once inside dsh does the same thing.',
    'workspaces.unreadable': 'Cannot read {file}: {error}. It was left alone — this is dsh\'s own file, and it records which workspaces dsh has seen',

    'name.empty': 'A sandbox name cannot be empty',
    'name.tooLong': 'A sandbox name is at most {max} characters',
    'name.dots': '"." and ".." mean the directory itself and cannot be names',
    'name.leadingDash': 'A sandbox name cannot start with "-"; the command line would read it as an option',
    'name.leadingDot': 'A sandbox name cannot start with "."; that is how hidden files are written',
    'name.trailingDot': 'A sandbox name cannot end with "."; Windows drops it silently',
    'name.charset': 'A sandbox name can use letters (including Chinese, Japanese and so on), digits, underscore "_", dot "." and hyphen "-", with no spaces and no punctuation',
    'name.reserved': '"{name}" collides with a reserved Windows device name, so no folder can be created with it',
    'name.reservedDaily': '"main" is the name of the daily cabinet, so a sandbox cannot use it — otherwise --in main would not say which one you meant. Any other name is fine',
    'name.rule': 'letters (Chinese is fine), digits, _ . - ; no spaces, and not starting with - or .',

    'box.notADirectory': '{dir} already exists and is not a folder',
    'box.occupied': '{dir} already exists, is not empty, and was not created by this tool',
    'box.noFreeName': 'No usable data directory name next to {cwd}',

    'npm.bothUnreachable': 'Neither the official npm registry nor the China mirror can be reached. Check the network, or try later',
    'npm.sourceMirror': 'Source chosen automatically: the China mirror is faster ({mirror} ms{versus})',
    'npm.sourceOfficial': 'Source chosen automatically: official npm ({official} ms{versus})',
    'npm.versusOfficialDown': ', official registry unreachable',
    'npm.versusMirrorDown': ', mirror unreachable',
    'npm.versusOfficial': ' vs official {official} ms',
    'npm.versusMirror': ' vs mirror {mirror} ms',
    'npm.queryFailed': 'npm answered {status} when asked about {name}@{version}',
    'npm.registryFailed': 'Cannot reach npm: the registry answered {status}',
    'npm.badVersion': 'Not a valid version: {version}',
    'npm.askingClosure': 'Asking npm which packages {version} contains',
    'npm.askedSoFar': 'Asked about {done} packages (roughly {queued} in total)',
    'npm.mirrorBehind': 'The mirror does not have {version} yet; asking the official registry instead',
    'npm.noSuchVersion': 'npm has no version called {version}',
    'npm.closureSize': '{version} comes to {count} packages; pinning each one',
    'npm.versionUnreadable': 'version unreadable',
    'npm.pinFailed': 'Pinning failed: {wrong} of {checked} packages are not {version} ({sample}). Installing that would mix releases together, so this download counts as failed.',
    'npm.pinOk': 'Verified: all {checked} packages are {version}',
    'npm.installing': 'Running npm install. Nothing changes on disk while dependencies are being resolved; packages land afterwards.',
    'npm.resolving': 'npm is still resolving dependencies, {seconds}s so far (nothing appears on disk during this stage, which is normal)',
    'npm.writing': 'npm is writing, {seconds}s so far, {landed} packages on disk',
    'npm.cannotStart': 'Cannot start npm: {error}. Check that npm is installed and on PATH.',
    'npm.installFailed': 'npm install failed (exit code {code}). Its last output:\n{tail}',
    'npm.directBlocked': 'A direct connection to npm does not work; using the proxy your system is configured with',
    'npm.direct': 'A direct connection to npm took {ms} ms, so the download goes direct (bypassing the proxy, for the npm domain only)',

    'window.address': 'Config window at {url}',
    'window.notLocal': 'That address is not this machine\'s config window',
    'window.crossOrigin': 'This request came from another page and was refused',
    'window.noPass': 'This request carried no pass for the current config window and was refused',
    'window.stalePass': 'This page is left over from a config window that has since reopened, and the pass changed with it. Reload the page.',
    'window.notFound': 'Not found',
    'window.agentHolds': 'A command is running against this data directory from outside, so the window is not sending commands. Press again once it has finished',
    'window.noCommand': 'No command was given',
    'window.nonTextToken': 'The command contains something that is not text',
    'window.unknownCommand': 'Unknown command "{name}"',
    'window.noNestedUi': 'A config window cannot open another config window',
    'window.reservedFlag': '--{flag} is filled in by the config window itself and is not accepted from outside',
    'window.cannotRunCli': 'Could not start the command line: {error}',
    'window.noOutput': 'The command produced no result (exit code {code})',
    'window.onlyLocalUrl': 'Only local sandbox addresses can be opened',

    'settings.changed': '{key} changed from {from} to {to}',
    'settings.lang.summary': 'Language: {options}',
    'settings.source.summary': 'Where official releases are downloaded from',
    'settings.askOnQuit.summary': 'Whether closing the config window warns that it stops every sandbox',
    'settings.askOnDaily.summary': 'Whether to warn before touching your everyday cabinet',
    'settings.lang.setting': 'Which language the window and the command line speak',

    'config.unreadable': 'Cannot read {file}: {error}\n  It was left alone. This file records what you picked last time, and overwriting it loses that.\n  Repair it yourself, or use rm setting to archive it and start from empty.',
    'config.notAnObject': '{file} does not contain an object and cannot be read. It was left alone; rm setting can archive it and start over',
    'config.busy': 'Another dsh-box process is changing the config and {seconds} seconds of waiting was not enough.\n  Try again shortly. If you are sure nothing else is running, delete {lock}',

    'plugin.dirNotFound': 'No such directory: {path}',
    'plugin.noPackageJson': 'There is no package.json in {path}',
    'plugin.unreadableManifest': 'Cannot read {file}: {error}',
    'plugin.noPackageName': '{file} does not state a package name',
    'plugin.workspaceDepsMissing': '{name} depends on {count} packages from its own repository (workspace:*), but its node_modules has not been installed.\n  Run an install and a build in that repository first, or install this package from npm instead.',
    'plugin.entryMissing': "{name}'s entry {main} does not exist yet; that repository has not been built.\n  Run a build in {path} and come back.",
    'plugin.noEntry': '{name} has no importable entry (no main, no exports, no index.js).\n  It is most likely a patch-only package: it holds no code of its own and uses its cordis.patch.yml to pull in the packages that do. Mounting it achieves nothing; mount the ones it pulls in.',
    'plugin.badId': 'Cannot derive an id from {name}',
    'plugin.notADshPlugin': '{path} is not a dsh plugin: its package.json has no dsh field, and dsh would ignore it without a word.',
    'plugin.monorepoHint': '\n  This looks like a multi-package repository with the plugins under packages/, {count} of them:',
    'plugin.monorepoPick': '\n  Point at one of those rather than at the repository root.',

    'status.labelBoxVersion': 'dsh-box',
    'status.labelDataDir': 'data dir',
    'status.labelAgent': 'running',
    'status.labelHost': 'your dsh',
    'status.labelDownloaded': 'downloaded',
    'status.labelPlugins': 'plugins we can name',
    'status.labelMainPlugins': 'daily has',
    'status.labelSettings': 'settings',
    'status.labelMain': 'daily',
    'status.agentNone': 'none',
    'status.agentSince': 'yes, since {at}',
    'status.none': '(none)',
    'status.downloadedHint': '(not used unless --version names one)',
    'status.foldersGone': '({count} folders no longer exist)',
    'status.oursTag': '{name} (installed by dsh-box)',
    'status.mainForeign': 'one is running on 3080, but it was not started from here',
    'status.mainNone': 'none started from here, and 3080 is free',
    'status.mainRunning': 'started from here at {url} (process {pid}); to stop it: stop main',
    'status.sandboxCount': '{count} sandboxes, {running} of them running',
    'status.boxStopped': 'stopped',
    'status.boxRunning': 'running at {url}',
    'sandbox.neverStarted': 'never started',
    'status.hostMissing': 'not found (install one: npm i -g @deepseek-ai/dsh, or name a downloaded release with --version each time)',
    'status.hostUnverified': 'this installation has an unfamiliar layout, so its versions cannot be checked',
    'status.hostPinned': '{count} packages verified',
    'status.hostMixed': 'mixed versions ({list}); reinstalling is advised',
    'status.versionUnknown': 'unreadable',

    'logs.kept': '{where} has kept {count} log files',
    'logs.fileLine': '{at}  {bytes} bytes  {file}',
    'logs.none': '{where} has no logs yet — {reason}',
    'logs.shapeFile': 'file      {file}',
    'logs.shapeSize': '{lines} lines / {bytes} bytes / last written {at}',
    'logs.shapeTrouble': 'error-like  {count} lines',
    'logs.shapeLast': 'last line  {line}',
    'logs.troublePicked': '{where}: {count} error-like lines picked out of {total} (with three lines either side)',
    'logs.troubleNote': '(guessed by keyword — dsh has no uniform error marker; read the full file when unsure)',
    'logs.tailHeader': '{where} {what}, {total} lines in all',
    'logs.tailOmitted': 'The last {shown} lines follow; the {omitted} before them are omitted (limited by {limit})',
    'logs.limitChars': 'characters',
    'logs.limitLines': 'lines',
    'logs.fullFile': 'Full file: {file}',
    'logs.whereVersion': 'release {version}',
    'logs.whatVersion': 'its last download or delete',
    'logs.neverVersion': 'it has never been downloaded or deleted',
    'logs.whatLaunch': 'its last launch',
    'logs.neverMain': 'it has never been started from here',
    'logs.neverSandbox': 'it has never been started',
    'logs.which': "Which cabinet's log? A sandbox name, or main for the everyday cabinet; for a download use --version <release> or --package <name>",

    'run.byProcess': 'process {pid}',
    'memory.none': 'Nothing has changed anything in this data directory yet',
    'memory.header': 'Recent actions {session}  since {at}',
    'memory.runningNow': 'Still running: {command} (process {pid}, started {at})',
    'memory.ok': 'ok',
    'memory.refused': 'refused: {code}',

    'box.usingInstead': 'Using {dir} instead — name one yourself with --box <folder>',
    'flag.twice': '--{flag} was given {count} times ({list}). Picking one would be a guess — please give just one.',
    'flag.notHere': '"--{flag}" is not an option of {command}; it belongs to {owners}. help {command} lists what this command takes.',

    'versions.downloaded': 'Downloaded',
    'versions.named': 'Folders you pointed at',
    'versions.noneNamed': '(none yet — give --version a folder when starting a sandbox and it appears here)',
    'versions.namedBy': 'used by {list}',
    'versions.noneDownloaded': '(none yet — try: get machine 0.1.0-rc.7)',
    'versions.pinned': 'every package verified',
    'versions.mixed': 'mixed versions — download it again',
    'versions.registryDown': '(cannot reach npm: {error})',
    'versions.available': 'Available on npm',
    'versions.tagLatest': 'official stable',
    'versions.tagNext': 'official preview',
    'pull.which': 'Which release? For example: get release 0.1.0-rc.7',
    'pull.ready': '{version} is ready',
    'drop.which': 'Which machine? A release number or a folder; ls machine shows them',
    'drop.redownload': 'A sandbox that was using it must download it again before its next launch',
    'forget.done': '{path} is no longer remembered here (it appeared in the records of: {list})',
    'forget.keptOnDisk': 'Not one byte of yours was touched: {path} is still there, and can be pointed at again any time',
    'forget.cleared': 'The module pointer layer was cleared for: {list}. dsh rebuilds it at the next boot',
    'forget.running': '{list} is running on this one; stop it first. This is not fastidiousness: clearing the module pointers under a live dsh is the very thing this record exists to prevent',
    'forget.unknown': 'No sandbox has ever used {path}, so there is no record of it here to forget. ls machine shows what is remembered',

    'cabinet.bothFlags': 'Which cabinet can only have one answer, and two were given',
    'cabinet.which': 'Which cabinet? Write a sandbox name, or main for your everyday ~/.dsh',
    'cabinet.dailyNeedsApproval': 'This acts on your everyday ~/.dsh — the one your own `dsh` reads — so it runs only after a person has agreed on the panel.\n  No flag can stand in for that click: the panel opens by itself, so go there and press Allow. A sandbox needs none of this: delete it and it is gone.',

    // ── The gate: one request, one click, one run
    'approval.opening': 'This step needs a person. Opening the panel — press Allow there (within {seconds}s)',
    'approval.waiting': 'Waiting for you to answer on the panel…',
    'approval.granted': 'Allowed on the panel; the panel ran this command through',
    'approval.denied': 'Refused on the panel; nothing was done',
    'approval.timedOut': 'Nobody answered within {seconds}s, so this step did not happen.\n  Either have a person press Allow on the panel, or leave the everyday cabinet alone — copy it into a sandbox and check there instead (get plugin --from main --to <sandbox>).',
    'approval.noPanel': 'The panel would not open, and this step cannot happen without somebody pressing Allow on it — so this stopped here rather than waiting.\n  Open one by hand and try again: dsh-box ui. On npx that is npx dsh-box ui.',
    'approval.gone': 'That request is no longer there (expired or swept), and it did not run',
    'approval.alreadyAnswered': 'That request has already been answered; it will not run a second time',
    'approval.what': '{line}',
    'approval.ranInWindow': 'The panel ran it: {line}',

    'plugins.cabinetHeader': 'Plugins currently in {cabinet}',
    'plugins.unreadableWarn': "This cabinet's plugin config cannot be read, so this list may be incomplete",
    'plugins.cabinetEmpty': '(none — plain official dsh)',
    'plugins.oursLine': '{package}  ← installed by dsh-box, and can come out',
    'plugins.theirsLine': '{name}  ← already in this cabinet; not ours to touch',
    'plugins.platform': 'Official base (in every profile): {names}',
    'plugins.patchAt': 'Config at {file}',
    'plugins.bundleLine': '{name}  ← a whole layer, and it may hold more than one plugin',
    'plugins.offLine': '(switched off)',
    'plugins.overrideLine': '{id}  ← changes a row that is already there, rather than adding a plugin',
    'plugins.fromHome': "(from the patch at the cabinet's root, which every profile reads)",
    'plugins.platformFolded': '{count} more official base rows, not listed',
    'plugins.installWhich': 'Which plugin? Give a plugin folder, an npm package name, or an id another cabinet already has (with --from). Give --from and no id to copy that whole cabinet across',
    'plugins.copySameCabinet': '"{name}" is both the cabinet copied from and the one copied to, which does not say anything',
    'plugins.copyDone': 'Copied {count} from "{from}" into "{cabinet}":',
    'plugins.copyAlready': '{count} more were already there and were left alone',
    'plugins.copyMissing': "{package}'s folder is no longer there, so it was not copied",
    'plugins.copyRefused': '{package} was not copied: {why}',
    'plugins.unreadablePatch': "Cannot read {cabinet}'s plugin config ({file}), so it will not be changed — look at what happened to that file, or restore from a backup",
    'plugins.nameTakenAt': 'The name "{package}" is already taken by something else in {cabinet}, pointing at {points}.\n  It was left alone — dsh-box did not install it, and replacing it cannot be taken back.\n  To really replace it with {wanted}, whoever installed the original has to take it out first.',
    'plugins.nameTakenGone': 'The name "{package}" is already taken by something else in {cabinet}, and what it points at no longer exists.\n  It was left alone — dsh-box did not install it, and replacing it cannot be taken back.\n  To really replace it with {wanted}, whoever installed the original has to take it out first.',
    'plugins.alreadyThere': '{cabinet} already has "{package}", pointing at exactly {points}',
    'plugins.alreadyOurs': '{cabinet} already has "{package}" — the copy we installed',
    'plugins.relinked': '{cabinet} already listed "{package}"; only its link was broken — re-aimed, and no second row added',
    'plugins.nothingDone': 'Nothing was done',
    'plugins.raceTaken': 'Something else registered "{package}" into {cabinet} in the meantime',
    'plugins.raceCheck': 'The patch was not changed, but the link was made. Check where the name points now:',
    'backup.saved': 'The previous copy was backed up to {file}',
    'plugins.badPackageName': '"{name}" is neither an existing folder nor something that looks like an npm package name. A folder needs a package.json; a package name may only use lowercase letters, digits and . _ -, optionally with @scope/',
    'packages.treeDescription': 'Plugins dsh-box downloaded for you live here',
    'plugins.downloading': 'Downloading {name} from {registry}',
    'plugins.stillDownloading': 'Still downloading, {seconds}s so far; {packages} packages have landed — when that number stops moving, it is no longer fetching',
    'plugins.installInFlight': '"{other}" is being installed right now. Only one at a time — two npm runs writing the same package directory corrupt it. Wait for it to finish, or watch where it has got to: logs --package {other}',
    'plugins.retryOfficial': '{mirror} did not have all of it. Trying the official registry instead — the mirror was picked for speed, and fast is not the same as complete',
    'plugins.mirrorHint': 'Your source is pinned to the mirror. Mirrors can lag or miss a package; try letting it choose: set source auto',
    'plugins.installReady': '{name} is now installed in "{cabinet}"',
    'logs.wherePackage': 'plugin package {name}',
    'logs.whatPackage': 'its last download and install',
    'logs.neverPackage': 'it has never been downloaded from npm',
    'npm.saidOkButEmpty': 'npm said it installed, but there is nothing in {dir}',
    'plugins.downloaded': 'Downloaded, at {dir}',
    'npm.installExit': 'npm could not install it (exit code {code}) — {last}',
    'npm.timedOut': 'npm ran for more than {minutes} minutes without finishing, so it and everything it started have been stopped. This is usually not a slow line — look at the last lines of the log for which package’s install script is stuck',
    'npm.saidNothing': 'it said nothing',
    'plugins.uninstallWhich': 'Which one? See what this cabinet has with ls plugin --in <cabinet>',
    'plugins.notOurs': '"{id}" was already in {cabinet} before dsh-box; what someone else wrote in is not ours to remove. Take it out the way it was put in, or switch it off with set plugin',
    'plugins.notInstalled': 'There is no dsh-box-installed "{id}" in {cabinet} — see what is there with ls plugin --in <cabinet>',

    'aggregate.expanded': '"{name}" is an aggregate; expanded to {count} rows from its own {file}:',
    'aggregate.alsoRemoved': 'The {count} it brought with it went too:',
    'aggregate.notInlineable': '"{name}" cannot be expanded into the profile patch: its own {file} has rows aimed at existing ids ({ids}).\n  dsh applies each bundle as its own layer, before the profile patch; expanding puts them after it — and at a different layer such a row lands on something else.\n  An aggregate that only adds can be expanded; this one cannot, so it is left alone rather than installed into something that merely looks right.',
    'aggregate.memberMissing': '"{aggregate}" names "{member}", but it cannot be resolved from {dir}.\n  This is that package\'s own problem: it lists the member and does not ship it (the usual cause is devDependencies, which consumers never install).\n  dsh resolves the same way, so it will not find it either. Take it up with that package\'s author.',
    'aggregate.memberTaken': '"{member}", which "{aggregate}" would bring in, is already held by something else in this cabinet. Nothing was installed — half of an aggregate is a state nobody can clean up.',

    'plugins.staged': 'It and what it needs — {count} packages — are now in this cabinet\'s _local; dsh can only load plugins that live inside profiles',
    'staging.nameTaken': 'This cabinet\'s _local already holds something called "{package}" ({dir}), and dsh-box did not put it there. It was left alone — it may be a plugin you are working on. To install the npm package, move or rename that one first',
    'staging.notDownloaded': '"{package}" is not in the download tree — it went when the last cabinet using it let go. Run get plugin again to fetch it',
    'launch.repointedDownloads': 'Aimed {count} downloaded plugin(s) at this dsh installation',

    'plugins.disableWhich': 'Switch which row off? See the ids with ls plugin --in <cabinet>',
    'plugins.enableWhich': 'Switch which row back on? See the ids with ls plugin --in <cabinet>',
    'plugins.noSuchRow': 'No row with the id "{id}" in {cabinet}. The format lets you write a rule against an id that is not there and it simply does nothing, so this is refused now instead — see what is there with ls plugin {flags}',
    'plugins.enableNotOurs': '"{id}" was switched off in {cabinet} by somebody else, not by dsh-box. Switching it back on would be overruling them, so nothing was done — turn it on the way it was turned off',
    'plugins.switchedOff': '"{id}" is now off in {cabinet}',
    'plugins.switchedOffWhere': 'Written as one `disabled: true` row in {file} — the row underneath is untouched; this format has no "remove"',
    'plugins.switchedOn': '"{id}" is back on in {cabinet}',
    'plugins.alreadyOff': '"{id}" was already off in {cabinet}; nothing done',
    'plugins.alreadyOn': '"{id}" was already on in {cabinet}; nothing done',
    'plugins.viaBundleLine': '{name} (came in with the package above)',
    'bundles.unreadable': '{file} cannot be read, so it will not be changed. If the JSON is broken, look at that file first',
    'bundles.removed': '"{name}" removed from {cabinet}\'s bundles',
    'bundles.bothPlaces': 'Taken out of both bundles and dependencies ({file}) — out of one only, the next dsh plugin command would put it back',
    'bundles.bundlesOnly': 'Taken out of bundles ({file}); it was not a dependency, so nothing will put it back',
    'bundles.filesLeft': 'The package files are still in {dir} — nothing declares them now and nothing loads them. Delete them yourself if you want the space; this tool does not run a package manager on upstream\'s behalf',

    'backups.noneMain': '(none yet — one is made when the plugin config is changed)',
    'backups.noneSandbox': '(sandboxes keep no backups — a sandbox is a clean start, and a broken one can simply be deleted)',
    'backups.limit': 'At most {keep} are kept; the oldest goes automatically when there are more',
    'backups.restoreHint': 'Go back one step: set plugin --undo {where}',
    'restore.preRestoreBackup': 'The copy from before the restore is kept too: {file}',

    'history.shapeHeader': 'The shape of the record',
    'history.shapeCount': '{count} entries in all',
    'history.shapeCountUnreadable': '{count} entries in all, plus {unreadable} unreadable lines',
    'history.shapeFailures': '{count} of them failed',
    'history.shapeRange': 'from {from} to {to}',
    'history.notYet': '(nothing yet)',
    'history.fileBytes': '{file}  {bytes} bytes',
    'flag.linesInteger': '--lines takes an integer of at least 0; "{value}" was given',
    'history.header': 'Record    {count} entries in all',
    'history.headerTail': 'Record    {count} entries in all; these are the last {shown}',
    'history.empty': '(nothing yet — only commands that change something are recorded)',
    'history.omitted': 'The {count} earlier entries are omitted — for all of them: ls history --lines 0',
    'history.unreadable': '{count} more lines could not be read and are not in the numbers above',
    'history.fullAt': 'Full record at {files}',
    'history.noFile': '(no file yet)',

    'workspaces.useWhich': 'Which folder? For example: set workspace E:\\code\\my-repo --in alpha',
    'workspaces.next': '{cabinet} opens into this workspace next time: {path}',
    'workspaces.addedNew': 'this is a new registration',
    'workspaces.movedFront': 'it was already registered, and moved to the front',
    'workspaces.alreadyFront': 'it was already at the front; nothing changed',
    'workspaces.writtenTo': 'Written to {file}',
    'workspaces.header': 'Workspaces {cabinet} has seen    the first is what it opens into',
    'workspaces.neverStarted': '(this cabinet has never started, or no project was ever picked)',
    'workspaces.emptyList': '(none — dsh does not register the current directory by itself)',
    'sessions.count': '{count} conversations',
    'workspaces.switchHint': 'Switch: set workspace <folder> {where}',
    'workspaces.atFile': 'At {file}',

    'packages.nothingDownloading': 'No download is running, so there is nothing to stop',
    'packages.cancelled': 'Stopped the download of "{name}", and everything it had started. Half-fetched packages stay where they are; installing the same package again writes over them',

    'sandboxes.header': "Sandboxes           each is an independent dsh; none can see another's conversations",
    'sandboxes.none': '(none yet)',
    'sandboxes.signedIn': 'signed in',
    'sandboxes.notSignedIn': 'not signed in',
    'sandboxes.sessionOnly': 'not signed in (browser session only)',
    'sandboxes.credsUnreadable': 'sign-in state unreadable',
    'sandboxes.runningAt': 'running at {url}',

    'adopt.bothForms': 'Where from and where to can each have only one answer, and two were given',
    'adopt.which': 'Copy from where to where? Both ends are needed: --from <sandbox|main> --to <sandbox|main>',
    'adopt.copied': 'Copied {adopted} conversations from {from} into {to}, skipping {skipped} duplicates',
    'adopt.originalsStay': 'The originals are all still in {from}; this is a copy, not a move',
    'adopt.visibleNextStart': '{to} sees them the next time it starts',
    'adopt.versionDiffers': 'Worth knowing, and not a verdict: {from} last ran {fromVersion} and {to} ran {toVersion}. A session log carries a format version in its header and a dsh that meets one it does not know refuses the whole log — and adding a new event type does not change that number, so equal numbers are no promise either. The logs are compressed, so this tool cannot look inside; whether they arrived shows up as whether that cabinet lists them once it starts',
    'adopt.versionUnknown': 'Worth knowing, and not a verdict: which dsh one of these two last ran is not known here, so whether the other will take these conversations is not something to claim. A session log carries a format version and an unknown one is refused whole — start that cabinet and see whether it lists them',

    'start.bothFlags': 'Which cabinet to open can only have one answer: with a name given, do not also pass --new',
    'start.whichCabinet': 'Which cabinet? A sandbox name for that one, --new for a fresh one, main for your everyday ~/.dsh. Nothing is carried over from last time — the same command should always give the same result',
    'start.unknownPlugins': 'These plugin ids cannot be named here: {list} — see the ones that can with ls plugin',
    'start.pluginGone': 'Note: "{id}" was selected but its folder no longer exists, so it is not installed this time',
    'start.mainNeedsApproval': 'This opens your real ~/.dsh with a release dsh-box downloaded. Neither half is dangerous alone; together they are the one combination that cannot be repaired if it goes wrong:\n  1. On-disk formats have no migration path across releases — afterwards your own dsh may not be able to open this cabinet.\n  2. The cabinet holds a layer of links recording which machine it last used. This launch points them at dsh-box, and an abnormal exit leaves the old ones dead.\n  3. If you also start your own dsh some other way, two of them are pointing at one cabinet.\n  It runs after somebody presses Allow on the panel. The panel opens by itself; if it did not, open one: dsh-box ui.',
    'start.mainAlreadyRunning': 'The everyday cabinet already has one running (port 3080); close it before starting another',
    'start.notSandbox': 'Not a sandbox: this opens your real ~/.dsh',
    'start.releaseOnMain': 'This is not the dsh you installed yourself but a release dsh-box downloaded. Two things to know:',
    'start.releaseOnMainDetails': "on-disk formats have no migration path between releases; until this dsh exits, this home's module pointers aim into dsh-box's directory",
    'start.signInSuffix': ', sign-in imported',
    'start.usingEngine': 'Using {engine}',
    'start.unplugged': 'Removed "{package}" from this cabinet',
    'start.unplugTheirs': '"{id}" was already in this cabinet; not ours to touch, so it was left alone',
    'start.unplugMissing': 'This cabinet has no dsh-box-installed "{id}"; nothing to take out',
    'start.pluginAdded': 'Installed "{package}" into this cabinet — every launch from now on loads it',
    'start.pluginAlready': 'This cabinet already had "{package}"; it was not added twice',
    'launch.followStop': 'Ctrl+C stops it (process {pid})',
    'launch.stopping': 'Stopping…',
    'cmd.get.signin.summary': 'Copy your sign-in into this sandbox, if it has none',
    'cmd.get.signin.notes': `⛔ --to can only name a sandbox. The daily cabinet is where a sign-in comes from,
  so importing it into itself is not a thing.`,
    'cmd.rm.signin.summary': 'Take the sign-in out of a cabinet',
    'cmd.rm.signin.notes': `⛔ There is no backup: once out, signing in again is the only way back. That is deliberate —
  a backup would be a second plaintext copy of your key, in a data directory whose whole point is
  that you can carry it away.
  ⛔ With --from main the copy is your own rather than one we imported, so that one runs only after
  a person has agreed in the config window.`,
    'signIn.which': 'Which sandbox should get the sign-in? See them with ls sandbox',
    'signIn.mainIsSource': 'The daily cabinet is where a sign-in comes from; there is no importing it into itself',
    'signIn.nothingToCopy': 'Your own ~/.dsh has no sign-in to copy — sign in once in dsh first',
    'signIn.already': 'Sandbox "{name}" already has a sign-in; nothing changed',
    'signIn.done': 'Copied your sign-in into "{name}" — conversations there are billed for real',
    'signIn.replacedSession': 'Its previous credentials document was written over (it held only the browser session dsh signed for itself). That cabinet mints a new one at its next launch, and any page already open has to come back in through the token in its address',
    'signIn.grantNotCarried': 'Only the key was carried: {count} browser-session record(s) stayed behind. That is the secret dsh signs its own cookies with, and two cabinets sharing one means a cookie issued by either verifies on both; this cabinet mints its own at the next launch',
    'signOut.which': 'Which cabinet should lose its sign-in? After --from write a sandbox name, or main',
    'signOut.none': '"{name}" had no sign-in',
    'signOut.done': 'Took the sign-in out of "{name}"',
    'signOut.noWayBack': 'No backup was kept: signing in again is the way back',
    'signOut.mainNeedsApproval': 'This removes your own sign-in and keeps no copy. Signing in again in dsh restores it, but this tool cannot do that for you.\n  It runs after somebody presses Allow on the panel. The panel opens by itself; if it did not, open one: dsh-box ui.',
    'stop.mainNotRunning': 'The everyday cabinet has no instance running that was started from here',
    'stop.mainNote': 'If one answers on 3080, you started it yourself and it is not ours to manage',
    'stop.mainStopped': 'Stopped the everyday cabinet (process {pid}) — its home is your everyday one, and the data is all still there',
    'stop.mainNeedsApproval': 'This stops the dsh you are working in: whatever that session held is gone once it stops, and somebody else may be using it too. A person has to agree on the panel.',
    'stop.which': 'Stop what? Name a cabinet (see them with ls sandbox; the everyday one is main), or use --all / --window / --download',
    'stop.notRunning': 'Sandbox "{name}" is not running',
    'stop.stopped': 'Stopped "{name}" (process {pid})',
    'stop.staleRow': 'That ledger row was stale: process {pid} now belongs to something else, so it was left alone. The row has been cleared.',
    'rm.which': 'Which sandbox? See them with ls sandbox',
    'rm.removed': 'Deleted "{name}" — that dsh no longer exists',

    'settings.header': 'Settings',
    'settings.choicesLine': 'choices: {choices}',
    'settings.unknown': 'There is no setting called "{key}" — see them all with ls setting',
    'settings.whichValue': 'Set {key} to what? Choices: {choices}',
    'settings.badValue': '{key} cannot be set to "{value}" — choices: {choices}',
    'config.nothingToReset': '{file} does not exist; there is nothing to reset',
    'config.archived': 'The old settings were archived to {file} — not deleted; it records what you picked last time',
    'config.freshStart': 'The next command starts from empty',

    'quit.nothingRunning': 'No sandbox is running; there is nothing to stop',
    'quit.staleRows': '{count} more rows were stale: the process ids they named now belong to something else, so nothing was touched and the rows were cleared.',
    'quit.stopped': 'Stopped {count} sandboxes: {names}',
    'quit.mainStopped': 'The everyday cabinet was stopped too (process {pid}) — its home is your everyday one, and the data is all still there',
    'quit.mainStale': "The everyday cabinet's row named process {pid}, which now belongs to something else; nothing was touched and the row was cleared",
    'quit.mainForeign': 'A dsh answers on 3080, but it was not started from here; it cannot and should not be touched',
    'quit.mainNeedsApproval': '{count} sandboxes have been stopped. The one left is the everyday cabinet, which is the one you work in, so stopping it needs a person to agree on the panel.',

    'flag.noValue': '--{flag} is a switch and takes no value',
    'flag.jsonSchema': '--json={asked}: this build has no JSON shape with that number; it has {known}. Bare --json is shape 1.',
    'flag.unknown': 'Unknown option "--{flag}" — run with no arguments to see usage',
    'flag.needsValue': '--{flag} must be followed by a value',
    'flag.needsPositiveInteger': '--{flag} takes a positive integer; got "{given}"',
    'error.lastLines': 'Its last {count} lines:',

    'ui.title': 'dsh sandbox launcher',
    'ui.intro': 'Try releases and plugins in isolated sandboxes without touching your everyday cabinet. An agent can pick the dsh machine and the sandbox cabinet through the CLI as well.',
    'ui.booting': 'Loading…',
    'ui.bootingSlow': 'the release list asks npm once; that is the slow step',
    'ui.machineCard': 'dsh machine',
    'ui.pull': 'Download',
    'ui.customVersionPh': 'or type a release, e.g. 0.0.1-rc.1',
    'ui.enginePathPh': 'or paste a folder: a dsh you built, or an application that ships one',
    'ui.usePath': 'Use this folder',
    'ui.pathNeeded': 'Paste the folder path into the box on the left first',
    'ui.pullNotAPath': 'That is a folder, so there is nothing to download — it is already on this computer. Pick its chip above to use it',
    'ui.pathChipUnstarted': 'not started yet',
    'ui.forgetTitle': 'Take it out of here (your folder is not deleted)',
    'ui.forgetAsk': 'Take "{where}" out of here?',
    'ui.forgetBody': 'Only dsh-box stops remembering it. <b>Your folder is not deleted</b> — {path} stays where it is, and can be pasted again any time. Sandboxes that used it have their module pointer layer cleared; dsh rebuilds it at the next boot.',
    'ui.forget': 'Take it out',
    'ui.forgotMsg': '{path} is no longer remembered; that folder was not touched',
    'ui.sourceLabel': 'Source',
    'ui.sourceAuto': 'auto',
    'ui.sourceOfficial': 'official npm',
    'ui.sourceMirror': 'China mirror',
    'ui.olderVersions': 'Earlier preview builds',
    'ui.cabinetCard': 'Cabinet',
    'ui.newSandboxPh': 'name for a new sandbox cabinet',
    'ui.newSandbox': 'New',
    'ui.ghostDeleted': 'deleted during this run',
    'ui.signInHave': 'signed in',
    'ui.signInNone': 'not signed in',
    'ui.signInGoing': 'coming out',
    'ui.signInWillImport': 'will be copied in',
    'ui.signInDailyNote': 'This is your own sign-in; unticking takes it out, and nothing is kept',
    'ui.signInSandboxNote': 'Ticked copies your sign-in in; unticked takes it out of this sandbox',
    'ui.importSignIn': 'Import sign-in credentials',
    'ui.importSignInNote': 'only meaningful for a newly created sandbox cabinet',
    'ui.pluginsCard': 'Plugins in this cabinet',
    'ui.pluginDirPh': 'plugin folder path (it needs a package.json)',
    'ui.browse': 'Browse…',
    'ui.addPlugin': 'Add',
    'ui.npmNamePh': 'npm package name (e.g. dsh-memory-pyramid)',
    'ui.npmInstall': 'Install from npm',
    'ui.npmCancel': 'Stop download',
    'ui.npmCancelled': 'Stopped the download of "{name}".',
    'ui.npmNote': 'Downloads from npm into the sandbox cabinet selected above. For the daily cabinet use the command line: get plugin <name> --to main',
    'ui.npmBadName': '"{name}" is not a valid npm package name; no command was sent.',
    'ui.npmInstallingHead': 'Downloading and installing {name} from npm… (this can take a few minutes)',
    'ui.npmInstalled': '"{name}" is now installed in "{cabinet}".',
    'ui.npmBrought': 'This package brought {count} plugins.',
    'ui.runningCard': 'Running',
    'ui.quit': 'Quit dsh-box',
    'ui.lockedHint': 'A command is running outside this window, so this action was not run — press again once it has finished',
    'ui.cancel': 'Cancel',
    'ui.ok': 'OK',
    'ui.notice': 'Notice',
    'ui.approvalTitle': 'One step needs you',
    'ui.approvalAllow': 'Allow',
    'ui.approvalDeny': 'Refuse',
    'ui.dontAskAgain': 'Do not ask again',
    'ui.dropDontAskNote': 'future changes to the everyday cabinet run without asking',
    'ui.dropConfirm': 'Uninstall and remove',
    'ui.quitDontAskNote': 'future closes follow this choice without asking',
    'ui.quitConfirm': 'Stop and quit',
    'ui.staleStuck': 'Reloaded once and the pass still does not match. Reopen the config window by hand (command line: dsh-box ui).',
    'ui.requestFailed': 'Request failed ({status})',
    'ui.commandFailed': 'Command failed ({code})',
    'ui.unknown': 'unknown',
    'ui.boxPath': 'Data directory {box} · process logs in its logs subfolder',
    'ui.dailyCabinet': 'Daily cabinet',
    'ui.runMainNote': 'not a sandbox; this is your everyday ~/.dsh',
    'ui.engineHost': 'this machine',
    'ui.engineRelease': 'a dsh-box download',
    'ui.stop': 'Stop',
    'ui.notDownloaded': 'not downloaded',
    'ui.pinnedShort': '{count} packages verified',
    'ui.mixedShort': 'mixed versions; download again',
    'ui.deleteVersionTitle': 'Delete this release',
    'ui.deleteVersionAsk': 'Delete {version}?',
    'ui.deleteVersionBody': 'About 200–260MB. A sandbox that was using it must download it again before its next launch.',
    'ui.delete': 'Delete',
    'ui.deletingHead': 'Deleting {version}…',
    'ui.deletedMsg': '{version} deleted.',
    'ui.hostChip': 'This machine {version}',
    'ui.machineHintHost': 'The machine on this computer is the default. Downloads are for trying another release.',
    'ui.machineHintNoHost': 'No dsh is installed on this computer, so only downloaded releases can run.',
    'ui.pluginHintMain': 'Installed into the everyday cabinet it stays, and typing dsh yourself loads it too. To just try one, use a sandbox.',
    'ui.pluginHintSandbox': 'Installed into this sandbox it stays, not only for this launch. For plain official dsh, make a new sandbox.',
    'ui.unreadableWarn': "This cabinet's plugin config cannot be read, so this list may be incomplete. It will not be touched until someone has looked — the command line can put the whole file back one step: set plugin --undo",
    'ui.willRemoveNote': 'comes out of this cabinet when start is pressed',
    'ui.installedHereNote': 'already installed in this cabinet',
    'ui.tagGoing': 'removing',
    'ui.tagHave': 'installed',
    'ui.tagAdd': 'adding',
    'ui.tagNot': 'not installed',
    'ui.tagTheirs': 'already there',
    'ui.theirsNote': 'already in this cabinet before dsh-box; cannot be changed here',
    'ui.missingPlugin': '{label} — folder no longer exists, cannot be installed',
    'ui.noPlugins': 'Nothing extra in this cabinet: plain official dsh.',
    'ui.dailyNote': 'the ~/.dsh you use every day',
    'ui.lastVersion': 'last {version}',
    'ui.hostSuffix': ' (this machine)',
    'ui.freshNote': 'not created yet; made at launch',
    'ui.cabinetHintMain': 'There is only one everyday cabinet, so only one dsh can point at it at a time.',
    'ui.cabinetHintSandbox': "Each sandbox cabinet has its own conversations and config; none can see another's.",
    'ui.adoptBtn': 'Copy conversations into daily cabinet',
    'ui.adoptAskTitle': 'Copy into the daily cabinet?',
    'ui.adoptAskBody': 'Copies the {sessions} conversations of "{name}" into your everyday ~/.dsh.',
    'ui.adoptAskNote': 'The originals stay in the sandbox and existing conversations are skipped, so running it again is safe.',
    'ui.adoptOk': 'Copy',
    'ui.adoptDone': 'Copied {adopted}, skipped {skipped} duplicates. Visible the next time dsh opens.',
    'ui.deleteSandboxBtn': 'Delete this sandbox',
    'ui.deleteSandboxAsk': 'Delete "{name}"?',
    'ui.deleteSandboxBody': 'Deletes it together with its {sessions} conversations, config and sign-in. Gone is gone.',
    'ui.startMain': 'Start normally',
    'ui.startSandbox': 'Start sandbox',
    'ui.recallLiveOpen': 'Fold the {count} steps being taken outside',
    'ui.recallLiveClosed': 'Unfold the {count} steps being taken outside',
    'ui.recallPastOpen': 'Fold the last {count} actions',
    'ui.recallPastClosed': 'Review the last {count} actions',
    'ui.refusedLine': 'refused {code}: {message}',
    'ui.trailHead': 'The last {count} actions in this data directory',
    'ui.outsideBusy': 'Something outside is working',
    'ui.outsideRun': 'process {pid} running <b>{name}</b> ({ago})',
    'ui.secondsAgo': '{count}s ago',
    'ui.minutesAgo': '{count} min ago',
    'ui.hoursAgo': '{count} h ago',
    'ui.pullNeedsVersion': 'Type a release first, or pick one above to download — the machine you installed yourself did not come from npm and cannot be downloaded.',
    'ui.pullingHead': 'Downloading {version}…',
    'ui.pullDone': '{version} is ready: {packages} packages verified.',
    'ui.startingHead': 'Starting…',
    'ui.sandboxQuoted': 'Sandbox "{name}"',
    'ui.startedMsg': '{where} started, using {engine} {version}.',
    'ui.openUrl': 'Open {url}',
    'ui.nameRule': 'Allowed names: {rule}',
    'ui.quitRowSandboxNone': 'sandboxes — none running',
    'ui.quitRowSandbox': 'sandboxes — {count} running: {names}',
    'ui.quitRowMainHere': 'cabinet — your own, started from here (process {pid}); it stops too, and stopping it asks you once more',
    'ui.quitRowMainForeign': 'cabinet — one answers on 3080, not started from here; process unknown, left alone',
    'ui.quitRowMainNone': 'cabinet — none started from here',
    'ui.quitPoint1': '1. <b>Sandboxes are only stopped</b>; conversations and config remain, and starting the same name continues them.',
    'ui.quitAlsoMain': ', and the everyday cabinet too (process {pid})',
    'ui.quitDoneTitle': 'Quit',
    'ui.quitDoneBody': 'Stopped {count} sandboxes{alsoMain}. This page can be closed now.',
    'ui.partialStopped': 'Half done: stopped {names}; the everyday cabinet is still up, waiting for your answer at the gate.',
    'ui.stateUnreadable': 'Cannot read state: {error}',
    'ui.dropRowPlugin': 'plugin — {label}',
    'ui.dropRowPlaces': 'installed in — {places}',
    'ui.dropPoint1': "1. <b>Comes out of the everyday cabinet too</b>; what changes is that cabinet's own config, so typing dsh yourself changes with it.",
    'ui.dropPoint2Downloaded': '2. <b>The downloaded package is deleted as well</b>; download it again to use it.',
    'ui.dropPoint2Yours': '2. <b>Your own folder is not touched</b>; only links and registration go.',
  },
}

/**
 * What each language calls itself, for a picker to list.
 *
 * ⛔ Deliberately assembled here rather than written into the sentence. A line
 * like `Language: 中文 | English` is the one place where Chinese in the English
 * table is correct, and one legitimate exception is enough to make the check
 * that finds untranslated entries stop being a straight answer. No exception,
 * no argument about it later.
 * @returns {string}
 */
export function langOptions() {
  return LANGS.map((lang) => MESSAGES[lang]['lang.name']).join(' | ')
}
