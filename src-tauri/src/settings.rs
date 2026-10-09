//! settings.json: the startup file that picks the Data Directory and Projects Root.
//! The Go backend writes it from the settings page; the shell reads it before each
//! start. An empty value means the default.

use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub data_dir: String,
    #[serde(default)]
    pub projects_dir: String,
}

impl Settings {
    pub fn is_default(&self) -> bool {
        self.data_dir.trim().is_empty() && self.projects_dir.trim().is_empty()
    }
}

/// The directories one backend run uses.
pub struct Dirs {
    pub data: PathBuf,
    pub projects: PathBuf,
}

impl Dirs {
    pub fn logs(&self) -> PathBuf {
        self.data.join("logs")
    }
}

pub struct Paths {
    pub settings_file: PathBuf,
    pub default_data: PathBuf,
    pub default_projects: PathBuf,
}

impl Paths {
    pub fn resolve(app: &AppHandle) -> tauri::Result<Self> {
        let default_data = app.path().local_data_dir()?.join("media-workstage");
        Ok(Self {
            settings_file: default_data.join("settings.json"),
            default_projects: app.path().document_dir()?.join("Media Workstage").join("projects"),
            default_data,
        })
    }

    /// A missing or unreadable file falls back to the defaults.
    pub fn load(&self) -> (Settings, Dirs) {
        let saved: Settings = fs::read_to_string(&self.settings_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let pick = |value: &str, default: &PathBuf| {
            if value.trim().is_empty() {
                default.clone()
            } else {
                PathBuf::from(value.trim())
            }
        };
        let dirs = Dirs {
            data: pick(&saved.data_dir, &self.default_data),
            projects: pick(&saved.projects_dir, &self.default_projects),
        };
        (saved, dirs)
    }

    /// Back to the default directories, for a start that failed on custom ones.
    pub fn reset(&self) -> io::Result<()> {
        fs::create_dir_all(&self.default_data)?;
        let raw = serde_json::to_string_pretty(&Settings::default()).map_err(io::Error::other)?;
        fs::write(&self.settings_file, raw)
    }
}
