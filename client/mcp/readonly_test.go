package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"go/parser"
	"go/token"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/client/transport"
)

// ---------------------------------------------------------------------------
// frozen surface and allowlist
// ---------------------------------------------------------------------------

// frozenReadOnlyOperations is the complete set of typed operations this
// surface can dispatch, written out literally. Changing the surface requires
// changing this list deliberately; the test below fails otherwise.
var frozenReadOnlyOperations = []string{
	"snapshot.list",
	"status.get",
	"content.list",
	"namespace.stat",
	"annotation.list",
	"representation.list",
	"description.list",
	"description.get",
	"search.query",
}

// frozenAdmitted classifies every operation the command ABI knows: true means
// the read-only MCP surface may dispatch it. Every operation is listed
// explicitly so that a newly added operation fails the test until a human
// classifies it.
var frozenAdmitted = map[string]bool{
	// Read-only and admitted to this surface.
	command.OpSnapshotList:       true,
	command.OpStatusGet:          true,
	command.OpContentList:        true,
	command.OpNamespaceStat:      true,
	command.OpAnnotationList:     true,
	command.OpRepresentationList: true,
	command.OpDescriptionList:    true,
	command.OpDescriptionGet:     true,
	command.OpSearchQuery:        true,
	// Read-only but not admitted to this four-tool surface.
	command.OpDoctorCheck:       false,
	command.OpCapabilityList:    false,
	command.OpConfigGet:         false,
	command.OpSourceList:        false,
	command.OpSnapshotDiff:      false,
	command.OpPlanGet:           false,
	command.OpJobEvents:         false,
	command.OpJobList:           false,
	command.OpNamespaceList:     false,
	command.OpNamespaceResolve:  false,
	command.OpNamespaceReadlink: false,
	command.OpContentOpen:       false,
	command.OpContentRead:       false,
	command.OpContentClose:      false,
	command.OpViewGet:           false,
	command.OpViewList:          false,
	command.OpViewEvaluate:      false,
	command.OpExportList:        false,
	command.OpAnnotationTagPlan: false,
	// Mutating or lifecycle operations: never reachable from this surface.
	command.OpConfigUpdate:          false,
	command.OpPlanIngest:            false,
	command.OpPlanRevise:            false,
	command.OpPlanAbandon:           false,
	command.OpPlanRestore:           false,
	command.OpPlanApply:             false,
	command.OpJobCancel:             false,
	command.OpSnapshotVerify:        false,
	command.OpRecoveryExport:        false,
	command.OpRecoveryAnchorExport:  false,
	command.OpRecoveryImport:        false,
	command.OpRecoveryTokenExport:   false,
	command.OpAnnotationUpsert:      false,
	command.OpAnnotationDelete:      false,
	command.OpAnnotationExport:      false,
	command.OpAnnotationImport:      false,
	command.OpAnnotationTagApply:    false,
	command.OpSearchRebuild:         false,
	command.OpSemanticBundleInstall: false,
	// The online provider profile install writes into the models root, so it is
	// not admitted to the read-only surface either.
	command.OpSemanticProviderInstall: false,
	// semantic.provider.list is read-only but not admitted to this four-tool
	// surface.
	command.OpSemanticProviderList: false,
	// Egress grant mutations are lifecycle operations and are never reachable
	// from this surface; the read-only grant list is not admitted either.
	command.OpEgressGrantCreate: false,
	command.OpEgressGrantRevoke: false,
	command.OpEgressGrantList:   false,
	// The image bundle install writes into the models root, so it is not admitted
	// to the read-only surface either.
	command.OpImageBundleInstall: false,
	command.OpAudioList:          false,
	command.OpBooksList:          false,
	command.OpDescriptionCreate:  false,
	command.OpViewSave:           false,
	command.OpExportPlan:         false,
	command.OpExportApply:        false,
	command.OpExportVerify:       false,
}

// TestReadOnlyAllowlistIsFrozenAndClassified proves the read-only property
// structurally: the surface's allowlist is exactly the frozen list, every
// operation it can dispatch is classified, and a newly added ABI operation
// fails this test until it is classified.
func TestReadOnlyAllowlistIsFrozenAndClassified(t *testing.T) {
	if got, want := readOnlyOperations, frozenReadOnlyOperations; len(got) != len(want) {
		t.Fatalf("read-only allowlist changed: got %v, want %v", got, want)
	}
	for index, operation := range readOnlyOperations {
		if operation != frozenReadOnlyOperations[index] {
			t.Fatalf("read-only allowlist[%d] = %q, want %q", index, operation, frozenReadOnlyOperations[index])
		}
		if !command.IsKnown(operation) {
			t.Fatalf("read-only allowlist contains unknown operation %q", operation)
		}
		if !frozenAdmitted[operation] {
			t.Fatalf("read-only allowlist contains %q, which the classification does not admit", operation)
		}
	}
	for _, operation := range command.KnownOperations() {
		if _, classified := frozenAdmitted[operation]; !classified {
			t.Fatalf("new operation %q appeared in the command ABI: classify it as admitted read-only or not admitted before this surface ships", operation)
		}
	}
	for operation, admitted := range frozenAdmitted {
		if !command.IsKnown(operation) {
			// A classification for an operation the ABI no longer knows is
			// stale, not dangerous: the allowlist itself is still checked
			// against the live ABI above. New operations remain fatal.
			t.Logf("classification lists %q, which the command ABI no longer knows", operation)
			continue
		}
		if admitted != readOnlyOperationIndex[operation] {
			t.Fatalf("classification for %q is admitted=%t but the allowlist says %t", operation, admitted, readOnlyOperationIndex[operation])
		}
	}
}

