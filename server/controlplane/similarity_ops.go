package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/ailiheizi/cairn/client/command"
	"github.com/ailiheizi/cairn/server/internal/processor"
	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// Optional similarity scan and candidate groups.
//
// Frozen rule, enforced by construction in this file: similarity NEVER
// establishes exact identity and NEVER authorizes deletion. Exact
// whole-content deduplication (SHA-256 plus logical length) remains the only
// identity grouping. A scan reads admitted bytes, computes a perceptual hash,
// and stores one durable immutable artifact per subject; it never touches
// protection records, content identity, recovery state, or representations.
// Candidate groups are a review projection over those artifacts; they carry
// no delete, merge, or keep-one action and add or remove no member anywhere.
//
// Image candidates: 64-bit dHash over a fixed 9x8 grayscale preprocess,
// grouped by connected components over pairwise Hamming distance <= the
// stated threshold. Audio candidates: normalized declared artist + title
// plus declared duration within 2 seconds; every audio group is labelled
// DECLARED_TRACK_FACTS because the grouping is metadata-derived, never
// content-derived.

// similarityScanInput is the similarity.scan input. maxSubjects bounds one
// explicit scan; the default keeps the operation bounded without a config key.
type similarityScanInput struct {
	WorkspaceID string `json:"workspace_id"`
	Kind        string `json:"kind"`
	MaxSubjects int    `json:"max_subjects,omitempty"`
}

// similarityGroupsInput is the similarity.groups input. maxDistance is the
// Hamming threshold out of 64 bits for image candidates; the default is
// command.DefaultSimilarityMaxDistance.
type similarityGroupsInput struct {
	WorkspaceID string `json:"workspace_id"`
	Kind        string `json:"kind"`
	MaxDistance int    `json:"max_distance,omitempty"`
}

// handleSimilarity is the single dispatch target for both operations. The
// dispatcher marks them implemented only when the exact lane (and therefore
// the repository the scan reads through) is wired.
func (d *Dispatcher) handleSimilarity(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	switch env.Operation {
	case command.OpSimilarityScan:
		return d.handleSimilarityScan(ctx, env, started)
	case command.OpSimilarityGroups:
		return d.handleSimilarityGroups(ctx, env, started)
	default:
		return unimplementedResult(env, started)
	}
}

func (d *Dispatcher) handleSimilarityScan(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil || d.exact.Repo == nil {
		return unimplementedResult(env, started)
	}
	var input similarityScanInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	kind := strings.TrimSpace(input.Kind)
	if kind != command.SimilarityKindImage && kind != command.SimilarityKindAudio {
		return invalidInputResult(env, started, errString("kind must be \"image\" or \"audio\""))
	}
	bound := input.MaxSubjects
	if bound == 0 {
		bound = command.DefaultSimilarityScanSubjects
	}
	if bound < 1 || bound > command.MaxSimilarityScanSubjects {
		return invalidInputResult(env, started, errString(fmt.Sprintf("max_subjects must be between 1 and %d", command.MaxSimilarityScanSubjects)))
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		return namespaceLookupResult(env, started, err)
	}
	// Like content.list, the scan is scoped to a workspace with committed
	// content; an unpublished workspace cannot be scanned.
	if _, err := d.store.LatestPublication(ctx, input.WorkspaceID); err != nil {
		return namespaceLookupResult(env, started, err)
	}
	entries, err := d.store.ListLatestNamespaceContent(ctx, input.WorkspaceID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	population := similarityPopulation(entries)
	var data command.SimilarityScanData
	if kind == command.SimilarityKindImage {
		data, err = d.scanImageSimilarity(ctx, input.WorkspaceID, population, bound)
	} else {
		data, err = d.scanAudioSimilarity(ctx, input.WorkspaceID, population, bound)
	}
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, data)
}

