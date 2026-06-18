// === base.js — slice of public/js/main.js (legacy monolith) ===
// This file is loaded by index.html in a specific order.
// Do not change the order without auditing dependencies.
// ─── Auth (LAN access token) ────────────────────────────────────────────────
// Mobile clients land on /?t=TOKEN (from QR code). We snatch the token from the
// URL, hide it from the address bar, and attach it to every API call.
// Desktop loads localhost — server bypasses auth there, so AUTH_TOKEN may be ''.
var AUTH_TOKEN = (function() {
  try {
    var params = new URLSearchParams(window.location.search);
    var t = params.get('t');
    if (t) {
      // Strip ?t= from URL bar so it doesn't get shared/screenshotted.
      params.delete('t');
      var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', clean);
      try { sessionStorage.setItem('gb_auth_token', t); } catch(e) {}
      return t;
    }
    try { return sessionStorage.getItem('gb_auth_token') || ''; } catch(e) { return ''; }
  } catch(e) { return ''; }
})();

// Append ?t=TOKEN to a URL — for <img>/<audio> tags that can't set headers.
function apiUrl(path) {
  if (!AUTH_TOKEN) return path;
  return path + (path.indexOf('?') === -1 ? '?' : '&') + 't=' + encodeURIComponent(AUTH_TOKEN);
}
// Specialized helpers (tiny but make call-sites readable).
function coverUrl(id) { return apiUrl('/api/cover/' + id); }
function streamUrl(id) { return apiUrl('/api/stream/' + id); }

// Wrap fetch so every /api/* call carries the Authorization header.
// Also: if a 401 comes back AND we're NOT on localhost, the stored token
// is stale (new server install generated a fresh one). We surface a clear
// message and wipe the bad token from sessionStorage so the next QR scan
// can write the correct one.
(function() {
  var _fetch = window.fetch.bind(window);
  var _authFailed = false;
  window.fetch = function(input, init) {
    if (!AUTH_TOKEN) return _fetch(input, init);
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') === -1) return _fetch(input, init);
    init = init || {};
    var headers = new Headers(init.headers || {});
    if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + AUTH_TOKEN);
    init.headers = headers;
    return _fetch(input, init).then(function(res) {
      if (res.status === 401 && !_authFailed) {
        _authFailed = true;
        try { sessionStorage.removeItem('gb_auth_token'); } catch(e) {}
        // Show a persistent banner telling the user to re-scan the QR.
        if (typeof document !== 'undefined' && !document.getElementById('authExpiredBanner')) {
          var banner = document.createElement('div');
          banner.id = 'authExpiredBanner';
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:14px 20px;background:var(--red,#e05555);color:#fff;font-size:0.85rem;font-weight:600;text-align:center;z-index:99999;';
          banner.textContent = 'Access denied — the server token has changed. Re-scan the QR code from the desktop Settings to reconnect.';
          document.body.prepend(banner);
        }
      }
      return res;
    });
  };
})();

// ─── State ───────────────────────────────────────────────────────────────────
var tracks = [];        // Currently displayed/filtered tracks in Library
var allTracks = [];     // Full unfiltered list — populated by fetchTracks()
                        // (declared here, not in playlists-player.js, so a
                        //  later `var allTracks = []` doesn't reset what
                        //  base.js's fetch already wrote.)
var trackCache = {};    // ID → track object (all tracks ever seen)
var allGenres = [];
var playlists = [];
var queue = [];
var currentIndex = -1;
var isPlaying = false;
var audio = document.getElementById('audio');
var isDesktop = !!(window.resonance && window.resonance.isElectron);
var mobileMode = 'remote';
var lastDesktopState = null;
var userPickedStream = false;

function cacheTrack(t) { if (t && t.id != null) trackCache[t.id] = t; }
function getTrack(id) { return trackCache[id] || null; }

