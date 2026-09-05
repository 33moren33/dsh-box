# 给 Agent 的使用说明

本工具是 dsh 沙箱管理器,全部功能都有命令行,不需要打开图形窗。

## 先决定用哪条路进来

下面所有例子写的是 `node bin/cli.js`,那是**源码仓**里的写法。手上是装好的那份就整段换掉:

```
<目录>\dsh-box.exe <命令>     安装版 / 便携包。同一个 exe:双击是窗口,带参数是命令行
npx dsh-box <命令>            npm 上那份,不装
dsh-box <命令>                npm i -g dsh-box 之后,或 exe 那份跑过 set path on
```

⭐ **exe 那条路自己认数据目录**——它旁边的 `dsh-box-files\data`,不看工作目录。⛔ 别去手跑安装包里的 `dsh-box-files\boot\bin\cli.js`:那样它按**当前工作目录**找数据,于是报「一个沙箱都没有」,而窗口里明明有三个。

⚠️ **其余几条路每次都要显式给 `--box <目录>`**。你每次调用的工作目录可能不同,不给就在当地建出一个空账本。**任何命令输出的第一个字段就是它实际用的目录**,拿它自查。

⛔ 0.3.4 及更早的 exe 只有窗口一张脸,带参数会挂住不返回,文件名也还是 `dsh-box-shell.exe`。撞上那种版本走 `npx`。

```
node bin/cli.js ls machine --json                # 能用哪些 dsh:本机装的、已下载的、你指过的文件夹
node bin/cli.js get machine 0.1.0-rc.8 --json    # 下载并逐包钉版核对(原地等到完)
node bin/cli.js rm machine 0.1.0-rc.6 --json     # 删掉一个已下载的版本
node bin/cli.js ls plugin --in <档案柜> --json   # 那个档案柜实际装着什么(--in main 看日常的)
node bin/cli.js get plugin <id|目录|包名> --to <档案柜> --json   # 正式装进去,一直在
node bin/cli.js get plugin --from main --to <名> --json          # 不给 id 就整柜复刻
node bin/cli.js rm plugin <id> --from <档案柜> --json            # 从那个档案柜拿掉
node bin/cli.js set plugin <id> off --in <档案柜> --json         # 关掉那一行(on 是打开)
node bin/cli.js set plugin --undo --in main --json               # 退回上一次改动之前,可连按
node bin/cli.js ls sandbox --json                # 沙箱清单,含谁在跑、端口、pid
node bin/cli.js start <名> --json                # ⚠会挡住:等到 dsh 真在服务才返回(重开约 5 秒、新建约 25 秒,上限 120 秒)
node bin/cli.js start <名> --version 0.1.0-rc.8 --json   # 改用下载的版本
node bin/cli.js stop <沙箱名> --json             # 停掉一台
node bin/cli.js start main                       # 非沙箱:开用户真实的 ~/.dsh
node bin/cli.js get chat --from <沙箱名> --to main --json  # 把沙箱对话复制进用户日常的 dsh
node bin/cli.js get chat --from main --to <沙箱名> --json  # 反方向,或沙箱之间
node bin/cli.js rm sandbox <沙箱名> --json       # 删除沙箱及其全部对话

node bin/cli.js ls setting --json                # 看设置,含这一份在不在 PATH 上
node bin/cli.js set source mirror --json         # 换安装源:auto | official | mirror
node bin/cli.js set path on --json               # 把 exe 所在目录加进用户 PATH;set path off 撤销
node bin/cli.js stop --all --json                # 总退出:停下所有沙箱;走到用户日常那台会要人在面板上点头

node bin/cli.js ls --json                        # 此刻全景:谁在跑、装了什么、此刻还有谁在动这个数据目录
node bin/cli.js logs <沙箱名> --shape --json     # 先看日志形状,再决定要不要读正文
node bin/cli.js logs <沙箱名> --errors --json    # 只要像出错的行(靠关键词猜的,会说明)
node bin/cli.js logs --version 0.1.0-rc.8 --json # 下载/删除那个版本时说了什么(下载中也能看)
node bin/cli.js ls memory --json                 # 这个数据目录最近做过什么(含被拒绝的、含是谁干的)
node bin/cli.js ui --port 10130                  # 给人开配置窗(会一直占着这个进程)
```

