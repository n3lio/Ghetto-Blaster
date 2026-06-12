// Radio mode — given a seed track, return a queue of "similar" tracks.
//
// Similarity heuristic (no ML, no external service):
//   - +3 points if the genre matches (substring, case-insensitive)
//   - +5 points if any artist from the seed matches (uses track.artists[]
//     when present, falls back to the raw artist string)
//   - +1 point if the year is within ±5 of the seed
//   - +1 point if same album-artist
//   - small random jitter so the order isn't deterministic across reloads
//
// Tracks scoring 0 are dropped, the rest are sorted descending and the
// first `limit` are returned (excluding the seed itself).

function _normaliseList(arrLike, fallbackString) {
  if (Array.isArray(arrLike) && arrLike.length > 0) {
    return arrLike.map(s => String(s).toLowerCase());
  }
  if (typeof fallbackString === 'string' && fallbackString.trim()) {
    return [fallbackString.toLowerCase()];
  }
  return [];
}

function genreScore(seed, candidate) {
  const seedG = _normaliseList(seed.genres, seed.genre);
  const candG = _normaliseList(candidate.genres, candidate.genre);
  for (const a of seedG) for (const b of candG) {
    if (a && b && (a.includes(b) || b.includes(a))) return 3;
  }
  return 0;
}

function artistScore(seed, candidate) {
  const seedA = _normaliseList(seed.artists, seed.artist);
  const candA = _normaliseList(candidate.artists, candidate.artist);
  for (const a of seedA) for (const b of candA) {
    if (a && b && a === b) return 5;
  }
  return 0;
}

function yearScore(seed, candidate) {
  const sy = parseInt(seed.year, 10);
  const cy = parseInt(candidate.year, 10);
  if (!Number.isFinite(sy) || !Number.isFinite(cy)) return 0;
  return Math.abs(sy - cy) <= 5 ? 1 : 0;
}

function albumArtistScore(seed, candidate) {
  if (seed.albumArtist && candidate.albumArtist
      && String(seed.albumArtist).toLowerCase() === String(candidate.albumArtist).toLowerCase()) {
    return 1;
  }
  return 0;
}

// `library` is the sparse array. Returns up to `limit` track ids.
function buildRadioQueue(seedTrackId, library, { limit = 50, jitter = true } = {}) {
  if (!Array.isArray(library)) return [];
  const seed = library[seedTrackId];
  if (!seed) return [];

  const scored = [];
  for (let i = 0; i < library.length; i++) {
    const t = library[i];
    if (!t || t.id === seed.id) continue;
    let score = 0;
    score += genreScore(seed, t);
    score += artistScore(seed, t);
    score += yearScore(seed, t);
    score += albumArtistScore(seed, t);
    if (score <= 0) continue;
    if (jitter) score += Math.random() * 0.5; // tiny tiebreaker
    scored.push({ id: t.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return [seed.id].concat(scored.slice(0, Math.max(0, limit - 1)).map(s => s.id));
}

module.exports = { buildRadioQueue, genreScore, artistScore, yearScore, albumArtistScore };
