package controlplane

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// subject.facts.list is the bounded subject-scoped read of durable typed
// facts. It is the read side of the same metadata_facts rows the processor
// host writes: one workspace, one stable subject, latest revision per key. It
// opens no new store, adds no durable state, and invents no default for a fact
// the subject never declared — an absent fact is simply absent from the answer.

type subjectFactsListInput struct {
	WorkspaceID string `json:"workspace_id"`
	SubjectRef  string `json:"subject_ref"`
	// Namespace is an optional exact filter, for a caller that wants one fact
	// vocabulary (for example cairn.domain.image) instead of all of them.
	Namespace string `json:"namespace,omitempty"`
}

func (d *Dispatcher) handleSubjectFactsList(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.store == nil {
		return unimplementedResult(env, started)
	}
	var input subjectFactsListInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("subject_ref", input.SubjectRef); err != nil {
		return invalidInputResult(env, started, err)
	}
	// An unknown subject is reported as not found rather than as a subject with
	// no facts: "no such subject" and "this subject declares nothing" are
	// different answers and must not be conflated.
	if _, err := d.resolveSubject(ctx, input.WorkspaceID, input.SubjectRef); err != nil {
		if containsNotFound(err) {
			return notFoundResult(env, started, "subject "+input.SubjectRef+" is not present in this workspace")
		}
		return catalogErrorResult(env, started, err)
	}
	records, err := d.store.ListMetadataFacts(ctx, input.WorkspaceID, input.SubjectRef)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	namespace := strings.TrimSpace(input.Namespace)
	latest := make(map[string]struct {
		index    int
		revision int64
	})
	facts := make([]command.SubjectFactData, 0, len(records))
	for _, record := range records {
		if namespace != "" && record.Namespace != namespace {
			continue
		}
		key := record.Namespace + "\x00" + record.Key
		if existing, ok := latest[key]; ok {
			// ListMetadataFacts is ordered by revision, but the latest-revision
			// rule is enforced here explicitly so a reordered query can never
			// present an older revision as current.
			if record.Revision <= existing.revision {
				continue
			}
			facts[existing.index] = projectSubjectFact(record)
			latest[key] = struct {
				index    int
				revision int64
			}{index: existing.index, revision: record.Revision}
			continue
		}
		latest[key] = struct {
			index    int
			revision int64
		}{index: len(facts), revision: record.Revision}
		facts = append(facts, projectSubjectFact(record))
	}
	sort.SliceStable(facts, func(i, j int) bool {
		if facts[i].Namespace != facts[j].Namespace {
			return facts[i].Namespace < facts[j].Namespace
		}
		return facts[i].Key < facts[j].Key
	})
	return succeeded(env, started, command.SubjectFactsData{
		WorkspaceID: input.WorkspaceID,
		SubjectRef:  input.SubjectRef,
		Facts:       facts,
	})
}

func projectSubjectFact(record sqlite.MetadataFact) command.SubjectFactData {
	return command.SubjectFactData{
		MetadataFactID: record.ID,
		SubjectRef:     record.SubjectRef,
		Namespace:      record.Namespace,
		Key:            record.Key,
		ValueJSON:      record.Value,
		ValueType:      record.ValueType,
		AuthorityClass: record.AuthorityClass,
		SourceRef:      record.SourceRef,
		Revision:       record.Revision,
		CreatedAt:      record.CreatedAt.UTC().Format(time.RFC3339),
	}
}
