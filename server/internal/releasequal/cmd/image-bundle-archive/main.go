// Command image-bundle-archive packages one admitted image bundle into a
// deterministic transport archive. It is a development and release tool, not a
// downloader: the source bundle root must already be admitted, and the archive
// carries exactly the descriptor and the assets that descriptor declares.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ailiheizi/restoreweave/server/internal/search"
)

func main() {
	flags := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	source := flags.String("source", "", "absolute admitted image bundle root")
	output := flags.String("output", "", "absolute archive path to create (.tar.gz)")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if err == flag.ErrHelp {
			os.Exit(0)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if !filepath.IsAbs(*source) || !filepath.IsAbs(*output) || strings.TrimSpace(*source) == "" || strings.TrimSpace(*output) == "" {
		fmt.Fprintln(os.Stderr, "error: --source and --output must be absolute paths")
		os.Exit(2)
	}
	path, archive, err := search.PackageImageBundleArchive(context.Background(), *output, *source)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	fmt.Printf("archive: %s\nbytes:   %d\n", path, len(archive))
}
