package command

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
)

type StatusData struct {
	Controller    string            `json:"controller"`
	ConfigDigest  string            `json:"config_digest,omitempty"`
	Catalog       CatalogStatus     `json:"catalog"`
	Identify      IdentifyStatus    `json:"identify"`
	Repository    *RepositoryStatus `json:"repository,omitempty"`
	Publications  int               `json:"publications,omitempty"`
	Plans         int               `json:"plans,omitempty"`
	RecentPlans   []PlanSummary     `json:"recent_plans,omitempty"`
	Jobs          int               `json:"jobs,omitempty"`
	RecentJobs    []JobSummary      `json:"recent_jobs,omitempty"`
	OpenHandles   int               `json:"open_handles,omitempty"`
	ReapedHandles int               `json:"reaped_handles,omitempty"`
	Listen        string            `json:"listen,omitempty"`
	Unimplemented []string          `json:"unimplemented"`
	// Index reports the read-only discovery-index projection per workspace.
	// It is omitted when no workspace exists yet; callers must not read an
	// absent entry as READY or as a catalog-wide index claim.
	Index []IndexStatusData `json:"index,omitempty"`
}

// JobSummary is the bounded durable job projection used by status.get and
// job.list. Fields whose recorded value is absent are omitted; a missing
// error_code is not the same claim as a successful job. checkpoint_present is
// only a hint that the durable checkpoint column holds content beyond its
// empty-object default, never a claim about run progress.
type JobSummary struct {
	JobID             string `json:"job_id"`
	WorkspaceID       string `json:"workspace_id"`
	PlanID            string `json:"plan_id,omitempty"`
	Kind              string `json:"kind"`
	State             string `json:"state"`
	Attempt           int64  `json:"attempt,omitempty"`
	MaxAttempts       int64  `json:"max_attempts,omitempty"`
	ErrorCode         string `json:"error_code,omitempty"`
	CheckpointPresent bool   `json:"checkpoint_present,omitempty"`
	UpdatedAt         string `json:"updated_at,omitempty"`
}

// JobListData is the job.list payload. Jobs are ordered by most recent update.
// A workspace filter narrows the newest rows selected by limit; it never widens
// the bound.
type JobListData struct {
	Jobs []JobSummary `json:"jobs"`
}

// IndexStatusData is the read-only discovery-index projection for one
// workspace. Lexical and Semantic reuse the same READY / NOT_BUILT /
// UNAVAILABLE vocabulary as per-item index status and are never aggregated
// into a catalog-wide claim: a single-workspace profile may present its entry
// as the global state, while a catalog with several workspaces must show them
// separately instead of inventing an aggregate.
type IndexStatusData struct {
	WorkspaceID    string `json:"workspace_id,omitempty"`
	Lexical        string `json:"lexical"`
	Semantic       string `json:"semantic"`
	SemanticReason string `json:"semantic_reason,omitempty"`
}

type PlanSummary struct {
	PlanID      string `json:"plan_id"`
	WorkspaceID string `json:"workspace_id"`
	Kind        string `json:"kind"`
	State       string `json:"state"`
	PlanDigest  string `json:"plan_digest,omitempty"`
	CreatedAt   string `json:"created_at,omitempty"`
}

// CatalogSchemaState names the runtime comparison between the applied
// migration ledger and this binary's embedded migrations. DRIFT and
// NEWER_THAN_BINARY mirror the open-time schema errors as reported facts.
const (
	CatalogSchemaCurrent         = "CURRENT"
	CatalogSchemaDrift           = "DRIFT"
	CatalogSchemaNewerThanBinary = "NEWER_THAN_BINARY"
	CatalogSchemaUnknown         = "UNKNOWN"
)

type CatalogStatus struct {
	Path string `json:"path"`
	OK   bool   `json:"ok"`
	// SchemaVersion and SchemaMigration are read from the catalog's applied
	// migration ledger. They are omitted when no ledger can be read;
	// SchemaState then reports UNKNOWN with a reason instead of a zero version.
	SchemaVersion       int    `json:"schema_version,omitempty"`
	SchemaMigration     string `json:"schema_migration,omitempty"`
	SchemaState         string `json:"schema_state,omitempty"`
	SchemaReason        string `json:"schema_reason,omitempty"`
	SchemaBinaryVersion int    `json:"schema_binary_version,omitempty"`
}

// Repository writability states. A probe that cannot run reports UNKNOWN with
// a reason; it is never collapsed into WRITABLE or READ_ONLY.
const (
	RepositoryWritableStateWritable = "WRITABLE"
	RepositoryWritableStateReadOnly = "READ_ONLY"
	RepositoryWritableStateUnknown  = "UNKNOWN"
)

type RepositoryStatus struct {
	Path               string `json:"path,omitempty"`
	RepositoryProfile  string `json:"repository_profile,omitempty"`
	CompressionProfile string `json:"compression_profile,omitempty"`
	OK                 bool   `json:"ok"`
	Snapshots          int    `json:"snapshots"`
	CapacityState      string `json:"capacity_state,omitempty"`
	CapacityTotal      uint64 `json:"capacity_total,omitempty"`
	CapacityFree       uint64 `json:"capacity_free,omitempty"`
	CapacityUsed       uint64 `json:"capacity_used,omitempty"`
	CapacityMeasuredAt string `json:"capacity_measured_at,omitempty"`
	CapacityReason     string `json:"capacity_reason,omitempty"`
	// Writable is the result of a live zero-byte probe: it creates and
	// immediately removes one empty probe file under the repository root and
	// never touches existing data. It is omitted when no repository is
	// attached.
	Writable          string `json:"writable,omitempty"`
	WritableReason    string `json:"writable_reason,omitempty"`
	WritableCheckedAt string `json:"writable_checked_at,omitempty"`
}

type IdentifyStatus struct {
	ID          string `json:"id"`
	RulesDigest string `json:"rules_digest"`
}

type CapabilityListData struct {
	Capabilities []Capability `json:"capabilities"`
}

type Capability struct {
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	State   string `json:"state"`
	Version string `json:"version,omitempty"`
	Source  string `json:"source,omitempty"`
	Notes   string `json:"notes,omitempty"`
}

// ConfigData is the daemon-owned persisted operator profile. Config contains
// the validated cairn.config.v1 document as a JSON object. Credential
// fields are references only; secret values are rejected by config validation.
type ConfigData struct {
	ConfigPath          string          `json:"config_path"`
	ConfigDigest        string          `json:"config_digest"`
	RunningConfigDigest string          `json:"running_config_digest"`
	RestartRequired     bool            `json:"restart_required"`
	Config              json.RawMessage `json:"config"`
}

type SnapshotListData struct {
	Snapshots []SnapshotSummary `json:"snapshots"`
}

// SnapshotSummary is the restore-point projection from snapshot.list. The
// counts and the protection mix are computed live from the repository-loaded
// manifest, never from the rebuildable catalog. Verification is always
// present: State UNRECORDED carries the reason no receipt exists, so an
// unverified restore point never renders as a zeroed verification time.
//
// The entry-derived fields are pointers with `omitempty` on purpose. The
// default full projection always sets them, including a genuine zero, so
// `"protected_files": 0` still means "read, and none were protected". The
// bounded identity projection does not read the manifest entries at all, and it
// leaves these fields nil so the keys are absent: a caller can then tell "not
// read" from "read as zero", and a consumer that would render a count must
// treat absence as unknown rather than as zero.
type SnapshotSummary struct {
	SnapshotRef     string `json:"snapshot_ref"`
	CreatedAt       string `json:"created_at,omitempty"`
	DisplayPath     string `json:"display_path,omitempty"`
	ManifestDigest  string `json:"manifest_digest,omitempty"`
	WorkspaceID     string `json:"workspace_id,omitempty"`
	NamespaceRootID string `json:"namespace_root_id,omitempty"`
	// Entries counts every manifest entry; Files counts regular files; Bytes
	// sums the recorded logical sizes of regular files. BytesComplete is false
	// when any regular file lacks a recorded size, so a partial sum is never
	// presented as the whole.
	Entries       *int   `json:"entries,omitempty"`
	Files         *int   `json:"files,omitempty"`
	Bytes         *int64 `json:"bytes,omitempty"`
	BytesComplete *bool  `json:"bytes_complete,omitempty"`
	// ProtectedFiles counts file entries with a locally verified exact payload
	// (EXACT_PROTECTED / EXACT_FALLBACK). UnprotectedFiles counts file entries
	// explicitly recorded as not locally protected (LINK_ONLY_UNPROTECTED /
	// EXPLICITLY_UNPROTECTED). ProtectionOutcomes is the faithful count of every
	// regular file by recorded outcome, including UNRECORDED for a legacy entry
	// without one, so blocked, unavailable, and external-replayable members
	// stay visible instead of disappearing from the mix.
	ProtectedFiles     *int                      `json:"protected_files,omitempty"`
	UnprotectedFiles   *int                      `json:"unprotected_files,omitempty"`
	ProtectionOutcomes map[string]int            `json:"protection_outcomes,omitempty"`
	Verification       *SnapshotVerificationData `json:"verification,omitempty"`
}

// Snapshot verification receipt states and outcomes. A receipt is written once
// per snapshot.verify run and is never rewritten.
const (
	SnapshotVerificationStateRecorded   = "RECORDED"
	SnapshotVerificationStateUnrecorded = "UNRECORDED"

	SnapshotVerificationOutcomeSucceeded   = "SUCCEEDED"
	SnapshotVerificationOutcomeFailed      = "FAILED"
	SnapshotVerificationOutcomeUnavailable = "UNAVAILABLE"

	// SnapshotProtectionOutcomeUnrecorded buckets a regular file whose
	// manifest entry carries no recorded protection outcome.
	SnapshotProtectionOutcomeUnrecorded = "UNRECORDED"
)

// SnapshotVerificationData is the newest recorded snapshot.verify receipt for
// one restore point. Attempted and passed counts are the values the run
// actually reached. An UNRECORDED state means no receipt exists and Reason
// explains why; its receipt fields stay empty rather than zero-valued.
type SnapshotVerificationData struct {
	State           string `json:"state"`
	Reason          string `json:"reason,omitempty"`
	Mode            string `json:"mode,omitempty"`
	Outcome         string `json:"outcome,omitempty"`
	AttemptedFiles  int    `json:"attempted_files,omitempty"`
	AttemptedBytes  int64  `json:"attempted_bytes,omitempty"`
	PassedFiles     int    `json:"passed_files,omitempty"`
	PassedBytes     int64  `json:"passed_bytes,omitempty"`
	OK              bool   `json:"ok,omitempty"`
	RestoreVerified bool   `json:"restore_verified,omitempty"`
	// FailureReason is the recorded reason for a FAILED or UNAVAILABLE
	// receipt; it stays empty for a successful run.
	FailureReason string `json:"failure_reason,omitempty"`
	VerifiedAt    string `json:"verified_at,omitempty"`
	RequestID     string `json:"request_id,omitempty"`
}

