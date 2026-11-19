// SOLMAR COVER — a GTA-style multi-panel cover art maker.
// Every pixel of the cover is drawn here on canvas: the sunset/neon sky,
// the striped sun, the skyline, the palm silhouettes, the photo panels and
// the bold poster lettering are all this file's own work. Photos are read
// on the user's machine and never uploaded anywhere.

'use strict';

// ---------------------------------------------------------------- state
const GRADES = {
  sunset: {
    sky: [[0, '#2b1055'], [0.42, '#8e2a6d'], [0.68, '#e8435f'], [0.86, '#ff7a3d'], [1, '#ffd166']],
    sun: ['#fff3b0', '#ffb347', '#ff5e62'],
    sea: ['#3d1550', '#1c0b33'],
    city: '#1c0a33',
    title: ['#fff8d8', '#ffd166', '#ff7a3d'],
    accent: '#ffd166',
    filter: 'saturate(1.35) contrast(1.08) sepia(0.22)',
  },
  neon: {
    sky: [[0, '#0d0221'], [0.45, '#3b0a63'], [0.75, '#a4136b'], [1, '#ff2e88']],
    sun: ['#aef6ff', '#00e5ff', '#ff2e88'],
    sea: ['#160430', '#0a0220'],
    city: '#0a0218',
    title: ['#ffffff', '#7df9ff', '#ff2e88'],
    accent: '#00e5ff',
    filter: 'saturate(1.6) contrast(1.15) hue-rotate(-18deg)',
  },
  comic: {
    sky: [[0, '#123a6b'], [0.4, '#c22a5e'], [0.7, '#ff7a3d'], [1, '#ffd166']],
    sun: ['#fff200', '#ffd166', '#ff2e63'],
    sea: ['#123a6b', '#0d1e3d'],
    city: '#12082a',
    title: ['#fff200', '#ffd166', '#ff2e63'],
    accent: '#fff200',
    filter: 'saturate(1.5) contrast(1.35)',
  },
};

// Panel polygons in unit coordinates; the diagonal edges are the poster's signature.
const LAYOUTS = {
  solo: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
  duo: [
    [[0, 0], [0.60, 0], [0.50, 1], [0, 1]],
    [[0.60, 0], [1, 0], [1, 1], [0.50, 1]],
  ],
  trio: [
    [[0, 0], [0.62, 0], [0.54, 1], [0, 1]],
    [[0.62, 0], [1, 0], [1, 0.52], [0.575, 0.52]],
    [[0.575, 0.52], [1, 0.52], [1, 1], [0.54, 1]],
  ],
  quad: [
    [[0, 0], [0.55, 0], [0.47, 0.5], [0, 0.5]],
    [[0.55, 0], [1, 0], [1, 0.5], [0.47, 0.5]],
    [[0, 0.5], [0.47, 0.5], [0.53, 1], [0, 1]],
    [[0.47, 0.5], [1, 0.5], [1, 1], [0.53, 1]],
  ],
};

const PRESETS = {
  'sunset-vice': { grade: 'sunset', layout: 'trio', title: 'VICE SUNSET', subtitle: 'LEONIDA BAY • EST. 2026', halftone: true, palms: true, vignette: true, outline: true },
  'neon-nights': { grade: 'neon', layout: 'quad', title: 'NEON NIGHTS', subtitle: 'DOWNTOWN • AFTER DARK', halftone: true, palms: true, vignette: true, outline: true },
  'comic-pop': { grade: 'comic', layout: 'duo', title: 'COMIC POP', subtitle: 'POW! • LEONIDA BAY', halftone: true, palms: false, vignette: false, outline: true },
};

const EXPORT_SIZES = { '1080x1080': [1080, 1080], '1080x1350': [1080, 1350], '1920x1080': [1920, 1080] };

