//! The backend's stdout and stderr, written to logs/ in the Data Directory with one
//! file per day.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use chrono::Local;

const KEEP_DAYS: u64 = 14;

pub struct LogFile {
    dir: PathBuf,
    current: Mutex<Option<(String, File)>>,
}

impl LogFile {
    pub fn open(dir: &Path) -> std::io::Result<Self> {
        fs::create_dir_all(dir)?;
        prune(dir);
        Ok(Self { dir: dir.to_path_buf(), current: Mutex::new(None) })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn line(&self, text: &str) {
        let now = Local::now();
        let day = now.format("%Y-%m-%d").to_string();
        let mut current = self.current.lock().unwrap();
        if current.as_ref().map(|(d, _)| d != &day).unwrap_or(true) {
            let path = self.dir.join(format!("media-workstage-{day}.log"));
            match OpenOptions::new().create(true).append(true).open(path) {
                Ok(file) => *current = Some((day, file)),
                Err(_) => return,
            }
        }
        if let Some((_, file)) = current.as_mut() {
            let _ = writeln!(file, "{} {}", now.format("%H:%M:%S"), text);
        }
    }
}

fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let cutoff = SystemTime::now() - Duration::from_secs(KEEP_DAYS * 24 * 3600);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("media-workstage-") || !name.ends_with(".log") {
            continue;
        }
        if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
            if modified < cutoff {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}
