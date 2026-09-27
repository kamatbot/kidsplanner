// Fam ETC — "One family week": a 60 s storybook film, captions only (STA-LAUNCH-PLAN §3.3).
// Engine from the promo-video kit (paper/ink primitives, sprites, compositor, player). This film adds
// watercolour pages, blooms (wet-edge reveals between pages), captions, the Fam ETC mark and a painted
// phone whose screen ui.js draws crisp (Family Rings, Geist). Live mode plays in sync with
// assets/audio/mix.*; ?render=1 exposes a deterministic window.__promo.seek(t) for tools/render.mjs.
import * as UI from "./ui.js";

const params = new URLSearchParams(location.search);
const V = params.get("format") === "vertical" || location.hash === "#vertical"; // 9:16 cut
const W = V ? 1080 : 1920, H = V ? 1920 : 1080, FPS = 30, DURATION = 60; // film length; the mix and build read it from here
const RENDER = params.has("render");
const BUILD_ID = "20260926-220119";
const canvas = document.getElementById("c");
canvas.width = W; canvas.height = H;
if (V) document.documentElement.classList.add("vertical");
let ctx = canvas.getContext("2d");
if (RENDER) document.body.classList.add("render");

// Global texture intensity: the storybook preset's textureStrength (styles.json).
const TEXTURE = 0.8;

// ───────────────────────────── palette & fonts ─────────────────────────────
// Marketing layer = Horizon (landing tokens in Planner/public/css/horizon.css); washes are the storybook
// preset's colours, lightened so they multiply softly onto the cream page.
const C = {
  cream: "#FBF6EA",
  page: "#FBF6EA", ink: "#211E1B", ink2: "#6A655F", violet: "#6F43D6", violetInk: "#5A34B8", coral: "#F0704F", coralInk: "#D2553A",
  graphite: "#4A4540", green: "#16A34A", kraft: "#C9A77C",
  lav: "#DCD2F7", sky: "#CFE1EE", butter: "#F8E6B4", meadow: "#CFE5C8", peach: "#F8CBBB", sand: "#EEDFC6",
  phone: "#2D2C38",
};
const F = {
  hand: (px, w = 700) => `${w} ${px}px Caveat`,
  sans: (px, w = 700) => `${w} ${px}px "Space Grotesk"`,
  mono: (px, w = 500) => `${w} ${px}px "JetBrains Mono"`,
};

// ───────────────────────────── math & randomness ─────────────────────────────
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, d) => clamp((t - a) / d);
const E = {
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t, s = 1.9) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  settle: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(10 * t)), // overshoot, damped wobble
};
function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h ^= Math.floor(v * 1000) | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function rng(seed) {
  let a = Math.floor(seed * 1e6) >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const noise1 = (x, seed = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1; };
// Stop-motion clock: props move "on twos" (15 fps inside 30 fps); ink boils at 10 fps.
const STEP = 1 / 15;
const st = (t) => Math.floor(t / STEP + 1e-6) * STEP;
const boil = (t) => Math.floor(t * 10 + 1e-6);

// ───────────────────────────── SFX cue sheet ─────────────────────────────
const CUES = [];
const cue = (t, name, gain_db = 0, pan = 0) => CUES.push({ t: +t.toFixed(3), name, gain_db, pan: +clamp(pan, -1, 1).toFixed(2) });

// ───────────────────────────── textures ─────────────────────────────
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };
let GRAIN, FIBERS, MOTTLE;
function makeNoise(size, seed, scale, octaves = 4) {
  const c = mk(size, size), g = c.getContext("2d"), img = g.createImageData(size, size), d = img.data;
  const r = rng(seed), N = 64, lat = [];
  for (let i = 0; i < N * N; i++) lat.push(r());
  // Each octave spans a whole number of lattice cells and wraps at that count, so the tile repeats without seams.
  const at = (i, j, cells) => lat[((j % cells) % N) * N + ((i % cells) % N)];
  const val = (x, y, cells) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(at(xi, yi, cells), at(xi + 1, yi, cells), u), lerp(at(xi, yi + 1, cells), at(xi + 1, yi + 1, cells), u), v);
  };
  const cells = Array.from({ length: octaves }, (_, o) => Math.max(1, Math.round(scale * 2 ** o * N)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, amp = 1, tot = 0;
    for (let o = 0; o < octaves; o++) { a += val((x * cells[o]) / size, (y * cells[o]) / size, cells[o]) * amp; tot += amp; amp *= 0.5; }
    const v = (a / tot) * 255, i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function makeGrain(size, seed) {
  const c = mk(size, size), g = c.getContext("2d"), img = g.createImageData(size, size), d = img.data, r = rng(seed);
  for (let i = 0; i < d.length; i += 4) { const v = r() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
function makeFibers(size, seed, n) {
  const c = mk(size, size), g = c.getContext("2d"), r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI * 2, l = 5 + r() * 18;
    g.strokeStyle = r() < 0.6 ? "rgba(255,255,255,0.5)" : "rgba(120,100,70,0.22)";
    g.lineWidth = 0.5 + r() * 0.7;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return c;
}
// Paper surface: flat color + mottled noise + fine grain + fibers. strength scales with
// the global TEXTURE constant, so one knob controls every surface's texture intensity.
function texturize(g, w, h, seed, strength = 1) {
  strength *= TEXTURE;
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = "soft-light";
  g.globalAlpha = 0.5 * strength;
  const p1 = g.createPattern(MOTTLE, "repeat");
  p1.setTransform(new DOMMatrix().translate(-r() * 512, -r() * 512).scale(1.6));
  g.fillStyle = p1; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "multiply";
  g.globalAlpha = 0.07 * strength;
  const p2 = g.createPattern(GRAIN, "repeat");
  p2.setTransform(new DOMMatrix().translate(-r() * 256, -r() * 256));
  g.fillStyle = p2; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-atop";
  g.globalAlpha = 0.32 * strength;
  const p3 = g.createPattern(FIBERS, "repeat");
  p3.setTransform(new DOMMatrix().translate(-r() * 700, -r() * 700));
  g.fillStyle = p3; g.fillRect(0, 0, w, h);
  g.restore();
}
// Torn / cut outline. sides: 4 chars (top,right,bottom,left): t=torn, c=cut.
function paperPath(w, h, seed, sides = "tttt", rough = 1) {
  const r = rng(seed), pts = [];
  const edge = (x0, y0, x1, y1, torn) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.floor(len / (torn ? 7 : 40)));
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    let drift = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      drift = torn ? drift * 0.7 + (r() - 0.5) * 3.2 * rough : (r() - 0.5) * 0.8;
      const jag = torn ? (r() - 0.5) * 2.4 * rough : 0;
      pts.push([lerp(x0, x1, u) + nx * (drift + jag), lerp(y0, y1, u) + ny * (drift + jag)]);
    }
  };
  edge(0, 0, w, 0, sides[0] === "t"); edge(w, 0, w, h, sides[1] === "t");
  edge(w, h, 0, h, sides[2] === "t"); edge(0, h, 0, 0, sides[3] === "t");
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}
function shadowOf(src, blur) {
  const s = mk(src.width + blur * 4, src.height + blur * 4), g = s.getContext("2d");
  g.filter = `blur(${blur}px)`;
  g.drawImage(src, blur * 2, blur * 2);
  g.filter = "none";
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#2a1d10"; g.fillRect(0, 0, s.width, s.height);
  return s;
}
// A textured paper piece rendered once: {canvas, shadow, w, h, pad}.
const PAPER_CACHE = new Map();
function paper(key, w, h, { color = C.cream, seed = 1, sides = "tttt", rough = 1, rim = true, rimAlpha = 0.85, decorate } = {}) {
  if (PAPER_CACHE.has(key)) return PAPER_CACHE.get(key);
  const pad = 14, c = mk(w + pad * 2, h + pad * 2), g = c.getContext("2d");
  g.translate(pad, pad);
  const path = paperPath(w, h, seed, sides, rough);
  g.save(); g.clip(path);
  g.fillStyle = color; g.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
  texturize(g, w, h, seed);
  if (decorate) decorate(g, w, h);
  if (rim) { g.strokeStyle = `rgba(255,252,244,${rimAlpha})`; g.lineWidth = rimAlpha < 0.6 ? 2.2 : 3.2; g.setLineDash([5, 2, 9, 3]); g.stroke(path); }
  g.restore();
  const piece = { canvas: c, shadow: shadowOf(c, 7), w, h, pad };
  PAPER_CACHE.set(key, piece);
  return piece;
}
// Draw a piece centred on (x,y) (or at anchor ax,ay). lift ∈ [0,1] = height above the desk.
function place(p, x, y, { rot = 0, s = 1, sx = 1, sy = 1, alpha = 1, lift = 0, ax = 0.5, ay = 0.5, shadow = 1 } = {}) {
  if (alpha <= 0 || s <= 0) return;
  const cw = p.canvas.width, ch = p.canvas.height, ox = -cw * ax, oy = -ch * ay;
  ctx.save();
  ctx.translate(x, y);
  if (shadow > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * shadow * clamp(0.34 - lift * 0.14, 0.1, 0.4);
    ctx.translate(4 + lift * 22, 7 + lift * 34);
    ctx.rotate(rot); ctx.scale(s * sx * (1 + lift * 0.05), s * sy * (1 + lift * 0.05));
    const b = (p.shadow.width - cw) / 2;
    ctx.drawImage(p.shadow, ox - b, oy - b);
    ctx.restore();
  }
  ctx.rotate(rot); ctx.scale(s * sx, s * sy);
  ctx.globalAlpha = alpha;
  ctx.drawImage(p.canvas, ox, oy);
  ctx.restore();
}
// Run fn in the local frame of a placed paper piece (origin = paper's top-left).
function inPiece(p, x, y, o, fn) {
  const { rot = 0, s = 1, ax = 0.5, ay = 0.5, alpha = 1 } = o;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.translate(-p.canvas.width * ax + (p.pad || 0), -p.canvas.height * ay + (p.pad || 0));
  ctx.globalAlpha = alpha;
  fn();
  ctx.restore();
}

// ───────────────────────────── sprites (AI-illustrated cut-outs) ─────────────────────────────
// Storybook cut-outs from assets/raw/img/sheet{A,B,C}.jpg (cutout.mjs, border 0; the AI drew its own white rim).
const SPR = {};
const SPRITES = ["kate", "tom", "mia_desk", "leo", "family", "dinner", "school", "stall", "fridge", "backpack", "football", "slip", "stickies", "mug", "tomatoes", "basil", "pasta"];
async function loadSprites() {
  await Promise.all(SPRITES.map((name) => new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => {
      const c = mk(im.naturalWidth, im.naturalHeight);
      c.getContext("2d").drawImage(im, 0, 0);
      SPR[name] = { canvas: c, shadow: shadowOf(c, 8), w: c.width, h: c.height, pad: 0 };
      ok();
    };
    im.onerror = () => fail(new Error(`sprite ${name} failed to load`));
    im.src = `assets/img/${name}.webp`;
  })));
}
function spr(name, x, y, { h, w, ...o } = {}) {
  const p = SPR[name];
  place(p, x, y, { ...o, s: (h ? h / p.h : w ? w / p.w : 1) * (o.s ?? 1) });
}

