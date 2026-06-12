// Pure playlist helpers — no fs/state, so the resolution logic can be tested
// independently of the server.

function resolveSmartPlaylist(genreMatch, library, genreExclude) {
  if (!Array.isArray(genreMatch) || !Array.isArray(library)) return [];
  const include = genreMatch.map(g => String(g).toLowerCase());
  const exclude = Array.isArray(genreExclude)
    ? genreExclude.map(g => String(g).toLowerCase()).filter(Boolean)
    : [];
  return library
    .filter(t => {
      if (!t || !t.genre) return false;
      const g = t.genre.toLowerCase();
      // Include: any keyword from genreMatch must appear.
      if (!include.some(m => g.includes(m))) return false;
      // Exclude: if any exclude keyword appears, drop it. So "Hip-Hop US"
      // can match `Hip-Hop` but exclude `Rap Français` even though both
      // contain "rap". The exclude check wins over the include.
      if (exclude.length && exclude.some(m => g.includes(m))) return false;
      return true;
    })
    .map(t => t.id);
}

function resolveManualPlaylist(trackIds, library) {
  if (!Array.isArray(trackIds) || !Array.isArray(library)) return [];
  return trackIds.filter(id => Number.isInteger(id) && library[id] != null);
}

function resolvePlaylistTracks(playlist, library) {
  if (!playlist) return [];
  if (playlist.type === 'smart' && playlist.genreMatch) {
    return resolveSmartPlaylist(playlist.genreMatch, library, playlist.genreExclude);
  }
  return resolveManualPlaylist(playlist.trackIds || [], library);
}

// Reorder playlists by ID order, keeping unmatched playlists at the end so a
// partial reorder request can never accidentally drop entries.
function reorderPlaylists(playlists, order) {
  if (!Array.isArray(playlists) || !Array.isArray(order)) return playlists;
  const reordered = [];
  const byId = new Map(playlists.map(p => [p.id, p]));
  for (const id of order) {
    const pl = byId.get(id);
    if (pl) {
      reordered.push(pl);
      byId.delete(id);
    }
  }
  for (const pl of byId.values()) reordered.push(pl);
  return reordered;
}

// Smart shuffle: avoid consecutive same-artist plays where possible. Falls back
// to plain shuffle if the constraint can't be satisfied.
function smartShuffle(library, ids) {
  if (!Array.isArray(ids)) return [];
  const items = ids
    .filter(id => Number.isInteger(id) && library[id] != null)
    .map(id => ({ id, artist: (library[id].artist || 'Unknown').toLowerCase() }));
  // Plain Fisher-Yates first
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  // Single sweep: if neighbour shares artist, try to swap with the next
  // different-artist track within a small window.
  for (let i = 1; i < items.length; i++) {
    if (items[i].artist === items[i - 1].artist) {
      for (let j = i + 1; j < Math.min(items.length, i + 5); j++) {
        if (items[j].artist !== items[i - 1].artist
            && (i + 1 >= items.length || items[j].artist !== items[i + 1].artist)) {
          [items[i], items[j]] = [items[j], items[i]];
          break;
        }
      }
    }
  }
  return items.map(x => x.id);
}

module.exports = {
  resolveSmartPlaylist,
  resolveManualPlaylist,
  resolvePlaylistTracks,
  reorderPlaylists,
  smartShuffle,
};