func (d *Dispatcher) handleSimilarityGroups(ctx context.Context, env command.Envelope, started time.Time) command.Result {
	if d.exact == nil || d.exact.Repo == nil {
		return unimplementedResult(env, started)
	}
	var input similarityGroupsInput
	if err := decodeInput(env.Input, &input); err != nil {
		return invalidInputResult(env, started, err)
	}
	if err := requireStableID("workspace_id", input.WorkspaceID); err != nil {
		return invalidInputResult(env, started, err)
	}
	kind := strings.TrimSpace(input.Kind)
	if kind != command.SimilarityKindImage && kind != command.SimilarityKindAudio {
		return invalidInputResult(env, started, errString("kind must be \"image\" or \"audio\""))
	}
	maxDistance := input.MaxDistance
	if maxDistance == 0 && !hasJSONField(env.Input, "max_distance") {
		maxDistance = command.DefaultSimilarityMaxDistance
	}
	if maxDistance < 0 || maxDistance > processor.PerceptualHashBits {
		return invalidInputResult(env, started, errString(fmt.Sprintf("max_distance must be between 0 and %d", processor.PerceptualHashBits)))
	}
	if _, err := d.store.GetWorkspace(ctx, input.WorkspaceID); err != nil {
		return namespaceLookupResult(env, started, err)
	}
	entries, err := d.store.ListLatestNamespaceContent(ctx, input.WorkspaceID)
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	population := similarityPopulation(entries)
	var data command.SimilarityGroupsData
	if kind == command.SimilarityKindImage {
		data, err = d.imageSimilarityGroups(ctx, input.WorkspaceID, population, maxDistance)
	} else {
		data, err = d.audioSimilarityGroups(ctx, input.WorkspaceID, population)
	}
	if err != nil {
		return catalogErrorResult(env, started, err)
	}
	return succeeded(env, started, data)
}

// hasJSONField reports whether the raw input explicitly carried a field, so a
// caller can distinguish "default it" from "explicitly zero".
func hasJSONField(raw json.RawMessage, field string) bool {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return false
	}
	_, ok := payload[field]
	return ok
}

// similarityPopulation is the scan population: the current regular-file
// subjects of the workspace listing, in stable subject order. Names, paths,
// and media types never establish identity; they only bound and label this
// read-only projection.
func similarityPopulation(entries []sqlite.NamespaceEntry) []sqlite.NamespaceEntry {
	population := make([]sqlite.NamespaceEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.EntryType != sqlite.EntryFile || strings.TrimSpace(entry.ContentID) == "" {
			continue
		}
		population = append(population, entry)
	}
	sort.Slice(population, func(i, j int) bool {
		return population[i].SubjectRef < population[j].SubjectRef
	})
	return population
}

