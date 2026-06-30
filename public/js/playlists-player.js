// === playlists-player.js — slice of public/js/main.js (legacy monolith) ===
// This file is loaded by index.html in a specific order.
// Do not change the order without auditing dependencies.
// ─── Playlists ───────────────────────────────────────────────────────────────
// Playlist color palette (high contrast, on-brand)
var PL_COLORS = ['#e8a435','#c47a7a','#b68adf','#7ac47a','#5ba8e8','#e06b9f','#4dd4ac','#e05555','#8b5cf6','#f59e0b'];

function getPlaylistColor(pl, index) {
  // Match a playlist to its genre color by checking the playlist's first
  // genreMatch keyword (or its name as a fallback) against GENRE_COLORS.
  //
  // Why we only check `keyword.includes(matchTerm)` and NOT the reverse:
  // the previous `m.includes(kw)` shortcut hit a false positive — the
  // 'french rap' bucket contains the term 'french hip-hop', which
  // .includes('hip-hop') from the Hip-Hop playlist's first keyword. The
  // Hip-Hop playlist therefore ended up wearing the Rap FR blue instead
  // of the Hip-Hop purple. Strict directional match fixes that without
  // breaking the legit case (a playlist whose genreMatch contains 'rap'
  // still finds 'rap' in the GENRE_COLORS bucket terms).
  if (pl.genreMatch && pl.genreMatch.length) {
    var kw = pl.genreMatch[0].toLowerCase();
    for (var i = 0; i < GENRE_COLORS.length; i++) {
      if (GENRE_COLORS[i].match.some(function(m){ return kw.indexOf(m) !== -1; })) {
        return GENRE_COLORS[i].color;
      }
    }
  }
  // Match from the playlist name as a second-best signal.
  var nl = (pl.name || '').toLowerCase();
  for (var j = 0; j < GENRE_COLORS.length; j++) {
    if (GENRE_COLORS[j].match.some(function(m){ return nl.indexOf(m) !== -1; })) {
      return GENRE_COLORS[j].color;
    }
  }
  // Fallback: deterministic hash-based color.
  var hash = 0;
  for (var k = 0; k < (pl.name||'').length; k++) hash = ((hash << 5) - hash) + pl.name.charCodeAt(k);
  return PL_COLORS[Math.abs(hash + index) % PL_COLORS.length];
}

