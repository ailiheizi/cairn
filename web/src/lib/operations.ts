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
    verify: "snapshot.verify",
  },
  source: {
    list: "source.list",
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
  },
  representation: {
    list: "representation.list",
  },
  description: {
    list: "description.list",
    get: "description.get",
  },
  semantic: {
    bundleInstall: "semantic.bundle.install",
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
