// === tracks-queue.js — slice of public/js/main.js (legacy monolith) ===
// This file is loaded by index.html in a specific order.
// Do not change the order without auditing dependencies.
// ─── Render Tracks (lazy — render in batches for performance) ────────────────
var BATCH_SIZE = 80;
var renderedCount = 0;
var loadingMore = false;

function renderTracks() {
  var list = document.getElementById('trackList');
  var scanText = document.getElementById('scanIndicator').style.display !== 'none' ? ' (scanning...)' : '';
  document.getElementById('trackCount').textContent = tracks.length + ' track' + (tracks.length !== 1 ? 's' : '') + scanText;
  renderedCount = 0;
  list.innerHTML = '';
  appendTrackBatch(list);
}

function appendTrackBatch(list) {
  if (renderedCount >= tracks.length) return;
  var end = Math.min(renderedCount + BATCH_SIZE, tracks.length);
  var html = '';
  for (var i = renderedCount; i < end; i++) {
    var t = tracks[i];
    var coverHtml = t.hasCover
      ? '<div class="track-cover"><img src="' + coverUrl(t.id) + '" loading="lazy"></div>'
      : '<div class="track-cover"><div class="ph">' + PLACEHOLDER_SVG + '</div></div>';
    html += '<div class="track-item" data-id="' + t.id + '">' +
      coverHtml +
      '<div class="track-info"><div class="track-title">' + esc(t.title) + '</div><div class="track-artist">' + esc(t.artist) + '</div></div>' +
      (t.genre ? '<span class="track-genre" style="' + getGenreStyle(t.genre) + '">' + esc(t.genre) + '</span>' : '') +
      '<span class="track-duration">' + formatTime(t.duration) + '</span>' +
      '<button class="fav-btn ' + (t.favorited ? 'liked' : '') + '" data-id="' + t.id + '" title="Favorite">&#9829;</button>' +
      '<button class="add-btn" data-id="' + t.id + '" title="Add to queue">+</button>' +
    '</div>';
  }
  var frag = document.createElement('div');
  frag.innerHTML = html;
  while (frag.firstChild) list.appendChild(frag.firstChild);
  renderedCount = end;
  loadingMore = false;
}

// Infinite scroll — load more when near bottom
(function() {
  var list = document.getElementById('trackList');
  list.addEventListener('scroll', function() {
    if (loadingMore) return;
    if (renderedCount >= tracks.length) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
      loadingMore = true;
      appendTrackBatch(list);
    }
  });
})();

// Event delegation for track clicks (no per-element listeners)
document.getElementById('trackList').addEventListener('click', function(e) {
  // Favorite toggle
  var favBtn = e.target.closest('.fav-btn');
  if (favBtn) {
    e.stopPropagation();
    var favId = parseInt(favBtn.dataset.id);
    api('/favorites/toggle', 'POST', { trackId: favId }).then(function(r) {
      favBtn.classList.toggle('liked', r.favorited);
      var t = getTrack(favId); if (t) t.favorited = r.favorited;
    });
    return;
  }
  var addBtn = e.target.closest('.add-btn');
  if (addBtn) {
    e.stopPropagation();
    var addId = parseInt(addBtn.dataset.id);
    if (!isDesktop && mobileMode === 'remote') {
      remoteAddToQueue(addId);
      showToast('Added to server queue');
    } else {
      queue.push(addId);
      renderQueue();
    }
    return;
  }
  var item = e.target.closest('.track-item');
  if (!item) return;
  var id = parseInt(item.dataset.id);

  if (!isDesktop && mobileMode === 'remote') {
    // Remote mode: play on desktop
    remotePlayTrack(id);
  } else {
    // Local play
    var idx = tracks.findIndex(function(t){ return t.id === id; });
    queue = tracks.map(function(t){ return t.id; });
    currentIndex = idx >= 0 ? idx : 0;
    playCurrentTrack();
    renderQueue();
    document.querySelector('[data-tab="nowplaying"]').click(); scrollToCurrentInQueue();
  }
});