// scanImageSimilarity reads each bounded subject's bytes through the
// repository image content source (which re-hashes and refuses a mismatched
// identity), computes the perceptual hash, and stores one durable immutable
// artifact. A subject that cannot be hashed is an explicit skip with a
// reason, never a guess.
func (d *Dispatcher) scanImageSimilarity(ctx context.Context, workspaceID string, population []sqlite.NamespaceEntry, bound int) (command.SimilarityScanData, error) {
	data := command.SimilarityScanData{
		WorkspaceID: workspaceID, Kind: command.SimilarityKindImage, SubjectBound: bound,
		Considered: len(population), NotContentIdentity: true,
		Skipped:    []command.SimilaritySkippedItem{},
		SkipCounts: map[string]int{},
		NotScanned: []command.SimilarityNotScannedItem{},
	}
	// Snapshot provenance: the artifact binds to the publication whose
	// namespace the subject was listed from, so a later scan under a newer
	// publication writes a new artifact instead of rewriting history.
	snapshotByRoot, err := d.latestSnapshotByNamespaceRoot(ctx, workspaceID)
	if err != nil {
		return data, err
	}
	// Idempotency: one admitted artifact per (workspace, snapshot, subject,
	// stage, capability) is enforced by the catalog's live index. A subject
	// that already carries the hash artifact for the current bytes is scanned
	// without writing anything new.
	existing, err := d.currentImageHashes(ctx, workspaceID, population)
	if err != nil {
		return data, err
	}
	source := NewRepositoryImageContentSource(d.exact.Repo, 0)
	routeDigest := processor.Route{
		Kind:  processor.RouteProcessing,
		Nodes: []processor.RouteNode{{Stage: processor.StageFingerprint, CapabilityID: processor.CapabilityImagePerceptualHash}},
	}.Digest()
	for index, entry := range population {
		if index >= bound {
			data.NotScannedCount++
			data.NotScanned = appendBoundedNotScanned(data.NotScanned, entry, command.SimilaritySkipSubjectBound, &data.NotScannedOmitted)
			continue
		}
		if _, ok := existing[entry.SubjectRef]; ok {
			// Already scanned: the current bytes have a durable hash.
			data.ScannedCount++
			continue
		}
		content, err := source.ReadImageContent(ctx, entry.ContentID)
		if err != nil {
			data.SkipCounts[command.SimilaritySkipImageReadFailed]++
			data.Skipped = appendBoundedSkipped(data.Skipped, entry, command.SimilaritySkipImageReadFailed, err.Error(), &data.SkippedOmitted)
			continue
		}
		if !admittedPerceptualDecoder(content.MediaType) {
			reason := command.SimilaritySkipNotAnImage
			if strings.HasPrefix(content.MediaType, "image/") {
				reason = command.SimilaritySkipUnsupportedImageFormat
			}
			data.SkipCounts[reason]++
			data.Skipped = appendBoundedSkipped(data.Skipped, entry, reason, content.MediaType, &data.SkippedOmitted)
			continue
		}
		hash, width, height, err := processor.HashImagePerceptual(content.Bytes)
		if err != nil {
			data.SkipCounts[command.SimilaritySkipImageDecodeFailed]++
			data.Skipped = appendBoundedSkipped(data.Skipped, entry, command.SimilaritySkipImageDecodeFailed, err.Error(), &data.SkippedOmitted)
			continue
		}
		body, err := json.Marshal(processor.PerceptualHashRecord{
			Algorithm:          processor.PerceptualHashAlgorithmDHash64,
			Version:            "1",
			HashHex:            processor.FormatPerceptualHash(hash),
			Width:              width,
			Height:             height,
			SourceContentID:    entry.ContentID,
			LogicalLength:      int64(len(content.Bytes)),
			NotContentIdentity: true,
		})
		if err != nil {
			return data, err
		}
		artifactID, err := sqlite.NewStableID(sqlite.IDPrefixArtifact)
		if err != nil {
			return data, err
		}
		envelope, err := json.Marshal(map[string]any{
			"schema_ref":        processor.SchemaRefPerceptualHash(),
			"determinism_class": processor.DeterminismByteExact,
			"capability_id":     processor.CapabilityImagePerceptualHash,
			"source_content_id": entry.ContentID,
			"logical_length":    len(content.Bytes),
			"origin":            "similarity.scan",
			"fence_token":       1,
		})
		if err != nil {
			return data, err
		}
		artifact := &sqlite.ProcessorArtifact{
			ID:             artifactID,
			WorkspaceID:    workspaceID,
			SubjectRef:     entry.SubjectRef,
			SnapshotRef:    snapshotByRoot[entry.RootID],
			RouteDigest:    routeDigest,
			Stage:          string(processor.StageFingerprint),
			CapabilityID:   processor.CapabilityImagePerceptualHash,
			SchemaRef:      processor.SchemaRefPerceptualHash(),
			State:          sqlite.ArtifactAdmitted,
			AuthorityClass: processor.AuthorityStagedArtifact,
			LifecycleClass: processor.LifecycleRebuildable,
			MediaType:      processor.MediaTypeFingerprintJSON,
			ByteLength:     int64(len(body)),
			Digest:         sha256DigestHex(body),
			Body:           string(body),
			AttemptID:      "",
			FenceToken:     1,
			ProducerDigest: processor.ProducerDigest(processor.CapabilityImagePerceptualHash),
			Envelope:       envelope,
			CreatedAt:      d.now().UTC(),
		}
		if err := d.store.InsertProcessorArtifact(ctx, artifact); err != nil {
			return data, err
		}
		data.ScannedCount++
		data.NewHashCount++
	}
	return data, nil
}

