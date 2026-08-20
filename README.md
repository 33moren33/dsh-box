<div align="center">

  <h1>DSH 干净启动</h1>

  <p>
    <img src="https://img.shields.io/badge/%E5%A4%9A%E7%89%88%E6%9C%AC%E5%B9%B6%E5%AD%98-ff6b35?style=for-the-badge" alt="多版本并存" height="90" />
    <img src="https://img.shields.io/badge/%E6%B2%99%E7%AE%B1%E9%9A%94%E7%A6%BB-2ea44f?style=for-the-badge" alt="沙箱隔离" height="90" />
    <img src="https://img.shields.io/badge/%E5%8F%AA%E9%9C%80%20NODE-3178c6?style=for-the-badge" alt="只需 Node" height="90" />
  </p>

  <p>选一个官方版本，开一台隔离的 dsh<br/>勾几个插件试，你天天用的那台不受影响<br/>版本和沙箱同住一个文件夹，删掉就等于卸载<br/>对话、配置、工作区名册各归各的沙箱，互不串门</p>

  <p>
    <a href="#怎么用"><strong>怎么用</strong></a>
    ·
    <a href="#命令"><strong>命令</strong></a>
    ·
    <a href="#沙箱是什么"><strong>沙箱是什么</strong></a>
    ·
    <a href="#桌面壳"><strong>桌面壳</strong></a>
  </p>

  <p>
    <img src="https://img.shields.io/static/v1?label=License&message=MIT&color=blue&style=flat-square" alt="License: MIT" />
    <img src="https://img.shields.io/static/v1?label=Node&message=%E2%89%A520&color=green&style=flat-square" alt="Node >= 20" />
    <img src="https://img.shields.io/static/v1?label=Platform&message=Windows%20%7C%20macOS%20%7C%20Linux&color=lightgrey&style=flat-square" alt="Platform" />
  </p>

  <p><sub>Fable 5 辅助</sub></p>

</div>

---

**「沙箱」只是一个独立的 `DSH_HOME`，不是安全隔离。** 它开出来的是一台干净的 dsh，权限和你平时那台一模一样——能读写你的文件，花你真实的钱。隔开的是版本、插件、配置和对话，不是这台电脑。

**勾上的插件是链过去的，不是拷过去的。** 改完源码下次启动就生效，不会让你测到昨天的代码。启动成没成也有硬判据：页面带着启动清单、进程还稳着，才算起来了——端口通不算数。

## 怎么用

```
node bin/cli.js ui        打开配置窗
node bin/cli.js           同样的事，在终端里做
```

第一次运行会在当前目录建一个 `dsh_box` 文件夹，下载的版本和所有沙箱都放在里面。想改名或换地方，用 `--box <目录>` 或环境变量 `DSH_BOX_HOME`。如果那里已经有个叫 `dsh_box` 的文件夹而且不是本工具建的，工具会另换一个名字，不会写进别人的目录。

下载、删除、启动这些要等的动作，每次都在 `dsh_box/logs/` 留一份带时间戳的日志，窗口关了也还在。报问题时把对应那份贴出来最省事。

## 需要什么

**Node 20 或更新，仅此而已。**

dsh 通过 npm 分发，启动文件是个 Node 脚本，所以没有 Node 就跑不了 dsh。除此之外什么都不需要：工具把要用的版本下载到自己的文件夹里再从那儿启动，**不会去找你全局装的 dsh**，也就不在乎你装在哪个盘、用的哪个包管理器。

dsh 本身没有任何平台限制、是纯 JavaScript，所以 Windows、macOS、Linux 都能跑。

## 命令

```
versions                     看已下载了哪些版本，以及 npm 上有哪些
pull <版本号>                下载一个官方版本（逐包核对版本）
drop <版本号>                删掉一个已下载的版本（约 200–260MB）
plugins                      列出记住的本地插件
plugins add <目录> [--id x]  记住一个插件目录
plugins rm <id>              不再记
sandboxes                    列出沙箱
start [选项]                 启动一个沙箱
adopt <沙箱名> [--force]     把沙箱的对话复制进你日常的 dsh
rm <沙箱名>                  删掉一个沙箱及其中一切
ui [--port n]                打开配置窗
```

`start` 的选项：

```
--version <版本>     用哪个版本          --sandbox <名字>   用哪个沙箱
--new                开全新沙箱          --plugin <id>      勾一个插件，可重复
--workspace <目录>   dsh 打开哪个目录    --no-sign-in       不导入登录
--main               不开沙箱，用你真实的 ~/.dsh 启动，勾的插件只在这一次生效
```

**`--json` 是通用选项**，任何命令加上它都以 JSON 输出，给脚本和 Agent 用。

`--main` 顺带是个体检：**沙箱开得起来、主机开不起来 —— 恭喜，你本机那台 dsh 里有脏东西。** 有干净的一台当对照，比盯着日志猜快得多。

## 沙箱是什么

一个沙箱就是一个 `DSH_HOME` —— 一台 dsh 的整个档案柜：装了哪些插件、配置、工作区名册，以及**所有对话记录**。给它一个新的档案柜就等于一台全新的 dsh；把文件夹删掉，那台 dsh 就不复存在，没有「卸载」这个步骤。

`DSH_HOME` 是 dsh 官方自己的环境变量。本工具全程在 dsh 进程外面，只做四件事：建目录、写配置文件、设 `DSH_HOME`、启动官方的 dsh 可执行文件。**不引用任何 `@deepseek-ai` 包**，所以 dsh 改插件接口与它无关。

三件要知道的事：

**对话记录属于它发生的那个沙箱。** 两个沙箱打开同一个代码文件夹，看到的历史也是不同的，因为历史跟着档案柜走，不跟着代码文件夹走。

**沙箱用的是你真实的登录。** 导入默认打开，省得每个沙箱都重配一遍 API Key；沙箱里的对话是真实请求，真实计费。

**沙箱里的对话能拿回来。** `adopt <沙箱名>` 把它的对话复制进你日常那台 dsh，按 session 幂等，重复执行不会多出来。

## 网络

下载版本要连 npm 官方仓库。工具**不替你决定走不走代理**：开始下载前先直连试一次，通就走直连，不通就走你系统里已配置的代理，并把选了哪条写进日志。

三种环境的正确答案不一样。没有代理时直连本来就是唯一选择；挂着代理时直连往往快好几倍、断线也少；而在必须靠代理才能连上 npm 的网络里，直连不是慢，是根本装不上。绕开代理只对 npm 仓库这一个域名生效，其它请求照旧。

## 桌面壳

```
npx tauri build
```

产出双击即用的小窗与 NSIS 安装包。壳是 Rust 写的，只做四件事：找系统 Node、挑一个空闲端口、拉起上面那个同样的 Node 服务、关窗时收割整棵进程树。**页面和逻辑与浏览器里那份是同一份**，壳里多一个原生的「浏览…」目录选择，浏览器里自动隐藏。

构建需要 Rust 工具链。macOS 与 Linux 的产物必须在对应系统上产出，无法从 Windows 交叉构建。两个平台的未签名程序都会被拦一次：Windows 点**更多信息 → 仍要运行**，macOS 是 Gatekeeper。

## 常见问题

<!-- 留待实际使用与 issues 反馈补充 -->

## License

MIT
