# Presentation packages

A presentation package is **one JSON document of design tokens**. It changes
how the already-loaded interface looks, and nothing else. It contains no
JavaScript, no components, no CSS text and no executable content of any kind:
the application never runs third-party code. A package can only restate values
for design tokens that the host already declares in
`web/src/styles/tokens.css`, and the host writes each admitted value with
`style.setProperty`, one custom property at a time.

This directory is the **source of truth**. `web/public/` is Vite's public
directory, so every `npm run build` copies it verbatim into the served root at
`web/dist/presentation-packages/`. A client rebuild therefore carries your
packages with it instead of destroying them. Nothing new loads them: the client
still fetches `presentation-packages/index.json` from the served web root at
startup and admits what it finds there.

## What ships here

- `index.json` — the index the client reads. It names the installed packages.
- `inkstone-indigo.json` — one genuine, selectable example theme and the
  reference to copy. It declares a light and a dark palette, so the Color mode
  control changes it the way it changes a built-in palette. Its `hostRange`
  admits this release, so it applies as soon as you build or run the client.

## Install your own package

1. Copy `inkstone-indigo.json` to `<your-package-id>.json` in this directory and
   edit it. The file name must be a plain `*.json` name: no directory, no
   protocol, no `..`.
2. Add the file name to `packages` in `index.json`.
3. Rebuild the client (`cd web && npm ci && npm run build`).

The build admits every listed package before Vite copies this directory into
the output. If one fails, **the build fails** and names the offending file and
the reason; the previous output is left untouched, so a bad package is refused
rather than shipped. Do not work around a refusal by dropping the file straight
into `web/dist/presentation-packages/`: the client admits it at runtime with the
same rule and shows it under **Settings → Appearance → Colors → Refused
presentation packages**, and a rebuild will delete it anyway.

## The manifest

Every field is required, and an unknown field is refused rather than ignored — a
document that declares `"css"`, `"script"` or `"components"` is refused whole,
never admitted with the executable-looking part silently dropped.

```json
{
  "schema": "cairn.presentation-package.v1",
  "id": "community:aurora",
  "name": "Aurora",
  "hostRange": ">=0.1.0-prealpha.1 <0.2.0",
  "swatches": ["#f4f8ff", "#2f5d8a", "#0f2b46"],
  "tokens": {
    "light": {
      "--canvas": "#f4f8ff",
      "--ink": "#0f2b46"
    },
    "dark": {
      "--canvas": "#0b1020",
      "--ink": "#e6edf3"
    }
  }
}
```

| Field | Rule |
| --- | --- |
| `schema` | Exactly `cairn.presentation-package.v1`. |
| `id` | `a-z`, digits and `-`, optionally one `:` namespace, e.g. `community:inkstone-indigo`. Built-in palette ids (`slate`, `paper`, `indigo`) and any id already installed are refused as a collision. |
| `name` | 1–80 characters. Shown in the palette picker. |
| `hostRange` | A space- or comma-separated comparator list over the application version (`web/package.json`), e.g. `>=0.1.0-prealpha.1 <0.2.0`. Comparators are `>=`, `>`, `<=`, `<`, `=`; anything else is refused as unsupported syntax. |
| `swatches` | 1–4 preview colours, each 1–40 characters, following the value rules below. |
| `tokens` | One flat value set — at least one entry, every key from the token list below — **or** the two names `light` and `dark`, each holding one such value set. See below. |

## `tokens`: one palette, or one per appearance

`tokens` accepts exactly two shapes, and never a mixture of them.

**A flat value set** is one palette of fixed values applied under every
appearance. This is the original form and still works unchanged:

```json
"tokens": {
  "--canvas": "#12111c",
  "--ink": "#ecebff"
}
```

**An appearance-keyed value set** declares one palette per effective
appearance, so the System/Light/Dark control changes how your theme looks
exactly as it does for a built-in palette. The host writes the set the
*effective* appearance selects, so `system` behaves like the appearance it
resolves to:

```json
"tokens": {
  "light": {
    "--canvas": "#f4f8ff",
    "--ink": "#0f2b46",
    "--primary": "#4a3f9d"
  },
  "dark": {
    "--canvas": "#12111c",
    "--ink": "#ecebff",
    "--primary": "#c6bcff"
  }
}
```

Rules for this form:

