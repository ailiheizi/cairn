package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/api"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

func TestHTTPDownloadFailsBeforeAttachmentForMissingOrCorruptEmptyObject(t *testing.T) {
	for _, damage := range []string{"missing", "tampered"} {
		t.Run(damage, func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			catalog := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
			repoPath := filepath.Join(t.TempDir(), "repository")
			repo, err := repository.OpenDir(repoPath)
			if err != nil {
				t.Fatal(err)
			}
			dispatcher := NewDispatcher(catalog, "catalog.sqlite", "/tmp/rw-download-test.sock",
				WithExact(&exact.Service{Store: catalog, Repo: repo}))
			if err := os.WriteFile(filepath.Join(root, "empty.dat"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			plan := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
			listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{"workspace_id": plan.WorkspaceID}))
			if listed.Status != command.StatusSucceeded {
				t.Fatalf("content.list = %q: %+v", listed.Status, listed.Reasons)
			}
			var contents command.ContentListData
			if err := json.Unmarshal(listed.Data, &contents); err != nil || len(contents.Items) != 1 {
				t.Fatalf("content.list data=%s err=%v", listed.Data, err)
			}
			item := contents.Items[0]
			_, digest, _ := strings.Cut(item.ContentID, ":")
			objectPath := filepath.Join(repoPath, "blobs", "sha256", digest[:2], digest)
			if _, err := os.Stat(objectPath); err != nil {
				t.Fatalf("ingest did not publish its empty exact object at %s: %v", objectPath, err)
			}
			if damage == "missing" {
				if err := os.Remove(objectPath); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(objectPath, []byte("unexpected non-empty bytes"), 0o600); err != nil {
				t.Fatal(err)
			}

			handler := api.Handler(dispatcher.Handle, api.Options{})
			req := httptest.NewRequest(http.MethodGet, "/api/v1/download?workspace_id="+plan.WorkspaceID+"&entry_id="+item.EntryID+"&filename=empty.dat", nil)
			resp := httptest.NewRecorder()
			handler.ServeHTTP(resp, req)
			if resp.Code != http.StatusUnprocessableEntity || resp.Header().Get("Content-Disposition") != "" || strings.Contains(resp.Header().Get("Content-Type"), "octet-stream") {
				t.Fatalf("damaged empty object returned status=%d headers=%v body=%s", resp.Code, resp.Header(), resp.Body.String())
			}
			if dispatcher.sessions == nil || dispatcher.sessions.len() != 0 {
				t.Fatalf("failed open left a live content session: %+v", dispatcher.sessions)
			}
		})
	}
}
