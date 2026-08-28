//! The desktop shell.
//!
//! Everything the tool does lives in the Node service next door; this crate
//! only puts a native window in front of it. Four jobs: find the system
//! Node, start the service on a free port, open a window pointing at it,
//! and take the whole process tree down when the window closes. Keeping the
//! shell this thin is what lets the browser version and the window version
//! stay the same program.
//!
//! One exe, two faces: double-clicked it is a window, given arguments it is
//! the command line — the same deal `claude -p` offers. The second face is
//! not a convenience. An agent driving an installed copy has no other way in,
//! and the way it used to reach for — running the bundled `cli.js` by hand —
//! resolves its data directory against the working directory and therefore
//! reports an empty world while the window shows three sandboxes. Here the
//! two faces are handed the same directory by the same function, so they
//! cannot disagree.

use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// Where the window tries to live. Same preference as the plain `ui`
/// command, so bookmarks made in either world keep working.
const UI_PORT: u16 = 10130;

/// Must stay equal to `identifier` in `tauri.conf.json`: it is the name of
/// the per-user folder both faces fall back to when the exe sits somewhere
/// unwritable, and the command line face has no Tauri app to ask.
const IDENTIFIER: &str = "com.dshbox.desktop";

/// The one folder beside the exe, holding `boot` (the program) and `data`
/// (the user's things).
///
/// ⛔ Must differ from `[[bin]] name` in `Cargo.toml`, and must stay equal to
/// the resource targets in `tauri.conf.json` and to `DEFAULT_BOX_NAME` in
/// `src/paths.js`.
const BOX_FOLDER: &str = "dsh-box-files";

/// One booted Node service.
struct Server {
    pid: u32,
    url: String,
}

/// Where the program is, where to run it, and where its data lives.
struct Layout {
    entry: PathBuf,
    cwd: PathBuf,
    box_dir: Option<PathBuf>,
}

/// Which face was asked for.
///
/// ⭐ Arguments decide, nothing else. No hidden flag, no environment
/// variable: `dsh-box` opens a window and `dsh-box status --json` answers on
/// the terminal, which is the whole of the rule and all of it is visible.
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        std::process::exit(run_command_line(&args));
    }
    #[cfg(windows)]
    if handed_over_to_detached_copy() {
        return;
    }
    run_window();
}

/// Pass the arguments to the command line and return its exit code.
///
/// Nothing is parsed here and nothing is reworded. The Node command line owns
/// every command, every flag and every message; this face only finds it,
/// points it at this installation's data directory, and gets out of the way —
/// otherwise there would be two programs deciding what `--main` means, and
/// two answers to that question is one too many.
fn run_command_line(args: &[String]) -> i32 {
    let wants_json = args.iter().any(|arg| arg == "--json");
    let layout = match layout(None, app_data_dir()) {
        Ok(layout) => layout,
        Err(reason) => return refuse(wants_json, "BOOT_MISSING", &reason),
    };
    let (node, major) = match find_node() {
        Some(found) => found,
        None => return refuse(wants_json, "NODE_MISSING", NO_NODE),
    };
    if major < 20 {
        return refuse(wants_json, "NODE_TOO_OLD", &old_node(major));
    }

    let mut command = Command::new(&node);
    command
        .arg(&layout.entry)
        .args(args)
        .current_dir(&layout.cwd)
        // Which file the user double-clicks is something only this side knows,
        // and `path add` needs it: a script cannot work out that it is being
        // run by an exe, let alone which one.
        .envs(exe_hint(layout.box_dir.is_some()))
        // Inherited, unlike the window's captured pipes: whoever typed the
        // command is the one who should see the output, as it appears.
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if let Some(dir) = &layout.box_dir {
        // Only when the caller has not already chosen one. An explicit
        // `DSH_BOX_HOME` means someone deliberately pointed at another data
        // directory, and `--box` still beats both. Which one won is never a
        // guess: every command prints the directory it used as its first
        // field.
        if std::env::var_os("DSH_BOX_HOME").is_none() {
            command.env("DSH_BOX_HOME", dir);
        }
    }
    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => refuse(wants_json, "NODE_MISSING", &format!("起不了 Node:{error}")),
    }
}

