const test = require('node:test');
const assert = require('node:assert/strict');
const radio = require('../lib/radio');

function makeLib() {
  const lib = [];
  lib[0] = { id: 0, title: 'Seed', artist: 'NTM', albumArtist: 'NTM', genre: 'rap', year: 1995 };
  lib[1] = { id: 1, title: 'Same artist', artist: 'NTM', albumArtist: 'NTM', genre: 'rap', year: 1996 };
  lib[2] = { id: 2, title: 'Same genre', artist: 'IAM', albumArtist: 'IAM', genre: 'rap', year: 1997 };
  lib[3] = { id: 3, title: 'Different', artist: 'Daft Punk', albumArtist: 'Daft Punk', genre: 'electronic', year: 2013 };
  lib[4] = { id: 4, title: 'Year-only neighbour', artist: 'Other', albumArtist: 'Other', genre: 'jazz', year: 1995 };
  return lib;
}

test('buildRadioQueue: seed first, similar next, unrelated dropped', () => {
  const lib = makeLib();
  const ids = radio.buildRadioQueue(0, lib, { limit: 10, jitter: false });
  // Seed is always first.
  assert.equal(ids[0], 0);
  // Same artist + same genre is the strongest match.
  assert.equal(ids[1], 1);
  // Same genre alone next.
  assert.ok(ids.includes(2));
  // Unrelated track 3 dropped.
  assert.equal(ids.includes(3), false);
});

test('buildRadioQueue: empty library returns empty', () => {
  assert.deepEqual(radio.buildRadioQueue(0, []), []);
});

test('buildRadioQueue: missing seed returns empty', () => {
  const lib = [{ id: 0 }];
  assert.deepEqual(radio.buildRadioQueue(99, lib), []);
});

test('buildRadioQueue: respects limit', () => {
  const lib = makeLib();
  const ids = radio.buildRadioQueue(0, lib, { limit: 2, jitter: false });
  assert.equal(ids.length, 2);
});

test('genreScore handles substring matches', () => {
  assert.equal(radio.genreScore({ genre: 'hip-hop' }, { genre: 'hip-hop, soul' }), 3);
  assert.equal(radio.genreScore({ genre: 'rock' }, { genre: 'electronic' }), 0);
});

test('artistScore uses artists[] when present', () => {
  const seed = { artists: ['NTM'] };
  const cand = { artists: ['NTM', 'IAM'] };
  assert.equal(radio.artistScore(seed, cand), 5);
});

test('yearScore: ±5 window', () => {
  assert.equal(radio.yearScore({ year: 1995 }, { year: 1998 }), 1);
  assert.equal(radio.yearScore({ year: 1995 }, { year: 2010 }), 0);
});
