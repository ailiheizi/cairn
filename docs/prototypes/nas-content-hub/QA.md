# Concept browser review — 2026-10-06

This review covers the standalone authored-data prototype in this directory,
served on loopback at `http://127.0.0.1:4650/`. It does not cover the current
development WebUI, real NAS content, daemon content access, or a release profile.

## Scope and trace

- **Phase:** Phase 3 informative browser-product planning; no production gate advanced.
- **Requirement:** Content-store contract §2 and §13, shared content discovery,
  inspection, and retrieval with truthful capability boundaries.
- **Exit:** A runnable responsive concept with specialized views sharing demo
  search, topics, and one Notes surface, without a new service or durable store.

## Observed results

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Desktop gallery and specialized navigation | PASS | All, Photos, Audio, Video, and Documents render in the in-app browser. Gallery layout was visually reviewed at a 1280-pixel CSS viewport. |
| Shared topic across types | PASS | `风景` yields two photos; switching to Audio preserves the topic and shows an honest zero-result state. Switching back to Photos yields two. `山间周末` yields three audio tracks and two documents. |
| Shared Notes and text search | PASS | A photo's session-only Notes were edited and saved; searching the unique test text yielded that one photo. Reload clears these edits as documented. |
| Escape and focus return | PASS | After saving Notes, Escape closes inspection and focus returns to the connected originating photo button. |
| Native audio playback | PASS | Bundled synthetic WAV reached its five-second duration with `readyState=4`, `ended=true`, and no media error. This is demo playback only. |
| Native video playback | PASS | Bundled five-second MP4 advanced to about 0.219 seconds with `paused=false`, `readyState=4`, a 640×360 frame, and no media error. This is demo playback only. |
| Document reading surface | PASS | Documents shows two authored items and an explicitly labeled reading excerpt. The placeholder PDF is not the prose route guide. |
| Mobile Photos and Audio | PASS | At a 390×844 CSS viewport, bottom navigation switches views and native audio controls fit. Document/body width is 375 pixels, including room for the scrollbar, with no horizontal overflow. This is responsive desktop emulation, not a physical-device test. |
| Return to desktop | PASS | Temporary device metrics were cleared; desktop document width is 1265 pixels in a 1280-pixel viewport. |
| JavaScript syntax and bundled formats | PASS | Inline JavaScript syntax and WAV/MP4/PDF signatures checked separately; syntax is not a substitute for the browser observations above. |
| Download completion and byte verification | NOT RUN | Matching local demo download links are present; this review did not verify browser downloads byte-for-byte. |
| Streaming seek, authorization, cancellation, integrity failure, codec matrix | NOT RUN | These require a separately reviewed content-access contract and real backend samples. Demo native controls do not prove them. |
| Physical phones, real NAS, production library integration | NOT RUN | No production integration exists in this prototype. |

Browser review found and corrected a classic-script `window.top` name collision,
loss of focus after Notes save, and inconsistent topic reset during navigation.
The final render, focus return, and topic behavior were checked in the browser
after the respective fixes. Historical console errors from the first render
must not be described as a clean initial run.

Desktop gallery, desktop audio, mobile gallery, and mobile audio screenshots
were retained locally under `dist/nas-concept-review-20261006/`. These are review
artifacts, not repository or release qualification evidence.

No Go tests or production integration suite were run for this documentation and
standalone-prototype slice. Existing core acceptance records remain separate.
