package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func newSearchRebuildDispatcher(t *testing.T, fixtures bool) *Dispatcher {
	t.Helper()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	opts := []DispatcherOption{WithExact(&exact.Service{Store: store, Repo: repo})}
	if fixtures {
		opts = append(opts, WithFixtureDimensions())
	}
	return NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", opts...)
}

func TestSearchRebuildCreatesLexicalGenerationAndReportsSemanticDegraded(t *testing.T) {
	ctx := context.Background()
	dispatcher := newSearchRebuildDispatcher(t, false)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "rebuild.txt"), []byte("rebuild search"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingested := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{
		"workspace_id": ingested.WorkspaceID,
	}))
	if result.Status != command.StatusDegraded {
		t.Fatalf("search.rebuild = %q: %+v", result.Status, result.Reasons)
	}
	var data command.SearchRebuildData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode search.rebuild: %v", err)
	}
	if data.WorkspaceID != ingested.WorkspaceID || data.SnapshotRef != ingested.SnapshotRef || data.NamespaceRootID != ingested.RootID {
		t.Fatalf("publication projection = %+v", data)
	}
	if data.LexicalGenerationRef == "" || data.LexicalState != command.CapabilityAvailable {
		t.Fatalf("lexical projection = %+v", data)
	}
	if sourceCoverage := data.LexicalCoverage.SourceCoverage; sourceCoverage == nil || !sourceCoverage.Available || !sourceCoverage.Complete ||
		sourceCoverage.GenerationID != data.LexicalGenerationRef || sourceCoverage.SnapshotRef != data.SnapshotRef ||
		sourceCoverage.NamespaceRootID != data.NamespaceRootID || sourceCoverage.Expected == 0 {
		t.Fatalf("lexical source coverage = %+v", sourceCoverage)
	}
	measuredCoverage, err := dispatcher.search.Coverage(ctx, ingested.WorkspaceID)
	if err != nil {
		t.Fatalf("measure lexical coverage: %v", err)
	}
	if want := projectSearchCoverage(measuredCoverage); !reflect.DeepEqual(data.LexicalCoverage, want) {
		t.Fatalf("lexical coverage projection = %+v, want %+v", data.LexicalCoverage, want)
	}
	lexical, err := dispatcher.search.Store.GetIndexGeneration(ctx, data.LexicalGenerationRef)
	if err != nil {
		t.Fatalf("get rebuilt lexical generation: %v", err)
	}
	if data.SnapshotRef != lexical.SnapshotRef || data.NamespaceRootID != lexical.NamespaceRootID || data.WorkspaceID != lexical.WorkspaceID {
		t.Fatalf("rebuild response escaped lexical generation: data=%+v generation=%+v", data, lexical)
	}
	if data.SemanticState != command.CapabilityUnavailable || strings.TrimSpace(data.SemanticFailure) == "" {
		t.Fatalf("semantic degradation = %+v", data)
	}
}