// Genre → color mapping (semantic colors)
var GENRE_COLORS = [
  // First-match wins: list more specific terms before generic ones.
  { match: ['french rap','rap français','rap francais','rap fr','french hip-hop','french hip hop'], color: '#5b8def', bg: 'rgba(91,141,239,0.14)' }, // bleu France mid-tone (readable on dark bg, distinct from Electro cyan)
  { match: ['hip-hop','hiphop','rap','hip hop'], color: '#9b59b6', bg: 'rgba(155,89,182,0.12)' }, // purple
  { match: ['rock','punk','metal','grunge','hard rock'], color: '#e05555', bg: 'rgba(224,85,85,0.12)' }, // red
  { match: ['electro','electronic','edm','house','techno','trance','dubstep'], color: '#06b6d4', bg: 'rgba(6,182,212,0.14)' }, // cyan (was steel blue, now distinct from Rap FR)
  { match: ['reggae','ragga','dancehall','dub','ska'], color: '#27ae60', bg: 'rgba(39,174,96,0.12)' }, // green
  { match: ['jazz','swing','bebop','bossa','fusion'], color: '#d4a843', bg: 'rgba(212,168,67,0.12)' }, // amber gold (less orange)
  { match: ['classical','classique','baroque','romantic','orchestral','orchestra','symphony','concerto','chamber','opera'], color: '#8e8e93', bg: 'rgba(142,142,147,0.1)' }, // grey
  { match: ['pop','synth-pop','synthpop','k-pop','kpop'], color: '#e06b9f', bg: 'rgba(224,107,159,0.12)' }, // pink
  { match: ['r&b','rnb','rhythm and blues','motown','soul','neo-soul','neo soul'], color: '#c47a7a', bg: 'rgba(196,122,122,0.12)' }, // rose
  { match: ['blues'], color: '#4a90d9', bg: 'rgba(74,144,217,0.12)' }, // mid blue
  { match: ['latin','reggaeton','salsa','bachata','cumbia','latino'], color: '#e76f51', bg: 'rgba(231,111,81,0.14)' }, // terracotta orange-red (clearly distinct from Jazz amber)
  { match: ['alternative','indie','alt'], color: '#4dd4ac', bg: 'rgba(77,212,172,0.12)' }, // teal
  { match: ['country','folk','americana'], color: '#d4a76a', bg: 'rgba(212,167,106,0.12)' }, // tan
  { match: ['funk','disco'], color: '#e8c83a', bg: 'rgba(232,200,58,0.12)' }, // gold
  { match: ['ambient','drone','new age','lo-fi','lofi'], color: '#7ab5c4', bg: 'rgba(122,181,196,0.12)' }, // soft cyan
];

function getGenreStyle(genre) {
  if (!genre) return 'color:var(--text-dim);background:var(--surface);';
  var gl = genre.toLowerCase();
  for (var i = 0; i < GENRE_COLORS.length; i++) {
    if (GENRE_COLORS[i].match.some(function(m){ return gl.includes(m); })) {
      return 'color:' + GENRE_COLORS[i].color + ';background:' + GENRE_COLORS[i].bg + ';';
    }
  }
  return 'color:var(--purple);background:var(--purple-subtle);';
}

function getGenreBarColor(genre) {
  if (!genre) return 'var(--accent)';
  var gl = genre.toLowerCase();
  for (var i = 0; i < GENRE_COLORS.length; i++) {
    if (GENRE_COLORS[i].match.some(function(m){ return gl.includes(m); })) {
      return GENRE_COLORS[i].color;
    }
  }
  return 'var(--accent)';
}

var PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

// Global: replace broken images with placeholder
document.addEventListener('error', function(e) {
  if (e.target.tagName === 'IMG' && e.target.closest('.track-cover,.player-cover,.np-cover,.group-icon')) {
    var parent = e.target.parentElement;
    e.target.remove();
    var ph = document.createElement('div');
    ph.className = 'ph';
    ph.innerHTML = PLACEHOLDER_SVG;
    parent.appendChild(ph);
  }
}, true);

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, method, body) {
  var opts = { method: method || 'GET' };
  if (body) { opts.headers = {'Content-Type':'application/json'}; opts.body = JSON.stringify(body); }
  var res = await fetch('/api' + path, opts);
  return res.json();
}

async function fetchTracks() {
  try {
    var data = await api('/tracks');
    data.forEach(cacheTrack);
    allTracks = data;
    tracks = data;
    renderTracks();
  } catch(e) { console.warn('fetchTracks:', e); }
}

async function fetchGenres() {
  try { allGenres = await api('/genres'); renderGenreFilter(); } catch(e) { console.warn('fetchGenres:', e); }
}

var _playlistsFetched = false;
async function fetchPlaylists(force) {
  if (!force && _playlistsFetched && playlists.length) { renderPlaylists(); return; }
  try { playlists = await api('/playlists'); _playlistsFetched = true; renderPlaylists(); } catch(e) {}
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
    document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'playlists') fetchPlaylists();
    if (tab.dataset.tab === 'nowplaying') scrollToCurrentInQueue();
  });
});