/// Say why nothing ran, in whichever form the caller asked for, and hand back
/// the exit code.
///
/// ⭐ The `code` is the contract — never translated, never reworded — and the
/// shape is the command line's own `{box, ok, code, message}`, because a
/// caller that parses one of these should not have to learn a second layout
/// for the handful of failures that happen before Node starts.
fn refuse(wants_json: bool, code: &str, reason: &str) -> i32 {
    if wants_json {
        let line = serde_json::json!({ "box": null, "ok": false, "code": code, "message": reason });
        println!("{line}");
    } else {
        eprintln!("\n  {reason}\n");
    }
    1
}

/// Deal with the console Windows hands a console-subsystem program, and say
/// whether the window has been handed to a detached copy of ourselves.
///
/// ⭐⭐ Why this exists at all: on Windows an exe declares one subsystem for
/// its whole life. Declared a window program, it has no console, and a
/// terminal that starts it does not wait for it — `dsh-box status --json`
/// would give the prompt back before the answer arrived, which is not a
/// command line. So this is a console program, and the console it gets when
/// nobody asked for one is dealt with here.
///
/// Three situations, told apart by who else is attached to the console:
/// nobody else means Windows made it for a double-click and it is ours to
/// hide; somebody else means we were started from a terminal, and rather than
/// occupy that terminal for as long as the window lives, the window is handed
/// to a detached copy so the prompt comes straight back; no console at all
/// means we already are that copy.
#[cfg(windows)]
fn handed_over_to_detached_copy() -> bool {
    const SW_HIDE: i32 = 0;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetConsoleWindow() -> isize;
        fn GetConsoleProcessList(list: *mut u32, count: u32) -> u32;
        fn FreeConsole() -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn ShowWindow(window: isize, command: i32) -> i32;
    }

    let (window, sharers) = unsafe {
        let window = GetConsoleWindow();
        if window == 0 {
            return false;
        }
        let mut pids = [0u32; 4];
        (window, GetConsoleProcessList(pids.as_mut_ptr(), pids.len() as u32))
    };

    if sharers <= 1 {
        // Ours alone. Hiding it is the whole cost of the second face: the
        // console exists for the few milliseconds before this line runs.
        unsafe {
            ShowWindow(window, SW_HIDE);
            FreeConsole();
        }
        return false;
    }

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let mut copy = Command::new(exe);
    copy.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    {
        use std::os::windows::process::CommandExt;
        copy.creation_flags(DETACHED_PROCESS);
    }
    // If the copy cannot be started, opening the window right here is still
    // better than not opening it: the only thing lost is the terminal, and
    // the person asked for a window.
    copy.spawn().is_ok()
}

