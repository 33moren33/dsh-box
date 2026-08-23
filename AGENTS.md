# 给 Agent 的使用说明

本工具是 dsh 沙箱管理器,全部功能都有命令行,不需要打开图形窗。

```
node bin/cli.js versions --json                  # 已下载哪些版本 / npm 上有哪些
node bin/cli.js pull 0.1.0-rc.8 --json           # 下载并逐包钉版核对(原地等到完)
node bin/cli.js drop 0.1.0-rc.6 --json           # 删掉一个已下载的版本
node bin/cli.js plugins --json                   # 登记表:dsh-box 认识哪些本地插件
node bin/cli.js plugins add <目录> --json        # 记住一个插件目录(还没装进任何工作区)
node bin/cli.js plugins --sandbox <名> --json    # 那个工作区实际装着什么(--main 看日常的)
node bin/cli.js plugins install <id|目录|包名> --sandbox <名> --json   # 正式装进去,一直在
node bin/cli.js plugins uninstall <id> --sandbox <名> --json          # 从那个工作区拿掉
node bin/cli.js plugins backups --main --json    # 改配置前留的备份
node bin/cli.js plugins restore --main --json    # 整份还原到某次改动之前
node bin/cli.js sandboxes --json                 # 沙箱清单,含谁在跑、端口、pid
node bin/cli.js start --sandbox <名> --json      # 启动后立即返回;用用户自己装的那台 dsh
node bin/cli.js start --sandbox <名> --version 0.1.0-rc.8 --json   # 改用下载的版本
node bin/cli.js stop <沙箱名> --json             # 停掉一台
node bin/cli.js start --main                     # 非沙箱:开用户真实的 ~/.dsh
node bin/cli.js adopt <沙箱名> --json            # 把沙箱对话复制进用户日常的 dsh
node bin/cli.js adopt --from main --to <沙箱名> --json   # 反方向,或沙箱之间
node bin/cli.js rm <沙箱名> --json               # 删除沙箱及其全部对话

node bin/cli.js config --json                    # 看设置
node bin/cli.js config source mirror --json      # 换安装源:auto | official | mirror
node bin/cli.js quit --json                      # 总退出:停下所有沙箱(不动用户日常那台)

node bin/cli.js status --json                    # 此刻全景:谁在跑、装了什么、有没有人接管
node bin/cli.js logs <沙箱名> --shape --json     # 先看日志形状,再决定要不要读正文
node bin/cli.js logs <沙箱名> --errors --json    # 只要像出错的行(靠关键词猜的,会说明)
node bin/cli.js logs --version 0.1.0-rc.8 --json # 下载/删除那个版本时说了什么(下载中也能看)
node bin/cli.js attach --json                    # 接管:配置窗显示你在操作并停止接受点击
node bin/cli.js detach --json                    # 交还(--forced 是窗口上那个停止按钮用的)
node bin/cli.js memory --json                    # 上次接管期间做了什么(含被拒绝的)
node bin/cli.js ui --port 10130                  # 给人开配置窗(会一直占着这个进程)
```

**共 17 条命令**(`plugins` 下面多了几个子命令,顶层没变)。上面每一条都认 `--json`,`ui` 除外(它是给人开窗口的,不返回结果)。

**配置窗没有第二套实现。**它显示的每件事都来自这里的命令:人点一个按钮,窗口就起一个进程敲对应的那条命令,和你敲的是同一条,记进同一份 `logs/actions.log`,失败给同一个 `code`。**所以窗口不可能做到命令行做不到的事**,你也不需要为了"让人看得见"去走窗口那条路。

## `attach` 之后,人是看得见你的

敲了 `attach`,配置窗整个罩上蓝框、**停止接受点击**,并按顺序标出你碰过哪些控件;
角标实时显示你此刻在跑哪条命令(**只读命令也算**,不然你下载版本的两分钟里窗口无话可说)。
干完敲 `detach` 交还,框一次性清掉,人可以点开回看你做过的那一串。