// ─── Remote Queue Data (fetched once, updated on change) ────────────────────
var remoteQueueData = [];
var remoteQueueRendered = 0;

var remoteQueueRetries = 0;
function fetchRemoteQueue() {
  fetch('/api/desktop/queue').then(function(r){ return r.json(); }).then(function(data) {
    remoteQueueData = data || [];
    lastQueueHash = ''; // force re-render
    renderQueue();
    // Retry if empty but desktop reports tracks (up to 5 retries)
    if (!remoteQueueData.length && lastDesktopState && lastDesktopState.queueLength > 0 && remoteQueueRetries < 5) {
      remoteQueueRetries++;
      setTimeout(fetchRemoteQueue, 1500);
    } else {
      remoteQueueRetries = 0;
    }
  }).catch(function(){});
}

function appendRemoteQueueBatch(list, sci) {
  var end = Math.min(remoteQueueRendered + 60, remoteQueueData.length);
  var html = '';
  for (var i = remoteQueueRendered; i < end; i++) {
    var t = remoteQueueData[i];
    var realIdx = t.qindex != null ? t.qindex : i;
    var coverHtml = t.hasCover
      ? '<div class="track-cover"><img src="' + coverUrl(t.id) + '" loading="lazy"></div>'
      : '<div class="track-cover"><div class="ph">' + PLACEHOLDER_SVG + '</div></div>';
    html += '<div class="track-item ' + (realIdx === sci ? 'playing' : '') + '" data-rindex="' + realIdx + '">' +
      coverHtml +
      '<div class="track-info"><div class="track-title">' + esc(t.title) + '</div><div class="track-artist">' + esc(t.artist) + '</div></div>' +
      (t.genre ? '<span class="track-genre" style="' + getGenreStyle(t.genre) + '">' + esc(t.genre) + '</span>' : '') +
      '<span class="track-duration">' + formatTime(t.duration) + '</span>' +
    '</div>';
  }
  var frag = document.createElement('div');
  frag.innerHTML = html;
  while (frag.firstChild) list.appendChild(frag.firstChild);
  remoteQueueRendered = end;
}

// ─── Render Queue ────────────────────────────────────────────────────────────
var lastQueueHash = '';
var queueRenderedCount = 0;
var QUEUE_BATCH = 60;

function renderQueue() {
  var list = document.getElementById('queueList');
  var countEl = document.getElementById('queueCount');

  // On mobile Remote mode, show the server queue
  if (!isDesktop && mobileMode === 'remote') {
    var sci = lastDesktopState ? lastDesktopState.currentIndex || 0 : 0;
    var qLen = lastDesktopState ? lastDesktopState.queueLength || 0 : 0;
    countEl.textContent = qLen ? '(' + qLen + ')' : '';

    if (!remoteQueueData.length) {
      list.innerHTML = '<div style="padding:24px;color:var(--text-dim);font-size:0.83rem;text-align:center;">Server queue is empty</div>';
      return;
    }

    // Only full re-render if queue data changed
    var newHash = remoteQueueData.length + ':' + (remoteQueueData[0] ? remoteQueueData[0].id : '');
    if (newHash === lastQueueHash) {
      // Ensure current track is rendered (lazy load more batches if needed)
      while (sci >= remoteQueueRendered && remoteQueueRendered < remoteQueueData.length) {
        appendRemoteQueueBatch(list, sci);
      }
      // Update highlight
      var items = list.querySelectorAll('.track-item');
      items.forEach(function(el) {
        var ri = parseInt(el.dataset.rindex);
        el.classList.toggle('playing', ri === sci);
      });
      scrollToCurrentInQueue();
      return;
    }
    lastQueueHash = newHash;

    // Lazy render server queue — render batches until current track is included
    remoteQueueRendered = 0;
    list.innerHTML = '';
    appendRemoteQueueBatch(list, sci);
    while (sci >= remoteQueueRendered && remoteQueueRendered < remoteQueueData.length) {
      appendRemoteQueueBatch(list, sci);
    }
    scrollToCurrentInQueue();
    return;
  }

  // Local queue (desktop always, or mobile in Stream mode)
  lastQueueHash = '';
  countEl.textContent = queue.length ? '(' + queue.length + ')' : '';
  if (!queue.length) {
    list.innerHTML = '<div style="padding:24px;color:var(--text-dim);font-size:0.83rem;text-align:center;">Queue is empty — pick a track!</div>';
    return;
  }

  // Lazy render queue — ensure current track is always rendered
  queueRenderedCount = 0;
  list.innerHTML = '';
  appendQueueBatch(list);
  // Keep rendering batches until current track is visible
  while (currentIndex >= queueRenderedCount && queueRenderedCount < queue.length) {
    appendQueueBatch(list);
  }
  // Auto-scroll to current track
  scrollToCurrentInQueue();
}

