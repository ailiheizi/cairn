package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/ailiheizi/restoreweave/client/command"
	"github.com/ailiheizi/restoreweave/server/internal/exact"
	"github.com/ailiheizi/restoreweave/server/internal/processor"
	"github.com/ailiheizi/restoreweave/server/internal/repository"
	"github.com/ailiheizi/restoreweave/server/internal/search"
	"github.com/ailiheizi/restoreweave/server/internal/store/sqlite"
	"github.com/ailiheizi/restoreweave/server/testutil"
)

// The similarity contract under test (Phase 4, content-store §6): similarity
// NEVER establishes exact identity and NEVER authorizes deletion; exact
// whole-content deduplication stays the only identity grouping; candidate
// groups carry hashes, distances, and honest unscanned accounting, and no
// group offers delete or merge.

// newSimilarityDispatcher wires one store, one real directory repository, and
// the dispatcher around them, so a scan reads admitted bytes through the same
// identity-checking content source the daemon uses.
func newSimilarityDispatcher(t *testing.T) (*sqlite.Store, *repository.Dir, *Dispatcher) {
	t.Helper()
	store := testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
	repo, err := repository.OpenDir(filepath.Join(t.TempDir(), "repository"))
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock", WithExact(&exact.Service{
		Store: store,
		Repo:  repo,
	}))
	return store, repo, dispatcher
}

// gradientPNG encodes the deterministic smooth gradient used by the fixtures.
// Its luma is strictly monotonic in x, so its perceptual hash is stable across
// encoders and sizes.
func gradientPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x * 255) / (width - 1)),
				G: uint8((y * 255) / (height - 1)),
				B: uint8((x + y) % 256),
				A: 255,
			})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// checkerboardPNG is a high-frequency pattern unrelated to the gradient.
func checkerboardPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			shade := uint8(255)
			if (x/4+y/4)%2 == 0 {
				shade = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{R: shade, G: shade, B: shade, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// webpHeaderBytes carries the RIFF/WEBP magic so media-type detection names it
// image/webp, but no stdlib decoder admits it.
var webpHeaderBytes = append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), make([]byte, 24)...)

// testMP3WithFrames builds an ID3-tagged MPEG audio file whose duration is
// derived from the declared frame header and the audio length, so two files
// with the same declared track can differ in duration by a controlled amount.
func testMP3WithFrames(tags map[string]string, audioLen int) []byte {
	body := testID3v23(tags)
	frame := []byte{0xFF, 0xFB, 0x90, 0x00} // MPEG1 Layer III, 128 kbps, 44100 Hz
	audio := append(frame, make([]byte, audioLen-len(frame))...)
	return append(body, audio...)
}

func decodeSimilarityData(t *testing.T, result command.Result, into any) {
	t.Helper()
	if result.Status != command.StatusSucceeded {
		t.Fatalf("operation status = %q reasons=%+v", result.Status, result.Reasons)
	}
	if err := json.Unmarshal(result.Data, into); err != nil {
		t.Fatalf("decode result: %v", err)
	}
}

