package search

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

type fullEvidenceSemanticProvider struct{}

func (fullEvidenceSemanticProvider) Embed(_ context.Context, request SemanticEmbeddingRequest) ([]SemanticVector, error) {
	results := make([]SemanticVector, 0, len(request.Inputs))
	for _, input := range request.Inputs {
		results = append(results, SemanticVector{SubjectID: input.SubjectID, SegmentID: input.SegmentID,
			Vector: []float32{1, 0, 0, 0}, InputEvidence: &SemanticInputEvidence{
				TextDigest: sha256Text(input.Text), SourceRef: input.DescriptionDocumentID, Ordinal: input.Ordinal,
				PreprocessingDigest: request.Manifest.PreprocessingDigest, AppliedPreprocessingDigest: sha256Text("applied"),
				Coverage: SemanticInputCoverageFull, InputTokens: 1, EmbeddedTokens: 1,
			}})
	}
	return results, validateSemanticEmbeddingResults(request, results)
}

func TestSemanticSourceProofRejectsImpossibleIndexedShapes(t *testing.T) {
	digest := sha256Text("note")
	base := semanticSourceInventoryRow{SubjectID: "subj_test", SourceKind: "NOTE", SourceRef: "ann_test",
		Revision: "1", BodyDigest: digest, BodyLength: 4, Disposition: SemanticSourceIndexed,
		Inputs: []semanticSourceInputProof{{SegmentID: "ann_test", SegmentDigest: digest, InputDigest: digest,
			SourceRef: "ann_test", SourceRevision: "1", Ordinal: 0, Disposition: SemanticSourceIndexed}}}
	tests := []struct {
		name string
		edit func(*semanticSourceInventoryRow)
	}{
		{"tag cannot be indexed", func(r *semanticSourceInventoryRow) { r.SourceKind = "TAG"; r.SourceRef = "ann_tag"; r.Revision = "1" }},
		{"indexed row requires input", func(r *semanticSourceInventoryRow) { r.Inputs = nil }},
		{"indexed row has no reason", func(r *semanticSourceInventoryRow) { r.Reason = SemanticSourceReasonInputIdentityMismatch }},
		{"input segment must be source ref", func(r *semanticSourceInventoryRow) { r.Inputs[0].SegmentID = "other" }},
		{"noncanonical revision rejected", func(r *semanticSourceInventoryRow) { r.Revision = "+1"; r.Inputs[0].SourceRevision = "+1" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			row := base
			row.Inputs = append([]semanticSourceInputProof(nil), base.Inputs...)
			test.edit(&row)
			if semanticSourceProofValid(row) {
				t.Fatal("malformed source proof was accepted")
			}
		})
	}
}

func TestSemanticSourceSegmentSetRequiresCompleteProfileBoundOrdinalSpans(t *testing.T) {
	body := strings.Repeat("source words remain byte-exact across each derived segment. ", 24)
	digest := sha256Text(body)
	segments, ok := deriveSemanticTextSourceSegments("NOTE", "subject", "annotation", "2", body, digest, "USER")
	if !ok || len(segments) < 2 {
		t.Fatalf("segments=%d valid=%t", len(segments), ok)
	}
	row := semanticSourceInventoryRow{SubjectID: "subject", SourceKind: "NOTE", SourceRef: "annotation", Revision: "2",
		BodyDigest: digest, BodyLength: int64(len(body)), Disposition: SemanticSourceIndexed,
		SegmentationProfileDigest: semanticTextSourceSegmentationProfileDigest}
	for _, segment := range segments {
		proof := semanticSourceInputFromSegment(segment, row.SourceRef, row.Revision)
		row.Inputs = append(row.Inputs, proof)
	}
	if !semanticSourceProofValid(row) {
		t.Fatal("valid complete segment set rejected")
	}
	// Receipt arrays are canonicalized by segment ID, so array order itself is
	// not semantically significant; ordinal/span order is validated explicitly.
	for i, j := 0, len(row.Inputs)-1; i < j; i, j = i+1, j-1 {
		row.Inputs[i], row.Inputs[j] = row.Inputs[j], row.Inputs[i]
	}
	if !semanticSourceProofValid(row) {
		t.Fatal("valid reordered input array rejected")
	}
	row.Inputs[0].SourceSpanStart++
	if semanticSourceProofValid(row) {
		t.Fatal("gapped/tampered source span accepted")
	}
	row.Inputs[0].SourceSpanStart--
	row.Inputs[0].SourceSpanEnd--
	if semanticSourceProofValid(row) {
		t.Fatal("overlapping/tampered source span accepted")
	}
	row.Inputs[0].SourceSpanEnd++
	row.Inputs[0].Ordinal++
	if semanticSourceProofValid(row) {
		t.Fatal("reordered ordinal accepted")
	}
	row.Inputs[0].Ordinal--
	row.SegmentationProfileDigest = "sha256:" + strings.Repeat("0", 64)
	if semanticSourceProofValid(row) {
		t.Fatal("unknown segmentation profile accepted")
	}
	excluded := semanticSourceInventoryRow{SubjectID: "subject", SourceKind: "NOTE", SourceRef: "annotation", Revision: "2",
		BodyDigest: digest, BodyLength: int64(len(body)), Disposition: SemanticSourceExcluded, Reason: SemanticSourceReasonEmptyText,
		SegmentationProfileDigest: "sha256:" + strings.Repeat("0", 64)}
	if semanticSourceProofValid(excluded) {
		t.Fatal("unknown segmentation profile accepted on excluded source")
	}
}

