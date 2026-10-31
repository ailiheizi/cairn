package search

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

const semanticSourceCoverageScopeV1 = "SEMANTIC_SELECTED_TEXT_V1"

type SemanticSourceCoverageDisposition string

const (
	SemanticSourceIndexed     SemanticSourceCoverageDisposition = "INDEXED"
	SemanticSourceExcluded    SemanticSourceCoverageDisposition = "EXCLUDED"
	SemanticSourceMissing     SemanticSourceCoverageDisposition = "MISSING"
	SemanticSourceUnavailable SemanticSourceCoverageDisposition = "UNAVAILABLE"
)

const (
	SemanticSourceReasonTag                   = "TAG"
	SemanticSourceReasonEmptyText             = "EMPTY_TEXT"
	SemanticSourceReasonDescriptionRejected   = "DESCRIPTION_REJECTED"
	SemanticSourceReasonDescriptionSuperseded = "DESCRIPTION_SUPERSEDED"
	SemanticSourceReasonSourceDigestMissing   = "SOURCE_DIGEST_MISSING"
	SemanticSourceReasonSourceChanged         = "SOURCE_CHANGED"
	SemanticSourceReasonSegmentSetInvalid     = "SEGMENT_SET_INVALID"
	SemanticSourceReasonInputIdentityMismatch = "INPUT_IDENTITY_MISMATCH"
	SemanticSourceReasonInventoryInvalid      = "INVENTORY_INVALID"
	SemanticSourceReasonLegacyReceipt         = "LEGACY_RECEIPT_V1"
	SemanticSourceReasonInputProfileMismatch  = "INPUT_PROFILE_MISMATCH"
	SemanticSourceReasonInputCoverageUnknown  = "INPUT_COVERAGE_UNKNOWN"
	SemanticSourceReasonInputTruncated        = "INPUT_TRUNCATED"
)

// SemanticSourceCoverageStatement reports source lineage separately from
// pair-only SemanticCoverage. Counts include selected exclusions; Indexed
// counts eligible sources whose inputs are present and fully evidenced.
type SemanticSourceCoverageStatement struct {
	Scope           string                      `json:"scope"`
	GenerationID    string                      `json:"generation_id,omitempty"`
	SnapshotRef     string                      `json:"snapshot_ref,omitempty"`
	NamespaceRootID string                      `json:"namespace_root_id,omitempty"`
	ConfigDigest    string                      `json:"config_digest,omitempty"`
	ProfileDigest   string                      `json:"profile_digest,omitempty"`
	Available       bool                        `json:"available"`
	Complete        bool                        `json:"complete"`
	Expected        int                         `json:"expected"`
	Indexed         int                         `json:"indexed"`
	Excluded        int                         `json:"excluded"`
	Missing         int                         `json:"missing"`
	Unavailable     int                         `json:"unavailable"`
	InputFull       int                         `json:"input_full"`
	InputTruncated  int                         `json:"input_truncated"`
	InputUnknown    int                         `json:"input_unknown"`
	Truncated       bool                        `json:"truncated"`
	Rows            []SemanticSourceCoverageRow `json:"rows,omitempty"`
	Reason          string                      `json:"reason,omitempty"`
	Notes           string                      `json:"notes,omitempty"`
}

type SemanticSourceCoverageRow struct {
	SubjectID      string                            `json:"subject_id"`
	SourceKind     string                            `json:"source_kind"`
	SourceSubtype  string                            `json:"source_subtype,omitempty"`
	SourceRef      string                            `json:"source_ref"`
	Revision       string                            `json:"revision"`
	BodyDigest     string                            `json:"body_digest"`
	Disposition    SemanticSourceCoverageDisposition `json:"disposition"`
	Reason         string                            `json:"reason,omitempty"`
	SegmentCount   int                               `json:"segment_count"`
	SegmentIndexed int                               `json:"segment_indexed"`
	SegmentMissing int                               `json:"segment_missing"`
	InputFull      int                               `json:"input_full"`
	InputTruncated int                               `json:"input_truncated"`
	InputUnknown   int                               `json:"input_unknown"`
}

