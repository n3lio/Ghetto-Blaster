#!/usr/bin/env node
// Headless scan runner. Boots just enough of the server module to load the
// config, run scanFolders() once, print a summary, and exit. Useful for:
//   - debugging slow scans without launching Electron
//   - benchmarking the worker pool against the inline parser
//   - sanity-checking a fresh musicFolders list before booting the GUI
//
// Usage:
//   npm run scan
//   DEV_DATA_DIR=~/Library/Application\ Support/ghetto-blaster npm run scan
//   GB_USE_WORKER=1 npm run scan

const fs = require('node:fs');
const path = require('node:path');
const server = require('../server-module');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DEV_DATA_DIR || path.join(ROOT, 'dev-data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cfgPath = path.join(DATA_DIR, 'config.json');
let cfg = {};
if (fs.existsSync(cfgPath)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { /* ignore */ }
}
if (!Array.isArray(cfg.musicFolders) || cfg.musicFolders.length === 0) {
  console.error('No musicFolders configured at:', cfgPath);
  console.error('Edit it and rerun, e.g. {"musicFolders":["/Users/me/Music"]}.');
  process.exit(2);
}
if (process.env.GB_USE_WORKER === '1') cfg.scanInWorker = true;
cfg.scanOnStartup = false;
cfg.watchForChanges = false;
cfg.devMode = true;
cfg.logLevel = 'info';
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

server.setDataDir(DATA_DIR);

(async () => {
  // Use port 0 so we don't collide with a running app — we won't actually
  // hit the HTTP surface from this script, but the server-module entry
  // point is startServer() so we go through it.
  const result = await server.startServer(0);
  console.log(`Server up at http://127.0.0.1:${result.port} (dev only).`);

  const startedAt = Date.now();
  const lib = await new Promise((resolve, reject) => {
    // We don't have a direct scanFolders() export — trigger via /api/rescan.
    const http = require('node:http');
    const req = http.request({
      method: 'POST',
      host: '127.0.0.1',
      port: result.port,
      path: '/api/rescan',
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  const ms = Date.now() - startedAt;
  console.log(`\nScan summary:`);
  console.log(`  tracks:    ${lib.count}`);
  console.log(`  duration:  ${ms} ms (${(ms / Math.max(1, lib.count)).toFixed(2)} ms/track)`);
  console.log(`  worker:    ${cfg.scanInWorker ? 'yes' : 'no'}`);

  await server.stopServer();
  process.exit(0);
})().catch((err) => {
  console.error('Scan failed:', err.message);
  process.exit(1);
});
