package search

import (
	"context"
	"fmt"
	"testing"
)

// buildPagingFixture builds one lexical generation whose common token matches
// every document, so a page boundary can be exercised over a match set larger
// than one page. The per-document term counts vary, so the bm25 ranks vary too
// and the (rank, rowid) tie-break is actually exercised.
func buildPagingFixture(t *testing.T, count int) (*Engine, string) {
	t.Helper()
	ctx := context.Background()
	engine := &Engine{Dir: t.TempDir()}
	docs := make([]Document, 0, count)
	for index := 0; index < count; index++ {
		docs = append(docs, Document{
			SubjectID: fmt.Sprintf("nse_%032d", index),
			// "pageitem" appears once in every name, so every document matches
			// the query token; the extra repetitions below change each rank.
			Name:      fmt.Sprintf("pageitem-%03d.txt", index),
			Path:      fmt.Sprintf("photos/pages/pageitem-%03d.txt", index),
			Suffix:    "txt",
			EntryType: "REGULAR_FILE",
			Notes:     fmt.Sprintf("pageitem %03d", index) + repeatWord("pageitem", index%5),
		})
	}
	path, err := engine.Build(ctx, "idx_pagingfixture00000000000000000", docs)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	return engine, path
}

func repeatWord(word string, count int) string {
	out := ""
	for index := 0; index < count; index++ {
		out += " " + word
	}
	return out
}

// TestEngineQueryPageWalksEveryMatchExactlyOnce is the core exactness proof:
// paging a match set larger than one page returns every match exactly once
// across at least three consecutive pages, with a total order and no
// duplicates or omissions.
func TestEngineQueryPageWalksEveryMatchExactlyOnce(t *testing.T) {
	ctx := context.Background()
	const total = 25
	const pageSize = 10
	engine, path := buildPagingFixture(t, total)

	seen := map[string]int{}
	order := ""
	cursor := (*PagePosition)(nil)
	pages := 0
	for {
		page, err := engine.QueryPage(ctx, path, "pageitem", nil, Filters{}, PageRequest{Limit: pageSize, Position: cursor})
		if err != nil {
			t.Fatalf("page %d: %v", pages, err)
		}
		pages++
		if page.Order == "" {
			t.Fatalf("page %d reported no total order", pages)
		}
		if order == "" {
			order = page.Order
		} else if page.Order != order {
			t.Fatalf("page %d order = %q, want %q", pages, page.Order, order)
		}
		if page.HasMore && page.Next == (PagePosition{}) {
			t.Fatalf("page %d claimed more matches without a resume position", pages)
		}
		for _, hit := range page.Hits {
			seen[hit.SubjectID]++
		}
		if !page.HasMore {
			if len(page.Hits) > pageSize {
				t.Fatalf("final page returned %d hits, above the %d bound", len(page.Hits), pageSize)
			}
			break
		}
		if len(page.Hits) != pageSize {
			t.Fatalf("page %d returned %d hits with more available, want %d", pages, len(page.Hits), pageSize)
		}
		position := page.Next
		cursor = &position
		if pages > total {
			t.Fatal("paging did not terminate; a page boundary is not advancing")
		}
	}
	if pages < 3 {
		t.Fatalf("paged %d pages, want at least three consecutive pages", pages)
	}
	if len(seen) != total {
		t.Fatalf("paged %d distinct subjects, want %d", len(seen), total)
	}
	for subject, count := range seen {
		if count != 1 {
			t.Fatalf("subject %s appeared %d times, want exactly once", subject, count)
		}
	}
}

