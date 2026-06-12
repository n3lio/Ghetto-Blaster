// Search query parser. Splits a free-text query into structured filters
// and a remaining "any-field" term, e.g.
//
//   `artist:NTM genre:rap year:2010..2015 banger`
//   → { filters: { artist: ['ntm'], genre: ['rap'], year: { from: 2010, to: 2015 } },
//       text: 'banger' }
//
// Supported keys:
//   artist:, album:, genre:, title:, year:, year:YYYY..YYYY
//
// Multiple occurrences of the same key OR together (artist:NTM artist:IAM
// matches either). Quoted values keep their spaces (`artist:"Daft Punk"`).
//
// `apply(query, library)` is the convenience that consumes a parsed query
// and returns matching tracks.

const KEYS = ['artist', 'album', 'genre', 'title'];

function parseQuery(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { filters: {}, text: '', year: null };
  }
  const filters = {};
  let year = null;
  const remaining = [];

  // Tokenize: respect quoted values, including the `key:"value with spaces"`
  // form that the simple `\S+|"..."` regex doesn't capture as a single unit.
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i >= input.length) break;
    let token = '';
    while (i < input.length && !/\s/.test(input[i])) {
      const ch = input[i];
      if (ch === '"') {
        // Eat a balanced quoted run (or to end of string if unbalanced).
        const end = input.indexOf('"', i + 1);
        if (end === -1) {
          token += input.substring(i); // unbalanced — take the rest
          i = input.length;
          break;
        }
        token += input.substring(i, end + 1);
        i = end + 1;
        continue;
      }
      token += ch;
      i++;
    }
    if (token) tokens.push(token);
  }

  for (const token of tokens) {
    const colon = token.indexOf(':');
    if (colon === -1) {
      remaining.push(token);
      continue;
    }
    const key = token.slice(0, colon).toLowerCase();
    const rawValue = token.slice(colon + 1);
    // Strip surrounding quotes if the original token wasn't quoted but the
    // value was (e.g. `artist:"Daft Punk"` is one token after the regex
    // above, but `artist:"a"` survives intact too).
    const value = rawValue.replace(/^"|"$/g, '');
    if (key === 'year') {
      const range = /^(\d{4})\.\.(\d{4})$/.exec(value);
      if (range) {
        year = { from: parseInt(range[1], 10), to: parseInt(range[2], 10) };
      } else if (/^\d{4}$/.test(value)) {
        const y = parseInt(value, 10);
        year = { from: y, to: y };
      } else {
        // Not a recognized year format — drop into free text.
        remaining.push(token);
      }
      continue;
    }
    if (KEYS.includes(key) && value) {
      filters[key] = filters[key] || [];
      filters[key].push(value.toLowerCase());
      continue;
    }
    // Unknown key — keep the whole token as free text.
    remaining.push(token);
  }

  return { filters, year, text: remaining.join(' ').toLowerCase().trim() };
}

function _matchAny(values, candidates) {
  if (!Array.isArray(values) || values.length === 0) return true;
  for (const v of values) {
    for (const c of candidates) {
      if (c && c.toLowerCase().includes(v)) return true;
    }
  }
  return false;
}

function applyQuery(parsed, library) {
  if (!Array.isArray(library)) return [];
  const compact = library.filter(Boolean);
  if (!parsed) return compact;
  const { filters = {}, year, text } = parsed;
  return compact.filter((t) => {
    if (filters.artist && !_matchAny(filters.artist, [t.artist].concat(t.artists || []))) return false;
    if (filters.album && !_matchAny(filters.album, [t.album])) return false;
    if (filters.genre && !_matchAny(filters.genre, [t.genre].concat(t.genres || []))) return false;
    if (filters.title && !_matchAny(filters.title, [t.title])) return false;
    if (year) {
      const y = parseInt(t.year, 10);
      if (!Number.isFinite(y)) return false;
      if (y < year.from || y > year.to) return false;
    }
    if (text) {
      const haystack = [t.title, t.artist, t.album, t.genre].filter(Boolean).join(' ').toLowerCase();
      // All free-text words must appear (AND).
      for (const word of text.split(/\s+/).filter(Boolean)) {
        if (!haystack.includes(word)) return false;
      }
    }
    return true;
  });
}

module.exports = { parseQuery, applyQuery };
