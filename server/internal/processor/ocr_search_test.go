package processor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/search"
)

// TestOCRTextReachesLexicalSearchThroughTheExistingExtractPath proves the
// integration promise: the recognized text is discovery content through the
// existing EXTRACT-artifact feed, not through a second index, a second store,
// or a new embedding dimension.
func TestOCRTextReachesLexicalSearchThroughTheExistingExtractPath(t *testing.T) {
	ctx := context.Background()
	store, repo := testLane(t)
	source := t.TempDir()
	pngBytes := encodeOCRFixturePNG(t, []string{"OCR", "ZXQ42"}, 4)
	if err := os.WriteFile(filepath.Join(source, "screenshot.png"), pngBytes, 0o600); err != nil {
		t.Fatalf("write png: %v", err)
	}
	host := NewHost(store, repo, Options{
		StagingDir: t.TempDir(),
		Processors: append(DefaultProcessors(), Processor(ocrFixtureProcessor(fixtureOCREngine{}))),
	})
	service := &exact.Service{Store: store, Repo: repo, Processor: host}
	ingested, err := service.Ingest(ctx, source)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	entries, err := store.ListNamespaceContent(ctx, ingested.WorkspaceID, ingested.RootID)
	if err != nil {
		t.Fatalf("namespace content: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("namespace entries = %d, want 1", len(entries))
	}
	subject := entries[0].SubjectRef

	artifacts, err := store.ListAdmittedArtifacts(ctx, ingested.WorkspaceID, ingested.SnapshotRef)
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	var body string
	for _, artifact := range artifacts {
		if artifact.CapabilityID == CapabilityOCRImageText {
			body = artifact.Body
		}
	}
	if body == "" {
		t.Fatal("no admitted OCR artifact to feed search")
	}
	if !strings.Contains(body, "ZXQ42") {
		t.Fatalf("OCR artifact does not carry the recognized text: %s", body)
	}

	indexer := &search.Indexer{Store: store, Engine: &search.Engine{Dir: t.TempDir()}}
	generation, err := indexer.Rebuild(ctx, ingested.WorkspaceID, ingested.SnapshotRef, ingested.RootID)
	if err != nil {
		t.Fatalf("rebuild lexical generation: %v", err)
	}
	if generation.Dimension != search.DimensionLexical {
		t.Fatalf("generation dimension = %q", generation.Dimension)
	}

	// A default query and an axis-restricted query must both find the subject
	// by the OCR-only token. The file name never contains it.
	for _, test := range []struct {
		name string
		axes []string
	}{
		{name: "default axes"},
		{name: "extracted axis", axes: []string{search.AxisExtracted}},
	} {
		_, hits, err := indexer.Query(ctx, search.QueryRequest{
			WorkspaceID: ingested.WorkspaceID, Dimension: search.DimensionLexical, Text: "ZXQ42", Axes: test.axes,
		})
		if err != nil {
			t.Fatalf("%s query: %v", test.name, err)
		}
		found := false
		for _, hit := range hits {
			if hit.SubjectID != subject {
				continue
			}
			found = true
			matchedArtifact := false
			for _, segment := range hit.Segments {
				if segment.SourceType == "ARTIFACT" && strings.Contains(segment.MatchedText, "ZXQ42") {
					matchedArtifact = true
				}
			}
			if !matchedArtifact {
				t.Fatalf("%s: hit %q carries no OCR artifact segment: %+v", test.name, hit.SubjectID, hit.Segments)
			}
		}
		if !found {
			t.Fatalf("%s: OCR-only token did not reach the subject in %d hits", test.name, len(hits))
		}
	}

	// The lexical generation reports the extracted axis as present, because the
	// OCR text travels in the same Extracted field as every other extraction.
	statement, err := indexer.Coverage(ctx, ingested.WorkspaceID)
	if err != nil {
		t.Fatalf("coverage: %v", err)
	}
	if !statement.Fields[search.AxisExtracted] {
		t.Fatalf("extracted axis not reported present: %+v", statement.Fields)
	}

	// No new dimension is declared and no second store is created by OCR.
	for _, dimension := range search.DeclaredDimensions(search.IndexerReadiness(indexer)) {
		if strings.Contains(strings.ToLower(dimension.ID), "ocr") {
			t.Fatalf("OCR declared a new discovery dimension: %+v", dimension)
		}
	}
}
