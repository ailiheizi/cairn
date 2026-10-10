package main

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ailiheizi/cairn/client/mcp"
	"github.com/ailiheizi/cairn/client/transport"
)

func newMCPCommand(env *clientEnv) *cobra.Command {
	var (
		stdio        bool
		readOnly     bool
		readTokenEnv string
	)
	command := newExitCommand(env, "mcp", "Run the local MCP server over stdio",
		func(cmd *cobra.Command, env *clientEnv, args []string) int {
			if readOnly {
				return runReadOnlyMCP(cmd, env, readTokenEnv)
			}
			// The stdio transport is the only transport this adapter has; a
			// non-stdio request is refused rather than silently served differently.
			if !stdio {
				fmt.Fprintf(cmd.ErrOrStderr(), "mcp requires --stdio: the MCP adapter has no network listener\n")
				return 2
			}
			// Dial with a bounded timeout so an unreachable daemon fails
			// fast, then serve for as long as the peer keeps the session.
			dialCtx, cancelDial := context.WithTimeout(cmd.Context(), env.timeout)
			conn, err := transport.DialContext(dialCtx, env.socket)
			cancelDial()
			if err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "cannot reach cairnd at %s: %v\n", env.socket, err)
				return 1
			}
			defer conn.Close()
			server := mcp.New(conn)
			if err := server.Run(cmd.Context(), &mcpsdk.StdioTransport{}); err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "mcp server: %v\n", err)
				return 1
			}
			return 0
		})
	command.Flags().BoolVar(&stdio, "stdio", false,
		"serve the MCP protocol over stdin/stdout (the only supported transport)")
	command.Flags().BoolVar(&readOnly, "read-only", false,
		"serve the bounded read-only MCP profile: search, get_subject, list_recent, read_text_extract; "+
			"a read-only token is required and no write, plan, apply, verify, delete, or configuration tool exists")
	command.Flags().StringVar(&readTokenEnv, "read-token-env", mcp.ReadOnlyTokenEnvVar,
		"environment variable holding the read-only MCP token (never logged or echoed)")
	return command.Command
}

// runReadOnlyMCP serves the four-tool read-only surface over stdio against the
// local daemon socket. The read-only token is resolved from the named
// environment variable; its value is never printed, logged, or echoed.
func runReadOnlyMCP(cmd *cobra.Command, env *clientEnv, readTokenEnv string) int {
	if err := mcp.ValidateLocalSocketPath(env.socket); err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "%v\n", err)
		return 2
	}
	token, err := mcp.ResolveReadOnlyToken(func(name string) string {
		if name == mcp.ReadOnlyTokenEnvVar && readTokenEnv != "" {
			return os.Getenv(readTokenEnv)
		}
		return os.Getenv(name)
	})
	if err != nil {
		// The error names the variable and the requirement, never the value.
		fmt.Fprintf(cmd.ErrOrStderr(), "read-only MCP token refused: %v\n", err)
		return 2
	}
	if !token.Configured() {
		fmt.Fprintf(cmd.ErrOrStderr(),
			"read-only MCP surface has no configured read token (%s); every tool call will be refused\n", readTokenEnv)
	}
	dialCtx, cancelDial := context.WithTimeout(cmd.Context(), env.timeout)
	conn, err := transport.DialContext(dialCtx, env.socket)
	cancelDial()
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "cannot reach cairnd at %s: %v\n", env.socket, err)
		return 1
	}
	defer conn.Close()
	server, err := mcp.NewReadOnly(conn, mcp.ReadOnlyOptions{Token: token})
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "read-only mcp server: %v\n", err)
		return 2
	}
	if err := server.Run(cmd.Context(), &mcpsdk.StdioTransport{}); err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "read-only mcp server: %v\n", err)
		return 1
	}
	return 0
}