func TestSimilarityScanAndGroupsImages(t *testing.T) {
	ctx := context.Background()
	store, _, dispatcher := newSimilarityDispatcher(t)

	photo := gradientPNG(t, 64, 64)
	variant := gradientPNG(t, 56, 56)
	other := checkerboardPNG(t)

	root := t.TempDir()
	writeFixture(t, filepath.Join(root, "photo.png"), photo)
	writeFixture(t, filepath.Join(root, "photo-variant.png"), variant)
	writeFixture(t, filepath.Join(root, "dup.png"), photo) // exact duplicate of photo.png
	writeFixture(t, filepath.Join(root, "other.png"), other)
	writeFixture(t, filepath.Join(root, "notes.txt"), []byte("not an image"))
	writeFixture(t, filepath.Join(root, "broken.webp"), webpHeaderBytes)
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	// The two identical files keep one exact identity while staying separate
	// subjects; the scan must not change any of that.
	listing := mustContentList(t, ctx, dispatcher, ingest.WorkspaceID)
	var photoItem, dupItem, notesItem, webpItem, variantItem, otherItem map[string]any
	for _, item := range listing {
		switch item["name"] {
		case "photo.png":
			photoItem = item
		case "dup.png":
			dupItem = item
		case "notes.txt":
			notesItem = item
		case "broken.webp":
			webpItem = item
		case "photo-variant.png":
			variantItem = item
		case "other.png":
			otherItem = item
		}
	}
	for _, item := range map[string]map[string]any{"photo": photoItem, "dup": dupItem, "notes": notesItem, "webp": webpItem, "variant": variantItem, "other": otherItem} {
		if item == nil {
			t.Fatalf("fixture subject missing from content.list: %v", listing)
		}
	}
	if photoItem["content_id"] != dupItem["content_id"] {
		t.Fatal("the exact duplicate fixtures must share one content identity")
	}

	// Explicit scan: honest per-subject accounting.
	var scan command.SimilarityScanData
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityScan, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "image",
	})), &scan)
	if !scan.NotContentIdentity || scan.Kind != "image" {
		t.Fatalf("scan = %+v", scan)
	}
	if scan.ScannedCount != 4 || scan.NewHashCount != 4 || scan.Considered != 6 {
		t.Fatalf("scan accounting = %+v", scan)
	}
	if scan.SkipCounts[command.SimilaritySkipNotAnImage] != 1 || scan.SkipCounts[command.SimilaritySkipUnsupportedImageFormat] != 1 {
		t.Fatalf("skip counts = %+v", scan.SkipCounts)
	}
	skipReasons := map[string]string{}
	for _, item := range scan.Skipped {
		skipReasons[item.SubjectRef] = item.Reason
	}
	if skipReasons[notesItem["subject_ref"].(string)] != command.SimilaritySkipNotAnImage ||
		skipReasons[webpItem["subject_ref"].(string)] != command.SimilaritySkipUnsupportedImageFormat {
		t.Fatalf("per-subject skip reasons = %+v", scan.Skipped)
	}
	if scan.NotScannedCount != 0 {
		t.Fatalf("nothing may be unscanned inside the bound: %+v", scan)
	}

	// The stored artifacts are durable, immutable, and never identity claims.
	artifacts, err := store.ListAdmittedArtifacts(ctx, ingest.WorkspaceID, "")
	if err != nil {
		t.Fatalf("list artifacts: %v", err)
	}
	hashArtifacts := 0
	for _, artifact := range artifacts {
		if artifact.CapabilityID != processor.CapabilityImagePerceptualHash {
			continue
		}
		hashArtifacts++
		if artifact.SchemaRef != processor.SchemaRefPerceptualHash() || artifact.Stage != "FINGERPRINT" {
			t.Fatalf("artifact schema/stage = %s/%s", artifact.SchemaRef, artifact.Stage)
		}
		record, ok := processor.ParsePerceptualHash(artifact.Body)
		if !ok || !record.NotContentIdentity || record.SourceContentID == "" || record.LogicalLength <= 0 {
			t.Fatalf("artifact body = %s", artifact.Body)
		}
	}
	if hashArtifacts != 4 {
		t.Fatalf("hash artifacts = %d, want 4", hashArtifacts)
	}

	// The scan is not a processor attempt: it never enters the attempt or
	// retry lineage that the exact publication owns.
	attempts, err := store.ListProcessorAttempts(ctx, ingest.WorkspaceID, ingest.SnapshotRef)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	for _, attempt := range attempts {
		if attempt.CapabilityID == processor.CapabilityImagePerceptualHash {
			t.Fatal("the similarity scan must not create processor attempts")
		}
	}

	// Re-scanning is idempotent: no new artifact, same accounting.
	var rescan command.SimilarityScanData
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityScan, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "image",
	})), &rescan)
	if rescan.ScannedCount != 4 || rescan.NewHashCount != 0 {
		t.Fatalf("rescan = %+v", rescan)
	}

	// Groups: candidate group for the similar images, explicit non-identity
	// statement, per-member hash and distance, exact duplicates flagged but
	// never merged, unscanned subjects reported and never grouped.
	var groups command.SimilarityGroupsData
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityGroups, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "image",
	})), &groups)
	if !groups.NotContentIdentity || groups.IdentityBasis == "" {
		t.Fatalf("groups = %+v", groups)
	}
	if groups.Basis != command.SimilarityBasisPerceptualHash || groups.Algorithm != processor.PerceptualHashAlgorithmDHash64 || groups.MaxDistance != command.DefaultSimilarityMaxDistance {
		t.Fatalf("groups header = %+v", groups)
	}
	if groups.ScannedCount != 4 || groups.NotScannedCount != 2 {
		t.Fatalf("groups accounting = %+v", groups)
	}
	notScannedRefs := map[string]string{}
	for _, item := range groups.NotScanned {
		notScannedRefs[item.SubjectRef] = item.Reason
	}
	if notScannedRefs[notesItem["subject_ref"].(string)] != command.SimilarityNotScannedReason ||
		notScannedRefs[webpItem["subject_ref"].(string)] != command.SimilarityNotScannedReason {
		t.Fatalf("not-scanned accounting = %+v", groups.NotScanned)
	}

	photoHash := mustHash(t, photo)
	variantHash := mustHash(t, variant)
	otherHash := mustHash(t, other)
	photoToVariant := processor.PerceptualHashDistance(photoHash, variantHash)
	photoToOther := processor.PerceptualHashDistance(photoHash, otherHash)
	if photoToOther <= command.DefaultSimilarityMaxDistance {
		t.Fatalf("fixture assumption broken: the checkerboard is distance %d from the gradient", photoToOther)
	}

	photoRef := photoItem["subject_ref"].(string)
	dupRef := dupItem["subject_ref"].(string)
	variantRef := variantItem["subject_ref"].(string)
	otherRef := otherItem["subject_ref"].(string)
	if photoToVariant > command.DefaultSimilarityMaxDistance {
		t.Fatalf("fixture assumption broken: the variant is distance %d away", photoToVariant)
	}
	if len(groups.Groups) != 1 {
		t.Fatalf("groups = %+v", groups.Groups)
	}
	group := groups.Groups[0]
	memberRefs := map[string]command.SimilarityMember{}
	for _, member := range group.Members {
		memberRefs[member.SubjectRef] = member
	}
	for _, ref := range []string{photoRef, dupRef, variantRef} {
		member, ok := memberRefs[ref]
		if !ok {
			t.Fatalf("expected member %s in group %+v", ref, group)
		}
		if len(member.HashHex) != 16 || member.ContentID == "" {
			t.Fatalf("member must carry hash and content id: %+v", member)
		}
	}
	if _, grouped := memberRefs[otherRef]; grouped {
		t.Fatal("the unrelated image must not be grouped")
	}
	if !group.ContainsExactDuplicates {
		t.Fatalf("the exact duplicate pair must be flagged: %+v", group)
	}
	// Exact duplicates are flagged, not merged: both subjects stay members.
	if len(memberRefs[photoRef].ExactDuplicatesWith) == 0 || !contains(memberRefs[photoRef].ExactDuplicatesWith, dupRef) {
		t.Fatalf("photo must flag its exact duplicate: %+v", memberRefs[photoRef])
	}
	if !contains(memberRefs[dupRef].ExactDuplicatesWith, photoRef) {
		t.Fatalf("dup must flag its exact duplicate: %+v", memberRefs[dupRef])
	}
	// The representative carries distance 0 and the smallest hash.
	representative := group.Representative
	if representative.Distance != 0 || representative.HashHex == "" {
		t.Fatalf("representative = %+v", representative)
	}
	for _, member := range group.Members {
		if member.HashHex < representative.HashHex {
			t.Fatalf("representative is not the smallest hash: %s vs %s", representative.HashHex, member.HashHex)
		}
	}
	if groups.NotGroupedCount != 1 {
		t.Fatalf("the unrelated image must be counted as not grouped: %+v", groups)
	}
	// The exact duplicate surface is untouched by the scan (see the dedicated
	// test); here the identity fields must still match the listing.
	if memberRefs[photoRef].ContentID != photoItem["content_id"].(string) ||
		memberRefs[dupRef].ContentID != dupItem["content_id"].(string) {
		t.Fatal("member content ids must be the daemon's own identity")
	}
}

