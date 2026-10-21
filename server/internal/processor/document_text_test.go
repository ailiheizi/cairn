package processor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/identify"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/giraffesyo/pdf/pdftest"
)

func TestDocumentTextCapabilitiesBindProfilesAndBudgets(t *testing.T) {
	for _, tc := range []struct {
		processor  Processor
		capability string
	}{
		{PDFTextExtract{}, CapabilityPDFTextExtract},
		{DOCXTextExtract{}, CapabilityDOCXTextExtract},
	} {
		if tc.processor.CapabilityID() != tc.capability || tc.processor.Stage() != StageExtract {
			t.Fatalf("document processor identity = %q/%q, want %q/EXTRACT", tc.processor.CapabilityID(), tc.processor.Stage(), tc.capability)
		}
		budget := tc.processor.(MediaBudget).ProcessingBudget()
		if budget.MaxSourceBytes != 16<<20 || budget.MaxOutputBytes != 1<<20 || budget.StageTimeout != documentTextStageTime {
			t.Fatalf("%s budget = %+v", tc.capability, budget)
		}
		if got := ProducerDigest(tc.capability); got == ProducerDigest("processor:unused") || got == ProducerDigest(CapabilityTextExtract) {
			t.Fatalf("%s producer digest is not independently profile-bound: %s", tc.capability, got)
		}
	}
	if ProducerDigest(CapabilityTextExtract) != digestProducerProfile("processor:"+CapabilityTextExtract) {
		t.Fatal("legacy text-extraction producer digest changed")
	}
	seenPDF, seenDOCX := false, false
	for _, proc := range DefaultProcessors() {
		seenPDF = seenPDF || proc.CapabilityID() == CapabilityPDFTextExtract
		seenDOCX = seenDOCX || proc.CapabilityID() == CapabilityDOCXTextExtract
	}
	if !seenPDF || !seenDOCX {
		t.Fatalf("default processors omit admitted document routes: PDF=%v DOCX=%v", seenPDF, seenDOCX)
	}
}

func TestDocumentTextRoutesRequireTypedFormatEvidence(t *testing.T) {
	for _, tc := range []struct {
		name       string
		format     string
		mime       string
		capability string
	}{
		{"pdf", "pdf", "application/pdf", CapabilityPDFTextExtract},
		{"docx", "ooxml-document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", CapabilityDOCXTextExtract},
	} {
		t.Run(tc.name, func(t *testing.T) {
			classification := ClassificationRecord{State: "IDENTIFIED", Evidence: []identify.DetectionEvidence{{Candidate: identify.FormatCandidate{FormatID: tc.format, MIME: tc.mime}}}}
			route := buildProcessingRoute(classification)
			if len(route.Nodes) != 1 || route.Nodes[0].CapabilityID != tc.capability || route.Nodes[0].Stage != StageExtract {
				t.Fatalf("route = %+v, want one %s EXTRACT node", route, tc.capability)
			}
		})
	}
	if route := buildProcessingRoute(ClassificationRecord{State: "IDENTIFIED"}); len(route.Nodes) != 0 {
		t.Fatalf("untyped evidence routed to document parser: %+v", route)
	}
}

