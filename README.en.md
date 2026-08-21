<div align="center">

  <h1>dsh-box</h1>

  <p>
    <img src="https://img.shields.io/badge/MANY%20VERSIONS-ff6b35?style=for-the-badge" alt="Many versions" height="90" />
    <img src="https://img.shields.io/badge/SANDBOXED-2ea44f?style=for-the-badge" alt="Sandboxed" height="90" />
    <img src="https://img.shields.io/badge/NODE%20ONLY-3178c6?style=for-the-badge" alt="Node only" height="90" />
  </p>

  <p>Pick an official version, boot an isolated dsh<br/>Try a few plugins; the one you use daily is untouched<br/>Versions and sandboxes share one folder — deleting it is the uninstall<br/>Chats, config and workspace lists stay inside their own sandbox</p>

  <p>
    <a href="#quick-start"><strong>Quick Start</strong></a>
    ·
    <a href="#commands"><strong>Commands</strong></a>
    ·
    <a href="#what-a-sandbox-is"><strong>What a Sandbox Is</strong></a>
    ·
    <a href="#desktop-shell"><strong>Desktop Shell</strong></a>
  </p>

  <p>
    <img src="https://img.shields.io/static/v1?label=License&message=MIT&color=blue&style=flat-square" alt="License: MIT" />
    <img src="https://img.shields.io/static/v1?label=Node&message=%E2%89%A520&color=green&style=flat-square" alt="Node >= 20" />
    <img src="https://img.shields.io/static/v1?label=Platform&message=Windows%20%7C%20macOS%20%7C%20Linux&color=lightgrey&style=flat-square" alt="Platform" />
  </p>

  <p><sub>Built with Fable 5</sub></p>

  <p><a href="README.md">中文</a> | English</p>

</div>

---

**A small tool for plugin developers.** For now it only knows local plugin directories — linked in, so an edit takes effect on the next start. Installing someone else's plugin from npm is not built yet.

## Quick Start

```bash
npx dsh-box ui        # the interface opens in your browser, nothing to install
```