- Both `light` and `dark` are required. A package that declares only one would
  keep claiming the theme id while leaving the other appearance on the built-in
  palette, so it is refused whole.
- A flat token name beside `light`/`dark` makes one field mean two things and is
  refused whole.
- Each set is checked by the same token allowlist and the same value rules as a
  flat set; an unknown key inside a set is refused whole, by name, and names the
  appearance it came from.
- A set may declare fewer tokens than the other one. A token declared in only
  one set is written for that appearance and **removed** for the other, so the
  compiled value takes over there instead of leaking across.


`index.json` has its own shape, and an entry is refused if it is not a plain
`*.json` file name in this directory:

```json
{
  "schema": "cairn.presentation-package-index.v1",
  "packages": ["inkstone-indigo.json"]
}
```

## The token list

These 42 names are exactly the custom properties declared by the `:root` block
of `web/src/styles/tokens.css`. Every other key is refused by name.

Colour and surface: `--ink`, `--muted`, `--quiet`, `--line`, `--line-strong`,
`--surface`, `--surface-raised`, `--surface-soft`, `--surface-dim`,
`--surface-container-low`, `--surface-container`, `--surface-container-high`,
`--surface-container-highest`, `--primary-container`, `--on-primary-container`,
`--glass`, `--primary`, `--primary-deep`, `--primary-ink`, `--primary-soft`,
`--accent`, `--accent-soft`, `--health`, `--health-soft`, `--coral`, `--gold`,
`--blue`, `--canvas`, `--overlay`, `--floating-surface`.

Depth and shape: `--shadow`, `--shadow-soft`, `--hairline`,
`--hairline-strong`, `--card-radius`, `--card-radius-sm`, `--card-fill`,
`--card-fill-quiet`, `--card-shadow`, `--card-shadow-soft`.

Layout: `--page-gutter`, `--rail`.

## The value rules

A token value is refused whole when it is empty, longer than 200 characters, or
contains anything that could terminate or extend a CSS declaration, fetch a
resource, or smuggle an expression:

- the characters `\` `;` `{` `}` `@` `"` `'` and control characters;
- the substrings `url(`, `expression(`, `image-set(`, `javascript:`, `/*`,
  `*/`, `!important`.

Ordinary `#rrggbb` colours, `rgb(… / …%)` (used for translucency), `0 8px 24px
rgb(0 0 0 / 26%)` shadows and `14px` radii are all fine. Keep the quotes: a
value may not be a quoted string.

## What a package can and cannot change

An admitted package can change the appearance of content the host has already
loaded: colours, surfaces, borders, radii, shadows, page gutter and rail width.

A package can never:

- influence exact identity, a content digest or a profile digest;
- register a processor or a representation, or change what processing reports;
- read or write the repository, the catalog, recovery records or trust anchors;
- alter an export manifest or a materialized output, or change what a
  verification reports;
- open network access, load a remote resource, or run code.

That boundary is structural, not a promise: a package is data, it is admitted
whole or refused whole, and the only thing the host does with an admitted value
is assign it to a design token.

## Notes for a theme author

- A package may restate **one** palette of fixed values, or **one palette per
  appearance**. Use the per-appearance form when you want the System/Light/Dark
  control to change how your theme looks; use the flat form when the palette is
  meant to be the same in both. Either way, check contrast yourself.
- The shipped example, `inkstone-indigo.json`, declares a real light and dark
  pair: an inkstone-paper light palette and the deep indigo dark palette, with
  the same shape and the same radii, so selecting it and switching appearance
  changes the rendered colours instead of doing nothing.
- The example sets 40 of the 42 tokens in each appearance and leaves
  `--page-gutter` and `--rail` at their compiled responsive values; whatever a
  package does not set for the selected appearance, the built-in palette keeps.
- `color-scheme` is not an admitted token, so a package never writes it, and it
  does not need to. The client already derives it from the effective appearance
  through a rule that is not scoped to a theme (`html[data-appearance="light"]`
  in `web/src/styles/base.css`), so native form controls and scrollbars follow
  light and dark correctly under an installed theme too. Measured: an installed
  theme reports `color-scheme: light` under light and `dark` under dark.
- Admission is pure: the same document is either admitted whole or refused
  whole, with one stable reason. If your package is refused, the reason is shown
  in the interface and, for this directory, named by the build.