// semanticSourceInventoryRow and semanticSourceInputProof are disposable
// evidence committed alongside the existing immutable semantic receipt.
type semanticSourceInventoryRow struct {
	SubjectID                 string                            `json:"subject_id"`
	SourceKind                string                            `json:"source_kind"`
	SourceSubtype             string                            `json:"source_subtype,omitempty"`
	SourceRef                 string                            `json:"source_ref"`
	Revision                  string                            `json:"revision"`
	BodyDigest                string                            `json:"body_digest"`
	BodyLength                int64                             `json:"body_length"`
	Disposition               SemanticSourceCoverageDisposition `json:"disposition"`
	Reason                    string                            `json:"reason,omitempty"`
	Inputs                    []semanticSourceInputProof        `json:"inputs,omitempty"`
	SegmentationProfileDigest string                            `json:"segmentation_profile_digest,omitempty"`
}

type semanticSourceInputProof struct {
	SegmentID       string                            `json:"segment_id"`
	SegmentDigest   string                            `json:"segment_digest"`
	InputDigest     string                            `json:"input_digest"`
	SourceRef       string                            `json:"source_ref"`
	Ordinal         int64                             `json:"ordinal"`
	SourceRevision  string                            `json:"source_revision"`
	SourceSpanStart int                               `json:"source_span_start,omitempty"`
	SourceSpanEnd   int                               `json:"source_span_end,omitempty"`
	HasSourceSpan   bool                              `json:"has_source_span"`
	Disposition     SemanticSourceCoverageDisposition `json:"disposition"`
	Reason          string                            `json:"reason,omitempty"`
	InputEvidence   *SemanticInputEvidence            `json:"input_evidence,omitempty"`
}

type semanticSourceInventory struct {
	Rows []semanticSourceInventoryRow `json:"rows"`
}

func semanticSourceInputFromSegment(segment SegmentRef, sourceRef, revision string) semanticSourceInputProof {
	proof := semanticSourceInputProof{
		SegmentID: segment.SegmentID, SegmentDigest: sha256Text(segment.MatchedText),
		InputDigest: sha256Text(segment.MatchedText), SourceRef: sourceRef,
		Ordinal: segment.Ordinal, SourceRevision: revision,
	}
	if provenance := segment.DescriptionSource; provenance != nil {
		proof.SourceSpanStart, proof.SourceSpanEnd = provenance.SourceStartByte, provenance.SourceEndByte
		proof.HasSourceSpan = true
	}
	if provenance := segment.TextSourceProvenance; provenance != nil {
		proof.SourceSpanStart, proof.SourceSpanEnd = provenance.SourceStartByte, provenance.SourceEndByte
		proof.HasSourceSpan = true
	}
	if strings.TrimSpace(segment.SegmentID) == "" || strings.TrimSpace(segment.MatchedText) == "" {
		proof.Disposition, proof.Reason = SemanticSourceExcluded, SemanticSourceReasonEmptyText
	} else {
		proof.Disposition = SemanticSourceIndexed
	}
	return proof
}

