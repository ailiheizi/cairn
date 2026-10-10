//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd

package search

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestOpenBundleFileNoFollowConcurrentNestedOpensPreserveBorrowedDescriptors(t *testing.T) {
	root := t.TempDir()
	assetPath := filepath.Join(root, "runtime", "darwin-arm64", "lib", "model.onnx")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0o700); err != nil {
		t.Fatal(err)
	}
	asset := []byte("nested semantic bundle asset")
	if err := os.WriteFile(assetPath, asset, 0o600); err != nil {
		t.Fatal(err)
	}

	const sentinelWorkers = 4
	const sentinelIterations = 3000
	sentinelRoot := filepath.Join(root, "sentinels")
	if err := os.Mkdir(sentinelRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	sentinels := make([][]byte, sentinelWorkers*sentinelIterations)
	for i := range sentinels {
		sentinels[i] = []byte(fmt.Sprintf("borrowed-fd-sentinel-%08d", i))
		if err := os.WriteFile(filepath.Join(sentinelRoot, fmt.Sprintf("%08d", i)), sentinels[i], 0o600); err != nil {
			t.Fatal(err)
		}
	}

	const assetWorkers = 24
	const assetIterations = 1000
	start := make(chan struct{})
	errors := make(chan error, 1)
	report := func(err error) {
		select {
		case errors <- err:
		default:
		}
	}
	var workers sync.WaitGroup
	for worker := 0; worker < assetWorkers; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for i := 0; i < assetIterations; i++ {
				file, err := openBundleFileNoFollow(root, "runtime/darwin-arm64/lib/model.onnx")
				if err != nil {
					report(fmt.Errorf("open bundle asset: %w", err))
					return
				}
				got, readErr := io.ReadAll(file)
				closeErr := file.Close()
				if readErr != nil || closeErr != nil || !bytes.Equal(got, asset) {
					report(fmt.Errorf("bundle asset read failed: read=%v close=%v bytes_match=%t", readErr, closeErr, bytes.Equal(got, asset)))
					return
				}
			}
		}()
	}
	for worker := 0; worker < sentinelWorkers; worker++ {
		worker := worker
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for i := 0; i < sentinelIterations; i++ {
				index := worker*sentinelIterations + i
				path := filepath.Join(sentinelRoot, fmt.Sprintf("%08d", index))
				file, err := os.Open(path)
				if err != nil {
					report(fmt.Errorf("open borrowed descriptor sentinel %d: %w", index, err))
					return
				}
				got, readErr := io.ReadAll(file)
				closeErr := file.Close()
				if readErr != nil || closeErr != nil || !bytes.Equal(got, sentinels[index]) {
					report(fmt.Errorf("borrowed descriptor sentinel %d was invalidated: read=%v close=%v bytes_match=%t", index, readErr, closeErr, bytes.Equal(got, sentinels[index])))
					return
				}
			}
		}()
	}
	close(start)
	workers.Wait()
	select {
	case err := <-errors:
		t.Fatal(err)
	default:
	}
}
