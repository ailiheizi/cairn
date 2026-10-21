package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/client/command"
)

// Bounds of the bounded upload channel into the reviewable staging inbox.
// They were fixed by the operator-approved slice: at most 1 GiB per file, at
// most 200 files per request, and a process-wide in-flight byte ceiling over
// concurrent upload traffic. Staged bytes carry no protection record; only
// the ordinary plan.ingest -> review -> digest-bound plan.apply flow protects
// them.
const (
	// UploadMaxFileBytes is the per-file bound (1 GiB).
	UploadMaxFileBytes int64 = 1 << 30
	// UploadMaxFilesPerRequest is the per-request file-count bound.
	UploadMaxFilesPerRequest = 200
	// UploadMaxInFlightBytes is the process-wide ceiling over bytes currently
	// being streamed into the staging inbox (4 GiB).
	UploadMaxInFlightBytes int64 = 4 << 30

	// uploadNameByteLimit keeps a stored name (including a possible collision
	// suffix) inside common filesystem NAME_MAX limits.
	uploadNameByteLimit = 240
	// uploadReportLimit bounds the path lists a cleanup reports; removal
	// itself always runs to completion.
	uploadReportLimit = 500
	// inboxDirName is the staging directory below the daemon data root (the
	// configured catalog's parent directory).
	inboxDirName = "inbox"
)

// uploadLimits exists so tests can shrink the bounds without rewriting the
// constants; production daemons always run the defaults above.
type uploadLimits struct {
	maxFileBytes int64
	maxFiles     int
	maxInFlight  int64
}

func defaultUploadLimits() uploadLimits {
	return uploadLimits{maxFileBytes: UploadMaxFileBytes, maxFiles: UploadMaxFilesPerRequest, maxInFlight: UploadMaxInFlightBytes}
}

// UploadSession stages one upload request's files into a fresh directory
// below the daemon-owned inbox. It is deliberately request-scoped: the only
// cross-request state is the process-wide in-flight byte counter on the
// dispatcher, and no staging session can reach repository, catalog, or source
// paths.
type UploadSession struct {
	d       *Dispatcher
	dir     string
	limits  uploadLimits
	results []command.UploadFileResult
	staged  []string
	seen    map[string]int
	parts   int
	refusal string
	mu      sync.Mutex
}

// inboxRoot derives the daemon-owned staging inbox from the configured
// catalog's parent directory. The daemon resolves persisted config paths at
// startup, so production roots are absolute; the process working directory is
// never consulted for placement.
func inboxRoot(catalogPath string) string {
	trimmed := strings.TrimSpace(catalogPath)
	if trimmed == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(filepath.Clean(trimmed)), inboxDirName)
}

// BeginUploadSession starts one request-scoped staging session. It fails
// closed when uploads are not enabled or when the derived inbox would overlap
// a durable store.
func (d *Dispatcher) BeginUploadSession() (*UploadSession, error) {
	if d == nil || strings.TrimSpace(d.inboxRoot) == "" {
		return nil, errors.New("upload staging is not enabled on this daemon")
	}
	if err := d.inboxPlacementAllowed(); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(d.inboxRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create upload inbox: %w", err)
	}
	dir, err := os.MkdirTemp(d.inboxRoot, d.now().UTC().Format("20060102-150405")+"-")
	if err != nil {
		return nil, fmt.Errorf("create upload staging directory: %w", err)
	}
	return &UploadSession{d: d, dir: dir, limits: d.uploadLimits, seen: map[string]int{}}, nil
}

// inboxPlacementAllowed refuses to place staged bytes anywhere a durable
// store lives. The inbox is derived from the catalog's parent, so a profile
// that pointed the repository or the vector store at that same subtree would
// otherwise let an upload write into durable content; in that case uploads
// stay disabled instead of being silently allowed.
func (d *Dispatcher) inboxPlacementAllowed() error {
	if d.exact != nil && d.exact.Repo != nil {
		if root := strings.TrimSpace(d.exact.Repo.Root()); root != "" && localPathsIntersect(d.inboxRoot, root) {
			return fmt.Errorf("upload staging inbox %s overlaps the configured repository %s; uploads are disabled", d.inboxRoot, root)
		}
	}
	if strings.TrimSpace(d.vectorPath) != "" && localPathsIntersect(d.inboxRoot, d.vectorPath) {
		return fmt.Errorf("upload staging inbox %s overlaps the configured vector store %s; uploads are disabled", d.inboxRoot, d.vectorPath)
	}
	return nil
}

