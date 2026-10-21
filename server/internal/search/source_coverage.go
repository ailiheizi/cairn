package search

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	_ "modernc.org/sqlite"
)

const (
	SourceCoverageScopeLexicalSelectedTextV1 = "LEXICAL_SELECTED_TEXT_V1"
	sourceCoverageProjectionVersion          = 1
	SourceCoverageDetailLimit                = 256
)

type SourceCoverageDisposition string

const (
	SourceCoverageIndexed     SourceCoverageDisposition = "INDEXED"
	SourceCoverageMissing     SourceCoverageDisposition = "MISSING"
	SourceCoverageUnavailable SourceCoverageDisposition = "UNAVAILABLE"
)

const (
	SourceCoverageReasonLegacyProjection   = "LEGACY_PROJECTION"
	SourceCoverageReasonSourceProofInvalid = "SOURCE_PROOF_INVALID"
	SourceCoverageReasonSourceMissing      = "SOURCE_MISSING"
	SourceCoverageReasonSourceChanged      = "SOURCE_CHANGED"
	SourceCoverageReasonFieldMissing       = "FIELD_MISSING"
	SourceCoverageReasonFieldChanged       = "FIELD_CHANGED"
	SourceCoverageReasonSourceProofMissing = "SOURCE_PROOF_MISSING"
	SourceCoverageReasonAnchorMissing      = "SOURCE_ANCHOR_MISSING"
)

// SourceCoverageRow identifies one selected durable text source in one lexical
// generation. SourceDigest is SHA-256 over the selected source bytes. For
// DESCRIPTION rows SourceSubtype is the exact durable DescriptionKind.
type SourceCoverageRow struct {
	SourceKind    string                    `json:"source_kind"`
	SourceSubtype string                    `json:"source_subtype,omitempty"`
	Field         string                    `json:"field"`
	SourceRef     string                    `json:"source_ref"`
	Revision      string                    `json:"revision"`
	SourceDigest  string                    `json:"source_digest"`
	Disposition   SourceCoverageDisposition `json:"disposition"`
	Reason        string                    `json:"reason,omitempty"`
}

// SourceCoverageStatement is lexical-source lineage for exactly one supplied
// immutable generation. It makes no claim about semantic receipt coverage.
type SourceCoverageStatement struct {
	Scope           string              `json:"scope"`
	GenerationID    string              `json:"generation_id,omitempty"`
	SnapshotRef     string              `json:"snapshot_ref,omitempty"`
	NamespaceRootID string              `json:"namespace_root_id,omitempty"`
	ConfigDigest    string              `json:"config_digest,omitempty"`
	ProfileDigest   string              `json:"profile_digest,omitempty"`
	Available       bool                `json:"available"`
	Complete        bool                `json:"complete"`
	Expected        int                 `json:"expected"`
	Indexed         int                 `json:"indexed"`
	Excluded        int                 `json:"excluded"`
	Missing         int                 `json:"missing"`
	Unavailable     int                 `json:"unavailable"`
	Truncated       bool                `json:"truncated"`
	Rows            []SourceCoverageRow `json:"rows,omitempty"`
	Reason          string              `json:"reason,omitempty"`
	Notes           string              `json:"notes,omitempty"`
}

type sourceCoverageProof struct {
	SourceCoverageVersion int                    `json:"source_coverage_version"`
	Scope                 string                 `json:"scope"`
	GenerationID          string                 `json:"generation_id"`
	WorkspaceID           string                 `json:"workspace_id"`
	SnapshotRef           string                 `json:"snapshot_ref"`
	NamespaceRootID       string                 `json:"namespace_root_id"`
	ConfigDigest          string                 `json:"config_digest"`
	ProfileDigest         string                 `json:"profile_digest"`
	Rows                  []sourceCoverageRecord `json:"rows"`
	InventoryDigest       string                 `json:"inventory_digest"`
}

type lexicalSourceCoverageProjection struct {
	Version         int                  `json:"version"`
	Role            string               `json:"role"`
	GenerationID    string               `json:"generation_id"`
	WorkspaceID     string               `json:"workspace_id"`
	InventoryDigest string               `json:"inventory_digest"`
	Inventory       *sourceCoverageProof `json:"inventory,omitempty"`
}

