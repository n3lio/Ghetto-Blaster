const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery, applyQuery } = require('../lib/query');

test('parseQuery: empty input', () => {
  assert.deepEqual(parseQuery(''), { filters: {}, text: '', year: null });
  assert.deepEqual(parseQuery(null), { filters: {}, text: '', year: null });
});

test('parseQuery: free text only', () => {
  const q = parseQuery('banger summer');
  assert.equal(q.text, 'banger summer');
  assert.deepEqual(q.filters, {});
});

test('parseQuery: artist + free text', () => {
  const q = parseQuery('artist:NTM banger');
  assert.deepEqual(q.filters.artist, ['ntm']);
  assert.equal(q.text, 'banger');
});

test('parseQuery: quoted value with spaces', () => {
  const q = parseQuery('artist:"Daft Punk" lucky');
  assert.deepEqual(q.filters.artist, ['daft punk']);
  assert.equal(q.text, 'lucky');
});

test('parseQuery: multiple values OR-ed', () => {
  const q = parseQuery('artist:NTM artist:IAM');
  assert.deepEqual(q.filters.artist, ['ntm', 'iam']);
});

test('parseQuery: year range', () => {
  const q = parseQuery('year:2010..2015');
  assert.deepEqual(q.year, { from: 2010, to: 2015 });
});

test('parseQuery: single year is treated as a degenerate range', () => {
  const q = parseQuery('year:1995');
  assert.deepEqual(q.year, { from: 1995, to: 1995 });
});

test('parseQuery: unknown key drops into free text', () => {
  const q = parseQuery('mystery:value rap');
  assert.equal(q.text, 'mystery:value rap');
});

test('applyQuery: filters compose AND-style', () => {
  const lib = [
    { id: 0, title: 'Police', artist: 'NTM', album: 'A', genre: 'rap', genres: ['rap'], year: 1995 },
    { id: 1, title: 'Get Lucky', artist: 'Daft Punk', album: 'RAM', genre: 'electronic', genres: ['electronic'], year: 2013 },
    { id: 2, title: 'Pose ton gun', artist: 'IAM', album: 'X', genre: 'hip-hop', genres: ['hip-hop'], year: 1997 },
  ];
  const out = applyQuery(parseQuery('genre:rap'), lib);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 0);
});

test('applyQuery: combined filters + free text', () => {
  const lib = [
    { id: 0, title: 'Police', artist: 'NTM', album: 'A', genre: 'rap', year: 1995 },
    { id: 1, title: 'Police 2', artist: 'IAM', album: 'X', genre: 'rap', year: 1997 },
  ];
  const out = applyQuery(parseQuery('genre:rap year:1995..1995 police'), lib);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 0);
});

test('applyQuery: artists[] is honored', () => {
  const lib = [
    { id: 0, title: 'Collab', artist: 'A feat. B', artists: ['A', 'B'], album: '', genre: '', year: 2020 },
  ];
  const out = applyQuery(parseQuery('artist:b'), lib);
  assert.equal(out.length, 1);
});

test('applyQuery: year range filters tracks outside the window', () => {
  const lib = [
    { id: 0, title: 'X', artist: 'A', year: 1990 },
    { id: 1, title: 'Y', artist: 'A', year: 2000 },
    { id: 2, title: 'Z', artist: 'A', year: 2010 },
  ];
  const out = applyQuery(parseQuery('year:1995..2005'), lib);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
});
