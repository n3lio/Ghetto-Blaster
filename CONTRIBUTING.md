# Contributing

Hi 👋 — this is a small personal project, but PRs are welcome. A few notes
to keep things smooth.

## Ground rules

- **Don't break existing user data.** The JSON files in `userData/` belong
  to the user. Schema changes must go through `lib/migrations.js` (versioned,
  with a snapshot before each step).
- **Pure helpers go in `lib/`.** If something has no side effects, it
  belongs there with a unit test next to it in `tests/`.
- **No external CDN in the renderer.** Everything ships with the app. Google
  Fonts is the only exception we tolerate.
- **CommonJS on the Node side, plain ES2020+ in the browser.** No
  TypeScript, no ESM yet.

## Setup

```sh
git clone https://github.com/n3lio/Ghetto-Blaster
cd Ghetto-Blaster
npm install
npm test          # 80+ unit + integration tests
npm run lint
npm start         # Electron, normal mode
npm run dev       # Electron with --dev (devtools + hot reload renderer)
npm run dev:server  # boot the HTTP+WS server alone (no Electron) with
                    # 200 mock tracks pre-seeded — port 3001 by default
```

## Where things live

See [`CLAUDE.md`](CLAUDE.md) for the full layout. TL;DR:

- `main.js` / `preload.js` — Electron main + bridge
- `server-module.js` — Express + ws + scanner + persistence
- `lib/` — pure helpers (validation, playlists, scanner-pool, logger,
  migrations, backup, m3u, tag-writer, lyrics, multitag, mock-library, radio)
- `public/` — the renderer (single-page app served by Express)
- `tests/` — `node:test` runner

## Workflow

1. Branch from `main`.
2. Make sure `npm run lint` and `npm test` pass.
3. Add tests for any helper you touch.
4. Open a PR; the CI runs lint + tests on Node 20 and 22, and a smoke
   build on Windows.

## Releasing

Maintainer-only: see [`docs/RELEASING.md`](docs/RELEASING.md). TL;DR:
bump `package.json`, tag, push tag — the rest is automated.

## Questions

Open an issue, mention `@n3lio` on a related PR, or check
[`docs/API.md`](docs/API.md) for the REST surface.
