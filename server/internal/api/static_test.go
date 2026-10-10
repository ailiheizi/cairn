package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
)

func TestHandlerWithStaticServesSnapshotAndPreservesAPI(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("INDEX"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.js"), []byte("ASSET"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "styles.css"), []byte("body{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	handler, err := HandlerWithStatic(func(_ context.Context, _ command.Envelope) command.Result {
		return command.Result{Status: command.StatusSucceeded}
	}, Options{}, root)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		method, path string
		status       int
		body         string
	}{
		{http.MethodGet, "/", http.StatusOK, "INDEX"}, {http.MethodHead, "/app.js", http.StatusOK, ""},
		{http.MethodGet, "/app.js", http.StatusOK, "ASSET"}, {http.MethodGet, "/styles.css", http.StatusOK, "body{}"}, {http.MethodGet, "/settings/profile", http.StatusOK, "INDEX"},
		{http.MethodGet, "/missing.js", http.StatusNotFound, ""}, {http.MethodPost, "/", http.StatusMethodNotAllowed, ""},
		{http.MethodGet, "/api/v1", http.StatusNotFound, "not found"}, {http.MethodGet, "/api/v1/", http.StatusNotFound, "endpoint not found"}, {http.MethodGet, "/api/v1/healthz", http.StatusOK, "\"status\":\"ok\""}, {http.MethodPost, "/api/v1/command", http.StatusBadRequest, "valid JSON"},
	}
	for _, test := range []struct {
		path, contentType string
		length            int
	}{{"/", "text/html; charset=utf-8", 5}, {"/app.js", "text/javascript; charset=utf-8", 5}, {"/styles.css", "text/css; charset=utf-8", 6}} {
		get := httptest.NewRecorder()
		handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "http://loopback"+test.path, nil))
		head := httptest.NewRecorder()
		handler.ServeHTTP(head, httptest.NewRequest(http.MethodHead, "http://loopback"+test.path, nil))
		if get.Header().Get("Content-Type") != test.contentType || head.Header().Get("Content-Type") != test.contentType || head.Header().Get("Content-Length") != fmt.Sprint(test.length) || head.Body.Len() != 0 {
			t.Errorf("headers %s: GET=%v HEAD=%v body=%q", test.path, get.Header(), head.Header(), head.Body.String())
		}
	}
	for _, test := range tests {
		req := httptest.NewRequest(test.method, "http://loopback"+test.path, nil)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != test.status || (test.body != "" && !strings.Contains(res.Body.String(), test.body)) {
			t.Errorf("%s %s = %d %q, want %d containing %q", test.method, test.path, res.Code, res.Body.String(), test.status, test.body)
		}
	}
	for _, encoded := range []string{"/%2e%2e/index.html", "/..%2findex.html", "/%5cetc%5cpasswd", "/%00bad"} {
		req := httptest.NewRequest(http.MethodGet, "http://loopback"+encoded, nil)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusNotFound {
			t.Errorf("unsafe path %s = %d, want 404", encoded, res.Code)
		}
	}
}

func TestNewStaticHandlerRejectsUnsafeRootsAndAssets(t *testing.T) {
	if _, err := NewStaticHandler("relative"); err == nil {
		t.Fatal("relative root accepted")
	}
	missing := filepath.Join(t.TempDir(), "missing")
	if _, err := NewStaticHandler(missing); err == nil {
		t.Fatal("missing root accepted")
	}
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStaticHandler(file); err == nil {
		t.Fatal("file root accepted")
	}
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(target, "index.html"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "root-link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStaticHandler(link); err == nil {
		t.Fatal("symlink root accepted")
	}
	assetLink := filepath.Join(target, "app.js")
	if err := os.Symlink(filepath.Join(target, "index.html"), assetLink); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStaticHandler(target); err == nil {
		t.Fatal("symlink asset accepted")
	}
	noIndex := t.TempDir()
	if err := os.WriteFile(filepath.Join(noIndex, "app.js"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStaticHandler(noIndex); err == nil {
		t.Fatal("missing index accepted")
	}
}

// A rebuilt WebUI must reach the browser without restarting the daemon. The
// startup snapshot used to stay in place forever, so a new build was invisible
// while the retired hashed asset kept answering 200.
func TestStaticHandlerServesRebuiltRootWithoutRestart(t *testing.T) {
	root := t.TempDir()
	writeFile := func(name, body string) {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeFile("index.html", "INDEX-1")
	writeFile("app.js", "ASSET-1")
	handler, err := NewStaticHandler(root)
	if err != nil {
		t.Fatal(err)
	}
	get := func(target string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "http://loopback"+target, nil))
		return res
	}
	if body := get("/app.js").Body.String(); body != "ASSET-1" {
		t.Fatalf("initial asset = %q, want ASSET-1", body)
	}
	// A production rebuild retires the old hashed asset and writes a new one.
	if err := os.Remove(filepath.Join(root, "app.js")); err != nil {
		t.Fatal(err)
	}
	writeFile("index.html", "INDEX-2")
	writeFile("app-2.js", "ASSET-2")
	if res := get("/app-2.js"); res.Code != http.StatusOK || res.Body.String() != "ASSET-2" {
		t.Fatalf("rebuilt asset = %d %q, want 200 ASSET-2", res.Code, res.Body.String())
	}
	if body := get("/").Body.String(); body != "INDEX-2" {
		t.Fatalf("rebuilt index = %q, want INDEX-2", body)
	}
	if res := get("/app.js"); res.Code != http.StatusNotFound {
		t.Fatalf("retired asset = %d, want 404", res.Code)
	}
}

// A replacement that fails validation is never served: the last validated
// snapshot stays in place rather than unverified bytes.
func TestStaticHandlerKeepsLastValidatedSnapshotOnInvalidRebuild(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("INDEX"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.js"), []byte("ASSET"), 0o600); err != nil {
		t.Fatal(err)
	}
	handler, err := NewStaticHandler(root)
	if err != nil {
		t.Fatal(err)
	}
	get := func(target string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "http://loopback"+target, nil))
		return res
	}
	if body := get("/app.js").Body.String(); body != "ASSET" {
		t.Fatalf("initial asset = %q, want ASSET", body)
	}
	if err := os.Symlink(filepath.Join(root, "index.html"), filepath.Join(root, "evil.js")); err != nil {
		t.Fatal(err)
	}
	if res := get("/evil.js"); res.Code != http.StatusNotFound {
		t.Fatalf("symlink asset = %d, want 404 from the last validated snapshot", res.Code)
	}
	if body := get("/app.js").Body.String(); body != "ASSET" {
		t.Fatalf("validated asset after an invalid rebuild = %q, want ASSET", body)
	}
}

func TestHandlerWithStaticDisabledMatchesAPI(t *testing.T) {
	handler, err := HandlerWithStatic(nil, Options{}, "")
	if err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "http://loopback/", nil))
	if res.Code != http.StatusInternalServerError {
		t.Fatalf("disabled static root status = %d", res.Code)
	}
}