// localPathsIntersect reports whether two local filesystem paths overlap
// after cleaning and absolutization. It is a placement guard only.
func localPathsIntersect(left, right string) bool {
	return localDirContains(left, right) || localDirContains(right, left)
}

// localDirContains reports whether child is parent itself or below it.
func localDirContains(parent, child string) bool {
	parentAbs, err := filepath.Abs(filepath.Clean(parent))
	if err != nil {
		return false
	}
	childAbs, err := filepath.Abs(filepath.Clean(child))
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(parentAbs, childAbs)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// Stage streams one file part into the session's staging directory. Content
// is never buffered whole: bytes stream to disk through the SHA-256 digest
// while the per-file, per-request, and process-wide bounds are enforced. A
// refused file never leaves a partial behind, and a refusal never blocks the
// other files of the same request.
func (s *UploadSession) Stage(fileName string, content io.Reader) command.UploadFileResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	original := fileName
	if skipped := s.beginPartLocked(original); skipped != nil {
		return *skipped
	}
	display, rewritten, nameErr := sanitizeUploadName(fileName)
	if nameErr != nil {
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: command.UploadReasonNameRejected, Message: nameErr.Error()}
		s.results = append(s.results, skipped)
		return skipped
	}
	if info, err := os.Lstat(filepath.Join(s.dir, display)); err == nil && (info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: command.UploadReasonNameRejected, Message: "filename conflicts with an existing staged folder path"}
		s.results = append(s.results, skipped)
		return skipped
	}
	stored := s.uniqueName(display)
	receipt, skipped := s.writeFile(stored, content)
	if receipt != nil {
		receipt.OriginalName = original
		receipt.NameRewritten = rewritten || stored != display
		s.results = append(s.results, *receipt)
		s.staged = append(s.staged, receipt.StoredPath)
		return *receipt
	}
	skipped.OriginalName = original
	s.results = append(s.results, *skipped)
	return *skipped
}

// StageRelative streams a strictly validated folder-relative path without
// rewriting components. Duplicate paths and file/directory collisions are
// per-file refusals; no existing staged path is overwritten.
func (s *UploadSession) StageRelative(relativePath string, content io.Reader) command.UploadFileResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	original := relativePath
	if skipped := s.beginPartLocked(original); skipped != nil {
		return *skipped
	}
	if err := validateRelativeUploadPath(relativePath); err != nil {
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: command.UploadReasonNameRejected, Message: err.Error()}
		s.results = append(s.results, skipped)
		return skipped
	}
	if s.seen[relativePath] > 0 {
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: command.UploadReasonNameRejected, Message: "the same folder-relative path was selected more than once"}
		s.results = append(s.results, skipped)
		return skipped
	}
	parentRoot, leaf, err := openRelativeUploadParent(s.dir, relativePath)
	if err != nil {
		message := "create safe folder path: " + err.Error()
		reason := command.UploadReasonIOFailed
		if errors.Is(err, errUploadPathConflict) {
			reason = command.UploadReasonNameRejected
			message = err.Error()
		}
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: reason, Message: message}
		s.results = append(s.results, skipped)
		return skipped
	}
	defer parentRoot.Close()
	if _, statErr := parentRoot.Lstat(leaf); statErr == nil {
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: command.UploadReasonNameRejected, Message: "folder-relative path conflicts with an already staged file or folder"}
		s.results = append(s.results, skipped)
		return skipped
	} else if !errors.Is(statErr, fs.ErrNotExist) {
		skipped := command.UploadFileResult{OriginalName: original, SkippedReason: command.UploadReasonIOFailed, Message: "inspect folder-relative path: " + statErr.Error()}
		s.results = append(s.results, skipped)
		return skipped
	}
	storedPath := filepath.Join(s.dir, filepath.FromSlash(relativePath))
	receipt, skipped := s.writeRelativeFile(parentRoot, leaf, relativePath, storedPath, content)
	if receipt != nil {
		receipt.OriginalName = original
		s.seen[relativePath] = 1
		s.results = append(s.results, *receipt)
		s.staged = append(s.staged, receipt.StoredPath)
		return *receipt
	}
	skipped.OriginalName = original
	s.results = append(s.results, *skipped)
	return *skipped
}