function renderPlaylists() {
  var view = document.getElementById('playlistsView');
  document.getElementById('playlistCount').textContent = playlists.length + ' playlist' + (playlists.length !== 1 ? 's' : '');
  // Always-on virtual 'All' playlist at the very top — accent-coloured icon,
  // not draggable, not deletable, not editable. Click 'Play' shuffles the
  // whole library (or hits the desktop via the remote command on mobile).
  var totalTracks = (typeof allTracks !== 'undefined' && Array.isArray(allTracks)) ? allTracks.length : 0;
  var allCardHtml = '<div class="playlist-card pl-all" data-id="__all__">'
    + '<div style="width:40px;height:40px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.1rem;font-weight:800;color:var(--bg);">★</div>'
    + '<div style="flex:1;min-width:0;margin-left:12px;">'
    +   '<div class="pl-name">All tracks</div>'
    +   '<div class="pl-count">' + totalTracks + ' tracks · whole library</div>'
    + '</div>'
    + '<div class="pl-actions"><button class="pl-btn play-pl" data-id="__all__">Play</button></div>'
    + '</div>';

  if (!playlists.length) {
    view.innerHTML = allCardHtml + '<p style="color:var(--text-muted);font-size:0.83rem;margin-top:14px;">No custom playlists yet.</p>';
  } else {
    view.innerHTML = allCardHtml + playlists.map(function(p, i) {
      var color = getPlaylistColor(p, i);
      var icon = '<div style="width:40px;height:40px;border-radius:8px;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.1rem;font-weight:700;color:#0a0a0b;">' + esc(p.name.charAt(0).toUpperCase()) + '</div>';
      return '<div class="playlist-card" draggable="true" data-id="' + p.id + '" data-idx="' + i + '">' + icon +
        '<div style="flex:1;min-width:0;margin-left:12px;"><div class="pl-name">' + esc(p.name) + '</div><div class="pl-count">' + p.trackCount + ' tracks</div></div>' +
        '<div class="pl-actions"><button class="pl-btn play-pl" data-id="' + p.id + '">Play</button><button class="pl-btn edit-pl" data-id="' + p.id + '">Edit</button><button class="pl-btn del" data-id="' + p.id + '">Delete</button></div></div>';
    }).join('');
  }

  // Drag & drop reorder
  var dragSrcIdx = null;
  view.querySelectorAll('.playlist-card').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      dragSrcIdx = parseInt(card.dataset.idx);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', function() { card.classList.remove('dragging'); });
    card.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('drag-over'); });
    card.addEventListener('dragleave', function() { card.classList.remove('drag-over'); });
    card.addEventListener('drop', function(e) {
      e.preventDefault();
      card.classList.remove('drag-over');
      var dropIdx = parseInt(card.dataset.idx);
      if (dragSrcIdx === null || dragSrcIdx === dropIdx) return;
      // Reorder
      var ids = playlists.map(function(p){ return p.id; });
      var moved = ids.splice(dragSrcIdx, 1)[0];
      ids.splice(dropIdx, 0, moved);
      api('/playlists/reorder', 'POST', { order: ids }).then(function() { fetchPlaylists(true); });
    });
  });

  view.querySelectorAll('.play-pl').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      // Special handling for the virtual 'All' playlist — no server lookup,
      // just shuffle the whole library directly.
      if (btn.dataset.id === '__all__') {
        if (!isDesktop && mobileMode === 'remote') {
          sendRemoteCommand('queue-set-all');
          document.querySelector('[data-tab="nowplaying"]').click(); scrollToCurrentInQueue();
          return;
        }
        var allIds = (allTracks || []).map(function(t){ return t.id; });
        if (!allIds.length) return;
        queue = smartShuffle(allIds);
        currentIndex = 0;
        playCurrentTrack();
        renderQueue();
        document.querySelector('[data-tab="nowplaying"]').click(); scrollToCurrentInQueue();
        return;
      }
      if (!isDesktop && mobileMode === 'remote') {
        // Remote: tell desktop to play this playlist
        sendRemoteCommand('play-playlist', { playlistId: btn.dataset.id });
        document.querySelector('[data-tab="nowplaying"]').click(); scrollToCurrentInQueue();
        return;
      }
      api('/playlists/' + btn.dataset.id).then(function(pl) {
        pl.tracks.forEach(cacheTrack);
        var ids = pl.tracks.map(function(t){ return t.id; });
        queue = smartShuffle(ids);
        currentIndex = 0;
        playCurrentTrack();
        renderQueue();
        document.querySelector('[data-tab="nowplaying"]').click(); scrollToCurrentInQueue();
      });
    });
  });

  view.querySelectorAll('.del').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (confirm('Delete this playlist?')) {
        api('/playlists/' + btn.dataset.id, 'DELETE').then(function() { fetchPlaylists(true); });
      }
    });
  });

  view.querySelectorAll('.edit-pl').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var plId = btn.dataset.id;
      api('/playlists/' + plId).then(function(pl) {
        // Open edit modal
        document.getElementById('editPlName').value = pl.name || '';
        var genreRow = document.getElementById('editPlGenreRow');
        var excludeRow = document.getElementById('editPlExcludeRow');
        var genreInput = document.getElementById('editPlGenres');
        var excludeInput = document.getElementById('editPlExcludes');
        if (pl.type === 'smart') {
          genreRow.style.display = '';
          if (excludeRow) excludeRow.style.display = '';
          genreInput.value = (pl.genreMatch || []).join(', ');
          if (excludeInput) excludeInput.value = (pl.genreExclude || []).join(', ');
        } else {
          genreRow.style.display = 'none';
          if (excludeRow) excludeRow.style.display = 'none';
          genreInput.value = '';
          if (excludeInput) excludeInput.value = '';
        }
        document.getElementById('editPlModal').classList.add('open');
        document.getElementById('editPlModal').dataset.plId = plId;
        document.getElementById('editPlModal').dataset.plType = pl.type || 'manual';
      });
    });
  });
}

