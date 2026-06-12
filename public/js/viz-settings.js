// === viz-settings.js — slice of public/js/main.js (legacy monolith) ===
// This file is loaded by index.html in a specific order.
// Do not change the order without auditing dependencies.
// ─── Visualizer ──────────────────────────────────────────────────────────────
var vizContainer = document.getElementById('vizContainer');
var vizCanvas = document.getElementById('vizCanvas');
var viz = null, vizInitialized = false, vizVisible = true, vizMode = 'drift';
// Set active class to match default vizVisible=true (canvas visible)
vizContainer.classList.add('active');

function initViz() {
  if (vizInitialized) return;
  try {
    viz = new Visualizer(vizCanvas, audio);
    viz.setMode(vizMode);
    viz.setColorMode(vizColorMode);
    viz.initAudio();
    vizInitialized = true;
    viz.start();
  } catch(e) { console.warn('Viz init failed:', e); }
}

function toggleViz() {
  vizVisible = !vizVisible;
  vizContainer.classList.toggle('active', vizVisible);
  if (vizVisible) { if (!vizInitialized) initViz(); if (viz) { viz.resize(); viz.start(); } }
  else { if (viz) viz.stop(); }
}

var vizColorMode = 'theme';
document.getElementById('vizGearBtn').addEventListener('click', function(e) { e.stopPropagation(); document.getElementById('vizMenu').classList.toggle('open'); });
document.addEventListener('click', function() { document.getElementById('vizMenu').classList.remove('open'); });
// Shape selection
document.querySelectorAll('.viz-menu-item[data-viz]').forEach(function(item) {
  item.addEventListener('click', function(e) {
    e.stopPropagation();
    vizMode = item.dataset.viz;
    if (viz) viz.setMode(vizMode);
    document.querySelectorAll('.viz-menu-item[data-viz]').forEach(function(i){i.classList.remove('active')});
    item.classList.add('active');
    document.getElementById('vizMenu').classList.remove('open');
    if (isDesktop && window.resonance) window.resonance.setConfig({ vizMode: vizMode });
  });
});
// Color mode selection
document.querySelectorAll('.viz-menu-item[data-color]').forEach(function(item) {
  item.addEventListener('click', function(e) {
    e.stopPropagation();
    vizColorMode = item.dataset.color;
    if (viz) viz.setColorMode(vizColorMode);
    document.querySelectorAll('.viz-menu-item[data-color]').forEach(function(i){i.classList.remove('active')});
    item.classList.add('active');
    document.getElementById('vizMenu').classList.remove('open');
    if (isDesktop && window.resonance) window.resonance.setConfig({ vizColorMode: vizColorMode });
  });
});
document.getElementById('vizCloseItem').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('vizMenu').classList.remove('open');
  toggleViz();
  document.getElementById('vizCloseItem').textContent = vizVisible ? 'Disable visualization' : 'Enable visualization';
});

// Vertical resizer (cover+viz / queue split) — constrained: min 20%, max 65%
(function() {
  var vresizer = document.getElementById('npVResizer');
  var npRow = document.getElementById('npRow');
  var dragging = false;
  if (!vresizer || !npRow) return;
  // Restore saved position or default to cover-max height
  var savedPct = localStorage.getItem('gb-viz-height');
  if (savedPct) { npRow.style.flex = 'none'; npRow.style.height = savedPct + '%'; }
  vresizer.addEventListener('mousedown', function(e) {
    e.preventDefault(); dragging = true; vresizer.classList.add('active');
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var panel = npRow.parentElement;
    var panelRect = panel.getBoundingClientRect();
    var pct = ((e.clientY - panelRect.top) / panelRect.height) * 100;
    pct = Math.max(20, Math.min(65, pct));
    npRow.style.flex = 'none';
    npRow.style.height = pct + '%';
    if (viz) viz.resize();
  });
  document.addEventListener('mouseup', function() {
    if (dragging) {
      dragging = false; vresizer.classList.remove('active');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      // Persist position
      var h = parseFloat(npRow.style.height);
      if (h) localStorage.setItem('gb-viz-height', h);
    }
  });
})();

