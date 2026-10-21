package controlplane

import (
	"context"
	"encoding/json"
	"io"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestDescriptionWritesPublishExactRevisionsAndSegments(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	configA := exact.DigestBytes([]byte("description-parent-config-a"))
	configB := exact.DigestBytes([]byte("description-write-config-b"))
	fixture.dispatcher.exact.ConfigDigest = configA
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	parentState := captureAnnotationParentState(t, ctx, fixture)
	fixture.dispatcher.exact.ConfigDigest = configB
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)

	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "USER", "body": "first authored description",
		"accepted": true,
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("description.create = %q: %+v data=%s", created.Status, created.Reasons, created.Data)
	}
	var createdData command.DescriptionCreateData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}
	if createdData.Document.ConfigDigest != configB {
		t.Fatalf("description config digest = %q, want new config %q", createdData.Document.ConfigDigest, configB)
	}
	assertDescriptionInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, createdData.Document)

	revisedBody := "revised authored description"
	revised := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "USER", "body": revisedBody,
		"accepted": true, "predecessor_id": createdData.Document.ID,
	}))
	if revised.Status != command.StatusSucceeded {
		t.Fatalf("description successor = %q: %+v", revised.Status, revised.Reasons)
	}
	var revisedData command.DescriptionCreateData
	if err := json.Unmarshal(revised.Data, &revisedData); err != nil {
		t.Fatal(err)
	}
	if revisedData.Document.Revision != 2 || revisedData.Document.PredecessorID != createdData.Document.ID || revisedData.Document.Body != revisedBody {
		t.Fatalf("description successor result = %+v", revisedData.Document)
	}
	assertDescriptionInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, revisedData.Document)

	importedBody := "retained imported description"
	imported := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "IMPORTED", "body": importedBody,
		"source_ref": "import:portable-note",
	}))
	if imported.Status != command.StatusSucceeded {
		t.Fatalf("imported-kind description.create = %q: %+v", imported.Status, imported.Reasons)
	}
	var importedData command.DescriptionCreateData
	if err := json.Unmarshal(imported.Data, &importedData); err != nil {
		t.Fatal(err)
	}
	if importedData.Document.Kind != "IMPORTED" || importedData.Document.Body != importedBody {
		t.Fatalf("imported description result = %+v", importedData.Document)
	}
	assertDescriptionInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, importedData.Document)

	// This is a manually supplied candidate fixture. It exercises immutable
	// candidate/acceptance admission and makes no model-integration claim.
	candidate := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "AI_SUMMARY", "body": "manually supplied candidate",
		"producer_profile": "manual-candidate-test", "accepted": false,
	}))
	if candidate.Status != command.StatusSucceeded {
		t.Fatalf("manual AI_SUMMARY candidate = %q: %+v", candidate.Status, candidate.Reasons)
	}
	var candidateData command.DescriptionCreateData
	if err := json.Unmarshal(candidate.Data, &candidateData); err != nil {
		t.Fatal(err)
	}
	if candidateData.Document.Accepted || candidateData.Document.Kind != "AI_SUMMARY" {
		t.Fatalf("candidate must remain non-accepted: %+v", candidateData.Document)
	}
	assertDescriptionInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, candidateData.Document)
	accepted := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "AI_SUMMARY", "body": candidateData.Document.Body,
		"predecessor_id": candidateData.Document.ID, "producer_profile": "manual-candidate-test", "accepted": true,
	}))
	if accepted.Status != command.StatusSucceeded {
		t.Fatalf("accepted manual candidate successor = %q: %+v", accepted.Status, accepted.Reasons)
	}
	var acceptedData command.DescriptionCreateData
	if err := json.Unmarshal(accepted.Data, &acceptedData); err != nil {
		t.Fatal(err)
	}
	if !acceptedData.Document.Accepted || acceptedData.Document.Revision != 2 || acceptedData.Document.PredecessorID != candidateData.Document.ID || acceptedData.Document.Body != candidateData.Document.Body {
		t.Fatalf("accepted candidate successor = %+v", acceptedData.Document)
	}
	assertDescriptionInEveryRetainedParent(t, ctx, fixture, first.WorkspaceID, subject, acceptedData.Document)
	for _, snapshot := range mustCurrentSnapshots(t, ctx, fixture) {
		if snapshot.ConfigDigest != configA {
			t.Fatalf("immutable parent config digest = %q, want original %q", snapshot.ConfigDigest, configA)
		}
	}
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parentState)
}

