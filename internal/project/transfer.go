package project

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// ExportsDir collects zips exported in desktop mode, under the root. Dot folders are
	// never read as projects.
	ExportsDir = ".exports"
	// stagingPrefix marks a folder an import or copy is still writing; never read as a project.
	stagingPrefix = ".staging-"
	// maxImportBytes bounds what an imported zip may unpack to.
	maxImportBytes = 20 << 30
	maxImportFiles = 200_000
)

// ErrInvalidArchive means an imported file is not a project zip.
var ErrInvalidArchive = errors.New("not a project archive")

// Export writes the project folder (project.json and assets/) as a zip.
func (s *Store) Export(id string, w io.Writer) error {
	dir, err := s.Dir(id)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(w)
	walkErr := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil || rel == "." || d.IsDir() {
			return err
		}
		// Leftovers of an interrupted save are not part of the project.
		if strings.HasSuffix(rel, ".tmp") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(rel)
		header.Method = zip.Deflate
		out, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(out, f)
		return err
	})
	if walkErr != nil {
		_ = zw.Close()
		return fmt.Errorf("export project: %w", walkErr)
	}
	return zw.Close()
}

// ExportToFolder writes the project zip into <root>/.exports and returns its path.
func (s *Store) ExportToFolder(id string) (string, error) {
	doc, err := s.Get(id)
	if err != nil {
		return "", err
	}
	exports := filepath.Join(s.root, ExportsDir)
	if err := os.MkdirAll(exports, 0755); err != nil {
		return "", fmt.Errorf("create exports folder: %w", err)
	}
	target := filepath.Join(exports, fmt.Sprintf("%s-%s.zip", folderName(doc.Name), time.Now().Format("20060102-150405")))
	f, err := os.Create(target)
	if err != nil {
		return "", fmt.Errorf("create export file: %w", err)
	}
	if err := s.Export(id, f); err != nil {
		f.Close()
		_ = os.Remove(target)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(target)
		return "", err
	}
	return target, nil
}

// Import unpacks a project zip into a new project folder. The project gets a
// fresh id (it may be a copy of one already here) and, when the name is taken,
// a numbered name. Nothing is left behind when the zip is not a project.
func (s *Store) Import(r io.ReaderAt, size int64) (*Document, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	prefix, err := archivePrefix(zr.File)
	if err != nil {
		return nil, err
	}

	staging, err := os.MkdirTemp(s.root, stagingPrefix)
	if err != nil {
		return nil, fmt.Errorf("create import folder: %w", err)
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.RemoveAll(staging)
		}
	}()

	var total int64
	for _, f := range zr.File {
		name := strings.TrimPrefix(f.Name, prefix)
		if name == "" || strings.HasSuffix(name, "/") {
			continue
		}
		target, err := safeJoin(staging, name)
		if err != nil {
			return nil, err
		}
		total += int64(f.UncompressedSize64)
		if total > maxImportBytes {
			return nil, fmt.Errorf("%w: too large", ErrInvalidArchive)
		}
		if err := extractFile(f, target); err != nil {
			return nil, err
		}
	}

	doc, err := readDocument(staging)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	return s.adopt(staging, doc, func() { ok = true })
}

// Duplicate copies a project folder into a new project named "<name> 副本".
func (s *Store) Duplicate(id string) (*Document, error) {
	src, err := s.Dir(id)
	if err != nil {
		return nil, err
	}
	staging, err := os.MkdirTemp(s.root, stagingPrefix)
	if err != nil {
		return nil, fmt.Errorf("create copy folder: %w", err)
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.RemoveAll(staging)
		}
	}()
	if err := copyTree(src, staging); err != nil {
		return nil, fmt.Errorf("copy project: %w", err)
	}
	doc, err := readDocument(staging)
	if err != nil {
		return nil, err
	}
	doc.Name = doc.Name + " 副本"
	return s.adopt(staging, doc, func() { ok = true })
}

// adopt turns a staged folder into a project: fresh id, a free name, tasks that
// were still running detached, then the folder moved to its final place.
func (s *Store) adopt(staging string, doc *Document, done func()) (*Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.scanLocked()
	if err != nil {
		return nil, err
	}
	taken := map[string]bool{}
	for _, d := range existing {
		taken[d.Name] = true
	}
	name := strings.TrimSpace(doc.Name)
	if name == "" {
		name = "未命名工程"
	}
	for i := 2; taken[name]; i++ {
		name = fmt.Sprintf("%s (%d)", strings.TrimSpace(doc.Name), i)
	}

	now := time.Now().UTC()
	doc.ID = uuid.New().String()
	doc.Name = name
	doc.Version = documentVersion
	doc.Revision = 1
	doc.CreatedAt = now
	doc.UpdatedAt = now
	doc.Cards = detachPendingTasks(doc.Cards)
	if err := writeDocument(staging, doc); err != nil {
		return nil, err
	}
	dir, err := s.uniqueFolderLocked(folderName(name))
	if err != nil {
		return nil, err
	}
	if err := os.Rename(staging, dir); err != nil {
		return nil, fmt.Errorf("place project folder: %w", err)
	}
	done()
	s.dirs[doc.ID] = dir
	return doc, nil
}

// detachPendingTasks marks cards still waiting on a task as failed: the task belongs to
// the original project, whose folder receives its output, so the copy would never get it.
func detachPendingTasks(raw json.RawMessage) json.RawMessage {
	var cards []map[string]any
	if err := json.Unmarshal(raw, &cards); err != nil {
		return raw
	}
	changed := false
	for _, c := range cards {
		if status, _ := c["status"].(string); status == "queued" || status == "running" {
			c["status"] = "failed"
			c["errorMessage"] = "复制工程时该任务尚未完成，结果只会出现在原工程中"
			delete(c, "taskId")
			changed = true
		}
	}
	if !changed {
		return raw
	}
	out, err := json.Marshal(cards)
	if err != nil {
		return raw
	}
	return out
}

// archivePrefix finds where the project sits in the zip: at the root, or inside one
// top-level folder (a project folder zipped by hand).
func archivePrefix(files []*zip.File) (string, error) {
	if len(files) > maxImportFiles {
		return "", fmt.Errorf("%w: too many files", ErrInvalidArchive)
	}
	for _, f := range files {
		if f.Name == DocumentFile {
			return "", nil
		}
	}
	for _, f := range files {
		dir, file := path.Split(f.Name)
		if file == DocumentFile && strings.Count(dir, "/") == 1 {
			return dir, nil
		}
	}
	return "", fmt.Errorf("%w: no %s", ErrInvalidArchive, DocumentFile)
}

// safeJoin resolves a zip entry inside dir, refusing names that climb out of it.
func safeJoin(dir, name string) (string, error) {
	name = strings.ReplaceAll(name, "\\", "/")
	if path.IsAbs(name) || strings.Contains(name, ":") {
		return "", fmt.Errorf("%w: unsafe path %q", ErrInvalidArchive, name)
	}
	clean := path.Clean(name)
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("%w: unsafe path %q", ErrInvalidArchive, name)
	}
	return filepath.Join(dir, filepath.FromSlash(clean)), nil
}

func extractFile(f *zip.File, target string) error {
	if f.FileInfo().Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("%w: symlink %q", ErrInvalidArchive, f.Name)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	in, err := f.Open()
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	defer in.Close()
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	// The declared size can lie; never write more than it says.
	declared := int64(f.UncompressedSize64)
	n, err := io.Copy(out, io.LimitReader(in, declared+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > declared {
		err = errors.New("entry larger than declared")
	}
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if strings.HasSuffix(rel, ".tmp") || d.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
}