**共 10 个动词**:`ls` `get` `rm` `start` `stop` `set` `logs` `ui` `mcp` `help`。上面每一条都认 `--json`,`ui` 与 `mcp` 除外(一个给人开窗口、一个给 Agent 当 MCP 服务,都不返回)。

⭐ **档案柜写成一个值,不是一个旗标**:`--in` 看/改哪个柜、`--to` 拿进哪个柜、`--from` 从哪个柜拿。值是沙箱名,或者日常档案柜的名字 `main`。

**配置窗没有第二套实现。**它显示的每件事都来自这里的命令:人点一个按钮,窗口就起一个进程敲对应的那条命令,和你敲的是同一条,记进同一份 `logs/actions.log`,失败给同一个 `code`。**所以窗口不可能做到命令行做不到的事**,你也不需要为了"让人看得见"去走窗口那条路。

## 人一直看得见你,你不用打招呼

**没有「接管」这个动作了**(`agent attach` / `agent detach` 已删)。你每敲一条会改状态的命令,
它自己会在数据目录里登记一条「正在跑」,跑完自动删掉;配置窗看见这条记录就罩上蓝框、
**在这条命令跑完之前不接受点击**,并按顺序标出被碰过的控件。你不需要声明任何东西,
也没有东西要交还——**进程一结束,锁就没了**。

- **多个 agent 同时干活是允许的**:一个进程一条记录,谁也不挤掉谁,每一步都记着是哪个进程干的。
- **下次醒来先敲 `ls memory`。**它列出这个数据目录最近的每一步——**包括被拒的那几步**、以及此刻还有谁在跑。
  「你在这里被拦下过」是你最该先知道的事,否则会再撞一次同一堵墙。
- ⚠️ 反过来也成立:**人在窗口上点东西的时候,你发的命令不受影响**——挡的只是窗口那一侧。
- ⛔ **能用这些命令干的事就不要绕过去自己伸手干**(直接改文件、自己起 dsh 进程)。
  窗口显示的是"经过这个工具的一切",绕过去的部分它看不见,人会以为屏幕上就是全部。

## 每轮先敲 `ls`

它只报此刻、**全部本地读盘不碰网络**,所以永远是快的。一句话拿到:数据目录、
此刻还有谁在动这个数据目录、**用户自己装的那台 dsh(`host`)**、已下载版本、记着的插件、
3080 上日常工作区在不在、每台沙箱跑没跑在哪。
**你每轮醒来都不记得上次做过什么,这条命令就是拿来重新定位的。**

## 看日志的三条规矩

- **先 `--shape` 再决定读不读。**它返回「多少行/多大/几行像出错/最后一行/文件在哪」,
  **无论日志多大这个回答都是固定几百字符**。绝大多数时候看完形状就够了。
- **默认只给最后 50 行或 4000 字符**(谁先到算谁),**并且会明说省略了多少、全文在哪**。
  要更多用 `--lines N`;`--all` 列出留着的所有日志。
- **`--errors` 是猜的**,输出里会标明——dsh 没有统一的错误标记,拿不准就看全文。

## `--json` 的约定

- 每一行都以 `{"schema":1, "box":…, "ok":…, "verdict":…}` 开头。**成功**是 `"ok":true`,**失败**多带 `"code":…, "message":…`。
- **`verdict` 分四档,退出码只是它的投影**:`ok` 0 答出来了 ／ `failed` 1 关于你问的那台的判定(沙箱不在、dsh 没起来、闸门拒了;请求没错,是世界说了不)／ `error` 2 请求或本工具的问题(不认识的命令或选项、工具崩了)／ `partial` 3 做了一半再被拒,答案里写着做了哪一半。⛔ 别把 1 当成「工具坏了」,也别把 2 当成「沙箱有问题」。
- **`code` 是不会变的标识,`message` 是给人看的、随时可能改写。**判断出了什么事请用 `code`,不要匹配中文。
- **`box` 是本次操作用的数据目录。**图形窗和命令行指向不同数据目录时,两边的回答都正确、都自洽、说的却是两个世界——每次核对这个字段是唯一的防线。
- **形状有版本**:裸 `--json` 永远是第 1 版,`--json=1` 是它的明写;要一个没有的版本会被拒(`JSON_SCHEMA_UNKNOWN`)。
- `--json` 写在子命令前后都可以。不认识的选项会被拒绝而不是忽略;**别的命令的选项也拒**,并说明它属于谁(`FLAG_NOT_HERE`)。
- **`ls` 是总览不是全量**:每台沙箱一行、插件只给数目;路径看 `ls sandbox`,某一柜装了什么看 `ls plugin --in <档案柜>`。

