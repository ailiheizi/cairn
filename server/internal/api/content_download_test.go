package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ailiheizi/restoreweave/client/command"
)

type downloadTestDispatcher struct {
	mu                   sync.Mutex
	content              []byte
	opens                int
	reads                int
	closes               int
	closed               map[string]bool
	cancelled            bool
	corruptEmptyIdentity bool
	mutateSecondPass     bool
}

func (d *downloadTestDispatcher) Handle(ctx context.Context, env command.Envelope) command.Result {
	var data any
	status := command.StatusSucceeded
	var input map[string]any
	_ = json.Unmarshal(env.Input, &input)
	d.mu.Lock()
	defer d.mu.Unlock()
	switch env.Operation {
	case command.OpContentOpen:
		d.opens++
		sum := sha256.Sum256(d.content)
		if d.corruptEmptyIdentity && len(d.content) == 0 {
			sum = sha256.Sum256([]byte("not-empty"))
		}
		data = command.ContentOpenData{Handle: fmt.Sprintf("hdl_%d", d.opens), EntryID: "entry_test", ContentID: "sha256:" + hex.EncodeToString(sum[:]), LogicalSize: int64(len(d.content)), MaxRead: downloadChunkLimit}
	case command.OpContentRead:
		d.reads++
		if d.cancelled || ctx.Err() != nil {
			status = command.StatusCancelled
			break
		}
		offset := int(input["offset"].(float64))
		length := int(input["length"].(float64))
		end := offset + length
		if end > len(d.content) {
			end = len(d.content)
		}
		payload := append([]byte(nil), d.content[offset:end]...)
		if d.mutateSecondPass && d.opens >= 2 && offset > 0 && len(payload) > 0 {
			payload[0] ^= 0xff
		}
		data = command.ContentReadData{Handle: input["handle"].(string), Offset: int64(offset), Length: int64(len(payload)), Bytes: payload, EOF: end >= len(d.content)}
	case command.OpContentClose:
		d.closes++
		if d.closed == nil {
			d.closed = map[string]bool{}
		}
		d.closed[input["handle"].(string)] = true
		data = command.ContentCloseData{Handle: input["handle"].(string), Closed: true}
	default:
		status = command.StatusFailed
	}
	return command.NewResult(env, status, time.Unix(0, 0), time.Unix(0, 0), data)
}

func TestContentDownloadStreamsExactBytesThroughScopedSession(t *testing.T) {
	for _, size := range []int{0, 73, downloadChunkLimit + 113} {
		t.Run(fmt.Sprintf("size_%d", size), func(t *testing.T) {
			payload := make([]byte, size)
			for index := range payload {
				payload[index] = byte((index*31 + index/7) % 251)
			}
			dispatcher := &downloadTestDispatcher{content: payload}
			handler := Handler(dispatcher.Handle, Options{})
			server := httptest.NewServer(handler)
			defer server.Close()
			query := url.Values{"workspace_id": {"workspace_test"}, "entry_id": {"entry_test"}, "filename": {"original.bin"}}
			response, err := server.Client().Get(server.URL + "/api/v1/download?" + query.Encode())
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK || response.Header.Get("Content-Disposition") != `attachment; filename=original.bin` {
				t.Fatalf("response status=%d headers=%v", response.StatusCode, response.Header)
			}
			if response.ContentLength != int64(size) {
				t.Fatalf("content length=%d want=%d", response.ContentLength, size)
			}
			got, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != string(payload) {
				t.Fatalf("downloaded %d bytes, want %d", len(got), len(payload))
			}
			dispatcher.mu.Lock()
			defer dispatcher.mu.Unlock()
			if dispatcher.opens != 2 || dispatcher.closes != 2 || len(dispatcher.closed) != 2 {
				t.Fatalf("session lifecycle: opens=%d closes=%d closed=%v", dispatcher.opens, dispatcher.closes, dispatcher.closed)
			}
			if size > downloadChunkLimit && dispatcher.reads < 4 {
				t.Fatalf("large transfer did not perform bounded verify+stream passes: reads=%d", dispatcher.reads)
			}
		})
	}
}

