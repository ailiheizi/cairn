package exact

import (
	"bytes"
	"context"
	"io"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

func TestPortableFactPublisherRejectsMissingAnnotationPredecessorBeforePlacement(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "prepublication-annotation.txt", []byte("original exact bytes"))
	result := fixture.ingest(t, "sha256:prepublication-annotation-plan")
	baseline := requireOneReadablePortableClosure(t, ctx, fixture, result.SnapshotRef)
	assertOriginalExactBytesRemainReadable(t, ctx, fixture, []byte("original exact bytes"))

	nodes, err := fixture.store.ListNamespaceSubtree(ctx, result.WorkspaceID, result.RootID, "")
	if err != nil {
		t.Fatal(err)
	}
	subject := ""
	for _, node := range nodes {
		if node.Entry.ContentID != "" {
			subject = node.Entry.SubjectRef
			break
		}
	}
	if subject == "" {
		t.Fatal("ingested stable subject is missing")
	}
	id, err := sqlite.NewStableID(sqlite.IDPrefixAnnotation)
	if err != nil {
		t.Fatal(err)
	}
	row := &sqlite.Annotation{
		ID: id, WorkspaceID: result.WorkspaceID, SubjectRef: subject, Kind: sqlite.AnnotationNote,
		Body: "revision three has an absent predecessor chain", Revision: 3, PredecessorRevision: 2,
	}
	if err := fixture.store.CreateAnnotation(ctx, row); err != nil {
		t.Fatal(err)
	}
	before := portableRecordInventory(t, ctx, fixture.repo)
	err = fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "orphan predecessor") {
		t.Fatalf("publisher error = %v, want orphan-predecessor validation", err)
	}
	after := portableRecordInventory(t, ctx, fixture.repo)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("invalid fact candidate placed repository records: before=%v after=%v", before, after)
	}
	stored, err := fixture.store.GetAnnotation(ctx, result.WorkspaceID, id)
	if err != nil || stored.Revision != 3 || stored.PredecessorRevision != 2 || stored.Body != row.Body || stored.BodyDigest != row.BodyDigest {
		t.Fatalf("invalid candidate catalog row was not retained: %+v, %v", stored, err)
	}
	assertPreviousPortableClosureReadable(t, ctx, fixture, result.SnapshotRef, baseline)
}

func TestPortableFactPublisherRejectsInvalidDescriptionConfigBeforeAttachmentPlacement(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "prepublication-description.txt", []byte("original exact bytes"))
	result := fixture.ingest(t, "sha256:prepublication-description-plan")
	baseline := requireOneReadablePortableClosure(t, ctx, fixture, result.SnapshotRef)
	assertOriginalExactBytesRemainReadable(t, ctx, fixture, []byte("original exact bytes"))
	nodes, err := fixture.store.ListNamespaceSubtree(ctx, result.WorkspaceID, result.RootID, "")
	if err != nil {
		t.Fatal(err)
	}
	subject := ""
	for _, node := range nodes {
		if node.Entry.ContentID != "" {
			subject = node.Entry.SubjectRef
			break
		}
	}
	if subject == "" {
		t.Fatal("ingested stable subject is missing")
	}
	id, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		t.Fatal(err)
	}
	document := &sqlite.DescriptionDocument{
		ID: id, WorkspaceID: result.WorkspaceID, SubjectRef: subject, Kind: sqlite.DescriptionImported,
		Language: "en", Body: "description attachment must not be placed", SourceRef: "import:prepublication-test",
		ConfigDigest: "not-a-sha256-digest",
	}
	if err := fixture.store.InsertDescriptionDocument(ctx, document); err != nil {
		t.Fatal(err)
	}
	before := portableRecordInventory(t, ctx, fixture.repo)
	err = fixture.service.PublishPortableFactClosure(ctx, result.WorkspaceID, result.SnapshotRef, result.PublicationCommitDigest)
	if err == nil || (!strings.Contains(strings.ToLower(err.Error()), "creation config binding is invalid") &&
		!strings.Contains(strings.ToLower(err.Error()), "portable description revision payload is invalid")) {
		t.Fatalf("publisher error = %v, want invalid description config binding", err)
	}
	after := portableRecordInventory(t, ctx, fixture.repo)
	if !reflect.DeepEqual(before, after) {
		t.Fatalf("invalid description candidate placed its attachment or another record: before=%v after=%v", before, after)
	}
	stored, err := fixture.store.GetDescriptionDocument(ctx, result.WorkspaceID, id)
	if err != nil || stored.Body != document.Body || stored.ConfigDigest != document.ConfigDigest {
		t.Fatalf("invalid candidate description row was not retained: %+v, %v", stored, err)
	}
	assertPreviousPortableClosureReadable(t, ctx, fixture, result.SnapshotRef, baseline)
}

func requireOneReadablePortableClosure(t *testing.T, ctx context.Context, fixture signedPublicationFixture, snapshotRef string) PortableFactClosureEnvelope {
	t.Helper()
	reader := &Service{Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor, PublicationDomain: testPublicationDomain, RequireSignedPublication: true}
	closures, err := reader.ListPortableFactClosures(ctx, snapshotRef)
	if err != nil || len(closures) != 1 {
		t.Fatalf("baseline portable closures = %d, err=%v; want one valid closure", len(closures), err)
	}
	return closures[0]
}

func assertPreviousPortableClosureReadable(t *testing.T, ctx context.Context, fixture signedPublicationFixture, snapshotRef string, baseline PortableFactClosureEnvelope) {
	t.Helper()
	reader := &Service{Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor, PublicationDomain: testPublicationDomain, RequireSignedPublication: true}
	closures, err := reader.ListPortableFactClosures(ctx, snapshotRef)
	if err != nil || len(closures) != 1 {
		t.Fatalf("prior portable closure after rejected candidate = %d, err=%v", len(closures), err)
	}
	baselineDigest, err := baseline.Closure.Digest()
	if err != nil {
		t.Fatal(err)
	}
	afterDigest, err := closures[0].Closure.Digest()
	if err != nil || afterDigest != baselineDigest {
		t.Fatalf("prior signed closure changed: before=%s after=%s err=%v", baselineDigest, afterDigest, err)
	}
}

type portablePlacementInventory struct {
	Placements []repository.PlacementRef
	Parts      []string
}

func portableRecordInventory(t *testing.T, ctx context.Context, repo *repository.Dir) portablePlacementInventory {
	t.Helper()
	placements, err := repo.ListPlacementRefs(ctx)
	if err != nil {
		t.Fatalf("list blob and record placement inventory: %v", err)
	}
	parts, err := repo.ListRecordDigests(ctx, repository.RecordPart)
	if err != nil {
		t.Fatalf("list record-part placement inventory: %v", err)
	}
	sort.Strings(parts)
	return portablePlacementInventory{Placements: placements, Parts: parts}
}

func assertOriginalExactBytesRemainReadable(t *testing.T, ctx context.Context, fixture signedPublicationFixture, want []byte) {
	t.Helper()
	contentID := DigestBytes(want)
	reader, err := fixture.repo.Open(ctx, contentID)
	if err != nil {
		t.Fatalf("open retained original %s: %v", contentID, err)
	}
	defer reader.Close()
	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read retained original %s: %v", contentID, err)
	}
	if !bytes.Equal(got, want) || DigestBytes(got) != contentID {
		t.Fatalf("retained original bytes mismatch for %s: bytes=%d digest=%s", contentID, len(got), DigestBytes(got))
	}
}