// Playlist search filter
(function() {
  var plSearch = document.getElementById('playlistSearch');
  var plClear = document.getElementById('clearPlaylistSearch');
  var plSearchTimeout;
  plSearch.addEventListener('input', function() {
    clearTimeout(plSearchTimeout);
    plSearchTimeout = setTimeout(function() {
      var q = plSearch.value.trim().toLowerCase();
      plSearch.parentElement.classList.toggle('has-value', !!q);
      var cards = document.querySelectorAll('#playlistsView .playlist-card');
      cards.forEach(function(card) {
        var name = card.querySelector('.pl-name');
        var text = name ? name.textContent.toLowerCase() : '';
        card.style.display = text.includes(q) ? '' : 'none';
      });
    }, 150);
  });
  plClear.addEventListener('click', function() {
    plSearch.value = '';
    plSearch.parentElement.classList.remove('has-value');
    document.querySelectorAll('#playlistsView .playlist-card').forEach(function(c) { c.style.display = ''; });
  });
})();

// Create playlist
document.getElementById('createPlaylistBtn').addEventListener('click', function() {
  document.getElementById('playlistModal').classList.add('open');
  document.getElementById('plName').value = '';
  document.getElementById('plKeywords').value = '';
});
document.getElementById('plCancel').addEventListener('click', function() { document.getElementById('playlistModal').classList.remove('open'); });
document.getElementById('playlistModal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });

document.getElementById('plCreate').addEventListener('click', async function() {
  var name = document.getElementById('plName').value.trim();
  if (!name) return alert('Give your playlist a name');
  var body = { name: name };
  var kw = document.getElementById('plKeywords').value.trim();
  if (kw) body.keywords = kw;
  else if (queue.length) body.trackIds = queue;
  else return alert('Enter keywords or have tracks in your queue');
  var r = await api('/playlists', 'POST', body);
  if (r.ok) { document.getElementById('playlistModal').classList.remove('open'); fetchPlaylists(true); }
  else alert(r.error || 'Error');
});

// Edit playlist modal
document.getElementById('editPlCancel').addEventListener('click', function() { document.getElementById('editPlModal').classList.remove('open'); });
document.getElementById('editPlModal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
document.getElementById('editPlSave').addEventListener('click', async function() {
  var modal = document.getElementById('editPlModal');
  var plId = modal.dataset.plId;
  var plType = modal.dataset.plType;
  var name = document.getElementById('editPlName').value.trim();
  if (!name) return;
  var body = { name: name };
  if (plType === 'smart') {
    var genres = document.getElementById('editPlGenres').value.trim();
    if (genres) body.genreMatch = genres.split(',').map(function(g){ return g.trim().toLowerCase(); }).filter(Boolean);
    // Empty exclude string clears the list — we send [] explicitly so the
    // server PUT handler resets the field rather than leaving the old
    // exclusions in place.
    var excludesRaw = (document.getElementById('editPlExcludes') || {}).value;
    if (excludesRaw != null) {
      var excludes = String(excludesRaw).trim();
      body.genreExclude = excludes
        ? excludes.split(',').map(function(g){ return g.trim().toLowerCase(); }).filter(Boolean)
        : [];
    }
  }
  var r = await api('/playlists/' + plId, 'PUT', body);
  if (r.ok) { modal.classList.remove('open'); fetchPlaylists(true); showToast('Playlist updated'); }
  else showToast(r.error || 'Error');
});

// ─── Now Playing Cover ───────────────────────────────────────────────────────
var lastHeroTrackId = null;
var HERO_PH = '<div class="ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';

function updateNowPlayingHero() {
  var trackId, track;

  if (!isDesktop && mobileMode === 'remote' && lastDesktopState) {
    trackId = lastDesktopState.trackId;
    track = { hasCover: lastDesktopState.hasCover };
  } else {
    trackId = queue[currentIndex];
    track = getTrack(trackId);
  }

  if (trackId !== lastHeroTrackId) {
    lastHeroTrackId = trackId;
    var cover = document.getElementById('npCover');
    if (track && track.hasCover && trackId != null) {
      cover.innerHTML = '<img src="' + coverUrl(trackId) + '">';
      // Ambient background: extract cover colors
      updateCoverAmbient(coverUrl(trackId));
    } else {
      cover.innerHTML = HERO_PH;
      clearCoverAmbient();
    }
  }
}

// Save current queue as playlist
document.getElementById('saveQueueAsPlaylist').addEventListener('click', function() {
  if (!queue.length) return showToast('Queue is empty');
  var name = prompt('Playlist name:');
  if (!name) return;
  api('/playlists', 'POST', { name: name, trackIds: queue }).then(function(r) {
    if (r.ok) { showToast('Playlist "' + name + '" saved (' + queue.length + ' tracks)'); fetchPlaylists(true); }
    else alert(r.error || 'Error');
  });
});

// ─── Audio Playback ──────────────────────────────────────────────────────────
function playCurrentTrack() {
  if (currentIndex < 0 || currentIndex >= queue.length) return;
  var trackId = queue[currentIndex];
  var track = getTrack(trackId);

  // Ensure AudioContext is resumed (needed for playback through viz pipeline)
  if (viz && viz.audioCtx && viz.audioCtx.state === 'suspended') viz.audioCtx.resume();

  audio.src = streamUrl(trackId);
  audio.load();
  audio.play().then(function() {
    isPlaying = true;
    updatePlayBtn();
  }).catch(function(e) {
    console.warn('play() failed, retrying:', e.message);
    // Retry once after a short delay (autoplay policy or load timing)
    setTimeout(function() {
      audio.play().then(function() { isPlaying = true; updatePlayBtn(); }).catch(function(){});
    }, 200);
  });
  isPlaying = true;

  // Log to history
  fetch('/api/history/log', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ trackId: trackId }) }).catch(function(){});

  updateNowPlayingHero();
  if (viz) {
    viz.setTrack(track ? track.title : '', track ? track.artist : '');
    viz.setCoverColors(track && track.hasCover ? coverUrl(track.id) : null);
  }

  // Update player bar
  document.getElementById('playerTitle').textContent = track ? track.title : 'Unknown';
  document.getElementById('playerArtist').textContent = track ? track.artist : '';
  document.getElementById('totalTime').textContent = track ? formatTime(track.duration) : '0:00';

  // Update Now Playing track info overlay
  document.getElementById('npTrackTitle').textContent = track ? track.title : '';
  document.getElementById('npTrackArtist').textContent = track ? track.artist : '';
  // Build meta: album line + genre line (separate)
  var metaEl = document.getElementById('npTrackMeta');
  if (track) {
    var html = '';
    var album = track.album && track.album !== 'Unknown' && track.album !== '' ? track.album : '';
    var albumArtist = track.albumArtist || '';
    // Extract 4-digit year from various formats (20201002, 2020-10-02, 2020, etc.)
    var yearStr = track.year ? String(track.year).match(/^\d{4}/)?.[0] || '' : '';
    // Skip album line if album = title AND albumArtist = artist (single/self-titled)
    var skipAlbum = album && album === track.title && (!albumArtist || albumArtist === track.artist);
    if (album && !skipAlbum) {
      var albumStr = album;
      if (albumArtist && albumArtist !== track.artist) albumStr += ' — ' + albumArtist;
      if (yearStr) albumStr += ' (' + yearStr + ')';
      html += '<div>' + esc(albumStr) + '</div>';
    } else if (yearStr) {
      html += '<div>' + yearStr + '</div>';
    }
    if (track.genre) {
      var gs = getGenreStyle(track.genre);
      html += '<span class="np-genre-tag" style="' + gs + '">' + esc(track.genre) + '</span>';
    }
    metaEl.innerHTML = html;
  } else {
    metaEl.innerHTML = '';
  }

  var cover = document.getElementById('playerCover');
  if (track && track.hasCover) {
    cover.innerHTML = '<img src="' + coverUrl(trackId) + '">';
  } else {
    cover.innerHTML = '<div class="ph">' + PLACEHOLDER_SVG + '</div>';
  }

  updatePlayBtn();
  highlightPlaying();
}

