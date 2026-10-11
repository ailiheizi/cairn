package exact

import (
	"context"
	"fmt"
	"time"

	"github.com/ailiheizi/cairn/server/internal/repository"
)

// SnapshotIdentity is the authenticated identity of one committed restore
// point: every fact `snapshot.list` can report without assembling the manifest
// entries the publication record carries. It is deliberately not a Manifest,
// because a Manifest without entries would be indistinguishable from an empty
// snapshot to a reader that renders entry counts.
type SnapshotIdentity struct {
	SnapshotRef    string
	CreatedAt      time.Time
	DisplayPath    string
	ManifestDigest string
}

// ListSnapshotIdentities returns the authenticated identity of every committed
// restore point without assembling a single manifest entry.
//
// It exists because assembling entries is the step that costs a full-library
// read: on a real 11,561-entry library the part-bound manifest is hundreds of
// megabytes of strict JSON, and `snapshot.list` reassembles all of it to report
// counts that a caller who only needs the newest ref never reads. This path
// still authenticates every commit marker (object digest, signature, fencing
// token, target repository and generation conflicts) and every prepared closure
// head (schema, signature, commit bindings, placement receipt, payload receipt
// and authenticated metadata evidence) through validatePreparedEnvelopeHead.
//
// What it does not do is reassemble and re-digest the entry parts. A caller
// that reports entry counts, file counts, logical bytes or the protection mix
// must therefore use ListSnapshots, which keeps that validation; a caller that
// only needs to name a restore point uses this, and no surface may present an
// identity as if the omitted counts were zero.
func (s *Service) ListSnapshotIdentities(ctx context.Context) ([]SnapshotIdentity, error) {
	if err := s.requireRepository(); err != nil {
		return nil, err
	}
	if !s.signedPublicationEnabled() {
		// The legacy unsigned profile embeds the whole manifest in the record
		// itself, so reading it is the only way to enumerate restore points.
		manifests, err := listManifests(s.Repo.Root())
		if err != nil {
			return nil, err
		}
		identities := make([]SnapshotIdentity, 0, len(manifests))
		for _, manifest := range manifests {
			identities = append(identities, snapshotIdentityOf(manifest))
		}
		return identities, nil
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return nil, err
	}
	markers, err := listCommitMarkers(ctx, driver, *s.TrustAnchor, s.PublicationDomain)
	if err != nil {
		return nil, err
	}
	identities := make([]SnapshotIdentity, 0, len(markers))
	for i := range markers {
		preparedBytes, err := readRecord(ctx, driver, repository.RecordPreparedClosure, markers[i].Commit.PreparedObjectDigest)
		if err != nil {
			return nil, err
		}
		var envelope PreparedClosureEnvelope
		if err := decodeStrictRecord(preparedBytes, &envelope); err != nil {
			return nil, fmt.Errorf("decode prepared closure %s: %w", markers[i].Commit.PreparedObjectDigest, err)
		}
		if _, err := validatePreparedEnvelopeHead(driver, *s.TrustAnchor, markers[i].Commit, envelope, int64(len(preparedBytes))); err != nil {
			return nil, fmt.Errorf("validate publication %s: %w", markers[i].CommitDigest, err)
		}
		identities = append(identities, snapshotIdentityOf(envelope.Manifest))
	}
	return identities, nil
}

// CommittedSnapshotCount answers the one question `status.get` asks about
// restore points — how many exist — with the same bounded read that
// ListSnapshotIdentities performs, so a status projection never walks a whole
// library to print one count. The contract already classes `status.get` as
// bounded reconciliation and names the committed snapshot count as what it
// returns; this is the implementation of that bound.
func (s *Service) CommittedSnapshotCount(ctx context.Context) (int, error) {
	identities, err := s.ListSnapshotIdentities(ctx)
	if err != nil {
		return 0, err
	}
	return len(identities), nil
}

// NewestSnapshotManifest reads and fully validates only the newest committed
// publication. A reader that renders the newest restore point's entry-derived
// facts — its file counts, logical bytes and protection mix — reads one
// publication instead of assembling every publication in the repository, which
// on a real library is the difference between one manifest and twenty-three.
// The bool is false when the repository holds no committed publication.
func (s *Service) NewestSnapshotManifest(ctx context.Context) (Manifest, bool, error) {
	if err := s.requireRepository(); err != nil {
		return Manifest{}, false, err
	}
	if !s.signedPublicationEnabled() {
		manifests, err := listManifests(s.Repo.Root())
		if err != nil {
			return Manifest{}, false, err
		}
		if len(manifests) == 0 {
			return Manifest{}, false, nil
		}
		return manifests[len(manifests)-1], true, nil
	}
	driver, err := s.publicationRecordDriver()
	if err != nil {
		return Manifest{}, false, err
	}
	markers, err := listCommitMarkers(ctx, driver, *s.TrustAnchor, s.PublicationDomain)
	if err != nil {
		return Manifest{}, false, err
	}
	if len(markers) == 0 {
		return Manifest{}, false, nil
	}
	newest := markers[len(markers)-1]
	preparedBytes, err := readRecord(ctx, driver, repository.RecordPreparedClosure, newest.Commit.PreparedObjectDigest)
	if err != nil {
		return Manifest{}, false, err
	}
	var envelope PreparedClosureEnvelope
	if err := decodeStrictRecord(preparedBytes, &envelope); err != nil {
		return Manifest{}, false, fmt.Errorf("decode prepared closure %s: %w", newest.Commit.PreparedObjectDigest, err)
	}
	manifest, err := validatePreparedEnvelope(ctx, driver, *s.TrustAnchor, newest.Commit, envelope, int64(len(preparedBytes)))
	if err != nil {
		return Manifest{}, false, fmt.Errorf("validate publication %s: %w", newest.CommitDigest, err)
	}
	return manifest, true, nil
}

// snapshotIdentityOf projects the authenticated head of a manifest. For the
// part-bound schema the manifest carries every field except its entries, so the
// identity is exact and does not depend on the omitted parts.
func snapshotIdentityOf(manifest Manifest) SnapshotIdentity {
	return SnapshotIdentity{
		SnapshotRef:    manifest.SnapshotRef,
		CreatedAt:      manifest.CreatedAt,
		DisplayPath:    manifest.Binding.DisplayPath,
		ManifestDigest: manifest.ManifestDigest,
	}
}
