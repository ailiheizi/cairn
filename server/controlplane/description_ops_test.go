package controlplane

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
	"github.com/ailiheizi/cairn/server/testutil"
)

func TestDescriptionCreateReviseListGetAndSegmentSpans(t *testing.T) {
	dispatcher, store := newTestDispatcher(t)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	body := "标题：雪后的城市。\n\n主角在废墟中寻找失落的城市，并记录沿途的线索。"
	created := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id":     seed.WorkspaceID,
		"subject_ref":      seed.FileEntryID,
		"kind":             "user",
		"title":            "用户描述",
		"language":         "zh",
		"body":             body,
		"source_ref":       "user:alice",
		"producer_profile": "operator",
		"confidence":       1.0,
		"coverage":         0.75,
		"accepted":         true,
	}))
	document := assertUnsignedDescriptionDegraded(t, created, body, 1)
	if document.ID == "" || document.Revision != 1 || document.PredecessorID != "" {
		t.Fatalf("created document = %+v", document)
	}
	if document.Kind != "USER" || document.SourceRef != "user:alice" || !document.Accepted {
		t.Fatalf("created provenance = %+v", document)
	}
	if len(document.Segments) == 0 {
		t.Fatal("create returned no segments")
	}
	assertDescriptionSpans(t, body, document.Segments)

	revisedBody := body + "\n\n修订：补充了新的证据。"
	revised := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id":   seed.WorkspaceID,
		"subject_ref":    seed.FileEntryID,
		"kind":           "USER",
		"body":           revisedBody,
		"predecessor_id": document.ID,
	}))
	revisedDocument := assertUnsignedDescriptionDegraded(t, revised, revisedBody, 2)
	if revisedDocument.Revision != 2 || revisedDocument.PredecessorID != document.ID {
		t.Fatalf("revised document = %+v", revisedDocument)
	}
	branch := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id":   seed.WorkspaceID,
		"subject_ref":    seed.FileEntryID,
		"kind":           "USER",
		"body":           "branching revision",
		"predecessor_id": document.ID,
	}))
	if branch.Status != command.StatusFailed || !hasReasonCode(branch, ReasonCodeConflict) {
		t.Fatalf("second successor status = %q reasons = %+v", branch.Status, branch.Reasons)
	}

	listed := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
	}))
	if listed.Status != command.StatusSucceeded {
		t.Fatalf("list status = %q: %+v", listed.Status, listed.Reasons)
	}
	var listData command.DescriptionListData
	if err := json.Unmarshal(listed.Data, &listData); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listData.Documents) != 2 || listData.Documents[0].Revision != 1 || listData.Documents[1].Revision != 2 {
		t.Fatalf("listed documents = %+v", listData.Documents)
	}
	if listData.Documents[0].BodyDigest == "" {
		t.Fatal("list summary omitted body digest")
	}
	encodedList := string(listed.Data)
	if strings.Contains(encodedList, `"body"`) || strings.Contains(encodedList, `"segments"`) {
		t.Fatalf("list unexpectedly contains full body or segments: %s", encodedList)
	}
	limited := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionList, map[string]any{
		"workspace_id": seed.WorkspaceID,
		"subject_ref":  seed.FileEntryID,
		"limit":        1,
	}))
	var limitedData command.DescriptionListData
	if err := json.Unmarshal(limited.Data, &limitedData); err != nil {
		t.Fatalf("decode limited list: %v", err)
	}
	if len(limitedData.Documents) != 1 || !limitedData.Truncated {
		t.Fatalf("limited list = %+v", limitedData)
	}

	got := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionGet, map[string]any{
		"workspace_id":            seed.WorkspaceID,
		"description_document_id": revisedDocument.ID,
	}))
	if got.Status != command.StatusSucceeded {
		t.Fatalf("get status = %q: %+v", got.Status, got.Reasons)
	}
	var getData command.DescriptionGetData
	if err := json.Unmarshal(got.Data, &getData); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	if getData.Document.Body != revisedBody || len(getData.Document.Segments) != len(revisedDocument.Segments) {
		t.Fatalf("got document = %+v", getData.Document)
	}
}

func TestDescriptionCreateRejectsInvalidPredecessorAndInputs(t *testing.T) {
	dispatcher, store := newTestDispatcher(t)
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	for _, input := range []map[string]any{
		{"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID, "kind": "USER", "body": "body", "predecessor_id": "dsc_00000000000000000000000000000000"},
		{"workspace_id": seed.WorkspaceID, "subject_ref": "bad", "kind": "USER", "body": "body"},
		{"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID, "kind": "UNKNOWN", "body": "body"},
		{"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID, "kind": "USER", "body": "  "},
	} {
		result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, input))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("input %+v: status=%q reasons=%+v", input, result.Status, result.Reasons)
		}
	}
	documents, err := store.ListDescriptionDocuments(ctx, seed.WorkspaceID, seed.FileEntryID)
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 0 {
		t.Fatalf("invalid creates inserted documents: %+v", documents)
	}
}

func TestDescriptionOperationsAreAvailableWithoutExactLane(t *testing.T) {
	dispatcher, _ := newTestDispatcher(t)
	for _, operation := range []string{command.OpDescriptionList, command.OpDescriptionGet, command.OpDescriptionCreate} {
		if !dispatcher.implemented[operation] {
			t.Fatalf("%s is not marked implemented", operation)
		}
	}
	capabilities := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpCapabilityList, map[string]any{}))
	if capabilities.Status != command.StatusSucceeded {
		t.Fatalf("capability.list status = %q: %+v", capabilities.Status, capabilities.Reasons)
	}
	var data command.CapabilityListData
	if err := json.Unmarshal(capabilities.Data, &data); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []string{command.OpDescriptionList, command.OpDescriptionGet, command.OpDescriptionCreate} {
		found := false
		for _, capability := range data.Capabilities {
			if capability.Kind == "operation" && capability.ID == operation {
				found = capability.State == command.CapabilityAvailable
			}
		}
		if !found {
			t.Fatalf("%s capability unavailable", operation)
		}
	}
}

