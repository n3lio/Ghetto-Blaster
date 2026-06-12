const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMockLibrary, buildMockGenres } = require('../lib/mock-library');

test('buildMockLibrary returns a sparse library of the requested size', () => {
  const lib = buildMockLibrary({ count: 50, seed: 7 });
  // Sparse — gaps at indices 3 and 7, length should still be 50.
  assert.equal(lib.length, 50);
  let real = 0;
  for (let i = 0; i < lib.length; i++) if (lib[i] != null) real++;
  assert.equal(real, 48); // 50 minus the two punched-out gaps
});

test('buildMockLibrary entries match the real scanner shape', () => {
  const lib = buildMockLibrary({ count: 10, seed: 1 });
  const t = lib[0];
  for (const k of ['id', 'path', 'filename', 'title', 'artist', 'albumArtist', 'album', 'year', 'duration', 'genre', 'hasCover']) {
    assert.ok(Object.prototype.hasOwnProperty.call(t, k), `missing key: ${k}`);
  }
  assert.equal(t.id, 0);
  assert.equal(typeof t.title, 'string');
  assert.equal(typeof t.duration, 'number');
});

test('buildMockLibrary is deterministic for the same seed', () => {
  const a = buildMockLibrary({ count: 30, seed: 42 });
  const b = buildMockLibrary({ count: 30, seed: 42 });
  assert.deepEqual(a.map(x => x && x.title), b.map(x => x && x.title));
});

test('buildMockLibrary respects different seeds (some divergence)', () => {
  const a = buildMockLibrary({ count: 30, seed: 1 });
  const b = buildMockLibrary({ count: 30, seed: 9999 });
  const sameTitles = a.reduce((acc, t, i) => acc + (t && b[i] && t.title === b[i].title ? 1 : 0), 0);
  // With pseudo-random and 30 items, identical sequences would be highly
  // suspicious. We tolerate up to ~5 collisions just to keep the test stable.
  assert.ok(sameTitles < 10, `too many identical titles between seeds: ${sameTitles}`);
});

test('buildMockGenres extracts distinct genres from a library', () => {
  const lib = buildMockLibrary({ count: 100, seed: 3 });
  const genres = buildMockGenres(lib);
  assert.ok(genres.size > 0);
  assert.ok(genres.size <= 10); // we only have 10 fixed genres in the mock
});

test('buildMockGenres skips null genres', () => {
  const lib = [{ id: 0, genre: null }, { id: 1, genre: 'rock' }];
  const genres = buildMockGenres(lib);
  assert.equal(genres.size, 1);
  assert.ok(genres.has('rock'));
});
