package controlplane

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	rwconfig "github.com/ailiheizi/restoreweave/config"
	"github.com/ailiheizi/restoreweave/server/internal/processor"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// ocrCapabilityFor returns the reported capability for one bundle root.
func ocrCapabilityFor(t *testing.T, data command.CapabilityListData) command.Capability {
	t.Helper()
	for _, capability := range data.Capabilities {
		if capability.Kind == capabilityKindProcessor && capability.ID == processor.CapabilityOCRImageText {
			return capability
		}
	}
	t.Fatalf("capability.list did not report the OCR processor: %+v", data.Capabilities)
	return command.Capability{}
}

func ocrTestDispatcher(t *testing.T) (*Dispatcher, command.CapabilityListData, rwconfig.ResolvedConfig) {
	t.Helper()
	// The persisted profile resolves paths.models below XDG_DATA_HOME, so the
	// test owns every directory the OCR capability inspects.
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	configPath := filepath.Join(t.TempDir(), "restoreweave.toml")
	resolved, err := rwconfig.Init(configPath)
	if err != nil {
		t.Fatalf("init config: %v", err)
	}
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	exactOption, err := WithExactDir(store, filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("exact dir: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw-ocr.sock", WithOperatorConfig(resolved), exactOption)
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("capability.list = %q: %+v", result.Status, result.Reasons)
	}
	var data command.CapabilityListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode capability data: %v", err)
	}
	return dispatcher, data, resolved
}

func TestOCRCapabilityReportsNotBuiltWithTheExpectedPath(t *testing.T) {
	dispatcher, data, resolved := ocrTestDispatcher(t)
	wantRoot := processor.OCRBundleRoot(resolved.Config.Paths.Models)
	if dispatcher.ocrBundleRoot != wantRoot {
		t.Fatalf("dispatcher OCR root = %q, want %q", dispatcher.ocrBundleRoot, wantRoot)
	}
	// The capability is registered for the resolved profile, but nothing is
	// installed at that path yet.
	if dispatcher.ocrProcessor == nil {
		t.Fatal("the OCR processor was not registered for a resolved models root")
	}
	capability := ocrCapabilityFor(t, data)
	if capability.State != "NOT_BUILT" {
		t.Fatalf("state = %q, want NOT_BUILT: %+v", capability.State, capability)
	}
	if !strings.Contains(capability.Notes, wantRoot) {
		t.Fatalf("notes must name the expected bundle root: %q", capability.Notes)
	}
	if !strings.Contains(capability.Notes, processor.OCRBundleManifestName) {
		t.Fatalf("notes must name the manifest the operator installs: %q", capability.Notes)
	}
	if capability.Version != "" || capability.Source != "" {
		t.Fatalf("an uninstalled profile must not claim an engine or digest: %+v", capability)
	}
}

func TestOCRCapabilityReportsUnavailableForABrokenBundle(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	// Pre-create the exact bundle location with an unreadable manifest.
	configPath := filepath.Join(t.TempDir(), "restoreweave.toml")
	resolved, err := rwconfig.Init(configPath)
	if err != nil {
		t.Fatalf("init config: %v", err)
	}
	bundleRoot := processor.OCRBundleRoot(resolved.Config.Paths.Models)
	if err := os.MkdirAll(bundleRoot, 0o700); err != nil {
		t.Fatalf("mkdir bundle root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bundleRoot, processor.OCRBundleManifestName), []byte("{not json"), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw-ocr-broken.sock", WithOperatorConfig(resolved))
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	var data command.CapabilityListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode capability data: %v", err)
	}
	capability := ocrCapabilityFor(t, data)
	if capability.State != "UNAVAILABLE" || capability.Notes == "" {
		t.Fatalf("state = %+v, want UNAVAILABLE with a reason", capability)
	}
	if !strings.Contains(capability.Notes, bundleRoot) {
		t.Fatalf("notes must name the inspected root: %q", capability.Notes)
	}
}

func TestOCRCapabilityWithoutAPersistedProfileReportsNotBuilt(t *testing.T) {
	dispatcher := &Dispatcher{}
	capability := dispatcher.ocrCapability()
	if capability.State != "NOT_BUILT" {
		t.Fatalf("state = %q, want NOT_BUILT", capability.State)
	}
	if capability.Kind != capabilityKindProcessor || capability.ID != processor.CapabilityOCRImageText {
		t.Fatalf("capability identity = %+v", capability)
	}
	if !strings.Contains(capability.Notes, "paths.models") {
		t.Fatalf("notes = %q", capability.Notes)
	}
	if err := dispatcher.CloseOCRCapability(); err != nil {
		t.Fatalf("close without a processor: %v", err)
	}
}