func TestSimilarityGroupsThresholdBoundary(t *testing.T) {
	// A(0xFF) --8-- B(0xFFFF); C is 9 bits from A and 15 from B, so at the
	// threshold of 8 the A-B pair groups while C stays out, and at 9 the
	// connected-components rule chains A-B (C never joins through B).
	base := uint64(0xFF)
	a := similarityCandidate{subjectRef: "subj_a", contentID: "sha256:a", hash: base, hashHex: processor.FormatPerceptualHash(base)}
	bHash := base ^ 0xFF00 // exactly 8 bits away from A
	b := similarityCandidate{subjectRef: "subj_b", contentID: "sha256:b", hash: bHash, hashHex: processor.FormatPerceptualHash(bHash)}
	cHash := base ^ 0x1FF // exactly 9 bits from A, 15 from B
	c := similarityCandidate{subjectRef: "subj_c", contentID: "sha256:c", hash: cHash, hashHex: processor.FormatPerceptualHash(cHash)}
	if got := processor.PerceptualHashDistance(a.hash, b.hash); got != 8 {
		t.Fatalf("fixture distance A-B = %d, want 8", got)
	}
	if got := processor.PerceptualHashDistance(a.hash, c.hash); got != 9 {
		t.Fatalf("fixture distance A-C = %d, want 9", got)
	}
	// At the boundary the pair groups; one past it, it does not.
	groups, ungrouped := groupPerceptualCandidates([]similarityCandidate{a, b, c}, 8)
	if len(groups) != 1 || ungrouped != 1 {
		t.Fatalf("threshold 8: groups=%d ungrouped=%d", len(groups), ungrouped)
	}
	if len(groups[0].Members) != 2 {
		t.Fatalf("threshold 8 members = %+v", groups[0].Members)
	}
	// The representative is the smallest hash hex, at distance 0.
	if groups[0].Representative.HashHex != a.hashHex || groups[0].Representative.SubjectRef != "subj_a" {
		t.Fatalf("representative = %+v", groups[0].Representative)
	}
	groups, ungrouped = groupPerceptualCandidates([]similarityCandidate{a, b, c}, 7)
	if len(groups) != 0 || ungrouped != 3 {
		t.Fatalf("threshold 7: groups=%d ungrouped=%d", len(groups), ungrouped)
	}
	// Connected components: at 9 everything chains into one group.
	groups, ungrouped = groupPerceptualCandidates([]similarityCandidate{a, b, c}, 9)
	if len(groups) != 1 || ungrouped != 0 || len(groups[0].Members) != 3 {
		t.Fatalf("threshold 9: groups=%+v ungrouped=%d", groups, ungrouped)
	}
	// Exact duplicates are flagged per member, never merged away.
	aDup := similarityCandidate{subjectRef: "subj_a2", contentID: "sha256:a", hash: base, hashHex: processor.FormatPerceptualHash(base)}
	groups, _ = groupPerceptualCandidates([]similarityCandidate{a, aDup}, 0)
	if len(groups) != 1 || !groups[0].ContainsExactDuplicates {
		t.Fatalf("distance 0 with one identity must flag exact duplicates: %+v", groups)
	}
	if !contains(groups[0].Members[0].ExactDuplicatesWith, "subj_a2") || !contains(groups[0].Members[1].ExactDuplicatesWith, "subj_a") {
		t.Fatalf("exact duplicate flags = %+v", groups[0].Members)
	}
}