// SourceListData is a read-only projection of configured source provenance.
// Reachability is a transient host probe and must not be confused with the
// durable source state or used as evidence that a source was retired.
type SourceListData struct {
	WorkspaceID string              `json:"workspace_id"`
	Sources     []SourceSummaryData `json:"sources"`
}

type SourceSummaryData struct {
	SourceRef             string          `json:"source_ref"`
	Kind                  string          `json:"kind"`
	Locator               string          `json:"locator"`
	State                 string          `json:"state"`
	Reachability          string          `json:"reachability"`
	ReachabilityCheckedAt string          `json:"reachability_checked_at"`
	ReachabilityMessage   string          `json:"reachability_message,omitempty"`
	LatestScan            *SourceScanData `json:"latest_scan,omitempty"`
	LatestSnapshotRef     string          `json:"latest_snapshot_ref,omitempty"`
	LatestNamespaceRootID string          `json:"latest_namespace_root_id,omitempty"`
	// Staging is present only on the daemon-owned upload-inbox entry. The
	// inbox is daemon scratch, not a captured source: it has no source_ref
	// and no catalog SourceRecord exists for it.
	Staging *SourceStagingData `json:"staging,omitempty"`
}

// SourceStagingData is the honest projection of the daemon-owned upload
// inbox. ProtectionRecord is always NONE until the operator reviews and
// applies an ingest plan over the staged directory; the entry exists only
// while the inbox holds files.
type SourceStagingData struct {
	Path             string `json:"path"`
	Files            int    `json:"files"`
	Bytes            int64  `json:"bytes"`
	ProtectionRecord string `json:"protection_record"`
	Note             string `json:"note,omitempty"`
}

type SourceScanData struct {
	ScanRef           string `json:"scan_ref"`
	Generation        int64  `json:"generation"`
	State             string `json:"state"`
	FullTraversal     bool   `json:"full_traversal"`
	StartedAt         string `json:"started_at,omitempty"`
	FinishedAt        string `json:"finished_at,omitempty"`
	Entries           uint64 `json:"entries"`
	RegularFiles      uint64 `json:"regular_files"`
	Directories       uint64 `json:"directories"`
	Symlinks          uint64 `json:"symlinks"`
	SpecialFiles      uint64 `json:"special_files"`
	BytesHashed       int64  `json:"bytes_hashed"`
	FailedEntries     uint64 `json:"failed_entries"`
	UnstableEntries   uint64 `json:"unstable_entries"`
	DetectionFailures uint64 `json:"detection_failures"`
}

type PlanIngestData struct {
	WorkspaceID         string                         `json:"workspace_id"`
	SourceID            string                         `json:"source_id"`
	ScanID              string                         `json:"scan_id"`
	RootID              string                         `json:"root_id"`
	SnapshotRef         string                         `json:"snapshot_ref"`
	ManifestDigest      string                         `json:"manifest_digest"`
	PlanID              string                         `json:"plan_id,omitempty"`
	PlanDigest          string                         `json:"plan_digest,omitempty"`
	JobID               string                         `json:"job_id,omitempty"`
	ProtectionMode      string                         `json:"protection_mode"`
	ProtectionDigest    string                         `json:"protection_digest,omitempty"`
	FileProtection      map[string]string              `json:"file_protection,omitempty"`
	ProtectionDecisions []IngestProtectionDecisionData `json:"protection_decisions,omitempty"`
	BlockedEntries      []IngestPlanIssueData          `json:"blocked_entries,omitempty"`
	Files               int                            `json:"files"`
	Bytes               int64                          `json:"bytes"`
	LocalFiles          int                            `json:"local_files"`
	LocalBytes          int64                          `json:"local_bytes"`
	NewBytes            int64                          `json:"new_bytes"`
	LinkOnlyFiles       int                            `json:"link_only_files"`
	LocatorCount        int                            `json:"locator_count"`
	State               string                         `json:"state,omitempty"`
	Executable          bool                           `json:"executable"`
	ConfigDigest        string                         `json:"config_digest,omitempty"`
	SourceBasisDigest   string                         `json:"source_basis_digest,omitempty"`
}

type IngestProtectionDecisionData struct {
	RelativePath         string `json:"relative_path"`
	Mode                 string `json:"mode"`
	PlannedOutcome       string `json:"planned_outcome"`
	ReasonCode           string `json:"reason_code"`
	ExpectedContentID    string `json:"expected_content_id"`
	ExpectedLogicalBytes int64  `json:"expected_logical_bytes"`
	LocatorCount         int    `json:"locator_count"`
}

type IngestPlanIssueData struct {
	RelativePath   string `json:"relative_path"`
	Mode           string `json:"mode"`
	PlannedOutcome string `json:"planned_outcome"`
	State          string `json:"state"`
	ReasonCode     string `json:"reason_code"`
	Message        string `json:"message,omitempty"`
}

// IngestLocatorInput is the command-ABI projection of one external recovery
// locator. Path is relative to the capture root and may be omitted only for a
// capture containing exactly one regular file.
type IngestLocatorInput struct {
	Path              string `json:"path,omitempty"`
	Kind              string `json:"kind,omitempty"`
	Locator           string `json:"locator"`
	DisplayLocator    string `json:"display_locator,omitempty"`
	CredentialRef     string `json:"credential_ref,omitempty"`
	RightsEvidenceRef string `json:"rights_evidence_ref,omitempty"`
}

type JobEventData struct {
	Sequence   int64           `json:"sequence"`
	EventID    string          `json:"event_id"`
	Action     string          `json:"action"`
	Outcome    string          `json:"outcome"`
	OccurredAt string          `json:"occurred_at,omitempty"`
	Details    json.RawMessage `json:"details,omitempty"`
}

type JobEventsData struct {
	JobID        string         `json:"job_id"`
	JobState     string         `json:"job_state"`
	Events       []JobEventData `json:"events"`
	NextSequence int64          `json:"next_sequence"`
	Terminal     bool           `json:"terminal"`
}

type JobCancelData struct {
	JobID             string `json:"job_id"`
	JobState          string `json:"job_state"`
	Cancelled         bool   `json:"cancelled"`
	AlreadyTerminal   bool   `json:"already_terminal"`
	CancellationAsked bool   `json:"cancellation_asked"`
}

const PlanReceiptSchema = "org.cairn.plan.v1"

type PlanGetData struct {
	PlanID            string          `json:"plan_id"`
	WorkspaceID       string          `json:"workspace_id"`
	Kind              string          `json:"kind"`
	State             string          `json:"state"`
	PlanDigest        string          `json:"plan_digest"`
	Applied           bool            `json:"applied"`
	Executable        bool            `json:"executable"`
	Abandoned         bool            `json:"abandoned,omitempty"`
	BasePlanID        string          `json:"base_plan_id,omitempty"`
	Plan              json.RawMessage `json:"plan,omitempty"`
	CreatedAt         string          `json:"created_at,omitempty"`
	SourceBasisDigest string          `json:"source_basis_digest,omitempty"`
}

type PlanReviseData struct {
	PlanID      string `json:"plan_id"`
	PlanDigest  string `json:"plan_digest"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	BasePlanID  string `json:"base_plan_id"`
	BaseDigest  string `json:"base_plan_digest"`
	Kind        string `json:"kind"`
	State       string `json:"state"`
	Applied     bool   `json:"applied"`
	Executable  bool   `json:"executable"`
	SnapshotRef string `json:"snapshot_ref,omitempty"`
}

type PlanAbandonData struct {
	PlanID           string `json:"plan_id"`
	PlanDigest       string `json:"plan_digest"`
	AbandonedPlanID  string `json:"abandoned_plan_id"`
	AlreadyAbandoned bool   `json:"already_abandoned"`
}

type DoctorData struct {
	OK            bool           `json:"ok"`
	Checks        []DoctorCheck  `json:"checks"`
	StorageReport *StorageReport `json:"storage_report,omitempty"`
}

// StorageReport is an explicit, read-only Phase 5 projection. Each category
// carries its own state so an unknown measurement is never presented as zero.
type StorageReport struct {
	Status                                  string             `json:"status"`
	Reason                                  string             `json:"reason,omitempty"`
	Basis                                   string             `json:"basis"`
	ConfigDigest                            string             `json:"config_digest,omitempty"`
	RepositoryProfile                       string             `json:"repository_profile,omitempty"`
	CompressionProfile                      string             `json:"compression_profile,omitempty"`
	SnapshotCount                           *int               `json:"snapshot_count,omitempty"`
	RetainedExactReferenceBytes             StorageByteMeasure `json:"retained_exact_reference_bytes"`
	UniqueExactObjectLogicalBytes           StorageByteMeasure `json:"unique_exact_object_logical_bytes"`
	WholeFileDuplicateReferenceSavingsBytes StorageByteMeasure `json:"whole_file_duplicate_reference_savings_bytes"`
	CompressionSavingsBytes                 StorageByteMeasure `json:"compression_savings_bytes"`
	StoredObjectFileBytes                   StorageByteMeasure `json:"stored_object_file_bytes"`
	RepositoryMetadataFileBytes             StorageByteMeasure `json:"repository_metadata_file_bytes"`
	RepositoryRecoveryRecordFileBytes       StorageByteMeasure `json:"repository_recovery_record_file_bytes"`
	CatalogFileBytes                        StorageByteMeasure `json:"catalog_file_bytes"`
	VectorIndexFileBytes                    StorageByteMeasure `json:"vector_index_file_bytes"`
	ModelFileBytes                          StorageByteMeasure `json:"model_file_bytes"`
	ConfiguredRecoveryRecordsFileBytes      StorageByteMeasure `json:"configured_recovery_records_file_bytes"`
	TemporaryFileBytes                      StorageByteMeasure `json:"temporary_file_bytes"`
	RetainedSourceBytes                     StorageByteMeasure `json:"retained_source_bytes"`
	RepositoryFootprintFileBytes            StorageByteMeasure `json:"repository_footprint_file_bytes"`
	NetSavingsBytes                         StorageByteMeasure `json:"net_savings_bytes"`
}

// StorageByteMeasure omits Bytes unless the measurement completed. In
// particular, an unknown category is not encoded as a numeric zero.
type StorageByteMeasure struct {
	Status string `json:"status"`
	Bytes  *int64 `json:"bytes,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type DoctorCheck struct {
	ID      string `json:"id"`
	OK      bool   `json:"ok"`
	Scope   string `json:"scope,omitempty"`
	Message string `json:"message"`
}