## 走 MCP 那条路

`dsh-box mcp` 把这张命令表原样交给 MCP 客户端,每条命令就是一个同名工具(两个词之间用下划线:`ls_sandbox`、`get_plugin`、`start`、`stop`),参数名就是旗标去掉 `--`,位置参数的名字以工具的 inputSchema 为准(就是 `--help --json` 里 `params[].name`;例如 `get_plugin` 的位置参数叫 `source`,`rm_sandbox` 的叫 `sandbox`)。挂法:

```json
{"mcpServers":{"dsh-box":{"command":"npx","args":["dsh-box","mcp","--box","<数据目录>"]}}}
```

- 每次工具调用的背后就是同一条命令行带 `--json`,答案就是那一行 JSON;**只有 `error` 会标成工具出错(isError)**,`failed` 与 `partial` 是答案。
- 不在工具表里的只有不返回的两样:`ui`、`mcp` 自己;`start --follow` 同理。需要人点头的动作照旧:后台那条命令行自己弹面板等一分钟。
- 答案超过 20000 字符会换成一条 `partial` 替身(`ANSWER_TOO_LARGE`,带前一段与实际大小);`mcp --max-chars <字符数>` 可调。

全部 `code`（41 个）:`BAD_FLAG` `BAD_PACKAGE_NAME` `BAD_PID` `BAD_PLUGIN_ID` `BAD_SANDBOX_NAME` `BAD_SETTING_VALUE` `BOOT_EXITED` `BOOT_EXITED_LATE` `BOOT_TIMEOUT` `DIR_NOT_FOUND` `MAIN_DSH_RUNNING` `MISSING_ARGUMENT` `MISSING_VALUE` `NEEDS_APPROVAL` `NOT_A_DSH_PLUGIN` `NOT_OURS` `NOT_RUNNING` `NO_BACKUP` `NO_FREE_PORT` `NO_HOST_DSH` `NO_LOGS` `NO_PACKAGE_JSON` `NO_PACKAGE_NAME` `NO_SESSIONS` `NO_SUCH_SANDBOX` `NPM_FAILED` `PLUGIN_DEPS_MISSING` `PLUGIN_HAS_NO_ENTRY` `PLUGIN_LINK_BROKEN` `PLUGIN_NOT_BUILT` `SAME_WORKSPACE` `SANDBOX_ALREADY_RUNNING` `SANDBOX_RUNNING` `UNKNOWN_COMMAND` `UNKNOWN_FLAG` `UNKNOWN_PLUGIN` `UNKNOWN_SETTING` `UNREADABLE_MANIFEST` `UNREADABLE_PATCH` `VERSION_IN_USE` `VERSION_NOT_DOWNLOADED`。
（这一批新的都来自「插件属于工作区」那次改动:`NOT_OURS`／`UNREADABLE_PATCH`／`NO_BACKUP`／`BAD_PACKAGE_NAME`／`NPM_FAILED`／`SAME_WORKSPACE`,以及闸门那条 `NEEDS_APPROVAL`。
⚠️ 数它们别只 grep 一行:`NOT_OURS` 是写在三元表达式里的,按 `new BoxError('X'` 去数会漏掉它。）

## ⭐⭐ 插件是工作区的属性,不是这次启动的

**这是最近一次改动里最大的一条,旧的理解会让你判断错。**

- `get plugin <id|目录|包名> --to <档案柜>` ＝ **真的装进某一个档案柜**,写在那个档案柜自己的
  profile 配置里。从此**用户自己敲 `dsh` 也会加载它**,不是只有从 dsh-box 启动才有。
- `start --plugin <id>` ＝ 启动前顺手装一次;`start --unplug <id>` ＝ 顺手拿掉。
- ⛔ **不写 `--plugin` 不是「一个都不装」,是「什么都不改」**——这个工作区之前装过的照样在。
  要一台纯官方的 dsh,**新建一个沙箱**(`--new`),新沙箱天生一个插件都没有。
