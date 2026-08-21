//! The desktop shell.
//!
//! Everything the tool does lives in the Node service next door; this crate
//! only puts a native window in front of it. Four jobs: find the system
//! Node, start the service on a free port, open a window pointing at it,
//! and take the whole process tree down when the window closes. Keeping the
//! shell this thin is what lets the browser version and the window version
//! stay the same program.

use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Where the window tries to live. Same preference as the plain `ui`
/// command, so bookmarks made in either world keep working.
const UI_PORT: u16 = 10130;

/// One booted Node service.
struct Server {
    pid: u32,
    url: String,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            match boot(app.handle()) {
                Ok(server) => {
                    let url: tauri::Url = server.url.parse().expect("a url built from a port");
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                        .title("dsh 沙箱启动器")
                        .inner_size(680.0, 780.0)
                        .build()?;
                    app.manage(server);
                    Ok(())
                }
                Err(reason) => {
                    // A double-clicked app has no terminal; the dialog is the
                    // only place a reason can reach the user. The stderr line
                    // is for the other launch path — a terminal or a test.
                    eprintln!("{reason}");
                    app.dialog()
                        .message(&reason)
                        .kind(MessageDialogKind::Error)
                        .title("dsh 沙箱启动器起不来")
                        .blocking_show();
                    Err(reason.into())
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // The service's children are the running sandboxes. Taking
                // the tree down with the window is what keeps closed-window
                // sandboxes from living on as orphans nobody can see.
                if let Some(server) = app.try_state::<Server>() {
                    kill_tree(server.pid);
                }
            }
        });
}

/// Start the Node service and wait until it answers.
fn boot(app: &tauri::AppHandle) -> Result<Server, String> {
    let (node, major) = find_node().ok_or_else(|| {
        "没找到 Node。这个工具和 dsh 本身都是 Node 程序,请先安装 Node 20 或更新版本(nodejs.org),装好后重新打开。".to_string()
    })?;
    if major < 20 {
        return Err(format!(
            "本机的 Node 是 {major} 版,太旧了。dsh 需要 Node 20 或更新版本,请升级后重新打开。"
        ));
    }

    let (entry, cwd, box_dir) = locate_boot(app)?;
    let port = free_port(UI_PORT).ok_or("找不到空闲端口")?;

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .args(["ui", "--port", &port.to_string(), "--no-open"])
        .current_dir(&cwd)
        // Captured, not inherited: a double-clicked app has no terminal, so
        // whatever Node says on the way down is only readable if kept.
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(dir) = &box_dir {
        command.env("DSH_BOX_HOME", dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("起不了 Node 服务:{error}"))?;

    // An open port is a sufficient readiness signal here: the service serves
    // its one static page the moment it listens, unlike a dsh sandbox whose
    // port opens long before it is usable.
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            let mut said = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                let _ = stderr.read_to_string(&mut said);
            }
            let tail: String = said.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev()
                .collect::<Vec<_>>().join("\n");
            return Err(format!(
                "Node 服务还没起来就退出了,退出码 {status}。\n入口:{}\nNode 说:\n{tail}",
                entry.display(),
            ));
        }
        if TcpStream::connect_timeout(
            &([127, 0, 0, 1], port).into(),
            Duration::from_millis(200),
        )
        .is_ok()
        {
            return Ok(Server {
                pid: child.id(),
                url: format!("http://127.0.0.1:{port}"),
            });
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    kill_tree(child.id());
    Err("Node 服务 20 秒内没有开始监听".to_string())
}

/// Find the service's entry script, the directory to run it in, and where
/// its data should live.
///
/// Two worlds: run from the repository (development), the entry sits next to
/// this crate and data goes wherever it always went — the repository's own
/// `dsh-box/data`. Installed or unzipped, the layout beside the exe is one
/// `dsh-box` folder holding `boot` (the program, replaced on upgrade) and
/// `data` (the user's things, never touched) — the whole point of the
/// portable form is that the folders you can see are the folders that hold
/// everything. Only when the exe sits somewhere unwritable (Program Files)
/// does data retreat to the per-user app directory.
fn locate_boot(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors() {
            let entry = ancestor.join("bin").join("cli.js");
            if entry.exists() && ancestor.join("src").join("server.js").exists() {
                return Ok((entry, ancestor.to_path_buf(), None));
            }
        }
    }
    let resources = plain(
        app.path()
            .resource_dir()
            .map_err(|error| format!("找不到资源目录:{error}"))?,
    );
    let entry = resources
        .join("dsh-box")
        .join("boot")
        .join("bin")
        .join("cli.js");
    if !entry.exists() {
        return Err(format!("安装包里缺了启动脚本:{}", entry.display()));
    }
    if let Some(beside) = box_beside_exe() {
        // The service runs where the exe lives, two levels up from
        // `dsh-box/data`, so anything resolved against the working
        // directory stays in the visible folder.
        let cwd = beside
            .parent()
            .and_then(|p| p.parent())
            .map(PathBuf::from)
            .unwrap_or_else(|| beside.clone());
        return Ok((entry, cwd, Some(beside)));
    }
    let data = plain(
        app.path()
            .app_data_dir()
            .map_err(|error| format!("找不到数据目录:{error}"))?,
    );
    std::fs::create_dir_all(&data).map_err(|error| format!("建不了数据目录:{error}"))?;
    // Inside the per-user app directory the app's folder role is already
    // taken by the directory itself, so the data folder sits directly in it.
    let box_dir = data.join("data");
    Ok((entry, data, Some(box_dir)))
}