type PlanApplyData struct {
	PlanID                string                         `json:"plan_id"`
	PlanDigest            string                         `json:"plan_digest"`
	AlreadyApplied        bool                           `json:"already_applied"`
	SnapshotRef           string                         `json:"snapshot_ref,omitempty"`
	JobID                 string                         `json:"job_id,omitempty"`
	State                 string                         `json:"state,omitempty"`
	WorkspaceID           string                         `json:"workspace_id,omitempty"`
	SourceID              string                         `json:"source_id,omitempty"`
	ScanID                string                         `json:"scan_id,omitempty"`
	RootID                string                         `json:"root_id,omitempty"`
	ManifestDigest        string                         `json:"manifest_digest,omitempty"`
	ProtectionDigest      string                         `json:"protection_digest,omitempty"`
	ProtectionDecisions   []IngestProtectionDecisionData `json:"protection_decisions,omitempty"`
	Destination           string                         `json:"destination,omitempty"`
	Files                 int                            `json:"files,omitempty"`
	Bytes                 int64                          `json:"bytes,omitempty"`
	LocalBytes            int64                          `json:"local_bytes"`
	NewBytes              int64                          `json:"new_bytes"`
	SavingsMeasured       bool                           `json:"savings_measured"`
	NewPhysicalBytes      int64                          `json:"new_physical_bytes"`
	CompressionSavedBytes int64                          `json:"compression_saved_bytes"`
	Warnings              []string                       `json:"warnings,omitempty"`
}

type PlanRestoreData struct {
	WorkspaceID string `json:"workspace_id"`
	SnapshotRef string `json:"snapshot_ref"`
	Destination string `json:"destination,omitempty"`
	Files       int    `json:"files"`
	Bytes       int64  `json:"bytes"`
	Wrote       bool   `json:"wrote"`
	PlanID      string `json:"plan_id,omitempty"`
	PlanDigest  string `json:"plan_digest,omitempty"`
	State       string `json:"state,omitempty"`
	Executable  bool   `json:"executable"`
}

const (
	VerifyAuthenticatedMetadata = "authenticated-metadata"
	VerifySampledContent        = "sampled-content"
	VerifyFullBytes             = "full-bytes"
	VerifyRestoreDrill          = "restore-drill"
	VerifyCleanRecovery         = "clean-recovery"
)

type SnapshotVerifyData struct {
	SnapshotRef     string `json:"snapshot_ref"`
	Mode            string `json:"mode,omitempty"`
	AcceptedLevel   string `json:"accepted_level,omitempty"`
	Entries         int    `json:"entries"`
	Files           int    `json:"files"`
	Bytes           int64  `json:"bytes"`
	AttemptedFiles  int    `json:"attempted_files,omitempty"`
	AttemptedBytes  int64  `json:"attempted_bytes,omitempty"`
	PassedFiles     int    `json:"passed_files,omitempty"`
	PassedBytes     int64  `json:"passed_bytes,omitempty"`
	OK              bool   `json:"ok"`
	RestoreVerified bool   `json:"restore_verified,omitempty"`
	CatalogUsed     bool   `json:"catalog_used"`
}

const (
	AnnotationConflictFail         = "fail"
	AnnotationConflictKeepLocal    = "keep-local"
	AnnotationConflictKeepImported = "keep-imported"
)

const (
	DiffAdded           = "added"
	DiffRemoved         = "removed"
	DiffMoved           = "moved"
	DiffContentChanged  = "content_changed"
	DiffMetadataChanged = "metadata_changed"
	DiffTypeChanged     = "type_changed"
)

type SnapshotDiffData struct {
	FromSnapshotRef string             `json:"from_snapshot_ref"`
	ToSnapshotRef   string             `json:"to_snapshot_ref"`
	Changes         []SnapshotDiffItem `json:"changes"`
}

type SnapshotDiffItem struct {
	Kind          string `json:"kind"`
	Path          string `json:"path,omitempty"`
	FromPath      string `json:"from_path,omitempty"`
	ToPath        string `json:"to_path,omitempty"`
	EntryType     string `json:"entry_type,omitempty"`
	FromType      string `json:"from_type,omitempty"`
	ToType        string `json:"to_type,omitempty"`
	ContentID     string `json:"content_id,omitempty"`
	FromContentID string `json:"from_content_id,omitempty"`
	ToContentID   string `json:"to_content_id,omitempty"`
}

type RecoveryExportData struct {
	SnapshotRef         string `json:"snapshot_ref"`
	Schema              string `json:"schema"`
	ManifestDigest      string `json:"manifest_digest"`
	ArtifactPath        string `json:"artifact_path"`
	Length              int64  `json:"length"`
	Files               int    `json:"files"`
	Bytes               int64  `json:"bytes"`
	IndependentlyStored bool   `json:"independently_stored"`
}

// RecoveryAnchorExportData is the public result of recovery.anchor.export.
// It intentionally exposes only verification metadata; the exported file
// itself contains the public key and never contains private signing material.
type RecoveryAnchorExportData struct {
	Schema            string `json:"schema"`
	ArtifactPath      string `json:"artifact_path"`
	PublicationDomain string `json:"publication_domain"`
	WriterIdentity    string `json:"writer_identity"`
	KeyID             string `json:"key_id"`
	Algorithm         string `json:"algorithm"`
	PublicKeyDigest   string `json:"public_key_digest"`
}

const (
	CapabilityAvailable   = "AVAILABLE"
	CapabilityUnavailable = "UNAVAILABLE"
	CapabilityExternal    = "EXTERNAL"
)

// NamespaceListData is the namespace.list payload. Entries are returned in
// deterministic raw-name order exactly as the catalog stores them.
type NamespaceListData struct {
	RootID   string               `json:"root_id"`
	ParentID string               `json:"parent_id,omitempty"`
	Entries  []NamespaceEntryData `json:"entries"`
}

// PageCompleteness is the explicit three-state answer a caller must be able to
// tell apart. Collapsing the last two states into one is the dishonest case:
// "there is nothing more" and "this lane cannot tell you" are different
// answers.
const (
	// PageCompletenessComplete means this answer provably contains every match
	// of the query.
	PageCompletenessComplete = "COMPLETE"
	// PageCompletenessMoreAvailable means the daemon proved at least one further
	// match exists beyond this answer.
	PageCompletenessMoreAvailable = "MORE_AVAILABLE"
	// PageCompletenessBoundedUnknown means this answer was cut by a bound the
	// daemon cannot page (a bounded top-k lane, or a lane that did not answer),
	// so it neither contains everything nor can say that more exists.
	PageCompletenessBoundedUnknown = "BOUNDED_UNKNOWN"
)

// PageMode names the request shape an answer was produced for.
const (
	// PageModeDefault is the pre-existing single-answer shape: the caller asked
	// for no bound of its own and the daemon's own bound applied. For
	// content.list that default is the complete workspace projection.
	PageModeDefault = "default"
	// PageModePage is an explicitly requested bounded page.
	PageModePage = "page"
)

// PageTruncationReason names why an answer was cut by a bound the daemon
// cannot page.
const (
	// PageTruncationBoundedTopK means the lane ranks a bounded candidate set
	// (a top-k answer) and has no seekable order, so the match set behind it is
	// not materializable as pages.
	PageTruncationBoundedTopK = "BOUNDED_TOP_K"
	// PageTruncationResultLimit means the pre-paging single-answer bound cut the
	// answer. It is pageable on the lexical lane; request a page to continue.
	PageTruncationResultLimit = "RESULT_LIMIT"
	// PageTruncationUnansweredLane means a declared lane did not answer, so its
	// possible matches are absent from this union.
	PageTruncationUnansweredLane = "LANE_DID_NOT_ANSWER"
)

// PageContinuationReason names why an answer carries no continuation.
const (
	// PageContinuationBoundedLane means the answer came from a bounded top-k
	// lane, which has no seekable order to resume.
	PageContinuationBoundedLane = "LANE_IS_BOUNDED_TOP_K"
	// PageContinuationFusedUnion means the answer is a fusion of lanes, at
	// least one of which is a bounded top-k set. A union that mixes a complete
	// match set with a bounded one is inherently partial and cannot be one
	// continuation chain; page the complete lane instead.
	PageContinuationFusedUnion = "FUSED_UNION_INCLUDES_BOUNDED_TOP_K"
)

// PageLaneData is one lane's completeness inside a multi-lane answer.
type PageLaneData struct {
	Dimension string `json:"dimension"`
	// Status is the lane's own component status (SUCCEEDED, SKIPPED,
	// DEGRADED, ...). It is copied from the fused component so a caller does
	// not have to join two lists.
	Status   string `json:"status"`
	Returned int    `json:"returned"`
	// Limit is the bound applied to this lane, or 0 when the lane applies no
	// page bound of its own.
	Limit int `json:"limit"`
	// Complete is true only when this lane provably returned every match it
	// was asked for.
	Complete bool `json:"complete"`
	// HasMore is true only when this lane proved further matches exist.
	HasMore bool `json:"has_more"`
	// Truncated is true when this lane's answer was cut by a bound it cannot
	// page.
	Truncated bool `json:"truncated"`
	// BoundedTopK is the lane's top-k ceiling, or 0 when the lane is not a
	// bounded top-k lane.
	BoundedTopK int `json:"bounded_top_k,omitempty"`
	// Pageable is true only for a lane whose complete match set the daemon can
	// walk in bounded pages.
	Pageable bool `json:"pageable"`
}

// PageData states plainly how one answer was bounded. It is present on every
// search.query and content.list answer so a caller can never mistake a partial
// answer for the whole answer, and never has to infer a bound from a count.
type PageData struct {
	// Mode is the request shape this answer was produced for.
	Mode string `json:"mode"`
	// Limit is the page bound actually applied to this answer. It mirrors the
	// request's page.limit. It is 0 when no page bound was applied and the
	// answer carries every entry the projection holds, and it is also 0 on a
	// fused answer, where no single bound applies to the union: each lane
	// reports its own bound in Lanes instead.
	Limit int `json:"limit"`
	// Returned is the number of hits or items in this answer.
	Returned int `json:"returned"`
	// Entries is the total number of entries the daemon's projection holds for
	// the queried scope, when that total is exactly known. It is present on
	// content.list answers and omitted where an exact total cannot be produced
	// without evaluating every candidate, rather than reported as a guess.
	Entries *int `json:"entries,omitempty"`
	// Completeness is the explicit three-state answer. It is the field a
	// caller should branch on.
	Completeness string `json:"completeness"`
	// Complete is true only when Completeness is PageCompletenessComplete.
	Complete bool `json:"complete"`
	// HasMore is true only when Completeness is PageCompletenessMoreAvailable.
	HasMore bool `json:"has_more"`
	// Truncated is true when this answer was cut by a bound the daemon cannot
	// page. It is never set merely because more results exist on a pageable
	// lane.
	Truncated bool `json:"truncated"`
	// TruncationReason is the stable reason when Truncated is true.
	TruncationReason string `json:"truncation_reason,omitempty"`
	// Lane names the single lane this answer came from, when there is one.
	Lane string `json:"lane,omitempty"`
	// Lanes reports per-lane completeness for a multi-lane (fused) answer.
	Lanes []PageLaneData `json:"lanes,omitempty"`
	// Order names the total order the page was produced in. A pageable answer
	// always names one.
	Order string `json:"order,omitempty"`
	// ContinuationSupported is true only when the daemon can continue this
	// exact chain.
	ContinuationSupported bool `json:"continuation_supported"`
	// ContinuationReason is the stable reason when ContinuationSupported is
	// false.
	ContinuationReason string `json:"continuation_reason,omitempty"`
	// Token is the opaque continuation for this exact query and generation. It
	// is the value to send back as the next request's page.token. It is present
	// only when ContinuationSupported is true and more matches exist.
	Token string `json:"token,omitempty"`
	// ExpiresAt is when Token stops being accepted (RFC 3339, UTC). A
	// caller that reaches it restarts the chain; an expired cursor is refused
	// rather than answered.
	ExpiresAt string `json:"expires_at,omitempty"`
}

