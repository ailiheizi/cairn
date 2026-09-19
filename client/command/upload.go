package command

// Wire contract of the bounded upload channel into the daemon-owned staging
// inbox (POST /api/v1/upload on the loopback adapter).
//
// Staged bytes are daemon-owned scratch: they carry no protection record, they
// are never repository, catalog, or source content, and they become protected
// only after the ordinary plan.ingest -> review -> digest-bound plan.apply
// flow. Nothing in this contract authorizes deletion of protected content.

// Typed refusal reasons reported by the upload endpoint and by per-file
// skipped_reason entries. The loopback adapter carries the same token gate as
// every other call; these codes describe staging outcomes only.
const (
	// UploadReasonTooLarge refuses one file that exceeds the per-file bound.
	// A mid-stream overflow deletes the partial file first.
	UploadReasonTooLarge = "UPLOAD_TOO_LARGE"
	// UploadReasonTooMany refuses a request that carries more files than the
	// per-request bound. The whole request is rolled back.
	UploadReasonTooMany = "UPLOAD_TOO_MANY"
	// UploadReasonNameRejected refuses one client-supplied filename: path
	// traversal, empty or all-dot names, reserved device names, and names
	// beyond the length bound are refused rather than rewritten.
	UploadReasonNameRejected = "UPLOAD_NAME_REJECTED"
	// UploadReasonBusy refuses one file because the process-wide in-flight
	// byte ceiling is currently used by other uploads. It is retryable.
	UploadReasonBusy = "UPLOAD_BUSY"
	// UploadReasonIOFailed reports an honest read/write failure for one file.
	// The partial file is deleted and the failure is never folded into a skip
	// of another reason.
	UploadReasonIOFailed = "UPLOAD_IO_FAILED"
	// UploadReasonUnavailable reports that this listener has no staging
	// session source or the staging inbox cannot be used at all.
	UploadReasonUnavailable = "UPLOAD_UNAVAILABLE"
	// UploadReasonMalformed reports an unparsable multipart request. Nothing
	// from that request stays staged.
	UploadReasonMalformed = "UPLOAD_MALFORMED"
	// UploadReasonEmpty reports a well-formed multipart request that carried
	// no files field at all.
	UploadReasonEmpty = "UPLOAD_EMPTY"
)

// UploadFileResult is one per-file outcome. A staged entry carries the stored
// identity (name, path, SHA-256, length); a refused entry carries
// skipped_reason and a plain message. The two shapes are distinguished by
// skipped_reason, never by inference.
type UploadFileResult struct {
	OriginalName string `json:"original_name,omitempty"`
	StoredName   string `json:"stored_name,omitempty"`
	StoredPath   string `json:"stored_path,omitempty"`
	SHA256       string `json:"sha256,omitempty"`
	Length       int64  `json:"length,omitempty"`
	// NameRewritten marks that the stored name differs from the
	// client-supplied name: separator base extraction, control-character or
	// leading/trailing-dot stripping, or a collision suffix.
	NameRewritten bool   `json:"name_rewritten,omitempty"`
	SkippedReason string `json:"skipped_reason,omitempty"`
	Message       string `json:"message,omitempty"`
}

// UploadResult is the upload endpoint's response body. StagingDir is the one
// request-scoped directory below the daemon inbox; it is empty when nothing
// was staged. Reason is a request-level refusal; per-file refusals stay in
// Files entries.
type UploadResult struct {
	StagingDir string             `json:"staging_dir,omitempty"`
	Files      []UploadFileResult `json:"files,omitempty"`
	Reason     string             `json:"reason,omitempty"`
	Message    string             `json:"message,omitempty"`
}

// SourceStagingCleanInput names the directory to clean. Only the daemon's own
// staging inbox root is accepted; anything else is a typed refusal.
type SourceStagingCleanInput struct {
	Directory string `json:"directory"`
}

// SourceStagingCleanData reports what a staged-file cleanup removed. Staged
// files are never-ingested scratch: this is not destructive garbage
// collection of protected content.
type SourceStagingCleanData struct {
	Directory    string   `json:"directory"`
	RemovedFiles int      `json:"removed_files"`
	RemovedBytes int64    `json:"removed_bytes"`
	Removed      []string `json:"removed,omitempty"`
	Skipped      []string `json:"skipped,omitempty"`
	// Truncated marks that the removal ran to completion but the reported
	// path list was bounded.
	Truncated bool `json:"truncated,omitempty"`
}
