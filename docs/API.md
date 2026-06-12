# REST API reference

Base URL: `http://<host>:<port>`. The desktop renderer hits `http://localhost:3000`
and bypasses auth; everything else needs the LAN auth token.

## Auth

Localhost requests skip auth entirely (`127.0.0.1` and `::1`).

LAN clients must present the token from the QR code as either:

- header: `Authorization: Bearer <token>`
- query: `?t=<token>` (necessary for `<audio>` and `<img>` tags that can't set
  headers)

Wrong/missing token → `401 { "error": "Unauthorized" }`.

## Rate limits

| Scope                     | Limit          |
| ------------------------- | -------------- |
| `/api/*`                  | 600 req / min  |
| `/api/cover/*`, `/api/stream/*` | not limited |
| `/api/rescan`             | 3 req / 5 min  |
| `/api/remote/command`     | 120 req / min  |

## Library

| Method | Path | Response |
| ------ | ---- | -------- |
| GET | `/api/tracks` | `[{ id, title, artist, album, genre, year, duration, hasCover, favorited }]`. Query: `q`, `genre`. |
| GET | `/api/genres` | `[String]` (sorted, distinct). |
| GET | `/api/cover/:id` | image bytes (or 404). Cache-Control 7d. |
| GET | `/api/stream/:id` | audio bytes. Supports HTTP range requests. |
| POST | `/api/rescan` | `{ ok, count }`. Rate-limited. |
| GET | `/api/scan/status` | `{ scanning: bool }`. |

## Playback

| Method | Path | Body | Notes |
| ------ | ---- | ---- | ----- |
| GET | `/api/state` | — | Current player state snapshot. |
| POST | `/api/queue` | `{ trackIds: [Int] }` | Replaces queue. Max 10 000 ids. |
| POST | `/api/queue/add` | `{ trackIds: [Int] }` | Appends. |
| POST | `/api/play` | `{ index?: Int }` | If `index` given, jumps to it. |
| POST | `/api/pause` | — | |
| POST | `/api/next` | — | |
| POST | `/api/prev` | — | |
| POST | `/api/shuffle` | — | Plain Fisher-Yates over the queue. |

## Playlists

| Method | Path | Body | Notes |
| ------ | ---- | ---- | ----- |
| GET | `/api/playlists` | — | Summary list. |
| GET | `/api/playlists/:id` | — | Includes resolved tracks. |
| POST | `/api/playlists` | `{ name, trackIds? \| genres? \| keywords? }` | Provide one of trackIds/genres/keywords. |
| PUT | `/api/playlists/:id` | `{ name?, genreMatch?, trackIds? }` | All fields validated. |
| DELETE | `/api/playlists/:id` | — | |
| POST | `/api/playlists/reorder` | `{ order: [String] }` | List of playlist ids. |
| POST | `/api/playlists/:id/play` | — | Replaces queue with playlist tracks. |

## Favorites

| Method | Path | Body |
| ------ | ---- | ---- |
| GET | `/api/favorites` | — |
| POST | `/api/favorites/toggle` | `{ trackId: Int }` |

## History & stats

| Method | Path | Notes |
| ------ | ---- | ----- |
| POST | `/api/history/log` | `{ trackId }` — appends. |
| GET | `/api/history/recent?limit=N` | Most recent N (max 200). |
| GET | `/api/history/top` | Top 50 by play count. |
| GET | `/api/stats` | `{ week, month, topArtists, topGenres, totalTracks, favorites }`. |

## Remote control (mobile → desktop)

| Method | Path | Body | Notes |
| ------ | ---- | ---- | ----- |
| POST | `/api/remote/command` | `{ command: String, ... }` | `command` is whitelisted (see `REMOTE_COMMANDS` in `lib/validation.js`). Broadcasts a `remote:command` WS event to the desktop renderer. |

## Pairing

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/qrcode` | `{ url, svg }` — `svg` includes the auth token, `url` does not (so the settings UI doesn't leak it on screenshots). |

## WebSocket

`ws://<host>:<port>/` — same auth as HTTP (localhost bypass; LAN clients must
send `?t=<token>`).

Events pushed by the server:

- `state` — full player snapshot. Debounced to ~80ms during heavy bursts.
- `desktop:state` — desktop renderer's view of its own audio (track id,
  progress, isPlaying). Debounced.
- `desktop:queue-changed` — `{ length }`. Mobile fetches the full queue from
  `/api/desktop/queue` after this.
- `library-updated` — `{ count }`. Sent after a rescan finishes.
- `scan:start` / `scan:done` — bracket a library rescan.
- `users:changed` — `{ count }` of connected WS clients.
- `remote:command` — payload from a `/api/remote/command` POST, broadcast so
  the desktop renderer can react.

Client → server messages:

- `{ type: 'set-name', name: String }` — sets the friendly name shown in the
  Devices tab. `name` is truncated to 20 chars.

Payload limit: 2 KB per message (server enforces).
