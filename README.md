<div align="center">

  <h1>DSH 干净启动</h1>

  <p>
    <img src="https://img.shields.io/badge/%E5%A4%9A%E7%89%88%E6%9C%AC%E5%B9%B6%E5%AD%98-ff6b35?style=for-the-badge" alt="多版本并存" height="90" />
    <img src="https://img.shields.io/badge/%E6%B2%99%E7%AE%B1%E9%9A%94%E7%A6%BB-2ea44f?style=for-the-badge" alt="沙箱隔离" height="90" />
    <img src="https://img.shields.io/badge/%E9%9B%B6%E5%91%BD%E4%BB%A4%E8%A1%8C-3178c6?style=for-the-badge" alt="零命令行" height="90" />
  </p>

  <p>双击一个 exe，勾几下开一台 dsh<br/>官方 rc.6 / rc.7 / rc.8 任选，同一个文件夹里并存<br/>每台沙箱各带各的插件、配置与会话，互不污染<br/>试插件、测版本、验兼容，都不碰你天天在用的那台</p>

  <p>
    <a href="#快速开始"><strong>快速开始</strong></a>
    ·
    <a href="#沙箱"><strong>沙箱</strong></a>
    ·
    <a href="#给-agent-调用"><strong>给 Agent 调用</strong></a>
    ·
    <a href="#roadmap"><strong>Roadmap</strong></a>
  </p>

  <p>
    <img src="https://img.shields.io/static/v1?label=License&message=MIT&color=blue&style=flat-square" alt="License: MIT" />
    <img src="https://img.shields.io/static/v1?label=Platform&message=Windows%20%7C%20macOS%20%7C%20Linux&color=lightgrey&style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/static/v1?label=Node&message=%E5%BF%85%E9%9C%80&color=green&style=flat-square" alt="Node 必需" />
  </p>

  <p><sub>Fable 5 辅助</sub></p>

  <p>中文 | <a href="README.en.md">English</a></p>

</div>

---

## 快速开始

1. 下载 exe，双击。
2. 选官方版本，勾要装的插件，给沙箱起个名字。
3. 启动。

首次运行会建一个数据文件夹，之后所有版本与沙箱都住在里面。位置和名字都可以改。

## 沙箱

一个沙箱就是一台完整的 dsh：

```
dsh-box/
├─ versions/            rc.6   rc.7   rc.8      官方版本，并存
└─ sandboxes/
   ├─ 试插件/           插件 · 配置 · 会话 · 工作区
   └─ 测-rc8/           同上，与隔壁毫不相干
```

删掉一个沙箱文件夹，那台 dsh 就从没存在过——没有"卸载"这一步。

同一份工作区可以挂进多个沙箱；**会话跟着沙箱走，不跟着工作区走**，所以换沙箱看不到隔壁的对话。

## 给 Agent 调用

界面上的每一步都有对应命令，输出是 JSON：

```bash
dsh-box versions --json
dsh-box create --name test --dsh 0.1.0-rc.8 --plugins pkg-a,pkg-b
dsh-box start test --json
```

默认只开命令行。HTTP 与 MCP 接口需要显式打开——沙箱会用你真实的 API Key。

## 版本

官方版本从 npm 取，插件层同时钉到同一版本。

`rc.6` 与 `rc.7` 是目前在用的两版，`rc.7` 是 npm 的 `latest`；`rc.8` 挂在 `next` 上，要装得指名道姓。

## Roadmap

- [ ] 原生小窗 exe（Windows / macOS / Linux）
- [ ] MCP 接口
- [ ] 插件来源扩展：npm / GitHub / 本地目录
- [ ] 沙箱配置导出与分享

## 常见问题

<!-- 留待实际使用与 issues 反馈补充 -->

## License

MIT
