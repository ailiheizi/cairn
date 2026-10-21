package exact

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ailiheizi/cairn/server/internal/repository"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// SubjectFactPublicationTarget is one authenticated committed parent that
// contains an affected stable subject. The commit digest, rather than a
// catalog publication pointer, is the portable-fact child's parent identity.
type SubjectFactPublicationTarget struct {
	SnapshotRef        string
	ParentCommitDigest string
}

// AnnotationFactMutation identifies the exact committed annotation revision
// whose appearance in every applicable portable successor must be verified.
type AnnotationFactMutation struct {
	AnnotationID string
	SubjectRef   string
	Revision     int64
	BodyDigest   string
	Kind         sqlite.AnnotationKind
	Tombstoned   bool
}

// DescriptionFactMutation identifies the exact immutable description
// revision whose appearance in every applicable portable successor must be
// verified.
type DescriptionFactMutation struct {
	DescriptionID string
	SubjectRef    string
	Revision      int64
	BodyDigest    string
	Accepted      bool
	Visibility    string
}

// SubjectFactMutationEvidence names a mutation joined to a verified child.
type SubjectFactMutationEvidence struct {
	RecordKind     string
	RecordID       string
	SubjectRef     string
	Revision       int64
	BodyDigest     string
	AnnotationKind sqlite.AnnotationKind
	Tombstoned     bool
	Accepted       bool
	Visibility     string
}

// SubjectFactParentEvidence records the exact signed complete-state child that
// covers this parent's mutations. A result is complete only when every target
// has Covered=true and every mutation applicable to it appears in Mutations.
type SubjectFactParentEvidence struct {
	Target          SubjectFactPublicationTarget
	ClosureSequence uint64
	ClosureDigest   string
	BundleDigest    string
	Mutations       []SubjectFactMutationEvidence
	Covered         bool
	Error           string
}

// SubjectFactPublicationResult retains the fixed authenticated target set and
// per-parent results even when a later publication or verification fails.
type SubjectFactPublicationResult struct {
	Targets []SubjectFactPublicationTarget
	Parents []SubjectFactParentEvidence
}

type subjectFactParentChainScan struct {
	chainPresent    bool
	mappedRequested map[string]struct{}
	latestClosure   PortableFactClosureRecord
	latestBundle    portableFactBundle
}

type subjectFactParentTargetScan struct {
	chainPresent    bool
	mappedRequested map[string]struct{}
	mappingErr      error
}

type subjectFactMappingScanError struct {
	err error
}

func (e *subjectFactMappingScanError) Error() string { return e.err.Error() }
func (e *subjectFactMappingScanError) Unwrap() error { return e.err }