- ⛔ `start --json` 里的 `pluginsChanged` 说的是**这一次改动了哪几个**(不写 `--plugin` 就是空的,那是「什么都没改」不是「一个都没装」);同一份答复里的 `cabinetPlugins` 才是**这个档案柜现在装着什么**。
- **要知道某个档案柜现在有什么,问 `ls plugin --in <档案柜>` 或 `ls` 的 `mainPlugins`**,
  返回分两栏:`ours`(dsh-box 装的,卸得掉)与 `theirs`(那个工作区本来就有的,**我们不动**)。
- 卸载**只删我们写进去的那几条**。想拿掉 `theirs` 里的东西会得到 `NOT_OURS`,这是对的,
  不要绕过去——那是用户或别的工具写的,不归这里管。
- **改任何档案柜的配置之前会先整份备份**,轮转是自动的,不用你管。逐条卸载够不着时
  (文件被改成认不出的形状),用 `set plugin --undo --in <档案柜>` 退回上一次改动之前——
  **按 n 次退 n 步**,输出里会说还能再退几步。

npm 上的包**先下载到 dsh-box 自己的目录**,再按本地插件那条路链进工作区——不是装进那个
profile。⛔ 这不是偏好,是实测:真 `~/.dsh` 的 profile 里有 pnpm 专有的 `link:` 依赖,
**npm 在那儿根本跑不起来**(`EUNSUPPORTEDPROTOCOL`)。所以 `dsh.profile.bundles` 这个文件
**我们只读不写**,里面的东西一律算那个工作区自己的。

## ⛔ `get plugin <目录>` 只认「一个文件夹＝一个插件」

它把那个文件夹 junction 链进 profile 的 `node_modules`,**不装任何依赖**。所以下面三种目录会被**当场拒绝**,而不是装上去之后由 dsh 一声不吭地忽略——**dsh 对形状不对的插件从不报错,只是不加载**,这三个 `code` 就是拿来把那份沉默换成一句话的:

- `NOT_A_DSH_PLUGIN` —— `package.json` 里没有 `dsh` 字段。**最常见的来源是指到了多包仓库的根目录**(clone 下来就是它,而且确实有 package.json)。错误里会列出 `packages/` 下的候选。
- `PLUGIN_DEPS_MISSING` —— 它依赖同仓兄弟包(`workspace:*`)而自己的 `node_modules` 没装。**多包仓库里的聚合包几乎一定是这种**。
- `PLUGIN_NOT_BUILT` —— `main` 指的入口文件不存在,这个仓还没构建过(`lib/` 通常被 git 忽略)。
- `PLUGIN_LINK_BROKEN` —— 链接建出来了却指向不存在的地方。**登记的路径一律会被转成完整路径**(相对路径在 Windows 上是相对链接自己那个文件夹解析的,而不是相对你敲命令的位置),老配置里若还留着相对路径,启动时会当场报这个,而不是让 dsh 少装一个插件还不吭声。
- `PLUGIN_HAS_NO_ENTRY` —— **没有可导入的入口**(既无 `main`/`exports`,也无 `index.js`)。这类是「只带 patch 的包」:自己不含代码,靠自己的 `cordis.patch.yml` 把有代码的包引进来。**挂它没用,该挂的是它引的那些。**⚠️ 实测判例:`@linxin666/dsh-skins` 声明了 `dsh.bundle` 却没有代码,挂上去**把整台 dsh 的启动带崩**(`ERR_MODULE_NOT_FOUND`)。

**要装 npm 上发布的插件用 `get plugin <包名> --to <档案柜>`**,它会把包下载到
dsh-box 自己的目录(`<数据目录>/packages`),然后走上面这三道同样的检查再链进去。
⚠️ 所以**纯资产型的包会被 `PLUGIN_HAS_NO_ENTRY` 拒绝**——那种包该由引用它的那个包带进来。

## ⭐ `start` ＝ 选两样东西,而且什么都不沿用上次

**一次启动是两个独立的选择**,dsh 只有一台机器的概念,`DSH_HOME` 才是档案柜的位置:

| 轴 | 怎么说 | 不说的话 |
|---|---|---|
| **机器**(用哪套 dsh 安装) | `--version <版本号>` ＝ 用 dsh-box 下载的那份 | **用用户自己装的那台**(全局 npm 那个) |
| **档案柜**(开哪个 `DSH_HOME`) | `start <沙箱名>` / `--new` / `start main` | **拒绝**,报 `MISSING_ARGUMENT` |

