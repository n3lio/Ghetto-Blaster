const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../lib/validation');

test('isIntegerArray', () => {
  assert.equal(v.isIntegerArray([1, 2, 3]), true);
  assert.equal(v.isIntegerArray([]), true);
  assert.equal(v.isIntegerArray([1, '2']), false);
  assert.equal(v.isIntegerArray([1.5]), false);
  assert.equal(v.isIntegerArray('not array'), false);
  assert.equal(v.isIntegerArray(null), false);
});

test('isStringArray', () => {
  assert.equal(v.isStringArray(['a', 'b']), true);
  assert.equal(v.isStringArray([]), true);
  assert.equal(v.isStringArray(['a', 1]), false);
  assert.equal(v.isStringArray(null), false);
});

test('isValidPort', () => {
  assert.equal(v.isValidPort(3000), true);
  assert.equal(v.isValidPort(1), true);
  assert.equal(v.isValidPort(65535), true);
  assert.equal(v.isValidPort(0), false);
  assert.equal(v.isValidPort(65536), false);
  assert.equal(v.isValidPort(-1), false);
  assert.equal(v.isValidPort(3000.5), false);
  assert.equal(v.isValidPort('3000'), false);
});

test('isValidTrackId — sparse library handling', () => {
  const lib = [];
  lib[5] = { id: 5, title: 'a' };
  lib[10] = { id: 10, title: 'b' };
  assert.equal(v.isValidTrackId(5, lib), true);
  assert.equal(v.isValidTrackId(10, lib), true);
  assert.equal(v.isValidTrackId(0, lib), false); // gap
  assert.equal(v.isValidTrackId(7, lib), false); // gap
  assert.equal(v.isValidTrackId(99, lib), false); // out of bounds
  assert.equal(v.isValidTrackId(-1, lib), false);
  assert.equal(v.isValidTrackId('5', lib), false);
});

test('parseTrackId', () => {
  assert.equal(v.parseTrackId('42'), 42);
  assert.equal(v.parseTrackId('0'), 0);
  assert.equal(v.parseTrackId('abc'), null);
  assert.equal(v.parseTrackId('-1'), null);
  assert.equal(v.parseTrackId(undefined), null);
});

test('isAudioFile — extensions whitelist', () => {
  assert.equal(v.isAudioFile('song.mp3'), true);
  assert.equal(v.isAudioFile('Song.MP3'), true);
  assert.equal(v.isAudioFile('track.flac'), true);
  assert.equal(v.isAudioFile('audio.m4a'), true);
  assert.equal(v.isAudioFile('cover.jpg'), false);
  assert.equal(v.isAudioFile('readme'), false);
  assert.equal(v.isAudioFile(''), false);
  assert.equal(v.isAudioFile(null), false);
});

test('isExcludedPath — handles both separators', () => {
  assert.equal(v.isExcludedPath('C:\\Music\\Backups\\song.mp3', ['Backups']), true);
  assert.equal(v.isExcludedPath('/home/user/music/.trash/song.mp3', ['.trash']), true);
  assert.equal(v.isExcludedPath('/home/user/music/song.mp3', ['Backups']), false);
  assert.equal(v.isExcludedPath('Music/SUBFOLDER/song.mp3', ['subfolder']), true); // case-insensitive
  assert.equal(v.isExcludedPath('/path/to/song.mp3', []), false);
  assert.equal(v.isExcludedPath('', ['x']), false);
});

test('REMOTE_COMMANDS includes the core commands', () => {
  assert.ok(v.REMOTE_COMMANDS.has('play'));
  assert.ok(v.REMOTE_COMMANDS.has('pause'));
  assert.ok(v.REMOTE_COMMANDS.has('next'));
  assert.ok(v.REMOTE_COMMANDS.has('add-to-queue'));
  assert.equal(v.REMOTE_COMMANDS.has('execute-arbitrary-code'), false);
});

// Guard against the whitelist drifting away from the verbs the front end
// actually emits. These are the commands the renderer sends via
// sendRemoteCommand(); every one must be accepted by the API or remote
// control silently breaks (this is exactly how remote volume regressed).
test('REMOTE_COMMANDS matches the verbs the renderer emits', () => {
  const emitted = [
    'play', 'pause', 'next', 'prev', 'shuffle',
    'play-track', 'play-playlist', 'play-index',
    'set-volume', 'set-output',
    'add-to-queue', 'add-tracks', 'shuffle-play', 'queue-set-all', 'clear',
  ];
  for (const cmd of emitted) {
    assert.ok(v.REMOTE_COMMANDS.has(cmd), `REMOTE_COMMANDS missing '${cmd}'`);
  }
});
