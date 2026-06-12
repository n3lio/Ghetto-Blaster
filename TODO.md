# Ghetto Blaster — TODO global

> Backlog complète. Le format est : `[ ] item — *(priorité)*` avec une note quand utile.
> Priorités : **P0** = bloquant / sécurité, **P1** = important, **P2** = nice-to-have, **P3** = futur lointain.

---

## 🔥 Bugs / risques connus

- [x] ~~**IDs de tracks non stables entre rescans**~~ *(P0)* — fait en v3.6.0 : map `path → id` persistée dans `library-ids.json`, pruning des paths supprimés.
- [x] ~~**Aucune authentification sur le LAN**~~ *(P0)* — fait en v3.6.0 : token 16 octets généré au boot, embarqué dans le QR-code, vérifié sur `/api/*` et upgrade WS, bypass localhost.
- [x] ~~**`fs.watch` recursive sur Windows**~~ *(P1)* — chokidar wired avec fallback fs.watch.
- [x] ~~**Cover cache vidé puis reconstruit à chaque rescan**~~ *(P1)* — diff incrémental par mtime via `<id>.<ext>.mtime` sidecar, sweep en fin de scan.
- [x] ~~**Express 4 → app.get('\*') deprecation**~~ *(P1)* — remplacé par un middleware path-less compatible Express 5.
- [x] ~~**`MAX_CONNECTIONS = 20` en dur**~~ *(P2)* — `config.maxConnections` (default 20).
- [x] ~~**`config.port` ignoré au boot Electron**~~ *(P2)* — `main.js` lit `config.port` et passe au server, port effectif récupéré pour `loadURL`.
- [x] ~~**Helmet CSP désactivé**~~ *(P2)* — CSP minimale activée (self + unsafe-inline pour le moment, à durcir après split frontend).
- [x] ~~**Pas de cleanup `userCounter` / `uniqueIps`**~~ *(P3)* — `uniqueIps` capé FIFO à 1000 entrées.
- [ ] **Pas de fallback couverture** *(P2)* — `/api/cover/:id` renvoie 404 si pas de cover ; vérifier que l'UI gère partout (placeholder).

## 🔒 Sécurité & robustesse

- [x] ~~**PIN/token d'accès**~~ *(P0)* — fait v3.6.0.
- [x] ~~**Rate-limit sur `/api/remote/command`**~~ *(P1)* — 120/min, whitelist de commandes.
- [x] ~~**Validation stricte des body JSON**~~ *(P1)* — helpers `lib/validation.js` + cap queue 10k + types stricts sur queue/playlists/favorites.
- [x] ~~**Path traversal**~~ *(P1)* — audité : tous les accès fichiers passent par `library[id]`, le client ne fournit jamais de chemin.
- [ ] **Limiter taille file watcher** *(P2)* — si l'user ajoute un dossier énorme par erreur, debounce + max items.
- [x] ~~**Logs structurés**~~ *(P2)* — `lib/logger.js` (zero dep, JSON Lines + rotation 5×5MB), wired sur server-module + endpoints `/api/_dev/log-tail` & `log-level`.

## 🧪 Tests & qualité

- [x] ~~**Tests from scratch**~~ *(P1)* — `node:test` runner.
  - [x] Helpers validation (18 tests) + playlists (10 tests).
  - [x] Tests HTTP via supertest sur `/api/{state,tracks,queue,playlists,remote/command,...}`.
  - [x] Test WebSocket (initial state, payload limit).
  - [ ] Tests scanner (parseTrackMetadata avec fixtures audio) — à venir.
- [x] ~~**Linter**~~ *(P1)* — ESLint 9 flat config (Node + browser splits).
- [x] ~~**Formatter**~~ *(P2)* — Prettier `.prettierrc.json`.
- [x] ~~**CI GitHub Actions**~~ *(P1)* — `.github/workflows/ci.yml` matrix Node 20/22, lint + tests, smoke build sur PR.
- [x] ~~**Smoke test du build**~~ *(P2)* — `npm run build:dir` dans le job `smoke-build`.

## 🚀 Release & distribution

- [ ] **Code-signing Windows** *(P1)* — décision en suspens (cf. `docs/RELEASING.md`). Certificat EV ou OV (~80–500 USD/an).
- [x] ~~**CI/CD release auto**~~ *(P1)* — `build.yml` lance test → build → upload sur tag `v*`.
- [~] **macOS build** *(P3)* — config DMG x64+arm64 dans `package.json`, `npm run build:mac`. Notarization Apple reste à wirer si on signe.
- [~] **Linux build** *(P3)* — config AppImage + .deb x64, `npm run build:linux`. CI matrix non-Windows à ajouter quand on voudra ship multi-OS.
- [x] ~~**icon.ico manquant**~~ *(P2)* — généré multi-résolutions (16/32/48/64/128/256), `build.win.icon` pointe dessus.
- [x] ~~**Changelog automatisé**~~ *(P2)* — généré dans le release workflow à partir du git log entre tags.
- [x] ~~**Page release GitHub avec notes formatées**~~ *(P2)* — template avec sections Download / What's new / changelog auto.