// ResolveSubjectFactPublicationTargets authenticates all retained committed
// parents in this service's publication domain and returns exactly those
// whose fully validated portable mappings contain any requested subject.
// Missing chains and legacy mappings without stable-subject identity fail
// closed because they cannot prove non-membership.
func (s *Service) ResolveSubjectFactPublicationTargets(
	ctx context.Context,
	workspaceID string,
	subjectRefs []string,
) ([]SubjectFactPublicationTarget, error) {
	if err := s.requireSignedSubjectFactPublishing(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(workspaceID) == "" {
		return nil, errors.New("workspace ID is required")
	}
	subjects, err := normalizeSubjectFactSubjects(subjectRefs)
	if err != nil {
		return nil, err
	}
	parents, err := s.committedPublications(ctx)
	if err != nil {
		return nil, fmt.Errorf("authenticate committed subject-fact parents: %w", err)
	}
	if len(parents) == 0 {
		return nil, errors.New("no authenticated committed parent can establish subject-fact coverage")
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return nil, fmt.Errorf("authenticated portable subject mappings are unavailable: %w", err)
	}
	parentScans := make([]subjectFactParentTargetScan, len(parents))
	anyChain := false
	for index, parent := range parents {
		scan, err := s.scanSubjectFactParentChain(ctx, driver, parent.CommitDigest, workspaceID, subjects, false)
		if err != nil {
			var mappingErr *subjectFactMappingScanError
			if !errors.As(err, &mappingErr) {
				return nil, fmt.Errorf("authenticated portable subject mappings are unavailable: %w", err)
			}
			parentScans[index].mappingErr = mappingErr.err
		}
		if scan.chainPresent {
			anyChain = true
		}
		parentScans[index].chainPresent = scan.chainPresent
		parentScans[index].mappedRequested = scan.mappedRequested
	}
	if !anyChain {
		return nil, fmt.Errorf("authenticated portable subject mappings are unavailable: %w", errors.New("portable fact closure is unavailable"))
	}
	matched := make([]SubjectFactPublicationTarget, 0, len(parents))
	mappedSubjects := make(map[string]struct{}, len(subjects))
	for index, parent := range parents {
		scan := parentScans[index]
		if !scan.chainPresent {
			return nil, fmt.Errorf("committed parent %s has no authenticated subject mapping chain", parent.CommitDigest)
		}
		if scan.mappingErr != nil {
			return nil, fmt.Errorf("committed parent %s subject mapping: %w", parent.CommitDigest, scan.mappingErr)
		}
		affected := false
		for subject := range subjects {
			if _, ok := scan.mappedRequested[subject]; ok {
				mappedSubjects[subject] = struct{}{}
				affected = true
			}
		}
		if affected {
			matched = append(matched, SubjectFactPublicationTarget{
				SnapshotRef: parent.Commit.SnapshotRef, ParentCommitDigest: parent.CommitDigest,
			})
		}
	}
	for subject := range subjects {
		if _, ok := mappedSubjects[subject]; !ok {
			return nil, fmt.Errorf("affected stable subject %q has no authenticated committed parent mapping", subject)
		}
	}
	// A concurrent root publication must not make the returned set look
	// complete when it was added during enumeration. Root commits are
	// immutable; equality checks the authenticated parent set on both sides.
	current, err := s.committedPublications(ctx)
	if err != nil {
		return nil, fmt.Errorf("recheck authenticated subject-fact parents: %w", err)
	}
	if !sameCommittedParentSet(parents, current) {
		return nil, errors.New("authenticated committed parent set changed during subject-fact resolution")
	}
	sort.Slice(matched, func(i, j int) bool {
		if matched[i].SnapshotRef != matched[j].SnapshotRef {
			return matched[i].SnapshotRef < matched[j].SnapshotRef
		}
		return matched[i].ParentCommitDigest < matched[j].ParentCommitDigest
	})
	return matched, nil
}

// PublishSubjectFactSuccessors publishes the existing signed complete-state
// child for each fixed target and verifies each mutation's exact revision,
// digest and lifecycle in the resulting child. It never mutates catalog facts.
func (s *Service) PublishSubjectFactSuccessors(
	ctx context.Context,
	workspaceID string,
	targets []SubjectFactPublicationTarget,
	annotations []AnnotationFactMutation,
	descriptions []DescriptionFactMutation,
) (SubjectFactPublicationResult, error) {
	result := SubjectFactPublicationResult{Targets: append([]SubjectFactPublicationTarget(nil), targets...)}
	if err := s.requireSignedSubjectFactPublishing(); err != nil {
		return result, err
	}
	mutations, err := validateSubjectFactMutations(workspaceID, annotations, descriptions)
	if err != nil {
		return result, err
	}
	if len(targets) == 0 {
		return result, errors.New("fixed authenticated subject-fact parent targets are required")
	}
	subjects := make([]string, 0, len(mutations))
	for subject := range mutations {
		subjects = append(subjects, subject)
	}
	canonicalTargets, err := s.ResolveSubjectFactPublicationTargets(ctx, workspaceID, subjects)
	if err != nil {
		return result, err
	}
	if !sameSubjectFactTargets(targets, canonicalTargets) {
		return result, errors.New("fixed subject-fact target set is no longer the complete authenticated parent set")
	}
	result.Targets = append([]SubjectFactPublicationTarget(nil), canonicalTargets...)
	result.Parents = make([]SubjectFactParentEvidence, len(canonicalTargets))
	mutationSubjects := make(map[string]struct{}, len(mutations))
	for subject := range mutations {
		mutationSubjects[subject] = struct{}{}
	}
	var publicationErrors []error
	for i, target := range canonicalTargets {
		parentResult := SubjectFactParentEvidence{Target: target}
		result.Parents[i] = parentResult
		if err := s.PublishPortableFactClosure(ctx, workspaceID, target.SnapshotRef, target.ParentCommitDigest); err != nil {
			result.Parents[i].Error = err.Error()
			publicationErrors = append(publicationErrors, fmt.Errorf("publish parent %s: %w", target.ParentCommitDigest, err))
			continue
		}
		driver, err := s.publicationRecordDriver()
		if err != nil {
			result.Parents[i].Error = err.Error()
			publicationErrors = append(publicationErrors, fmt.Errorf("verify parent %s successor: %w", target.ParentCommitDigest, err))
			continue
		}
		scan, err := s.scanSubjectFactParentChain(ctx, driver, target.ParentCommitDigest, workspaceID, mutationSubjects, true)
		if err != nil {
			var mappingErr *subjectFactMappingScanError
			if errors.As(err, &mappingErr) {
				result.Parents[i].Error = mappingErr.err.Error()
				publicationErrors = append(publicationErrors, fmt.Errorf("validate parent %s mappings: %w", target.ParentCommitDigest, mappingErr.err))
			} else {
				result.Parents[i].Error = err.Error()
				publicationErrors = append(publicationErrors, fmt.Errorf("verify parent %s successor: %w", target.ParentCommitDigest, err))
			}
			continue
		}
		if !scan.chainPresent {
			err = errors.New("portable fact successor chain is empty")
			result.Parents[i].Error = err.Error()
			publicationErrors = append(publicationErrors, fmt.Errorf("verify parent %s successor: %w", target.ParentCommitDigest, err))
			continue
		}
		covered, evidence, err := subjectFactMutationEvidence(scan.latestBundle, scan.mappedRequested, mutations)
		if err != nil {
			result.Parents[i].Error = err.Error()
			publicationErrors = append(publicationErrors, fmt.Errorf("verify parent %s mutation facts: %w", target.ParentCommitDigest, err))
			continue
		}
		closureDigest, err := scan.latestClosure.Digest()
		if err != nil {
			result.Parents[i].Error = err.Error()
			publicationErrors = append(publicationErrors, fmt.Errorf("digest parent %s successor: %w", target.ParentCommitDigest, err))
			continue
		}
		result.Parents[i].ClosureSequence = scan.latestClosure.ClosureSequence
		result.Parents[i].ClosureDigest = closureDigest
		result.Parents[i].BundleDigest = scan.latestClosure.BundleDigest
		result.Parents[i].Mutations = evidence
		result.Parents[i].Covered = covered
	}
	if len(publicationErrors) != 0 {
		return result, errors.Join(publicationErrors...)
	}
	// Recheck that no newly retained parent appeared during child publication;
	// if one did, the caller receives evidence for the fixed set but no global
	// coverage success claim.
	currentTargets, err := s.ResolveSubjectFactPublicationTargets(ctx, workspaceID, subjects)
	if err != nil {
		return result, fmt.Errorf("post-publication parent coverage recheck: %w", err)
	}
	if !sameSubjectFactTargets(canonicalTargets, currentTargets) {
		return result, errors.New("authenticated subject-fact parent set changed during successor publication")
	}
	return result, nil
}

func (s *Service) requireSignedSubjectFactPublishing() error {
	if !s.signedPublicationEnabled() {
		return errors.New("subject-fact publication requires signed publication to be enabled")
	}
	if s.SigningIdentity == nil || s.TrustAnchor == nil || strings.TrimSpace(s.PublicationDomain) == "" {
		return errors.New("subject-fact publication requires signing identity, trust anchor, and publication domain")
	}
	if s.Store == nil && s.PublicationFencer == nil {
		return errors.New("subject-fact publication requires a cross-process publication fence")
	}
	if _, err := s.publicationRecordDriver(); err != nil {
		return err
	}
	return nil
}

func normalizeSubjectFactSubjects(values []string) (map[string]struct{}, error) {
	if len(values) == 0 {
		return nil, errors.New("at least one affected stable subject is required")
	}
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value {
			return nil, errors.New("affected stable subject references must be non-empty and trimmed")
		}
		result[value] = struct{}{}
	}
	return result, nil
}

