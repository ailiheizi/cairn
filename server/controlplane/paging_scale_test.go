package controlplane

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
)

// TestLargeLibraryPagingMeasuresAndProvesExactness walks a library larger than
// one page through the real search.query and content.list operations and
// reports the real latency and response size of a first and a later page, plus
// the exactly-once proof over the whole walk.
//
// The fixture is seeded directly into the catalog as symlink entries, so it
// has no file bytes behind it: the lexical feed, the generation rebuild, the
// page bounds, the ordering and the response sizes are all the real ones, but
// the numbers are a discovery-plane measurement, not an ingest measurement.
func TestLargeLibraryPagingMeasuresAndProvesExactness(t *testing.T) {
	ctx := context.Background()
	const (
		total       = 9138
		pageSize    = 1000
		directories = 20
	)
	started := time.Now()
	dispatcher, library := newPagingDispatcher(t, total, directories)
	t.Logf("fixture: %d entries over %d directories; seed + lexical rebuild took %s", total, directories, time.Since(started))

	type measurement struct {
		latency time.Duration
		bytes   int
		hits    int
	}
	query := func(axes []string, cursor string, size int) (*command.SearchQueryData, measurement) {
		input := map[string]any{
			"workspace_id": library.WorkspaceID,
			"dimension":    search.DimensionLexical,
			"query":        "pageitem",
			"page":         map[string]any{"limit": size},
		}
		if len(axes) > 0 {
			input["construct_axes"] = axes
		}
		if cursor != "" {
			input["page"] = map[string]any{"limit": size, "token": cursor}
		}
		callStarted := time.Now()
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, input))
		elapsed := time.Since(callStarted)
		if result.Status != command.StatusSucceeded {
			t.Fatalf("search.query = %q: %+v", result.Status, result.Reasons)
		}
		var data command.SearchQueryData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatalf("decode search.query: %v", err)
		}
		return &data, measurement{latency: elapsed, bytes: len(result.Data), hits: len(data.Hits)}
	}

	// Walk the first pages of the large library at a bounded page size on one
	// construct axis. This proves the page boundaries are exact over a match
	// set far larger than one page (no duplicates, no short page while more
	// remains), and it measures the real per-page cost at that bound. A full
	// walk of every match is deliberately left to the small fixture: the cost
	// here is per returned hit, so walking all 9,138 costs about 2.5 minutes
	// and proves nothing the five-page walk does not.
	const (
		walkPageSize = 200
		walkPages    = 5
	)
	seen := map[string]int{}
	walked := 0
	cursor := ""
	var walkFirst, walkLater measurement
	for pages := 1; pages <= walkPages; pages++ {
		data, measured := query([]string{search.AxisName}, cursor, walkPageSize)
		if pages == 1 {
			walkFirst = measured
		}
		if pages == walkPages {
			walkLater = measured
		}
		if len(data.Hits) != walkPageSize {
			t.Fatalf("page %d returned %d hits, want a full page of %d", pages, len(data.Hits), walkPageSize)
		}
		if !data.Page.HasMore || data.Page.Token == "" {
			t.Fatalf("page %d of a larger library claimed the answer was finished", pages)
		}
		if data.Page.Completeness != command.PageCompletenessMoreAvailable {
			t.Fatalf("page %d completeness = %q, want %q", pages, data.Page.Completeness, command.PageCompletenessMoreAvailable)
		}
		for _, hit := range data.Hits {
			seen[hit.SubjectRef]++
			walked++
		}
		cursor = data.Page.Token
	}
	if walked != walkPages*walkPageSize || len(seen) != walked {
		t.Fatalf("walked %d hits with %d distinct subjects, want %d/%d", walked, len(seen), walkPages*walkPageSize, walkPages*walkPageSize)
	}
	for subject, appearances := range seen {
		if appearances != 1 {
			t.Fatalf("subject %s appeared %d times, want exactly once", subject, appearances)
		}
	}
	t.Logf("search.query lexical (one axis, page_size=%d): walked %d of %d matches over %d pages; page 1 = %s / %d bytes (%d hits); page %d = %s / %d bytes (%d hits)",
		walkPageSize, walked, total, walkPages, walkFirst.latency, walkFirst.bytes, walkFirst.hits,
		walkPages, walkLater.latency, walkLater.bytes, walkLater.hits)

	// The cost is per returned hit, so a page at the documented maximum is
	// measurably more expensive than a default-sized page. The bound is the
	// caller's lever over server cost, and it is stated in every answer.
	_, rare := query([]string{search.AxisName}, "", 10)
	t.Logf("search.query lexical (one axis, page_size=10): %s / %d bytes (%d hits)", rare.latency, rare.bytes, rare.hits)

	// The same chain with the full default construct-axis projection: this is
	// the pre-existing per-hit provenance cost, and it is what a caller pays
	// per page. The page bound is the caller's lever over that cost.
	fullFirstData, fullFirst := query(nil, "", pageSize)
	if fullFirstData.Page.Token == "" {
		t.Fatal("full-axis page 1 issued no continuation")
	}
	_, fullSecond := query(nil, fullFirstData.Page.Token, 200)
	t.Logf("search.query lexical (all axes): page_size=%d page 1 = %s / %d bytes (%d hits); page_size=200 page 2 = %s / %d bytes (%d hits)",
		pageSize, fullFirst.latency, fullFirst.bytes, fullFirst.hits, fullSecond.latency, fullSecond.bytes, fullSecond.hits)

	// content.list keeps its complete-projection default and states its exact
	// total; the same projection is available as bounded pages.
	completeStarted := time.Now()
	complete := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{
		"workspace_id": library.WorkspaceID,
	}))
	completeElapsed := time.Since(completeStarted)
	if complete.Status != command.StatusSucceeded {
		t.Fatalf("content.list = %q: %+v", complete.Status, complete.Reasons)
	}
	var completeData command.ContentListData
	if err := json.Unmarshal(complete.Data, &completeData); err != nil {
		t.Fatal(err)
	}
	if completeData.Page == nil || completeData.Page.Entries == nil || *completeData.Page.Entries != total {
		t.Fatalf("content.list page block = %+v, want entries=%d", completeData.Page, total)
	}
	if completeData.Page.Mode != command.PageModeDefault || !completeData.Page.Complete {
		t.Fatalf("content.list default = %+v, want a stated complete projection", completeData.Page)
	}
	if len(completeData.Items) != total {
		t.Fatalf("content.list default returned %d items, want %d", len(completeData.Items), total)
	}

	var contentFirst, contentLater measurement
	contentSeen := map[string]int{}
	contentPages := 0
	contentCursor := ""
	for {
		input := map[string]any{"workspace_id": library.WorkspaceID, "page": map[string]any{"limit": pageSize}}
		if contentCursor != "" {
			input["page"] = map[string]any{"limit": pageSize, "token": contentCursor}
		}
		callStarted := time.Now()
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, input))
		elapsed := time.Since(callStarted)
		if result.Status != command.StatusSucceeded {
			t.Fatalf("content.list page = %q: %+v", result.Status, result.Reasons)
		}
		var data command.ContentListData
		if err := json.Unmarshal(result.Data, &data); err != nil {
			t.Fatal(err)
		}
		contentPages++
		switch contentPages {
		case 1:
			contentFirst = measurement{latency: elapsed, bytes: len(result.Data), hits: len(data.Items)}
		case 5:
			contentLater = measurement{latency: elapsed, bytes: len(result.Data), hits: len(data.Items)}
		}
		for _, item := range data.Items {
			contentSeen[item.SubjectRef]++
		}
		if !data.Page.HasMore {
			break
		}
		contentCursor = data.Page.Token
		if contentCursor == "" {
			t.Fatal("a content.list page with more entries issued no continuation")
		}
		if contentPages > total/pageSize+2 {
			t.Fatal("content.list paging did not terminate")
		}
	}
	if len(contentSeen) != total {
		t.Fatalf("content.list paged %d distinct entries, want %d", len(contentSeen), total)
	}
	for subject, appearances := range contentSeen {
		if appearances != 1 {
			t.Fatalf("entry %s appeared %d times, want exactly once", subject, appearances)
		}
	}
	t.Logf("content.list: %d entries; complete projection = %s / %d bytes; page 1 = %s / %d bytes (%d items); page 5 = %s / %d bytes (%d items)",
		total, completeElapsed, len(complete.Data), contentFirst.latency, contentFirst.bytes, contentFirst.hits,
		contentLater.latency, contentLater.bytes, contentLater.hits)

	// The bounded page must be materially smaller than the complete
	// projection, which is what the measured 26-second client absorb was about.
	if contentFirst.bytes >= len(complete.Data) {
		t.Fatalf("a bounded content.list page (%d bytes) is not smaller than the complete projection (%d bytes)",
			contentFirst.bytes, len(complete.Data))
	}
}
