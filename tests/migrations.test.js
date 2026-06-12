const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateAll, migrateFile, readVersion, unwrap, LATEST } = require('../lib/migrations');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gb-mig-'));
}

test('migrateFile: missing file is a no-op', () => {
  const d = tmpdir();
  const r = migrateFile(d, 'playlists.json');
  assert.deepEqual(r, { ok: true, migrated: false });
  fs.rmSync(d, { recursive: true, force: true });
});

test('migrateFile: legacy bare array → v1 wrapped object', () => {
  const d = tmpdir();
  const legacy = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  fs.writeFileSync(path.join(d, 'playlists.json'), JSON.stringify(legacy));
  const r = migrateFile(d, 'playlists.json');
  assert.equal(r.ok, true);
  assert.equal(r.migrated, true);
  assert.equal(r.from, 0);
  assert.equal(r.to, LATEST['playlists.json']);
  const after = JSON.parse(fs.readFileSync(path.join(d, 'playlists.json'), 'utf8'));
  assert.equal(after._version, 1);
  assert.deepEqual(after.items, legacy);
  // Backup created.
  const backups = fs.readdirSync(path.join(d, 'migrations-backup'));
  assert.equal(backups.length, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

test('migrateFile: already at latest version is a no-op', () => {
  const d = tmpdir();
  const versioned = { _version: 1, items: [{ id: 'x' }] };
  fs.writeFileSync(path.join(d, 'playlists.json'), JSON.stringify(versioned));
  const r = migrateFile(d, 'playlists.json');
  assert.equal(r.migrated, false);
  fs.rmSync(d, { recursive: true, force: true });
});

test('migrateFile: corrupt JSON returns error and does not touch the file', () => {
  const d = tmpdir();
  const filePath = path.join(d, 'playlists.json');
  fs.writeFileSync(filePath, 'not json {{{');
  const before = fs.readFileSync(filePath, 'utf8');
  const r = migrateFile(d, 'playlists.json');
  assert.equal(r.ok, false);
  const after = fs.readFileSync(filePath, 'utf8');
  assert.equal(before, after);
  fs.rmSync(d, { recursive: true, force: true });
});

test('migrateAll: handles each tracked file', () => {
  const d = tmpdir();
  // Mix: legacy playlists, already-v1 history, missing favorites, legacy ids.
  fs.writeFileSync(path.join(d, 'playlists.json'), JSON.stringify([{ id: 'a' }]));
  fs.writeFileSync(path.join(d, 'history.json'), JSON.stringify({ _version: 1, entries: [] }));
  fs.writeFileSync(path.join(d, 'library-ids.json'), JSON.stringify({ paths: { '/x.mp3': 0 }, nextId: 1 }));
  const r = migrateAll(d);
  assert.equal(r['playlists.json'].migrated, true);
  assert.equal(r['history.json'].migrated, false);
  assert.equal(r['favorites.json'].migrated, false); // missing → no-op
  assert.equal(r['library-ids.json'].migrated, true);
  fs.rmSync(d, { recursive: true, force: true });
});

test('readVersion: returns 0 for legacy shapes', () => {
  assert.equal(readVersion([1, 2, 3]), 0);
  assert.equal(readVersion({ items: [] }), 0);
  assert.equal(readVersion(null), 0);
  assert.equal(readVersion({ _version: 2 }), 2);
});

test('unwrap: returns inner key on versioned, raw otherwise', () => {
  assert.deepEqual(unwrap({ _version: 1, items: [1, 2] }, 'items'), [1, 2]);
  assert.deepEqual(unwrap([1, 2], 'items'), [1, 2]); // legacy array
  assert.deepEqual(unwrap({ _version: 1, ids: [9] }, 'ids'), [9]);
});