type stableSubjectMappingChainState struct {
	previous map[string][]byte
	subjects map[string]struct{}
}

func (state *stableSubjectMappingChainState) advance(envelope PortableFactClosureEnvelope, workspaceID string) (portableFactBundle, error) {
	if envelope.Closure.WorkspaceID != workspaceID {
		return portableFactBundle{}, errors.New("portable subject mapping workspace differs from requested workspace")
	}
	var bundle portableFactBundle
	if err := decodeStrictRecord(envelope.Bundle, &bundle); err != nil {
		return portableFactBundle{}, fmt.Errorf("decode complete-state bundle: %w", err)
	}
	if bundle.Schema != PortableFactBundleSchemaV2 || bundle.WorkspaceID != workspaceID || bundle.SnapshotRef != envelope.Closure.SnapshotRef {
		return portableFactBundle{}, errors.New("portable mapping lacks authenticated stable-subject identity")
	}
	current := make(map[string][]byte)
	currentSubjects := make(map[string]struct{})
	for _, record := range bundle.Records {
		if record.RecordKind != "SUBJECT_MAPPING" {
			continue
		}
		var mapping subjectMappingPayload
		if err := decodeStrictRecord(record.Payload, &mapping); err != nil {
			return portableFactBundle{}, fmt.Errorf("decode stable subject mapping: %w", err)
		}
		if mapping.WorkspaceID != workspaceID || mapping.NamespaceEntryID == "" || record.RecordID != mapping.NamespaceEntryID || mapping.StableSubjectRef == "" || record.StableSubjectRef != mapping.StableSubjectRef {
			return portableFactBundle{}, errors.New("portable mapping does not bind one stable subject")
		}
		canonical, err := CanonicalJSON(mapping)
		if err != nil {
			return portableFactBundle{}, err
		}
		if _, duplicate := current[mapping.NamespaceEntryID]; duplicate {
			return portableFactBundle{}, fmt.Errorf("namespace entry %q has duplicate authenticated mappings in a committed parent", mapping.NamespaceEntryID)
		}
		current[mapping.NamespaceEntryID] = canonical
		currentSubjects[mapping.StableSubjectRef] = struct{}{}
	}
	if state.previous != nil && !sameMappingSet(state.previous, current) {
		return portableFactBundle{}, errors.New("complete-state successor changed immutable subject mappings")
	}
	state.previous = current
	state.subjects = currentSubjects
	return bundle, nil
}