// scanAudioSimilarity records which bounded subjects carry declared track
// facts. It reads no bytes: the facts are the durable audio.tags artifacts
// the extraction processor already wrote.
func (d *Dispatcher) scanAudioSimilarity(ctx context.Context, workspaceID string, population []sqlite.NamespaceEntry, bound int) (command.SimilarityScanData, error) {
	data := command.SimilarityScanData{
		WorkspaceID: workspaceID, Kind: command.SimilarityKindAudio, SubjectBound: bound,
		Considered: len(population), NotContentIdentity: true,
		Skipped:    []command.SimilaritySkippedItem{},
		SkipCounts: map[string]int{},
		NotScanned: []command.SimilarityNotScannedItem{},
	}
	declared, err := d.currentAudioTrackFacts(ctx, workspaceID, population)
	if err != nil {
		return data, err
	}
	for index, entry := range population {
		if index >= bound {
			data.NotScannedCount++
			data.NotScanned = appendBoundedNotScanned(data.NotScanned, entry, command.SimilaritySkipSubjectBound, &data.NotScannedOmitted)
			continue
		}
		if _, ok := declared[entry.SubjectRef]; ok {
			data.ScannedCount++
			continue
		}
		data.SkipCounts[command.SimilaritySkipNoDeclaredTrackFacts]++
		data.Skipped = appendBoundedSkipped(data.Skipped, entry, command.SimilaritySkipNoDeclaredTrackFacts, "", &data.SkippedOmitted)
	}
	return data, nil
}

// imageSimilarityGroups groups scanned image subjects into connected
// components over pairwise Hamming distance <= maxDistance. A subject with no
// current hash is reported as not scanned and is never grouped. Exact
// duplicates are flagged on their members but are never merged: both subjects
// stay in the group.
func (d *Dispatcher) imageSimilarityGroups(ctx context.Context, workspaceID string, population []sqlite.NamespaceEntry, maxDistance int) (command.SimilarityGroupsData, error) {
	data := command.SimilarityGroupsData{
		WorkspaceID: workspaceID, Kind: command.SimilarityKindImage,
		Basis: command.SimilarityBasisPerceptualHash, Algorithm: processor.PerceptualHashAlgorithmDHash64,
		MaxDistance: maxDistance, NotContentIdentity: true, IdentityBasis: command.SimilarityIdentityBasis,
		Groups: []command.SimilarityGroup{}, NotScanned: []command.SimilarityNotScannedItem{},
	}
	hashes, err := d.currentImageHashes(ctx, workspaceID, population)
	if err != nil {
		return data, err
	}
	byRef := make(map[string]sqlite.NamespaceEntry, len(population))
	for _, entry := range population {
		byRef[entry.SubjectRef] = entry
	}
	candidates := make([]similarityCandidate, 0, len(hashes))
	for _, entry := range population {
		hash, ok := hashes[entry.SubjectRef]
		if !ok {
			data.NotScannedCount++
			data.NotScanned = appendBoundedNotScanned(data.NotScanned, entry, command.SimilarityNotScannedReason, &data.NotScannedOmitted)
			continue
		}
		data.ScannedCount++
		candidates = append(candidates, similarityCandidate{
			subjectRef: entry.SubjectRef, name: entry.DisplayName,
			contentID: entry.ContentID, hashHex: processor.FormatPerceptualHash(hash), hash: hash,
		})
	}
	groups, ungrouped := groupPerceptualCandidates(candidates, maxDistance)
	data.NotGroupedCount = ungrouped
	data.Groups = groups
	return data, nil
}

