/**
 * Audio Visualizer — Shape × Color architecture
 * 9 shapes, 2 color modes (theme / cover)
 * Web Audio API (AnalyserNode) + Canvas 2D
 */

class Visualizer {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.mode = 'drift'; // shape
    this.colorMode = 'theme'; // 'theme' or 'cover'
    this.running = false;
    this.animId = null;
    this.frame = 0;
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
    this.freqArray = null;
    this.stars = [];
    this.particles = [];
    this.trackTitle = '';
    this.trackArtist = '';
    this.coverColors = null;
    this.initStars();
    this.initParticles();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.w = rect.width;
    this.h = rect.height;
  }

  initAudio() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      return;
    }
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.source = this.audioCtx.createMediaElementSource(this.audio);
    this.source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  start() { if (this.running) return; this.running = true; this.loop(); }
  stop() { this.running = false; if (this.animId) cancelAnimationFrame(this.animId); this.clear(); }
  setMode(m) { this.mode = m; if (m === 'starfield') this.initStars(); if (m === 'glow') this.initParticles(); }
  setColorMode(m) { this.colorMode = m; }
  setTrack(t, a) { this.trackTitle = t || ''; this.trackArtist = a || ''; }

  // ─── Color source: returns [hue, rgb1, rgb2, rgb3] based on colorMode ────
  getColors() {
    var hue = this.getHue();
    if (this.colorMode === 'cover' && this.coverColors && this.coverColors.length >= 2) {
      return {
        hue: hue,
        c1: this.coverColors[0],
        c2: this.coverColors[1],
        c3: this.coverColors[2] || this.coverColors[0],
        source: 'cover'
      };
    }
    // Theme mode: derive 3 colors from hue
    return {
      hue: hue,
      c1: this.hslToRgb(hue / 360, 0.8, 0.55),
      c2: this.hslToRgb(((hue + 140) % 360) / 360, 0.7, 0.5),
      c3: this.hslToRgb(((hue + 260) % 360) / 360, 0.6, 0.45),
      source: 'theme'
    };
  }

  // Extract dominant colors from a cover image. Two passes:
  //  1. Sample 32×32 thumbnail, drop transparent / near-white / near-black
  //     pixels.
  //  2. Bucket the survivors by hue (12 slots of 30°). Score each bucket by
  //     count × max-saturation so a small but vivid pop of red beats a big
  //     muddy beige patch. Pick the two top-scoring buckets that aren't
  //     adjacent (so we don't return two near-identical reds).
  // The returned RGB pair gets a saturation/lightness boost so the result
  // reads "punchy" on a black background — playlists with album art that's
  // already quite muted (lo-fi, ambient) used to come out grey/desaturated.
  setCoverColors(coverUrl) {
    if (!coverUrl) { this.coverColors = null; return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const SIZE = 32;
      const c = document.createElement('canvas');
      c.width = SIZE; c.height = SIZE;
      const cx = c.getContext('2d');
      try { cx.drawImage(img, 0, 0, SIZE, SIZE); }
      catch (e) { this.coverColors = null; return; }
      let data;
      try { data = cx.getImageData(0, 0, SIZE, SIZE).data; }
      catch (e) { this.coverColors = null; return; }

      const BUCKETS = 12; // 30° hue slices
      const buckets = Array.from({ length: BUCKETS }, () => ({
        count: 0, sumR: 0, sumG: 0, sumB: 0, maxSat: 0,
      }));
      let neutralR = 0, neutralG = 0, neutralB = 0, neutralN = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 200) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 510; // 0..1
        if (l < 0.08 || l > 0.92) continue; // skip near-black / near-white
        const d = max - min;
        const sat = max === 0 ? 0 : d / max; // 0..1 (HSV-ish)
        if (sat < 0.18) {
          // Save the neutral so we can fall back if nothing saturated emerges.
          neutralR += r; neutralG += g; neutralB += b; neutralN++;
          continue;
        }
        // Hue (0..360)
        let h = 0;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
        const bucket = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
        const slot = buckets[bucket];
        slot.count++;
        slot.sumR += r; slot.sumG += g; slot.sumB += b;
        if (sat > slot.maxSat) slot.maxSat = sat;
      }

      // Score each bucket by count * sqrt(maxSat) so vibrant minorities still
      // beat dull majorities.
      const scored = buckets.map((s, idx) => ({
        idx,
        score: s.count > 0 ? s.count * Math.sqrt(s.maxSat) : 0,
        avg: s.count > 0 ? [s.sumR / s.count, s.sumG / s.count, s.sumB / s.count] : null,
      })).filter(x => x.avg).sort((a, b) => b.score - a.score);

      const out = [];
      for (const cand of scored) {
        // Avoid picking two adjacent buckets — they're almost the same hue.
        if (out.every(o => Math.abs(o.idx - cand.idx) > 1
            && Math.abs(o.idx - cand.idx) < BUCKETS - 1)) {
          out.push(cand);
        }
        if (out.length >= 2) break;
      }

      // Pump up the saturation so the canvas glow actually pops.
      const punch = (rgb) => this._punchSaturation(rgb, 0.7, 0.55);
      const punched = out.map(o => punch(o.avg));

      // Fallback: not enough vivid colors — use the neutral average + its
      // complement so we still get some contrast instead of two greys.
      if (punched.length < 2) {
        if (neutralN > 0) {
          const navg = [neutralR / neutralN, neutralG / neutralN, neutralB / neutralN];
          punched.push(punch(navg));
          if (punched.length < 2) {
            // Synthesize a complement.
            punched.push([255 - navg[0] | 0, 255 - navg[1] | 0, 255 - navg[2] | 0]);
          }
        } else {
          this.coverColors = null;
          return;
        }
      }
      this.coverColors = punched;
    };
    img.onerror = () => { this.coverColors = null; };
    img.src = coverUrl;
  }

  // Bumps saturation toward `targetSat` and lightness toward `targetL`, so
  // pulled-from-cover colors don't look grey on a black canvas.
  _punchSaturation(rgb, targetSat, targetL) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    const newS = Math.max(s, targetSat);
    const newL = (l < 0.25 || l > 0.75) ? targetL : l;
    return this.hslToRgb(h, newS, newL);
  }

  clear() { this.ctx.clearRect(0, 0, this.w, this.h); }

  getHue() {
    try { return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hue')) || 38; }
    catch(e) { return 38; }
  }

  loop() {
    if (!this.running) return;
    this.animId = requestAnimationFrame(() => this.loop());
    this.frame++;
    if (!this.analyser) { this.clear(); return; }
    this.analyser.getByteFrequencyData(this.freqArray);
    this.analyser.getByteTimeDomainData(this.dataArray);
    this.clear();
    switch (this.mode) {
      case 'nebula': this.drawNebula(); break;
      case 'glow': this.drawGlow(); break;
      case 'drift': this.drawDrift(); break;
      case 'wave': this.drawWave(); break;
      case 'starfield': this.drawStarfield(); break;
      case 'bars': this.drawBars(); break;
      case 'spectrum': this.drawSpectrum(); break;
      case 'circular': this.drawCircular(); break;
      case 'text': this.drawText(); break;
    }
  }

  getAvg(s, e) { let sum = 0; for (let i = s; i < e && i < this.freqArray.length; i++) sum += this.freqArray[i]; return sum / (e - s) / 255; }
  boost(v, p) { return Math.pow(v, p || 0.6); }

  // Helper: HSL (0-1) to RGB (0-255)
  hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; } else {
      const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // Helper: rgba string from color array
  rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // ─── NEBULA ───────────────────────────────────────────────────────────────
  drawNebula() {
    const { ctx, w, h } = this;
    const colors = this.getColors();
    const bass = this.boost(this.getAvg(0, 6));
    const mid = this.boost(this.getAvg(8, 20));
    const high = this.boost(this.getAvg(24, 50));
    const t = this.frame * 0.012;

    ctx.fillStyle = 'rgba(10,10,11,' + (0.04 + (1 - bass) * 0.04) + ')';
    ctx.fillRect(0, 0, w, h);

    const layers = [
      { cx: 0.3 + Math.sin(t * 0.7) * 0.15, cy: 0.4 + Math.cos(t * 0.5) * 0.15, r: 0.35 + bass * 0.55, c: colors.c1, alpha: 0.04 + bass * 0.18 },
      { cx: 0.7 + Math.cos(t * 0.6) * 0.12, cy: 0.5 + Math.sin(t * 0.8) * 0.12, r: 0.3 + mid * 0.45, c: colors.c2, alpha: 0.03 + mid * 0.14 },
      { cx: 0.5 + Math.sin(t * 0.9) * 0.18, cy: 0.35 + Math.cos(t * 0.4) * 0.15, r: 0.25 + high * 0.4, c: colors.c3, alpha: 0.025 + high * 0.12 },
      { cx: 0.4 + Math.cos(t * 1.1) * 0.1, cy: 0.65 + Math.sin(t * 0.6) * 0.1, r: 0.22 + bass * 0.35, c: colors.c1, alpha: 0.02 + mid * 0.08 },
    ];
    for (const l of layers) {
      const g = ctx.createRadialGradient(l.cx * w, l.cy * h, 0, l.cx * w, l.cy * h, l.r * w);
      g.addColorStop(0, this.rgba(l.c, l.alpha));
      g.addColorStop(0.35, this.rgba(l.c, l.alpha * 0.6));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (bass > 0.6) { ctx.fillStyle = this.rgba(colors.c1, (bass - 0.6) * 0.25); ctx.fillRect(0, 0, w, h); }
  }

  // ─── DRIFT (nebula + wave + glow) ─────────────────────────────────────────
  drawDrift() {
    const { ctx, w, h, dataArray } = this;
    const colors = this.getColors();
    const bass = this.boost(this.getAvg(0, 6));
    const mid = this.boost(this.getAvg(8, 20));
    const high = this.boost(this.getAvg(24, 50));
    const t = this.frame * 0.01;

    ctx.fillStyle = 'rgba(10,10,11,' + (0.04 + (1 - bass) * 0.04) + ')';
    ctx.fillRect(0, 0, w, h);

    // Nebula background
    const layers = [
      { cx: 0.3 + Math.sin(t * 0.7) * 0.15, cy: 0.4 + Math.cos(t * 0.5) * 0.15, r: 0.35 + bass * 0.5, c: colors.c1, alpha: 0.04 + bass * 0.16 },
      { cx: 0.7 + Math.cos(t * 0.6) * 0.12, cy: 0.55 + Math.sin(t * 0.8) * 0.12, r: 0.3 + mid * 0.4, c: colors.c2, alpha: 0.03 + mid * 0.12 },
      { cx: 0.5 + Math.sin(t * 0.9) * 0.14, cy: 0.35 + Math.cos(t * 0.4) * 0.12, r: 0.25 + high * 0.35, c: colors.c3, alpha: 0.025 + high * 0.1 },
    ];
    for (const l of layers) {
      const g = ctx.createRadialGradient(l.cx * w, l.cy * h, 0, l.cx * w, l.cy * h, l.r * w);
      g.addColorStop(0, this.rgba(l.c, l.alpha));
      g.addColorStop(0.4, this.rgba(l.c, l.alpha * 0.55));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (bass > 0.6) { ctx.fillStyle = this.rgba(colors.c1, (bass - 0.6) * 0.2); ctx.fillRect(0, 0, w, h); }

    // Wave overlay with colored glow. Layers tuned so the halo is as
    // present as the standalone Wave visualizer (was lw*4 → lw*6, plus a
    // beefier outer glow line). Also fixes a missing moveTo on i===0
    // which was leaving a tiny artifact at the canvas left edge.
    if (dataArray) {
      const waveLayers = [
        { lw: 12, alpha: 0.07 + bass * 0.18, c: colors.c1 }, // outer halo
        { lw: 5, alpha: 0.25 + bass * 0.4, c: colors.c2 },   // mid glow
        { lw: 2, alpha: 0.6 + bass * 0.4, c: null },         // crisp line
      ];
      waveLayers.forEach(({ lw, alpha, c }) => {
        ctx.beginPath(); ctx.lineWidth = lw;
        ctx.strokeStyle = c ? this.rgba(c, alpha) : 'rgba(240,235,228,' + alpha + ')';
        ctx.shadowColor = c ? this.rgba(c, 0.4 + bass * 0.5) : this.rgba(colors.c1, 0.35 + bass * 0.4);
        ctx.shadowBlur = lw * 6;
        const sl = w / dataArray.length; let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i] / 128;
          if (i === 0) ctx.moveTo(x, (v * h) / 2);
          else ctx.lineTo(x, (v * h) / 2);
          x += sl;
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    }
  }

  // ─── WAVE ─────────────────────────────────────────────────────────────────
  drawWave() {
    const { ctx, w, h, dataArray } = this;
    const colors = this.getColors();
    const bass = this.boost(this.getAvg(0, 4));
    const layers = [
      { lw: 10, alpha: 0.06 + bass * 0.18, c: colors.c1 },
      { lw: 4, alpha: 0.25 + bass * 0.4, c: colors.c2 },
      { lw: 2, alpha: 0.7 + bass * 0.3, c: null },
    ];
    layers.forEach(({ lw, alpha, c }) => {
      ctx.beginPath(); ctx.lineWidth = lw;
      ctx.strokeStyle = c ? this.rgba(c, alpha) : 'rgba(240,235,228,' + alpha + ')';
      ctx.shadowColor = c ? this.rgba(c, 0.3 + bass * 0.6) : this.rgba(colors.c1, 0.3 + bass * 0.4);
      ctx.shadowBlur = lw * 4;
      const sl = w / dataArray.length; let x = 0;
      for (let i = 0; i < dataArray.length; i++) { const v = dataArray[i] / 128; if (i === 0) ctx.moveTo(x, (v * h) / 2); else ctx.lineTo(x, (v * h) / 2); x += sl; }
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
  }

  // ─── STARFIELD ────────────────────────────────────────────────────────────
  initStars() {
    this.stars = [];
    for (let i = 0; i < 300; i++) {
      this.stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), hueOffset: Math.random() * 360 });
    }
  }

  drawStarfield() {
    const { ctx, w, h } = this;
    const colors = this.getColors();
    const cx = w / 2, cy = h / 2;
    const bass = this.boost(this.getAvg(0, 6));
    const mid = this.boost(this.getAvg(8, 16));
    const high = this.boost(this.getAvg(24, 40));
    const speed = 0.003 + bass * 0.07;
    const energy = bass * 0.5 + mid * 0.3 + high * 0.2;
    const t = this.frame;

    ctx.fillStyle = 'rgba(10,10,11,' + (0.2 + (1 - bass) * 0.15) + ')';
    ctx.fillRect(0, 0, w, h);

    // Subtle background glow from colors
    if (energy > 0.3) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.6);
      g.addColorStop(0, this.rgba(colors.c1, energy * 0.04));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }

    for (const star of this.stars) {
      const prevX = star.x / star.z, prevY = star.y / star.z;
      star.z -= speed;
      if (star.z <= 0) { star.x = Math.random() * 2 - 1; star.y = Math.random() * 2 - 1; star.z = 1; star.hueOffset = Math.random() * 360; continue; }
      const sx = (star.x / star.z) * cx + cx, sy = (star.y / star.z) * cy + cy;
      const px = prevX * cx + cx, py = prevY * cy + cy;
      if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
      const size = (1 - star.z) * (2 + bass * 4);
      const brightness = (1 - star.z);

      // Color: stars shimmer between the palette colors based on beat
      let color;
      const beatPhase = (t * 0.02 + star.hueOffset) % 3;
      const beatColor = beatPhase < 1 ? colors.c1 : beatPhase < 2 ? colors.c2 : colors.c3;

      if (energy < 0.2) {
        // Low energy: white/dim stars
        color = 'rgba(240,235,228,' + (brightness * 0.7) + ')';
      } else if (energy < 0.5) {
        // Medium: tinted towards palette
        const mix = (energy - 0.2) / 0.3;
        const r = Math.round(240 + (beatColor[0] - 240) * mix);
        const g = Math.round(235 + (beatColor[1] - 235) * mix);
        const b = Math.round(228 + (beatColor[2] - 228) * mix);
        color = 'rgba(' + r + ',' + g + ',' + b + ',' + brightness + ')';
      } else {
        // High energy: full palette colors, stars scintillate
        const scintillate = Math.sin(t * 0.15 + star.hueOffset) * 0.3 + 0.7;
        color = this.rgba(beatColor, brightness * scintillate);
      }

      // Draw streak
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();

      // Bright star tip glow on beat hits
      if (bass > 0.5 && brightness > 0.6) {
        ctx.beginPath();
        ctx.arc(sx, sy, size * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = this.rgba(beatColor, (bass - 0.5) * brightness * 0.6);
        ctx.fill();
      }
    }
  }

  // ─── SPECTRUM ─────────────────────────────────────────────────────────────
  drawSpectrum() {
    const { ctx, w, h, freqArray } = this;
    const colors = this.getColors();
    const barCount = 80, barWidth = w / barCount, step = Math.floor(freqArray.length / barCount), halfH = h / 2;
    for (let i = 0; i < barCount; i++) {
      const value = this.boost(freqArray[i * step] / 255, 0.55);
      const barHeight = value * halfH * 0.95;
      const t = i / barCount;
      // Interpolate between palette colors
      const c = t < 0.5
        ? this.lerpColor(colors.c1, colors.c2, t * 2)
        : this.lerpColor(colors.c2, colors.c3, (t - 0.5) * 2);
      const grad = ctx.createLinearGradient(0, halfH - barHeight, 0, halfH + barHeight);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.3, this.rgba(c, value * 0.9));
      grad.addColorStop(0.5, this.rgba(c, 0.4 + value * 0.6));
      grad.addColorStop(0.7, this.rgba(c, value * 0.9));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad; ctx.fillRect(i * barWidth, halfH - barHeight, barWidth - 1, barHeight * 2);
      if (value > 0.5) { ctx.shadowColor = this.rgba(c, 0.7); ctx.shadowBlur = 14; ctx.fillRect(i * barWidth, halfH - 2, barWidth - 1, 4); ctx.shadowBlur = 0; }
    }
  }

  // ─── GLOW ─────────────────────────────────────────────────────────────────
  initParticles() {
    this.particles = [];
    // 25 fewer / bigger particles, slower base velocity, with a smoothed
    // "size pulse" that the audio modulates instead of the previous flicker.
    for (let i = 0; i < 25; i++) {
      this.particles.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0014,
        vy: (Math.random() - 0.5) * 0.0014,
        size: Math.random() * 4 + 4,         // 4..8 (was 2..5)
        pulse: Math.random() * Math.PI * 2,  // continuous phase, no random per-frame jitter
        colorPos: Math.random(),             // 0..1 position along the palette
        sizeNow: 0,                          // smoothed size, eased toward target
      });
    }
  }

  drawGlow() {
    const { ctx, w, h } = this;
    const colors = this.getColors();
    const bass = this.boost(this.getAvg(0, 6));
    const mid = this.boost(this.getAvg(6, 16));
    // Slightly more aggressive trail clearing so older particles fade fast
    // instead of layering up into noise.
    ctx.fillStyle = 'rgba(10,10,11,' + (0.10 + (1 - bass) * 0.05) + ')';
    ctx.fillRect(0, 0, w, h);

    for (const p of this.particles) {
      // Drift: gentle constant velocity, with bass nudge — no per-frame
      // random kick. The previous Math.random() in every step caused the
      // scintillation. Let the wave carry the motion instead.
      p.x += p.vx * (1 + bass * 2.5);
      p.y += p.vy * (1 + bass * 2.5);
      if (p.x < 0 || p.x > 1) p.vx *= -1;
      if (p.y < 0 || p.y > 1) p.vy *= -1;
      p.x = Math.max(0, Math.min(1, p.x));
      p.y = Math.max(0, Math.min(1, p.y));

      // Smooth pulse: a slow sine breathing + bass kick, eased rather than
      // jumped. p.sizeNow chases the target, so spikes feel organic.
      p.pulse += 0.02 + bass * 0.04;
      const breath = 0.85 + Math.sin(p.pulse) * 0.15;
      const target = p.size * (breath + bass * 1.6);
      p.sizeNow = p.sizeNow * 0.85 + target * 0.15;
      const px = p.x * w, py = p.y * h, radius = p.sizeNow;

      // Smooth color blend across the palette (no hard switches between
      // c1/c2/c3 the way the previous phase index did). lerp on a 0..2
      // axis: 0 → c1, 1 → c2, 2 → c3 then back.
      const t = (p.colorPos + mid * 0.4 + this.frame * 0.0025) % 1;
      const seg = t * 2; // 0..2
      const c = seg < 1
        ? this.lerpColor(colors.c1, colors.c2, seg)
        : this.lerpColor(colors.c2, colors.c3, seg - 1);

      const g = ctx.createRadialGradient(px, py, 0, px, py, radius * 5);
      g.addColorStop(0, this.rgba(c, 0.55 + bass * 0.4));
      g.addColorStop(0.3, this.rgba(c, 0.18 + bass * 0.25));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, radius * 5, 0, Math.PI * 2); ctx.fill();
      // Bright core
      ctx.fillStyle = this.rgba(c, 0.55 + bass * 0.35);
      ctx.beginPath(); ctx.arc(px, py, radius * 0.45, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ─── BARS ─────────────────────────────────────────────────────────────────
  drawBars() {
    const { ctx, w, h, freqArray } = this;
    const colors = this.getColors();
    const barCount = 48, totalGap = w * 0.12;
    const barWidth = (w - totalGap) / barCount, gap = totalGap / barCount;
    const step = Math.floor(freqArray.length / barCount);
    const bass = this.boost(this.getAvg(0, 4));
    for (let i = 0; i < barCount; i++) {
      const value = this.boost(freqArray[i * step] / 255, 0.55);
      const barHeight = value * h * 0.78; const x = i * (barWidth + gap) + gap; const y = h - barHeight;
      const t = i / barCount;
      const c = t < 0.5
        ? this.lerpColor(colors.c1, colors.c2, t * 2)
        : this.lerpColor(colors.c2, colors.c3, (t - 0.5) * 2);
      const grad = ctx.createLinearGradient(x, h, x, y);
      grad.addColorStop(0, this.rgba(c, 0.95));
      grad.addColorStop(0.5, this.rgba(c, 0.8));
      grad.addColorStop(1, this.rgba(c, 0.4));
      ctx.shadowColor = this.rgba(c, value * 0.8); ctx.shadowBlur = 8 + value * 14;
      ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2, barWidth / 2, 2, 2]); ctx.fill();
      ctx.shadowBlur = 0;
      // Bright cap
      ctx.fillStyle = this.rgba(c, 0.4 + value * 0.6);
      ctx.beginPath(); ctx.roundRect(x, y, barWidth, 3, 2); ctx.fill();
    }
    if (bass > 0.65) { ctx.fillStyle = this.rgba(colors.c1, (bass - 0.65) * 0.1); ctx.fillRect(0, 0, w, h); }
  }

  // ─── CIRCULAR ─────────────────────────────────────────────────────────────
  drawCircular() {
    const { ctx, w, h, freqArray } = this;
    const colors = this.getColors();
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.4;
    const bars = 120, step = Math.floor(freqArray.length / bars);
    const bass = this.boost(this.getAvg(0, 6));
    // Center glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * (1.2 + bass * 0.6));
    glow.addColorStop(0, this.rgba(colors.c1, bass * 0.2));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    // Color strategy:
    //  - Cover mode: smooth lerp c1 → c2 → c1 around the ring, so the two
    //    "punchy" cover colors blend continuously instead of hard-switching
    //    at thirds. The user's request: "dégradé color1 a couleur 2".
    //  - Theme mode: rotate hue around the wheel from accent → +180° and
    //    back, with constant saturation/lightness — feels like a single
    //    palette breathing rather than three discrete colors.
    const useCoverGradient = colors.source === 'cover';
    for (let i = 0; i < bars; i++) {
      const value = this.boost(freqArray[i * step] / 255, 0.55);
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const barLen = value * radius * 0.9;
      const innerR = radius * 0.35;
      const x1 = cx + Math.cos(angle) * innerR, y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * (innerR + barLen), y2 = cy + Math.sin(angle) * (innerR + barLen);

      let c;
      if (useCoverGradient) {
        // Mirror the gradient at the halfway mark so the ring looks
        // symmetrical instead of jumping when wrapping at i=0/i=bars.
        const half = i < bars / 2 ? (i / (bars / 2)) : ((bars - i) / (bars / 2));
        c = this.lerpColor(colors.c1, colors.c2, half);
      } else {
        // Theme mode: smooth hue rotation around the accent.
        const hueOffset = Math.sin((i / bars) * Math.PI * 2) * 60; // ±60°
        c = this.hslToRgb(((colors.hue + hueOffset + 360) % 360) / 360, 0.75, 0.55);
      }
      ctx.strokeStyle = this.rgba(c, 0.15 + value * 0.85);
      ctx.lineWidth = 2 + value * 2.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // Center dot
    ctx.beginPath(); ctx.arc(cx, cy, radius * 0.06 * (1 + bass * 0.8), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,240,220,' + (0.5 + bass * 0.5) + ')'; ctx.fill();
  }

  // ─── TEXT — smooth scrolling typography ───────────────────────────────────
  drawText() {
    const { ctx, w, h } = this;
    const colors = this.getColors();
    const bass = this.boost(this.getAvg(0, 6));
    const mid = this.boost(this.getAvg(8, 20));
    const t = this.frame;
    const energy = bass * 0.6 + mid * 0.4;

    ctx.fillStyle = 'rgba(10,10,11,0.035)'; ctx.fillRect(0, 0, w, h);

    const title = (this.trackTitle || 'GHETTO BLASTER').toUpperCase();
    const artist = (this.trackArtist || '').toUpperCase();

    // Layer 1: Title — smooth scroll right-to-left
    const fontSize1 = Math.min(w * 0.55, h * 0.65);
    ctx.font = '900 ' + fontSize1 + 'px system-ui, sans-serif';
    const measuredW1 = ctx.measureText(title).width;
    const speed1 = 0.4;
    const tx1 = w - ((t * speed1) % (measuredW1 + w));
    const ty1 = h * 0.48;

    // Bass glitch: blur on big hits
    if (bass > 0.8) { ctx.filter = 'blur(' + ((bass - 0.8) * 12) + 'px)'; }

    // Glow layer
    ctx.shadowColor = this.rgba(colors.c1, 0.3 + energy * 0.4);
    ctx.shadowBlur = 15 + energy * 20;
    ctx.fillStyle = this.rgba(colors.c1, 0.08 + energy * 0.15);
    ctx.fillText(title, tx1, ty1);

    // Sharp text on top
    ctx.shadowBlur = 0;
    ctx.filter = 'none';
    ctx.fillStyle = this.rgba(colors.c1, 0.15 + energy * 0.3);
    ctx.fillText(title, tx1, ty1);

    // Layer 2: Artist — smooth scroll left-to-right
    if (artist) {
      const fontSize2 = fontSize1 * 0.4;
      ctx.font = '700 ' + fontSize2 + 'px system-ui, sans-serif';
      const measuredW2 = ctx.measureText(artist).width;
      const speed2 = 0.55;
      const tx2 = ((t * speed2) % (measuredW2 + w)) - measuredW2;
      const ty2 = h * 0.72;

      if (bass > 0.8) { ctx.filter = 'blur(' + ((bass - 0.8) * 8) + 'px)'; }

      ctx.shadowColor = this.rgba(colors.c2, 0.2 + mid * 0.3);
      ctx.shadowBlur = 10 + mid * 15;
      ctx.fillStyle = this.rgba(colors.c2, 0.06 + mid * 0.12);
      ctx.fillText(artist, tx2, ty2);

      ctx.shadowBlur = 0;
      ctx.filter = 'none';
      ctx.fillStyle = this.rgba(colors.c2, 0.12 + mid * 0.22);
      ctx.fillText(artist, tx2, ty2);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  lerpColor(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }
}

window.Visualizer = Visualizer;
