package project

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// projectWithAsset creates a project holding one card and one asset file.
func projectWithAsset(t *testing.T, s *Store, name string, cards string) *Document {
	t.Helper()
	doc, err := s.Create(name)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Save(doc.ID, doc.Revision, Viewport{Zoom: 1}, json.RawMessage(cards), json.RawMessage(`[{"id":"s1","title":"区"}]`)); err != nil {
		t.Fatalf("Save: %v", err)
	}
	dir, _ := s.Dir(doc.ID)
	asset := filepath.Join(dir, "assets", "images", "t1", "base.png")
	if err := os.MkdirAll(filepath.Dir(asset), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, []byte("png-bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(doc.ID)
	return got
}

func exportBytes(t *testing.T, s *Store, id string) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := s.Export(id, &buf); err != nil {
		t.Fatalf("Export: %v", err)
	}
	return buf.Bytes()
}

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// stagingLeftovers lists unfinished import or copy folders under the root.
func stagingLeftovers(t *testing.T, s *Store) []string {
	t.Helper()
	entries, _ := os.ReadDir(s.Root())
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), stagingPrefix) {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestTransfer_ExportImportRoundTrip(t *testing.T) {
	s := newTestStore(t)
	src := projectWithAsset(t, s, "短片", `[{"id":"c1","type":"image","resultUrl":"assets/images/t1/base.png"}]`)

	data := exportBytes(t, s, src.ID)
	imported, err := s.Import(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	if imported.ID == src.ID {
		t.Fatal("imported project kept the original id")
	}
	if imported.Name != "短片 (2)" {
		t.Fatalf("expected a numbered name for the clash, got %q", imported.Name)
	}
	if imported.Revision != 1 {
		t.Fatalf("expected a fresh revision, got %d", imported.Revision)
	}
	dir, err := s.Dir(imported.ID)
	if err != nil {
		t.Fatalf("Dir: %v", err)
	}
	asset, err := os.ReadFile(filepath.Join(dir, "assets", "images", "t1", "base.png"))
	if err != nil || string(asset) != "png-bytes" {
		t.Fatalf("asset not carried over: %v %q", err, asset)
	}
	got, _ := s.Get(imported.ID)
	if !strings.Contains(string(got.Cards), "assets/images/t1/base.png") || !strings.Contains(string(got.Sections), "s1") {
		t.Fatalf("cards or sections lost: %s %s", got.Cards, got.Sections)
	}
	// The original is untouched.
	orig, _ := s.Get(src.ID)
	if orig.Name != "短片" {
		t.Fatalf("original changed: %+v", orig)
	}
	list, _ := s.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(list))
	}
}

func TestTransfer_ImportFolderZippedByHand(t *testing.T) {
	s := newTestStore(t)
	data := zipOf(t, map[string]string{
		"我的工程/project.json":         `{"id":"x","name":"手动打包","cards":[]}`,
		"我的工程/assets/uploads/a.png": "a",
	})
	doc, err := s.Import(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	dir, _ := s.Dir(doc.ID)
	if _, err := os.Stat(filepath.Join(dir, "assets", "uploads", "a.png")); err != nil {
		t.Fatalf("asset missing: %v", err)
	}
}

func TestTransfer_ImportRejectsBadArchives(t *testing.T) {
	cases := map[string][]byte{
		"not a zip":       []byte("hello"),
		"no project":      zipOf(t, map[string]string{"readme.txt": "x"}),
		"bad json":        zipOf(t, map[string]string{"project.json": "{"}),
		"climbs out":      zipOf(t, map[string]string{"project.json": `{"name":"x"}`, "../evil.txt": "x"}),
		"climbs out (\\)": zipOf(t, map[string]string{"project.json": `{"name":"x"}`, "assets\\..\\..\\evil.txt": "x"}),
		"absolute":        zipOf(t, map[string]string{"project.json": `{"name":"x"}`, "/etc/evil": "x"}),
		"drive letter":    zipOf(t, map[string]string{"project.json": `{"name":"x"}`, "C:/evil": "x"}),
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			s := newTestStore(t)
			if _, err := s.Import(bytes.NewReader(data), int64(len(data))); !errors.Is(err, ErrInvalidArchive) {
				t.Fatalf("expected ErrInvalidArchive, got %v", err)
			}
			if left := stagingLeftovers(t, s); len(left) != 0 {
				t.Fatalf("left behind: %v", left)
			}
			if _, err := os.Stat(filepath.Join(filepath.Dir(s.Root()), "evil.txt")); err == nil {
				t.Fatal("wrote outside the projects root")
			}
			list, _ := s.List()
			if len(list) != 0 {
				t.Fatalf("a project appeared: %+v", list)
			}
		})
	}
}