/// Open the window.
fn run_window() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            match boot(app.handle()) {
                Ok(server) => {
                    let address = server.url.clone();
                    show_window(app, &address)?;
                    // ⭐ The window closes when the service does, and this is
                    // the arm that owns one: the page's own "quit" ends the
                    // service, and without this the shell went on living with a
                    // dead page in it — on screen, in the task list, and
                    // (before this) still called "closed" by the page.
                    watch_service(app.handle().clone(), &address);
                    app.manage(server);
                    Ok(())
                }
                // ⭐⭐ Not a refusal, and no longer a dialog: this data
                // directory already has a service, so show it. CEO 2026-08-28:
                // 「既然都能检测到冲突,那肯定可以直接接入应用的,应用打开也是直接
                // 给人观察窗不会冲突的」。
                //
                // It is also what this program already believed: a second
                // *service* on one data directory is refused, while **views are
                // free** — any number of browser tabs may point at the one
                // service. The shell simply never implemented the second half,
                // so a person who double-clicked got an apology instead of the
                // thing they asked for. ⛔ The apology was worse than useless:
                // `blocking_show` parks the process on a modal until somebody
                // clicks it, so every extra double-click left another dsh-box
                // sitting in the task list.
                //
                // ⛔ No `app.manage(server)` here, deliberately. This window
                // owns nothing: on exit the owner kills the service tree, and a
                // mere viewer doing that would shut down the world of the
                // person who actually started it — the exact harm the one
                // service rule exists to prevent.
                //
                // ⛔ Whether a service is already here is still decided by the
                // command line, never here. A copy of that rule in Rust would
                // be a second rule, and two rules about one fact drift.
                Err(NoWindow::AlreadyOpen { message, url }) => {
                    // ⚠ Attach only to something that answers. A seat can name
                    // a process that is alive and no longer listening, and a
                    // window opened onto that address shows a browser error
                    // page under our own title — which reads as "the app is
                    // broken" rather than "there is a stale seat here". The
                    // sentence, which now names the command that clears it, is
                    // the more useful of the two.
                    let reachable = match url.as_deref().and_then(socket_of) {
                        Some(socket) => {
                            TcpStream::connect_timeout(&socket, Duration::from_millis(400)).is_ok()
                        }
                        None => false,
                    };
                    match url {
                        Some(address) if reachable => {
                            show_window(app, &address)?;
                            watch_service(app.handle().clone(), &address);
                            Ok(())
                        }
                        // Nothing to attach to: no address, or nothing at it.
                        // Saying so beats opening a blank window onto nowhere.
                        _ => {
                            eprintln!("{message}");
                            app.dialog()
                                .message(&message)
                                .kind(MessageDialogKind::Info)
                                .title("dsh-box 已经开着了")
                                .blocking_show();
                            Err(message.into())
                        }
                    }
                }
                Err(NoWindow::Broken(reason)) => {
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

/// Why this run started no service of its own: because this data directory
/// already has one, or because something is wrong. Two very different
/// situations — and the first one is not a failure at all.
///
/// ⭐ `url` is what makes the difference actionable. Knowing *that* a service
/// is already here only lets us apologise; knowing *where* it is lets us show
/// it, which is what a person double-clicking actually wanted.
enum NoWindow {
    AlreadyOpen { message: String, url: Option<String> },
    Broken(String),
}

impl From<String> for NoWindow {
    fn from(reason: String) -> Self {
        NoWindow::Broken(reason)
    }
}

impl From<&str> for NoWindow {
    fn from(reason: &str) -> Self {
        NoWindow::Broken(reason.to_string())
    }
}

/// What to say when there is no usable Node. Said the same way to both
/// faces: the situation is identical and so is the fix.
const NO_NODE: &str = "没找到 Node。这个工具和 dsh 本身都是 Node 程序,请先安装 Node 20 或更新版本(nodejs.org),装好后重新打开。";

/// What to say when the Node that was found is too old.
fn old_node(major: u32) -> String {
    format!("本机的 Node 是 {major} 版,太旧了。dsh 需要 Node 20 或更新版本,请升级后重新打开。")
}

/// Start the Node service and wait until it answers.
fn boot(app: &tauri::AppHandle) -> Result<Server, NoWindow> {
    let (node, major) = find_node().ok_or_else(|| NoWindow::Broken(NO_NODE.to_string()))?;
    if major < 20 {
        return Err(NoWindow::Broken(old_node(major)));
    }

    // Tauri knows two directories this crate cannot work out on its own on
    // every platform, so the window hands them to the shared function rather
    // than the function growing a second way to find them.
    let resources = app.path().resource_dir().ok().map(plain);
    let app_data = app.path().app_data_dir().ok().map(plain);
    let Layout { entry, cwd, box_dir } = layout(resources, app_data)?;
    let port = free_port(UI_PORT).ok_or("找不到空闲端口")?;

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        // `--json` so that a refusal comes back as one machine-readable line
        // with a `code` that never changes and a `message` already in the
        // user's language. The shell then repeats what the command line said
        // instead of inventing its own wording.
        .args(["ui", "--port", &port.to_string(), "--no-open", "--json"])
        .current_dir(&cwd)
        // Inherited by every command the window runs, so a button and a typed
        // command have the same idea of which exe they belong to.
        .envs(exe_hint(box_dir.is_some()))
        // ⛔⛔ Not inherited, which is what the default would be. By the time
        // this runs the window face has no usable standard input: a
        // double-click gets a console that the previous step hides and frees,
        // and a launch from a terminal is handed to a detached copy that never
        // had one. Either way the inherited handle names a console that is
        // gone, and `CreateProcess` refuses the whole call — `os error 50`,
        // reported to the user as "起不了 Node 服务", with nothing to say which
        // of the three handles was at fault. The command line face never
        // reaches here, which is why it kept working and hid this.
        .stdin(Stdio::null())
        // Captured, not inherited: a double-clicked app has no terminal, so
        // whatever Node says on the way down is only readable if kept.
        .stdout(Stdio::piped())
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
            let mut answered = String::new();
            if let Some(mut stdout) = child.stdout.take() {
                let _ = stdout.read_to_string(&mut answered);
            }
            if let Some((message, url)) = refused_because_open(&answered) {
                return Err(NoWindow::AlreadyOpen { message, url });
            }
            let mut said = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                let _ = stderr.read_to_string(&mut said);
            }
            let tail: String = said.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev()
                .collect::<Vec<_>>().join("\n");
            return Err(NoWindow::Broken(format!(
                "Node 服务还没起来就退出了,退出码 {status}。\n入口:{}\nNode 说:\n{tail}",
                entry.display(),
            )));
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
    Err(NoWindow::Broken("Node 服务 20 秒内没有开始监听".to_string()))
}

/// The sentence to show when the command line refused because a window is
/// already serving this data directory, or None for any other outcome.
///
/// ⭐ The `code` is the contract — it is never translated and never reworded —
/// while `message` is already in whatever language the data directory is set
/// to. So the shell recognises the situation by the code and then says the
/// command line's own sentence, which is how the window and the terminal end
/// up telling a person the same thing.
fn refused_because_open(answered: &str) -> Option<(String, Option<String>)> {
    let line = answered.lines().rev().find(|line| !line.trim().is_empty())?;
    let parsed: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if parsed.get("code")?.as_str()? != "UI_ALREADY_SERVING" {
        return None;
    }
    let message = parsed.get("message")?.as_str()?.to_string();
    // ⭐ The refusal carries the address of the service already here, which is
    // what turns "no" into "here it is". Optional on purpose: a refusal from an
    // older service says only that one exists, and a window opened onto a
    // guessed address would be worse than the sentence.
    let url = parsed.get("url").and_then(|value| value.as_str()).map(str::to_string);
    Some((message, url))
}

/// Put the window on screen, showing whatever service is at this address.
///
/// ⭐ One function for both arms, because from here they are the same thing: a
/// view of a service. Which process started that service is a question about
/// ownership, answered above by whether a `Server` is managed — not by drawing
/// a different window.
fn show_window(app: &tauri::App, address: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url: tauri::Url = address.parse()?;
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("dsh 沙箱启动器")
        .inner_size(680.0, 780.0)
        .build()?;
    Ok(())
}

/// Close this window once the service it is showing is gone.
///
/// ⛔⛔ The gap this fills was reported from the other side: press the page's
/// own "close dsh-box" and the service really does end — but the shell went on
/// living, its window still on screen still saying 已退出, and the process
/// still in the task list. So the honest reading of the screen was that
/// quitting had not worked, and the only way out was the task manager.
///
/// ⭐ The same ruler the boot used: a service is here while something answers
/// on its port. Reusing it means the window cannot disagree with the check that
/// let it open in the first place.
///
/// ⚠ Three misses rather than one. A single refused connect happens while the
/// service is draining its last response, and a window that vanished on that
/// would be closing itself for a hiccup.
fn watch_service(app: tauri::AppHandle, address: &str) {
    let Some(socket) = socket_of(address) else { return };
    std::thread::spawn(move || {
        let mut misses = 0;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            if TcpStream::connect_timeout(&socket, Duration::from_millis(400)).is_ok() {
                misses = 0;
                continue;
            }
            misses += 1;
            if misses >= 3 {
                // Exit, not "close the window": leaving the process behind with
                // no window is the very thing being fixed.
                app.exit(0);
                return;
            }
        }
    });
}