function updatePlayBtn() {
  var svg = isPlaying
    ? '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>';
  document.getElementById('playPauseBtn').innerHTML = svg;
  updateNowPlayingHero();
}

function highlightPlaying() {
  document.querySelectorAll('.track-item').forEach(function(el) {
    var id = el.dataset.id ? parseInt(el.dataset.id) : -1;
    var qi = el.dataset.qindex !== undefined ? parseInt(el.dataset.qindex) : -1;
    el.classList.toggle('playing', (id >= 0 && id === queue[currentIndex]) || qi === currentIndex);
  });
}

audio.addEventListener('timeupdate', function() {
  if (!audio.duration) return;
  document.getElementById('progressFill').style.width = (audio.currentTime / audio.duration * 100) + '%';
  document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
});

audio.addEventListener('ended', function() {
  if (currentIndex < queue.length - 1) {
    currentIndex++;
    playCurrentTrack();
    renderQueue();
  } else {
    isPlaying = false;
    updatePlayBtn();
  }
});

// ─── Player bar cover click → open Now Playing ──────────────────────────────
document.getElementById('playerCover').addEventListener('click', function() {
  document.querySelector('[data-tab="nowplaying"]').click();
});
document.getElementById('playerCover').style.cursor = 'pointer';

// ─── Controls ────────────────────────────────────────────────────────────────
document.getElementById('playPauseBtn').addEventListener('click', function() {
  if (!isDesktop && mobileMode === 'remote') {
    // Remote: toggle desktop
    var cmd = (lastDesktopState && lastDesktopState.isPlaying) ? 'pause' : 'play';
    sendRemoteCommand(cmd);
    return;
  }
  if (!audio.src || queue.length === 0) return;
  if (audio.paused) { audio.play(); isPlaying = true; }
  else { audio.pause(); isPlaying = false; }
  updatePlayBtn();
});