## 📚 Documentation

- [ ] **Screenshots/GIFs dans README** *(P1)* — il manque les visuels (logo, player, viz, mobile remote, settings). Texte fait, illustrations à ajouter.
- [x] ~~**Section Architecture dans le README**~~ *(P2)* — diagramme ASCII Electron ↔ server ↔ WS ↔ mobile.
- [x] ~~**Doc des raccourcis clavier**~~ *(P2)* — table dans le README.
- [x] ~~**CONTRIBUTING.md**~~ *(P3)* — guide setup/workflow/release référant CLAUDE.md et docs/.
- [x] ~~**Doc API REST**~~ *(P2)* — `docs/API.md`.
- [x] ~~**CLAUDE.md / agent context**~~ *(P2)* — `CLAUDE.md` à la racine.

## 🎵 Features player (desktop)

- [x] ~~**Crossfade configurable**~~ *(P1)* — implé déjà OK (settings.crossfade + duration). v3.9 : ajout safety `pause` qui restore le volume cible si pause manuelle pendant le ramp.
- [ ] **Gapless playback** *(P2)* — utile pour DJ sets / albums live.
- [x] ~~**Égaliseur : sauvegarder le preset utilisateur**~~ *(P2)* — `_appConfig.eqPreset`, restauré au boot, sauvé à chaque change.
- [ ] **Pitch / speed control** *(P3)* — utile pour DJ.
- [x] ~~**ReplayGain / normalisation volume**~~ *(P2)* — extracteur `track.replayGain` (dB) côté serveur, factor multiplicatif sur audio.volume côté renderer (capé à 1 pour éviter clipping).
- [x] ~~**Sleep timer**~~ *(P3)* — `POST /api/sleep-timer {minutes}` arme un timer côté serveur qui broadcast `pause` après. GET pour status, DELETE pour annuler.
- [x] ~~**Mode "radio"**~~ *(P3)* — `lib/radio.js` scoring (artist+5, genre+3, year±5+1, albumArtist+1) + jitter. Endpoints `GET /api/radio/seed?trackId` et `POST /api/radio/play`.
- [x] ~~**Lyrics auto-fetch**~~ *(P2)* — `GET /api/tracks/:id/lyrics` via `lib/lyrics.js`. Resolution: sidecar .lrc → `userData/lyrics-cache/<id>.{lrc,txt}` → lyrics.ovh public API. Cache automatique des hits online. Memo LRU 500 entrées.
- [x] ~~**Synchro lyrics avec position**~~ *(P2)* — parser LRC dans `lib/lyrics.js` retourne `{lines: [{time, text}]}` quand timestamps présents. UI sync reste à câbler côté renderer.

## 📱 Mobile / remote

- [ ] **Upload de track depuis mobile vers la lib desktop** *(P3)*.
- [ ] **Ajouter à la file depuis mobile — vérifier UX queue management** *(P2)*.
- [ ] **Multi-room / multi-device sync** *(P3)* — plusieurs enceintes en même temps via WS.
- [x] ~~**PWA installable**~~ *(P2)* — `manifest.json`, service worker `sw.js` (cache shell), icons 192/512, theme-color, apple-touch-icon.
- [x] ~~**Media Session API**~~ *(P2)* — métadonnées + handlers play/pause/next/prev poussés à `navigator.mediaSession`, mis à jour via WS state.
- [ ] **Mode "guest"** *(P3)* — un invité peut ajouter des tracks à la queue mais pas tout casser.

## 🎨 UI / UX