// ───────────────────────────── ink: pencil, crayon, handwriting ─────────────────────────────
const INK_PAT = new Map();
function inkPattern(color) { // grainy graphite/crayon texture for strokes and handwriting
  if (INK_PAT.has(color)) return INK_PAT.get(color);
  const c = mk(128, 128), g = c.getContext("2d");
  g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = "destination-out";
  const r = rng(color.length * 7.3 + color.charCodeAt(1));
  for (let i = 0; i < 1400; i++) { g.globalAlpha = r() * 0.5; g.fillRect(r() * 128, r() * 128, 1 + r() * 1.5, 1 + r() * 1.5); }
  const pat = ctx.createPattern(c, "repeat");
  INK_PAT.set(color, pat);
  return pat;
}
// Hand-drawn stroke through points; reveal ∈ [0,1] draws the first part only.
function sketch(pts, { color = C.graphite, w = 3, seed = 1, t = 0, reveal = 1, wobble = 1.4, passes = 2, alpha = 1 } = {}) {
  if (reveal <= 0 || pts.length < 2 || alpha <= 0) return;
  const b = boil(t);
  let total = 0; const segs = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
  const target = total * reveal;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = inkPattern(color);
  for (let pass = 0; pass < passes; pass++) {
    ctx.globalAlpha = alpha * (pass ? 0.55 : 0.95);
    ctx.lineWidth = w * (pass ? 0.7 : 1);
    ctx.beginPath();
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const jx = noise1(i * 0.9 + b * 3.1, seed + pass * 11) * wobble, jy = noise1(i * 0.9 + b * 3.1, seed + 5 + pass * 11) * wobble;
      let [x, y] = pts[i];
      if (i > 0) {
        const l = segs[i - 1];
        if (acc + l > target) { const u = (target - acc) / l; x = lerp(pts[i - 1][0], x, u); y = lerp(pts[i - 1][1], y, u); ctx.lineTo(x + jx, y + jy); break; }
        acc += l;
      }
      i ? ctx.lineTo(x + jx, y + jy) : ctx.moveTo(x + jx, y + jy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
const P = {
  ellipse: (cx, cy, rx, ry, { turns = 1.12, start = -2.2, seed = 1, n = 60, loose = 0.06 } = {}) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, a = start + u * turns * Math.PI * 2, k = 1 + noise1(u * 5, seed) * loose + u * loose * 0.8;
      out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return out;
  },
  line: (x0, y0, x1, y1, n = 12, sag = 0) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [lerp(x0, x1, u), lerp(y0, y1, u) + Math.sin(u * Math.PI) * sag]; }),
  arrowHead: (x, y, ang, size = 18) => [[x + Math.cos(ang + 2.6) * size, y + Math.sin(ang + 2.6) * size], [x, y], [x + Math.cos(ang - 2.6) * size, y + Math.sin(ang - 2.6) * size]],
};
function arrow(pts, o) {
  sketch(pts, o);
  if ((o.reveal ?? 1) >= 0.98) {
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    sketch(P.arrowHead(b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), o.head ?? 18), { ...o, reveal: 1, seed: (o.seed ?? 1) + 9 });
  }
}
function check(x, y, s, o) { sketch([[x - 18 * s, y], [x - 4 * s, y + 16 * s], [x + 24 * s, y - 22 * s]], o); }
// Handwriting with letter-by-letter write-on and gentle boil.
function hand(text, x, y, { size = 48, color = C.ink, weight = 600, t = 0, reveal = 1, align = "left", seed = 1, jitter = 1, alpha = 1 } = {}) {
  if (reveal <= 0 || alpha <= 0) return 0;
  ctx.save();
  ctx.font = F.hand(size, weight);
  ctx.textBaseline = "alphabetic";
  const full = ctx.measureText(text).width;
  const x0 = align === "center" ? x - full / 2 : align === "right" ? x - full : x;
  const n = text.length, shown = reveal * n, b = boil(t);
  ctx.fillStyle = inkPattern(color);
  for (let i = 0; i < n && i < shown; i++) {
    const px = x0 + ctx.measureText(text.slice(0, i)).width;
    ctx.save();
    ctx.translate(px, y + noise1(i * 1.7 + b * 2.3, seed) * 1.2 * jitter);
    ctx.rotate(noise1(i * 2.1 + b * 1.9, seed + 3) * 0.035 * jitter);
    ctx.globalAlpha = alpha * clamp(shown - i);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return full;
}
// Crisp printed text (labels, numbers).
function print(text, x, y, { font = F.sans(40), color = C.ink, align = "left", alpha = 1, base = "alphabetic", tracking = 0 } = {}) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.globalAlpha = alpha;
  if (tracking) ctx.letterSpacing = `${tracking}px`;
  ctx.fillText(text, x, y);
  ctx.restore();
}
// Washi / masking tape strip.
const TAPES = ["rgba(240,112,79,0.55)", "rgba(227,176,75,0.62)", "rgba(127,163,192,0.58)", "rgba(143,174,139,0.6)"];
function tape(x, y, w, rot, { color = TAPES[0], seed = 1, alpha = 1, h = 38 } = {}) {
  if (alpha <= 0) return;
  const p = paper(`tape:${color}:${w | 0}:${h}:${seed}`, w, h, { color, seed, sides: "ctct", rough: 0.9, rim: false, decorate: (g, ww, hh) => {
    g.globalAlpha = 0.18; g.fillStyle = "#fff";
    for (let i = 0; i < ww; i += 14) g.fillRect(i, 0, 6, hh);
  } });
  place(p, x, y, { rot, alpha, shadow: 0.35 });
}
function sparkles(cx, cy, t, t0, { n = 6, r = 90, color = C.mustard, seed = 3 } = {}) {
  const u = prog(t, t0, 0.7);
  if (u <= 0 || u >= 1) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash(i, seed) * 0.6, d = r * (0.55 + 0.45 * E.out(u)), len = 16 * (1 - u) + 4;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    sketch([[x - Math.cos(a) * len, y - Math.sin(a) * len], [x + Math.cos(a) * len, y + Math.sin(a) * len]], { color, w: 4, t, seed: seed + i, wobble: 0.6, alpha: 1 - u * 0.6 });
  }
}
// Translucent marker swipe over ledger cells (multiply keeps the ink readable). vertical = sweeps top→bottom.
function highlight(x, y, w, h, t, t0, color, vertical = false) {
  const u = E.out(prog(st(t), t0, 0.35));
  if (u <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.5; ctx.fillStyle = color;
  const p = new Path2D();
  vertical ? p.roundRect(x - w / 2, y - h / 2, w, h * u, 12) : p.roundRect(x - w / 2, y - h / 2, w * u, h, 12);
  ctx.fill(p);
  ctx.restore();
}
// Slap-down entrance: {u, lift, s} for a piece landing at t0 over d seconds (on twos).
function slap(t, t0, d = 0.32, from = 1.16) {
  const u = prog(st(t), t0, d);
  return { u, lift: 1 - E.out(u), s: lerp(from, 1, E.out(u)) };
}


// ───────────────────────────── shared bits ─────────────────────────────
const L = (l, p) => (V ? p : l); // pick a landscape or portrait value
const fade = (t, a, b, d = 0.25) => clamp(Math.min((t - a) / d, (b - t) / d)); // in over d from a, out over d before b

// ───────────────────────────── watercolour: blobs, washes, pages, blooms ─────────────────────────────
// Irregular blob outline: an ellipse whose radius wanders on a few seeded harmonics. drift slides the phases,
// so a growing bloom's edge keeps bleeding instead of scaling rigidly.
function blobPts(cx, cy, rx, ry, seed, { n = 120, amp = 0.1, drift = 0 } = {}) {
  const r = rng(seed), HM = [2, 3, 4, 6, 9], ph = HM.map(() => r() * 6.283), am = HM.map((_, i) => (amp * (0.35 + r() * 0.65)) / (1 + i * 0.55));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283;
    let k = 1;
    for (let j = 0; j < HM.length; j++) k += am[j] * Math.sin(HM[j] * a + ph[j] + drift * (j + 1) * 0.7);
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}
const pathOf = (pts) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };
// One watercolour wash baked into g: layered translucent fills pool pigment, a dried tide line darkens the edge,
// and faint granulation sits inside. Multiply keeps overlapping washes deepening like real paint.
function wash(g, cx, cy, rx, ry, color, seed, alpha = 1) {
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = "multiply";
  g.fillStyle = color;
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.13;
    g.filter = `blur(${7 - i * 1.5}px)`;
    g.globalAlpha = alpha * (i ? 0.32 : 0.6);
    g.fill(pathOf(blobPts(cx + (r() - 0.5) * rx * 0.1, cy + (r() - 0.5) * ry * 0.1, rx * k, ry * k, seed + i * 17, { amp: 0.11 })));
  }
  const edge = pathOf(blobPts(cx, cy, rx, ry, seed, { amp: 0.11 }));
  g.filter = "blur(0.8px)"; g.globalAlpha = alpha * 0.55; g.strokeStyle = color; g.lineWidth = 3; g.stroke(edge);
  g.filter = "none";
  g.save(); g.clip(edge);
  g.globalAlpha = alpha * 0.08;
  const p = g.createPattern(MOTTLE, "repeat");
  p.setTransform(new DOMMatrix().translate(r() * 512, r() * 512));
  g.fillStyle = p; g.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 2.8);
  g.restore();
  g.restore();
}
// A full-frame cream page with washes, baked once. washes: [color, fx, fy, rx, ry, alpha] with positions as
// fractions of the frame and radii as fractions of its long side, so one recipe composes for both cuts.
function page(washes, seed) {
  const c = mk(W + 200, H + 200), g = c.getContext("2d"), M = Math.max(W, H);
  g.fillStyle = C.page; g.fillRect(0, 0, c.width, c.height);
  texturize(g, c.width, c.height, seed, 0.9);
  washes.forEach(([color, fx, fy, rx, ry, a = 1], i) => wash(g, 100 + fx * W, 100 + fy * H, rx * M, ry * M, color, seed * 31 + i * 7, a));
  return c;
}
// A page arriving as spreading paint: a wet blob grows from (cx,cy), a tinted wet front runs just ahead of it,
// and the page (plus the scene drawn by content) shows inside. Once the bloom has covered the frame it is a plain draw.
function bloom(pg, u, cx, cy, seed, color, content) {
  if (u <= 0) return;
  const k = E.inOut(clamp(u));
  if (k >= 1) { ctx.drawImage(pg, -100, -100); if (content) content(); return; }
  const R = k * Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.25;
  const o = { amp: 0.13, drift: u * 1.6 };
  ctx.save();
  ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.5 * (1 - k); ctx.filter = "blur(14px)"; ctx.fillStyle = color;
  ctx.fill(pathOf(blobPts(cx, cy, R * 1.07 + 24, R * 1.07 + 24, seed, o)));
  ctx.restore();
  const path = pathOf(blobPts(cx, cy, R, R, seed, o));
  ctx.save(); ctx.clip(path); ctx.drawImage(pg, -100, -100); if (content) content(); ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.65 * (1 - k * 0.7); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.filter = "blur(0.6px)";
  ctx.stroke(path);
  ctx.restore();
}
// A soft painted shadow on the ground under a standing figure.
function groundShadow(x, y, w, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.22 * alpha; ctx.filter = "blur(10px)"; ctx.fillStyle = "#9C8A6E";
  ctx.beginPath(); ctx.ellipse(x, y, w / 2, w * 0.09, 0, 0, 6.283); ctx.fill();
  ctx.restore();
}

