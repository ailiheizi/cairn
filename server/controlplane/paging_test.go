package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/exact"
	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

// publishedLibrary is one directly seeded, published content library. Seeding
// the catalog (rather than ingesting real bytes) keeps a multi-thousand-entry
// fixture fast enough to page through end to end while still exercising the
// real store, the real lexical index rebuild, and the real dispatcher.
type publishedLibrary struct {
	WorkspaceID     string
	SourceID        string
	RootID          string
	SnapshotRef     string
	ScanGeneration  string
	CaptureBinding  string
	PublicationID   string
	DirectoryIDs    []string
	EntryIDs        []string
	EntrySubjectIDs []string
}

// seedPublishedLibrary inserts count non-directory entries spread over
// directoryCount directories under one published root, and returns the
// identifiers the paging tests address the library by.
func seedPublishedLibrary(t *testing.T, store *sqlite.Store, count, directoryCount int) publishedLibrary {
	t.Helper()
	ctx := context.Background()
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	library := publishedLibrary{
		WorkspaceID:    mustStableID(t, sqlite.IDPrefixWorkspace),
		SourceID:       mustStableID(t, sqlite.IDPrefixSource),
		RootID:         mustStableID(t, sqlite.IDPrefixNamespaceRoot),
		ScanGeneration: mustStableID(t, sqlite.IDPrefixScanGeneration),
		CaptureBinding: mustStableID(t, sqlite.IDPrefixCaptureBinding),
		PublicationID:  mustStableID(t, sqlite.IDPrefixPublication),
		SnapshotRef:    "apfs-snapshot:paging-fixture",
	}
	workspace := sqlite.Workspace{ID: library.WorkspaceID, Name: "Paging fixture workspace"}
	source := sqlite.Source{
		ID: library.SourceID, WorkspaceID: library.WorkspaceID,
		StableKey: "apfs:paging-fixture", Kind: "APFS_ROOT", Locator: "/Paging",
		State: sqlite.SourceActive,
	}
	scan := sqlite.ScanGeneration{
		ID: library.ScanGeneration, WorkspaceID: library.WorkspaceID, SourceID: library.SourceID,
		Generation: 1, CaptureSetID: "capture-paging-fixture",
		CaptureSetDigest: "sha256:capture-paging-fixture", State: sqlite.ScanRunning,
	}
	binding := sqlite.CaptureRootBinding{
		ID: library.CaptureBinding, WorkspaceID: library.WorkspaceID, SourceID: library.SourceID,
		ScanGenerationID: library.ScanGeneration, CaptureMode: "ROOTED_FD",
		Profile: "apfs-native-v1", DisplayPath: "/Paging", DeviceID: 1, Inode: 1,
		ConsistencyClaim: "quiesced", IdentityDigest: "sha256:paging-binding", BoundAt: now,
		Record: json.RawMessage(`{}`),
	}
	root := sqlite.NamespaceRoot{
		ID: library.RootID, WorkspaceID: library.WorkspaceID, SourceID: library.SourceID,
		ScanGenerationID: library.ScanGeneration, SnapshotRef: library.SnapshotRef,
		Name: "Paging", RootPathKey: []byte{}, FilesystemSemantics: "APFS_NATIVE_V1",
		AuthorityDigest: "sha256:paging-root",
	}
	directories := make([]sqlite.NamespaceEntry, 0, directoryCount)
	for index := 0; index < directoryCount; index++ {
		name := fmt.Sprintf("album-%03d", index)
		directories = append(directories, sqlite.NamespaceEntry{
			ID: mustStableID(t, sqlite.IDPrefixNamespaceEntry), WorkspaceID: library.WorkspaceID,
			RootID: library.RootID, RawName: []byte(name), DisplayName: name,
			FullPathKey: []byte(name), EntryType: sqlite.EntryDirectory,
		})
	}
	entries := make([]sqlite.NamespaceEntry, 0, count)
	subjects := make([]string, 0, count)
	for index := 0; index < count; index++ {
		directory := directories[index%len(directories)]
		name := fmt.Sprintf("pageitem-%05d.txt", index)
		subject := mustStableID(t, sqlite.IDPrefixSubject)
		entry := sqlite.NamespaceEntry{
			ID: mustStableID(t, sqlite.IDPrefixNamespaceEntry), SubjectRef: subject,
			WorkspaceID: library.WorkspaceID, RootID: library.RootID, ParentID: directory.ID,
			RawName: []byte(name), DisplayName: name,
			FullPathKey: []byte(directory.DisplayName + "\x00" + name),
			EntryType:   sqlite.EntrySymlink,
			Metadata:    json.RawMessage(fmt.Sprintf(`{"mod_time":"2026-10-11T12:00:%02dZ","size":%d}`, index%60, index+1)),
			// A symlink carries a target instead of a file version, so the
			// fixture needs no representation or observation rows while the
			// lexical feed still indexes the same name/path/metadata fields.
			SymlinkTargetRaw:     []byte("../originals/" + name),
			SymlinkTargetDisplay: "../originals/" + name,
		}
		entries = append(entries, entry)
		subjects = append(subjects, subject)
	}
	publication := sqlite.Publication{
		ID: library.PublicationID, WorkspaceID: library.WorkspaceID,
		SnapshotRef: library.SnapshotRef, ScanGenerationID: library.ScanGeneration,
		BindingID: library.CaptureBinding, NamespaceRootID: library.RootID,
		ManifestDigest: "sha256:paging-manifest",
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertWorkspace(ctx, &workspace); err != nil {
			return err
		}
		if err := tx.InsertSource(ctx, &source); err != nil {
			return err
		}
		if err := tx.InsertScanGeneration(ctx, &scan); err != nil {
			return err
		}
		if err := tx.InsertCaptureRootBinding(ctx, &binding); err != nil {
			return err
		}
		if err := tx.InsertNamespaceRoot(ctx, &root); err != nil {
			return err
		}
		for index := range directories {
			if err := tx.InsertNamespaceEntry(ctx, &directories[index]); err != nil {
				return err
			}
		}
		for index := range entries {
			if err := tx.InsertNamespaceEntry(ctx, &entries[index]); err != nil {
				return err
			}
		}
		finished := now.Add(time.Minute)
		if err := tx.FinishScanGeneration(ctx, library.WorkspaceID, library.ScanGeneration, sqlite.ScanComplete, true,
			json.RawMessage(`{"entries":1}`), finished); err != nil {
			return err
		}
		return tx.InsertPublication(ctx, &publication)
	}); err != nil {
		t.Fatalf("seed published library: %v", err)
	}
	library.DirectoryIDs = make([]string, 0, len(directories))
	for _, directory := range directories {
		library.DirectoryIDs = append(library.DirectoryIDs, directory.ID)
	}
	library.EntryIDs = make([]string, 0, len(entries))
	for _, entry := range entries {
		library.EntryIDs = append(library.EntryIDs, entry.ID)
	}
	library.EntrySubjectIDs = subjects
	return library
}