/// The data directory beside the exe, when that location can actually hold
/// data. The layout is `dsh-box/boot` for the program and `dsh-box/data` for
/// everything the user accumulates: replacing the program means replacing
/// `boot`, and `data` is never touched by an upgrade or an uninstall.
///
/// Writability is proved by writing: create the directory and put a probe
/// file inside, because on Windows the only honest answer to "may I write
/// here?" is the attempt itself. An unwritable location (Program Files
/// without elevation) fails the probe and the caller falls back to the
/// per-user app directory.
fn box_beside_exe() -> Option<PathBuf> {
    let exe = plain(std::env::current_exe().ok()?);
    let dir = exe.parent()?;
    let candidate = dir.join("dsh-box").join("data");
    std::fs::create_dir_all(&candidate).ok()?;
    let probe = candidate.join(".write-probe");
    std::fs::write(&probe, b"probe").ok()?;
    let _ = std::fs::remove_file(&probe);
    Some(candidate)
}

/// Strip Windows' `\\?\` verbatim prefix.
///
/// Tauri hands out canonicalized paths, which on Windows carry that prefix —
/// and Node's module loader cannot open its entry script through it, failing
/// with a bewildering `lstat 'C:'`. Caught by running the portable layout
/// outside the repository.
fn plain(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

/// Find a runnable Node and its major version.
///
/// PATH is tried first, but is not enough on its own: a double-clicked app
/// does not see what a terminal sees. On macOS launchd's PATH knows nothing
/// of Homebrew or nvm; on Windows, version managers that only touch the user
/// PATH are invisible to some launch paths. So the usual install locations
/// are probed by absolute path as well, and whichever answers is used by its
/// full path — not as a bare `node` — so the choice cannot drift afterwards.
fn find_node() -> Option<(String, u32)> {
    let mut candidates = vec!["node".to_string()];
    #[cfg(windows)]
    {
        let env = |name: &str| std::env::var(name).ok();
        if let Some(dir) = env("NVM_SYMLINK") {
            candidates.push(format!("{dir}\\node.exe")); // nvm-windows' switchable link
        }
        if let Some(dir) = env("ProgramFiles") {
            candidates.push(format!("{dir}\\nodejs\\node.exe")); // official installer
        }
        if let Some(home) = env("USERPROFILE") {
            candidates.push(format!("{home}\\scoop\\shims\\node.exe"));
            candidates.push(format!("{home}\\.volta\\bin\\node.exe"));
        }
        if let Some(roaming) = env("APPDATA") {
            candidates.push(format!("{roaming}\\fnm\\aliases\\default\\node.exe"));
        }
    }
    #[cfg(not(windows))]
    {
        candidates.push("/opt/homebrew/bin/node".to_string()); // Homebrew, Apple Silicon
        candidates.push("/usr/local/bin/node".to_string()); // Homebrew, Intel; manual installs
        candidates.push("/usr/bin/node".to_string()); // distro packages
    }
    candidates
        .into_iter()
        .find_map(|node| Some((node.clone(), node_major(&node)?)))
}

/// The major version reported by one candidate `node`, if it runs.
fn node_major(node: &str) -> Option<u32> {
    let mut command = Command::new(node);
    command.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// First port nothing else is bound to, probed by binding — the only answer
/// that is correct on machines where Hyper-V reserves shifting port ranges.
fn free_port(from: u16) -> Option<u16> {
    (from..from.saturating_add(200)).find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
}

/// Stop a process and everything it started.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(windows))]
    {
        // SIGTERM to the direct child; sandboxes get their own SIGTERM from
        // the service's shutdown. Good enough until the mac/Linux packaging
        // pass, which is where process groups belong.
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}
