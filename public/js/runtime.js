// === runtime.js — slice of public/js/main.js (legacy monolith) ===
// This file is loaded by index.html in a specific order.
// Do not change the order without auditing dependencies.
// ─── Equalizer ──────────────────────────────────────────────────────────────
var EQ_BANDS = [60, 150, 400, 1000, 2500, 6000, 15000];
var EQ_LABELS = ['60', '150', '400', '1K', '2.5K', '6K', '15K'];
var EQ_PRESETS = {
  flat: [0,0,0,0,0,0,0],
  bass: [6,4,2,0,-1,-1,0],
  treble: [-1,0,0,1,3,5,6],
  vocal: [-2,-1,0,3,4,3,1],
  party: [4,3,0,0,0,2,4],
  'late-night': [3,2,1,0,-1,-2,-3],
};
var eqFilters = [];
var eqConnected = false;

function initEQ() {
  if (eqConnected || !viz || !viz.audioCtx) return;
  var ctx = viz.audioCtx;
  // Disconnect existing chain and insert EQ
  viz.source.disconnect();
  var prev = viz.source;
  EQ_BANDS.forEach(function(freq) {
    var filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    filter.gain.value = 0;
    prev.connect(filter);
    prev = filter;
    eqFilters.push(filter);
  });
  prev.connect(viz.analyser);
  eqConnected = true;
}

function renderEQ() {
  var container = document.getElementById('eqSliders');
  var labels = document.getElementById('eqLabels');
  container.innerHTML = EQ_BANDS.map(function(freq, i) {
    var gain = eqFilters.length ? eqFilters[i].gain.value : 0;
    return '<div class="eq-band"><input type="range" min="-12" max="12" value="' + gain + '" data-idx="' + i + '"><div class="eq-val">' + (gain > 0 ? '+' : '') + Math.round(gain) + 'dB</div></div>';
  }).join('');
  labels.innerHTML = EQ_LABELS.map(function(l) { return '<span>' + l + '</span>'; }).join('');

  container.querySelectorAll('input').forEach(function(slider) {
    slider.addEventListener('input', function() {
      var idx = parseInt(slider.dataset.idx);
      var val = parseFloat(slider.value);
      if (eqFilters[idx]) eqFilters[idx].gain.value = val;
      slider.nextElementSibling.textContent = (val > 0 ? '+' : '') + Math.round(val) + 'dB';
    });
  });
}

document.getElementById('eqPreset').addEventListener('change', function() {
  var preset = EQ_PRESETS[this.value] || EQ_PRESETS.flat;
  initEQ();
  preset.forEach(function(val, i) { if (eqFilters[i]) eqFilters[i].gain.value = val; });
  renderEQ();
});

document.querySelector('[data-tab="eq"]').addEventListener('click', function() {
  initEQ();
  renderEQ();
  startEqWave();
});

// EQ live frequency wave background
var eqWaveAnimFrame = null;
function startEqWave() {
  if (eqWaveAnimFrame) return;
  var canvas = document.getElementById('eqWaveCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  function drawEqWave() {
    if (!document.getElementById('panel-eq').classList.contains('active')) {
      eqWaveAnimFrame = null; return;
    }
    var w = canvas.offsetWidth, h = canvas.offsetHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    if (viz && viz.analyser) {
      var bufLen = viz.analyser.frequencyBinCount;
      var data = new Uint8Array(bufLen);
      viz.analyser.getByteFrequencyData(data);
      // Draw bars (input signal)
      var barW = w / bufLen;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a435';
      for (var i = 0; i < bufLen; i++) {
        var bh = (data[i] / 255) * h;
        ctx.fillRect(i * barW, h - bh, barW * 0.8, bh);
      }
    }
    eqWaveAnimFrame = requestAnimationFrame(drawEqWave);
  }
  drawEqWave();
}

function fetchStats() {
  // Show a quick placeholder so the panel never looks empty while the fetch
  // is in flight — without it, on a fresh install the user sees just the
  // section headings and thinks the panel is broken.
  var statsCards = document.getElementById('statsCards');
  if (statsCards && !statsCards.innerHTML.trim()) {
    statsCards.innerHTML = '<div class="stat-card"><div class="stat-value">…</div><div class="stat-label">Loading</div></div>';
  }
  fetch('/api/stats').then(function(r){ return r.json(); }).then(function(s) {
    var week = s.week || {};
    var month = s.month || {};
    var hours = Math.floor((month.minutes || 0) / 60);
    var topArtists = s.topArtists || [];
    var topGenres = s.topGenres || [];
    var cards = document.getElementById('statsCards');
    cards.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + (week.plays || 0) + '</div><div class="stat-label">Plays this week</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + hours + 'h</div><div class="stat-label">Listened (30d)</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.totalTracks || 0) + '</div><div class="stat-label">Total tracks</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.favorites || 0) + '</div><div class="stat-label">Favorites</div></div>';

    if (!topArtists.length) {
      document.getElementById('statsArtists').innerHTML = '<p style="font-size:0.78rem;color:var(--text-dim);">No listening data yet — play some tracks!</p>';
    } else {
      var maxArtist = topArtists[0].count;
      document.getElementById('statsArtists').innerHTML = topArtists.map(function(a, i) {
        return '<div class="stat-row"><span class="stat-rank">' + (i+1) + '</span><span class="stat-name">' + esc(a.name) + '</span><div class="stat-bar"><div class="stat-bar-fill" style="width:' + (a.count/maxArtist*100) + '%"></div></div><span class="stat-count">' + a.count + '</span></div>';
      }).join('');
    }

    if (!topGenres.length) {
      document.getElementById('statsGenres').innerHTML = '<p style="font-size:0.78rem;color:var(--text-dim);">No listening data yet — play some tracks!</p>';
    } else {
      var maxGenre = topGenres[0].count;
      document.getElementById('statsGenres').innerHTML = topGenres.map(function(g, i) {
        var barColor = getGenreBarColor(g.name);
        return '<div class="stat-row"><span class="stat-rank">' + (i+1) + '</span><span class="stat-name">' + esc(g.name) + '</span><div class="stat-bar"><div class="stat-bar-fill" style="width:' + (g.count/maxGenre*100) + '%;background:' + barColor + '"></div></div><span class="stat-count">' + g.count + '</span></div>';
      }).join('');
    }
  }).catch(function(e){ console.warn('[gb] stats fetch failed:', e && e.message); });

  // Server stats
  fetch('/api/server/stats').then(function(r){ return r.json(); }).then(function(sv) {
    var uptimeStr = formatUptime(sv.uptime || 0);
    var cards = document.getElementById('serverStatsCards');
    cards.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + uptimeStr + '</div><div class="stat-label">Server uptime</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (sv.uniqueDevices || 0) + '</div><div class="stat-label">Unique devices</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (sv.currentConnections || 0) + '</div><div class="stat-label">Active now</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (sv.totalConnections || 0) + '</div><div class="stat-label">Total connections</div></div>';
  }).catch(function(e){ console.warn('[gb] stats fetch failed:', e && e.message); });
}

function formatUptime(seconds) {
  if (!seconds || isNaN(seconds)) return '0s';
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'min';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  return h + 'h ' + (m > 0 ? m + 'min' : '');
}

function showToast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;top:50px;right:16px;background:var(--surface);border:1px solid var(--accent);border-radius:var(--radius);padding:10px 16px;z-index:9999;font-size:0.8rem;color:var(--text);box-shadow:0 8px 32px rgba(0,0,0,0.4);opacity:1;transition:opacity 0.6s ease;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.style.opacity = '0'; }, 5000);
  setTimeout(function(){ t.remove(); }, 5600);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatTime(s) { if (!s||isNaN(s)) return '0:00'; var m=Math.floor(s/60); var sec=Math.floor(s%60); return m+':'+(sec<10?'0':'')+sec; }
function esc(str) { var d=document.createElement('div'); d.textContent=str||''; return d.innerHTML; }

// ─── Mobile Mode: Remote vs Stream ───────────────────────────────────────────
// 'remote' = control the desktop, browse → play on desktop
// 'stream' = play locally on this device
function setMobileMode(mode) {
  mobileMode = mode;
  document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
  var bar = document.getElementById('playerBar');
  var label = document.getElementById('playerModeLabel');
  if (mode === 'remote') {
    bar.classList.add('remote-mode');
    label.style.display = 'block';
    label.textContent = 'REMOTE';
    if (lastDesktopState) updatePlayerFromDesktop(lastDesktopState);
    // Hide visualizer in remote mode (no local audio to analyze)
    document.getElementById('vizContainer').classList.remove('active');
  } else {
    bar.classList.remove('remote-mode');
    label.style.display = 'none';
    updatePlayerFromLocal();
  }
  lastQueueHash = ''; // Force re-render
  renderQueue();
}