func semanticSourceProofValid(row semanticSourceInventoryRow) bool {
	if row.SubjectID == "" || row.SourceKind == "" || row.SourceRef == "" || row.Revision == "" || row.BodyLength < 0 {
		return false
	}
	if !validSHA256Text(row.BodyDigest) && !(row.Disposition == SemanticSourceUnavailable && row.Reason == SemanticSourceReasonSourceDigestMissing) {
		return false
	}
	ocrProjected := row.SegmentationProfileDigest == semanticOCRTextProjectionProfileDigest
	segmented := row.SegmentationProfileDigest == semanticTextSourceSegmentationProfileDigest
	if row.SegmentationProfileDigest != "" && !segmented && !ocrProjected {
		return false
	}
	if segmented && ((row.SourceKind != "NOTE" && row.SourceKind != "EXTRACT") || row.BodyLength <= semanticTextSourceSegmentTargetBytes) {
		return false
	}
	if ocrProjected && row.SourceKind != "EXTRACT" {
		return false
	}
	switch row.SourceKind {
	case "FILENAME", "EXTRACT":
		if row.Revision != row.SourceRef || row.SourceSubtype != "" {
			return false
		}
	case "NOTE", "TAG", "DESCRIPTION":
		revision, err := strconv.ParseInt(row.Revision, 10, 64)
		if err != nil || revision < 1 || strconv.FormatInt(revision, 10) != row.Revision {
			return false
		}
		if row.SourceKind != "DESCRIPTION" && row.SourceSubtype != "" {
			return false
		}
		if row.SourceKind == "DESCRIPTION" {
			switch sqlite.DescriptionKind(row.SourceSubtype) {
			case sqlite.DescriptionUser, sqlite.DescriptionImported, sqlite.DescriptionExtracted, sqlite.DescriptionAISummary, sqlite.DescriptionAIAnalysis:
			default:
				return false
			}
		}
	default:
		return false
	}
	if row.Disposition == SemanticSourceExcluded {
		switch row.Reason {
		case SemanticSourceReasonTag, SemanticSourceReasonEmptyText, SemanticSourceReasonDescriptionRejected, SemanticSourceReasonDescriptionSuperseded:
			if len(row.Inputs) != 0 {
				return false
			}
			if row.SourceKind == "TAG" {
				return row.Reason == SemanticSourceReasonTag
			}
			if row.SourceKind == "DESCRIPTION" {
				return row.Reason == SemanticSourceReasonEmptyText || row.Reason == SemanticSourceReasonDescriptionRejected || row.Reason == SemanticSourceReasonDescriptionSuperseded
			}
			return row.Reason == SemanticSourceReasonEmptyText
		default:
			return false
		}
	}
	if row.Disposition != SemanticSourceIndexed && row.Disposition != SemanticSourceUnavailable && row.Disposition != SemanticSourceMissing {
		return false
	}
	if row.Disposition == SemanticSourceUnavailable {
		switch row.Reason {
		case SemanticSourceReasonSourceDigestMissing, SemanticSourceReasonSourceChanged, SemanticSourceReasonSegmentSetInvalid, SemanticSourceReasonInputIdentityMismatch, SemanticSourceReasonInputProfileMismatch, SemanticSourceReasonInputCoverageUnknown, SemanticSourceReasonInputTruncated:
		default:
			return false
		}
	}
	if row.Disposition == SemanticSourceMissing && row.Reason != SemanticSourceReasonInputIdentityMismatch {
		return false
	}
	if row.SourceKind == "TAG" && (row.Disposition != SemanticSourceExcluded || row.Reason != SemanticSourceReasonTag) {
		return false
	}
	if row.Disposition == SemanticSourceIndexed && row.Reason != "" {
		return false
	}
	seen := map[string]struct{}{}
	for _, input := range row.Inputs {
		if input.SegmentID == "" || !validSHA256Text(input.SegmentDigest) || !validSHA256Text(input.InputDigest) || input.SourceRef != row.SourceRef || input.SourceRevision != row.Revision {
			return false
		}
		if _, exists := seen[input.SegmentID]; exists {
			return false
		}
		seen[input.SegmentID] = struct{}{}
		if input.HasSourceSpan && (input.SourceSpanStart < 0 || input.SourceSpanEnd <= input.SourceSpanStart) {
			return false
		}
		if input.Disposition == SemanticSourceExcluded {
			if input.Reason != SemanticSourceReasonEmptyText || row.Disposition != SemanticSourceExcluded || row.Reason != SemanticSourceReasonEmptyText {
				return false
			}
		} else if input.Disposition != SemanticSourceIndexed {
			return false
		}
		if input.InputEvidence != nil && (input.InputEvidence.TextDigest != input.InputDigest || input.InputEvidence.SourceRef != input.SourceRef || input.InputEvidence.Ordinal != input.Ordinal) {
			return false
		}
		if row.SourceKind != "DESCRIPTION" && !segmented && !ocrProjected && input.Disposition == SemanticSourceIndexed && row.BodyDigest != input.InputDigest {
			return false
		}
		if segmented && input.Disposition == SemanticSourceIndexed {
			if !input.HasSourceSpan || input.Ordinal < 0 ||
				input.SegmentID != semanticTextSegmentID(row.SourceKind, row.SubjectID, row.SourceRef, row.Revision,
					row.BodyDigest, row.SegmentationProfileDigest, input.Ordinal, input.SourceSpanStart, input.SourceSpanEnd, input.InputDigest) {
				return false
			}
		}
		if ocrProjected && input.Disposition == SemanticSourceIndexed {
			if input.SegmentDigest != input.InputDigest || input.HasSourceSpan || input.SourceSpanStart != 0 || input.SourceSpanEnd != 0 || input.Ordinal < 0 ||
				input.SegmentID != semanticOCRTextSegmentID(row.SubjectID, row.SourceRef, row.Revision, row.BodyDigest, input.Ordinal, input.InputDigest) {
				return false
			}
		}
		if input.InputEvidence != nil {
			evidence := input.InputEvidence
			if !validSHA256Text(evidence.PreprocessingDigest) || !validSHA256Text(evidence.AppliedPreprocessingDigest) || evidence.InputTokens <= 0 || evidence.EmbeddedTokens <= 0 || evidence.EmbeddedTokens > evidence.InputTokens {
				return false
			}
			switch evidence.Coverage {
			case SemanticInputCoverageFull:
				if evidence.InputTokens != evidence.EmbeddedTokens {
					return false
				}
			case SemanticInputCoverageTruncated:
				if evidence.InputTokens <= evidence.EmbeddedTokens {
					return false
				}
			default:
				return false
			}
		}
	}
	if row.Disposition == SemanticSourceIndexed {
		if len(row.Inputs) == 0 {
			return false
		}
		if ocrProjected {
			ordered := append([]semanticSourceInputProof(nil), row.Inputs...)
			sort.Slice(ordered, func(i, j int) bool { return ordered[i].Ordinal < ordered[j].Ordinal })
			for ordinal, input := range ordered {
				if input.Ordinal != int64(ordinal) || input.HasSourceSpan || input.Disposition != SemanticSourceIndexed {
					return false
				}
			}
		} else if segmented {
			spans := append([]semanticSourceInputProof(nil), row.Inputs...)
			sort.Slice(spans, func(i, j int) bool { return spans[i].Ordinal < spans[j].Ordinal })
			offset := 0
			for ordinal, input := range spans {
				if input.Ordinal != int64(ordinal) || !input.HasSourceSpan || input.SourceSpanStart != offset || input.SourceSpanEnd <= input.SourceSpanStart || input.SourceSpanEnd > int(row.BodyLength) {
					return false
				}
				offset = input.SourceSpanEnd
			}
			if int64(offset) != row.BodyLength {
				return false
			}
		} else if row.SourceKind != "DESCRIPTION" {
			if len(row.Inputs) != 1 || row.Inputs[0].SegmentID != row.SourceRef || row.Inputs[0].Ordinal != 0 || row.Inputs[0].Disposition != SemanticSourceIndexed {
				return false
			}
		} else {
			spans := append([]semanticSourceInputProof(nil), row.Inputs...)
			sort.Slice(spans, func(i, j int) bool { return spans[i].SourceSpanStart < spans[j].SourceSpanStart })
			offset := 0
			for _, input := range spans {
				if !input.HasSourceSpan || input.Disposition != SemanticSourceIndexed || input.SourceSpanStart != offset || input.SourceSpanEnd <= input.SourceSpanStart {
					return false
				}
				offset = input.SourceSpanEnd
			}
			if int64(offset) != row.BodyLength {
				return false
			}
		}
	}
	return true
}

