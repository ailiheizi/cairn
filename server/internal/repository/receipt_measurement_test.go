package repository

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestReceiptMeasuredStoredBytesRequiresExplicitValidState(t *testing.T) {
	for _, tc := range []struct {
		name    string
		receipt Receipt
		want    bool
	}{
		{name: "missing state", receipt: Receipt{Bytes: 5, StoredBytes: 5}},
		{name: "unrecognized state", receipt: Receipt{Bytes: 5, StoredBytes: 5, StoredBytesState: "MAYBE"}},
		{name: "unavailable zero", receipt: Receipt{Bytes: 5, StoredBytes: 0, StoredBytesState: StoredBytesUnavailable}},
		{name: "unavailable positive shared count", receipt: Receipt{Bytes: 5, StoredBytes: 7, StoredBytesState: StoredBytesUnavailable}},
		{name: "measured negative", receipt: Receipt{Bytes: 5, StoredBytes: -1, StoredBytesState: StoredBytesMeasured}},
		{name: "measured zero nonempty", receipt: Receipt{Bytes: 5, StoredBytes: 0, StoredBytesState: StoredBytesMeasured}},
		{name: "measured positive", receipt: Receipt{Bytes: 5, StoredBytes: 3, StoredBytesState: StoredBytesMeasured}, want: true},
		{name: "measured empty zero", receipt: Receipt{Bytes: 0, StoredBytes: 0, StoredBytesState: StoredBytesMeasured}, want: true},
		{name: "negative logical length", receipt: Receipt{Bytes: -1, StoredBytes: 1, StoredBytesState: StoredBytesMeasured}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.receipt.HasMeasuredStoredBytes(); got != tc.want {
				t.Fatalf("HasMeasuredStoredBytes() = %t, want %t", got, tc.want)
			}
		})
	}
}

func TestRawMemoryAndZstdReceiptsDeclareMeasuredWholeObjects(t *testing.T) {
	ctx := context.Background()
	var emptyHash [32]byte = sha256.Sum256(nil)
	emptyID := AlgorithmSHA256 + ":" + hex.EncodeToString(emptyHash[:])
	payload := []byte("complete stored object measurement")
	for _, tc := range []struct {
		name string
		open func() (Driver, error)
	}{
		{name: "raw", open: func() (Driver, error) { return OpenDir(t.TempDir()) }},
		{name: "memory", open: func() (Driver, error) { return NewMemory(), nil }},
		{name: "zstd", open: func() (Driver, error) { return OpenZstdDir(t.TempDir()) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			driver, err := tc.open()
			if err != nil {
				t.Fatal(err)
			}
			nonempty, err := driver.Place(ctx, bytes.NewReader(payload))
			if err != nil {
				t.Fatal(err)
			}
			if nonempty.StoredBytesState != StoredBytesMeasured || !nonempty.HasMeasuredStoredBytes() || nonempty.StoredBytes <= 0 {
				t.Fatalf("nonempty receipt = %+v", nonempty)
			}
			empty, err := driver.PlaceExact(ctx, emptyID, bytes.NewReader(nil))
			if err != nil {
				t.Fatal(err)
			}
			if empty.StoredBytesState != StoredBytesMeasured || !empty.HasMeasuredStoredBytes() {
				t.Fatalf("empty receipt = %+v", empty)
			}
			if tc.name != "zstd" && empty.StoredBytes != 0 {
				t.Fatalf("empty %s object length = %d, want zero", tc.name, empty.StoredBytes)
			}
		})
	}
}
