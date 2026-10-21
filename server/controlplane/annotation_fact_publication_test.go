package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestAnnotationNoteUpsertPublishesExactRevisionToEveryRetainedParent(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	// A second committed snapshot retains the same source subject, so Note
	// coverage must advance both authenticated parent chains.
	second := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	if second.WorkspaceID != first.WorkspaceID {
		t.Fatalf("second ingest workspace = %q, want %q", second.WorkspaceID, first.WorkspaceID)
	}
	// A signer and trust anchor enable signed publication even when the
	// optional RequireSignedPublication bit is false.
	fixture.dispatcher.exact.RequireSignedPublication = false

	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "NOTE", "body": "first exact note body",
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create Note = %q: %+v", created.Status, created.Reasons)
	}
	var createdData command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}
	if createdData.Annotation.Revision != 1 || createdData.Annotation.Body != "first exact note body" || createdData.Annotation.BodyDigest == "" {
		t.Fatalf("created Note = %+v", createdData.Annotation)
	}
	assertCleanReaderNoteCoverage(t, ctx, fixture, first.WorkspaceID, subject, createdData.Annotation)

	revised := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "NOTE",
		"body": "second exact note body", "annotation_id": createdData.Annotation.ID, "expected_revision": int64(1),
	}))
	if revised.Status != command.StatusSucceeded {
		t.Fatalf("revise Note = %q: %+v", revised.Status, revised.Reasons)
	}
	var revisedData command.AnnotationUpsertData
	if err := json.Unmarshal(revised.Data, &revisedData); err != nil {
		t.Fatal(err)
	}
	if revisedData.Annotation.ID != createdData.Annotation.ID || revisedData.Annotation.Revision != 2 ||
		revisedData.Annotation.Body != "second exact note body" || revisedData.Annotation.BodyDigest == createdData.Annotation.BodyDigest {
		t.Fatalf("revised Note = %+v", revisedData.Annotation)
	}
	assertCleanReaderNoteCoverage(t, ctx, fixture, first.WorkspaceID, subject, revisedData.Annotation)
}

func assertUnsignedNoteDegraded(t *testing.T, result command.Result, wantBody string, wantRevision int64) command.AnnotationUpsertData {
	t.Helper()
	if result.Status != command.StatusDegraded || len(result.Reasons) != 1 ||
		result.Reasons[0].Code != ReasonCodeUnavailable ||
		!strings.Contains(result.Reasons[0].Message, "subject-fact publication requires signed publication to be enabled") {
		t.Fatalf("unsigned Note result = %q: %+v, want explicit unavailable authenticated-publication warning", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Annotation.ID == "" || data.Annotation.Revision != wantRevision || data.Annotation.Body != wantBody || data.Annotation.BodyDigest == "" {
		t.Fatalf("unsigned Note result did not retain committed identity: %+v", data.Annotation)
	}
	return data
}

func TestAnnotationNoteUpsertMissingAuthIsDegradedWithSavedRecord(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	fixture.dispatcher.exact.RequireSignedPublication = false
	fixture.dispatcher.exact.SigningIdentity = nil
	fixture.dispatcher.exact.TrustAnchor = nil
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "NOTE", "body": "saved without recovery signer",
	}))
	data := assertUnsignedNoteDegraded(t, result, "saved without recovery signer", 1)
	stored, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, data.Annotation.ID)
	if err != nil || stored.BodyDigest != data.Annotation.BodyDigest {
		t.Fatalf("missing-auth committed catalog row = %+v, %v", stored, err)
	}
}