func semanticSourceInventoryValid(inventory semanticSourceInventory) bool {
	if len(inventory.Rows) == 0 {
		return false
	}
	rows := map[string]struct{}{}
	inputs := map[string]struct{}{}
	for _, row := range inventory.Rows {
		if !semanticSourceProofValid(row) {
			return false
		}
		identity := semanticSourceRowIdentity(row)
		if _, duplicate := rows[identity]; duplicate {
			return false
		}
		rows[identity] = struct{}{}
		for _, input := range row.Inputs {
			key := row.SubjectID + "\x00" + input.SegmentID
			if _, duplicate := inputs[key]; duplicate {
				return false
			}
			inputs[key] = struct{}{}
		}
	}
	return true
}

func semanticSourceInventoryMatchesIdentities(inventory semanticSourceInventory, identities []ZvecCoverageIdentity) bool {
	if !semanticSourceInventoryValid(inventory) {
		return false
	}
	inputs := map[string]struct{}{}
	for _, row := range inventory.Rows {
		for _, input := range row.Inputs {
			if input.Disposition != SemanticSourceIndexed {
				continue
			}
			key := row.SubjectID + "\x00" + input.SegmentID
			inputs[key] = struct{}{}
		}
	}
	pairs := map[string]struct{}{}
	for _, identity := range identities {
		key := identity.SubjectID + "\x00" + identity.SegmentID
		if _, exists := pairs[key]; exists {
			return false
		}
		pairs[key] = struct{}{}
	}
	if len(inputs) != len(pairs) {
		return false
	}
	for key := range inputs {
		if _, ok := pairs[key]; !ok {
			return false
		}
	}
	return true
}