type sourceCoverageRecord struct {
	SourceCoverageRow
	SubjectID   string `json:"subject_id"`
	DocumentRef string `json:"document_ref,omitempty"`
	SourceBytes string `json:"-"`
	FieldStart  int    `json:"field_start_byte"`
	FieldEnd    int    `json:"field_end_byte"`
	FieldDigest string `json:"field_digest"`
}

type sourceCoverageCandidate struct {
	SourceKind    string
	SourceSubtype string
	Field         string
	SourceRef     string
	Revision      string
	SourceBytes   string
	StoredDigest  string
	DocumentRef   string
	FieldStart    int
	FieldEnd      int
}

func appendSourceCoverageCandidate(bySubject map[string][]sourceCoverageCandidate, subject, kind, subtype, field, ref, revision, body, storedDigest string, start int) {
	bySubject[subject] = append(bySubject[subject], sourceCoverageCandidate{
		SourceKind: kind, SourceSubtype: subtype, Field: field, SourceRef: ref,
		Revision: revision, SourceBytes: body, StoredDigest: storedDigest, FieldStart: start, FieldEnd: start + len(body),
	})
}

func makeSourceCoverageRecords(subjectID string, candidates []sourceCoverageCandidate, fields map[string]string) []sourceCoverageRecord {
	records := make([]sourceCoverageRecord, 0, len(candidates))
	fieldDigests := make(map[string]string, len(fields))
	for name, value := range fields {
		fieldDigests[name] = sha256Text(value)
	}
	for _, candidate := range candidates {
		disposition, reason := SourceCoverageIndexed, ""
		if candidate.StoredDigest != "" && candidate.StoredDigest != sha256Text(candidate.SourceBytes) {
			disposition, reason = SourceCoverageUnavailable, SourceCoverageReasonSourceChanged
		} else if candidate.StoredDigest == "" && (candidate.SourceKind == "TAG" || candidate.SourceKind == "NOTE" || candidate.SourceKind == "DESCRIPTION" || candidate.SourceKind == "EXTRACT") {
			disposition, reason = SourceCoverageUnavailable, SourceCoverageReasonSourceProofMissing
		}
		fieldDigest := ""
		if _, ok := fields[candidate.Field]; ok {
			fieldDigest = fieldDigests[candidate.Field]
		} else {
			disposition, reason = SourceCoverageUnavailable, SourceCoverageReasonFieldMissing
		}
		records = append(records, sourceCoverageRecord{
			SourceCoverageRow: SourceCoverageRow{
				SourceKind: candidate.SourceKind, SourceSubtype: candidate.SourceSubtype,
				Field: candidate.Field, SourceRef: candidate.SourceRef, Revision: candidate.Revision,
				SourceDigest: sha256Text(candidate.SourceBytes), Disposition: disposition, Reason: reason,
			},
			SubjectID: subjectID, DocumentRef: candidate.DocumentRef, SourceBytes: candidate.SourceBytes,
			FieldStart: candidate.FieldStart, FieldEnd: candidate.FieldEnd,
			FieldDigest: fieldDigest,
		})
	}
	return records
}

