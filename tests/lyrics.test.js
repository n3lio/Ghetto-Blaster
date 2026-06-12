const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lyrics = require('../lib/lyrics');

test('parseLrc: extracts timestamped lines', () => {
  const text = '[00:12.50]Hello\n[00:15.00]World\n';
  const out = lyrics.parseLrc(text);
  assert.equal(out.lines.length, 2);
  assert.equal(out.lines[0].time, 12.5);
  assert.equal(out.lines[0].text, 'Hello');
  assert.equal(out.lines[1].time, 15);
  assert.equal(out.lines[1].text, 'World');
});

test('parseLrc: a single line can carry multiple timestamps', () => {
  const out = lyrics.parseLrc('[00:01.00][00:30.00]Repeat me\n');
  assert.equal(out.lines.length, 2);
  assert.equal(out.lines[0].time, 1);
  assert.equal(out.lines[1].time, 30);
  assert.equal(out.lines[0].text, 'Repeat me');
});

test('parseLrc: plain text returns no lines', () => {
  const out = lyrics.parseLrc('Just words.\nNo timestamps.\n');
  assert.equal(out.lines.length, 0);
  assert.ok(out.raw.includes('Just words'));
});

test('isLikelyLrc detects timestamps', () => {
  assert.equal(lyrics.isLikelyLrc('[00:01.00]hi'), true);
  assert.equal(lyrics.isLikelyLrc('[00:01]hi'), true);
  assert.equal(lyrics.isLikelyLrc('plain'), false);
});

test('lrcSidecarPath: replaces extension', () => {
  assert.equal(lyrics.lrcSidecarPath('/x/y/song.mp3'), '/x/y/song.lrc');
  assert.equal(lyrics.lrcSidecarPath('a.flac'), 'a.lrc');
  assert.equal(lyrics.lrcSidecarPath(''), null);
});

test('resolveLyrics: prefers .lrc sidecar', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-lyr-'));
  const audio = path.join(d, 'song.mp3');
  fs.writeFileSync(audio, 'fake-audio');
  fs.writeFileSync(path.join(d, 'song.lrc'), '[00:00.00]Hi\n[00:05.00]World\n');
  lyrics.clearMemo();
  const r = await lyrics.resolveLyrics({ id: 1, path: audio, artist: 'A', title: 'B' }, d);
  assert.equal(r.source, 'sidecar');
  assert.equal(r.parsed.lines.length, 2);
  fs.rmSync(d, { recursive: true, force: true });
});

test('resolveLyrics: falls back to userData cache', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-lyr-'));
  const audio = path.join(d, 'song.mp3');
  fs.writeFileSync(audio, 'fake-audio');
  // No sidecar — but a cache entry exists.
  fs.mkdirSync(path.join(d, 'lyrics-cache'), { recursive: true });
  fs.writeFileSync(path.join(d, 'lyrics-cache', '42.txt'), 'cached lyrics text');
  lyrics.clearMemo();
  const r = await lyrics.resolveLyrics({ id: 42, path: audio, artist: 'A', title: 'B' }, d);
  assert.equal(r.source, 'cache');
  assert.equal(r.text, 'cached lyrics text');
  fs.rmSync(d, { recursive: true, force: true });
});

test('resolveLyrics: returns null when nothing can be resolved (offline)', async () => {
  // Without a sidecar, cache, or network, the resolver should return null
  // rather than throw. We don't make a real outbound call from CI/sandbox —
  // the fetch will fail and we get null.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-lyr-'));
  const audio = path.join(d, 'song.mp3');
  fs.writeFileSync(audio, 'fake');
  lyrics.clearMemo();
  const r = await lyrics.resolveLyrics({ id: 999, path: audio, artist: '', title: '' }, d);
  assert.equal(r, null);
  fs.rmSync(d, { recursive: true, force: true });
});