// TestReadOnlyGatewayRefusesEveryNonAllowlistedOperation drives the one gateway
// with every known non-admitted operation and requires a typed refusal with no
// daemon traffic at all.
func TestReadOnlyGatewayRefusesEveryNonAllowlistedOperation(t *testing.T) {
	daemon := startFakeDaemon(t, func(command.Envelope) fakeReply {
		t.Fatalf("read-only gateway contacted the daemon for a refused operation")
		return fakeReply{}
	})
	conn := daemon.connect(t)
	gateway := &readOnlyGateway{conn: conn, token: validTestToken(t)}

	for _, operation := range command.KnownOperations() {
		if frozenAdmitted[operation] {
			continue
		}
		if _, err := gateway.execute(context.Background(), operation, map[string]any{}); err == nil {
			t.Fatalf("gateway executed non-admitted operation %q", operation)
		} else if !strings.Contains(err.Error(), "read-only allowlist") {
			t.Fatalf("gateway refusal for %q = %q, want a read-only allowlist refusal", operation, err)
		}
	}
	daemon.requireSilent(t)
}

// ---------------------------------------------------------------------------
// tool inventory
// ---------------------------------------------------------------------------

func TestReadOnlySurfaceExposesExactlyFourReadOnlyTools(t *testing.T) {
	daemon := startFakeDaemon(t, defaultFakeReply)
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("tools/list: %v", err)
	}
	names := map[string]*mcpsdk.Tool{}
	for _, tool := range listed.Tools {
		names[tool.Name] = tool
	}
	want := []string{ReadOnlyToolSearch, ReadOnlyToolGetSubject, ReadOnlyToolListRecent, ReadOnlyToolReadTextExtract}
	if len(names) != len(want) {
		t.Fatalf("read-only surface exposes %d tools, want %d: %v", len(names), len(want), names)
	}
	for _, name := range want {
		tool, ok := names[name]
		if !ok {
			t.Fatalf("read-only surface is missing tool %q", name)
		}
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Fatalf("tool %q is not marked readOnlyHint", name)
		}
		if tool.Annotations.DestructiveHint == nil || *tool.Annotations.DestructiveHint {
			t.Fatalf("tool %q is marked destructive", name)
		}
		if !strings.Contains(tool.Description, "cannot write, plan, apply, verify, delete, or change configuration") {
			t.Fatalf("tool %q description does not state the read-only boundary: %q", name, tool.Description)
		}
		if !strings.Contains(tool.Description, "never answers from a cache") && !strings.Contains(tool.Description, "never answered from a cache") {
			t.Fatalf("tool %q description does not state the no-cache property: %q", name, tool.Description)
		}
	}
	for _, forbidden := range []string{command.OpPlanApply, command.OpPlanIngest, command.OpAnnotationUpsert, command.OpSnapshotVerify, "write"} {
		if _, ok := names[forbidden]; ok {
			t.Fatalf("read-only surface exposes forbidden tool %q", forbidden)
		}
	}
	daemon.requireSilent(t)
}

// TestReadOnlySurfaceHasNoListenerOrHTTPTransport proves there is no network
// listener in this package: the surface is stdio over a local Unix socket.
func TestReadOnlySurfaceHasNoListenerOrHTTPTransport(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	for _, entry := range entries {
		// Test files host the recording fake daemon and are not part of the
		// shipped surface.
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), entry.Name(), nil, parser.ImportsOnly)
		if parseErr != nil {
			t.Fatalf("parse %s: %v", entry.Name(), parseErr)
		}
		for _, imported := range parsed.Imports {
			path := strings.Trim(imported.Path.Value, `"`)
			if path == "net" || path == "net/http" {
				t.Fatalf("%s imports %q: the read-only MCP surface must not open a listener", entry.Name(), path)
			}
		}
		source, readErr := os.ReadFile(entry.Name())
		if readErr != nil {
			t.Fatalf("read %s: %v", entry.Name(), readErr)
		}
		if bytes.Contains(source, []byte("net.Listen(")) {
			t.Fatalf("%s calls net.Listen", entry.Name())
		}
	}
}

// ---------------------------------------------------------------------------
// token gate
// ---------------------------------------------------------------------------

func TestReadOnlyRefusesEveryToolWithoutAConfiguredToken(t *testing.T) {
	daemon := startFakeDaemon(t, defaultFakeReply)
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	calls := []mcpsdk.CallToolParams{
		{Name: ReadOnlyToolSearch, Arguments: map[string]any{"query": "anything"}},
		{Name: ReadOnlyToolGetSubject, Arguments: map[string]any{"subject_ref": "subj_0000000000000000000000000000dead"}},
		{Name: ReadOnlyToolListRecent, Arguments: map[string]any{"limit": 5}},
		{Name: ReadOnlyToolReadTextExtract, Arguments: map[string]any{"subject_ref": "subj_0000000000000000000000000000dead"}},
	}
	for _, call := range calls {
		result, callErr := session.CallTool(context.Background(), &call)
		if callErr != nil {
			t.Fatalf("%s call: %v", call.Name, callErr)
		}
		if !result.IsError {
			t.Fatalf("%s without a configured token must be refused", call.Name)
		}
		text := contentText(t, result)
		if !strings.Contains(text, "refused") || !strings.Contains(text, ReadOnlyTokenEnvVar) {
			t.Fatalf("%s refusal = %q, want a refusal naming %s", call.Name, text, ReadOnlyTokenEnvVar)
		}
		if result.StructuredContent == nil {
			t.Fatalf("%s refusal carries no structured content", call.Name)
		}
		encoded, err := json.Marshal(result.StructuredContent)
		if err != nil {
			t.Fatalf("encode %s structured content: %v", call.Name, err)
		}
		var refused struct {
			Tool         string          `json:"tool"`
			ReadOnly     bool            `json:"read_only"`
			Refused      bool            `json:"refused"`
			DaemonStatus string          `json:"daemon_status"`
			Bounds       json.RawMessage `json:"bounds"`
		}
		if err := json.Unmarshal(encoded, &refused); err != nil {
			t.Fatalf("decode %s structured content: %v", call.Name, err)
		}
		if refused.Tool != call.Name || !refused.ReadOnly || !refused.Refused {
			t.Fatalf("%s refusal structured content = %+v, want the read-only refusal shape", call.Name, refused)
		}
		if refused.DaemonStatus != readOnlyStatusNotRequested || len(refused.Bounds) != 0 {
			t.Fatalf("%s refusal claims a daemon answer: %+v", call.Name, refused)
		}
	}
	daemon.requireSilent(t)
}