func sourceCoverageDigest(proof sourceCoverageProof) string {
	proof.InventoryDigest = ""
	rows := append([]sourceCoverageRecord(nil), proof.Rows...)
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		return sourceCoverageIdentity(a) < sourceCoverageIdentity(b)
	})
	proof.Rows = rows
	b, _ := json.Marshal(proof)
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func validSourceCoverageRecord(row sourceCoverageRecord) bool {
	if row.SubjectID == "" || row.SourceRef == "" || row.Field == "" || row.SourceKind == "" ||
		!validSHA256Text(row.SourceDigest) || !validSHA256Text(row.FieldDigest) ||
		row.FieldStart < 0 || row.FieldEnd < row.FieldStart {
		return false
	}
	if row.Disposition == SourceCoverageIndexed && row.Reason != "" {
		return false
	}
	if row.Disposition == SourceCoverageUnavailable && row.Reason != SourceCoverageReasonSourceChanged && row.Reason != SourceCoverageReasonSourceProofMissing {
		return false
	}
	if row.Disposition != SourceCoverageIndexed && row.Disposition != SourceCoverageUnavailable {
		return false
	}
	switch row.SourceKind {
	case "FILENAME", "EXTRACT":
		return row.Revision == row.SourceRef && row.SourceSubtype == "" &&
			((row.SourceKind == "FILENAME" && row.Field == "name" && row.DocumentRef == row.SourceRef) ||
				(row.SourceKind == "EXTRACT" && row.Field == "extracted" && row.DocumentRef == ""))
	case "TAG", "NOTE", "DESCRIPTION":
		revision, err := strconv.ParseInt(row.Revision, 10, 64)
		if err != nil || revision < 1 || strconv.FormatInt(revision, 10) != row.Revision || row.DocumentRef != "" {
			return false
		}
		if row.SourceKind == "TAG" {
			return row.SourceSubtype == "" && row.Field == "tags"
		}
		if row.SourceKind == "NOTE" {
			return row.SourceSubtype == "" && row.Field == "notes"
		}
		switch sqlite.DescriptionKind(row.SourceSubtype) {
		case sqlite.DescriptionUser, sqlite.DescriptionImported, sqlite.DescriptionExtracted, sqlite.DescriptionAISummary, sqlite.DescriptionAIAnalysis:
			return row.Field == "descriptions"
		default:
			return false
		}
	default:
		return false
	}
}

func sourceCoverageIdentity(row sourceCoverageRecord) string {
	return strings.Join([]string{row.SubjectID, row.DocumentRef, row.SourceKind, row.SourceSubtype, row.Field, row.SourceRef, row.Revision}, "\x00")
}

func deduplicateSourceCoverageRows(rows []sourceCoverageRecord) []sourceCoverageRecord {
	seen := map[string]sourceCoverageRecord{}
	result := make([]sourceCoverageRecord, 0, len(rows))
	for _, row := range rows {
		key := sourceCoverageIdentity(row)
		previous, exists := seen[key]
		if !exists {
			seen[key] = row
			result = append(result, row)
			continue
		}
		if previous.SourceDigest == row.SourceDigest && previous.FieldDigest == row.FieldDigest &&
			previous.FieldStart == row.FieldStart && previous.FieldEnd == row.FieldEnd &&
			previous.Disposition == row.Disposition && previous.Reason == row.Reason {
			continue
		}
		// Preserve conflicting duplicates. The generation remains searchable,
		// while the coverage reader rejects this proof as unavailable.
		result = append(result, row)
	}
	return result
}