// Auto-init on first play
audio.addEventListener('play', function() { if (!vizInitialized) initViz(); if (vizVisible && viz) viz.start(); }, { once: true });

// ─── Settings Modal ──────────────────────────────────────────────────────────
var settingsModal = document.getElementById('settingsModal');
var settingsFolders = [];

// About modal (fancy open/close)
document.getElementById('shortcutsBtn').addEventListener('click', function() {
  var modal = document.getElementById('aboutModal');
  modal.classList.remove('closing');
  modal.classList.add('open');
  if (window.resonance && window.resonance.getVersion) {
    window.resonance.getVersion().then(function(v) {
      document.getElementById('aboutVersion').textContent = 'v' + v;
    });
  }
});
document.getElementById('aboutModal').addEventListener('click', function(e) {
  if (e.target === this || e.target.closest('.about-card') === null) {
    var modal = this;
    modal.classList.add('closing');
    setTimeout(function() { modal.classList.remove('open', 'closing'); }, 450);
  }
});
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsCancel').addEventListener('click', function() { settingsModal.classList.remove('open'); });
document.getElementById('settingsClose').addEventListener('click', function() { settingsModal.classList.remove('open'); });
settingsModal.addEventListener('click', function(e) { if (e.target === settingsModal) settingsModal.classList.remove('open'); });

// ─── Update State (global, syncs badge + Settings section) ──────────────────
window._updateState = { status: 'checking', version: null, percent: null };

function syncSettingsUpdate() {
  var label = document.getElementById('settingsUpdateStatus');
  if (!label) return;
  var st = window._updateState;
  if (st.status === 'available') {
    label.textContent = '⬆ v' + st.version + ' available';
    label.style.color = '#b68adf'; label.style.borderColor = '#b68adf'; label.style.background = 'rgba(182,138,223,0.1)';
  } else if (st.status === 'downloading') {
    label.textContent = '↓ Downloading…' + (st.percent ? ' ' + st.percent + '%' : '');
    label.style.color = 'var(--accent)'; label.style.borderColor = 'var(--accent)'; label.style.background = 'rgba(232,164,53,0.08)';
  } else if (st.status === 'ready') {
    label.textContent = '✓ v' + st.version + ' ready';
    label.style.color = 'var(--green)'; label.style.borderColor = 'var(--green)'; label.style.background = 'rgba(122,196,122,0.08)';
  } else if (st.status === 'error') {
    label.textContent = '✕ Failed — retry?';
    label.style.color = 'var(--red)'; label.style.borderColor = 'var(--red)'; label.style.background = 'rgba(224,85,85,0.08)';
  } else if (st.status === 'uptodate') {
    label.textContent = '✓ Up to date';
    label.style.color = 'var(--green)'; label.style.borderColor = 'var(--green)'; label.style.background = 'rgba(122,196,122,0.08)';
  } else {
    label.textContent = '';
    label.style.background = 'transparent';
  }
}

function setBadgeStyle(badge, type) {
  badge.style.display = 'inline';
  if (type === 'available') { badge.style.color = 'var(--green)'; badge.style.borderColor = 'var(--green)'; badge.style.background = 'rgba(122,196,122,0.1)'; }
  else if (type === 'downloading') { badge.style.color = 'var(--accent)'; badge.style.borderColor = 'var(--accent)'; badge.style.background = 'rgba(232,164,53,0.1)'; }
  else if (type === 'ready') { badge.style.color = 'var(--accent)'; badge.style.borderColor = 'var(--accent)'; badge.style.background = 'var(--accent-subtle)'; }
  else if (type === 'error') { badge.style.color = 'var(--red)'; badge.style.borderColor = 'var(--red)'; badge.style.background = 'rgba(224,85,85,0.1)'; }
}

