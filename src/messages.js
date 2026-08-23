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
 * once `config lang` has been used, that answer wins, because a setting the
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

    'cmd.versions.usage': 'versions',
    'cmd.versions.summary': '看已下载了哪些版本,以及 npm 上有哪些',
    'cmd.pull.usage': 'pull <版本号>',
    'cmd.pull.summary': '下载一个官方版本(逐包核对版本)',
    'cmd.drop.usage': 'drop <版本号>',
    'cmd.drop.summary': '删掉一个已下载的版本(约 200–260MB)',

    'cmd.plugins.usage': 'plugins [--sandbox <名> | --main]',
    'cmd.plugins.summary': '不给档案柜就列登记表;给了就列那个档案柜实际装着什么',
    'cmd.plugins.add.usage': 'plugins add <目录> [--id x]',
    'cmd.plugins.add.summary': '记住一个插件目录(里面要有 package.json)',
    'cmd.plugins.rm.usage': 'plugins rm <id> [--approved]',
    'cmd.plugins.rm.summary': '彻底弄走一个插件:从每个档案柜卸下、从登记表移除、下载的连包一起删',
    'cmd.plugins.rm.notes': `⭐ 做什么取决于这个插件的文件是谁的,只取决于这一点:
  你自己的文件夹(plugins add <目录> 记进来的)
      从每个档案柜去掉链接与配置条目,从登记表移除。
      ⛔ 你那个文件夹一个字节都不碰。
  dsh-box 下载的(plugins install <包名> 下来的)
      同上,外加把下载的那份包删掉:它在我们自己的目录里,不删就没人删得掉。

⚠ 它会扫过每一个档案柜,不只是你上次装的那个。碰到日常档案柜时会先拦下来
  说清楚要动哪几处,要 --approved 才继续;不想每次都问:config ask-on-daily off。
⛔ 只扫得到 dsh-box 认识的档案柜(它建的沙箱 ＋ 日常档案柜)。你手工造的、
  从没在这里打开过的 DSH_HOME,它看不见。`,
    'cmd.plugins.install.usage': 'plugins install <id|目录|包名> --sandbox <名> | --main',
    'cmd.plugins.install.summary': '把插件正式装进某个档案柜(一直在,直到你卸掉)',
    'cmd.plugins.install.notes': `⭐ 「记住」和「装上」是两层,别混:
  plugins add <目录>   dsh-box 认识这个插件了(登记表),任何档案柜都还没有它
  plugins install …    真的装进某一个档案柜,dsh 从此启动就加载它

装进去的东西写在那个档案柜自己的 profile 配置里,所以你自己敲 dsh 也在,
不是只在从这里启动时才有。要拿掉用 plugins uninstall。
⭐ 改这个文件之前会先整份备份(plugins backups 看得到,plugins restore 还原)。
⛔ 只删得掉我们写进去的那几条;那个档案柜本来就有的插件不归我们动。`,
    'cmd.plugins.uninstall.usage': 'plugins uninstall <id> --sandbox <名> | --main',
    'cmd.plugins.uninstall.summary': '把插件从某个档案柜拿掉',

    'cmd.history.usage': 'history [--lines N] [--shape]',
    'cmd.history.summary': '看这个数据目录里做过的所有事(持久记录)',
    'cmd.history.notes': `⛔ 跟 memory 是两样东西,别混:
  memory   上一轮 agent 接管期间做了什么,是给窗口看的显示,下一轮会覆盖掉
  history  这个数据目录做过的所有事,持久记录,只增不改

不写 --lines 就是最近 {historyLines} 条。省略了多少会当场说出来,全文路径也会给。
--lines 0 是全部;--shape 只回答「有多大、从什么时候到什么时候、失败几条」,
  无论记录多长这个回答都是固定几行。

⚠ 只有会改变状态的命令才记。到 2MB 会转一代(.1),更早的那一代会被顶掉。`,

    'cmd.workspaces.usage': 'workspaces --sandbox <名> | --main',
    'cmd.workspaces.summary': '看这个档案柜见过哪些工作区(第一条就是打开时进的那个)',
    'cmd.workspaces.notes': `⚠ 两个词别混,它们不是并列关系:
  档案柜  一个 DSH_HOME,装对话、配置与登录,就是 --main / --sandbox 说的那个
  工作区  dsh 实际干活的那个项目文件夹,本条命令管的是它,这也是 dsh 官方的叫法
  一个档案柜里装着一张「这台见过哪些工作区」的名单,本条命令看的就是那张名单。

⛔ dsh 不会自己把启动目录登记成工作区,实测过:新起一台那张表是空的,
  所以人得在 dsh 的网页里选一次。而 dsh web 那层没有任何参数能指定它
  (只有 --host / --port / --trusted-host),这正是本命令存在的理由。
⛔ 配置窗里没有这个控件,也不会加:人直接在 dsh 里选就行,这条是给 agent 的。`,
    'cmd.workspaces.use.usage': 'workspaces use <目录> --sandbox <名> | --main [--title <名字>]',
    'cmd.workspaces.use.summary': '让这个档案柜下次打开时进这个工作区',
    'cmd.workspaces.use.notes': `已经登记过的会被提到最前面;没登记过的会加一条。⛔ 从不删、也不动对话归属。
⚠ 改的是 dsh 自己的文件($DSH_HOME/storages/workspace.json)。写之前会核对
  它的版本号,不认识就拒绝:那张表写错一个字段,整台 dsh 起不来(实测过)。`,

    'cmd.packages.usage': 'packages',
    'cmd.packages.summary': '看 dsh-box 替你下载的插件包,以及各被哪些档案柜用着',
    'cmd.packages.notes': `下载的包只存一份,谁要用就往那个档案柜链一根,所以删之前得先知道还有谁在用。
列表每行末尾就是这个答案,不用自己去各个档案柜翻。
⛔ plugins uninstall 故意不删包,为的是装回来是瞬间的事,所以清理是单独一步。`,
    'cmd.packages.rm.usage': 'packages rm <包名>',
    'cmd.packages.rm.summary': '删掉一个下载的包',
    'cmd.packages.rm.notes': `还有档案柜在用就会被拒绝(PACKAGE_IN_USE),先去那边 plugins uninstall。
⛔ 硬删会让那些档案柜指着一个不存在的包名,而 dsh 遇到那种情况会拒绝加载整棵插件树。`,
    'cmd.packages.prune.usage': 'packages prune',
    'cmd.packages.prune.summary': '清掉没有任何档案柜在用的下载',

    'cmd.plugins.backups.usage': 'plugins backups --sandbox <名> | --main',
    'cmd.plugins.backups.summary': '看这个档案柜的插件配置留了哪些备份',
    'cmd.plugins.backups.notes': `⭐ 只有日常档案柜留备份。沙箱本来就是干净启动的,玩坏了删掉整个沙箱就是,
  给它的配置留快照保护不了任何值得保护的东西。
最多留 {keepBackups} 份,改一次配置留一份,多出来的自动丢最老的。`,
    'cmd.plugins.backups.rm.usage': 'plugins backups rm <时间戳> --sandbox <名> | --main',
    'cmd.plugins.backups.rm.summary': '删掉某一份备份',
    'cmd.plugins.backups.prune.usage': 'plugins backups prune [--keep N] --sandbox <名> | --main',
    'cmd.plugins.backups.prune.summary': '按上限清一次备份;--keep 0 全清掉',
    'cmd.plugins.restore.usage': 'plugins restore --sandbox <名> | --main [--at <时间戳>]',
    'cmd.plugins.restore.summary': '把插件配置整份还原到某次改动之前',
    'cmd.plugins.restore.notes': `不写 --at 就是最近那一份。还原本身也会先备份现在这份,所以还原错了还能回来。
⭐ 这是「精确卸载」够不着时的后路:文件被别处改成我们认不出的形状,
  逐条删就找不到东西可删,那时整份还原。`,

    'cmd.sandboxes.usage': 'sandboxes',
    'cmd.sandboxes.summary': '列出沙箱',
    'cmd.start.usage': 'start --sandbox <名>|--new|--main [--version <版本号>]',
    'cmd.start.summary': '启动:不写 --version 就用你自己装的那台 dsh',
    'cmd.start.notes': `start ＝ 选两样东西:用哪台 dsh(机器) × 开哪个档案柜(DSH_HOME)
  机器    不写就是你自己装的那台 dsh;--version <版本号> 改用 dsh-box 下载的
  档案柜  --sandbox <名字> 某台沙箱 | --new 开一台新的 | --main 你日常的 ~/.dsh

  --plugin <id>      把一个插件装进这个档案柜(一直在),可重复
  --unplug <id>      反过来,把它从这个档案柜拿掉,可重复
  --no-sign-in       不导入登录     --follow  留在这里看日志(Ctrl+C 停掉它)

⚠ 什么都不沿用上次:不写 --sandbox 会被拒绝,不写 --version 就是你自己那台。
  同一条命令永远得到同一个结果。
⚠ 这里不说 dsh 打开哪个「工作区」(项目文件夹),那是 workspaces use 管的,
  而且 dsh 不会因为启动目录就登记一个工作区,实测过。
⭐ 插件是档案柜的属性,不是这次启动的:不写 --plugin 不是「一个都不装」,是「什么都不改」,
  这个档案柜之前装过的照样加载,你自己敲 dsh 也一样。要纯官方就开一个新沙箱。
沙箱名可用:字母(中文也可以)、数字、_ . - ,不能有空格,不能以 - 或 . 开头。

--main 只说档案柜,不说机器。--main 配 --version 是唯一「出事修不回来」的组合:
磁盘格式跨版本无迁移路径,且那台 dsh 在跑期间,这个 home 的模块指针指着 dsh-box。
⛔ 所以只有那一格会被拒(NEEDS_APPROVAL),要人在配置窗里亲手点过。agent 不要自己
  带 --approved:那个旗标是给人点过头之后用的,而且会留在操作记录里。`,
    'cmd.stop.usage': 'stop <沙箱名> | stop --main',
    'cmd.stop.summary': '停掉一个正在跑的沙箱,或停掉从这里启动的日常档案柜',
    'cmd.stop.notes': `⛔ 只停得掉从这里启动的那台日常档案柜,它有进程号可认。
你自己在别处开的那台,我们只知道 3080 在应答,认不出是哪个进程,不去动它。`,
    'cmd.adopt.usage': 'adopt <沙箱名> | adopt --from <名|main> --to <名|main>',
    'cmd.adopt.summary': '把对话从一个档案柜复制到另一个(复制,不是搬走)',
    'cmd.adopt.notes': `adopt <沙箱名>  ＝ --from <沙箱名> --to main,最常用的那个方向的简写。
要反过来(把日常档案柜的对话复制进某个沙箱)就写全:
  adopt --from main --to <沙箱名>
沙箱之间也可以,写两个沙箱名即可。

⭐ 只复制不搬走:原件留在来源那边,目标已经有的同一条会跳过,所以重复跑是安全的。
⛔ 目标那台 dsh 正跑着会被拒绝:dsh 只在启动时扫描对话目录,开着的时候复制进去它看不见。
  确认无碍可加 --force,那些对话会在它下次启动时出现。`,
    'cmd.rm.usage': 'rm <沙箱名>',
    'cmd.rm.summary': '删掉一个沙箱及其中一切',

    'cmd.config.usage': 'config',
    'cmd.config.summary': '看当前设置',
    'cmd.config.source.usage': 'config source <源>',
    'cmd.config.source.summary': '换安装源:auto | official | mirror',
    'cmd.config.lang.usage': 'config lang <zh|en>',
    'cmd.config.lang.summary': '换语言:{options}',
    'cmd.config.lang.notes': `语言是这个数据目录的设置,不是页面的偏好:命令行和配置窗跟着一起变,
所以两边永远说同一种语言。配置窗右上角那个开关跑的就是这条命令。

没设过就跟这台电脑的语言走;设过之后就以设的为准,不再看环境变量。
⛔ 错误代号(PLUGIN_NAME_TAKEN 之类)和写进你配置文件里的标记不翻译:
  它们是数据不是话,跟着语言变会让脚本和我们自己都认不出来。`,
    'cmd.config.ask-on-quit.usage': 'config ask-on-quit <on|off>',
    'cmd.config.ask-on-quit.summary': '关配置窗前提不提醒「会停掉所有沙箱」',
    'cmd.config.ask-on-daily.usage': 'config ask-on-daily <on|off>',
    'cmd.config.ask-on-daily.summary': '动到日常档案柜之前提不提醒',
    'cmd.config.reset.usage': 'config reset',
    'cmd.config.reset.summary': '设置文件读不懂时:把它存档,从空的重来',
    'cmd.config.reset.notes': `只在别的命令报 CONFIG_UNREADABLE 时才需要它。
⛔ 旧文件是改名存档,不是删掉:里面记着你登记过哪些插件目录,那份东西别处找不回来。
存档之后登记表是空的,但档案柜里已经装着的插件不受影响:那些写在档案柜自己的配置里。`,

    'cmd.ui.usage': 'ui [--port n]',
    'cmd.ui.summary': '打开配置窗',
    'cmd.quit.usage': 'quit [--main]',
    'cmd.quit.summary': '总退出:停下所有沙箱;加 --main 连日常档案柜一起停',
    'cmd.quit.notes': `没有一个常驻的 dsh-box 进程可关:每条命令都是自己的小进程,跑完就退。
所以「退出」只能是一件做出来的事,让所有沙箱停下。沙箱只是停下,不会被删。
ui 那个进程被 Ctrl+C 掉不算 quit,那只是结束了 ui 这一条命令,沙箱照跑。`,
    'cmd.status.usage': 'status',
    'cmd.status.summary': '此刻的全景:数据目录、版本、沙箱、谁在跑',
    'cmd.logs.usage': 'logs <沙箱名> [选项]',
    'cmd.logs.summary': '看某台沙箱最近一次启动说了什么',
    'cmd.logs.notes': `  --shape            只报形状(多少行/多大/几行像出错/最后一行),不吐正文
  --errors           只要像出错的行,各带前后三行
  --lines <n>        要多少行(默认 50 行或 4000 字符,谁先到算谁)
  --all              列出这台沙箱留着的所有日志文件
  --main             看日常档案柜启动的日志,不用给沙箱名
  --version <版本号> 看下载/删除那个版本时说了什么(下载中也能看,这就是进度)

⭐ 先 --shape 再决定读不读:无论日志多大,那个回答都是固定几百字符。
默认只给最后 50 行或 4000 字符,并且会明说省略了多少、全文在哪。`,
    'cmd.attach.usage': 'attach',
    'cmd.attach.summary': '接管:配置窗会显示你正在操作,并停止接受点击',
    'cmd.detach.usage': 'detach [--forced]',
    'cmd.detach.summary': '交还:配置窗恢复正常,操作记录留下可回看',
    'cmd.detach.notes': `--forced 表示不是自己交还的,是人按了配置窗上的停止把控制权收回去。
这一笔写进记录里,memory 读得到:「你在这里被拦下过」是下次最该知道的事。`,
    'cmd.memory.usage': 'memory',
    'cmd.memory.summary': '看上次接管期间做了哪些操作(含被拒绝的)',

    'help.title': 'dsh 沙箱启动器 —— 在隔离沙箱里跑 DeepSeek Harness',
    'help.perCommand': '某一条的细则: help <命令> 或 <命令> --help(例如 help start)',
    'help.machineReadable': '机器可读的一份: --help --json,给出的就是驱动这个命令行的那张表',
    'help.common': `通用选项: --json 以 JSON 输出结果(给脚本和 Agent 用)。
  成功是一行 {"box":…,"ok":true,…},失败是一行 {"box":…,"ok":false,"code":…}。
  code 是不会变的标识,message 是给人看的、随时可能改写。
数据默认放在 ./dsh-box/data(可用 --box <目录> 或环境变量 DSH_BOX_HOME 改)。`,
    'help.flags': '旗标',
    'help.valuePlaceholder': '值',
    'help.mutates': '会改变状态,所以会记进操作记录',
    'help.readOnly': '只读,不改任何东西',
    'help.noSuchTopic': '没有叫「{topic}」的命令,不带参数运行可看全部',
    'help.unknownCommand': '不认识的命令「{command}」,不带参数运行可看用法',

    'sandbox.created': '沙箱「{name}」已新建',
    'sandbox.reused': '沙箱「{name}」已复用',
    'sandbox.ownConversations': '它的对话只属于它,别的沙箱看不到',
    'sandbox.signInImported': '登录已导入',
    'sandbox.plain': '这个档案柜一个插件都没有:纯官方的 dsh',
    'sandbox.holds': '这个档案柜装着:{names}',

    'launch.starting': '正在启动 {version},端口 {port}',
    'launch.ready': '已就绪:页面带着启动清单,且进程稳定',
    'launch.portTaken': '端口 {port} 这一刻被别人占了,多半是同时启动的另一台;改用 {next} 再试一次',
    'launch.needsExposeInternals': '这台 Node 拿不到内部加载器,启动补上 --expose-internals;否则 dsh 起不来,插件也解析不到',
    'launch.clearedModuleLinks': '已清掉可能指错版本的模块链接,启动时会重建',
    'launch.open': '打开 {url}',
    'launch.realKey': '用的是你真实的 API Key,这里的对话真实计费',
    'launch.logAt': '日志 {file}',
    'launch.detached': '在后台跑着(进程号 {pid}),停它: stop {name}',
    'launch.noFreePort': '在 {from} 到 {to} 之间找不到空闲端口',
    'launch.linkDangling': '「{name}」链上去之后指向了不存在的地方,登记的路径是 {path}。重新登记一次这个插件目录,用完整路径',
    'launch.noHostDshFile': '你自己装的 dsh 里没有 {entry} 这个文件,它可能刚被卸载,或者升级到一半',
    'launch.versionNotDownloaded': '版本 {version} 还没下载',
    'launch.sandboxAlreadyRunning': '沙箱「{name}」已经开着:{url}(进程 {pid})。同一个沙箱同时只能跑一台,两台会互踩同一份档案柜。要并行就换个沙箱,要重启就先停掉它',
    'launch.bootExited': 'dsh 还没启动完就退出了,退出码 {code}',
    'launch.bootExitedLate': 'dsh 服务完页面之后退出了,退出码 {code}',
    'launch.bootTimeout': 'dsh 在 {seconds} 秒内没有启动完成',
    'launch.badPid': '拒绝停止进程号 {pid}',

    'cabinet.daily': '日常档案柜',
    'sandbox.noFreeName': '{prefix}-{stamp}-1 到 -999 都被占着了,给它起个名字吧',
    'sandbox.noSuch': '没有叫「{name}」的沙箱',
    'sandbox.runningCannotDelete': '「{name}」正在跑(进程 {pid}),先 stop {name} 再删',

    'adopt.sameCabinet': '从哪儿复制到哪儿是同一个档案柜,没什么可做的',
    'adopt.noSessions': '{label}里还没有任何对话',
    'adopt.destinationRunning': '{label} 上正跑着一台 dsh,先把它关掉再复制。dsh 只在启动时扫描对话目录,开着的时候复制进去它看不见。确认无碍可以加 --force,那些对话会在它下次启动时出现',

    'plugin.installed': '已把「{name}」装进{where}',
    'plugin.installedWhere': '写在 {file}——你自己敲 dsh 也会加载它',
    'plugin.removeHint': '要拿掉: plugins uninstall {id} {cabinet}',
    'plugin.uninstalled': '已把「{name}」从{where}拿掉',
    'plugin.folderUntouched': '没有改动你那个文件夹',

    'restore.done': '{where} 的插件配置已还原到 {at} 那一份',
    'restore.linksNotRolledBack': '只还原了配置,链接没有跟着回滚。少了的插件不会被加载,多出来的链接是空占位',

    'version.notDownloadedAlready': '{version} 本来就没下载',
    'version.inUse': '「{sandbox}」正用着 {version}(进程 {pid}),先 stop {sandbox} 再删',
    'version.deleting': '正在删除 {version}…',
    'version.deletingSized': '正在删除 {version},约 {mb} MB…',
    'version.stillDeleting': '还在删,已 {seconds} 秒',
    'version.deleted': '{version} 已删除',

    'host.versionNotDownloaded': '版本 {version} 还没下载,试试: pull {version}',
    'host.noHostDsh': '没找到你自己装的 dsh。两条路:装一台(npm i -g @deepseek-ai/dsh),或者用 --version <版本号> 指定一个 dsh-box 已经下载的版本',
    'engine.unknown': '不知道用的哪台',
    'engine.versionUnreadable': '版本读不出',
    'engine.host': '你自己装的 {version}',
    'engine.release': 'dsh-box 下载的 {version}',

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
    'window.agentHolds': 'agent 正在控制这个数据目录,窗口暂时不发命令。要自己操作,先在窗口上按「停止并收回」',
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

    'config.unreadable': '读不懂 {file}:{error}\n  没有动它。这个文件记着你登记过的插件和上次的选择,覆盖掉就找不回来了。\n  自己修好它,或者 config reset 把它存档、从空的重来。',
    'config.notAnObject': '{file} 里不是一个对象,读不懂。没有动它;config reset 可以存档重来',
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

    'status.labelDataDir': '数据目录',
    'status.labelAgent': '接管中',
    'status.labelHost': '本机 dsh',
    'status.labelDownloaded': '已下载',
    'status.labelPlugins': '记住插件',
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
    'status.mainRunning': '从这里启动着 {url}(进程 {pid}),停它: stop --main',
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
    'logs.which': '看哪个沙箱的日志? 或者用 --main 看日常档案柜、--version <版本号> 看下载',

    'attach.done': '已接管。配置窗会显示你的操作并停止接受点击,窗口上的「退出」按钮可以随时收回。',
    'attach.session': '会话 {session}',
    'detach.nobody': '本来就没人在接管',
    'detach.forced': '已收回控制权。配置窗恢复正常,刚才的操作可以在窗口里回看',
    'detach.done': '已交还。配置窗恢复正常,刚才的操作可以在窗口里回看',
    'session.endedForced': '人按了停止收回',
    'session.endedDone': 'agent 自己交还',
    'memory.none': '还没有任何接管期间的操作记录',
    'memory.header': '会话 {session}  开始于 {at}',
    'memory.stillOpen': '尚未结束',
    'memory.endedAt': '结束于 {at}({how})',
    'memory.ok': '成功',
    'memory.refused': '被拒:{code}',

    'box.usingInstead': '改用 {dir} —— 想自己指定就加 --box <目录>',

    'versions.downloaded': '已下载',
    'versions.noneDownloaded': '(还没有 —— 试试: pull 0.1.0-rc.7)',
    'versions.pinned': '版本已逐包核对',
    'versions.mixed': '版本混杂 —— 请重新下载',
    'versions.registryDown': '(连不上 npm: {error})',
    'versions.available': 'npm 上可选',
    'versions.tagLatest': '官方稳定版',
    'versions.tagNext': '官方尝鲜版',
    'pull.which': '要哪个版本? 例如: pull 0.1.0-rc.7',
    'pull.ready': '{version} 已就绪',
    'drop.which': '要删哪个版本? 用 versions 查看',
    'drop.redownload': '用过它的沙箱,下次启动前要重新下载',

    'cabinet.bothFlags': '--main 和 --sandbox 说的是同一件事的两个答案:哪个档案柜。只能给一个',
    'cabinet.which': '装到哪个档案柜? --sandbox <名字> 某台沙箱,--main 你日常的 ~/.dsh',

    'plugins.addWhich': '哪个目录? 例如: plugins add ../my-plugin',
    'plugins.remembered': '已记住 {package},id 为「{id}」',
    'plugins.rememberedReplaced': '已记住 {package},id 为「{id}」(换掉了同 id 的旧记录)',
    'plugins.cabinetHeader': '{cabinet} 现在装着的插件',
    'plugins.unreadableWarn': '这个档案柜的插件配置读不懂,下面这份可能不全',
    'plugins.cabinetEmpty': '(一个都没有 —— 纯官方 dsh)',
    'plugins.oursLine': '{package}  ← dsh-box 装的,卸得掉',
    'plugins.theirsLine': '{name}  ← 这个档案柜本来就有,不归这里动',
    'plugins.platform': '官方基座(每个 profile 都有):{names}',
    'plugins.patchAt': '配置在 {file}',
    'plugins.registryHeader': '记住的插件(这是登记表,还没装进任何档案柜)',
    'plugins.registryEmpty': '(没有 —— 试试: plugins add <目录>)',
    'plugins.missingLine': '{package}  ← 文件夹已不在',
    'plugins.installHint': '装进某个档案柜: plugins install <id> --sandbox <名>|--main',
    'plugins.installWhich': '装哪个插件? 给一个登记过的 id、一个插件目录,或者一个 npm 包名',
    'plugins.rmWhich': '拿掉哪个 id? 用 plugins 查看',
    'plugins.rmUnknown': '没记过「{id}」,也没有哪个档案柜装着它',
    'plugins.rmApprovalDownloaded': '「{package}」不只在沙箱里,{daily}也装着它。\n  拿掉它会一并从{places}卸下来,并删掉下载的那份包。\n  改的是那个档案柜自己的配置,所以你直接敲 dsh 也会跟着变。\n  确认了就带 --approved;不想每次都问:config ask-on-daily off',
    'plugins.rmApprovalYours': '「{package}」不只在沙箱里,{daily}也装着它。\n  拿掉它会一并从{places}卸下来,你自己那个文件夹不动。\n  改的是那个档案柜自己的配置,所以你直接敲 dsh 也会跟着变。\n  确认了就带 --approved;不想每次都问:config ask-on-daily off',
    'plugins.rmHeader': '「{package}」',
    'plugins.rmNowhere': '没有哪个档案柜装着它',
    'plugins.rmDetached': '已从{cabinet}卸下',
    'plugins.rmUnregistered': '已从登记表移除',
    'plugins.rmUnregisteredNever': '已从登记表移除(本来也没记过)',
    'plugins.rmPackageDeleted': '下载的那份包也删了 —— 要用再下一次',
    'plugins.rmFolderUntouched': '你那个文件夹一个字节都没动',
    'plugins.unreadablePatch': '读不懂{cabinet}的插件配置({file}),所以不会去改它——先看看那个文件出了什么事,或者从备份还原',
    'plugins.nameTakenAt': '「{package}」这个名字在{cabinet}里已经被别的东西占着了,指向 {points}。\n  没有动它——那不是 dsh-box 装的,换掉就撤不回来了。\n  真要换成 {wanted},得先由装它的人把原来那个卸掉。',
    'plugins.nameTakenGone': '「{package}」这个名字在{cabinet}里已经被别的东西占着了,而它指向的地方已经不在了。\n  没有动它——那不是 dsh-box 装的,换掉就撤不回来了。\n  真要换成 {wanted},得先由装它的人把原来那个卸掉。',
    'plugins.alreadyThere': '{cabinet}里已经装着「{package}」,而且指的就是 {points}',
    'plugins.nothingDone': '什么都没做',
    'plugins.raceTaken': '「{package}」在这中间被别的东西登记进{cabinet}了',
    'plugins.raceCheck': 'patch 没有改动,但链接已经建了。核对一下这个名字现在指向哪:',
    'backup.saved': '改之前那份已备份到 {file}',
    'plugins.badPackageName': '「{name}」既不是存在的目录,也不像一个 npm 包名。目录要有 package.json;包名只能是小写字母、数字和 . _ -,可以带 @scope/',
    'packages.treeDescription': 'dsh-box 替你下载的插件都放在这儿',
    'plugins.downloading': '正在从 {registry} 下载 {name}',
    'npm.saidOkButEmpty': 'npm 说装好了,但 {dir} 里没有东西',
    'plugins.downloaded': '下载好了,在 {dir}',
    'npm.installExit': 'npm 装不上(退出码 {code})——{last}',
    'npm.saidNothing': '它什么也没说',
    'plugins.uninstallWhich': '拿掉哪个? 用 plugins --sandbox <名> 看这个档案柜装着什么',
    'plugins.notOurs': '「{id}」是{cabinet}本来就装着的,不是 dsh-box 装的——我们不动别人写进去的东西。要拿掉它请用装它的那个办法',
    'plugins.notInstalled': '{cabinet}里没有 dsh-box 装的「{id}」——用 plugins {flags} 看看有什么',

    'backups.unknownAction': 'plugins backups 只认 rm 和 prune,不认「{action}」',
    'backups.header': '{cabinet} 的插件配置备份',
    'backups.noneMain': '(还没有 —— 备份是改插件配置时才产生的)',
    'backups.noneSandbox': '(沙箱不留备份 —— 它本来就是干净启动的,玩坏了删掉就是)',
    'backups.limit': '最多留 {keep} 份,多的会自动丢掉最老的',
    'backups.restoreHint': '还原最近那份: plugins restore {where}',
    'backups.rmHint': '删掉某一份:   plugins backups rm <时间戳> {where}',
    'backups.pruneHint': '全清掉:       plugins backups prune --keep 0 {where}',
    'backups.rmWhich': '删哪一份? 时间戳用 plugins backups 看',
    'backups.noSuch': '没有 {at} 这一份',
    'backups.removed': '{cabinet} 的备份 {at} 已删掉,还剩 {count} 份',
    'flag.keepInteger': '--keep 要一个不小于 0 的整数,给的是「{value}」',
    'backups.pruned': '{cabinet}:留下最近 {keep} 份,删掉了 {count} 份',
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
    'history.omitted': '省略了前面 {count} 条 —— 要全部: history --lines 0',
    'history.unreadable': '另有 {count} 行读不出来,没有算进上面的数目',
    'history.fullAt': '全文在 {files}',
    'history.noFile': '(还没有这个文件)',

    'workspaces.useWhich': '用哪个目录? 例如: workspaces use E:\\code\\my-repo --sandbox 甲',
    'workspaces.next': '{cabinet} 下次打开的工作区:{path}',
    'workspaces.addedNew': '这是新登记的一条',
    'workspaces.movedFront': '本来就登记着,提到了最前面',
    'workspaces.alreadyFront': '本来就在最前面,没有改动',
    'workspaces.writtenTo': '写在 {file}',
    'workspaces.unknownAction': 'workspaces 只认 use,不认「{action}」',
    'workspaces.header': '{cabinet} 见过的工作区    第一条就是打开时进的那个',
    'workspaces.neverStarted': '(这个档案柜还没启动过,或者一个项目都没选过)',
    'workspaces.emptyList': '(一个都没有 —— dsh 不会自己登记当前目录)',
    'sessions.count': '{count} 条对话',
    'workspaces.switchHint': '换一个: workspaces use <目录> {where}',
    'workspaces.atFile': '在 {file}',

    'packages.rmWhich': '删哪个包? 用 packages 看有哪些',
    'packages.noSuch': '没下载过「{name}」',
    'packages.inUse': '「{name}」还装在 {usedBy} 里,没有删。\n  先从那些档案柜卸掉它(plugins uninstall),再回来删这个包。\n  直接删掉会让那些档案柜指着一个不存在的包名,而 dsh 遇到那种情况会拒绝加载整棵插件树',
    'packages.removed': '「{name}」的下载已经删掉了,要用再下一次',
    'packages.pruned': '删掉了 {count} 个没有任何档案柜在用的下载',
    'packages.unknownAction': 'packages 只认 rm 和 prune,不认「{action}」',
    'packages.header': 'dsh-box 替你下载的插件包    一份共享,谁要用就往谁那儿链一根',
    'packages.empty': '(还没有 —— plugins install <包名> 会下到这里)',
    'packages.nobodyUses': '没有档案柜在用',
    'packages.usedBy': '用着的:{list}',
    'packages.filesCount': '{count} 个文件',
    'packages.at': '在 {dir}',
    'packages.hints': '删一个: packages rm <包名>      清掉没人用的: packages prune',

    'sandboxes.header': '沙箱                每个都是一台独立的 dsh,彼此看不到对方的对话',
    'sandboxes.none': '(还没有)',
    'sandboxes.signedIn': '已登录',
    'sandboxes.notSignedIn': '未登录',
    'sandboxes.runningAt': '正在跑 {url}',

    'adopt.bothForms': 'adopt <沙箱名> 和 --from/--to 是同一件事的两种写法,只能用一种',
    'adopt.which': '从哪儿复制到哪儿? adopt <沙箱名> 把那个沙箱的对话复制进你日常的 ~/.dsh;要别的方向就写全:--from <沙箱名|main> --to <沙箱名|main>',
    'adopt.copied': '已从{from}复制 {adopted} 条对话到{to},跳过 {skipped} 条重复',
    'adopt.originalsStay': '原件都还在{from},这是复制不是搬走',
    'adopt.visibleNextStart': '{to} 下次启动即可看到',

    'start.bothFlags': '--main 和 --sandbox/--new 说的是同一件事的两个答案:开哪个档案柜。只能给一个',
    'start.whichCabinet': '要开哪个档案柜? --sandbox <名字> 用某台沙箱,--new 开一台新的,--main 用你日常的 ~/.dsh。不写不再沿用上次——同一条命令应当永远得到同一个结果',
    'start.unknownPlugins': '没记过这些插件 id:{list} —— 用 plugins 查看',
    'start.pluginGone': '注意:「{id}」被勾着但文件夹已不在,这次不装它',
    'start.mainNeedsApproval': '用 dsh-box 下载的版本去开你真实的 ~/.dsh,是唯一一个出事修不回来的组合,要有人亲手点过头才执行。开着配置窗做这件事:dsh-box ui,在里面选日常档案柜和这个版本,弹窗会说清会发生什么。你若是 agent,不要自己带 --approved 绕过去——那等于替人点头。',
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

    'stop.mainNotRunning': '日常档案柜现在没有从这里启动的实例在跑',
    'stop.mainNote': '3080 上若有一台,那是你自己开的,不归这里管',
    'stop.mainStopped': '已停掉日常档案柜(进程号 {pid})——它的 home 是你日常那个,数据都还在',
    'stop.which': '停哪个沙箱? 用 sandboxes 查看,或用 --main 停日常档案柜',
    'stop.notRunning': '沙箱「{name}」现在没有在跑',
    'stop.stopped': '已停掉「{name}」(进程号 {pid})',
    'rm.which': '哪个沙箱? 用 sandboxes 查看',
    'rm.removed': '已删除「{name}」—— 那台 dsh 不复存在',

    'settings.header': '设置',
    'settings.choicesLine': '可选:{choices}',
    'settings.unknown': '没有叫「{key}」的设置 —— 不带参数运行 config 可看全部',
    'settings.whichValue': '把 {key} 设成什么? 可选:{choices}',
    'settings.badValue': '{key} 不能设成「{value}」——可选:{choices}',
    'config.nothingToReset': '{file} 本来就不在,没什么可重置的',
    'config.archived': '旧的设置存到了 {file}——没有删,里面记着你登记过哪些插件',
    'config.freshStart': '下一条命令会从空的重新开始',

    'quit.nothingRunning': '没有沙箱在跑,不用停什么',
    'quit.stopped': '已停下 {count} 台沙箱:{names}',
    'quit.mainStopped': '日常档案柜也停了(进程号 {pid})——它的 home 是你日常那个,数据都还在',
    'quit.mainLeft': '日常档案柜是从这里启动的,还留着(要一起停:加 --main)',
    'quit.mainForeign': '3080 上有一台 dsh,但不是从这里启动的,动不了也不该动',

    'flag.noValue': '--{flag} 是开关,不接受取值',
    'flag.unknown': '不认识的选项「--{flag}」——不带参数运行可看用法',
    'flag.needsValue': '--{flag} 后面要跟一个值',
    'error.lastLines': '它最后说的 {count} 行:',

    'ui.title': 'dsh 沙箱启动器',
    'ui.intro': '隔离沙箱里试版本、试插件,不影响日常档案柜。也可让 agent 通过 CLI 选择要启动的 dsh 本体与沙箱档案柜环境。',
    'ui.booting': '正在读取…',
    'ui.bootingSlow': '版本清单要问一次 npm,慢的是这一步',
    'ui.machineCard': 'dsh 本体',
    'ui.pull': '下载',
    'ui.customVersionPh': '或直接填版本号,例如 0.0.1-rc.1',
    'ui.sourceLabel': '安装源',
    'ui.sourceAuto': '自动',
    'ui.sourceOfficial': '官方 npm',
    'ui.sourceMirror': '中国镜像',
    'ui.olderVersions': '更早的内测版本',
    'ui.cabinetCard': '档案柜',
    'ui.newSandboxPh': '新沙箱档案柜的名字',
    'ui.newSandbox': '新建',
    'ui.importSignIn': '导入登录凭据',
    'ui.importSignInNote': '只对新建的沙箱档案柜有意义',
    'ui.pluginsCard': '这个档案柜的插件',
    'ui.pluginDirPh': '插件目录路径(里面要有 package.json)',
    'ui.browse': '浏览…',
    'ui.addPlugin': '添加',
    'ui.runningCard': '正在运行',
    'ui.quit': '退出 dsh-box',
    'ui.lockedHint': 'agent 正在控制,这个操作暂不执行 —— 要自己动手,先按上面的「停止并收回」',
    'ui.stopAgent': '停止并收回',
    'ui.cancel': '取消',
    'ui.ok': '确定',
    'ui.notice': '提示',
    'ui.dontAskAgain': '下次不再提醒',
    'ui.dropDontAskNote': '之后动到日常档案柜时直接执行',
    'ui.dropConfirm': '卸下并移除',
    'ui.quitMainToo': '连日常档案柜一起停',
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
    'ui.unreadableWarn': '这个档案柜的插件配置读不懂,下面这份可能不全。在有人看过之前不会去动它——命令行可以整份还原:plugins restore',
    'ui.willRemoveNote': '按下启动时会从这个档案柜拿掉',
    'ui.installedHereNote': '已经装在这个档案柜里',
    'ui.tagGoing': '要拿掉',
    'ui.tagHave': '已装',
    'ui.tagAdd': '这次装上',
    'ui.tagNot': '没装',
    'ui.tagTheirs': '本来就有',
    'ui.theirsNote': '这个档案柜本来就有的,不是 dsh-box 装的,这里动不了',
    'ui.uninstallDelete': '卸载并删除',
    'ui.forget': '不再记',
    'ui.uninstallDeleteTitle': '从每个档案柜卸下,并删掉下载的那份包',
    'ui.forgetTitle': '从每个档案柜卸下并忘记它;你自己那个文件夹不动',
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
    'ui.endedForced': '你按了停止收回',
    'ui.recallLiveOpen': '收起 agent 正在做的 {count} 步',
    'ui.recallLiveClosed': '展开 agent 正在做的 {count} 步',
    'ui.recallPastOpen': '收起上次 agent 的 {count} 步操作',
    'ui.recallPastClosed': '回看上次 agent 的 {count} 步操作',
    'ui.refusedLine': '被拒 {code}:{message}',
    'ui.tookOver': '{at} 接管',
    'ui.notHandedBack': ',尚未交还',
    'ui.endedAtLine': ',{at} 结束({how})',
    'ui.noActionYet': '还没有动作',
    'ui.doingNow': '正在 <b>{name}</b>',
    'ui.badgeRefused': '<b>{name}</b> <span class="bad">被拒 {code}</span>',
    'ui.badgeDone': '<b>{name}</b> 已完成',
    'ui.tookOverAt': '接管于 {at}',
    'ui.agentDriving': 'agent 正在操作',
    'ui.stepsSoFar': '已做 {count} 步',
    'ui.secondsAgo': '{count} 秒前',
    'ui.minutesAgo': '{count} 分钟前',
    'ui.hoursAgo': '{count} 小时前',
    'ui.staleRetry': '这个页面是上一次打开的窗口留下的,正在刷新——刷新后再点一次',
    'ui.detachFailed': '没能交还:{error}',
    'ui.pullNeedsVersion': '先填一个版本号,或在上面选一个要下载的版本——「你自己装的那台」不是从 npm 下的,没法下载。',
    'ui.pullingHead': '正在下载 {version}…',
    'ui.pullDone': '{version} 已就绪:{packages} 个包已核对。',
    'ui.approveHead': 'dsh　　　<b>沙箱版本 {version}</b>,非本机<br>档案柜　<b>本机档案柜 ~/.dsh</b>',
    'ui.approvePoint1': '1. <b>磁盘格式跨版本</b>——本地 dsh 打不开更改后的档案柜。',
    'ui.approvePoint2': '2. <b>档案柜里有一层链接</b>,记着上次用的是哪个本体。这次会指到 dsh-box,非正常退出原来的链接失效。',
    'ui.approvePoint3': '3. 如果通过其他方式启动本机 dsh,此时<b>两台 dsh 指向本机档案柜</b>,易冲突损坏档案柜。',
    'ui.approveOk': '照做',
    'ui.startingHead': '正在启动…',
    'ui.sandboxQuoted': '沙箱「{name}」',
    'ui.startedMsg': '{where}已启动,用的是{engine} {version}。',
    'ui.openUrl': '打开 {url}',
    'ui.nameRule': '名字可用:{rule}',
    'ui.quitRowSandboxNone': '沙箱　　　没有在跑的',
    'ui.quitRowSandbox': '沙箱　　　{count} 台在跑:{names}',
    'ui.quitRowMainHere': '档案柜　　本机档案柜从这里启动着(进程 {pid}),默认不停',
    'ui.quitRowMainForeign': '档案柜　　3080 上有一台,不是从这里启动的,认不出进程,不会去动',
    'ui.quitRowMainNone': '档案柜　　没有从这里启动的',
    'ui.quitPoint1': '1. <b>沙箱只是停下</b>,对话与配置都还在,下次启动同名的接着用。',
    'ui.quitMainNote': '不勾就让它继续跑',
    'ui.quitAlsoMain': ',日常档案柜也停了(进程 {pid})',
    'ui.quitDoneTitle': '已退出',
    'ui.quitDoneBody': '已停下 {count} 台沙箱{alsoMain}。这个页面可以关掉了。',
    'ui.stateUnreadable': '读不到状态:{error}',
    'ui.dropRowPlugin': '插件    {label}',
    'ui.dropRowPlaces': '装在    {places}',
    'ui.dropPoint1': '1. <b>连日常档案柜一起卸</b>,改的是那个档案柜自己的配置,所以你直接敲 dsh 也会跟着变。',
    'ui.dropPoint2Downloaded': '2. <b>下载的那份包也会删掉</b>,要用再下一次。',
    'ui.dropPoint2Yours': '2. <b>你自己那个文件夹不动</b>,只去掉链接与登记。',
  },

  en: {
    'lang.name': 'English',

    'cmd.versions.usage': 'versions',
    'cmd.versions.summary': 'Which releases are downloaded, and which exist on npm',
    'cmd.pull.usage': 'pull <release>',
    'cmd.pull.summary': 'Download an official release (every package version checked)',
    'cmd.drop.usage': 'drop <release>',
    'cmd.drop.summary': 'Delete a downloaded release (about 200–260MB)',

    'cmd.plugins.usage': 'plugins [--sandbox <name> | --main]',
    'cmd.plugins.summary': 'With no cabinet, list the registry; with one, list what that cabinet actually has',
    'cmd.plugins.add.usage': 'plugins add <folder> [--id x]',
    'cmd.plugins.add.summary': 'Remember a plugin folder (it needs a package.json)',
    'cmd.plugins.rm.usage': 'plugins rm <id> [--approved]',
    'cmd.plugins.rm.summary': 'Get rid of a plugin entirely: out of every cabinet, out of the registry, and the downloaded package with it',
    'cmd.plugins.rm.notes': `⭐ What this does depends on whose files the plugin is, and on nothing else:
  your own folder (registered with plugins add <folder>)
      links and config entries come out of every cabinet, and the registry row goes.
      ⛔ Not one byte of your folder is touched.
  downloaded by dsh-box (fetched by plugins install <package>)
      the same, plus the downloaded package is deleted: it lives in our own
      directory, and nobody else can delete it.

⚠ It sweeps every cabinet, not only the one you last installed into. When your
  everyday cabinet is involved it stops first and says exactly what it would
  touch; --approved continues. To stop being asked: config ask-on-daily off.
⛔ It can only sweep cabinets dsh-box knows about (the sandboxes it made, plus
  your everyday cabinet). A DSH_HOME you made by hand and never opened from
  here is invisible to it.`,
    'cmd.plugins.install.usage': 'plugins install <id|folder|package> --sandbox <name> | --main',
    'cmd.plugins.install.summary': 'Install a plugin into one cabinet, for good, until you take it out',
    'cmd.plugins.install.notes': `⭐ Remembering and installing are two layers. Do not mix them up:
  plugins add <folder>   dsh-box now knows this plugin (the registry).
                         No cabinet has it yet.
  plugins install …      actually puts it into one cabinet; dsh loads it from
                         then on.

What goes in is written into that cabinet's own profile config, so typing dsh
yourself loads it too, not only when the launch came from here. Take it back
out with plugins uninstall.
⭐ The file is backed up in full before it is touched (plugins backups lists
  them, plugins restore puts one back).
⛔ Only the lines we wrote come out again; plugins the cabinet already had are
  not ours to touch.`,
    'cmd.plugins.uninstall.usage': 'plugins uninstall <id> --sandbox <name> | --main',
    'cmd.plugins.uninstall.summary': 'Take a plugin out of one cabinet',

    'cmd.history.usage': 'history [--lines N] [--shape]',
    'cmd.history.summary': 'Everything ever done in this data directory (the permanent record)',
    'cmd.history.notes': `⛔ Not the same thing as memory. Do not mix them up:
  memory   what an agent did while it last held the window: a display, and the
           next session overwrites it
  history  everything this data directory has ever done: permanent, append-only

Without --lines you get the last {historyLines}. How much was left out is said
out loud, and the path to the whole file comes with it.
--lines 0 is everything; --shape answers only "how big, from when to when, how
  many failed", and that answer is a few lines however long the record is.

⚠ Only commands that change something are recorded. At 2MB it rotates (.1), and
the generation before that is dropped.`,

    'cmd.workspaces.usage': 'workspaces --sandbox <name> | --main',
    'cmd.workspaces.summary': 'Which workspaces this cabinet has seen (the first one is what it opens into)',
    'cmd.workspaces.notes': `⚠ Two words, and they are not two of a kind:
  cabinet    one DSH_HOME, holding conversations, config and sign-in. This is
             what --main and --sandbox name.
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
    'cmd.workspaces.use.usage': 'workspaces use <folder> --sandbox <name> | --main [--title <title>]',
    'cmd.workspaces.use.summary': 'Make this cabinet open into this workspace next time',
    'cmd.workspaces.use.notes': `One already on the list moves to the front; one that is not gets added.
⛔ Nothing is ever removed, and which conversation belongs where is not touched.
⚠ This writes dsh's own file ($DSH_HOME/storages/workspace.json). Its version is
  checked first and an unfamiliar one is refused: one wrong field in that table
  and dsh will not start at all (measured).`,

    'cmd.packages.usage': 'packages',
    'cmd.packages.summary': 'Plugin packages dsh-box downloaded for you, and which cabinets use each one',
    'cmd.packages.notes': `A downloaded package is kept once and linked into whichever cabinet wants it,
so before deleting one you need to know who is still using it. The end of each
line is that answer; you do not have to go through the cabinets yourself.
⛔ plugins uninstall deliberately leaves the package alone, so that putting it
back is instant. Cleaning up is therefore a separate step.`,
    'cmd.packages.rm.usage': 'packages rm <package>',
    'cmd.packages.rm.summary': 'Delete one downloaded package',
    'cmd.packages.rm.notes': `Refused while any cabinet still uses it (PACKAGE_IN_USE); run plugins uninstall
there first.
⛔ Deleting it anyway would leave those cabinets pointing at a package name that
does not resolve, and dsh refuses to load the whole plugin tree when that happens.`,
    'cmd.packages.prune.usage': 'packages prune',
    'cmd.packages.prune.summary': 'Clear downloads that no cabinet is using',

    'cmd.plugins.backups.usage': 'plugins backups --sandbox <name> | --main',
    'cmd.plugins.backups.summary': 'Which backups exist of this cabinet\'s plugin config',
    'cmd.plugins.backups.notes': `⭐ Only your everyday cabinet keeps backups. A sandbox is a clean start you
  throw away; if you break one, delete the whole sandbox. A snapshot of its
  config protects nothing that was worth protecting.
At most {keepBackups} are kept, one per change, and the oldest goes when there
are more.`,
    'cmd.plugins.backups.rm.usage': 'plugins backups rm <timestamp> --sandbox <name> | --main',
    'cmd.plugins.backups.rm.summary': 'Delete one backup',
    'cmd.plugins.backups.prune.usage': 'plugins backups prune [--keep N] --sandbox <name> | --main',
    'cmd.plugins.backups.prune.summary': 'Trim backups to the limit; --keep 0 clears them all',
    'cmd.plugins.restore.usage': 'plugins restore --sandbox <name> | --main [--at <timestamp>]',
    'cmd.plugins.restore.summary': 'Restore the whole plugin config to how it was before some change',
    'cmd.plugins.restore.notes': `Without --at you get the most recent one. Restoring makes a backup of the
current file first, so restoring the wrong one is not the end of the road.
⭐ This is the way out when precise removal cannot reach: if the file has been
  edited elsewhere into a shape we no longer recognise, removing our entries
  one by one finds nothing to remove, and the whole file goes back instead.`,

    'cmd.sandboxes.usage': 'sandboxes',
    'cmd.sandboxes.summary': 'List the sandboxes',
    'cmd.start.usage': 'start --sandbox <name>|--new|--main [--version <release>]',
    'cmd.start.summary': 'Start. Without --version this uses the dsh you installed yourself',
    'cmd.start.notes': `start = picking two things: which dsh (the machine) × which cabinet (DSH_HOME)
  machine  unset means the dsh you installed yourself; --version <release>
           switches to one dsh-box downloaded
  cabinet  --sandbox <name> a sandbox | --new a fresh one | --main your own ~/.dsh

  --plugin <id>      install a plugin into this cabinet, for good. Repeatable
  --unplug <id>      the reverse: take it out of this cabinet. Repeatable
  --no-sign-in       do not import the sign-in
  --follow           stay here and watch the log (Ctrl+C stops it)

⚠ Nothing carries over from last time: omitting --sandbox is refused, and
  omitting --version means the machine this computer has.
  The same command always gives the same result.
⚠ This says nothing about which workspace (project folder) dsh opens. That is
  what workspaces use is for, and dsh does not register a workspace just
  because it was started in one. Measured.
⭐ A plugin is a property of the cabinet, not of this launch: leaving out
  --plugin does not mean "install none", it means "change nothing". Whatever
  this cabinet already had still loads, and it loads when you type dsh too.
  For plain official dsh, make a new sandbox.
Sandbox names may use letters (Chinese is fine), digits, _ . - ; no spaces, and
not starting with - or .

--main names a cabinet, not a machine. --main together with --version is the one
combination that cannot be undone: on-disk formats have no migration path
between releases, and while that dsh runs, this home's module pointers aim into
dsh-box's directory.
⛔ So that one square is refused (NEEDS_APPROVAL) until a person has clicked
  through it in the config window. An agent should not pass --approved itself:
  that flag exists for after a person has agreed, and it stays in the record.`,
    'cmd.stop.usage': 'stop <sandbox> | stop --main',
    'cmd.stop.summary': 'Stop a running sandbox, or the everyday cabinet started from here',
    'cmd.stop.notes': `⛔ Only an everyday cabinet started from here can be stopped; that one has a
process id we can name.
One you started elsewhere yourself is something we only see as "3080 answers".
We cannot tell which process it is, so we leave it alone.`,
    'cmd.adopt.usage': 'adopt <sandbox> | adopt --from <name|main> --to <name|main>',
    'cmd.adopt.summary': 'Copy conversations from one cabinet into another (a copy, not a move)',
    'cmd.adopt.notes': `adopt <sandbox>  = --from <sandbox> --to main, short for the common direction.
For the other way round (copying your everyday conversations into a sandbox),
write it out:
  adopt --from main --to <sandbox>
Between two sandboxes works too: name both.

⭐ Copied, not moved: the originals stay where they were, and anything the
  destination already has is skipped, so running it again is safe.
⛔ Refused while a dsh is running on the destination: dsh scans the conversation
  directory only at startup, so anything copied in while it runs stays invisible
  to it. Add --force if you are sure; they appear the next time it starts.`,
    'cmd.rm.usage': 'rm <sandbox>',
    'cmd.rm.summary': 'Delete a sandbox and everything in it',

    'cmd.config.usage': 'config',
    'cmd.config.summary': 'Show the current settings',
    'cmd.config.source.usage': 'config source <source>',
    'cmd.config.source.summary': 'Change where releases come from: auto | official | mirror',
    'cmd.config.lang.usage': 'config lang <zh|en>',
    'cmd.config.lang.summary': 'Change the language: {options}',
    'cmd.config.lang.notes': `The language is a setting of this data directory, not a preference of the page:
the command line and the config window change together, so the two can never be
in different languages. The switch in the window's corner runs this command.

Unset means "whatever this computer is set to". Once it has been set, that
setting wins and the environment is no longer consulted.
⛔ Error codes (PLUGIN_NAME_TAKEN and the like) and the markers written into your
  config files are not translated: they are data rather than speech, and moving
  them with the language would leave both scripts and this tool unable to
  recognise what they wrote.`,
    'cmd.config.ask-on-quit.usage': 'config ask-on-quit <on|off>',
    'cmd.config.ask-on-quit.summary': 'Whether closing the config window warns that it stops every sandbox',
    'cmd.config.ask-on-daily.usage': 'config ask-on-daily <on|off>',
    'cmd.config.ask-on-daily.summary': 'Whether to warn before touching your everyday cabinet',
    'cmd.config.reset.usage': 'config reset',
    'cmd.config.reset.summary': 'When the settings file cannot be read: archive it and start from empty',
    'cmd.config.reset.notes': `Only needed when another command reports CONFIG_UNREADABLE.
⛔ The old file is renamed and kept, not deleted: it records which plugin folders
you registered, and that is not recoverable anywhere else.
After the reset the registry is empty, but plugins already installed in cabinets
are unaffected: those live in each cabinet's own config.`,

    'cmd.ui.usage': 'ui [--port n]',
    'cmd.ui.summary': 'Open the config window',
    'cmd.quit.usage': 'quit [--main]',
    'cmd.quit.summary': 'Quit everything: stop every sandbox; with --main, the everyday cabinet too',
    'cmd.quit.notes': `There is no long-running dsh-box process to close: every command is its own
small process that exits when it is done.
So "quit" can only be something done rather than something closed: every sandbox
is stopped. They are only stopped, never deleted.
Ctrl+C on the ui process is not a quit; it ends that one command, and the
sandboxes keep running.`,
    'cmd.status.usage': 'status',
    'cmd.status.summary': 'The whole picture right now: data directory, releases, sandboxes, what is running',
    'cmd.logs.usage': 'logs <sandbox> [options]',
    'cmd.logs.summary': 'What a sandbox said the last time it started',
    'cmd.logs.notes': `  --shape             the shape only (how many lines / how big / how many look
                      like errors / the last line), without the body
  --errors            only the lines that look like errors, three lines either side
  --lines <n>         how many lines (default 50 lines or 4000 characters,
                      whichever comes first)
  --all               list every log file this sandbox has kept
  --main              the everyday cabinet's startup log; no sandbox name needed
  --version <release> what was said while that release was downloaded or deleted
                      (readable during a download, which is what progress is)

⭐ Ask --shape first and then decide whether to read: however big the log is,
that answer is a few hundred characters.
By default you get the last 50 lines or 4000 characters, and it says how much
was left out and where the whole file is.`,
    'cmd.attach.usage': 'attach',
    'cmd.attach.summary': 'Take over: the config window shows that you are working and stops accepting clicks',
    'cmd.detach.usage': 'detach [--forced]',
    'cmd.detach.summary': 'Hand back: the config window returns to normal, and the record stays for review',
    'cmd.detach.notes': `--forced means it was not handed back voluntarily: a person pressed stop in the
config window and took control back.
That fact goes into the record and memory can read it: "you were stopped here" is
the thing most worth knowing next time.`,
    'cmd.memory.usage': 'memory',
    'cmd.memory.summary': 'What was done during the last takeover, refusals included',

    'help.title': 'dsh-box — run DeepSeek Harness in an isolated sandbox',
    'help.perCommand': 'Detail on one: help <command> or <command> --help (for example, help start)',
    'help.machineReadable': 'Machine-readable: --help --json gives the table this command line is driven by',
    'help.common': `Common options: --json prints the result as JSON, for scripts and agents.
  Success is one line {"box":…,"ok":true,…}, failure is one line {"box":…,"ok":false,"code":…}.
  The code is a fixed identifier; the message is for people and may be reworded at any time.
Data goes in ./dsh-box/data by default (change it with --box <folder> or DSH_BOX_HOME).`,
    'help.flags': 'Flags',
    'help.valuePlaceholder': 'value',
    'help.mutates': 'Changes something, so it goes into the record',
    'help.readOnly': 'Read-only; changes nothing',
    'help.noSuchTopic': 'There is no command called "{topic}". Run with no arguments to see them all',
    'help.unknownCommand': 'Unknown command "{command}". Run with no arguments to see how it is used',

    'sandbox.created': 'Sandbox "{name}" created',
    'sandbox.reused': 'Sandbox "{name}" reused',
    'sandbox.ownConversations': 'Its conversations belong to it alone; no other sandbox can see them',
    'sandbox.signInImported': 'sign-in imported',
    'sandbox.plain': 'Nothing extra in this cabinet: plain official dsh',
    'sandbox.holds': 'This cabinet holds: {names}',

    'launch.starting': 'Starting {version} on port {port}',
    'launch.ready': 'Ready: the page carries the boot manifest and the process is still up',
    'launch.portTaken': 'Port {port} was taken just now, most likely by another launch starting at the same moment. Retrying on {next}',
    'launch.needsExposeInternals': 'This Node cannot reach the internal loader, so it starts with --expose-internals. Without it dsh will not come up and plugins will not resolve',
    'launch.clearedModuleLinks': 'Cleared module links that could point at the wrong release; boot rebuilds them',
    'launch.open': 'Open {url}',
    'launch.realKey': 'This uses your real API key, so conversations here are billed',
    'launch.logAt': 'Log {file}',
    'launch.detached': 'Running in the background (process {pid}). To stop it: stop {name}',
    'launch.noFreePort': 'No free port between {from} and {to}',
    'launch.linkDangling': '{name} links to somewhere that does not exist; the registered path is {path}. Register that plugin folder again, using a full path',
    'launch.noHostDshFile': 'The dsh you installed yourself has no file at {entry}. It may have just been uninstalled, or an upgrade is half done',
    'launch.versionNotDownloaded': 'Release {version} has not been downloaded',
    'launch.sandboxAlreadyRunning': 'Sandbox "{name}" is already open: {url} (process {pid}). Only one dsh at a time per sandbox; two of them write over each other in the same cabinet. Use another sandbox to run both, or stop this one first',
    'launch.bootExited': 'dsh exited before it finished starting, exit code {code}',
    'launch.bootExitedLate': 'dsh exited after serving the page, exit code {code}',
    'launch.bootTimeout': 'dsh did not finish starting within {seconds} seconds',
    'launch.badPid': 'Refusing to stop process {pid}',

    'cabinet.daily': 'your everyday cabinet',
    'sandbox.noFreeName': '{prefix}-{stamp}-1 through -999 are all taken. Give this one a name',
    'sandbox.noSuch': 'There is no sandbox named "{name}"',
    'sandbox.runningCannotDelete': '{name} is running (process {pid}). Stop it first: stop {name}',

    'adopt.sameCabinet': 'Copying from a cabinet to itself; there is nothing to do',
    'adopt.noSessions': '{label} has no conversations yet',
    'adopt.destinationRunning': 'A dsh is running on {label}. Stop it before copying. dsh scans the conversation directory only at startup, so anything copied in while it runs stays invisible to it. Add --force if you are sure; those conversations appear the next time it starts',

    'plugin.installed': 'Installed {name} into {where}',
    'plugin.installedWhere': 'Written to {file} — typing dsh yourself loads it too',
    'plugin.removeHint': 'To take it out: plugins uninstall {id} {cabinet}',
    'plugin.uninstalled': 'Removed {name} from {where}',
    'plugin.folderUntouched': 'Your folder was not changed',

    'restore.done': 'Plugin config for {where} restored to the copy from {at}',
    'restore.linksNotRolledBack': 'Only the config was restored; links were not rolled back. Plugins that are gone will not load, and the extra links are empty placeholders',

    'version.notDownloadedAlready': '{version} was not downloaded in the first place',
    'version.inUse': '{sandbox} is using {version} (process {pid}). Stop it first: stop {sandbox}',
    'version.deleting': 'Deleting {version}…',
    'version.deletingSized': 'Deleting {version}, about {mb} MB…',
    'version.stillDeleting': 'Still deleting, {seconds}s so far',
    'version.deleted': '{version} deleted',

    'host.versionNotDownloaded': 'Release {version} has not been downloaded. Try: pull {version}',
    'host.noHostDsh': 'No dsh of your own was found. Either install one (npm i -g @deepseek-ai/dsh), or name a release dsh-box has already downloaded with --version <release>',
    'engine.unknown': 'machine unknown',
    'engine.versionUnreadable': 'version unreadable',
    'engine.host': 'the {version} you installed yourself',
    'engine.release': 'the {version} dsh-box downloaded',

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
    'window.agentHolds': 'An agent is driving this data directory, so the window is not sending commands. To take over, press "Stop and take back control" in the window',
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

    'config.unreadable': 'Cannot read {file}: {error}\n  It was left alone. This file records the plugins you registered and what you picked last time, and overwriting it loses both.\n  Repair it yourself, or use config reset to archive it and start from empty.',
    'config.notAnObject': '{file} does not contain an object and cannot be read. It was left alone; config reset can archive it and start over',
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

    'status.labelDataDir': 'data dir',
    'status.labelAgent': 'agent',
    'status.labelHost': 'your dsh',
    'status.labelDownloaded': 'downloaded',
    'status.labelPlugins': 'registered',
    'status.labelMainPlugins': 'daily has',
    'status.labelSettings': 'settings',
    'status.labelMain': 'daily',
    'status.agentNone': 'no',
    'status.agentSince': 'yes, since {at}',
    'status.none': '(none)',
    'status.downloadedHint': '(not used unless --version names one)',
    'status.foldersGone': '({count} folders no longer exist)',
    'status.oursTag': '{name} (installed by dsh-box)',
    'status.mainForeign': 'one is running on 3080, but it was not started from here',
    'status.mainNone': 'none started from here, and 3080 is free',
    'status.mainRunning': 'started from here at {url} (process {pid}); to stop it: stop --main',
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
    'logs.which': "Which sandbox's log? Or --main for the everyday cabinet, --version <release> for a download",

    'attach.done': 'Attached. The config window now shows your actions and stops accepting clicks; its stop button can take control back at any time.',
    'attach.session': 'Session {session}',
    'detach.nobody': 'Nobody was attached in the first place',
    'detach.forced': 'Control taken back. The config window is back to normal, and what just happened can be reviewed there',
    'detach.done': 'Handed back. The config window is back to normal, and what just happened can be reviewed there',
    'session.endedForced': 'a person pressed stop and took it back',
    'session.endedDone': 'the agent handed it back itself',
    'memory.none': 'No takeover has been recorded yet',
    'memory.header': 'Session {session}  started {at}',
    'memory.stillOpen': 'not finished yet',
    'memory.endedAt': 'ended {at} ({how})',
    'memory.ok': 'ok',
    'memory.refused': 'refused: {code}',

    'box.usingInstead': 'Using {dir} instead — name one yourself with --box <folder>',

    'versions.downloaded': 'Downloaded',
    'versions.noneDownloaded': '(none yet — try: pull 0.1.0-rc.7)',
    'versions.pinned': 'every package verified',
    'versions.mixed': 'mixed versions — download it again',
    'versions.registryDown': '(cannot reach npm: {error})',
    'versions.available': 'Available on npm',
    'versions.tagLatest': 'official stable',
    'versions.tagNext': 'official preview',
    'pull.which': 'Which release? For example: pull 0.1.0-rc.7',
    'pull.ready': '{version} is ready',
    'drop.which': 'Which release to delete? See them with versions',
    'drop.redownload': 'A sandbox that was using it must download it again before its next launch',

    'cabinet.bothFlags': '--main and --sandbox are two answers to the same question: which cabinet. Give only one',
    'cabinet.which': 'Which cabinet? --sandbox <name> for a sandbox, --main for your everyday ~/.dsh',

    'plugins.addWhich': 'Which folder? For example: plugins add ../my-plugin',
    'plugins.remembered': 'Remembered {package}, with id "{id}"',
    'plugins.rememberedReplaced': 'Remembered {package}, with id "{id}" (replacing the old row with that id)',
    'plugins.cabinetHeader': 'Plugins currently in {cabinet}',
    'plugins.unreadableWarn': "This cabinet's plugin config cannot be read, so this list may be incomplete",
    'plugins.cabinetEmpty': '(none — plain official dsh)',
    'plugins.oursLine': '{package}  ← installed by dsh-box, and can come out',
    'plugins.theirsLine': '{name}  ← already in this cabinet; not ours to touch',
    'plugins.platform': 'Official base (in every profile): {names}',
    'plugins.patchAt': 'Config at {file}',
    'plugins.registryHeader': 'Registered plugins (the registry — none of this is installed anywhere yet)',
    'plugins.registryEmpty': '(none — try: plugins add <folder>)',
    'plugins.missingLine': '{package}  ← folder no longer exists',
    'plugins.installHint': 'Install into a cabinet: plugins install <id> --sandbox <name>|--main',
    'plugins.installWhich': 'Which plugin? Give a registered id, a plugin folder, or an npm package name',
    'plugins.rmWhich': 'Which id? See them with plugins',
    'plugins.rmUnknown': '"{id}" was never registered, and no cabinet has it',
    'plugins.rmApprovalDownloaded': '"{package}" is not only in sandboxes; {daily} has it too.\n  Removing it takes it out of {places}, and deletes the downloaded package as well.\n  What changes is that cabinet\'s own config, so typing dsh yourself changes with it.\n  Pass --approved if you are sure; to stop being asked: config ask-on-daily off',
    'plugins.rmApprovalYours': '"{package}" is not only in sandboxes; {daily} has it too.\n  Removing it takes it out of {places}, leaving your own folder alone.\n  What changes is that cabinet\'s own config, so typing dsh yourself changes with it.\n  Pass --approved if you are sure; to stop being asked: config ask-on-daily off',
    'plugins.rmHeader': '"{package}"',
    'plugins.rmNowhere': 'No cabinet had it installed',
    'plugins.rmDetached': 'Removed from {cabinet}',
    'plugins.rmUnregistered': 'Removed from the registry',
    'plugins.rmUnregisteredNever': 'Removed from the registry (it was never registered anyway)',
    'plugins.rmPackageDeleted': 'The downloaded package was deleted too — download it again to use it',
    'plugins.rmFolderUntouched': 'Not one byte of your folder was touched',
    'plugins.unreadablePatch': "Cannot read {cabinet}'s plugin config ({file}), so it will not be changed — look at what happened to that file, or restore from a backup",
    'plugins.nameTakenAt': 'The name "{package}" is already taken by something else in {cabinet}, pointing at {points}.\n  It was left alone — dsh-box did not install it, and replacing it cannot be taken back.\n  To really replace it with {wanted}, whoever installed the original has to take it out first.',
    'plugins.nameTakenGone': 'The name "{package}" is already taken by something else in {cabinet}, and what it points at no longer exists.\n  It was left alone — dsh-box did not install it, and replacing it cannot be taken back.\n  To really replace it with {wanted}, whoever installed the original has to take it out first.',
    'plugins.alreadyThere': '{cabinet} already has "{package}", pointing at exactly {points}',
    'plugins.nothingDone': 'Nothing was done',
    'plugins.raceTaken': 'Something else registered "{package}" into {cabinet} in the meantime',
    'plugins.raceCheck': 'The patch was not changed, but the link was made. Check where the name points now:',
    'backup.saved': 'The previous copy was backed up to {file}',
    'plugins.badPackageName': '"{name}" is neither an existing folder nor something that looks like an npm package name. A folder needs a package.json; a package name may only use lowercase letters, digits and . _ -, optionally with @scope/',
    'packages.treeDescription': 'Plugins dsh-box downloaded for you live here',
    'plugins.downloading': 'Downloading {name} from {registry}',
    'npm.saidOkButEmpty': 'npm said it installed, but there is nothing in {dir}',
    'plugins.downloaded': 'Downloaded, at {dir}',
    'npm.installExit': 'npm could not install it (exit code {code}) — {last}',
    'npm.saidNothing': 'it said nothing',
    'plugins.uninstallWhich': 'Which one? See what this cabinet has with plugins --sandbox <name>',
    'plugins.notOurs': '"{id}" was already in {cabinet} before dsh-box; what someone else wrote in is not ours to remove. Take it out the way it was put in',
    'plugins.notInstalled': 'There is no dsh-box-installed "{id}" in {cabinet} — see what is there with plugins {flags}',

    'backups.unknownAction': 'plugins backups knows only rm and prune, not "{action}"',
    'backups.header': 'Plugin config backups for {cabinet}',
    'backups.noneMain': '(none yet — one is made when the plugin config is changed)',
    'backups.noneSandbox': '(sandboxes keep no backups — a sandbox is a clean start, and a broken one can simply be deleted)',
    'backups.limit': 'At most {keep} are kept; the oldest goes automatically when there are more',
    'backups.restoreHint': 'Restore the latest: plugins restore {where}',
    'backups.rmHint': 'Delete one:         plugins backups rm <timestamp> {where}',
    'backups.pruneHint': 'Clear them all:     plugins backups prune --keep 0 {where}',
    'backups.rmWhich': 'Which one? See the timestamps with plugins backups',
    'backups.noSuch': 'There is no copy from {at}',
    'backups.removed': 'Backup {at} for {cabinet} deleted; {count} remain',
    'flag.keepInteger': '--keep takes an integer of at least 0; "{value}" was given',
    'backups.pruned': '{cabinet}: kept the latest {keep}, deleted {count}',
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
    'history.omitted': 'The {count} earlier entries are omitted — for all of them: history --lines 0',
    'history.unreadable': '{count} more lines could not be read and are not in the numbers above',
    'history.fullAt': 'Full record at {files}',
    'history.noFile': '(no file yet)',

    'workspaces.useWhich': 'Which folder? For example: workspaces use E:\\code\\my-repo --sandbox alpha',
    'workspaces.next': '{cabinet} opens into this workspace next time: {path}',
    'workspaces.addedNew': 'this is a new registration',
    'workspaces.movedFront': 'it was already registered, and moved to the front',
    'workspaces.alreadyFront': 'it was already at the front; nothing changed',
    'workspaces.writtenTo': 'Written to {file}',
    'workspaces.unknownAction': 'workspaces knows only use, not "{action}"',
    'workspaces.header': 'Workspaces {cabinet} has seen    the first is what it opens into',
    'workspaces.neverStarted': '(this cabinet has never started, or no project was ever picked)',
    'workspaces.emptyList': '(none — dsh does not register the current directory by itself)',
    'sessions.count': '{count} conversations',
    'workspaces.switchHint': 'Switch: workspaces use <folder> {where}',
    'workspaces.atFile': 'At {file}',

    'packages.rmWhich': 'Which package? See them with packages',
    'packages.noSuch': '"{name}" was never downloaded',
    'packages.inUse': '"{name}" is still installed in {usedBy}, so it was not deleted.\n  Uninstall it from those cabinets first (plugins uninstall), then come back and delete the package.\n  Deleting it anyway would leave those cabinets pointing at a package name that does not resolve, and dsh answers that by refusing to load the whole plugin tree',
    'packages.removed': 'The download of "{name}" is deleted — download it again to use it',
    'packages.pruned': 'Deleted {count} downloads that no cabinet was using',
    'packages.unknownAction': 'packages knows only rm and prune, not "{action}"',
    'packages.header': 'Plugin packages dsh-box downloaded for you    one shared copy, linked into whichever cabinet wants it',
    'packages.empty': '(none yet — plugins install <package> downloads here)',
    'packages.nobodyUses': 'no cabinet uses it',
    'packages.usedBy': 'used by: {list}',
    'packages.filesCount': '{count} files',
    'packages.at': 'At {dir}',
    'packages.hints': 'Delete one: packages rm <package>      clear unused ones: packages prune',

    'sandboxes.header': "Sandboxes           each is an independent dsh; none can see another's conversations",
    'sandboxes.none': '(none yet)',
    'sandboxes.signedIn': 'signed in',
    'sandboxes.notSignedIn': 'not signed in',
    'sandboxes.runningAt': 'running at {url}',

    'adopt.bothForms': 'adopt <sandbox> and --from/--to are two spellings of the same thing; use only one',
    'adopt.which': "Copy from where to where? adopt <sandbox> copies that sandbox's conversations into your everyday ~/.dsh; for any other direction write it out: --from <sandbox|main> --to <sandbox|main>",
    'adopt.copied': 'Copied {adopted} conversations from {from} into {to}, skipping {skipped} duplicates',
    'adopt.originalsStay': 'The originals are all still in {from}; this is a copy, not a move',
    'adopt.visibleNextStart': '{to} sees them the next time it starts',

    'start.bothFlags': '--main and --sandbox/--new are two answers to the same question: which cabinet to open. Give only one',
    'start.whichCabinet': 'Which cabinet? --sandbox <name> for a sandbox, --new for a fresh one, --main for your everyday ~/.dsh. Nothing is carried over from last time — the same command should always give the same result',
    'start.unknownPlugins': 'These plugin ids were never registered: {list} — see them with plugins',
    'start.pluginGone': 'Note: "{id}" was selected but its folder no longer exists, so it is not installed this time',
    'start.mainNeedsApproval': "Opening your real ~/.dsh with a release dsh-box downloaded is the one combination that cannot be repaired if it goes wrong, so it only runs after a person has agreed in person. Do it from the config window: dsh-box ui, pick the everyday cabinet and this release there, and the dialog says what will happen. If you are an agent, do not pass --approved yourself — that would be nodding on a person's behalf.",
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

    'stop.mainNotRunning': 'The everyday cabinet has no instance running that was started from here',
    'stop.mainNote': 'If one answers on 3080, you started it yourself and it is not ours to manage',
    'stop.mainStopped': 'Stopped the everyday cabinet (process {pid}) — its home is your everyday one, and the data is all still there',
    'stop.which': 'Which sandbox? See them with sandboxes, or use --main for the everyday cabinet',
    'stop.notRunning': 'Sandbox "{name}" is not running',
    'stop.stopped': 'Stopped "{name}" (process {pid})',
    'rm.which': 'Which sandbox? See them with sandboxes',
    'rm.removed': 'Deleted "{name}" — that dsh no longer exists',

    'settings.header': 'Settings',
    'settings.choicesLine': 'choices: {choices}',
    'settings.unknown': 'There is no setting called "{key}" — run config with no arguments to see them all',
    'settings.whichValue': 'Set {key} to what? Choices: {choices}',
    'settings.badValue': '{key} cannot be set to "{value}" — choices: {choices}',
    'config.nothingToReset': '{file} does not exist; there is nothing to reset',
    'config.archived': 'The old settings were archived to {file} — not deleted; it records which plugins you registered',
    'config.freshStart': 'The next command starts from empty',

    'quit.nothingRunning': 'No sandbox is running; there is nothing to stop',
    'quit.stopped': 'Stopped {count} sandboxes: {names}',
    'quit.mainStopped': 'The everyday cabinet was stopped too (process {pid}) — its home is your everyday one, and the data is all still there',
    'quit.mainLeft': 'The everyday cabinet was started from here and is still running (to stop it too: add --main)',
    'quit.mainForeign': 'A dsh answers on 3080, but it was not started from here; it cannot and should not be touched',

    'flag.noValue': '--{flag} is a switch and takes no value',
    'flag.unknown': 'Unknown option "--{flag}" — run with no arguments to see usage',
    'flag.needsValue': '--{flag} must be followed by a value',
    'error.lastLines': 'Its last {count} lines:',

    'ui.title': 'dsh sandbox launcher',
    'ui.intro': 'Try releases and plugins in isolated sandboxes without touching your everyday cabinet. An agent can pick the dsh machine and the sandbox cabinet through the CLI as well.',
    'ui.booting': 'Loading…',
    'ui.bootingSlow': 'the release list asks npm once; that is the slow step',
    'ui.machineCard': 'dsh machine',
    'ui.pull': 'Download',
    'ui.customVersionPh': 'or type a release, e.g. 0.0.1-rc.1',
    'ui.sourceLabel': 'Source',
    'ui.sourceAuto': 'auto',
    'ui.sourceOfficial': 'official npm',
    'ui.sourceMirror': 'China mirror',
    'ui.olderVersions': 'Earlier preview builds',
    'ui.cabinetCard': 'Cabinet',
    'ui.newSandboxPh': 'name for a new sandbox cabinet',
    'ui.newSandbox': 'New',
    'ui.importSignIn': 'Import sign-in credentials',
    'ui.importSignInNote': 'only meaningful for a newly created sandbox cabinet',
    'ui.pluginsCard': 'Plugins in this cabinet',
    'ui.pluginDirPh': 'plugin folder path (it needs a package.json)',
    'ui.browse': 'Browse…',
    'ui.addPlugin': 'Add',
    'ui.runningCard': 'Running',
    'ui.quit': 'Quit dsh-box',
    'ui.lockedHint': 'An agent is in control, so this action was not run — to take over, press "Stop and take back control" above',
    'ui.stopAgent': 'Stop and take back control',
    'ui.cancel': 'Cancel',
    'ui.ok': 'OK',
    'ui.notice': 'Notice',
    'ui.dontAskAgain': 'Do not ask again',
    'ui.dropDontAskNote': 'future changes to the everyday cabinet run without asking',
    'ui.dropConfirm': 'Uninstall and remove',
    'ui.quitMainToo': 'Stop the everyday cabinet too',
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
    'ui.unreadableWarn': "This cabinet's plugin config cannot be read, so this list may be incomplete. It will not be touched until someone has looked — the command line can restore it whole: plugins restore",
    'ui.willRemoveNote': 'comes out of this cabinet when start is pressed',
    'ui.installedHereNote': 'already installed in this cabinet',
    'ui.tagGoing': 'removing',
    'ui.tagHave': 'installed',
    'ui.tagAdd': 'adding',
    'ui.tagNot': 'not installed',
    'ui.tagTheirs': 'already there',
    'ui.theirsNote': 'already in this cabinet before dsh-box; cannot be changed here',
    'ui.uninstallDelete': 'Uninstall and delete',
    'ui.forget': 'Forget',
    'ui.uninstallDeleteTitle': 'Comes out of every cabinet, and the downloaded package is deleted',
    'ui.forgetTitle': 'Comes out of every cabinet and is forgotten; your own folder is not touched',
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
    'ui.endedForced': 'you pressed stop and took it back',
    'ui.recallLiveOpen': 'Fold the {count} steps the agent is taking',
    'ui.recallLiveClosed': 'Unfold the {count} steps the agent is taking',
    'ui.recallPastOpen': 'Fold the last agent run ({count} steps)',
    'ui.recallPastClosed': 'Review the last agent run ({count} steps)',
    'ui.refusedLine': 'refused {code}: {message}',
    'ui.tookOver': 'Took over at {at}',
    'ui.notHandedBack': ', not yet handed back',
    'ui.endedAtLine': ', ended at {at} ({how})',
    'ui.noActionYet': 'no action yet',
    'ui.doingNow': 'running <b>{name}</b>',
    'ui.badgeRefused': '<b>{name}</b> <span class="bad">refused {code}</span>',
    'ui.badgeDone': '<b>{name}</b> done',
    'ui.tookOverAt': 'took over at {at}',
    'ui.agentDriving': 'agent is driving',
    'ui.stepsSoFar': '{count} steps so far',
    'ui.secondsAgo': '{count}s ago',
    'ui.minutesAgo': '{count} min ago',
    'ui.hoursAgo': '{count} h ago',
    'ui.staleRetry': 'This page is left over from a previous window and is reloading — press again after the reload',
    'ui.detachFailed': 'Could not hand back: {error}',
    'ui.pullNeedsVersion': 'Type a release first, or pick one above to download — the machine you installed yourself did not come from npm and cannot be downloaded.',
    'ui.pullingHead': 'Downloading {version}…',
    'ui.pullDone': '{version} is ready: {packages} packages verified.',
    'ui.approveHead': 'dsh — <b>downloaded release {version}</b>, not this machine<br>cabinet — <b>your own ~/.dsh</b>',
    'ui.approvePoint1': '1. <b>On-disk formats differ across releases</b> — your local dsh cannot open the cabinet afterwards.',
    'ui.approvePoint2': '2. <b>The cabinet holds a layer of links</b> recording which machine it last used. This launch points them at dsh-box; an abnormal exit leaves the old links dead.',
    'ui.approvePoint3': '3. If a local dsh is started some other way, <b>two dsh point at the same cabinet</b> and can corrupt it.',
    'ui.approveOk': 'Do it',
    'ui.startingHead': 'Starting…',
    'ui.sandboxQuoted': 'Sandbox "{name}"',
    'ui.startedMsg': '{where} started, using {engine} {version}.',
    'ui.openUrl': 'Open {url}',
    'ui.nameRule': 'Allowed names: {rule}',
    'ui.quitRowSandboxNone': 'sandboxes — none running',
    'ui.quitRowSandbox': 'sandboxes — {count} running: {names}',
    'ui.quitRowMainHere': 'cabinet — your own, started from here (process {pid}); left running by default',
    'ui.quitRowMainForeign': 'cabinet — one answers on 3080, not started from here; process unknown, left alone',
    'ui.quitRowMainNone': 'cabinet — none started from here',
    'ui.quitPoint1': '1. <b>Sandboxes are only stopped</b>; conversations and config remain, and starting the same name continues them.',
    'ui.quitMainNote': 'unticked leaves it running',
    'ui.quitAlsoMain': ', and the everyday cabinet too (process {pid})',
    'ui.quitDoneTitle': 'Quit',
    'ui.quitDoneBody': 'Stopped {count} sandboxes{alsoMain}. This page can be closed now.',
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
