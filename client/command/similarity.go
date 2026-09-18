package command

// Typed inputs and results for the optional similarity surfaces.
//
// Frozen rule, restated on every payload: similarity NEVER establishes exact
// identity and NEVER authorizes deletion. Exact whole-content deduplication
// (SHA-256 plus logical length) remains the only identity grouping. Candidate
// groups are review evidence only; no operation here carries a delete, merge,
// or keep-one action, and no group changes protection, identity, or recovery
// state.

const (
	// SimilarityKindImage scans image subjects for perceptual-hash candidates.
	SimilarityKindImage = "image"
	// SimilarityKindAudio groups subjects by their declared track facts only.
	SimilarityKindAudio = "audio"

	// SimilarityBasisPerceptualHash labels image candidate groups: members
	// carry a 64-bit perceptual hash and a Hamming distance, never an
	// identity claim.
	SimilarityBasisPerceptualHash = "PERCEPTUAL_HASH"
	// SimilarityBasisDeclaredTrackFacts labels audio candidate groups: every
	// member fact is metadata the file itself declared, so the grouping is
	// metadata-derived, never content-derived.
	SimilarityBasisDeclaredTrackFacts = "DECLARED_TRACK_FACTS"

	// SimilarityIdentityBasis is the explicit non-identity statement carried
	// by every similarity.groups answer.
	SimilarityIdentityBasis = "exact identity is whole-content SHA-256 plus logical length; perceptual hashes and declared metadata never establish identity and never authorize deletion"

	// SimilaritySkipNotAnImage: the subject's bytes are not an image media type.
	SimilaritySkipNotAnImage = "NOT_AN_IMAGE"
	// SimilaritySkipUnsupportedImageFormat: the image media type has no
	// admitted stdlib decoder (for example webp); the skip names the format.
	SimilaritySkipUnsupportedImageFormat = "UNSUPPORTED_IMAGE_FORMAT"
	// SimilaritySkipImageDecodeFailed: the bytes declared an admitted image
	// media type but did not decode.
	SimilaritySkipImageDecodeFailed = "IMAGE_DECODE_FAILED"
	// SimilaritySkipImageReadFailed: the repository bytes could not be read or
	// did not match the requested content identity.
	SimilaritySkipImageReadFailed = "IMAGE_READ_FAILED"
	// SimilaritySkipNoDeclaredTrackFacts: no admitted audio track-fact
	// artifact exists for the subject.
	SimilaritySkipNoDeclaredTrackFacts = "NO_DECLARED_TRACK_FACTS"
	// SimilaritySkipSubjectBound: the subject fell outside the bounded scan
	// window and was never examined.
	SimilaritySkipSubjectBound = "SUBJECT_BOUND_EXCEEDED"
	// SimilarityNotScannedReason is the groups-side reason for a subject with
	// no current hash: it is reported as not scanned and is never grouped.
	SimilarityNotScannedReason = "NOT_SCANNED"

	// DefaultSimilarityMaxDistance is the default Hamming threshold out of 64
	// bits for image candidate groups.
	DefaultSimilarityMaxDistance = 8
	// DefaultSimilarityScanSubjects bounds one scan; the default keeps an
	// explicit scan bounded.
	DefaultSimilarityScanSubjects = 200
	// MaxSimilarityScanSubjects is the largest accepted explicit bound.
	MaxSimilarityScanSubjects = 10000
	// SimilarityAudioDurationToleranceMS is the declared-duration tolerance
	// for audio candidate groups: two tracks group only when their declared
	// durations differ by at most this much.
	SimilarityAudioDurationToleranceMS = 2000
)

// SimilaritySkippedItem is one subject the scan examined (or skipped by bound)
// without producing a hash, always with its explicit reason.
type SimilaritySkippedItem struct {
	SubjectRef string `json:"subject_ref"`
	Name       string `json:"name,omitempty"`
	Reason     string `json:"reason"`
	Detail     string `json:"detail,omitempty"`
}

