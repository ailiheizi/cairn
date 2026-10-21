package exact

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/ailiheizi/cairn/server/internal/store/sqlite"
)

// This regression records the intended admitted meaning of a description's
// ConfigDigest: the configuration that created that immutable revision. A
// later retained parent may have a different snapshot config, but must still
// carry the original description revision unchanged in its signed child.
func TestDescriptionCreationConfigSurvivesAllRetainedParentPublication(t *testing.T) {
	ctx := context.Background()
	fixture := newSignedPublicationFixture(t, "description.txt", []byte("same exact content across config generations"))
	configA := DigestBytes([]byte("valid retained-parent config A"))
	configB := DigestBytes([]byte("valid description-creation config B"))
	if configA == configB || !validExactContentID(configA) || !validExactContentID(configB) {
		t.Fatalf("test config digests are not distinct valid SHA-256 IDs: A=%q B=%q", configA, configB)
	}
	fixture.service.ConfigDigest = configA
	parentA := fixture.ingest(t, "sha256:description-config-parent-a")
	subject := stableSubjectForSnapshotFile(t, fixture.service, parentA.SnapshotRef, "description.txt")

	fixture.service.ConfigDigest = configB
	parentB := fixture.ingest(t, "sha256:description-config-parent-b")
	if parentB.ConfigDigest != configB || parentA.ConfigDigest != configA {
		t.Fatalf("signed parent configs do not preserve requested generations: A=%q B=%q", parentA.ConfigDigest, parentB.ConfigDigest)
	}
	if got := stableSubjectForSnapshotFile(t, fixture.service, parentB.SnapshotRef, "description.txt"); got != subject {
		t.Fatalf("stable subject changed across config generations: A=%q B=%q", subject, got)
	}

	descriptionID, err := sqlite.NewStableID(sqlite.IDPrefixDescription)
	if err != nil {
		t.Fatal(err)
	}
	description := &sqlite.DescriptionDocument{
		ID: descriptionID, WorkspaceID: parentB.WorkspaceID,
		SubjectRef: subject, Kind: sqlite.DescriptionUser, Language: "en",
		Body:         "Created with config B and retained verbatim under every parent.",
		SourceRef:    "user:description-config-binding-regression",
		ConfigDigest: configB, Accepted: true, Visibility: "private",
	}
	if err := fixture.store.InsertDescriptionDocument(ctx, description); err != nil {
		t.Fatal(err)
	}
	targets, err := fixture.service.ResolveSubjectFactPublicationTargets(ctx, parentB.WorkspaceID, []string{subject})
	if err != nil {
		t.Fatalf("resolve authenticated retained parents: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("authenticated target count = %d, want both A and B parents: %+v", len(targets), targets)
	}
	parentBytes := captureImmutableParentBytes(t, fixture.service, []string{parentA.SnapshotRef, parentB.SnapshotRef})

	result, err := fixture.service.PublishSubjectFactSuccessors(ctx, parentB.WorkspaceID, targets, nil, []DescriptionFactMutation{{
		DescriptionID: description.ID, SubjectRef: subject, Revision: description.Revision,
		BodyDigest: description.BodyDigest, Accepted: description.Accepted, Visibility: description.Visibility,
	}})
	assertImmutableParentBytes(t, fixture.service, parentBytes)
	if err != nil {
		t.Fatalf("publish immutable description creation config %s across signed parents A=%s and B=%s: %v (evidence=%+v)", configB, configA, configB, err, result)
	}
	if len(result.Parents) != 2 {
		t.Fatalf("verified parent evidence count = %d, want 2", len(result.Parents))
	}
	reader := &Service{
		Repo: fixture.repo, TrustAnchor: fixture.service.TrustAnchor,
		PublicationDomain: testPublicationDomain, RequireSignedPublication: true,
	}
	for _, parent := range result.Parents {
		if !parent.Covered || len(parent.Mutations) != 1 || parent.Mutations[0].RecordID != description.ID || parent.Mutations[0].Revision != description.Revision || parent.Mutations[0].BodyDigest != description.BodyDigest {
			t.Fatalf("parent lacks exact authenticated description revision evidence: %+v", parent)
		}
		closures, err := reader.ListPortableFactClosures(ctx, parent.Target.SnapshotRef)
		if err != nil {
			t.Fatalf("catalog-free, signing-key-free authenticated read for parent %s: %v", parent.Target.ParentCommitDigest, err)
		}
		latest := closures[len(closures)-1]
		var bundle portableFactBundle
		if err := decodeStrictRecord(latest.Bundle, &bundle); err != nil {
			t.Fatal(err)
		}
		index := findPortableRecord(t, bundle, "DESCRIPTION_REVISION")
		var portable descriptionPortablePayload
		if err := decodeStrictRecord(bundle.Records[index].Payload, &portable); err != nil {
			t.Fatal(err)
		}
		if portable.ID != description.ID || portable.Revision != description.Revision || portable.BodyDigest != description.BodyDigest || portable.ConfigDigest != configB {
			t.Fatalf("authenticated child rewrote description creation evidence: %+v", portable)
		}
		var attachment *portableFactAttachment
		for i := range bundle.Attachments {
			if bundle.Attachments[i].AttachmentID == portable.BodyAttachmentID {
				attachment = &bundle.Attachments[i]
				break
			}
		}
		if attachment == nil {
			t.Fatalf("description body attachment %q is missing", portable.BodyAttachmentID)
		}
		bodyReader, err := reader.Repo.Open(ctx, attachment.ContentID)
		if err != nil {
			t.Fatalf("open authenticated description body: %v", err)
		}
		body, readErr := io.ReadAll(bodyReader)
		closeErr := bodyReader.Close()
		if readErr != nil || closeErr != nil {
			t.Fatalf("read authenticated description body: read=%v close=%v", readErr, closeErr)
		}
		if int64(len(body)) != attachment.LogicalLength || DigestBytes(body) != attachment.ContentID || !bytes.Equal(body, []byte(description.Body)) {
			t.Fatalf("authenticated description attachment differs from committed body: length=%d/%d digest=%s/%s", len(body), attachment.LogicalLength, DigestBytes(body), attachment.ContentID)
		}
	}
	if description.ConfigDigest != configB {
		t.Fatal("publication mutated the committed description creation config")
	}
}