function appendQueueBatch(list) {
  if (queueRenderedCount >= queue.length) return;
  var end = Math.min(queueRenderedCount + QUEUE_BATCH, queue.length);
  var html = '';
  for (var i = queueRenderedCount; i < end; i++) {
    var t = getTrack(queue[i]) || { id: queue[i], title: 'Unknown', artist: '', hasCover: false, duration: 0, genre: null };
    var coverHtml = t.hasCover
      ? '<div class="track-cover"><img src="' + coverUrl(t.id) + '" loading="lazy"></div>'
      : '<div class="track-cover"><div class="ph">' + PLACEHOLDER_SVG + '</div></div>';
    html += '<div class="track-item ' + (i === currentIndex ? 'playing' : '') + '" data-qindex="' + i + '">' +
      coverHtml +
      '<div class="track-info"><div class="track-title">' + esc(t.title) + '</div><div class="track-artist">' + esc(t.artist) + '</div></div>' +
      (t.genre ? '<span class="track-genre" style="' + getGenreStyle(t.genre) + '">' + esc(t.genre) + '</span>' : '') +
      '<span class="track-duration">' + formatTime(t.duration) + '</span>' +
    '</div>';
  }
  var frag = document.createElement('div');
  frag.innerHTML = html;
  while (frag.firstChild) list.appendChild(frag.firstChild);
  queueRenderedCount = end;
}

// Queue infinite scroll
(function() {
  var list = document.getElementById('queueList');
  list.addEventListener('scroll', function() {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
      if (!isDesktop && mobileMode === 'remote') {
        if (remoteQueueRendered < remoteQueueData.length) {
          var sci = lastDesktopState ? lastDesktopState.currentIndex || 0 : 0;
          appendRemoteQueueBatch(list, sci);
        }
      } else {
        if (queueRenderedCount < queue.length) appendQueueBatch(list);
      }
    }
  });
})();

