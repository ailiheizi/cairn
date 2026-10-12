package main

import (
	"fmt"
	"os"
	"runtime/debug"
	"strings"
)

// buildVersion is injected at build time with
// -ldflags "-X main.buildVersion=<version>". An unreplaced build reports the
// module version Go stamped into the binary.
var buildVersion string

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Printf("cairn %s\n", buildVersionInfo())
		return
	}
	root := NewRootCommand()
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
	os.Exit(root.Code())
}

// buildVersionInfo prefers the injected release token and otherwise falls back
// to the build metadata Go records, including the VCS revision when the build
// host had one.
func buildVersionInfo() string {
	if value := strings.TrimSpace(buildVersion); value != "" {
		return value
	}
	info, ok := debug.ReadBuildInfo()
	if !ok || info == nil {
		return "unknown"
	}
	version := strings.TrimSpace(info.Main.Version)
	if version == "" || version == "(devel)" {
		version = "devel"
	}
	// Go itself appends "+dirty" when the build host had uncommitted changes.
	// That is not the same fact as the installed build identity, so keep only
	// the base version and add the revision marker below.
	version = strings.TrimSuffix(version, "+dirty")
	revision := ""
	modified := ""
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			modified = setting.Value
		}
	}
	if revision == "" {
		return version
	}
	short := revision
	if len(short) > 12 {
		short = short[:12]
	}
	if modified == "true" {
		return version + "+" + short + ".dirty"
	}
	return version + "+" + short
}
