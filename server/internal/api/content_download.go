package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/ailiheizi/restoreweave/client/command"
)

const downloadChunkLimit = 1 << 20

type downloadQuery struct {
	workspaceID string
	entryID     string
	filename    string
}

func serveContentDownload(w http.ResponseWriter, r *http.Request, dispatch DispatchFunc) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "download requires GET")
		return
	}
	query, err := parseDownloadQuery(r.URL.RawQuery)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()
	opened, result, err := openDownload(ctx, dispatch, query)
	if err != nil {
		writeDispatchFailure(w, result, err)
		return
	}
	if err := validateDownloadOpen(opened); err != nil {
		closeContent(ctx, dispatch, opened.Handle)
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if opened.EntryID != query.entryID {
		closeContent(ctx, dispatch, opened.Handle)
		writeError(w, http.StatusUnprocessableEntity, "opened content did not match the requested snapshot entry")
		return
	}
	if verifyResult, err := verifyDownloadHandle(ctx, dispatch, opened); err != nil {
		closeContent(ctx, dispatch, opened.Handle)
		writeDispatchFailure(w, verifyResult, err)
		return
	}
	closeContent(ctx, dispatch, opened.Handle)

	// The first pass authenticates the complete immutable logical byte stream
	// before the transport marks this response as an attachment. The second pass
	// streams bounded reads to the browser and checks the same identity again.
	streamed, result, err := openDownload(ctx, dispatch, query)
	if err != nil {
		writeDispatchFailure(w, result, err)
		return
	}
	defer closeContent(ctx, dispatch, streamed.Handle)
	if err := validateDownloadOpen(streamed); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if streamed.EntryID != opened.EntryID || streamed.ContentID != opened.ContentID || streamed.LogicalSize != opened.LogicalSize || streamed.MaxRead != opened.MaxRead {
		writeError(w, http.StatusUnprocessableEntity, "content changed between verification and download")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming downloads are unavailable on this connection")
		return
	}
	filename := query.filename
	if filename == "" {
		filename = "download.bin"
	}
	contentDisposition := mime.FormatMediaType("attachment", map[string]string{"filename": filename})
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", contentDisposition)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", fmt.Sprint(streamed.LogicalSize))
	hash := sha256.New()
	var total int64
	var pending []byte
	for offset := int64(0); offset < streamed.LogicalSize; {
		read, _, readErr := readDownloadChunk(ctx, dispatch, streamed, offset)
		if readErr != nil {
			abortDownload(w)
			return
		}
		if len(read.Bytes) == 0 || int64(len(read.Bytes)) > streamed.MaxRead || offset+int64(len(read.Bytes)) > streamed.LogicalSize {
			abortDownload(w)
			return
		}
		_, _ = hash.Write(read.Bytes)
		total += int64(len(read.Bytes))
		if pending != nil {
			if _, err := w.Write(pending); err != nil {
				return
			}
			flusher.Flush()
		}
		pending = read.Bytes
		offset += int64(len(read.Bytes))
	}
	if total != streamed.LogicalSize || hex.EncodeToString(hash.Sum(nil)) != strings.TrimPrefix(streamed.ContentID, "sha256:") {
		abortDownload(w)
		return
	}
	if len(pending) > 0 {
		if _, err := w.Write(pending); err != nil {
			return
		}
		flusher.Flush()
	}
}

func parseDownloadQuery(raw string) (downloadQuery, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return downloadQuery{}, errors.New("invalid download query")
	}
	for key, entries := range values {
		if key != "workspace_id" && key != "entry_id" && key != "filename" {
			return downloadQuery{}, fmt.Errorf("unsupported download parameter %q", key)
		}
		if len(entries) != 1 {
			return downloadQuery{}, fmt.Errorf("download parameter %q must appear once", key)
		}
	}
	query := downloadQuery{
		workspaceID: strings.TrimSpace(values.Get("workspace_id")),
		entryID:     strings.TrimSpace(values.Get("entry_id")),
		filename:    values.Get("filename"),
	}
	if query.workspaceID == "" || query.entryID == "" {
		return downloadQuery{}, errors.New("workspace_id and entry_id are required")
	}
	if query.filename != "" && !safeDownloadFilename(query.filename) {
		return downloadQuery{}, errors.New("filename must be one safe presentation name")
	}
	return query, nil
}

func safeDownloadFilename(value string) bool {
	if value == "." || value == ".." || path.Base(value) != value || strings.ContainsAny(value, "/\\") {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return false
		}
	}
	return strings.TrimSpace(value) != ""
}

func openDownload(ctx context.Context, dispatch DispatchFunc, query downloadQuery) (command.ContentOpenData, command.Result, error) {
	result := dispatch(ctx, downloadEnvelope(command.OpContentOpen, map[string]any{
		"workspace_id": query.workspaceID,
		"entry_id":     query.entryID,
	}))
	if !successfulContentResult(result) {
		return command.ContentOpenData{}, result, errors.New("content.open failed")
	}
	var data command.ContentOpenData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		return command.ContentOpenData{}, result, fmt.Errorf("decode content.open result: %w", err)
	}
	return data, result, nil
}