document.getElementById('nextBtn').addEventListener('click', function() {
  if (!isDesktop && mobileMode === 'remote') { sendRemoteCommand('next'); return; }
  if (currentIndex < queue.length - 1) { currentIndex++; playCurrentTrack(); renderQueue(); }
});

document.getElementById('prevBtn').addEventListener('click', function() {
  if (!isDesktop && mobileMode === 'remote') { sendRemoteCommand('prev'); return; }
  if (audio.currentTime > 3) { audio.currentTime = 0; }
  else if (currentIndex > 0) { currentIndex--; playCurrentTrack(); renderQueue(); }
});

// ─── Smart Shuffle: spaces artists, varies genres, avoids repeats ────────────
function smartShuffle(ids) {
  if (ids.length < 3) return ids;
  // Build track info map
  var items = ids.map(function(id) { var t = getTrack(id); return { id: id, artist: t ? t.artist : '', genre: t ? (t.genre || '') : '' }; });

  // Weighted random pick that penalizes recent artists/genres
  var result = [];
  var remaining = items.slice();
  var recentArtists = [];
  var recentGenres = [];
  var ARTIST_COOLDOWN = Math.min(8, Math.floor(ids.length / 10) + 2);
  var GENRE_COOLDOWN = Math.min(4, Math.floor(ids.length / 20) + 1);

  while (remaining.length > 0) {
    // Score each candidate
    var scores = remaining.map(function(item) {
      var score = 1;
      // Penalize if same artist was recent
      var artistIdx = recentArtists.indexOf(item.artist);
      if (artistIdx >= 0) score *= 0.05 * (artistIdx + 1) / ARTIST_COOLDOWN;
      // Penalize if same genre was recent
      var genreIdx = recentGenres.indexOf(item.genre);
      if (genreIdx >= 0 && item.genre) score *= 0.3 * (genreIdx + 1) / GENRE_COOLDOWN;
      return score;
    });

    // Weighted random selection
    var totalWeight = scores.reduce(function(s, v) { return s + v; }, 0);
    var pick = Math.random() * totalWeight;
    var chosen = 0;
    for (var i = 0; i < scores.length; i++) {
      pick -= scores[i];
      if (pick <= 0) { chosen = i; break; }
    }

    var item = remaining[chosen];
    result.push(item.id);
    remaining.splice(chosen, 1);

    // Update recency
    recentArtists.unshift(item.artist);
    if (recentArtists.length > ARTIST_COOLDOWN) recentArtists.pop();
    if (item.genre) {
      recentGenres.unshift(item.genre);
      if (recentGenres.length > GENRE_COOLDOWN) recentGenres.pop();
    }
  }
  return result;
}