// DrainRemainder consumes at most the daemon-owned per-file allowance plus
// one sentinel byte. The staging write may already have consumed part data;
// this independently bounds only the bytes discarded to reach the next part.
func (s *UploadSession) DrainRemainder(content io.Reader) (string, error) {
	limit := s.limits.maxFileBytes + 1
	n, err := io.CopyN(io.Discard, content, limit)
	if n == limit {
		return command.UploadReasonTooLarge, nil
	}
	if errors.Is(err, io.EOF) {
		return "", nil
	}
	if err != nil {
		return command.UploadReasonIOFailed, err
	}
	return "", nil
}

func (s *UploadSession) beginPartLocked(original string) *command.UploadFileResult {
	if s.refusal != "" {
		return &command.UploadFileResult{OriginalName: original, SkippedReason: s.refusal, Message: "the upload request was refused and rolled back"}
	}
	s.parts++
	if s.parts > s.limits.maxFiles {
		s.refusal = command.UploadReasonTooMany
		skipped := command.UploadFileResult{
			OriginalName:  original,
			SkippedReason: s.refusal,
			Message:       fmt.Sprintf("upload request carries more than %d files", s.limits.maxFiles),
		}
		s.results = append(s.results, skipped)
		return &skipped
	}
	return nil
}

var errUploadPathConflict = errors.New("folder-relative path conflicts with an existing file, directory, or symbolic link")

func validateRelativeUploadPath(raw string) error {
	if raw == "" || !utf8.ValidString(raw) {
		return errors.New("folder-relative path must be non-empty valid UTF-8")
	}
	if len(raw) > 2048 {
		return errors.New("folder-relative path exceeds 2048 UTF-8 bytes")
	}
	if strings.HasPrefix(raw, "/") || strings.ContainsAny(raw, "\\:") {
		return errors.New("folder-relative path must use safe relative slash-separated components")
	}
	components := strings.Split(raw, "/")
	if len(components) > 16 {
		return errors.New("folder-relative path exceeds 16 components")
	}
	for _, component := range components {
		if component == "" || component == "." || component == ".." {
			return errors.New("folder-relative path contains an empty, dot, or dot-dot component")
		}
		if len(component) > uploadNameByteLimit {
			return fmt.Errorf("folder-relative path component exceeds %d UTF-8 bytes", uploadNameByteLimit)
		}
		for _, r := range component {
			if unicode.IsControl(r) {
				return errors.New("folder-relative path contains a control character")
			}
		}
		if strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") {
			return errors.New("folder-relative path components may not end in a dot or space")
		}
		if windowsReservedName(component) {
			return fmt.Errorf("folder-relative path component %q is a reserved device name", component)
		}
	}
	return nil
}

// openRelativeUploadParent descends one component at a time from the session
// root. Lstat refuses a symlink or non-directory before opening each child;
// os.Root keeps every subsequent operation confined if the directory changes
// concurrently.
func openRelativeUploadParent(sessionDir, relativePath string) (*os.Root, string, error) {
	components := strings.Split(relativePath, "/")
	root, err := os.OpenRoot(sessionDir)
	if err != nil {
		return nil, "", err
	}
	for _, component := range components[:len(components)-1] {
		info, statErr := root.Lstat(component)
		if errors.Is(statErr, fs.ErrNotExist) {
			if mkdirErr := root.Mkdir(component, 0o700); mkdirErr != nil && !errors.Is(mkdirErr, fs.ErrExist) {
				_ = root.Close()
				return nil, "", mkdirErr
			}
			info, statErr = root.Lstat(component)
		}
		if statErr != nil {
			_ = root.Close()
			return nil, "", statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			_ = root.Close()
			return nil, "", errUploadPathConflict
		}
		child, openErr := root.OpenRoot(component)
		if openErr != nil {
			_ = root.Close()
			return nil, "", openErr
		}
		_ = root.Close()
		root = child
	}
	return root, components[len(components)-1], nil
}

// Refusal reports a sticky request-level refusal. Once set, no further file
// part is accepted and the caller must roll the session back.
func (s *UploadSession) Refusal() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.refusal
}

// Rollback deletes everything this request staged. It removes only the one
// session directory this session created below the inbox root, and it refuses
// to act on a directory that is no longer inside that root.
func (s *UploadSession) Rollback() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeSessionDirLocked()
	s.staged = nil
}