func (s *Service) scanSubjectFactParentChain(
	ctx context.Context,
	driver repository.RecordDriver,
	parentDigest string,
	workspaceID string,
	requested map[string]struct{},
	retainLatestBundle bool,
) (subjectFactParentChainScan, error) {
	scan := subjectFactParentChainScan{mappedRequested: make(map[string]struct{})}
	state := stableSubjectMappingChainState{}
	err := visitPortableFactClosures(ctx, s.Repo, driver, *s.TrustAnchor, s.PublicationDomain, parentDigest, func(envelope PortableFactClosureEnvelope, _ string) error {
		scan.chainPresent = true
		if retainLatestBundle {
			// A summary is private to this scan. Drop the preceding parsed body
			// before decoding the next visitor item so history bodies are not kept.
			scan.latestBundle = portableFactBundle{}
		}
		bundle, err := state.advance(envelope, workspaceID)
		if err != nil {
			return &subjectFactMappingScanError{err: err}
		}
		matched := make(map[string]struct{})
		for subject := range state.subjects {
			if _, wanted := requested[subject]; wanted {
				matched[subject] = struct{}{}
			}
		}
		scan.mappedRequested = matched
		if retainLatestBundle {
			scan.latestClosure = clonePortableFactClosureRecord(envelope.Closure)
			scan.latestBundle = bundle
		}
		return nil
	})
	return scan, err
}

func clonePortableFactClosureRecord(record PortableFactClosureRecord) PortableFactClosureRecord {
	cloneStrings := func(values []string) []string {
		if values == nil {
			return nil
		}
		return append(make([]string, 0, len(values)), values...)
	}
	cloneBytes := func(value []byte) []byte {
		if value == nil {
			return nil
		}
		return append(make([]byte, 0, len(value)), value...)
	}
	record.RequiredReaderDependencies = cloneStrings(record.RequiredReaderDependencies)
	record.CriticalExtensions = cloneStrings(record.CriticalExtensions)
	record.OptionalExtensions = cloneBytes(record.OptionalExtensions)
	record.Signature = cloneBytes(record.Signature)
	return record
}

func stableSubjectsForParentChain(chain []PortableFactClosureEnvelope, workspaceID string) (map[string]struct{}, error) {
	if len(chain) == 0 {
		return nil, errors.New("authenticated portable fact chain is missing")
	}
	state := stableSubjectMappingChainState{}
	for _, envelope := range chain {
		if _, err := state.advance(envelope, workspaceID); err != nil {
			return nil, err
		}
	}
	return state.subjects, nil
}