- ⭐ **人手上永远有一个停止按钮**,随时可以把控制权收回去。**收回不需要理由,也不会等你**。
- **下次醒来先敲 `memory`。**它会告诉你上次结束于 `done`(你自己交还)还是 **`forced`(人按停止收回)**,
  并列出每一步——**包括被拒的那几步**。「你在这里被拦下过」是你最该先知道的事,否则会再撞一次同一堵墙。
- ⛔ **能用这些命令干的事就不要绕过去自己伸手干**(直接改文件、自己起 dsh 进程)。
  窗口显示的是"经过这个工具的一切",绕过去的部分它看不见,人会以为屏幕上就是全部。

## 每轮先敲 `status`

它只报此刻、**全部本地读盘不碰网络**,所以永远是快的。一句话拿到:数据目录、
有没有人接管、**用户自己装的那台 dsh(`host`)**、已下载版本、记着的插件、
3080 上日常工作区在不在、每台沙箱跑没跑在哪。
**你每轮醒来都不记得上次做过什么,这条命令就是拿来重新定位的。**

## 看日志的三条规矩

- **先 `--shape` 再决定读不读。**它返回「多少行/多大/几行像出错/最后一行/文件在哪」,
  **无论日志多大这个回答都是固定几百字符**。绝大多数时候看完形状就够了。
- **默认只给最后 50 行或 4000 字符**(谁先到算谁),**并且会明说省略了多少、全文在哪**。
  要更多用 `--lines N`;`--all` 列出留着的所有日志。
- **`--errors` 是猜的**,输出里会标明——dsh 没有统一的错误标记,拿不准就看全文。

## `--json` 的约定

- **成功**是一行 `{"box":…, "ok":true, …}`,**失败**是一行 `{"box":…, "ok":false, "code":…, "message":…}`,退出码 1。
- **`code` 是不会变的标识,`message` 是给人看的、随时可能改写。**判断出了什么事请用 `code`,不要匹配中文。
- **`box` 永远是第一个字段**,它是本次操作用的数据目录。**图形窗和命令行指向不同数据目录时,两边的回答都正确、都自洽、说的却是两个世界**——每次核对这个字段是唯一的防线。
- `--json` 写在子命令前后都可以。不认识的选项会被拒绝而不是忽略。

全部 `code`（41 个）:`BAD_FLAG` `BAD_PACKAGE_NAME` `BAD_PID` `BAD_PLUGIN_ID` `BAD_SANDBOX_NAME` `BAD_SETTING_VALUE` `BOOT_EXITED` `BOOT_EXITED_LATE` `BOOT_TIMEOUT` `DIR_NOT_FOUND` `MAIN_DSH_RUNNING` `MISSING_ARGUMENT` `MISSING_VALUE` `NEEDS_APPROVAL` `NOT_A_DSH_PLUGIN` `NOT_OURS` `NOT_RUNNING` `NO_BACKUP` `NO_FREE_PORT` `NO_HOST_DSH` `NO_LOGS` `NO_PACKAGE_JSON` `NO_PACKAGE_NAME` `NO_SESSIONS` `NO_SUCH_SANDBOX` `NPM_FAILED` `PLUGIN_DEPS_MISSING` `PLUGIN_HAS_NO_ENTRY` `PLUGIN_LINK_BROKEN` `PLUGIN_NOT_BUILT` `SAME_WORKSPACE` `SANDBOX_ALREADY_RUNNING` `SANDBOX_RUNNING` `UNKNOWN_COMMAND` `UNKNOWN_FLAG` `UNKNOWN_PLUGIN` `UNKNOWN_SETTING` `UNREADABLE_MANIFEST` `UNREADABLE_PATCH` `VERSION_IN_USE` `VERSION_NOT_DOWNLOADED`。
（这一批新的都来自「插件属于工作区」那次改动:`NOT_OURS`／`UNREADABLE_PATCH`／`NO_BACKUP`／`BAD_PACKAGE_NAME`／`NPM_FAILED`／`SAME_WORKSPACE`,以及闸门那条 `NEEDS_APPROVAL`。
⚠️ 数它们别只 grep 一行:`NOT_OURS` 是写在三元表达式里的,按 `new BoxError('X'` 去数会漏掉它。）

## ⭐⭐ 插件是工作区的属性,不是这次启动的