func TestContentDownloadTokenAndQueryAreScoped(t *testing.T) {
	dispatcher := &downloadTestDispatcher{content: []byte("exact")}
	handler := Handler(dispatcher.Handle, Options{Token: "secret"})
	for _, test := range []struct {
		name, path, token string
		want              int
	}{
		{name: "missing token", path: "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test", want: http.StatusUnauthorized},
		{name: "host path parameter", path: "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test&path=/etc/passwd", token: "secret", want: http.StatusBadRequest},
		{name: "duplicate entry", path: "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test&entry_id=other", token: "secret", want: http.StatusBadRequest},
		{name: "unsafe filename", path: "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test&filename=..%2Fsecret", token: "secret", want: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.token != "" {
				req.Header.Set("Authorization", "Bearer "+test.token)
			}
			resp := httptest.NewRecorder()
			handler.ServeHTTP(resp, req)
			if resp.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", resp.Code, test.want, resp.Body.String())
			}
		})
	}
	if dispatcher.opens != 0 {
		t.Fatalf("invalid/unauthorized requests opened content %d times", dispatcher.opens)
	}
}

func TestContentDownloadRejectsIntegrityFailureBeforeAttachment(t *testing.T) {
	dispatcher := &downloadTestDispatcher{content: []byte("good")}
	handler := Handler(func(ctx context.Context, env command.Envelope) command.Result {
		result := dispatcher.Handle(ctx, env)
		if env.Operation == command.OpContentRead {
			var read command.ContentReadData
			_ = json.Unmarshal(result.Data, &read)
			read.Bytes = []byte(strings.Repeat("x", len(read.Bytes)))
			result.Data, _ = json.Marshal(read)
		}
		return result
	}, Options{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnprocessableEntity || strings.Contains(resp.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("integrity failure status=%d headers=%v body=%s", resp.Code, resp.Header(), resp.Body.String())
	}
	dispatcher.mu.Lock()
	defer dispatcher.mu.Unlock()
	if dispatcher.closes != 1 || len(dispatcher.closed) != 1 {
		t.Fatalf("preflight failure leaked handle: closes=%d closed=%v", dispatcher.closes, dispatcher.closed)
	}
}

func TestContentDownloadRejectsCorruptEmptyIdentityBeforeAttachment(t *testing.T) {
	dispatcher := &downloadTestDispatcher{corruptEmptyIdentity: true}
	handler := Handler(dispatcher.Handle, Options{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test&filename=empty.bin", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnprocessableEntity || resp.Header().Get("Content-Disposition") != "" {
		t.Fatalf("corrupt empty content status=%d headers=%v body=%s", resp.Code, resp.Header(), resp.Body.String())
	}
	var failure map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &failure); err != nil || failure["status"] == string(command.StatusSucceeded) {
		t.Fatalf("integrity error was mislabeled as a successful command: %s err=%v", resp.Body.String(), err)
	}
}

func TestContentDownloadLateIntegrityFailureAbortsIncompleteBody(t *testing.T) {
	payload := make([]byte, downloadChunkLimit+17)
	for index := range payload {
		payload[index] = byte(index % 251)
	}
	dispatcher := &downloadTestDispatcher{content: payload, mutateSecondPass: true}
	server := httptest.NewServer(Handler(dispatcher.Handle, Options{}))
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test&filename=large.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength != int64(len(payload)) {
		t.Fatalf("late-failure headers status=%d content-length=%d", response.StatusCode, response.ContentLength)
	}
	got, readErr := io.ReadAll(response.Body)
	if readErr == nil || int64(len(got)) >= int64(len(payload)) {
		t.Fatalf("late failure appeared complete: downloaded=%d want-less-than=%d err=%v", len(got), len(payload), readErr)
	}
}

func TestContentDownloadHonorsRequestCancellationAndClosesHandle(t *testing.T) {
	dispatcher := &downloadTestDispatcher{content: []byte("cancel me"), cancelled: true}
	handler := Handler(dispatcher.Handle, Options{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/download?workspace_id=workspace_test&entry_id=entry_test", nil).WithContext(ctx)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusRequestTimeout {
		t.Fatalf("cancel status=%d body=%s", resp.Code, resp.Body.String())
	}
	dispatcher.mu.Lock()
	defer dispatcher.mu.Unlock()
	if dispatcher.closes != 1 || len(dispatcher.closed) != 1 {
		t.Fatalf("cancelled download leaked handle: closes=%d closed=%v", dispatcher.closes, dispatcher.closed)
	}
}
