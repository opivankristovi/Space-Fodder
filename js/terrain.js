'use strict';
// Biomes, procedural map generation, pathfinding and pre-rendered terrain.

const T_GROUND = 0, T_ROCK = 1, T_FLORA = 2, T_WATER = 3, T_LAVA = 4;

const BIOMES = {
  dust: {
    label: 'Arid dust world',
    ground: ['#a8603a', '#c47d4c', '#8c4b2e', '#d6a067'],
    rockTop: ['#8b5a45', '#b07a5e'], rockSide: '#4d2b22', rockRim: '#d6a488',
    liquid: { kind: 'water', deep: '#154857', shallow: '#3f8e8f', shore: '#6a3a24', foam: '#bfeee6', damage: 0 },
    flora: 'crystal', floraColors: ['#2fb3b8', '#7de6df', '#d8fffb'], floraGlow: '#5ff0e8',
    ambient: null, weather: 'dust', footprint: 'rgba(90,45,25,0.28)',
    planet: ['#c47d4c', '#8c4b2e', '#e8b27a'],
  },
  jungle: {
    label: 'Bioluminescent jungle',
    ground: ['#2b4a2c', '#3f6536', '#1f3627', '#5d7f3f'],
    rockTop: ['#4b5b4d', '#687b69'], rockSide: '#1a241e', rockRim: '#9bb29a',
    liquid: { kind: 'water', deep: '#10281f', shallow: '#2f5c46', shore: '#1b2a19', foam: '#9fe8c0', damage: 0 },
    flora: 'frond', floraColors: ['#17563c', '#2c8a5a', '#8affd0'], floraGlow: '#6affc0',
    ambient: [96, 128, 132], weather: 'spores', footprint: 'rgba(15,30,15,0.35)',
    planet: ['#3f6536', '#1f3627', '#7fd0a0'],
  },
  ice: {
    label: 'Frozen moon',
    ground: ['#c3d2df', '#e3ecf4', '#a3b7c9', '#f6fafd'],
    rockTop: ['#71869d', '#93a7bd'], rockSide: '#34445a', rockRim: '#e2eefa',
    liquid: { kind: 'water', deep: '#173f66', shallow: '#4c8bbd', shore: '#8fa9c0', foam: '#e8f6ff', damage: 0 },
    flora: 'spire', floraColors: ['#6fb6ee', '#bfe6ff', '#ffffff'], floraGlow: '#a8dcff',
    ambient: null, weather: 'snow', footprint: 'rgba(70,95,130,0.35)',
    planet: ['#dfe9f2', '#8fa9c0', '#ffffff'],
  },
  hive: {
    label: 'Infested hive world',
    ground: ['#3b2442', '#512f55', '#2a1a30', '#6a3a62'],
    rockTop: ['#5b3052', '#78426d'], rockSide: '#1c0d1b', rockRim: '#b06a9c',
    liquid: { kind: 'acid', deep: '#2c5510', shallow: '#86d42c', shore: '#27260f', foam: '#e6ff9a', damage: 14 },
    flora: 'pod', floraColors: ['#7d3466', '#c25b92', '#ffb445'], floraGlow: '#ffa640',
    ambient: [92, 70, 104], weather: 'spores', footprint: 'rgba(20,5,20,0.35)',
    planet: ['#512f55', '#2a1a30', '#c25b92'],
  },
  volcanic: {
    label: 'Volcanic badlands',
    ground: ['#2b2527', '#3c3133', '#1d191b', '#4d3c37'],
    rockTop: ['#5b4d4a', '#7a6660'], rockSide: '#1a1212', rockRim: '#c09a88',
    liquid: { kind: 'lava', deep: '#9c1c00', shallow: '#ff7a12', shore: '#170907', foam: '#ffe070', damage: 80 },
    flora: 'obsidian', floraColors: ['#17121c', '#3a2a4a', '#ff5a1c'], floraGlow: '#ff6a20',
    ambient: [132, 96, 88], weather: 'ash', footprint: 'rgba(0,0,0,0.3)',
    planet: ['#3c3133', '#1d191b', '#ff6a20'],
  },
};

class GameMap {
  constructor(w, h, biomeKey, seed, opts = {}) {
    this.w = w; this.h = h;
    this.biomeKey = biomeKey;
    this.biome = BIOMES[biomeKey];
    this.pw = w * TILE; this.ph = h * TILE;
    this.opts = Object.assign({ rock: 0.17, water: 0.08, flora: 0.08 }, opts);
    this.tiles = new Uint8Array(w * h);
    this.flow = new Int32Array(w * h);
    this.floraAt = new Int32Array(w * h).fill(-1);
    this.flora = [];
    this.generate(seed);
  }