func TestReadOnlyTokenNeverReachesTheDaemonOrTheResult(t *testing.T) {
	secret := "readonly-secret-token-0123456789"
	daemon := startFakeDaemon(t, defaultFakeReply)
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: ReadOnlyToken{value: secret}})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolSearch, Arguments: map[string]any{"query": "demo"},
	})
	if callErr != nil {
		t.Fatalf("search call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("search refused: %s", contentText(t, result))
	}
	for _, raw := range daemon.rawEnvelopes(t) {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("read-only token was sent to the daemon: %s", raw)
		}
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if bytes.Contains(encoded, []byte(secret)) {
		t.Fatalf("read-only token appeared in a tool result: %s", encoded)
	}
	if formatted := fmt.Sprintf("%v %#v %s", ReadOnlyToken{value: secret}, ReadOnlyToken{value: secret}, ReadOnlyToken{value: secret}); strings.Contains(formatted, secret) {
		t.Fatalf("ReadOnlyToken formatting leaked the token: %s", formatted)
	}
}

func TestResolveReadOnlyTokenRules(t *testing.T) {
	valid := "readonly-token-0123456789abcdef"

	lookupOf := func(values map[string]string) func(string) string {
		return func(name string) string { return values[name] }
	}
	absent, err := ResolveReadOnlyToken(lookupOf(map[string]string{}))
	if err != nil || absent.Configured() {
		t.Fatalf("absent token = (%v, %v), want unconfigured without error", absent, err)
	}
	weak := "weakvalue123"
	if _, err := ResolveReadOnlyToken(lookupOf(map[string]string{ReadOnlyTokenEnvVar: weak})); err == nil {
		t.Fatal("short token must be refused")
	} else if strings.Contains(err.Error(), weak) {
		t.Fatalf("short-token refusal echoed the value: %v", err)
	}
	for _, writeEnv := range []string{ReadOnlyWriteTokenEnvVar, APIWriteTokenEnvVar} {
		_, err := ResolveReadOnlyToken(lookupOf(map[string]string{ReadOnlyTokenEnvVar: valid, writeEnv: valid}))
		if err == nil {
			t.Fatalf("read-only token equal to %s must be refused", writeEnv)
		}
		if !strings.Contains(err.Error(), writeEnv) {
			t.Fatalf("distinctness refusal = %v, want it to name %s", err, writeEnv)
		}
		if strings.Contains(err.Error(), valid) {
			t.Fatalf("distinctness refusal echoed the token: %v", err)
		}
	}
	resolved, err := ResolveReadOnlyToken(lookupOf(map[string]string{ReadOnlyTokenEnvVar: valid, APIWriteTokenEnvVar: valid + "-different"}))
	if err != nil || !resolved.Configured() {
		t.Fatalf("valid token = (%v, %v), want configured", resolved, err)
	}
	if !resolved.matches(valid) || resolved.matches(valid+"x") {
		t.Fatal("token comparison accepted the wrong value")
	}
}

func TestValidateLocalSocketPathRefusesNetworkAddresses(t *testing.T) {
	for _, rejected := range []string{"", "tcp://127.0.0.1:9000", "http://localhost/socket", "127.0.0.1:4538", "localhost:4538"} {
		if err := ValidateLocalSocketPath(rejected); err == nil {
			t.Fatalf("ValidateLocalSocketPath(%q) accepted a non-local address", rejected)
		}
	}
	for _, accepted := range []string{"/tmp/restoreweave/restoreweaved.sock", "/run/user/1000/restoreweave.sock"} {
		if err := ValidateLocalSocketPath(accepted); err != nil {
			t.Fatalf("ValidateLocalSocketPath(%q) = %v", accepted, err)
		}
	}
}

// ---------------------------------------------------------------------------
// bounds
// ---------------------------------------------------------------------------

func TestReadOnlyLimitsClampReportAndTruncate(t *testing.T) {
	hits := []command.SearchHitData{
		{SubjectRef: "subj_a", Name: "a", Path: "a", ContentID: "sha256:a"},
		{SubjectRef: "subj_b", Name: "b", Path: "b", ContentID: "sha256:b"},
		{SubjectRef: "subj_c", Name: "c", Path: "c", ContentID: "sha256:c"},
	}
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		if env.Operation != command.OpSearchQuery {
			t.Fatalf("unexpected operation %q", env.Operation)
		}
		return fakeReply{data: command.SearchQueryData{Hits: hits}}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	call := func(limit any) readOnlySearchOutput {
		t.Helper()
		arguments := map[string]any{"query": "anything"}
		if limit != nil {
			arguments["limit"] = limit
		}
		result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{Name: ReadOnlyToolSearch, Arguments: arguments})
		if callErr != nil {
			t.Fatalf("search call: %v", callErr)
		}
		if result.IsError {
			t.Fatalf("search refused: %s", contentText(t, result))
		}
		var output readOnlySearchOutput
		decodeStructured(t, result, &output)
		return output
	}

	defaulted := call(nil)
	if !defaulted.Bounds.Defaulted || defaulted.Bounds.EffectiveLimit != readOnlySearchDefaultLimit {
		t.Fatalf("default bounds = %+v, want the default limit", defaulted.Bounds)
	}
	if defaulted.Bounds.Reported != 3 || defaulted.Bounds.Returned != 3 || defaulted.Bounds.Truncated {
		t.Fatalf("default bounds counts = %+v", defaulted.Bounds)
	}

	small := call(2)
	if small.Bounds.Clamped || small.Bounds.EffectiveLimit != 2 || small.Bounds.Returned != 2 || !small.Bounds.Truncated || small.Bounds.Reported != 3 {
		t.Fatalf("limit=2 bounds = %+v, want a reported 2-of-3 truncation", small.Bounds)
	}
	if len(small.Hits) != 2 {
		t.Fatalf("limit=2 returned %d hits", len(small.Hits))
	}
	if !strings.Contains(searchOutputText(small), "truncated=true") {
		t.Fatalf("text rendering hides the truncation: %s", searchOutputText(small))
	}

	clamped := call(10000)
	if !clamped.Bounds.Clamped || clamped.Bounds.EffectiveLimit != readOnlySearchMaxLimit {
		t.Fatalf("limit=10000 bounds = %+v, want a clamped limit", clamped.Bounds)
	}
	if clamped.Bounds.RequestedLimit != 10000 || clamped.Bounds.Reported != 3 || clamped.Bounds.Truncated {
		t.Fatalf("limit=10000 counts = %+v", clamped.Bounds)
	}

	invalid, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolSearch, Arguments: map[string]any{"query": "anything", "limit": -1},
	})
	if callErr != nil {
		t.Fatalf("negative limit call: %v", callErr)
	}
	if !invalid.IsError || !strings.Contains(contentText(t, invalid), "limit") {
		t.Fatalf("negative limit = %q, want an invalid-input error", contentText(t, invalid))
	}
}