func TestDescriptionPublicationMissingAuthRetainsCommittedDocument(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	fixture.dispatcher.exact.SigningIdentity = nil
	fixture.dispatcher.exact.TrustAnchor = nil
	body := "saved description without publication credentials"
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "USER", "body": body,
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 || result.Reasons[0].Code != ReasonCodeUnavailable ||
		!strings.Contains(result.Reasons[0].Message, "authenticated recovery publication incomplete") ||
		!strings.Contains(result.Reasons[0].Message, "subject-fact publication requires signing identity, trust anchor, and publication domain") {
		t.Fatalf("missing-auth description result = %q: %+v", result.Status, result.Reasons)
	}
	var data command.DescriptionCreateData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Document.ID == "" || data.Document.Revision != 1 || data.Document.Body != body || data.Document.BodyDigest == "" || len(data.Document.Segments) == 0 {
		t.Fatalf("degraded result lost committed description: %+v", data.Document)
	}
	stored, err := fixture.store.GetDescriptionDocument(ctx, ingested.WorkspaceID, data.Document.ID)
	if err != nil || stored.BodyDigest != data.Document.BodyDigest || stored.Revision != data.Document.Revision {
		t.Fatalf("missing-auth catalog description = %+v, %v", stored, err)
	}
}

func TestDescriptionPublicationPartialParentFailureKeepsWriteAndLexicalResult(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	fixture.dispatcher.exact.ConfigDigest = exact.DigestBytes([]byte("description-partial-parent-config-a"))
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	parents := captureAnnotationParentState(t, ctx, fixture)
	fixture.dispatcher.exact.ConfigDigest = exact.DigestBytes([]byte("description-partial-write-config-b"))
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	fixture.dispatcher.search = &search.Indexer{
		Store:  fixture.store,
		Engine: &search.Engine{Dir: filepath.Join(fixture.repo.Root(), "indexes")},
	}
	failedRepo := &annotationFactFailingRepo{Driver: fixture.repo, RecordDriver: fixture.repo, failAt: 2}
	fixture.dispatcher.exact.Repo = failedRepo
	body := "description remains searchable after partial recovery publication"
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "IMPORTED", "body": body, "source_ref": "import:partial-proof",
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 ||
		(result.Reasons[0].Code != ReasonCodeUnknownExternalOutcome && result.Reasons[0].Code != ReasonCodeNeedsReconciliation) ||
		!strings.Contains(result.Reasons[0].Message, "publish description revision") || !strings.Contains(result.Reasons[0].Message, "injected portable fact placement response loss") {
		t.Fatalf("partial description publication = %q: %+v", result.Status, result.Reasons)
	}
	var data command.DescriptionCreateData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Document.ID == "" || data.Document.Kind != "IMPORTED" || data.Document.Revision != 1 || data.Document.Body != body || data.Document.BodyDigest != exact.DigestBytes([]byte(body)) || len(data.Document.Segments) == 0 {
		t.Fatalf("partial result lost committed description or segments: %+v", data.Document)
	}
	stored, err := fixture.store.GetDescriptionDocument(ctx, first.WorkspaceID, data.Document.ID)
	if err != nil || stored.BodyDigest != data.Document.BodyDigest || stored.Body != body || stored.Revision != 1 {
		t.Fatalf("catalog description after partial publication = %+v, %v", stored, err)
	}
	if failedRepo.failedCalls != 1 || failedRepo.factCalls != 2 {
		t.Fatalf("publication placement calls = total %d failed %d, want exactly one failure on second parent", failedRepo.factCalls, failedRepo.failedCalls)
	}
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
	searchResult := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": first.WorkspaceID, "dimension": search.DimensionLexical, "query": body,
	}))
	if searchResult.Status != command.StatusSucceeded {
		t.Fatalf("lexical search after partial publication = %q: %+v", searchResult.Status, searchResult.Reasons)
	}
	var searchData command.SearchQueryData
	if err := json.Unmarshal(searchResult.Data, &searchData); err != nil {
		t.Fatal(err)
	}
	if len(searchData.Hits) != 1 || searchData.Hits[0].SubjectRef != subject {
		t.Fatalf("lexical search omitted committed description: %+v", searchData.Hits)
	}
}

func assertUnsignedDescriptionDegraded(t *testing.T, result command.Result, wantBody string, wantRevision int64) command.DescriptionDocumentData {
	return assertDescriptionPublicationDegraded(t, result, wantBody, wantRevision, "exact service is unavailable for authenticated recovery publication")
}

func assertDescriptionPublicationDegraded(t *testing.T, result command.Result, wantBody string, wantRevision int64, wantCause string) command.DescriptionDocumentData {
	t.Helper()
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 || result.Reasons[0].Code != ReasonCodeUnavailable ||
		!strings.Contains(result.Reasons[0].Message, "authenticated recovery publication incomplete") ||
		!strings.Contains(result.Reasons[0].Message, wantCause) {
		t.Fatalf("unsigned description result = %q: %+v, want the precise unavailable-publication warning", result.Status, result.Reasons)
	}
	var data command.DescriptionCreateData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	document := data.Document
	if document.ID == "" || document.Revision != wantRevision || document.Body != wantBody || document.BodyDigest == "" || len(document.Segments) == 0 {
		t.Fatalf("unsigned result lost committed description identity/body/segments: %+v", document)
	}
	return document
}

