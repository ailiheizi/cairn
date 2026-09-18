package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/search"
)

// DefaultImageContentMaxBytes bounds what the image dimension may read for one
// subject. An image larger than this is refused rather than truncated: a partial
// stream cannot carry the identity the request asked for.
const DefaultImageContentMaxBytes = int64(64 << 20)

// repositoryImageContentSource is the daemon's byte boundary for image
// embedding. It reads one object from the exact repository and refuses anything
// whose SHA-256 does not equal the requested content identity, so the search
// package never has to trust a caller-supplied binding between bytes and id.
type repositoryImageContentSource struct {
	repo     repository.Driver
	maxBytes int64
}

// NewRepositoryImageContentSource binds the image dimension to repository bytes.
func NewRepositoryImageContentSource(repo repository.Driver, maxBytes int64) search.ImageContentSource {
	if maxBytes <= 0 {
		maxBytes = DefaultImageContentMaxBytes
	}
	return repositoryImageContentSource{repo: repo, maxBytes: maxBytes}
}

func (s repositoryImageContentSource) ReadImageContent(ctx context.Context, contentID string) (search.ImageContent, error) {
	trimmed := strings.TrimSpace(contentID)
	if trimmed == "" {
		return search.ImageContent{}, errors.New("image content id is required")
	}
	if s.repo == nil {
		return search.ImageContent{}, errors.New("image content source has no repository")
	}
	if err := ctx.Err(); err != nil {
		return search.ImageContent{}, err
	}
	body, err := s.repo.Open(ctx, trimmed)
	if err != nil {
		return search.ImageContent{}, err
	}
	defer body.Close()
	payload, err := io.ReadAll(io.LimitReader(body, s.maxBytes+1))
	if err != nil {
		return search.ImageContent{}, fmt.Errorf("read image content: %w", err)
	}
	if int64(len(payload)) > s.maxBytes {
		return search.ImageContent{}, fmt.Errorf("image content exceeds the %d byte bound", s.maxBytes)
	}
	want := strings.TrimPrefix(trimmed, "sha256:")
	sum := sha256.Sum256(payload)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), want) {
		return search.ImageContent{}, errors.New("image bytes do not match the requested content identity")
	}
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(payload), ";")[0]))
	return search.ImageContent{ContentID: trimmed, MediaType: mediaType, Bytes: payload}, nil
}
