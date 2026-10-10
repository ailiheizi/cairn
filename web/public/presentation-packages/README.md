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
  reference to copy. Its `hostRange` admits this release, so it applies as soon
  as you build or run the client.

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
  "id": "community:inkstone-indigo",
  "name": "Inkstone Indigo",
  "hostRange": ">=0.1.0-prealpha.1 <0.2.0",
  "swatches": ["#12111c", "#c6bcff", "#7fe0b5"],
  "tokens": {
    "--canvas": "#12111c",
    "--ink": "#ecebff"
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
| `tokens` | At least one entry, every key from the token list below. |

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

- A package restates a **single** palette of fixed values. The application's
  System/Light/Dark control still switches appearance, but the tokens a package
  sets do not become a second light or dark variant — they are the same values
  in both. Set the tokens as one coherent palette and check contrast yourself.
  The shipped example is a dark theme, so it renders dark under every appearance
  setting.
- The example sets 40 of the 42 tokens and leaves `--page-gutter` and `--rail`
  at their compiled responsive values; whatever a package does not set, the
  built-in palette keeps.
- Admission is pure: the same document is either admitted whole or refused
  whole, with one stable reason. If your package is refused, the reason is shown
  in the interface and, for this directory, named by the build.
