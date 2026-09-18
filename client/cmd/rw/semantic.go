package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ailiheizi/restoreweave/client/command"
)

// newSemanticCommand exposes the semantic provider profile lifecycle and the
// durable egress grant lifecycle through the same thin command envelope as the
// other operator workflows. Every command prints the daemon's own facts and
// never a secret.
func newSemanticCommand(env *clientEnv) *cobra.Command {
	semantic := &cobra.Command{Use: "semantic", Short: "Manage the local semantic provider"}
	bundle := &cobra.Command{Use: "bundle", Short: "Install the pinned BGE/ONNX and zvec bundle"}
	install := newExitCommand(env, "install", "Install the semantic bundle; optionally use a local offline archive",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			archivePath, err := cmd.Flags().GetString("archive")
			if err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "read archive flag: %v\n", err)
				return 1
			}
			input := command.SemanticBundleInstallInput{}
			if archivePath != "" {
				input.ArchivePath = archivePath
			}
			return env.request(cmd, command.OpSemanticBundleInstall, input, func(cmd *cobra.Command, result command.Result) error {
				var data command.SemanticBundleInstallData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "profile:     %s\n", data.ProfileID)
				fmt.Fprintf(cmd.OutOrStdout(), "digest:      %s\n", data.ProfileDigest)
				fmt.Fprintf(cmd.OutOrStdout(), "destination: %s\n", data.Destination)
				fmt.Fprintf(cmd.OutOrStdout(), "changed:     %t\n", data.Changed)
				if data.RestartRequired {
					fmt.Fprintln(cmd.OutOrStdout(), "restart:     required before semantic worker/index use")
				}
				return nil
			})
		})
	install.Flags().String("archive", "", "local absolute offline semantic bundle archive (.tar.gz)")
	bundle.AddCommand(install.Command)
	semantic.AddCommand(bundle)
	semantic.AddCommand(newSemanticProviderCommand(env))
	semantic.AddCommand(newSemanticEgressCommand(env))
	return semantic
}

// newSemanticProviderCommand manages operator-installed online provider
// profiles. The install source is an absolute local path: the daemon reads the
// document itself and never downloads it.
func newSemanticProviderCommand(env *clientEnv) *cobra.Command {
	provider := &cobra.Command{Use: "provider", Short: "Manage installed online provider profiles"}
	install := newExitCommand(env, "install <path>", "Install one online provider profile from a local absolute path",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			if len(args) != 1 {
				fmt.Fprintln(cmd.ErrOrStderr(), "usage: rw semantic provider install <path> --digest sha256:...")
				return 1
			}
			digest, err := cmd.Flags().GetString("digest")
			if err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "read digest flag: %v\n", err)
				return 1
			}
			input := command.SemanticProviderInstallInput{Path: args[0], ProfileDigest: digest}
			return env.request(cmd, command.OpSemanticProviderInstall, input, func(cmd *cobra.Command, result command.Result) error {
				var data command.SemanticProviderInstallData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "profile:      %s\n", data.ProfileID)
				fmt.Fprintf(cmd.OutOrStdout(), "provider:     %s\n", data.Provider)
				fmt.Fprintf(cmd.OutOrStdout(), "api style:    %s\n", data.APIStyle)
				fmt.Fprintf(cmd.OutOrStdout(), "endpoint:     %s\n", data.EndpointHost)
				fmt.Fprintf(cmd.OutOrStdout(), "model:        %s@%s\n", data.ModelID, data.ModelRevision)
				fmt.Fprintf(cmd.OutOrStdout(), "dimension:    %d\n", data.Dimension)
				fmt.Fprintf(cmd.OutOrStdout(), "space digest: %s\n", data.SpaceDigest)
				fmt.Fprintf(cmd.OutOrStdout(), "digest:       %s\n", data.ProfileDigest)
				fmt.Fprintf(cmd.OutOrStdout(), "destination:  %s\n", data.Destination)
				fmt.Fprintf(cmd.OutOrStdout(), "expiry:       %s\n", data.Expiry)
				fmt.Fprintf(cmd.OutOrStdout(), "data classes:    %s\n", strings.Join(data.DisclosedDataClasses, ","))
				fmt.Fprintf(cmd.OutOrStdout(), "subject classes: %s\n", strings.Join(data.AllowedSubjectClasses, ","))
				fmt.Fprintf(cmd.OutOrStdout(), "changed:      %t\n", data.Changed)
				fmt.Fprintf(cmd.OutOrStdout(), "already installed: %t\n", data.AlreadyInstalled)
				if data.RestartRequired {
					fmt.Fprintln(cmd.OutOrStdout(), "restart:      required before the profile can be selected")
				}
				return nil
			})
		})
	install.Flags().String("digest", "", "declared profile digest (sha256:...) the daemon must reproduce")
	provider.AddCommand(install.Command)

	list := newExitCommand(env, "list", "List online provider profiles installed under the daemon's models root",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			return env.request(cmd, command.OpSemanticProviderList, command.SemanticProviderListInput{}, func(cmd *cobra.Command, result command.Result) error {
				var data command.SemanticProviderListData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "models root: %s\n", data.ModelsRoot)
				if len(data.Profiles) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "no online provider profiles are installed")
					return nil
				}
				for _, profile := range data.Profiles {
					state := "ACTIVE"
					if profile.Expired {
						state = "EXPIRED"
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\t%s\t%s@%s\t%dd\t%s\t%s\n",
						profile.ProfileID, state, profile.Provider, profile.EndpointHost,
						profile.ModelID, profile.ModelRevision, profile.Dimension, profile.ProfileDigest, profile.Expiry)
					fmt.Fprintf(cmd.OutOrStdout(), "\tdata classes: %s; subject classes: %s; budgets: %d requests, %d bytes, %ds; audit required: %t\n",
						strings.Join(profile.DisclosedDataClasses, ","), strings.Join(profile.AllowedSubjectClasses, ","),
						profile.MaxRequests, profile.MaxBytes, profile.MaxSeconds, profile.AuditRequired)
				}
				return nil
			})
		})
	provider.AddCommand(list.Command)
	return provider
}