- ⛔ **不写 `--version` 不是「沿用上次那个版本」,是「用这台电脑上已经装着的 dsh」。**探不到就报 `NO_HOST_DSH` 并说明两条出路,**不会偷偷回落到某个下载的版本**。
- ⛔ **档案柜也不沿用上次。**裸敲 `start` 一定被拒。理由:同一条命令应当永远得到同一个结果——这条比少敲几个字重要,你写进日志或回给用户的那行命令,别人重跑必须得到同一台。
- ⛔ **`main` 只说档案柜,不说机器。**`start main` 配 `--version` 是唯一「出事修不回来」的组合(见下)。`main` 和 `--new` 同时给会被拒:它们是同一个问题的两个答案。
- 输出里的 `engine` 字段说清楚了这次用的是哪台:`{"kind":"host"|"release","version":…,"dir":…}`。**光看 `version` 分不出来**——用户自己装的和我们下载的可以是同一个版本号、两套不同的安装。
- **启动完就交还命令行,沙箱留在后台跑。**输出里有 `url`／`pid`／`port`／`logFile`,还有 `elapsedMs`(这一次从接到命令到 dsh 真在服务用了多少毫秒)——**定自己的等待上限用它,别照抄文档里的约数**。要停用 `stop <沙箱名>`,**不要按进程名模糊匹配去杀**,会误杀用户自己正在用的 dsh。人想留在终端看日志加 `--follow`(Ctrl+C 则停掉沙箱)。
- **一个沙箱同时只能跑一台**(两台会互踩同一份档案柜)。要并行就用不同的沙箱名,端口从 3090 起自动找。
- ⛔ **但插件不在「不沿用」之列**,因为它根本不属于这次启动:见上面那节。不写 `--plugin` ＝ 不改动这个工作区的插件。

### 用用户自己那台 ＋ 沙箱 home ＝ 白送的安全组合

`ls` 的 `host` 字段报的就是那台(在哪、什么版本、包版本核对结果)。用它开沙箱**两头都不影响**:隔离靠的是 `DSH_HOME` 不是靠哪套安装,状态全写进沙箱那个 home,链接只往沙箱里建、对全局安装只读,端口也不撞。**试插件的默认做法就该是这个**——用他日常那台 dsh,在一次性 home 里试,试完删文件夹。
⚠️ 代价:我们下载的每个版本都逐包核对过,全局安装没人核对。所以 `ls` 顺手核对一次并照实报告,包括**「这套安装的形状没见过,核对不了」**这第三种答案——它不等于「版本混杂」,别混说。
- **启动失败时,输出里的 `tail` 是 dsh 自己最后说的话**,`logFile` 是全文位置。只看退出码判断不了原因。
- **判断"起好了"的标准是首页带着启动清单且进程稳定**,端口通不算数——web 服务一激活就监听,插件树还在装。这条工具已经替你做了。

## `stop --all` 是一个动作,不是"关掉某个进程"

**没有一个常驻的 dsh-box 进程可关。**每条命令都是自己的小进程,跑完就退;沙箱是被交出去的独立 dsh 进程。所以"退出"只能是一件**做**出来的事,`stop --all` 就是做这件事:**让所有沙箱停下**。

- **`--all` 只停沙箱。**要连日常档案柜一起停,再敲一次 `stop main`(界面上那个勾选框调的就是它)。
- ⛔ **只有「从这里启动的」日常档案柜停得掉**,因为只有它有记下来的进程号。用户自己在别处开的那台,我们只知道 3080 在应答、**认不出是哪个进程**,不该也不会去动——`ls` 用两个字段把这两件事分开:`main`(我们起的那台,含 pid)与 `mainDshOnDefaultPort`(端口有没有应答)。**按端口猜进程去杀,是杀错东西的标准做法。**
- **沙箱只是停下,不会被删**,里面的对话原样还在,下次 `start` 同名即可继续。
- `ui` 那个进程被 Ctrl+C 掉**不算** `stop --all`——那只是结束了 `ui` 这一条命令,沙箱照跑。配置窗本身用 `stop --window` 关。
- 替用户执行前先 `ls` 看看会停掉哪几台,并说出来。

## 必须知道的事

