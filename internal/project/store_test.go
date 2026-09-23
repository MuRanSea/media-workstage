package project

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return s
}

func TestStore_CreateGetAndList(t *testing.T) {
	s := newTestStore(t)

	doc, err := s.Create("分镜 A")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if doc.ID == "" || doc.Revision != 1 || string(doc.Cards) != "[]" {
		t.Fatalf("unexpected new document: %+v", doc)
	}
	dir, err := s.Dir(doc.ID)
	if err != nil {
		t.Fatalf("Dir: %v", err)
	}
	if filepath.Base(dir) != "分镜 A" {
		t.Fatalf("expected folder named after project, got %s", dir)
	}
	if _, err := os.Stat(filepath.Join(dir, AssetsDir)); err != nil {
		t.Fatalf("expected assets folder: %v", err)
	}

	got, err := s.Get(doc.ID)
	if err != nil || got.Name != "分镜 A" {
		t.Fatalf("Get: %+v, %v", got, err)
	}

	list, err := s.List()
	if err != nil || len(list) != 1 || list[0].ID != doc.ID {
		t.Fatalf("List: %+v, %v", list, err)
	}
}

func TestStore_CreateDedupesAndSanitizesFolderNames(t *testing.T) {
	s := newTestStore(t)
	a, _ := s.Create("a/b:c")
	b, _ := s.Create("a/b:c")
	dirA, _ := s.Dir(a.ID)
	dirB, _ := s.Dir(b.ID)
	if filepath.Base(dirA) != "a-b-c" || filepath.Base(dirB) != "a-b-c-2" {
		t.Fatalf("unexpected folders %s, %s", dirA, dirB)
	}
	con, _ := s.Create("con")
	dirCon, _ := s.Dir(con.ID)
	if filepath.Base(dirCon) != "con-project" {
		t.Fatalf("reserved name not escaped: %s", dirCon)
	}
}

func TestStore_SaveBumpsRevisionAndDetectsConflict(t *testing.T) {
	s := newTestStore(t)
	doc, _ := s.Create("p")
	cards := json.RawMessage(`[{"id":"c1","type":"image"},{"id":"c2","type":"video"}]`)

	saved, err := s.Save(doc.ID, 1, Viewport{Zoom: 1.2, PanX: 5, PanY: 6}, cards)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if saved.Revision != 2 || saved.Viewport.Zoom != 1.2 {
		t.Fatalf("unexpected saved doc: %+v", saved)
	}

	// A second tab still holding revision 1 must not overwrite.
	if _, err := s.Save(doc.ID, 1, Viewport{}, json.RawMessage(`[]`)); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
	got, _ := s.Get(doc.ID)
	if got.Revision != 2 {
		t.Fatalf("conflicting save changed the document: %+v", got)
	}

	list, _ := s.List()
	if list[0].CardCounts["image"] != 1 || list[0].CardCounts["video"] != 1 {
		t.Fatalf("unexpected card counts: %+v", list[0].CardCounts)
	}

	if _, err := s.Save(doc.ID, 2, Viewport{}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("expected non-array cards to be rejected")
	}
}

func TestStore_RenameKeepsFolderAndRevision(t *testing.T) {
	s := newTestStore(t)
	doc, _ := s.Create("old")
	dirBefore, _ := s.Dir(doc.ID)

	renamed, err := s.Rename(doc.ID, "new")
	if err != nil {
		t.Fatalf("Rename: %v", err)
	}
	dirAfter, _ := s.Dir(doc.ID)
	if renamed.Name != "new" || renamed.Revision != doc.Revision || dirAfter != dirBefore {
		t.Fatalf("unexpected rename result: %+v in %s", renamed, dirAfter)
	}
}

func TestStore_CopiedFolderGetsFreshID(t *testing.T) {
	s := newTestStore(t)
	doc, _ := s.Create("orig")
	dir, _ := s.Dir(doc.ID)

	copyDir := filepath.Join(s.Root(), "orig-copy")
	if err := os.MkdirAll(copyDir, 0755); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(dir, DocumentFile))
	if err := os.WriteFile(filepath.Join(copyDir, DocumentFile), data, 0644); err != nil {
		t.Fatal(err)
	}

	list, err := s.List()
	if err != nil || len(list) != 2 {
		t.Fatalf("List: %+v, %v", list, err)
	}
	if list[0].ID == list[1].ID {
		t.Fatal("copied project kept a duplicate id")
	}
	if got, _ := s.Dir(doc.ID); got != dir {
		t.Fatalf("original project lost its id: %s", got)
	}
}

func TestStore_DeleteMovesToTrash(t *testing.T) {
	s := newTestStore(t)
	doc, _ := s.Create("gone")

	if err := s.Delete(doc.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Get(doc.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
	trashed, _ := os.ReadDir(filepath.Join(s.Root(), TrashDir))
	if len(trashed) != 1 {
		t.Fatalf("expected one trashed folder, got %d", len(trashed))
	}
	if list, _ := s.List(); len(list) != 0 {
		t.Fatalf("trash must not be listed: %+v", list)
	}
}