- [x] ~~**Drag & drop fichiers/dossiers sur la fenêtre**~~ *(P2)* — drop dossiers (ou fichiers, on remonte au parent) → ajout à `musicFolders` + rescan auto. preload expose `dropPath` via `webUtils.getPathForFile`.
- [ ] **Vue "Year"** *(P3)* — frise chronologique des albums.
- [ ] **Vue "Genres" rich** *(P3)* — pas juste un filtre, une vraie page d'exploration.
- [x] ~~**Recherche : opérateurs**~~ *(P3)* — `lib/query.js` parse `artist:`, `album:`, `genre:`, `title:`, `year:YYYY` ou `year:YYYY..YYYY`, quoted values, multi-valeurs OR. 12 tests. Wired sur `/api/tracks?q=...`.
- [x] ~~**Mode mini-player**~~ *(P2)* — fenêtre Electron + `body.mini` CSS layout compact (cover 56px + info + transport + progress full-width). Toggle via tray menu ou IPC `miniplayer:toggle`.
- [x] ~~**Onboarding première utilisation**~~ *(P2)* — overlay `#onboardingOverlay` révélé au boot si `musicFolders` vide ET library vide. Boutons "Choose music folder" (call `window.resonance.pickFolder` + setConfig + rescan) et "Continue with sample tracks" (seed mock library en dev mode).
- [x] ~~**Drag & drop reorder de la queue**~~ *(P2)* — handlers dragstart/dragover/drop sur `.track-item`, MutationObserver pour rearmer après render, push `/api/queue` après reorder. Mobile reste sur le menu long-press existant.
- [x] ~~**Theme : dark/light/auto**~~ *(P3)* — `html[data-theme="auto|light|dark"]` + `prefers-color-scheme` media query. Variables CSS overridées dans `style.css`. `window.setTheme(mode)` persiste dans `_appConfig.theme`. Re-applique au changement OS quand auto.
- [x] ~~**Animations réduites (prefers-reduced-motion)**~~ *(P2)* — `@media (prefers-reduced-motion: reduce)` désactive transforms/spins/pulses, garde transitions opacity courtes.
- [ ] **A11y : navigation clavier complète + ARIA** *(P2)*.

## 🎧 Visualizers

- [ ] **Sauvegarder le viz favori par track/genre** *(P3)*.
- [ ] **Plus de palettes de couleurs** *(P3)*.
- [ ] **Export d'un visualizer en vidéo** *(P3)* — mode démo.
- [ ] **Mode "ambient"** *(P3)* — viz lent en background quand fenêtre pas focus.

## 📚 Bibliothèque

- [x] ~~**Édition de tags**~~ *(P2)* — `PUT /api/tracks/:id/tags` via `lib/tag-writer.js` (node-id3 dep). MP3 supporté (title/artist/album/albumArtist/year/genre/trackNumber). FLAC/M4A/Vorbis renvoient 501 avec format hint. Library cache mirroré en mémoire après write.
- [x] ~~**Tags multiples par track**~~ *(P2)* — `lib/multitag.js` calcule `track.artists[]` et `track.genres[]` au scan (séparateurs : `,`, `;`, `feat.`, `ft.`, `with`, `vs`, `x`, `/`, `·`, `×`, `|`). String original conservé.
- [x] ~~**Détection des doublons**~~ *(P2)* — `/api/duplicates` et `/api/duplicates/preview` (groupes par titre+artiste+durée arrondie).
- [x] ~~**Statistiques par dossier**~~ *(P3)* — `GET /api/stats/folders` renvoie tracks count par folder + unrooted.
- [x] ~~**Historique pagination**~~ *(P3)* — `/api/history/recent?offset&limit` (limit max 500) + `X-Total-Count`. Cap à 5000 conservé pour la persistance.
- [x] ~~**Export bibliothèque (CSV/JSON)**~~ *(P2)* — `GET /api/library/export.{json,csv}` (RFC 4180 escape pour CSV).
- [x] ~~**Import M3U / M3U8**~~ *(P2)* — `POST /api/playlists/import-m3u`, parser `lib/m3u.js` (BOM, CRLF, EXTINF), résolution par `/api/stream/<id>` puis `(artist,title)` puis basename, tests 9/9.
- [x] ~~**Export playlist M3U**~~ *(P2)* — `GET /api/playlists/:id/export.m3u`.
- [ ] **Last.fm scrobbling** *(P3)*.

## 💾 Données / persistance

- [x] ~~**Migrations de schéma**~~ *(P1)* — `lib/migrations.js` versionne playlists/history/favorites/library-ids. Backup snapshot avant migration. Tests 7/7.
- [x] ~~**Backup auto**~~ *(P2)* — `lib/backup.js` snapshot quotidien `userData/backups/<YYYY-MM-DD>/`, rotation 7j, scheduled au boot.
- [x] ~~**Restore depuis backup**~~ *(P2)* — `POST /api/backups/restore` avec `.before-restore-<stamp>` aside des live files. UI Settings reste à câbler côté renderer.
- [ ] **Sync entre 2 PCs** *(P3)* — option avancée, via dossier partagé / cloud.

## ⚡ Performance

