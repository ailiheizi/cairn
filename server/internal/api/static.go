package api

import (
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
)

// HandlerWithStatic preserves API precedence while optionally serving a
// pre-built WebUI from one loopback listener.
func HandlerWithStatic(dispatch DispatchFunc, options Options, webRoot string) (http.Handler, error) {
	apiHandler := Handler(dispatch, options)
	if strings.TrimSpace(webRoot) == "" {
		return apiHandler, nil
	}
	staticHandler, err := NewStaticHandler(webRoot)
	if err != nil {
		return nil, err
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1" || strings.HasPrefix(r.URL.Path, "/api/v1/") {
			apiHandler.ServeHTTP(w, r)
			return
		}
		staticHandler.ServeHTTP(w, r)
	}), nil
}

// staticSnapshot is one fully validated in-memory copy of the WebUI root.
type staticSnapshot struct {
	assets map[string][]byte
	index  []byte
	stamp  string
}

// NewStaticHandler serves a pre-built WebUI from one validated in-memory
// snapshot, reassembled whenever the root changes on disk.
//
// The snapshot still exists, and for the original reason: every asset is read
// and checked up front, so a request never observes a half-written file. A tree
// that fails validation (a symlink, a non-regular entry, an unsafe relative
// path) is refused rather than served.
//
// What changed is the lifetime of the snapshot. It used to be taken once at
// startup and kept forever, so a rebuilt WebUI was invisible until the daemon
// restarted while the retired hashed assets kept answering 200 — a silent
// staleness that made every frontend change look like it never landed. The
// snapshot is now rebuilt when the root's immediate children change. A root
// that fails revalidation is never served: the last validated snapshot stays in
// place, so a hostile or broken replacement degrades to the previous verified
// content instead of unverified bytes.
func NewStaticHandler(root string) (http.Handler, error) {
	root = strings.TrimSpace(root)
	if root == "" || !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return nil, errors.New("web root must be an absolute canonical path")
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("web root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, errors.New("web root must be a regular non-symlink directory")
	}
	initial, err := loadStaticSnapshot(root)
	if err != nil {
		return nil, err
	}
	var current atomic.Pointer[staticSnapshot]
	current.Store(initial)
	// Serializes reloads so concurrent requests cannot each walk the tree.
	var reload sync.Mutex
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		snapshot := current.Load()
		if stamp, ok := staticStamp(root); ok && stamp != snapshot.stamp {
			reload.Lock()
			snapshot = current.Load()
			if stamp, ok := staticStamp(root); ok && stamp != snapshot.stamp {
				if next, err := loadStaticSnapshot(root); err == nil {
					current.Store(next)
					snapshot = next
				}
			}
			reload.Unlock()
		}
		escaped := r.URL.EscapedPath()
		decoded, err := urlPathFromEscaped(escaped)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if body, ok := snapshot.assets[decoded]; ok {
			writeStaticResponse(w, r, decoded, body)
			return
		}
		// Client-side routes have no extension; file/asset misses stay 404.
		if path.Ext(decoded) == "" {
			writeStaticResponse(w, r, "/index.html", snapshot.index)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}), nil
}

// staticStamp summarizes the root's immediate children so a rebuilt tree is
// noticed without re-reading every asset. A Vite build rewrites index.html and
// replaces the entries inside assets/, so the child set, a modification time,
// or a size changes; entry names participate so a replacement that only
// renames files is still detected.
func staticStamp(root string) (string, bool) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return "", false
	}
	var b strings.Builder
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return "", false
		}
		fmt.Fprintf(&b, "%s\x00%d\x00%d\x00%v\n", entry.Name(), info.ModTime().UnixNano(), info.Size(), info.Mode().Type())
	}
	return b.String(), true
}

// loadStaticSnapshot reads and validates the whole tree. Every entry must be a
// regular file reachable through a relative, non-symlink path.
func loadStaticSnapshot(root string) (*staticSnapshot, error) {
	assets := make(map[string][]byte)
	var index []byte
	err := filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if filePath == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("web root contains symlink %q", filePath)
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("web root contains non-regular asset %q", filePath)
		}
		rel, err := filepath.Rel(root, filePath)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "." || strings.HasPrefix(rel, "../") || strings.Contains(rel, "\\") || strings.ContainsFunc(rel, unicode.IsControl) {
			return fmt.Errorf("unsafe web asset path %q", rel)
		}
		body, err := os.ReadFile(filePath)
		if err != nil {
			return err
		}
		urlPath := "/" + rel
		assets[urlPath] = body
		if rel == "index.html" {
			index = body
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if index == nil {
		return nil, errors.New("web root is missing regular index.html")
	}
	stamp, ok := staticStamp(root)
	if !ok {
		return nil, errors.New("web root is not readable after loading")
	}
	return &staticSnapshot{assets: assets, index: index, stamp: stamp}, nil
}

func writeStaticResponse(w http.ResponseWriter, r *http.Request, name string, body []byte) {
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = http.DetectContentType(body)
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprint(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

func urlPathFromEscaped(escaped string) (string, error) {
	if escaped == "" {
		escaped = "/"
	}
	decoded, err := (&urlUnescaper{}).Unescape(escaped)
	if err != nil || decoded == "" || !strings.HasPrefix(decoded, "/") || strings.Contains(decoded, "\\") || strings.ContainsFunc(decoded, unicode.IsControl) {
		return "", errors.New("unsafe web URL path")
	}
	clean := path.Clean(decoded)
	if clean != decoded || strings.Contains(decoded, "/../") || strings.HasSuffix(decoded, "/..") || strings.HasPrefix(decoded, "/../") {
		return "", errors.New("web URL path escapes root")
	}
	return clean, nil
}

// Small indirection keeps URL unescaping testable without exposing another API.
type urlUnescaper struct{}

func (*urlUnescaper) Unescape(value string) (string, error) {
	var out strings.Builder
	for i := 0; i < len(value); i++ {
		if value[i] != '%' {
			out.WriteByte(value[i])
			continue
		}
		if i+2 >= len(value) {
			return "", errors.New("incomplete URL escape")
		}
		var b byte
		for _, c := range []byte{value[i+1], value[i+2]} {
			b <<= 4
			switch {
			case c >= '0' && c <= '9':
				b |= c - '0'
			case c >= 'a' && c <= 'f':
				b |= c - 'a' + 10
			case c >= 'A' && c <= 'F':
				b |= c - 'A' + 10
			default:
				return "", errors.New("invalid URL escape")
			}
		}
		out.WriteByte(b)
		i += 2
	}
	return out.String(), nil
}