func summarizeSemanticSourceCoverage(generation sqlite.IndexGeneration, inventory semanticSourceInventory, expected, actual []ZvecCoverageIdentity, pairBound, backendComplete bool, preprocessingProfiles ...string) SemanticSourceCoverageStatement {
	statement := SemanticSourceCoverageStatement{Scope: semanticSourceCoverageScopeV1, GenerationID: generation.ID,
		SnapshotRef: generation.SnapshotRef, NamespaceRootID: generation.NamespaceRootID,
		ConfigDigest: generation.ConfigDigest, ProfileDigest: generation.ProviderProfileDigest}
	if len(inventory.Rows) == 0 {
		statement.Reason = SemanticSourceReasonInventoryInvalid
		return statement
	}
	if !pairBound {
		statement.Reason = SemanticSourceReasonInventoryInvalid
		statement.Notes = "backend identity evidence is not subject-bound"
		return statement
	}
	actualSet := make(map[string]struct{}, len(actual))
	for _, identity := range actual {
		key := identity.SubjectID + "\x00" + identity.SegmentID
		if _, exists := actualSet[key]; exists {
			statement.Reason = SemanticSourceReasonInputIdentityMismatch
			return statement
		}
		actualSet[key] = struct{}{}
	}
	expectedSet := make(map[string]struct{}, len(expected))
	for _, identity := range expected {
		key := identity.SubjectID + "\x00" + identity.SegmentID
		if _, exists := expectedSet[key]; exists {
			statement.Reason = SemanticSourceReasonInputIdentityMismatch
			return statement
		}
		expectedSet[key] = struct{}{}
	}
	inventoryInputs := make(map[string]struct{})
	for _, row := range inventory.Rows {
		for _, input := range row.Inputs {
			if input.Disposition == SemanticSourceIndexed {
				inventoryInputs[row.SubjectID+"\x00"+input.SegmentID] = struct{}{}
			}
		}
	}
	if !semanticStringSetEqual(expectedSet, inventoryInputs) || !semanticStringSetEqual(expectedSet, actualSet) {
		statement.Reason = SemanticSourceReasonInputIdentityMismatch
		return statement
	}
	statement.Available = true
	allGood := true
	preprocessingDigest := ""
	if len(preprocessingProfiles) > 0 {
		preprocessingDigest = preprocessingProfiles[0]
	}
	rows := append([]semanticSourceInventoryRow(nil), inventory.Rows...)
	sort.Slice(rows, func(i, j int) bool { return semanticSourceRowIdentity(rows[i]) < semanticSourceRowIdentity(rows[j]) })
	for _, row := range rows {
		for _, input := range row.Inputs {
			if input.Disposition != SemanticSourceIndexed {
				continue
			}
			switch {
			case input.InputEvidence == nil:
				statement.InputUnknown++
			case input.InputEvidence.Coverage == SemanticInputCoverageFull:
				statement.InputFull++
			case input.InputEvidence.Coverage == SemanticInputCoverageTruncated:
				statement.InputTruncated++
			default:
				statement.InputUnknown++
			}
		}
	}
	plannedSet := make(map[string]struct{})
	for _, row := range rows {
		statement.Expected++
		public := SemanticSourceCoverageRow{SubjectID: row.SubjectID, SourceKind: row.SourceKind, SourceSubtype: row.SourceSubtype,
			SourceRef: row.SourceRef, Revision: row.Revision, BodyDigest: row.BodyDigest, Disposition: row.Disposition, Reason: row.Reason}
		if !semanticSourceProofValid(row) {
			public.Disposition, public.Reason = SemanticSourceUnavailable, SemanticSourceReasonInventoryInvalid
			statement.Unavailable++
			allGood = false
		} else if row.Disposition == SemanticSourceExcluded {
			statement.Excluded++
		} else if row.Disposition == SemanticSourceUnavailable {
			statement.Unavailable++
			allGood = false
		} else if row.Disposition == SemanticSourceMissing {
			statement.Missing++
			allGood = false
		} else {
			valid := len(row.Inputs) > 0
			missing := false
			profileMismatch := false
			consumptionReason := ""
			if row.SourceKind == "DESCRIPTION" || row.SegmentationProfileDigest == semanticTextSourceSegmentationProfileDigest {
				spans := make([]semanticSourceInputProof, 0, len(row.Inputs))
				for _, input := range row.Inputs {
					spans = append(spans, input)
				}
				if row.SegmentationProfileDigest != "" {
					sort.Slice(spans, func(i, j int) bool { return spans[i].Ordinal < spans[j].Ordinal })
				} else {
					sort.Slice(spans, func(i, j int) bool { return spans[i].SourceSpanStart < spans[j].SourceSpanStart })
				}
				offset := 0
				for ordinal, input := range spans {
					if !input.HasSourceSpan || input.SourceSpanStart != offset || input.SourceSpanEnd <= input.SourceSpanStart || (row.SegmentationProfileDigest != "" && input.Ordinal != int64(ordinal)) {
						valid = false
					}
					offset = input.SourceSpanEnd
				}
				if int64(offset) != row.BodyLength {
					valid = false
				}
			}
			for _, input := range row.Inputs {
				if input.Disposition == SemanticSourceExcluded {
					continue
				}
				public.SegmentCount++
				key := row.SubjectID + "\x00" + input.SegmentID
				if _, duplicate := plannedSet[key]; duplicate {
					valid = false
					public.SegmentMissing++
				} else {
					plannedSet[key] = struct{}{}
				}
				_, expectedOK := expectedSet[key]
				_, actualOK := actualSet[key]
				if expectedOK && actualOK && input.InputDigest == input.SegmentDigest {
					public.SegmentIndexed++
				} else if !actualOK {
					public.SegmentMissing++
					missing, valid = true, false
				} else {
					public.SegmentMissing++
					valid = false
				}
				switch {
				case input.InputEvidence == nil:
					public.InputUnknown++
					valid = false
					consumptionReason = SemanticSourceReasonInputCoverageUnknown
				case input.InputEvidence.Coverage == SemanticInputCoverageFull:
					public.InputFull++
				case input.InputEvidence.Coverage == SemanticInputCoverageTruncated:
					public.InputTruncated++
					valid = false
					consumptionReason = SemanticSourceReasonInputTruncated
				default:
					public.InputUnknown++
					valid = false
					consumptionReason = SemanticSourceReasonInputCoverageUnknown
				}
				if input.InputEvidence != nil && preprocessingDigest != "" && input.InputEvidence.PreprocessingDigest != preprocessingDigest {
					profileMismatch, valid = true, false
				}
			}
			if valid {
				statement.Indexed++
				public.Disposition = SemanticSourceIndexed
			} else if missing {
				statement.Missing++
				public.Disposition, public.Reason = SemanticSourceMissing, SemanticSourceReasonInputIdentityMismatch
				allGood = false
			} else if profileMismatch {
				statement.Unavailable++
				public.Disposition, public.Reason = SemanticSourceUnavailable, SemanticSourceReasonInputProfileMismatch
				allGood = false
			} else if consumptionReason != "" {
				statement.Unavailable++
				public.Disposition, public.Reason = SemanticSourceUnavailable, consumptionReason
				allGood = false
			} else {
				statement.Unavailable++
				public.Disposition, public.Reason = SemanticSourceUnavailable, SemanticSourceReasonInputIdentityMismatch
				allGood = false
			}
		}
		statement.Rows = append(statement.Rows, public)
	}
	statement.Complete = allGood && backendComplete && statement.Expected > 0
	statement.Notes = "semantic source membership is generation-local; tokenizer consumption is reported separately"
	sort.Slice(statement.Rows, func(i, j int) bool {
		badI, badJ := statement.Rows[i].Disposition != SemanticSourceIndexed && statement.Rows[i].Disposition != SemanticSourceExcluded,
			statement.Rows[j].Disposition != SemanticSourceIndexed && statement.Rows[j].Disposition != SemanticSourceExcluded
		if badI != badJ {
			return badI
		}
		return strings.Join([]string{statement.Rows[i].SubjectID, statement.Rows[i].SourceRef, statement.Rows[i].Revision}, "\x00") <
			strings.Join([]string{statement.Rows[j].SubjectID, statement.Rows[j].SourceRef, statement.Rows[j].Revision}, "\x00")
	})
	if len(statement.Rows) > 256 {
		statement.Rows = statement.Rows[:256]
		statement.Truncated = true
	}
	return statement
}

func semanticStringSetEqual(left, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for key := range left {
		if _, ok := right[key]; !ok {
			return false
		}
	}
	return true
}

func semanticSourceInventoryDigest(inventory semanticSourceInventory) string {
	rows := append([]semanticSourceInventoryRow(nil), inventory.Rows...)
	sort.Slice(rows, func(i, j int) bool { return semanticSourceRowIdentity(rows[i]) < semanticSourceRowIdentity(rows[j]) })
	for i := range rows {
		rows[i].Inputs = append([]semanticSourceInputProof(nil), rows[i].Inputs...)
		sort.Slice(rows[i].Inputs, func(a, b int) bool { return rows[i].Inputs[a].SegmentID < rows[i].Inputs[b].SegmentID })
	}
	data, _ := json.Marshal(semanticSourceInventory{Rows: rows})
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func semanticSourceRowIdentity(row semanticSourceInventoryRow) string {
	return strings.Join([]string{row.SubjectID, row.SourceKind, row.SourceSubtype, row.SourceRef, row.Revision}, "\x00")
}
