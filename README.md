# Ghetto Blaster

Personal music player & LAN streamer for Windows, by [n3lio](https://github.com/n3lio).

Play your collection on the desktop, control it from your phone, share it
across the room.

---

## Download

[**Latest Release**](https://github.com/n3lio/Ghetto-Blaster/releases/latest) — grab `Ghetto-Blaster-Setup-X.X.X.exe`, install, done.

> Windows may show a SmartScreen warning ("Unknown publisher"). This is normal
> for indie software — click **More info** → **Run anyway**.

---

## Features

- Play **MP3, M4A, FLAC, OGG, WAV, AAC**
- Stream to any device on the LAN (phone, tablet, laptop)
- Remote control from mobile (play, pause, skip, volume, browse library)
- Switch audio output (PC speakers / Bluetooth) from desktop or phone
- Fuzzy search across title, artist, album, genre
- Smart shuffle (avoids consecutive same-artist plays)
- 10 audio visualizers with fullscreen mode
- Equalizer with presets
- Smart playlists by genre + drag & drop reorder
- Favorites (heart tracks)
- Library views: Tracks, Albums, Artists
- Crossfade between tracks
- Play history + stats dashboard
- QR code for instant mobile pairing (with auth token baked in)
- Customizable accent color theme
- Auto-update

---

## Setup

1. Install and launch
2. Settings (gear icon) → add your music folder(s)
3. Wait for scan to complete
4. Play

Mobile: scan the QR code in Settings, or open `http://<your-PC-IP>:3000` on
your phone — the QR code includes the auth token, so the phone is paired in
one shot.

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
   │   ─ /api/tracks  /api/queue  /api/playlists  …       │
   │   ─ /api/stream/:id  (range-aware)                   │
   │   ─ /api/cover/:id   (mtime-cached)                  │
   │   ─ ws://… push: state, library-updated, scan:*      │
   │   ─ scan: chokidar → music-metadata → library + ids  │
   └─────────┬────────────────────────────────────────────┘
             │
             ▼
   ┌──────────────────────────────────────┐
   │  public/  (renderer, also served to  │
   │  LAN clients)                        │
   │  ─ index.html  (SPA shell)           │
   │  ─ style.css   (theme + layout)      │
   │  ─ visualizer.js (Shape × Color)     │
   └──────────────────────────────────────┘
```

The Electron desktop and the LAN clients are the **same web app** — the
renderer hits `localhost:3000`, mobile hits `http://<PC-IP>:3000?t=<token>`.
The desktop is just the LAN client that also drives audio playback.

---

## Development

```sh
npm install
npm start          # Electron, normal mode
npm run dev        # Electron with --dev (devtools + hot reload)
npm test           # Node test runner — unit + integration
npm run lint
npm run build      # Windows .exe via electron-builder
npm run build:dir  # unpacked smoke build
```

Releasing: bump `package.json` version, then `git tag vX.Y.Z && git push --tags`.
See [`docs/RELEASING.md`](docs/RELEASING.md) for the workflow details.

REST API: see [`docs/API.md`](docs/API.md).

Repo conventions for AI assistants: [`CLAUDE.md`](CLAUDE.md).

---

Made by [n3lio](https://github.com/n3lio)
