# Ghetto Blaster — TODO global

> Backlog complète. Le format est : `[ ] item — *(priorité)*` avec une note quand utile.
> Priorités : **P0** = bloquant / sécurité, **P1** = important, **P2** = nice-to-have, **P3** = futur lointain.

---

## 🔥 Bugs / risques connus

- [x] ~~**IDs de tracks non stables entre rescans**~~ *(P0)* — fait en v3.6.0 : map `path → id` persistée dans `library-ids.json`, pruning des paths supprimés.
- [x] ~~**Aucune authentification sur le LAN**~~ *(P0)* — fait en v3.6.0 : token 16 octets généré au boot, embarqué dans le QR-code, vérifié sur `/api/*` et upgrade WS, bypass localhost.
- [ ] **`fs.watch` recursive sur Windows** *(P1)* — peu fiable, rate des events, déclenche des cascades. Évaluer `chokidar` ou un rescan périodique en complément.
- [ ] **Cover cache vidé puis reconstruit à chaque rescan** *(P1)* — lent et inutile sur grosse lib. Diff incrémental : ne (re)régénérer que les couvertures de tracks nouvelles/modifiées.
- [ ] **Express 4 → app.get('\*') deprecation** *(P1)* — bloquera la migration Express 5 (`path-to-regexp` v6). À adapter.
- [ ] **`MAX_CONNECTIONS = 20` en dur** *(P2)* — exposer en config.
- [ ] **Pas de fallback couverture** *(P2)* — `/api/cover/:id` renvoie 404 si pas de cover ; vérifier que l'UI gère partout (placeholder).
- [ ] **`config.port` ignoré au boot Electron** *(P2)* — `main.js` appelle `startServer(3000)` en dur.
- [ ] **Helmet CSP désactivé** *(P2)* — réactiver une CSP minimale, le mobile + desktop sont des contextes connus.
- [ ] **Pas de cleanup `userCounter` / `uniqueIps`** *(P3)* — fuite mémoire mineure sur uptime très long.

## 🔒 Sécurité & robustesse

- [ ] **PIN/token d'accès** *(P0)* — voir bug ci-dessus, le bundle.
- [ ] **Rate-limit sur `/api/remote/command`** *(P1)* — un client malicieux peut spammer.
- [ ] **Validation stricte des body JSON** *(P1)* — passer à `zod` ou un check manuel partout (currentement `Array.isArray` & co, OK mais incomplet).
- [ ] **Limiter taille file watcher** *(P2)* — si l'user ajoute un dossier énorme par erreur, debounce + max items.
- [ ] **Path traversal** *(P1)* — vérifier que `track.path` ne peut jamais être déterminé par le client (actuellement OK : on map par ID, mais auditer).
- [ ] **Logs structurés** *(P2)* — remplacer `console.log` par un logger (pino/winston) avec niveaux et fichier rotatif.

## 🧪 Tests & qualité

- [ ] **Aucun test n'existe — partir from scratch** *(P1)*
  - [ ] Tests unitaires pour le scanner (`scanFolders`, gestion des tags, exclusions)
  - [ ] Tests unitaires playlists (smart vs manual, resolve, reorder)
  - [ ] Tests d'intégration HTTP (supertest) sur `/api/tracks`, `/api/queue`, `/api/playlists`
  - [ ] Test du flux WebSocket
- [ ] **Linter** *(P1)* — ajouter ESLint + config (recommended + n/security).
- [ ] **Formatter** *(P2)* — Prettier.
- [ ] **CI GitHub Actions** *(P1)* — lint + tests à chaque PR.
- [ ] **Smoke test du build** *(P2)* — sur tag, vérifier que le `.exe` se génère et que `main.js` boot dans Electron headless.

## 🚀 Release & distribution

- [ ] **Code-signing Windows** *(P1)* — supprimerait le SmartScreen "Unknown publisher". Certificat EV ou OV.
- [ ] **CI/CD release auto** *(P1)* — sur tag `v*`, GitHub Actions build et publie l'asset (electron-builder a déjà la config publish GitHub).
- [ ] **macOS build** *(P3)* — `electron-builder --mac` (DMG, signature/notarization Apple).
- [ ] **Linux build** *(P3)* — AppImage + .deb.
- [ ] **icon.ico manquant ?** *(P2)* — `build.win.icon` pointe sur `assets/icon.png` ; Windows préfère un `.ico` multi-résolutions.
- [ ] **Changelog automatisé** *(P2)* — `conventional-changelog` ou release-please.
- [ ] **Page release GitHub avec notes formatées** *(P2)* — template release.

## 📚 Documentation

- [ ] **README avec screenshots/GIFs** *(P1)* — déjà dans backlog. Logo, player, visualizer, mobile remote, settings.
- [ ] **Section "Architecture" dans le README** *(P2)* — rapide diagramme : Electron ↔ server local ↔ WS ↔ mobile.
- [ ] **Doc des raccourcis clavier** *(P2)* — déjà dans Settings, dupliquer dans README.
- [ ] **CONTRIBUTING.md** *(P3)* — au cas où.
- [ ] **Doc API REST** *(P3)* — utile si quelqu'un veut faire un client tiers (Home Assistant, etc.).
- [ ] **CLAUDE.md / agent context** *(P2)* — documenter conventions du repo pour assistants IA.

