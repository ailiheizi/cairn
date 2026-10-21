package sqlite

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// DescriptionSummaryPosition is the stable keyset boundary for the ordered
// summary projection. It is intended to be carried only inside an authenticated
// continuation token.
type DescriptionSummaryPosition struct {
	SubjectRef string
	Revision   int64
	DocumentID string
}

// DescriptionSummaryPage contains bounded summary rows and facts calculated
// from the same SQLite read transaction.
type DescriptionSummaryPage struct {
	Documents     []DescriptionDocument
	ProjectionRef string
	Total         int
	HasMore       bool
	Next          DescriptionSummaryPosition
}

type descriptionProjectionHeader struct {
	WorkspaceID string `json:"workspace_id"`
	SubjectRef  string `json:"subject_ref,omitempty"`
	CurrentOnly bool   `json:"current_only"`
	Mode        string `json:"mode"`
	Order       string `json:"order"`
}

// descriptionProjectionSummary mirrors every field exposed by
// DescriptionSummaryData. Body and segment text are deliberately absent.
type descriptionProjectionSummary struct {
	ID                    string   `json:"description_document_id"`
	WorkspaceID           string   `json:"workspace_id"`
	SubjectRef            string   `json:"subject_ref"`
	Kind                  string   `json:"kind"`
	Title                 string   `json:"title,omitempty"`
	Language              string   `json:"language"`
	BodyDigest            string   `json:"body_digest"`
	SourceRef             string   `json:"source_ref,omitempty"`
	ProducerProfile       string   `json:"producer_profile,omitempty"`
	ConfigDigest          string   `json:"config_digest,omitempty"`
	ProducerProfileDigest string   `json:"producer_profile_digest,omitempty"`
	Confidence            *float64 `json:"confidence,omitempty"`
	Coverage              *float64 `json:"coverage,omitempty"`
	Visibility            string   `json:"visibility"`
	Accepted              bool     `json:"accepted"`
	Revision              int64    `json:"revision"`
	PredecessorID         string   `json:"predecessor_id,omitempty"`
	CreatedAt             string   `json:"created_at,omitempty"`
	UpdatedAt             string   `json:"updated_at,omitempty"`
}

func descriptionProjectionQuery(workspaceID, subjectRef string, currentOnly bool) (string, []any) {
	query := `SELECT d.description_document_id, d.workspace_id, d.subject_ref, d.kind, d.title,
       d.language, d.body_digest, d.source_ref, d.producer_profile, d.confidence,
       d.config_digest, d.producer_profile_digest, d.coverage, d.visibility, d.accepted,
       d.revision, d.predecessor_id, d.created_at_ns, d.updated_at_ns
FROM description_documents AS d WHERE d.workspace_id = ?`
	args := []any{workspaceID}
	if strings.TrimSpace(subjectRef) != "" {
		query += ` AND d.subject_ref = ?`
		args = append(args, subjectRef)
	}
	if currentOnly {
		query += ` AND NOT EXISTS (
    SELECT 1 FROM description_documents AS successor
    WHERE successor.workspace_id = d.workspace_id
      AND successor.subject_ref = d.subject_ref
      AND successor.predecessor_id = d.description_document_id
)`
	}
	return query, args
}