function triggerDownload() {
  var badge = document.getElementById('updateBadge');
  var wasError = window._updateState.status === 'error';
  badge.textContent = wasError ? 'retrying…' : 'downloading…';
  setBadgeStyle(badge, 'downloading');
  badge.onclick = null; badge.style.cursor = 'default';
  window._updateState.status = 'downloading';
  syncSettingsUpdate();
  if (wasError) {
    // After an error, electron-updater needs a fresh check before download
    window._updateState._autoDownload = true;
    window.resonance.checkForUpdates();
  } else {
    window.resonance.downloadUpdate();
  }
}

async function openSettings() {
  if (window.resonance) {
    var cfg = await window.resonance.getConfig();
    settingsFolders = cfg.musicFolders || [];
    document.getElementById('settingsVizMode').value = vizMode;
    document.getElementById('settingsVizColor').value = vizColorMode;
    document.getElementById('settingsVizEnabled').checked = vizVisible;
    document.getElementById('settingsHue').value = cfg.hue != null ? cfg.hue : 0;
    document.getElementById('settingsLanEnabled').checked = cfg.lanEnabled !== false;
    // List audio output devices
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var sel = document.getElementById('settingsAudioOutput');
        sel.innerHTML = '<option value="">Default</option>';
        devices.filter(function(d){ return d.kind === 'audiooutput'; }).forEach(function(d) {
          var opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || ('Speaker ' + d.deviceId.slice(0,8));
          if (cfg.audioOutput === d.deviceId) opt.selected = true;
          sel.appendChild(opt);
        });
      });
    }
    document.getElementById('settingsCrossfade').checked = !!cfg.crossfade;
    document.getElementById('settingsCrossfadeDur').value = cfg.crossfadeDuration || 3;
    document.getElementById('crossfadeVal').textContent = cfg.crossfadeDuration || 3;
    document.getElementById('crossfadeDuration').style.display = cfg.crossfade ? 'block' : 'none';
    var ver = await window.resonance.getVersion();
    document.getElementById('aboutVersion').textContent = 'v' + ver;
    document.getElementById('settingsVersionLabel').textContent = 'v' + ver;
    document.getElementById('settingsUpdatesSection').style.display = '';
    syncSettingsUpdate();

    // Generate QR code for mobile access (via server API)
    var qrContainer = document.getElementById('qrCode');
    var qrUrl = document.getElementById('qrUrl');
    var qrLabel = document.getElementById('qrLabel');
    try {
      var qrData = await fetch('/api/qrcode').then(function(r){ return r.json(); });
      if (qrData.svg) {
        qrContainer.style.display = 'flex';
        qrContainer.innerHTML = qrData.svg;
        qrUrl.textContent = qrData.url;
        qrLabel.textContent = 'Scan from your phone to open Ghetto Blaster';
      }
    } catch(e) {
      qrContainer.style.display = 'none';
      qrUrl.textContent = '';
      qrLabel.textContent = 'QR code unavailable';
    }
  } else {
    settingsFolders = [];
    document.getElementById('aboutVersion').textContent = 'web mode';
    document.getElementById('settingsUpdatesSection').style.display = 'none';
  }
  renderFolderList();
  settingsModal.classList.add('open');
}

function renderFolderList() {
  var list = document.getElementById('folderList');
  if (!settingsFolders.length) {
    list.innerHTML = '<p style="font-size:0.75rem;color:var(--text-dim);">No folders configured. Add one to get started.</p>';
    return;
  }
  list.innerHTML = settingsFolders.map(function(f, i) {
    return '<div class="folder-item"><span>' + esc(f) + '</span><button data-idx="' + i + '">×</button></div>';
  }).join('');
  list.querySelectorAll('button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      settingsFolders.splice(parseInt(btn.dataset.idx), 1);
      renderFolderList();
    });
  });
}

document.getElementById('addFolderBtn').addEventListener('click', async function() {
  if (window.resonance) {
    var folder = await window.resonance.pickFolder();
    if (folder) { settingsFolders.push(folder); renderFolderList(); }
  } else {
    var folder = prompt('Enter folder path:');
    if (folder) { settingsFolders.push(folder); renderFolderList(); }
  }
});

