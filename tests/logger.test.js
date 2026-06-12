const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../lib/logger');

test('logger writes JSON-lines to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-log-'));
  const log = createLogger({ dir, level: 'debug', pretty: false, name: 'unit' });
  log.info('hello', { foo: 'bar' });
  log.warn('careful', { count: 3 });
  log.close();

  const lines = fs.readFileSync(path.join(dir, 'unit.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.level, 'info');
  assert.equal(first.msg, 'hello');
  assert.deepEqual(first.ctx, { foo: 'bar' });
  assert.equal(typeof first.time, 'number');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('logger respects level threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-log-'));
  const log = createLogger({ dir, level: 'warn', pretty: false, name: 'unit' });
  log.debug('skip me');
  log.info('skip me too');
  log.warn('keep me');
  log.error('keep me too');
  log.close();

  const lines = fs.readFileSync(path.join(dir, 'unit.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('logger tail returns recent in-memory entries', () => {
  const log = createLogger({ pretty: false, level: 'debug' });
  for (let i = 0; i < 10; i++) log.info('msg ' + i);
  const recent = log.tail(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[2].msg, 'msg 9');
  log.close();
});

test('logger setLevel changes threshold dynamically', () => {
  const log = createLogger({ pretty: false, level: 'info' });
  assert.equal(log.getLevel(), 'info');
  log.setLevel('error');
  assert.equal(log.getLevel(), 'error');
  log.info('skipped');
  log.error('kept');
  const recent = log.tail();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].msg, 'kept');
  log.close();
});