func sameMappingSet(a, b map[string][]byte) bool {
	if len(a) != len(b) {
		return false
	}
	for subject, payload := range a {
		if !bytes.Equal(payload, b[subject]) {
			return false
		}
	}
	return true
}

func sameCommittedParentSet(a, b []committedPublication) bool {
	if len(a) != len(b) {
		return false
	}
	left := make([]string, 0, len(a))
	right := make([]string, 0, len(b))
	for _, parent := range a {
		left = append(left, parent.CommitDigest)
	}
	for _, parent := range b {
		right = append(right, parent.CommitDigest)
	}
	sort.Strings(left)
	sort.Strings(right)
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func sameSubjectFactTargets(a, b []SubjectFactPublicationTarget) bool {
	if len(a) != len(b) {
		return false
	}
	left := append([]SubjectFactPublicationTarget(nil), a...)
	right := append([]SubjectFactPublicationTarget(nil), b...)
	less := func(values []SubjectFactPublicationTarget) func(int, int) bool {
		return func(i, j int) bool {
			if values[i].SnapshotRef != values[j].SnapshotRef {
				return values[i].SnapshotRef < values[j].SnapshotRef
			}
			return values[i].ParentCommitDigest < values[j].ParentCommitDigest
		}
	}
	sort.Slice(left, less(left))
	sort.Slice(right, less(right))
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

type subjectFactMutation struct {
	kind        string
	recordID    string
	subjectRef  string
	revision    int64
	bodyDigest  string
	annotation  *AnnotationFactMutation
	description *DescriptionFactMutation
}

func validateSubjectFactMutations(workspaceID string, annotations []AnnotationFactMutation, descriptions []DescriptionFactMutation) (map[string][]subjectFactMutation, error) {
	if strings.TrimSpace(workspaceID) == "" || (len(annotations) == 0 && len(descriptions) == 0) {
		return nil, errors.New("workspace and at least one committed annotation or description revision are required")
	}
	result := make(map[string][]subjectFactMutation)
	seen := make(map[string]struct{}, len(annotations)+len(descriptions))
	for i := range annotations {
		fact := annotations[i]
		if strings.TrimSpace(fact.AnnotationID) == "" || strings.TrimSpace(fact.SubjectRef) == "" || fact.Revision < 1 || !validExactContentID(fact.BodyDigest) {
			return nil, errors.New("annotation fact mutation identity, revision, or body digest is invalid")
		}
		if fact.Kind != sqlite.AnnotationTag && fact.Kind != sqlite.AnnotationNote && fact.Kind != sqlite.AnnotationProgress {
			return nil, errors.New("annotation fact mutation kind is invalid")
		}
		key := "ANNOTATION_REVISION\x00" + fact.AnnotationID + fmt.Sprintf("\x00%d", fact.Revision)
		if _, exists := seen[key]; exists {
			return nil, errors.New("duplicate subject-fact mutation identity")
		}
		seen[key] = struct{}{}
		copy := fact
		result[fact.SubjectRef] = append(result[fact.SubjectRef], subjectFactMutation{
			kind: "ANNOTATION_REVISION", recordID: fact.AnnotationID, subjectRef: fact.SubjectRef,
			revision: fact.Revision, bodyDigest: fact.BodyDigest, annotation: &copy,
		})
	}
	for i := range descriptions {
		fact := descriptions[i]
		if strings.TrimSpace(fact.DescriptionID) == "" || strings.TrimSpace(fact.SubjectRef) == "" || fact.Revision < 1 || !validExactContentID(fact.BodyDigest) || strings.TrimSpace(fact.Visibility) == "" {
			return nil, errors.New("description fact mutation identity, revision, body digest, or visibility is invalid")
		}
		key := "DESCRIPTION_REVISION\x00" + fact.DescriptionID + fmt.Sprintf("\x00%d", fact.Revision)
		if _, exists := seen[key]; exists {
			return nil, errors.New("duplicate subject-fact mutation identity")
		}
		seen[key] = struct{}{}
		copy := fact
		result[fact.SubjectRef] = append(result[fact.SubjectRef], subjectFactMutation{
			kind: "DESCRIPTION_REVISION", recordID: fact.DescriptionID, subjectRef: fact.SubjectRef,
			revision: fact.Revision, bodyDigest: fact.BodyDigest, description: &copy,
		})
	}
	for subject := range result {
		sort.Slice(result[subject], func(i, j int) bool {
			if result[subject][i].kind != result[subject][j].kind {
				return result[subject][i].kind < result[subject][j].kind
			}
			if result[subject][i].recordID != result[subject][j].recordID {
				return result[subject][i].recordID < result[subject][j].recordID
			}
			return result[subject][i].revision < result[subject][j].revision
		})
	}
	return result, nil
}

func subjectFactMutationEvidence(bundle portableFactBundle, members map[string]struct{}, mutations map[string][]subjectFactMutation) (bool, []SubjectFactMutationEvidence, error) {
	wanted := make([]subjectFactMutation, 0)
	for subject, facts := range mutations {
		if _, contains := members[subject]; contains {
			wanted = append(wanted, facts...)
		}
	}
	if len(wanted) == 0 {
		return false, nil, errors.New("fixed target does not contain an affected stable subject")
	}
	found := make(map[string]SubjectFactMutationEvidence, len(wanted))
	for _, record := range bundle.Records {
		for _, expected := range wanted {
			if record.RecordKind != expected.kind || record.StableSubjectRef != expected.subjectRef || record.Revision != expected.revision {
				continue
			}
			switch expected.kind {
			case "ANNOTATION_REVISION":
				var value sqlite.AnnotationRevision
				if err := decodeStrictRecord(record.Payload, &value); err != nil {
					return false, nil, err
				}
				mutation := expected.annotation
				if value.AnnotationID != mutation.AnnotationID || value.SubjectRef != mutation.SubjectRef || value.WorkspaceID != bundle.WorkspaceID || value.Revision != mutation.Revision || value.BodyDigest != mutation.BodyDigest || value.Kind != mutation.Kind || value.Tombstoned != mutation.Tombstoned {
					continue
				}
				found[expected.kind+"\x00"+expected.recordID+fmt.Sprintf("\x00%d", expected.revision)] = SubjectFactMutationEvidence{
					RecordKind: expected.kind, RecordID: record.RecordID, SubjectRef: expected.subjectRef,
					Revision: expected.revision, BodyDigest: value.BodyDigest, AnnotationKind: value.Kind,
					Tombstoned: value.Tombstoned,
				}
			case "DESCRIPTION_REVISION":
				var value descriptionPortablePayload
				if err := decodeStrictRecord(record.Payload, &value); err != nil {
					return false, nil, err
				}
				mutation := expected.description
				if value.ID != mutation.DescriptionID || value.SubjectRef != mutation.SubjectRef || value.WorkspaceID != bundle.WorkspaceID || value.Revision != mutation.Revision || value.BodyDigest != mutation.BodyDigest || value.Accepted != mutation.Accepted || value.Visibility != mutation.Visibility {
					continue
				}
				found[expected.kind+"\x00"+expected.recordID+fmt.Sprintf("\x00%d", expected.revision)] = SubjectFactMutationEvidence{
					RecordKind: expected.kind, RecordID: record.RecordID, SubjectRef: expected.subjectRef,
					Revision: expected.revision, BodyDigest: value.BodyDigest,
					Accepted: value.Accepted, Visibility: value.Visibility,
				}
			}
		}
	}
	evidence := make([]SubjectFactMutationEvidence, 0, len(wanted))
	for _, expected := range wanted {
		key := expected.kind + "\x00" + expected.recordID + fmt.Sprintf("\x00%d", expected.revision)
		item, ok := found[key]
		if !ok {
			return false, nil, fmt.Errorf("successor does not contain committed %s %s revision %d with expected digest and lifecycle", strings.ToLower(expected.kind), expected.recordID, expected.revision)
		}
		evidence = append(evidence, item)
	}
	sort.Slice(evidence, func(i, j int) bool {
		if evidence[i].RecordKind != evidence[j].RecordKind {
			return evidence[i].RecordKind < evidence[j].RecordKind
		}
		if evidence[i].RecordID != evidence[j].RecordID {
			return evidence[i].RecordID < evidence[j].RecordID
		}
		return evidence[i].Revision < evidence[j].Revision
	})
	return true, evidence, nil
}