// Scroll queue to current track
function scrollToCurrentInQueue() {
  setTimeout(function() {
    var playing = document.querySelector('#queueList .track-item.playing');
    if (playing) playing.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 100);
}

// Queue click delegation
document.getElementById('queueList').addEventListener('click', function(e) {
  var item = e.target.closest('.track-item');
  if (!item) return;
  // Remote queue click → tell desktop to play that index
  if (item.dataset.rindex != null && !isDesktop && mobileMode === 'remote') {
    sendRemoteCommand('play-index', { index: parseInt(item.dataset.rindex) });
    return;
  }
  // Local queue click
  if (item.dataset.qindex != null) {
    currentIndex = parseInt(item.dataset.qindex);
    playCurrentTrack();
    renderQueue();
  }
});

// ─── Genre Filter ────────────────────────────────────────────────────────────
// Genre super-groups (match any genre containing these keywords)
var GENRE_GROUPS = [
  { label: 'Hip-Hop', match: ['hip-hop','hiphop','rap','hip hop'] },
  { label: 'Rap FR', match: ['french rap','rap français','rap francais','rap fr','french hip-hop','french hip hop'] },
  { label: 'Electro', match: ['electro','electronic','edm','house','techno','trance','dubstep','dnb','drum'] },
  { label: 'Rock', match: ['rock','punk','metal','grunge','indie rock'] },
  { label: 'R&B / Soul', match: ['r&b','rnb','soul','neo-soul','neo soul'] },
  { label: 'Reggae', match: ['reggae','dancehall','dub','ska'] },
  { label: 'Jazz', match: ['jazz','bebop','swing','bossa'] },
  { label: 'Classical', match: ['classical','orchestra','symphony','opera'] },
  { label: 'Pop', match: ['pop','synth-pop','synthpop','k-pop'] },
  { label: 'Blues', match: ['blues'] },
  { label: 'Latin', match: ['latin','reggaeton','salsa','bachata','latino'] },
  { label: 'Alternative', match: ['alternative','indie','alt'] },
  { label: 'Funk / Disco', match: ['funk','disco'] },
  { label: 'Ambient', match: ['ambient','lo-fi','lofi','new age'] },
];

function renderGenreFilter() {
  var sel = document.getElementById('genreFilter');
  var html = '<option value="">All genres</option>';
  html += '<optgroup label="─ Categories ─">';
  GENRE_GROUPS.forEach(function(g) { html += '<option value="group:' + g.label + '">' + g.label + '</option>'; });
  html += '</optgroup>';
  html += '<optgroup label="─ All genres ─">';
  allGenres.forEach(function(g) { html += '<option value="' + esc(g) + '">' + esc(g) + '</option>'; });
  html += '</optgroup>';
  sel.innerHTML = html;
}
document.getElementById('genreFilter').addEventListener('change', applyFilters);

// ─── Library Views (Tracks / Albums / Artists) ───────────────────────────────
var currentLibView = 'tracks';
var drillDownFrom = null; // 'albums' or 'artists' when drilled into a sub-view
var drillDownLabel = '';  // e.g. the album or artist name

function showBackBar(label) {
  var bar = document.getElementById('libBackBar');
  document.getElementById('libBreadcrumb').textContent = label;
  bar.classList.add('visible');
}
function hideBackBar() {
  document.getElementById('libBackBar').classList.remove('visible');
  drillDownFrom = null;
  drillDownLabel = '';
}

document.getElementById('libBackBtn').addEventListener('click', function() {
  if (!drillDownFrom) return;
  var target = drillDownFrom;
  hideBackBar();
  currentLibView = target;
  document.querySelectorAll('.lib-view-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.view === target); });
  document.getElementById('trackList').style.display = 'none';
  document.getElementById('albumList').style.display = target === 'albums' ? '' : 'none';
  document.getElementById('artistList').style.display = target === 'artists' ? '' : 'none';
  tracks = allTracks.slice();
  updateSortOptions();
  applyFilters();
});

document.querySelectorAll('.lib-view-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    hideBackBar();
    currentLibView = btn.dataset.view;
    document.querySelectorAll('.lib-view-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.view === currentLibView); });
    document.getElementById('trackList').style.display = currentLibView === 'tracks' ? '' : 'none';
    document.getElementById('albumList').style.display = currentLibView === 'albums' ? '' : 'none';
    document.getElementById('artistList').style.display = currentLibView === 'artists' ? '' : 'none';
    document.getElementById('yearList').style.display = currentLibView === 'years' ? '' : 'none';
    document.getElementById('genreList').style.display = currentLibView === 'genresrich' ? '' : 'none';
    tracks = allTracks.slice();
    // Hide duration sort options for Albums/Artists views (makes no sense)
    updateSortOptions();
    // Apply current filters/sort to the new view
    applyFilters();
  });
});

function updateSortOptions() {
  var sel = document.getElementById('sortSelect');
  var opts = sel.querySelectorAll('option');
  opts.forEach(function(o) {
    if (o.value === 'duration' || o.value === 'duration-desc') {
      o.style.display = currentLibView === 'tracks' ? '' : 'none';
      o.disabled = currentLibView !== 'tracks';
    }
  });
  // If current selection is now hidden, reset to title
  if ((sel.value === 'duration' || sel.value === 'duration-desc') && currentLibView !== 'tracks') {
    sel.value = 'title';
  }
}