func semanticCoverageNoteSource(subject, source, body string, evidence *SemanticInputEvidence) semanticSourceInventoryRow {
	digest := sha256Text(body)
	return semanticSourceInventoryRow{SubjectID: subject, SourceKind: "NOTE", SourceRef: source, Revision: "1",
		BodyDigest: digest, BodyLength: int64(len(body)), Disposition: SemanticSourceIndexed,
		Inputs: []semanticSourceInputProof{{SegmentID: source, SegmentDigest: digest, InputDigest: digest,
			SourceRef: source, SourceRevision: "1", Disposition: SemanticSourceIndexed, InputEvidence: evidence}}}
}

func semanticCoverageEvidence(body, preprocessing string, coverage SemanticInputCoverage) *SemanticInputEvidence {
	inputTokens, embeddedTokens := int64(3), int64(3)
	if coverage == SemanticInputCoverageTruncated {
		embeddedTokens = 2
	}
	return &SemanticInputEvidence{TextDigest: sha256Text(body), SourceRef: "ann_test", Ordinal: 0,
		PreprocessingDigest: preprocessing, AppliedPreprocessingDigest: sha256Text("applied"), Coverage: coverage,
		InputTokens: inputTokens, EmbeddedTokens: embeddedTokens}
}

func TestSemanticSourceSummarySeparatesConsumptionFromIdentity(t *testing.T) {
	preprocessing := sha256Text("base")
	for _, tc := range []struct {
		name                                 string
		evidence                             *SemanticInputEvidence
		wantReason                           string
		wantFull, wantUnknown, wantTruncated int
	}{
		{name: "full", evidence: semanticCoverageEvidence("note", preprocessing, SemanticInputCoverageFull), wantFull: 1},
		{name: "unknown", wantReason: SemanticSourceReasonInputCoverageUnknown, wantUnknown: 1},
		{name: "truncated", evidence: semanticCoverageEvidence("note", preprocessing, SemanticInputCoverageTruncated), wantReason: SemanticSourceReasonInputTruncated, wantTruncated: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := semanticCoverageNoteSource("subj_test", "ann_test", "note", tc.evidence)
			ids := []ZvecCoverageIdentity{{SubjectID: "subj_test", SegmentID: "ann_test"}}
			statement := summarizeSemanticSourceCoverage(sqlite.IndexGeneration{ID: "gen_test"}, semanticSourceInventory{Rows: []semanticSourceInventoryRow{row}}, ids, ids, true, true, preprocessing)
			if statement.Expected != 1 || statement.Missing != 0 || statement.InputFull != tc.wantFull ||
				statement.InputUnknown != tc.wantUnknown || statement.InputTruncated != tc.wantTruncated || statement.Complete != (tc.wantReason == "") {
				t.Fatalf("source summary = %+v", statement)
			}
			if tc.wantReason != "" && (statement.Rows[0].Reason != tc.wantReason || statement.Rows[0].Disposition != SemanticSourceUnavailable) {
				t.Fatalf("consumption outcome mislabeled as identity failure: %+v", statement.Rows[0])
			}
		})
	}
	t.Run("profile mismatch", func(t *testing.T) {
		row := semanticCoverageNoteSource("subj_test", "ann_test", "note", semanticCoverageEvidence("note", sha256Text("other-base"), SemanticInputCoverageFull))
		ids := []ZvecCoverageIdentity{{SubjectID: "subj_test", SegmentID: "ann_test"}}
		statement := summarizeSemanticSourceCoverage(sqlite.IndexGeneration{ID: "gen_test"}, semanticSourceInventory{Rows: []semanticSourceInventoryRow{row}}, ids, ids, true, true, preprocessing)
		if statement.Complete || statement.Rows[0].Reason != SemanticSourceReasonInputProfileMismatch {
			t.Fatalf("profile mismatch coverage = %+v", statement)
		}
	})
}

