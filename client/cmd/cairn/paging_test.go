package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/ailiheizi/cairn/client/command"
)

// TestSearchPageInputMapsFlagsToThePageObject proves the porcelain fills the
// canonical page object and stays out of the way when the caller asked for no
// bound: the daemon's own default then applies and the answer states it.
func TestSearchPageInputMapsFlagsToThePageObject(t *testing.T) {
	cmd := &cobra.Command{}
	cmd.Flags().Int("page-size", 0, "")
	cmd.Flags().String("cursor", "", "")
	if page := searchPageInput(cmd, 10, ""); page != nil {
		t.Fatalf("no paging flag must send no page object, got %+v", page)
	}
	if err := cmd.Flags().Set("page-size", "10"); err != nil {
		t.Fatal(err)
	}
	page := searchPageInput(cmd, 10, "")
	if page == nil || page["limit"] != 10 {
		t.Fatalf("page-size did not become page.limit: %+v", page)
	}
	if _, present := page["token"]; present {
		t.Fatalf("a page with no cursor must not carry a token: %+v", page)
	}
	page = searchPageInput(cmd, 10, "opaque-token")
	if page == nil || page["limit"] != 10 || page["token"] != "opaque-token" {
		t.Fatalf("cursor did not become page.token: %+v", page)
	}
}

// TestRenderPageFactsNamesTheCompletenessState proves the human output always
// states how the answer was bounded, so a shell caller can tell an exhausted
// answer from one with more available and from a lane that cannot say.
func TestRenderPageFactsNamesTheCompletenessState(t *testing.T) {
	count := 9138
	cases := []struct {
		name string
		page *command.PageData
		want []string
	}{
		{
			name: "complete",
			page: &command.PageData{
				Mode: command.PageModeDefault, Returned: 9138, Entries: &count,
				Completeness: command.PageCompletenessComplete, Complete: true,
				Order: "entry_path,entry_id", ContinuationSupported: true,
			},
			want: []string{"mode=default", "returned=9138", "entries=9138", "completeness=COMPLETE", "order: entry_path,entry_id"},
		},
		{
			name: "more available",
			page: &command.PageData{
				Mode: command.PageModePage, Limit: 200, Returned: 200,
				Completeness: command.PageCompletenessMoreAvailable, HasMore: true,
				Lane: "lexical-metadata-fts", Order: "rank,rowid",
				ContinuationSupported: true, Token: "opaque-token", ExpiresAt: "2026-10-11T12:15:00Z",
			},
			want: []string{"mode=page", "limit=200", "completeness=MORE_AVAILABLE", "token: opaque-token", "token_expires_at: 2026-10-11T12:15:00Z"},
		},
		{
			name: "bounded and unknowable",
			page: &command.PageData{
				Mode: command.PageModeDefault, Returned: 100,
				Completeness: command.PageCompletenessBoundedUnknown,
				Truncated:    true, TruncationReason: command.PageTruncationBoundedTopK,
				Lane: "semantic-embedding", ContinuationSupported: false,
				ContinuationReason: command.PageContinuationBoundedLane,
				Lanes: []command.PageLaneData{{
					Dimension: "semantic-embedding", Status: "SUCCEEDED", Returned: 100,
					Truncated: true, BoundedTopK: 100, Limit: 100,
				}},
			},
			want: []string{
				"completeness=BOUNDED_UNKNOWN", "truncated=BOUNDED_TOP_K",
				"no_continuation: LANE_IS_BOUNDED_TOP_K", "lane: semantic-embedding", "bounded_top_k=100",
			},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			cmd := &cobra.Command{}
			var out bytes.Buffer
			cmd.SetOut(&out)
			renderPageFacts(cmd, testCase.page)
			rendered := out.String()
			for _, fragment := range testCase.want {
				if !strings.Contains(rendered, fragment) {
					t.Fatalf("rendered page facts missing %q:\n%s", fragment, rendered)
				}
			}
		})
	}
}