/// The loopback address a service url points at.
fn socket_of(address: &str) -> Option<std::net::SocketAddr> {
    let port: u16 = address.trim_end_matches('/').rsplit(':').next()?.parse().ok()?;
    Some(([127, 0, 0, 1], port).into())
}

/// Find the service's entry script, the directory to run it in, and where
/// its data should live.
///
/// ⭐⭐ Both faces come through here, and that is the point. When the window
/// worked this out for itself and the bundled `cli.js` worked it out from the
/// working directory, the same installation reported three sandboxes in one
/// face and none in the other. One function, one answer.
///
/// Two worlds: run from the repository (development), the entry sits next to
/// this crate and data goes wherever it always went — the repository's own
/// `dsh-box-files/data`. Installed or unzipped, the layout beside the exe is
/// one `dsh-box-files` folder holding `boot` (the program, replaced on
/// upgrade) and
/// `data` (the user's things, never touched) — the whole point of the
/// portable form is that the folders you can see are the folders that hold
/// everything. Only when the exe sits somewhere unwritable (Program Files)
/// does data retreat to the per-user app directory.
///
/// `resources` and `app_data` are the two directories Tauri knows and this
/// crate cannot always work out alone; the window passes what Tauri says and
/// the command line passes its own equivalents. On Windows both are the same
/// answer either way, so the faces cannot drift where it would matter most.
fn layout(resources: Option<PathBuf>, app_data: Option<PathBuf>) -> Result<Layout, String> {
    let exe = std::env::current_exe().ok().map(plain);
    if let Some(exe) = &exe {
        for ancestor in exe.ancestors() {
            let entry = ancestor.join("bin").join("cli.js");
            if entry.exists() && ancestor.join("src").join("server.js").exists() {
                return Ok(Layout { entry, cwd: ancestor.to_path_buf(), box_dir: None });
            }
        }
    }

    // Beside the exe first: on Windows that is also what Tauri calls the
    // resource directory, and it is the only answer the command line face can
    // reach without a Tauri app to ask.
    //
    // ⛔ This folder must not be named after the binary. Cargo writes the
    // executable straight into `target/release/`, and Tauri lands these
    // resources in the same directory during a build — where a folder called
    // `dsh-box` and a file called `dsh-box` are the same name. Windows was
    // spared only because its executable carries `.exe`; Linux and macOS
    // failed the build outright with `Is a directory`.
    let packaged =
        |root: &Path| root.join(BOX_FOLDER).join("boot").join("bin").join("cli.js");
    let mut looked = Vec::new();
    let mut found = None;
    for root in [exe.as_deref().and_then(Path::parent).map(Path::to_path_buf), resources]
        .into_iter()
        .flatten()
    {
        let candidate = packaged(&root);
        if candidate.exists() {
            found = Some(candidate);
            break;
        }
        looked.push(candidate);
    }
    let entry = found.ok_or_else(|| {
        let where_looked = looked
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("\n      ");
        format!("安装包里缺了启动脚本,找过:\n      {where_looked}")
    })?;

    if let Some(beside) = box_beside_exe() {
        // The service runs where the exe lives, two levels up from
        // `dsh-box-files/data`, so anything resolved against the working
        // directory stays in the visible folder.
        let cwd = beside
            .parent()
            .and_then(|p| p.parent())
            .map(PathBuf::from)
            .unwrap_or_else(|| beside.clone());
        return Ok(Layout { entry, cwd, box_dir: Some(beside) });
    }
    let data = app_data.ok_or("找不到数据目录")?;
    std::fs::create_dir_all(&data).map_err(|error| format!("建不了数据目录:{error}"))?;
    // Inside the per-user app directory the app's folder role is already
    // taken by the directory itself, so the data folder sits directly in it.
    let box_dir = data.join("data");
    Ok(Layout { entry, cwd: data, box_dir: Some(box_dir) })
}

