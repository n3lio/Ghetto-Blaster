const test = require('node:test');
const assert = require('node:assert/strict');
const { parseM3U, resolveAgainstLibrary } = require('../lib/m3u');

test('parseM3U: empty / missing input', () => {
  assert.deepEqual(parseM3U(''), []);
  assert.deepEqual(parseM3U(null), []);
});

test('parseM3U: extended format with EXTINF', () => {
  const txt = [
    '#EXTM3U',
    '#PLAYLIST:My Mix',
    '#EXTINF:240,NTM - Police',
    '/music/ntm/police.mp3',
    '#EXTINF:185,Daft Punk - Get Lucky',
    '/music/daft/getlucky.mp3',
  ].join('\n');
  const out = parseM3U(txt);
  assert.equal(out.length, 2);
  assert.equal(out[0].artist, 'NTM');
  assert.equal(out[0].title, 'Police');
  assert.equal(out[0].duration, 240);
  assert.equal(out[0].uri, '/music/ntm/police.mp3');
  assert.equal(out[1].artist, 'Daft Punk');
  assert.equal(out[1].title, 'Get Lucky');
});

test('parseM3U: simple format (URIs only)', () => {
  const out = parseM3U('a.mp3\nb.mp3\n');
  assert.equal(out.length, 2);
  assert.equal(out[0].uri, 'a.mp3');
  assert.equal(out[0].artist, '');
});

test('parseM3U: BOM and CRLF tolerated', () => {
  const out = parseM3U('﻿#EXTM3U\r\n#EXTINF:60,A - B\r\nx.mp3\r\n');
  assert.equal(out.length, 1);
  assert.equal(out[0].artist, 'A');
});

test('parseM3U: malformed EXTINF doesn\'t lose the next URI', () => {
  // missing comma → whole rest treated as duration-string
  const out = parseM3U('#EXTINF:bad\nfile.mp3\n');
  assert.equal(out.length, 1);
  assert.equal(out[0].uri, 'file.mp3');
});

test('resolveAgainstLibrary: matches by /api/stream/<id> URI', () => {
  const lib = [];
  lib[5] = { id: 5, title: 'A', artist: 'X', filename: 'a.mp3' };
  const entries = [{ uri: '/api/stream/5', title: '', artist: '', duration: 0 }];
  const r = resolveAgainstLibrary(entries, lib);
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].trackId, 5);
});

test('resolveAgainstLibrary: matches by (artist, title)', () => {
  const lib = [];
  lib[7] = { id: 7, title: 'Police', artist: 'NTM', filename: 'p.mp3' };
  const entries = [{ uri: '/foo/bar.mp3', title: 'Police', artist: 'NTM', duration: 0 }];
  const r = resolveAgainstLibrary(entries, lib);
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].trackId, 7);
});

test('resolveAgainstLibrary: matches by basename fallback', () => {
  const lib = [];
  lib[3] = { id: 3, title: 'X', artist: 'Y', filename: 'song.mp3' };
  const entries = [{ uri: '/some/path/song.mp3', title: 'wrong', artist: 'wrong', duration: 0 }];
  const r = resolveAgainstLibrary(entries, lib);
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].trackId, 3);
});

test('resolveAgainstLibrary: unresolved entries kept separate', () => {
  const lib = [{ id: 0, title: 'Known', artist: 'Me', filename: 'known.mp3' }];
  const entries = [
    { uri: '/api/stream/0', title: '', artist: '', duration: 0 },
    { uri: '/foo.mp3', title: 'Unknown', artist: 'Stranger', duration: 0 },
  ];
  const r = resolveAgainstLibrary(entries, lib);
  assert.equal(r.matched.length, 1);
  assert.equal(r.unresolved.length, 1);
});