// ContentListData is the flat, read-only content-library projection. Paths
// are provenance strings; subject refs remain the stable catalog identity.
type ContentListData struct {
	WorkspaceID string            `json:"workspace_id"`
	RootID      string            `json:"root_id"`
	Roots       []ContentRootData `json:"roots,omitempty"`
	Items       []ContentItemData `json:"items"`
	// Page states plainly how this projection was bounded and how many entries
	// the projection holds in total.
	Page *PageData `json:"page,omitempty"`
}

// ContentRootData is a read-only source-path browsing choice projected from
// the latest published namespace roots.
type ContentRootData struct {
	RootID     string `json:"root_id"`
	Name       string `json:"name"`
	SourcePath string `json:"source_path,omitempty"`
}

type ContentItemData struct {
	SubjectRef  string `json:"subject_ref"`
	EntryID     string `json:"entry_id,omitempty"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	EntryType   string `json:"entry_type"`
	ContentID   string `json:"content_id,omitempty"`
	LogicalSize *int64 `json:"logical_size,omitempty"`
	// ModifiedAt is the modification time the scanner recorded at capture
	// (RFC 3339, UTC). It is absent for a row whose captured metadata carries
	// no usable time.
	ModifiedAt  string              `json:"modified_at,omitempty"`
	IndexStatus *ContentIndexStatus `json:"index_status,omitempty"`
}

// ContentIndexStatus is a read-only view of disposable discovery projections.
// It is deliberately not durable state: callers must tolerate missing or
// unavailable generations while exact content remains readable.
type ContentIndexStatus struct {
	Lexical  string `json:"lexical,omitempty"`
	Semantic string `json:"semantic,omitempty"`
	Tags     string `json:"tags,omitempty"`
}

// NamespaceEntryData is the client-visible projection of one namespace entry.
// Raw byte names are never placed here; they appear only in readlink targets.
type NamespaceEntryData struct {
	ID                   string              `json:"entry_id"`
	SubjectRef           string              `json:"subject_ref"`
	RootID               string              `json:"root_id"`
	ParentID             string              `json:"parent_id,omitempty"`
	DisplayName          string              `json:"display_name"`
	EntryType            string              `json:"entry_type"`
	ContentID            string              `json:"content_id,omitempty"`
	FileVersionID        string              `json:"file_version_id,omitempty"`
	HardlinkGroupID      string              `json:"hardlink_group_id,omitempty"`
	LogicalSize          *int64              `json:"logical_size,omitempty"`
	AllocatedSize        *int64              `json:"allocated_size,omitempty"`
	SymlinkTargetDisplay string              `json:"symlink_target_display,omitempty"`
	IndexStatus          *ContentIndexStatus `json:"index_status,omitempty"`
}

// NamespaceStatData is the namespace.stat payload.
type NamespaceStatData struct {
	Entry NamespaceEntryData `json:"entry"`
}

// NamespaceResolveData is the namespace.resolve payload. PathRef is the
// catalog entry id. Resolve does not follow symbolic links.
type NamespaceResolveData struct {
	WorkspaceID string             `json:"workspace_id"`
	RootID      string             `json:"root_id"`
	Path        string             `json:"path"`
	PathRef     string             `json:"path_ref"`
	Entry       NamespaceEntryData `json:"entry"`
}

// NamespaceReadlinkData is the namespace.readlink payload. TargetRaw carries
// the captured raw symlink target bytes (JSON base64); callers must not
// interpret it as a filesystem path.
type NamespaceReadlinkData struct {
	EntryID       string `json:"entry_id"`
	TargetDisplay string `json:"target_display"`
	TargetRaw     []byte `json:"target_raw,omitempty"`
}

const AnnotationBundleSchema = "org.cairn.annotations.v1"

type AnnotationData struct {
	ID                  string `json:"annotation_id"`
	WorkspaceID         string `json:"workspace_id"`
	SubjectRef          string `json:"subject_ref"`
	Kind                string `json:"kind"`
	Body                string `json:"body"`
	BodyDigest          string `json:"body_digest,omitempty"`
	Revision            int64  `json:"revision"`
	PredecessorRevision int64  `json:"predecessor_revision"`
	Tombstoned          bool   `json:"tombstoned"`
	CreatedAt           string `json:"created_at,omitempty"`
	UpdatedAt           string `json:"updated_at,omitempty"`
}

type AnnotationListData struct {
	Annotations []AnnotationData `json:"annotations"`
}

type AnnotationUpsertData struct {
	Annotation AnnotationData `json:"annotation"`
}

type AnnotationExportData struct {
	Schema      string           `json:"schema"`
	Annotations []AnnotationData `json:"annotations"`
	Conflict    string           `json:"conflict,omitempty"`
}

// AnnotationTagPlanSchema names the canonical, non-mutating rename/merge plan.
// The plan is derived from the live TAG records of one workspace and is bound
// by AnnotationTagPlanData.PlanDigest: the SHA-256 of the canonical JSON of
// {schema, kind, workspace_id, from, to, subjects} with subjects sorted by
// subject_ref and each subject's changes in the fixed add-then-tombstone
// order. Planning writes nothing, including no plan row.
const AnnotationTagPlanSchema = "org.cairn.annotation-tag-plan.v1"

// AnnotationTagApplySchema names the digest-bound apply result. It reports one
// outcome per planned subject; a partial apply is a first-class outcome and is
// never collapsed into success.
const AnnotationTagApplySchema = "org.cairn.annotation-tag-apply.v1"

// AnnotationTagPlanAction* are the only two changes a tag rename/merge plan
// carries. A subject that already carries the target name keeps its ADD_TAG
// change as an explicit no-op instead of an omitted step.
const (
	AnnotationTagPlanActionAddTag    = "ADD_TAG"
	AnnotationTagPlanActionTombstone = "TOMBSTONE_TAG"
)

// AnnotationTagOutcome* are the per-subject apply outcomes. CHANGED means the
// subject now carries the target name and no longer carries the source name.
// UNCHANGED means nothing was written for that subject.
// TARGET_ADDED_SOURCE_REMAINS is the documented interruption state: the target
// name is recorded and the source record is still recorded, because the add is
// committed before the tombstone is attempted.
const (
	AnnotationTagOutcomeChanged                  = "CHANGED"
	AnnotationTagOutcomeUnchanged                = "UNCHANGED"
	AnnotationTagOutcomeTargetAddedSourceRemains = "TARGET_ADDED_SOURCE_REMAINS"
)

// AnnotationTagPlanChangeData is one exact change the apply must issue for one
// subject. Noop marks a change the current state already satisfies: it is
// still listed so the plan states every intended effect. AnnotationID and
// ExpectedRevision name the live record the change concerns (the record to
// tombstone, or the already-live target record for a no-op add).
type AnnotationTagPlanChangeData struct {
	Action           string `json:"action"`
	Body             string `json:"body"`
	Noop             bool   `json:"noop"`
	AnnotationID     string `json:"annotation_id,omitempty"`
	ExpectedRevision int64  `json:"expected_revision,omitempty"`
}

// AnnotationTagPlanSubjectData is one affected subject and the ordered
// changes planned for it. The first change is always the ADD_TAG and the
// second the TOMBSTONE_TAG, so the plan itself states the add-before-tombstone
// ordering the apply follows.
type AnnotationTagPlanSubjectData struct {
	SubjectRef string                        `json:"subject_ref"`
	Changes    []AnnotationTagPlanChangeData `json:"changes"`
}

// AnnotationTagPlanData is the annotation.tag_plan result. Wrote is always
// false on the plan path and is reported explicitly so a client can assert it
// instead of inferring it. RemainingSubjects is the number of subjects whose
// records still carry the source name; a re-plan after a completed rename
// reports zero. NoopSubjects counts subjects whose ADD_TAG is already
// satisfied by a live target record.
type AnnotationTagPlanData struct {
	Schema            string                         `json:"schema"`
	Kind              string                         `json:"kind"`
	WorkspaceID       string                         `json:"workspace_id"`
	From              string                         `json:"from"`
	To                string                         `json:"to"`
	Subjects          []AnnotationTagPlanSubjectData `json:"subjects"`
	RemainingSubjects int                            `json:"remaining_subjects"`
	NoopSubjects      int                            `json:"noop_subjects"`
	Wrote             bool                           `json:"wrote"`
	PlanDigest        string                         `json:"plan_digest"`
}

// AnnotationTagApplySubjectData is one subject's outcome after the digest-bound
// apply ran its add-then-tombstone pair. Reason carries the daemon's own
// refusal or failure reason when the subject did not reach CHANGED.
type AnnotationTagApplySubjectData struct {
	SubjectRef         string `json:"subject_ref"`
	Outcome            string `json:"outcome"`
	TargetAnnotationID string `json:"target_annotation_id,omitempty"`
	TargetCreated      bool   `json:"target_created"`
	SourceAnnotationID string `json:"source_annotation_id,omitempty"`
	SourceTombstoned   bool   `json:"source_tombstoned"`
	Reason             string `json:"reason,omitempty"`
}

// AnnotationTagApplyData is the annotation.tag_apply result. Changed counts
// CHANGED subjects; Unchanged counts subjects nothing was written for;
// SourceRemains counts subjects left carrying both names. Failed counts every
// subject whose change did not complete and Partial is Failed > 0: the data
// always carries the per-subject outcomes, so a partial apply cannot be read as
// a clean one. Applied is true only when every planned subject reached CHANGED.
type AnnotationTagApplyData struct {
	Schema        string                          `json:"schema"`
	WorkspaceID   string                          `json:"workspace_id"`
	From          string                          `json:"from"`
	To            string                          `json:"to"`
	PlanDigest    string                          `json:"plan_digest"`
	Subjects      []AnnotationTagApplySubjectData `json:"subjects"`
	Changed       int                             `json:"changed"`
	Unchanged     int                             `json:"unchanged"`
	SourceRemains int                             `json:"source_remains"`
	Failed        int                             `json:"failed"`
	Partial       bool                            `json:"partial"`
	Applied       bool                            `json:"applied"`
	Warnings      []string                        `json:"warnings,omitempty"`
}

// DescriptionDocumentData is the durable source/provenance projection for a
// description revision. Segments are retained here as source material; any
// embeddings or other retrieval generations remain rebuildable derivatives.
type DescriptionDocumentData struct {
	ID                    string                `json:"description_document_id"`
	WorkspaceID           string                `json:"workspace_id"`
	SubjectRef            string                `json:"subject_ref"`
	Kind                  string                `json:"kind"`
	Title                 string                `json:"title,omitempty"`
	Language              string                `json:"language"`
	Body                  string                `json:"body"`
	BodyDigest            string                `json:"body_digest"`
	SourceRef             string                `json:"source_ref,omitempty"`
	ProducerProfile       string                `json:"producer_profile,omitempty"`
	ConfigDigest          string                `json:"config_digest,omitempty"`
	ProducerProfileDigest string                `json:"producer_profile_digest,omitempty"`
	Confidence            *float64              `json:"confidence,omitempty"`
	Coverage              *float64              `json:"coverage,omitempty"`
	Visibility            string                `json:"visibility"`
	Accepted              bool                  `json:"accepted"`
	Revision              int64                 `json:"revision"`
	PredecessorID         string                `json:"predecessor_id,omitempty"`
	Metadata              json.RawMessage       `json:"metadata,omitempty"`
	CreatedAt             string                `json:"created_at,omitempty"`
	UpdatedAt             string                `json:"updated_at,omitempty"`
	Segments              []SemanticSegmentData `json:"segments"`
}

// SemanticSegmentData is an ordered, provenance-bearing source span of a
// description document. SourceSpan uses byte offsets into Body.
type SemanticSegmentData struct {
	ID                        string          `json:"semantic_segment_id"`
	WorkspaceID               string          `json:"workspace_id"`
	DocumentID                string          `json:"description_document_id"`
	SubjectRef                string          `json:"subject_ref"`
	Ordinal                   int64           `json:"ordinal"`
	Text                      string          `json:"text"`
	TextDigest                string          `json:"text_digest"`
	Language                  string          `json:"language"`
	Section                   string          `json:"section,omitempty"`
	SourceSpan                json.RawMessage `json:"source_span"`
	Metadata                  json.RawMessage `json:"metadata,omitempty"`
	DocumentRevision          int64           `json:"document_revision"`
	SegmentationProfileDigest string          `json:"segmentation_profile_digest,omitempty"`
	CreatedAt                 string          `json:"created_at,omitempty"`
}

type DescriptionListData struct {
	Documents     []DescriptionSummaryData `json:"documents"`
	Truncated     bool                     `json:"truncated,omitempty"`
	WorkspaceID   string                   `json:"workspace_id,omitempty"`
	SubjectRef    string                   `json:"subject_ref,omitempty"`
	CurrentOnly   *bool                    `json:"current_only,omitempty"`
	ProjectionRef string                   `json:"projection_ref,omitempty"`
	Page          *PageData                `json:"page,omitempty"`
}

// DescriptionSummaryData is the bounded description.list projection. Full
// body text and segments are available from description.get.
type DescriptionSummaryData struct {
	ID                    string   `json:"description_document_id"`
	WorkspaceID           string   `json:"workspace_id"`
	SubjectRef            string   `json:"subject_ref"`
	Kind                  string   `json:"kind"`
	Title                 string   `json:"title,omitempty"`
	Language              string   `json:"language"`
	BodyDigest            string   `json:"body_digest"`
	SourceRef             string   `json:"source_ref,omitempty"`
	ProducerProfile       string   `json:"producer_profile,omitempty"`
	ConfigDigest          string   `json:"config_digest,omitempty"`
	ProducerProfileDigest string   `json:"producer_profile_digest,omitempty"`
	Confidence            *float64 `json:"confidence,omitempty"`
	Coverage              *float64 `json:"coverage,omitempty"`
	Visibility            string   `json:"visibility"`
	Accepted              bool     `json:"accepted"`
	Revision              int64    `json:"revision"`
	PredecessorID         string   `json:"predecessor_id,omitempty"`
	CreatedAt             string   `json:"created_at,omitempty"`
	UpdatedAt             string   `json:"updated_at,omitempty"`
}

type DescriptionGetData struct {
	Document DescriptionDocumentData `json:"document"`
}

type DescriptionCreateData struct {
	Document DescriptionDocumentData `json:"document"`
}

// DescriptionGenerateInput is the description.generate input. It names one
// subject and the requested durable kind (AI_SUMMARY or AI_ANALYSIS only);
// the daemon selects the configured DESCRIBE_SUBJECT profile, assembles the
// gated input from admitted facts only, and admits the candidate as a new
// non-accepted immutable revision. egress_confirmation carries the typed
// per-request authorization (profile, destination host, model, purpose
// DESCRIBE, and the live grant id) the egress gate requires unless the
// operator's remote-egress switch skips confirmations.
type DescriptionGenerateInput struct {
	WorkspaceID        string                              `json:"workspace_id"`
	SubjectRef         string                              `json:"subject_ref"`
	Kind               string                              `json:"kind"`
	Language           string                              `json:"language,omitempty"`
	Title              string                              `json:"title,omitempty"`
	EgressConfirmation *DescriptionEgressConfirmationInput `json:"egress_confirmation,omitempty"`
}

// DescriptionEgressConfirmationInput is the typed per-request egress
// confirmation the caller resolved from the live grant list. The daemon fills
// the content digest: only the daemon assembles the exact inputs.
type DescriptionEgressConfirmationInput struct {
	ProfileID     string `json:"profile_id,omitempty"`
	ProfileDigest string `json:"profile_digest,omitempty"`
	EndpointHost  string `json:"endpoint_host,omitempty"`
	ModelID       string `json:"model,omitempty"`
	Purpose       string `json:"purpose"`
	GrantID       string `json:"grant_id"`
}

type DescriptionGenerateData struct {
	Document DescriptionDocumentData `json:"document"`
}

type SearchHitData struct {
	SubjectRef    string              `json:"subject_ref"`
	EntryID       string              `json:"entry_id,omitempty"`
	Path          string              `json:"path"`
	Name          string              `json:"name"`
	EntryType     string              `json:"entry_type"`
	ContentID     string              `json:"content_id,omitempty"`
	LogicalSize   *int64              `json:"logical_size,omitempty"`
	ConstructAxes []string            `json:"construct_axes,omitempty"`
	Dimensions    []string            `json:"dimensions,omitempty"`
	Segments      []SearchSegmentData `json:"segments,omitempty"`
	IndexStatus   *ContentIndexStatus `json:"index_status,omitempty"`
}

// SearchSegmentData preserves the complete source segment and provenance that
// produced a search hit. MatchedExcerpt and MatchSpans are query-derived and
// remain absent when derived text cannot map to exact source bytes.
type SearchSegmentData struct {
	DescriptionDocumentID string                          `json:"description_document_id,omitempty"`
	SourceType            string                          `json:"source_type,omitempty"`
	SourceID              string                          `json:"source_id,omitempty"`
	SegmentID             string                          `json:"semantic_segment_id"`
	Ordinal               int64                           `json:"ordinal"`
	MatchedText           string                          `json:"matched_text"`
	Kind                  string                          `json:"kind"`
	Producer              string                          `json:"producer"`
	Accepted              bool                            `json:"accepted"`
	Language              string                          `json:"language"`
	MatchedExcerpt        string                          `json:"matched_excerpt,omitempty"`
	MatchSpans            []SearchMatchSpanData           `json:"match_spans,omitempty"`
	TextSourceProvenance  *SearchTextSourceProvenanceData `json:"text_source_provenance,omitempty"`
}

// SearchTextSourceProvenanceData identifies the immutable retained text span
// behind a search segment. It is optional on legacy and non-text-source hits.
type SearchTextSourceProvenanceData struct {
	SourceRevision            string `json:"source_revision"`
	BodyDigest                string `json:"body_digest"`
	SegmentationProfileDigest string `json:"segmentation_profile_digest"`
	SourceStartByte           int    `json:"source_start_byte"`
	SourceEndByte             int    `json:"source_end_byte"`
	TextDigest                string `json:"text_digest"`
}

// SearchMatchSpanData contains query-derived byte offsets within matched_text.
// Derived-token matches omit spans when they cannot be mapped exactly.
type SearchMatchSpanData struct {
	StartByte int `json:"start_byte"`
	EndByte   int `json:"end_byte"`
}

type SearchComponentData struct {
	Dimension      string `json:"dimension"`
	Provider       string `json:"query_provider_ref,omitempty"`
	GenerationID   string `json:"index_generation_ref,omitempty"`
	ScoreSemantics string `json:"score_semantics,omitempty"`
	Status         string `json:"status"`
	// Reason is the stable machine-readable reason when Status is not
	// SUCCEEDED. A component that contributes no hits is never reported as a
	// successful empty result.
	Reason string `json:"reason,omitempty"`
	Hits   int    `json:"hits"`
}

type SearchQueryData struct {
	GenerationID    string                `json:"index_generation_ref,omitempty"`
	Dimension       string                `json:"dimension,omitempty"`
	Provider        string                `json:"query_provider_ref,omitempty"`
	ScoreSemantics  string                `json:"score_semantics,omitempty"`
	ConstructAxes   []string              `json:"construct_axes,omitempty"`
	FusedDimensions []string              `json:"fused_dimensions,omitempty"`
	Components      []SearchComponentData `json:"components,omitempty"`
	Hits            []SearchHitData       `json:"hits"`
	// Page states plainly how this answer was bounded, whether it is complete,
	// and how (or whether) it can be continued. It is present on every answer,
	// including one that carries no continuation, so a caller can never mistake
	// a partial answer for the whole answer.
	Page *PageData `json:"page,omitempty"`
}

// SearchRebuildData reports the result of rebuilding disposable search
// projections for the newest published snapshot. Exact content, namespace,
// and recovery records are not changed by this operation.
type SearchRebuildData struct {
	WorkspaceID           string             `json:"workspace_id"`
	SnapshotRef           string             `json:"snapshot_ref"`
	NamespaceRootID       string             `json:"namespace_root_id"`
	LexicalGenerationRef  string             `json:"lexical_generation_ref"`
	LexicalState          string             `json:"lexical_state"`
	LexicalCoverage       SearchCoverageData `json:"lexical_coverage"`
	SemanticGenerationRef string             `json:"semantic_generation_ref,omitempty"`
	SemanticState         string             `json:"semantic_state"`
	SemanticFailure       string             `json:"semantic_failure,omitempty"`
	// SemanticSourceCoverage is optional generation-local source lineage.
	// Its absence means unknown; pair-only SemanticCoverage is not source proof.
	SemanticSourceCoverage *SearchSemanticSourceCoverageData `json:"semantic_source_coverage,omitempty"`
	// ImageState reports the separate image embedding dimension. It is
	// NOT_BUILT when no model artifact or binding is installed, UNAVAILABLE
	// when an installed artifact cannot run, and READY only after a verified
	// image generation exists. Image vectors are never mixed with text-space
	// vectors.
	ImageState string `json:"image_state"`
	// ImageReason is the stable reason code when ImageState is not READY.
	ImageReason string `json:"image_reason,omitempty"`
	// ImageSpaceFingerprint is the canonical digest of the image space the
	// generation was built in. Vectors from another space are refused.
	ImageSpaceFingerprint string         `json:"image_space_fingerprint,omitempty"`
	ImageGenerationRef    string         `json:"image_generation_ref,omitempty"`
	ImageIndexed          int            `json:"image_indexed,omitempty"`
	ImageSkipped          int            `json:"image_skipped,omitempty"`
	ImageSkipReasons      map[string]int `json:"image_skip_reasons,omitempty"`
}

type SearchSemanticSourceCoverageDisposition string

const (
	SearchSemanticSourceIndexed     SearchSemanticSourceCoverageDisposition = "INDEXED"
	SearchSemanticSourceExcluded    SearchSemanticSourceCoverageDisposition = "EXCLUDED"
	SearchSemanticSourceMissing     SearchSemanticSourceCoverageDisposition = "MISSING"
	SearchSemanticSourceUnavailable SearchSemanticSourceCoverageDisposition = "UNAVAILABLE"
)

type SearchSemanticSourceCoverageRowData struct {
	SubjectID      string                                  `json:"subject_id"`
	SourceKind     string                                  `json:"source_kind"`
	SourceSubtype  string                                  `json:"source_subtype,omitempty"`
	SourceRef      string                                  `json:"source_ref"`
	Revision       string                                  `json:"revision"`
	BodyDigest     string                                  `json:"body_digest"`
	Disposition    SearchSemanticSourceCoverageDisposition `json:"disposition"`
	Reason         string                                  `json:"reason,omitempty"`
	SegmentCount   int                                     `json:"segment_count"`
	SegmentIndexed int                                     `json:"segment_indexed"`
	SegmentMissing int                                     `json:"segment_missing"`
	InputFull      int                                     `json:"input_full"`
	InputTruncated int                                     `json:"input_truncated"`
	InputUnknown   int                                     `json:"input_unknown"`
}

// SearchSemanticSourceCoverageData is separate from pair-based semantic
// vector coverage: it records whether selected source revisions have complete
// generation-bound inputs and tokenizer evidence.
type SearchSemanticSourceCoverageData struct {
	Scope           string                                `json:"scope"`
	GenerationID    string                                `json:"generation_id,omitempty"`
	SnapshotRef     string                                `json:"snapshot_ref,omitempty"`
	NamespaceRootID string                                `json:"namespace_root_id,omitempty"`
	ConfigDigest    string                                `json:"config_digest,omitempty"`
	ProfileDigest   string                                `json:"profile_digest,omitempty"`
	Available       bool                                  `json:"available"`
	Complete        bool                                  `json:"complete"`
	Expected        int                                   `json:"expected"`
	Indexed         int                                   `json:"indexed"`
	Excluded        int                                   `json:"excluded"`
	Missing         int                                   `json:"missing"`
	Unavailable     int                                   `json:"unavailable"`
	InputFull       int                                   `json:"input_full"`
	InputTruncated  int                                   `json:"input_truncated"`
	InputUnknown    int                                   `json:"input_unknown"`
	Truncated       bool                                  `json:"truncated"`
	Rows            []SearchSemanticSourceCoverageRowData `json:"rows,omitempty"`
	Reason          string                                `json:"reason,omitempty"`
	Notes           string                                `json:"notes,omitempty"`
}

// SemanticBundleInstallInput selects the explicit installation source for the
// fixed local BGE bundle. An empty object keeps the existing online installer;
// archive_path selects a locally retained offline package.
type SemanticBundleInstallInput struct {
	ArchivePath string `json:"archive_path,omitempty"`
}

// ImageBundleInstallInput installs one image bundle from a local archive. The
// archive is transport: the descriptor inside it is what the daemon verifies.
type ImageBundleInstallInput struct {
	ArchivePath string `json:"archive_path"`
}

// ImageBundleInstallData reports one admitted image bundle installation. It is
// a model-bundle fact, not a readiness claim: no provider or generation is
// activated by installing.
type ImageBundleInstallData struct {
	ProfileID       string `json:"profile_id"`
	ProfileDigest   string `json:"profile_digest,omitempty"`
	Destination     string `json:"destination,omitempty"`
	AssetCount      int    `json:"asset_count"`
	Changed         bool   `json:"changed"`
	RestartRequired bool   `json:"restart_required"`
}

// SemanticBundleInstallData reports admission of the fixed local BGE bundle.
// Installing a model bundle never hot-loads an embedding worker or rebuilds a
// semantic generation; callers must restart the daemon before those services
// can use the newly admitted files.
type SemanticBundleInstallData struct {
	ProfileID       string `json:"profile_id"`
	ProfileDigest   string `json:"profile_digest"`
	Destination     string `json:"destination"`
	Changed         bool   `json:"changed"`
	RestartRequired bool   `json:"restart_required"`
}

// SemanticProviderInstallInput installs one online provider profile from an
// absolute local path on the host. The daemon reads the file itself: the
// browser never uploads content and a URL is never an install source.
type SemanticProviderInstallInput struct {
	Path          string `json:"path"`
	ProfileDigest string `json:"profile_digest"`
}

// SemanticProviderInstallData reports one admitted online provider profile. It
// is a profile fact, not a readiness claim: no provider, endpoint, grant, or
// generation is activated by installing, and the daemon must restart before
// the profile can be selected.
type SemanticProviderInstallData struct {
	ProfileID             string   `json:"profile_id"`
	Provider              string   `json:"provider"`
	APIStyle              string   `json:"api_style"`
	EndpointHost          string   `json:"endpoint_host"`
	ModelID               string   `json:"model_id"`
	ModelRevision         string   `json:"model_revision"`
	Dimension             int      `json:"dimension"`
	SpaceDigest           string   `json:"space_digest"`
	ProfileDigest         string   `json:"profile_digest"`
	Destination           string   `json:"destination"`
	Expiry                string   `json:"expiry"`
	DisclosedDataClasses  []string `json:"disclosed_data_classes"`
	AllowedSubjectClasses []string `json:"allowed_subject_classes"`
	Changed               bool     `json:"changed"`
	AlreadyInstalled      bool     `json:"already_installed"`
	RestartRequired       bool     `json:"restart_required"`
}

// SemanticProviderListInput lists profiles installed under the daemon's own
// configured models root. Describe profiles are an explicit opt-in so callers
// that rely on the legacy embedding-only projection keep its original shape.
type SemanticProviderListInput struct {
	IncludeDescribe bool `json:"include_describe,omitempty"`
	IncludeOrganize bool `json:"include_organize,omitempty"`
}

// UnmarshalJSON rejects null explicitly: encoding/json otherwise treats null
// as the zero value for a bool, which would silently turn a malformed opt-in
// request into a legacy embedding-only request.
func (input *SemanticProviderListInput) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for name, value := range fields {
		if !strings.EqualFold(name, "include_describe") && !strings.EqualFold(name, "include_organize") {
			return errors.New("unknown field " + name)
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return errors.New(name + " must be a boolean, not null")
		}
	}
	type plain SemanticProviderListInput
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*input = SemanticProviderListInput(decoded)
	return nil
}

// DescribeProviderProfileData is a validated installed DESCRIBE_SUBJECT
// profile projection. It deliberately omits credential references and profile
// instructions; the user-facing client needs only the immutable identity and
// declared grant ceiling.
type DescribeProviderProfileData struct {
	ProfileID             string   `json:"profile_id"`
	ProfileDigest         string   `json:"profile_digest"`
	Provider              string   `json:"provider"`
	APIStyle              string   `json:"api_style"`
	EndpointHost          string   `json:"endpoint_host"`
	ModelID               string   `json:"model_id"`
	ModelRevision         string   `json:"model_revision"`
	OutputSchema          string   `json:"output_schema"`
	Destination           string   `json:"destination"`
	Expiry                string   `json:"expiry"`
	DisclosedDataClasses  []string `json:"disclosed_data_classes"`
	AllowedSubjectClasses []string `json:"allowed_subject_classes"`
	MaxRequests           int64    `json:"max_requests"`
	MaxBytes              int64    `json:"max_bytes"`
	MaxSeconds            int64    `json:"max_seconds"`
	AuditRequired         bool     `json:"audit_required"`
	Expired               bool     `json:"expired"`
}

// DescribeProviderListData is returned only when semantic.provider.list is
// explicitly asked to include the read-only describe-profile projection.
type DescribeProviderListData struct {
	State    string                        `json:"state"`
	Reason   string                        `json:"reason,omitempty"`
	Profiles []DescribeProviderProfileData `json:"profiles"`
}

// SemanticProviderProfileData is one installed online provider profile as the
// daemon reads it from disk. It never contains credential material.
type SemanticProviderProfileData struct {
	ProfileID             string   `json:"profile_id"`
	Provider              string   `json:"provider"`
	APIStyle              string   `json:"api_style"`
	EndpointHost          string   `json:"endpoint_host"`
	ModelID               string   `json:"model_id"`
	ModelRevision         string   `json:"model_revision"`
	Dimension             int      `json:"dimension"`
	SpaceDigest           string   `json:"space_digest"`
	ProfileDigest         string   `json:"profile_digest"`
	Destination           string   `json:"destination"`
	Expiry                string   `json:"expiry"`
	DisclosedDataClasses  []string `json:"disclosed_data_classes"`
	AllowedSubjectClasses []string `json:"allowed_subject_classes"`
	MaxRequests           int64    `json:"max_requests"`
	MaxBytes              int64    `json:"max_bytes"`
	MaxSeconds            int64    `json:"max_seconds"`
	AuditRequired         bool     `json:"audit_required"`
	Expired               bool     `json:"expired"`
}

type SemanticProviderListData struct {
	ModelsRoot string                            `json:"models_root"`
	Profiles   []SemanticProviderProfileData     `json:"profiles"`
	Describe   *DescribeProviderListData         `json:"describe,omitempty"`
	Organize   *MaterialOrganizeProviderListData `json:"organize,omitempty"`
}

// MaterialOrganizeProviderListData is the opt-in safe projection for installed
// material organizer profiles. It contains no credential reference or task
// instruction.
type MaterialOrganizeProviderListData struct {
	// READY means the configured installed profile is valid and host-bound. It
	// does not probe credentials or live grants; those are checked at organize.
	State           string                                `json:"state"`
	Reason          string                                `json:"reason,omitempty"`
	ActiveProfileID string                                `json:"active_profile_id,omitempty"`
	Profiles        []MaterialOrganizeProviderProfileData `json:"profiles"`
}

type MaterialOrganizeProviderProfileData struct {
	ProfileID             string   `json:"profile_id"`
	ProfileDigest         string   `json:"profile_digest"`
	Provider              string   `json:"provider"`
	EndpointHost          string   `json:"endpoint_host"`
	ModelID               string   `json:"model_id"`
	ModelRevision         string   `json:"model_revision"`
	OutputSchema          string   `json:"output_schema"`
	Destination           string   `json:"destination"`
	Expiry                string   `json:"expiry"`
	DisclosedDataClasses  []string `json:"disclosed_data_classes"`
	AllowedSubjectClasses []string `json:"allowed_subject_classes"`
	MaxRequests           int64    `json:"max_requests"`
	MaxBytes              int64    `json:"max_bytes"`
	MaxSeconds            int64    `json:"max_seconds"`
	MaxOutputBytes        int64    `json:"max_output_bytes"`
	TimeoutMS             int      `json:"timeout_ms"`
	Expired               bool     `json:"expired"`
}

type MaterialOrganizeConfirmation struct {
	ProfileID     string `json:"profile_id"`
	ProfileDigest string `json:"profile_digest"`
	EndpointHost  string `json:"endpoint_host"`
	Model         string `json:"model"`
	Purpose       string `json:"purpose"`
	GrantID       string `json:"grant_id"`
}

type MaterialOrganizeInput struct {
	WorkspaceID        string                       `json:"workspace_id"`
	DocumentJSON       string                       `json:"document_json"`
	BaseDigest         string                       `json:"base_digest"`
	EgressConfirmation MaterialOrganizeConfirmation `json:"egress_confirmation"`
}

type MaterialOrganizeData struct {
	CandidateJSON string `json:"candidate_json"`
	BaseDigest    string `json:"base_digest"`
	ProfileID     string `json:"profile_id"`
	ProfileDigest string `json:"profile_digest"`
}

// EgressGrantCreateInput creates one immutable egress grant. The profile,
// endpoint host, and model must match an installed online provider profile,
// the expiry must be in the future, and every class must be part of its
// closed vocabulary.
type EgressGrantCreateInput struct {
	WorkspaceID    string   `json:"workspace_id,omitempty"`
	ProfileID      string   `json:"profile_id"`
	ProfileDigest  string   `json:"profile_digest"`
	EndpointHost   string   `json:"endpoint_host"`
	ModelID        string   `json:"model_id"`
	Purpose        string   `json:"purpose"`
	DataClasses    []string `json:"data_classes"`
	SubjectClasses []string `json:"subject_classes"`
	MaxRequests    int64    `json:"max_requests"`
	MaxBytes       int64    `json:"max_bytes"`
	MaxSeconds     int64    `json:"max_seconds"`
	ExpiresAt      string   `json:"expires_at"`
	GrantedBy      string   `json:"granted_by,omitempty"`
}

type EgressGrantListInput struct {
	WorkspaceID string `json:"workspace_id,omitempty"`
}

type EgressGrantRevokeInput struct {
	WorkspaceID string `json:"workspace_id,omitempty"`
	GrantID     string `json:"grant_id"`
	Reason      string `json:"reason"`
	RevokedBy   string `json:"revoked_by,omitempty"`
}

// EgressGrantData is one durable grant exactly as recorded, together with its
// derived liveness and revocation evidence.
type EgressGrantData struct {
	GrantID        string   `json:"grant_id"`
	WorkspaceID    string   `json:"workspace_id"`
	ProfileID      string   `json:"profile_id"`
	ProfileDigest  string   `json:"profile_digest"`
	EndpointHost   string   `json:"endpoint_host"`
	ModelID        string   `json:"model_id"`
	Purpose        string   `json:"purpose"`
	DataClasses    []string `json:"data_classes"`
	SubjectClasses []string `json:"subject_classes"`
	MaxRequests    int64    `json:"max_requests"`
	MaxBytes       int64    `json:"max_bytes"`
	MaxSeconds     int64    `json:"max_seconds"`
	ExpiresAt      string   `json:"expires_at"`
	GrantedBy      string   `json:"granted_by"`
	CreatedAt      string   `json:"created_at"`
	Live           bool     `json:"live"`
	Revoked        bool     `json:"revoked"`
	RevocationID   string   `json:"revocation_id,omitempty"`
	RevokedReason  string   `json:"revoked_reason,omitempty"`
	RevokedAt      string   `json:"revoked_at,omitempty"`
}

type EgressGrantListData struct {
	Grants []EgressGrantData `json:"grants"`
}

type EgressGrantRevokeData struct {
	GrantID      string `json:"grant_id"`
	RevocationID string `json:"revocation_id"`
	RevokedBy    string `json:"revoked_by"`
	RevokedAt    string `json:"revoked_at"`
	Reason       string `json:"reason"`
	Live         bool   `json:"live"`
}

// SearchCoverageData is the public projection of measured lexical field
// coverage. It describes the generation that was actually built; it is not a
// claim based on the index schema alone.
type SearchCoverageData struct {
	Dimension string          `json:"dimension"`
	Available bool            `json:"available"`
	Complete  bool            `json:"complete"`
	Fields    map[string]bool `json:"fields"`
	Missing   []string        `json:"missing"`
	Notes     string          `json:"notes,omitempty"`
	// SourceCoverage is additive generation-local provenance for selected
	// lexical text sources. A daemon that cannot read a generation's source
	// proof returns an explicit unavailable statement; older daemon responses
	// may omit this field and do not imply complete source coverage.
	SourceCoverage *SearchSourceCoverageData `json:"source_coverage,omitempty"`
}

type SearchSourceCoverageDisposition string

const (
	SearchSourceCoverageIndexed     SearchSourceCoverageDisposition = "INDEXED"
	SearchSourceCoverageExcluded    SearchSourceCoverageDisposition = "EXCLUDED"
	SearchSourceCoverageMissing     SearchSourceCoverageDisposition = "MISSING"
	SearchSourceCoverageUnavailable SearchSourceCoverageDisposition = "UNAVAILABLE"
)

type SearchSourceCoverageRowData struct {
	SourceKind    string                          `json:"source_kind"`
	SourceSubtype string                          `json:"source_subtype,omitempty"`
	Field         string                          `json:"field"`
	SourceRef     string                          `json:"source_ref"`
	Revision      string                          `json:"revision"`
	SourceDigest  string                          `json:"source_digest"`
	Disposition   SearchSourceCoverageDisposition `json:"disposition"`
	Reason        string                          `json:"reason,omitempty"`
}

// SearchSourceCoverageData describes selected durable text-source coverage
// for exactly one lexical generation. It does not claim semantic coverage.
type SearchSourceCoverageData struct {
	Scope           string                        `json:"scope"`
	GenerationID    string                        `json:"generation_id,omitempty"`
	SnapshotRef     string                        `json:"snapshot_ref,omitempty"`
	NamespaceRootID string                        `json:"namespace_root_id,omitempty"`
	ConfigDigest    string                        `json:"config_digest,omitempty"`
	ProfileDigest   string                        `json:"profile_digest,omitempty"`
	Available       bool                          `json:"available"`
	Complete        bool                          `json:"complete"`
	Expected        int                           `json:"expected"`
	Indexed         int                           `json:"indexed"`
	Excluded        int                           `json:"excluded"`
	Missing         int                           `json:"missing"`
	Unavailable     int                           `json:"unavailable"`
	Truncated       bool                          `json:"truncated"`
	Rows            []SearchSourceCoverageRowData `json:"rows,omitempty"`
	Reason          string                        `json:"reason,omitempty"`
	Notes           string                        `json:"notes,omitempty"`
}

const (
	RepresentationClassExact       = "EXACT"
	RepresentationClassRecorded    = "RECORDED"
	RepresentationFidelityExact    = "exact"
	RepresentationFidelityRecorded = "recorded"
	RepresentationPlacementPresent = "present"
	RepresentationPlacementMissing = "missing"
	RepresentationPlacementUnknown = "unknown"
)

type RepresentationListData struct {
	WorkspaceID     string               `json:"workspace_id"`
	SubjectRef      string               `json:"subject_ref,omitempty"`
	FileVersionID   string               `json:"file_version_id,omitempty"`
	ContentID       string               `json:"content_id,omitempty"`
	Representations []RepresentationData `json:"representations"`
}

type RepresentationData struct {
	ID              string `json:"representation_id"`
	ContentID       string `json:"content_id"`
	Class           string `json:"class"`
	Fidelity        string `json:"fidelity"`
	CodecProfileRef string `json:"codec_profile_ref"`
	AccessMode      string `json:"access_mode"`
	OwnershipMode   string `json:"ownership_mode"`
	DecodedLength   int64  `json:"decoded_length"`
	Authoritative   bool   `json:"authoritative"`
	Placement       string `json:"placement"`
	Verified        *bool  `json:"verified,omitempty"`
	RecordDigest    string `json:"record_digest,omitempty"`
}

type ContentOpenData struct {
	Handle      string `json:"handle"`
	EntryID     string `json:"entry_id"`
	SubjectRef  string `json:"subject_ref"`
	ContentID   string `json:"content_id"`
	LogicalSize int64  `json:"logical_size"`
	MaxRead     int64  `json:"max_read"`
}

type ContentReadData struct {
	Handle string `json:"handle"`
	Offset int64  `json:"offset"`
	Length int64  `json:"length"`
	Bytes  []byte `json:"bytes"`
	EOF    bool   `json:"eof"`
}

type ContentCloseData struct {
	Handle string `json:"handle"`
	Closed bool   `json:"closed"`
}

type AudioListData struct {
	WorkspaceID string       `json:"workspace_id"`
	SnapshotRef string       `json:"snapshot_ref,omitempty"`
	Albums      []AudioAlbum `json:"albums"`
	Tracks      []AudioTrack `json:"tracks"`
}

type AudioAlbum struct {
	Artist      string   `json:"artist,omitempty"`
	Title       string   `json:"title,omitempty"`
	Year        string   `json:"year,omitempty"`
	DurationMS  int64    `json:"duration_ms,omitempty"`
	SubjectRefs []string `json:"subject_refs"`
}

type AudioTrack struct {
	SubjectRef string `json:"subject_ref"`
	Name       string `json:"name,omitempty"`
	Title      string `json:"title,omitempty"`
	Artist     string `json:"artist,omitempty"`
	Album      string `json:"album,omitempty"`
	Track      int    `json:"track,omitempty"`
	Year       string `json:"year,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	ArtifactID string `json:"artifact_id"`
}