// ───────────────────────────── captions ─────────────────────────────
// The film's whole script. Space Grotesk 700, top-left in 16:9, top-centre in 9:16 (below the 150 px app-UI band).
// A watercolour marker wash paints in behind one key phrase per caption.
const CAP = L({ x: 120, y: 206, align: "left", size: 72, maxW: 1060, narrowW: 840, lh: 86 }, { x: 540, y: 300, align: "center", size: 70, maxW: 960, narrowW: 960, lh: 84 });
const WRAPS = new Map();
function wrap(text, maxW) { // balanced lines: the fewest lines that fit, then the narrowest width that keeps that count
  const key = `${ctx.font}|${maxW}|${text}`;
  if (WRAPS.has(key)) return WRAPS.get(key);
  const words = text.split(" "), wOf = (s) => ctx.measureText(s).width;
  const lay = (lim) => { const out = []; let cur = ""; for (const w of words) { const s = cur ? `${cur} ${w}` : w; if (wOf(s) > lim && cur) { out.push(cur); cur = w; } else cur = s; } out.push(cur); return out; };
  let lines = lay(maxW);
  if (lines.length > 1) {
    let lo = maxW / lines.length, hi = maxW;
    for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; lay(mid).length <= lines.length ? (hi = mid) : (lo = mid); }
    lines = lay(hi);
  }
  WRAPS.set(key, lines);
  return lines;
}
function hlWash(x0, x1, y, h, u, seed, color, a = 1) { // a marker stroke of wet paint, painted left to right
  if (u <= 0 || a <= 0) return;
  const r = rng(seed), xe = lerp(x0, x1, E.out(u)), top = [], bot = [];
  for (let x = x0; x <= xe; x += 14) { top.push([x, y - h / 2 + (r() - 0.5) * 7]); bot.push([x, y + h / 2 + (r() - 0.5) * 7]); }
  top.push([xe, y - h / 2 + 3]); bot.push([xe, y + h / 2 - 3]);
  const p = pathOf([...top, [xe + 10, y], ...bot.reverse(), [x0 - 10, y]]);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.85 * a; ctx.filter = "blur(1.2px)"; ctx.fillStyle = color; ctx.fill(p);
  ctx.globalAlpha = 0.35 * a; ctx.filter = "none"; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(p);
  ctx.restore();
}
function caption(text, t, t0, t1, o = {}) {
  if (t < t0 || t > t1) return;
  const { hl, x = CAP.x, y = CAP.y, align = CAP.align, size = CAP.size, maxW = CAP.maxW, lh = CAP.lh, color = C.ink, hlColor = "#F6D77E", seed = 1, panel = V } = o;
  const out = 1 - E.in(prog(t, t1 - 0.32, 0.32));
  ctx.save();
  ctx.font = F.sans(size, 700); ctx.letterSpacing = `${-size * 0.02}px`;
  const lines = wrap(text, maxW);
  if (panel) { // 9:16: a cream paper panel under the words, so the phone can sit behind it
    const pw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 110, ph = lines.length * lh + 76, a = E.out(prog(t, t0, 0.4)) * out;
    const p = paper(`cap:${text}`, pw, ph, { color: "#FFFDF7", seed: seed + 300, sides: "tctc", rough: 0.9, rimAlpha: 0.7 });
    place(p, x, y - size * 0.72 - 38 + ph / 2 + (1 - a) * 16, { alpha: a, lift: 0.25, rot: (seed % 2 ? 0.006 : -0.006) });
  }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => {
    const u = E.out(prog(t, t0 + i * 0.09, 0.5)), a = u * out;
    if (a <= 0) return;
    const lw = ctx.measureText(line).width, lx = align === "center" ? x - lw / 2 : x, ly = y + i * lh + (1 - u) * 22;
    if (hl && line.includes(hl)) {
      const hx = lx + ctx.measureText(line.slice(0, line.indexOf(hl))).width, hw = ctx.measureText(hl).width;
      hlWash(hx - 6, hx + hw + 6, ly - size * 0.3, size * 0.62, prog(t, t0 + 0.45, 0.5), seed, hlColor, out);
    }
    ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillText(line, lx, ly);
  });
  ctx.restore();
}