func TestSimilarityScanAndGroupsAudioDeclaredTrackFacts(t *testing.T) {
	ctx := context.Background()
	_, _, dispatcher := newSimilarityDispatcher(t)

	nightfall := map[string]string{"TIT2": "Nightfall", "TPE1": "Example Artist"}
	root := t.TempDir()
	writeFixture(t, filepath.Join(root, "nightfall.mp3"), testMP3WithFrames(nightfall, 128000))
	writeFixture(t, filepath.Join(root, "nightfall-take2.mp3"), testMP3WithFrames(nightfall, 128256)) // +16 ms
	writeFixture(t, filepath.Join(root, "nightfall-shout.mp3"), testMP3WithFrames(map[string]string{"TIT2": "NIGHTFALL", "TPE1": "  example   artist "}, 128512))
	writeFixture(t, filepath.Join(root, "harbor.mp3"), testMP3WithFrames(map[string]string{"TIT2": "Harbor", "TPE1": "Example Artist"}, 128000))
	// Declared tags but no duration: the stated rule cannot evaluate, so the
	// track stays scanned but ungrouped.
	writeFixture(t, filepath.Join(root, "silent.mp3"), testID3v23(map[string]string{"TIT2": "Silent", "TPE1": "Example Artist"}))
	writeFixture(t, filepath.Join(root, "notes.txt"), []byte("not audio"))
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	var scan command.SimilarityScanData
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityScan, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "audio",
	})), &scan)
	if scan.ScannedCount != 5 || scan.SkipCounts[command.SimilaritySkipNoDeclaredTrackFacts] != 1 {
		t.Fatalf("audio scan = %+v", scan)
	}
	if !scan.NotContentIdentity {
		t.Fatalf("audio scan must restate the non-identity rule: %+v", scan)
	}

	var groups command.SimilarityGroupsData
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityGroups, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "audio",
	})), &groups)
	if groups.Basis != command.SimilarityBasisDeclaredTrackFacts || !groups.NotContentIdentity || groups.IdentityBasis == "" {
		t.Fatalf("audio groups header = %+v", groups)
	}
	if len(groups.Groups) != 1 {
		t.Fatalf("audio groups = %+v", groups.Groups)
	}
	group := groups.Groups[0]
	if group.Basis != command.SimilarityBasisDeclaredTrackFacts {
		t.Fatalf("audio group must be labelled declared-track: %+v", group)
	}
	if len(group.Members) != 3 {
		t.Fatalf("the normalized declared-track group must hold all three takes: %+v", group.Members)
	}
	deltaSeen := false
	for _, member := range group.Members {
		if member.Title == "" || member.Artist == "" {
			t.Fatalf("audio members carry declared facts: %+v", member)
		}
		if member.DurationDeltaMS > 0 {
			deltaSeen = true
		}
		if member.DurationDeltaMS > command.SimilarityAudioDurationToleranceMS {
			t.Fatalf("duration delta beyond tolerance: %+v", member)
		}
	}
	if !deltaSeen {
		t.Fatal("members must carry their duration delta to the representative")
	}
	if groups.NotGroupedCount != 2 {
		t.Fatalf("harbor and the duration-less track stay ungrouped: %+v", groups)
	}
	if groups.NotScannedCount != 1 {
		t.Fatalf("the text file is reported not scanned: %+v", groups)
	}
}