- [x] ~~**Découper `index.html`**~~ *(P1)* — CSS extrait dans `style.css`, JS inline (~2470 lignes) extrait dans `public/js/main.js`. `index.html` à 436 lignes. v3.13 : main.js splitté en 5 modules (base, tracks-queue, playlists-player, viz-settings, runtime).
- [x] ~~**Bundler frontend (esbuild/vite)**~~ *(P2)* — esbuild setup en `scripts/build-frontend.js` (`npm run build:frontend`/`watch:frontend`). Maintenant que main.js est splitté, on peut le wirer dans le build prod (à confirmer après testing).
- [x] ~~**Scan en worker thread**~~ *(P2)* — pool `lib/scanner-pool.js`, opt-in via `config.scanInWorker`.
- [~] **Lazy-load library côté UI** *(P2)* — server prêt + helper `window.gbLazy.loadAll({chunk, onProgress})` dispo côté frontend + warning console au boot si library > 5000. Wiring effectif dans le rendu de la library reste à faire (besoin de virtual scrolling).
- [x] ~~**WebSocket : debounce broadcasts d'état**~~ *(P2)* — fenêtre 80ms, collapse les bursts state/desktop:state/users:changed.
- [x] ~~**Cache HTTP côté covers/streams**~~ *(P2)* — ETag `W/"<size>-<mtime>"` + `Cache-Control: private, max-age=3600` sur `/api/stream`, support 304 sur `If-None-Match`.

## 🔧 Dev experience

- [x] ~~**Hot reload du renderer en dev**~~ *(P2)* — `fs.watch` sur `public/`, reload sur change quand `--dev`.
- [x] ~~**`npm run dev` qui ouvre devtools auto**~~ *(P2)* — devtools detached quand `--dev`.
- [x] ~~**Script `npm run scan`**~~ *(P3)* — `scripts/scan.js`, lit DEV_DATA_DIR ou ./dev-data, run rescan, log stats temps + ms/track. `GB_USE_WORKER=1` pour activer le pool.
- [x] ~~**Mock library pour dev sans fichiers**~~ *(P3)* — `lib/mock-library.js` + endpoints `/api/_dev/library/{seed,clear}` + `npm run dev:server` qui boot tout en mode mock.
- [x] ~~**`engines` dans package.json**~~ *(P2)* — Node ≥ 18.
- [x] ~~**Mettre à jour les deps**~~ *(P1)* — Electron 28 → 31, ajout devDeps eslint/prettier/supertest.

## 🔮 Idées long terme

- [ ] **Plugin system** *(P3)* — visualizers, sources externes (YouTube, SoundCloud) en plugins.
- [ ] **Intégration Home Assistant** *(P3)* — exposer une API/MQTT.
- [ ] **AirPlay / Chromecast / DLNA output** *(P3)*.
- [ ] **Mode "party"** *(P3)* — file collaborative, vote pour skip, anti-spam.
- [ ] **Reconnaissance automatique de morceau (Shazam-like)** *(P3)*.

---

## ✅ Done (récents — référence)

- [x] **v3.13.0** — onboarding overlay, theme dark/light/auto, lazy-load helper `window.gbLazy`, frontend JS splitté en 5 modules.
- [x] **v3.12.0** — query operators (`artist:`, `genre:`, `year:Y..Y`), history pagination, `npm run scan` headless.
- [x] **v3.11.0** — radio mode (scoring artist/genre/year), sleep timer (server-side), mac/linux build config, CONTRIBUTING.md.
- [x] **v3.10.0** — édition de tags (node-id3, MP3), lyrics fetch (lyrics.ovh + cache), logs main.js, tags multi-valeurs (`track.artists[]`, `track.genres[]`).
- [x] **v3.9.0** — migrations JSON versionnées, backup auto + restore, export CSV/JSON, import M3U, ETag stream, drag&drop fichiers + reorder queue, mini-player layout, ReplayGain, EQ persist, prefers-reduced-motion.
- [x] **v3.8.0** — logger structuré (zero dep), endpoints `/api/_dev/*`, mock library, `npm run dev:server`, esbuild setup, JS extrait dans `public/js/main.js`.
- [x] **v3.7.0** — Phase 1→6 sweep : bugs P0/P1, helpers `lib/`, tests `node:test`, ESLint 9, Prettier, CI GitHub Actions, icon.ico, changelog auto, chokidar, cover incrémental, scanner pool opt-in, WS debounce, CSS extrait, README/CLAUDE.md/API doc, devtools+hot-reload `--dev`, PWA, Media Session, mini-player, duplicates API, M3U export.
- [x] **v3.6.0** — IDs de tracks stables entre rescans (map persistée dans `library-ids.json`)
- [x] **v3.6.0** — Auth token LAN (génération auto, QR-code embarque le token, middleware `/api/*` + WS, bypass localhost)
- [x] Visualizer refactor (Shape × Color), starfield revamp
- [x] Mobile queue : scroll auto vers la track courante au next/prev
- [x] French Rap genre color (bleu France)
- [x] Stats panel : empty history sans NaN
- [x] About modal : lien GitHub cliquable, version, server popover
- [x] v3.5.7 : fix update retry loop
- [x] v3.5.6 : server popover, album/artist back nav, toolbar separators, playlist search
- [x] Splash glassmorphism + Text viz
- [x] Cover Drift viz, Lyrics rework, remote shuffle fix
- [x] Auto-update : confirmation utilisateur avant download
