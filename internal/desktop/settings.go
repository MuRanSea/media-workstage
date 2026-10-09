// Package desktop holds what the backend needs to know when it runs as the Tauri
// desktop app's sidecar (ADR 0007): the startup settings file the shell reads to
// choose the Data Directory and Projects Root.
package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// RestartExitCode is the exit code the sidecar uses to ask the desktop shell to
// start it again, so changed directory settings take effect.
const RestartExitCode = 75

// Settings is the content of settings.json. An empty directory means the shell's
// default for it.
type Settings struct {
	DataDir     string `json:"data_dir"`
	ProjectsDir string `json:"projects_dir"`
}

// Load reads the settings file; a missing file yields empty (default) settings.
func Load(path string) (Settings, error) {
	var s Settings
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return s, fmt.Errorf("parse %s: %w", path, err)
	}
	return s, nil
}

// Save writes the settings file atomically, so a crash never leaves the shell a
// half-written file to start from.
func Save(path string, s Settings) error {
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// CheckDir accepts an empty value (use the default) or an absolute directory the
// app can create and write to.
func CheckDir(dir string) error {
	if dir == "" {
		return nil
	}
	if !filepath.IsAbs(dir) {
		return fmt.Errorf("%q 不是绝对路径", dir)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("无法创建 %q: %w", dir, err)
	}
	probe, err := os.CreateTemp(dir, ".write-check-*")
	if err != nil {
		return fmt.Errorf("%q 不可写: %w", dir, err)
	}
	name := probe.Name()
	probe.Close()
	os.Remove(name)
	return nil
}

// Mode is present when the backend runs as the desktop sidecar. It carries the
// directories in effect for this run and how to ask the shell for a restart.
type Mode struct {
	SettingsPath string
	DataDir      string
	ProjectsDir  string
	LogsDir      string
	// Restart shuts the backend down so the shell starts it again.
	Restart func()
}