**Want a native window you can double-click? Grab an installer from [Releases](https://github.com/33moren33/dsh-box/releases).** Both routes are the same program wearing two faces — the same local service, the same page. Installing just adds an icon and a native folder picker.

Once the config window is open it is three steps: **pick an official dsh version → tick the local plugins to load → boot a sandbox.** The first run downloads the version you picked (about 200–260MB); after that it is reused.

If you would rather not use the interface, every step is a command of its own:

```bash
npx dsh-box versions                                  # what npm has, what you already downloaded
npx dsh-box pull 0.1.0-rc.8                           # download an official version
npx dsh-box plugins add ./my-plugin                   # remember a local plugin directory
npx dsh-box start --version 0.1.0-rc.8 --new --plugin my-plugin
npx dsh-box sandboxes --json                          # add --json to any command, for scripts and agents
```

From source it is `node bin/cli.js ui`.

**A "sandbox" is just a separate `DSH_HOME`, not a security boundary.** What it boots is a clean dsh with exactly the permissions your everyday one has — it can read and write your files, and it spends real money. What gets separated is the version, the plugins, the config and the chats. Not this computer.

**Ticked plugins are linked, not copied.** Edit the source and the next start picks it up; you never end up testing yesterday's code. Whether a boot succeeded has a hard test, too: the page carries the startup list and the process is still standing. An open port does not count.

## Data Directory

Downloaded versions, every sandbox, and the logs all live in one folder called `data`. **The data follows the program:**

- Run it with `npx` or from source and it is created under your current directory, at `dsh-box/data`.
- Install the desktop build or unzip the portable one, and it sits next to the exe, inside `dsh-box/`. That folder holds exactly two things: `boot` is the program, `data` is your stuff. **Unzipping over the top is the upgrade — `boot` is replaced, `data` is not touched by a single byte**, and the uninstaller only removes what it installed. Only when the exe sits somewhere unwritable (Program Files, say) does the data retreat to your user directory.

To put it elsewhere, use `--box <dir>` or the `DSH_BOX_HOME` environment variable. If a folder of that name already exists there, has something in it, and was not created by this tool, the tool picks a different name rather than writing into someone else's directory.

Every action worth waiting on — downloading, deleting, booting — leaves a timestamped log in `data/logs/` that outlives the window. When reporting a problem, pasting the matching one is the shortest path.

## Requirements

**Node 20 or newer. That is all.**

dsh ships through npm and its entry point is a Node script, so without Node there is no dsh. Nothing else is needed: the tool downloads the version it needs into its own folder and starts it from there. **It never looks for a globally installed dsh**, so it does not care which drive you installed on or which package manager you use.

dsh itself is plain JavaScript with no platform restrictions, so Windows, macOS and Linux all work.

## Commands

```
versions                     which versions you have, and what npm offers
pull <version>               download an official version (verified package by package)
drop <version>               delete a downloaded version (about 200–260MB)
plugins                      list the local plugins being remembered
plugins add <dir> [--id x]   remember a plugin directory
plugins rm <id>              stop remembering it
sandboxes                    list sandboxes
start [options]              boot a sandbox
adopt <sandbox> [--force]    copy a sandbox's chats into your everyday dsh
rm <sandbox>                 delete a sandbox and everything in it
ui [--port n]                open the config window
```

Options for `start`:

```
--version <version>  which version        --sandbox <name>   which sandbox
--new                a brand new sandbox  --plugin <id>      tick a plugin, repeatable
--workspace <dir>    which dir dsh opens  --no-sign-in       do not import the sign-in
--main               no sandbox: boot your real ~/.dsh, with the ticked plugins for this run only
```

**`--json` is a general option** — add it to any command for JSON output, meant for scripts and agents.

`--main` doubles as a health check: **if the sandbox boots and your main one does not, congratulations, there is something dirty in your local dsh.** Having a clean one to compare against beats staring at logs and guessing.

## What a Sandbox Is

A sandbox is exactly one `DSH_HOME` — the entire filing cabinet of a dsh: which plugins are installed, the config, the workspace list, and **every chat record**. Hand it a new cabinet and you have a brand new dsh; delete the folder and that dsh ceases to exist. There is no "uninstall" step.

`DSH_HOME` is dsh's own environment variable. This tool stays outside the dsh process the whole time and does four things: create directories, write config files, set `DSH_HOME`, and start the official dsh executable. **It imports no `@deepseek-ai` package**, so changes to the dsh plugin interface do not concern it.

That variable and its `~/.dsh` default have not been renamed, aliased, or given a compatibility layer since they first appeared in the official repository on 2026-06-25. **As long as those two hold, the sandbox half is unaffected by dsh updates.** The other half — delivering local plugins into a profile — leans on directory conventions that are considerably newer, and keeping up with those is on us.

Three things worth knowing:

**A chat belongs to the sandbox it happened in.** Two sandboxes opening the same code folder see different histories, because history follows the cabinet, not the code folder.

**A sandbox uses your real sign-in.** Importing it is on by default so you do not reconfigure an API key per sandbox; chats inside a sandbox are real requests and are really billed.

**Chats can be brought back out.** `adopt <sandbox>` copies its chats into your everyday dsh, keyed by session, so running it again adds nothing twice.

## Network

Downloading a version means reaching the official npm registry. The tool **does not decide about your proxy for you**: before downloading it tries a direct connection once, uses it if it works, falls back to whatever proxy your system already has if it does not, and writes down which one it chose.

The right answer differs across three situations. With no proxy, direct is the only option anyway. With a proxy running, direct is often several times faster and drops fewer connections. And on a network where npm is only reachable through the proxy, direct is not slow — it simply cannot install anything. Bypassing the proxy applies to the npm registry domain alone; every other request is untouched.

## Desktop Shell

```
npx tauri build
```

This produces the double-clickable window and the NSIS installer. The shell is written in Rust and does four things: find the system Node, pick a free port, start that same Node service, and reap the whole process tree when the window closes. **The page and the logic are the same ones the browser gets**; the shell just adds a native "Browse…" folder picker, which hides itself in the browser.

Building requires a Rust toolchain. macOS and Linux artifacts must be produced on those systems; you cannot cross-build them from Windows. Unsigned programs get stopped once on both: on Windows click **More info → Run anyway**, on macOS it is Gatekeeper.

## FAQ

<!-- To be filled in from real use and issue reports. -->

## License

MIT
