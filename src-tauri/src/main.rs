// Media Workstage desktop shell (ADR 0007): starts the Go backend as a sidecar and
// shows the page it serves. No business logic lives here.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod logfile;
mod settings;

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Where the splash page lives inside the webview on Windows.
pub const SPLASH_URL: &str = "http://tauri.localhost/index.html";

fn main() {
    let app = tauri::Builder::default()
        // Two backends on one database and one Projects Root would fight over
        // project.json revisions, so a second launch just raises the first window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = settings::Paths::resolve(app.handle())?;
            let port = Arc::new(AtomicU16::new(0));
            build_window(app.handle(), port.clone())?;
            backend::start(app.handle().clone(), paths, port);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Media Workstage");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            backend::shutdown(app);
        }
    });
}

fn build_window(app: &AppHandle, port: Arc<AtomicU16>) -> tauri::Result<()> {
    let nav_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Media Workstage")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .maximized(true)
        // Let file drops reach the page's own HTML5 drop handlers (Upload Cards).
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if is_internal(url, port.load(Ordering::SeqCst)) {
                return true;
            }
            open_external(&nav_app, url);
            false
        })
        // target="_blank" links open in the system browser, never a bare webview window.
        .on_new_window(move |url, _features| {
            open_external(&popup_app, &url);
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

/// The splash page and the running backend stay in the window; everything else
/// is someone else's site.
fn is_internal(url: &Url, backend_port: u16) -> bool {
    match url.scheme() {
        "about" | "data" | "blob" | "tauri" => return true,
        _ => {}
    }
    match url.host_str() {
        Some("tauri.localhost") => true,
        Some("127.0.0.1") => backend_port != 0 && url.port() == Some(backend_port),
        _ => false,
    }
}

fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}
