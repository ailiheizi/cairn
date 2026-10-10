# Cairn browser client

This directory is part of the unreleased core preview on `main` after
`v0.1.0-prealpha.1`.

This is a small React/Vite client for the optional loopback API. It contains
no storage logic: all requests are `command.Envelope` calls to
`POST /api/v1/command`.

1. Enable the adapter in the persisted TOML profile:

```toml
[api]
enabled = true
listen = "127.0.0.1:4534"
```

2. Start `restoreweaved` and run `npm ci && npm run dev` in this
directory. Set `RESTOREWEAVE_API_TOKEN` when the API is not confined to a
trusted local process.

The browser is a convenience surface. It must not be required for exact
ingest, verification, or clean-install restore.

Source layout: `src/main.tsx` is the application shell (root state, document
effects, surface composition), `src/app/` holds one hook per data concern,
`src/components/` holds one file per surface, `src/styles/` holds one stylesheet
per surface aggregated by `src/styles/index.css`, and `src/lib/` holds pure
helpers including the typed daemon operation names. See
`docs/technical/webui-architecture.md` for the module map, the ownership rules,
and the checklist for adding a surface.
