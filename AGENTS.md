# 给 Agent 的使用说明

本工具是 dsh 沙箱管理器,全部功能都有命令行,不需要打开图形窗。

```
node bin/cli.js versions                 # 已下载哪些版本 / npm 上有哪些
node bin/cli.js pull 0.1.0-rc.8          # 下载并逐包钉版核对
node bin/cli.js sandboxes --json         # 沙箱清单(JSON)
node bin/cli.js start --version 0.1.0-rc.8 --sandbox <名> --workspace <目录> --json
node bin/cli.js adopt <沙箱名> --json    # 把沙箱对话复制进用户日常的 dsh
node bin/cli.js rm <沙箱名>              # 删除沙箱及其全部对话
```

## 必须知道的事

- **沙箱默认导入用户的真 API Key**(`--no-sign-in` 可关)。在沙箱里发出的每条对话都真实计费。替用户启动前应征得同意。
- `start --json` 成功时输出一行 `{url, pid, port, sandbox, version}`,随后进程保持前台看护沙箱;停止用 Ctrl+C 或按 pid 杀进程树。**不要按进程名模糊匹配去杀**,会误杀用户自己正在用的 dsh。
- `adopt` 只复制不移动,重复的对话按 session id 跳过,可安全重跑。检测到 3080 端口有 dsh 在跑会拒绝(用户重启 dsh 前看不到新对话);确认无碍可加 `--force`。
- 判断"版本装好了"的唯一标准是钉版核对通过(工具自动做),不要用目录存在与否或端口通不通来判断。
- 数据都在 `./dsh_box`(或 `--box <目录>` / 环境变量 `DSH_BOX_HOME`)。一个沙箱 = 一个独立 `DSH_HOME`,删目录即卸载。
