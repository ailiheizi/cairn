package search

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const lexicalSegmentProjectionSchemaV1 = 1

// descriptionSourceProvenance is rebuildable evidence stored only in the
// lexical generation's UNINDEXED segment projection. Source offsets are into
// the durable body; body-field offsets are into the exact joined descriptions
// field indexed in that generation.
type descriptionSourceProvenance struct {
	WorkspaceID         string `json:"workspace_id"`
	SubjectID           string `json:"subject_id"`
	DocumentRevision    int64  `json:"document_revision"`
	SegmentationProfile string `json:"segmentation_profile_digest"`
	BodyDigest          string `json:"body_digest"`
	BodyFieldStartByte  int    `json:"body_field_start_byte"`
	BodyFieldEndByte    int    `json:"body_field_end_byte"`
	SourceStartByte     int    `json:"source_start_byte"`
	SourceEndByte       int    `json:"source_end_byte"`
	TextDigest          string `json:"text_digest"`
}

type lexicalSegmentProjection struct {
	SchemaVersion         int          `json:"schema_version"`
	DescriptionsFieldHash string       `json:"descriptions_field_sha256"`
	Segments              []SegmentRef `json:"segments"`
}

type descriptionSourceSpan struct {
	StartByte int `json:"start_byte"`
	EndByte   int `json:"end_byte"`
}

// verifiedDescriptionSourceProvenance returns provenance only when the
// complete durable segment set reconstructs the exact description body.
// Failure is non-fatal: lexical search can still index the description text.
func verifiedDescriptionSourceProvenance(document sqlite.DescriptionDocument, subjectID string, bodyFieldStart int, segments []sqlite.SemanticSegment) []*descriptionSourceProvenance {
	if len(segments) == 0 || !utf8.ValidString(document.Body) || bodyFieldStart < 0 ||
		sha256Text(document.Body) != document.BodyDigest || document.Revision < 1 ||
		strings.TrimSpace(document.WorkspaceID) == "" || strings.TrimSpace(subjectID) == "" {
		return nil
	}
	results := make([]*descriptionSourceProvenance, len(segments))
	previousEnd := 0
	profile := ""
	for ordinal, segment := range segments {
		if segment.Ordinal != int64(ordinal) || segment.WorkspaceID != document.WorkspaceID ||
			segment.DocumentID != document.ID || segment.SubjectRef != document.SubjectRef ||
			segment.DocumentRevision != document.Revision ||
			strings.TrimSpace(segment.SegmentationProfileDigest) == "" ||
			sha256Text(segment.Text) != segment.TextDigest || !utf8.ValidString(segment.Text) {
			return nil
		}
		if profile == "" {
			profile = segment.SegmentationProfileDigest
		} else if profile != segment.SegmentationProfileDigest {
			return nil
		}
		span, err := decodeDescriptionSourceSpan(segment.SourceSpan)
		if err != nil || span.StartByte != previousEnd || span.StartByte < 0 || span.EndByte <= span.StartByte || span.EndByte > len(document.Body) ||
			!utf8.ValidString(document.Body[:span.StartByte]) || !utf8.ValidString(document.Body[:span.EndByte]) ||
			document.Body[span.StartByte:span.EndByte] != segment.Text {
			return nil
		}
		results[ordinal] = &descriptionSourceProvenance{
			WorkspaceID: document.WorkspaceID, SubjectID: subjectID,
			DocumentRevision: document.Revision, SegmentationProfile: profile,
			BodyDigest:         document.BodyDigest,
			BodyFieldStartByte: bodyFieldStart, BodyFieldEndByte: bodyFieldStart + len(document.Body),
			SourceStartByte: span.StartByte, SourceEndByte: span.EndByte,
			TextDigest: segment.TextDigest,
		}
		previousEnd = span.EndByte
	}
	if previousEnd != len(document.Body) {
		return nil
	}
	return results
}

func decodeDescriptionSourceSpan(raw json.RawMessage) (descriptionSourceSpan, error) {
	var span descriptionSourceSpan
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&span); err != nil {
		return descriptionSourceSpan{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return descriptionSourceSpan{}, errors.New("multiple source-span values")
		}
		return descriptionSourceSpan{}, err
	}
	return span, nil
}