// TestEngineQueryPageReportsExhaustion proves an exhausted page says so rather
// than silently repeating or truncating, and that retrying an identical page
// request is idempotent.
func TestEngineQueryPageReportsExhaustion(t *testing.T) {
	ctx := context.Background()
	engine, path := buildPagingFixture(t, 7)

	page, err := engine.QueryPage(ctx, path, "pageitem", nil, Filters{}, PageRequest{Limit: 10})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if page.HasMore {
		t.Fatal("a page that returned every match must not claim more exist")
	}
	if page.Next != (PagePosition{}) {
		t.Fatalf("an exhausted page carried a resume position: %+v", page.Next)
	}
	if len(page.Hits) != 7 {
		t.Fatalf("exhausted page hits = %d, want 7", len(page.Hits))
	}
	// Retrying the same request returns the same page: the continuation names a
	// page start, so an identical retry is idempotent rather than a skip.
	again, err := engine.QueryPage(ctx, path, "pageitem", nil, Filters{}, PageRequest{Limit: 10})
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if len(again.Hits) != len(page.Hits) {
		t.Fatalf("retry returned %d hits, want %d", len(again.Hits), len(page.Hits))
	}
	for index := range page.Hits {
		if again.Hits[index].SubjectID != page.Hits[index].SubjectID {
			t.Fatalf("retry hit %d = %s, want %s", index, again.Hits[index].SubjectID, page.Hits[index].SubjectID)
		}
	}
	// A page whose resume position is past every row reports exhaustion, not a
	// silent repeat of the previous page. bm25 rank is never positive, so a
	// large positive rank sorts after every candidate.
	empty, err := engine.QueryPage(ctx, path, "pageitem", nil, Filters{}, PageRequest{
		Limit:    10,
		Position: &PagePosition{Lane: DimensionLexical, RowID: 1 << 40, Rank: 1e9, HasRank: true},
	})
	if err != nil {
		t.Fatalf("past-the-end page: %v", err)
	}
	if len(empty.Hits) != 0 || empty.HasMore {
		t.Fatalf("past-the-end page = %d hits, has_more=%t; want 0 and false", len(empty.Hits), empty.HasMore)
	}
}

// TestEngineQueryPageFilterOnlyOrderIsRowID proves a filter-only (no free text)
// page has its own declared total order and still pages exactly.
func TestEngineQueryPageFilterOnlyOrderIsRowID(t *testing.T) {
	ctx := context.Background()
	engine, path := buildPagingFixture(t, 9)
	filters := Filters{Suffix: "txt"}
	seen := map[string]bool{}
	cursor := (*PagePosition)(nil)
	pages := 0
	for {
		page, err := engine.QueryPage(ctx, path, "", nil, filters, PageRequest{Limit: 4, Position: cursor})
		if err != nil {
			t.Fatalf("filter page %d: %v", pages, err)
		}
		pages++
		if page.Order != OrderRowID {
			t.Fatalf("filter-only page order = %q, want %q", page.Order, OrderRowID)
		}
		for _, hit := range page.Hits {
			if seen[hit.SubjectID] {
				t.Fatalf("subject %s appeared twice", hit.SubjectID)
			}
			seen[hit.SubjectID] = true
		}
		if !page.HasMore {
			break
		}
		position := page.Next
		cursor = &position
		if pages > 10 {
			t.Fatal("filter-only paging did not terminate")
		}
	}
	if pages < 3 {
		t.Fatalf("filter-only paging covered %d pages, want at least three", pages)
	}
	if len(seen) != 9 {
		t.Fatalf("filter-only paging covered %d subjects, want 9", len(seen))
	}
}

// TestEngineQueryPageRefusesAnOutOfRangeBound proves the page bound is refused,
// not silently clamped, and that the legacy single-answer path keeps its own
// documented bound.
func TestEngineQueryPageRefusesAnOutOfRangeBound(t *testing.T) {
	ctx := context.Background()
	engine, path := buildPagingFixture(t, 3)
	if _, err := engine.QueryPage(ctx, path, "pageitem", nil, Filters{}, PageRequest{Limit: MaxPageSize + 1}); err == nil {
		t.Fatal("a page size above the maximum must be refused")
	}
	hits, err := engine.QueryFiltered(ctx, path, "pageitem", nil, Filters{})
	if err != nil {
		t.Fatalf("legacy query: %v", err)
	}
	if len(hits) != 3 {
		t.Fatalf("legacy query hits = %d, want 3", len(hits))
	}
}
