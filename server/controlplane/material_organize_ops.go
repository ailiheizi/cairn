package controlplane

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/search"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

type materialOrganizeEgressAuditSink struct{ store *sqlite.Store }

func NewMaterialOrganizeEgressAuditSink(store *sqlite.Store) search.MaterialOrganizeEgressAuditSink {
	return materialOrganizeEgressAuditSink{store: store}
}

func (s materialOrganizeEgressAuditSink) RecordMaterialOrganizeEgress(ctx context.Context, record search.MaterialOrganizeEgressRecord) error {
	if s.store == nil {
		return errors.New("material organizer audit ledger is unavailable")
	}
	workspaceID, err := semanticEgressWorkspaceID(ctx, s.store)
	if err != nil {
		return err
	}
	details, err := json.Marshal(record)
	if err != nil {
		return err
	}
	action, outcome := "MATERIAL_ORGANIZE_EGRESS_FAILED", search.SemanticEgressOutcomeFailed
	if record.Outcome == "RESPONSE_RECEIVED" {
		action, outcome = "MATERIAL_ORGANIZE_RESPONSE_RECEIVED", search.SemanticEgressOutcomeSucceeded
	}
	return s.store.Update(ctx, func(tx *sqlite.Tx) error {
		event := sqlite.AuditEvent{ID: mustAuditID(), WorkspaceID: workspaceID, Actor: auditActorSemanticEgress, Action: action, TargetType: "MATERIAL_ORGANIZER", TargetID: record.ProviderProfile, RequestID: record.RequestDigest, Source: "material.organize", Outcome: outcome, Details: details, OccurredAt: time.Now().UTC()}
		return tx.AppendAuditEvent(ctx, &event)
	})
}

type materialListWire struct {
	Format string `json:"format"`
	Title  string `json:"title"`
	Guide  *struct {
		Name        string           `json:"name"`
		Body        string           `json:"body"`
		ContentID   string           `json:"content_id"`
		LogicalSize int64            `json:"logical_size"`
		Source      *materialRefWire `json:"source,omitempty"`
	} `json:"guide,omitempty"`
	Items []struct {
		Ref     materialRefWire   `json:"ref"`
		Label   string            `json:"label"`
		Context map[string]string `json:"context,omitempty"`
	} `json:"items"`
}
type materialRefWire struct {
	ContentID   string `json:"content_id"`
	LogicalSize int64  `json:"logical_size"`
	EntryID     string `json:"entry_id,omitempty"`
	SubjectRef  string `json:"subject_ref,omitempty"`
}