// ───────────────────────────── the Fam ETC mark and wordmark ─────────────────────────────
// public/icons/fametc-mark.svg (viewBox 112): coral, violet, violet at 45 %, violet circle. Each tile is baked
// once as flat gouache with a little paper grain so it sits in the painted world without changing the brand.
const MARK = [[8, 8, 14, C.coral, 1], [60, 8, 14, C.violet, 1], [8, 60, 14, C.violet, 0.45], [60, 60, 22, C.violet, 1]];
let TILES;
function buildTiles() {
  TILES = MARK.map(([, , rr, col], i) => {
    const c = mk(260, 260), g = c.getContext("2d"), k = 220 / 44;
    g.translate(20, 20);
    g.beginPath(); g.roundRect(0, 0, 220, 220, rr * k); g.clip();
    g.fillStyle = col; g.fillRect(0, 0, 220, 220);
    texturize(g, 220, 220, 700 + i, 0.55);
    return c;
  });
}
function drawMark(x, y, size, reveal = [1, 1, 1, 1], alpha = 1) {
  const k = size / 112;
  MARK.forEach(([tx, ty, , , op], i) => {
    const u = reveal[i];
    if (u <= 0) return;
    const s = E.back(clamp(u), 2.2), d = 44 * k;
    ctx.save();
    ctx.translate(x - size / 2 + (tx + 22) * k, y - size / 2 + (ty + 22) * k); ctx.scale(s, s);
    ctx.globalAlpha = alpha * op * clamp(u * 2.5);
    ctx.drawImage(TILES[i], -d / 2 - (20 * d) / 220, -d / 2 - (20 * d) / 220, (260 * d) / 220, (260 * d) / 220);
    ctx.restore();
  });
}
function wordmarkWidth(px) {
  ctx.save();
  ctx.font = F.sans(px, 700); ctx.letterSpacing = `${-0.02 * px}px`; const a = ctx.measureText("Fam").width;
  ctx.font = F.mono(px * 0.82, 700); ctx.letterSpacing = `${0.02 * px * 0.82}px`; const b = ctx.measureText("ETC").width;
  ctx.restore();
  return { a, b, gap: px * 0.235, w: a + px * 0.235 + b };
}
function drawWordmark(x, y, px, alpha = 1) { // "Fam" + violet mono "ETC", as the landing header sets it
  if (alpha <= 0) return;
  const m = wordmarkWidth(px);
  ctx.save();
  ctx.globalAlpha = alpha; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.font = F.sans(px, 700); ctx.letterSpacing = `${-0.02 * px}px`; ctx.fillStyle = C.ink; ctx.fillText("Fam", x, y);
  ctx.font = F.mono(px * 0.82, 700); ctx.letterSpacing = `${0.02 * px * 0.82}px`; ctx.fillStyle = C.violet; ctx.fillText("ETC", x + m.a + m.gap, y);
  ctx.restore();
}
function lockup(cx, cy, mark, px, t, t0, { gap = mark * 0.24 } = {}) { // mark + wordmark centred on (cx, cy)
  const m = wordmarkWidth(px), total = mark + gap + m.w, x0 = cx - total / 2;
  drawMark(x0 + mark / 2, cy, mark, [0, 1, 2, 3].map((i) => prog(t, t0 + i * 0.075, 0.3)));
  const u = E.out(prog(t, t0 + 0.42, 0.45));
  drawWordmark(x0 + mark + gap - (1 - u) * 30, cy + px * 0.36, px, u);
}

// ───────────────────────────── the phone (painted body, crisp screen from ui.js) ─────────────────────────────
// ui.js draws each screen in CSS px (390×844, the same viewport as the reference shots of the real app).
// PS = 2 makes 15 px UI text 30 px on the frame; the phone is a close-up, partly off-frame, and each
// shot chooses where the screen sits and how far the page inside it is scrolled.
const PS = 2.0, PH = { w: UI.SCREEN.w, h: UI.SCREEN.h, bez: 13, r: 58, sr: 47 };
let BODY;
function buildPhone() {
  const s = PS, b = PH.bez * s, bw = PH.w * s + b * 2, bh = PH.h * s + b * 2, pad = 70;
  const c = mk(bw + pad * 2, bh + pad * 2), g = c.getContext("2d");
  g.save(); g.filter = "blur(26px)"; g.globalAlpha = 0.3; g.fillStyle = "#3a2a1a";
  g.beginPath(); g.roundRect(pad + 18, pad + 34, bw, bh, PH.r * s); g.fill(); g.restore();
  g.save();
  g.beginPath(); g.roundRect(pad, pad, bw, bh, PH.r * s); g.clip();
  g.fillStyle = C.phone; g.fillRect(pad, pad, bw, bh);
  g.translate(pad, pad); texturize(g, bw, bh, 88, 0.7); g.translate(-pad, -pad);
  const hi = g.createLinearGradient(pad, pad, pad + bw, pad + bh);
  hi.addColorStop(0, "rgba(255,255,255,0.14)"); hi.addColorStop(0.5, "rgba(255,255,255,0)"); hi.addColorStop(1, "rgba(255,255,255,0.06)");
  g.fillStyle = hi; g.fillRect(pad, pad, bw, bh);
  g.restore();
  BODY = { canvas: c, pad, b, bw, bh };
}
// Draws the phone with its screen's top-left at (sx, sy). screen(ctx) paints in CSS px and may return hit
// points {name: [x, y]} in CSS px; they come back in frame px for tap rings.
let FADE_CANVAS;
function phone(sx, sy, screen, { t = 0, alpha = 1, s = PS, fadeTop = null, fadeLen = 260 } = {}) {
  if (fadeTop !== null) { // draw off-screen, then dissolve the phone's upper part into the page above fadeTop
    const main = ctx;
    FADE_CANVAS ||= mk(W, H);
    ctx = FADE_CANVAS.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    const out = phone(sx, sy, screen, { t, alpha, s });
    ctx.globalCompositeOperation = "destination-in";
    const gr = ctx.createLinearGradient(0, fadeTop - fadeLen, 0, fadeTop);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx = main;
    ctx.drawImage(FADE_CANVAS, 0, 0);
    return out;
  }
  const k = s / PS, b = PH.bez * s;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(BODY.canvas, sx - b - BODY.pad * k, sy - b - BODY.pad * k, BODY.canvas.width * k, BODY.canvas.height * k);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(sx, sy, PH.w * s, PH.h * s, PH.sr * s); ctx.clip();
  ctx.translate(sx, sy); ctx.scale(s, s);
  const hits = screen(ctx) || {};
  ctx.fillStyle = "#0E0E12"; ctx.beginPath(); ctx.roundRect(PH.w / 2 - 62, 11, 124, 36, 18); ctx.fill(); // island
  ctx.restore();
  const g = ctx.createLinearGradient(sx, sy, sx + PH.w * s, sy + PH.h * s * 0.6); // glass
  g.addColorStop(0, "rgba(255,255,255,0.07)"); g.addColorStop(0.45, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(sx, sy, PH.w * s, PH.h * s, PH.sr * s); ctx.fill();
  const x0 = sx - b, y0 = sy - b, x1 = sx + PH.w * s + b, y1 = sy + PH.h * s + b, R = PH.r * s; // pencil outline, boiling
  const pts = [];
  const arc = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); } };
  arc(x1 - R, y0 + R, -Math.PI / 2); arc(x1 - R, y1 - R, 0); arc(x0 + R, y1 - R, Math.PI / 2); arc(x0 + R, y0 + R, Math.PI); pts.push(pts[0]);
  sketch(pts, { color: "#1E1C26", w: 3.2, t, seed: 91, wobble: 1.6, alpha: 0.7 * alpha });
  ctx.restore();
  const out = {};
  for (const [n, [x, y]] of Object.entries(hits)) out[n] = [sx + x * s, sy + y * s];
  return out;
}
// A finger-tap cue: a pressed dot, then two pencil rings spreading out.
function tapRing(p, t, t0, color = C.violet, k = 1) { // k < 1 keeps the rings clear of text beside small targets
  if (!p) return;
  const u = prog(t, t0, 0.6);
  if (u <= 0 || u >= 1) return;
  const [x, y] = p;
  ctx.save();
  ctx.globalAlpha = 0.35 * (1 - u); ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 30 * k * (1 - u * 0.4), 0, 6.283); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 2; i++) {
    const v = clamp(u * 1.25 - i * 0.22);
    if (v <= 0) continue;
    const r = (30 + v * 58) * k;
    sketch(P.ellipse(x, y, r, r, { seed: 40 + i, turns: 1.05, n: 40, loose: 0.03 }), { color, w: 4.5 - i * 1.5, t, seed: 50 + i, alpha: 1 - v });
  }
}
// Where the phone's screen sits for a shot: x centre and the screen's top edge, per cut.
const PHX = L(1440 - (PH.w * PS) / 2, 540 - (PH.w * PS) / 2);
const TOP = L(30, 880); // screen top for list shots: 16:9 right half; 9:16 below the caption panel and the character strip
const rise = (t, t0, from, to, d = 0.8) => lerp(from, to, E.out(prog(t, t0, d)));