func TestExactDuplicateGroupsUnchangedAfterSimilarityScan(t *testing.T) {
	ctx := context.Background()
	store, repo, dispatcher := newSimilarityDispatcher(t)
	// The duplicate-group projection is served through the lexical lane; the
	// bundled FTS engine needs only the store and an index directory.
	dispatcher.search = &search.Indexer{Store: store, Engine: &search.Engine{Dir: filepath.Join(repo.Root(), "indexes")}}

	root := t.TempDir()
	writeFixture(t, filepath.Join(root, "alpha.txt"), []byte("RestoreWeave exact duplicate content"))
	writeFixture(t, filepath.Join(root, "beta.txt"), []byte("RestoreWeave exact duplicate content"))
	writeFixture(t, filepath.Join(root, "photo.png"), gradientPNG(t, 64, 64))
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	beforeListing := mustContentList(t, ctx, dispatcher, ingest.WorkspaceID)
	alphaRef := ""
	contentID := ""
	for _, item := range beforeListing {
		if item["name"] == "alpha.txt" {
			alphaRef = item["subject_ref"].(string)
			contentID = item["content_id"].(string)
		}
	}
	if alphaRef == "" || contentID == "" {
		t.Fatalf("fixture subjects missing: %+v", beforeListing)
	}
	membersBefore := mustDuplicateGroupMembers(t, ctx, dispatcher, ingest.WorkspaceID, contentID)
	if len(membersBefore) != 2 {
		t.Fatalf("the exact duplicate group must hold both files: %+v", membersBefore)
	}

	// The explicit scan changes no identity, protection, or duplicate fact.
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityScan, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "image",
	})), &command.SimilarityScanData{})

	afterListing := mustContentList(t, ctx, dispatcher, ingest.WorkspaceID)
	if len(afterListing) != len(beforeListing) {
		t.Fatalf("the listing changed: %d vs %d", len(afterListing), len(beforeListing))
	}
	for index, item := range beforeListing {
		if item["content_id"] != afterListing[index]["content_id"] || item["logical_size"] != afterListing[index]["logical_size"] {
			t.Fatalf("subject identity changed: %+v vs %+v", item, afterListing[index])
		}
	}
	membersAfter := mustDuplicateGroupMembers(t, ctx, dispatcher, ingest.WorkspaceID, contentID)
	if len(membersAfter) != 2 {
		t.Fatalf("the exact duplicate group must be unchanged: %+v", membersAfter)
	}
	for ref := range membersBefore {
		if !membersAfter[ref] {
			t.Fatalf("member %s left the exact duplicate group", ref)
		}
	}

	// The similarity groups never absorb the exact duplicates into one member:
	// the text subjects carry no hash and are reported not scanned, and no
	// similarity group membership is offered as a merge or delete.
	var groups command.SimilarityGroupsData
	decodeSimilarityData(t, dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityGroups, map[string]any{
		"workspace_id": ingest.WorkspaceID, "kind": "image",
	})), &groups)
	for _, group := range groups.Groups {
		for _, member := range group.Members {
			if member.SubjectRef == alphaRef {
				t.Fatalf("a text subject must never be grouped: %+v", group)
			}
		}
	}
	if groups.NotScannedCount != 2 {
		t.Fatalf("the two text subjects are not scanned: %+v", groups)
	}
}