**这是最近一次改动里最大的一条,旧的理解会让你判断错。**

- `plugins add <目录>` ＝ **登记表**:dsh-box 认识了这个插件,**任何工作区都还没有它**。
- `plugins install … --sandbox <名>|--main` ＝ **真的装进某一个工作区**,写在那个工作区自己的
  profile 配置里。从此**用户自己敲 `dsh` 也会加载它**,不是只有从 dsh-box 启动才有。
- `start --plugin <id>` ＝ 启动前顺手做一次 install;`start --unplug <id>` ＝ 顺手拿掉。
- ⛔ **不写 `--plugin` 不是「一个都不装」,是「什么都不改」**——这个工作区之前装过的照样在。
  要一台纯官方的 dsh,**新建一个沙箱**(`--new`),新沙箱天生一个插件都没有。
- **要知道某个工作区现在有什么,问 `plugins --sandbox <名>` 或 `status` 的 `mainPlugins`**,
  返回分两栏:`ours`(dsh-box 装的,卸得掉)与 `theirs`(那个工作区本来就有的,**我们不动**)。
- 卸载**只删我们写进去的那几条**。想拿掉 `theirs` 里的东西会得到 `NOT_OURS`,这是对的,
  不要绕过去——那是用户或别的工具写的,不归这里管。
- **改任何工作区的配置之前会先整份备份**(`plugins backups` 看得到)。逐条卸载够不着时
  (文件被改成认不出的形状),用 `plugins restore` 整份还原。

npm 上的包**先下载到 dsh-box 自己的目录**,再按本地插件那条路链进工作区——不是装进那个
profile。⛔ 这不是偏好,是实测:真 `~/.dsh` 的 profile 里有 pnpm 专有的 `link:` 依赖,
**npm 在那儿根本跑不起来**(`EUNSUPPORTEDPROTOCOL`)。所以 `dsh.profile.bundles` 这个文件
**我们只读不写**,里面的东西一律算那个工作区自己的。

## ⛔ `plugins add` 只认「一个文件夹＝一个插件」

它把那个文件夹 junction 链进 profile 的 `node_modules`,**不装任何依赖**。所以下面三种目录会被**当场拒绝**,而不是装上去之后由 dsh 一声不吭地忽略——**dsh 对形状不对的插件从不报错,只是不加载**,这三个 `code` 就是拿来把那份沉默换成一句话的:

- `NOT_A_DSH_PLUGIN` —— `package.json` 里没有 `dsh` 字段。**最常见的来源是指到了多包仓库的根目录**(clone 下来就是它,而且确实有 package.json)。错误里会列出 `packages/` 下的候选。
- `PLUGIN_DEPS_MISSING` —— 它依赖同仓兄弟包(`workspace:*`)而自己的 `node_modules` 没装。**多包仓库里的聚合包几乎一定是这种**。
- `PLUGIN_NOT_BUILT` —— `main` 指的入口文件不存在,这个仓还没构建过(`lib/` 通常被 git 忽略)。
- `PLUGIN_LINK_BROKEN` —— 链接建出来了却指向不存在的地方。**登记的路径一律会被转成完整路径**(相对路径在 Windows 上是相对链接自己那个文件夹解析的,而不是相对你敲命令的位置),老配置里若还留着相对路径,启动时会当场报这个,而不是让 dsh 少装一个插件还不吭声。
- `PLUGIN_HAS_NO_ENTRY` —— **没有可导入的入口**(既无 `main`/`exports`,也无 `index.js`)。这类是「只带 patch 的包」:自己不含代码,靠自己的 `cordis.patch.yml` 把有代码的包引进来。**挂它没用,该挂的是它引的那些。**⚠️ 实测判例:`@linxin666/dsh-skins` 声明了 `dsh.bundle` 却没有代码,挂上去**把整台 dsh 的启动带崩**(`ERR_MODULE_NOT_FOUND`)。

**要装 npm 上发布的插件用 `plugins install <包名> --sandbox <名>|--main`**,它会把包下载到
dsh-box 自己的目录(`<数据目录>/packages`),然后走上面这三道同样的检查再链进去。
⚠️ 所以**纯资产型的包会被 `PLUGIN_HAS_NO_ENTRY` 拒绝**——那种包该由引用它的那个包带进来。