func TestDescriptionSegmentationDoesNotPersistWhitespaceOnlyChunks(t *testing.T) {
	body := "intro" + strings.Repeat(" ", descriptionSegmentMaxBytes*2) + "尾声"
	segments := splitDescriptionBody(body)
	if len(segments) == 0 {
		t.Fatal("segmentation returned no chunks")
	}
	for _, segment := range segments {
		if strings.TrimSpace(segment.text) == "" {
			t.Fatalf("whitespace-only segment: %+v", segment)
		}
	}
	if segments[0].start != 0 || segments[len(segments)-1].end != len(body) {
		t.Fatalf("segments do not cover body: first=%+v last=%+v", segments[0], segments[len(segments)-1])
	}
}

func TestDescriptionCreateBindsConfigAndProfileIdentities(t *testing.T) {
	store := testutil.OpenStore(t, ":memory:")
	configDigest := "sha256:description-config-v1"
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn.sock", WithConfigDigest(configDigest))
	seed := testutil.SeedNamespace(t, store)
	result := dispatcher.Handle(context.Background(), mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id":     seed.WorkspaceID,
		"subject_ref":      seed.FileEntryID,
		"kind":             "USER",
		"body":             "bound description",
		"producer_profile": "operator-v1",
	}))
	document := assertUnsignedDescriptionDegraded(t, result, "bound description", 1)
	if document.ConfigDigest != configDigest || document.ProducerProfileDigest == "" {
		t.Fatalf("description binding = %+v", document)
	}
	if len(document.Segments) != 1 || document.Segments[0].DocumentRevision != document.Revision || document.Segments[0].SegmentationProfileDigest != sqlite.DescriptionSegmentationProfileDigestV1 {
		t.Fatalf("segment binding = %+v", document.Segments)
	}
	got, err := store.GetDescriptionDocument(context.Background(), seed.WorkspaceID, document.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ConfigDigest != configDigest || got.ProducerProfileDigest != document.ProducerProfileDigest {
		t.Fatalf("stored description binding = %+v", got)
	}
}

func TestDescriptionConfigSwitchCreatesBoundSuccessor(t *testing.T) {
	store := testutil.OpenStore(t, ":memory:")
	seed := testutil.SeedNamespace(t, store)
	ctx := context.Background()
	firstDispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn-a.sock", WithConfigDigest("sha256:description-config-a"))
	first := firstDispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"kind": "USER", "body": "first revision", "producer_profile": "operator-v1",
	}))
	firstDocument := assertUnsignedDescriptionDegraded(t, first, "first revision", 1)
	secondDispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/cairn-b.sock", WithConfigDigest("sha256:description-config-b"))
	second := secondDispatcher.Handle(ctx, mustEnvelope(t, command.OpDescriptionCreate, map[string]any{
		"workspace_id": seed.WorkspaceID, "subject_ref": seed.FileEntryID,
		"kind": "USER", "body": "second revision", "producer_profile": "operator-v1",
		"predecessor_id": firstDocument.ID,
	}))
	secondDocument := assertUnsignedDescriptionDegraded(t, second, "second revision", 2)
	if firstDocument.ConfigDigest == secondDocument.ConfigDigest || firstDocument.Revision != 1 || secondDocument.Revision != 2 {
		t.Fatalf("config switch did not create distinct bound revisions: first=%+v second=%+v", firstDocument, secondDocument)
	}
	if firstDocument.Segments[0].SegmentationProfileDigest != secondDocument.Segments[0].SegmentationProfileDigest {
		t.Fatalf("segmentation profile unexpectedly changed: first=%+v second=%+v", firstDocument.Segments, secondDocument.Segments)
	}
}

func assertDescriptionSpans(t *testing.T, body string, segments []command.SemanticSegmentData) {
	t.Helper()
	if !utf8.ValidString(body) {
		t.Fatal("test body is not valid UTF-8")
	}
	previousEnd := 0
	for ordinal, segment := range segments {
		if segment.Ordinal != int64(ordinal) {
			t.Fatalf("segment ordinal = %d, want %d", segment.Ordinal, ordinal)
		}
		var span struct {
			StartByte int `json:"start_byte"`
			EndByte   int `json:"end_byte"`
		}
		if err := json.Unmarshal(segment.SourceSpan, &span); err != nil {
			t.Fatalf("segment span %s: %v", segment.ID, err)
		}
		if span.StartByte != previousEnd || span.StartByte < 0 || span.EndByte <= span.StartByte || span.EndByte > len(body) {
			t.Fatalf("segment span = %+v, previous end %d", span, previousEnd)
		}
		if segment.Text != body[span.StartByte:span.EndByte] || !utf8.ValidString(segment.Text) {
			t.Fatalf("segment %d text/span mismatch: %q %+v", ordinal, segment.Text, span)
		}
		previousEnd = span.EndByte
	}
	if previousEnd != len(body) || strings.Join(func() []string {
		texts := make([]string, 0, len(segments))
		for _, segment := range segments {
			texts = append(texts, segment.Text)
		}
		return texts
	}(), "") != body {
		t.Fatalf("segments do not cover body")
	}
}
