# Changelog

## v3.18 (June 2026)

**v3.18.3**: Cross-device preferences sync — theme, accent hue, volume normalization, gapless, visualization all sync across desktop and mobile clients in real-time.

**v3.18.2**: Time-based stats visualizations — new graphical dashboard showing daily play frequency (timeline) and hourly heatmap. Stats tab becomes visual and interactive.

**v3.18.0**: Queue header alignment — visual consistency with Library and Playlists toolbars for a unified header design across tabs.

## v3.17 (May 2026)

Major UI polish sweep: tooltips on all buttons, volume indicator fill, tab playing indicator, queue checkmarks for current track, mini-player refactor with dedicated page (cover-first layout, synced state, draggable), menu restructure (Visualization/App/Mini-player sections), settings modal reorganized into 6 logical sections, light-mode coverage for all UI elements (modales, player bar, visualizers, menus), icon crop optimization for tray, window drag fix, independent track-info/radio toggles. QR code rendering hardened with fallback. Roughly 25 point releases stabilizing the 3.17 era.

## v3.16 (April 2026)

Library cache optimization + icon improvements — incremental scan speedup by detecting unchanged folders, app icon cropped to actual bounding box (bigger in tray), clickable artist/album in Now Playing info (filters library), mobile Years timeline touch drag, window title bar drag re-enabled, desktop renderer stays offline while mobile auth uses token.

## v3.15 (March 2026)

Major feature expansion: Years view with brushable timeline, Genres clustered by color (Latin, Jazz, etc.), search operators (artist:, genre:, year:), Mixing tab with EQ presets and pitch/speed control, gapless playback, visualizer palettes + ambient mode, volume normalization (ReplayGain), light/dark/auto theme system, lazy-load library UI with virtual scroll, full a11y pass (ARIA labels, keyboard nav), sleep timer, history pagination (capped at 5000), parallel metadata scanning (~3-4x faster on large libraries). Includes lrclib lyrics auto-fetch, guest mode, Settings reorganization, smart playlists with genre exclusions, backup/restore endpoints.

## v3.14 (February 2026)

Guest mode for sharing without credentials — visitors can browse and listen without auth token. Settings extras: custom folders, Devices info panel, indicator badges. Visualizer cover color extraction + Glow smoothing. lrclib integration for lyrics. Development: dropped node-id3 tag-writer (user feedback — limit scope).

## v3.13 (January 2026)

Theme system overhaul: light/dark/auto modes with system preference detection. Onboarding panel when library is empty (helps first-time users add music folders). Frontend JS module split from monolithic index.html. CI fixes: enable linting, remove ghost workflow spam, ESLint auto-ignore legacy renderer.

## v3.12 (December 2025)

Query operators in /api/tracks search: artist:, genre:, year: for power users. History pagination + configurable cap. New npm run scan for headless library scanning (useful for automation).

## v3.11 (November 2025)

Radio mode: auto-queue similar tracks (avoid repetition). Sleep timer with custom duration. macOS and Linux build support (electron-builder targets added). CONTRIBUTING.md + developer docs.

## v3.10 (October 2025)

Tag editing: endpoint to modify ID3 tags on tracks. Multi-tag support per track. Lyrics auto-fetch from lyrics.ovh. Electron logs structured (move from console to file in userData/).

## v3.9 (September 2025)

Data safety: auto-backup system + restore endpoint. Library export (JSON) + M3U import. HTTP stream caching. Per-folder stats. A11y pass: semantic HTML, keyboard nav, reduced motion.

## v3.8 (August 2025)

Structured logging (pino): server logs go to file with levels (debug, info, warn, error). Dev tooling: npm run dev:server (headless Express for quick iteration). Frontend JS split from index.html into modules. esbuild bundler setup. CI: GitHub Actions build for Windows.

## v3.7 (July 2025)

Initial Electron refactor and npm package release. Single-instance lock, tray icon, auto-updater. Express + WebSocket server. Public SPA served from Express. Initial test suite (node:test).

## v3.15 early versions (March–May 2026)

Bugfixes and polish: library filter var shadowing, scan indicator at boot, update badge race conditions, visualizer glow/circular gradient fixes, Settings icon crop, QR code verbose errors, import config from cache when folders empty, independent toggle states, trackinfo rendering, menu positioning.