## ⭐ `start` ＝ 选两样东西,而且什么都不沿用上次

**一次启动是两个独立的选择**,dsh 只有一台机器的概念,`DSH_HOME` 才是档案柜的位置:

| 轴 | 怎么说 | 不说的话 |
|---|---|---|
| **机器**(用哪套 dsh 安装) | `--version <版本号>` ＝ 用 dsh-box 下载的那份 | **用用户自己装的那台**(全局 npm 那个) |
| **档案柜**(开哪个 `DSH_HOME`) | `--sandbox <名>` / `--new` / `--main` | **拒绝**,报 `MISSING_ARGUMENT` |

- ⛔ **不写 `--version` 不是「沿用上次那个版本」,是「用这台电脑上已经装着的 dsh」。**探不到就报 `NO_HOST_DSH` 并说明两条出路,**不会偷偷回落到某个下载的版本**。
- ⛔ **`--sandbox` 也不沿用上次。**裸敲 `start` 一定被拒。理由:同一条命令应当永远得到同一个结果——这条比少敲几个字重要,你写进日志或回给用户的那行命令,别人重跑必须得到同一台。
- ⛔ **`--main` 只说档案柜,不说机器。**`--main` 配 `--version` 是唯一「出事修不回来」的组合(见下)。`--main` 和 `--sandbox`/`--new` 同时给会被拒:它们是同一个问题的两个答案。
- 输出里的 `engine` 字段说清楚了这次用的是哪台:`{"kind":"host"|"release","version":…,"dir":…}`。**光看 `version` 分不出来**——用户自己装的和我们下载的可以是同一个版本号、两套不同的安装。
- **启动完就交还命令行,沙箱留在后台跑。**输出里有 `url`／`pid`／`port`／`logFile`。要停用 `stop <沙箱名>`,**不要按进程名模糊匹配去杀**,会误杀用户自己正在用的 dsh。人想留在终端看日志加 `--follow`(Ctrl+C 则停掉沙箱)。
- **一个沙箱同时只能跑一台**(两台会互踩同一份档案柜)。要并行就用不同的沙箱名,端口从 3090 起自动找。
- ⛔ **但插件不在「不沿用」之列**,因为它根本不属于这次启动:见上面那节。不写 `--plugin` ＝ 不改动这个工作区的插件。

### 用用户自己那台 ＋ 沙箱 home ＝ 白送的安全组合

`status` 的 `host` 字段报的就是那台(在哪、什么版本、包版本核对结果)。用它开沙箱**两头都不影响**:隔离靠的是 `DSH_HOME` 不是靠哪套安装,状态全写进沙箱那个 home,链接只往沙箱里建、对全局安装只读,端口也不撞。**试插件的默认做法就该是这个**——用他日常那台 dsh,在一次性 home 里试,试完删文件夹。
⚠️ 代价:我们下载的每个版本都逐包核对过,全局安装没人核对。所以 `status` 顺手核对一次并照实报告,包括**「这套安装的形状没见过,核对不了」**这第三种答案——它不等于「版本混杂」,别混说。
- **启动失败时,输出里的 `tail` 是 dsh 自己最后说的话**,`logFile` 是全文位置。只看退出码判断不了原因。
- **判断"起好了"的标准是首页带着启动清单且进程稳定**,端口通不算数——web 服务一激活就监听,插件树还在装。这条工具已经替你做了。

## `quit` 是一个动作,不是"关掉某个进程"

**没有一个常驻的 dsh-box 进程可关。**每条命令都是自己的小进程,跑完就退;沙箱是被交出去的独立 dsh 进程。所以"退出"只能是一件**做**出来的事,`quit` 就是做这件事:**让所有沙箱停下**。

