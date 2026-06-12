// Splits multi-value tag strings (artists, genres) on the separators that
// show up most often in real-world libraries. Conservative on artist names
// (we don't split on "&" because of bands like "Earth, Wind & Fire").
//
// The splitters are intentionally additive: the original string is also
// preserved on the track, so any UI that wants the raw form can use it.

const ARTIST_SEPARATORS = /\s*(?:,|;|\sfeat\.?\s|\sft\.?\s|\swith\s|\svs\.?\s|\bx\b|\/|·|×)\s*/gi;
const GENRE_SEPARATORS = /\s*(?:,|;|\/|·|\|)\s*/g;

function dedupeKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function splitArtistTag(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const parts = value.split(ARTIST_SEPARATORS).map((p) => p.trim()).filter(Boolean);
  return dedupeKeepOrder(parts);
}

function splitGenreTag(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const parts = value.split(GENRE_SEPARATORS).map((p) => p.trim()).filter(Boolean);
  return dedupeKeepOrder(parts);
}

module.exports = { splitArtistTag, splitGenreTag };