// Crossfade settings UI
document.getElementById('settingsCrossfade').addEventListener('change', function() {
  document.getElementById('crossfadeDuration').style.display = this.checked ? 'block' : 'none';
});
document.getElementById('settingsCrossfadeDur').addEventListener('input', function(e) {
  document.getElementById('crossfadeVal').textContent = e.target.value;
});

// Live preview hue
document.getElementById('settingsHue').addEventListener('input', function(e) {
  document.documentElement.style.setProperty('--hue', e.target.value);
});

// Download QR as PNG
document.getElementById('downloadQrBtn').addEventListener('click', function() {
  var svg = document.querySelector('#qrCode svg');
  if (!svg) return;
  var svgData = new XMLSerializer().serializeToString(svg);
  var canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 400;
  var ctx = canvas.getContext('2d');
  var img = new Image();
  img.onload = function() {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 400);
    ctx.drawImage(img, 20, 20, 360, 360);
    var a = document.createElement('a');
    a.download = 'ghetto-blaster-qr.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
});

async function saveSettings(opts) {
  var doRescan = opts && opts.rescan;
  vizMode = document.getElementById('settingsVizMode').value;
  vizColorMode = document.getElementById('settingsVizColor').value;
  vizVisible = document.getElementById('settingsVizEnabled').checked;
  var hue = parseInt(document.getElementById('settingsHue').value);
  var lanEnabled = document.getElementById('settingsLanEnabled').checked;
  var crossfade = document.getElementById('settingsCrossfade').checked;
  var crossfadeDuration = parseInt(document.getElementById('settingsCrossfadeDur').value) || 3;
  var audioOutput = document.getElementById('settingsAudioOutput').value;

  // Switch audio output device
  if (audioOutput && audio.setSinkId) {
    audio.setSinkId(audioOutput).catch(function(e) {
      console.warn('Could not set audio output:', e);
      audio.setSinkId('default').catch(function(){});
      showToast('Audio device unavailable — using default');
    });
  } else if (!audioOutput && audio.setSinkId) {
    audio.setSinkId('default').catch(function(){});
  }

  if (viz) { viz.setMode(vizMode); viz.setColorMode(vizColorMode); }
  document.querySelectorAll('.viz-menu-item[data-viz]').forEach(function(i){ i.classList.toggle('active', i.dataset.viz === vizMode); });
  document.querySelectorAll('.viz-menu-item[data-color]').forEach(function(i){ i.classList.toggle('active', i.dataset.color === vizColorMode); });
  document.getElementById('vizContainer').classList.toggle('active', vizVisible);
  // Force a clean restart of the visualizer after settings change. Without
  // the stop() the rAF loop kept by start() can be left orphaned by the
  // mode/color switch above and the canvas freezes until the user toggles
  // disable/enable manually. Defer slightly so the DOM has time to apply
  // the .active class change before resize() reads its dimensions.
  if (vizVisible && viz) {
    setTimeout(function() { try { viz.stop(); viz.resize(); viz.start(); } catch (e) {} }, 50);
  } else if (viz) {
    try { viz.stop(); } catch (e) {}
  }

  // Apply theme
  document.documentElement.style.setProperty('--hue', hue);

  // Close modal immediately
  settingsModal.classList.remove('open');

  if (window.resonance) {
    window._appConfig = { musicFolders: settingsFolders, vizEnabled: vizVisible, vizMode: vizMode, vizColorMode: vizColorMode, hue: hue, lanEnabled: lanEnabled, crossfade: crossfade, crossfadeDuration: crossfadeDuration, audioOutput: audioOutput };
    await window.resonance.setConfig(window._appConfig);
  }

  if (doRescan) {
    api('/rescan', 'POST').then(function() {
      fetchTracks();
      fetchGenres();
    }).catch(function(){});
    showToast('Settings saved. Scanning…');
  } else {
    showToast('Settings saved');
  }
}

document.getElementById('settingsSave').addEventListener('click', function() { saveSettings({ rescan: true }); });
document.getElementById('settingsSaveOnly').addEventListener('click', function() { saveSettings({ rescan: false }); });

