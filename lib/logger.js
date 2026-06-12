// Tiny structured logger. Zero deps so it ships with the rest of the app
// without bloating node_modules. Writes JSON-lines to a rotating file in the
// user-data dir (or a configured directory) and a colored line to stderr in
// dev mode. The logger keeps the last N lines in memory so the dev API can
// surface them via `/api/_dev/log-tail` without parsing the on-disk file.

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const COLORS = {
  trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[32m',
  warn: '\x1b[33m', error: '\x1b[31m', fatal: '\x1b[35m',
};
const RESET = '\x1b[0m';

const RING_SIZE = 500; // last N lines kept in memory for /api/_dev/log-tail
const ROTATE_BYTES = 5 * 1024 * 1024;
const ROTATE_KEEP = 5;

function formatPretty(entry) {
  const color = COLORS[entry.level] || '';
  const ts = new Date(entry.time).toISOString().slice(11, 23);
  const ctx = entry.ctx ? ' ' + JSON.stringify(entry.ctx) : '';
  return `${color}${ts} ${entry.level.padEnd(5)}${RESET} ${entry.msg}${ctx}`;
}

function createLogger({ dir = null, level = 'info', pretty = false, name = 'server' } = {}) {
  let minLevel = LEVELS[level] || LEVELS.info;
  let logPath = null;
  let dirReady = false;
  const ring = [];

  function ensureDir() {
    if (!dir || dirReady) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      logPath = path.join(dir, `${name}.log`);
      dirReady = true;
    } catch (e) {
      process.stderr.write(`[logger] cannot create ${dir}: ${e.message}\n`);
    }
  }

  function rotateIfNeeded() {
    if (!logPath) return;
    let size = 0;
    try { size = fs.statSync(logPath).size; } catch (e) { return; }
    if (size < ROTATE_BYTES) return;
    try {
      // Shift .N → .N+1, drop the oldest. Best-effort, never throw.
      for (let i = ROTATE_KEEP - 1; i >= 1; i--) {
        const src = `${logPath}.${i}`;
        const dst = `${logPath}.${i + 1}`;
        if (fs.existsSync(src)) {
          try { fs.renameSync(src, dst); } catch (e) { /* ignore */ }
        }
      }
      try { fs.renameSync(logPath, logPath + '.1'); } catch (e) { /* ignore */ }
      const beyond = `${logPath}.${ROTATE_KEEP + 1}`;
      if (fs.existsSync(beyond)) {
        try { fs.unlinkSync(beyond); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* rotation best-effort */ }
  }

  function emit(level, msg, ctx) {
    if ((LEVELS[level] || 0) < minLevel) return;
    const entry = {
      time: Date.now(),
      level,
      msg: typeof msg === 'string' ? msg : String(msg),
    };
    if (ctx && typeof ctx === 'object') entry.ctx = ctx;

    // Ring buffer (memory) — synchronous, always available.
    ring.push(entry);
    if (ring.length > RING_SIZE) ring.shift();

    // File (rotating). Synchronous append — overkill on big servers but the
    // throughput here is low (a few logs per scan) so the simplicity wins.
    if (dir) {
      ensureDir();
      if (logPath) {
        try {
          fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
        } catch (e) { /* ignore */ }
        rotateIfNeeded();
      }
    }

    // Console.
    if (pretty || !logPath) {
      const line = formatPretty(entry);
      const out = (level === 'error' || level === 'fatal' || level === 'warn')
        ? process.stderr : process.stdout;
      out.write(line + '\n');
    }
  }

  return {
    trace: (m, c) => emit('trace', m, c),
    debug: (m, c) => emit('debug', m, c),
    info: (m, c) => emit('info', m, c),
    warn: (m, c) => emit('warn', m, c),
    error: (m, c) => emit('error', m, c),
    fatal: (m, c) => emit('fatal', m, c),
    setLevel(lvl) { if (LEVELS[lvl]) minLevel = LEVELS[lvl]; },
    getLevel() { return Object.keys(LEVELS).find(k => LEVELS[k] === minLevel); },
    tail(n = 100) {
      return ring.slice(Math.max(0, ring.length - n));
    },
    path() { return logPath; },
    close() { /* nothing to flush, appends are sync */ },
  };
}

// Default logger instance — wires itself when setLogDir() is called by the
// server. Until then it logs to stderr only.
let defaultLogger = createLogger({ pretty: true, level: 'info' });

function setLogConfig({ dir, level, pretty, name } = {}) {
  // Drain old logger and replace with one writing to the new dir.
  if (defaultLogger) defaultLogger.close();
  defaultLogger = createLogger({ dir, level, pretty, name });
  return defaultLogger;
}

function getLogger() { return defaultLogger; }

module.exports = { createLogger, setLogConfig, getLogger };