type BookListData struct {
	WorkspaceID string       `json:"workspace_id"`
	SnapshotRef string       `json:"snapshot_ref,omitempty"`
	Authors     []BookAuthor `json:"authors"`
	Works       []BookWork   `json:"works"`
}

type BookAuthor struct {
	Name        string   `json:"name,omitempty"`
	SubjectRefs []string `json:"subject_refs"`
}

type BookWork struct {
	SubjectRef string `json:"subject_ref"`
	Name       string `json:"name,omitempty"`
	Title      string `json:"title,omitempty"`
	Author     string `json:"author,omitempty"`
	Year       string `json:"year,omitempty"`
	Kind       string `json:"kind,omitempty"`
	ArtifactID string `json:"artifact_id"`
}

// SubjectFactsData is the subject.facts.list payload: the durable typed facts
// one subject carries, each with its namespace, key, typed JSON value, value
// type, authority class, producing artifact reference, and immutable revision.
// The reader reports the latest revision of every key the subject holds and
// invents nothing for a key that was never declared.
type SubjectFactsData struct {
	WorkspaceID string            `json:"workspace_id"`
	SubjectRef  string            `json:"subject_ref"`
	Facts       []SubjectFactData `json:"facts"`
}

// SubjectFactData is one durable metadata_facts row as the typed read projects
// it. ValueJSON is the stored typed value, never a rendered string.
type SubjectFactData struct {
	MetadataFactID string          `json:"metadata_fact_id"`
	SubjectRef     string          `json:"subject_ref"`
	Namespace      string          `json:"namespace"`
	Key            string          `json:"key"`
	ValueJSON      json.RawMessage `json:"value_json"`
	ValueType      string          `json:"value_type"`
	AuthorityClass string          `json:"authority_class"`
	SourceRef      string          `json:"source_ref"`
	Revision       int64           `json:"revision"`
	CreatedAt      string          `json:"created_at"`
}