var lastRemoteTrackId = null;
var lastRemotePlaying = null;

function updatePlayerFromDesktop(d) {
  if (mobileMode !== 'remote' || isDesktop) return;
  document.getElementById('playerTitle').textContent = d.title || 'Nothing playing';
  document.getElementById('playerArtist').textContent = d.artist || 'Server idle';
  document.getElementById('totalTime').textContent = formatTime(d.duration);
  document.getElementById('currentTime').textContent = formatTime(d.progress);
  if (d.duration) document.getElementById('progressFill').style.width = (d.progress / d.duration * 100) + '%';
  // Only update cover if track changed (avoid image flash)
  if (d.trackId !== lastRemoteTrackId) {
    lastRemoteTrackId = d.trackId;
    var cover = document.getElementById('playerCover');
    if (d.hasCover && d.trackId) cover.innerHTML = '<img src="' + coverUrl(d.trackId) + '">';
    else cover.innerHTML = '<div class="ph">' + PLACEHOLDER_SVG + '</div>';
  }
  // Only update play/pause icon if state changed
  if (d.isPlaying !== lastRemotePlaying) {
    lastRemotePlaying = d.isPlaying;
    var svg = d.isPlaying
      ? '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>';
    document.getElementById('playPauseBtn').innerHTML = svg;
  }
  // Sync volume slider
  if (d.volume != null) document.getElementById('volumeSlider').value = d.volume;

  // Update cover
  updateNowPlayingHero();
}

function updatePlayerFromLocal() {
  if (mobileMode !== 'stream' || isDesktop) return;
  var trackId = queue[currentIndex];
  var track = trackId != null ? tracks.find(function(t){ return t.id === trackId; }) : null;
  document.getElementById('playerTitle').textContent = track ? track.title : 'Ghetto Blaster';
  document.getElementById('playerArtist').textContent = track ? track.artist : 'Select a track';
  var cover = document.getElementById('playerCover');
  if (track && track.hasCover) cover.innerHTML = '<img src="' + coverUrl(trackId) + '">';
  else cover.innerHTML = '<div class="ph">' + PLACEHOLDER_SVG + '</div>';
}

function sendRemoteCommand(cmd, extra) {
  var payload = { command: cmd };
  if (extra) { for (var k in extra) payload[k] = extra[k]; }
  fetch('/api/remote/command', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(function(){});
}

// Remote: play a specific track on desktop
function remotePlayTrack(trackId) {
  fetch('/api/remote/command', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command: 'play-track', trackId: trackId }) }).catch(function(){});
}

// Remote: add track to desktop queue
function remoteAddToQueue(trackId) {
  fetch('/api/remote/command', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command: 'add-to-queue', trackId: trackId }) }).catch(function(){});
}

// ─── WebSocket ───────────────────────────────────────────────────────────────
(function connectWS() {
  if (!location.host) return;
  var wsBase = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
  var wsUrl = AUTH_TOKEN ? wsBase + '/?t=' + encodeURIComponent(AUTH_TOKEN) : wsBase;
  var ws = new WebSocket(wsUrl);
  ws.onopen = function() {
    // Identify this device with a persistent name
    var deviceName = localStorage.getItem('ghettoblaster-device');
    if (!deviceName) {
      var ua = navigator.userAgent;
      if (/iPhone/.test(ua)) deviceName = 'iPhone';
      else if (/Android/.test(ua)) deviceName = 'Android';
      else if (/iPad/.test(ua)) deviceName = 'iPad';
      else deviceName = 'Browser';
      localStorage.setItem('ghettoblaster-device', deviceName);
    }
    ws.send(JSON.stringify({ type: 'set-name', name: deviceName }));
  };
  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    if (msg.type === 'scan:start') {
      document.getElementById('scanIndicator').style.display = 'inline';
      document.getElementById('trackCount').textContent = 'Scanning library...';
      // Refresh tracks periodically during scan so user sees progress
      var scanRefresh = setInterval(function() {
        if (document.getElementById('scanIndicator').style.display === 'none') { clearInterval(scanRefresh); return; }
        fetchTracks();
      }, 4000);
    }
    if (msg.type === 'scan:done') {
      document.getElementById('scanIndicator').style.display = 'none';
      fetchTracks();
      fetchGenres();
      // On mobile, queue might now be available after scan
      if (!isDesktop) fetchRemoteQueue();
    }
    if (msg.type === 'library-updated') {
      fetchTracks();
      fetchGenres();
    }
    // Desktop state (for mobile)
    if (msg.type === 'desktop:state' && !isDesktop) {
      var prevState = lastDesktopState;
      lastDesktopState = msg.data;
      // Auto-switch to remote if desktop is playing and user hasn't picked stream (only switch once)
      if (msg.data.isPlaying && !userPickedStream && mobileMode !== 'remote') setMobileMode('remote');
      // If queue is empty locally but desktop reports tracks, refetch
      if (!remoteQueueData.length && msg.data.queueLength > 0) {
        fetchRemoteQueue();
      }
      if (mobileMode === 'remote') {
        updatePlayerFromDesktop(msg.data);
        // Update queue highlight + scroll to current when index changes
        if (prevState && prevState.currentIndex !== msg.data.currentIndex) {
          var sci = msg.data.currentIndex;
          var list = document.getElementById('queueList');
          // Ensure the current track is rendered (lazy load more if needed)
          while (sci >= remoteQueueRendered && remoteQueueRendered < remoteQueueData.length) {
            appendRemoteQueueBatch(list, sci);
          }
          var items = list.querySelectorAll('.track-item');
          items.forEach(function(el) {
            var ri = parseInt(el.dataset.rindex);
            el.classList.toggle('playing', ri === sci);
          });
          scrollToCurrentInQueue();
        }
      }
    }
    // Desktop queue changed → refetch once
    if (msg.type === 'desktop:queue-changed' && !isDesktop) {
      fetchRemoteQueue();
    }
    // Users changed — refresh
    if (msg.type === 'users:changed' && isDesktop) {
      fetchUsers();
    }
    // Remote commands (mobile → desktop)
    if (msg.type === 'remote:command' && isDesktop) {
      var cmd = msg.data.command;
      if (cmd === 'play') { if (queue.length && currentIndex >= 0) { audio.play(); isPlaying = true; updatePlayBtn(); } }
      if (cmd === 'pause') { audio.pause(); isPlaying = false; updatePlayBtn(); }
      if (cmd === 'next') document.getElementById('nextBtn').click();
      if (cmd === 'prev') document.getElementById('prevBtn').click();
      if (cmd === 'clear') { document.getElementById('clearQueue').click(); }
      if (cmd === 'shuffle') { document.getElementById('shuffleBtn').click(); }
      if (cmd === 'set-output' && msg.data.deviceId && audio.setSinkId) {
        audio.setSinkId(msg.data.deviceId).then(function() {
          window._appConfig = window._appConfig || {};
          window._appConfig.audioOutput = msg.data.deviceId;
          if (window.resonance) window.resonance.setConfig({ audioOutput: msg.data.deviceId });
          postOutputDevices();
        }).catch(function(e) { console.warn('set-output failed:', e); });
      }
      if (cmd === 'play-track' && msg.data.trackId != null) {
        // Fetch all tracks if needed (cache might be partial)
        var tid = msg.data.trackId;
        if (!getTrack(tid)) {
          // Track not in cache — fetch all and retry
          api('/tracks').then(function(all) { all.forEach(cacheTrack); tracks = all;
            var idx = all.findIndex(function(t){return t.id === tid});
            if (idx >= 0) { queue = all.map(function(t){return t.id}); currentIndex = idx; playCurrentTrack(); renderQueue(); }
          });
        } else {
          // Build queue from all cached tracks (full library)
          api('/tracks').then(function(all) { all.forEach(cacheTrack); tracks = all;
            var idx = all.findIndex(function(t){return t.id === tid});
            queue = all.map(function(t){return t.id}); currentIndex = idx >= 0 ? idx : 0; playCurrentTrack(); renderQueue();
          });
        }
      }
      if (cmd === 'shuffle-play' && msg.data.trackIds) {
        // Remote sent a filtered list of track IDs to shuffle-play
        queue = smartShuffle(msg.data.trackIds);
        currentIndex = 0;
        playCurrentTrack();
        renderQueue();
      }
      if (cmd === 'add-to-queue' && msg.data.trackId != null) {
        queue.push(msg.data.trackId);
        renderQueue();
      }
      if (cmd === 'add-tracks' && msg.data.trackIds) {
        msg.data.trackIds.forEach(function(id) { queue.push(id); });
        renderQueue();
      }
      if (cmd === 'play-index' && msg.data.index != null) {
        var pi = parseInt(msg.data.index);
        if (pi >= 0 && pi < queue.length) { currentIndex = pi; playCurrentTrack(); renderQueue(); }
      }
      if (cmd === 'set-volume' && msg.data.volume != null) {
        audio.volume = parseFloat(msg.data.volume);
        document.getElementById('volumeSlider').value = audio.volume;
      }
      if (cmd === 'play-playlist' && msg.data.playlistId) {
        api('/playlists/' + msg.data.playlistId).then(function(pl) {
          pl.tracks.forEach(cacheTrack);
          queue = smartShuffle(pl.tracks.map(function(t){return t.id}));
          currentIndex = 0;
          playCurrentTrack();
          renderQueue();
        });
      }
    }
  };
  ws.onclose = function() { setTimeout(connectWS, 3000); };
  ws.onerror = function() { ws.close(); };
})();

