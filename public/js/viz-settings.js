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

var vizColorMode = 'cover';
// Legacy vizGearBtn + shape handlers removed in v3.17.2 — they conflicted
// with the new setupNewVizMenu() IIFE below (double-toggle cancelled out,
// menu never opened). All interaction is now wired in setupNewVizMenu().
// ─── New viz-menu (v3.17.1): groups + sub-menus + toggles ────────────────
// Wrapped in try/catch so a failure here can't kill the rest of the file
// (which includes the settings modal listener at the bottom). If this
// throws, the menu just won't work but Settings will still open.
try { (function setupNewVizMenu() {
  var menu = document.getElementById('vizMenu');
  if (!menu) return;

  // Sub-menu show/hide.
  menu.querySelectorAll('.vm-has-sub').forEach(function(item) {
    item.addEventListener('mouseenter', function() {
      menu.querySelectorAll('.vm-sub').forEach(function(s) { s.classList.remove('open'); });
      var sub = document.getElementById(item.dataset.sub);
      if (sub) {
        sub.classList.add('open');
        // Position near the triggering item.
        sub.style.top = (item.offsetTop - menu.scrollTop) + 'px';
      }
    });
  });
  menu.addEventListener('mouseleave', function() {
    menu.querySelectorAll('.vm-sub').forEach(function(s) { s.classList.remove('open'); });
  });

  // Shape selection.
  menu.querySelectorAll('[data-viz]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      vizMode = item.dataset.viz;
      if (viz) viz.setMode(vizMode);
      menu.querySelectorAll('[data-viz]').forEach(function(i) { i.classList.toggle('active', i.dataset.viz === vizMode); });
      menu.querySelectorAll('.vm-sub').forEach(function(s) { s.classList.remove('open'); });
      menu.classList.remove('open');
      if (isDesktop && window.resonance) window.resonance.setConfig({ vizMode: vizMode });
    });
  });

  // Palette selection.
  menu.querySelectorAll('[data-color]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      vizColorMode = item.dataset.color;
      if (viz) viz.setColorMode(vizColorMode);
      menu.querySelectorAll('[data-color]').forEach(function(i) { i.classList.toggle('active', i.dataset.color === vizColorMode); });
      menu.querySelectorAll('.vm-sub').forEach(function(s) { s.classList.remove('open'); });
      menu.classList.remove('open');
      if (isDesktop && window.resonance) window.resonance.setConfig({ vizColorMode: vizColorMode });
    });
  });

  // Visualization toggle.
  var vizToggle = document.getElementById('vmVizToggle');
  function syncVizToggle() {
    if (!vizToggle) return;
    vizToggle.classList.toggle('on', vizVisible);
    vizToggle.classList.toggle('off', !vizVisible);
    vizToggle.querySelector('.vm-toggle-label').textContent = vizVisible ? 'Active' : 'Disabled';
  }
  syncVizToggle();
  if (vizToggle) vizToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleViz();
    syncVizToggle();
  });

  // Mini-player toggle.
  var miniToggle = document.getElementById('vmMiniToggle');
  var miniActive = false;
  function syncMiniToggle() {
    if (!miniToggle) return;
    miniToggle.classList.toggle('on', miniActive);
    miniToggle.classList.toggle('off', !miniActive);
    miniToggle.querySelector('.vm-toggle-label').textContent = miniActive ? 'Active' : 'Disabled';
  }
  syncMiniToggle();
  if (miniToggle) miniToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    miniActive = !miniActive;
    syncMiniToggle();
    if (window.resonance && window.resonance.toggleMiniPlayer) {
      window.resonance.toggleMiniPlayer();
    }
    menu.classList.remove('open');
  });

  // App > Mode pills.
  function syncModePills() {
    var current = (window._appConfig && window._appConfig.theme) || document.documentElement.dataset.theme || 'auto';
    menu.querySelectorAll('[data-theme-mode]').forEach(function(p) {
      p.classList.toggle('active', p.dataset.themeMode === current);
    });
  }
  syncModePills();
  menu.querySelectorAll('[data-theme-mode]').forEach(function(pill) {
    pill.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof window.setTheme === 'function') window.setTheme(pill.dataset.themeMode);
      syncModePills();
      // Sync settings modal if it's open.
      var sel = document.getElementById('settingsThemeMode');
      if (sel) sel.value = pill.dataset.themeMode;
    });
  });

  // App > Color swatches.
  function syncColorSwatches() {
    var current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hue')) || 0;
    menu.querySelectorAll('.vm-color-swatch').forEach(function(s) {
      s.classList.toggle('active', parseInt(s.dataset.hue) === current);
    });
  }
  syncColorSwatches();
  menu.querySelectorAll('.vm-color-swatch').forEach(function(sw) {
    sw.addEventListener('click', function(e) {
      e.stopPropagation();
      var hue = parseInt(sw.dataset.hue, 10);
      document.documentElement.style.setProperty('--hue', hue);
      var cfg = window._appConfig = window._appConfig || {};
      cfg.hue = hue;
      if (window.resonance && window.resonance.setConfig) window.resonance.setConfig({ hue: hue });
      syncColorSwatches();
      // Sync the Settings hue slider if present.
      var slider = document.getElementById('settingsHue');
      if (slider) slider.value = hue;
    });
  });
  // Color picker → open Settings directly.
  var picker = menu.querySelector('.vm-color-picker');
  if (picker) picker.addEventListener('click', function(e) {
    e.stopPropagation();
    menu.classList.remove('open');
    var btn = document.getElementById('settingsBtn');
    if (btn) btn.click();
  });

  // Open/close the menu (replaces the legacy vizGearBtn handler).
  document.getElementById('vizGearBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = menu.classList.toggle('open');
    if (isOpen) { syncVizToggle(); syncModePills(); syncColorSwatches(); }
  });
  // Close on outside click.
  document.addEventListener('click', function(e) {
    if (!menu.contains(e.target) && !e.target.closest('.viz-gear-btn')) {
      menu.classList.remove('open');
      menu.querySelectorAll('.vm-sub').forEach(function(s) { s.classList.remove('open'); });
    }
  });
})(); } catch (e) { console.error('[gb] viz-menu setup failed:', e); }

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
document.getElementById('settingsBtn').addEventListener('click', function() {
  // Wrap openSettings in a safety net: if the async config fetch throws,
  // still open the modal so the user isn't stuck with a dead button.
  openSettings().catch(function(err) {
    console.error('[gb] openSettings error:', err);
    settingsModal.classList.add('open');
  });
});
document.getElementById('settingsCancel').addEventListener('click', function() { settingsModal.classList.remove('open'); });
document.getElementById('settingsClose').addEventListener('click', function() { settingsModal.classList.remove('open'); });
settingsModal.addEventListener('click', function(e) { if (e.target === settingsModal) settingsModal.classList.remove('open'); });