// ───────────────────────────── pages (built in init) ─────────────────────────────
let P1, P2, P3, P4, P5, P6, P7, P8, P9, P10;
function buildPages() {
  P1 = page([[C.butter, 0.6, 0.55, 0.42, 0.36], [C.peach, 0.16, 0.86, 0.26, 0.2, 0.8], [C.sky, 0.9, 0.12, 0.2, 0.15, 0.6]], 11);
  P2 = page([[C.lav, 0.5, 0.46, 0.4, 0.3], [C.peach, 0.82, 0.78, 0.16, 0.12, 0.7], [C.sky, 0.16, 0.2, 0.15, 0.11, 0.6]], 22);
  P3 = page([[C.lav, 0.72, 0.55, 0.38, 0.5], [C.sky, 0.18, 0.82, 0.24, 0.2, 0.7]], 33);
  P4 = page([[C.meadow, 0.3, 0.62, 0.34, 0.36], [C.peach, 0.76, 0.42, 0.3, 0.42, 0.8], [C.butter, 0.5, 0.1, 0.3, 0.12, 0.6]], 44);
  P5 = page([[C.butter, 0.62, 0.55, 0.42, 0.38], [C.peach, 0.2, 0.22, 0.2, 0.16, 0.7], [C.lav, 0.92, 0.92, 0.2, 0.16, 0.6]], 55);
  P6 = page([[C.sky, 0.3, 0.6, 0.36, 0.4], [C.lav, 0.78, 0.45, 0.3, 0.44, 0.8], [C.meadow, 0.12, 0.92, 0.22, 0.12, 0.6]], 66);
  P7 = page([[C.peach, 0.3, 0.6, 0.34, 0.36], [C.butter, 0.75, 0.45, 0.32, 0.44, 0.8], [C.sky, 0.9, 0.08, 0.16, 0.1, 0.6]], 77);
  P8 = page([[C.lav, 0.72, 0.5, 0.4, 0.48], [C.butter, 0.18, 0.78, 0.24, 0.2, 0.7]], 88);
  P9 = page([[C.lav, 0.58, 0.56, 0.42, 0.4], [C.butter, 0.18, 0.3, 0.2, 0.15, 0.7], [C.meadow, 0.88, 0.88, 0.2, 0.14, 0.6]], 99);
  P10 = page([[C.lav, 0.5, 0.42, 0.42, 0.34], [C.peach, 0.14, 0.86, 0.2, 0.15, 0.6], [C.sky, 0.88, 0.14, 0.18, 0.13, 0.6]], 110);
}

// ───────────────────────────── timeline (seconds) ─────────────────────────────
// Captions only, so picture beats key off the music (m2.mp3): full band enters at 8.03 s, a new section
// hits at 29.27 s, the final chord blooms at 56.6 s.
const VO = {}; // no narration (STA-LAUNCH-PLAN §3.3); mix-config.mjs reads an empty cue list
const T = {
  cap1: 0.55, cap2: 3.9, swirl: 7.0,
  s2: 7.3, tiles: 7.78, tag: 9.05,
  s3: 12.3, phone3: 12.45, cap3: 12.85, tom: 13.4, typing: 14.2, send: 15.05, tapCart: 16.0, cap4: 16.3, sheet: 16.2, tapAdd: 17.45, toast: 17.75, note: 18.45,
  s4: 20.15, cap5: 20.55, phone4: 20.35, tick4: 22.45,
  s5: 24.85, cap6: 25.25,
  s6: 29.2, cap7: 29.7, cards: 30.35, phone6: 29.55, cap8: 33.55, clock: 33.7, cap9: 37.15, push9: 37.0,
  s7: 40.75, cap10: 41.15, phone7: 40.95, tick7: 42.0, toast7: 42.25,
  s8: 44.5, cap11: 44.9, phone8: 44.6, roll8: 45.45,
  s9: 47.65, cap12: 48.05, tags: 49.45,
  s10: 53.6, mark10: 53.95, url: 54.5, endTag: 55.0, free: 55.45, chord: 56.6,
};
const CAPS = [
  ["Everyone had a piece of the week.", T.cap1, 3.75, "piece"],
  ["Nobody had the week.", T.cap2, 7.1, "Nobody"],
  ["It starts as a message.", T.cap3, 16.15, "message.", 1],
  ["Turn it into the shopping list.", T.cap4, 20.05, "shopping list.", 1],
  ["Whoever's near a shop ticks it off.", T.cap5, 24.75, "ticks it off.", 1],
  ["Decided in chat. Done by dinner.", T.cap6, 29.1, "Done by dinner."],
  ["Homework comes in from school.", T.cap7, 33.4, "from school.", 1],
  ["Checks the school every eight hours.", T.cap8, 37.0, "every eight hours.", 1],
  ["Sorted by when it's due.", T.cap9, 40.6, "when it's due.", 1],
  ["Mia ticks it off.", T.cap10, 44.35, "ticks it off.", 1],
  ["Everyone sees it.", T.cap11, 47.5, "Everyone", 1],
  ["Built by an STA parent, for STA families.", T.cap12, 53.45, "STA parent,"],
];

// ═════════════════════════════ SCENE 1 — everyone had a piece of the week ═════════════════════════════
const S1 = L(
  { kate: [930, 1045, 720], leo: [1290, 1048, 520], fridge: [1660, 1035, 620], centre: [960, 600],
    scraps: [["bub", "Swim squad parents", "31", 560, 470, 0.9, -0.05], ["bub", "Year 5 parents", "12", 1360, 330, 0.9, 0.04], ["bub", "Family", "9", 470, 690, 0.85, 0.03],
      ["slip", 300, 900, 250, -0.16], ["stickies", 1560, 250, 150, 0.12], ["backpack", 640, 960, 220, 0.05], ["mug", 1500, 900, 150, 0]] },
  { kate: [440, 1705, 900], leo: [800, 1708, 640], fridge: [900, 1560, 560], centre: [540, 1050],
    scraps: [["bub", "Swim squad parents", "31", 330, 640, 0.85, -0.05], ["bub", "Year 5 parents", "12", 760, 560, 0.85, 0.04], ["bub", "Family", "9", 170, 875, 0.7, 0.03],
      ["slip", 170, 1250, 230, -0.16], ["stickies", 900, 800, 130, 0.12], ["backpack", 150, 1640, 210, 0.05], ["mug", 960, 1240, 130, 0]] });
const BUB_COL = ["#7FA3C0", "#E3B04B", "#8FAE8B"];
function bubbleCard(label, count, x, y, s, alpha, rot, i) { // a messaging-app thread card with an unread badge
  ctx.save(); ctx.font = F.sans(28, 700); const lw = ctx.measureText(label).width; ctx.restore();
  const p = paper(`bub:${label}`, Math.max(360, Math.ceil(lw) + 104 + 92), 124, { color: "#FFFDF8", seed: 120 + i, sides: "cccc", rough: 0.25, rim: false, decorate: (g, w, h) => { // width fits the label, clear of the badge
    g.fillStyle = BUB_COL[i % 3]; g.beginPath(); g.arc(56, h / 2, 30, 0, 6.283); g.fill();
    g.font = F.sans(28, 700); g.fillStyle = C.ink; g.fillText(label, 104, 54);
    g.strokeStyle = "rgba(90,84,76,0.5)"; g.lineWidth = 5; g.lineCap = "round";
    g.beginPath(); g.moveTo(106, 86); g.bezierCurveTo(150, 78, 170, 94, 214, 86); g.bezierCurveTo(244, 80, 262, 92, 292, 86); g.stroke();
    g.fillStyle = C.coral; g.beginPath(); g.arc(w - 48, h / 2, 26, 0, 6.283); g.fill();
    g.font = F.sans(26, 700); g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(count, w - 48, h / 2 + 9);
  } });
  place(p, x, y, { s, rot, alpha, lift: 0.35 });
}
function scene1(t) {
  if (t > T.s2 + 0.7) return;
  ctx.drawImage(P1, -100, -100);
  const [cx, cy] = S1.centre, sw = E.in(prog(t, T.swirl, 0.75)), spread = 1 + 0.07 * E.inOut(prog(t, T.cap2, 3));
  const [fx, fb, fh] = S1.fridge;
  spr("fridge", fx, fb - fh / 2, { h: fh, shadow: 0.6 });
  S1.scraps.forEach((sc, i) => {
    const t0 = 0.3 + i * 0.3, u = E.out(prog(t, t0, 0.8));
    if (u <= 0) return;
    const bob = Math.sin(t * 1.3 + i * 1.7) * 7, [rx, ry] = sc[0] === "bub" ? [sc[3], sc[4]] : [sc[1], sc[2]];
    let x = cx + (rx - cx) * spread, y = cy + (ry - cy) * spread + bob;
    const enter = (1 - u) * 90, ang = Math.atan2(y - cy, x - cx);
    x += Math.cos(ang) * enter; y += Math.sin(ang) * enter;
    if (sw > 0) { // swirl into the middle as the page turns
      const d = Math.hypot(x - cx, y - cy) * (1 - sw), a = Math.atan2(y - cy, x - cx) + sw * 1.6;
      x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d;
    }
    const k = 1 - sw * 0.75, alpha = u * (1 - sw);
    if (sc[0] === "bub") bubbleCard(sc[1], sc[2], x, y, sc[5] * k, alpha, sc[6] + Math.sin(t * 0.9 + i) * 0.02, i);
    else spr(sc[0], x, y, { h: sc[3] * k, rot: sc[4] + Math.sin(t * 0.8 + i) * 0.04, alpha, lift: 0.3 });
  });
  const [kx, kb, kh] = S1.kate, [lx, lb, lh] = S1.leo;
  groundShadow(lx, lb - 6, lh * 0.5); groundShadow(kx, kb - 6, kh * 0.42);
  spr("leo", lx, lb - lh / 2, { h: lh, sy: 1 + Math.sin(t * 2.2) * 0.006, shadow: 0 });
  spr("kate", kx, kb - kh / 2, { h: kh, sy: 1 + Math.sin(t * 1.7 + 1) * 0.005, shadow: 0 });
}