// ─── Mode Toggle (mobile only) ───────────────────────────────────────────────
if (!isDesktop) {
  // Show mode toggle on mobile/web
  document.getElementById('modeToggle').style.display = 'flex';

  document.querySelectorAll('.mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.disabled) return;
      var mode = btn.dataset.mode;
      if (mode === 'stream') userPickedStream = true;
      setMobileMode(mode);
    });
  });

  // Fetch initial desktop state THEN queue (need state first for correct highlighting)
  fetch('/api/desktop/state').then(function(r){ return r.json(); }).then(function(d) {
    lastDesktopState = d;
    if (d && d.isPlaying) setMobileMode('remote');
    updatePlayerFromDesktop(d);
    fetchRemoteQueue();
  }).catch(function(){ fetchRemoteQueue(); });
  // Retry queue fetch after 3s in case desktop hadn't posted yet
  setTimeout(function() { if (!remoteQueueData.length) fetchRemoteQueue(); }, 3000);
  // Sync theme from server config
  fetch('/api/config/theme').then(function(r){ return r.json(); }).then(function(d) {
    if (d.hue != null) document.documentElement.style.setProperty('--hue', d.hue);
  }).catch(function(e){ console.warn('[gb] theme fetch failed:', e && e.message); });
}

// ─── Scan-state probe (desktop AND mobile) ─────────────────────────────────
// The 'scan:start' WS event is broadcast at the moment the server begins
// scanning, which is often BEFORE the renderer's WebSocket has finished
// connecting — so the listener in the WS handler can miss it. Probe
// /api/scan/status on boot, and if a scan is in progress, kick off a
// periodic refetch so the indicator and the track count stay accurate
// until the scan finishes.
(function probeScanState() {
  var ind = document.getElementById('scanIndicator');
  var countEl = document.getElementById('trackCount');
  if (!ind) return;
  function refresh() {
    return fetch('/api/scan/status')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var scanning = !!(d && d.scanning);
        ind.style.display = scanning ? 'inline' : 'none';
        if (scanning && countEl && countEl.textContent.trim().length === 0) {
          countEl.textContent = 'Scanning library...';
        }
        return scanning;
      })
      .catch(function() { return false; });
  }
  refresh().then(function(scanning) {
    if (!scanning) return;
    var iv = setInterval(function() {
      refresh().then(function(stillScanning) {
        if (!stillScanning) {
          clearInterval(iv);
          // Reload library + genres now that the scan settled.
          if (typeof window.fetchTracks === 'function') window.fetchTracks();
          if (typeof window.fetchGenres === 'function') window.fetchGenres();
        } else {
          // Pull fresh tracks while scan is running so the count creeps up.
          if (typeof window.fetchTracks === 'function') window.fetchTracks();
        }
      });
    }, 4000);
  });
})();

// ─── Init ────────────────────────────────────────────────────────────────────
fetchTracks();
fetchGenres();
// Retry after 3s if library was empty (scan might still be running)
setTimeout(function() { if (!tracks.length) { fetchTracks(); fetchGenres(); } }, 3000);

// Default tab: Library on desktop (nothing playing), Now Playing on mobile if remote playing
if (isDesktop) {
  // Desktop: start on Library (user will go to Now Playing when they start something)
  document.querySelector('[data-tab="library"]').click();
} else {
  // Mobile: check if server is playing → stay on Now Playing, else Library
  fetch('/api/desktop/state').then(function(r){ return r.json(); }).then(function(d) {
    if (!d || !d.isPlaying) document.querySelector('[data-tab="library"]').click();
  }).catch(function() { document.querySelector('[data-tab="library"]').click(); });
}

// PWA: register the service worker on mobile/web. We skip it inside Electron
// because the desktop renderer is already local — adding a SW just adds a
// stale-cache risk during dev.
if ('serviceWorker' in navigator && !window.resonance) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function(e) {
      console.warn('SW registration failed:', e && e.message);
    });
  });
}

// Media Session API: surface playback metadata + controls to the OS lock
// screen / notification shade. The audio element id varies by deployment, so
// we look it up lazily and bail out silently if it isn't there yet.
(function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  function findAudio() {
    return document.querySelector('audio')
      || document.getElementById('player')
      || document.getElementById('audio');
  }
  function setMeta(track) {
    if (!track) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        artwork: track.hasCover && track.id != null
          ? [{ src: '/api/cover/' + track.id, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
    } catch (e) { /* ignore */ }
  }
  function bindActions() {
    var actions = {
      play: function() { var a = findAudio(); if (a) a.play(); },
      pause: function() { var a = findAudio(); if (a) a.pause(); },
      previoustrack: function() { var b = document.querySelector('[data-action="prev"]'); if (b) b.click(); },
      nexttrack: function() { var b = document.querySelector('[data-action="next"]'); if (b) b.click(); },
    };
    Object.keys(actions).forEach(function(name) {
      try { navigator.mediaSession.setActionHandler(name, actions[name]); } catch (e) {}
    });
  }
  bindActions();
  // Subscribe to state pushes to keep metadata fresh.
  try {
    var proto = (location.protocol === 'https:') ? 'wss:' : 'ws:';
    var url = new URL(location.href);
    var token = url.searchParams.get('t');
    var ws = new WebSocket(proto + '//' + location.host + (token ? '/?t=' + token : '/'));
    ws.addEventListener('message', function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'state' && msg.data && msg.data.currentTrack) setMeta(msg.data.currentTrack);
      } catch (e) {}
    });
  } catch (e) { /* ignore */ }
})();

// ─── Lazy library loader (chunked /api/tracks fetch) ──────────────────────
// Utility for libraries large enough that loading everything at once stalls
// the renderer. Fetches the index in chunks of N and reports progress.
//
// Usage:
//   const tracks = await window.gbLazy.loadAll({
//     chunk: 500,
//     onProgress: (loaded, total) => updateBar(loaded, total),
//   });
//
// We don't wire it into the legacy loadTracks() automatically because the
// renderer's code path expects the full array to be available before
// rendering. Call this from a refactored library view that supports
// streaming. Until then, the helper is simply available on window.gbLazy.
(function setupLazyLibrary() {
  if (typeof window === 'undefined') return;

  function buildUrl(opts) {
    var p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    if (opts.genre) p.set('genre', opts.genre);
    p.set('offset', String(opts.offset || 0));
    p.set('limit', String(opts.limit || 500));
    return '/api/tracks?' + p.toString();
  }

  async function loadAll(options) {
    var opts = Object.assign({ chunk: 500, q: '', genre: '' }, options || {});
    var all = [];
    var total = null;
    var offset = 0;
    while (true) {
      var url = buildUrl({ q: opts.q, genre: opts.genre, offset: offset, limit: opts.chunk });
      var res = await fetch(url);
      if (!res.ok) break;
      var batch = await res.json();
      if (total == null) {
        var hdr = res.headers.get('X-Total-Count');
        if (hdr != null) total = parseInt(hdr, 10);
      }
      all = all.concat(batch);
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(all.length, total); } catch (e) {}
      }
      if (batch.length < opts.chunk) break;
      if (total != null && all.length >= total) break;
      offset += opts.chunk;
    }
    return all;
  }

  async function getCount() {
    try {
      var r = await fetch('/api/tracks/count');
      if (!r.ok) return null;
      var d = await r.json();
      return typeof d.count === 'number' ? d.count : null;
    } catch (e) { return null; }
  }

  window.gbLazy = { loadAll: loadAll, getCount: getCount };

  // At boot, warn if the library is large enough that an eager load may stall.
  // Threshold is conservative (5k) — most users hit it long before the render
  // becomes painful, but it's a hint, not a hard switch.
  setTimeout(function() {
    getCount().then(function(n) {
      if (n != null && n > 5000) {
        console.info('[gb] library has ' + n + ' tracks — consider window.gbLazy.loadAll for chunked fetching.');
      }
    });
  }, 1500);
})();