func measureSourceCoverage(ctx context.Context, generation sqlite.IndexGeneration, dbPath string) (SourceCoverageStatement, error) {
	statement := SourceCoverageStatement{
		Scope:        SourceCoverageScopeLexicalSelectedTextV1,
		GenerationID: generation.ID, SnapshotRef: generation.SnapshotRef,
		NamespaceRootID: generation.NamespaceRootID, ConfigDigest: generation.ConfigDigest,
		ProfileDigest: generation.ProviderProfileDigest,
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return statement, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `SELECT subject_id, name, tags, notes, descriptions, extracted, segments FROM documents ORDER BY rowid`)
	if err != nil {
		return statement, err
	}
	defer rows.Close()
	type actualDocument struct {
		subjectID, documentRef string
		fields                 map[string]string
		fieldDigests           map[string]string
	}
	actualBySubject := map[string]actualDocument{}
	actualByDocumentRef := map[string]actualDocument{}
	conflictingFields := map[string]bool{}
	var anchor *sourceCoverageProof
	markerDigest := ""
	markerSeen := false
	for rows.Next() {
		var subjectID, name, tags, notes, descriptions, extracted, rawProjection string
		if err := rows.Scan(&subjectID, &name, &tags, &notes, &descriptions, &extracted, &rawProjection); err != nil {
			return statement, err
		}
		var projection lexicalSegmentProjection
		if err := json.Unmarshal([]byte(rawProjection), &projection); err != nil || projection.SchemaVersion != lexicalSegmentProjectionSchemaV1 {
			statement.Reason = SourceCoverageReasonLegacyProjection
			statement.Notes = "lexical generation has no versioned source coverage inventory"
			return statement, nil
		}
		if len(projection.SourceCoverage) == 0 {
			statement.Reason = SourceCoverageReasonLegacyProjection
			statement.Notes = "lexical generation has no source coverage inventory"
			return statement, nil
		}
		var marker lexicalSourceCoverageProjection
		if err := json.Unmarshal(projection.SourceCoverage, &marker); err != nil || marker.Version != sourceCoverageProjectionVersion ||
			marker.GenerationID != generation.ID || marker.WorkspaceID != generation.WorkspaceID || marker.InventoryDigest == "" {
			statement.Reason = SourceCoverageReasonSourceProofInvalid
			statement.Notes = "source coverage generation marker is invalid"
			return statement, nil
		}
		if markerDigest == "" {
			markerDigest = marker.InventoryDigest
		} else if markerDigest != marker.InventoryDigest {
			statement.Reason = SourceCoverageReasonSourceProofInvalid
			statement.Notes = "generation rows disagree on the source inventory digest"
			return statement, nil
		}
		markerSeen = true
		switch marker.Role {
		case "ANCHOR":
			if anchor != nil || marker.Inventory == nil {
				statement.Reason = SourceCoverageReasonSourceProofInvalid
				statement.Notes = "source coverage anchor is missing or duplicated"
				return statement, nil
			}
			proof := marker.Inventory
			if proof.SourceCoverageVersion != sourceCoverageProjectionVersion || proof.Scope != SourceCoverageScopeLexicalSelectedTextV1 ||
				proof.GenerationID != generation.ID || proof.WorkspaceID != generation.WorkspaceID || proof.SnapshotRef != generation.SnapshotRef ||
				proof.NamespaceRootID != generation.NamespaceRootID || proof.ConfigDigest != generation.ConfigDigest ||
				proof.ProfileDigest != generation.ProviderProfileDigest || proof.InventoryDigest != marker.InventoryDigest ||
				proof.InventoryDigest != sourceCoverageDigest(*proof) || len(proof.Rows) == 0 {
				statement.Reason = SourceCoverageReasonSourceProofInvalid
				statement.Notes = "source coverage anchor binding or inventory digest is invalid"
				return statement, nil
			}
			anchor = proof
		case "FRAGMENT":
			if marker.Inventory != nil {
				statement.Reason = SourceCoverageReasonSourceProofInvalid
				statement.Notes = "source coverage fragment unexpectedly contains an inventory"
				return statement, nil
			}
		default:
			statement.Reason = SourceCoverageReasonSourceProofInvalid
			statement.Notes = "source coverage marker role is invalid"
			return statement, nil
		}
		actualFields := map[string]string{"name": name, "tags": tags, "notes": notes, "descriptions": descriptions, "extracted": extracted}
		actual := actualDocument{subjectID: subjectID, documentRef: projection.DocumentRef, fields: actualFields,
			fieldDigests: make(map[string]string, len(actualFields))}
		for fieldName, fieldValue := range actualFields {
			actual.fieldDigests[fieldName] = sha256Text(fieldValue)
		}
		if previous, ok := actualBySubject[subjectID]; ok {
			for _, fieldName := range []string{"tags", "notes", "descriptions", "extracted"} {
				if previous.fields[fieldName] != actual.fields[fieldName] {
					conflictingFields[subjectID+"\x00"+fieldName] = true
				}
			}
		} else {
			actualBySubject[subjectID] = actual
		}
		if projection.DocumentRef != "" {
			if _, duplicate := actualByDocumentRef[projection.DocumentRef]; duplicate {
				statement.Reason = SourceCoverageReasonSourceProofInvalid
				statement.Notes = "duplicate document references in lexical generation"
				return statement, nil
			}
			actualByDocumentRef[projection.DocumentRef] = actual
		}
	}
	if err := rows.Err(); err != nil {
		return statement, err
	}
	if !markerSeen || anchor == nil || len(anchor.Rows) == 0 {
		statement.Reason = SourceCoverageReasonAnchorMissing
		statement.Notes = "lexical generation has no surviving source inventory anchor"
		return statement, nil
	}
	byIdentity := map[string]sourceCoverageRecord{}
	for _, expected := range anchor.Rows {
		if !validSourceCoverageRecord(expected) || expected.SubjectID == "" ||
			(expected.SourceKind == "FILENAME" && expected.DocumentRef != expected.SourceRef) {
			statement.Reason = SourceCoverageReasonSourceProofInvalid
			statement.Notes = "source coverage inventory contains an invalid identity or span"
			return statement, nil
		}
		key := sourceCoverageIdentity(expected)
		if _, duplicate := byIdentity[key]; duplicate {
			statement.Reason = SourceCoverageReasonSourceProofInvalid
			statement.Notes = "source coverage inventory contains duplicate identities"
			return statement, nil
		}
		var document actualDocument
		foundDocument := false
		if expected.DocumentRef != "" {
			document, foundDocument = actualByDocumentRef[expected.DocumentRef]
			foundDocument = foundDocument && document.subjectID == expected.SubjectID
		} else {
			document, foundDocument = actualBySubject[expected.SubjectID]
		}
		measured := expected
		if !foundDocument {
			measured.Disposition, measured.Reason = SourceCoverageMissing, SourceCoverageReasonSourceMissing
		} else if conflictingFields[expected.SubjectID+"\x00"+expected.Field] {
			measured.Disposition, measured.Reason = SourceCoverageMissing, SourceCoverageReasonFieldChanged
		} else if field, ok := document.fields[expected.Field]; !ok {
			measured.Disposition, measured.Reason = SourceCoverageMissing, SourceCoverageReasonFieldMissing
		} else if document.fieldDigests[expected.Field] != expected.FieldDigest {
			measured.Disposition, measured.Reason = SourceCoverageMissing, SourceCoverageReasonFieldChanged
		} else if expected.FieldEnd > len(field) || !validUTF8Boundary(field, expected.FieldStart) || !validUTF8Boundary(field, expected.FieldEnd) {
			measured.Disposition, measured.Reason = SourceCoverageMissing, SourceCoverageReasonSourceMissing
		} else if sha256Text(field[expected.FieldStart:expected.FieldEnd]) != expected.SourceDigest {
			measured.Disposition, measured.Reason = SourceCoverageMissing, SourceCoverageReasonSourceChanged
		}
		byIdentity[key] = measured
	}
	finalizeSourceCoverage(&statement, byIdentity)
	statement.Notes = "lexical selected-source coverage is measured against this generation's immutable inventory"
	return statement, nil
}