func strictMaterialJSON(raw []byte, max int64) (materialListWire, error) {
	var doc materialListWire
	if int64(len(raw)) == 0 || int64(len(raw)) > max || !utf8.Valid(raw) {
		return doc, errors.New("material-list JSON is empty, invalid UTF-8, or exceeds its byte limit")
	}
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		return doc, err
	}
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(raw, &shape); err != nil {
		return doc, errors.New("material-list JSON must be an object")
	}
	if err := requireExactMaterialKeys(shape, "format", "title", "guide", "items"); err != nil {
		return doc, err
	}
	for _, key := range []string{"format", "title", "items"} {
		if _, ok := shape[key]; !ok {
			return doc, fmt.Errorf("material-list JSON is missing %s", key)
		}
	}
	var itemShapes []json.RawMessage
	if err := json.Unmarshal(shape["items"], &itemShapes); err != nil {
		return doc, errors.New("material-list items must be an array")
	}
	for _, rawItem := range itemShapes {
		var item map[string]json.RawMessage
		if err := json.Unmarshal(rawItem, &item); err != nil {
			return doc, errors.New("material-list item must be an object")
		}
		if err := requireExactMaterialKeys(item, "ref", "label", "context"); err != nil {
			return doc, err
		}
		for _, key := range []string{"ref", "label"} {
			if _, ok := item[key]; !ok {
				return doc, fmt.Errorf("material-list item is missing %s", key)
			}
		}
		var ref map[string]json.RawMessage
		if err := json.Unmarshal(item["ref"], &ref); err != nil {
			return doc, errors.New("material reference must be an object")
		}
		if err := requireExactMaterialKeys(ref, "content_id", "logical_size", "entry_id", "subject_ref"); err != nil {
			return doc, err
		}
		for _, key := range []string{"content_id", "logical_size"} {
			if _, ok := ref[key]; !ok {
				return doc, fmt.Errorf("material reference is missing %s", key)
			}
		}
		if err := validatePresentMaterialHints(ref); err != nil {
			return doc, err
		}
	}
	if guideRaw, ok := shape["guide"]; ok {
		var guide map[string]json.RawMessage
		if err := json.Unmarshal(guideRaw, &guide); err != nil {
			return doc, errors.New("material-list guide must be an object")
		}
		if err := requireExactMaterialKeys(guide, "name", "body", "content_id", "logical_size", "source"); err != nil {
			return doc, err
		}
		for _, key := range []string{"name", "body", "content_id", "logical_size"} {
			if _, ok := guide[key]; !ok {
				return doc, fmt.Errorf("material-list guide is missing %s", key)
			}
		}
		if sourceRaw, ok := guide["source"]; ok {
			var source map[string]json.RawMessage
			if err := json.Unmarshal(sourceRaw, &source); err != nil {
				return doc, errors.New("guide source must be an object")
			}
			if err := requireExactMaterialKeys(source, "content_id", "logical_size", "entry_id", "subject_ref"); err != nil {
				return doc, err
			}
			for _, key := range []string{"content_id", "logical_size"} {
				if _, ok := source[key]; !ok {
					return doc, fmt.Errorf("guide source is missing %s", key)
				}
			}
			if err := validatePresentMaterialHints(source); err != nil {
				return doc, err
			}
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&doc); err != nil {
		return doc, fmt.Errorf("invalid material-list JSON: %w", err)
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return doc, errors.New("material-list JSON has trailing data")
	}
	if doc.Format != "cairn.material-list.v1" || strings.TrimSpace(doc.Title) == "" || len([]rune(doc.Title)) > 160 || len(doc.Items) > search.OnlineOrganizeMaxOccurrences {
		return doc, errors.New("material-list format, title, or occurrence count is invalid")
	}
	for _, it := range doc.Items {
		if err := validateWireRef(it.Ref); err != nil {
			return doc, err
		}
		if len([]rune(it.Label)) > 512 || len(it.Context) > 32 {
			return doc, errors.New("material-list label or context exceeds its limit")
		}
		for k, v := range it.Context {
			if strings.TrimSpace(k) == "" || len([]byte(v)) > 16<<10 {
				return doc, errors.New("material-list context is invalid or exceeds its limit")
			}
		}
	}
	if g := doc.Guide; g != nil {
		if strings.TrimSpace(g.Name) == "" || len([]byte(g.Body)) > 64<<10 || g.ContentID == "" || g.LogicalSize < 0 {
			return doc, errors.New("material-list guide is invalid or exceeds its limit")
		}
		guideDigest := sha256.Sum256([]byte(g.Body))
		if g.ContentID != "sha256:"+hex.EncodeToString(guideDigest[:]) || int64(len([]byte(g.Body))) != g.LogicalSize {
			return doc, errors.New("material-list guide body does not match its exact content identity and length")
		}
		if g.Source != nil {
			if err := validateWireRef(*g.Source); err != nil {
				return doc, err
			}
			if g.Source.ContentID != g.ContentID || g.Source.LogicalSize != g.LogicalSize {
				return doc, errors.New("guide source identity does not match guide text")
			}
		}
	}
	return doc, nil
}

func requireExactMaterialKeys(object map[string]json.RawMessage, allowed ...string) error {
	set := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		set[key] = struct{}{}
	}
	for key := range object {
		if _, ok := set[key]; !ok {
			return fmt.Errorf("material-list JSON contains unsupported or case-aliased key %q", key)
		}
	}
	return nil
}

func validatePresentMaterialHints(ref map[string]json.RawMessage) error {
	for _, key := range []string{"entry_id", "subject_ref"} {
		raw, present := ref[key]
		if !present {
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil || strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
			return fmt.Errorf("material reference %s, when present, must be a nonblank string", key)
		}
	}
	return nil
}

