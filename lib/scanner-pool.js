// Tiny worker pool for the metadata scanner. We spin up `size` workers (default
// = CPU count, capped at 4 because metadata parsing is mostly I/O), funnel jobs
// through them, and resolve each call's promise when its job comes back.
//
// The pool is opt-in: if `worker_threads` isn't available or the worker fails
// to start, callers should fall back to inline parsing.

const os = require('node:os');
const path = require('node:path');

let Worker;
try { ({ Worker } = require('node:worker_threads')); } catch (e) { Worker = null; }

class ScannerPool {
  constructor(size) {
    this.size = Math.max(1, Math.min(size || os.cpus().length, 4));
    this.nextJobId = 0;
    this.pending = new Map(); // jobId → { resolve, reject }
    this.queue = [];
    this.workers = [];
    this.idle = [];
    this._available = false;
  }

  start() {
    if (!Worker) return false;
    try {
      const workerPath = path.join(__dirname, 'scanner-worker.js');
      for (let i = 0; i < this.size; i++) {
        const w = new Worker(workerPath);
        w.on('message', (msg) => this._onMessage(w, msg));
        w.on('error', (err) => this._onError(w, err));
        w.on('exit', (code) => this._onExit(w, code));
        this.workers.push(w);
        this.idle.push(w);
      }
      this._available = true;
      return true;
    } catch (e) {
      this._available = false;
      return false;
    }
  }

  available() { return this._available; }

  parseFile(filePath) {
    if (!this._available) return Promise.reject(new Error('Pool not started'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextJobId;
      this.pending.set(id, { resolve, reject });
      const job = { id, filePath };
      const idleWorker = this.idle.pop();
      if (idleWorker) {
        idleWorker._jobId = id;
        idleWorker.postMessage(job);
      } else {
        this.queue.push(job);
      }
    });
  }

  _onMessage(worker, msg) {
    const cb = this.pending.get(msg.id);
    if (cb) {
      this.pending.delete(msg.id);
      if (msg.ok) cb.resolve(msg);
      else cb.reject(new Error(msg.error || 'parse failed'));
    }
    // Worker is idle again — assign next queued job or park it.
    const next = this.queue.shift();
    if (next) {
      worker._jobId = next.id;
      worker.postMessage(next);
    } else {
      worker._jobId = null;
      this.idle.push(worker);
    }
  }

  _onError(worker, err) {
    if (worker._jobId) {
      const cb = this.pending.get(worker._jobId);
      if (cb) { this.pending.delete(worker._jobId); cb.reject(err); }
    }
  }

  _onExit(worker /*, code */) {
    if (worker._jobId) {
      const cb = this.pending.get(worker._jobId);
      if (cb) { this.pending.delete(worker._jobId); cb.reject(new Error('Worker exited')); }
    }
    this.workers = this.workers.filter(w => w !== worker);
    this.idle = this.idle.filter(w => w !== worker);
    if (this.workers.length === 0) this._available = false;
  }

  async stop() {
    this._available = false;
    await Promise.all(this.workers.map(w => w.terminate().catch(() => {})));
    this.workers = [];
    this.idle = [];
    // Reject anything still pending.
    for (const cb of this.pending.values()) cb.reject(new Error('Pool stopped'));
    this.pending.clear();
    this.queue = [];
  }
}

module.exports = { ScannerPool };