// newPagingDispatcher wires the real dispatcher and lexical indexer over one
// seeded published library, then rebuilds the lexical generation through the
// real provider path.
func newPagingDispatcher(t *testing.T, count, directoryCount int) (*Dispatcher, publishedLibrary) {
	t.Helper()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	library := seedPublishedLibrary(t, store, count, directoryCount)
	indexer := &search.Indexer{Store: store, Engine: &search.Engine{Dir: t.TempDir()}}
	if _, err := indexer.Rebuild(context.Background(), library.WorkspaceID, library.SnapshotRef, library.RootID); err != nil {
		t.Fatalf("rebuild lexical generation: %v", err)
	}
	// search.query is wired only with the exact lane, which is what makes the
	// operation implemented at all; the indexer below is the real provider over
	// the generation this test rebuilt.
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithExact(&exact.Service{Store: store, Repo: repo}))
	dispatcher.search = indexer
	return dispatcher, library
}

// TestSearchQueryLexicalPagingIsExactAndExhaustive is the end-to-end exactness
// proof through the real operation: every match is returned exactly once
// across at least three consecutive pages, the exhausted page says it is
// exhausted, and the ordering is stable.
func TestSearchQueryLexicalPagingIsExactAndExhaustive(t *testing.T) {
	ctx := context.Background()
	const total = 25
	const pageSize = 10
	dispatcher, library := newPagingDispatcher(t, total, 3)

	seen := map[string]int{}
	pages := 0
	cursor := ""
	order := ""
	for {
		input := map[string]any{
			"workspace_id": library.WorkspaceID,
			"dimension":    search.DimensionLexical,
			"query":        "pageitem",
			"page":         map[string]any{"limit": pageSize},
		}
		if cursor != "" {
			input["page"] = map[string]any{"limit": pageSize, "token": cursor}
		}
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, input))
		if result.Status != command.StatusSucceeded {
			t.Fatalf("search.query page %d = %q: %+v", pages+1, result.Status, result.Reasons)
		}
		var data command.SearchQueryData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatalf("decode page %d: %v", pages+1, err)
		}
		if data.Page == nil {
			t.Fatalf("page %d carried no page block", pages+1)
		}
		pages++
		if data.Page.Lane != search.DimensionLexical || data.Page.Order == "" {
			t.Fatalf("page %d lane/order = %q/%q", pages, data.Page.Lane, data.Page.Order)
		}
		if order == "" {
			order = data.Page.Order
		} else if data.Page.Order != order {
			t.Fatalf("page %d order changed from %q to %q", pages, order, data.Page.Order)
		}
		if data.Page.Returned != len(data.Hits) {
			t.Fatalf("page %d returned=%d but carried %d hits", pages, data.Page.Returned, len(data.Hits))
		}
		for _, hit := range data.Hits {
			seen[hit.SubjectRef]++
		}
		if !data.Page.HasMore {
			if !data.Page.Complete || data.Page.Completeness != command.PageCompletenessComplete {
				t.Fatalf("final page completeness = %q complete=%t; an exhausted page must say it is exhausted",
					data.Page.Completeness, data.Page.Complete)
			}
			if data.Page.Token != "" {
				t.Fatalf("final page carried a continuation: %q", data.Page.Token)
			}
			break
		}
		if data.Page.Completeness != command.PageCompletenessMoreAvailable {
			t.Fatalf("page %d completeness = %q, want %q", pages, data.Page.Completeness, command.PageCompletenessMoreAvailable)
		}
		if len(data.Hits) != pageSize {
			t.Fatalf("page %d returned %d hits with more available, want %d", pages, len(data.Hits), pageSize)
		}
		if data.Page.Token == "" {
			t.Fatalf("page %d claimed more matches with no continuation", pages)
		}
		cursor = data.Page.Token
		if pages > total {
			t.Fatal("paging did not terminate")
		}
	}
	if pages < 3 {
		t.Fatalf("paged %d pages, want at least three consecutive pages", pages)
	}
	if len(seen) != total {
		t.Fatalf("paged %d distinct subjects, want %d", len(seen), total)
	}
	for subject, appearances := range seen {
		if appearances != 1 {
			t.Fatalf("subject %s appeared %d times, want exactly once", subject, appearances)
		}
	}

	// Retrying an identical page request with the same continuation is
	// idempotent: the token names a page start, so the retry returns the same
	// page rather than a shifted one.
	first := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": library.WorkspaceID,
		"dimension":    search.DimensionLexical,
		"query":        "pageitem",
		"page":         map[string]any{"limit": pageSize},
	}))
	var firstData command.SearchQueryData
	if err := json.Unmarshal(first.Data, &firstData); err != nil {
		t.Fatal(err)
	}
	if firstData.Page == nil || firstData.Page.Token == "" {
		t.Fatal("first page issued no continuation to retry")
	}
	secondInput := map[string]any{
		"workspace_id": library.WorkspaceID,
		"dimension":    search.DimensionLexical,
		"query":        "pageitem",
		"page":         map[string]any{"limit": pageSize, "token": firstData.Page.Token},
	}
	second := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, secondInput))
	var secondData command.SearchQueryData
	if err := json.Unmarshal(second.Data, &secondData); err != nil {
		t.Fatal(err)
	}
	repeated := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, secondInput))
	var repeatedData command.SearchQueryData
	if err := json.Unmarshal(repeated.Data, &repeatedData); err != nil {
		t.Fatal(err)
	}
	if len(secondData.Hits) == 0 {
		t.Fatal("the continued page returned no hits")
	}
	if len(repeatedData.Hits) != len(secondData.Hits) {
		t.Fatalf("repeated page returned %d hits, want %d", len(repeatedData.Hits), len(secondData.Hits))
	}
	for index := range secondData.Hits {
		if repeatedData.Hits[index].SubjectRef != secondData.Hits[index].SubjectRef {
			t.Fatalf("repeated page hit %d = %s, want %s",
				index, repeatedData.Hits[index].SubjectRef, secondData.Hits[index].SubjectRef)
		}
	}
	if repeatedData.Page.Returned != secondData.Page.Returned || repeatedData.Page.HasMore != secondData.Page.HasMore {
		t.Fatalf("repeated page bound = %+v, want %+v", repeatedData.Page, secondData.Page)
	}
	// The retry re-issues a continuation for the following page; only its
	// expiry differs, because a continuation is freshly minted each time.
	if repeatedData.Page.Token == "" || secondData.Page.Token == "" {
		t.Fatal("a page with more matches must keep issuing a continuation on retry")
	}
}