func TestProjectSearchCoveragePreservesSourceCoverageAndLegacyJSON(t *testing.T) {
	statement := &search.SourceCoverageStatement{
		Scope: search.SourceCoverageScopeLexicalSelectedTextV1, GenerationID: "generation-1",
		SnapshotRef: "snapshot-1", NamespaceRootID: "root-1", ConfigDigest: "config-1", ProfileDigest: "profile-1",
		Available: true, Complete: true, Expected: 1, Indexed: 1,
		Rows: []search.SourceCoverageRow{{
			SourceKind: "DESCRIPTION", SourceSubtype: "USER", Field: "descriptions", SourceRef: "description-1",
			Revision: "2", SourceDigest: "sha256:abc", Disposition: search.SourceCoverageIndexed,
		}},
	}
	projected := projectSearchCoverage(search.CoverageStatement{
		Dimension: search.DimensionLexical, Available: true, Complete: false,
		Fields: search.FieldCoverage{search.AxisName: true}, Missing: []string{search.AxisTags},
		SourceCoverage: statement,
	})
	if projected.Complete || projected.Fields[search.AxisName] != true || projected.SourceCoverage == nil {
		t.Fatalf("aggregate/source completeness were conflated: %+v", projected)
	}
	source := projected.SourceCoverage
	if source.GenerationID != "generation-1" || source.ConfigDigest != "config-1" || source.Expected != 1 ||
		len(source.Rows) != 1 || source.Rows[0].SourceSubtype != "USER" ||
		source.Rows[0].Disposition != command.SearchSourceCoverageIndexed {
		t.Fatalf("source coverage projection = %+v", source)
	}

	// Old daemons omit the additive property. Old payloads remain decodable and
	// absence stays distinct from an available, empty inventory.
	legacy := []byte(`{"dimension":"lexical","available":true,"complete":true,"fields":{},"missing":[]}`)
	var decoded command.SearchCoverageData
	if err := json.Unmarshal(legacy, &decoded); err != nil {
		t.Fatalf("decode legacy coverage: %v", err)
	}
	if decoded.SourceCoverage != nil {
		t.Fatalf("legacy payload invented source coverage: %+v", decoded.SourceCoverage)
	}
	encoded, err := json.Marshal(command.SearchCoverageData{Dimension: search.DimensionLexical, Available: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"source_coverage"`) {
		t.Fatalf("absent optional detail should be omitted: %s", encoded)
	}
}

func TestProjectSemanticSourceCoveragePreservesLineageAndInputOutcomes(t *testing.T) {
	statement := &search.SemanticSourceCoverageStatement{
		Scope: "SEMANTIC_SELECTED_TEXT_V1", GenerationID: "semantic-generation", SnapshotRef: "snapshot",
		NamespaceRootID: "root", ConfigDigest: "config", ProfileDigest: "profile", Available: true,
		Complete: false, Expected: 2, Indexed: 1, Excluded: 0, Missing: 0, Unavailable: 1,
		InputFull: 1, InputTruncated: 0, InputUnknown: 1, Truncated: false,
		Rows: []search.SemanticSourceCoverageRow{{
			SubjectID: "subject", SourceKind: "DESCRIPTION", SourceSubtype: "USER", SourceRef: "description",
			Revision: "2", BodyDigest: "sha256:body", Disposition: search.SemanticSourceUnavailable,
			Reason: search.SemanticSourceReasonInputIdentityMismatch, SegmentCount: 2, SegmentIndexed: 1,
			SegmentMissing: 1, InputFull: 1, InputTruncated: 0, InputUnknown: 1,
		}},
	}
	projected := projectSemanticSourceCoverage(statement)
	if projected == nil || projected.Complete || !projected.Available || projected.GenerationID != statement.GenerationID ||
		projected.SnapshotRef != statement.SnapshotRef || projected.NamespaceRootID != statement.NamespaceRootID ||
		projected.InputFull != 1 || projected.InputUnknown != 1 || len(projected.Rows) != 1 {
		t.Fatalf("semantic source coverage projection = %+v", projected)
	}
	row := projected.Rows[0]
	if row.SourceRef != "description" || row.Revision != "2" || row.Disposition != command.SearchSemanticSourceUnavailable ||
		row.SegmentIndexed != 1 || row.SegmentMissing != 1 || row.InputUnknown != 1 {
		t.Fatalf("semantic source row projection = %+v", row)
	}
	legacy, err := json.Marshal(command.SearchRebuildData{SemanticState: command.CapabilityAvailable})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(legacy), `"semantic_source_coverage"`) {
		t.Fatalf("absent semantic source evidence must be omitted: %s", legacy)
	}
}

func TestSearchRebuildReportsFixtureSemanticReady(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	manifest := search.EmbeddingGenerationManifest{
		RuntimeDigest: "runtime", ModelDigest: "model", TokenizerDigest: "tokenizer", PreprocessingDigest: "preprocess",
		Pooling: "cls", Normalization: "l2", ElementType: "float32", Dimension: 2, VectorSchema: "float32:2",
		SemanticSpace: "test-space", Distance: "cosine", IndexConfig: search.ZvecIndexConfigV1, QueryConfig: search.ZvecQueryConfigV1,
		ProviderDigest: "provider", ConfigDigest: "config",
	}
	zvec := &rebuildSemanticZvec{}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock",
		WithConfigDigest(manifest.ConfigDigest),
		WithSemanticIndexerBinding(rebuildSemanticProvider{}, zvec, "/tmp/libzvec", "sha256:"+strings.Repeat("a", 64), manifest),
		WithExact(&exact.Service{Store: store, Repo: repo, ConfigDigest: manifest.ConfigDigest}))
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "fixture.txt"), []byte("fixture search"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingested := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	resolved := dispatcher.Handle(ctx, mustEnvelope(t, command.OpNamespaceResolve, map[string]any{
		"workspace_id": ingested.WorkspaceID, "root_id": ingested.RootID, "path": "fixture.txt",
	}))
	if resolved.Status != command.StatusSucceeded {
		t.Fatalf("namespace.resolve = %q: %+v", resolved.Status, resolved.Reasons)
	}
	var entry command.NamespaceResolveData
	if err := json.Unmarshal(resolved.Data, &entry); err != nil {
		t.Fatal(err)
	}
	described := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "USER", "body": "fixture semantic text", "language": "en", "accepted": true,
	}))
	assertDescriptionPublicationDegraded(t, described, "fixture semantic text", 1, "subject-fact publication requires signed publication to be enabled")
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{
		"workspace_id": ingested.WorkspaceID,
	}))
	if result.Status != command.StatusDegraded {
		t.Fatalf("search.rebuild = %q: %+v", result.Status, result.Reasons)
	}
	var data command.SearchRebuildData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode search.rebuild: %v", err)
	}
	if data.LexicalGenerationRef == "" || data.SemanticGenerationRef == "" ||
		data.LexicalState != command.CapabilityAvailable || data.SemanticState != command.CapabilityAvailable {
		t.Fatalf("ready projection = %+v", data)
	}
	if data.SemanticSourceCoverage == nil || data.SemanticSourceCoverage.Complete || data.SemanticSourceCoverage.InputUnknown == 0 {
		t.Fatalf("fixture vector membership was treated as full source evidence: %+v", data.SemanticSourceCoverage)
	}
	if data.LexicalCoverage.Dimension != search.DimensionLexical || !data.LexicalCoverage.Available || data.LexicalCoverage.Complete || len(data.LexicalCoverage.Missing) == 0 {
		t.Fatalf("lexical coverage = %+v", data.LexicalCoverage)
	}
	semantic, err := dispatcher.search.Store.LatestIndexGeneration(ctx, ingested.WorkspaceID, search.DimensionSemantic)
	if err != nil {
		t.Fatalf("get semantic generation: %v", err)
	}
	mismatchID, err := sqlite.NewStableID(sqlite.IDPrefixIndexGeneration)
	if err != nil {
		t.Fatal(err)
	}
	mismatch := semantic
	mismatch.ID = mismatchID
	mismatch.SnapshotRef = "snapshot-mismatch"
	mismatch.CreatedAt = time.Now().Add(time.Hour)
	if err := dispatcher.search.Store.InsertIndexGeneration(ctx, &mismatch); err != nil {
		t.Fatalf("insert mismatched semantic generation: %v", err)
	}
	degraded := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{
		"workspace_id": ingested.WorkspaceID,
	}))
	if degraded.Status != command.StatusDegraded {
		t.Fatalf("mismatched semantic generation status = %q: %+v", degraded.Status, degraded.Reasons)
	}
	var degradedData command.SearchRebuildData
	if err := json.Unmarshal(degraded.Data, &degradedData); err != nil {
		t.Fatal(err)
	}
	if degradedData.SemanticState != command.CapabilityUnavailable || degradedData.SemanticGenerationRef != "" || degradedData.SemanticFailure != "semantic generation does not match rebuilt lexical snapshot" {
		t.Fatalf("mismatched semantic generation projection = %+v", degradedData)
	}
}

type documentEmbedCounter struct {
	documentCalls atomic.Int32
	queryCalls    atomic.Int32
	ready         atomic.Bool
}

type latencyZvec struct {
	mu       sync.Mutex
	segments map[string][]search.ZvecSegment
	ready    atomic.Bool
}

func (d *latencyZvec) ZvecReady(string, string, search.EmbeddingGenerationManifest) bool {
	return d.ready.Load()
}

func (d *latencyZvec) Build(_ context.Context, spec search.ZvecGenerationSpec, segments []search.ZvecSegment) (search.ZvecGenerationReceipt, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.segments == nil {
		d.segments = make(map[string][]search.ZvecSegment)
	}
	d.segments[spec.Path] = append([]search.ZvecSegment(nil), segments...)
	return search.ZvecGenerationReceipt{Path: spec.Path, LibraryDigest: spec.LibraryDigest, ProfileDigest: spec.ProfileDigest,
		Dimension: spec.Manifest.Dimension, SegmentCount: len(segments)}, nil
}

func (d *latencyZvec) Open(_ context.Context, spec search.ZvecGenerationSpec) (search.ZvecGeneration, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return latencyZvecGeneration{segments: append([]search.ZvecSegment(nil), d.segments[spec.Path]...), dimension: spec.Manifest.Dimension}, nil
}

func (d *latencyZvec) CoveragePairs(_ context.Context, spec search.ZvecGenerationSpec) ([]search.ZvecCoverageIdentity, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	segments := d.segments[spec.Path]
	pairs := make([]search.ZvecCoverageIdentity, 0, len(segments))
	for _, segment := range segments {
		pairs = append(pairs, search.ZvecCoverageIdentity{SubjectID: segment.SubjectID, SegmentID: segment.SegmentID})
	}
	return pairs, nil
}

func (d *latencyZvec) VerifyMembership(_ context.Context, spec search.ZvecGenerationSpec, candidates []search.ZvecCoverageIdentity) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	known := make(map[search.ZvecCoverageIdentity]struct{}, len(d.segments[spec.Path]))
	for _, segment := range d.segments[spec.Path] {
		known[search.ZvecCoverageIdentity{SubjectID: segment.SubjectID, SegmentID: segment.SegmentID}] = struct{}{}
	}
	for _, candidate := range candidates {
		if _, ok := known[candidate]; !ok {
			return search.ErrZvecUnavailable
		}
	}
	return nil
}

type latencyZvecGeneration struct {
	segments  []search.ZvecSegment
	dimension int
}

func (g latencyZvecGeneration) Query(_ context.Context, vector []float32, topK int) ([]search.ZvecHit, error) {
	if len(vector) != g.dimension {
		return nil, search.ErrInvalidZvecGeneration
	}
	hits := make([]search.ZvecHit, 0, len(g.segments))
	for _, segment := range g.segments {
		hits = append(hits, search.ZvecHit{SubjectID: segment.SubjectID, SegmentID: segment.SegmentID, Score: 1})
	}
	if topK < len(hits) {
		hits = hits[:topK]
	}
	return hits, nil
}

func (latencyZvecGeneration) Close() error { return nil }

func (p *documentEmbedCounter) SemanticReady() bool { return p.ready.Load() }

func (p *documentEmbedCounter) Embed(_ context.Context, req search.SemanticEmbeddingRequest) ([]search.SemanticVector, error) {
	if req.Purpose == search.SemanticEmbeddingDocument {
		p.documentCalls.Add(1)
	} else {
		p.queryCalls.Add(1)
	}
	results := make([]search.SemanticVector, 0, len(req.Inputs))
	for _, input := range req.Inputs {
		results = append(results, search.SemanticVector{SubjectID: input.SubjectID, SegmentID: input.SegmentID, Vector: []float32{1, 0}})
	}
	return results, nil
}

func TestSemanticEmbeddingIsExplicitAfterOrdinaryWrites(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	manifest := search.EmbeddingGenerationManifest{
		RuntimeDigest: "runtime", ModelDigest: "model", TokenizerDigest: "tokenizer", PreprocessingDigest: "preprocess",
		Pooling: "cls", Normalization: "l2", ElementType: "float32", Dimension: 2, VectorSchema: "float32:2",
		SemanticSpace: search.SemanticBundleBGESemanticSpace, Distance: "cosine", IndexConfig: search.ZvecIndexConfigV1,
		QueryConfig: search.ZvecQueryConfigV1, ProviderDigest: "provider", ConfigDigest: "config",
	}
	provider := &documentEmbedCounter{}
	provider.ready.Store(true)
	zvec := &latencyZvec{}
	zvec.ready.Store(true)
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock",
		WithConfigDigest(manifest.ConfigDigest),
		WithSemanticIndexerBinding(provider, zvec, "/tmp/libzvec", "sha256:"+strings.Repeat("a", 64), manifest),
		WithExact(&exact.Service{Store: store, Repo: repo, ConfigDigest: manifest.ConfigDigest}))
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "fixture.txt"), []byte("lexical source stays immediate"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingested := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	if got := provider.documentCalls.Load(); got != 0 {
		t.Fatalf("ordinary exact ingest document Embed calls = %d, want 0", got)
	}
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "NOT_BUILT" {
		t.Fatalf("semantic state before explicit rebuild = %q, want NOT_BUILT", states.semanticState)
	}
	resolve := dispatcher.Handle(ctx, mustEnvelope(t, command.OpNamespaceResolve, map[string]any{
		"workspace_id": ingested.WorkspaceID, "root_id": ingested.RootID, "path": "fixture.txt",
	}))
	if resolve.Status != command.StatusSucceeded {
		t.Fatalf("namespace.resolve = %q: %+v", resolve.Status, resolve.Reasons)
	}
	var entry command.NamespaceResolveData
	if err := json.Unmarshal(resolve.Data, &entry); err != nil {
		t.Fatal(err)
	}
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "lexical source", entry.Entry.SubjectRef)
	if _, err := dispatcher.search.RebuildLatest(ctx, ingested.WorkspaceID); err != nil {
		t.Fatalf("explicit semantic baseline rebuild: %v", err)
	}
	if got := provider.documentCalls.Load(); got == 0 {
		t.Fatal("explicit semantic rebuild did not make document Embed calls")
	}
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "READY" {
		t.Fatalf("semantic state after explicit rebuild = %q, want READY", states.semanticState)
	} else if _, covered := states.semanticBySubject[entry.Entry.SubjectRef]; !covered {
		t.Fatalf("semantic coverage omitted current subject %q after explicit rebuild", entry.Entry.SubjectRef)
	}
	provider.documentCalls.Store(0)

	// TAG changes refresh lexical search but do not invalidate selected semantic
	// text identities or trigger document embedding.
	tag := dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "TAG", "body": "reviewed",
	}))
	assertUnsignedFixtureTAG(t, tag, ingested.WorkspaceID, "reviewed")
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "reviewed", entry.Entry.SubjectRef)
	if _, _, err := dispatcher.search.Query(ctx, search.QueryRequest{WorkspaceID: ingested.WorkspaceID, Dimension: search.DimensionSemantic, Text: "lexical"}); err != nil {
		t.Fatalf("TAG-only mutation should preserve current semantic generation: %v; semantic failure=%q", err, dispatcher.search.SemanticFailure())
	}
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "READY" {
		t.Fatalf("semantic state after TAG-only mutation = %q, want READY", states.semanticState)
	}
	if got := provider.documentCalls.Load(); got != 0 {
		t.Fatalf("TAG mutation document Embed calls = %d, want 0", got)
	}

	note := dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "NOTE", "body": "first operator note",
	}))
	noteData := assertUnsignedNoteDegraded(t, note, "first operator note", 1)
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "first operator note", entry.Entry.SubjectRef)
	if _, _, err := dispatcher.search.Query(ctx, search.QueryRequest{WorkspaceID: ingested.WorkspaceID, Dimension: search.DimensionSemantic, Text: "first"}); !errors.Is(err, search.ErrUnavailable) {
		t.Fatalf("default semantic after Note create = %v, want stale UNAVAILABLE", err)
	}
	if _, err := dispatcher.search.SemanticSubjectCoverage(ctx, ingested.WorkspaceID); !errors.Is(err, search.ErrUnavailable) {
		t.Fatalf("per-file semantic coverage after Note create = %v, want unavailable", err)
	}
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "UNAVAILABLE" {
		t.Fatalf("semantic state after Note create = %q, want UNAVAILABLE", states.semanticState)
	}
	pinnedGeneration := mustLatestGenerationID(t, ctx, dispatcher.search, ingested.WorkspaceID, search.DimensionSemantic)
	queriesBeforePin := provider.queryCalls.Load()
	pinned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": ingested.WorkspaceID, "dimension": search.DimensionSemantic,
		"index_generation_ref": pinnedGeneration, "query": "lexical",
	}))
	if pinned.Status != command.StatusSucceeded || provider.queryCalls.Load() <= queriesBeforePin {
		t.Fatalf("pinned historical semantic query while feed-stale = %q, reasons=%+v, query calls %d -> %d", pinned.Status, pinned.Reasons, queriesBeforePin, provider.queryCalls.Load())
	}
	provider.ready.Store(false)
	queriesBeforeUnhealthyPin := provider.queryCalls.Load()
	unhealthyPinned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": ingested.WorkspaceID, "dimension": search.DimensionSemantic,
		"index_generation_ref": pinnedGeneration, "query": "lexical",
	}))
	if unhealthyPinned.Status == command.StatusSucceeded || provider.queryCalls.Load() != queriesBeforeUnhealthyPin {
		t.Fatalf("pinned semantic query bypassed provider failure: status=%q reasons=%+v calls=%d -> %d", unhealthyPinned.Status, unhealthyPinned.Reasons, queriesBeforeUnhealthyPin, provider.queryCalls.Load())
	}
	provider.ready.Store(true)
	revised := dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationUpsert, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "NOTE", "body": "revised operator note",
		"annotation_id": noteData.Annotation.ID, "expected_revision": noteData.Annotation.Revision,
	}))
	revisedData := assertUnsignedNoteDegraded(t, revised, "revised operator note", 2)
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "revised operator note", entry.Entry.SubjectRef)
	assertLexicalQueryHasNoResults(t, ctx, dispatcher.search, ingested.WorkspaceID, "first operator note")
	deleted := dispatcher.Handle(ctx, mustEnvelope(t, command.OpAnnotationDelete, map[string]any{
		"workspace_id": ingested.WorkspaceID, "annotation_id": noteData.Annotation.ID, "expected_revision": 2,
	}))
	assertUnsignedFixtureTombstone(t, deleted, revisedData.Annotation)
	assertLexicalQueryHasNoResults(t, ctx, dispatcher.search, ingested.WorkspaceID, "revised operator note")
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "READY" {
		t.Fatalf("semantic state after deleting Note back to the indexed feed = %q, want READY", states.semanticState)
	} else if _, covered := states.semanticBySubject[entry.Entry.SubjectRef]; !covered {
		t.Fatalf("restored current-feed semantic coverage omitted subject %q", entry.Entry.SubjectRef)
	}
	if _, _, err := dispatcher.search.Query(ctx, search.QueryRequest{WorkspaceID: ingested.WorkspaceID, Dimension: search.DimensionSemantic, Text: "lexical"}); err != nil {
		t.Fatalf("semantic query after deleting Note back to indexed feed: %v", err)
	}
	if got := provider.documentCalls.Load(); got != 0 {
		t.Fatalf("restoring equal current feed made %d document Embed calls, want 0", got)
	}
	firstDescription := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "IMPORTED", "body": "imported description one", "accepted": true,
	}))
	firstDoc := assertDescriptionPublicationDegraded(t, firstDescription, "imported description one", 1, "subject-fact publication requires signed publication to be enabled")
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "imported description one", entry.Entry.SubjectRef)
	secondDescription := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "IMPORTED", "body": "imported description successor", "accepted": true,
		"predecessor_id": firstDoc.ID,
	}))
	assertDescriptionPublicationDegraded(t, secondDescription, "imported description successor", 2, "subject-fact publication requires signed publication to be enabled")
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "imported description successor", entry.Entry.SubjectRef)
	if got := provider.documentCalls.Load(); got != 0 {
		t.Fatalf("ordinary metadata writes made %d document Embed calls, want 0", got)
	}
	if _, _, err := dispatcher.search.Query(ctx, search.QueryRequest{WorkspaceID: ingested.WorkspaceID, Dimension: search.DimensionSemantic, Text: "imported"}); !errors.Is(err, search.ErrUnavailable) {
		t.Fatalf("default semantic after description successor = %v, want stale UNAVAILABLE", err)
	}

	rebuilt := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{"workspace_id": ingested.WorkspaceID}))
	if rebuilt.Status != command.StatusDegraded && rebuilt.Status != command.StatusSucceeded {
		t.Fatalf("explicit search.rebuild = %q: %+v", rebuilt.Status, rebuilt.Reasons)
	}
	if got := provider.documentCalls.Load(); got == 0 {
		t.Fatal("explicit search.rebuild did not restore semantic generation with document Embed calls")
	}
	if _, _, err := dispatcher.search.Query(ctx, search.QueryRequest{WorkspaceID: ingested.WorkspaceID, Dimension: search.DimensionSemantic, Text: "imported"}); err != nil {
		t.Fatalf("default semantic after explicit rebuild = %v", err)
	}
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "READY" {
		t.Fatalf("semantic state after explicit search.rebuild = %q, want READY", states.semanticState)
	} else if _, covered := states.semanticBySubject[entry.Entry.SubjectRef]; !covered {
		t.Fatalf("semantic coverage omitted current subject %q after explicit search.rebuild", entry.Entry.SubjectRef)
	}
	provider.documentCalls.Store(0)

	// A later ordinary publication can add another namespace root without
	// changing the original root's metadata. It still invalidates default
	// semantic readiness while preserving the pinned prior generation.
	pinnedBeforeNewRoot := mustLatestGenerationID(t, ctx, dispatcher.search, ingested.WorkspaceID, search.DimensionSemantic)
	secondRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(secondRoot, "second.txt"), []byte("second published lexical root"), 0o600); err != nil {
		t.Fatal(err)
	}
	second := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"workspace_id": ingested.WorkspaceID, "root": secondRoot})
	if second.WorkspaceID != ingested.WorkspaceID {
		t.Fatalf("second publication workspace = %q, want %q", second.WorkspaceID, ingested.WorkspaceID)
	}
	if got := provider.documentCalls.Load(); got != 0 {
		t.Fatalf("ordinary second-root ingest made %d document Embed calls, want 0", got)
	}
	if states := dispatcher.indexDimensionStates(ctx, ingested.WorkspaceID); states.semanticState != "UNAVAILABLE" {
		t.Fatalf("semantic state after second-root ingest = %q, want UNAVAILABLE", states.semanticState)
	}
	if _, err := dispatcher.search.SemanticSubjectCoverage(ctx, ingested.WorkspaceID); !errors.Is(err, search.ErrUnavailable) {
		t.Fatalf("per-file semantic coverage after second-root ingest = %v, want unavailable", err)
	}
	secondEntryResult := dispatcher.Handle(ctx, mustEnvelope(t, command.OpNamespaceResolve, map[string]any{
		"workspace_id": ingested.WorkspaceID, "root_id": second.RootID, "path": "second.txt",
	}))
	if secondEntryResult.Status != command.StatusSucceeded {
		t.Fatalf("second-root namespace.resolve = %q: %+v", secondEntryResult.Status, secondEntryResult.Reasons)
	}
	var secondEntry command.NamespaceResolveData
	if err := json.Unmarshal(secondEntryResult.Data, &secondEntry); err != nil {
		t.Fatal(err)
	}
	assertLexicalQueryHasSubject(t, ctx, dispatcher.search, ingested.WorkspaceID, "second published lexical root", secondEntry.Entry.SubjectRef)
	pinned = dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": ingested.WorkspaceID, "dimension": search.DimensionSemantic,
		"index_generation_ref": pinnedBeforeNewRoot, "query": "lexical",
	}))
	if pinned.Status != command.StatusSucceeded {
		t.Fatalf("pinned prior semantic generation after second-root ingest = %q: %+v", pinned.Status, pinned.Reasons)
	}
}

func assertLexicalQueryHasSubject(t *testing.T, ctx context.Context, indexer *search.Indexer, workspaceID, text, subjectID string) {
	t.Helper()
	_, hits, err := indexer.Query(ctx, search.QueryRequest{WorkspaceID: workspaceID, Dimension: search.DimensionLexical, Text: text})
	for _, hit := range hits {
		if hit.SubjectID == subjectID {
			return
		}
	}
	t.Fatalf("fresh lexical query %q = %+v, err=%v; want subject %q", text, hits, err, subjectID)
}

func assertLexicalQueryHasNoResults(t *testing.T, ctx context.Context, indexer *search.Indexer, workspaceID, text string) {
	t.Helper()
	_, hits, err := indexer.Query(ctx, search.QueryRequest{WorkspaceID: workspaceID, Dimension: search.DimensionLexical, Text: text})
	if err != nil || len(hits) != 0 {
		t.Fatalf("fresh lexical query %q = %d hits, err=%v; want no hits", text, len(hits), err)
	}
}

func mustLatestGenerationID(t *testing.T, ctx context.Context, indexer *search.Indexer, workspaceID, dimension string) string {
	t.Helper()
	generation, err := indexer.Store.LatestIndexGeneration(ctx, workspaceID, dimension)
	if err != nil {
		t.Fatalf("latest %s generation: %v", dimension, err)
	}
	return generation.ID
}

func TestSearchRebuildRevokesSemanticAvailabilityWhenCoverageLifecycleFails(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatal(err)
	}
	manifest := search.EmbeddingGenerationManifest{
		RuntimeDigest: "runtime", ModelDigest: "model", TokenizerDigest: "tokenizer", PreprocessingDigest: "preprocess",
		Pooling: "cls", Normalization: "l2", ElementType: "float32", Dimension: 2, VectorSchema: "float32:2",
		SemanticSpace: "test-space", Distance: "cosine", IndexConfig: search.ZvecIndexConfigV1, QueryConfig: search.ZvecQueryConfigV1,
		ProviderDigest: "provider", ConfigDigest: "config",
	}
	zvec := &coverageLifecycleFailureZvec{rebuildSemanticZvec: &rebuildSemanticZvec{}}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock",
		WithConfigDigest(manifest.ConfigDigest),
		WithSemanticIndexerBinding(rebuildSemanticProvider{}, zvec, "/tmp/libzvec", "sha256:"+strings.Repeat("a", 64), manifest),
		WithExact(&exact.Service{Store: store, Repo: repo, ConfigDigest: manifest.ConfigDigest}))
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "fixture.txt"), []byte("fixture search"), 0o600); err != nil {
		t.Fatal(err)
	}
	ingested := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})
	resolved := dispatcher.Handle(ctx, mustEnvelope(t, command.OpNamespaceResolve, map[string]any{
		"workspace_id": ingested.WorkspaceID, "root_id": ingested.RootID, "path": "fixture.txt",
	}))
	if resolved.Status != command.StatusSucceeded {
		t.Fatalf("namespace.resolve = %q: %+v", resolved.Status, resolved.Reasons)
	}
	var entry command.NamespaceResolveData
	if err := json.Unmarshal(resolved.Data, &entry); err != nil {
		t.Fatal(err)
	}
	described := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": ingested.WorkspaceID, "subject_ref": entry.PathRef, "kind": "USER", "body": "fixture semantic text", "language": "en", "accepted": true,
	}))
	assertDescriptionPublicationDegraded(t, described, "fixture semantic text", 1, "subject-fact publication requires signed publication to be enabled")
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{"workspace_id": ingested.WorkspaceID}))
	if result.Status != command.StatusDegraded {
		t.Fatalf("search.rebuild = %q: %+v", result.Status, result.Reasons)
	}
	var data command.SearchRebuildData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode search.rebuild: %v", err)
	}
	if data.LexicalState != command.CapabilityAvailable || data.SemanticState != command.CapabilityUnavailable || strings.TrimSpace(data.SemanticFailure) == "" {
		t.Fatalf("semantic lifecycle failure did not revoke readiness independently of lexical search: %+v", data)
	}
	if data.SemanticSourceCoverage == nil || data.SemanticSourceCoverage.Available || data.SemanticSourceCoverage.Complete {
		t.Fatalf("lifecycle failure source proof must remain explicitly unavailable: %+v", data.SemanticSourceCoverage)
	}
	if !strings.Contains(strings.ToLower(data.SemanticFailure), "lifecycle") {
		t.Fatalf("semantic failure should retain the lifecycle diagnostic: %q", data.SemanticFailure)
	}
	if zvec.openCalls.Load() < 2 {
		t.Fatalf("test did not reach post-build coverage lifecycle validation: Open calls = %d", zvec.openCalls.Load())
	}
}

type rebuildSemanticProvider struct{}

func (rebuildSemanticProvider) SemanticReady() bool { return true }

func (rebuildSemanticProvider) Embed(_ context.Context, req search.SemanticEmbeddingRequest) ([]search.SemanticVector, error) {
	results := make([]search.SemanticVector, 0, len(req.Inputs))
	for _, input := range req.Inputs {
		results = append(results, search.SemanticVector{SubjectID: input.SubjectID, SegmentID: input.SegmentID, Vector: []float32{1, 0}})
	}
	return results, nil
}

type rebuildSemanticZvec struct {
	mu               sync.Mutex
	membershipByPath map[string]map[search.ZvecCoverageIdentity]struct{}
	coverageByPath   map[string][]search.ZvecCoverageIdentity
}

type coverageLifecycleFailureZvec struct {
	*rebuildSemanticZvec
	openCalls atomic.Int32
}

func (d *coverageLifecycleFailureZvec) Open(ctx context.Context, spec search.ZvecGenerationSpec) (search.ZvecGeneration, error) {
	if d.openCalls.Add(1) >= 2 {
		return nil, errors.New("simulated semantic generation lifecycle failure")
	}
	return d.rebuildSemanticZvec.Open(ctx, spec)
}

func (*rebuildSemanticZvec) ZvecReady(string, string, search.EmbeddingGenerationManifest) bool {
	return true
}

func (d *rebuildSemanticZvec) Build(_ context.Context, spec search.ZvecGenerationSpec, segments []search.ZvecSegment) (search.ZvecGenerationReceipt, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.membershipByPath == nil {
		d.membershipByPath = make(map[string]map[search.ZvecCoverageIdentity]struct{})
	}
	if d.coverageByPath == nil {
		d.coverageByPath = make(map[string][]search.ZvecCoverageIdentity)
	}
	membership := make(map[search.ZvecCoverageIdentity]struct{}, len(segments))
	coverage := make([]search.ZvecCoverageIdentity, 0, len(segments))
	for _, segment := range segments {
		identity := search.ZvecCoverageIdentity{SubjectID: segment.SubjectID, SegmentID: segment.SegmentID}
		membership[identity] = struct{}{}
		coverage = append(coverage, identity)
	}
	d.membershipByPath[spec.Path] = membership
	d.coverageByPath[spec.Path] = coverage
	return search.ZvecGenerationReceipt{Path: spec.Path, LibraryDigest: spec.LibraryDigest, ProfileDigest: spec.ProfileDigest, Dimension: spec.Manifest.Dimension, SegmentCount: len(segments)}, nil
}

func (d *rebuildSemanticZvec) CoveragePairs(_ context.Context, spec search.ZvecGenerationSpec) ([]search.ZvecCoverageIdentity, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]search.ZvecCoverageIdentity(nil), d.coverageByPath[spec.Path]...), nil
}

func (d *rebuildSemanticZvec) VerifyMembership(_ context.Context, spec search.ZvecGenerationSpec, candidates []search.ZvecCoverageIdentity) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	known := d.membershipByPath[spec.Path]
	for _, candidate := range candidates {
		if _, ok := known[candidate]; !ok {
			return search.ErrZvecUnavailable
		}
	}
	return nil
}

func (*rebuildSemanticZvec) Open(context.Context, search.ZvecGenerationSpec) (search.ZvecGeneration, error) {
	return nil, nil
}

func TestSearchRebuildFailsClosedForUnknownOrUnpublishedWorkspace(t *testing.T) {
	ctx := context.Background()
	dispatcher := newSearchRebuildDispatcher(t, false)
	unknown := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{
		"workspace_id": "wsp_00000000000000000000000000000000",
	}))
	if unknown.Status != command.StatusFailed || !hasReasonCode(unknown, ReasonCodeNotFound) {
		t.Fatalf("unknown workspace = %q: %+v", unknown.Status, unknown.Reasons)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "planned.txt"), []byte("planned"), 0o600); err != nil {
		t.Fatal(err)
	}
	planned := dispatcher.Handle(ctx, mustEnvelope(t, command.OpPlanIngest, map[string]any{"root": root}))
	if planned.Status != command.StatusSucceeded {
		t.Fatalf("plan.ingest = %q: %+v", planned.Status, planned.Reasons)
	}
	var plan command.PlanIngestData
	if err := json.Unmarshal(planned.Data, &plan); err != nil {
		t.Fatal(err)
	}
	unpublished := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{
		"workspace_id": plan.WorkspaceID,
	}))
	if unpublished.Status != command.StatusFailed || !hasReasonCode(unpublished, ReasonCodeNotFound) {
		t.Fatalf("unpublished workspace = %q: %+v", unpublished.Status, unpublished.Reasons)
	}
	malformed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchRebuild, map[string]any{
		"workspace_id": "not-a-stable-id",
	}))
	if malformed.Status != command.StatusFailed || !hasReasonCode(malformed, ReasonCodeInvalidInput) {
		t.Fatalf("malformed workspace = %q: %+v", malformed.Status, malformed.Reasons)
	}
}