func validateDownloadOpen(data command.ContentOpenData) error {
	if data.Handle == "" || data.EntryID == "" {
		return errors.New("content.open returned an incomplete handle")
	}
	if data.LogicalSize < 0 || data.MaxRead <= 0 || data.MaxRead > downloadChunkLimit {
		return errors.New("content.open returned an invalid size or read limit")
	}
	prefix, digest, ok := strings.Cut(data.ContentID, ":")
	if !ok || prefix != "sha256" || len(digest) != sha256.Size*2 {
		return errors.New("content.open did not select an exact SHA-256 representation")
	}
	decoded, err := hex.DecodeString(digest)
	if err != nil || hex.EncodeToString(decoded) != digest {
		return errors.New("content.open did not select an exact SHA-256 representation")
	}
	return nil
}

func verifyDownloadHandle(ctx context.Context, dispatch DispatchFunc, opened command.ContentOpenData) (command.Result, error) {
	hash := sha256.New()
	var total int64
	for {
		read, result, err := readDownloadChunk(ctx, dispatch, opened, total)
		if err != nil {
			return result, err
		}
		if int64(len(read.Bytes)) > opened.MaxRead || total+int64(len(read.Bytes)) > opened.LogicalSize {
			return command.Result{}, errors.New("content.read exceeded the opened byte range")
		}
		_, _ = hash.Write(read.Bytes)
		total += int64(len(read.Bytes))
		if read.EOF {
			break
		}
		if len(read.Bytes) == 0 || total >= opened.LogicalSize {
			return command.Result{}, errors.New("content.read ended before the complete exact content was verified")
		}
	}
	if total != opened.LogicalSize {
		return command.Result{}, errors.New("content length did not match its exact identity")
	}
	want := strings.TrimPrefix(opened.ContentID, "sha256:")
	if hex.EncodeToString(hash.Sum(nil)) != want {
		return command.Result{}, errors.New("content SHA-256 did not match its exact identity")
	}
	return command.Result{}, nil
}

func readDownloadChunk(ctx context.Context, dispatch DispatchFunc, opened command.ContentOpenData, offset int64) (command.ContentReadData, command.Result, error) {
	length := opened.MaxRead
	remaining := opened.LogicalSize - offset
	if remaining < 0 {
		return command.ContentReadData{}, command.Result{}, errors.New("content read offset exceeds logical length")
	}
	if length > remaining {
		length = remaining
	}
	result := dispatch(ctx, downloadEnvelope(command.OpContentRead, map[string]any{
		"handle": opened.Handle,
		"offset": offset,
		"length": length,
	}))
	if !successfulContentResult(result) {
		return command.ContentReadData{}, result, errors.New("content.read failed")
	}
	var data command.ContentReadData
	if err := json.Unmarshal(result.Data, &data); err != nil {
		return command.ContentReadData{}, result, fmt.Errorf("decode content.read result: %w", err)
	}
	if data.Handle != opened.Handle || data.Offset != offset || int64(len(data.Bytes)) != data.Length || data.Length > length {
		return command.ContentReadData{}, result, errors.New("content.read returned an invalid byte range")
	}
	if data.EOF != (offset+data.Length >= opened.LogicalSize) {
		return command.ContentReadData{}, result, errors.New("content.read returned an invalid end-of-file marker")
	}
	return data, result, nil
}

func successfulContentResult(result command.Result) bool {
	return result.Status == command.StatusSucceeded || result.Status == command.StatusDegraded
}

func closeContent(ctx context.Context, dispatch DispatchFunc, handle string) {
	if handle == "" {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	dispatch(cleanupCtx, downloadEnvelope(command.OpContentClose, map[string]string{"handle": handle}))
}

func downloadEnvelope(operation string, input any) command.Envelope {
	payload, _ := json.Marshal(input)
	return command.Envelope{Operation: operation, Input: payload}
}

func writeDispatchFailure(w http.ResponseWriter, result command.Result, err error) {
	if result.Status == command.StatusFailed || result.Status == command.StatusBlocked || result.Status == command.StatusCancelled {
		status := http.StatusUnprocessableEntity
		if result.Status == command.StatusCancelled {
			status = http.StatusRequestTimeout
		}
		writeJSON(w, status, result)
		return
	}
	writeError(w, http.StatusUnprocessableEntity, err.Error())
}

func abortDownload(w http.ResponseWriter) {
	// net/http turns ErrAbortHandler into an incomplete response: browsers
	// cannot mistake a truncated chunked download for a completed attachment.
	panic(http.ErrAbortHandler)
}