// ─── Theme switcher (dark / light / auto) ─────────────────────────────────
// Three modes:
//   'auto'  — follow the OS prefers-color-scheme (default)
//   'dark'  — force dark
//   'light' — force light
// Persisted in _appConfig.theme. The CSS in style.css does the rest.
(function setupTheme() {
  if (typeof document === 'undefined') return;
  function apply(mode) {
    if (!['auto', 'dark', 'light'].includes(mode)) mode = 'auto';
    document.documentElement.dataset.theme = mode;
    // Update the meta theme-color for mobile browser chrome.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var resolved = mode === 'light' ? '#fafaf7' : '#0f0e0d';
      if (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        resolved = '#fafaf7';
      }
      meta.setAttribute('content', resolved);
    }
  }
  // Restore from persisted config when it lands; default to auto in the meantime.
  apply('auto');
  var tries = 0;
  var iv = setInterval(function() {
    tries++;
    if (window._appConfig || tries > 40) {
      clearInterval(iv);
      var saved = (window._appConfig && window._appConfig.theme) || 'auto';
      apply(saved);
    }
  }, 250);
  // Expose a setter so the Settings UI can flip the theme without reading
  // its config from disk.
  window.setTheme = function(mode) {
    apply(mode);
    window._appConfig = window._appConfig || {};
    window._appConfig.theme = mode;
    if (window.resonance && window.resonance.setConfig) {
      window.resonance.setConfig({ theme: mode });
    }
  };
  // Re-apply on OS theme change while in auto mode.
  if (window.matchMedia) {
    var mql = window.matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener('change', function() {
      if (document.documentElement.dataset.theme === 'auto') apply('auto');
    });
  }
})();

// ─── Onboarding (first run on desktop, first connection on mobile) ─────────
// Two variants in the markup:
//   - #onboardingDesktop: shown to the Electron renderer when musicFolders
//     is empty. Buttons: 'Skip' OR 'Choose music folder'.
//   - #onboardingMobile: shown to LAN clients on first visit. Pure
//     informational — explains they're remote-controlling the desktop.
// Dismissal is persisted in localStorage as `gb.onboardingSeen` so the
// overlay never appears twice on the same device.
(function setupOnboarding() {
  if (typeof window === 'undefined') return;
  if (location.search.indexOf('mini=1') !== -1) return; // never in mini-player
  var overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;

  var DESKTOP = !!(window.resonance && window.resonance.isElectron);
  var STORAGE_KEY = 'gb.onboardingSeen';
  var SEEN_VARIANT = (function() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  })();

  function markSeen(variant) {
    try { localStorage.setItem(STORAGE_KEY, variant); } catch (e) {}
  }

  function hide() { overlay.style.display = 'none'; }

  function showVariant(name) {
    var d = document.getElementById('onboardingDesktop');
    var m = document.getElementById('onboardingMobile');
    if (d) d.style.display = name === 'desktop' ? 'block' : 'none';
    if (m) m.style.display = name === 'mobile' ? 'block' : 'none';
    overlay.style.display = 'flex';
  }

  function maybeShowDesktop() {
    if (SEEN_VARIANT === 'desktop' || SEEN_VARIANT === 'desktop-skip') return;
    fetch('/api/tracks/count').then(function(r) { return r.json(); }).then(function(d) {
      if (d && d.count > 0) return;
      window.resonance.getConfig().then(function(cfg) {
        var folders = (cfg && cfg.musicFolders) || [];
        if (folders.length === 0) showVariant('desktop');
      });
    }).catch(function() {});
  }

  function maybeShowMobile() {
    // Mobile/LAN clients see the welcome only once per device. Independent
    // of library state — they may be connecting to a populated server just
    // to remote-control it.
    if (SEEN_VARIANT) return;
    showVariant('mobile');
  }

  // ─── Desktop button wiring ─────────────────────────────────────────────
  var pickBtn = document.getElementById('onboardingPickFolder');
  var skipBtn = document.getElementById('onboardingSkip');

  if (pickBtn) {
    pickBtn.addEventListener('click', function() {
      if (!(window.resonance && window.resonance.pickFolder)) return;
      window.resonance.pickFolder().then(function(folderPath) {
        if (!folderPath) return;
        window.resonance.getConfig().then(function(cfg) {
          var folders = (cfg && cfg.musicFolders) || [];
          if (folders.indexOf(folderPath) === -1) folders.push(folderPath);
          window.resonance.setConfig({ musicFolders: folders }).then(function() {
            markSeen('desktop');
            hide();
            fetch('/api/rescan', { method: 'POST' }).catch(function() {});
          });
        });
      });
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', function() {
      markSeen('desktop-skip');
      hide();
    });
  }

  // ─── Mobile button wiring ──────────────────────────────────────────────
  var mobileGo = document.getElementById('onboardingMobileGo');
  if (mobileGo) {
    mobileGo.addEventListener('click', function() {
      markSeen('mobile');
      hide();
    });
  }

  // ─── Trigger ───────────────────────────────────────────────────────────
  setTimeout(function() {
    if (DESKTOP) maybeShowDesktop();
    else maybeShowMobile();
  }, 400);
})();

// ─── Mini-player toggle (?mini=1) ──────────────────────────────────────────
// Adds the `mini` class to <body> when the URL has ?mini=1, which the CSS
// in style.css uses to swap to the compact layout. Toggled by the Electron
// mini-player window which loads /?mini=1.
(function setupMiniMode() {
  try {
    var url = new URL(location.href);
    if (url.searchParams.get('mini') === '1') {
      document.body.classList.add('mini');
    }
  } catch (e) { /* ignore */ }
})();

// ─── ReplayGain (opt-in) ───────────────────────────────────────────────────
// Smooths out loudness differences between tracks by attenuating audio.volume
// by 10^(rg/20) when the track has a ReplayGain tag. Off by default — turning
// it on without the user asking caused surprise volume drops on tagged tracks
// AND fought with the crossfade interval (which writes to audio.volume too).
//
// To enable: set _appConfig.replayGain = true (Settings UI toggle pending).
// While a crossfade ramp is in flight (window.crossfadeTriggered === true)
// we skip applying RG so we don't tug-of-war with the fade.
(function setupReplayGain() {
  var audioEl = document.querySelector('audio');
  if (!audioEl) return;

  function isEnabled() {
    return !!(window._appConfig && window._appConfig.replayGain);
  }

  function dbToFactor(db) {
    if (typeof db !== 'number' || !isFinite(db)) return 1;
    return Math.min(1, Math.max(0, Math.pow(10, db / 20)));
  }

  function userVolume() {
    var cfg = window._appConfig || {};
    return typeof cfg.volume === 'number' ? cfg.volume : 1;
  }

  function applyForCurrentTrack() {
    if (!isEnabled()) return;
    if (window.crossfadeTriggered) return; // never fight the crossfade
    if (!audioEl.src) return;
    var m = /\/api\/stream\/(\d+)/.exec(audioEl.src);
    if (!m) return;
    var trackId = parseInt(m[1], 10);
    var lib = window.library || (window.tracks && window.tracks.list);
    var track = Array.isArray(lib) ? lib.find(function(t) { return t && t.id === trackId; }) : null;
    var factor = (track && track.replayGain != null) ? dbToFactor(track.replayGain) : 1;
    audioEl.volume = userVolume() * factor;
  }

  // Hook only on loadstart — no polling. Way less likely to step on the
  // crossfade ramp than the previous setInterval implementation.
  audioEl.addEventListener('loadstart', applyForCurrentTrack);
})();

// ─── EQ preset persistence ─────────────────────────────────────────────────
// `_appConfig.eqPreset` holds the last selected preset name. Restored on boot
// once the EQ has been initialised, re-saved whenever the user picks a new
// one. Custom slider gains are not persisted (yet) — only the preset.
(function setupEqPersist() {
  var sel = document.getElementById('eqPreset');
  if (!sel) return;

  sel.addEventListener('change', function() {
    var cfg = window._appConfig = window._appConfig || {};
    cfg.eqPreset = sel.value;
    if (window.resonance && window.resonance.setConfig) {
      window.resonance.setConfig({ eqPreset: sel.value });
    }
  });

  function tryRestore() {
    var cfg = window._appConfig || {};
    if (!cfg.eqPreset) return;
    if (sel.value === cfg.eqPreset) return;
    sel.value = cfg.eqPreset;
    sel.dispatchEvent(new Event('change'));
  }
  // _appConfig is populated asynchronously after window.resonance.getConfig()
  // resolves, so retry until it's there.
  var tries = 0;
  var iv = setInterval(function() {
    tries++;
    if (window._appConfig || tries > 40) {
      clearInterval(iv);
      tryRestore();
    }
  }, 250);
})();

