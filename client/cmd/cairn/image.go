package main

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/ailiheizi/cairn/client/command"
)

// newImageCommand exposes the image bundle installation operation through the
// same thin command envelope as the semantic bundle command. The archive is
// transport: the descriptor inside it is what the daemon verifies.
func newImageCommand(env *clientEnv) *cobra.Command {
	image := &cobra.Command{Use: "image", Short: "Manage the local image (Chinese-CLIP) provider"}
	bundle := &cobra.Command{Use: "bundle", Short: "Install the admitted Chinese-CLIP ONNX bundle from an archive"}
	install := newExitCommand(env, "install", "Install the image bundle from a local offline archive",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			archivePath, err := cmd.Flags().GetString("archive")
			if err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "read archive flag: %v\n", err)
				return 1
			}
			return env.request(cmd, command.OpImageBundleInstall, command.ImageBundleInstallInput{ArchivePath: archivePath}, func(cmd *cobra.Command, result command.Result) error {
				var data command.ImageBundleInstallData
				if err := json.Unmarshal(result.Data, &data); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "profile:     %s\n", data.ProfileID)
				fmt.Fprintf(cmd.OutOrStdout(), "digest:      %s\n", data.ProfileDigest)
				fmt.Fprintf(cmd.OutOrStdout(), "destination: %s\n", data.Destination)
				fmt.Fprintf(cmd.OutOrStdout(), "assets:      %d\n", data.AssetCount)
				fmt.Fprintf(cmd.OutOrStdout(), "changed:     %t\n", data.Changed)
				if data.RestartRequired {
					fmt.Fprintln(cmd.OutOrStdout(), "restart:     required before the image dimension can serve a generation")
				}
				return nil
			})
		})
	install.Flags().String("archive", "", "local absolute image bundle archive (.tar.gz)")
	bundle.AddCommand(install.Command)
	image.AddCommand(bundle)
	return image
}