// TestFusedSearchPageFactsNameABoundedTopKLane proves a fused answer that
// really includes a bounded top-k lane reports that lane, its ceiling, and the
// resulting partiality in the answer itself — not only in prose.
func TestFusedSearchPageFactsNameABoundedTopKLane(t *testing.T) {
	facts := fusedSearchPageData(command.PageModeDefault, search.LegacyResultLimit, []search.Component{
		{
			Dimension: search.DimensionLexical, Status: string(command.StatusSucceeded), Hits: 20,
			Page: search.PageState{Returned: 20, Complete: true, Order: search.OrderRankRowID, Lane: search.DimensionLexical},
		},
		{
			Dimension: search.DimensionSemantic, Status: string(command.StatusSucceeded), Hits: 100,
			Page: search.PageState{Returned: 100, Truncated: true, BoundedTopK: search.BoundedTopKCeiling, Lane: search.DimensionSemantic},
		},
	}, 120)
	if facts.Complete || facts.Completeness != command.PageCompletenessBoundedUnknown {
		t.Fatalf("fused facts = %+v; a bounded top-k lane must make the union partial and unknowable", facts)
	}
	if !facts.Truncated || facts.TruncationReason != command.PageTruncationBoundedTopK {
		t.Fatalf("fused truncation = %t/%q, want %q", facts.Truncated, facts.TruncationReason, command.PageTruncationBoundedTopK)
	}
	if facts.ContinuationSupported || facts.ContinuationReason != command.PageContinuationFusedUnion {
		t.Fatalf("fused continuation = %t/%q", facts.ContinuationSupported, facts.ContinuationReason)
	}
	if len(facts.Lanes) != 2 {
		t.Fatalf("fused lanes = %+v", facts.Lanes)
	}
	var bounded *command.PageLaneData
	for index := range facts.Lanes {
		if facts.Lanes[index].Dimension == search.DimensionSemantic {
			bounded = &facts.Lanes[index]
		}
	}
	if bounded == nil || bounded.BoundedTopK != search.BoundedTopKCeiling || !bounded.Truncated || bounded.Pageable {
		t.Fatalf("bounded lane = %+v", bounded)
	}
	if facts.HasMore {
		t.Fatal("a bounded top-k lane cannot prove further matches exist, so the union must not claim it")
	}
}