// SimilarityNotScannedItem is one subject that currently has no hash. It is
// reported as not scanned and is never grouped.
type SimilarityNotScannedItem struct {
	SubjectRef string `json:"subject_ref"`
	Name       string `json:"name,omitempty"`
	Reason     string `json:"reason"`
}

// SimilarityScanData is the honest per-subject accounting of one explicit
// scan. ScannedCount counts subjects that now carry a current hash (image) or
// declared track facts (audio); Skipped names every examined-but-not-hashed
// subject with its reason; NotScannedCount counts subjects never examined
// because the bounded window closed.
type SimilarityScanData struct {
	WorkspaceID        string                     `json:"workspace_id"`
	Kind               string                     `json:"kind"`
	SubjectBound       int                        `json:"subject_bound"`
	Considered         int                        `json:"considered"`
	ScannedCount       int                        `json:"scanned_count"`
	NewHashCount       int                        `json:"new_hash_count"`
	NotScannedCount    int                        `json:"not_scanned_count"`
	NotScanned         []SimilarityNotScannedItem `json:"not_scanned"`
	NotScannedOmitted  int                        `json:"not_scanned_omitted"`
	Skipped            []SimilaritySkippedItem    `json:"skipped"`
	SkippedOmitted     int                        `json:"skipped_omitted"`
	SkipCounts         map[string]int             `json:"skip_counts"`
	NotContentIdentity bool                       `json:"not_content_identity"`
}

// SimilarityMember is one candidate-group member. Image members carry the
// perceptual hash and their Hamming distance to the group representative;
// audio members carry their declared track facts and the duration delta to
// the representative. ExactDuplicateWith names the other group members that
// share this member's exact content identity: they are flagged, never merged,
// and remain separate subjects.
type SimilarityMember struct {
	SubjectRef          string   `json:"subject_ref"`
	Name                string   `json:"name,omitempty"`
	ContentID           string   `json:"content_id,omitempty"`
	HashHex             string   `json:"hash,omitempty"`
	Distance            int      `json:"distance"`
	ExactDuplicatesWith []string `json:"exact_duplicate_with,omitempty"`
	Artist              string   `json:"artist,omitempty"`
	Title               string   `json:"title,omitempty"`
	DurationMS          int64    `json:"duration_ms"`
	DurationDeltaMS     int64    `json:"duration_delta_ms"`
}

// SimilarityGroup is one candidate group. Basis labels the evidence the group
// was formed from; it is never an identity claim.
type SimilarityGroup struct {
	Representative          SimilarityMember   `json:"representative"`
	Members                 []SimilarityMember `json:"members"`
	Basis                   string             `json:"basis"`
	ContainsExactDuplicates bool               `json:"contains_exact_duplicates"`
}

// SimilarityGroupsData is the similarity.groups answer. NotContentIdentity
// and IdentityBasis restate the frozen rule on every payload: candidate
// groups are review evidence only and offer no delete or merge action.
type SimilarityGroupsData struct {
	WorkspaceID        string                     `json:"workspace_id"`
	Kind               string                     `json:"kind"`
	Basis              string                     `json:"basis"`
	Algorithm          string                     `json:"algorithm,omitempty"`
	MaxDistance        int                        `json:"max_distance,omitempty"`
	NotContentIdentity bool                       `json:"not_content_identity"`
	IdentityBasis      string                     `json:"identity_basis"`
	ScannedCount       int                        `json:"scanned_count"`
	NotScannedCount    int                        `json:"not_scanned_count"`
	NotScanned         []SimilarityNotScannedItem `json:"not_scanned"`
	NotScannedOmitted  int                        `json:"not_scanned_omitted"`
	NotGroupedCount    int                        `json:"not_grouped_count"`
	Groups             []SimilarityGroup          `json:"groups"`
}
