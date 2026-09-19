// Browser-side domain types for the RestoreWeave client projection.
//
// These are the shapes the bounded local adapter returns and the shapes the
// surfaces render. They are declarations only: no behavior, no daemon call, no
// durable meaning. Durable records stay in the daemon catalog; the browser
// projection is always rebuildable from it.

import type { Result } from "../app/command";

/** The one command entry point every surface calls. */
export type Command = (operation: string, input: unknown) => Promise<Result>;

export type SearchSegment = {
  description_document_id?: string;
  source_type?: string;
  source_id?: string;
  semantic_segment_id?: string;
  ordinal?: number;
  matched_text?: string;
  kind?: string;
  producer?: string;
  accepted?: boolean;
  language?: string;
};

export type SearchHit = { subject_ref?: string; entry_id?: string; name?: string; path?: string; entry_type?: string; content_id?: string; logical_size?: number; segments?: SearchSegment[]; index_status?: { lexical?: string; semantic?: string; tags?: string } };

export type ExportItem = { subject_ref?: string; output_name?: string; content_id?: string; logical_size?: number; exact?: boolean };
export type ExportManifestData = { manifest_id?: string; manifest_digest?: string; view_id?: string; subject_count?: number; representation?: string; target?: string; created_at?: string; items?: string[] };
export type AnnotationRecord = { annotation_id?: string; subject_ref?: string; kind?: string; body?: string; tombstoned?: boolean; revision?: number; updated_at?: string };
// The restore-point projection from `snapshot.list`. The counts, the
// protection mix, and the newest verification receipt are read-only facts the
// daemon reports per snapshot; `verification.state` is always present, and an
// UNRECORDED state carries the reason no receipt exists instead of a zeroed
// verification time.
export type SnapshotVerificationData = { state?: string; reason?: string; mode?: string; outcome?: string; attempted_files?: number; attempted_bytes?: number; passed_files?: number; passed_bytes?: number; ok?: boolean; restore_verified?: boolean; failure_reason?: string; verified_at?: string; request_id?: string };
export type SnapshotSummary = {
  snapshot_ref?: string;
  workspace_id?: string;
  namespace_root_id?: string;
  created_at?: string;
  display_path?: string;
  manifest_digest?: string;
  entries?: number;
  files?: number;
  bytes?: number;
  bytes_complete?: boolean;
  protected_files?: number;
  unprotected_files?: number;
  protection_outcomes?: Record<string, number>;
  verification?: SnapshotVerificationData;
};
export type SourceScan = { scan_ref?: string; generation?: number; state?: string; full_traversal?: boolean; started_at?: string; finished_at?: string; entries?: number; regular_files?: number; directories?: number; symlinks?: number; special_files?: number; bytes_hashed?: number; failed_entries?: number; unstable_entries?: number; detection_failures?: number };
export type SourceSummary = { source_ref?: string; kind?: string; locator?: string; state?: string; reachability?: string; reachability_checked_at?: string; reachability_message?: string; latest_scan?: SourceScan; latest_snapshot_ref?: string; latest_namespace_root_id?: string; staging?: SourceStaging };
// The daemon-owned upload inbox entry (`source.list`, kind STAGING_INBOX).
// It is a projection over the staging directory, not a configured source: no
// source_ref exists, and protection_record is always NONE until the operator
// reviews and applies an ingest plan over the staged directory.
export type SourceStaging = { path?: string; files?: number; bytes?: number; protection_record?: string; note?: string };
// One per-file row of the upload endpoint's answer. A staged row carries the
// stored identity the daemon computed while streaming; a refused row carries
// skipped_reason (UPLOAD_TOO_LARGE / UPLOAD_NAME_REJECTED / UPLOAD_BUSY /
// UPLOAD_IO_FAILED) and a plain message. The browser renders both shapes and
// never derives an identity of its own.
export type UploadFileRow = { original_name?: string; stored_name?: string; stored_path?: string; sha256?: string; length?: number; name_rewritten?: boolean; skipped_reason?: string; message?: string };
export type UploadOutcome = { staging_dir?: string; files?: UploadFileRow[]; reason?: string; message?: string; error?: string };
export type SourceProjection = { state: "READY" | "DEGRADED"; message?: string };

// The path-level change the daemon classified between two restore points
// (`snapshot.diff`). `kind` is the daemon's own token (`added`, `removed`,
// `moved`, `content_changed`, `metadata_changed`, `type_changed`); the browser
// never reclassifies a change, and `path`/`from_path`/`to_path` are the
// recorded provenance strings.
export type SnapshotDiffItem = { kind?: string; path?: string; from_path?: string; to_path?: string; entry_type?: string; from_type?: string; to_type?: string; content_id?: string; from_content_id?: string; to_content_id?: string };