func TestSemanticSourceSummaryBoundsDetailsAndKeepsFullCounters(t *testing.T) {
	rows := make([]semanticSourceInventoryRow, 260)
	ids := make([]ZvecCoverageIdentity, 260)
	for i := range rows {
		body := "body"
		ref := fmt.Sprintf("ann_%03d", i)
		var evidence *SemanticInputEvidence
		if i == 259 { // A deterministic bad outcome must be prioritized in detail.
			body, evidence = "bad", nil
		} else {
			digest := sha256Text(body)
			evidence = &SemanticInputEvidence{TextDigest: digest, SourceRef: ref, Ordinal: 0,
				PreprocessingDigest: sha256Text("base"), AppliedPreprocessingDigest: sha256Text("applied"),
				Coverage: SemanticInputCoverageFull, InputTokens: 1, EmbeddedTokens: 1}
		}
		rows[i] = semanticCoverageNoteSource("subj_test", ref, body, evidence)
		ids[i] = ZvecCoverageIdentity{SubjectID: "subj_test", SegmentID: ref}
	}
	statement := summarizeSemanticSourceCoverage(sqlite.IndexGeneration{ID: "gen_test"}, semanticSourceInventory{Rows: rows}, ids, ids, true, true, sha256Text("base"))
	if !statement.Truncated || len(statement.Rows) != 256 || statement.Expected != 260 || statement.Indexed != 259 ||
		statement.Unavailable != 1 || statement.InputFull != 259 || statement.InputUnknown != 1 || statement.Complete {
		t.Fatalf("bounded source coverage = %+v", statement)
	}
	if statement.Rows[0].SourceRef != "ann_259" || statement.Rows[0].Reason != SemanticSourceReasonInputCoverageUnknown {
		t.Fatalf("bad source outcome was not prioritized: %+v", statement.Rows[0])
	}
}

func TestSemanticGenerationReceiptV2RoundTripAndCorruptionRejection(t *testing.T) {
	for _, corruption := range []string{"missing inventory", "changed inventory digest"} {
		t.Run(corruption, func(t *testing.T) {
			generation := sqlite.IndexGeneration{ID: "generation:test-v2", WorkspaceID: "workspace:test", SnapshotRef: "snapshot:test",
				NamespaceRootID: "root:test", DBPath: filepath.Join(t.TempDir(), "semantic.zvec"), ConfigDigest: "config:test",
				ProviderProfileDigest: "profile:test", SemanticSpace: "space:test"}
			row := semanticCoverageNoteSource("subject:test", "segment:test", "note", nil)
			identities := []ZvecCoverageIdentity{{SubjectID: "subject:test", SegmentID: "segment:test"}}
			inventory := semanticSourceInventory{Rows: []semanticSourceInventoryRow{row}}
			if err := writeSemanticGenerationReceipt(generation, "sha256:"+strings.Repeat("0", 64), identities, inventory); err != nil {
				t.Fatalf("write v2 receipt: %v", err)
			}
			got, reason, err := readSemanticSourceInventory(generation)
			if err != nil || reason != "" || got == nil || !semanticSourceInventoryMatchesIdentities(*got, identities) {
				t.Fatalf("v2 source inventory round trip = %#v, %q, %v", got, reason, err)
			}
			path := semanticGenerationReceiptPath(generation.DBPath)
			payload, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var receipt semanticGenerationReceiptFile
			if err := json.Unmarshal(payload, &receipt); err != nil {
				t.Fatal(err)
			}
			if corruption == "missing inventory" {
				receipt.SourceInventory = nil
			} else {
				receipt.SourceInventory.Rows[0].BodyDigest = sha256Text("changed")
			}
			payload, err = json.Marshal(receipt)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, payload, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, _, _, err := readSemanticGenerationReceipt(generation); err == nil {
				t.Fatal("corrupt v2 source inventory was accepted")
			}
		})
	}
}

