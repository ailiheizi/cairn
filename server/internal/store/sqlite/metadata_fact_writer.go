package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Metadata facts are immutable: the writer never updates or deletes a row, and
// the table triggers reject both. A changed file therefore appends a new
// revision for the same (subject, namespace, fact_key) chain, while re-reading
// an unchanged file appends nothing. This file is the production writer; the
// reader and the schema live in descriptions.go and migrations.go.

// RecordMetadataFactRevision inserts one fact as the next revision of its
// chain and reports whether a row was written. A fact whose value, value type,
// and producing artifact are identical to the latest revision is already
// durable and writes nothing; any difference appends revision N+1. The record's
// Revision field is overwritten with the revision that was written (or that
// already existed).
func (tx *Tx) RecordMetadataFactRevision(ctx context.Context, record *MetadataFact) (bool, error) {
	if record == nil {
		return false, errors.New("metadata fact is required")
	}
	latestRevision, latestValue, latestType, latestSource, found, err := tx.latestMetadataFactRevision(ctx, record)
	if err != nil {
		return false, err
	}
	if found {
		if latestType == record.ValueType && latestSource == record.SourceRef && bytes.Equal(latestValue, factValueForComparison(record.Value)) {
			record.Revision = latestRevision
			return false, nil
		}
		record.Revision = latestRevision + 1
	} else {
		record.Revision = 1
	}
	if err := tx.InsertMetadataFact(ctx, record); err != nil {
		return false, err
	}
	return true, nil
}

// RecordMetadataFactRevisions writes a batch inside the caller's transaction.
func (tx *Tx) RecordMetadataFactRevisions(ctx context.Context, records []MetadataFact) (int, error) {
	written := 0
	for index := range records {
		inserted, err := tx.RecordMetadataFactRevision(ctx, &records[index])
		if err != nil {
			return written, err
		}
		if inserted {
			written++
		}
	}
	return written, nil
}

func (tx *Tx) latestMetadataFactRevision(ctx context.Context, record *MetadataFact) (int64, []byte, string, string, bool, error) {
	if err := requireID("workspace id", record.WorkspaceID); err != nil {
		return 0, nil, "", "", false, err
	}
	if err := requireID("subject ref", record.SubjectRef); err != nil {
		return 0, nil, "", "", false, err
	}
	var revision int64
	var value string
	var valueType string
	var sourceRef string
	err := tx.tx.QueryRowContext(ctx, `
SELECT revision, value_json, value_type, source_ref
FROM metadata_facts
WHERE workspace_id = ? AND subject_ref = ? AND namespace = ? AND fact_key = ?
ORDER BY revision DESC
LIMIT 1`,
		record.WorkspaceID, record.SubjectRef, record.Namespace, record.Key,
	).Scan(&revision, &value, &valueType, &sourceRef)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil, "", "", false, nil
	}
	if err != nil {
		return 0, nil, "", "", false, fmt.Errorf("read latest metadata fact revision: %w", err)
	}
	return revision, []byte(value), valueType, sourceRef, true, nil
}

// factValueForComparison mirrors the normalization InsertMetadataFact applies,
// so a comparison against the stored form never reports a difference that the
// writer itself would not have stored.
func factValueForComparison(value []byte) []byte {
	normalized, err := normalizeJSON(value)
	if err != nil {
		return append([]byte(nil), value...)
	}
	return normalized
}