func rejectDuplicateJSONKeys(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var walk func() error
	walk = func() error {
		tok, err := d.Token()
		if err != nil {
			return err
		}
		if tok == nil {
			return errors.New("material-list JSON must not contain null values")
		}
		delim, ok := tok.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, err := d.Token()
				if err != nil {
					return err
				}
				key, ok := k.(string)
				if !ok || seen[key] {
					return errors.New("material-list JSON contains a duplicate or invalid object key")
				}
				seen[key] = true
				if err := walk(); err != nil {
					return err
				}
			}
			_, err = d.Token()
			return err
		case '[':
			for d.More() {
				if err := walk(); err != nil {
					return err
				}
			}
			_, err = d.Token()
			return err
		default:
			return errors.New("material-list JSON contains an invalid delimiter")
		}
	}
	if err := walk(); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("material-list JSON has trailing data")
	}
	return nil
}

func validateWireRef(ref materialRefWire) error {
	if len(ref.ContentID) != 71 || !strings.HasPrefix(ref.ContentID, "sha256:") {
		return errors.New("material reference content_id must be a lowercase SHA-256 identity")
	}
	if strings.ToLower(ref.ContentID) != ref.ContentID {
		return errors.New("material reference content_id must be a lowercase SHA-256 identity")
	}
	if _, err := hex.DecodeString(strings.TrimPrefix(ref.ContentID, "sha256:")); err != nil {
		return errors.New("material reference content_id must be a lowercase SHA-256 identity")
	}
	if ref.LogicalSize < 0 || ref.LogicalSize > 9007199254740991 {
		return errors.New("material reference logical_size is outside the safe integer range")
	}
	if (ref.EntryID != "" && strings.TrimSpace(ref.EntryID) != ref.EntryID) || (ref.SubjectRef != "" && strings.TrimSpace(ref.SubjectRef) != ref.SubjectRef) {
		return errors.New("material reference hints must not contain surrounding whitespace")
	}
	return nil
}