func TestReadOnlyListRecentClampsAndReportsSubjectsOrderingHonestly(t *testing.T) {
	points := []command.SnapshotSummary{
		{SnapshotRef: "snap_old", CreatedAt: "2026-01-01T00:00:00Z", WorkspaceID: "wsp_one", Files: 1, Bytes: 10, ManifestDigest: "sha256:old"},
		{SnapshotRef: "snap_new", CreatedAt: "2026-02-01T00:00:00Z", WorkspaceID: "wsp_one", Files: 2, Bytes: 20, ManifestDigest: "sha256:new"},
	}
	subjects := []command.ContentItemData{
		{SubjectRef: "subj_one", Name: "one.txt", Path: "one.txt", EntryType: "REGULAR_FILE", ContentID: "sha256:one"},
		{SubjectRef: "subj_two", Name: "two.txt", Path: "two.txt", EntryType: "REGULAR_FILE", ContentID: "sha256:two"},
	}
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		switch env.Operation {
		case command.OpSnapshotList:
			return fakeReply{data: command.SnapshotListData{Snapshots: points}}
		case command.OpContentList:
			return fakeReply{data: command.ContentListData{WorkspaceID: "wsp_one", Items: subjects}}
		}
		t.Fatalf("unexpected operation %q", env.Operation)
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	recent, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolListRecent, Arguments: map[string]any{"limit": 1},
	})
	if callErr != nil {
		t.Fatalf("list_recent call: %v", callErr)
	}
	if recent.IsError {
		t.Fatalf("list_recent refused: %s", contentText(t, recent))
	}
	var recentOutput readOnlyRecentOutput
	decodeStructured(t, recent, &recentOutput)
	if recentOutput.Kind != readOnlyRecentKindRestorePoints || len(recentOutput.RestorePoints) != 1 {
		t.Fatalf("restore points = %+v", recentOutput)
	}
	if recentOutput.RestorePoints[0].SnapshotRef != "snap_new" {
		t.Fatalf("newest restore point = %q, want snap_new", recentOutput.RestorePoints[0].SnapshotRef)
	}
	if recentOutput.Bounds.Reported != 2 || recentOutput.Bounds.Returned != 1 || !recentOutput.Bounds.Truncated {
		t.Fatalf("restore point bounds = %+v", recentOutput.Bounds)
	}

	subjectList, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolListRecent, Arguments: map[string]any{"kind": "subjects", "limit": 5000},
	})
	if callErr != nil {
		t.Fatalf("list_recent subjects call: %v", callErr)
	}
	if subjectList.IsError {
		t.Fatalf("list_recent subjects refused: %s", contentText(t, subjectList))
	}
	var subjectOutput readOnlyRecentOutput
	decodeStructured(t, subjectList, &subjectOutput)
	if len(subjectOutput.Subjects) != 2 || subjectOutput.Subjects[0].SubjectRef != "subj_one" {
		t.Fatalf("subjects = %+v", subjectOutput.Subjects)
	}
	if !subjectOutput.Bounds.Clamped || subjectOutput.Bounds.EffectiveLimit != readOnlyRecentMaxLimit {
		t.Fatalf("subject bounds = %+v, want a clamped limit", subjectOutput.Bounds)
	}
	found := false
	for _, note := range subjectOutput.Unavailable {
		if note.State == readOnlyStateNotReported && strings.Contains(note.Reason, "no per-subject timestamp") {
			found = true
		}
	}
	if !found {
		t.Fatalf("subject listing must state that the daemon reports no recency ordering: %+v", subjectOutput.Unavailable)
	}
}

// ---------------------------------------------------------------------------
// honesty: unavailable capabilities and daemon reasons
// ---------------------------------------------------------------------------

