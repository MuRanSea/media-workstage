//! Runs the Go backend as a child process and keeps the window pointed at it:
//! start, wait for its LISTENING line, navigate, and start again when it exits
//! asking for a restart. A start that fails offers to go back to the default
//! directories, so a bad setting can never lock the user out.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::logfile::LogFile;
use crate::settings::{Dirs, Paths};

/// Exit code the backend uses to ask for a restart (internal/desktop.RestartExitCode).
const RESTART_EXIT_CODE: i32 = 75;
const START_TIMEOUT: Duration = Duration::from_secs(30);
const SIDECAR_NAME: &str = "media-workstage-server.exe";

struct Backend {
    child: Mutex<Option<Child>>,
    exiting: AtomicBool,
    #[cfg(windows)]
    job: Option<win32job::Job>,
}

pub fn start(app: AppHandle, paths: Paths, port: Arc<AtomicU16>) {
    app.manage(Backend {
        child: Mutex::new(None),
        exiting: AtomicBool::new(false),
        #[cfg(windows)]
        job: kill_on_close_job(),
    });
    thread::spawn(move || supervise(app, paths, port));
}

/// Called when the app exits: the backend goes with it.
pub fn shutdown(app: &AppHandle) {
    let Some(backend) = app.try_state::<Backend>() else { return };
    backend.exiting.store(true, Ordering::SeqCst);
    let child = backend.child.lock().unwrap().take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn supervise(app: AppHandle, paths: Paths, port: Arc<AtomicU16>) {
    loop {
        let (saved, dirs) = paths.load();
        let log = open_log(&dirs, &paths);

        let failure = match launch(&app, &paths, &dirs, log.as_ref()) {
            Ok(listening) => {
                port.store(listening, Ordering::SeqCst);
                navigate(&app, &format!("http://127.0.0.1:{listening}/"));
                let code = wait_for_exit(&app);
                port.store(0, Ordering::SeqCst);
                if exiting(&app) {
                    return;
                }
                navigate(&app, crate::SPLASH_URL);
                if code == Some(RESTART_EXIT_CODE) {
                    continue;
                }
                format!("后台服务意外退出（退出码 {}）。", describe_code(code))
            }
            Err(message) => message,
        };
        if exiting(&app) {
            return;
        }

        let logs_dir = log.as_ref().map(|l| l.dir().display().to_string()).unwrap_or_default();
        let detail = format!(
            "{failure}\n\n数据目录：{}\n工程目录：{}\n日志目录：{logs_dir}",
            dirs.data.display(),
            dirs.projects.display()
        );
        let retry_label = if saved.is_default() { "重试" } else { "恢复默认目录后重试" };
        let retry = app
            .dialog()
            .message(detail)
            .title("Media Workstage 无法启动")
            .kind(MessageDialogKind::Error)
            .buttons(MessageDialogButtons::OkCancelCustom(retry_label.into(), "退出".into()))
            .blocking_show();
        if !retry {
            app.exit(1);
            return;
        }
        if !saved.is_default() {
            if let Err(err) = paths.reset() {
                if let Some(log) = &log {
                    log.line(&format!("[shell] could not reset settings: {err}"));
                }
            }
        }
    }
}

/// Logs go to the Data Directory; when that is the thing that is broken, to the
/// default one so the failure is still recorded.
fn open_log(dirs: &Dirs, paths: &Paths) -> Option<Arc<LogFile>> {
    LogFile::open(&dirs.logs())
        .or_else(|_| LogFile::open(&paths.default_data.join("logs")))
        .ok()
        .map(Arc::new)
}

/// Starts the backend and waits for the port it announces.
fn launch(app: &AppHandle, paths: &Paths, dirs: &Dirs, log: Option<&Arc<LogFile>>) -> Result<u16, String> {
    let sidecar = sidecar_path().map_err(|e| format!("找不到后台服务程序：{e}"))?;
    let mut cmd = Command::new(&sidecar);
    cmd.arg("--settings")
        .arg(&paths.settings_file)
        .arg("--data-dir")
        .arg(&dirs.data)
        .arg("--projects")
        .arg(&dirs.projects)
        .arg("--port")
        .arg(pick_port(paths).to_string())
        .arg("--no-browser")
        .env("GIN_MODE", "release")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("无法启动后台服务 {}：{e}", sidecar.display()))?;

    #[cfg(windows)]
    if let Some(job) = &app.state::<Backend>().job {
        use std::os::windows::io::AsRawHandle;
        let _ = job.assign_process(child.as_raw_handle() as isize);
    }

    let (port_tx, port_rx) = mpsc::channel();
    let recent = Arc::new(Mutex::new(VecDeque::new()));
    pipe(child.stdout.take(), log.cloned(), recent.clone(), Some(port_tx));
    pipe(child.stderr.take(), log.cloned(), recent.clone(), None);

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if let Ok(port) = port_rx.recv_timeout(Duration::from_millis(100)) {
            *app.state::<Backend>().child.lock().unwrap() = Some(child);
            let _ = std::fs::write(last_port_file(paths), port.to_string());
            return Ok(port);
        }
        if let Ok(Some(status)) = child.try_wait() {
            // Give the pipes a moment to flush the last lines of output.
            thread::sleep(Duration::from_millis(200));
            return Err(format!(
                "后台服务启动失败（退出码 {}）。\n\n{}",
                describe_code(status.code()),
                tail(&recent)
            ));
        }
        if Instant::now() > deadline || exiting(app) {
            let _ = child.kill();
            return Err(format!("后台服务在 {} 秒内没有就绪。\n\n{}", START_TIMEOUT.as_secs(), tail(&recent)));
        }
    }
}