/// Tell the Node side which exe it is running behind, when there is one worth
/// naming.
///
/// ⛔ Deliberately empty when the program was found in a source checkout. The
/// exe is real there too — `target\debug\dsh-box.exe` — but it is not a copy
/// anybody installed, and the one command that reads this puts its folder on
/// the user's PATH. Saying nothing is what makes that command refuse in
/// development instead of registering a build directory.
fn exe_hint(packaged: bool) -> Vec<(String, String)> {
    if !packaged {
        return Vec::new();
    }
    match std::env::current_exe() {
        Ok(exe) => vec![("DSH_BOX_EXE".to_string(), plain(exe).display().to_string())],
        Err(_) => Vec::new(),
    }
}

/// The per-user application directory, worked out without asking Tauri.
///
/// The command line face runs before any Tauri app exists, so it cannot call
/// `app_data_dir()`. These are the same three locations that call returns,
/// written out per platform — deliberately, because the alternative is the
/// two faces disagreeing about where a Program Files installation keeps its
/// things, which is the exact bug this whole change exists to remove.
fn app_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|roaming| PathBuf::from(roaming).join(IDENTIFIER))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(IDENTIFIER)
        })
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })
            .map(|base| base.join(IDENTIFIER))
    }
}

/// The data directory beside the exe, when that location can actually hold
/// data. The layout is `dsh-box-files/boot` for the program and
/// `dsh-box-files/data` for everything the user accumulates: replacing the
/// program means replacing `boot`, and `data` is never touched by an upgrade
/// or an uninstall.
///
/// Writability is proved by writing: create the directory and put a probe
/// file inside, because on Windows the only honest answer to "may I write
/// here?" is the attempt itself. An unwritable location (Program Files
/// without elevation) fails the probe and the caller falls back to the
/// per-user app directory.
fn box_beside_exe() -> Option<PathBuf> {
    let exe = plain(std::env::current_exe().ok()?);
    let dir = exe.parent()?;
    let candidate = dir.join(BOX_FOLDER).join("data");
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