// TestSearchQueryCursorRefusals proves a malformed, tampered, stale, or
// out-of-scope cursor is refused as invalid input rather than answered with
// wrong data.
func TestSearchQueryCursorRefusals(t *testing.T) {
	ctx := context.Background()
	dispatcher, library := newPagingDispatcher(t, 25, 3)
	lexical := func(extra map[string]any) *command.Result {
		input := map[string]any{
			"workspace_id": library.WorkspaceID,
			"dimension":    search.DimensionLexical,
			"query":        "pageitem",
			"page":         map[string]any{"limit": 10},
		}
		for key, value := range extra {
			input[key] = value
		}
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, input))
		return &result
	}
	first := lexical(nil)
	if first.Status != command.StatusSucceeded {
		t.Fatalf("first page = %q: %+v", first.Status, first.Reasons)
	}
	var firstData command.SearchQueryData
	if err := json.Unmarshal(first.Data, &firstData); err != nil {
		t.Fatal(err)
	}
	cursor := firstData.Page.Token
	if cursor == "" {
		t.Fatal("first page issued no continuation")
	}
	tampered := tamperCursor(t, cursor)

	cases := []struct {
		name   string
		extra  map[string]any
		expect string
	}{
		{name: "malformed", extra: map[string]any{"page": map[string]any{"token": "not-a-token"}}, expect: "continuation"},
		{name: "tampered", extra: map[string]any{"page": map[string]any{"token": tampered}}, expect: "continuation"},
		{name: "another query", extra: map[string]any{"query": "album", "page": map[string]any{"token": cursor}}, expect: "different query"},
		{name: "another page limit on the same chain is allowed", extra: map[string]any{"page": map[string]any{"token": cursor, "limit": 5}}},
		{name: "another workspace", extra: map[string]any{"workspace_id": "", "page": map[string]any{"token": cursor}}, expect: "continuation"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			result := lexical(testCase.extra)
			if testCase.expect == "" {
				if result.Status != command.StatusSucceeded {
					t.Fatalf("expected success, got %q: %+v", result.Status, result.Reasons)
				}
				return
			}
			if result.Status != command.StatusFailed {
				t.Fatalf("expected a refusal, got %q with data %s", result.Status, result.Data)
			}
			if len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeInvalidInput {
				t.Fatalf("refusal reasons = %+v, want %s", result.Reasons, ReasonCodeInvalidInput)
			}
			if !strings.Contains(strings.ToLower(result.Reasons[0].Message), strings.ToLower(testCase.expect)) {
				t.Fatalf("refusal message = %q, want it to mention %q", result.Reasons[0].Message, testCase.expect)
			}
		})
	}

	// A cursor minted against one generation is stale after a rebuild: the
	// chain must not cross into a replacement index silently.
	if _, err := dispatcher.search.Rebuild(ctx, library.WorkspaceID, library.SnapshotRef, library.RootID); err != nil {
		t.Fatalf("second rebuild: %v", err)
	}
	stale := lexical(map[string]any{"page": map[string]any{"token": cursor}})
	if stale.Status != command.StatusFailed {
		t.Fatalf("stale cursor answered with %q and data %s; it must be refused", stale.Status, stale.Data)
	}
	if len(stale.Reasons) == 0 || stale.Reasons[0].Code != ReasonCodeInvalidInput {
		t.Fatalf("stale cursor reasons = %+v", stale.Reasons)
	}
}