func TestAnnotationNoteUpsertKeepsCatalogWriteOnPartialFactPublication(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	fixture.dispatcher.search = &search.Indexer{
		Store:  fixture.store,
		Engine: &search.Engine{Dir: filepath.Join(fixture.repo.Root(), "indexes")},
	}

	failedRepo := &annotationFactFailingRepo{Driver: fixture.repo, RecordDriver: fixture.repo, failAt: 2}
	fixture.dispatcher.exact.Repo = failedRepo
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": first.WorkspaceID, "subject_ref": subject, "kind": "NOTE", "body": "committed despite partial publication",
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) == 0 {
		t.Fatalf("partial publication result = %q: %+v", result.Status, result.Reasons)
	}
	if result.Reasons[0].Code != ReasonCodeUnknownExternalOutcome && result.Reasons[0].Code != ReasonCodeNeedsReconciliation {
		t.Fatalf("partial publication reason = %+v, want unknown/reconciliation classification", result.Reasons[0])
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Annotation.ID == "" || data.Annotation.Revision != 1 || data.Annotation.Body != "committed despite partial publication" {
		t.Fatalf("degraded result lost committed Note identity: %+v", data.Annotation)
	}
	stored, err := fixture.store.GetAnnotation(ctx, first.WorkspaceID, data.Annotation.ID)
	if err != nil || stored.Revision != data.Annotation.Revision || stored.BodyDigest != data.Annotation.BodyDigest {
		t.Fatalf("catalog write after partial publication = %+v, %v", stored, err)
	}
	if failedRepo.failedCalls != 1 {
		t.Fatalf("portable placement fail calls = %d, want one; mutation must not be retried", failedRepo.failedCalls)
	}
	searchResult := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": first.WorkspaceID, "dimension": search.DimensionLexical,
		"query": "committed despite partial publication",
	}))
	if searchResult.Status != command.StatusSucceeded {
		t.Fatalf("lexical search after degraded Note = %q: %+v", searchResult.Status, searchResult.Reasons)
	}
	var searchData command.SearchQueryData
	if err := json.Unmarshal(searchResult.Data, &searchData); err != nil {
		t.Fatal(err)
	}
	if len(searchData.Hits) != 1 || searchData.Hits[0].SubjectRef != subject {
		t.Fatalf("lexical search did not expose committed Note: %+v", searchData.Hits)
	}
}

func TestAnnotationNoteUpsertReturnsOwnRevisionWhenNewerRevisionRacesPublication(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	created := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "NOTE", "body": "initial note",
	}))
	if created.Status != command.StatusSucceeded {
		t.Fatalf("create Note = %q: %+v", created.Status, created.Reasons)
	}
	var createdData command.AnnotationUpsertData
	if err := json.Unmarshal(created.Data, &createdData); err != nil {
		t.Fatal(err)
	}
	originalCreatedAt := createdData.Annotation.CreatedAt
	concurrentRepo := &annotationFactFailingRepo{Driver: fixture.repo, RecordDriver: fixture.repo}
	concurrentRepo.beforeFactPlace = func() error {
		return fixture.store.ReviseAnnotation(ctx, ingested.WorkspaceID, createdData.Annotation.ID, 2, "concurrent later revision", false, time.Now().UTC())
	}
	fixture.dispatcher.exact.Repo = concurrentRepo
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "NOTE", "body": "this operation revision",
		"annotation_id": createdData.Annotation.ID, "expected_revision": int64(1),
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("racing Note revision = %q: %+v", result.Status, result.Reasons)
	}
	var response command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &response); err != nil {
		t.Fatal(err)
	}
	if response.Annotation.ID != createdData.Annotation.ID || response.Annotation.Revision != 2 ||
		response.Annotation.Body != "this operation revision" || response.Annotation.BodyDigest == createdData.Annotation.BodyDigest ||
		response.Annotation.CreatedAt != originalCreatedAt {
		t.Fatalf("response did not preserve this operation's committed revision: %+v", response.Annotation)
	}
	latest, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, createdData.Annotation.ID)
	if err != nil || latest.Revision != 3 || latest.Body != "concurrent later revision" {
		t.Fatalf("later concurrent catalog revision = %+v, %v", latest, err)
	}
}