- **默认只停沙箱。**要连日常工作区一起停,**显式加 `--main`**(界面上那个勾选框调的就是它)。
- ⛔ **只有「从这里启动的」日常工作区停得掉**,因为只有它有记下来的进程号。用户自己在别处开的那台,我们只知道 3080 在应答、**认不出是哪个进程**,不该也不会去动——`status` 用两个字段把这两件事分开:`main`(我们起的那台,含 pid)与 `mainDshOnDefaultPort`(端口有没有应答)。**按端口猜进程去杀,是杀错东西的标准做法。**
- **沙箱只是停下,不会被删**,里面的对话原样还在,下次 `start` 同名即可继续。
- `ui` 那个进程被 Ctrl+C 掉**不算** `quit`——那只是结束了 `ui` 这一条命令,沙箱照跑。
- 替用户执行前先 `status` 看看会停掉哪几台,并说出来。

## 必须知道的事

- **「沙箱」只是一个独立的 `DSH_HOME`,不是安全隔离。** 它开出来的 dsh 进程权限和用户平时那台一模一样——能读写这台电脑的文件,花真实的钱。隔开的是版本、插件、配置和对话,不是这台电脑。**不要基于"这是沙箱"的假设在里面运行不受信的插件或代码。**
- **沙箱默认导入用户的真 API Key**(`--no-sign-in` 可关)。在沙箱里发出的每条对话都真实计费。替用户启动前应征得同意。
- ⛔ **`--main` 用的是用户天天在用的那个 `~/.dsh`**,不是沙箱。替用户执行前必须问过。
  **真正修不回来的是 `--main` ＋ `--version` 那一格**:①dsh 的磁盘格式跨版本**没有迁移路径**,用新版本打开过之后旧版本可能就打不开这个 home;②那台 dsh 在跑期间,`~/.dsh/profiles/node_modules` 那层指针指向 dsh-box 的版本目录(**正常退出会清掉,强杀则留着**,于是用户日常的 dsh 就依赖上了 dsh-box 这个文件夹——真机上发生过,251 条)。
  **不给 `--version` 的 `--main` 没有这两条**:用他自己那台开他自己的 home,就是他平时的状态。
  ⛔ **所以只有那一格会被当场拒绝**,代号 `NEEDS_APPROVAL`——它要人在配置窗里亲手点过确认。
  **`--approved` 是配置窗在人点过之后才带上的,你不要自己带**:那不是一个「解开限制」的旗标,
  是「有人点过头了」这句话,你带上它就是替人点了头。而且它会留在操作记录里,人回头看得见。
  正确做法是把这个拒绝原样告诉用户,让他自己开窗口做,或者改用不带 `--version` 的 `--main`。
- `adopt` **只复制不搬走**,重复的对话按 session id 跳过,可安全重跑。方向随便:`adopt <沙箱名>` 是
  「那个沙箱 → 日常工作区」的简写,写全就是 `--from <名|main> --to <名|main>`,沙箱之间也行。
  **目标那台 dsh 正跑着会被拒绝**(dsh 只在启动时扫描对话目录),确认无碍可加 `--force`。
  ⚠️ 目标是日常工作区时,这个检测只认 3080——跑在自定义端口的 dsh 探不到。
- **记忆库跟工作区走,不跟沙箱走**(dsh 自身设计):沙箱和用户日常 dsh 打开同一个项目文件夹时,`<项目>/dsh_memory` 是同一份。在沙箱里试会写记忆的插件,选个一次性文件夹当工作区。
- 判断"版本装好了"的唯一标准是钉版核对通过(工具自动做),不要用目录存在与否或端口通不通来判断。
- 数据都在 `./dsh-box/data`(或 `--box <目录>` / 环境变量 `DSH_BOX_HOME`)。一个沙箱 = 一个独立 `DSH_HOME`,删目录即卸载。桌面壳(exe)的数据在 exe 旁的 `dsh-box/data`——Agent 想和窗口共享同一份数据,就把 `DSH_BOX_HOME` 指到那里。
- **沙箱名的规则**:字母(中文、日文等都可以)、数字、`_`、`.`、`-`;不能有空格或标点,不能以 `-` 或 `.` 开头,不能是 Windows 保留设备名(`con`/`nul`/`com1` 等),最长 64 字符。不合规**不会被悄悄改写**,而是报 `BAD_SANDBOX_NAME`,`message` 说明哪一条没过、`rule` 字段是规则全文。
