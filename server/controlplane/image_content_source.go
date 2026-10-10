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

	"github.com/ailiheizi/cairn/server/internal/processor"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
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

// Stable typed reasons carried inside search.query input errors when an
// image_subject_ref cannot become one admitted query image. They are retrieval
// facts only: a similarity or vision-tower signal never establishes exact
// identity and never authorizes deletion.
const (
	// ImageQueryReasonSubjectNotImage is used when the referenced subject is
	// not an admitted image file: a non-file entry, a name without an admitted
	// jpeg/png suffix, or no bound content identity.
	ImageQueryReasonSubjectNotImage = "SUBJECT_NOT_IMAGE"
	// ImageQueryReasonTooLarge is used when the image exceeds the admitted
	// query-image byte bound before any bytes are read.
	ImageQueryReasonTooLarge = "QUERY_IMAGE_TOO_LARGE"
	// ImageQueryReasonUndecodable is used when the stored bytes are not a
	// decodable admitted image: a foreign format, corrupt bytes, or geometry
	// outside the admitted bounds.
	ImageQueryReasonUndecodable = "QUERY_IMAGE_UNDECODABLE"
)

// errImageQueryInput marks a search.query caller input error in the image
// subject resolution path, so the operation reports it as invalid input (and
// the search package's own ErrInvalidQuery path never revokes a verified
// generation). Repository and catalog failures are not marked with it.
var errImageQueryInput = errors.New("image query input rejected")

func imageQueryInputError(reason, detail string) error {
	return fmt.Errorf("%w: %s (%s)", errImageQueryInput, detail, reason)
}

// resolveImageQueryInput resolves one search.query image_subject_ref into the
// single admitted query image the search package consumes. The subject is
// resolved once to its newest published file entry, admitted by type and
// suffix, and its bytes are read through the repository image content source,
// which re-hashes them and refuses any identity mismatch. The stored media
// type and the shared decode admission then verify that the bytes really are
// a decodable admitted image; suffix evidence alone is never identity.
func (d *Dispatcher) resolveImageQueryInput(ctx context.Context, workspaceID, subjectRef string) (search.ImageQueryInput, error) {
	entry, err := d.resolveSubject(ctx, workspaceID, subjectRef)
	if err != nil {
		return search.ImageQueryInput{}, fmt.Errorf("image_subject_ref: %w", err)
	}
	if entry.EntryType != sqlite.EntryFile || strings.TrimSpace(entry.ContentID) == "" {
		return search.ImageQueryInput{}, imageQueryInputError(ImageQueryReasonSubjectNotImage,
			"image_subject_ref does not resolve to a file with a bound content identity")
	}
	if _, ok := search.ImageMediaTypeForName(entry.DisplayName); !ok {
		return search.ImageQueryInput{}, imageQueryInputError(ImageQueryReasonSubjectNotImage,
			"image_subject_ref does not resolve to an admitted image file (jpeg or png)")
	}
	if entry.LogicalSize != nil && *entry.LogicalSize > search.MaxImageEmbeddingInputBytes {
		return search.ImageQueryInput{}, imageQueryInputError(ImageQueryReasonTooLarge,
			fmt.Sprintf("image_subject_ref content exceeds the %d byte query-image bound", search.MaxImageEmbeddingInputBytes))
	}
	if d.exact == nil || d.exact.Repo == nil {
		return search.ImageQueryInput{}, fmt.Errorf("image query content source is not configured")
	}
	source := NewRepositoryImageContentSource(d.exact.Repo, 0)
	content, err := source.ReadImageContent(ctx, entry.ContentID)
	if err != nil {
		return search.ImageQueryInput{}, fmt.Errorf("read image_subject_ref content: %w", err)
	}
	mediaType := strings.ToLower(strings.TrimSpace(content.MediaType))
	if err := processor.ValidateImageBytes(content.Bytes, mediaType); err != nil {
		return search.ImageQueryInput{}, imageQueryInputError(ImageQueryReasonUndecodable,
			"image_subject_ref bytes are not a decodable admitted image: "+err.Error())
	}
	return search.ImageQueryInput{
		MediaType: mediaType,
		Digest:    content.ContentID,
		Bytes:     content.Bytes,
	}, nil
}
