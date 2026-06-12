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
- [ ] **Logs structurés** *(P2)* — remplacer `console.log` par un logger (pino/winston) avec niveaux et fichier rotatif.

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
- [ ] **macOS build** *(P3)* — `electron-builder --mac` (DMG, signature/notarization Apple).
- [ ] **Linux build** *(P3)* — AppImage + .deb.
- [x] ~~**icon.ico manquant**~~ *(P2)* — généré multi-résolutions (16/32/48/64/128/256), `build.win.icon` pointe dessus.
- [x] ~~**Changelog automatisé**~~ *(P2)* — généré dans le release workflow à partir du git log entre tags.
- [x] ~~**Page release GitHub avec notes formatées**~~ *(P2)* — template avec sections Download / What's new / changelog auto.

## 📚 Documentation

- [ ] **Screenshots/GIFs dans README** *(P1)* — il manque les visuels (logo, player, viz, mobile remote, settings). Texte fait, illustrations à ajouter.
- [x] ~~**Section Architecture dans le README**~~ *(P2)* — diagramme ASCII Electron ↔ server ↔ WS ↔ mobile.
- [x] ~~**Doc des raccourcis clavier**~~ *(P2)* — table dans le README.
- [ ] **CONTRIBUTING.md** *(P3)* — au cas où.
- [x] ~~**Doc API REST**~~ *(P2)* — `docs/API.md`.
- [x] ~~**CLAUDE.md / agent context**~~ *(P2)* — `CLAUDE.md` à la racine.

## 🎵 Features player (desktop)

- [ ] **Crossfade configurable** *(P1)* — vérifier l'implémentation actuelle, polish.
- [ ] **Gapless playback** *(P2)* — utile pour DJ sets / albums live.
- [ ] **Égaliseur : sauvegarder le preset utilisateur** *(P2)* — vérifier que ça persiste au redémarrage.
- [ ] **Pitch / speed control** *(P3)* — utile pour DJ.
- [ ] **ReplayGain / normalisation volume** *(P2)* — éviter les sauts entre pistes. Côté renderer : Web Audio gain dynamique basé sur les tags ReplayGain extraits par music-metadata.
- [ ] **Sleep timer** *(P3)*.
- [ ] **Mode "radio"** *(P3)* — auto-queue similaire à la track en cours (genre, artiste).
- [ ] **Lyrics auto-fetch** *(P2)* — vérifier l'état actuel ; si LRC pas disponible, fallback vers une API.
- [ ] **Synchro lyrics avec position** *(P2)*.

## 📱 Mobile / remote

- [ ] **Upload de track depuis mobile vers la lib desktop** *(P3)*.
- [ ] **Ajouter à la file depuis mobile — vérifier UX queue management** *(P2)*.
- [ ] **Multi-room / multi-device sync** *(P3)* — plusieurs enceintes en même temps via WS.
- [x] ~~**PWA installable**~~ *(P2)* — `manifest.json`, service worker `sw.js` (cache shell), icons 192/512, theme-color, apple-touch-icon.
- [x] ~~**Media Session API**~~ *(P2)* — métadonnées + handlers play/pause/next/prev poussés à `navigator.mediaSession`, mis à jour via WS state.
- [ ] **Mode "guest"** *(P3)* — un invité peut ajouter des tracks à la queue mais pas tout casser.

## 🎨 UI / UX

- [ ] **Drag & drop fichiers/dossiers sur la fenêtre** *(P2)* — pour ajouter à la queue ou à une playlist.
- [ ] **Vue "Year"** *(P3)* — frise chronologique des albums.
- [ ] **Vue "Genres" rich** *(P3)* — pas juste un filtre, une vraie page d'exploration.
- [ ] **Recherche : opérateurs** *(P3)* — `artist:NTM`, `genre:rap`, `year:2010..2015`.
- [~] **Mode mini-player** *(P2)* — fenêtre Electron compacte always-on-top branchée (tray menu + IPC `miniplayer:toggle`). Layout compact côté renderer (`?mini=1`) reste à designer.
- [ ] **Onboarding première utilisation** *(P2)* — petit tour guidé après install.
- [ ] **Drag & drop reorder de la queue** *(P2)* — vérifier si déjà OK partout (desktop + mobile).
- [ ] **Theme : dark/light/auto** *(P3)* — actuellement dark only ; ajouter light theme.
- [ ] **Animations réduites (prefers-reduced-motion)** *(P2)*.
- [ ] **A11y : navigation clavier complète + ARIA** *(P2)*.