// audioSimilarityGroups groups declared track facts. Every group is labelled
// DECLARED_TRACK_FACTS: the grouping is metadata-derived and never proves
// that two files sound or are the same.
func (d *Dispatcher) audioSimilarityGroups(ctx context.Context, workspaceID string, population []sqlite.NamespaceEntry) (command.SimilarityGroupsData, error) {
	data := command.SimilarityGroupsData{
		WorkspaceID: workspaceID, Kind: command.SimilarityKindAudio,
		Basis: command.SimilarityBasisDeclaredTrackFacts, NotContentIdentity: true, IdentityBasis: command.SimilarityIdentityBasis,
		Groups: []command.SimilarityGroup{}, NotScanned: []command.SimilarityNotScannedItem{},
	}
	declared, err := d.currentAudioTrackFacts(ctx, workspaceID, population)
	if err != nil {
		return data, err
	}
	byRef := make(map[string]sqlite.NamespaceEntry, len(population))
	for _, entry := range population {
		byRef[entry.SubjectRef] = entry
	}
	tracks := make([]audioTrackCandidate, 0, len(declared))
	for _, entry := range population {
		facts, ok := declared[entry.SubjectRef]
		if !ok {
			data.NotScannedCount++
			data.NotScanned = appendBoundedNotScanned(data.NotScanned, entry, command.SimilarityNotScannedReason, &data.NotScannedOmitted)
			continue
		}
		data.ScannedCount++
		tracks = append(tracks, audioTrackCandidate{
			subjectRef: entry.SubjectRef, name: entry.DisplayName, contentID: entry.ContentID,
			artist: facts.artist, title: facts.title, durationMS: facts.durationMS,
		})
	}
	groups, ungrouped := groupAudioTrackCandidates(tracks)
	data.NotGroupedCount = ungrouped
	data.Groups = groups
	return data, nil
}

// similarityCandidate is one scanned image subject with its perceptual hash.
type similarityCandidate struct {
	subjectRef string
	name       string
	contentID  string
	hashHex    string
	hash       uint64
}

// audioTrackCandidate is one subject with declared track facts.
type audioTrackCandidate struct {
	subjectRef string
	name       string
	contentID  string
	artist     string
	title      string
	durationMS int64
}

type audioTrackFacts struct {
	artist     string
	title      string
	durationMS int64
}