// Finish finalizes the session. A request that staged nothing leaves no empty
// directory behind; the result reports every staged receipt and every honest
// skip, and names the first refusal when nothing landed.
func (s *UploadSession) Finish() command.UploadResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := command.UploadResult{Files: append([]command.UploadFileResult(nil), s.results...)}
	if len(s.staged) == 0 {
		s.removeSessionDirLocked()
		for _, entry := range result.Files {
			if entry.SkippedReason != "" {
				result.Reason = entry.SkippedReason
				result.Message = entry.Message
				break
			}
		}
		return result
	}
	pruneEmptySessionDirs(s.dir)
	result.StagingDir = s.dir
	return result
}

func pruneEmptySessionDirs(root string) {
	var directories []string
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || path == root || !entry.IsDir() {
			return err
		}
		directories = append(directories, path)
		return nil
	})
	sort.Slice(directories, func(i, j int) bool { return len(directories[i]) > len(directories[j]) })
	for _, directory := range directories {
		_ = os.Remove(directory) // Only empty directories are removed.
	}
}

func (s *UploadSession) removeSessionDirLocked() {
	if s.dir == "" || s.d == nil || strings.TrimSpace(s.d.inboxRoot) == "" {
		return
	}
	// Defense in depth: the removal target must still be the directory this
	// session created below the inbox root.
	if !localDirContains(s.d.inboxRoot, s.dir) || filepath.Clean(s.dir) == filepath.Clean(s.d.inboxRoot) {
		return
	}
	_ = os.RemoveAll(s.dir)
	s.dir = ""
}

// uniqueName keeps one session's stored names distinct without ever renaming
// across sessions: a fresh staging directory per request makes cross-request
// collisions impossible.
func (s *UploadSession) uniqueName(display string) string {
	if s.seen[display] == 0 {
		s.seen[display] = 1
		return display
	}
	for n := 2; ; n++ {
		candidate := nameWithCountSuffix(display, n)
		if s.seen[candidate] == 0 {
			s.seen[candidate] = 1
			return candidate
		}
	}
}

func nameWithCountSuffix(name string, n int) string {
	ext := filepath.Ext(name)
	return fmt.Sprintf("%s-%d%s", strings.TrimSuffix(name, ext), n, ext)
}

// writeFile streams one file to disk at 0600 while hashing. It returns either
// a receipt or a typed skip; both paths delete any partial file and release
// the in-flight byte reservation.
func (s *UploadSession) writeFile(storedName string, content io.Reader) (*command.UploadFileResult, *command.UploadFileResult) {
	path := filepath.Join(s.dir, storedName)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, &command.UploadFileResult{SkippedReason: command.UploadReasonIOFailed, Message: "create staged file: " + err.Error()}
	}
	return s.writeFileContents(file, storedName, path, content, func() { _ = os.Remove(path) })
}

func (s *UploadSession) writeRelativeFile(root *os.Root, leaf, storedName, storedPath string, content io.Reader) (*command.UploadFileResult, *command.UploadFileResult) {
	file, err := root.OpenFile(leaf, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			return nil, &command.UploadFileResult{SkippedReason: command.UploadReasonNameRejected, Message: "folder-relative path conflicts with an already staged file or folder"}
		}
		return nil, &command.UploadFileResult{SkippedReason: command.UploadReasonIOFailed, Message: "create staged folder file: " + err.Error()}
	}
	return s.writeFileContents(file, storedName, storedPath, content, func() { _ = root.Remove(leaf) })
}