func sha256Text(text string) string {
	sum := sha256.Sum256([]byte(text))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func marshalLexicalSegmentProjection(segments []SegmentRef, descriptions string) (string, error) {
	projection := lexicalSegmentProjection{
		SchemaVersion:         lexicalSegmentProjectionSchemaV1,
		DescriptionsFieldHash: sha256Text(descriptions),
		Segments:              segments,
	}
	data, err := json.Marshal(projection)
	if err != nil {
		return "", fmt.Errorf("encode lexical segment projection: %w", err)
	}
	return string(data), nil
}

type sourceByteRange struct{ start, end int }

// verifiedDescriptionFieldRanges validates the optional metadata as a whole
// before any description segment is trusted for source attribution.
func verifiedDescriptionFieldRanges(field string, fieldDigest string, segments []SegmentRef, subjectID string) map[string]sourceByteRange {
	if sha256Text(field) != fieldDigest || !utf8.ValidString(field) {
		return nil
	}
	type documentGroup struct {
		segments []SegmentRef
		first    descriptionSourceProvenance
	}
	groups := make(map[string]*documentGroup)
	for _, segment := range segments {
		if segment.SourceType != "DESCRIPTION" {
			continue
		}
		provenance := segment.DescriptionSource
		if provenance == nil || strings.TrimSpace(segment.DescriptionDocumentID) == "" {
			return nil
		}
		group := groups[segment.DescriptionDocumentID]
		if group == nil {
			group = &documentGroup{first: *provenance}
			groups[segment.DescriptionDocumentID] = group
		} else if group.first != *provenance {
			// Per-segment source bounds differ; compare the document-wide
			// bindings explicitly below and retain the source bounds per row.
			first := group.first
			first.SourceStartByte, first.SourceEndByte, first.TextDigest = provenance.SourceStartByte, provenance.SourceEndByte, provenance.TextDigest
			if first != *provenance {
				return nil
			}
		}
		group.segments = append(group.segments, segment)
	}
	result := make(map[string]sourceByteRange)
	for documentID, group := range groups {
		first := group.first
		if first.WorkspaceID == "" || first.SubjectID != subjectID || first.DocumentRevision < 1 ||
			first.SegmentationProfile == "" || !validSHA256Text(first.BodyDigest) ||
			first.BodyFieldStartByte < 0 || first.BodyFieldEndByte <= first.BodyFieldStartByte || first.BodyFieldEndByte > len(field) ||
			!utf8.ValidString(field[:first.BodyFieldStartByte]) || !utf8.ValidString(field[:first.BodyFieldEndByte]) ||
			sha256Text(field[first.BodyFieldStartByte:first.BodyFieldEndByte]) != first.BodyDigest {
			return nil
		}
		previous := 0
		for ordinal, segment := range group.segments {
			provenance := segment.DescriptionSource
			if segment.Ordinal != int64(ordinal) || segment.SegmentID == "" || segment.DescriptionDocumentID != documentID ||
				provenance.WorkspaceID != first.WorkspaceID || provenance.SubjectID != first.SubjectID ||
				provenance.DocumentRevision != first.DocumentRevision || provenance.SegmentationProfile != first.SegmentationProfile ||
				provenance.BodyDigest != first.BodyDigest || provenance.BodyFieldStartByte != first.BodyFieldStartByte ||
				provenance.BodyFieldEndByte != first.BodyFieldEndByte || provenance.SourceStartByte != previous ||
				provenance.SourceEndByte <= provenance.SourceStartByte ||
				provenance.SourceEndByte-provenance.SourceStartByte != len(segment.MatchedText) ||
				!validSHA256Text(provenance.TextDigest) || sha256Text(segment.MatchedText) != provenance.TextDigest || !utf8.ValidString(segment.MatchedText) {
				return nil
			}
			bodyStart := first.BodyFieldStartByte
			start, end := bodyStart+provenance.SourceStartByte, bodyStart+provenance.SourceEndByte
			if end > first.BodyFieldEndByte || !utf8.ValidString(field[bodyStart:start]) || !utf8.ValidString(field[bodyStart:end]) ||
				field[start:end] != segment.MatchedText {
				return nil
			}
			if _, duplicate := result[segment.SegmentID]; duplicate {
				return nil
			}
			result[segment.SegmentID] = sourceByteRange{start: start, end: end}
			previous = provenance.SourceEndByte
		}
		if previous != first.BodyFieldEndByte-first.BodyFieldStartByte {
			return nil
		}
	}
	return result
}

func validSHA256Text(value string) bool {
	if len(value) != len("sha256:")+sha256.Size*2 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}
