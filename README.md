# Ghetto Blaster

**Personal music player & LAN streamer** — v3.18.4

Play your collection on the desktop, control it from your phone, share it across the room.

[![Download Latest](https://img.shields.io/github/v/release/n3lio/Ghetto-Blaster?label=Download&style=flat-square)](https://github.com/n3lio/Ghetto-Blaster/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

Made by [n3lio](https://github.com/n3lio).

---

## Download

[**Latest Release**](https://github.com/n3lio/Ghetto-Blaster/releases/latest) — grab `Ghetto-Blaster-Setup-X.X.X.exe`, install, done.

> Windows may show a SmartScreen warning ("Unknown publisher"). This is normal for indie software — click **More info** → **Run anyway**.

---

## Features

### Playback
- Play **MP3, M4A, FLAC, OGG, WAV, AAC**
- Gapless playback + crossfade between tracks
- Volume normalization (ReplayGain)
- 10 audio visualizers with fullscreen mode
- Equalizer with presets + pitch/speed control
- Sleep timer + auto-shutdown
- Mini-player with drag & drop

### Library
- Fuzzy search across title, artist, album, genre, year
- Library views: Tracks, Albums, Artists, Years (with timeline), Genres (grouped)
- Smart playlists: create by genre/keywords with exclusions
- Manual playlists + drag & drop reorder
- Favorites (heart tracks)
- Play history + stats dashboard (plays by week, top artists/genres, heatmap)
- Auto-backup + restore

### Mobile & Streaming
- Stream to any device on the LAN (phone, tablet, laptop)
- Remote control from mobile (play, pause, skip, volume, browse library, device switching)
- QR code for instant pairing (auth token baked in)
- Seamless sync across desktop and mobile clients

### UI & Settings
- Light / dark / auto theme
- Customizable accent color
- Offline-friendly (all code shipped with app, no CDN)
- Auto-update mechanism
- Keyboard shortcuts for power users

---

## Quick Start

1. **Install**: Download from [Releases](https://github.com/n3lio/Ghetto-Blaster/releases/latest), run the installer.
2. **Configure**: Open Settings (gear icon) → add your music folder(s).
3. **Wait**: Let the library scan complete.
4. **Play**: Pick a track or playlist.

**Mobile access**:
1. Settings → copy the QR code (or view the pairing URL).
2. On your phone, scan the QR or open `http://<your-PC-IP>:3000?t=<token>`.
3. Control playback, browse library, manage queue from mobile.

(The QR code includes the auth token, so pairing is instant.)

---

## Keyboard shortcuts

| Action               | Shortcut          |
| -------------------- | ----------------- |
| Play / pause         | Space             |
| Next track           | →                 |
| Previous track       | ←                 |
| Volume up / down     | ↑ / ↓             |
| Mute                 | M                 |
| Toggle fullscreen viz| F                 |
| Search               | /                 |
| Toggle settings      | ,                 |
| Toggle library views | 1 / 2 / 3         |

---

## Architecture

```
 ┌────────────────────────┐         ┌────────────────────┐
 │  Electron main process │         │   LAN clients      │
 │  (main.js, preload.js) │         │   (phone, tablet)  │
 │  ─ tray, splash        │         │                    │
 │  ─ auto-updater        │         └─────────┬──────────┘
 │  ─ window controls     │                   │
 └────────┬───────────────┘                   │ HTTP / WS
          │ IPC                               │ (auth-token-gated
          │                                   │  except localhost)
          ▼                                   ▼
   ┌──────────────────────────────────────────────────────┐
   │   Express + ws server (server-module.js)             │
   │   ─ /api/state  /api/tracks  /api/queue  /api/stream │
   │   ─ /api/playlists  /api/favorites  /api/history     │
   │   ─ /api/cover/:id   (mtime-cached)                  │
   │   ─ ws://… push: state, library-updated, scan:*      │
   │   ─ scan: chokidar → music-metadata → library + ids  │
   └─────────┬────────────────────────────────────────────┘
             │
             ▼
   ┌──────────────────────────────────────┐
   │  public/  (SPA — shared by desktop   │
   │  and LAN clients)                    │
   │  ─ index.html  shell                 │
   │  ─ style.css   (theme, layout)       │
   │  ─ js/* (modules)                    │
   │  ─ visualizer.js (10 shapes)         │
   └──────────────────────────────────────┘
```

**Desktop + Mobile = Same Web App**: the Electron renderer and LAN clients both
hit the Express server and use the same frontend. The desktop controls audio
playback; mobile remotes do queue/playback commands via WebSocket.

---

## Project Structure

- `main.js` — Electron entrypoint. Tray, auto-updater, window lifecycle, IPC.
- `preload.js` — contextBridge exposing `window.resonance` API to renderer.
- `server-module.js` — Express + WebSocket server. Core library, queue, playlists, history, favorites.
- `public/` — SPA renderer: `index.html` shell, `style.css`, modular JavaScript.
- `lib/` — Pure helpers (validation, playlists logic, scanner pool, metadata parsing).
- `tests/` — Node test suite: unit tests, HTTP integration tests, WebSocket tests.
- `assets/` — App icons (multi-resolution on Windows, PNG source).
- `docs/` — API reference, release procedure, changelog.

---

## Development

```sh
npm install                # Install dependencies
npm start                  # Launch Electron app
npm run dev                # Electron + devtools + hot reload
npm run dev:server         # Run just the Express server (headless)
npm test                   # Run test suite
npm run lint               # Check code style
npm run build:dir          # Build unpacked .exe (smoke test)
npm run build              # Build Windows installer
```

---

## Documentation

- **[`docs/API.md`](docs/API.md)** — REST API reference: endpoints, auth, rate limits, WebSocket events.
- **[`docs/RELEASING.md`](docs/RELEASING.md)** — Release workflow: how tags trigger CI builds and GitHub Releases.
- **[`docs/CHANGELOG.md`](docs/CHANGELOG.md)** — Version history: features and fixes per release.
- **[`CLAUDE.md`](CLAUDE.md)** — Repo conventions for developers and AI assistants.

---

## License

MIT

Made by [n3lio](https://github.com/n3lio)