// ─── Electron Integration ───────────────────────────────────────────────────
if (isDesktop) {
  // Load persisted settings (viz + volume + theme + crossfade)
  window.resonance.getConfig().then(function(cfg) {
    window._appConfig = cfg;
    if (cfg.vizEnabled === false) { vizVisible = false; document.getElementById('vizContainer').classList.remove('active'); }
    else { vizVisible = true; document.getElementById('vizContainer').classList.add('active'); }
    if (cfg.vizMode) { vizMode = cfg.vizMode; if (viz) viz.setMode(vizMode); }
    if (cfg.vizColorMode) { vizColorMode = cfg.vizColorMode; if (viz) viz.setColorMode(vizColorMode); document.querySelectorAll('.viz-menu-item[data-color]').forEach(function(i){ i.classList.toggle('active', i.dataset.color === vizColorMode); }); }
    if (cfg.volume != null) { audio.volume = cfg.volume; document.getElementById('volumeSlider').value = cfg.volume; }
    if (cfg.hue != null) { document.documentElement.style.setProperty('--hue', cfg.hue); }
    // Audio output: always start on default device (BT speaker may be off)
  });

  // Window controls in header
  document.getElementById('winControls').classList.add('visible');
  document.getElementById('tbClose').addEventListener('click', function() { window.resonance.close(); });
  document.getElementById('tbMin').addEventListener('click', function() { window.resonance.minimize(); });
  document.getElementById('tbMax').addEventListener('click', function() { window.resonance.maximize(); });

  // Server pill — shows "Online", click toggles popover
  var pill = document.getElementById('serverPill');
  var popover = document.getElementById('serverPopover');
  pill.style.display = 'flex';
  var serverInfo = { ip: '...', port: 3000, version: '' };
  window.resonance.getServerStatus().then(function(s) { serverInfo.ip = s.ip; serverInfo.port = s.port || 3000; });
  window.resonance.getVersion().then(function(v) { serverInfo.version = v; });
  pill.addEventListener('click', function(e) {
    e.stopPropagation();
    if (popover.contains(e.target)) return; // don't toggle when clicking inside popover
    var isOpen = popover.classList.toggle('open');
    if (isOpen) {
      document.getElementById('spAddr').textContent = 'http://' + serverInfo.ip + ':' + serverInfo.port;
      document.getElementById('spVersion').textContent = 'v' + serverInfo.version;
    }
  });
  // Close popover on outside click
  document.addEventListener('click', function(e) { if (!pill.contains(e.target)) popover.classList.remove('open'); });
  // Mode toggle in popover
  document.getElementById('spModeOn').addEventListener('click', function() {
    var cfg = window._appConfig || {};
    var isLan = cfg.lanEnabled !== false;
    cfg.lanEnabled = !isLan;
    window._appConfig = cfg;
    window.resonance.setConfig(cfg);
    this.textContent = cfg.lanEnabled ? 'LAN Server' : 'Offline';
    this.className = 'sp-mode ' + (cfg.lanEnabled ? 'on' : 'off');
    document.getElementById('spHint').style.display = 'block';
  });

  // Post audio output devices to server (for mobile Output tab)
  function postOutputDevices() {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var currentId = (window._appConfig && window._appConfig.audioOutput) || '';
      var outputs = devices.filter(function(d){ return d.kind === 'audiooutput'; }).map(function(d) {
        return { id: d.deviceId, label: d.label || 'Speaker ' + d.deviceId.slice(0,8), active: d.deviceId === currentId || (!currentId && d.deviceId === 'default') };
      });
      fetch('/api/desktop/outputs', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(outputs) }).catch(function(){});
    });
  }
  postOutputDevices();
  setInterval(postOutputDevices, 30000); // Refresh every 30s (devices may connect/disconnect)

  // Broadcast desktop player state to server (so mobile can see it)
  function broadcastDesktopState() {
    var trackId = queue[currentIndex];
    var track = trackId != null ? getTrack(trackId) : null;
    var payload = {
      trackId: trackId != null ? trackId : null,
      title: track ? track.title : '',
      artist: track ? track.artist : '',
      isPlaying: isPlaying,
      progress: audio.currentTime || 0,
      duration: audio.duration || 0,
      hasCover: track ? track.hasCover : false,
      genre: track ? track.genre : '',
      volume: audio.volume,
      queueLength: queue.length,
      currentIndex: currentIndex,
    };
    fetch('/api/desktop/state', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(function(){});
  }

  // Broadcast on play/pause/track change
  audio.addEventListener('play', broadcastDesktopState);
  audio.addEventListener('pause', broadcastDesktopState);
  audio.addEventListener('ended', broadcastDesktopState);
  // Broadcast progress every 1s
  setInterval(function() { if (isPlaying) broadcastDesktopState(); }, 1000);

  // Post full queue to server (only when queue content changes)
  var lastQueueSent = '';
  function broadcastDesktopQueue() {
    var sig = queue.length + ':' + currentIndex + ':' + (queue[0] || '') + ':' + (queue[queue.length-1] || '');
    if (sig === lastQueueSent) return;
    lastQueueSent = sig;
    var queueData = [];
    for (var qi = 0; qi < queue.length; qi++) {
      var t = getTrack(queue[qi]);
      if (t) queueData.push({ id: t.id, title: t.title, artist: t.artist, album: t.album, albumArtist: t.albumArtist, year: t.year, hasCover: t.hasCover, duration: t.duration, genre: t.genre, qindex: qi });
    }
    fetch('/api/desktop/queue', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(queueData) }).catch(function(){});
  }

  // Hook into renderQueue to broadcast queue changes
  var _origRenderQueue = renderQueue;
  renderQueue = function() { _origRenderQueue(); broadcastDesktopQueue(); };

  // Broadcast queue on startup and after scan completes
  setTimeout(broadcastDesktopQueue, 2000);
  setTimeout(function() { lastQueueSent = ''; broadcastDesktopQueue(); }, 8000);

  // Listen for remote commands from mobile
  // (via WS — handled below in WS section)

  // Show Devices + Stats tabs (desktop only)
  document.getElementById('devicesTab').style.display = '';
  document.getElementById('statsTab').style.display = '';
  document.querySelector('[data-tab="devices"]').addEventListener('click', function() { fetchUsers(); fetchOutputDevices(); });
  document.querySelector('[data-tab="stats"]').addEventListener('click', fetchStats);
  document.getElementById('refreshUsersBtn').addEventListener('click', fetchUsers);
  setInterval(function() { if (document.getElementById('panel-devices').classList.contains('active')) fetchUsers(); }, 10000);

  // Updates — wire IPC events to global state + badge
  window.resonance.onUpdateAvailable(function(d) {
    var badge = document.getElementById('updateBadge');
    var shouldAutoDownload = window._updateState && window._updateState._autoDownload;
    window._updateState = { status: 'available', version: d.version };
    if (shouldAutoDownload) {
      // This is a retry after error — auto-trigger download
      badge.textContent = 'downloading…';
      setBadgeStyle(badge, 'downloading');
      badge.onclick = null; badge.style.cursor = 'default';
      window._updateState.status = 'downloading';
      syncSettingsUpdate();
      window.resonance.downloadUpdate();
    } else {
      badge.textContent = 'v' + d.version + ' available';
      setBadgeStyle(badge, 'available');
      badge.style.cursor = 'pointer';
      badge.onclick = triggerDownload;
      syncSettingsUpdate();
    }
  });
  window.resonance.onUpdateProgress(function(d) {
    var badge = document.getElementById('updateBadge');
    badge.textContent = 'downloading… ' + d.percent + '%';
    window._updateState.status = 'downloading';
    window._updateState.percent = d.percent;
    syncSettingsUpdate();
  });
  window.resonance.onUpdateDownloaded(function(d) {
    var badge = document.getElementById('updateBadge');
    window._updateState = { status: 'ready', version: d.version };
    badge.textContent = 'v' + d.version + ' ready — click to install';
    setBadgeStyle(badge, 'ready');
    badge.style.cursor = 'pointer';
    badge.onclick = function() { window.resonance.restartToUpdate(); };
    syncSettingsUpdate();
  });
  window.resonance.onUpdateError(function() {
    var badge = document.getElementById('updateBadge');
    window._updateState.status = 'error';
    badge.textContent = 'update error — click to retry';
    setBadgeStyle(badge, 'error');
    badge.style.cursor = 'pointer';
    badge.onclick = triggerDownload;
    syncSettingsUpdate();
  });
  window.resonance.onUpdateUpToDate(function() {
    window._updateState.status = 'uptodate';
    syncSettingsUpdate();
  });

  // Pull current state at boot — covers the race where main.js emitted an
  // update event BEFORE the renderer's listeners above were registered
  // (the first checkForUpdates fires 5s into app boot, which can outpace
  // the script bundle on cold install).
  if (typeof window.resonance.getUpdateState === 'function') {
    window.resonance.getUpdateState().then(function(state) {
      if (!state || !state.status || state.status === 'idle') return;
      var badge = document.getElementById('updateBadge');
      window._updateState = {
        status: state.status,
        version: state.version,
        percent: state.percent,
      };
      if (state.status === 'available') {
        badge.textContent = 'v' + state.version + ' available';
        setBadgeStyle(badge, 'available');
        badge.style.cursor = 'pointer';
        badge.onclick = triggerDownload;
      } else if (state.status === 'downloading') {
        badge.textContent = 'downloading…' + (state.percent ? ' ' + state.percent + '%' : '');
        setBadgeStyle(badge, 'downloading');
      } else if (state.status === 'ready') {
        badge.textContent = 'v' + state.version + ' ready — click to install';
        setBadgeStyle(badge, 'ready');
        badge.style.cursor = 'pointer';
        badge.onclick = function() { window.resonance.restartToUpdate(); };
      } else if (state.status === 'error') {
        badge.textContent = 'update error — click to retry';
        setBadgeStyle(badge, 'error');
        badge.style.cursor = 'pointer';
        badge.onclick = triggerDownload;
      }
      syncSettingsUpdate();
    }).catch(function() { /* ignore */ });
  }

  // Settings: Check for updates button
  document.getElementById('settingsCheckUpdate').addEventListener('click', function() {
    var label = document.getElementById('settingsUpdateStatus');
    if (window._updateState.status === 'available' || window._updateState.status === 'error') {
      triggerDownload();
    } else if (window._updateState.status === 'ready') {
      window.resonance.restartToUpdate();
    } else {
      label.textContent = 'Checking…';
      label.style.color = 'var(--text-dim)'; label.style.borderColor = 'var(--border)';
      window.resonance.checkForUpdates();
    }
  });
}