function renderAlbums() {
  var list = document.getElementById('albumList');
  var genre = document.getElementById('genreFilter').value;
  var q = document.getElementById('search').value.trim();
  var source = (genre || q) ? tracks : allTracks;
  var albumMap = {};
  source.forEach(function(t) {
    var key = (t.album || 'Unknown Album').toLowerCase().trim();
    if (!albumMap[key]) albumMap[key] = { album: t.album || 'Unknown Album', artists: [], tracks: [], hasCover: false, coverId: null };
    albumMap[key].tracks.push(t.id);
    if (albumMap[key].artists.indexOf(t.artist) === -1) albumMap[key].artists.push(t.artist);
    if (!albumMap[key].hasCover && t.hasCover) { albumMap[key].hasCover = true; albumMap[key].coverId = t.id; }
  });
  var sort = document.getElementById('sortSelect').value;
  var albums = Object.values(albumMap).sort(function(a, b) {
    switch(sort) {
      case 'title-desc': return b.album.localeCompare(a.album);
      case 'artist': return a.artists[0].localeCompare(b.artists[0]);
      default: return a.album.localeCompare(b.album);
    }
  });
  document.getElementById('trackCount').textContent = albums.length + ' album' + (albums.length !== 1 ? 's' : '');
  var ALBUM_PH = '<div class="group-icon" style="background:var(--surface);display:flex;align-items:center;justify-content:center;border-radius:6px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:20px;height:20px;opacity:0.3;color:var(--accent);"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';
  list.innerHTML = albums.map(function(a) {
    var artistLabel = a.artists.length > 2 ? a.artists[0] + ' + ' + (a.artists.length - 1) + ' more' : a.artists.join(', ');
    var coverHtml = a.hasCover
      ? '<div class="group-icon" style="background:none;overflow:hidden;border-radius:6px;"><img src="' + coverUrl(a.coverId) + '" style="width:100%;height:100%;object-fit:cover;"></div>'
      : ALBUM_PH;
    return '<div class="group-card" data-album="' + esc(a.album) + '" data-tracks="' + a.tracks.join(',') + '">' +
      coverHtml + '<div><div class="group-name">' + esc(a.album) + '</div><div class="group-count">' + esc(artistLabel) + ' — ' + a.tracks.length + ' tracks</div></div>' +
      '<button class="group-add-btn" title="Add to queue">+</button></div>';
  }).join('');
  list.querySelectorAll('.group-card').forEach(function(card) {
    // Add to queue button
    var addBtn = card.querySelector('.group-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var ids = card.dataset.tracks ? card.dataset.tracks.split(',').map(Number) : [];
        if (!ids.length) return;
        if (!isDesktop && mobileMode === 'remote') {
          sendRemoteCommand('add-tracks', { trackIds: ids });
          showToast('Added ' + ids.length + ' tracks to queue');
        } else {
          ids.forEach(function(id) { queue.push(id); });
          renderQueue();
          showToast('Added ' + ids.length + ' tracks to queue');
        }
      });
    }
    card.addEventListener('click', function() {
      var album = card.dataset.album;
      tracks = allTracks.filter(function(t) { return t.album === album; });
      drillDownFrom = 'albums';
      drillDownLabel = album;
      showBackBar(album);
      currentLibView = 'tracks';
      document.querySelectorAll('.lib-view-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.view === 'tracks'); });
      document.getElementById('trackList').style.display = '';
      document.getElementById('albumList').style.display = 'none';
      document.getElementById('artistList').style.display = 'none';
      renderTracks();
    });
  });
}

// Artists whose name contains a comma — must NOT be split
var UNSPLITTABLE_ARTISTS = ['tyler, the creator', 'earth, wind & fire', 'earth, wind and fire'];

