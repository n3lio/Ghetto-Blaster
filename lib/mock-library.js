// Generates a fake library so the UI / API can be exercised without any real
// audio files. Used only when `config.devMode` is on and the user explicitly
// hits `/api/_dev/library/seed`.
//
// The shape of each entry mirrors what the real scanner produces (see
// server-module.js scanDirectory), so any code that reads `library` won't
// notice the difference.

const ARTISTS = [
  ['Daft Punk', 'electronic', 'Random Access Memories'],
  ['Kendrick Lamar', 'hip-hop', 'To Pimp a Butterfly'],
  ['NTM', 'rap français', 'Suprême NTM'],
  ['Tame Impala', 'psychedelic rock', 'Currents'],
  ['Air', 'electronic', 'Moon Safari'],
  ['Bob Marley', 'reggae', 'Legend'],
  ['Radiohead', 'alternative', 'In Rainbows'],
  ['IAM', 'hip-hop', "L'École du Micro d'Argent"],
  ['Justice', 'electronic', '†'],
  ['Aretha Franklin', 'soul', 'I Never Loved a Man the Way I Love You'],
];

const TITLES = [
  'Intro', 'Get Lucky', 'Money Trees', 'Police', 'Let It Happen', 'La Femme d\'Argent',
  'Three Little Birds', 'Weird Fishes', 'Demain c\'est loin', 'D.A.N.C.E.',
  'Respect', 'Outro', 'Reckoner', 'Doing It Right', 'Alright', 'Pose ton gun',
  'New Person, Same Old Mistakes', 'Sexy Boy', 'Could You Be Loved', 'Genesis',
];

function pseudoRandom(seed) {
  let s = seed | 0;
  return function next() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Returns a sparse array shaped like the real library. We don't write any
// files to disk — track.path points to a fake location so anything that tries
// to actually stream the bytes will 404 (intentional: we're testing UI/API
// wiring, not playback).
function buildMockLibrary({ count = 200, seed = 1 } = {}) {
  const rand = pseudoRandom(seed);
  const lib = [];
  for (let i = 0; i < count; i++) {
    const [artist, genre, album] = ARTISTS[Math.floor(rand() * ARTISTS.length)];
    const title = TITLES[Math.floor(rand() * TITLES.length)] + ' #' + i;
    lib[i] = {
      id: i,
      // path inside an obviously-fake folder so the dev knows it's mock data
      // if they look at the disk.
      path: `/__mock__/${artist}/${album}/${i}.mp3`,
      filename: `${i}.mp3`,
      title,
      artist,
      albumArtist: artist,
      album,
      year: 2000 + Math.floor(rand() * 25),
      duration: 60 + Math.floor(rand() * 240),
      genre,
      hasCover: false,
    };
  }
  // Punch a couple of gaps to mimic a library where some files were deleted.
  if (count > 5) {
    delete lib[3];
    delete lib[7];
  }
  return lib;
}

function buildMockGenres(library) {
  const out = new Set();
  for (let i = 0; i < library.length; i++) {
    if (library[i] && library[i].genre) out.add(library[i].genre);
  }
  return out;
}

module.exports = { buildMockLibrary, buildMockGenres };
