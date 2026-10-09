package desktop

import "os/exec"

// OpenFolder shows a directory in Explorer.
func OpenFolder(dir string) error {
	return exec.Command("explorer", dir).Start()
}
