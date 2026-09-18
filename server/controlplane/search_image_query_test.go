package controlplane

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// newImageQueryDispatcher opens one catalog/repository pair and a dispatcher
// with the exact lane wired, so search.query can resolve image subjects
// through the repository image content source.
func newImageQueryDispatcher(t *testing.T) *Dispatcher {
	t.Helper()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	return NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
}

func testPNGQueryBytes(t *testing.T) []byte {
	t.Helper()
	source := image.NewNRGBA(image.Rect(0, 0, 6, 6))
	for y := 0; y < 6; y++ {
		for x := 0; x < 6; x++ {
			source.Set(x, y, color.NRGBA{R: uint8(40 * x), G: uint8(40 * y), B: 90, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, source); err != nil {
		t.Fatalf("encode fixture png: %v", err)
	}
	return buffer.Bytes()
}

func mustSubjectRef(t *testing.T, ctx context.Context, dispatcher *Dispatcher, workspaceID, rootID, path string) command.NamespaceEntryData {
	t.Helper()
	resolved := dispatcher.Handle(ctx, mustEnvelope(t, command.OpNamespaceResolve, map[string]any{
		"workspace_id": workspaceID,
		"root_id":      rootID,
		"path":         path,
	}))
	if resolved.Status != command.StatusSucceeded {
		t.Fatalf("namespace.resolve(%s) = %q: %+v", path, resolved.Status, resolved.Reasons)
	}
	var data command.NamespaceResolveData
	if err := json.Unmarshal(resolved.Data, &data); err != nil {
		t.Fatalf("decode namespace.resolve: %v", err)
	}
	return data.Entry
}

func TestSearchQueryImageSubjectResolutionTypedReasons(t *testing.T) {
	ctx := context.Background()
	dispatcher := newImageQueryDispatcher(t)

	root := t.TempDir()
	payload := testPNGQueryBytes(t)
	if err := writeFile(filepath.Join(root, "pictures", "photo.png"), payload); err != nil {
		t.Fatalf("write png fixture: %v", err)
	}
	if err := writeFile(filepath.Join(root, "notes", "summary.txt"), []byte("a plain text note")); err != nil {
		t.Fatalf("write text fixture: %v", err)
	}
	ingestData := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	imageEntry := mustSubjectRef(t, ctx, dispatcher, ingestData.WorkspaceID, ingestData.RootID, "pictures/photo.png")
	textEntry := mustSubjectRef(t, ctx, dispatcher, ingestData.WorkspaceID, ingestData.RootID, "notes/summary.txt")

	// A readable image subject resolves through the repository content source:
	// the bytes are the stored content and the digest is its exact identity.
	resolved, err := dispatcher.resolveImageQueryInput(ctx, ingestData.WorkspaceID, imageEntry.SubjectRef)
	if err != nil {
		t.Fatalf("resolve image subject: %v", err)
	}
	if resolved.MediaType != search.ImageMediaTypePNG {
		t.Fatalf("resolved media type = %q", resolved.MediaType)
	}
	sum := sha256.Sum256(resolved.Bytes)
	if got := "sha256:" + hex.EncodeToString(sum[:]); got != imageEntry.ContentID || got != resolved.Digest {
		t.Fatalf("resolved digest = %q, entry content id = %q, hashed bytes = %q: the content source must re-hash the bytes against the stored identity", resolved.Digest, imageEntry.ContentID, got)
	}
	if !bytes.Equal(resolved.Bytes, payload) {
		t.Fatal("resolved bytes differ from the ingested payload")
	}
	if err := resolved.Validate(); err != nil {
		t.Fatalf("resolved query image rejected by the search contract: %v", err)
	}

	// A non-image subject is a stable typed input error.
	resolved, err = dispatcher.resolveImageQueryInput(ctx, ingestData.WorkspaceID, textEntry.SubjectRef)
	if !errors.Is(err, errImageQueryInput) || !strings.Contains(err.Error(), ImageQueryReasonSubjectNotImage) {
		t.Fatalf("non-image subject error = %v, want %s", err, ImageQueryReasonSubjectNotImage)
	}
	operation := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id":      ingestData.WorkspaceID,
		"image_subject_ref": textEntry.SubjectRef,
	}))
	if operation.Status != command.StatusFailed || !hasReasonCode(operation, ReasonCodeInvalidInput) ||
		!strings.Contains(operation.Reasons[0].Message, ImageQueryReasonSubjectNotImage) {
		t.Fatalf("non-image search.query = %q: %+v", operation.Status, operation.Reasons)
	}

	// Stored bytes that are not a decodable admitted image are a typed input
	// error; suffix evidence alone is never identity.
	corruptRoot := t.TempDir()
	if err := writeFile(filepath.Join(corruptRoot, "broken.png"), []byte("this is not an image")); err != nil {
		t.Fatalf("write corrupt fixture: %v", err)
	}
	corruptIngest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": corruptRoot})
	corruptEntry := mustSubjectRef(t, ctx, dispatcher, corruptIngest.WorkspaceID, corruptIngest.RootID, "broken.png")
	resolved, err = dispatcher.resolveImageQueryInput(ctx, corruptIngest.WorkspaceID, corruptEntry.SubjectRef)
	if !errors.Is(err, errImageQueryInput) || !strings.Contains(err.Error(), ImageQueryReasonUndecodable) {
		t.Fatalf("corrupt image error = %v, want %s", err, ImageQueryReasonUndecodable)
	}

	// An unknown but well-formed subject is not found; a malformed one is
	// invalid input.
	missing := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id":      ingestData.WorkspaceID,
		"image_subject_ref": "nse_" + strings.Repeat("0", 32),
	}))
	if missing.Status != command.StatusFailed || !hasReasonCode(missing, ReasonCodeNotFound) {
		t.Fatalf("missing subject search.query = %q: %+v", missing.Status, missing.Reasons)
	}
	malformed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id":      ingestData.WorkspaceID,
		"image_subject_ref": "not-a-stable-id",
	}))
	if malformed.Status != command.StatusFailed || !hasReasonCode(malformed, ReasonCodeInvalidInput) {
		t.Fatalf("malformed subject search.query = %q: %+v", malformed.Status, malformed.Reasons)
	}

	// Query text and a query image are mutually exclusive, and the field
	// requires the workspace it resolves within.
	combined := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id":      ingestData.WorkspaceID,
		"query":             "photo",
		"image_subject_ref": imageEntry.SubjectRef,
	}))
	if combined.Status != command.StatusFailed || !hasReasonCode(combined, ReasonCodeInvalidInput) {
		t.Fatalf("combined text and image search.query = %q: %+v", combined.Status, combined.Reasons)
	}
	workspaceless := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"image_subject_ref": imageEntry.SubjectRef,
	}))
	if workspaceless.Status != command.StatusFailed || !hasReasonCode(workspaceless, ReasonCodeInvalidInput) {
		t.Fatalf("workspaceless image search.query = %q: %+v", workspaceless.Status, workspaceless.Reasons)
	}
	// A caller-pinned dimension that cannot use the image is refused instead
	// of silently ignoring the query image.
	pinned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id":      ingestData.WorkspaceID,
		"dimension":         search.DimensionLexical,
		"image_subject_ref": imageEntry.SubjectRef,
	}))
	if pinned.Status != command.StatusFailed || !hasReasonCode(pinned, ReasonCodeInvalidInput) {
		t.Fatalf("pinned lexical image search.query = %q: %+v", pinned.Status, pinned.Reasons)
	}
}

