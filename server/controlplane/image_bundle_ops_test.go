package controlplane

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// TestImageBundleInstallArchiveInputUsesTheArchiveInstaller pins the routing and
// the honest failure modes of the image bundle install operation: only the
// archive installer runs, a missing archive path is invalid input, and an
// unconfigured installer keeps the operation visible but unavailable.
func TestImageBundleInstallArchiveInputUsesTheArchiveInstaller(t *testing.T) {
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	modelsRoot := filepath.Join(t.TempDir(), "models")
	const archivePath = "/var/lib/restoreweave/chinese-clip.tar.gz"
	var calls int
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock",
		WithImageBundleArchiveInstaller(modelsRoot, func(_ context.Context, root, path string) (ImageBundleInstallReceipt, error) {
			calls++
			if root != modelsRoot || path != archivePath {
				return ImageBundleInstallReceipt{}, errors.New("archive installer received wrong paths")
			}
			return ImageBundleInstallReceipt{}, errors.New("fixture refuses to publish")
		}),
	)
	// A failed installer must never read as success.
	result := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpImageBundleInstall,
		Input:     []byte(`{"archive_path":"` + archivePath + `"}`),
	})
	if result.Status != command.StatusFailed {
		t.Fatalf("failed install = %s, want FAILED", result.Status)
	}
	if calls != 1 {
		t.Fatalf("archive installer calls = %d, want 1", calls)
	}
	failure := ""
	for _, reason := range result.Reasons {
		failure += reason.Message + " "
	}
	if !strings.Contains(failure, "installation unavailable") {
		t.Fatalf("failure must name the installation path: %+v", result.Reasons)
	}

	// A missing archive path is invalid input, and never reaches the installer.
	result = dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpImageBundleInstall,
		Input:     []byte(`{}`),
	})
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
		t.Fatalf("missing archive path = %s, want FAILED/invalid_input: %+v", result.Status, result.Reasons)
	}
	if calls != 1 {
		t.Fatalf("an invalid request reached the installer (%d calls)", calls)
	}
}

// TestImageBundleInstallRequiresAnInjectedInstaller pins the sibling rule the
// semantic bundle follows: without a configured installer the operation stays
// visible but unimplemented, never silently successful.
func TestImageBundleInstallRequiresAnInjectedInstaller(t *testing.T) {
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock")
	result := dispatcher.Handle(context.Background(), command.Envelope{
		Operation: command.OpImageBundleInstall,
		Input:     []byte(`{"archive_path":"/var/lib/restoreweave/chinese-clip.tar.gz"}`),
	})
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeUnimplemented) {
		t.Fatalf("unconfigured installer = %s, want FAILED/unimplemented: %+v", result.Status, result.Reasons)
	}
}

// TestValidateImageBundleInstallReceiptRefusesAForeignDestination keeps an
// installer from reporting a bundle it did not actually place under the
// configured models root.
func TestValidateImageBundleInstallReceiptRefusesAForeignDestination(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	admission := search.ImageBundleAdmission{Descriptor: search.ImageBundleDescriptor{ProfileID: search.ImageBundleDefaultProfileID}}
	if err := validateImageBundleInstallReceipt(ImageBundleInstallReceipt{Admission: admission, Destination: "/tmp/elsewhere"}, modelsRoot); err == nil {
		t.Fatal("a receipt pointing outside the models root must be refused")
	}
}