document.getElementById('shuffleBtn').addEventListener('click', function() {
  if (!isDesktop && mobileMode === 'remote') { sendRemoteCommand('shuffle'); return; }
  if (queue.length < 2) return;
  var before = queue.slice(0, currentIndex + 1);
  var after = smartShuffle(queue.slice(currentIndex + 1));
  queue = before.concat(after);
  renderQueue();
});

document.getElementById('shuffleQueue').addEventListener('click', function() {
  if (!isDesktop && mobileMode === 'remote') { sendRemoteCommand('shuffle'); return; }
  queue = smartShuffle(queue);
  currentIndex = 0;
  if (queue.length) playCurrentTrack();
  renderQueue();
});

document.getElementById('clearQueue').addEventListener('click', function() {
  if (!isDesktop && mobileMode === 'remote') {
    sendRemoteCommand('clear');
    return;
  }
  queue = []; currentIndex = -1;
  audio.pause(); audio.removeAttribute('src');
  isPlaying = false; updatePlayBtn();
  document.getElementById('playerTitle').textContent = 'Ghetto Blaster';
  document.getElementById('playerArtist').textContent = 'Select a track to play';
  document.getElementById('playerCover').innerHTML = '<div class="ph">' + PLACEHOLDER_SVG + '</div>';
  renderQueue();
});

