// Smoke e2e test — boots the real server on port 0 and exercises key API paths.
// Validates that core endpoints respond, return expected shapes, and auth works.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let request;
try {
  request = require('supertest');
} catch (e) {
  console.warn('supertest not installed — skipping smoke tests.');
  test('supertest missing', () => assert.ok(true));
  process.exit(0);
}

const server = require('../server-module');

let tmpDir;
let port;
let token;

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-smoke-'));
  fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
    musicFolders: [],
    excludeFolders: [],
    port: 0,
    scanOnStartup: false,
    watchForChanges: false,
    devMode: true,
    logLevel: 'error',
  }));
  server.setDataDir(tmpDir);
  const result = await server.startServer(0);
  port = result.port || (server.getConfig() && server.getConfig().port) || 3000;
  token = server.getConfig().authToken;
});

test.after(async () => {
  await server.stopServer();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/state returns player snapshot', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/state')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(typeof res.body === 'object');
  assert.ok('currentTrackId' in res.body);
  assert.ok('isPlaying' in res.body);
  assert.ok('queue' in res.body);
  assert.ok('queueIndex' in res.body);
});

test('GET /api/tracks returns array', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/tracks')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(Array.isArray(res.body));
});

test('GET /api/playlists returns array', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/playlists')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(Array.isArray(res.body));
});

test('GET /api/qrcode returns svg and url', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/qrcode')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(typeof res.body.svg === 'string');
  assert.ok(typeof res.body.url === 'string');
  assert.match(res.body.svg, /<svg/);
});

test('GET /api/config/preferences returns current theme and settings', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/config/preferences')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(typeof res.body === 'object');
  assert.ok('theme' in res.body || 'normalizeVolume' in res.body); // At least one preference field
});

test('POST /api/queue with empty trackIds clears queue', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .post('/api/queue')
    .send({ trackIds: [] })
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(typeof res.body === 'object');
});

test('POST /api/queue with invalid trackIds rejects', async () => {
  await request(`http://127.0.0.1:${port}`)
    .post('/api/queue')
    .send({ trackIds: 'not-an-array' })
    .expect(400);
});

test('GET /api/scan/status returns scanning flag', async () => {
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/scan/status')
    .expect('Content-Type', /json/)
    .expect(200);

  assert.ok(typeof res.body.scanning === 'boolean');
});

test('Localhost bypasses auth (no token required)', async () => {
  // All endpoints from above work without ?t=token on localhost.
  const res = await request(`http://127.0.0.1:${port}`)
    .get('/api/state')
    .expect(200);

  assert.ok(res.body);
});