func noteTestSubject(t *testing.T, store *sqlite.Store, workspaceID, rootID string) string {
	t.Helper()
	nodes, err := store.ListNamespaceSubtree(context.Background(), workspaceID, rootID, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range nodes {
		if node.Entry.ContentID != "" && node.Entry.SubjectRef != "" {
			return node.Entry.SubjectRef
		}
	}
	t.Fatal("ingested file stable subject is missing")
	return ""
}

func assertCleanReaderNoteCoverage(t *testing.T, ctx context.Context, fixture planIngestFixture, workspaceID, subject string, want command.AnnotationData) {
	t.Helper()
	snapshots, err := fixture.dispatcher.exact.ListSnapshots(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) < 2 {
		t.Fatalf("retained snapshots = %d, want both ingested parents", len(snapshots))
	}
	readerRepo, err := repository.OpenProfileReadOnly(repository.RepositoryProfileDirectoryCASDev, fixture.repo.Root())
	if err != nil {
		t.Fatalf("open independent recovery reader: %v", err)
	}
	anchor := *fixture.dispatcher.exact.TrustAnchor
	reader := &exact.Service{Repo: readerRepo, TrustAnchor: &anchor, PublicationDomain: fixture.dispatcher.exact.PublicationDomain, RequireSignedPublication: true}
	if reader.Store != nil || reader.SigningIdentity != nil {
		t.Fatal("clean reader must have no catalog or signing identity")
	}
	targets, err := fixture.dispatcher.exact.ResolveSubjectFactPublicationTargets(ctx, workspaceID, []string{subject})
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, snapshot := range snapshots {
		containsSnapshot := false
		for _, target := range targets {
			if target.SnapshotRef == snapshot.SnapshotRef {
				containsSnapshot = true
				break
			}
		}
		if !containsSnapshot {
			continue
		}
		reference, err := fixture.dispatcher.exact.BuildRecoveryReference(ctx, snapshot.SnapshotRef)
		if err != nil {
			t.Fatalf("build clean-reader reference for %s: %v", snapshot.SnapshotRef, err)
		}
		if err := reference.ValidateAgainstRepository(ctx, readerRepo, anchor); err != nil {
			t.Fatalf("clean-reader validation for %s: %v", snapshot.SnapshotRef, err)
		}
		closures, err := reader.ListPortableFactClosures(ctx, snapshot.SnapshotRef)
		if err != nil {
			t.Fatalf("catalog-free portable fact read for %s: %v", snapshot.SnapshotRef, err)
		}
		if len(closures) == 0 {
			t.Fatalf("clean-reader reference for %s has no portable facts", snapshot.SnapshotRef)
		}
		var bundle struct {
			Records []struct {
				RecordKind string          `json:"record_kind"`
				RecordID   string          `json:"record_id"`
				Revision   int64           `json:"revision"`
				Payload    json.RawMessage `json:"payload"`
			} `json:"records"`
		}
		if err := json.Unmarshal(closures[len(closures)-1].Bundle, &bundle); err != nil {
			t.Fatalf("decode clean-reader facts for %s: %v", snapshot.SnapshotRef, err)
		}
		covered := false
		for _, record := range bundle.Records {
			if record.RecordKind != "ANNOTATION_REVISION" || record.RecordID != fmt.Sprintf("%s@%d", want.ID, want.Revision) || record.Revision != want.Revision {
				continue
			}
			var actual sqlite.AnnotationRevision
			if err := json.Unmarshal(record.Payload, &actual); err != nil {
				t.Fatal(err)
			}
			covered = actual.AnnotationID == want.ID && actual.SubjectRef == subject && actual.Revision == want.Revision &&
				actual.Body == want.Body && actual.BodyDigest == want.BodyDigest && !actual.Tombstoned
		}
		if !covered {
			t.Fatalf("clean-reader parent %s lacks exact Note %s@%d body/digest", snapshot.SnapshotRef, want.ID, want.Revision)
		}
		seen++
	}
	if seen != len(snapshots) {
		t.Fatalf("subject mapped into %d of %d retained parents", seen, len(snapshots))
	}
}

type annotationFactFailingRepo struct {
	repository.Driver
	repository.RecordDriver
	failAt          int
	factCalls       int
	failedCalls     int
	beforeFactPlace func() error
	hookCalled      bool
}

func (r *annotationFactFailingRepo) RepositoryProfile() repository.ProfileDescription {
	return repository.DescribeProfile(r.Driver)
}

func (r *annotationFactFailingRepo) PlaceRecord(ctx context.Context, role repository.RecordRole, body io.Reader) (repository.RecordReceipt, error) {
	if role == repository.RecordPortableFactClosure {
		r.factCalls++
		if r.beforeFactPlace != nil && !r.hookCalled {
			r.hookCalled = true
			if err := r.beforeFactPlace(); err != nil {
				return repository.RecordReceipt{}, err
			}
		}
		if r.factCalls == r.failAt {
			r.failedCalls++
			return repository.RecordReceipt{}, errors.New("injected portable fact placement response loss")
		}
	}
	return r.RecordDriver.PlaceRecord(ctx, role, body)
}

var _ repository.Driver = (*annotationFactFailingRepo)(nil)
var _ repository.RecordDriver = (*annotationFactFailingRepo)(nil)