func (d *Dispatcher) handleMaterialOrganize(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.materialOrganizer == nil {
		return unimplementedResult(env, started)
	}
	if !d.materialOrganizeMu.TryLock() {
		return invalidInputResult(env, started, errString("a material organizer request is already in flight"))
	}
	defer d.materialOrganizeMu.Unlock()
	var input command.MaterialOrganizeInput
	if err := decodeStrictOperationInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		return namespaceLookupResult(env, started, err)
	}
	raw := []byte(input.DocumentJSON)
	if int64(len(raw)) > search.OnlineOrganizeMaxInputBytes {
		return invalidInputResult(env, started, errString("document_json exceeds 128 KiB"))
	}
	h := sha256.Sum256(raw)
	digest := "sha256:" + hex.EncodeToString(h[:])
	if input.BaseDigest != digest {
		return invalidInputResult(env, started, errString("base_digest does not match exact document_json bytes"))
	}
	doc, err := strictMaterialJSON(raw, search.OnlineOrganizeMaxInputBytes)
	if err != nil {
		return invalidInputResult(env, started, errString(err.Error()))
	}
	entries, err := d.store.ListLatestNamespaceContent(ctx, input.WorkspaceID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	refs := make([]materialRefWire, 0, len(doc.Items)+1)
	for _, it := range doc.Items {
		refs = append(refs, it.Ref)
	}
	if doc.Guide != nil && doc.Guide.Source != nil {
		refs = append(refs, *doc.Guide.Source)
	}
	var outcomes []search.EgressSubjectOutcome
	for _, ref := range refs {
		entry, findErr := findMaterialEntry(entries, ref)
		if findErr != nil {
			return invalidInputResult(env, started, errString(findErr.Error()))
		}
		rec, protectErr := d.store.GetProtectionRecordBySubject(ctx, input.WorkspaceID, entry.SubjectRef)
		if protectErr != nil {
			return invalidInputResult(env, started, errString("every referenced subject must have an admitted protection record"))
		}
		if entry.LogicalSize == nil || rec.ExpectedContentID != entry.ContentID || rec.ExpectedLogicalLength == nil || *rec.ExpectedLogicalLength != *entry.LogicalSize {
			return invalidInputResult(env, started, errString("the current protection record does not bind the referenced exact content identity"))
		}
		class, reason, _ := egressClassForProtection(rec.Outcome)
		if reason != "" {
			return invalidInputResult(env, started, errString("a referenced subject is not admitted for remote disclosure"))
		}
		outcomes = append(outcomes, search.EgressSubjectOutcome{SubjectID: entry.SubjectRef, Class: class})
	}
	c := input.EgressConfirmation
	if c.ProfileID == "" || c.ProfileDigest == "" || c.EndpointHost == "" || c.Model == "" || c.GrantID == "" || c.Purpose != search.EgressPurposeOrganize {
		return invalidInputResult(env, started, errString("complete egress_confirmation for ORGANIZE is required"))
	}
	confirmation := search.SemanticEgressConfirmation{ProviderProfileID: c.ProfileID, ProfileDigest: c.ProfileDigest, EndpointHost: c.EndpointHost, ModelID: c.Model, GrantID: c.GrantID, Purpose: search.SemanticEmbeddingPurpose(search.EgressPurposeOrganize)}
	confirmation.ContentDigest = digest
	request := search.MaterialOrganizeRequest{WorkspaceID: input.WorkspaceID, DocumentJSON: input.DocumentJSON, BaseDigest: digest, SubjectOutcomes: outcomes, Confirmation: confirmation}
	ctx = search.WithEgressWorkspaceID(ctx, input.WorkspaceID)
	result, err := d.materialOrganizer.Organize(ctx, request)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	profile := d.materialOrganizer.Profile()
	if result.ProfileID != d.materialOrganizeProfileID || result.ProfileID != profile.ProfileID || result.ProfileDigest != profile.ProviderProfileDigest() || result.BaseDigest != digest {
		return invalidInputResult(env, started, errString("organizer result is not bound to the selected profile and exact submitted draft"))
	}
	candidateLimit := profile.MaxOutputBytes
	if candidateLimit > search.OnlineOrganizeMaxOutputBytes {
		candidateLimit = search.OnlineOrganizeMaxOutputBytes
	}
	candidate, err := strictMaterialJSON([]byte(result.CandidateJSON), candidateLimit)
	if err != nil {
		return catalogErrorResult(env, started, fmt.Errorf("organizer response was not a valid material list: %w", err))
	}
	allowed := map[string]bool{}
	for _, it := range doc.Items {
		allowed[materialRefKey(it.Ref)] = true
	}
	for _, it := range candidate.Items {
		key := materialRefKey(it.Ref)
		if !allowed[key] {
			return invalidInputResult(env, started, errString("candidate contains a reference not present in the submitted draft"))
		}
	}
	if candidate.Guide != nil && (doc.Guide == nil || candidate.Guide.Name != doc.Guide.Name || candidate.Guide.Body != doc.Guide.Body || candidate.Guide.ContentID != doc.Guide.ContentID || candidate.Guide.LogicalSize != doc.Guide.LogicalSize || !sameOptionalMaterialRef(candidate.Guide.Source, doc.Guide.Source)) {
		return invalidInputResult(env, started, errString("candidate changed the submitted guide"))
	}
	candidate.Guide = doc.Guide
	encoded, err := json.MarshalIndent(candidate, "", "  ")
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	encoded = append(encoded, '\n')
	if int64(len(encoded)) > candidateLimit {
		return invalidInputResult(env, started, errString("normalized candidate exceeds the active profile or operation output limit"))
	}
	return succeeded(env, started, command.MaterialOrganizeData{CandidateJSON: string(encoded), BaseDigest: digest, ProfileID: result.ProfileID, ProfileDigest: result.ProfileDigest})
}

func materialRefKey(ref materialRefWire) string { raw, _ := json.Marshal(ref); return string(raw) }
func sameOptionalMaterialRef(a, b *materialRefWire) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return materialRefKey(*a) == materialRefKey(*b)
}
func findMaterialEntry(entries []sqlite.NamespaceEntry, ref materialRefWire) (sqlite.NamespaceEntry, error) {
	var match *sqlite.NamespaceEntry
	for i := range entries {
		e := &entries[i]
		if e.EntryType != sqlite.EntryFile || e.ContentID != ref.ContentID || e.LogicalSize == nil || *e.LogicalSize != ref.LogicalSize {
			continue
		}
		if ref.EntryID != "" && e.ID != ref.EntryID {
			continue
		}
		if ref.SubjectRef != "" && e.SubjectRef != ref.SubjectRef {
			continue
		}
		if match == nil {
			match = e
		}
	}
	if match == nil {
		return sqlite.NamespaceEntry{}, errors.New("a submitted reference is not present in the current loaded workspace scope")
	}
	return *match, nil
}
