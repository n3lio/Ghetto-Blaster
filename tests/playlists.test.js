const test = require('node:test');
const assert = require('node:assert/strict');
const pl = require('../lib/playlists');

function makeLib() {
  // Sparse array — mimics the real library shape (gaps after deletions).
  const lib = [];
  lib[0] = { id: 0, title: 'A', artist: 'NTM',          genre: 'Hip-Hop' };
  lib[1] = { id: 1, title: 'B', artist: 'NTM',          genre: 'rap français' };
  lib[2] = { id: 2, title: 'C', artist: 'IAM',          genre: 'hip hop' };
  lib[3] = { id: 3, title: 'D', artist: 'Daft Punk',    genre: 'Electronic' };
  // gap at 4
  lib[5] = { id: 5, title: 'E', artist: 'Air',          genre: 'electronic, ambient' };
  lib[6] = { id: 6, title: 'F', artist: 'Bob Marley',   genre: 'Reggae' };
  lib[7] = { id: 7, title: 'G', artist: 'No Genre',     genre: null };
  return lib;
}

test('resolveSmartPlaylist — substring genre match, case-insensitive', () => {
  const lib = makeLib();
  // 'hip hop' (with space) and 'hip-hop' (with dash) are intentionally
  // different — playlist matching is plain substring, not normalized. So we
  // pass both spellings to catch both tracks.
  const ids = pl.resolveSmartPlaylist(['hip-hop', 'hip hop', 'rap'], lib);
  assert.deepEqual(ids.sort(), [0, 1, 2]);
});

test('resolveSmartPlaylist — multiple matches per genre', () => {
  const lib = makeLib();
  const ids = pl.resolveSmartPlaylist(['electro'], lib);
  assert.deepEqual(ids.sort(), [3, 5]);
});

test('resolveSmartPlaylist — null genre is skipped', () => {
  const lib = makeLib();
  const ids = pl.resolveSmartPlaylist(['anything'], lib);
  assert.equal(ids.includes(7), false);
});

test('resolveSmartPlaylist — handles bad inputs', () => {
  assert.deepEqual(pl.resolveSmartPlaylist(null, []), []);
  assert.deepEqual(pl.resolveSmartPlaylist(['x'], null), []);
});

test('resolveManualPlaylist — drops invalid + missing IDs', () => {
  const lib = makeLib();
  const ids = pl.resolveManualPlaylist([0, 4, 5, 99, '2'], lib);
  // 4 and 99 don't exist; '2' is a string, dropped.
  assert.deepEqual(ids, [0, 5]);
});

test('resolvePlaylistTracks — dispatches by type', () => {
  const lib = makeLib();
  const smart = { type: 'smart', genreMatch: ['reggae'] };
  assert.deepEqual(pl.resolvePlaylistTracks(smart, lib), [6]);
  const manual = { type: 'manual', trackIds: [0, 99] };
  assert.deepEqual(pl.resolvePlaylistTracks(manual, lib), [0]);
});

test('reorderPlaylists — applies order, keeps unmatched at the end', () => {
  const lists = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  const reordered = pl.reorderPlaylists(lists, ['c', 'a']);
  assert.deepEqual(reordered.map(p => p.id), ['c', 'a', 'b']);
});

test('reorderPlaylists — ignores unknown ids in the order', () => {
  const lists = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const reordered = pl.reorderPlaylists(lists, ['ghost', 'b', 'a']);
  assert.deepEqual(reordered.map(p => p.id), ['b', 'a']);
});

test('smartShuffle — preserves the multiset of ids', () => {
  const lib = makeLib();
  const input = [0, 1, 2, 3, 5, 6];
  const shuffled = pl.smartShuffle(lib, input);
  assert.deepEqual([...shuffled].sort(), [...input].sort());
});

test('smartShuffle — drops invalid ids', () => {
  const lib = makeLib();
  const shuffled = pl.smartShuffle(lib, [0, 99, 4, 1]);
  assert.deepEqual([...shuffled].sort(), [0, 1]);
});