func mustCurrentSnapshots(t *testing.T, ctx context.Context, fixture planIngestFixture) []exact.Manifest {
	t.Helper()
	snapshots, err := fixture.dispatcher.exact.ListSnapshots(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return snapshots
}

func assertDescriptionInEveryRetainedParent(
	t *testing.T,
	ctx context.Context,
	fixture planIngestFixture,
	workspaceID string,
	subject string,
	want command.DescriptionDocumentData,
) {
	t.Helper()
	targets, err := fixture.dispatcher.exact.ResolveSubjectFactPublicationTargets(ctx, workspaceID, []string{subject})
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) < 2 {
		t.Fatalf("retained parents = %d, want both committed snapshots", len(targets))
	}
	readerRepo, err := repository.OpenProfileReadOnly(repository.RepositoryProfileDirectoryCASDev, fixture.repo.Root())
	if err != nil {
		t.Fatal(err)
	}
	anchor := *fixture.dispatcher.exact.TrustAnchor
	reader := &exact.Service{Repo: readerRepo, TrustAnchor: &anchor, PublicationDomain: fixture.dispatcher.exact.PublicationDomain, RequireSignedPublication: true}
	if reader.Store != nil || reader.SigningIdentity != nil {
		t.Fatal("description recovery reader must have no catalog or signing identity")
	}
	for _, target := range targets {
		closures, err := reader.ListPortableFactClosures(ctx, target.SnapshotRef)
		if err != nil || len(closures) == 0 {
			t.Fatalf("catalog-free facts for %s = %d, %v", target.SnapshotRef, len(closures), err)
		}
		var bundle struct {
			Records []struct {
				RecordKind string          `json:"record_kind"`
				RecordID   string          `json:"record_id"`
				Revision   int64           `json:"revision"`
				Payload    json.RawMessage `json:"payload"`
			} `json:"records"`
			Attachments []struct {
				AttachmentID  string `json:"attachment_id"`
				Purpose       string `json:"purpose"`
				ContentID     string `json:"content_id"`
				LogicalLength int64  `json:"logical_length"`
			} `json:"attachments"`
		}
		if err := json.Unmarshal(closures[len(closures)-1].Bundle, &bundle); err != nil {
			t.Fatal(err)
		}
		var description struct {
			ID               string `json:"id"`
			WorkspaceID      string `json:"workspace_id"`
			SubjectRef       string `json:"subject_ref"`
			Kind             string `json:"kind"`
			BodyDigest       string `json:"body_digest"`
			ConfigDigest     string `json:"config_digest"`
			BodyAttachmentID string `json:"body_attachment_id"`
			Accepted         bool   `json:"accepted"`
			Visibility       string `json:"visibility"`
		}
		foundDescription := false
		foundSegments := make(map[string]bool, len(want.Segments))
		for _, record := range bundle.Records {
			switch record.RecordKind {
			case "DESCRIPTION_REVISION":
				if record.RecordID != want.ID || record.Revision != want.Revision {
					continue
				}
				if err := json.Unmarshal(record.Payload, &description); err != nil {
					t.Fatal(err)
				}
				foundDescription = description.ID == want.ID && description.WorkspaceID == workspaceID && description.SubjectRef == subject &&
					description.Kind == want.Kind && description.BodyDigest == want.BodyDigest && description.ConfigDigest == want.ConfigDigest &&
					description.Accepted == want.Accepted && description.Visibility == want.Visibility
			case "SEMANTIC_SEGMENT":
				var segment sqlite.SemanticSegment
				if err := json.Unmarshal(record.Payload, &segment); err != nil {
					t.Fatal(err)
				}
				if segment.DocumentID == want.ID && segment.DocumentRevision == want.Revision {
					foundSegments[segment.ID] = true
				}
			}
		}
		if !foundDescription {
			t.Fatalf("parent %s lacks exact description %s@%d", target.SnapshotRef, want.ID, want.Revision)
		}
		for _, segment := range want.Segments {
			if !foundSegments[segment.ID] {
				t.Fatalf("parent %s lacks segment %s for description %s@%d", target.SnapshotRef, segment.ID, want.ID, want.Revision)
			}
		}
		var bodyContentID string
		var bodyLength int64
		for _, attachment := range bundle.Attachments {
			if attachment.AttachmentID == description.BodyAttachmentID && attachment.Purpose == "DESCRIPTION_BODY" {
				bodyContentID, bodyLength = attachment.ContentID, attachment.LogicalLength
			}
		}
		if bodyContentID != want.BodyDigest || bodyLength != int64(len(want.Body)) {
			t.Fatalf("parent %s description attachment = %s/%d, want %s/%d", target.SnapshotRef, bodyContentID, bodyLength, want.BodyDigest, len(want.Body))
		}
		stream, err := readerRepo.Open(ctx, bodyContentID)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(stream)
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || string(body) != want.Body || exact.DigestBytes(body) != want.BodyDigest {
			t.Fatalf("parent %s description body readback mismatch: read=%v close=%v", target.SnapshotRef, readErr, closeErr)
		}
	}
}