func TestV1ReceiptSourceCoverageIsTypedLegacyUnavailable(t *testing.T) {
	generation := sqlite.IndexGeneration{ID: "generation:test-v1", WorkspaceID: "workspace:test", SnapshotRef: "snapshot:test",
		NamespaceRootID: "root:test", DBPath: filepath.Join(t.TempDir(), "semantic.zvec"), ConfigDigest: "config:test",
		ProviderProfileDigest: "profile:test", SemanticSpace: "space:test"}
	identities := []ZvecCoverageIdentity{{SubjectID: "subject:test", SegmentID: "segment:test"}}
	if err := writeSemanticGenerationReceipt(generation, "sha256:"+strings.Repeat("0", 64), identities); err != nil {
		t.Fatal(err)
	}
	inventory, reason, err := readSemanticSourceInventory(generation)
	if err != nil || inventory != nil || reason != SemanticSourceReasonLegacyReceipt {
		t.Fatalf("v1 source detail = %#v, %q, %v", inventory, reason, err)
	}
	statement := unavailableSemanticSourceCoverage(generation, reason)
	if statement.Available || statement.Complete || statement.Reason != SemanticSourceReasonLegacyReceipt {
		t.Fatalf("v1 source coverage = %+v", statement)
	}
}

func TestSemanticSourceCoverageIncompleteWhenGenerationReaderCannotClose(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	seed := testutil.SeedNamespace(t, store)
	manifest := testZvecManifest()
	driver := &closeErrorSemanticDriver{base: &integrationSemanticGenerationDriver{}}
	indexer := &Indexer{Store: store, Engine: &Engine{Dir: t.TempDir()}, ConfigDigest: manifest.ConfigDigest,
		LexicalProfileDigest: ProfileDigest(DimensionLexical, LexicalProfileV4), SemanticManifest: manifest,
		SemanticProvider: fullEvidenceSemanticProvider{}, SemanticZvec: driver,
		SemanticLibraryPath: "/private/explicit/libzvec_c_api.dylib", SemanticLibraryDigest: "sha256:" + strings.Repeat("0", 64)}
	if _, err := indexer.Rebuild(ctx, seed.WorkspaceID, "snapshot:source-close-failure", seed.RootID); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	before, err := indexer.SemanticCoverage(ctx, seed.WorkspaceID)
	if err != nil || before.SourceCoverage == nil || !before.SourceCoverage.Complete {
		t.Fatalf("pre-failure source coverage = %+v, err=%v", before.SourceCoverage, err)
	}
	driver.close = true
	after, err := indexer.SemanticCoverage(ctx, seed.WorkspaceID)
	if err != nil || after.Complete || after.SourceCoverage == nil || after.SourceCoverage.Complete ||
		after.SourceCoverage.Available || after.SourceCoverage.Reason != semanticSourceReasonBackendLifecycleUnavailable {
		t.Fatalf("reader lifecycle failure retained complete source coverage: %+v, err=%v", after, err)
	}
}

func TestLegacyDescriptionSpanDerivationRequiresAbsentSingleWholeBodySpan(t *testing.T) {
	body := "complete retained description"
	document := sqlite.DescriptionDocument{ID: "desc_test", WorkspaceID: "workspace:test", SubjectRef: "subject:test",
		Revision: 1, Body: body, BodyDigest: sha256Text(body)}
	segment := sqlite.SemanticSegment{ID: "segment_test", WorkspaceID: document.WorkspaceID, DocumentID: document.ID,
		SubjectRef: document.SubjectRef, DocumentRevision: 1, Ordinal: 0, Text: body, TextDigest: sha256Text(body),
		SegmentationProfileDigest: "profile:test"}
	derived := legacyDescriptionSourceProvenance(document, document.SubjectRef, 0, []sqlite.SemanticSegment{segment})
	if len(derived) != 1 || derived[0].SourceStartByte != 0 || derived[0].SourceEndByte != len(body) {
		t.Fatalf("single whole-body legacy span = %+v", derived)
	}
	malformed := segment
	malformed.SourceSpan = json.RawMessage(`{}`)
	if got := legacyDescriptionSourceProvenance(document, document.SubjectRef, 0, []sqlite.SemanticSegment{malformed}); got != nil {
		t.Fatalf("explicit malformed span was replaced by derived proof: %+v", got)
	}
	partial := segment
	partial.Text = "partial"
	partial.TextDigest = sha256Text(partial.Text)
	if got := legacyDescriptionSourceProvenance(document, document.SubjectRef, 0, []sqlite.SemanticSegment{partial}); got != nil {
		t.Fatalf("partial segment was promoted to whole-body proof: %+v", got)
	}
	second := segment
	second.ID = "segment_test_2"
	second.Ordinal = 1
	if got := legacyDescriptionSourceProvenance(document, document.SubjectRef, 0, []sqlite.SemanticSegment{segment, second}); got != nil {
		t.Fatalf("multi-segment legacy set received invented proof: %+v", got)
	}
}

