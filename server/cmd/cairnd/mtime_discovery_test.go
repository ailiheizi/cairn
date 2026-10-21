package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	cairnconfig "github.com/ailiheizi/cairn/config"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestRealDaemonCapturedModificationTimeDrivesContentAndSearch(t *testing.T) {
	if search.CurrentLexicalProfile != search.LexicalProfileV5 {
		t.Fatalf("current lexical profile = %q, want captured-time profile %q", search.CurrentLexicalProfile, search.LexicalProfileV5)
	}
	workspaceRoot := testWorkspaceRoot(t)
	binDir := t.TempDir()
	daemonBin := buildTestBinary(t, workspaceRoot, "./server/cmd/cairnd", filepath.Join(binDir, "cairnd"))
	cairnBin := buildTestBinary(t, workspaceRoot, "./client/cmd/cairn", filepath.Join(binDir, "cairn"))

	root := t.TempDir()
	dataHome := filepath.Join(root, "xdg-data")
	source := filepath.Join(root, "source")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	olderBody := []byte("captured-time discovery older payload")
	newerBody := []byte("captured-time discovery newer payload")
	olderTime := time.Date(2020, time.March, 4, 5, 6, 7, 0, time.UTC)
	newerTime := time.Date(2024, time.August, 9, 10, 11, 12, 0, time.UTC)
	for _, item := range []struct {
		name string
		body []byte
		when time.Time
	}{
		{name: "captured-older.bin", body: olderBody, when: olderTime},
		{name: "captured-newer.bin", body: newerBody, when: newerTime},
	} {
		path := filepath.Join(source, item.name)
		if err := os.WriteFile(path, item.body, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, item.when, item.when); err != nil {
			t.Fatal(err)
		}
	}

	configPath := filepath.Join(root, "config", "config.toml")
	cliEnv := append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	initConfig := exec.Command(cairnBin, "config", "init", "--path", configPath)
	initConfig.Env = cliEnv
	if output, err := initConfig.CombinedOutput(); err != nil {
		t.Fatalf("cairn config init: %v\n%s", err, output)
	}
	cfg, err := cairnconfig.LoadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Storage.RepositoryProfile = cairnconfig.RepositoryProfileLocalZstdV1
	cfg.Storage.CompressionProfile = cairnconfig.CompressionProfileZstdV1
	if err := cairnconfig.Save(configPath, cfg); err != nil {
		t.Fatalf("persist test config: %v", err)
	}
	socketPath := fmt.Sprintf("/tmp/cairn-captured-mtime-%d-%d.sock", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	daemon, daemonDone, daemonLog := startDaemonProcessWithEnv(t, cliEnv, daemonBin, socketPath, "--config", configPath)
	defer stopDaemonProcess(t, daemon, daemonDone, daemonLog)
	waitForCLI(t, cairnBin, socketPath, daemonDone, daemonLog, "status")

	planned := runRWProcess(t, cairnBin, socketPath, "ingest", source)
	var plan command.PlanIngestData
	decodeProcessResult(t, planned, &plan)
	if plan.State != "READY" || !plan.Executable || plan.Files != 2 {
		t.Fatalf("ingest plan = %+v, want two ready files", plan)
	}
	applied := runRWProcess(t, cairnBin, socketPath, "plan", "apply", plan.PlanID,
		"--workspace", plan.WorkspaceID, "--digest", plan.PlanDigest)
	var apply command.PlanApplyData
	decodeProcessResult(t, applied, &apply)
	if apply.Files != 2 || apply.ManifestDigest == "" {
		t.Fatalf("ingest apply = %+v, want two published exact files", apply)
	}

	listed := runRWProcess(t, cairnBin, socketPath, "content", "list", "--workspace", plan.WorkspaceID)
	var content command.ContentListData
	decodeProcessResult(t, listed, &content)
	wantByName := map[string]struct {
		when time.Time
		body []byte
	}{
		"captured-older.bin": {when: olderTime, body: olderBody},
		"captured-newer.bin": {when: newerTime, body: newerBody},
	}
	for name, expected := range wantByName {
		found := false
		for _, item := range content.Items {
			if filepath.Base(item.Path) != name {
				continue
			}
			found = true
			wantDigest := sha256.Sum256(expected.body)
			if item.ModifiedAt != expected.when.Format(time.RFC3339) || item.ContentID != "sha256:"+hex.EncodeToString(wantDigest[:]) || item.LogicalSize == nil || *item.LogicalSize != int64(len(expected.body)) {
				t.Errorf("content.list %s = %+v, want captured modified_at %s and unchanged exact identity/length", name, item, expected.when.Format(time.RFC3339))
			}
		}
		if !found {
			t.Errorf("content.list omitted %s: %+v", name, content.Items)
		}
	}

	cutoffMillis := time.Date(2022, time.January, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	queries := []struct {
		name     string
		filter   string
		wantName string
	}{
		{name: "strictly before cutoff", filter: fmt.Sprintf("mtime_before=%d", cutoffMillis), wantName: "captured-older.bin"},
		{name: "strictly after cutoff", filter: fmt.Sprintf("mtime_after=%d", cutoffMillis), wantName: "captured-newer.bin"},
	}
	var generation string
	for _, query := range queries {
		t.Run(query.name, func(t *testing.T) {
			result := runRWProcess(t, cairnBin, socketPath, "search", "captured", "--workspace", plan.WorkspaceID,
				"--dimension", search.DimensionLexical, "--filter", query.filter)
			var data command.SearchQueryData
			decodeProcessResult(t, result, &data)
			if len(data.Hits) != 1 || filepath.Base(data.Hits[0].Path) != query.wantName {
				t.Fatalf("captured-time query hits = %+v, want only %s", data.Hits, query.wantName)
			}
			if data.Dimension != search.DimensionLexical || data.GenerationID == "" {
				t.Fatalf("captured-time lexical generation = dimension %q generation %q", data.Dimension, data.GenerationID)
			}
			if generation == "" {
				generation = data.GenerationID
			} else if generation != data.GenerationID {
				t.Fatalf("captured-time searches used different generations: %q and %q", generation, data.GenerationID)
			}
		})
	}

	effective, err := cairnconfig.LoadEffective(cairnconfig.LoadOptions{
		Path:           configPath,
		ResolveOptions: cairnconfig.ResolveOptions{Environ: map[string]string{"XDG_DATA_HOME": dataHome}},
	})
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := sqlite.Open(context.Background(), cfg.Paths.Catalog, sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	indexGeneration, generationErr := catalog.LatestIndexGeneration(context.Background(), plan.WorkspaceID, search.DimensionLexical)
	closeErr := catalog.Close()
	if generationErr != nil {
		t.Fatal(generationErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	wantProfile := search.ProfileDigest(search.DimensionLexical, search.CurrentLexicalProfile)
	if indexGeneration.ProviderProfileDigest != wantProfile || indexGeneration.ConfigDigest != effective.Digest {
		t.Fatalf("real daemon lexical generation = %+v, want profile=%s config=%s", indexGeneration, wantProfile, effective.Digest)
	}
	if generation != indexGeneration.ID {
		t.Fatalf("queried generation %q differs from catalog latest %q", generation, indexGeneration.ID)
	}
}