// ═════════════════════════════ SCENE 2 — one place (title) ═════════════════════════════
function scene2(t) {
  if (t < T.s2 || t > T.s3 + 0.7) return;
  const [cx, cy] = L([960, 470], [540, 820]);
  bloom(P2, prog(t, T.s2, 0.62), cx, cy, 201, "#BBA9F0", () => {
    lockup(cx, cy, L(176, 158), L(128, 112), t, T.tiles);
    const imp = t > 8.03 ? Math.exp(-(t - 8.03) * 5) : 0;
    if (imp > 0.02) sparkles(cx, cy, t, 8.03, { n: 9, r: L(330, 300), color: C.coral, seed: 9 });
    caption("Everyone knows what today looks like.", t, T.tag, 12.25, { x: cx, y: L(716, 1100), align: "center", size: L(70, 66), maxW: L(1600, 900), lh: 80, hl: "today", seed: 3, panel: false });
  });
}

// ═════════════════════════════ SCENE 3 — it starts as a message ═════════════════════════════
function scene3(t) {
  if (t < T.s3 || t > T.s4 + 0.7) return;
  bloom(P3, prog(t, T.s3, 0.6), L(1440, 540), L(600, 1150), 301, "#B9ABEE", () => {
    if (!V) { const [kx, kb, kh] = [360, 1048, 640]; groundShadow(kx, kb - 6, kh * 0.42); spr("kate", kx, kb - kh / 2, { h: kh, sy: 1 + Math.sin(t * 1.7) * 0.005, shadow: 0 }); }
    // the whole chat card in frame; after "Add item" the camera tilts down to the toast (16:9 only; 9:16 already shows it)
    const rest = L(-416, 28), sy = rise(t, T.phone3, H + 60, rest, 0.85) + L(-170, 0) * E.inOut(prog(t, T.toast - 0.25, 0.55));
    const st = {
      t, tom: prog(t, T.tom, 0.4), typed: prog(t, T.typing, 0.7), sent: prog(t, T.send, 0.35), actions: prog(t, T.send + 0.45, 0.3),
      sheet: E.out(prog(t, T.sheet, 0.4)) * (1 - E.in(prog(t, T.tapAdd + 0.16, 0.3))), addDown: fade(t, T.tapAdd, T.tapAdd + 0.2, 0.05), toast: fade(t, T.toast, 19.95, 0.25),
    };
    const hit = phone(PHX, sy, (g) => UI.chat(g, st), { t, fadeTop: V ? 470 : null, fadeLen: 150 });
    tapRing(hit.cart3, t, T.tapCart);
    tapRing(hit.add, t, T.tapAdd);
    if (!V && hit.toast && t > T.note) { // a pencilled aside once the item has landed
      const [tx, ty] = hit.toast, nx = 760, ny = ty - 150;
      hand("no retyping!", nx, ny, { size: 78, color: C.coralInk, t, reveal: prog(t, T.note, 0.6), align: "center", seed: 31 });
      arrow([[nx + 60, ny + 30], [nx + 150, ny + 90], [tx - 250, ty - 6]], { color: C.coralInk, w: 4.5, t, seed: 32, reveal: prog(t, T.note + 0.45, 0.35), head: 16 });
    }
  });
}

// ═════════════════════════════ SCENE 4 — whoever's near a shop ═════════════════════════════
function scene4(t) {
  if (t < T.s4 || t > T.s5 + 0.7) return;
  bloom(P4, prog(t, T.s4, 0.6), L(560, 540), L(700, 700), 401, "#A6CFA0", () => {
    const [stx, stb, sth] = L([380, 905, 540], [290, 872, 380]);
    spr("stall", stx, stb - sth / 2, { h: sth, shadow: 0.7 });
    const [tx, tb, th] = L([700, 1160, 780], [700, 940, 480]); // Tom from the waist up: the frame edge (16:9) or the phone (9:16) hides the rest
    spr("tom", tx, tb - th / 2, { h: th, sy: 1 + Math.sin(t * 1.9) * 0.005, shadow: 0.5 });
    const sy = rise(t, T.phone4, H + 60, TOP, 0.85);
    const st = { t, scroll: 250, tick: E.out(prog(t, T.tick4, 0.35)), down: fade(t, T.tick4 - 0.05, T.tick4 + 0.18, 0.05) };
    const hit = phone(PHX, sy, (g) => UI.shopping(g, st), { t });
    tapRing(hit.check, t, T.tick4 - 0.05, C.violet, 0.5);
  });
}

// ═════════════════════════════ SCENE 5 — decided in chat, done by dinner ═════════════════════════════
function steam(x, y, t, seed) { // three wisps curling up and away
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.55 + i / 3) % 1, pts = [];
    for (let j = 0; j <= 10; j++) { const v = j / 10; pts.push([x + (i - 1) * 26 + Math.sin(v * 5 + t * 2 + i) * 12 * v, y - v * 120 - ph * 40]); }
    sketch(pts, { color: "#B9A993", w: 4, t, seed: seed + i, alpha: 0.55 * Math.sin(ph * Math.PI) });
  }
}
function scene5(t) {
  if (t < T.s5 || t > T.s6 + 0.7) return;
  bloom(P5, prog(t, T.s5, 0.6), L(1180, 540), L(660, 1250), 501, "#EDCF83", () => {
    const [dx, db, dh] = L([1200, 1050, 760], [540, 1650, 700]);
    const dw = (dh * SPR.dinner.w) / SPR.dinner.h;
    spr("dinner", dx, db - dh / 2, { h: dh, shadow: 0.5 });
    steam(dx + dw * 0.02, db - dh * 0.62, t, 510);
    if (t > T.cap6 + 0.4) sparkles(dx + dw * 0.02, db - dh * 0.72, t, T.cap6 + 0.4, { n: 7, r: 120, color: "#E3B04B", seed: 12 });
  });
}

// ═════════════════════════════ SCENE 6 — homework comes in from school ═════════════════════════════
function clockFace(x, y, r, t, t0, alpha = 1) { // painted wall clock whose hands sweep eight hours
  if (alpha <= 0) return;
  const p = paper("clock", r * 2, r * 2, { color: "#FFFDF6", seed: 60, sides: "cccc", rough: 0.2, rim: false });
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.clip(); place(p, x, y, { shadow: 0 }); ctx.restore();
  sketch(P.ellipse(x, y, r, r, { seed: 61, turns: 1.04, loose: 0.02 }), { color: "#8A6F52", w: 6, t, seed: 62 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; sketch([[x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8], [x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9]], { color: "#8A6F52", w: 3, t, seed: 63 + i, wobble: 0.5 }); }
  const u = E.inOut(prog(t, t0, 2.6)), hr = -Math.PI / 2 + (8 / 12) * 6.283 * u + 0.3, mn = -Math.PI / 2 + 8 * 6.283 * u;
  sketch([[x, y], [x + Math.cos(hr) * r * 0.5, y + Math.sin(hr) * r * 0.5]], { color: C.ink, w: 7, t, seed: 70, wobble: 0.4 });
  sketch([[x, y], [x + Math.cos(mn) * r * 0.74, y + Math.sin(mn) * r * 0.74]], { color: C.violet, w: 5, t, seed: 71, wobble: 0.4 });
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.283); ctx.fill();
  ctx.restore();
}
function hwCard(x, y, s, rot, alpha, col, seed) { // a little paper assignment card in flight
  const p = paper(`hwcard:${seed}`, 180, 120, { color: "#FFFDF8", seed, sides: "cccc", rough: 0.3, rim: false, decorate: (g, w, h) => {
    g.fillStyle = col; g.fillRect(0, 0, 14, h);
    g.strokeStyle = "rgba(90,84,76,0.55)"; g.lineWidth = 6; g.lineCap = "round";
    g.beginPath(); g.moveTo(36, 40); g.lineTo(150, 40); g.moveTo(36, 70); g.lineTo(120, 70); g.stroke();
    g.lineWidth = 4; g.strokeStyle = "rgba(90,84,76,0.3)"; g.beginPath(); g.moveTo(36, 96); g.lineTo(96, 96); g.stroke();
  } });
  place(p, x, y, { s, rot, alpha, lift: 0.5 });
}
function scene6(t) {
  if (t < T.s6 || t > T.s7 + 0.7) return;
  bloom(P6, prog(t, T.s6, 0.6), L(470, 300), L(760, 700), 601, "#A9C9E3", () => {
    const back = E.inOut(prog(t, T.push9, 0.9)); // the school steps back as the list takes over
    const [scx, scb, sch] = L([470, 1000, 430], [320, 850, 300]);
    ctx.save(); ctx.globalAlpha = 1 - back * 0.55;
    groundShadow(scx, scb - 8, sch * 1.6);
    spr("school", scx, scb - sch / 2, { h: sch, shadow: 0.5 });
    ctx.restore();
    const [ckx, cky, ckr] = L([500, 462, 90], [820, 640, 80]);
    clockFace(ckx, cky, ckr, t, T.clock, fade(t, T.cap8 - 0.1, T.push9 + 0.5, 0.3));
    const sy = rise(t, T.phone6, H + 60, TOP, 0.85);
    const arrive = [0, 1, 2, 3, 4].map((i) => prog(t, T.cards + 0.55 + i * 0.5, 0.4));
    const hit = phone(PHX, sy, (g) => UI.homework(g, { t, arrive, scroll: L(749, 790) }), { t });
    const cols = ["#EF6A12", "#0EA58C", "#7B4DFF", "#EF6A12"];
    for (let i = 0; i < 4; i++) { // cards leave the school door and land on their rows
      const u = prog(t, T.cards + i * 0.5, 0.62);
      if (u <= 0 || u >= 1) continue;
      const [x0, y0] = [scx, scb - sch * 0.18], [x1, y1] = hit[`row${i}`] || [PHX + 390, sy + 700];
      const k = E.inOut(u), x = lerp(x0, x1, k), y = lerp(y0, y1, k) - Math.sin(k * Math.PI) * L(260, 180);
      hwCard(x, y, lerp(0.55, 1.0, Math.sin(k * Math.PI)) * (1 - E.in(clamp((u - 0.8) / 0.2)) * 0.6), (1 - k) * -0.5 + i * 0.07, 1 - E.in(clamp((u - 0.85) / 0.15)), cols[i], 620 + i);
    }
    [0, 1].forEach((gi) => { // sorted by when it's due: pencil underlines under the due-date headings
      const h = hit[`hdr${gi}`];
      if (!h) return;
      const w = [150, 196][gi];
      sketch(P.line(h[0] - 4, h[1] + 22, h[0] + w, h[1] + 20, 10, 3), { color: C.violet, w: 5, t, seed: 640 + gi, reveal: prog(t, T.cap9 + 0.45 + gi * 0.3, 0.35) });
    });
  });
}

