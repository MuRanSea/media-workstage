// Package project persists canvas projects as self-contained folders on disk.
//
// Each project lives in <root>/<folder>/ with a project.json document and an
// assets/ tree holding the media its tasks produced, so a folder can be copied
// or moved as a unit. Deleted projects are moved to <root>/.trash/.
package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
)

const (
	// DocumentFile is the project document inside each project folder.
	DocumentFile = "project.json"
	// AssetsDir is the project-relative folder generated media is written to.
	AssetsDir = "assets"
	// TrashDir collects deleted projects under the root.
	TrashDir = ".trash"

	documentVersion = 1
	maxFolderRunes  = 60
)

var (
	ErrNotFound = errors.New("project not found")
	// ErrConflict means the save was based on a stale revision (another tab saved first).
	ErrConflict = errors.New("project was modified elsewhere")
)

// Viewport is the canvas transform saved with a project.
type Viewport struct {
	Zoom float64 `json:"zoom"`
	PanX float64 `json:"panX"`
	PanY float64 `json:"panY"`
}

// Document is the on-disk project.json. Cards are opaque to the backend: the
// frontend owns their shape.
type Document struct {
	Version   int             `json:"version"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
	Revision  int64           `json:"revision"`
	Viewport  Viewport        `json:"viewport"`
	Cards     json.RawMessage `json:"cards"`
}

// Summary is a project list entry.
type Summary struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Dir        string         `json:"dir"`
	CreatedAt  time.Time      `json:"createdAt"`
	UpdatedAt  time.Time      `json:"updatedAt"`
	CardCounts map[string]int `json:"cardCounts"`
}

// Store manages the project folders under one root directory.
type Store struct {
	root string
	mu   sync.Mutex
	dirs map[string]string // project id -> absolute folder path
}

// NewStore creates the root directory if needed and indexes existing projects.
func NewStore(root string) (*Store, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve projects root %s: %w", root, err)
	}
	if err := os.MkdirAll(abs, 0755); err != nil {
		return nil, fmt.Errorf("create projects root %s: %w", abs, err)
	}
	s := &Store{root: abs, dirs: map[string]string{}}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.scanLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

// Root returns the absolute projects root.
func (s *Store) Root() string { return s.root }

// List rescans the root and returns projects, most recently updated first.
func (s *Store) List() ([]Summary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	docs, err := s.scanLocked()
	if err != nil {
		return nil, err
	}
	out := make([]Summary, 0, len(docs))
	for _, d := range docs {
		out = append(out, Summary{
			ID:         d.ID,
			Name:       d.Name,
			Dir:        s.dirs[d.ID],
			CreatedAt:  d.CreatedAt,
			UpdatedAt:  d.UpdatedAt,
			CardCounts: countCards(d.Cards),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

// Create makes a new empty project folder named after the project.
func (s *Store) Create(name string) (*Document, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "未命名工程"
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	dir, err := s.uniqueFolderLocked(folderName(name))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dir, AssetsDir), 0755); err != nil {
		return nil, fmt.Errorf("create project folder: %w", err)
	}
	now := time.Now().UTC()
	doc := &Document{
		Version:   documentVersion,
		ID:        uuid.New().String(),
		Name:      name,
		CreatedAt: now,
		UpdatedAt: now,
		Revision:  1,
		Viewport:  Viewport{Zoom: 0.85, PanX: 60, PanY: 40},
		Cards:     json.RawMessage("[]"),
	}
	if err := writeDocument(dir, doc); err != nil {
		return nil, err
	}
	s.dirs[doc.ID] = dir
	return doc, nil
}

// Get reads a project document.
func (s *Store) Get(id string) (*Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.dirLocked(id)
	if err != nil {
		return nil, err
	}
	return readDocument(dir)
}

// Save replaces the canvas state. baseRevision must match the stored revision,
// otherwise ErrConflict is returned and nothing is written.
func (s *Store) Save(id string, baseRevision int64, viewport Viewport, cards json.RawMessage) (*Document, error) {
	if !isJSONArray(cards) {
		return nil, errors.New("cards must be a JSON array")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.dirLocked(id)
	if err != nil {
		return nil, err
	}
	doc, err := readDocument(dir)
	if err != nil {
		return nil, err
	}
	if doc.Revision != baseRevision {
		return doc, ErrConflict
	}
	doc.Viewport = viewport
	doc.Cards = cards
	doc.Revision++
	doc.UpdatedAt = time.Now().UTC()
	if err := writeDocument(dir, doc); err != nil {
		return nil, err
	}
	return doc, nil
}

// Rename changes the display name. The folder keeps its name so paths of
// in-flight downloads stay valid. The revision is left alone so an open
// canvas can keep autosaving.
func (s *Store) Rename(id, name string) (*Document, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("name cannot be empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.dirLocked(id)
	if err != nil {
		return nil, err
	}
	doc, err := readDocument(dir)
	if err != nil {
		return nil, err
	}
	doc.Name = name
	doc.UpdatedAt = time.Now().UTC()
	if err := writeDocument(dir, doc); err != nil {
		return nil, err
	}
	return doc, nil
}

// Delete moves the project folder into <root>/.trash/.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.dirLocked(id)
	if err != nil {
		return err
	}
	trash := filepath.Join(s.root, TrashDir)
	if err := os.MkdirAll(trash, 0755); err != nil {
		return fmt.Errorf("create trash folder: %w", err)
	}
	target := filepath.Join(trash, fmt.Sprintf("%s-%s", filepath.Base(dir), time.Now().Format("20060102-150405")))
	if err := os.Rename(dir, target); err != nil {
		return fmt.Errorf("move project to trash: %w", err)
	}
	delete(s.dirs, id)
	return nil
}

// Dir returns the absolute folder of a project.
func (s *Store) Dir(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dirLocked(id)
}

// AssetRoot returns the project's assets folder, or "" when projectID is empty
// or unknown. The poller uses it as the per-task download root.
func (s *Store) AssetRoot(projectID string) string {
	if projectID == "" {
		return ""
	}
	dir, err := s.Dir(projectID)
	if err != nil {
		return ""
	}
	return filepath.Join(dir, AssetsDir)
}

// dirLocked resolves an id, rescanning once in case the folder appeared or moved.
func (s *Store) dirLocked(id string) (string, error) {
	if id == "" {
		return "", ErrNotFound
	}
	if dir, ok := s.dirs[id]; ok {
		if _, err := os.Stat(filepath.Join(dir, DocumentFile)); err == nil {
			return dir, nil
		}
	}
	if _, err := s.scanLocked(); err != nil {
		return "", err
	}
	if dir, ok := s.dirs[id]; ok {
		return dir, nil
	}
	return "", ErrNotFound
}

// scanLocked rebuilds the id index from disk. A copied folder carries its
// source's id; the later folder (by name) gets a fresh id written back.
func (s *Store) scanLocked() ([]*Document, error) {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, fmt.Errorf("read projects root: %w", err)
	}
	dirs := map[string]string{}
	var docs []*Document
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dir := filepath.Join(s.root, e.Name())
		doc, err := readDocument(dir)
		if err != nil {
			continue // not a project folder, or unreadable; skip rather than fail the whole list
		}
		if _, taken := dirs[doc.ID]; taken || doc.ID == "" {
			doc.ID = uuid.New().String()
			if err := writeDocument(dir, doc); err != nil {
				continue
			}
		}
		dirs[doc.ID] = dir
		docs = append(docs, doc)
	}
	s.dirs = dirs
	return docs, nil
}

func (s *Store) uniqueFolderLocked(base string) (string, error) {
	for i := 1; i < 1000; i++ {
		candidate := base
		if i > 1 {
			candidate = fmt.Sprintf("%s-%d", base, i)
		}
		dir := filepath.Join(s.root, candidate)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			return dir, nil
		}
	}
	return "", errors.New("could not find a free folder name")
}

func readDocument(dir string) (*Document, error) {
	data, err := os.ReadFile(filepath.Join(dir, DocumentFile))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var doc Document
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse %s: %w", filepath.Join(dir, DocumentFile), err)
	}
	if !isJSONArray(doc.Cards) {
		doc.Cards = json.RawMessage("[]")
	}
	if doc.Name == "" {
		doc.Name = filepath.Base(dir)
	}
	return &doc, nil
}

// writeDocument writes via a temp file + rename so a crash never leaves a half-written project.json.
func writeDocument(dir string, doc *Document) error {
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	target := filepath.Join(dir, DocumentFile)
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return fmt.Errorf("write project document: %w", err)
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace project document: %w", err)
	}
	return nil
}

func isJSONArray(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return strings.HasPrefix(trimmed, "[") && json.Valid(raw)
}

func countCards(raw json.RawMessage) map[string]int {
	counts := map[string]int{}
	var cards []struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &cards); err != nil {
		return counts
	}
	for _, c := range cards {
		counts[c.Type]++
	}
	return counts
}

var reservedWindowsNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// folderName turns a display name into a portable folder name (CJK kept).
func folderName(name string) string {
	var b strings.Builder
	for _, r := range name {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteRune('-')
			continue
		}
		b.WriteRune(r)
	}
	out := strings.Trim(b.String(), " .")
	if runes := []rune(out); len(runes) > maxFolderRunes {
		out = strings.TrimRight(string(runes[:maxFolderRunes]), " .")
	}
	if out == "" || strings.HasPrefix(out, ".") {
		out = "project" + out
	}
	if reservedWindowsNames[strings.ToUpper(out)] {
		out += "-project"
	}
	return out
}