// ─── Drag & drop folders onto the window → add to musicFolders ────────────
// Electron sets `webUtils.getPathForFile` on dropped File objects; that's the
// only reliable way to recover the host path of a drop in modern Electron.
// We try that first, fall back to file.path (older Electron), and otherwise
// fall back to a toast hint. Drop a directory or one of its children — we
// walk up to the parent folder for a single-file drop so the rescan picks
// up the whole album.
(function setupFileDrop() {
  if (typeof document === 'undefined') return;

  function pathFromFile(file) {
    try {
      if (window.resonance && typeof window.resonance.dropPath === 'function') {
        return window.resonance.dropPath(file);
      }
    } catch (e) { /* ignore */ }
    // Older Electron exposed `file.path` directly; modern stacks return ''.
    if (file && typeof file.path === 'string' && file.path) return file.path;
    return null;
  }

  function showToast(msg) {
    if (typeof window.toast === 'function') return window.toast(msg);
    // Cheap fallback: console.
    console.log('[drop]', msg);
  }

  function dirnameOf(p) {
    if (typeof p !== 'string' || !p) return p;
    var slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (slash === -1) return p;
    return p.slice(0, slash);
  }

  document.addEventListener('dragover', function(e) {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
      e.preventDefault();
    }
  });

  document.addEventListener('drop', function(e) {
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    var files = Array.from(e.dataTransfer.files);
    var folders = new Set();
    var unresolved = 0;
    files.forEach(function(f) {
      var p = pathFromFile(f);
      if (!p) { unresolved++; return; }
      // Heuristic: if it's a folder (no extension on the basename), use as-is.
      // Otherwise use its parent so we add the album folder, not a single file.
      var base = p.split(/[\\/]/).pop() || '';
      var folder = base.indexOf('.') === -1 ? p : dirnameOf(p);
      if (folder) folders.add(folder);
    });
    if (folders.size === 0) {
      showToast(unresolved
        ? 'Drop folders directly to add them (this build can\'t resolve file paths).'
        : 'Nothing to add.');
      return;
    }
    // Merge with current config and rescan.
    if (!window.resonance || !window.resonance.getConfig || !window.resonance.setConfig) {
      showToast('Folder drop only works in the desktop app.');
      return;
    }
    window.resonance.getConfig().then(function(cfg) {
      var existing = (cfg && cfg.musicFolders) || [];
      var merged = Array.from(new Set(existing.concat(Array.from(folders))));
      var added = merged.length - existing.length;
      if (added === 0) {
        showToast('Folder already in library.');
        return;
      }
      window.resonance.setConfig({ musicFolders: merged }).then(function() {
        showToast('Added ' + added + ' folder' + (added > 1 ? 's' : '') + ' — rescanning...');
        fetch('/api/rescan', { method: 'POST' }).catch(function() {});
      });
    });
  });
})();

// ─── Drag & drop reorder for the queue ─────────────────────────────────────
// The legacy queue UI renders rows as `.track-item` in `#queueList`. We wire
// drag handles on each row and post the new order to the server so other
// clients see it too. Falls back gracefully on touch-only mobile (the existing
// long-press menu handles reorder there).
(function setupQueueReorder() {
  var list = document.getElementById('queueList');
  if (!list) return;

  var dragSrcIndex = null;

  function rowsAreDraggable() {
    var rows = list.querySelectorAll('.track-item');
    rows.forEach(function(row, idx) {
      if (row.getAttribute('draggable') === 'true') return;
      row.setAttribute('draggable', 'true');
      row.dataset.queueIdx = String(idx);
    });
  }

  // Re-arm whenever the queue panel is shown — cheap and safe.
  document.addEventListener('click', function(e) {
    if (e.target && e.target.closest && e.target.closest('[data-tab]')) {
      setTimeout(rowsAreDraggable, 50);
    }
  });
  // Re-arm on DOM mutations inside the queue list.
  if (typeof MutationObserver !== 'undefined') {
    var obs = new MutationObserver(rowsAreDraggable);
    obs.observe(list, { childList: true });
  }
  rowsAreDraggable();

  list.addEventListener('dragstart', function(e) {
    var row = e.target.closest && e.target.closest('.track-item');
    if (!row) return;
    var rows = Array.from(list.querySelectorAll('.track-item'));
    dragSrcIndex = rows.indexOf(row);
    row.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragover', function(e) {
    var row = e.target.closest && e.target.closest('.track-item');
    if (!row || dragSrcIndex == null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('drop', function(e) {
    var row = e.target.closest && e.target.closest('.track-item');
    if (!row || dragSrcIndex == null) return;
    e.preventDefault();
    var rows = Array.from(list.querySelectorAll('.track-item'));
    var dropIndex = rows.indexOf(row);
    if (dropIndex === dragSrcIndex || dropIndex === -1) return;
    if (!Array.isArray(window.queue)) return;
    var moved = window.queue.splice(dragSrcIndex, 1)[0];
    window.queue.splice(dropIndex, 0, moved);
    // Adjust currentIndex so playback stays on the same track.
    if (typeof window.currentIndex === 'number') {
      if (window.currentIndex === dragSrcIndex) window.currentIndex = dropIndex;
      else if (dragSrcIndex < window.currentIndex && dropIndex >= window.currentIndex) window.currentIndex--;
      else if (dragSrcIndex > window.currentIndex && dropIndex <= window.currentIndex) window.currentIndex++;
    }
    if (typeof window.renderQueue === 'function') window.renderQueue();
    // Persist server-side.
    fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackIds: window.queue }),
    }).catch(function() {});
  });

  list.addEventListener('dragend', function(e) {
    var row = e.target.closest && e.target.closest('.track-item');
    if (row) row.classList.remove('dragging');
    dragSrcIndex = null;
  });
})();

// (Crossfade safety on pause was removed — it was a rustine that conflicted
//  with the legacy crossfade ramp. The crossfade itself reset volume to the
//  saved target after a fade-in, so the safety net was unneeded and harmful
//  in edge cases. If pause mid-fade leaves audio.volume low, hitting play
//  resumes the fade-in correctly.)

// ─── Accessibility helpers (v3.15) ─────────────────────────────────────────
// Three small additions that cost nothing and help keyboard / screen-reader
// users a lot:
//   - ESC closes any open modal-overlay or popover.
//   - Buttons that only render a glyph (settings gear, ?, win-btns, mini
//     player, viz menu, mode toggle) get an aria-label so screen readers
//     can announce them.
//   - The tab strip becomes a proper role="tablist" with role="tab" on
//     each tab so AT users get tab-strip semantics for free.
(function setupA11y() {
  if (typeof document === 'undefined') return;

  // ESC-to-close. Looks at every visible overlay-style element and closes
  // the topmost one. Safe even when nothing is open.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    // Order matters: try the highest z-index containers first.
    var candidates = [
      document.querySelector('.modal-overlay.open'),
      document.getElementById('aboutModal'),
      document.querySelector('.viz-menu.open'),
      document.querySelector('.server-popover.open'),
    ].filter(Boolean);
    if (candidates.length === 0) return;
    e.preventDefault();
    var top = candidates[0];
    if (top.id === 'settingsModal' || top.classList.contains('modal-overlay')) {
      // Settings has a Cancel button — synthesize a click for the same path.
      var cancel = top.querySelector('#settingsCancel');
      if (cancel) cancel.click(); else top.classList.remove('open');
    } else if (top.id === 'aboutModal') {
      top.classList.remove('open');
      top.style.display = 'none';
    } else if (top.classList.contains('viz-menu')) {
      top.classList.remove('open');
    } else if (top.classList.contains('server-popover')) {
      top.classList.remove('open');
    }
  });

  // ARIA labels for icon-only controls. Only adds them when they're missing
  // — never overrides a label the legacy markup already set.
  var labelMap = {
    settingsBtn: 'Open settings',
    shortcutsBtn: 'About and shortcuts',
    tbMin: 'Minimize window',
    tbMax: 'Maximize window',
    tbClose: 'Close window',
    vizGearBtn: 'Visualizer options',
    refreshUsersBtn: 'Refresh device list',
  };
  Object.keys(labelMap).forEach(function(id) {
    var el = document.getElementById(id);
    if (el && !el.getAttribute('aria-label')) {
      el.setAttribute('aria-label', labelMap[id]);
    }
  });

  // Tab strip semantics.
  var tabStrip = document.querySelector('.tabs');
  if (tabStrip) {
    tabStrip.setAttribute('role', 'tablist');
    tabStrip.querySelectorAll('.tab').forEach(function(t) {
      t.setAttribute('role', 'tab');
      t.setAttribute('tabindex', '0');
      // Mark the active one for screen readers.
      var update = function() {
        t.setAttribute('aria-selected', t.classList.contains('active') ? 'true' : 'false');
      };
      update();
      t.addEventListener('click', update);
    });
  }

  // Make tabs activate on Enter/Space (they're divs, so default key
  // handling doesn't fire click).
  document.querySelectorAll('[role="tab"]').forEach(function(t) {
    t.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        t.click();
      }
    });
  });
})();

