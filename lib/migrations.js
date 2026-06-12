// Schema migrations for the JSON files in userData/. Each tracked file has a
// list of migrations indexed by target version (1, 2, 3, …). At boot we read
// the file's `_version` (default 0 = legacy/unversioned), then run each
// migration in order until we reach the latest known version.
//
// Migrations must be **idempotent** and **non-destructive on failure**: we
// snapshot the file to userData/migrations-backup/ before applying anything,
// so a botched migration can be reverted by hand without data loss.
//
// To add a migration:
//   1. Add an entry to MIGRATIONS[<file>][<version>] returning the new shape.
//   2. Bump LATEST[<file>] to the new version.
//
// Example legacy → v1 transition for a hypothetical history.json:
//   MIGRATIONS['history.json'][1] = (data) => ({
//     _version: 1,
//     entries: Array.isArray(data) ? data : (data.entries || []),
//   });

const fs = require('node:fs');
const path = require('node:path');

// File-by-file migration tables. Each migration receives the parsed JSON of
// the previous version and returns the next version.
const MIGRATIONS = {
  'playlists.json': {
    // v0 was a bare array of playlist objects. v1 wraps in {_version, items}.
    1: (data) => {
      const items = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
      return { _version: 1, items };
    },
  },
  'history.json': {
    1: (data) => {
      const entries = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []);
      return { _version: 1, entries };
    },
  },
  'favorites.json': {
    1: (data) => {
      const ids = Array.isArray(data) ? data : (data && Array.isArray(data.ids) ? data.ids : []);
      return { _version: 1, ids };
    },
  },
  'library-ids.json': {
    1: (data) => {
      // Already shaped as {paths, nextId}; just stamp a version.
      const paths = (data && data.paths) || {};
      const nextId = (data && typeof data.nextId === 'number') ? data.nextId : 0;
      return { _version: 1, paths, nextId };
    },
  },
  // config.json is intentionally NOT versioned — its shape is loose by design
  // and DEFAULT_CONFIG handles missing keys at load time.
};

// Highest known version per file. Bump this whenever you add an entry above.
const LATEST = {
  'playlists.json': 1,
  'history.json': 1,
  'favorites.json': 1,
  'library-ids.json': 1,
};

function readVersion(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed._version === 'number') {
    return parsed._version;
  }
  return 0;
}

// Migrates a single file. Returns one of:
//   { ok: true, migrated: false }            — nothing to do
//   { ok: true, migrated: true, from, to }   — migrated successfully
//   { ok: false, error }                     — migration threw; original file untouched
function migrateFile(dataDir, filename, log) {
  const target = LATEST[filename];
  if (target == null) return { ok: true, migrated: false };
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) return { ok: true, migrated: false };

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) {
    if (log) log.warn('migration: file unreadable', { filename, error: e.message });
    return { ok: false, error: e.message };
  }

  const from = readVersion(parsed);
  if (from >= target) return { ok: true, migrated: false };

  // Snapshot before applying anything, so we can recover if the rewrite fails.
  try {
    const backupDir = path.join(dataDir, 'migrations-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(filePath, path.join(backupDir, `${filename}.${stamp}.v${from}.bak`));
  } catch (e) {
    if (log) log.warn('migration: backup failed, aborting', { filename, error: e.message });
    return { ok: false, error: 'backup failed: ' + e.message };
  }

  let current = parsed;
  for (let v = from + 1; v <= target; v++) {
    const fn = MIGRATIONS[filename] && MIGRATIONS[filename][v];
    if (!fn) {
      if (log) log.warn('migration: missing step', { filename, version: v });
      return { ok: false, error: 'missing migration step v' + v };
    }
    try {
      current = fn(current);
    } catch (e) {
      if (log) log.error('migration: step failed', { filename, version: v, error: e.message });
      return { ok: false, error: e.message };
    }
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2));
  } catch (e) {
    if (log) log.error('migration: write failed', { filename, error: e.message });
    return { ok: false, error: 'write failed: ' + e.message };
  }

  if (log) log.info('migration: done', { filename, from, to: target });
  return { ok: true, migrated: true, from, to: target };
}

function migrateAll(dataDir, log) {
  const results = {};
  for (const filename of Object.keys(LATEST)) {
    results[filename] = migrateFile(dataDir, filename, log);
  }
  return results;
}

// Helper used by load*() functions to peel the version wrapper transparently.
// If the file is unversioned (legacy), returns the data as-is.
function unwrap(parsed, key) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed._version === 'number') {
    return key && parsed[key] !== undefined ? parsed[key] : parsed;
  }
  return parsed;
}

module.exports = { MIGRATIONS, LATEST, migrateAll, migrateFile, readVersion, unwrap };