const state = {
  layout: 'trio',
  grade: 'sunset',
  preset: 'sunset-vice',
  title: 'VICE SUNSET',
  subtitle: 'LEONIDA BAY • EST. 2026',
  titleSize: 1.0,
  titlePos: 'bottom',
  photos: [], // { img, name, sample }
  panels: [], // { photo, zoom, ox, oy } — ox/oy in -1..1
  halftone: true,
  palms: true,
  vignette: true,
  outline: true,
  exportSize: '1080x1080',
  selected: 0,
};

function defaultPanels(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ photo: Math.min(i, 1), zoom: 1, ox: 0, oy: 0 });
  return out;
}
function ensurePanels() {
  const n = LAYOUTS[state.layout].length;
  while (state.panels.length < n) state.panels.push({ photo: 0, zoom: 1, ox: 0, oy: 0 });
  state.panels.length = n;
  if (state.selected >= n) state.selected = 0;
}
ensurePanels();

// ---------------------------------------------------------------- helpers
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load image'));
    img.src = url;
  });
}
function polyPath(ctx, poly, W, H) {
  ctx.beginPath();
  poly.forEach(([u, v], i) => (i === 0 ? ctx.moveTo(u * W, v * H) : ctx.lineTo(u * W, v * H)));
  ctx.closePath();
}
function polyBBox(poly, W, H) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const [u, v] of poly) { x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v); }
  return { x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H };
}
function pointInPoly(px, py, poly, W, H) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = [poly[i][0] * W, poly[i][1] * H];
    const [xj, yj] = [poly[j][0] * W, poly[j][1] * H];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- sky
// Draws the poster backing: gradient sky, striped retro sun, skyline, sea.
function drawSky(ctx, W, H) {
  const g = GRADES[state.grade];
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  for (const [t, c] of g.sky) sky.addColorStop(t, c);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // stars on the neon night
  if (state.grade === 'neon') {
    const rnd = mulberry32(77);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W, y = rnd() * H * 0.4, r = rnd() * 1.8 + 0.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // striped retro sun, low on the horizon
  const sunR = H * 0.17;
  const sunX = W * 0.5, sunY = H * 0.44;
  ctx.save();
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.clip();
  const sg = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sg.addColorStop(0, g.sun[0]); sg.addColorStop(0.55, g.sun[1]); sg.addColorStop(1, g.sun[2]);
  ctx.fillStyle = sg;
  ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
  // cut the sun into stripes with the sky's own gradient, widening downward
  ctx.fillStyle = sky;
  let y = sunY + sunR * 0.05, bar = H * 0.006;
  while (y < sunY + sunR) { ctx.fillRect(sunX - sunR, y, sunR * 2, bar); y += bar + H * 0.018; bar *= 1.45; }
  ctx.restore();

  // skyline silhouette with a few lit windows
  const rnd = mulberry32(20261119);
  const horizon = H * 0.74;
  ctx.fillStyle = g.city;
  let x = -W * 0.02;
  while (x < W) {
    const bw = W * (0.05 + rnd() * 0.06);
    const bh = H * (0.07 + rnd() * 0.16);
    ctx.fillRect(x, horizon - bh, bw, bh + H * 0.26);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.85)';
    for (let wy = horizon - bh + H * 0.02; wy < horizon - H * 0.015; wy += H * 0.028) {
      for (let wx = x + bw * 0.18; wx < x + bw * 0.85; wx += bw * 0.28) {
        if (rnd() < 0.4) ctx.fillRect(wx, wy, bw * 0.1, H * 0.011);
      }
    }
    ctx.fillStyle = g.city;
    x += bw + W * 0.008;
  }

  // foreground: sea with a sun reflection, or a neon perspective grid
  const sea = ctx.createLinearGradient(0, horizon, 0, H);
  sea.addColorStop(0, g.sea[0]); sea.addColorStop(1, g.sea[1]);
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, W, H - horizon);
  if (state.grade === 'neon') {
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.lineWidth = Math.max(1, W * 0.0012);
    const vpx = W * 0.5, vpy = horizon;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(vpx + i * W * 0.03, vpy); ctx.lineTo(vpx + i * W * 0.22, H); ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const y = horizon + ((H - horizon) * (i + 1) * (i + 1)) / 36;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  } else {
    ctx.fillStyle = 'rgba(255, 190, 110, 0.55)';
    for (let i = 0; i < 9; i++) {
      const y = horizon + H * 0.02 + i * H * 0.028;
      const wdt = W * (0.05 + i * 0.012);
      ctx.fillRect(sunX - wdt / 2, y, wdt, H * 0.006);
    }
  }
}