func TestReadOnlyReportsDegradedSearchComponentsAndDaemonReasons(t *testing.T) {
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		if env.Operation != command.OpSearchQuery {
			t.Fatalf("unexpected operation %q", env.Operation)
		}
		return fakeReply{
			status: command.StatusDegraded,
			reasons: []command.Reason{{
				Code: "QUERY_PROVIDER_UNAVAILABLE", Class: "DEPENDENCY", Severity: "WARNING",
				Message: "one or more default search components are unavailable; available component results are still returned",
			}},
			data: command.SearchQueryData{
				Provider:        "query.broker.fuse.v1",
				FusedDimensions: []string{"lexical-metadata-fts", "semantic-embedding"},
				Components: []command.SearchComponentData{
					{Dimension: "lexical-metadata-fts", Status: "SUCCEEDED", Hits: 1},
					{Dimension: "semantic-embedding", Status: "UNAVAILABLE", Hits: 0},
				},
				Hits: []command.SearchHitData{{SubjectRef: "subj_one", Path: "one.txt", Name: "one.txt"}},
			},
		}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolSearch, Arguments: map[string]any{"query": "demo"},
	})
	if callErr != nil {
		t.Fatalf("search call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("degraded search must still return its available results: %s", contentText(t, result))
	}
	var output readOnlySearchOutput
	decodeStructured(t, result, &output)
	if output.DaemonStatus != string(command.StatusDegraded) {
		t.Fatalf("daemon_status = %q, want DEGRADED", output.DaemonStatus)
	}
	if len(output.Components) != 2 || output.Components[1].Status != "UNAVAILABLE" {
		t.Fatalf("components = %+v, want the daemon's own component states", output.Components)
	}
	var semanticNote *readOnlyNote
	for index := range output.Unavailable {
		if output.Unavailable[index].Capability == "search_component:semantic-embedding" {
			semanticNote = &output.Unavailable[index]
		}
	}
	if semanticNote == nil || semanticNote.State != "UNAVAILABLE" {
		t.Fatalf("semantic unavailability was not reported: %+v", output.Unavailable)
	}
	if !strings.Contains(searchOutputText(output), "QUERY_PROVIDER_UNAVAILABLE") {
		t.Fatalf("text rendering hides the daemon reason: %s", searchOutputText(output))
	}
}

func TestReadOnlyGetSubjectUsesOnlyReportedFactsAndLabelsSources(t *testing.T) {
	workedOn := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC).Format(time.RFC3339)
	size := int64(51)
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		switch env.Operation {
		case command.OpSnapshotList:
			return fakeReply{data: command.SnapshotListData{Snapshots: []command.SnapshotSummary{
				{SnapshotRef: "snap_one", CreatedAt: workedOn, WorkspaceID: "wsp_one"},
			}}}
		case command.OpContentList:
			return fakeReply{data: command.ContentListData{WorkspaceID: "wsp_one", Items: []command.ContentItemData{{
				SubjectRef: "subj_one", EntryID: "nse_one", Name: "one.txt", Path: "notes/one.txt",
				EntryType: "REGULAR_FILE", ContentID: "sha256:20e3e54a2bfa637ad9dc33005229c00baadfe395e23650ff72d20b79bc042205",
				LogicalSize: &size,
				IndexStatus: &command.ContentIndexStatus{Lexical: "READY", Semantic: "UNAVAILABLE", Tags: "TAGGED"},
			}}}}
		case command.OpNamespaceStat:
			return fakeReply{data: command.NamespaceStatData{Entry: command.NamespaceEntryData{
				ID: "nse_one", SubjectRef: "subj_one", DisplayName: "one.txt", EntryType: "REGULAR_FILE",
				ContentID:     "sha256:20e3e54a2bfa637ad9dc33005229c00baadfe395e23650ff72d20b79bc042205",
				FileVersionID: "fvr_one", LogicalSize: &size,
			}}}
		case command.OpAnnotationList:
			return fakeReply{data: command.AnnotationListData{Annotations: []command.AnnotationData{
				{ID: "ann_tag", SubjectRef: "subj_one", Kind: "TAG", Body: "reviewed", Revision: 2},
				{ID: "ann_note", SubjectRef: "subj_one", Kind: "NOTE", Body: "kept for the report", Revision: 1},
			}}}
		case command.OpRepresentationList:
			return fakeReply{data: command.RepresentationListData{WorkspaceID: "wsp_one", SubjectRef: "subj_one", Representations: []command.RepresentationData{{
				ID: "rep_one", ContentID: "sha256:20e3", Class: "EXACT", Fidelity: "exact",
				CodecProfileRef: "raw/v1", Placement: "present", Authoritative: true,
			}}}}
		case command.OpDescriptionList:
			return fakeReply{data: command.DescriptionListData{Documents: []command.DescriptionSummaryData{{
				ID: "dsc_one", SubjectRef: "subj_one", Kind: "EXTRACTED", Language: "en",
				BodyDigest: "sha256:body", Revision: 1, Accepted: true,
			}}}}
		}
		t.Fatalf("unexpected operation %q", env.Operation)
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolGetSubject, Arguments: map[string]any{"subject_ref": "subj_one"},
	})
	if callErr != nil {
		t.Fatalf("get_subject call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("get_subject refused: %s", contentText(t, result))
	}
	var output readOnlySubjectOutput
	decodeStructured(t, result, &output)
	if !output.Found || output.Content == nil || output.Content.Name != "one.txt" || output.Content.Path != "notes/one.txt" {
		t.Fatalf("subject content = %+v", output.Content)
	}
	if output.Content.LogicalSize == nil || *output.Content.LogicalSize != 51 ||
		output.Content.ContentID != "sha256:20e3e54a2bfa637ad9dc33005229c00baadfe395e23650ff72d20b79bc042205" {
		t.Fatalf("exact identity and length were not reported verbatim: %+v", output.Content)
	}
	if output.Entry == nil || output.Entry.FileVersionID != "fvr_one" {
		t.Fatalf("namespace.stat entry was not included: %+v", output.Entry)
	}
	if len(output.Tags) != 1 || output.Tags[0].Body != "reviewed" || output.Tags[0].Source != "annotation/tag" {
		t.Fatalf("tags = %+v", output.Tags)
	}
	if len(output.Notes) != 1 || output.Notes[0].Body != "kept for the report" || output.Notes[0].Source != "annotation/note" {
		t.Fatalf("notes = %+v", output.Notes)
	}
	if len(output.RecordedTexts) != 1 || output.RecordedTexts[0].Source != "description/extracted" || !output.RecordedTexts[0].Accepted {
		t.Fatalf("recorded texts = %+v", output.RecordedTexts)
	}
	if len(output.Representations) != 1 || !output.Representations[0].Authoritative {
		t.Fatalf("representations = %+v", output.Representations)
	}
	operations := daemon.operations(t)
	want := []string{
		command.OpSnapshotList, command.OpContentList, command.OpNamespaceStat,
		command.OpAnnotationList, command.OpRepresentationList, command.OpDescriptionList,
	}
	if strings.Join(operations, ",") != strings.Join(want, ",") {
		t.Fatalf("get_subject operations = %v, want %v", operations, want)
	}
	found := false
	for _, note := range output.Unavailable {
		if note.Capability == "semantic_search" && note.State == "UNAVAILABLE" {
			found = true
		}
	}
	if !found {
		t.Fatalf("semantic UNAVAILABLE was not surfaced: %+v", output.Unavailable)
	}
}