// The change summary between one source's two newest restore points. The
// counts and the affected subjects are the daemon's answer to `snapshot.diff`;
// the browser renders them and never computes a comparison of its own.
//
//   - READY        the daemon compared two restore points and answered;
//   - READING      the comparison is in flight; no count is claimed yet;
//   - NO_POINTS    the source has no published restore point;
//   - SINGLE_POINT only one restore point exists: there is nothing to compare
//                  against yet (this is not "no changes");
//   - UNAVAILABLE  the daemon reported no comparison; `reason` carries the
//                  daemon's own reason and no count is rendered.
// `newestVerification` is the newest restore point's recorded verification
// receipt, so an unverified comparison never reads as a verified one.
export type SourceChangeState = "READY" | "READING" | "NO_POINTS" | "SINGLE_POINT" | "UNAVAILABLE";
export type SourceChangeSummary = {
  state: SourceChangeState;
  reason?: string;
  fromRef?: string;
  toRef?: string;
  fromAt?: string;
  toAt?: string;
  added: number;
  removed: number;
  changed: number;
  changes: SnapshotDiffItem[];
  newestVerification?: SnapshotVerificationData;
};

// Durable job rows (`job.list` / `status.get.recent_jobs`). Every field the
// daemon omits is genuinely absent from the record: a missing error_code is
// not a successful job, and a missing updated_at is not a completion time. The
// activity surface renders the absence as `UNKNOWN — not reported by this
// build` instead of inventing a value.
export type JobSummary = { job_id?: string; workspace_id?: string; plan_id?: string; kind?: string; state?: string; attempt?: number; max_attempts?: number; error_code?: string; checkpoint_present?: boolean; updated_at?: string };
export type JobEventRecord = { sequence?: number; event_id?: string; action?: string; outcome?: string; occurred_at?: string; details?: unknown };
// The daemon's answer to `plan.get`, reused by the activity surface's
// reconciliation read. Only recorded plan facts are rendered.
export type PlanRecord = { plan_id?: string; workspace_id?: string; kind?: string; state?: string; plan_digest?: string; applied?: boolean; executable?: boolean; abandoned?: boolean; created_at?: string; updated_at?: string };
export type ActionFeedback = { state: "IDLE" | "RUNNING" | "SUCCEEDED" | "DEGRADED" | "FAILED"; message?: string };
export type DetailResourceStatus = "idle" | "loading" | "ready" | "error";
export type DetailState = { subjectRef: string; annotations: DetailResourceStatus; representations: DetailResourceStatus; descriptions: DetailResourceStatus };
export type DetailCollection = { status: DetailResourceStatus; items: any[] };
export type BrowseCrumb = { subject_ref: string; entry_id: string; name: string };
export type BrowseRoot = { root_id: string; name: string; source_path?: string };
export type SettingsSection = "storage" | "search" | "descriptions" | "recovery" | "service";

// `sources` and `activity` are real workspace views like the library filters:
// the configured sources and the durable job rows are each one surface, not a
// second disclosure bar inside the library.
export type ViewMode = "content" | "tag" | "path" | "search" | "sources" | "activity" | "duplicates" | "tags";
export type ExportMode = "selected" | "view";

// A frozen manifest reaches the drawer either from export.plan (the live
// plan/preview path) or from export.list history. History manifests are
// already materialized units: the drawer may verify them, but it must never
// offer to write them again.
export type ExportManifestSource = "planned" | "history";

// The library listing is one client-side projection of the complete publication
// set that `content.list` returns. Sorting is therefore a browser-side order
// over items already loaded, never a server query; search results keep the
// relevance order the daemon returned.
export type SortField = "name" | "size" | "type" | "path";
export type SortDirection = "asc" | "desc";
export type LibraryLayout = "grid" | "list";
export type RecalledView = { view_id: string; name: string; revision: number; query: string; state: "READY" | "DEGRADED" | "EMPTY"; message?: string };
export type SavedViewData = { view_id?: string; name?: string; query?: string; fields?: string[]; scope?: string; sort?: string; output_names?: string; when_missing?: string; required_capabilities?: string[]; revision?: number; created_at?: string; updated_at?: string };
export type ExportActionState = "IDLE" | "SAVING_VIEW" | "PLANNING" | "APPLYING" | "VERIFYING" | "SUCCEEDED" | "FAILED";
export type PlanActionState = "IDLE" | "INSPECTING" | "PROTECTING" | "SUCCEEDED" | "FAILED";
export type SystemFacetState = { type: string; format: string; dedup: string; tags: string; index: string };
export type PathSuggestion = { key: string; path: string; sourceRef: string; kind: "source" | "recent" };
export type Notice = { kind: "success" | "error" | "warning"; text: string };

// The drawer's sticky action bar performs exactly one action per state. The
// add-source drawer and the restore drawer share the same states: the restore
// drawer reuses DONE for a finished, verified restore instead of SAVED.
export type ActionBarState = "PREVIEW" | "READY" | "BLOCKED" | "AWAITING" | "UP_TO_DATE" | "SAVED" | "DONE";

// A row click keeps the modifier meanings stable for every inner control: a
// plain click opens details, Cmd/Ctrl+click toggles this row in the batch
// selection, and Shift+click extends the batch selection from the last anchor.
export type RowClickEvent = { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault: () => void };
