# Bounded Client Appearance and Library Views Acceptance

Date: 2026-10-06 (Asia/Shanghai). Status: implemented and locally tested client
maintenance. This is not release qualification, a plugin runtime, a player, or
a core phase closure.

## Scope and checkpoint

- Active phase: Phase 3, bounded browser maintenance under the current lock.
- Normative requirement: [REST/WebUI adapter requirements §2 and §6](../requirements/api-and-webui.md#2-adapter-architecture): one typed core authority and recognizable actions/status. The existing library/Notes/content-access loop stays shared.
- Executable exit: web build, static slot/preference contract checks, i18n checks,
  broad practical Go tests, and actual browser checks of palette selection,
  persistence, disabled-view fallback, draft retention, and narrow layout.
- Checkout: `main`, HEAD `5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`,
  with pre-existing uncommitted work. This record covers the current changed
  tree, not a clean HEAD or a release artifact.

The root selected the slice and integrated shell/settings behavior. Luna agents
implemented token palettes, static library slots, preferences, and targeted
style corrections. Unrelated worktree changes were preserved.

## Implemented behavior

Settings > Appearance provides Slate, warm paper, and deep indigo palettes;
system/light/dark appearance; immediate browser-local preferences and reset.
Root attributes are applied before React mounts. System preference changes
affect only system mode; explicit light/dark overrides do not depend on OS CSS
media rules. Shared surfaces consume the active semantic palette.

The existing photo/audio library lenses are compiled, namespaced entries with
unique IDs/slots/modes. Reserved host destinations cannot be replaced. Settings
can hide either lens while the generic library remains available. Hiding the
active lens returns to the shared listing without clearing the inspected
subject or its Notes draft. A disabled lens's old deep link resolves to the
generic library. Visibility does not install/remove code, alter provider
routing, delete content, or change annotations.

The new presentation keys follow the existing browser layout/sort convention.
They are discardable origin-local preferences, not server config, recovery
records, cross-device synchronization, or another settings database. Appearance
is usable without daemon config; server Save/restart controls are absent from
that section. Operator config retains its existing reviewed save contract.

## Evidence

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| `npm --prefix web run build` | PASS | TypeScript and production Vite build. Existing large-JS-chunk warning remains. |
| `node scripts/web-client-preferences-check.mjs` | PASS | Duplicate IDs/slots/modes and reserved host modes reject; generic modes remain available; malformed/unknown/denied appearance storage falls back; explicit/system appearance resolution is checked. |
| `node scripts/web-i18n-check.mjs` | PASS | 16 partials, 1,532 unique keys; client literal translations covered. |
| `go test -tags purego ./...` | PASS | Broad current-tree Go set, largely cached. No Go/core mutation in this slice. |
| `git diff --check` and stylesheet parsing | PASS | No whitespace errors; installed PostCSS parses all client styles. |
| Live browser, six theme/mode combinations | PASS for bounded checks | Actual local daemon/client; primary and secondary token readability, native radio controls, explicit dark over simulated OS light, and dynamic system following were inspected. This is not a complete accessibility audit. |
| Preference persistence / keyboard | PASS | Selection survived reload; native radio ArrowRight changed selected mode. |
| Active photo lens disabled | PASS | Returned to generic URL/listing while saved Notes/tag and a typed unsaved Notes draft remained present. |
| Disabled lens deep link | PASS | `#v=photos` with Photos hidden returned to generic library. |
| Both optional lenses hidden | PASS | All three QA subjects remained in the generic library. |
| API unavailable | PASS for client appearance | Browser requests to `/api/v1/*` were temporarily blocked; controls remained available and daemon Save was absent. Blocking and OS emulation were cleared afterward. |
| Narrow layout | PASS | Actual 390 × 844 browser viewport: document width equals scroll width; label copy has room beside switches. Temporary viewport override was reset. |
| Content/annotation invariants | PASS | Saved tag/Notes records and three subject/content identity tuples unchanged; original downloads independently matched SHA-256 and logical length. |

Preview: `http://127.0.0.1:4648/`, served by the current daemon with
`--web-root web/dist`. Retained local evidence is under
`dist/client-appearance-20261006/`, including `palette-contrast.json`,
`qa-readback.txt`, and `screenshots/`. The final build uses assets `index-KBQVlgmj.js` and `index-CvupLUub.css`.
All six checked palettes have quiet text contrast of at least 4.59:1 across
base, raised, soft, and highest-container tokens. Primary-button text contrast
is at least 6.59:1. These are token-pair checks, not full WCAG conformance.
These are local development outputs, not supported installation packages.

Three isolated QA files (PNG, Markdown, WAV) and one subject's tag/Note were
created through the real typed ingest/annotation operations in a fresh preview
data directory. They are test data, not user-library content or media playback
qualification. Missing image/semantic model bundles remain visibly unavailable
in this preview; no fixture provider was enabled or promoted.

## Remaining scope

The two lenses retain their existing classification/coverage semantics. This
slice does not add real albums, playlists, queue/playback, video/document
readers, domain schemas, public manifest/ABI, runtime installation, dependency
graphs, third-party isolation, remote identities, or multi-user deployment.
The full contribution/lifecycle proposal remains a design for later reviewed
slices. Decorative identity marks and some alpha borders/shadows retain their
existing styling; the bounded token checks do not qualify every surface or
all assistive-technology combinations.

See [the single-operator design](single-operator-experience-pack-design.md) and
[ADR-019 / ADR-020](build-stack-and-architecture-selection.md#adr-019-bundled-vertical-client-modules-before-a-runtime-extension-framework).