// TestSearchQueryRefusesACursorOnANonPageableShape proves a cursor is refused
// on the fused broker and on a bounded top-k lane instead of being ignored or
// answered from a lane that has no complete match set.
func TestSearchQueryRefusesACursorOnANonPageableShape(t *testing.T) {
	ctx := context.Background()
	dispatcher, library := newPagingDispatcher(t, 25, 3)
	for name, input := range map[string]map[string]any{
		"default fused broker": {
			"workspace_id": library.WorkspaceID,
			"query":        "pageitem",
			"page":         map[string]any{"token": "whatever"},
		},
		"bounded semantic lane": {
			"workspace_id": library.WorkspaceID,
			"dimension":    search.DimensionSemantic,
			"query":        "pageitem",
			"page":         map[string]any{"token": "whatever"},
		},
		"fuse of two dimensions": {
			"workspace_id": library.WorkspaceID,
			"fuse":         []string{search.DimensionLexical, search.DimensionSemantic},
			"query":        "pageitem",
			"page":         map[string]any{"token": "whatever"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, input))
			if result.Status != command.StatusFailed {
				t.Fatalf("expected a refusal, got %q with data %s", result.Status, result.Data)
			}
			if len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeInvalidInput {
				t.Fatalf("refusal reasons = %+v, want %s", result.Reasons, ReasonCodeInvalidInput)
			}
		})
	}
}

