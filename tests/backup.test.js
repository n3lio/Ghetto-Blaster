const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const backup = require('../lib/backup');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gb-bk-'));
}

function seed(dir) {
  fs.writeFileSync(path.join(dir, 'playlists.json'), JSON.stringify({ _version: 1, items: [{ id: 'a' }] }));
  fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify({ _version: 1, entries: [] }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 3000 }));
}

test('backupNow copies tracked files into backups/<today>/', () => {
  const d = tmpdir();
  seed(d);
  const r = backup.backupNow(d);
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.ok(r.files.includes('playlists.json'));
  // Files actually exist in the backup folder.
  const today = new Date().toISOString().slice(0, 10);
  const list = fs.readdirSync(path.join(d, 'backups', today));
  assert.ok(list.includes('playlists.json'));
  fs.rmSync(d, { recursive: true, force: true });
});

test('backupNow is a no-op if today already snapshotted', () => {
  const d = tmpdir();
  seed(d);
  backup.backupNow(d);
  const r = backup.backupNow(d);
  assert.equal(r.skipped, true);
  fs.rmSync(d, { recursive: true, force: true });
});

test('listBackups returns sorted descending', () => {
  const d = tmpdir();
  // Forge two fake older dates by creating folders manually.
  fs.mkdirSync(path.join(d, 'backups', '2026-01-01'), { recursive: true });
  fs.mkdirSync(path.join(d, 'backups', '2026-02-15'), { recursive: true });
  const list = backup.listBackups(d);
  assert.equal(list.length, 2);
  assert.equal(list[0].date, '2026-02-15');
  assert.equal(list[1].date, '2026-01-01');
  fs.rmSync(d, { recursive: true, force: true });
});

test('restoreFrom moves current files aside before overwriting', () => {
  const d = tmpdir();
  seed(d);
  backup.backupNow(d);
  const today = new Date().toISOString().slice(0, 10);
  // Mutate the live file.
  fs.writeFileSync(path.join(d, 'playlists.json'), JSON.stringify({ _version: 1, items: [{ id: 'CHANGED' }] }));
  const r = backup.restoreFrom(d, today);
  assert.equal(r.ok, true);
  // Live file is the snapshot again.
  const live = JSON.parse(fs.readFileSync(path.join(d, 'playlists.json'), 'utf8'));
  assert.equal(live.items[0].id, 'a');
  // Pre-restore copy exists.
  const aside = fs.readdirSync(d).find(f => f.startsWith('playlists.json.before-restore-'));
  assert.ok(aside, 'pre-restore backup not created');
  fs.rmSync(d, { recursive: true, force: true });
});

test('restoreFrom rejects bad date format', () => {
  const d = tmpdir();
  const r = backup.restoreFrom(d, 'not-a-date');
  assert.equal(r.ok, false);
  fs.rmSync(d, { recursive: true, force: true });
});

test('pruneOld removes folders beyond KEEP_DAYS', () => {
  const d = tmpdir();
  // Create more than KEEP_DAYS dated folders.
  for (let i = 1; i <= backup.KEEP_DAYS + 3; i++) {
    const date = `2026-01-${String(i).padStart(2, '0')}`;
    fs.mkdirSync(path.join(d, 'backups', date), { recursive: true });
  }
  backup.pruneOld(d);
  const remaining = backup.listBackups(d);
  assert.equal(remaining.length, backup.KEEP_DAYS);
  fs.rmSync(d, { recursive: true, force: true });
});
