//go:build !windows

package desktop

import (
	"os/exec"
	"runtime"
)

// OpenFolder shows a directory in the system file manager.
func OpenFolder(dir string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", dir).Start()
	}
	return exec.Command("xdg-open", dir).Start()
}
