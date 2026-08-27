// ⛔ Deliberately NOT `windows_subsystem = "windows"`.
//
// That attribute is the usual way to keep a console from flashing behind a
// desktop app, and it is what this program used to do. The cost only shows up
// from a terminal: a window-subsystem program has no console to write to, and
// neither cmd nor PowerShell waits for one to finish, so `dsh-box status
// --json` hands the prompt back before the answer exists. A single exe cannot
// have it both ways — the subsystem is fixed at link time — and of the two,
// only this one lets the tool be a real command line. The console Windows
// hands us for a double-click is hidden in `lib.rs` instead.
fn main() {
  app_lib::run();
}