/// Copies one output stream into the log, keeping the last lines for error
/// dialogs and reporting the LISTENING line on stdout.
fn pipe<R: Read + Send + 'static>(
    stream: Option<R>,
    log: Option<Arc<LogFile>>,
    recent: Arc<Mutex<VecDeque<String>>>,
    port_tx: Option<mpsc::Sender<u16>>,
) {
    let Some(stream) = stream else { return };
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            if let Some(log) = &log {
                log.line(&line);
            }
            if let (Some(tx), Some(port)) = (&port_tx, line.strip_prefix("LISTENING ")) {
                if let Ok(port) = port.trim().parse() {
                    let _ = tx.send(port);
                }
            }
            let mut recent = recent.lock().unwrap();
            recent.push_back(line);
            if recent.len() > 6 {
                recent.pop_front();
            }
        }
    });
}

/// The page's origin includes the port, and so does its localStorage (theme,
/// last-used provider). Reuse the last port when it is free so those survive a
/// restart; otherwise let the backend take any free port.
fn pick_port(paths: &Paths) -> u16 {
    let last = std::fs::read_to_string(last_port_file(paths))
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|&p| p != 0);
    match last {
        Some(port) if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() => port,
        _ => 0,
    }
}

fn last_port_file(paths: &Paths) -> PathBuf {
    paths.default_data.join("last-port")
}

fn wait_for_exit(app: &AppHandle) -> Option<i32> {
    let backend = app.state::<Backend>();
    loop {
        {
            let mut guard = backend.child.lock().unwrap();
            match guard.as_mut() {
                None => return None,
                Some(child) => {
                    if let Ok(Some(status)) = child.try_wait() {
                        guard.take();
                        return status.code();
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(300));
    }
}

fn navigate(app: &AppHandle, url: &str) {
    if let (Some(window), Ok(url)) = (app.get_webview_window("main"), Url::parse(url)) {
        let _ = window.navigate(url);
    }
}

fn exiting(app: &AppHandle) -> bool {
    app.state::<Backend>().exiting.load(Ordering::SeqCst)
}

fn sidecar_path() -> std::io::Result<PathBuf> {
    let path = std::env::current_exe()?.with_file_name(SIDECAR_NAME);
    if path.exists() {
        Ok(path)
    } else {
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, path.display().to_string()))
    }
}

fn describe_code(code: Option<i32>) -> String {
    code.map(|c| c.to_string()).unwrap_or_else(|| "未知".into())
}

fn tail(recent: &Mutex<VecDeque<String>>) -> String {
    recent.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n")
}

/// A job object that kills the backend when the shell's last handle to it closes,
/// so a crashed shell never leaves a backend holding the database.
#[cfg(windows)]
fn kill_on_close_job() -> Option<win32job::Job> {
    let job = win32job::Job::create().ok()?;
    let mut info = job.query_extended_limit_info().ok()?;
    info.limit_kill_on_job_close();
    job.set_extended_limit_info(&mut info).ok()?;
    Some(job)
}