function fetchUsers() {
  fetch('/api/users').then(function(r){ return r.json(); }).then(function(users) {
    var list = document.getElementById('usersList');
    if (!list) return;
    // Filter out the first connection (desktop itself)
    if (users.length > 1) users = users.slice(1);
    else { users = []; }
    if (!users.length) { list.innerHTML = '<p style="font-size:0.78rem;color:var(--text-dim);">No remote devices connected</p>'; return; }
    var USER_COLORS = ['#e8a435','#b68adf','#7ac47a','#5ba8e8','#e06b9f','#4dd4ac','#c47a7a','#8b5cf6'];
    list.innerHTML = users.map(function(u, i) {
      var color = USER_COLORS[i % USER_COLORS.length];
      var isLast = i === users.length - 1;
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;' + (isLast ? '' : 'border-bottom:1px solid var(--border);') + '">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;color:#0a0a0b;">' + u.name.charAt(0).toUpperCase() + '</div>' +
        '<div><div style="font-size:0.85rem;font-weight:500;">' + u.name + '</div><div style="font-size:0.7rem;color:var(--text-dim);">Connected ' + new Date(u.connectedAt).toLocaleTimeString() + '</div></div>' +
      '</div>';
    }).join('');
  }).catch(function(){});
}

// ─── Output Tab ──────────────────────────────────────────────────────────────
function fetchOutputDevices() {
  var list = document.getElementById('outputList');
  if (!list) return;

  if (isDesktop && navigator.mediaDevices) {
    // Desktop: list local audio output devices
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var outputs = devices.filter(function(d) { return d.kind === 'audiooutput'; });
      var currentId = (window._appConfig && window._appConfig.audioOutput) || '';
      list.innerHTML = outputs.map(function(d) {
        var active = d.deviceId === currentId || (!currentId && d.deviceId === 'default');
        var label = d.label || ('Speaker ' + d.deviceId.slice(0, 8));
        return '<div class="group-card" data-device="' + d.deviceId + '" style="' + (active ? 'background:var(--accent-subtle);border-left:3px solid var(--accent);' : '') + '">' +
          '<div class="group-icon" style="background:' + (active ? 'var(--accent)' : 'var(--surface)') + ';color:' + (active ? '#0a0a0b' : 'var(--text-dim)') + ';font-size:1.2rem;">&#9835;</div>' +
          '<div><div class="group-name">' + esc(label) + '</div><div class="group-count">' + (active ? 'Active' : 'Click to switch') + '</div></div></div>';
      }).join('') || '<p style="font-size:0.78rem;color:var(--text-dim);">No audio devices found</p>';

      list.querySelectorAll('.group-card').forEach(function(card) {
        card.addEventListener('click', function() {
          var deviceId = card.dataset.device;
          if (audio.setSinkId) {
            audio.setSinkId(deviceId).then(function() {
              window._appConfig = window._appConfig || {};
              window._appConfig.audioOutput = deviceId;
              if (window.resonance) window.resonance.setConfig({ audioOutput: deviceId });
              fetchOutputDevices(); // refresh UI
              showToast('Output switched');
            }).catch(function(e) {
              console.warn('setSinkId failed:', e);
              // Fallback to default device
              audio.setSinkId('default').then(function() {
                window._appConfig = window._appConfig || {};
                window._appConfig.audioOutput = 'default';
                if (window.resonance) window.resonance.setConfig({ audioOutput: 'default' });
                fetchOutputDevices();
                showToast('Device unavailable — switched to default');
              }).catch(function() {
                showToast('Cannot switch output — device unavailable');
              });
            });
          }
        });
      });
    });
  } else {
    // Mobile: show remote output control
    fetch('/api/desktop/outputs').then(function(r){ return r.json(); }).then(function(outputs) {
      list.innerHTML = outputs.map(function(d) {
        return '<div class="group-card" data-device="' + d.id + '" style="' + (d.active ? 'background:var(--accent-subtle);border-left:3px solid var(--accent);' : '') + '">' +
          '<div class="group-icon" style="background:' + (d.active ? 'var(--accent)' : 'var(--surface)') + ';color:' + (d.active ? '#0a0a0b' : 'var(--text-dim)') + ';font-size:1.2rem;">&#9835;</div>' +
          '<div><div class="group-name">' + esc(d.label) + '</div><div class="group-count">' + (d.active ? 'Active' : 'Tap to switch') + '</div></div></div>';
      }).join('') || '<p style="font-size:0.78rem;color:var(--text-dim);">No outputs available</p>';

      list.querySelectorAll('.group-card').forEach(function(card) {
        card.addEventListener('click', function() {
          sendRemoteCommand('set-output', { deviceId: card.dataset.device });
          showToast('Switching output...');
          setTimeout(fetchOutputDevices, 1000);
        });
      });
    }).catch(function() {
      list.innerHTML = '<p style="font-size:0.78rem;color:var(--text-dim);">Connect to server to see outputs</p>';
    });
  }
}

// Output devices are fetched when Devices tab is clicked (see desktop init above)

// BT Scan button — opens Windows Bluetooth settings
document.getElementById('btScanBtn').addEventListener('click', function() {
  if (isDesktop && window.resonance && window.resonance.openBluetoothSettings) {
    window.resonance.openBluetoothSettings();
    showToast('Opening Bluetooth settings — pair your device, then come back');
    // Refresh device list after user may have paired
    setTimeout(fetchOutputDevices, 8000);
  } else {
    showToast('Pair Bluetooth from your device settings, then refresh');
  }
});