// ─── Update State (global, syncs badge + Settings section) ──────────────────
window._updateState = { status: 'checking', version: null, percent: null };

function syncSettingsUpdate() {
  var label = document.getElementById('settingsUpdateStatus');
  if (!label) return;
  var st = window._updateState || { status: 'idle' };
  if (st.status === 'available') {
    label.textContent = '⬆ v' + st.version + ' available';
    label.style.color = '#b68adf'; label.style.borderColor = '#b68adf'; label.style.background = 'rgba(182,138,223,0.1)';
  } else if (st.status === 'downloading') {
    label.textContent = '↓ Downloading…' + (st.percent ? ' ' + st.percent + '%' : '');
    label.style.color = 'var(--accent)'; label.style.borderColor = 'var(--accent)'; label.style.background = 'var(--accent-subtle)';
  } else if (st.status === 'ready') {
    label.textContent = '✓ v' + st.version + ' ready — restart to install';
    label.style.color = 'var(--green)'; label.style.borderColor = 'var(--green)'; label.style.background = 'rgba(122,196,122,0.08)';
  } else if (st.status === 'error') {
    var hint = (st.errorMsg || st.error || 'unknown').slice(0, 60);
    label.textContent = '⚠ ' + hint;
    label.style.color = 'var(--red)'; label.style.borderColor = 'var(--red)'; label.style.background = 'rgba(224,85,85,0.08)';
  } else if (st.status === 'uptodate') {
    label.textContent = '✓ Up to date';
    label.style.color = 'var(--green)'; label.style.borderColor = 'var(--green)'; label.style.background = 'rgba(122,196,122,0.08)';
  } else if (st.status === 'checking') {
    label.textContent = '… Checking';
    label.style.color = 'var(--text-dim)'; label.style.borderColor = 'var(--border)'; label.style.background = 'transparent';
  } else {
    // idle (initial state, before the first auto-check has fired) — show
    // a neutral hint instead of an empty pill so the user knows what the
    // pill is supposed to be for.
    label.textContent = '— not checked yet';
    label.style.color = 'var(--text-dim)'; label.style.borderColor = 'var(--border)'; label.style.background = 'transparent';
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
  // ALWAYS open the modal — even if the config fetch or any sub-step
  // throws, the user must see the panel (possibly with stale values)
  // rather than a dead button.
  settingsModal.classList.add('open');
  if (window.resonance) {
    var cfg;
    try { cfg = await window.resonance.getConfig(); } catch(e) { cfg = {}; }
    // Merge with any previously known _appConfig so folders are never empty
    // just because one fetch threw.
    if (!cfg.musicFolders || !cfg.musicFolders.length) {
      cfg = Object.assign({}, window._appConfig || {}, cfg);
    }
    settingsFolders = cfg.musicFolders || [];
    // Snapshot the folders the user opened the modal with, so saveSettings
    // can detect a real change. _appConfig was sometimes empty when the
    // modal opened, which made saveSettings think every save changed
    // folders and the 'Library outdated' badge appeared even when the
    // user hadn't touched the folder list.
    window._settingsOpenFolders = (cfg.musicFolders || []).slice();
    // Refresh the update pill every time Settings opens — covers the case
    // where the modal opens before any updater event has fired and the
    // pill would otherwise show stale '— not checked yet'.
    if (typeof window.resonance.getUpdateState === 'function') {
      try {
        const live = await window.resonance.getUpdateState();
        if (live && live.status) {
          window._updateState = Object.assign({}, window._updateState || {}, live);
        }
      } catch (e) { /* ignore */ }
    }
    syncSettingsUpdate();
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
  // Detect a folders change so we can flag 'library outdated' if the user
  // saves without rescanning. Use the snapshot taken at modal open time —
  // _appConfig.musicFolders can lag during boot which made every save look
  // like a change.
  var prevFolders = Array.isArray(window._settingsOpenFolders)
    ? window._settingsOpenFolders.slice() : (settingsFolders || []).slice();
  var foldersChanged = JSON.stringify(prevFolders.slice().sort())
                    !== JSON.stringify(settingsFolders.slice().sort());
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
    // Rescan kicks off — clear any lingering 'library outdated' badge.
    if (typeof window.setRescanNeeded === 'function') window.setRescanNeeded(false);
  } else {
    showToast('Settings saved');
    // 'Save' without rescan + folders changed → surface the badge so the
    // user knows the library on disk no longer matches what's loaded.
    if (foldersChanged && typeof window.setRescanNeeded === 'function') {
      window.setRescanNeeded(true);
    }
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
  window.resonance.getVersion().then(function(v) {
    serverInfo.version = v;
    // Also populate the Settings version label eagerly so it's never "v---".
    var lbl = document.getElementById('settingsVersionLabel');
    if (lbl) lbl.textContent = 'v' + v;
  });
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
      hue: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hue')) || 0,
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
  // Wrap cross-file references in inline functions: fetchStats lives in
  // runtime.js, which loads after this file. Passing the bare reference
  // captures `undefined` at registration time and the click did nothing.
  document.querySelector('[data-tab="devices"]').addEventListener('click', function() {
    if (typeof fetchUsers === 'function') fetchUsers();
    if (typeof fetchOutputDevices === 'function') fetchOutputDevices();
  });
  document.querySelector('[data-tab="stats"]').addEventListener('click', function() {
    if (typeof fetchStats === 'function') fetchStats();
  });
  document.getElementById('refreshUsersBtn').addEventListener('click', function() {
    if (typeof fetchUsers === 'function') fetchUsers();
  });
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
  window.resonance.onUpdateError(function(d) {
    var badge = document.getElementById('updateBadge');
    window._updateState.status = 'error';
    window._updateState.errorMsg = (d && d.message) || 'unknown';
    // Don't loop 'click to retry' when the download keeps failing —
    // surface the manual download path instead so the user isn't stuck.
    badge.textContent = 'Update failed — download manually';
    setBadgeStyle(badge, 'error');
    badge.style.cursor = 'pointer';
    badge.onclick = function() {
      window.open('https://github.com/n3lio/Ghetto-Blaster/releases/latest', '_blank');
    };
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
  // ALSO covers states that don't have a header badge but should still
  // show in the Settings pill ('uptodate', 'checking') — earlier versions
  // skipped these and the pill was left empty / 0-width.
  if (typeof window.resonance.getUpdateState === 'function') {
    window.resonance.getUpdateState().then(function(state) {
      if (!state || !state.status) return;
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
      // 'uptodate', 'checking', 'idle' → no header badge but the
      // Settings pill must still reflect the state.
      syncSettingsUpdate();
    }).catch(function() { /* ignore */ });
  }

  // Settings: Check for updates button — visually dynamic so the user
  // sees that something is happening:
  //   1. click → button shows 'Checking…' + disabled while in flight,
  //      pill flips to 'checking' state via syncSettingsUpdate.
  //   2. event-driven onUpdate{Available,UpToDate,Error} restores the
  //      button text + state.
  //   3. safety timeout 30s → re-enable button and surface 'No response
  //      from update server — retry?' on the pill.
  document.getElementById('settingsCheckUpdate').addEventListener('click', function() {
    var btn = this;
    if (window._updateState.status === 'available' || window._updateState.status === 'error') {
      triggerDownload();
      return;
    }
    if (window._updateState.status === 'ready') {
      window.resonance.restartToUpdate();
      return;
    }
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    btn.classList.add('is-checking');
    window._updateState = { status: 'checking', version: null, percent: null };
    syncSettingsUpdate();
    window.resonance.checkForUpdates();
    var restored = false;
    function restoreButton() {
      if (restored) return;
      restored = true;
      btn.disabled = false;
      btn.textContent = originalLabel;
      btn.classList.remove('is-checking');
    }
    var safety = setTimeout(function() {
      if (window._updateState.status === 'checking') {
        window._updateState = { status: 'error', error: 'No response from update server' };
        syncSettingsUpdate();
      }
      restoreButton();
    }, 30000);
    // Restore as soon as ANY update event lands on the renderer (the
    // existing onUpdate* handlers already mutate _updateState).
    var poll = setInterval(function() {
      if (window._updateState && window._updateState.status !== 'checking') {
        clearTimeout(safety);
        clearInterval(poll);
        restoreButton();
      }
    }, 250);
  });
}

window.fetchUsers = function fetchUsers() {
  fetch('/api/users').then(function(r){ return r.json(); }).then(function(users) {
    var list = document.getElementById('usersList');
    if (!list) return;
    // Hide the desktop renderer's own session (it shows up as 127.0.0.1)
    // — the user already knows they're using the desktop, no need to list it.
    var visible = users.filter(function(u) { return !u.isLocal; });
    if (!visible.length) {
      list.innerHTML = '<p style="font-size:0.78rem;color:var(--text-dim);">No remote devices connected. Scan the QR code in Settings to pair a phone.</p>';
      return;
    }
    var USER_COLORS = ['#e8a435','#b68adf','#7ac47a','#5ba8e8','#e06b9f','#4dd4ac','#c47a7a','#8b5cf6'];
    var ICONS = {
      mobile:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="18" r="0.6" fill="currentColor"/></svg>',
      tablet:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="17" r="0.7" fill="currentColor"/></svg>',
      desktop: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M9 20h6M12 16v4"/></svg>',
      unknown: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 116 0c0 2-3 3-3 3M12 17h.01"/></svg>',
    };
    function elapsed(iso) {
      var ms = Date.now() - new Date(iso).getTime();
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60); var rs = s % 60;
      if (m < 60) return m + 'm ' + rs + 's';
      var h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm';
    }
    list.innerHTML = visible.map(function(u, i) {
      var color = USER_COLORS[i % USER_COLORS.length];
      var isLast = i === visible.length - 1;
      var icon = ICONS[u.deviceKind] || ICONS.unknown;
      var roleBadge = u.role === 'guest'
        ? '<span style="display:inline-block;background:var(--purple-subtle);color:var(--purple);border:1px solid var(--purple);border-radius:4px;padding:1px 6px;font-size:0.62rem;font-weight:700;letter-spacing:0.05em;margin-left:6px;">GUEST</span>'
        : '';
      return '<div data-user-id="' + u.id + '" data-role="' + u.role + '" style="display:flex;align-items:center;gap:12px;padding:12px 0;' + (isLast ? '' : 'border-bottom:1px solid var(--border);') + '">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;color:#0a0a0b;">' + (u.name||'?').charAt(0).toUpperCase() + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.85rem;font-weight:500;display:flex;align-items:center;gap:6px;">' + esc(u.name||'') + roleBadge + '</div>' +
          '<div style="font-size:0.7rem;color:var(--text-dim);display:flex;align-items:center;gap:6px;margin-top:2px;">' +
            '<span style="display:inline-flex;align-items:center;gap:4px;">' + icon + esc(u.deviceLabel||'Browser') + '</span>' +
            '<span>·</span>' +
            '<span title="LAN address">' + esc(u.ip||'?') + '</span>' +
            '<span>·</span>' +
            '<span title="Connected since ' + new Date(u.connectedAt).toLocaleTimeString() + '">connected ' + elapsed(u.connectedAt) + ' ago</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }).catch(function(){});
};
// Local alias for the legacy call sites.
var fetchUsers = window.fetchUsers;

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