function splitArtists(artistStr) {
  if (!artistStr) return ['Unknown'];
  // Protect unsplittable names by temporarily replacing them
  var lower = artistStr.toLowerCase();
  var protected = [];
  var work = artistStr;
  UNSPLITTABLE_ARTISTS.forEach(function(name) {
    var idx = lower.indexOf(name);
    if (idx !== -1) {
      var original = work.substring(idx, idx + name.length);
      var placeholder = '\x00' + protected.length + '\x00';
      work = work.substring(0, idx) + placeholder + work.substring(idx + name.length);
      lower = work.toLowerCase();
      protected.push(original);
    }
  });
  // Split by ", "
  var parts = work.split(', ').map(function(p) {
    // Restore protected names
    return p.replace(/\x00(\d+)\x00/g, function(_, i) { return protected[parseInt(i)]; });
  }).map(function(p) { return p.trim(); }).filter(Boolean);
  return parts.length ? parts : ['Unknown'];
}

function renderArtists() {
  var list = document.getElementById('artistList');
  var genre = document.getElementById('genreFilter').value;
  var q = document.getElementById('search').value.trim();
  var source = (genre || q) ? tracks : allTracks;
  var artistMap = {};
  source.forEach(function(t) {
    var artists = splitArtists(t.artist);
    artists.forEach(function(a) {
      var key = a.toLowerCase();
      if (!artistMap[key]) artistMap[key] = { artist: a, count: 0 };
      artistMap[key].count++;
    });
  });
  var sort = document.getElementById('sortSelect').value;
  var artists = Object.values(artistMap).sort(function(a, b) {
    switch(sort) {
      case 'title': case 'artist': return a.artist.localeCompare(b.artist);
      case 'title-desc': return b.artist.localeCompare(a.artist);
      default: return b.count - a.count;
    }
  });
  document.getElementById('trackCount').textContent = artists.length + ' artist' + (artists.length !== 1 ? 's' : '');
  var ARTIST_COLORS = ['#e8a435','#b68adf','#7ac47a','#5ba8e8','#e06b9f','#4dd4ac','#c47a7a','#8b5cf6','#f59e0b','#e05555'];
  list.innerHTML = artists.map(function(a, i) {
    var color = ARTIST_COLORS[i % ARTIST_COLORS.length];
    return '<div class="group-card" data-artist="' + esc(a.artist) + '">' +
      '<div class="group-icon" style="background:' + color + ';">' + esc(a.artist.charAt(0).toUpperCase()) + '</div>' +
      '<div><div class="group-name">' + esc(a.artist) + '</div><div class="group-count">' + a.count + ' tracks</div></div>' +
      '<button class="group-add-btn" title="Add to queue">+</button></div>';
  }).join('');
  list.querySelectorAll('.group-card').forEach(function(card) {
    // Add to queue button
    var addBtn = card.querySelector('.group-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var artist = card.dataset.artist;
        var artistLower = artist.toLowerCase();
        var ids = allTracks.filter(function(t) {
          return splitArtists(t.artist).some(function(a) { return a.toLowerCase() === artistLower; });
        }).map(function(t) { return t.id; });
        if (!ids.length) return;
        if (!isDesktop && mobileMode === 'remote') {
          sendRemoteCommand('add-tracks', { trackIds: ids });
          showToast('Added ' + ids.length + ' tracks to queue');
        } else {
          ids.forEach(function(id) { queue.push(id); });
          renderQueue();
          showToast('Added ' + ids.length + ' tracks to queue');
        }
      });
    }
    card.addEventListener('click', function() {
      var artist = card.dataset.artist;
      var artistLower = artist.toLowerCase();
      tracks = allTracks.filter(function(t) {
        return splitArtists(t.artist).some(function(a) { return a.toLowerCase() === artistLower; });
      });
      drillDownFrom = 'artists';
      drillDownLabel = artist;
      showBackBar(artist);
      currentLibView = 'tracks';
      document.querySelectorAll('.lib-view-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.view === 'tracks'); });
      document.getElementById('trackList').style.display = '';
      document.getElementById('albumList').style.display = 'none';
      document.getElementById('artistList').style.display = 'none';
      renderTracks();
    });
  });
}

