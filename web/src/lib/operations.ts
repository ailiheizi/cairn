// Typed daemon operation names.
//
// Every browser surface calls the bounded local `/api/v1` dispatcher through
// `app/command.ts`; this module owns the operation identifiers so a surface
// never builds an operation string inline. The names are the frozen public
// dispatcher verbs: adding or renaming one is a contract change, not a
// presentation change.
//
// `API_BASE` and the two REST-shaped endpoints (`/healthz` and `/command`) are
// part of the same adapter contract and live here too.

export const API_BASE = "/api/v1";

/** Transport endpoints of the bounded local adapter. */
export const endpoints = {
  health: `${API_BASE}/healthz`,
  command: `${API_BASE}/command`,
  // The bounded upload channel into the daemon-owned staging inbox. It sits
  // behind the same token gate as /command; staging is daemon scratch until
  // an ingest plan is reviewed and applied.
  upload: `${API_BASE}/upload`,
  // One explicit snapshot-local exact file; bytes are streamed by the browser.
  download: `${API_BASE}/download`,
} as const;

/**
 * Typed operation path. The literal records are grouped by the daemon
 * subsystem they address; `Operation` is the union every caller may pass to
 * `command()`.
 */
export const operations = {
  status: {
    get: "status.get",
  },
  capability: {
    list: "capability.list",
  },
  doctor: {
    check: "doctor.check",
  },
  snapshot: {
    list: "snapshot.list",
    diff: "snapshot.diff",
    verify: "snapshot.verify",
  },
  source: {
    list: "source.list",
    // The reviewed staged-file cleanup: deletes only regular files inside the
    // daemon-owned staging inbox after the operator's explicit confirmation.
    stagingClean: "source.staging_clean",
  },
  content: {
    list: "content.list",
    open: "content.open",
    read: "content.read",
    close: "content.close",
  },
  namespace: {
    list: "namespace.list",
  },
  search: {
    query: "search.query",
    rebuild: "search.rebuild",
  },
  plan: {
    ingest: "plan.ingest",
    get: "plan.get",
    apply: "plan.apply",
    restore: "plan.restore",
  },
  annotation: {
    list: "annotation.list",
    upsert: "annotation.upsert",
    delete: "annotation.delete",
    // The reviewed rename/merge pair: a read-only plan and the digest-bound
    // apply that performs it. They replace N sequential per-subject writes.
    tagPlan: "annotation.tag_plan",
    tagApply: "annotation.tag_apply",
  },
  representation: {
    list: "representation.list",
  },
  description: {
    list: "description.list",
    get: "description.get",
    // On-demand DESCRIBE_SUBJECT generation through the daemon's egress gate.
    // It is a write (it can create a durable revision and disclose subject
    // material to the configured provider) and runs only from the explicit,
    // confirmed details-panel action.
    generate: "description.generate",
    // The immutable revision write. The details panel uses it for exactly one
    // user decision: accepting a generated candidate as the accepted successor
    // (the selected candidate's kind and predecessor, with caller-supplied
    // body text that may be edited before acceptance). It stores that body and
    // never runs a provider.
    create: "description.create",
  },
  // The image bundle installs from a local archive only: it is a write into the
  // models root, offered by exactly the vocabulary the daemon implements.
  image: {
    bundleInstall: "image.bundle.install",
  },
  semantic: {
    bundleInstall: "semantic.bundle.install",
    providerList: "semantic.provider.list",
  },
  // Durable typed media facts: one subject-scoped read of the same
  // metadata_facts rows the processor host writes. Track and work metadata
  // stay in their own projections the daemon already keeps.
  subjectFacts: {
    list: "subject.facts.list",
  },
  audio: {
    list: "audio.list",
  },
  books: {
    list: "books.list",
  },
  // Remote egress is authorized by an immutable operator-issued grant. The
  // browser can list what exists and issue or revoke one; it never carries a
  // credential or a destination of its own.
  egress: {
    grantCreate: "egress.grant.create",
    grantList: "egress.grant.list",
    grantRevoke: "egress.grant.revoke",
  },
  // Optional similarity review: an explicit scan computes non-identity
  // perceptual hashes; groups are a review projection that never claims
  // identity and never offers deletion or merging.
  similarity: {
    scan: "similarity.scan",
    groups: "similarity.groups",
  },
  config: {
    get: "config.get",
    update: "config.update",
  },
  view: {
    save: "view.save",
    list: "view.list",
    get: "view.get",
    evaluate: "view.evaluate",
  },
  export: {
    plan: "export.plan",
    apply: "export.apply",
    verify: "export.verify",
    list: "export.list",
  },
  recovery: {
    export: "recovery.export",
    anchorExport: "recovery.anchor.export",
  },
  // The durable job rows and their retained run log. `job.list` and
  // `job.events` are bounded reads; `job.cancel` stays the only cancel path.
  job: {
    list: "job.list",
    events: "job.events",
    cancel: "job.cancel",
  },
} as const;

type OperationTree = typeof operations;
type Leaf<T> = { [K in keyof T]: T[K] extends string ? T[K] : Leaf<T[K]> }[keyof T];

/** Union of every daemon operation this client may dispatch. */
export type Operation = Leaf<OperationTree>;