func TestDocumentTextHostRouteAdmitsExistingExtractedTextArtifact(t *testing.T) {
	ctx := context.Background()
	pdfBody := pdftest.Build(1,
		pdftest.Catalog(2), pdftest.Pages(3),
		pdftest.Page(2, 4, "<< /Font << /F1 5 0 R >> >>"),
		pdftest.Stream("", "BT /F1 12 Tf 72 700 Td (pdf body route) Tj ET"), pdftest.Helvetica(),
	)
	docxBody := validDOCX(t, testDOCXDocument(`<x:p><x:r><x:t>docx body route</x:t></x:r></x:p>`))
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "paper.pdf"), pdfBody, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "letter.docx"), docxBody, 0o600); err != nil {
		t.Fatal(err)
	}
	store, repo := testLane(t)
	host := NewHost(store, repo, Options{StagingDir: t.TempDir()})
	service := &exact.Service{Store: store, Repo: repo, Processor: host}
	publication, err := service.Ingest(ctx, sourceDir)
	if err != nil {
		t.Fatalf("exact ingest failed: %v", err)
	}
	if _, err := service.Verify(ctx, publication.SnapshotRef); err != nil {
		t.Fatalf("verify exact originals: %v", err)
	}
	artifacts, err := store.ListAdmittedArtifacts(ctx, publication.WorkspaceID, publication.SnapshotRef)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{CapabilityPDFTextExtract: "pdf body route", CapabilityDOCXTextExtract: "docx body route\n"}
	for _, artifact := range artifacts {
		if expected, ok := want[artifact.CapabilityID]; ok {
			if artifact.State != sqlite.ArtifactAdmitted || artifact.Stage != string(StageExtract) || artifact.SchemaRef != SchemaRefExtractedText() || artifact.MediaType != MediaTypeUTF8Text || artifact.Body != expected {
				t.Fatalf("document artifact = %+v; want admitted extracted text %q", artifact, expected)
			}
			if artifact.ProducerDigest != ProducerDigest(artifact.CapabilityID) {
				t.Fatalf("producer digest mismatch for %s: %s", artifact.CapabilityID, artifact.ProducerDigest)
			}
			delete(want, artifact.CapabilityID)
		}
	}
	if len(want) != 0 {
		t.Fatalf("host omitted document text artifacts: %+v; got %+v", want, artifacts)
	}
	restoreDir := filepath.Join(t.TempDir(), "restored")
	if _, err := service.Restore(ctx, publication.SnapshotRef, restoreDir); err != nil {
		t.Fatalf("restore exact originals: %v", err)
	}
	for name, expected := range map[string][]byte{"paper.pdf": pdfBody, "letter.docx": docxBody} {
		got, err := os.ReadFile(filepath.Join(restoreDir, name))
		if err != nil || string(got) != string(expected) {
			t.Fatalf("restored %s mismatch: bytes=%d err=%v", name, len(got), err)
		}
	}
}

func TestSourceHandleMarksBoundedReadsAsTruncated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.bin")
	if err := os.WriteFile(path, []byte("complete source"), 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	truncated, err := SourceFromFile(context.Background(), file, 4)
	if err != nil {
		t.Fatal(err)
	}
	if !truncated.Truncated() {
		t.Fatal("bounded prefix was reported as complete")
	}
	complete, err := SourceFromFile(context.Background(), file, 64)
	if err != nil {
		t.Fatal(err)
	}
	if complete.Truncated() {
		t.Fatal("complete source was reported as truncated")
	}
}

func TestDocumentTextStageRefusesTruncationIdentityMismatchAndOutputOverflow(t *testing.T) {
	docxBody := validDOCX(t, testDOCXDocument(`<x:p><x:r><x:t>body exceeds tiny cap</x:t></x:r></x:p>`))
	contentID := func(body []byte) string {
		sum := sha256.Sum256(body)
		return "sha256:" + hex.EncodeToString(sum[:])
	}
	for _, tc := range []struct {
		name      string
		contentID string
		truncated bool
		outputMax int64
	}{
		{name: "truncated source", contentID: contentID(docxBody), truncated: true, outputMax: 1024},
		{name: "identity mismatch", contentID: "sha256:wrong", outputMax: 1024},
		{name: "output ceiling", contentID: contentID(docxBody), outputMax: 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := &SourceHandle{id: "source", body: docxBody, content: tc.contentID, truncated: tc.truncated}
			staging, err := openStaging(t.TempDir(), "attempt", tc.outputMax)
			if err != nil {
				t.Fatal(err)
			}
			defer staging.Close()
			result, err := (DOCXTextExtract{}).RunStage(context.Background(), Invocation{Source: source, Staging: staging, MaxOutputBytes: tc.outputMax})
			if err != nil || result.Status != StatusFailed || result.Sealed {
				t.Fatalf("result = %+v, err=%v; want failed without sealed artifact", result, err)
			}
		})
	}
}

func digestProducerProfile(profile string) string {
	sum := sha256.Sum256([]byte(profile))
	return "sha256:" + hex.EncodeToString(sum[:])
}