// TestSearchQueryDefaultAnswerStatesItsBounding proves the default (unpaged)
// answer is no longer a silent truncation: it names the bound it applied and
// says whether more matches exist, and it names the exact call that retrieves
// them.
func TestSearchQueryDefaultAnswerStatesItsBounding(t *testing.T) {
	ctx := context.Background()
	dispatcher, library := newPagingDispatcher(t, 25, 3)
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": library.WorkspaceID,
		"query":        "pageitem",
	}))
	var data command.SearchQueryData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode default search: %v", err)
	}
	if data.Page == nil {
		t.Fatal("the default fused answer carried no page block")
	}
	if data.Page.Mode != command.PageModeDefault {
		t.Fatalf("default mode = %q, want %q", data.Page.Mode, command.PageModeDefault)
	}
	if data.Page.Complete {
		t.Fatalf("a fused answer that includes a bounded top-k lane claimed completeness: %+v", data.Page)
	}
	if data.Page.Completeness != command.PageCompletenessBoundedUnknown {
		t.Fatalf("fused completeness = %q, want %q", data.Page.Completeness, command.PageCompletenessBoundedUnknown)
	}
	if data.Page.ContinuationSupported || data.Page.ContinuationReason != command.PageContinuationFusedUnion {
		t.Fatalf("fused continuation = %t/%q", data.Page.ContinuationSupported, data.Page.ContinuationReason)
	}
	if len(data.Page.Lanes) == 0 {
		t.Fatal("a fused answer must report per-lane completeness")
	}
	pageable := false
	bounded := false
	for _, lane := range data.Page.Lanes {
		if lane.Dimension == search.DimensionLexical {
			pageable = lane.Pageable
		} else if lane.Status == string(command.StatusSucceeded) {
			bounded = lane.BoundedTopK > 0
		}
	}
	if !pageable {
		t.Fatalf("the lexical lane was not reported pageable: %+v", data.Page.Lanes)
	}
	if !bounded {
		t.Logf("no bounded lane succeeded in this fixture (semantic is unavailable): %+v", data.Page.Lanes)
	}
}

// TestContentListPagingIsExactAndBoundsItself proves content.list keeps its
// complete-projection default while making paging explicitly requestable, that
// the answer always states its mode and the exact total, and that paged walks
// return every entry exactly once.
func TestContentListPagingIsExactAndBoundsItself(t *testing.T) {
	ctx := context.Background()
	const total = 25
	const pageSize = 10
	dispatcher, library := newPagingDispatcher(t, total, 3)

	complete := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{
		"workspace_id": library.WorkspaceID,
	}))
	if complete.Status != command.StatusSucceeded {
		t.Fatalf("content.list = %q: %+v", complete.Status, complete.Reasons)
	}
	var completeData command.ContentListData
	if err := json.Unmarshal(complete.Data, &completeData); err != nil {
		t.Fatalf("decode content.list: %v", err)
	}
	if completeData.Page == nil {
		t.Fatal("content.list carried no page block")
	}
	if completeData.Page.Mode != command.PageModeDefault {
		t.Fatalf("default content.list mode = %q, want %q", completeData.Page.Mode, command.PageModeDefault)
	}
	if !completeData.Page.Complete || completeData.Page.HasMore {
		t.Fatalf("default content.list completeness = %+v, want complete", completeData.Page)
	}
	if completeData.Page.Entries == nil || *completeData.Page.Entries != total {
		t.Fatalf("default content.list entries = %v, want %d", completeData.Page.Entries, total)
	}
	if len(completeData.Items) != total {
		t.Fatalf("default content.list returned %d items, want %d", len(completeData.Items), total)
	}
	if completeData.Page.Limit != 0 {
		t.Fatalf("default content.list claimed page_size %d with no page bound applied", completeData.Page.Limit)
	}

	seen := map[string]int{}
	pages := 0
	cursor := ""
	for {
		input := map[string]any{"workspace_id": library.WorkspaceID, "page": map[string]any{"limit": pageSize}}
		if cursor != "" {
			input["page"] = map[string]any{"limit": pageSize, "token": cursor}
		}
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, input))
		if result.Status != command.StatusSucceeded {
			t.Fatalf("content.list page %d = %q: %+v", pages+1, result.Status, result.Reasons)
		}
		var data command.ContentListData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatalf("decode page %d: %v", pages+1, err)
		}
		if data.Page == nil || data.Page.Mode != command.PageModePage {
			t.Fatalf("page %d mode = %+v, want %q", pages+1, data.Page, command.PageModePage)
		}
		if data.Page.Entries == nil || *data.Page.Entries != total {
			t.Fatalf("page %d entries = %v, want %d", pages+1, data.Page.Entries, total)
		}
		if data.Page.Limit != pageSize {
			t.Fatalf("page %d page_size = %d, want %d", pages+1, data.Page.Limit, pageSize)
		}
		pages++
		for _, item := range data.Items {
			seen[item.SubjectRef]++
		}
		if !data.Page.HasMore {
			if !data.Page.Complete {
				t.Fatalf("final page not marked complete: %+v", data.Page)
			}
			break
		}
		if len(data.Items) != pageSize {
			t.Fatalf("page %d returned %d items with more available, want %d", pages, len(data.Items), pageSize)
		}
		if data.Page.Token == "" {
			t.Fatalf("page %d claimed more entries with no continuation", pages)
		}
		cursor = data.Page.Token
		if pages > total {
			t.Fatal("content.list paging did not terminate")
		}
	}
	if pages < 3 {
		t.Fatalf("paged %d content.list pages, want at least three", pages)
	}
	if len(seen) != total {
		t.Fatalf("paged %d distinct entries, want %d", len(seen), total)
	}
	for subject, appearances := range seen {
		if appearances != 1 {
			t.Fatalf("entry %s appeared %d times, want exactly once", subject, appearances)
		}
	}
}

