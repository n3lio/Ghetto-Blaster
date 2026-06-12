const test = require('node:test');
const assert = require('node:assert/strict');
const { splitArtistTag, splitGenreTag } = require('../lib/multitag');

test('splitArtistTag: comma-separated', () => {
  assert.deepEqual(splitArtistTag('NTM, IAM, Suprême'), ['NTM', 'IAM', 'Suprême']);
});

test('splitArtistTag: feat. variants', () => {
  assert.deepEqual(splitArtistTag('Daft Punk feat. Pharrell'), ['Daft Punk', 'Pharrell']);
  assert.deepEqual(splitArtistTag('Daft Punk ft Pharrell'), ['Daft Punk', 'Pharrell']);
  assert.deepEqual(splitArtistTag('Daft Punk ft. Pharrell'), ['Daft Punk', 'Pharrell']);
});

test('splitArtistTag: x, vs, with', () => {
  assert.deepEqual(splitArtistTag('Artist x Other'), ['Artist', 'Other']);
  assert.deepEqual(splitArtistTag('A vs B'), ['A', 'B']);
  assert.deepEqual(splitArtistTag('A with B'), ['A', 'B']);
});

test('splitArtistTag: dedupes case-insensitively', () => {
  assert.deepEqual(splitArtistTag('Air, AIR, air'), ['Air']);
});

test('splitArtistTag: ignores empty / null', () => {
  assert.deepEqual(splitArtistTag(''), []);
  assert.deepEqual(splitArtistTag('   '), []);
  assert.deepEqual(splitArtistTag(null), []);
});

test('splitArtistTag: documents that comma DOES split (& is preserved)', () => {
  // We deliberately do NOT split on '&', so "Wind & Fire" survives as one.
  // Comma is a valid separator though, so the leading "Earth," gets peeled
  // off. Compounds like "Earth, Wind & Fire" therefore become two entries.
  // If a user wants to keep them as one, they can edit the tag.
  const out = splitArtistTag('Earth, Wind & Fire');
  assert.deepEqual(out, ['Earth', 'Wind & Fire']);
});

test('splitGenreTag: handles slash, comma, semi, pipe, middot', () => {
  assert.deepEqual(splitGenreTag('Hip-Hop / Rap'), ['Hip-Hop', 'Rap']);
  assert.deepEqual(splitGenreTag('rock; alternative; indie'), ['rock', 'alternative', 'indie']);
  assert.deepEqual(splitGenreTag('Soul · Funk'), ['Soul', 'Funk']);
  assert.deepEqual(splitGenreTag('jazz|blues'), ['jazz', 'blues']);
});

test('splitGenreTag: tolerates whitespace', () => {
  assert.deepEqual(splitGenreTag('  Pop ,  R&B  '), ['Pop', 'R&B']);
});
