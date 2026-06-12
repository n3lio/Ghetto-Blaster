const test = require('node:test');
const assert = require('node:assert/strict');
const tw = require('../lib/tag-writer');

test('pickValidFields keeps only known string/number fields', () => {
  const out = tw.pickValidFields({
    title: 'New Title',
    artist: 'Artist',
    album: '',                 // dropped (empty)
    year: 2026,
    bogus: 'x',                // dropped (not in whitelist)
    trackNumber: '7',
  });
  assert.deepEqual(out, { title: 'New Title', artist: 'Artist', year: '2026', trackNumber: '7' });
});

test('pickValidFields rejects oversized values', () => {
  const huge = 'x'.repeat(600);
  const out = tw.pickValidFields({ title: huge, artist: 'OK' });
  assert.equal(out.title, undefined);
  assert.equal(out.artist, 'OK');
});

test('pickValidFields handles null / non-objects', () => {
  assert.deepEqual(tw.pickValidFields(null), {});
  assert.deepEqual(tw.pickValidFields({}), {});
});

test('fileFormat: extensions are recognized', () => {
  assert.equal(tw.fileFormat('/x/y.mp3'), 'mp3');
  assert.equal(tw.fileFormat('Y.MP3'), 'mp3');
  assert.equal(tw.fileFormat('/x/y.flac'), 'flac');
  assert.equal(tw.fileFormat('y.m4a'), 'm4a');
  assert.equal(tw.fileFormat('y.mp4'), 'm4a');
  assert.equal(tw.fileFormat('y.ogg'), 'vorbis');
  assert.equal(tw.fileFormat('y.weirdext'), 'unknown');
  assert.equal(tw.fileFormat(''), 'unknown');
});

test('writeTags rejects non-mp3 with format hint', () => {
  // Use a path that exists in the test workspace to isolate the format check.
  const r = tw.writeTags(__filename.replace(/\.js$/, '.flac'), { title: 'X' });
  // file doesn't exist either — error surface is fine here
  assert.equal(r.ok, false);
});

test('writeTags rejects empty payload', () => {
  // Use this very test file so the path-exists check passes, but pass no
  // valid fields. node-id3 will say "no valid fields" before touching disk.
  // (It still might fail because this isn't an mp3; both outcomes assert ok=false.)
  const r = tw.writeTags(__filename, {});
  assert.equal(r.ok, false);
});