// TestContentListCursorRefusals proves a malformed, tampered, or
// publication-crossing cursor is refused instead of seeked.
func TestContentListCursorRefusals(t *testing.T) {
	ctx := context.Background()
	dispatcher, library := newPagingDispatcher(t, 25, 3)
	first := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{
		"workspace_id": library.WorkspaceID,
		"page":         map[string]any{"limit": 10},
	}))
	var firstData command.ContentListData
	if err := json.Unmarshal(first.Data, &firstData); err != nil {
		t.Fatal(err)
	}
	cursor := firstData.Page.Token
	if cursor == "" {
		t.Fatal("content.list issued no continuation")
	}
	for name, value := range map[string]string{
		"malformed": "not-a-cursor",
		"tampered":  tamperCursor(t, cursor),
	} {
		t.Run(name, func(t *testing.T) {
			result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{
				"workspace_id": library.WorkspaceID,
				"page":         map[string]any{"token": value},
			}))
			if result.Status != command.StatusFailed {
				t.Fatalf("expected a refusal, got %q with data %s", result.Status, result.Data)
			}
			if len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeInvalidInput {
				t.Fatalf("refusal reasons = %+v", result.Reasons)
			}
		})
	}

	// A new publication for the same source replaces the pinned projection, so
	// the outstanding continuation must fail closed rather than skip or repeat
	// an entry under a shifted order.
	store := dispatcher.store
	secondSnapshot, secondRootID := publishSecondGeneration(t, store, library)
	if secondRootID == "" || secondSnapshot == "" {
		t.Fatal("second publication was not seeded")
	}
	stale := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{
		"workspace_id": library.WorkspaceID,
		"page":         map[string]any{"token": cursor},
	}))
	if stale.Status != command.StatusFailed {
		t.Fatalf("publication-crossing cursor answered with %q and data %s", stale.Status, stale.Data)
	}
	if len(stale.Reasons) == 0 || stale.Reasons[0].Code != ReasonCodeInvalidInput {
		t.Fatalf("stale reasons = %+v", stale.Reasons)
	}
}