// groupPerceptualCandidates is the deterministic image grouping: connected
// components over pairwise Hamming distance <= maxDistance; the
// representative is the member with the smallest hash hex (ties broken by
// subject ref); members carry their distance to that representative.
func groupPerceptualCandidates(candidates []similarityCandidate, maxDistance int) ([]command.SimilarityGroup, int) {
	parent := make([]int, len(candidates))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		for parent[i] != i {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[rb] = ra
		}
	}
	for i := 0; i < len(candidates); i++ {
		for j := i + 1; j < len(candidates); j++ {
			if processor.PerceptualHashDistance(candidates[i].hash, candidates[j].hash) <= maxDistance {
				union(i, j)
			}
		}
	}
	membersByRoot := make(map[int][]int, len(candidates))
	for i := range candidates {
		membersByRoot[find(i)] = append(membersByRoot[find(i)], i)
	}
	roots := make([]int, 0, len(membersByRoot))
	for root := range membersByRoot {
		roots = append(roots, root)
	}
	sort.Slice(roots, func(i, j int) bool { return roots[i] < roots[j] })
	groups := make([]command.SimilarityGroup, 0, len(roots))
	ungrouped := 0
	for _, root := range roots {
		indexes := membersByRoot[root]
		if len(indexes) < 2 {
			ungrouped++
			continue
		}
		sort.Slice(indexes, func(i, j int) bool {
			left, right := candidates[indexes[i]], candidates[indexes[j]]
			if left.hashHex != right.hashHex {
				return left.hashHex < right.hashHex
			}
			return left.subjectRef < right.subjectRef
		})
		representativeIndex := indexes[0]
		representative := candidates[representativeIndex]
		members := make([]command.SimilarityMember, 0, len(indexes))
		for _, index := range indexes {
			candidate := candidates[index]
			member := command.SimilarityMember{
				SubjectRef: candidate.subjectRef, Name: candidate.name,
				ContentID: candidate.contentID, HashHex: candidate.hashHex,
				Distance: processor.PerceptualHashDistance(candidate.hash, representative.hash),
			}
			for _, other := range indexes {
				if other == index {
					continue
				}
				if candidates[other].contentID == candidate.contentID {
					member.ExactDuplicatesWith = append(member.ExactDuplicatesWith, candidates[other].subjectRef)
				}
			}
			members = append(members, member)
		}
		group := command.SimilarityGroup{
			Representative: members[0], Members: members,
			Basis: command.SimilarityBasisPerceptualHash,
		}
		for _, member := range members {
			if len(member.ExactDuplicatesWith) > 0 {
				group.ContainsExactDuplicates = true
				break
			}
		}
		groups = append(groups, group)
	}
	sort.Slice(groups, func(i, j int) bool {
		left, right := groups[i].Representative, groups[j].Representative
		if left.HashHex != right.HashHex {
			return left.HashHex < right.HashHex
		}
		return left.SubjectRef < right.SubjectRef
	})
	return groups, ungrouped
}

