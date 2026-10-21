package controlplane

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestAnnotationImportPublishesActualRowsForConflictPolicies(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	second := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	if second.WorkspaceID != first.WorkspaceID {
		t.Fatalf("second ingest workspace = %q, want %q", second.WorkspaceID, first.WorkspaceID)
	}

	item := command.AnnotationData{
		ID: newImportTestAnnotationID(t), WorkspaceID: first.WorkspaceID, SubjectRef: subject,
		Kind: "NOTE", Body: "imported exact row", Revision: 1,
	}
	importBundle := func(policy string, body string) command.Result {
		t.Helper()
		bundle := command.AnnotationExportData{
			Schema: command.AnnotationBundleSchema, Conflict: policy,
			Annotations: []command.AnnotationData{{
				ID: item.ID, WorkspaceID: item.WorkspaceID, SubjectRef: item.SubjectRef,
				Kind: item.Kind, Body: body, Revision: item.Revision,
			}},
		}
		return fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationImport, bundle))
	}
	assertResponseAndCoverage := func(result command.Result, wantBody string, wantRevision int64) command.AnnotationData {
		t.Helper()
		if result.Status != command.StatusSucceeded {
			t.Fatalf("annotation import = %q: %+v", result.Status, result.Reasons)
		}
		var data command.AnnotationExportData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatal(err)
		}
		if len(data.Annotations) != 1 {
			t.Fatalf("import response annotations = %d, want 1", len(data.Annotations))
		}
		got := data.Annotations[0]
		if got.ID != item.ID || got.WorkspaceID != item.WorkspaceID || got.SubjectRef != subject ||
			got.Body != wantBody || got.Revision != wantRevision || got.BodyDigest == "" || got.Tombstoned {
			t.Fatalf("import response row = %+v", got)
		}
		stored, err := fixture.store.GetAnnotation(ctx, item.WorkspaceID, item.ID)
		if err != nil || stored.ID != got.ID || stored.Revision != got.Revision ||
			stored.Body != got.Body || stored.BodyDigest != got.BodyDigest || stored.Tombstoned != got.Tombstoned {
			t.Fatalf("stored import row = %+v, %v; response=%+v", stored, err, got)
		}
		assertAnnotationInEveryRetainedParent(t, ctx, fixture, item.WorkspaceID, subject, got)
		return got
	}

	assertResponseAndCoverage(importBundle("", item.Body), item.Body, 1)
	// An identical re-import must use the existing committed row and remain
	// covered without creating a new catalog revision.
	closuresBeforeNoop := importFactClosureDigests(t, ctx, fixture)
	assertResponseAndCoverage(importBundle("", item.Body), item.Body, 1)
	if got := importFactClosureDigests(t, ctx, fixture); !reflect.DeepEqual(closuresBeforeNoop, got) {
		t.Fatalf("idempotent import appended signed successors: before=%v after=%v", closuresBeforeNoop, got)
	}
	// KEEP_LOCAL likewise publishes the selected existing row, not the ignored
	// incoming body.
	closuresBeforeKeepLocal := importFactClosureDigests(t, ctx, fixture)
	assertResponseAndCoverage(importBundle(command.AnnotationConflictKeepLocal, "ignored remote body"), item.Body, 1)
	if got := importFactClosureDigests(t, ctx, fixture); !reflect.DeepEqual(closuresBeforeKeepLocal, got) {
		t.Fatalf("KEEP_LOCAL appended signed successors for an already-covered row: before=%v after=%v", closuresBeforeKeepLocal, got)
	}
	// KEEP_IMPORTED creates and publishes the actual local successor (revision
	// two), rather than the incoming revision number.
	assertResponseAndCoverage(importBundle(command.AnnotationConflictKeepImported, "accepted imported body"), "accepted imported body", 2)
}

