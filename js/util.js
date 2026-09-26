'use strict';
// Shared math, random, noise and colour helpers. Loaded first; everything is global.

const TAU = Math.PI * 2;
const TILE = 32;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
function turnToward(a, b, max) {
  const d = angDiff(a, b);
  return Math.abs(d) <= max ? b : a + Math.sign(d) * max;
}
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

// Deterministic PRNG (mulberry32) with helpers, used for map generation.
function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + r() * (b - a);
  r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

// 2D value noise with optional wrap period (for tileable textures).
class Noise2D {
  constructor(seed) {
    const r = makeRng(seed);
    const p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    this.v = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.v[i] = r();
  }
  _h(ix, iy) { return this.v[this.p[this.p[ix & 255] + (iy & 255)]]; }
  value(x, y, period) {
    let ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    let ix1 = ix + 1, iy1 = iy + 1;
    if (period) {
      ix = ((ix % period) + period) % period; iy = ((iy % period) + period) % period;
      ix1 = ((ix1 % period) + period) % period; iy1 = ((iy1 % period) + period) % period;
    }
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = this._h(ix, iy), b = this._h(ix1, iy), c = this._h(ix, iy1), d = this._h(ix1, iy1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  fbm(x, y, oct = 4, period = 0) {
    let s = 0, amp = 0.5, f = 1, n = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * this.value(x * f, y * f, period ? period * f : 0);
      n += amp; amp *= 0.5; f *= 2;
    }
    return s / n;
  }
}

// Colours
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rgbStr(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function shade(hex, f, a = 1) {
  const c = hexToRgb(hex);
  const t = f < 0 ? [0, 0, 0] : [255, 255, 255];
  return rgbStr(mixRgb(c, t, Math.abs(f)), a);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// Soft radial sprites, cached per colour. Used for glows, smoke and lights.
const _glowCache = new Map();
function glowSprite(color, hard = 0) {
  const key = color + '|' + hard;
  let c = _glowCache.get(key);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const rgb = hexToRgb(color);
  grd.addColorStop(0, rgbStr(rgb, 1));
  grd.addColorStop(clamp(hard, 0, 0.9), rgbStr(rgb, hard ? 0.9 : 0.55));
  grd.addColorStop(1, rgbStr(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _glowCache.set(key, c);
  return c;
}

// Binary min-heap keyed by numeric priority (for A*).
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(val, key) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i;
        let mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// Trooper name generator (original, generic names).
const FIRST_NAMES = ['Ada','Bram','Cass','Dario','Elin','Faro','Greta','Hugo','Ines','Jonah','Kira','Lev','Mara','Nils','Oona','Pim','Quinn','Rhea','Sven','Tamsin','Udo','Vera','Wes','Xan','Yara','Zeke','Anouk','Basil','Cleo','Dex','Esme','Finn','Gus','Hana','Ivo','Juno','Kai','Lotte','Milo','Noor','Otis','Pia','Rafe','Saar','Teo','Uma','Vik','Wren','Yuri','Zola','Arlo','Bea','Colm','Dina','Emil','Fleur','Gio','Hester','Ilse','Joss'];
const LAST_NAMES = ['Ashdown','Brask','Corvin','Dunmore','Eckhart','Falk','Grieve','Holt','Ivers','Jansen','Kestrel','Lund','Marsh','Norrell','Okafor','Pryce','Quill','Rook','Stroud','Thorne','Ulrich','Vance','Wilde','Yates','Zeller','Aalders','Bexley','Crane','Doyle','Everts','Fenwick','Garrow','Hale','Ibarra','Jory','Kovac','Lark','Moss','Nakai','Orme','Petrov','Rask','Sato','Tully','Varga','Wick','Brandt','Calder','Drummond','Engel','Frost','Gault','Harrow','Kade','Lowell','Mercer','Nyberg','Oakes','Penhallow','Rourke'];
function randomName() { return pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES); }

const RANKS = [
  { name: 'Recruit', short: 'RCT', bars: 0 },
  { name: 'Private', short: 'PVT', bars: 1 },
  { name: 'Lance Corporal', short: 'LCP', bars: 2 },
  { name: 'Corporal', short: 'CPL', bars: 3 },
  { name: 'Sergeant', short: 'SGT', bars: 4 },
  { name: 'Staff Sergeant', short: 'SSG', bars: 5 },
  { name: 'Lieutenant', short: 'LT', bars: 6 },
  { name: 'Captain', short: 'CPT', bars: 7 },
  { name: 'Major', short: 'MAJ', bars: 8 },
];
const RANK_COLORS = ['#8a9aa8', '#9fb3c4', '#7fc7d9', '#6fd6b0', '#e8c25a', '#f0a040', '#e87a50', '#e05a7a', '#c07af0'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
