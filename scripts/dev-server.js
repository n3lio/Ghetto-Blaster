#!/usr/bin/env node
// Standalone server runner — boots Express + ws without Electron, in dev
// mode, with a pre-seeded mock library so the API is immediately usable
// from curl/Postman/browser.
//
// Usage:
//   npm run dev:server                  # default (port 3001, 200 mock tracks)
//   PORT=3010 npm run dev:server        # custom port
//   MOCK=0 npm run dev:server           # don't seed (empty library)
//   MOCK=500 npm run dev:server         # seed N tracks
//
// Logs go to ./dev-data/logs/server.log (JSON lines) AND stderr (pretty).
// Data files (config, playlists, history, library-ids) live in ./dev-data
// so they don't pollute the real userData dir.

const fs = require('node:fs');
const path = require('node:path');
const server = require('../server-module');
const { buildMockLibrary, buildMockGenres } = require('../lib/mock-library');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DEV_DATA_DIR || path.join(ROOT, 'dev-data');
const PORT = parseInt(process.env.PORT, 10) || 3001;
const MOCK_COUNT = process.env.MOCK !== undefined ? parseInt(process.env.MOCK, 10) : 200;

fs.mkdirSync(DATA_DIR, { recursive: true });

// Seed a dev config so the dev mode + verbose logs kick in from the first
// startServer() call. We only write it on first run; subsequent runs reuse
// whatever the user tweaked.
const cfgPath = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(cfgPath)) {
  fs.writeFileSync(cfgPath, JSON.stringify({
    musicFolders: [],
    excludeFolders: [],
    port: PORT,
    scanOnStartup: false,
    watchForChanges: false,
    devMode: true,
    logLevel: 'debug',
  }, null, 2));
}

server.setDataDir(DATA_DIR);

(async () => {
  const result = await server.startServer(PORT);
  const cfg = server.getConfig();
  console.log(`\n  → http://localhost:${result.port} (dev)`);
  console.log(`  → token: ${cfg.authToken} (use ?t=${cfg.authToken} from non-localhost)`);
  console.log(`  → data: ${DATA_DIR}`);
  console.log(`  → logs: ${path.join(DATA_DIR, 'logs', 'server.log')}\n`);

  if (Number.isInteger(MOCK_COUNT) && MOCK_COUNT > 0) {
    // Use the dev-only seed endpoint so the server logs the action and
    // broadcasts library-updated to any connected WS clients. We hit it
    // through Node's built-in http to avoid pulling in fetch polyfills.
    const http = require('node:http');
    const body = JSON.stringify({ count: MOCK_COUNT });
    const req = http.request({
      method: 'POST',
      host: '127.0.0.1',
      port: result.port,
      path: '/api/_dev/library/seed',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          console.log(`  → mock library: ${parsed.count} tracks, ${parsed.genres} genres\n`);
        } catch (e) { /* ignore */ }
      });
    });
    req.on('error', () => { /* ignore */ });
    req.write(body);
    req.end();
  }
})();

// Ctrl-C / SIGTERM: stop cleanly so the JSON files aren't left half-written.
function shutdown() {
  console.log('\n  shutting down...');
  server.stopServer().then(() => process.exit(0)).catch(() => process.exit(1));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