## 🎵 Features player (desktop)

- [ ] **Crossfade configurable** *(P1)* — vérifier l'implémentation actuelle, polish.
- [ ] **Gapless playback** *(P2)* — utile pour DJ sets / albums live.
- [ ] **Égaliseur : sauvegarder le preset utilisateur** *(P2)* — vérifier que ça persiste au redémarrage.
- [ ] **Pitch / speed control** *(P3)* — utile pour DJ.
- [ ] **ReplayGain / normalisation volume** *(P2)* — éviter les sauts entre pistes.
- [ ] **Sleep timer** *(P3)*.
- [ ] **Mode "radio"** *(P3)* — auto-queue similaire à la track en cours (genre, artiste).
- [ ] **Lyrics auto-fetch** *(P2)* — vérifier l'état actuel ; si LRC pas disponible, fallback vers une API.
- [ ] **Synchro lyrics avec position** *(P2)*.

## 📱 Mobile / remote

- [ ] **Upload de track depuis mobile vers la lib desktop** *(P3)*.
- [ ] **Ajouter à la file depuis mobile (déjà fait ?) — vérifier UX queue management** *(P2)*.
- [ ] **Multi-room / multi-device sync** *(P3)* — plusieurs enceintes en même temps via WS.
- [ ] **PWA installable depuis mobile** *(P2)* — manifest + service worker offline cache du shell.
- [ ] **Notif media controls iOS/Android** *(P2)* — Media Session API (vérifier si déjà branché).
- [ ] **Mode "guest"** *(P3)* — un invité peut ajouter des tracks à la queue mais pas tout casser.

## 🎨 UI / UX

- [ ] **Drag & drop fichiers/dossiers sur la fenêtre** *(P2)* — pour ajouter à la queue ou à une playlist.
- [ ] **Vue "Year"** *(P3)* — frise chronologique des albums.
- [ ] **Vue "Genres" rich** *(P3)* — pas juste un filtre, une vraie page d'exploration.
- [ ] **Recherche : opérateurs** *(P3)* — `artist:NTM`, `genre:rap`, `year:2010..2015`.
- [ ] **Mode mini-player** *(P2)* — fenêtre Electron compacte toujours-au-dessus.
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

- [ ] **Édition de tags** *(P2)* — corriger un titre/artiste/genre depuis l'app (write back ID3).
- [ ] **Tags multiples par track** *(P2)* — déjà partiellement (split multi-artist).
- [ ] **Détection des doublons** *(P2)* — par hash audio ou par (titre, artiste, durée).
- [ ] **Statistiques par dossier** *(P3)*.
- [ ] **Historique illimité avec pagination** *(P3)* — actuellement cap à 5000.
- [ ] **Export bibliothèque (CSV/JSON)** *(P2)* — utile pour backup/migration.
- [ ] **Import M3U / M3U8** *(P2)*.
- [ ] **Export playlist M3U** *(P2)*.
- [ ] **Last.fm scrobbling** *(P3)*.

## 💾 Données / persistance

- [ ] **Migrations de schéma** *(P1)* — quand tu changes le format de `playlists.json` / `history.json`, prévoir un mécanisme.
- [ ] **Backup auto** *(P2)* — copie quotidienne des JSON dans `userData/backups/` (rotation 7 jours).
- [ ] **Restore depuis backup** *(P2)* — UI dans Settings.
- [ ] **Sync entre 2 PCs** *(P3)* — option avancée, via dossier partagé / cloud.

## ⚡ Performance

- [ ] **Découper `index.html` (3537 lignes)** *(P1)* — modules JS séparés, feuille CSS dédiée, faciliter maintenance.
- [ ] **Bundler frontend (esbuild/vite)** *(P2)* — minifier, tree-shake.
- [ ] **Scan en worker thread** *(P2)* — sortir `parseFile` du thread principal pour pas freezer le serveur.
- [ ] **Lazy-load library côté UI** *(P2)* — si > 10k tracks, ne pas tout envoyer d'un coup.
- [ ] **WebSocket : debounce broadcasts d'état** *(P2)* — éviter les rafales pendant scan.
- [ ] **Cache HTTP côté covers/streams** *(P2)* — déjà partiel (Cache-Control 7j sur covers), à propager.

## 🔧 Dev experience

- [ ] **Hot reload du renderer en dev** *(P2)*.
- [ ] **`npm run dev` qui ouvre devtools auto** *(P2)*.
- [ ] **Script `npm run scan`** *(P3)* — scan headless pour debug.
- [ ] **Mock library pour dev sans fichiers** *(P3)*.
- [ ] **`engines` dans package.json** *(P2)* — préciser la version Node minimum.
- [ ] **Mettre à jour les deps** *(P1)* — Electron 28 → 31+, security patches.

## 🔮 Idées long terme

- [ ] **Plugin system** *(P3)* — visualizers, sources externes (YouTube, SoundCloud) en plugins.
- [ ] **Intégration Home Assistant** *(P3)* — exposer une API/MQTT.
- [ ] **AirPlay / Chromecast / DLNA output** *(P3)*.
- [ ] **Mode "party"** *(P3)* — file collaborative, vote pour skip, anti-spam.
- [ ] **Reconnaissance automatique de morceau (Shazam-like)** *(P3)*.

---

## ✅ Done (récents — référence)

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