func TestTransfer_PendingTasksAreDetached(t *testing.T) {
	s := newTestStore(t)
	src := projectWithAsset(t, s, "p", `[{"id":"done","status":"succeeded","taskId":"t1"},{"id":"run","status":"running","taskId":"t2"},{"id":"q","status":"queued","taskId":"t3"}]`)
	copyDoc, err := s.Duplicate(src.ID)
	if err != nil {
		t.Fatalf("Duplicate: %v", err)
	}
	var cards []map[string]any
	_ = json.Unmarshal(copyDoc.Cards, &cards)
	for _, c := range cards {
		switch c["id"] {
		case "done":
			if c["taskId"] != "t1" || c["status"] != "succeeded" {
				t.Fatalf("finished card changed: %v", c)
			}
		default:
			if c["status"] != "failed" || c["taskId"] != nil || c["errorMessage"] == nil {
				t.Fatalf("pending card not detached: %v", c)
			}
		}
	}
	// The original still waits on its tasks.
	orig, _ := s.Get(src.ID)
	if !strings.Contains(string(orig.Cards), `"t2"`) {
		t.Fatalf("original lost its task: %s", orig.Cards)
	}
}

func TestTransfer_DuplicateIsIndependent(t *testing.T) {
	s := newTestStore(t)
	src := projectWithAsset(t, s, "原片", `[]`)
	copyDoc, err := s.Duplicate(src.ID)
	if err != nil {
		t.Fatalf("Duplicate: %v", err)
	}
	if copyDoc.Name != "原片 副本" || copyDoc.ID == src.ID {
		t.Fatalf("unexpected copy: %+v", copyDoc)
	}
	srcDir, _ := s.Dir(src.ID)
	copyDir, _ := s.Dir(copyDoc.ID)
	if srcDir == copyDir {
		t.Fatal("copy shares the folder")
	}
	if err := os.WriteFile(filepath.Join(copyDir, "assets", "images", "t1", "base.png"), []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(srcDir, "assets", "images", "t1", "base.png"))
	if string(b) != "png-bytes" {
		t.Fatal("editing the copy changed the original")
	}
	if s.AssetRoot(copyDoc.ID) != filepath.Join(copyDir, AssetsDir) {
		t.Fatal("copy's tasks would not write into the copy")
	}
	// A second copy gets a numbered name.
	second, _ := s.Duplicate(src.ID)
	if second.Name != "原片 副本 (2)" {
		t.Fatalf("expected a numbered name, got %q", second.Name)
	}
	if left := stagingLeftovers(t, s); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}

func TestTransfer_ExportToFolder(t *testing.T) {
	s := newTestStore(t)
	src := projectWithAsset(t, s, "导出", `[]`)
	p, err := s.ExportToFolder(src.ID)
	if err != nil {
		t.Fatalf("ExportToFolder: %v", err)
	}
	if filepath.Dir(p) != filepath.Join(s.Root(), ExportsDir) || !strings.HasSuffix(p, ".zip") {
		t.Fatalf("unexpected path %s", p)
	}
	data, _ := os.ReadFile(p)
	if _, err := zip.NewReader(bytes.NewReader(data), int64(len(data))); err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	// The exports folder is not read as a project.
	list, _ := s.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 project, got %d", len(list))
	}
}