// ─── Gapless playback (v3.15) ──────────────────────────────────────────────
// Preloads the next queued track into a hidden secondary <audio>, and on
// `ended` swaps its buffer into the main audio element so playback resumes
// with no silent gap. Browsers can't do truly sample-accurate gapless
// without Web Audio AudioBufferSourceNode scheduling, but this preloaded-
// swap approach gets us within ~30-50ms which is below most listeners'
// detection threshold for non-DJ-grade material.
//
// Disabled while crossfade is on (the two would fight). Toggled via
// _appConfig.gapless / #settingsGapless.
(function setupGapless() {
  if (typeof document === 'undefined') return;
  var audio = document.querySelector('audio');
  if (!audio) return;

  // Hidden preloader audio element. Created lazily so the legacy code
  // doesn't see two <audio>s during init.
  var preloader = null;
  function getPreloader() {
    if (preloader) return preloader;
    preloader = document.createElement('audio');
    preloader.preload = 'auto';
    preloader.style.display = 'none';
    document.body.appendChild(preloader);
    return preloader;
  }

  function gaplessEnabled() {
    var cfg = window._appConfig || {};
    return !!cfg.gapless && !cfg.crossfade;
  }
  function nextTrackId() {
    var q = window.queue, idx = window.currentIndex;
    if (!Array.isArray(q) || typeof idx !== 'number') return null;
    return q[idx + 1] != null ? q[idx + 1] : null;
  }

  // Preload the next track when we cross the 10s-from-end mark.
  audio.addEventListener('timeupdate', function() {
    if (!gaplessEnabled()) return;
    if (!audio.duration) return;
    var remaining = audio.duration - audio.currentTime;
    if (remaining > 10 || remaining <= 0) return;
    var nextId = nextTrackId();
    if (!nextId) return;
    var url = (typeof window.streamUrl === 'function')
      ? window.streamUrl(nextId)
      : '/api/stream/' + nextId;
    var pre = getPreloader();
    if (pre.src && pre.src.indexOf('/api/stream/' + nextId) !== -1) return; // already loading
    pre.src = url;
    try { pre.load(); } catch (e) { /* ignore */ }
  });

  // On ended → swap. The legacy 'ended' handler advances the queue and calls
  // playCurrentTrack(); ours just primes audio.src from the preloader so
  // the actual play() call by the legacy code reuses the buffered data.
  audio.addEventListener('ended', function() {
    if (!gaplessEnabled()) return;
    var nextId = nextTrackId();
    if (!nextId || !preloader || !preloader.src) return;
    if (preloader.src.indexOf('/api/stream/' + nextId) === -1) return;
    // Move the buffered data into the main audio element by reassigning
    // its src to the preloader's. The browser reuses the cached HTTP
    // response so the load is instant.
    audio.src = preloader.src;
    try { audio.load(); } catch (e) { /* ignore */ }
    preloader.removeAttribute('src');
  }, true); // capture so we run before the legacy listener

  // Wire the Settings checkbox once Settings opens for the first time.
  function wireCheckbox() {
    var cb = document.getElementById('settingsGapless');
    if (!cb || cb._wired) return;
    cb._wired = true;
    var cfg = window._appConfig || {};
    cb.checked = !!cfg.gapless;
    cb.addEventListener('change', function() {
      var c = window._appConfig = window._appConfig || {};
      c.gapless = cb.checked;
      if (window.resonance && window.resonance.setConfig) {
        window.resonance.setConfig({ gapless: cb.checked });
      }
    });
  }
  var settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.addEventListener('click', function() {
    setTimeout(wireCheckbox, 50);
  });
  // Also try at boot in case Settings markup is already there.
  setTimeout(wireCheckbox, 1500);
})();

// ─── Library views: Year + Genres rich (v3.15) ────────────────────────────
// Two new library tabs that render into #yearList / #genreList. Re-rendered
// each time their button is clicked or the underlying library changes.
//
// Year view: groups tracks by decade then year, with a compact card per
// year showing count and a click that filters the legacy Tracks view to
// that year (year:YYYY operator) and switches back.
//
// Genres rich: card grid keyed on the genre tag. Click filters Tracks to
// genre:<name>. Designed to feel like an exploration page rather than a
// dropdown.
(function setupYearGenresViews() {
  if (typeof document === 'undefined') return;
  var yearList = document.getElementById('yearList');
  var genreList = document.getElementById('genreList');
  if (!yearList || !genreList) return;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function libraryTracks() {
    if (Array.isArray(window.allTracks)) return window.allTracks;
    if (Array.isArray(window.tracks)) return window.tracks;
    return [];
  }

  function pickYear(t) {
    if (!t) return null;
    var s = String(t.year || '').match(/^\d{4}/);
    return s ? parseInt(s[0], 10) : null;
  }

  function renderYears() {
    var src = libraryTracks();
    var byYear = {};
    src.forEach(function(t) {
      var y = pickYear(t);
      if (!y) return;
      byYear[y] = (byYear[y] || 0) + 1;
    });
    var years = Object.keys(byYear).map(Number).sort(function(a, b) { return b - a; });
    if (years.length === 0) {
      yearList.innerHTML = '<div class="lib-empty">No year tags in your library yet.</div>';
      return;
    }
    // Group by decade.
    var decades = {};
    years.forEach(function(y) {
      var d = Math.floor(y / 10) * 10;
      decades[d] = decades[d] || [];
      decades[d].push(y);
    });
    var decadeKeys = Object.keys(decades).map(Number).sort(function(a, b) { return b - a; });
    yearList.innerHTML = decadeKeys.map(function(d) {
      var rows = decades[d].map(function(y) {
        return '<button class="year-card" data-year="' + y + '" aria-label="Filter to year ' + y + '">'
          + '<span class="year-card-y">' + y + '</span>'
          + '<span class="year-card-n">' + byYear[y] + '</span>'
          + '</button>';
      }).join('');
      return '<section class="decade">'
        + '<h3>' + d + 's</h3>'
        + '<div class="year-grid">' + rows + '</div>'
        + '</section>';
    }).join('');
  }

  function renderGenres() {
    var src = libraryTracks();
    var byGenre = {};
    src.forEach(function(t) {
      var arr = (t.genres && t.genres.length) ? t.genres : (t.genre ? [t.genre] : []);
      arr.forEach(function(g) {
        if (!g) return;
        var key = String(g).trim();
        if (!key) return;
        byGenre[key] = (byGenre[key] || 0) + 1;
      });
    });
    var genres = Object.keys(byGenre).sort(function(a, b) {
      return byGenre[b] - byGenre[a] || a.localeCompare(b);
    });
    if (genres.length === 0) {
      genreList.innerHTML = '<div class="lib-empty">No genre tags in your library yet.</div>';
      return;
    }
    genreList.innerHTML = '<div class="genre-grid">' + genres.map(function(g) {
      var hue = 0;
      // Try to use the genre color helper if it exists in the legacy code.
      if (typeof window.getGenreStyle === 'function') {
        try {
          var s = window.getGenreStyle(g);
          if (s && typeof s.bg === 'string') {
            return '<button class="genre-card" data-genre="' + escHtml(g) + '" '
              + 'style="background:' + s.bg + ';color:' + (s.color || '#fff') + ';" '
              + 'aria-label="Filter to genre ' + escHtml(g) + '">'
              + '<span class="genre-card-name">' + escHtml(g) + '</span>'
              + '<span class="genre-card-n">' + byGenre[g] + '</span>'
              + '</button>';
          }
        } catch (e) { /* ignore */ }
      }
      // Fallback: deterministic hue per genre name.
      for (var i = 0; i < g.length; i++) hue = (hue * 31 + g.charCodeAt(i)) % 360;
      return '<button class="genre-card" data-genre="' + escHtml(g) + '" '
        + 'style="background:linear-gradient(135deg, hsl(' + hue + ',45%,28%), hsl(' + ((hue + 35) % 360) + ',55%,18%));color:#fff;" '
        + 'aria-label="Filter to genre ' + escHtml(g) + '">'
        + '<span class="genre-card-name">' + escHtml(g) + '</span>'
        + '<span class="genre-card-n">' + byGenre[g] + '</span>'
        + '</button>';
    }).join('') + '</div>';
  }

  function jumpToTracksWithFilter(query) {
    // Switch to Tracks view + drop the filter into the search box.
    var tracksBtn = document.querySelector('.lib-view-btn[data-view="tracks"]');
    if (tracksBtn) tracksBtn.click();
    var search = document.getElementById('search');
    if (search) {
      search.value = query;
      search.dispatchEvent(new Event('input'));
      search.dispatchEvent(new KeyboardEvent('keyup'));
    }
  }

  yearList.addEventListener('click', function(e) {
    var card = e.target.closest && e.target.closest('.year-card');
    if (!card) return;
    jumpToTracksWithFilter('year:' + card.dataset.year);
  });
  genreList.addEventListener('click', function(e) {
    var card = e.target.closest && e.target.closest('.genre-card');
    if (!card) return;
    jumpToTracksWithFilter('genre:"' + card.dataset.genre + '"');
  });

  // Re-render when the user clicks the years/genres tab. (Cheap — done on
  // demand rather than every library refresh.)
  document.querySelectorAll('.lib-view-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (btn.dataset.view === 'years') renderYears();
      else if (btn.dataset.view === 'genresrich') renderGenres();
    });
  });

  // Refresh after big library updates so the views stay in sync.
  if (typeof MutationObserver !== 'undefined') {
    var trackList = document.getElementById('trackList');
    if (trackList) {
      var lastRender = 0;
      new MutationObserver(function() {
        if (Date.now() - lastRender < 500) return;
        lastRender = Date.now();
        if (yearList.style.display !== 'none') renderYears();
        if (genreList.style.display !== 'none') renderGenres();
      }).observe(trackList, { childList: true });
    }
  }
})();