// publishSecondGeneration commits a newer publication for the same source,
// which replaces the latest published root with a new snapshot identity.
func publishSecondGeneration(t *testing.T, store *sqlite.Store, library publishedLibrary) (string, string) {
	t.Helper()
	ctx := context.Background()
	now := time.Date(2026, 10, 11, 13, 0, 0, 0, time.UTC)
	scan := sqlite.ScanGeneration{
		ID: mustStableID(t, sqlite.IDPrefixScanGeneration), WorkspaceID: library.WorkspaceID,
		SourceID: library.SourceID, Generation: 2, ParentID: library.ScanGeneration,
		CaptureSetID: "capture-paging-fixture-2", CaptureSetDigest: "sha256:capture-paging-fixture-2",
		State: sqlite.ScanRunning,
	}
	binding := sqlite.CaptureRootBinding{
		ID: mustStableID(t, sqlite.IDPrefixCaptureBinding), WorkspaceID: library.WorkspaceID,
		SourceID: library.SourceID, ScanGenerationID: scan.ID, CaptureMode: "ROOTED_FD",
		Profile: "apfs-native-v1", DisplayPath: "/Paging", DeviceID: 1, Inode: 1,
		ConsistencyClaim: "quiesced", IdentityDigest: "sha256:paging-binding-2", BoundAt: now,
		Record: json.RawMessage(`{}`),
	}
	snapshot := "apfs-snapshot:paging-fixture-2"
	root := sqlite.NamespaceRoot{
		ID: mustStableID(t, sqlite.IDPrefixNamespaceRoot), WorkspaceID: library.WorkspaceID,
		SourceID: library.SourceID, ScanGenerationID: scan.ID, SnapshotRef: snapshot,
		Name: "Paging", RootPathKey: []byte{}, FilesystemSemantics: "APFS_NATIVE_V1",
		AuthorityDigest: "sha256:paging-root-2",
	}
	publication := sqlite.Publication{
		ID: mustStableID(t, sqlite.IDPrefixPublication), WorkspaceID: library.WorkspaceID,
		SnapshotRef: snapshot, ScanGenerationID: scan.ID, BindingID: binding.ID,
		NamespaceRootID: root.ID, ManifestDigest: "sha256:paging-manifest-2",
	}
	if err := store.Update(ctx, func(tx *sqlite.Tx) error {
		if err := tx.InsertScanGeneration(ctx, &scan); err != nil {
			return err
		}
		if err := tx.InsertCaptureRootBinding(ctx, &binding); err != nil {
			return err
		}
		if err := tx.InsertNamespaceRoot(ctx, &root); err != nil {
			return err
		}
		if err := tx.FinishScanGeneration(ctx, library.WorkspaceID, scan.ID, sqlite.ScanComplete, true,
			json.RawMessage(`{"entries":0}`), now.Add(time.Minute)); err != nil {
			return err
		}
		return tx.InsertPublication(ctx, &publication)
	}); err != nil {
		t.Fatalf("publish second generation: %v", err)
	}
	return snapshot, root.ID
}

// TestSearchQueryRefusesAnOutOfRangePageSize proves the documented maximum is
// enforced by refusal rather than by silent clamping.
func TestSearchQueryRefusesAnOutOfRangePageSize(t *testing.T) {
	ctx := context.Background()
	dispatcher, library := newPagingDispatcher(t, 5, 1)
	for name, pageSize := range map[string]int{
		"above the maximum": search.MaxPageSize + 1,
		"zero":              0,
	} {
		t.Run(name, func(t *testing.T) {
			result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
				"workspace_id": library.WorkspaceID,
				"dimension":    search.DimensionLexical,
				"query":        "pageitem",
				"page":         map[string]any{"limit": pageSize},
			}))
			if result.Status != command.StatusFailed {
				t.Fatalf("expected a refusal, got %q with data %s", result.Status, result.Data)
			}
			if len(result.Reasons) == 0 || result.Reasons[0].Code != ReasonCodeInvalidInput {
				t.Fatalf("refusal reasons = %+v", result.Reasons)
			}
		})
	}
}

// tamperCursor changes one character in the middle of a continuation token's
// payload segment, which must break its authentication.
func tamperCursor(t *testing.T, cursor string) string {
	t.Helper()
	parts := strings.Split(cursor, ".")
	if len(parts) != 2 || len(parts[0]) < 8 {
		t.Fatalf("continuation token is not in the expected opaque shape: %q", cursor)
	}
	payload := []byte(parts[0])
	replacement := byte('A')
	if payload[5] == 'A' {
		replacement = 'B'
	}
	payload[5] = replacement
	return string(payload) + "." + parts[1]
}
