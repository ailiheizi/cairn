package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ailiheizi/cairn/client/command"
)

// cairn description generate
//
// One explicit, on-demand description generation for one subject. The daemon
// runs the egress-gated DESCRIBE_SUBJECT provider; this command never carries
// a credential, never sends content of its own, and prints only the daemon's
// own facts (the admitted revision header).
//
// Unless the operator's remote-egress switch skips confirmations, the request
// must carry a per-request egress confirmation naming the live grant. The
// confirmation is resolved from the daemon's own durable grant ledger
// (egress.grant.list) by --grant: the command copies the grant's profile,
// digest, destination host, and model into the confirmation and dispatches it.
// No secret material ever passes through the client.

const describeEgressPurpose = "DESCRIBE"

func newDescriptionGenerateCommand(env *clientEnv) *cobra.Command {
	commandNode := newExitCommand(env, "generate <subject-ref>", "Generate one candidate description through the egress-gated provider",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			if len(args) != 1 {
				fmt.Fprintln(cmd.ErrOrStderr(), "usage: cairn description generate <subject-ref> --workspace <id> --kind <AI_SUMMARY|AI_ANALYSIS> [--grant <grant-id>]")
				return 1
			}
			input := map[string]any{
				"workspace_id": workspaceValue(cmd),
				"subject_ref":  args[0],
				"kind":         strings.TrimSpace(cmd.Flags().Lookup("kind").Value.String()),
			}
			for flag, field := range map[string]string{"title": "title", "language": "language"} {
				if value := cmd.Flags().Lookup(flag).Value.String(); value != "" {
					input[field] = value
				}
			}
			grantID := strings.TrimSpace(cmd.Flags().Lookup("grant").Value.String())
			if grantID != "" {
				confirmation, err := resolveDescriptionEgressConfirmation(cmd, env, grantID)
				if err != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "egress confirmation: %v\n", err)
					return 1
				}
				input["egress_confirmation"] = confirmation
			}
			return env.request(cmd, command.OpDescriptionGenerate, input, renderDescriptionGenerate)
		})
	workspaceFlag(commandNode.Command)
	commandNode.Flags().String("kind", "", "AI_SUMMARY or AI_ANALYSIS")
	commandNode.Flags().String("title", "", "title for the generated revision")
	commandNode.Flags().String("language", "", "requested output language label")
	commandNode.Flags().String("grant", "", "live egress grant id that authorizes this disclosure (required unless the daemon runs with send_content_without_confirmation)")
	_ = commandNode.MarkFlagRequired("workspace")
	_ = commandNode.MarkFlagRequired("kind")
	return commandNode.Command
}

// resolveDescriptionEgressConfirmation reads the daemon's live grant list and
// builds the per-request confirmation from the named grant row. The daemon
// verifies the bindings; the client only copies the facts it was given.
func resolveDescriptionEgressConfirmation(cmd *cobra.Command, env *clientEnv, grantID string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(cmd.Context(), env.timeout)
	defer cancel()
	result, err := env.do(ctx, command.OpEgressGrantList, map[string]any{})
	if err != nil {
		return nil, err
	}
	if result.Status != command.StatusSucceeded {
		return nil, fmt.Errorf("cannot read the egress grant ledger (status %s)", result.Status)
	}
	var data command.EgressGrantListData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		return nil, err
	}
	for _, grant := range data.Grants {
		if grant.GrantID != grantID {
			continue
		}
		if grant.Revoked {
			return nil, fmt.Errorf("egress grant %s is revoked", grantID)
		}
		if !grant.Live {
			return nil, fmt.Errorf("egress grant %s has expired", grantID)
		}
		if !strings.EqualFold(strings.TrimSpace(grant.Purpose), describeEgressPurpose) {
			return nil, fmt.Errorf("egress grant %s authorizes purpose %s, not %s", grantID, grant.Purpose, describeEgressPurpose)
		}
		return map[string]any{
			"profile_id":     grant.ProfileID,
			"profile_digest": grant.ProfileDigest,
			"endpoint_host":  grant.EndpointHost,
			"model":          grant.ModelID,
			"purpose":        describeEgressPurpose,
			"grant_id":       grant.GrantID,
		}, nil
	}
	return nil, fmt.Errorf("egress grant %s is not in the daemon's grant ledger", grantID)
}

func renderDescriptionGenerate(cmd *cobra.Command, result command.Result) error {
	var data command.DescriptionGenerateData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		return err
	}
	item := data.Document
	renderDescriptionHeader(cmd, item)
	fmt.Fprintf(cmd.OutOrStdout(), "producer:    %s\n", item.ProducerProfile)
	if item.ProducerProfileDigest != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "producer digest: %s\n", item.ProducerProfileDigest)
	}
	fmt.Fprintf(cmd.OutOrStdout(), "accepted:    %t\n", item.Accepted)
	return nil
}
