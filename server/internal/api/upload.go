package api

import (
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/ailiheizi/cairn/client/command"
)

// UploadStaging is the daemon-owned staging policy behind POST /api/v1/upload.
// The adapter owns multipart framing only; bounds, name handling, and
// placement are entirely the staging session's decisions, so the adapter adds
// no second policy, job, catalog, or recovery state machine.
type UploadStaging interface {
	BeginUploadSession() (UploadSession, error)
}

// UploadSession is one request-scoped staging session. Stage streams one file
// part into the inbox; Refusal reports a sticky request-level refusal after
// which the caller must Rollback; Finish reports every per-file outcome.
// DrainRemainder bounds discarded payload before the next part. A nonempty
// reason or error requires rollback without advancing the multipart reader.
type UploadSession interface {
	Stage(fileName string, content io.Reader) command.UploadFileResult
	DrainRemainder(content io.Reader) (reason string, err error)
	Refusal() string
	Rollback()
	Finish() command.UploadResult
}

// RelativeUploadSession is an optional extension for sessions that can stage
// safe, hierarchy-preserving paths. Callers must refuse the request rather
// than flattening relative_files when a session does not implement it.
type RelativeUploadSession interface {
	StageRelative(relativePath string, content io.Reader) command.UploadFileResult
}

// serveUpload streams a multipart/form-data upload into the daemon's staging
// session. The adapter never buffers a file: each part is handed to the
// session as a stream. A skipped part's remainder is drained only within the
// daemon-owned per-file bound; a sticky or drain-limit refusal rolls back and
// stops parsing without an unbounded multipart drain.
func serveUpload(w http.ResponseWriter, r *http.Request, stager UploadStaging) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "upload requires POST")
		return
	}
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") || strings.TrimSpace(params["boundary"]) == "" {
		writeUploadError(w, http.StatusBadRequest, command.UploadReasonMalformed, "upload requires multipart/form-data with a boundary")
		return
	}
	reader := multipart.NewReader(r.Body, params["boundary"])
	session, err := stager.BeginUploadSession()
	if err != nil {
		writeUploadError(w, http.StatusServiceUnavailable, command.UploadReasonUnavailable, err.Error())
		return
	}
	// Nothing survives an unexpected exit: a request that neither finished
	// nor rolled back explicitly (a panic mid-part, a lost connection) has
	// its session directory and in-flight reservation released here.
	finalized := false
	defer func() {
		if !finalized {
			session.Rollback()
		}
	}()
	results := []command.UploadFileResult{}
	parts := 0
	for {
		part, partErr := reader.NextPart()
		if partErr == io.EOF {
			break
		}
		if partErr != nil {
			session.Rollback()
			writeUploadError(w, http.StatusBadRequest, command.UploadReasonMalformed, "read multipart request: "+partErr.Error())
			return
		}
		var result command.UploadFileResult
		switch part.FormName() {
		case "files":
			parts++
			result = session.Stage(rawPartFileName(part), part)
		case "relative_files":
			parts++
			relative, ok := session.(RelativeUploadSession)
			if !ok {
				session.Rollback()
				finalized = true
				writeUploadError(w, http.StatusUnprocessableEntity, command.UploadReasonNameRejected, "this upload staging session cannot preserve folder paths; nothing was staged")
				return
			}
			result = relative.StageRelative(rawPartFileName(part), part)
		default:
			session.Rollback()
			finalized = true
			writeUploadError(w, http.StatusBadRequest, command.UploadReasonMalformed, "multipart form contains an unsupported field")
			return
		}
		results = append(results, result)
		// A sticky request-level refusal requires rollback. Do not close the part
		// here: multipart.Part.Close drains its remaining bytes without a bound.
		if session.Refusal() != "" {
			break
		}
		if reason, err := session.DrainRemainder(part); err != nil || reason != "" {
			session.Rollback()
			finalized = true
			if reason == command.UploadReasonTooLarge {
				writeUploadError(w, http.StatusRequestEntityTooLarge, command.UploadReasonTooLarge, "discarded file content exceeds the per-file upload bound")
				return
			}
			message := "read multipart part remainder"
			if err != nil {
				message += ": " + err.Error()
			}
			writeUploadError(w, http.StatusInternalServerError, command.UploadReasonIOFailed, message)
			return
		}
		// The session bounded the remaining payload; close now only to finalize
		// the multipart part before advancing to the next one.
		_ = part.Close()
	}
	if parts == 0 {
		session.Rollback()
		writeUploadError(w, http.StatusBadRequest, command.UploadReasonEmpty, "multipart form must contain a files field")
		return
	}
	if refusal := session.Refusal(); refusal != "" {
		session.Rollback()
		finalized = true
		writeUploadError(w, http.StatusUnprocessableEntity, refusal, uploadRefusalMessage(results, refusal))
		return
	}
	outcome := session.Finish()
	finalized = true
	status := http.StatusOK
	if outcome.StagingDir == "" {
		status = http.StatusUnprocessableEntity
	}
	writeJSON(w, status, outcome)
}

// rawPartFileName extracts the client-supplied filename before any path
// stripping, so traversal attempts reach the staging session's typed
// rejection instead of silently becoming a different file name.
func rawPartFileName(part *multipart.Part) string {
	disposition := part.Header.Get("Content-Disposition")
	if disposition == "" {
		return ""
	}
	_, params, err := mime.ParseMediaType(disposition)
	if err != nil {
		return ""
	}
	return params["filename"]
}

// uploadRefusalMessage finds the refusing entry's own message so a
// request-level refusal keeps the reason the daemon recorded.
func uploadRefusalMessage(results []command.UploadFileResult, refusal string) string {
	for _, entry := range results {
		if entry.SkippedReason == refusal && entry.Message != "" {
			return entry.Message
		}
	}
	return "upload request refused: " + refusal
}

func writeUploadError(w http.ResponseWriter, status int, reason, message string) {
	writeJSON(w, status, map[string]any{"error": message, "reason": reason})
}