func TestReadOnlyGetSubjectReportsMissingSubjectAndFailedSteps(t *testing.T) {
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		switch env.Operation {
		case command.OpSnapshotList:
			return fakeReply{data: command.SnapshotListData{Snapshots: []command.SnapshotSummary{
				{SnapshotRef: "snap_one", CreatedAt: "2026-03-01T10:00:00Z", WorkspaceID: "wsp_one"},
			}}}
		case command.OpContentList:
			return fakeReply{data: command.ContentListData{WorkspaceID: "wsp_one", Items: []command.ContentItemData{{
				SubjectRef: "subj_one", EntryID: "nse_one", Name: "one.txt", Path: "one.txt", EntryType: "REGULAR_FILE",
			}}}}
		case command.OpAnnotationList:
			return fakeReply{status: command.StatusFailed, reasons: []command.Reason{{
				Code: "CATALOG_UNAVAILABLE", Class: "DEPENDENCY", Severity: "ERROR", Message: "the catalog is not readable",
			}}}
		case command.OpRepresentationList:
			return fakeReply{status: command.StatusFailed, reasons: []command.Reason{{
				Code: "CONTENT_NOT_AVAILABLE", Class: "DEPENDENCY", Severity: "ERROR", Message: "no representation is recorded",
			}}}
		case command.OpDescriptionList:
			return fakeReply{data: command.DescriptionListData{}}
		}
		t.Fatalf("unexpected operation %q", env.Operation)
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolGetSubject, Arguments: map[string]any{"subject_ref": "subj_missing"},
	})
	if callErr != nil {
		t.Fatalf("get_subject call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("get_subject must still return the facts it could read: %s", contentText(t, result))
	}
	var output readOnlySubjectOutput
	decodeStructured(t, result, &output)
	if output.Found {
		t.Fatalf("missing subject reported as found: %+v", output)
	}
	if output.DaemonStatus != string(command.StatusDegraded) {
		t.Fatalf("daemon_status = %q, want DEGRADED because steps failed", output.DaemonStatus)
	}
	notesByCapability := map[string]readOnlyNote{}
	for _, note := range output.Unavailable {
		notesByCapability[note.Capability] = note
	}
	if note, ok := notesByCapability["subject"]; !ok || note.State != readOnlyStateNotFound {
		t.Fatalf("missing subject was not reported: %+v", output.Unavailable)
	}
	if note, ok := notesByCapability["tags_and_notes"]; !ok || !strings.Contains(note.Reason, "CATALOG_UNAVAILABLE") || !strings.Contains(note.Reason, "catalog is not readable") {
		t.Fatalf("failed annotation.list was not reported with the daemon reason: %+v", output.Unavailable)
	}
	if note, ok := notesByCapability["representations"]; !ok || !strings.Contains(note.Reason, "CONTENT_NOT_AVAILABLE") {
		t.Fatalf("failed representation.list was not reported: %+v", output.Unavailable)
	}
}

func TestReadOnlyReadTextExtractReturnsRecordedTextOrUnavailable(t *testing.T) {
	body := "第一段 recorded text.\n\nsecond paragraph."
	workedOn := "2026-03-01T10:00:00Z"
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		switch env.Operation {
		case command.OpSnapshotList:
			return fakeReply{data: command.SnapshotListData{Snapshots: []command.SnapshotSummary{
				{SnapshotRef: "snap_one", CreatedAt: workedOn, WorkspaceID: "wsp_one"},
			}}}
		case command.OpDescriptionList:
			if subjectRefOf(env) == "subj_absent" {
				return fakeReply{data: command.DescriptionListData{}}
			}
			return fakeReply{data: command.DescriptionListData{Documents: []command.DescriptionSummaryData{
				{ID: "dsc_old", SubjectRef: "subj_one", Kind: "IMPORTED", Revision: 1, CreatedAt: workedOn},
				{ID: "dsc_new", SubjectRef: "subj_one", Kind: "EXTRACTED", Revision: 2, CreatedAt: workedOn},
			}}}
		case command.OpDescriptionGet:
			return fakeReply{data: command.DescriptionGetData{Document: command.DescriptionDocumentData{
				ID: "dsc_new", SubjectRef: "subj_one", Kind: "EXTRACTED", Language: "en",
				Body: body, BodyDigest: "sha256:bodydigest", Revision: 2, Accepted: true, Visibility: "workspace",
				SourceRef: "processor:extract-text/v1",
				Segments: []command.SemanticSegmentData{
					{ID: "seg_1", Ordinal: 0, Text: "第一段 recorded text.", Language: "en"},
					{ID: "seg_2", Ordinal: 1, Text: "second paragraph.", Language: "en"},
				},
			}}}
		}
		t.Fatalf("unexpected operation %q", env.Operation)
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolReadTextExtract, Arguments: map[string]any{"subject_ref": "subj_one", "limit": 1},
	})
	if callErr != nil {
		t.Fatalf("read_text_extract call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("read_text_extract refused: %s", contentText(t, result))
	}
	var output readOnlyTextOutput
	decodeStructured(t, result, &output)
	if !output.Available || output.Document == nil {
		t.Fatalf("recorded text was not returned: %+v", output)
	}
	if output.Document.DescriptionID != "dsc_new" || output.Document.Kind != "EXTRACTED" || output.Document.Source != "description/extracted" {
		t.Fatalf("newest revision was not selected: %+v", output.Document)
	}
	if output.Document.BodyPrefix != body || output.Document.BodyDigest != "sha256:bodydigest" || !output.Document.Untrusted {
		t.Fatalf("body was not returned verbatim with its digest: %+v", output.Document)
	}
	if output.Document.SegmentsReported != 2 || output.Document.SegmentsReturned != 1 {
		t.Fatalf("segment bounds were not reported: %+v", output.Document)
	}
	if len(output.Revisions) != 2 || output.Revisions[0].Source != "description/imported" {
		t.Fatalf("revision source labels = %+v", output.Revisions)
	}

	absent, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolReadTextExtract, Arguments: map[string]any{"subject_ref": "subj_absent"},
	})
	if callErr != nil {
		t.Fatalf("read_text_extract absent call: %v", callErr)
	}
	if absent.IsError {
		t.Fatalf("an absent description is an honest UNAVAILABLE result, not an error: %s", contentText(t, absent))
	}
	var absentOutput readOnlyTextOutput
	decodeStructured(t, absent, &absentOutput)
	if absentOutput.Available {
		t.Fatalf("absent description reported as available: %+v", absentOutput)
	}
	found := false
	for _, note := range absentOutput.Unavailable {
		if note.Capability == "recorded_text" && note.State == readOnlyStateUnavailable {
			found = true
		}
	}
	if !found {
		t.Fatalf("absent description was not reported as unavailable: %+v", absentOutput.Unavailable)
	}
}