// ═════════════════════════════ SCENE 7 — Mia ticks it off ═════════════════════════════
function scene7(t) {
  if (t < T.s7 || t > T.s8 + 0.7) return;
  bloom(P7, prog(t, T.s7, 0.6), L(560, 540), L(700, 700), 701, "#F0B9A2", () => {
    const [mx, mb, mh] = L([520, 1045, 620], [540, 872, 400]);
    groundShadow(mx, mb - 8, mh * 0.8);
    spr("mia_desk", mx, mb - mh / 2, { h: mh, shadow: 0.4 });
    const sy = rise(t, T.phone7, H + 60, TOP, 0.8);
    const st = { t, scroll: 652, tick: prog(t, T.tick7, 0.9), down: fade(t, T.tick7 - 0.05, T.tick7 + 0.18, 0.05) };
    const hit = phone(PHX, sy, (g) => UI.kidHomework(g, st), { t });
    tapRing(hit.check, t, T.tick7 - 0.05, C.green, 0.5);
    if (hit.check && t > T.tick7 + 0.15) sparkles(hit.check[0] - 6, hit.check[1], t, T.tick7 + 0.15, { n: 5, r: 38, color: C.green, seed: 17 });
  });
}

// ═════════════════════════════ SCENE 8 — everyone sees it ═════════════════════════════
function scene8(t) {
  if (t < T.s8 || t > T.s9 + 0.7) return;
  bloom(P8, prog(t, T.s8, 0.55), L(1440, 540), L(540, 1300), 801, "#BBA9F0", () => {
    const [kx, kb, kh] = L([520, 1048, 690], [540, 920, 460]);
    groundShadow(kx, kb - 6, kh * 0.42);
    spr("kate", kx, kb - kh / 2, { h: kh, sy: 1 + Math.sin(t * 1.7) * 0.005, shadow: 0 });
    const sy = rise(t, T.phone8, H + 60, TOP, 0.7);
    const hit = phone(PHX, sy, (g) => UI.homework(g, { t, scroll: 308, roll: prog(t, T.roll8, 0.7) }), { t });
    if (hit.ring && t > T.roll8 + 0.45) sparkles(hit.ring[0], hit.ring[1], t, T.roll8 + 0.45, { n: 7, r: 90, color: "#EF6A12", seed: 18 });
    if (hit.miaLeft && t > T.roll8 + 0.2) sketch(P.ellipse(hit.miaLeft[0] + 120, hit.miaLeft[1] - 6, 150, 34, { seed: 81 }), { color: C.coralInk, w: 4.5, t, seed: 82, reveal: prog(t, T.roll8 + 0.2, 0.45) });
  });
}

// ═════════════════════════════ SCENE 9 — built by an STA parent ═════════════════════════════
const TAGS = [["Read-only", "#CFE1EE"], ["Encrypted", "#DCD2F7"], ["Parent-controlled", "#F8E6B4"]];
function trustTag(text, col, x, y, t, t0, i) { // a painted luggage tag
  const sl = slap(t, t0, 0.3, 1.25);
  if (sl.u <= 0) return;
  ctx.save(); ctx.font = F.sans(40, 700); const tw = ctx.measureText(text).width; ctx.restore();
  const w = tw + 130, h = 92;
  const p = paper(`tag:${text}`, w, h, { color: col, seed: 900 + i, sides: "cccc", rough: 0.35, rim: false, decorate: (g, ww, hh) => {
    g.fillStyle = "rgba(60,48,36,0.45)"; g.beginPath(); g.arc(34, hh / 2, 10, 0, 6.283); g.fill();
    g.font = F.sans(40, 700); g.fillStyle = C.ink; g.fillText(text, 70, hh / 2 + 14);
  } });
  place(p, x, y - sl.lift * 30, { rot: (i % 2 ? 0.04 : -0.035), s: sl.s, lift: sl.lift });
}
function scene9(t) {
  if (t < T.s9 || t > T.s10 + 0.7) return;
  bloom(P9, prog(t, T.s9, 0.6), L(1250, 540), L(540, 1300), 901, "#BBA9F0", () => {
    const [fx, fb, fh] = L([1260, 1045, 720], [540, 1650, 740]);
    groundShadow(fx, fb - 8, fh * 0.9);
    spr("family", fx, fb - fh / 2, { h: fh, sy: 1 + Math.sin(t * 1.6) * 0.004, shadow: 0 });
    const spots = L([[360, 560], [340, 700], [420, 840]], [[300, 640], [790, 640], [540, 780]]);
    TAGS.forEach(([txt, col], i) => trustTag(txt, col, spots[i][0], spots[i][1], t, T.tags + i * 0.38, i));
  });
}

// ═════════════════════════════ SCENE 10 — end card ═════════════════════════════
function urlLabel(x, y, t, t0) {
  const sl = slap(t, t0, 0.32, 1.2);
  if (sl.u <= 0) return;
  const p = paper("url", 640, 132, { color: "#FFFDF6", seed: 1010, sides: "cccc", rough: 0.3, rim: false, decorate: (g, w, h) => {
    wash(g, w / 2, h / 2, w * 0.46, h * 0.36, "#F6D77E", 1011, 0.9);
    g.font = F.sans(76, 700); g.letterSpacing = "-1.5px"; g.fillStyle = C.ink; g.textAlign = "center"; g.fillText("fametc.com", w / 2, h / 2 + 27);
  } });
  place(p, x, y - sl.lift * 36, { rot: -0.015, s: sl.s, lift: sl.lift });
}
function scene10(t) {
  if (t < T.s10) return;
  const [cx, cy] = L([960, 400], [540, 720]);
  bloom(P10, prog(t, T.s10, 0.62), cx, cy, 1001, "#BBA9F0", () => {
    lockup(cx, cy, L(164, 150), L(118, 104), t, T.mark10);
    urlLabel(cx, L(622, 1000), t, T.url);
    const a = E.out(prog(t, T.endTag, 0.5));
    print("Stay in touch. Stay on top.", cx, L(790, 1190) + (1 - a) * 16, { font: F.sans(L(54, 52), 600), color: C.ink, align: "center", alpha: a, tracking: -0.8 });
    const b = E.out(prog(t, T.free, 0.5));
    print("FREE FOR STA FAMILIES WHILE WE'RE TESTING", cx, L(882, 1300), { font: F.mono(L(36, 31), 700), color: C.ink, align: "center", alpha: b, tracking: 1.6 });
    const glow = prog(t, T.chord, 1.6), m = wordmarkWidth(L(118, 104)), mk = L(164, 150), mx = cx - (mk + mk * 0.24 + m.w) / 2 + mk / 2;
    if (glow > 0 && glow < 1) sparkles(mx, cy, t, T.chord, { n: 8, r: mk * 0.95, color: C.violet, seed: 21 }); // a small burst round the tiles on the final chord
  });
}

