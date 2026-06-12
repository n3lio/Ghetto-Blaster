// Daily snapshot of the user's persistent JSON files into
// userData/backups/<YYYY-MM-DD>/. Keep the last N days, drop older ones.
//
// We snapshot at most once per UTC day — calling backupNow() twice in a row
// is a no-op the second time. Restore is a full file overwrite, with the
// current files moved aside as `.before-restore` so the user can undo by hand.

const fs = require('node:fs');
const path = require('node:path');

const TRACKED = ['playlists.json', 'history.json', 'favorites.json', 'library-ids.json', 'config.json'];
const KEEP_DAYS = 7;

function backupsRoot(dataDir) {
  return path.join(dataDir, 'backups');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function listBackups(dataDir) {
  const root = backupsRoot(dataDir);
  if (!fs.existsSync(root)) return [];
  let names;
  try { names = fs.readdirSync(root); } catch (e) { return []; }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort()
    .reverse()
    .map((name) => {
      const dir = path.join(root, name);
      let files = [];
      try { files = fs.readdirSync(dir); } catch (e) { /* ignore */ }
      return { date: name, files, path: dir };
    });
}

// Copies tracked files into backups/<today>/. If today already exists, skip.
// Returns { ok, created, skipped, dir }.
function backupNow(dataDir, log) {
  const root = backupsRoot(dataDir);
  const today = todayKey();
  const dir = path.join(root, today);
  if (fs.existsSync(dir)) {
    return { ok: true, created: false, skipped: true, dir, reason: 'already exists for today' };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (log) log.warn('backup: mkdir failed', { error: e.message });
    return { ok: false, error: e.message };
  }
  const copied = [];
  for (const file of TRACKED) {
    const src = path.join(dataDir, file);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(dir, file));
      copied.push(file);
    } catch (e) {
      if (log) log.warn('backup: copy failed', { file, error: e.message });
    }
  }
  pruneOld(dataDir, log);
  if (log) log.info('backup: created', { date: today, files: copied.length });
  return { ok: true, created: true, dir, files: copied };
}

function pruneOld(dataDir, log) {
  const all = listBackups(dataDir);
  if (all.length <= KEEP_DAYS) return;
  const toDelete = all.slice(KEEP_DAYS);
  for (const b of toDelete) {
    try {
      fs.rmSync(b.path, { recursive: true, force: true });
      if (log) log.info('backup: pruned', { date: b.date });
    } catch (e) {
      if (log) log.warn('backup: prune failed', { date: b.date, error: e.message });
    }
  }
}

// Restores all tracked files from a given backup date. Each existing file is
// renamed to `<file>.before-restore-<stamp>` so the operation is reversible.
function restoreFrom(dataDir, date, log) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return { ok: false, error: 'invalid date format' };
  }
  const dir = path.join(backupsRoot(dataDir), date);
  if (!fs.existsSync(dir)) return { ok: false, error: 'backup not found' };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const restored = [];
  for (const file of TRACKED) {
    const src = path.join(dir, file);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dataDir, file);
    try {
      if (fs.existsSync(dst)) {
        fs.renameSync(dst, `${dst}.before-restore-${stamp}`);
      }
      fs.copyFileSync(src, dst);
      restored.push(file);
    } catch (e) {
      if (log) log.error('restore: failed', { file, error: e.message });
      return { ok: false, error: e.message, restored };
    }
  }
  if (log) log.info('restore: done', { date, files: restored.length });
  return { ok: true, restored, dir, stamp };
}

// Schedule backupNow() to run on a daily-ish cadence. Intentionally simple —
// `setInterval` with a 6h tick that bails out early when today's backup
// already exists. Returns a stop() to clear the timer.
function startScheduledBackups(dataDir, log) {
  // Initial backup at boot.
  try { backupNow(dataDir, log); } catch (e) { /* ignore */ }
  const id = setInterval(() => {
    try { backupNow(dataDir, log); } catch (e) { /* ignore */ }
  }, 6 * 60 * 60 * 1000);
  // Don't keep the process alive just for backups.
  if (id && typeof id.unref === 'function') id.unref();
  return { stop: () => clearInterval(id) };
}

module.exports = {
  TRACKED,
  KEEP_DAYS,
  backupNow,
  listBackups,
  pruneOld,
  restoreFrom,
  startScheduledBackups,
};