func TestReadOnlyReadTextExtractBoundsLongBodiesOnARuneBoundary(t *testing.T) {
	long := strings.Repeat("记忆", readOnlyTextBodyMaxBytes) // far above the cap, multi-byte runes
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		switch env.Operation {
		case command.OpSnapshotList:
			return fakeReply{data: command.SnapshotListData{Snapshots: []command.SnapshotSummary{
				{SnapshotRef: "snap_one", CreatedAt: "2026-03-01T10:00:00Z", WorkspaceID: "wsp_one"},
			}}}
		case command.OpDescriptionList:
			return fakeReply{data: command.DescriptionListData{Documents: []command.DescriptionSummaryData{
				{ID: "dsc_one", SubjectRef: "subj_one", Kind: "EXTRACTED", Revision: 1},
			}}}
		case command.OpDescriptionGet:
			return fakeReply{data: command.DescriptionGetData{Document: command.DescriptionDocumentData{
				ID: "dsc_one", SubjectRef: "subj_one", Kind: "EXTRACTED", Body: long, BodyDigest: "sha256:long", Revision: 1,
			}}}
		}
		t.Fatalf("unexpected operation %q", env.Operation)
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolReadTextExtract, Arguments: map[string]any{"subject_ref": "subj_one"},
	})
	if callErr != nil {
		t.Fatalf("read_text_extract call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("read_text_extract refused: %s", contentText(t, result))
	}
	var output readOnlyTextOutput
	decodeStructured(t, result, &output)
	if output.Document == nil || !output.Document.BodyTruncated {
		t.Fatalf("long body was not reported as truncated: %+v", output.Document)
	}
	if output.Document.BodyBytesReturned > readOnlyTextBodyMaxBytes {
		t.Fatalf("body bound exceeded: %d", output.Document.BodyBytesReturned)
	}
	if !strings.HasPrefix(long, output.Document.BodyPrefix) {
		t.Fatalf("returned prefix is not a prefix of the daemon body")
	}
	if !utf8ValidString(output.Document.BodyPrefix) {
		t.Fatalf("bounded body split a UTF-8 rune")
	}
}

func TestReadOnlyWorkspaceResolutionIsHonestWithoutDurableState(t *testing.T) {
	daemon := startFakeDaemon(t, func(env command.Envelope) fakeReply {
		switch env.Operation {
		case command.OpSnapshotList:
			return fakeReply{data: command.SnapshotListData{}}
		case command.OpStatusGet:
			return fakeReply{data: command.StatusData{Controller: "restoreweaved"}}
		}
		t.Fatalf("unexpected operation %q", env.Operation)
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolListRecent, Arguments: map[string]any{"kind": "subjects"},
	})
	if callErr != nil {
		t.Fatalf("list_recent call: %v", callErr)
	}
	if result.IsError {
		t.Fatalf("an unknown workspace is an honest result, not an error: %s", contentText(t, result))
	}
	var output readOnlyRecentOutput
	decodeStructured(t, result, &output)
	if output.DaemonStatus != string(command.StatusDegraded) {
		t.Fatalf("daemon_status = %q, want DEGRADED", output.DaemonStatus)
	}
	found := false
	for _, note := range output.Unavailable {
		if note.Capability == "workspace" {
			found = true
		}
	}
	if !found {
		t.Fatalf("an unknown workspace was not reported: %+v", output)
	}
	if !strings.Contains(recentOutputText(output), "no published restore point and no recorded plan") {
		t.Fatalf("text rendering hides the unknown workspace: %s", recentOutputText(output))
	}
}

func TestReadOnlySearchRejectsEmptyQueryWithoutDaemonTraffic(t *testing.T) {
	daemon := startFakeDaemon(t, func(command.Envelope) fakeReply {
		t.Fatalf("an empty query must not reach the daemon")
		return fakeReply{}
	})
	conn := daemon.connect(t)
	server, err := NewReadOnly(conn, ReadOnlyOptions{Token: validTestToken(t)})
	if err != nil {
		t.Fatalf("NewReadOnly: %v", err)
	}
	session := connectReadOnlyClient(t, server)

	result, callErr := session.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name: ReadOnlyToolSearch, Arguments: map[string]any{"query": "   "},
	})
	if callErr != nil {
		t.Fatalf("search call: %v", callErr)
	}
	if !result.IsError || !strings.Contains(contentText(t, result), "non-empty query") {
		t.Fatalf("empty query = %q, want an invalid-input refusal", contentText(t, result))
	}
	daemon.requireSilent(t)
}