// ─── Volume persistence across track changes (v3.15.5) ────────────────────
// Some browsers (and electron's chromium) reset audio.volume to 1 when
// audio.src changes. The legacy slider only writes the volume on user
// input, so the next track played at full while the slider/icon kept
// showing the user's intended value. Re-apply the saved volume on every
// loadstart, but bow out of crossfade ramps (which deliberately mutate
// audio.volume) to avoid fighting them.
(function setupVolumePersist() {
  var audioEl = document.querySelector('audio');
  if (!audioEl) return;
  audioEl.addEventListener('loadstart', function() {
    if (window.crossfadeTriggered) return;
    var cfg = window._appConfig || {};
    if (typeof cfg.volume === 'number' && cfg.volume >= 0 && cfg.volume <= 1) {
      audioEl.volume = cfg.volume;
    }
  });
})();

// ─── Speed / pitch control (Mixing tab, v3.15) ────────────────────────────
// Sets `audio.playbackRate` directly. We disable preservesPitch so pitch
// rises with speed — that's the vinyl/DJ behavior the user asked for, and
// also what makes "Speed" feel like a real performance control instead of
// a cold timestretch. Persists in _appConfig.playbackRate.
(function setupSpeedControl() {
  if (typeof document === 'undefined') return;
  var slider = document.getElementById('speedSlider');
  var valueEl = document.getElementById('speedValue');
  var resetBtn = document.getElementById('speedReset');
  var audioEl = document.querySelector('audio');
  if (!slider || !audioEl) return;

  function applyRate(rate) {
    audioEl.playbackRate = rate;
    // Vinyl/DJ feel: pitch tracks speed.
    audioEl.preservesPitch = false;
    audioEl.mozPreservesPitch = false;
    audioEl.webkitPreservesPitch = false;
    if (valueEl) valueEl.textContent = rate.toFixed(2) + '×';
  }

  slider.addEventListener('input', function() {
    var rate = parseFloat(slider.value);
    if (!isFinite(rate) || rate <= 0) return;
    applyRate(rate);
    var cfg = window._appConfig = window._appConfig || {};
    cfg.playbackRate = rate;
    if (window.resonance && window.resonance.setConfig) {
      window.resonance.setConfig({ playbackRate: rate });
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      slider.value = '1';
      slider.dispatchEvent(new Event('input'));
    });
  }

  // Restore on boot.
  var tries = 0;
  var iv = setInterval(function() {
    tries++;
    if (window._appConfig || tries > 40) {
      clearInterval(iv);
      var saved = window._appConfig && window._appConfig.playbackRate;
      if (typeof saved === 'number' && saved > 0) {
        slider.value = String(saved);
        applyRate(saved);
      } else {
        applyRate(1);
      }
    }
  }, 250);

  // Each new track resets playbackRate to 1 implicitly on some browsers —
  // re-apply ours after every loadstart.
  audioEl.addEventListener('loadstart', function() {
    var rate = parseFloat(slider.value) || 1;
    applyRate(rate);
  });
})();

// ─── Settings extras (v3.14): theme, sleep timer, backups, radio button ────
// All injected lazily into #settingsExtras the first time the modal opens,
// so we don't have to touch the legacy settings markup. Each section is
// independent and degrades gracefully if its endpoint is missing.
(function setupSettingsExtras() {
  if (typeof document === 'undefined') return;
  var settingsBtn = document.getElementById('settingsBtn');
  var extras = document.getElementById('settingsExtras');
  if (!settingsBtn || !extras) return;
  var injected = false;

  function injectMarkup() {
    if (injected) return;
    injected = true;
    extras.innerHTML = ''
      + '<div class="settings-section"><h3>Theme</h3>'
      +   '<div class="settings-row">'
      +     '<label>Mode</label>'
      +     '<select id="settingsThemeMode">'
      +       '<option value="auto">Auto (follow OS)</option>'
      +       '<option value="dark">Dark</option>'
      +       '<option value="light">Light</option>'
      +     '</select>'
      +   '</div>'
      + '</div>'
      + '<div class="settings-section"><h3>Sleep timer</h3>'
      +   '<div class="sleep-timer-row">'
      +     '<button class="sleep-preset" data-min="15">15 min</button>'
      +     '<button class="sleep-preset" data-min="30">30 min</button>'
      +     '<button class="sleep-preset" data-min="60">1 h</button>'
      +     '<button class="sleep-preset" data-min="90">1 h 30</button>'
      +     '<input type="number" min="1" max="1440" id="sleepCustomMin" placeholder="custom (min)">'
      +     '<button id="sleepCancelBtn" class="sleep-cancel">Cancel</button>'
      +   '</div>'
      +   '<p id="sleepTimerStatus" class="settings-hint">No timer set</p>'
      + '</div>'
      + '<div class="settings-section"><h3>Backups</h3>'
      +   '<p class="settings-hint">Daily snapshot of your playlists, history, favorites, and config (kept 7 days).</p>'
      +   '<div class="backups-actions">'
      +     '<button id="backupNowBtn">Snapshot now</button>'
      +     '<button id="backupRefreshBtn">Refresh list</button>'
      +   '</div>'
      +   '<div id="backupsList" class="backups-list"></div>'
      + '</div>';

    bindTheme();
    bindSleepTimer();
    bindBackups();
  }

  settingsBtn.addEventListener('click', function() {
    injectMarkup();
    refreshSleepStatus();
    refreshBackups();
    syncTheme();
  });

  // ─── Theme ────────────────────────────────────────────────────────────
  function syncTheme() {
    var sel = document.getElementById('settingsThemeMode');
    if (!sel) return;
    var current = (window._appConfig && window._appConfig.theme)
      || document.documentElement.dataset.theme || 'auto';
    sel.value = current;
  }
  function bindTheme() {
    var sel = document.getElementById('settingsThemeMode');
    if (!sel) return;
    sel.addEventListener('change', function() {
      if (typeof window.setTheme === 'function') window.setTheme(sel.value);
    });
  }

  // ─── Sleep timer ──────────────────────────────────────────────────────
  function refreshSleepStatus() {
    var status = document.getElementById('sleepTimerStatus');
    if (!status) return;
    fetch('/api/sleep-timer').then(function(r) { return r.json(); }).then(function(s) {
      if (!s.active) { status.textContent = 'No timer set'; return; }
      var mins = Math.ceil(s.msRemaining / 60000);
      status.textContent = 'Pausing in ~' + mins + ' min (at '
        + new Date(s.endsAt).toLocaleTimeString() + ')';
    }).catch(function() {});
  }
  function startSleep(minutes) {
    fetch('/api/sleep-timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: minutes }),
    }).then(refreshSleepStatus);
  }
  function bindSleepTimer() {
    document.querySelectorAll('.sleep-preset').forEach(function(btn) {
      btn.addEventListener('click', function() { startSleep(parseInt(btn.dataset.min, 10)); });
    });
    var custom = document.getElementById('sleepCustomMin');
    if (custom) {
      custom.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var v = parseInt(custom.value, 10);
          if (Number.isFinite(v) && v > 0) { startSleep(v); custom.value = ''; }
        }
      });
    }
    var cancel = document.getElementById('sleepCancelBtn');
    if (cancel) {
      cancel.addEventListener('click', function() {
        fetch('/api/sleep-timer', { method: 'DELETE' }).then(refreshSleepStatus);
      });
    }
    // Listen for the server's sleep-timer broadcast so the status auto-updates.
    if (window.ws && typeof window.ws.addEventListener === 'function') {
      window.ws.addEventListener('message', function(ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'sleep-timer') refreshSleepStatus();
        } catch (e) {}
      });
    }
  }

  // ─── Backups ──────────────────────────────────────────────────────────
  function refreshBackups() {
    var list = document.getElementById('backupsList');
    if (!list) return;
    fetch('/api/backups').then(function(r) { return r.json(); }).then(function(d) {
      var arr = (d && d.backups) || [];
      if (arr.length === 0) {
        list.innerHTML = '<p class="settings-hint">No backups yet — one is created automatically each day.</p>';
        return;
      }
      list.innerHTML = arr.map(function(b) {
        return '<div class="backup-row">'
          + '<span class="backup-date">' + b.date + '</span>'
          + '<span class="backup-files">' + (b.files || []).length + ' files</span>'
          + '<button class="backup-restore" data-date="' + b.date + '">Restore</button>'
          + '</div>';
      }).join('');
      list.querySelectorAll('.backup-restore').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var date = btn.dataset.date;
          if (!confirm('Restore backup from ' + date + '? Current files are kept aside as .before-restore.')) return;
          fetch('/api/backups/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: date }),
          }).then(function(r) { return r.json(); }).then(function(res) {
            if (res.ok) { showToast('Restored from ' + date + ' — reload the app.'); }
            else { showToast('Restore failed: ' + (res.error || 'unknown')); }
          });
        });
      });
    }).catch(function(e) { console.warn('[gb] backups fetch failed:', e && e.message); });
  }
  function bindBackups() {
    var snap = document.getElementById('backupNowBtn');
    var refresh = document.getElementById('backupRefreshBtn');
    if (snap) snap.addEventListener('click', function() {
      fetch('/api/backups', { method: 'POST' }).then(refreshBackups);
    });
    if (refresh) refresh.addEventListener('click', refreshBackups);
  }
})();

