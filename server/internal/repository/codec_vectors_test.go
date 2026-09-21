package repository

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Golden codec payloads are the executable half of the reader-closure
// declaration: they are stored bytes produced by this repository's write path
// and committed so a later build can prove the decoder still returns the
// declared identity. Exact identity is the SHA-256 digest of the complete
// logical byte stream plus its logical length, so the assertion is on the
// decoded stream: a decoder upgrade is free to frame differently, but it may
// never return other bytes.
const (
	codecVectorDir      = "testdata/codec"
	codecVectorManifest = "vectors.json"
	codecVectorWriteEnv = "RESTOREWEAVE_WRITE_CODEC_VECTORS"
	codecVectorSchema   = "org.restoreweave.codec-vector.v1"
)

type codecVector struct {
	Name          string `json:"name"`
	Profile       string `json:"repository_profile"`
	Blob          string `json:"blob"`
	ContentID     string `json:"content_id"`
	LogicalLength int64  `json:"logical_length"`
}

type codecVectorManifestFile struct {
	Schema  string        `json:"schema"`
	Vectors []codecVector `json:"vectors"`
}

// codecVectorPayloads are the logical streams the committed blobs decode to.
func codecVectorPayloads() []struct {
	Name    string
	Profile string
	Payload []byte
} {
	return []struct {
		Name    string
		Profile string
		Payload []byte
	}{
		{Name: "identity-payload", Profile: RepositoryProfileDirectoryCASDev, Payload: bytes.Repeat([]byte("restoreweave identity codec vector\n"), 64)},
		{Name: "zstd-frame", Profile: RepositoryProfileLocalZstdV1, Payload: bytes.Repeat([]byte("restoreweave zstd codec vector, compressible on purpose\n"), 256)},
		{Name: "zstd-frame-incompressible", Profile: RepositoryProfileLocalZstdV1, Payload: prefixBytes("restoreweave-zstd-vector", 4096)},
	}
}

// prefixBytes derives a deterministic high-entropy stream without pulling in a
// random source, so the vector regenerates identically.
func prefixBytes(seed string, length int) []byte {
	payload := make([]byte, 0, length)
	for counter := 0; len(payload) < length; counter++ {
		sum := sha256.Sum256([]byte(seed + "\x00" + string(rune('a'+counter%26)) + string(rune('0'+counter/26%10))))
		payload = append(payload, sum[:]...)
	}
	return payload[:length]
}

// TestCodecGoldenPayloadsDecodeToTheirDeclaredIdentity regenerates the vector
// manifest from the production write path and then decodes every committed
// blob through the production read path, proving each declared codec still
// returns the exact logical stream and identity it claims.
func TestCodecGoldenPayloadsDecodeToTheirDeclaredIdentity(t *testing.T) {
	ctx := context.Background()
	if os.Getenv(codecVectorWriteEnv) == "1" {
		writeCodecVectors(t, ctx)
	}
	payload, err := os.ReadFile(filepath.Join(codecVectorDir, codecVectorManifest))
	if err != nil {
		t.Fatalf("read committed codec vectors (regenerate with %s=1): %v", codecVectorWriteEnv, err)
	}
	var manifest codecVectorManifestFile
	if err := json.Unmarshal(payload, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Schema != codecVectorSchema || len(manifest.Vectors) != len(codecVectorPayloads()) {
		t.Fatalf("codec vector manifest = %+v", manifest)
	}
	for _, vector := range manifest.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			blob, err := os.ReadFile(filepath.Join(codecVectorDir, vector.Blob))
			if err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			repo, err := OpenProfile(profileForCodecVector(t, vector.Profile), root)
			if err != nil {
				t.Fatal(err)
			}
			// The committed bytes are placed exactly where the read path looks
			// for them. Nothing re-encodes them: this is the decoder contract.
			blobPath := filepath.Join(root, "blobs", "sha256", strings.TrimPrefix(vector.ContentID, "sha256:")[:2], strings.TrimPrefix(vector.ContentID, "sha256:"))
			if err := os.MkdirAll(filepath.Dir(blobPath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(blobPath, blob, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := repo.Verify(ctx, vector.ContentID); err != nil {
				t.Fatalf("decode %s: %v", vector.Name, err)
			}
			body, err := repo.Open(ctx, vector.ContentID)
			if err != nil {
				t.Fatalf("open %s: %v", vector.Name, err)
			}
			decoded, err := io.ReadAll(body)
			closeErr := body.Close()
			if err != nil || closeErr != nil {
				t.Fatalf("read %s: %v/%v", vector.Name, err, closeErr)
			}
			digest := sha256.Sum256(decoded)
			got := "sha256:" + hex.EncodeToString(digest[:])
			if got != vector.ContentID || int64(len(decoded)) != vector.LogicalLength {
				t.Fatalf("decoded %s = %s/%d, want %s/%d", vector.Name, got, len(decoded), vector.ContentID, vector.LogicalLength)
			}
		})
	}
}

func profileForCodecVector(t *testing.T, profile string) string {
	t.Helper()
	switch profile {
	case RepositoryProfileDirectoryCASDev, RepositoryProfileLocalZstdV1:
		return profile
	default:
		t.Fatalf("unsupported codec vector profile %q", profile)
		return ""
	}
}

func writeCodecVectors(t *testing.T, ctx context.Context) {
	t.Helper()
	if err := os.MkdirAll(codecVectorDir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := codecVectorManifestFile{Schema: codecVectorSchema}
	for _, vector := range codecVectorPayloads() {
		root := t.TempDir()
		repo, err := OpenProfile(vector.Profile, root)
		if err != nil {
			t.Fatal(err)
		}
		receipt, err := repo.Place(ctx, bytes.NewReader(vector.Payload))
		if err != nil {
			t.Fatalf("place %s: %v", vector.Name, err)
		}
		digest := sha256.Sum256(vector.Payload)
		contentID := "sha256:" + hex.EncodeToString(digest[:])
		if receipt.ContentID != contentID {
			t.Fatalf("placed %s as %s, want %s", vector.Name, receipt.ContentID, contentID)
		}
		blobName := vector.Name + ".blob"
		blob, err := os.ReadFile(filepath.Join(root, "blobs", "sha256", hex.EncodeToString(digest[:])[:2], hex.EncodeToString(digest[:])))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(codecVectorDir, blobName), blob, 0o644); err != nil {
			t.Fatal(err)
		}
		manifest.Vectors = append(manifest.Vectors, codecVector{
			Name: vector.Name, Profile: vector.Profile, Blob: blobName,
			ContentID: contentID, LogicalLength: int64(len(vector.Payload)),
		})
	}
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(codecVectorDir, codecVectorManifest), append(payload, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