// RecoveryImportInput is the recovery.import input. It names a portable
// recovery artifact produced by recovery.export plus an independently retained
// trust anchor path. The operation verifies and admits the closure into a
// clean-install reader without depending on a pre-existing SQLite catalog.
type RecoveryImportInput struct {
	ArtifactPath      string `json:"artifact_path"`
	TrustAnchorPath   string `json:"trust_anchor_path"`
	PublicationDomain string `json:"publication_domain,omitempty"`
}

// RecoveryImportData is the recovery.import result.
type RecoveryImportData struct {
	Schema                string `json:"schema"`
	SnapshotRef           string `json:"snapshot_ref"`
	ManifestDigest        string `json:"manifest_digest"`
	CommitDigest          string `json:"commit_digest"`
	PreparedClosureDigest string `json:"prepared_closure_digest"`
	Generation            uint64 `json:"generation"`
	TrustAnchorDigest     string `json:"trust_anchor_digest"`
	FactHealth            string `json:"fact_health"`
	Files                 int    `json:"files"`
	Bytes                 int64  `json:"bytes"`
	CatalogCreated        bool   `json:"catalog_created"`
}

// RecoveryTokenExportInput is the recovery.token.export input.
type RecoveryTokenExportInput struct {
	SnapshotRef     string `json:"snapshot_ref"`
	SubjectPath     string `json:"subject_path,omitempty"`
	TrustAnchorPath string `json:"trust_anchor_path,omitempty"`
}

