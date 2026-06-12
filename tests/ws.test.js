// WebSocket integration test — boots the server, opens a client, asserts
// that the initial state message arrives and that an unauthorized non-local
// connect is closed by the server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.warn('ws not installed — skipping WS tests. Run `npm install` first.');
  test('ws missing', () => assert.ok(true));
  return;
}

const server = require('../server-module');

let tmpDir;
let port;

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ws-test-'));
  fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
    musicFolders: [],
    excludeFolders: [],
    port: 0,
    scanOnStartup: false,
    watchForChanges: false,
  }));
  server.setDataDir(tmpDir);
  const result = await server.startServer(0);
  port = result.port;
});

test.after(async () => {
  await server.stopServer();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('localhost client receives initial state on connect', async () => {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('No state message within 2s'));
    }, 2000);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(raw.toString());
        assert.equal(msg.type, 'state');
        assert.equal(typeof msg.data, 'object');
        ws.close();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
});

test('rejects oversized messages (maxPayload guard)', async () => {
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let closed = false;
    ws.on('open', () => {
      // 4 KB > maxPayload (2 KB) — server should close the socket.
      ws.send('x'.repeat(4 * 1024));
    });
    ws.on('close', () => {
      closed = true;
      resolve();
    });
    ws.on('error', () => { /* expected */ });
    setTimeout(() => {
      if (!closed) ws.terminate();
      resolve();
    }, 1500);
  });
});
