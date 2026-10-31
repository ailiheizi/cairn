package search

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOCRSemanticProjectionLineage(t *testing.T) {
	t.Run("canonical recognized text inputs preserve exact text without source spans", func(t *testing.T) {
		recognized := strings.Repeat("七月十二日，冰箱里的牛奶需要尽快使用。 ", 32)
		body, err := json.Marshal(map[string]any{
			"schema": "cairn.artifact.ocr-text.v1", "state": "PARTIAL", "text": recognized,
			"engine": "must-not-be-embedded", "model": "must-not-be-embedded", "regions": []any{map[string]any{"text": "duplicate region"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		bodyDigest := sha256Text(string(body))
		segments, _, known, valid := projectSemanticOCRArtifact("subj_ocr", "art_ocr", "art_ocr", bodyDigest, "producer", string(body))
		if !known || !valid || len(segments) < 2 {
			t.Fatalf("projection known=%v valid=%v segments=%d", known, valid, len(segments))
		}
		var joined strings.Builder
		for _, segment := range segments {
			var envelope map[string]any
			if err := json.Unmarshal([]byte(segment.MatchedText), &envelope); err != nil {
				t.Fatal(err)
			}
			if len(envelope) != 3 || envelope["schema"] != semanticOCRArtifactSchema || envelope["state"] != "PARTIAL" {
				t.Fatalf("unexpected canonical envelope fields: %#v", envelope)
			}
			piece, ok := envelope["text"].(string)
			if !ok {
				t.Fatalf("canonical text has type %T", envelope["text"])
			}
			joined.WriteString(piece)
			if segment.TextSourceProvenance != nil {
				t.Fatal("OCR projection invented source-byte provenance")
			}
			proof := semanticSourceInputFromSegment(segment, "art_ocr", "art_ocr")
			if proof.HasSourceSpan || proof.InputDigest != proof.SegmentDigest {
				t.Fatalf("bad OCR input proof: %#v", proof)
			}
		}
		if joined.String() != recognized {
			t.Fatal("segmented projection changed recognized text")
		}
	})

	t.Run("only top-level OCR schema is recognized and malformed known input fails closed", func(t *testing.T) {
		for _, prose := range []string{
			`A note showing {"schema":"cairn.artifact.ocr-text.v1"} as an example.`,
			`{"metadata":{"schema":"cairn.artifact.ocr-text.v1"},"text":"ordinary JSON"}`,
			`"{\"schema\":\"cairn.artifact.ocr-text.v1\"}"`,
		} {
			if semanticOCRKnownArtifact(prose) {
				t.Fatalf("ordinary prose/nested JSON recognized as OCR: %s", prose)
			}
		}
		malformed := `{"schema":"cairn.artifact.ocr-text.v1","state":"PARTIAL","text":`
		segments, _, known, valid := projectSemanticOCRArtifact("s", "a", "a", sha256Text(malformed), "p", malformed)
		if !known || valid || len(segments) != 0 {
			t.Fatalf("malformed known OCR: known=%v valid=%v segments=%d", known, valid, len(segments))
		}
		invalidUnicode := `{"schema":"cairn.artifact.ocr-text.v1","state":"PARTIAL","text":"\ud800"}`
		segments, _, known, valid = projectSemanticOCRArtifact("s", "a", "a", sha256Text(invalidUnicode), "p", invalidUnicode)
		if !known || valid || len(segments) != 0 {
			t.Fatalf("unpaired surrogate accepted: known=%v valid=%v segments=%d", known, valid, len(segments))
		}
	})

	t.Run("partial empty OCR is empty text and OCR proof requires exact no-span input identity", func(t *testing.T) {
		body := `{"schema":"cairn.artifact.ocr-text.v1","state":"PARTIAL","text":"  ","quality":{"reasons":["EMPTY_REGION"]}}`
		segments, state, known, valid := projectSemanticOCRArtifact("subj_ocr", "art_ocr", "art_ocr", sha256Text(body), "producer", body)
		if !known || !valid || state != "PARTIAL" || len(segments) != 0 {
			t.Fatalf("partial empty OCR: known=%v valid=%v state=%q segments=%d", known, valid, state, len(segments))
		}
		emptyRow := semanticSourceInventoryRow{SubjectID: "subj_ocr", SourceKind: "EXTRACT", SourceRef: "art_ocr", Revision: "art_ocr", BodyDigest: sha256Text(body), BodyLength: int64(len(body)), Disposition: SemanticSourceExcluded, Reason: SemanticSourceReasonEmptyText, SegmentationProfileDigest: semanticOCRTextProjectionProfileDigest}
		if !semanticSourceProofValid(emptyRow) {
			t.Fatal("PARTIAL empty OCR was not a valid EMPTY_TEXT exclusion")
		}

		recognizedBody := `{"schema":"cairn.artifact.ocr-text.v1","state":"TEXT","text":"milk expires tomorrow"}`
		inputs, _, _, ok := projectSemanticOCRArtifact("subj_ocr", "art_ocr", "art_ocr", sha256Text(recognizedBody), "producer", recognizedBody)
		if !ok || len(inputs) != 1 {
			t.Fatalf("recognized input set invalid: %v, %d inputs", ok, len(inputs))
		}
		proof := semanticSourceInputFromSegment(inputs[0], "art_ocr", "art_ocr")
		proof.InputEvidence = &SemanticInputEvidence{TextDigest: proof.InputDigest, SourceRef: "art_ocr", Ordinal: 0,
			PreprocessingDigest: sha256Text("preprocessing"), AppliedPreprocessingDigest: sha256Text("applied"),
			Coverage: SemanticInputCoverageFull, InputTokens: 4, EmbeddedTokens: 4}
		row := semanticSourceInventoryRow{SubjectID: "subj_ocr", SourceKind: "EXTRACT", SourceRef: "art_ocr", Revision: "art_ocr", BodyDigest: sha256Text(recognizedBody), BodyLength: int64(len(recognizedBody)), Disposition: SemanticSourceIndexed, SegmentationProfileDigest: semanticOCRTextProjectionProfileDigest, Inputs: []semanticSourceInputProof{proof}}
		if !semanticSourceProofValid(row) {
			t.Fatal("valid full OCR input evidence without source span was rejected")
		}
		for name, edit := range map[string]func(*semanticSourceInventoryRow){
			"forged input digest":        func(r *semanticSourceInventoryRow) { r.Inputs[0].InputDigest = sha256Text("forged") },
			"unknown projection profile": func(r *semanticSourceInventoryRow) { r.SegmentationProfileDigest = sha256Text("unknown profile") },
			"fabricated source span":     func(r *semanticSourceInventoryRow) { r.Inputs[0].HasSourceSpan = true; r.Inputs[0].SourceSpanEnd = 10 },
		} {
			forged := row
			forged.Inputs = append([]semanticSourceInputProof(nil), row.Inputs...)
			edit(&forged)
			if semanticSourceProofValid(forged) {
				t.Errorf("accepted %s", name)
			}
		}
		if !semanticOCRInputSetMatches(row, inputs) {
			t.Fatal("canonical ordered OCR input set did not match its proof")
		}
	})
}