// RecoveryTokenData is one deterministic proof envelope over an admitted
// recovery reference, its recipe/locator-set digest, expected identity,
// publication, and trust-anchor reference. It is a pointer and proof, never
// the payload.
type RecoveryTokenData struct {
	// The legacy top-level token fields remain populated with the first token
	// for compatibility. Subject-scope callers should consume Tokens.
	TokenSchema          string                   `json:"token_schema"`
	SnapshotRef          string                   `json:"snapshot_ref"`
	PublicationDomain    string                   `json:"publication_domain,omitempty"`
	SubjectRef           string                   `json:"subject_ref"`
	RecoveryReferenceID  string                   `json:"recovery_reference_id"`
	ReferenceKind        string                   `json:"reference_kind,omitempty"`
	ProtectionClaim      string                   `json:"protection_claim,omitempty"`
	ExpectedContentID    string                   `json:"expected_content_id,omitempty"`
	ExpectedLength       int64                    `json:"expected_length,omitempty"`
	RecipeDigest         string                   `json:"recipe_digest,omitempty"`
	LocatorSetDigest     string                   `json:"locator_set_digest,omitempty"`
	PublicationCommitRef string                   `json:"publication_commit_ref"`
	TrustAnchorRef       string                   `json:"trust_anchor_ref"`
	Expiry               string                   `json:"expiry,omitempty"`
	TokenDigest          string                   `json:"token_digest"`
	TokenSetSchema       string                   `json:"token_set_schema,omitempty"`
	SubjectPath          string                   `json:"subject_path,omitempty"`
	ProtectionOutcome    string                   `json:"protection_outcome,omitempty"`
	Tokens               []RecoveryTokenItemData  `json:"tokens"`
	Unprotected          *RecoveryUnprotectedData `json:"unprotected,omitempty"`
	TokenSetDigest       string                   `json:"token_set_digest,omitempty"`
}