func finalizeSourceCoverage(statement *SourceCoverageStatement, records map[string]sourceCoverageRecord) {
	statement.Available = true
	allIndexed := true
	for _, row := range records {
		statement.Expected++
		switch row.Disposition {
		case SourceCoverageIndexed:
			statement.Indexed++
		case SourceCoverageMissing:
			statement.Missing++
			allIndexed = false
		case SourceCoverageUnavailable:
			statement.Unavailable++
			allIndexed = false
		default:
			statement.Unavailable++
			allIndexed = false
		}
	}
	statement.Complete = statement.Expected > 0 && allIndexed
	statement.Rows = sortedSourceCoverageDetails(records, &statement.Truncated)
}

func validUTF8Boundary(value string, offset int) bool {
	return offset >= 0 && offset <= len(value) && (offset == 0 || offset == len(value) || value[offset]&0xc0 != 0x80)
}

func sortedSourceCoverageDetails(records map[string]sourceCoverageRecord, truncated *bool) []SourceCoverageRow {
	all := make([]sourceCoverageRecord, 0, len(records))
	for _, record := range records {
		all = append(all, record)
	}
	sort.Slice(all, func(i, j int) bool {
		badI := all[i].Disposition != SourceCoverageIndexed
		badJ := all[j].Disposition != SourceCoverageIndexed
		if badI != badJ {
			return badI
		}
		return sourceCoverageIdentity(all[i]) < sourceCoverageIdentity(all[j])
	})
	limit := len(all)
	if limit > SourceCoverageDetailLimit {
		limit = SourceCoverageDetailLimit
		*truncated = true
	}
	result := make([]SourceCoverageRow, 0, limit)
	for _, record := range all[:limit] {
		result = append(result, record.SourceCoverageRow)
	}
	return result
}