## 🎧 Visualizers

- [ ] **Sauvegarder le viz favori par track/genre** *(P3)*.
- [ ] **Plus de palettes de couleurs** *(P3)*.
- [ ] **Export d'un visualizer en vidéo** *(P3)* — mode démo.
- [ ] **Mode "ambient"** *(P3)* — viz lent en background quand fenêtre pas focus.

## 📚 Bibliothèque

- [~] **Édition de tags** *(P2)* — endpoint `PUT /api/tracks/:id/tags` stub (501) en place. Reste à brancher une lib write-back (`node-id3` pour MP3, format-spécifique pour FLAC).
- [ ] **Tags multiples par track** *(P2)* — déjà partiellement (split multi-artist).
- [x] ~~**Détection des doublons**~~ *(P2)* — `/api/duplicates` et `/api/duplicates/preview` (groupes par titre+artiste+durée arrondie).
- [ ] **Statistiques par dossier** *(P3)*.
- [ ] **Historique illimité avec pagination** *(P3)* — actuellement cap à 5000.
- [ ] **Export bibliothèque (CSV/JSON)** *(P2)* — utile pour backup/migration.
- [ ] **Import M3U / M3U8** *(P2)*.
- [x] ~~**Export playlist M3U**~~ *(P2)* — `GET /api/playlists/:id/export.m3u`.
- [ ] **Last.fm scrobbling** *(P3)*.

## 💾 Données / persistance

- [ ] **Migrations de schéma** *(P1)* — quand tu changes le format de `playlists.json` / `history.json`, prévoir un mécanisme.
- [ ] **Backup auto** *(P2)* — copie quotidienne des JSON dans `userData/backups/` (rotation 7 jours).
- [ ] **Restore depuis backup** *(P2)* — UI dans Settings.
- [ ] **Sync entre 2 PCs** *(P3)* — option avancée, via dossier partagé / cloud.

## ⚡ Performance

- [~] **Découper `index.html`** *(P1)* — partial : CSS extrait dans `public/style.css` (3583 → 2841 lignes). Le JS inline reste à éclater en modules.
- [ ] **Bundler frontend (esbuild/vite)** *(P2)* — minifier, tree-shake. À faire après le split JS.
- [x] ~~**Scan en worker thread**~~ *(P2)* — pool `lib/scanner-pool.js`, opt-in via `config.scanInWorker`.
- [ ] **Lazy-load library côté UI** *(P2)* — si > 10k tracks, ne pas tout envoyer d'un coup.
- [x] ~~**WebSocket : debounce broadcasts d'état**~~ *(P2)* — fenêtre 80ms, collapse les bursts state/desktop:state/users:changed.
- [ ] **Cache HTTP côté covers/streams** *(P2)* — déjà partiel (Cache-Control 7j sur covers), à propager.

## 🔧 Dev experience

- [x] ~~**Hot reload du renderer en dev**~~ *(P2)* — `fs.watch` sur `public/`, reload sur change quand `--dev`.
- [x] ~~**`npm run dev` qui ouvre devtools auto**~~ *(P2)* — devtools detached quand `--dev`.
- [ ] **Script `npm run scan`** *(P3)* — scan headless pour debug.
- [ ] **Mock library pour dev sans fichiers** *(P3)*.
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

- [x] **v3.7 in progress** — Phase 1→6 sweep : bugs P0/P1, helpers `lib/`, tests `node:test`, ESLint 9, Prettier, CI GitHub Actions, icon.ico, changelog auto, chokidar, cover incrémental, scanner pool opt-in, WS debounce, CSS extrait, README/CLAUDE.md/API doc, devtools+hot-reload `--dev`, PWA, Media Session, mini-player, duplicates API, M3U export.
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