// newSemanticEgressCommand manages immutable egress grants. A grant is
// revoked by appending a revocation; nothing is ever deleted or edited.
func newSemanticEgressCommand(env *clientEnv) *cobra.Command {
	egress := &cobra.Command{Use: "egress", Short: "Manage immutable remote-egress grants"}

	grant := newExitCommand(env, "grant", "Create an immutable egress grant for one installed profile",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			flags := cmd.Flags()
			profileID, _ := flags.GetString("profile")
			profileDigest, _ := flags.GetString("digest")
			endpointHost, _ := flags.GetString("endpoint-host")
			modelID, _ := flags.GetString("model")
			purpose, _ := flags.GetString("purpose")
			dataClasses, _ := flags.GetStringArray("data-class")
			subjectClasses, _ := flags.GetStringArray("subject-class")
			maxRequests, _ := flags.GetInt64("max-requests")
			maxBytes, _ := flags.GetInt64("max-bytes")
			maxSeconds, _ := flags.GetInt64("max-seconds")
			expiresAt, _ := flags.GetString("expires-at")
			grantedBy, _ := flags.GetString("granted-by")
			workspaceID, _ := flags.GetString("workspace")
			input := command.EgressGrantCreateInput{
				WorkspaceID: workspaceID,
				ProfileID:   profileID, ProfileDigest: profileDigest, EndpointHost: endpointHost,
				ModelID: modelID, Purpose: purpose, DataClasses: dataClasses, SubjectClasses: subjectClasses,
				MaxRequests: maxRequests, MaxBytes: maxBytes, MaxSeconds: maxSeconds,
				ExpiresAt: expiresAt, GrantedBy: grantedBy,
			}
			return env.request(cmd, command.OpEgressGrantCreate, input, func(cmd *cobra.Command, result command.Result) error {
				var data command.EgressGrantData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "grant:     %s\n", data.GrantID)
				fmt.Fprintf(cmd.OutOrStdout(), "profile:   %s\n", data.ProfileID)
				fmt.Fprintf(cmd.OutOrStdout(), "endpoint:  %s\n", data.EndpointHost)
				fmt.Fprintf(cmd.OutOrStdout(), "model:     %s\n", data.ModelID)
				fmt.Fprintf(cmd.OutOrStdout(), "purpose:   %s\n", data.Purpose)
				fmt.Fprintf(cmd.OutOrStdout(), "expires:   %s\n", data.ExpiresAt)
				fmt.Fprintf(cmd.OutOrStdout(), "live:      %t\n", data.Live)
				return nil
			})
		})
	grant.Flags().String("profile", "", "installed online provider profile id")
	grant.Flags().String("digest", "", "installed profile digest (sha256:...)")
	grant.Flags().String("endpoint-host", "", "endpoint host[:port] from the installed profile")
	grant.Flags().String("model", "", "model id from the installed profile")
	grant.Flags().String("purpose", "", "DOCUMENT or QUERY")
	grant.Flags().StringArray("data-class", nil, "disclosed data class (repeatable; e.g. text.segment)")
	grant.Flags().StringArray("subject-class", nil, "allowed subject class (repeatable; e.g. EXACT_PROTECTED)")
	grant.Flags().Int64("max-requests", 0, "per-run request budget (positive)")
	grant.Flags().Int64("max-bytes", 0, "per-run byte budget (positive)")
	grant.Flags().Int64("max-seconds", 0, "per-run wall-clock budget in seconds (positive)")
	grant.Flags().String("expires-at", "", "RFC3339 expiry instant in the future")
	grant.Flags().String("granted-by", "", "actor recorded on the grant (default: operator)")
	grant.Flags().String("workspace", "", "workspace id (default: the single default workspace)")
	egress.AddCommand(grant.Command)

	list := newExitCommand(env, "list", "List durable egress grants with their liveness",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			workspaceID, _ := cmd.Flags().GetString("workspace")
			return env.request(cmd, command.OpEgressGrantList, command.EgressGrantListInput{WorkspaceID: workspaceID}, func(cmd *cobra.Command, result command.Result) error {
				var data command.EgressGrantListData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				if len(data.Grants) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "no egress grants are recorded")
					return nil
				}
				for _, item := range data.Grants {
					state := "LIVE"
					if item.Revoked {
						state = "REVOKED"
					} else if !item.Live {
						state = "EXPIRED"
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
						item.GrantID, state, item.ProfileID, item.EndpointHost, item.ModelID, item.Purpose, item.ExpiresAt)
					if item.Revoked {
						fmt.Fprintf(cmd.OutOrStdout(), "\trevoked: %s (%s) at %s\n", item.RevocationID, item.RevokedReason, item.RevokedAt)
					}
				}
				return nil
			})
		})
	list.Flags().String("workspace", "", "workspace id (default: the single default workspace)")
	egress.AddCommand(list.Command)

	revoke := newExitCommand(env, "revoke <grant-id>", "Revoke one egress grant by appending a revocation",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			if len(args) != 1 {
				fmt.Fprintln(cmd.ErrOrStderr(), "usage: rw semantic egress revoke <grant-id> --reason \"...\"")
				return 1
			}
			reason, _ := cmd.Flags().GetString("reason")
			revokedBy, _ := cmd.Flags().GetString("revoked-by")
			workspaceID, _ := cmd.Flags().GetString("workspace")
			input := command.EgressGrantRevokeInput{WorkspaceID: workspaceID, GrantID: args[0], Reason: reason, RevokedBy: revokedBy}
			return env.request(cmd, command.OpEgressGrantRevoke, input, func(cmd *cobra.Command, result command.Result) error {
				var data command.EgressGrantRevokeData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "grant:      %s\n", data.GrantID)
				fmt.Fprintf(cmd.OutOrStdout(), "revocation: %s\n", data.RevocationID)
				fmt.Fprintf(cmd.OutOrStdout(), "revoked by: %s\n", data.RevokedBy)
				fmt.Fprintf(cmd.OutOrStdout(), "revoked at: %s\n", data.RevokedAt)
				fmt.Fprintf(cmd.OutOrStdout(), "reason:     %s\n", data.Reason)
				fmt.Fprintf(cmd.OutOrStdout(), "live:       %t\n", data.Live)
				return nil
			})
		})
	revoke.Flags().String("reason", "", "recorded reason for the revocation")
	revoke.Flags().String("revoked-by", "", "actor recorded on the revocation (default: operator)")
	revoke.Flags().String("workspace", "", "workspace id (default: the single default workspace)")
	egress.AddCommand(revoke.Command)
	return egress
}