// ---------------------------------------------------------------------------
// fake daemon
// ---------------------------------------------------------------------------

type fakeReply struct {
	data    any
	status  command.Status
	reasons []command.Reason
}

func defaultFakeReply(env command.Envelope) fakeReply {
	switch env.Operation {
	case command.OpSnapshotList:
		return fakeReply{data: command.SnapshotListData{Snapshots: []command.SnapshotSummary{
			{SnapshotRef: "snap_one", CreatedAt: "2026-03-01T10:00:00Z", WorkspaceID: "wsp_one"},
		}}}
	case command.OpContentList:
		return fakeReply{data: command.ContentListData{WorkspaceID: "wsp_one", Items: []command.ContentItemData{}}}
	case command.OpSearchQuery:
		return fakeReply{data: command.SearchQueryData{Hits: []command.SearchHitData{}}}
	}
	return fakeReply{data: map[string]any{}}
}

type fakeDaemon struct {
	t          *testing.T
	socketPath string
	listener   net.Listener
	respond    func(command.Envelope) fakeReply

	mu        sync.Mutex
	envelopes []command.Envelope
	raw       [][]byte
	wg        sync.WaitGroup
}

var fakeSocketCounter int64

func startFakeDaemon(t *testing.T, respond func(command.Envelope) fakeReply) *fakeDaemon {
	t.Helper()
	// A short path in the system temp directory: a Unix socket path is limited
	// to about 104 bytes on Darwin, and t.TempDir() embeds the test name.
	socketPath := filepath.Join(os.TempDir(),
		fmt.Sprintf("rw-mcp-test-%d-%d.sock", os.Getpid(), atomic.AddInt64(&fakeSocketCounter, 1)))
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	daemon := &fakeDaemon{t: t, socketPath: socketPath, listener: listener, respond: respond}
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			daemon.wg.Add(1)
			go func() {
				defer daemon.wg.Done()
				daemon.serve(conn)
			}()
		}
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		daemon.wg.Wait()
	})
	return daemon
}

func (d *fakeDaemon) serve(conn net.Conn) {
	defer conn.Close()
	for {
		raw, err := transport.ReadFrame(conn, transport.MaxFrameBytes)
		if err != nil {
			return
		}
		var env command.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			return
		}
		d.mu.Lock()
		d.envelopes = append(d.envelopes, env)
		d.raw = append(d.raw, append([]byte(nil), raw...))
		d.mu.Unlock()
		reply := d.respond(env)
		status := reply.status
		if status == "" {
			// A canned reply without an explicit status is a successful one.
			status = command.StatusSucceeded
		}
		started := time.Now()
		result := command.NewResult(env, status, started, started, reply.data, reply.reasons...)
		payload, err := json.Marshal(result)
		if err != nil {
			return
		}
		if err := transport.WriteFrame(conn, payload); err != nil {
			return
		}
	}
}

func (d *fakeDaemon) connect(t *testing.T) *transport.Conn {
	t.Helper()
	conn, err := transport.Dial(d.socketPath)
	if err != nil {
		t.Fatalf("dial fake daemon: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func (d *fakeDaemon) operations(t *testing.T) []string {
	t.Helper()
	d.mu.Lock()
	defer d.mu.Unlock()
	operations := make([]string, 0, len(d.envelopes))
	for _, envelope := range d.envelopes {
		operations = append(operations, envelope.Operation)
	}
	return operations
}

func (d *fakeDaemon) rawEnvelopes(t *testing.T) [][]byte {
	t.Helper()
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([][]byte(nil), d.raw...)
}

func (d *fakeDaemon) requireSilent(t *testing.T) {
	t.Helper()
	if operations := d.operations(t); len(operations) > 0 {
		t.Fatalf("the daemon received operations that must never be sent: %v", operations)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func validTestToken(t *testing.T) ReadOnlyToken {
	t.Helper()
	token, err := ResolveReadOnlyToken(func(name string) string {
		if name == ReadOnlyTokenEnvVar {
			return "readonly-test-token-0123456789"
		}
		return ""
	})
	if err != nil {
		t.Fatalf("resolve test token: %v", err)
	}
	if !token.Configured() {
		t.Fatal("test token must be configured")
	}
	return token
}

func connectReadOnlyClient(t *testing.T, server *mcpsdk.Server) *mcpsdk.ClientSession {
	t.Helper()
	serverRead, clientWrite := io.Pipe()
	clientRead, serverWrite := io.Pipe()
	serverSession, err := server.Connect(context.Background(),
		&mcpsdk.IOTransport{Reader: serverRead, Writer: serverWrite}, nil)
	if err != nil {
		t.Fatalf("server connect: %v", err)
	}
	t.Cleanup(func() { _ = serverSession.Close() })
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "readonly-mcp-test-client", Version: "test"}, nil)
	clientSession, err := client.Connect(context.Background(),
		&mcpsdk.IOTransport{Reader: clientRead, Writer: clientWrite}, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	t.Cleanup(func() { _ = clientSession.Close() })
	return clientSession
}

func decodeStructured(t *testing.T, result *mcpsdk.CallToolResult, into any) {
	t.Helper()
	if result.StructuredContent == nil {
		t.Fatalf("tool result has no structured content: %+v", result)
	}
	encoded, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatalf("encode structured content: %v", err)
	}
	if err := json.Unmarshal(encoded, into); err != nil {
		t.Fatalf("decode structured content: %v", err)
	}
}

func subjectRefOf(env command.Envelope) string {
	var input struct {
		SubjectRef string `json:"subject_ref"`
	}
	_ = json.Unmarshal(env.Input, &input)
	return input.SubjectRef
}

func utf8ValidString(value string) bool { return utf8.ValidString(value) }