// ---------------------------------------------------------------- palms
// A palm silhouette drawn from strokes: curved trunk, drooping fronds.
function drawPalm(ctx, x, yBase, s, lean, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  // trunk: a quadratic curve, thick at the base
  ctx.lineWidth = Math.max(2, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(x, yBase);
  ctx.quadraticCurveTo(x + lean * 0.3, yBase - s * 0.6, x + lean, yBase - s);
  ctx.stroke();
  const topX = x + lean, topY = yBase - s;
  // fronds fan across the upper hemisphere and droop: each one arcs up
  // from the crown, then falls to a tip below it, like a fountain.
  ctx.lineWidth = Math.max(1.5, s * 0.028);
  for (let f = 0; f < 7; f++) {
    const a = (-0.917 + f * 0.139) * Math.PI; // -165° .. -15°
    const len = s * (0.42 + (f % 3) * 0.05);
    const ex = topX + Math.cos(a) * len;
    const ey = topY + Math.sin(a) * len * 0.55 + len * 0.42;
    const mx = topX + Math.cos(a) * len * 0.55;
    const my = topY + Math.sin(a) * len * 0.55 - len * 0.18;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(topX - s * 0.03, topY + s * 0.02, s * 0.025, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(topX + s * 0.03, topY + s * 0.03, s * 0.025, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- panels
function drawPhotoPanel(ctx, img, poly, panel, W, H) {
  const bbox = polyBBox(poly, W, H);
  ctx.save();
  polyPath(ctx, poly, W, H);
  ctx.clip();
  if (img) {
    const base = Math.max(bbox.w / img.naturalWidth, bbox.h / img.naturalHeight);
    const scale = base * panel.zoom;
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const cx = bbox.x + bbox.w / 2 + panel.ox * bbox.w * 0.35;
    const cy = bbox.y + bbox.h / 2 + panel.oy * bbox.h * 0.35;
    ctx.filter = GRADES[state.grade].filter;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.filter = 'none';
  } else {
    // empty panel: diagonal placeholder stripes over the sky
    ctx.fillStyle = 'rgba(13, 2, 24, 0.45)';
    ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = Math.max(2, W * 0.004);
    for (let i = -bbox.h; i < bbox.w; i += W * 0.05) {
      ctx.beginPath(); ctx.moveTo(bbox.x + i, bbox.y + bbox.h); ctx.lineTo(bbox.x + i + bbox.h, bbox.y); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(W * 0.028)}px "Arial Black", Impact, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DROP A PHOTO', bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
  }
  ctx.restore();

  if (state.outline) {
    ctx.save();
    polyPath(ctx, poly, W, H);
    ctx.strokeStyle = '#12041f';
    ctx.lineWidth = Math.max(2, W * 0.011);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, W * 0.006);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- effects
function drawHalftone(ctx, W, H) {
  const step = Math.max(10, W * 0.014);
  ctx.save();
  ctx.fillStyle = 'rgba(10, 2, 20, 0.16)';
  for (let y = H * 0.55; y < H; y += step) {
    for (let x = (y / step % 2) * step / 2; x < W; x += step) {
      const r = step * 0.16 * (1 + ((y - H * 0.55) / (H * 0.45)) * 1.6);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
function drawVignette(ctx, W, H) {
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(5,1,12,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- lettering
function fitTitleLines(ctx, text, maxW, startSize) {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], size: startSize };
  let size = startSize;
  let lines = [];
  while (size > startSize * 0.4) {
    ctx.font = `900 ${Math.round(size)}px "Arial Black", Impact, "Franklin Gothic Heavy", sans-serif`;
    try { ctx.letterSpacing = '1px'; } catch { /* older canvas: ignore */ }
    lines = [];
    let cur = words[0];
    for (const w of words.slice(1)) {
      const test = `${cur} ${w}`;
      if (ctx.measureText(test).width <= maxW) cur = test;
      else { lines.push(cur); cur = w; }
    }
    lines.push(cur);
    if (lines.length <= 2 && Math.max(...lines.map((l) => ctx.measureText(l).width)) <= maxW) break;
    size *= 0.92;
  }
  return { lines: lines.slice(0, 2), size };
}
function drawTitleBlock(ctx, W, H) {
  const g = GRADES[state.grade];
  const top = state.titlePos === 'top';
  const { lines, size } = fitTitleLines(ctx, state.title, W * 0.92, W * 0.115 * state.titleSize);
  if (!lines.length) return;
  const lineH = size * 1.02;
  const blockH = lineH * lines.length;
  const subSize = Math.max(14, W * 0.021 * state.titleSize);
  const gap = H * 0.016;
  const pillH = subSize * 2.1;
  const totalH = blockH + gap + pillH;
  let y0 = top ? H * 0.055 : H - totalH - H * 0.045;

  // wordmark on the opposite edge from the title
  ctx.save();
  ctx.font = `900 ${Math.round(W * 0.026)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = Math.max(2, W * 0.004); ctx.lineJoin = 'round';
  ctx.strokeStyle = '#12041f'; ctx.fillStyle = '#fff';
  const wmY = top ? H - H * 0.035 : H * 0.048;
  ctx.strokeText('★ SOLMAR', W * 0.035, wmY);
  ctx.fillText('★ SOLMAR', W * 0.035, wmY);
  ctx.textAlign = 'right';
  ctx.font = `700 ${Math.round(W * 0.016)}px Arial, sans-serif`;
  ctx.strokeText('LEONIDA BAY', W * 0.965, wmY);
  ctx.fillText('LEONIDA BAY', W * 0.965, wmY);
  ctx.restore();

  // big title, skewed, gradient-filled, thick dark outline
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + blockH);
  grad.addColorStop(0, g.title[0]); grad.addColorStop(0.55, g.title[1]); grad.addColorStop(1, g.title[2]);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${Math.round(size)}px "Arial Black", Impact, "Franklin Gothic Heavy", sans-serif`;
  try { ctx.letterSpacing = '1px'; } catch { /* ignore */ }
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.11);
  ctx.strokeStyle = '#12041f';
  ctx.shadowColor = state.grade === 'neon' ? 'rgba(255,46,136,0.65)' : 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = size * 0.14;
  ctx.shadowOffsetY = size * 0.03;
  lines.forEach((line, i) => {
    const cy = y0 + lineH * (i + 1) - size * 0.18;
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.transform(1, 0, -0.07, 1, 0, 0);
    ctx.strokeText(line, 0, 0);
    ctx.fillStyle = grad;
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
  ctx.restore();

  // subtitle pill under (or above) the title
  const sub = (state.subtitle || '').trim().toUpperCase();
  if (sub) {
    ctx.save();
    ctx.font = `700 ${Math.round(subSize)}px Arial, sans-serif`;
    try { ctx.letterSpacing = '3px'; } catch { /* ignore */ }
    const tw = ctx.measureText(sub).width;
    const pw = Math.min(W * 0.92, tw + subSize * 2.4);
    const px = (W - pw) / 2;
    const py = y0 + blockH + gap;
    roundRect(ctx, px, py, pw, pillH, pillH / 2);
    ctx.fillStyle = g.accent;
    ctx.fill();
    ctx.fillStyle = '#12041f';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sub, W / 2, py + pillH / 2 + subSize * 0.04, pw - subSize);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- render
// Paints the whole cover onto ctx at W x H. Pure function of `state`.
function renderCover(ctx, W, H) {
  ensurePanels();
  drawSky(ctx, W, H);
  const polys = LAYOUTS[state.layout];
  polys.forEach((poly, i) => {
    const panel = state.panels[i];
    const photo = state.photos[panel.photo];
    drawPhotoPanel(ctx, photo ? photo.img : null, poly, panel, W, H);
  });
  if (state.palms) {
    const s = H * 0.24;
    drawPalm(ctx, W * 0.045, H * 0.985, s, -W * 0.02, 'rgba(18,4,31,0.92)');
    drawPalm(ctx, W * 0.955, H * 0.985, s * 0.9, W * 0.02, 'rgba(18,4,31,0.92)');
  }
  if (state.halftone) drawHalftone(ctx, W, H);
  if (state.vignette) drawVignette(ctx, W, H);
  drawTitleBlock(ctx, W, H);
  // thin outer frame
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(2, W * 0.004);
  ctx.strokeRect(W * 0.008, H * 0.008, W * 0.984, H * 0.984);
  ctx.restore();
}

// ---------------------------------------------------------------- UI wiring
const canvas = document.getElementById('cover');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg) { statusEl.textContent = msg; }

function render() {
  const [w, h] = EXPORT_SIZES[state.exportSize];
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  renderCover(ctx, w, h);
  $('sizePill').textContent = `${w} × ${h}`;
  syncPanelUI();
}

function syncPanelUI() {
  const tabs = $('panelTabs');
  tabs.innerHTML = '';
  state.panels.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Panel ${i + 1}`;
    b.className = i === state.selected ? 'active' : '';
    b.addEventListener('click', () => { state.selected = i; render(); });
    tabs.appendChild(b);
  });
  $('panelInfo').textContent = `Panel ${state.selected + 1} of ${state.panels.length}`;
  const sel = $('panelPhoto');
  sel.innerHTML = '';
  state.photos.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${i + 1}. ${p.name}`;
    sel.appendChild(o);
  });
  const cur = state.panels[state.selected];
  sel.value = String(cur.photo);
  sel.disabled = state.photos.length === 0;
  $('zoom').value = String(Math.round(cur.zoom * 100));
  $('zoomVal').textContent = `${Math.round(cur.zoom * 100)}%`;
  $('panX').value = String(Math.round(cur.ox * 100));
  $('panXVal').textContent = String(Math.round(cur.ox * 100));
  $('panY').value = String(Math.round(cur.oy * 100));
  $('panYVal').textContent = String(Math.round(cur.oy * 100));
  $('photoCount').textContent = state.photos.length
    ? `${state.photos.length} photo${state.photos.length > 1 ? 's' : ''} loaded — click a thumbnail, then pick its panel below.`
    : 'No photo yet — a sample scene is loaded for you.';
  const row = $('thumbRow');
  row.innerHTML = '';
  state.photos.forEach((p, i) => {
    const t = document.createElement('img');
    t.src = p.img.src;
    t.alt = p.name;
    t.title = p.name;
    t.className = state.panels.some((pl) => pl.photo === i) ? 'used' : '';
    t.addEventListener('click', () => {
      state.panels[state.selected].photo = i;
      render();
      setStatus(`Panel ${state.selected + 1} now uses “${p.name}”.`);
    });
    row.appendChild(t);
  });
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  state.preset = name;
  state.grade = p.grade;
  state.layout = p.layout;
  state.title = p.title;
  state.subtitle = p.subtitle;
  state.halftone = p.halftone;
  state.palms = p.palms;
  state.vignette = p.vignette;
  state.outline = p.outline;
  $('titleInput').value = p.title;
  $('subtitleInput').value = p.subtitle;
  $('fxHalftone').checked = p.halftone;
  $('fxPalms').checked = p.palms;
  $('fxVignette').checked = p.vignette;
  $('fxOutline').checked = p.outline;
  document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
  document.querySelectorAll('#gradeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.grade === p.grade));
  document.querySelectorAll('#layoutSeg button').forEach((b) => b.classList.toggle('active', b.dataset.layout === p.layout));
  ensurePanels();
  render();
  setStatus(`Look “${name.replace(/-/g, ' ')}” applied — export when it feels right.`);
}

async function addPhotoFile(file) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  state.photos.push({ img, name: file.name, sample: false });
  if (state.photos.length === 1) state.panels.forEach((p) => { p.photo = 0; });
  render();
  setStatus(`Loaded “${file.name}” — it is now in panel ${state.selected + 1}.`);
}
async function addSample(url, name) {
  const img = await loadImage(url);
  if (!state.photos.some((p) => p.name === name)) state.photos.push({ img, name, sample: true });
  render();
  return img;
}

// --- controls ------------------------------------------------------------
document.querySelectorAll('#layoutSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    state.layout = b.dataset.layout;
    state.preset = '';
    document.querySelectorAll('#layoutSeg button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.preset').forEach((x) => x.classList.remove('active'));
    ensurePanels();
    render();
  });
});
document.querySelectorAll('#gradeSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    state.grade = b.dataset.grade;
    state.preset = '';
    document.querySelectorAll('#gradeSeg button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.preset').forEach((x) => x.classList.remove('active'));
    render();
  });
});
document.querySelectorAll('.preset').forEach((b) => {
  b.addEventListener('click', () => applyPreset(b.dataset.preset));
});
document.querySelectorAll('#titlePosSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    state.titlePos = b.dataset.pos;
    document.querySelectorAll('#titlePosSeg button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  });
});
$('titleInput').addEventListener('input', (e) => { state.title = e.target.value; render(); });
$('subtitleInput').addEventListener('input', (e) => { state.subtitle = e.target.value; render(); });
$('titleSize').addEventListener('input', (e) => {
  state.titleSize = Number(e.target.value) / 100;
  $('titleSizeVal').textContent = `${e.target.value}%`;
  render();
});
$('zoom').addEventListener('input', (e) => {
  state.panels[state.selected].zoom = Number(e.target.value) / 100;
  render();
});
$('panX').addEventListener('input', (e) => {
  state.panels[state.selected].ox = Number(e.target.value) / 100;
  render();
});
$('panY').addEventListener('input', (e) => {
  state.panels[state.selected].oy = Number(e.target.value) / 100;
  render();
});
$('panelPhoto').addEventListener('change', (e) => {
  state.panels[state.selected].photo = Number(e.target.value);
  render();
});
for (const [id, key] of [['fxHalftone', 'halftone'], ['fxPalms', 'palms'], ['fxVignette', 'vignette'], ['fxOutline', 'outline']]) {
  $(id).addEventListener('change', (e) => { state[key] = e.target.checked; render(); });
}
$('exportSize').addEventListener('change', (e) => {
  state.exportSize = e.target.value;
  render();
  setStatus(`Preview is now ${e.target.value.replace('x', ' × ')} — the PNG will match.`);
});

// --- photo intake --------------------------------------------------------
$('pickBtn').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', async (e) => {
  for (const f of e.target.files) { try { await addPhotoFile(f); } catch { setStatus(`Could not read “${f.name}”.`); } }
  e.target.value = '';
});
const dz = $('dropzone');
dz.addEventListener('click', () => $('photoInput').click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('photoInput').click(); } });
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) { setStatus('That drop had no image in it.'); return; }
  for (const f of files) { try { await addPhotoFile(f); } catch { setStatus(`Could not read “${f.name}”.`); } }
});
document.querySelectorAll('[data-sample]').forEach((b) => {
  b.addEventListener('click', async () => {
    const url = b.dataset.sample;
    const name = url.includes('neon') ? 'Sample: neon boulevard' : 'Sample: sunset beach';
    await addSample(url, name);
    const idx = state.photos.findIndex((p) => p.name === name);
    if (idx >= 0) state.panels[state.selected].photo = idx;
    render();
    setStatus(`Sample “${name}” loaded into panel ${state.selected + 1}.`);
  });
});

