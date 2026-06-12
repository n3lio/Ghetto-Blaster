# Repo conventions

Notes for AI assistants (and humans coming back after a long break).

## Layout

- `main.js` — Electron entrypoint. Single-instance lock, BrowserWindow, tray,
  IPC, auto-updater, splash. Starts the embedded server.
- `preload.js` — `contextBridge` exposing a small `window.resonance` API to
  the renderer. Keep it tight — no full `ipcRenderer` exposure.
- `server-module.js` — Express + ws server. Holds in-memory `library`, `queue`,
  `playlists`, `history`, `favorites`. Persists JSON files to `userData/`.
- `lib/` — pure helpers, unit-tested:
  - `validation.js` — input/type guards used by API handlers.
  - `playlists.js` — playlist resolution, smart shuffle, reorder.
  - `scanner-pool.js` + `scanner-worker.js` — opt-in worker pool for metadata
    parsing (enable with `scanInWorker: true` in `config.json`).
- `public/` — renderer. Single-page app served by Express. `index.html` shell
  with inline JS, `style.css` for layout, `visualizer.js` for audio viz.
- `tests/` — `node:test` based. No jest, no vitest. Each `*.test.js` runs in
  isolation; use `test.before` / `test.after` for fixtures.
- `assets/` — app icons (`icon.ico` is multi-resolution; `icon.png` is the
  source 1024×1024).
- `docs/` — release procedure, REST API reference.

## Persistence

- `userData/config.json` — user-mutable config (folders, port, accent hue,
  auth token).
- `userData/library-ids.json` — `{ paths: { "C:/Music/x.mp3": 42 }, nextId }`.
  Track ids are stable across rescans (favorites/history depend on this).
- `userData/playlists.json` — manual + smart playlists.
- `userData/history.json` — capped at 5000 plays.
- `userData/favorites.json` — array of track ids.
- `userData/__covers/` — `<id>.<ext>` cover files, with `<id>.<ext>.mtime`
  sidecar so the cache only re-extracts when the source file changed.

## Conventions

- **CommonJS only on the Node side.** No ESM, no TypeScript. Renderer is
  plain ES2020+ in browser context.
- **No external CDNs in the renderer** beyond the Google Fonts stylesheet.
  All other code is shipped with the app — keep it offline-friendly.
- **No bundler yet.** `index.html` is large by design until a frontend
  refactor lands. Don't add webpack/vite without splitting the renderer first.
- **Pure helpers go in `lib/`.** If something has no side effects and could
  be unit-tested, it belongs there, not buried in `server-module.js`.
- **Track ids are integers, never strings.** Validate with
  `validation.isValidTrackId(id, library)` before indexing.
- **Auth token is baked into the QR code.** Localhost bypasses auth; everyone
  else needs `?t=<token>` or `Authorization: Bearer <token>`.
- **Remote commands are whitelisted.** Adding a new mobile-triggered action
  means appending to `validation.REMOTE_COMMANDS` *and* handling it on the
  desktop renderer side.

## Testing

```sh
npm test           # all tests, headless
npm run test:watch # rerun on file changes
```

`tests/validation.test.js` and `tests/playlists.test.js` are the unit suite —
they don't need any installed dependencies and run in a fresh checkout.
`tests/http.test.js` and `tests/ws.test.js` boot the real server (port 0) and
hit it via `supertest` / `ws`. They auto-skip if those packages aren't
installed.

When adding a route, also add at least one supertest assertion covering
input validation (the security-relevant case).

## Style

- 2-space indent, single quotes, trailing commas, semis. Prettier handles it.
- `'use strict'` is implicit (CommonJS modules).
- Comments explain *why*, not *what*. Reach for a comment when the code is
  doing something subtle (e.g. why a debounce window exists).

## Things to NOT change without asking

- The track-id allocation scheme (`getOrAssignTrackId`). Breaking the
  `path → id` mapping invalidates every user's favorites and history.
- The auth-token middleware logic. Localhost bypass is intentional —
  the desktop renderer hits `http://localhost:3000` with no token.
- The on-disk JSON shapes (`playlists.json`, `library-ids.json`, etc.)
  without a migration step. There are users in the wild.

## Roadmap status

See `TODO.md` for the global backlog. The current phasing is recorded in
the assistant's persistent memory under `project_phases.md`.