// groupAudioTrackCandidates groups declared track facts: one group per
// (normalized artist, normalized title) whose members' declared durations
// differ by at most the tolerance. A track with no declared duration, or with
// no declared artist/title, cannot satisfy the stated rule and stays
// ungrouped. The representative is the smallest subject ref, and every group
// carries the DECLARED_TRACK_FACTS basis label.
func groupAudioTrackCandidates(tracks []audioTrackCandidate) ([]command.SimilarityGroup, int) {
	normalize := func(value string) string {
		return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
	}
	parent := make([]int, len(tracks))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		for parent[i] != i {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	union := func(a, b int) {
		ra, rb := find(a), find(b)
		if ra != rb {
			parent[rb] = ra
		}
	}
	type declaredKey struct{ artist, title string }
	keys := make([]declaredKey, len(tracks))
	for i := range tracks {
		keys[i] = declaredKey{normalize(tracks[i].artist), normalize(tracks[i].title)}
	}
	for i := 1; i < len(tracks); i++ {
		for j := 0; j < i; j++ {
			if keys[i].artist == "" || keys[i].title == "" || keys[j].artist == "" || keys[j].title == "" {
				continue
			}
			if keys[i] != keys[j] {
				continue
			}
			left, right := tracks[i].durationMS, tracks[j].durationMS
			if left <= 0 || right <= 0 {
				continue
			}
			delta := left - right
			if delta < 0 {
				delta = -delta
			}
			if delta <= command.SimilarityAudioDurationToleranceMS {
				union(i, j)
			}
		}
	}
	membersByRoot := make(map[int][]int)
	for i := range tracks {
		root := find(i)
		membersByRoot[root] = append(membersByRoot[root], i)
	}
	roots := make([]int, 0, len(membersByRoot))
	for root := range membersByRoot {
		roots = append(roots, root)
	}
	sort.Slice(roots, func(i, j int) bool { return roots[i] < roots[j] })
	groups := make([]command.SimilarityGroup, 0, len(roots))
	ungrouped := 0
	for _, root := range roots {
		indexes := membersByRoot[root]
		if len(indexes) < 2 {
			ungrouped++
			continue
		}
		sort.Slice(indexes, func(i, j int) bool {
			return tracks[indexes[i]].subjectRef < tracks[indexes[j]].subjectRef
		})
		representative := tracks[indexes[0]]
		members := make([]command.SimilarityMember, 0, len(indexes))
		for _, index := range indexes {
			track := tracks[index]
			delta := track.durationMS - representative.durationMS
			if delta < 0 {
				delta = -delta
			}
			members = append(members, command.SimilarityMember{
				SubjectRef: track.subjectRef, Name: track.name, ContentID: track.contentID,
				Artist: track.artist, Title: track.title,
				DurationMS: track.durationMS, DurationDeltaMS: delta,
			})
		}
		groups = append(groups, command.SimilarityGroup{
			Representative: command.SimilarityMember{
				SubjectRef: representative.subjectRef, Name: representative.name, ContentID: representative.contentID,
				Artist: representative.artist, Title: representative.title, DurationMS: representative.durationMS,
			},
			Members: members, Basis: command.SimilarityBasisDeclaredTrackFacts,
		})
	}
	sort.Slice(groups, func(i, j int) bool {
		left, right := groups[i].Representative, groups[j].Representative
		if left.Artist != right.Artist {
			return left.Artist < right.Artist
		}
		if left.Title != right.Title {
			return left.Title < right.Title
		}
		return left.SubjectRef < right.SubjectRef
	})
	return groups, ungrouped
}

// currentImageHashes resolves the newest admitted perceptual-hash artifact
// per subject whose pinned source content identity still matches the
// subject's current content. A hash computed from different bytes than the
// subject carries now is stale and is never returned.
func (d *Dispatcher) currentImageHashes(ctx context.Context, workspaceID string, population []sqlite.NamespaceEntry) (map[string]uint64, error) {
	current := make(map[string]string, len(population))
	for _, entry := range population {
		current[entry.SubjectRef] = entry.ContentID
	}
	artifacts, err := d.store.ListAdmittedArtifacts(ctx, workspaceID, "")
	if err != nil {
		return nil, err
	}
	ordered := make([]sqlite.ProcessorArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact.CapabilityID == processor.CapabilityImagePerceptualHash && artifact.SchemaRef == processor.SchemaRefPerceptualHash() {
			ordered = append(ordered, artifact)
		}
	}
	sort.Slice(ordered, func(i, j int) bool {
		if !ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].CreatedAt.After(ordered[j].CreatedAt)
		}
		return ordered[i].ID > ordered[j].ID
	})
	hashes := make(map[string]uint64, len(ordered))
	for _, artifact := range ordered {
		if _, ok := hashes[artifact.SubjectRef]; ok {
			continue
		}
		if current[artifact.SubjectRef] != artifactBodyContentID(artifact) {
			continue
		}
		record, ok := processor.ParsePerceptualHash(artifact.Body)
		if !ok {
			continue
		}
		hash, err := processor.ParsePerceptualHashHex(record.HashHex)
		if err != nil {
			continue
		}
		hashes[artifact.SubjectRef] = hash
	}
	return hashes, nil
}

// currentAudioTrackFacts resolves the newest declared track facts per subject
// whose producing artifact still names the subject's current content.
func (d *Dispatcher) currentAudioTrackFacts(ctx context.Context, workspaceID string, population []sqlite.NamespaceEntry) (map[string]audioTrackFacts, error) {
	current := make(map[string]string, len(population))
	for _, entry := range population {
		current[entry.SubjectRef] = entry.ContentID
	}
	artifacts, err := d.store.ListAdmittedArtifacts(ctx, workspaceID, "")
	if err != nil {
		return nil, err
	}
	ordered := make([]sqlite.ProcessorArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		if artifact.CapabilityID == processor.CapabilityAudioTags {
			ordered = append(ordered, artifact)
		}
	}
	sort.Slice(ordered, func(i, j int) bool {
		if !ordered[i].CreatedAt.Equal(ordered[j].CreatedAt) {
			return ordered[i].CreatedAt.After(ordered[j].CreatedAt)
		}
		return ordered[i].ID > ordered[j].ID
	})
	facts := make(map[string]audioTrackFacts, len(ordered))
	for _, artifact := range ordered {
		if _, ok := facts[artifact.SubjectRef]; ok {
			continue
		}
		if current[artifact.SubjectRef] != artifactBodyContentID(artifact) {
			continue
		}
		var parsed struct {
			Title      string `json:"title"`
			Artist     string `json:"artist"`
			DurationMS int64  `json:"duration_ms"`
		}
		if json.Unmarshal([]byte(artifact.Body), &parsed) != nil {
			continue
		}
		facts[artifact.SubjectRef] = audioTrackFacts{artist: parsed.Artist, title: parsed.Title, durationMS: parsed.DurationMS}
	}
	return facts, nil
}

