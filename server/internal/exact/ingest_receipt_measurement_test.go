package exact

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type fixedMeasurementReceiptRepo struct {
	*repository.Dir
	state  repository.StoredBytesState
	stored int64
}

func (r *fixedMeasurementReceiptRepo) PlaceExact(ctx context.Context, contentID string, body io.Reader) (repository.Receipt, error) {
	receipt, err := r.Dir.PlaceExact(ctx, contentID, body)
	if err == nil {
		receipt.StoredBytes = r.stored
		receipt.StoredBytesState = r.state
	}
	return receipt, err
}

func TestIngestUnavailableOrInvalidStoredBytesStillRestoresExactBytes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		state  repository.StoredBytesState
		stored int64
	}{
		{name: "omitted state", stored: 12},
		{name: "unknown state", state: "MAYBE", stored: 12},
		{name: "unavailable zero", state: repository.StoredBytesUnavailable, stored: 0},
		{name: "unavailable shared count", state: repository.StoredBytesUnavailable, stored: 7},
		{name: "measured negative", state: repository.StoredBytesMeasured, stored: -1},
		{name: "measured zero for nonempty", state: repository.StoredBytesMeasured, stored: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			payload := []byte("independently exact despite unknown physical bytes")
			source := t.TempDir()
			if err := os.WriteFile(filepath.Join(source, "payload.bin"), payload, 0o600); err != nil {
				t.Fatal(err)
			}
			store, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "catalog.sqlite"), sqlite.Options{})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			base, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
			if err != nil {
				t.Fatal(err)
			}
			repo := &fixedMeasurementReceiptRepo{Dir: base, state: tc.state, stored: tc.stored}
			service := &Service{Store: store, Repo: repo}
			result, err := service.Ingest(ctx, source)
			if err != nil {
				t.Fatalf("unknown telemetry blocked exact ingest: %v", err)
			}
			if result.SavingsMeasured || result.NewPhysicalBytes != 0 || result.CompressionSavedBytes != 0 || len(result.Warnings) == 0 {
				t.Fatalf("invalid or unavailable measurement result = %+v", result)
			}
			destination := filepath.Join(t.TempDir(), "restored")
			if _, err := service.Restore(ctx, result.SnapshotRef, destination); err != nil {
				t.Fatalf("restore after unavailable measurement: %v", err)
			}
			got, err := os.ReadFile(filepath.Join(destination, "payload.bin"))
			if err != nil || !bytes.Equal(got, payload) {
				t.Fatalf("restored exact bytes = %q, err=%v", got, err)
			}
		})
	}
}

func TestIngestMeasuredStoredByteSumOverflowKeepsExactRestore(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	want := map[string][]byte{
		"first.bin":  []byte("small first payload"),
		"second.bin": []byte("small second payload"),
	}
	for name, content := range want {
		if err := os.WriteFile(filepath.Join(source, name), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	store, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "catalog.sqlite"), sqlite.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	base, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: store, Repo: &fixedMeasurementReceiptRepo{Dir: base, state: repository.StoredBytesMeasured, stored: math.MaxInt64}}
	result, err := service.Ingest(ctx, source)
	if err != nil {
		t.Fatalf("overflowing optional measurement blocked exact ingest: %v", err)
	}
	if result.SavingsMeasured || result.NewPhysicalBytes != 0 || result.CompressionSavedBytes != 0 || len(result.Warnings) == 0 {
		t.Fatalf("overflowing measurement result = %+v", result)
	}
	destination := filepath.Join(t.TempDir(), "restored")
	if _, err := service.Restore(ctx, result.SnapshotRef, destination); err != nil {
		t.Fatalf("restore after measurement overflow: %v", err)
	}
	for name, content := range want {
		got, err := os.ReadFile(filepath.Join(destination, name))
		if err != nil || !bytes.Equal(got, content) {
			t.Fatalf("restored %s = %q, err=%v", name, got, err)
		}
	}
}

func TestIngestAndRestoreMeasuredZeroLengthFilesForRawAndZstd(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name string
		open func(string) (repository.Driver, error)
	}{
		{name: "raw", open: func(root string) (repository.Driver, error) { return repository.OpenDir(root) }},
		{name: "zstd", open: func(root string) (repository.Driver, error) { return repository.OpenZstdDir(root) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := t.TempDir()
			if err := os.WriteFile(filepath.Join(source, "empty.bin"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			store, err := sqlite.Open(ctx, filepath.Join(t.TempDir(), "catalog.sqlite"), sqlite.Options{})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			driver, err := tc.open(filepath.Join(t.TempDir(), "repository"))
			if err != nil {
				t.Fatal(err)
			}
			service := &Service{Store: store, Repo: driver}
			result, err := service.Ingest(ctx, source)
			if err != nil {
				t.Fatal(err)
			}
			if !result.SavingsMeasured || result.NewPhysicalBytes < 0 || result.CompressionSavedBytes != 0 {
				t.Fatalf("empty-file measured result = %+v", result)
			}
			if tc.name == "raw" && result.NewPhysicalBytes != 0 {
				t.Fatalf("raw empty-file physical bytes = %d, want zero", result.NewPhysicalBytes)
			}
			if tc.name == "zstd" && result.NewPhysicalBytes == 0 {
				t.Fatalf("zstd empty-file frame has no measured physical bytes: %+v", result)
			}
			destination := filepath.Join(t.TempDir(), "restored")
			if _, err := service.Restore(ctx, result.SnapshotRef, destination); err != nil {
				t.Fatalf("restore empty file: %v", err)
			}
			got, err := os.ReadFile(filepath.Join(destination, "empty.bin"))
			if err != nil || len(got) != 0 {
				t.Fatalf("restored empty file = %q, err=%v", got, err)
			}
		})
	}
}

func TestLostPlacementResponseProducesUnavailableSyntheticReceipt(t *testing.T) {
	ctx := context.Background()
	payload := []byte("committed bytes with a lost response")
	base, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	repo := &payloadPlacementResponseLossRepo{Dir: base}
	receipt, err := placeExactWithReadback(ctx, repo, digest, int64(len(payload)), bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if receipt.StoredBytesState != repository.StoredBytesUnavailable || receipt.StoredBytes != 0 || receipt.HasMeasuredStoredBytes() || !receipt.Existed {
		t.Fatalf("synthetic unknown-outcome receipt invented placement bytes: %+v", receipt)
	}
	reader, err := repo.Open(ctx, digest)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, payload) {
		t.Fatalf("independently read bytes = %q, read=%v close=%v", got, readErr, closeErr)
	}
}