document.getElementById('progressBar').addEventListener('click', function(e) {
  if (!audio.duration) return;
  var rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

document.getElementById('volumeSlider').addEventListener('input', function(e) {
  var vol = parseFloat(e.target.value);
  if (!isDesktop && mobileMode === 'remote') {
    sendRemoteCommand('set-volume', { volume: vol });
  } else {
    audio.volume = vol;
    // Persist volume preference
    if (isDesktop && window.resonance) window.resonance.setConfig({ volume: vol });
  }
});

// Play All (smart shuffle all)
document.getElementById('playAll').addEventListener('click', function() {
  if (!tracks.length) return;
  if (!isDesktop && mobileMode === 'remote') {
    // Remote mode: send shuffle command with current filtered track IDs
    var ids = tracks.map(function(t){ return t.id; });
    sendRemoteCommand('shuffle-play', { trackIds: ids });
    document.querySelector('[data-tab="nowplaying"]').click();
    return;
  }
  queue = smartShuffle(tracks.map(function(t){ return t.id; }));
  currentIndex = 0;
  playCurrentTrack();
  renderQueue();
  document.querySelector('[data-tab="nowplaying"]').click(); scrollToCurrentInQueue();
});

// ─── Fuzzy Search (client-side, all words must match) ────────────────────────
// allTracks is now declared in base.js — re-declaring here would reset it
// to [] long after fetchTracks() populated it, which silently broke every
// library view (Tracks/Albums/Artists/Years/Genres) and every filter.

// Search-bar query operators. Tokens of the form `key:value` (or
// `key:"value with spaces"`) become structured filters on a specific
// field; everything else is free text matched fuzzily across
// title/artist/album/genre. Year supports a single year or a range:
// `year:2015`, `year:2010..2015`. Quoted values keep their spaces:
// `genre:"hip hop"`, `artist:"Daft Punk"`.
//
// Without this, clicking a tile in the Years/Genres views (which
// stamps `year:2021` into the search box) returned an empty list
// because the legacy fuzzy filter looked for the literal string
// 'year:2021' inside the track haystack.
function _gbParseSearch(query) {
  var filters = { year: null, artists: [], albums: [], genres: [], titles: [] };
  var freeWords = [];
  if (!query) return { filters: filters, free: freeWords };
  // Tokenize while honouring `key:"quoted value"` and standalone "quoted".
  var tokens = [];
  var i = 0;
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) i++;
    if (i >= query.length) break;
    var tok = '';
    while (i < query.length && !/\s/.test(query[i])) {
      var ch = query[i];
      if (ch === '"') {
        var end = query.indexOf('"', i + 1);
        if (end === -1) { tok += query.substring(i); i = query.length; break; }
        tok += query.substring(i, end + 1);
        i = end + 1;
        continue;
      }
      tok += ch;
      i++;
    }
    if (tok) tokens.push(tok);
  }
  for (var t = 0; t < tokens.length; t++) {
    var tk = tokens[t];
    var colon = tk.indexOf(':');
    if (colon === -1) { freeWords.push(tk.toLowerCase()); continue; }
    var key = tk.slice(0, colon).toLowerCase();
    var raw = tk.slice(colon + 1).replace(/^"|"$/g, '');
    var val = raw.toLowerCase();
    if (key === 'year') {
      var m = /^(\d{4})\.\.(\d{4})$/.exec(val);
      if (m) filters.year = { from: parseInt(m[1], 10), to: parseInt(m[2], 10) };
      else if (/^\d{4}$/.test(val)) {
        var y = parseInt(val, 10); filters.year = { from: y, to: y };
      } else freeWords.push(tk.toLowerCase());
    } else if (key === 'artist' && val) filters.artists.push(val);
    else if (key === 'album' && val) filters.albums.push(val);
    else if (key === 'genre' && val) filters.genres.push(val);
    else if (key === 'title' && val) filters.titles.push(val);
    else freeWords.push(tk.toLowerCase());
  }
  return { filters: filters, free: freeWords };
}

function fuzzyFilter(query) {
  if (!query) return allTracks;
  var parsed = _gbParseSearch(query);
  var f = parsed.filters;
  return allTracks.filter(function(t) {
    if (f.year) {
      var ys = String(t.year || '').match(/^\d{4}/);
      if (!ys) return false;
      var yn = parseInt(ys[0], 10);
      if (yn < f.year.from || yn > f.year.to) return false;
    }
    if (f.artists.length) {
      var artists = [(t.artist || '').toLowerCase()].concat((t.artists || []).map(function(a){ return String(a).toLowerCase(); }));
      var hit = f.artists.some(function(v) { return artists.some(function(a) { return a.indexOf(v) !== -1; }); });
      if (!hit) return false;
    }
    if (f.albums.length) {
      var alb = (t.album || '').toLowerCase();
      if (!f.albums.some(function(v) { return alb.indexOf(v) !== -1; })) return false;
    }
    if (f.genres.length) {
      var genres = [(t.genre || '').toLowerCase()].concat((t.genres || []).map(function(g){ return String(g).toLowerCase(); }));
      if (!f.genres.some(function(v) { return genres.some(function(g) { return g.indexOf(v) !== -1; }); })) return false;
    }
    if (f.titles.length) {
      var ti = (t.title || '').toLowerCase();
      if (!f.titles.some(function(v) { return ti.indexOf(v) !== -1; })) return false;
    }
    if (parsed.free.length) {
      var hay = ((t.title || '') + ' ' + (t.artist || '') + ' ' + (t.album || '') + ' ' + (t.genre || '')).toLowerCase();
      if (!parsed.free.every(function(w) { return hay.indexOf(w) !== -1; })) return false;
    }
    return true;
  });
}