// artifactBodyContentID reads the source content id an artifact was computed
// from: the pinned body field for perceptual hashes, else the admitted
// envelope's source_content_id.
func artifactBodyContentID(artifact sqlite.ProcessorArtifact) string {
	record, ok := processor.ParsePerceptualHash(artifact.Body)
	if ok && record.SourceContentID != "" {
		return record.SourceContentID
	}
	var envelope struct {
		SourceContentID string `json:"source_content_id"`
	}
	if json.Unmarshal(artifact.Envelope, &envelope) == nil {
		return envelope.SourceContentID
	}
	return ""
}

// latestSnapshotByNamespaceRoot maps each namespace root of the workspace to
// the snapshot ref of its latest publication, so a scan artifact is bound to
// the namespace state it was computed against.
func (d *Dispatcher) latestSnapshotByNamespaceRoot(ctx context.Context, workspaceID string) (map[string]string, error) {
	publications, err := d.store.ListPublications(ctx)
	if err != nil {
		return nil, err
	}
	latest := make(map[string]sqlite.Publication)
	for _, publication := range publications {
		if publication.WorkspaceID != workspaceID {
			continue
		}
		current, ok := latest[publication.NamespaceRootID]
		if !ok || publication.CommittedAt.After(current.CommittedAt) ||
			(publication.CommittedAt.Equal(current.CommittedAt) && publication.SnapshotRef > current.SnapshotRef) {
			latest[publication.NamespaceRootID] = publication
		}
	}
	byRoot := make(map[string]string, len(latest))
	for root, publication := range latest {
		byRoot[root] = publication.SnapshotRef
	}
	return byRoot, nil
}

// admittedPerceptualDecoder names the image media types the standard library
// decoders admit for the perceptual hash. Anything else is an explicit skip.
func admittedPerceptualDecoder(mediaType string) bool {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "image/png", "image/jpeg", "image/gif":
		return true
	default:
		return false
	}
}

// sha256DigestHex is the artifact body digest the artifacts table verifies on
// insert.
func sha256DigestHex(body []byte) string {
	sum := sha256.Sum256(body)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// bounded response helpers: the counts are always complete; the rendered
// lists carry a bound and an omitted count so honesty never becomes
// unbounded output.
func appendBoundedSkipped(items []command.SimilaritySkippedItem, entry sqlite.NamespaceEntry, reason, detail string, omitted *int) []command.SimilaritySkippedItem {
	if len(items) >= maxSimilarityListedSkips {
		*omitted++
		return items
	}
	return append(items, command.SimilaritySkippedItem{SubjectRef: entry.SubjectRef, Name: entry.DisplayName, Reason: reason, Detail: detail})
}

func appendBoundedNotScanned(items []command.SimilarityNotScannedItem, entry sqlite.NamespaceEntry, reason string, omitted *int) []command.SimilarityNotScannedItem {
	if len(items) >= maxSimilarityListedNotScanned {
		*omitted++
		return items
	}
	return append(items, command.SimilarityNotScannedItem{SubjectRef: entry.SubjectRef, Name: entry.DisplayName, Reason: reason})
}

const (
	maxSimilarityListedSkips      = 200
	maxSimilarityListedNotScanned = 50
)