func TestSearchQueryImageOnlyRequestDegradesWithoutImageGeneration(t *testing.T) {
	ctx := context.Background()
	dispatcher := newImageQueryDispatcher(t)

	root := t.TempDir()
	if err := writeFile(filepath.Join(root, "photo.png"), testPNGQueryBytes(t)); err != nil {
		t.Fatalf("write png fixture: %v", err)
	}
	ingestData := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	imageEntry := mustSubjectRef(t, ctx, dispatcher, ingestData.WorkspaceID, ingestData.RootID, "photo.png")

	// The dispatcher here has no image binding, so no dimension can answer an
	// image-only request. The operation must degrade honestly with the

	operation := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id":      ingestData.WorkspaceID,
		"image_subject_ref": imageEntry.SubjectRef,
	}))
	if operation.Status != command.StatusDegraded {
		t.Fatalf("image-only search.query = %q: %+v", operation.Status, operation.Reasons)
	}
	var data command.SearchQueryData
	if err := json.Unmarshal(operation.Data, &data); err != nil {
		t.Fatalf("decode search.query data: %v", err)
	}
	skipped := false
	for _, component := range data.Components {
		if component.Dimension == search.DimensionLexical && component.Status == "SKIPPED" && component.Reason == "QUERY_TEXT_REQUIRED" {
			skipped = true
		}
	}
	if !skipped {
		t.Fatalf("lexical component for an image-only request = %+v, want SKIPPED with QUERY_TEXT_REQUIRED", data.Components)
	}
	if len(data.Hits) != 0 {
		t.Fatalf("image-only hits without an image generation = %+v, want none", data.Hits)
	}
}
