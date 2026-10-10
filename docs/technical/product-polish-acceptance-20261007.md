# Product Polish Acceptance (2026-10-07)

This is bounded existing-client maintenance in parallel with Phase 4. It records experience evidence for the ordinary intake/find/inspect/takeout loop under [WebUI interaction principles §6](../requirements/api-and-webui.md#6-interaction-principles). It awards no phase or release credit and does not qualify a new source, engine, default, album, player, or theme loader.

## Accepted scope

- Intake retains a visible add-content call to action. Search uses a concise prompt. Phone actions meet the 44 px target. Generic files show “File information”; readable units, estimated flags, and track work appear as grouped fields.
- Root reviewed and corrected fact-key matching, strict boolean parsing, subsecond and invalid-duration handling, and restored translations. The inspector had no original pre-capture: evidence is limited to pre-review repair snapshots and code review.
- The fresh-profile journey uploaded a file, reviewed and explicitly chose `STORE_EXACT`, then found it by name/tag/Notes and downloaded the original: 74 bytes, SHA-256 `1aaf9532a144c24ff5fd572773eff6aac7fa3d102bdc58ebad3a058dc659b379`. Offline and source-degraded states stayed visible. Both layouts passed at 390 px and 1280 px with one and two files.
- Root CUA checked both layouts at 320, 390, 641, 1024, and 1280 px: label visible and no horizontal overflow. The showcase/light interface was restored and viewport reset. Audio details showed `Sound.wav`, 0.25 seconds, 8000 Hz.

## Executable evidence

At `dist/product-polish-20261007/validation`: `web-build-v3-result.json` exited 0 in 4.459 s with no drift; `go-result.json` exited 0 in 304.846 s across 535 inputs with no drift; `first-use-result.json` exited 0 in 26.613 s using existing build-v5 daemon `52b87e4d...`, cairn `aa87a00c...`, and `web-dist-v3`. The fresh journey’s original download hash and size are recorded above. `browser-layout-checks.json` and `live-audio-details.jpg` retain CUA evidence. `node scripts/web-i18n-check.mjs` passed (1,582 keys, 53 source files); `git diff --check` passed.

Preview promotion v2 passed locally (PID 99937, `web-dist-v3`) while preserving backend configuration, snapshots, sources, jobs, and subject facts; no index rebuild or model install occurred. The first promotion attempt was rolled back after request timestamps/IDs and source observation time diverged; `preview-first-attempt.json` preserves that limitation and correction.

Next, improve existing library hierarchy, format-appropriate preview, and unsupported-content guidance within current locks. No Linux work is implied by this acceptance.

## Second slice: browsing hierarchy and preview guidance

The second slice separates title, type views, sort/layout, and secondary browse
tools. Space and month panels remain native disclosures with their measured
scope visible. Active filters and service/error notices remain visible. Normal
unsupported formats and size limits have quiet, specific guidance; missing
original content remains explicit, while failed reads, ranges, hashes, and
decoding retain error presentation and retry. No reader or player was added.

Review also corrected two existing presentation bugs: visible counts and empty
states now follow the filtered projection, and unknown logical sizes stay last
in both sort directions. The regression check executes the actual TypeScript
helper, including invalid sizes, equal keys, and input preservation.

Final evidence is under `dist/product-polish-20261007-round2`:

- `validation/web-build-v2-result.json`: exit 0, 5.285 s, no source drift.
- `validation/go-result.json`: exit 0, 189.972 s, 535 unchanged inputs.
- `validation/first-use-result.json`: exit 0, 19.628 s, real isolated
  upload/save/name/tag/Notes/original-download journey using `web-dist-v2`.
- `validation/preview-e2e-result.json` and `preview/result.json`: exit 0,
  26.184 s; real bounded PNG/UTF-8 reads, empty text, fault rejection,
  filter/sort/empty-month clearing, and both layouts at 320/390/1280 px.
  Opaque audio/PDF/archive suffix fixtures issued no preview open/read and
  downloaded with matching length/SHA-256; they prove no parsing or playback.
- `validation/sort-final.log` and `i18n-final.log`: passing regression and
  1,596 translation keys across 53 client source files.

Current preview identity supersedes PID 99937 above: PID 10932 serves
`web-dist-v2`, index SHA-256
`293619bf398b1b4c4cee4095c0706e41a451273cb4baa14e726a523eadfbe4a1`.
`validation/preview-result.json` records unchanged configuration, snapshots,
sources, jobs, and subject facts. An initial child-process launch did not
persist and left a temporary semantic lease conflict; a retained foreground
session and graceful restart after expiry restored lexical/semantic `READY`.
`live-search-after-recovery.json` records both real query components succeeding.
No index rebuild or model install occurred. The initial hash-navigation test
timeout is retained; the corrected test reloads because hash restoration runs
on mount. CUA checked retained content, tag count, and audio guidance; screenshots
are `validation/live-library.jpg` and `live-audio.jpg`. The failed original tab
was left open; the restored preview is retained in a new tab. These remain
bounded client results, without phase or release qualification.