func (s *UploadSession) writeFileContents(file *os.File, storedName, storedPath string, content io.Reader, remove func()) (*command.UploadFileResult, *command.UploadFileResult) {
	hasher := sha256.New()
	var length int64
	var reserved int64
	release := func() {
		if reserved > 0 {
			s.d.uploadInFlight.Add(-reserved)
			reserved = 0
		}
	}
	fail := func(reason, message string) *command.UploadFileResult {
		_ = file.Close()
		remove()
		release()
		return &command.UploadFileResult{SkippedReason: reason, Message: message}
	}
	buf := make([]byte, 256<<10)
	for {
		n, readErr := content.Read(buf)
		if n > 0 {
			if length+int64(n) > s.limits.maxFileBytes {
				return nil, fail(command.UploadReasonTooLarge, fmt.Sprintf("file exceeds the %d byte per-file upload bound", s.limits.maxFileBytes))
			}
			if grown := s.d.uploadInFlight.Add(int64(n)); grown > s.limits.maxInFlight {
				s.d.uploadInFlight.Add(-int64(n))
				return nil, fail(command.UploadReasonBusy, "another upload is using the staging channel; retry after it finishes")
			}
			reserved += int64(n)
			if _, writeErr := file.Write(buf[:n]); writeErr != nil {
				return nil, fail(command.UploadReasonIOFailed, "write staged file: "+writeErr.Error())
			}
			_, _ = hasher.Write(buf[:n])
			length += int64(n)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, fail(command.UploadReasonIOFailed, "read upload part: "+readErr.Error())
		}
	}
	if err := file.Close(); err != nil {
		remove()
		release()
		return nil, &command.UploadFileResult{SkippedReason: command.UploadReasonIOFailed, Message: "close staged file: " + err.Error()}
	}
	release()
	return &command.UploadFileResult{
		StoredName: storedName,
		StoredPath: storedPath,
		SHA256:     hex.EncodeToString(hasher.Sum(nil)),
		Length:     length,
	}, nil
}

// sanitizeUploadName turns one client-supplied filename into a safe display
// name for the staging inbox. Client-side directory components are rewritten
// to the final component, control characters and leading/trailing dots and
// spaces are stripped, and the boolean reports every rewrite. Traversal and
// disallowed names are typed refusals, never rewrites.
func sanitizeUploadName(raw string) (string, bool, error) {
	if strings.TrimSpace(raw) == "" {
		return "", false, fmt.Errorf("filename is required")
	}
	rewritten := false
	if strings.ContainsAny(raw, "/\\") {
		components := strings.FieldsFunc(raw, func(r rune) bool { return r == '/' || r == '\\' })
		for _, component := range components {
			if component == ".." {
				return "", false, fmt.Errorf("filename %q is not allowed: path traversal", raw)
			}
		}
		if len(components) == 0 {
			return "", false, fmt.Errorf("filename %q is not allowed", raw)
		}
		raw = components[len(components)-1]
		rewritten = true
	}
	display := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, raw)
	if display != raw {
		rewritten = true
	}
	trimmed := strings.TrimLeft(display, ".")
	if trimmed != display {
		rewritten = true
	}
	display = trimmed
	trimmed = strings.TrimRight(display, " .")
	if trimmed != display {
		rewritten = true
	}
	display = trimmed
	if display == "" {
		return "", false, fmt.Errorf("filename %q is not allowed", raw)
	}
	if windowsReservedName(display) {
		return "", false, fmt.Errorf("filename %q is not allowed: reserved device name", display)
	}
	if len(display) > uploadNameByteLimit {
		return "", false, fmt.Errorf("filename exceeds %d bytes", uploadNameByteLimit)
	}
	return display, rewritten, nil
}

// windowsReservedName refuses the Windows reserved device names so a staged
// name can never become un-restorable on another host's filesystem.
func windowsReservedName(name string) bool {
	base := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	switch base {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return true
	}
	return false
}

// inboxProjection is the honest source-list entry for the daemon-owned
// upload inbox. It is a live projection over the staging directory, never a
// catalog SourceRecord: the inbox holds never-protected scratch bytes, and
// the entry exists only while the inbox holds files.
func (d *Dispatcher) inboxProjection(checkedAt string) *command.SourceSummaryData {
	root := strings.TrimSpace(d.inboxRoot)
	if root == "" {
		return nil
	}
	if _, err := os.Lstat(root); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return &command.SourceSummaryData{
			Kind:                  inboxEntryKind,
			Locator:               root,
			State:                 inboxStateUnavailable,
			Reachability:          "UNKNOWN",
			ReachabilityCheckedAt: checkedAt,
			ReachabilityMessage:   "staging inbox could not be inspected: " + err.Error(),
		}
	}
	files, bytes, walkErr := measureInbox(root)
	if walkErr == nil && files == 0 {
		return nil
	}
	entry := &command.SourceSummaryData{
		Kind:                  inboxEntryKind,
		Locator:               root,
		State:                 inboxStateStagedUnprotected,
		Reachability:          "AVAILABLE",
		ReachabilityCheckedAt: checkedAt,
		ReachabilityMessage:   "daemon-owned upload staging inbox",
		Staging: &command.SourceStagingData{
			Path:             root,
			Files:            files,
			Bytes:            bytes,
			ProtectionRecord: inboxProtectionNone,
			Note:             "Staged uploads have no protection record yet; they become protected only after an ingest plan over this directory is reviewed and applied.",
		},
	}
	if walkErr != nil {
		entry.Reachability = "UNKNOWN"
		entry.ReachabilityMessage = "staging inbox could not be measured: " + walkErr.Error()
	}
	return entry
}