// --- drag to pan, scroll to zoom on the preview --------------------------
let drag = null;
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
}
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e);
  const polys = LAYOUTS[state.layout];
  let hit = polys.findIndex((poly) => pointInPoly(p.x, p.y, poly, canvas.width, canvas.height));
  if (hit === -1) hit = state.selected;
  state.selected = hit;
  drag = { x: p.x, y: p.y, panel: state.panels[hit] };
  canvas.setPointerCapture(e.pointerId);
  render();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = canvasPoint(e);
  const bbox = polyBBox(LAYOUTS[state.layout][state.selected], canvas.width, canvas.height);
  drag.panel.ox = Math.max(-1, Math.min(1, drag.panel.ox + ((p.x - drag.x) / bbox.w) * 2.4));
  drag.panel.oy = Math.max(-1, Math.min(1, drag.panel.oy + ((p.y - drag.y) / bbox.h) * 2.4));
  drag.x = p.x; drag.y = p.y;
  render();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const panel = state.panels[state.selected];
  panel.zoom = Math.max(0.5, Math.min(3, panel.zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
  render();
}, { passive: false });

// ---------------------------------------------------------------- export
function renderExportCanvas() {
  const [w, h] = EXPORT_SIZES[state.exportSize];
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  renderCover(off.getContext('2d'), w, h);
  return off;
}
function exportPNG() {
  const off = renderExportCanvas();
  const [w, h] = EXPORT_SIZES[state.exportSize];
  const name = `solmar-cover-${w}x${h}.png`;
  off.toBlob((blob) => {
    if (!blob) { setStatus('Export failed — the canvas could not make a PNG.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`Saved ${name} — share it anywhere.`);
  }, 'image/png');
}
$('exportBtn').addEventListener('click', exportPNG);

// Test hooks: the screenshot driver and the local checks use these.
window.__solmar = { state, renderCover, exportPNG, applyPreset };
window.__exportPNG = async (w, h) => {
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  renderCover(off.getContext('2d'), w, h);
  return off.toDataURL('image/png');
};

// ---------------------------------------------------------------- shots
// ?shot=cover&photo=beach&caption=...&preset=...&layout=...&grade=...&w=&h=
// paints one fixed scene (cover alone, controls hidden by CSS) for screenshots;
// ?shot=editor does the same but keeps the editor visible.
async function runShot() {
  const q = new URLSearchParams(location.search);
  const shot = q.get('shot');
  if (!shot) return false;
  const photo = q.get('photo') === 'neon' ? 'samples/sample-neon.png' : 'samples/sample-beach.png';
  const name = q.get('photo') === 'neon' ? 'Sample: neon boulevard' : 'Sample: sunset beach';
  if (q.get('preset')) applyPreset(q.get('preset'));
  if (q.get('layout')) { state.layout = q.get('layout'); ensurePanels(); }
  if (q.get('grade')) state.grade = q.get('grade');
  if (q.get('caption')) { state.title = q.get('caption'); $('titleInput').value = state.title; }
  if (q.get('subtitle')) { state.subtitle = q.get('subtitle'); $('subtitleInput').value = state.subtitle; }
  if (q.get('size') && EXPORT_SIZES[q.get('size')]) state.exportSize = q.get('size');
  await addSample(photo, name);
  state.panels.forEach((p, i) => { p.photo = i % 2 === 0 ? 0 : Math.min(1, state.photos.length - 1); });
  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
    const w = Number(q.get('w')) || 1080;
    const h = Number(q.get('h')) || 1080;
    canvas.width = w; canvas.height = h;
    renderCover(ctx, w, h);
  } else {
    render();
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__shotReady = true;
  return true;
}

// ---------------------------------------------------------------- init
(async () => {
  try {
    await addSample('samples/sample-beach.png', 'Sample: sunset beach');
    await addSample('samples/sample-neon.png', 'Sample: neon boulevard');
  } catch (err) {
    setStatus('Sample scenes could not load — drop a photo to begin.');
  }
  render();
  const shot = await runShot();
  if (!shot) window.__shotReady = true;
})();