// ─── Radio mode trigger (button on Now Playing + context) ─────────────────
// Adds a "Start radio" button next to the current track info in Now Playing.
// On click, posts /api/radio/play which replaces the queue with a similar-
// tracks queue scored by lib/radio.js (genre, artist, year, album-artist).
(function setupRadioButton() {
  if (typeof document === 'undefined') return;
  var meta = document.getElementById('npTrackMeta');
  if (!meta) return;

  var btn = document.createElement('button');
  btn.id = 'startRadioBtn';
  btn.className = 'np-radio-btn';
  btn.title = 'Build a 50-track queue of similar songs (same artist / genre / era) and start playing';
  btn.setAttribute('aria-label', 'Start a radio mix from this track');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none" aria-hidden="true"><path d="M3.24 6.15a2 2 0 00-.97 1.71v12.04a2 2 0 002 2h15.46a2 2 0 002-2V7.86a2 2 0 00-2-2H8.66l8.42-3.42a1 1 0 00-.74-1.86L3.83 5.85a2 2 0 00-.59.3zm14.39 13.5a3.5 3.5 0 11-1-6.85 3.5 3.5 0 011 6.85z"/></svg> Start a radio mix';
  btn.style.display = 'none';
  meta.parentElement.appendChild(btn);

  function currentTrackId() {
    if (typeof window.queue !== 'undefined' && Array.isArray(window.queue)
        && typeof window.currentIndex === 'number') {
      return window.queue[window.currentIndex];
    }
    return null;
  }

  function refresh() {
    var id = currentTrackId();
    btn.style.display = (id != null) ? 'inline-flex' : 'none';
  }

  btn.addEventListener('click', function() {
    var id = currentTrackId();
    if (id == null) return;
    fetch('/api/radio/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: id, limit: 50 }),
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.ok) {
        showToast('Radio queue: ' + d.length + ' tracks');
      } else {
        showToast('Could not start radio: ' + (d.error || 'unknown'));
      }
    }).catch(function() {});
  });

  // The button visibility tracks the currentIndex changes — poll cheap and
  // sometimes (the canonical state mutates from many places, hooking into
  // each is fragile).
  setInterval(refresh, 1000);
})();

// ─── Mode guest: track our own clientId, expose role badge, send clientId ──
// The server pushes a `whoami` message right after the WS handshake. We
// remember our id so we can stamp every /api/remote/command with it (the
// server uses it to look up our role).
(function setupGuestMode() {
  if (typeof window === 'undefined') return;
  window.gbClientId = null;

  // Hook an MO observer for the WS that the legacy code creates — easier
  // than refactoring base.js. We just listen to the DOM for now-playing
  // updates, but the actual whoami arrives over WS.
  // The legacy WS instance is stored in `window.ws` after init() in base.js.
  function attachWhoami() {
    var ws = window.ws;
    if (!ws || ws._whoamiHooked) return;
    ws._whoamiHooked = true;
    ws.addEventListener('message', function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'whoami' && msg.data && msg.data.id) {
          window.gbClientId = msg.data.id;
        }
        if (msg.type === 'users:changed') refreshGuestBadge();
      } catch (e) {}
    });
  }
  setInterval(attachWhoami, 500);

  // Wrap fetch so any POST to /api/remote/command auto-stamps clientId. We
  // restore the original fetch on cleanup but in practice this lives for
  // the page lifetime.
  var originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/remote/command') !== -1
          && init && init.method && init.method.toUpperCase() === 'POST'
          && init.body && typeof init.body === 'string'
          && window.gbClientId) {
        try {
          var parsed = JSON.parse(init.body);
          if (parsed && typeof parsed === 'object' && !parsed.clientId) {
            parsed.clientId = window.gbClientId;
            init = Object.assign({}, init, { body: JSON.stringify(parsed) });
          }
        } catch (e) { /* not JSON, ignore */ }
      }
    } catch (e) {}
    return originalFetch(input, init);
  };

  function refreshGuestBadge() {
    if (!window.gbClientId) return;
    fetch('/api/users').then(function(r) { return r.json(); }).then(function(users) {
      var me = users.find(function(u) { return u.id === window.gbClientId; });
      var existing = document.getElementById('guestBadge');
      if (me && me.role === 'guest') {
        if (!existing) {
          var b = document.createElement('span');
          b.id = 'guestBadge';
          b.className = 'guest-badge';
          b.title = 'You can only suggest tracks — the host limited your access.';
          b.textContent = 'GUEST';
          var hr = document.querySelector('.header-right');
          if (hr) hr.insertBefore(b, hr.firstChild);
        }
      } else if (existing) {
        existing.remove();
      }
    }).catch(function() {});
  }
})();

// ─── Mode guest: role buttons in the Devices tab ──────────────────────────
// Augments each row in #usersList with "Make guest" / "Restore full access"
// when the host is looking at the Devices panel.
(function setupDeviceRoles() {
  if (typeof document === 'undefined') return;
  var panel = document.getElementById('panel-devices');
  if (!panel) return;

  function decorate() {
    var users = panel.querySelectorAll('[data-user-id]');
    if (users.length === 0) return;
    users.forEach(function(row) {
      if (row.querySelector('.role-toggle')) return;
      var id = row.dataset.userId;
      var role = row.dataset.role || 'full';
      var btn = document.createElement('button');
      btn.className = 'role-toggle';
      btn.textContent = role === 'guest' ? 'Restore full access' : 'Make guest';
      btn.addEventListener('click', function() {
        var newRole = role === 'guest' ? 'full' : 'guest';
        fetch('/api/users/' + id + '/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d.ok) {
            // Re-fetch the list so role is re-rendered consistently.
            if (typeof window.fetchUsers === 'function') window.fetchUsers();
          }
        });
      });
      row.appendChild(btn);
    });
  }

  // Re-decorate on each render of the Devices list. The legacy fetchUsers()
  // rebuilds the inner HTML; we observe and patch.
  if (typeof MutationObserver !== 'undefined') {
    var obs = new MutationObserver(decorate);
    var list = document.getElementById('usersList');
    if (list) obs.observe(list, { childList: true, subtree: true });
  }
  setInterval(decorate, 2000); // safety net for env without MO
})();