  idx(tx, ty) { return ty * this.w + tx; }
  get(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? T_ROCK : this.tiles[ty * this.w + tx]; }
  tileAt(x, y) { return this.get(Math.floor(x / TILE), Math.floor(y / TILE)); }
  walkable(tx, ty) { const t = this.get(tx, ty); return t === T_GROUND || t === T_WATER; }
  // 'foot' units wade water; 'hover' craft also cross lava and acid.
  passable(tx, ty, mode) {
    const t = this.get(tx, ty);
    return t === T_GROUND || t === T_WATER || (mode === 'hover' && t === T_LAVA);
  }
  blocksShotAt(x, y) { const t = this.tileAt(x, y); return t === T_ROCK || t === T_FLORA; }

  // ---------------------------------------------------------------- generation
  generate(seed) {
    const { w, h } = this;
    const N = w * h;
    for (let attempt = 0; attempt < 40; attempt++) {
      const s = seed + attempt * 7919;
      const rng = makeRng(s);
      const nA = new Noise2D(s + 1), nB = new Noise2D(s + 2), nC = new Noise2D(s + 3);
      const e = new Float32Array(N), m = new Float32Array(N), f = new Float32Array(N);
      for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx;
        const d = Math.min(tx, ty, w - 1 - tx, h - 1 - ty);
        e[i] = nA.fbm(tx / 9, ty / 9, 4) + Math.max(0, 3 - d) * 0.12;
        m[i] = nB.fbm(tx / 7 + 40, ty / 7 + 40, 3);
        f[i] = nC.fbm(tx / 3.5, ty / 3.5, 2) * 0.75 + rng() * 0.25;
      }
      const quant = (arr, filter, q) => {
        const vals = [];
        for (let i = 0; i < N; i++) if (filter(i)) vals.push(arr[i]);
        vals.sort((a, b) => a - b);
        return vals.length ? vals[clamp(Math.floor(q * vals.length), 0, vals.length - 1)] : 0;
      };
      const t = this.tiles;
      t.fill(T_GROUND);
      const rockT = quant(e, () => true, 1 - this.opts.rock);
      for (let i = 0; i < N; i++) if (e[i] > rockT) t[i] = T_ROCK;
      const liq = this.biome.liquid.kind === 'lava' ? T_LAVA : T_WATER;
      const waterT = quant(m, (i) => t[i] === T_GROUND, this.opts.water);
      for (let i = 0; i < N; i++) if (t[i] === T_GROUND && m[i] < waterT) t[i] = liq;
      // Smooth rock and liquid shapes.
      const count = (tx, ty, type) => {
        let c = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if ((ox || oy) && this.get(tx + ox, ty + oy) === type) c++;
        }
        return c;
      };
      for (let pass = 0; pass < 2; pass++) {
        const copy = t.slice();
        for (let ty = 1; ty < h - 1; ty++) for (let tx = 1; tx < w - 1; tx++) {
          const i = ty * w + tx;
          const rc = count(tx, ty, T_ROCK);
          if (copy[i] === T_ROCK && rc < 3) t[i] = T_GROUND;
          else if (copy[i] !== T_ROCK && rc >= 6) t[i] = T_ROCK;
          else if (copy[i] === liq && count(tx, ty, liq) < 2) t[i] = T_GROUND;
        }
      }
      const floraT = quant(f, (i) => t[i] === T_GROUND, 1 - this.opts.flora);
      for (let i = 0; i < N; i++) if (t[i] === T_GROUND && f[i] > floraT) t[i] = T_FLORA;
      for (let tx = 0; tx < w; tx++) { t[tx] = T_ROCK; t[(h - 1) * w + tx] = T_ROCK; }
      for (let ty = 0; ty < h; ty++) { t[ty * w] = T_ROCK; t[ty * w + w - 1] = T_ROCK; }