- **「沙箱」只是一个独立的 `DSH_HOME`,不是安全隔离。** 它开出来的 dsh 进程权限和用户平时那台一模一样——能读写这台电脑的文件,花真实的钱。隔开的是版本、插件、配置和对话,不是这台电脑。**不要基于"这是沙箱"的假设在里面运行不受信的插件或代码。**
- **沙箱默认导入用户的真 API Key**(`--no-sign-in` 可关)。在沙箱里发出的每条对话都真实计费。替用户启动前应征得同意。
- ⛔ **`main` 这个档案柜就是用户天天在用的那个 `~/.dsh`**,不是沙箱。替用户执行前必须问过。
  **真正修不回来的是 `start main` ＋ `--version` 那一格**:①dsh 的磁盘格式跨版本**没有迁移路径**,用新版本打开过之后旧版本可能就打不开这个 home;②那台 dsh 在跑期间,`~/.dsh/profiles/node_modules` 那层指针指向 dsh-box 的版本目录(**正常退出会清掉,强杀则留着**,于是用户日常的 dsh 就依赖上了 dsh-box 这个文件夹——真机上发生过,251 条)。
  **不给 `--version` 的 `start main` 没有这两条**:用他自己那台开他自己的 home,就是他平时的状态。
  ⛔ **凡是动到日常档案柜的,都要有人在面板上亲手点过**,代号 `NEEDS_APPROVAL`。**「动」包括停机**
  (`stop main`、`stop --all` 走到那一台时),不只是写配置。
  ⭐⭐ **它会挡住你,而且是这样挡的**(2026-08-28 改的形态):这条命令**自己把面板弹出来**,
  在磁盘上留一条待批请求,然后**最多等 60 秒**。人在面板上点「允许」之后,**由面板把这条命令跑掉**,
  你这边照常收到 `ok:true`(多一个 `approvedInWindow: true`)。
  - 没人点 → 60 秒后返回 `NEEDS_APPROVAL`。
  - 点了拒绝 → 立刻返回 `APPROVAL_DENIED`。
  - **面板根本弹不出来 → 立刻返回 `NO_PANEL`,不会白等那一分钟。**
  ⛔⛔ **没有任何旗标能替代那一下。`--approved` 已经删掉了**,现在敲它报 `UNKNOWN_FLAG`。
  判据是两条同时成立:这次运行的父进程是那扇面板,**并且**面板是在有人回答了某一条请求之后
  才起的它。你自己的命令行两条都不满足,怎么写参数都过不去。
  ⭐ **撞上之后的两条正路**:让用户去面板点一下;或者**别动日常柜——在沙箱里复刻一份来验证**
  (`get plugin --from main --to <沙箱>` 整柜搬过去)。
  ⚠️ 环境变量 `DSH_BOX_NO_PANEL=1` 会让它**不弹面板、立刻拒绝**。给无头机器和 CI 用的,
  它只会让拒绝来得更快,**不会**让任何东西通过。
  ⚠️ `set ask-on-daily off` 只影响窗口里那些提示的啰嗦程度,它**不会**替任何人同意。
- `get chat` **只复制不搬走**,重复的对话按 session id 跳过,可安全重跑。方向随便:
  `--from <名|main> --to <名|main>`,沙箱之间也行。
  **目标那台 dsh 正跑着会被拒绝**(dsh 只在启动时扫描对话目录),确认无碍可加 `--force`。
  ⚠️ 目标是日常档案柜时,这个检测只认 3080——跑在自定义端口的 dsh 探不到。
- **记忆库跟工作区走,不跟沙箱走**(dsh 自身设计):沙箱和用户日常 dsh 打开同一个项目文件夹时,`<项目>/dsh_memory` 是同一份。在沙箱里试会写记忆的插件,选个一次性文件夹当工作区。
- 判断"版本装好了"的唯一标准是钉版核对通过(工具自动做),不要用目录存在与否或端口通不通来判断。
- 数据都在 `./dsh-box-files/data`(或 `--box <目录>` / 环境变量 `DSH_BOX_HOME`)。一个沙箱 = 一个独立 `DSH_HOME`,删目录即卸载。桌面壳(exe)的数据在 exe 旁的 `dsh-box-files/data`——Agent 想和窗口共享同一份数据,就把 `DSH_BOX_HOME` 指到那里。
- **沙箱名的规则**:字母(中文、日文等都可以)、数字、`_`、`.`、`-`;不能有空格或标点,不能以 `-` 或 `.` 开头,不能是 Windows 保留设备名(`con`/`nul`/`com1` 等),最长 64 字符。不合规**不会被悄悄改写**,而是报 `BAD_SANDBOX_NAME`,`message` 说明哪一条没过、`rule` 字段是规则全文。