// ───────────────────────────── frame compositor ─────────────────────────────
const SCENES = [scene1, scene2, scene3, scene4, scene5, scene6, scene7, scene8, scene9, scene10];
function frame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";
  for (const s of SCENES) s(t);
  CAPS.forEach(([text, t0, t1, hl, narrow], i) => caption(text, t, t0, t1, { hl, seed: 40 + i, maxW: narrow ? CAP.narrowW : CAP.maxW }));
  ctx.save(); // grade: warm window light, a soft vignette, animated grain (12 fps)
  const lamp = ctx.createRadialGradient(W * 0.3, H * 0.12, 50, W * 0.3, H * 0.12, Math.max(W, H) * 0.9);
  lamp.addColorStop(0, "rgba(255,238,205,0.10)"); lamp.addColorStop(1, "rgba(255,238,205,0)");
  ctx.fillStyle = lamp; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.66);
  vg.addColorStop(0, "rgba(70,50,30,0)"); vg.addColorStop(1, "rgba(70,50,30,0.16)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = 0.06;
  const gi = Math.floor(t * 12) % 4, pat = ctx.createPattern(GRAIN, "repeat");
  pat.setTransform(new DOMMatrix().translate(gi * 61, gi * 37));
  ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ───────────────────────────── SFX cue sheet (times match the picture) ─────────────────────────────
function buildCues() {
  [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1].forEach((tt, i) => cue(tt + 0.1, i < 3 ? `pop_${(i % 3) + 1}` : "paper_rustle_1", i < 3 ? -16 : -20, (i % 2 ? 0.3 : -0.3)));
  cue(T.swirl, "paper_whoosh_1", -12);
  cue(T.s2, "page_flip", -10);
  [0, 1, 2, 3].forEach((i) => cue(T.tiles + i * 0.075, `pop_${(i % 3) + 1}`, -12, (i - 1.5) * 0.2));
  cue(8.03, "sparkle", -9);
  cue(T.s3, "page_flip", -10);
  cue(T.phone3, "paper_whoosh_2", -16, 0.4);
  cue(T.tom, "chime_up", -13, 0.3);
  [0, 0.12, 0.24, 0.36, 0.5, 0.62].forEach((d) => cue(T.typing + d, "ui_click", -24, 0.35));
  cue(T.send, "pop_2", -13, 0.35);
  cue(T.tapCart, "ui_click", -12, 0.35);
  cue(T.sheet, "paper_whoosh_2", -17, 0.35);
  cue(T.tapAdd, "ui_click", -12, 0.35);
  cue(T.toast, "chime_up", -12, 0.35);
  cue(T.note, "pencil_scribble_1", -14, -0.2);
  cue(T.s4, "page_flip", -10);
  cue(T.phone4, "paper_whoosh_2", -16, 0.4);
  cue(T.tick4, "pencil_tick", -9, 0.35);
  cue(T.s5, "page_flip", -10);
  cue(T.cap6 + 0.4, "sparkle", -14);
  cue(T.s6, "page_flip", -10);
  cue(T.phone6, "paper_whoosh_2", -16, 0.4);
  for (let i = 0; i < 5; i++) { cue(T.cards + i * 0.5, i % 2 ? "paper_whoosh_1" : "paper_whoosh_2", -19, -0.2 + i * 0.12); cue(T.cards + 0.55 + i * 0.5, `pop_${(i % 3) + 1}`, -16, 0.35); }
  cue(T.clock, "tick_counter", -14, -0.3);
  cue(T.s7, "page_flip", -10);
  cue(T.phone7, "paper_whoosh_2", -16, 0.4);
  cue(T.tick7, "pencil_tick", -9, 0.35);
  cue(T.toast7, "chime_up", -12, 0.35);
  cue(T.tick7 + 0.9, "sparkle", -14, 0.35);
  cue(T.s8, "page_flip", -10);
  cue(T.roll8, "tick_counter", -15, 0.35);
  cue(T.s9, "page_flip", -10);
  TAGS.forEach((_, i) => cue(T.tags + i * 0.38, `paper_slap_${i + 1}`, -14, -0.35 + i * 0.1));
  cue(T.s10, "page_flip", -10);
  [0, 1, 2, 3].forEach((i) => cue(T.mark10 + i * 0.075, `pop_${(i % 3) + 1}`, -13));
  cue(T.url, "paper_slap_2", -12);
  cue(T.chord, "sparkle", -12);
}

// ───────────────────────────── boot ─────────────────────────────
async function init() {
  const fams = ['700 40px Caveat', '600 40px "Space Grotesk"', '700 40px "Space Grotesk"', '500 40px "JetBrains Mono"', '600 40px "JetBrains Mono"', '700 40px "JetBrains Mono"',
    '400 40px Geist', '500 40px Geist', '600 40px Geist', '700 40px Geist', '800 40px Geist'];
  await Promise.all(fams.map((f) => document.fonts.load(f, "Sample 0123 Text ≈ • — … ✓")));
  GRAIN = makeGrain(256, 7); FIBERS = makeFibers(1024, 9, 1500); MOTTLE = makeNoise(512, 3, 0.35, 5);
  await loadSprites();
  buildPages(); buildTiles(); buildPhone();
  buildCues();
  console.log(`[promo] build ${BUILD_ID} · ${CUES.length} sfx cues · ${DURATION}s`);
}

const ready = init();
if (RENDER) {
  window.__promo = { ready, fps: FPS, duration: DURATION, width: W, height: H, canvas, get sfxCues() { return CUES; }, vo: VO, seek: (t) => frame(t) };
} else {
  window.__promo = { ready, vo: VO, seek: (t) => frame(t) };
  const audio = document.getElementById("audio"), play = document.getElementById("play"), toggle = document.getElementById("toggle"), replay = document.getElementById("replay");
  const bar = document.getElementById("progress"), time = document.getElementById("time");
  const POSTER_T = 19.8; // Kate's message becoming the shopping list stands in as the poster until first play
  // Autoplays silently (a hero film); "Sound on" brings the mix in at the current moment.
  let clock0 = 0, paused = true, useAudio = false, pausedAt = 0, started = false, muted = true;
  const mute = document.getElementById("mute");
  function setMuted(m) { muted = m; mute.innerHTML = m ? "🔊&nbsp;Sound on" : "🔇&nbsp;Mute"; mute.classList.toggle("on", m); }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const now = () => (paused ? pausedAt : useAudio ? audio.currentTime : (performance.now() - clock0) / 1000);
  const buildEl = document.getElementById("build"); if (buildEl) buildEl.textContent = BUILD_ID;
  const fmt916 = document.getElementById("format");
  if (fmt916) { fmt916.textContent = V ? "Landscape 16:9" : "Vertical 9:16"; fmt916.addEventListener("click", () => { location.hash = V ? "" : "vertical"; location.reload(); }); }
  function showOverlay(html, aria) { play.querySelector("span").innerHTML = html; play.setAttribute("aria-label", aria); play.hidden = false; }
  function loop() {
    const t = Math.min(DURATION, now());
    frame(started ? t : POSTER_T);
    bar.style.width = `${(t / DURATION) * 100}%`;
    time.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
    if (t >= DURATION && !paused) {
      if (muted) start(0); // silent playback loops
      else { paused = true; pausedAt = DURATION; toggle.textContent = "Play"; showOverlay("↻&nbsp; Watch again", "Watch the film again"); }
    }
    requestAnimationFrame(loop);
  }
  // Audio must never fail silently: retry with the MP3 once, then say so and offer a retry.
  const sound = document.getElementById("sound"), SOURCES = ["assets/audio/mix.mp3", "assets/audio/mix-aac.mp4"];
  let srcIdx = 0;
  function useSource(i) { srcIdx = i; audio.src = SOURCES[i]; audio.load(); }
  useSource(0);
  audio.addEventListener("error", () => {
    const at = now();
    if (srcIdx === 0) { useSource(1); if (!paused) start(at); return; }
    sound.hidden = false;
    if (!paused) { useAudio = false; clock0 = performance.now() - at * 1000; }
  });
  document.getElementById("retry").addEventListener("click", () => { sound.hidden = true; useSource(0); start(0); });
  // The wall clock runs the film until the audio is actually playing, then
  // the audio takes over (re-synced to wherever the picture got to).
  async function start(from = 0) {
    started = true; paused = false; toggle.textContent = "Pause"; play.hidden = true;
    useAudio = false; clock0 = performance.now() - from * 1000;
    if (muted) { audio.pause(); return; }
    try {
      audio.currentTime = from; await audio.play();
      if (muted || paused) { audio.pause(); return; }
      audio.currentTime = (performance.now() - clock0) / 1000; useAudio = true; sound.hidden = true;
    } catch { sound.hidden = false; }
  }
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  ready.then(() => {
    requestAnimationFrame(loop);
    if (reduceMotion) { toggle.textContent = "Play"; play.hidden = false; } else start(0);
  });
  play.addEventListener("click", () => { if (!started) setMuted(false); start(started && pausedAt < DURATION ? pausedAt : 0); });
  mute.addEventListener("click", () => {
    const at = now(); setMuted(!muted);
    if (paused) return;
    if (muted) { audio.pause(); useAudio = false; clock0 = performance.now() - at * 1000; } else start(at);
  });
  replay.addEventListener("click", () => start(0));
  toggle.addEventListener("click", () => {
    if (paused) start(!started || pausedAt >= DURATION ? 0 : pausedAt);
    else { pausedAt = now(); paused = true; audio.pause(); toggle.textContent = "Play"; showOverlay("▶&nbsp; Resume", "Resume the film"); }
  });
  window.addEventListener("keydown", (e) => { if (e.code === "Space" && e.target === document.body) { e.preventDefault(); toggle.click(); } });
  canvas.addEventListener("click", () => { if (started && !paused) toggle.click(); });
}