func TestAnnotationImportPartialParentFailureKeepsTypedUnknownAndLexicalResult(t *testing.T) {
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
	item := command.AnnotationData{
		ID: newImportTestAnnotationID(t), WorkspaceID: first.WorkspaceID, SubjectRef: subject,
		Kind: "NOTE", Body: "lexical import survives second-parent placement failure", Revision: 1,
	}
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationImport, command.AnnotationExportData{
		Schema: command.AnnotationBundleSchema, Annotations: []command.AnnotationData{item},
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) == 0 ||
		(result.Reasons[0].Code != ReasonCodeUnknownExternalOutcome && result.Reasons[0].Code != ReasonCodeNeedsReconciliation) {
		t.Fatalf("partial import publication = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationExportData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Annotations) != 1 || data.Annotations[0].ID != item.ID || data.Annotations[0].Body != item.Body ||
		data.Annotations[0].Revision != 1 || data.Annotations[0].BodyDigest == "" {
		t.Fatalf("partial import lost committed identity: %+v", data.Annotations)
	}
	stored, err := fixture.store.GetAnnotation(ctx, item.WorkspaceID, item.ID)
	if err != nil || stored.ID != item.ID || stored.Revision != 1 || stored.Body != item.Body || stored.BodyDigest != data.Annotations[0].BodyDigest {
		t.Fatalf("partial import catalog row = %+v, %v", stored, err)
	}
	if failedRepo.factCalls != 2 || failedRepo.failedCalls != 1 {
		t.Fatalf("parent publication calls = total %d, failures %d; want exactly one second-parent failure", failedRepo.factCalls, failedRepo.failedCalls)
	}
	searchResult := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": first.WorkspaceID, "dimension": search.DimensionLexical, "query": item.Body,
	}))
	if searchResult.Status != command.StatusSucceeded {
		t.Fatalf("lexical query after partial import = %q: %+v", searchResult.Status, searchResult.Reasons)
	}
	var searchData command.SearchQueryData
	if err := json.Unmarshal(searchResult.Data, &searchData); err != nil {
		t.Fatal(err)
	}
	if len(searchData.Hits) != 1 || searchData.Hits[0].SubjectRef != subject {
		t.Fatalf("committed import missing from lexical query: %+v", searchData.Hits)
	}
}

func TestAnnotationImportMissingInitialHistoryRetainsRowAndRejectsPublication(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	parents := captureAnnotationParentState(t, ctx, fixture)
	closuresBefore := importFactClosureDigests(t, ctx, fixture)
	item := command.AnnotationData{
		ID: newImportTestAnnotationID(t), WorkspaceID: first.WorkspaceID, SubjectRef: subject,
		Kind: "NOTE", Body: "imported high revision with absent predecessors", Revision: 3, PredecessorRevision: 2,
	}
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationImport, command.AnnotationExportData{
		Schema: command.AnnotationBundleSchema, Annotations: []command.AnnotationData{item},
	}))
	if result.Status != command.StatusDegraded || len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeUnavailable {
		t.Fatalf("import with absent prior revisions = %q: %+v", result.Status, result.Reasons)
	}
	if !(strings.Contains(strings.ToLower(result.Reasons[0].Message), "revision") || strings.Contains(strings.ToLower(result.Reasons[0].Message), "history") || strings.Contains(strings.ToLower(result.Reasons[0].Message), "predecessor")) {
		t.Fatalf("missing-history reason does not describe the publication gap: %+v", result.Reasons[0])
	}
	var data command.AnnotationExportData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Annotations) != 1 || data.Annotations[0].ID != item.ID || data.Annotations[0].Revision != 3 ||
		data.Annotations[0].PredecessorRevision != 2 || data.Annotations[0].Body != item.Body || data.Annotations[0].BodyDigest == "" {
		t.Fatalf("degraded high-revision import lost exact committed row: %+v", data.Annotations)
	}
	stored, err := fixture.store.GetAnnotation(ctx, item.WorkspaceID, item.ID)
	if err != nil || stored.ID != item.ID || stored.Revision != 3 || stored.PredecessorRevision != 2 || stored.Body != item.Body || stored.BodyDigest != data.Annotations[0].BodyDigest {
		t.Fatalf("high-revision catalog row = %+v, %v", stored, err)
	}
	assertAnnotationParentStateUnchanged(t, ctx, fixture, parents)
	if got := importFactClosureDigests(t, ctx, fixture); !reflect.DeepEqual(closuresBefore, got) {
		t.Fatalf("incomplete history created portable successors: before=%v after=%v", closuresBefore, got)
	}
}

