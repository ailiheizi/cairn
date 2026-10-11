package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ailiheizi/cairn/client/command"
)

// contentListPageProbe is the page object one scripted content.list answer is
// keyed by.
type contentListPageProbe struct {
	Page *struct {
		Limit *int   `json:"limit"`
		Token string `json:"token"`
	} `json:"page"`
}

func contentListPageToken(t *testing.T, env command.Envelope) string {
	t.Helper()
	var probe contentListPageProbe
	if err := json.Unmarshal(env.Input, &probe); err != nil {
		t.Fatalf("decode content.list input: %v", err)
	}
	if probe.Page == nil {
		return ""
	}
	return probe.Page.Token
}

// TestReadOnlyContentScanFollowsTheProjectionsOwnContinuation proves the
// read-only adapter walks a paged content projection to exhaustion and reports
// the daemon's own total rather than the size of one page.
func TestReadOnlyContentScanFollowsTheProjectionsOwnContinuation(t *testing.T) {
	const total = 3
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		if env.Operation != command.OpContentList {
			t.Fatalf("unexpected operation %q", env.Operation)
		}
		count := total
		switch contentListPageToken(t, env) {
		case "":
			return fakeReply{data: command.ContentListData{
				WorkspaceID: "wsp_one",
				Items:       []command.ContentItemData{{SubjectRef: "subj_a"}, {SubjectRef: "subj_b"}},
				Page: &command.PageData{
					Mode: command.PageModePage, Limit: 2, Returned: 2, Entries: &count,
					Completeness: command.PageCompletenessMoreAvailable, HasMore: true, Token: "page-2",
				},
			}}
		case "page-2":
			return fakeReply{data: command.ContentListData{
				WorkspaceID: "wsp_one",
				Items:       []command.ContentItemData{{SubjectRef: "subj_c"}},
				Page: &command.PageData{
					Mode: command.PageModePage, Limit: 2, Returned: 1, Entries: &count,
					Completeness: command.PageCompletenessComplete, Complete: true,
				},
			}}
		}
		t.Fatalf("adapter sent an unexpected page token")
		return fakeReply{}
	})
	gateway := &readOnlyGateway{conn: daemon.connect(t), token: validTestToken(t)}
	collector := &readOnlyCollector{}
	var seen []string
	reported, _, err := readOnlyContentScan(context.Background(), gateway, collector, "wsp_one", func(item command.ContentItemData) bool {
		seen = append(seen, item.SubjectRef)
		return false
	})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if reported != total {
		t.Fatalf("scan reported total %d, want the daemon's %d", reported, total)
	}
	if strings.Join(seen, ",") != "subj_a,subj_b,subj_c" {
		t.Fatalf("scan visited %v, want the three projected entries", seen)
	}
	if len(collector.steps) != 2 {
		t.Fatalf("scan recorded %d steps, want two pages followed", len(collector.steps))
	}
}

// TestReadOnlyContentScanStopsOnANonAdvancingContinuation proves the bounded
// loop fails visibly instead of spinning when a continuation does not advance,
// so a partial scan can never be presented as complete.
func TestReadOnlyContentScanStopsOnANonAdvancingContinuation(t *testing.T) {
	count := 5
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		return fakeReply{data: command.ContentListData{
			WorkspaceID: "wsp_one",
			Items:       []command.ContentItemData{{SubjectRef: "subj_a"}},
			Page: &command.PageData{
				Mode: command.PageModePage, Limit: 1, Returned: 1, Entries: &count,
				Completeness: command.PageCompletenessMoreAvailable, HasMore: true, Token: "stuck",
			},
		}}
	})
	gateway := &readOnlyGateway{conn: daemon.connect(t), token: validTestToken(t)}
	_, _, err := readOnlyContentScan(context.Background(), gateway, &readOnlyCollector{}, "wsp_one", nil)
	if err == nil {
		t.Fatal("a continuation that does not advance must stop with a visible error")
	}
	if !strings.Contains(err.Error(), "did not advance") {
		t.Fatalf("non-advancing continuation error = %q", err)
	}
}

// TestReadOnlyContentScanIsBounded proves the loop refuses to run forever even
// when every page advances, so a broken projection cannot hang the surface.
func TestReadOnlyContentScanIsBounded(t *testing.T) {
	count := 100000
	page := 0
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		page++
		return fakeReply{data: command.ContentListData{
			WorkspaceID: "wsp_one",
			Items:       []command.ContentItemData{{SubjectRef: "subj_a"}},
			Page: &command.PageData{
				Mode: command.PageModePage, Limit: 1, Returned: 1, Entries: &count,
				Completeness: command.PageCompletenessMoreAvailable, HasMore: true,
				Token: "page-" + strings.Repeat("x", page%7+1),
			},
		}}
	})
	gateway := &readOnlyGateway{conn: daemon.connect(t), token: validTestToken(t)}
	_, _, err := readOnlyContentScan(context.Background(), gateway, &readOnlyCollector{}, "wsp_one", nil)
	if err == nil {
		t.Fatal("the scan must refuse to run past its page bound")
	}
	if !strings.Contains(err.Error(), "page bound") {
		t.Fatalf("bounded-loop error = %q", err)
	}
}