var searchTimeout;

function applyFilters() {
  var q = document.getElementById('search').value.trim();
  var genre = document.getElementById('genreFilter').value;
  var filtered = fuzzyFilter(q);

  if (genre) {
    if (genre.startsWith('group:')) {
      // Super-group: match any keyword from the group
      var groupName = genre.slice(6);
      var group = GENRE_GROUPS.find(function(g){ return g.label === groupName; });
      if (group) {
        filtered = filtered.filter(function(t) {
          if (!t.genre) return false;
          var gl = t.genre.toLowerCase();
          return group.match.some(function(m) { return gl.includes(m); });
        });
      }
    } else {
      var gl = genre.toLowerCase();
      filtered = filtered.filter(function(t) { return t.genre && t.genre.toLowerCase().includes(gl); });
    }
  }
  // Sort
  var sort = document.getElementById('sortSelect').value;
  filtered.sort(function(a, b) {
    switch(sort) {
      case 'title': return (a.title||'').localeCompare(b.title||'');
      case 'title-desc': return (b.title||'').localeCompare(a.title||'');
      case 'artist': return (a.artist||'').localeCompare(b.artist||'');
      case 'album': return (a.album||'').localeCompare(b.album||'');
      case 'duration': return (a.duration||0) - (b.duration||0);
      case 'duration-desc': return (b.duration||0) - (a.duration||0);
      default: return 0;
    }
  });

  tracks = filtered;
  // Re-render current view (not just tracks)
  if (currentLibView === 'albums') renderAlbums();
  else if (currentLibView === 'artists') renderArtists();
  else renderTracks();
  // Update inline clear buttons visibility + genre highlight
  var searchWrap = document.getElementById('search').parentElement;
  var genreWrap = document.getElementById('genreFilter').parentElement;
  searchWrap.classList.toggle('has-value', !!q);
  genreWrap.classList.toggle('has-value', !!genre);
  document.getElementById('genreFilter').classList.toggle('active', !!genre);
}

document.getElementById('sortSelect').addEventListener('change', applyFilters);

// Inline clear: search
document.getElementById('clearSearch').addEventListener('click', function() {
  document.getElementById('search').value = '';
  applyFilters();
});

// Inline clear: genre
document.getElementById('clearGenre').addEventListener('click', function() {
  document.getElementById('genreFilter').value = '';
  applyFilters();
});

document.getElementById('search').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(applyFilters, 200);
});

// ─── Keyboard ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); document.getElementById('playPauseBtn').click(); }
  if (e.code === 'ArrowRight') document.getElementById('nextBtn').click();
  if (e.code === 'ArrowLeft') document.getElementById('prevBtn').click();
});

// ─── Cover Ambient Background ────────────────────────────────────────────────
var ambientCanvas = document.getElementById('npCoverAmbient');
var ambientCtx = ambientCanvas ? ambientCanvas.getContext('2d') : null;

function updateCoverAmbient(coverUrl) {
  if (!ambientCtx) return;
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
    // Draw tiny version to extract colors
    ambientCanvas.width = 4;
    ambientCanvas.height = 4;
    ambientCtx.drawImage(img, 0, 0, 4, 4);
    ambientCanvas.style.opacity = '1';
    // Scale up via CSS for the blur effect
    ambientCanvas.style.width = '100%';
    ambientCanvas.style.height = '100%';
  };
  img.src = coverUrl;
}

function clearCoverAmbient() {
  if (!ambientCtx) return;
  ambientCtx.clearRect(0, 0, 4, 4);
  ambientCanvas.style.opacity = '0';
}