func importFactClosureDigests(t *testing.T, ctx context.Context, fixture planIngestFixture) []string {
	t.Helper()
	digests, err := fixture.repo.ListRecordDigests(ctx, repository.RecordPortableFactClosure)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(digests)
	return digests
}

func TestAnnotationImportMissingSignerRetainsCommittedRowAsDegraded(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	first := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	_ = mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, first.WorkspaceID, first.RootID)
	fixture.dispatcher.exact.SigningIdentity = nil
	item := command.AnnotationData{
		ID: newImportTestAnnotationID(t), WorkspaceID: first.WorkspaceID, SubjectRef: subject,
		Kind: "NOTE", Body: "catalog commit survives missing signer", Revision: 1,
	}
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationImport, command.AnnotationExportData{
		Schema: command.AnnotationBundleSchema, Annotations: []command.AnnotationData{item},
	}))
	if result.Status != command.StatusDegraded {
		t.Fatalf("import without signer = %q, want DEGRADED: %+v", result.Status, result.Reasons)
	}
	if len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeUnavailable {
		t.Fatalf("missing-signer import reason = %+v", result.Reasons)
	}
	var data command.AnnotationExportData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Annotations) != 1 || data.Annotations[0].ID != item.ID || data.Annotations[0].Body != item.Body || data.Annotations[0].Revision != 1 {
		t.Fatalf("degraded import lost committed response row: %+v", data.Annotations)
	}
	stored, err := fixture.store.GetAnnotation(ctx, item.WorkspaceID, item.ID)
	if err != nil || stored.ID != item.ID || stored.Body != item.Body || stored.Revision != 1 || stored.BodyDigest == "" {
		t.Fatalf("degraded import catalog row = %+v, %v", stored, err)
	}
}

func newImportTestAnnotationID(t *testing.T) string {
	t.Helper()
	id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAnnotationTagCreateReturnsItsOwnRowWhenConcurrentTombstoneRacesPublication(t *testing.T) {
	ctx := context.Background()
	fixture := newPlanIngestFixture(t, 1)
	ingested := mustAppliedIngest(t, ctx, fixture.dispatcher, map[string]any{"root": fixture.source})
	subject := noteTestSubject(t, fixture.store, ingested.WorkspaceID, ingested.RootID)
	concurrentRepo := &annotationFactFailingRepo{Driver: fixture.repo, RecordDriver: fixture.repo}
	// The hook needs the generated TAG id, which is available only after its
	// row is inserted. Resolve the newly inserted tag by its exact unique body.
	concurrentRepo.beforeFactPlace = func() error {
		records, err := fixture.store.ListAnnotations(ctx, ingested.WorkspaceID, subject, false)
		if err != nil {
			return err
		}
		for _, record := range records {
			if record.Kind == sqlite.AnnotationTag && record.Body == "tag own-row race" {
				return fixture.store.ReviseAnnotation(ctx, ingested.WorkspaceID, record.ID, 1, record.Body, true, time.Now().UTC())
			}
		}
		return nil
	}
	fixture.dispatcher.exact.Repo = concurrentRepo
	result := fixture.dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": subject, "kind": "TAG", "body": "tag own-row race",
	}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("TAG upsert = %q: %+v", result.Status, result.Reasons)
	}
	var data command.AnnotationUpsertData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Annotation.ID == "" || data.Annotation.Kind != "TAG" || data.Annotation.Revision != 1 || data.Annotation.Tombstoned || data.Annotation.Body != "tag own-row race" || data.Annotation.BodyDigest == "" {
		t.Fatalf("TAG response did not preserve create revision: %+v", data.Annotation)
	}
	stored, err := fixture.store.GetAnnotation(ctx, ingested.WorkspaceID, data.Annotation.ID)
	if err != nil || stored.Revision != 2 || !stored.Tombstoned {
		t.Fatalf("concurrent catalog tombstone = %+v, %v", stored, err)
	}
}