// openPlainStore opens a catalog with no exact lane, so the similarity
// operations can be proven unimplemented rather than merely failing.
func openPlainStore(t *testing.T) *sqlite.Store {
	t.Helper()
	return testutil.OpenStore(t, filepath.Join(t.TempDir(), "catalog.sqlite"))
}

func TestSimilarityOperationsRequireExactLane(t *testing.T) {
	store := openPlainStore(t)
	dispatcher := NewDispatcher(store, "catalog.sqlite", "/tmp/rw.sock")
	for _, operation := range []string{command.OpSimilarityScan, command.OpSimilarityGroups} {
		result := dispatcher.Handle(context.Background(), mustEnvelope(t, operation, map[string]any{"workspace_id": "wsp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "kind": "image"}))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeUnimplemented) {
			t.Fatalf("%s without an exact lane = %q reasons=%+v", operation, result.Status, result.Reasons)
		}
	}
	ops := dispatcher.UnimplementedOperations()
	if !contains(ops, command.OpSimilarityScan) || !contains(ops, command.OpSimilarityGroups) {
		t.Fatalf("unimplemented list = %+v", ops)
	}
}

func TestSimilarityInputValidation(t *testing.T) {
	ctx := context.Background()
	_, _, dispatcher := newSimilarityDispatcher(t)
	root := t.TempDir()
	writeFixture(t, filepath.Join(root, "notes.txt"), []byte("text"))
	ingest := mustAppliedIngest(t, ctx, dispatcher, map[string]any{"root": root})

	cases := []struct {
		name  string
		op    string
		input map[string]any
	}{
		{"bad kind scan", command.OpSimilarityScan, map[string]any{"workspace_id": ingest.WorkspaceID, "kind": "video"}},
		{"bad bound scan", command.OpSimilarityScan, map[string]any{"workspace_id": ingest.WorkspaceID, "kind": "image", "max_subjects": command.MaxSimilarityScanSubjects + 1}},
		{"bad kind groups", command.OpSimilarityGroups, map[string]any{"workspace_id": ingest.WorkspaceID, "kind": "vectors"}},
		{"bad threshold groups", command.OpSimilarityGroups, map[string]any{"workspace_id": ingest.WorkspaceID, "kind": "image", "max_distance": 65}},
		{"negative threshold groups", command.OpSimilarityGroups, map[string]any{"workspace_id": ingest.WorkspaceID, "kind": "image", "max_distance": -1}},
		{"missing workspace", command.OpSimilarityScan, map[string]any{"kind": "image"}},
	}
	for _, testCase := range cases {
		result := dispatcher.Handle(ctx, mustEnvelope(t, testCase.op, testCase.input))
		if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeInvalidInput) {
			t.Fatalf("%s = %q reasons=%+v", testCase.name, result.Status, result.Reasons)
		}
	}
	// Unknown workspace fails as a lookup, not as a scan.
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSimilarityScan, map[string]any{"workspace_id": "wsp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "kind": "image"}))
	if result.Status != command.StatusFailed || !hasReasonCode(result, ReasonCodeNotFound) {
		t.Fatalf("unknown workspace = %q reasons=%+v", result.Status, result.Reasons)
	}
}

// --- helpers ---

func writeFixture(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func mustHash(t *testing.T, data []byte) uint64 {
	t.Helper()
	hash, _, _, err := processor.HashImagePerceptual(data)
	if err != nil {
		t.Fatalf("hash fixture: %v", err)
	}
	return hash
}

func mustContentList(t *testing.T, ctx context.Context, dispatcher *Dispatcher, workspaceID string) []map[string]any {
	t.Helper()
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpContentList, map[string]any{"workspace_id": workspaceID}))
	if result.Status != command.StatusSucceeded {
		t.Fatalf("content.list = %q reasons=%+v", result.Status, result.Reasons)
	}
	var data struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode content.list: %v", err)
	}
	return data.Items
}

func mustDuplicateGroupMembers(t *testing.T, ctx context.Context, dispatcher *Dispatcher, workspaceID, contentID string) map[string]bool {
	t.Helper()
	result := dispatcher.Handle(ctx, mustEnvelope(t, command.OpSearchQuery, map[string]any{
		"workspace_id": workspaceID,
		"filters":      map[string]any{"duplicate_group": contentID},
	}))
	// The default broker degrades while no semantic provider is wired; the
	// duplicate_group filter is structural, so its hits remain complete and
	// the degraded status must not hide them.
	if result.Status != command.StatusSucceeded && result.Status != command.StatusDegraded {
		t.Fatalf("search.query = %q reasons=%+v", result.Status, result.Reasons)
	}
	var data struct {
		Hits []struct {
			SubjectRef string `json:"subject_ref"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(result.Data, &data); err != nil {
		t.Fatalf("decode search: %v", err)
	}
	members := map[string]bool{}
	for _, hit := range data.Hits {
		members[hit.SubjectRef] = true
	}
	return members
}
