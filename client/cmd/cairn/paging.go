package main

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/ailiheizi/cairn/client/command"
)

// searchPageInput builds the canonical page object shared by search.query and
// content.list. It returns nil when the caller asked for no explicit bound, so
// the daemon's own default applies and the answer states it.
func searchPageInput(cmd *cobra.Command, limit int, token string) map[string]any {
	page := map[string]any{}
	if cmd.Flags().Changed("page-size") {
		page["limit"] = limit
	}
	if token != "" {
		page["token"] = token
	}
	if len(page) == 0 {
		return nil
	}
	return page
}

// renderPageFacts prints how one answer was bounded.
//
// It is deliberately printed on every answer, including a complete one, so a
// shell caller can never mistake a partial answer for the whole answer, and
// can always tell "there is nothing more" (completeness COMPLETE) from "this
// lane cannot tell you" (completeness BOUNDED_UNKNOWN).
func renderPageFacts(cmd *cobra.Command, page *command.PageData) {
	if page == nil {
		return
	}
	out := cmd.OutOrStdout()
	summary := fmt.Sprintf("page: mode=%s returned=%d", page.Mode, page.Returned)
	if page.Entries != nil {
		summary += fmt.Sprintf(" entries=%d", *page.Entries)
	}
	if page.Limit > 0 {
		summary += fmt.Sprintf(" limit=%d", page.Limit)
	}
	summary += " completeness=" + page.Completeness
	if page.Truncated {
		summary += " truncated=" + page.TruncationReason
	}
	fmt.Fprintln(out, summary)
	if page.Order != "" {
		fmt.Fprintf(out, "order: %s\n", page.Order)
	}
	switch {
	case page.HasMore && page.Token != "":
		fmt.Fprintf(out, "token: %s\n", page.Token)
		if page.ExpiresAt != "" {
			fmt.Fprintf(out, "token_expires_at: %s\n", page.ExpiresAt)
		}
	case !page.ContinuationSupported && page.ContinuationReason != "":
		fmt.Fprintf(out, "no_continuation: %s\n", page.ContinuationReason)
	}
	for _, lane := range page.Lanes {
		fmt.Fprintf(out, "lane: %s status=%s returned=%d complete=%t has_more=%t truncated=%t bounded_top_k=%d pageable=%t\n",
			lane.Dimension, lane.Status, lane.Returned, lane.Complete, lane.HasMore, lane.Truncated, lane.BoundedTopK, lane.Pageable)
	}
}

// newContentListCommand exposes content.list, the flat latest-published
// content-library projection, as bounded pages. It is a thin round trip: the
// daemon decides the bound and states it, and this command only prints it.
func newContentListCommand(env *clientEnv) *cobra.Command {
	var workspace string
	var pageSize int
	var cursor string
	commandNode := newExitCommand(env, "list", "List the latest published content projection (bounded pages)",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			if workspace == "" {
				fmt.Fprintf(cmd.ErrOrStderr(), "usage: cairn content list --workspace <id> [--page-size <n>] [--cursor <token>]\n")
				return 1
			}
			input := map[string]any{"workspace_id": workspace}
			if page := searchPageInput(cmd, pageSize, cursor); page != nil {
				input["page"] = page
			}
			return env.request(cmd, command.OpContentList, input, func(cmd *cobra.Command, result command.Result) error {
				var data command.ContentListData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				for _, item := range data.Items {
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\n", item.EntryType, item.SubjectRef, item.Path)
				}
				renderPageFacts(cmd, data.Page)
				return nil
			})
		})
	commandNode.Flags().StringVar(&workspace, "workspace", "", "catalog workspace stable id")
	commandNode.Flags().IntVar(&pageSize, "page-size", 0, "page.limit: bounded page size (1..1000); omit for the complete projection")
	commandNode.Flags().StringVar(&cursor, "cursor", "", "page.token: opaque continuation from an earlier page")
	return commandNode.Command
}