const (
	inboxEntryKind              = "STAGING_INBOX"
	inboxStateStagedUnprotected = "STAGED_UNPROTECTED"
	inboxStateUnavailable       = "UNAVAILABLE"
	inboxProtectionNone         = "NONE"
)

// measureInbox counts the staged files and bytes below the inbox root. It
// never follows symbolic links out of the inbox and never modifies anything.
func measureInbox(root string) (int, int64, error) {
	files := 0
	var bytes int64
	err := filepath.WalkDir(root, func(_ string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		// Symbolic links and other non-regular entries are not staged bytes;
		// counting them would let inbox-adjacent content inflate the report.
		if !entry.Type().IsRegular() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		files++
		bytes += info.Size()
		return nil
	})
	return files, bytes, err
}

type sourceStagingCleanInput struct {
	Directory string `json:"directory"`
}

// handleSourceStagingClean deletes the files inside the daemon-owned upload
// inbox after the operator's explicit confirmation (the browser owns that
// confirmation). It refuses any directory other than the inbox root, never
// follows symbolic links, and removes only regular files. Deleting staged,
// never-ingested scratch is not destructive garbage collection of protected
// content: this operation cannot reach the repository, the catalog, or any
// configured source tree.
func (d *Dispatcher) handleSourceStagingClean(_ context.Context, env command.Envelope, started time.Time) command.Result {
	if strings.TrimSpace(d.inboxRoot) == "" {
		return unimplementedResult(env, started)
	}
	var input sourceStagingCleanInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if strings.TrimSpace(input.Directory) == "" {
		return invalidInputResult(env, started, errString("directory is required"))
	}
	if inFlight := d.uploadInFlight.Load(); inFlight > 0 {
		return conflictResult(env, started, fmt.Sprintf("%d upload bytes are still in flight; retry staged-file cleanup after uploads finish", inFlight))
	}
	inboxAbs, err := filepath.Abs(filepath.Clean(d.inboxRoot))
	if err != nil {
		return failed(env, started, newReason(ReasonCodeUnavailable, "resolve staging inbox: "+err.Error()))
	}
	requestedAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(input.Directory)))
	if err != nil {
		return invalidInputResult(env, started, err)
	}
	if requestedAbs != inboxAbs {
		return invalidInputResult(env, started, fmt.Errorf("directory %q is outside the daemon staging inbox %q; nothing was removed", input.Directory, d.inboxRoot))
	}
	removed, bytesRemoved, skipped, walkErr := cleanInboxFiles(inboxAbs)
	data := command.SourceStagingCleanData{
		Directory:    inboxAbs,
		RemovedFiles: len(removed),
		RemovedBytes: bytesRemoved,
	}
	data.Removed, data.Truncated = truncateReportList(removed)
	data.Skipped, _ = truncateReportList(skipped)
	if walkErr != nil {
		// A partial cleanup is a first-class outcome: report what was removed
		// and why the walk stopped instead of claiming a clean sweep.
		return degradedResult(env, started, data, "staged-file cleanup stopped early: "+walkErr.Error())
	}
	return succeeded(env, started, data)
}

// cleanInboxFiles removes only regular files below root, never following
// symbolic links and never removing directories.
func cleanInboxFiles(root string) (removed []string, bytesRemoved int64, skipped []string, walkErr error) {
	removed = []string{}
	skipped = []string{}
	walkErr = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root || entry.IsDir() {
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			relative = path
		}
		if !entry.Type().IsRegular() {
			skipped = append(skipped, relative)
			return nil
		}
		size := int64(0)
		if info, infoErr := entry.Info(); infoErr == nil {
			size = info.Size()
		}
		if rmErr := os.Remove(path); rmErr != nil {
			return rmErr
		}
		removed = append(removed, relative)
		bytesRemoved += size
		return nil
	})
	return removed, bytesRemoved, skipped, walkErr
}

func truncateReportList(paths []string) ([]string, bool) {
	if len(paths) <= uploadReportLimit {
		return paths, false
	}
	return paths[:uploadReportLimit], true
}