// ListCurrentDescriptionSummaries returns a bounded current-leaf projection.
// The NOT EXISTS predicate is evaluated against the full revision chain, not
// the requested result window.
func (s *Store) ListCurrentDescriptionSummaries(ctx context.Context, workspaceID, subjectRef string, limit int) ([]DescriptionDocument, error) {
	if err := requireID("workspace id", workspaceID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(subjectRef) != "" {
		if err := requireID("subject ref", subjectRef); err != nil {
			return nil, err
		}
	}
	if limit < 1 || limit > 1001 {
		return nil, errors.New("current description summary limit must be between 1 and 1001")
	}
	query, args := descriptionProjectionQuery(workspaceID, subjectRef, true)
	query += ` ORDER BY d.subject_ref COLLATE BINARY, d.revision, d.description_document_id COLLATE BINARY LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list current description summaries: %w", err)
	}
	defer rows.Close()
	result := make([]DescriptionDocument, 0, limit)
	for rows.Next() {
		document, err := scanDescriptionSummary(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, document)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate current description summaries: %w", err)
	}
	return result, nil
}

// ListDescriptionSummaryPage fingerprints the complete ordered metadata
// projection and reads one keyset page from the same read transaction. No body
// or segment text is selected.
func (s *Store) ListDescriptionSummaryPage(ctx context.Context, workspaceID, subjectRef string, currentOnly bool, limit int, after *DescriptionSummaryPosition) (DescriptionSummaryPage, error) {
	var result DescriptionSummaryPage
	if err := requireID("workspace id", workspaceID); err != nil {
		return result, err
	}
	if strings.TrimSpace(subjectRef) != "" {
		if err := requireID("subject ref", subjectRef); err != nil {
			return result, err
		}
	}
	if limit < 1 || limit > 1000 {
		return result, errors.New("description summary page limit must be between 1 and 1000")
	}
	if after != nil && (strings.TrimSpace(after.SubjectRef) == "" || strings.TrimSpace(after.DocumentID) == "" || after.Revision < 1) {
		return result, errors.New("description summary page position is invalid")
	}
	if after != nil {
		if err := requireID("description page subject ref", after.SubjectRef); err != nil {
			return result, err
		}
		if err := requireID("description page document id", after.DocumentID); err != nil {
			return result, err
		}
		if subjectRef != "" && after.SubjectRef != subjectRef {
			return result, errors.New("description summary page position is outside the requested subject")
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, fmt.Errorf("begin description summary read: %w", err)
	}
	defer tx.Rollback()

	projection := sha256.New()
	header, err := json.Marshal(descriptionProjectionHeader{
		WorkspaceID: workspaceID,
		SubjectRef:  subjectRef,
		CurrentOnly: currentOnly,
		Mode:        "page",
		Order:       "subject_ref,revision,description_document_id",
	})
	if err != nil {
		return result, err
	}
	writeProjectionBytes(projection, header)

	query, args := descriptionProjectionQuery(workspaceID, subjectRef, currentOnly)
	query += ` ORDER BY d.subject_ref COLLATE BINARY, d.revision, d.description_document_id COLLATE BINARY`
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return result, fmt.Errorf("fingerprint description summary projection: %w", err)
	}
	for rows.Next() {
		document, scanErr := scanDescriptionSummary(rows)
		if scanErr != nil {
			rows.Close()
			return result, scanErr
		}
		encoded, marshalErr := json.Marshal(descriptionProjectionSummary{
			ID: document.ID, WorkspaceID: document.WorkspaceID, SubjectRef: document.SubjectRef,
			Kind: string(document.Kind), Title: document.Title, Language: document.Language,
			BodyDigest: document.BodyDigest, SourceRef: document.SourceRef,
			ProducerProfile: document.ProducerProfile, ConfigDigest: document.ConfigDigest,
			ProducerProfileDigest: document.ProducerProfileDigest, Confidence: document.Confidence,
			Coverage: document.Coverage, Visibility: document.Visibility, Accepted: document.Accepted,
			Revision: document.Revision, PredecessorID: document.PredecessorID,
			CreatedAt: document.CreatedAt.UTC().Format(time.RFC3339),
			UpdatedAt: document.UpdatedAt.UTC().Format(time.RFC3339),
		})
		if marshalErr != nil {
			rows.Close()
			return result, marshalErr
		}
		writeProjectionBytes(projection, encoded)
		result.Total++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, fmt.Errorf("iterate description summary projection: %w", err)
	}
	if err := rows.Close(); err != nil {
		return result, fmt.Errorf("close description summary projection: %w", err)
	}
	var totalBytes [8]byte
	binary.BigEndian.PutUint64(totalBytes[:], uint64(result.Total))
	writeProjectionBytes(projection, totalBytes[:])
	result.ProjectionRef = "sha256:" + hex.EncodeToString(projection.Sum(nil))

	pageQuery, pageArgs := descriptionProjectionQuery(workspaceID, subjectRef, currentOnly)
	if after != nil {
		pageQuery += ` AND (d.subject_ref COLLATE BINARY > ? OR
    (d.subject_ref COLLATE BINARY = ? AND (d.revision > ? OR
    (d.revision = ? AND d.description_document_id COLLATE BINARY > ?))))`
		pageArgs = append(pageArgs, after.SubjectRef, after.SubjectRef, after.Revision, after.Revision, after.DocumentID)
	}
	pageQuery += ` ORDER BY d.subject_ref COLLATE BINARY, d.revision, d.description_document_id COLLATE BINARY LIMIT ?`
	pageArgs = append(pageArgs, limit+1)
	pageRows, err := tx.QueryContext(ctx, pageQuery, pageArgs...)
	if err != nil {
		return result, fmt.Errorf("read description summary page: %w", err)
	}
	defer pageRows.Close()
	result.Documents = make([]DescriptionDocument, 0, limit)
	for pageRows.Next() {
		document, scanErr := scanDescriptionSummary(pageRows)
		if scanErr != nil {
			return result, scanErr
		}
		if len(result.Documents) == limit {
			result.HasMore = true
			break
		}
		result.Documents = append(result.Documents, document)
	}
	if err := pageRows.Err(); err != nil {
		return result, fmt.Errorf("iterate description summary page: %w", err)
	}
	if result.HasMore && len(result.Documents) > 0 {
		last := result.Documents[len(result.Documents)-1]
		result.Next = DescriptionSummaryPosition{SubjectRef: last.SubjectRef, Revision: last.Revision, DocumentID: last.ID}
	}
	return result, nil
}

func writeProjectionBytes(destination interface{ Write([]byte) (int, error) }, value []byte) {
	var size [8]byte
	binary.BigEndian.PutUint64(size[:], uint64(len(value)))
	_, _ = destination.Write(size[:])
	_, _ = destination.Write(value)
}