      // Drop zone near the southern edge.
      const sx = rng.int(5, Math.floor(w * 0.45)), sy = h - rng.int(5, 7);
      for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
        if (ox * ox + oy * oy > 11) continue;
        const x = sx + ox, y = sy + oy;
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) t[y * w + x] = T_GROUND;
      }
      this.start = { tx: sx, ty: sy, x: (sx + 0.5) * TILE, y: (sy + 0.5) * TILE };
      this.distFromStart = this.bfs([[sx, sy]]);
      let reached = 0;
      for (let i = 0; i < N; i++) if (this.distFromStart[i] >= 0 && t[i] === T_GROUND) reached++;
      this.seed = s;
      this.rng = rng;
      if (reached / N > 0.4) break;
    }
    // Flora index
    this.flora = [];
    this.floraAt.fill(-1);
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
      if (this.tiles[ty * w + tx] !== T_FLORA) continue;
      this.floraAt[ty * w + tx] = this.flora.length;
      this.flora.push({ tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, v: this.rng.int(0, 4), alive: true, phase: this.rng() * TAU });
    }
  }

  // Breadth-first distances over walkable tiles (8-way, no corner cutting).
  bfs(sources) {
    const { w, h } = this;
    const d = new Int32Array(w * h).fill(-1);
    const q = new Int32Array(w * h);
    let qh = 0, qt = 0;
    for (const [x, y] of sources) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (d[i] === -1) { d[i] = 0; q[qt++] = i; }
    }
    while (qh < qt) {
      const i = q[qh++];
      const x = i % w, y = (i / w) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (!this.walkable(nx, ny)) continue;
        if (ox && oy && (!this.walkable(x + ox, y) || !this.walkable(x, y + oy))) continue;
        const ni = ny * w + nx;
        if (d[ni] !== -1) continue;
        d[ni] = d[i] + 1;
        q[qt++] = ni;
      }
    }
    return d;
  }

  computeFlow(goals) { this.flow = this.bfs(goals); }

  // Returns a world point one tile further down the flow field, or null.
  flowStep(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const w = this.w;
    const here = this.flow[ty * w + tx];
    let best = here < 0 ? 1e9 : here, bx = -1, by = -1;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = tx + ox, ny = ty + oy;
      if (!this.walkable(nx, ny)) continue;
      if (ox && oy && (!this.walkable(tx + ox, ty) || !this.walkable(tx, ty + oy))) continue;
      const v = this.flow[ny * w + nx];
      if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
    }
    return bx < 0 ? null : { x: (bx + 0.5) * TILE, y: (by + 0.5) * TILE };
  }

  // Circle vs. blocking tiles.
  circleBlocked(x, y, r, mode) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (mode ? this.passable(tx, ty, mode) : this.walkable(tx, ty)) continue;
      const cx = clamp(x, tx * TILE, tx * TILE + TILE), cy = clamp(y, ty * TILE, ty * TILE + TILE);
      if (dist2(x, y, cx, cy) < r * r) return true;
    }
    return false;
  }

  // Line of sight for bullets and awareness (rock and flora block).
  lineClear(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1);
    const steps = Math.ceil(d / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksShotAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  walkClear(x0, y0, x1, y1, r, mode) {
    const d = dist(x0, y0, x1, y1);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.circleBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, mode)) return false;
    }
    return true;
  }

  nearestWalkable(tx, ty, maxR = 6, mode = 'foot') {
    if (this.passable(tx, ty, mode)) return { tx, ty };
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        if (!this.passable(tx + ox, ty + oy, mode)) continue;
        const dd = ox * ox + oy * oy;
        if (dd < bd) { bd = dd; best = { tx: tx + ox, ty: ty + oy }; }
      }
      if (best) return best;
    }
    return null;
  }

  // A* on the tile grid; returns smoothed world-space waypoints.
  findPath(sx, sy, gx, gy, r = 7, mode = 'foot') {
    const ok = (x, y) => this.passable(x, y, mode);
    const { w } = this;
    const s = { tx: Math.floor(sx / TILE), ty: Math.floor(sy / TILE) };
    const g = this.nearestWalkable(Math.floor(gx / TILE), Math.floor(gy / TILE), 6, mode);
    if (!g) return null;
    const exactGoal = ok(Math.floor(gx / TILE), Math.floor(gy / TILE));
    const si = s.ty * w + s.tx, gi = g.ty * w + g.tx;
    const came = new Int32Array(this.w * this.h).fill(-1);
    const cost = new Float32Array(this.w * this.h).fill(Infinity);
    const heap = new MinHeap();
    cost[si] = 0; heap.push(si, 0);
    const H = (i) => { const x = i % w, y = (i / w) | 0; const dx = Math.abs(x - g.tx), dy = Math.abs(y - g.ty); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
    let found = false, iter = 0;
    while (heap.size && iter++ < 20000) {
      const i = heap.pop();
      if (i === gi) { found = true; break; }
      const x = i % w, y = (i / w) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (!ok(nx, ny)) continue;
        if (ox && oy && (!ok(x + ox, y) || !ok(x, y + oy))) continue;
        const ni = ny * w + nx;
        const step = (ox && oy ? 1.414 : 1) * (mode === 'foot' && this.get(nx, ny) === T_WATER ? 2.5 : 1);
        const nc = cost[i] + step;
        if (nc < cost[ni]) { cost[ni] = nc; came[ni] = i; heap.push(ni, nc + H(ni)); }
      }
    }
    if (!found) return null;
    const pts = [];
    for (let i = gi; i !== si && i !== -1; i = came[i]) pts.push({ x: (i % w + 0.5) * TILE, y: (((i / w) | 0) + 0.5) * TILE });
    pts.reverse();
    if (exactGoal && pts.length) pts[pts.length - 1] = { x: gx, y: gy };
    else if (exactGoal) pts.push({ x: gx, y: gy });
    // String-pull: skip waypoints that are directly reachable.
    const out = [];
    let cx = sx, cy = sy, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (j - k > 12) continue;
        if (this.walkClear(cx, cy, pts[j].x, pts[j].y, r, mode)) { far = j; break; }
      }
      out.push(pts[far]);
      cx = pts[far].x; cy = pts[far].y;
      k = far + 1;
    }
    return out;
  }

  destroyFlora(tx, ty) {
    const i = this.idx(tx, ty);
    if (this.tiles[i] !== T_FLORA) return false;
    this.tiles[i] = T_GROUND;
    const fi = this.floraAt[i];
    if (fi >= 0) this.flora[fi].alive = false;
    this.floraAt[i] = -1;
    if (this.minimap) {
      const g = this.minimap.getContext('2d');
      g.fillStyle = this.biome.ground[0];
      g.fillRect(tx, ty, 1, 1);
    }
    return true;
  }

  // ---------------------------------------------------------------- rendering
  render() {
    const b = this.biome;
    const W = this.pw, H = this.ph;
    this.canvas = makeCanvas(W, H);
    this.decals = makeCanvas(W, H);
    const ctx = this.canvas.getContext('2d');
    const rng = makeRng(this.seed + 99);

    // Ground: tileable detail texture + large-scale colour variation.
    ctx.fillStyle = ctx.createPattern(this._groundTexture(), 'repeat');
    ctx.fillRect(0, 0, W, H);
    const blot = makeCanvas(this.w * 2, this.h * 2);
    const bg = blot.getContext('2d');
    const nz = new Noise2D(this.seed + 5);
    const img = bg.createImageData(blot.width, blot.height);
    const c2 = hexToRgb(b.ground[2]), c3 = hexToRgb(b.ground[3]);
    for (let y = 0; y < blot.height; y++) for (let x = 0; x < blot.width; x++) {
      const n = nz.fbm(x / 14, y / 14, 3);
      const o = (y * blot.width + x) * 4;
      const c = n < 0.5 ? c2 : c3;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
      img.data[o + 3] = clamp(Math.abs(n - 0.5) * 2.2, 0, 1) * 140;
    }
    bg.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blot, 0, 0, W, H);

    this._scatterDetails(ctx, rng);
    this._renderLiquid(ctx);
    this._renderRock(ctx);

    // Flora sprites (2x resolution for crisp zoom).
    this.floraSprites = [];
    for (let v = 0; v < 5; v++) this.floraSprites.push(this._makeFloraSprite(v, makeRng(this.seed * 13 + v)));

    // Minimap
    this.minimap = makeCanvas(this.w, this.h);
    const mg = this.minimap.getContext('2d');
    const col = { [T_GROUND]: b.ground[0], [T_ROCK]: b.rockSide, [T_FLORA]: b.floraColors[0], [T_WATER]: b.liquid.shallow, [T_LAVA]: b.liquid.shallow };
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) {
      mg.fillStyle = col[this.tiles[ty * this.w + tx]];
      mg.fillRect(tx, ty, 1, 1);
    }

    this.liquidTiles = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t === T_WATER || t === T_LAVA) this.liquidTiles.push({ x: (i % this.w + 0.5) * TILE, y: (((i / this.w) | 0) + 0.5) * TILE, p: rng() * TAU });
    }
  }

  _groundTexture() {
    const b = this.biome, S = 256;
    const c = makeCanvas(S, S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const nz = new Noise2D(this.seed + 11), nz2 = new Noise2D(this.seed + 12);
    const c0 = hexToRgb(b.ground[0]), c1 = hexToRgb(b.ground[1]), c2 = hexToRgb(b.ground[2]);
    const kind = this.biomeKey;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = nz.fbm(x / 32, y / 32, 4, 8);
      const fine = nz2.fbm(x / 8, y / 8, 2, 32);
      let t = clamp((n - 0.3) * 2.2, 0, 1);
      let col = mixRgb(c0, c1, t);
      if (fine < 0.35) col = mixRgb(col, c2, (0.35 - fine) * 1.6);
      const ridge = 1 - Math.abs(2 * nz2.fbm(x / 16, y / 16, 3, 16) - 1);
      if (kind === 'dust') {
        const rip = Math.sin((y + n * 40) * 0.35);
        col = mixRgb(col, c2, rip > 0.85 ? 0.18 : 0);
      } else if (kind === 'hive') {
        const r = Math.pow(ridge, 10);
        col = mixRgb(col, [180, 70, 150], r * 0.55);
      } else if (kind === 'volcanic') {
        const r = Math.pow(ridge, 22);
        col = mixRgb(col, [255, 110, 30], r * 0.35);
      } else if (kind === 'ice') {
        const r = Math.pow(ridge, 16);
        col = mixRgb(col, [120, 150, 180], r * 0.35);
      } else if (kind === 'jungle') {
        if (fine > 0.68) col = mixRgb(col, [110, 160, 70], (fine - 0.68) * 1.5);
      }
      const grain = (Math.random() - 0.5) * 14;
      const o = (y * S + x) * 4;
      img.data[o] = clamp(col[0] + grain, 0, 255);
      img.data[o + 1] = clamp(col[1] + grain, 0, 255);
      img.data[o + 2] = clamp(col[2] + grain, 0, 255);
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  _rockTexture() {
    const b = this.biome, S = 256;
    const c = makeCanvas(S, S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const nz = new Noise2D(this.seed + 21), nz2 = new Noise2D(this.seed + 22);
    const a = hexToRgb(b.rockTop[0]), bb = hexToRgb(b.rockTop[1]), dark = hexToRgb(b.rockSide);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = nz.fbm(x / 32, y / 32, 5, 8);
      const ridge = 1 - Math.abs(2 * nz2.fbm(x / 16, y / 16, 3, 16) - 1);
      let col = mixRgb(a, bb, clamp((n - 0.3) * 2.5, 0, 1));
      col = mixRgb(col, dark, Math.pow(ridge, 12) * 0.7);
      const grain = (Math.random() - 0.5) * 18;
      const o = (y * S + x) * 4;
      img.data[o] = clamp(col[0] + grain, 0, 255);
      img.data[o + 1] = clamp(col[1] + grain, 0, 255);
      img.data[o + 2] = clamp(col[2] + grain, 0, 255);
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Smooth scalar field for one tile type at half resolution: bilinear-upscaled
  // tile grid plus noise, so thresholding gives organic edges that match collision.
  _field(type) {
    const fw = Math.ceil(this.pw / 2), fh = Math.ceil(this.ph / 2);
    const lo = makeCanvas(this.w, this.h), lg = lo.getContext('2d');
    const img = lg.createImageData(this.w, this.h);
    for (let i = 0; i < this.tiles.length; i++) {
      const v = this.tiles[i] === type ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    lg.putImageData(img, 0, 0);
    const mid = makeCanvas(fw, fh), mg = mid.getContext('2d');
    mg.imageSmoothingEnabled = true;
    mg.drawImage(lo, 0, 0, fw, fh);
    const d = mg.getImageData(0, 0, fw, fh).data;
    const f = new Float32Array(fw * fh);
    const nz = new Noise2D(this.seed + type * 31);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = y * fw + x;
      f[i] = d[i * 4] / 255 + (nz.fbm(x / 9, y / 9, 3) - 0.5) * 0.42;
    }
    return { f, fw, fh };
  }

  _maskFrom(F, bias, rgb, edge = 0) {
    const c = makeCanvas(F.fw, F.fh), g = c.getContext('2d');
    const img = g.createImageData(F.fw, F.fh), d = img.data, f = F.f;
    for (let i = 0; i < f.length; i++) {
      const v = f[i] + bias;
      const a = edge ? 1 - Math.abs(v - 0.5) / edge : (v - 0.5) / 0.07 + 0.5;
      if (a <= 0) continue;
      const o = i * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2];
      d[o + 3] = a >= 1 ? 255 : a * 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Cheap blur: repeated halving with bilinear filtering.
  _downsample(src, steps) {
    let c = src;
    for (let s = 0; s < steps; s++) {
      const n = makeCanvas(c.width / 2, c.height / 2), g = n.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.drawImage(c, 0, 0, n.width, n.height);
      c = n;
    }
    return c;
  }

  _renderRock(ctx) {
    const b = this.biome, rng = makeRng(this.seed + 31);
    const W = this.pw, H = this.ph;
    const F = this._field(T_ROCK), fw = F.fw, fh = F.fh;
    const mask = this._maskFrom(F, 0, [255, 255, 255]);
    // Soft cast shadow toward the south-east.
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(this._downsample(this._maskFrom(F, 0.06, [0, 0, 0]), 3), 8, 12, W, H);
    ctx.restore();
    // Cliff faces: extrude the footprint downward (half-res pixels).
    const side = makeCanvas(fw, fh), sg = side.getContext('2d');
    for (let dy = 0; dy <= 7; dy++) sg.drawImage(mask, 0, dy);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = b.rockSide;
    sg.fillRect(0, 0, fw, fh);
    sg.globalCompositeOperation = 'source-atop';
    for (let y = 0; y < fh; y += 2) {
      sg.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.18})`;
      sg.fillRect(0, y, fw, 1);
    }
    ctx.drawImage(side, 0, 0, W, H);
    // Top face, full resolution texture clipped to the mask.
    const top = makeCanvas(W, H), tg = top.getContext('2d');
    tg.fillStyle = tg.createPattern(this._rockTexture(), 'repeat');
    tg.fillRect(0, 0, W, H);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(mask, 0, 0, W, H);
    tg.globalCompositeOperation = 'source-atop';
    const edgeLight = (dx, dy, color, alpha) => {
      const inv = makeCanvas(fw, fh), ig = inv.getContext('2d');
      ig.fillStyle = color; ig.fillRect(0, 0, fw, fh);
      ig.globalCompositeOperation = 'destination-out';
      ig.drawImage(mask, dx, dy);
      tg.globalAlpha = alpha;
      tg.drawImage(this._downsample(inv, 1), 0, 0, W, H);
    };
    edgeLight(-2, -2.5, b.rockRim, 0.5);
    edgeLight(2.5, 3, '#000', 0.4);
    tg.globalAlpha = 1;
    ctx.drawImage(top, 0, 0);
    // Boulders on the plateaus.
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) {
      if (this.tiles[ty * this.w + tx] !== T_ROCK || rng() > 0.16) continue;
      if (this.get(tx, ty + 1) !== T_ROCK || this.get(tx - 1, ty) !== T_ROCK || this.get(tx + 1, ty) !== T_ROCK) continue;
      const x = (tx + rng()) * TILE, y = (ty + rng()) * TILE, r = rng.range(3, 7);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(x + 2, y + 2, r, r * 0.8, 0, 0, TAU); ctx.fill();
      const gr = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r);
      gr.addColorStop(0, b.rockRim); gr.addColorStop(1, b.rockTop[0]);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU); ctx.fill();
    }
  }

  _renderLiquid(ctx) {
    const L = this.biome.liquid;
    const type = L.kind === 'lava' ? T_LAVA : T_WATER;
    if (!this.tiles.includes(type)) return;
    const rng = makeRng(this.seed + 41);
    const W = this.pw, H = this.ph;
    const F = this._field(type), fw = F.fw, fh = F.fh;
    // Wet, darkened shore
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.drawImage(this._downsample(this._maskFrom(F, 0.2, hexToRgb(L.shore)), 2), 0, 0, W, H);
    ctx.restore();
    // Body: shallow edge grading to a blurred deep centre
    const body = this._maskFrom(F, 0, hexToRgb(L.shallow)), g = body.getContext('2d');
    g.globalCompositeOperation = 'source-atop';
    g.drawImage(this._downsample(this._maskFrom(F, -0.3, hexToRgb(L.deep)), 3), 0, 0, fw, fh);
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] !== type) continue;
      const tx = i % this.w, ty = (i / this.w) | 0;
      for (let k = 0; k < 3; k++) {
        const x = (tx + rng()) * TILE / 2, y = (ty + rng()) * TILE / 2;
        if (L.kind === 'lava') {
          g.fillStyle = rng() > 0.45 ? 'rgba(40,10,5,0.55)' : 'rgba(255,220,90,0.4)';
          g.beginPath(); g.ellipse(x, y, rng.range(2, 5), rng.range(1, 3), rng() * TAU, 0, TAU); g.fill();
        } else {
          g.strokeStyle = 'rgba(255,255,255,0.07)';
          g.lineWidth = 0.6;
          g.beginPath(); g.ellipse(x, y, rng.range(2, 5), rng.range(0.5, 1), 0, 0, TAU); g.stroke();
        }
      }
    }
    ctx.drawImage(body, 0, 0, W, H);
    // Foam line along the edge
    ctx.save();
    ctx.globalAlpha = L.kind === 'lava' ? 0.6 : 0.4;
    ctx.drawImage(this._maskFrom(F, 0.03, hexToRgb(L.foam), 0.06), 0, 0, W, H);
    ctx.restore();
  }

  _scatterDetails(ctx, rng) {
    const b = this.biome, kind = this.biomeKey;
    const isGround = (x, y) => this.tileAt(x, y) === T_GROUND;
    const n = Math.floor(this.w * this.h * 0.9);
    const stone = hexToRgb(b.ground[2]);
    for (let i = 0; i < n; i++) {
      const x = rng() * this.pw, y = rng() * this.ph;
      if (!isGround(x, y)) continue;
      const r = rng.range(1, 3.2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(x + 1, y + 1, r, r * 0.75, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = rgbStr(mixRgb(stone, [255, 255, 255], rng() * 0.25));
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, rng() * TAU, 0, TAU); ctx.fill();
    }
    // Craters
    for (let i = 0; i < this.w * this.h / 260; i++) {
      const x = rng() * this.pw, y = rng() * this.ph, r = rng.range(14, 34);
      if (!isGround(x, y) || !isGround(x + r, y) || !isGround(x - r, y)) continue;
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.75, 'rgba(0,0,0,0.12)'); g.addColorStop(0.9, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    // Cracks
    ctx.lineCap = 'round';
    for (let i = 0; i < this.w * this.h / 30; i++) {
      let x = rng() * this.pw, y = rng() * this.ph;
      if (!isGround(x, y)) continue;
      ctx.strokeStyle = kind === 'volcanic' ? 'rgba(255,90,20,0.55)' : kind === 'hive' ? 'rgba(200,90,170,0.35)' : 'rgba(0,0,0,0.22)';
      ctx.lineWidth = rng.range(0.6, 1.6);
      if (kind === 'volcanic' || kind === 'hive') { ctx.shadowColor = kind === 'volcanic' ? '#ff5010' : '#e060c0'; ctx.shadowBlur = 6; }
      ctx.beginPath(); ctx.moveTo(x, y);
      let a = rng() * TAU;
      for (let k = 0; k < rng.int(3, 8); k++) { a += rng.range(-0.8, 0.8); x += Math.cos(a) * 7; y += Math.sin(a) * 7; ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // Biome flourishes
    for (let i = 0; i < this.w * this.h / 5; i++) {
      const x = rng() * this.pw, y = rng() * this.ph;
      if (!isGround(x, y)) continue;
      if (kind === 'jungle') {
        ctx.strokeStyle = rgbStr(mixRgb(hexToRgb(b.ground[3]), [160, 220, 110], rng() * 0.5), 0.8);
        ctx.lineWidth = 1;
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + rng.range(-0.9, 0.9);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); ctx.stroke();
        }
        if (rng() < 0.15) { ctx.fillStyle = 'rgba(120,255,200,0.7)'; ctx.beginPath(); ctx.arc(x + 2, y - 3, 1.2, 0, TAU); ctx.fill(); }
      } else if (kind === 'ice') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
        g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 22, 10, 0, 0, TAU); ctx.fill();
      } else if (kind === 'dust' && rng() < 0.3) {
        ctx.fillStyle = 'rgba(255,220,170,0.12)';
        ctx.beginPath(); ctx.ellipse(x, y, 20, 5, -0.2, 0, TAU); ctx.fill();
      } else if (kind === 'hive' && rng() < 0.25) {
        ctx.strokeStyle = 'rgba(120,40,100,0.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + rng.range(-30, 30), y + rng.range(-30, 30), x + rng.range(-30, 30), y + rng.range(-30, 30), x + rng.range(-40, 40), y + rng.range(-40, 40));
        ctx.stroke();
      } else if (kind === 'volcanic' && rng() < 0.3) {
        ctx.fillStyle = 'rgba(120,110,110,0.12)';
        ctx.beginPath(); ctx.ellipse(x, y, rng.range(8, 20), rng.range(4, 9), rng() * TAU, 0, TAU); ctx.fill();
      }
    }
    // Giant skeletal remains
    for (let i = 0; i < 3; i++) {
      const x = rng() * this.pw, y = rng() * this.ph;
      if (!isGround(x, y) || !isGround(x + 60, y) || !isGround(x - 60, y)) continue;
      this._bones(ctx, x, y, rng);
    }
  }

  _bones(ctx, x, y, rng) {
    const a = rng() * TAU;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? '#e8dcc4' : 'rgba(0,0,0,0.3)';
      ctx.lineWidth = pass ? 3 : 4;
      const off = pass ? 0 : 3;
      ctx.beginPath(); ctx.moveTo(-50 + off, off); ctx.lineTo(50 + off, off); ctx.stroke();
      for (let k = -4; k <= 4; k++) {
        ctx.lineWidth = pass ? 2.2 : 3;
        ctx.beginPath(); ctx.moveTo(k * 10 + off, off);
        ctx.quadraticCurveTo(k * 10 + 10 + off, -22 + off, k * 10 + 4 + off, -30 + Math.abs(k) * 2 + off);
        ctx.moveTo(k * 10 + off, off);
        ctx.quadraticCurveTo(k * 10 + 10 + off, 22 + off, k * 10 + 4 + off, 30 - Math.abs(k) * 2 + off);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#e8dcc4';
    ctx.beginPath(); ctx.ellipse(60, 0, 12, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a2018';
    ctx.beginPath(); ctx.arc(63, -4, 2.5, 0, TAU); ctx.arc(63, 4, 2.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Concrete pad with broken walls; decorative, painted into the terrain.
  paintRuin(x, y, rng, size = 70) {
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.range(-0.2, 0.2));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-size / 2 + 4, -size / 2 + 5, size, size);
    ctx.fillStyle = '#6d7275';
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let k = -size / 2; k <= size / 2; k += 14) {
      ctx.beginPath(); ctx.moveTo(k, -size / 2); ctx.lineTo(k, size / 2); ctx.moveTo(-size / 2, k); ctx.lineTo(size / 2, k); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(230,160,40,0.7)';
    for (let k = -size / 2; k < size / 2; k += 10) ctx.fillRect(k, -size / 2, 5, 3);
    // Walls
    ctx.fillStyle = '#8b9194';
    const seg = (x0, y0, x1, y1) => {
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.min(x0, x1) + 3, Math.min(y0, y1) + 4, Math.abs(x1 - x0) || 5, Math.abs(y1 - y0) || 5); ctx.restore();
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || 5, Math.abs(y1 - y0) || 5);
    };
    const h = size / 2;
    seg(-h, -h, -h + rng.range(10, size), -h);
    seg(-h, -h, -h, -h + rng.range(10, size));
    seg(h - 5, h - rng.range(10, size), h - 5, h);
    // Scorch
    const g = ctx.createRadialGradient(rng.range(-10, 10), rng.range(-10, 10), 0, 0, 0, size * 0.6);
    g.addColorStop(0, 'rgba(10,8,8,0.5)'); g.addColorStop(1, 'rgba(10,8,8,0)');
    ctx.fillStyle = g; ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  }

  _makeFloraSprite(v, rng) {
    const S = 2; // sprite scale
    const W = 72, H = 72;
    const c = makeCanvas(W * S, H * S), g = c.getContext('2d');
    g.scale(S, S);
    g.translate(W / 2, H / 2);
    const b = this.biome, col = b.floraColors;
    const shadow = () => {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath(); g.ellipse(5, 7, 15, 10, 0, 0, TAU); g.fill();
    };
    shadow();
    if (b.flora === 'frond') {
      const n = rng.int(7, 10);
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rng.range(-0.2, 0.2) + layer * 0.3;
          const len = rng.range(18, 27) * (layer ? 0.75 : 1);
          g.save(); g.rotate(a);
          const gr = g.createLinearGradient(0, 0, len, 0);
          gr.addColorStop(0, layer ? col[1] : shade(col[0], -0.3)); gr.addColorStop(1, layer ? shade(col[1], 0.25) : col[0]);
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(0, 0);
          g.quadraticCurveTo(len * 0.5, -9, len, 0);
          g.quadraticCurveTo(len * 0.5, 9, 0, 0);
          g.fill();
          g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.7;
          g.beginPath(); g.moveTo(2, 0); g.lineTo(len - 2, 0); g.stroke();
          g.restore();
        }
      }
      for (let i = 0; i < 5; i++) {
        const x = rng.range(-5, 5), y = rng.range(-5, 5);
        g.fillStyle = col[2];
        g.shadowColor = col[2]; g.shadowBlur = 6;
        g.beginPath(); g.arc(x, y, rng.range(1.5, 2.8), 0, TAU); g.fill();
      }
      g.shadowBlur = 0;
    } else if (b.flora === 'pod') {
      const n = rng.int(3, 6);
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU, d = rng.range(0, 10);
        const x = Math.cos(a) * d, y = Math.sin(a) * d, r = rng.range(7, 12);
        const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.4, 1, x, y, r);
        gr.addColorStop(0, shade(col[1], 0.35)); gr.addColorStop(0.7, col[0]); gr.addColorStop(1, shade(col[0], -0.5));
        g.fillStyle = gr;
        g.beginPath(); g.ellipse(x, y, r, r * 0.85, a, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(40,0,30,0.5)'; g.lineWidth = 0.8;
        for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x, y - r * 0.8); g.quadraticCurveTo(x + rng.range(-r, r), y, x + rng.range(-r / 2, r / 2), y + r * 0.8); g.stroke(); }
        g.fillStyle = col[2]; g.shadowColor = col[2]; g.shadowBlur = 8;
        g.beginPath(); g.arc(x + r * 0.2, y + r * 0.1, r * 0.22, 0, TAU); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.4, r * 0.25, r * 0.15, -0.6, 0, TAU); g.fill();
      }
    } else {
      // Shards: crystal, spire, obsidian
      const n = rng.int(4, 7);
      const shards = [];
      for (let i = 0; i < n; i++) shards.push({ a: rng() * TAU, len: rng.range(12, 26), wd: rng.range(4, 7) });
      shards.sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
      for (const s of shards) {
        g.save(); g.rotate(s.a);
        const L = s.len, Wd = s.wd;
        g.fillStyle = b.flora === 'obsidian' ? col[0] : shade(col[0], -0.25);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.75, -Wd); g.lineTo(L, 0); g.lineTo(0, 0); g.fill();
        g.fillStyle = b.flora === 'obsidian' ? col[1] : col[1];
        g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.75, Wd); g.lineTo(L, 0); g.lineTo(0, 0); g.fill();
        g.strokeStyle = b.flora === 'obsidian' ? col[2] : col[2];
        g.globalAlpha = 0.8; g.lineWidth = 0.8;
        if (b.flora === 'obsidian') { g.shadowColor = col[2]; g.shadowBlur = 6; }
        g.beginPath(); g.moveTo(2, 0); g.lineTo(L, 0); g.stroke();
        g.globalAlpha = 1; g.shadowBlur = 0;
        g.restore();
      }
      const core = g.createRadialGradient(0, 0, 0, 0, 0, 8);
      core.addColorStop(0, col[2]); core.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = core; g.beginPath(); g.arc(0, 0, 8, 0, TAU); g.fill();
      if (b.flora === 'spire') {
        g.fillStyle = 'rgba(255,255,255,0.8)';
        g.beginPath(); g.ellipse(-2, -2, 6, 4, 0.4, 0, TAU); g.fill();
      }
    }
    return { canvas: c, w: W, h: H };
  }
}