func TestSemanticSourceInventoryMustMatchReceiptInputSet(t *testing.T) {
	digest := sha256Text("note")
	inventory := semanticSourceInventory{Rows: []semanticSourceInventoryRow{{SubjectID: "subj_test", SourceKind: "NOTE",
		SourceRef: "ann_test", Revision: "1", BodyDigest: digest, BodyLength: 4, Disposition: SemanticSourceIndexed,
		Inputs: []semanticSourceInputProof{{SegmentID: "ann_test", SegmentDigest: digest, InputDigest: digest,
			SourceRef: "ann_test", SourceRevision: "1", Disposition: SemanticSourceIndexed}}}}}
	want := []ZvecCoverageIdentity{{SubjectID: "subj_test", SegmentID: "ann_test"}}
	if !semanticSourceInventoryMatchesIdentities(inventory, want) {
		t.Fatal("matching inventory and receipt identity set was rejected")
	}
	if semanticSourceInventoryMatchesIdentities(inventory, nil) {
		t.Fatal("inventory without its planned receipt identity was accepted")
	}
}

func TestInvalidUTF8ExtractCannotCompleteSemanticSourceCoverage(t *testing.T) {
	body := string([]byte{0xff, 'x'})
	disposition, reason := semanticExtractSourceDisposition(body)
	if disposition != SemanticSourceUnavailable || reason != SemanticSourceReasonSegmentSetInvalid {
		t.Fatalf("invalid UTF-8 extraction classified as %s/%s", disposition, reason)
	}
	noteDigest := sha256Text("note")
	evidenceDigest := sha256Text("preprocessing")
	note := semanticSourceInventoryRow{SubjectID: "subj_test", SourceKind: "NOTE", SourceRef: "ann_test", Revision: "1",
		BodyDigest: noteDigest, BodyLength: 4, Disposition: SemanticSourceIndexed,
		Inputs: []semanticSourceInputProof{{SegmentID: "ann_test", SegmentDigest: noteDigest, InputDigest: noteDigest,
			SourceRef: "ann_test", SourceRevision: "1", Ordinal: 0, Disposition: SemanticSourceIndexed,
			InputEvidence: &SemanticInputEvidence{TextDigest: noteDigest, SourceRef: "ann_test", Ordinal: 0,
				PreprocessingDigest: evidenceDigest, AppliedPreprocessingDigest: evidenceDigest,
				Coverage: SemanticInputCoverageFull, InputTokens: 1, EmbeddedTokens: 1}}}}
	invalid := semanticSourceInventoryRow{SubjectID: "subj_test", SourceKind: "EXTRACT", SourceRef: "artifact_test", Revision: "artifact_test",
		BodyDigest: sha256Text(body), BodyLength: int64(len(body)), Disposition: disposition, Reason: reason}
	identities := []ZvecCoverageIdentity{{SubjectID: "subj_test", SegmentID: "ann_test"}}
	statement := summarizeSemanticSourceCoverage(sqlite.IndexGeneration{ID: "gen_test"}, semanticSourceInventory{Rows: []semanticSourceInventoryRow{note, invalid}}, identities, identities, true, true)
	if !statement.Available || statement.Complete || statement.Expected != 2 || statement.Indexed != 1 || statement.Unavailable != 1 {
		t.Fatalf("invalid UTF-8 source incorrectly completed coverage: %+v", statement)
	}
}