// RecoveryTokenItemData is one token in a subject-scope recovery export.
type RecoveryTokenItemData struct {
	TokenSchema          string `json:"token_schema"`
	SnapshotRef          string `json:"snapshot_ref"`
	PublicationDomain    string `json:"publication_domain"`
	SubjectRef           string `json:"subject_ref"`
	RecoveryReferenceID  string `json:"recovery_reference_id"`
	ReferenceKind        string `json:"reference_kind"`
	ProtectionClaim      string `json:"protection_claim"`
	ExpectedContentID    string `json:"expected_content_id,omitempty"`
	ExpectedLength       int64  `json:"expected_length,omitempty"`
	RecipeDigest         string `json:"recipe_digest,omitempty"`
	LocatorSetDigest     string `json:"locator_set_digest,omitempty"`
	PublicationCommitRef string `json:"publication_commit_ref"`
	TrustAnchorRef       string `json:"trust_anchor_ref"`
	Expiry               string `json:"expiry,omitempty"`
	TokenDigest          string `json:"token_digest"`
}

// RecoveryUnprotectedData makes a metadata-only outcome explicit. It is not
// a recovery token and must never be rendered as a restore route.
type RecoveryUnprotectedData struct {
	Schema               string `json:"schema"`
	SnapshotRef          string `json:"snapshot_ref"`
	SubjectRef           string `json:"subject_ref"`
	SubjectPath          string `json:"subject_path"`
	ProtectionMode       string `json:"protection_mode"`
	ProtectionOutcome    string `json:"protection_outcome"`
	ReasonCode           string `json:"reason_code,omitempty"`
	ExpectedLogicalBytes *int64 `json:"expected_logical_bytes,omitempty"`
	RecordDigest         string `json:"record_digest"`
}

// ViewSaveInput is the view.save input.
type ViewSaveInput struct {
	Name        string   `json:"name"`
	Query       string   `json:"query"`
	Fields      []string `json:"fields,omitempty"`
	Scope       string   `json:"scope,omitempty"`
	Sort        string   `json:"sort,omitempty"`
	OutputNames string   `json:"output_names,omitempty"`
	Required    []string `json:"required_capabilities,omitempty"`
	WhenMissing string   `json:"when_missing,omitempty"`
}

// ViewData is a saved dynamic view revision.
type ViewData struct {
	ViewID      string   `json:"view_id"`
	Name        string   `json:"name"`
	Query       string   `json:"query"`
	Fields      []string `json:"fields,omitempty"`
	Scope       string   `json:"scope,omitempty"`
	Sort        string   `json:"sort,omitempty"`
	OutputNames string   `json:"output_names,omitempty"`
	Required    []string `json:"required_capabilities,omitempty"`
	WhenMissing string   `json:"when_missing,omitempty"`
	Revision    int64    `json:"revision"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

// ViewEvaluateInput is the view.evaluate input. Scope is retained for legacy
// request compatibility; the saved view's stored scope remains authoritative.
type ViewEvaluateInput struct {
	ViewID string                 `json:"view_id"`
	Name   string                 `json:"name,omitempty"`
	Scope  string                 `json:"scope,omitempty"`
	Limit  *int                   `json:"limit,omitempty"`
	Page   *ViewEvaluatePageInput `json:"page,omitempty"`
}

// ViewEvaluatePageInput requests one explicit page of the current saved-view
// projection. Limit is optional so omission can select the documented default
// while an explicit zero remains invalid.
type ViewEvaluatePageInput struct {
	Limit *int   `json:"limit,omitempty"`
	Token string `json:"token,omitempty"`
}

// ViewEvaluateData is the view.evaluate result.
type ViewEvaluateData struct {
	ViewID             string          `json:"view_id"`
	Query              string          `json:"query"`
	Hits               []SearchHitData `json:"hits"`
	Coverage           []string        `json:"coverage,omitempty"`
	ViewRevision       int64           `json:"view_revision,omitempty"`
	WorkspaceID        string          `json:"workspace_id,omitempty"`
	IndexGenerationRef string          `json:"index_generation_ref,omitempty"`
	ProjectionRef      string          `json:"projection_ref,omitempty"`
	Page               *PageData       `json:"page,omitempty"`
}

// ExportSidecarPolicyNone and ExportSidecarPolicyHandoffV1ManifestJSON are the
// frozen sidecar-policy vocabulary. The empty policy requests no sidecar and
// keeps the destination to the frozen subject files. The implemented policy
// writes the derived handoff sidecar named by ExportSidecarFileName next to
// them. Any other value is rejected as invalid_input by export.plan instead of
// being ignored. These values mirror server/internal/exact's vocabulary; a
// control-plane test asserts the two definitions stay equal.
const (
	ExportSidecarPolicyNone                  = ""
	ExportSidecarPolicyHandoffV1ManifestJSON = "handoff-v1:manifest-json"
)

// ExportSidecarFileName is the destination-relative name of the one derived
// handoff sidecar the implemented policy writes. It is derived output, never a
// frozen subject name and never content identity.
const ExportSidecarFileName = "cairn-export.json"

// ExportPlanInput is the export.plan input. It names a saved view or explicit
// subject set, output naming policy, and optional sidecar policy.
type ExportPlanInput struct {
	ViewID         string   `json:"view_id,omitempty"`
	Subjects       []string `json:"subjects,omitempty"`
	OutputName     string   `json:"output_name,omitempty"`
	Representation string   `json:"representation,omitempty"`
	Sidecars       string   `json:"sidecars,omitempty"`
	Target         string   `json:"target,omitempty"`
}

// ExportManifestData is the frozen export manifest summary.
type ExportManifestData struct {
	ManifestID     string   `json:"manifest_id"`
	ManifestDigest string   `json:"manifest_digest"`
	ViewID         string   `json:"view_id,omitempty"`
	SubjectCount   int      `json:"subject_count"`
	Representation string   `json:"representation,omitempty"`
	Target         string   `json:"target,omitempty"`
	CreatedAt      string   `json:"created_at"`
	Items          []string `json:"items,omitempty"`
}

// ExportApplyInput is the export.apply input.
type ExportApplyInput struct {
	ManifestID     string `json:"manifest_id"`
	ManifestDigest string `json:"manifest_digest"`
	Destination    string `json:"destination"`
}

// ExportVerifyInput is the export.verify input.
type ExportVerifyInput struct {
	ManifestID     string `json:"manifest_id"`
	ManifestDigest string `json:"manifest_digest"`
	Destination    string `json:"destination"`
}

// ExportApplyVerifyData is shared by export.apply and export.verify. Sidecars
// names the destination-relative derived sidecar files that were written
// (apply) or verified (verify) for the frozen sidecar policy. It is empty when
// the frozen manifest requested no sidecar; the files are derived handoff
// output and are never part of the frozen item set or its identity.
type ExportApplyVerifyData struct {
	ManifestID     string   `json:"manifest_id"`
	ManifestDigest string   `json:"manifest_digest"`
	Destination    string   `json:"destination"`
	Items          int      `json:"items"`
	Bytes          int64    `json:"bytes"`
	Verified       bool     `json:"verified"`
	Sidecars       []string `json:"sidecars,omitempty"`
}
