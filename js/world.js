'use strict';
// One mission in progress: map, units, projectiles, objectives and rendering.

const SPACING = 17;

class World {
  constructor(mission, squadData, opts = {}) {
    this.mission = mission;
    this.demo = !!opts.demo;
    this.onMessage = opts.onMessage || (() => {});
    this.map = new GameMap(mission.size[0], mission.size[1], mission.biome, mission.seed, mission.terrain);
    this.map.render();
    this.biome = this.map.biome;
    this.ambient = mission.ambient !== undefined ? mission.ambient : this.biome.ambient;
    this.time = 0;
    this.troopers = []; this.fallen = [];
    this.aliens = []; this.nests = []; this.colonists = [];
    this.bullets = []; this.globs = []; this.throwables = [];
    this.pickups = []; this.barrels = []; this.lights = [];
    this.particles = new Particles(this);
    this.trail = []; this.path = null; this.goal = null; this.pathT = 0;
    this.marker = null;
    this.grenades = mission.grenades || 0;
    this.rockets = mission.rockets || 0;
    this.special = this.grenades > 0 || this.rockets === 0 ? 'grenade' : 'rocket';
    this.throwCd = 0;
    this.stats = { kills: 0, nests: 0, rescued: 0, time: 0, shots: 0 };
    this.shake = 0;
    this.flowT = 0;
    this.phase = this.demo ? 'play' : 'intro';
    this.phaseT = 0;
    this.deployed = this.demo;
    this.result = null;
    this.boss = null;
    this.beacon = null;
    this.tips = {};
    this.populate(squadData);
    this.weather = [];
    for (let i = 0; i < 90; i++) this.weather.push({ x: Math.random(), y: Math.random(), z: Math.random(), p: Math.random() * TAU });
  }

  // ------------------------------------------------------------ setup
  populate(squadData) {
    const M = this.mission, map = this.map;
    const rng = makeRng(map.seed + 777);
    const D = map.distFromStart;
    const cells = [];
    let maxD = 1;
    for (let i = 0; i < D.length; i++) {
      if (D[i] < 0 || map.tiles[i] !== T_GROUND) continue;
      cells.push(i);
      if (D[i] > maxD) maxD = D[i];
    }
    const placed = [];
    const clear = (tx, ty, r) => {
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (map.get(tx + ox, ty + oy) !== T_GROUND) return false;
      return true;
    };
    const pickCell = (minD, sep, clr = 0, maxDist = 1e9) => {
      for (let tries = 0; tries < 600; tries++) {
        const relax = tries > 300 ? 0.5 : 1;
        const i = cells[Math.floor(rng() * cells.length)];
        if (D[i] < Math.min(minD * relax, maxD * 0.8) || D[i] > maxDist) continue;
        const tx = i % map.w, ty = (i / map.w) | 0;
        if (clr && !clear(tx, ty, clr)) continue;
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        if (placed.some((p) => dist2(p.x, p.y, x, y) < (sep * relax) ** 2)) continue;
        return { x, y, tx, ty };
      }
      const i = cells[Math.floor(rng() * cells.length)];
      return { x: (i % map.w + 0.5) * TILE, y: (((i / map.w) | 0) + 0.5) * TILE };
    };

    // Squad at the drop zone
    const s = map.start;
    placed.push({ x: s.x, y: s.y });
    squadData.forEach((d, i) => {
      let x = s.x + ((i % 3) - 1) * 14, y = s.y + Math.floor(i / 3) * 14;
      if (map.circleBlocked(x, y, 7)) { x = s.x; y = s.y; }
      this.troopers.push(new Trooper(d, x, y));
    });
    this.trail = [{ x: s.x, y: s.y + 60 }, { x: s.x, y: s.y + 30 }];

    // Extraction beacon
    if (M.objectives.includes('rescue') || M.objectives.includes('extract')) {
      const c = pickCell(Math.min(12, maxD * 0.3), 200, 1, Math.max(20, maxD * 0.55));
      this.beacon = { x: c.x, y: c.y, r: 46 };
      placed.push(c);
      map.paintRuin(c.x, c.y, rng, 76);
    }
    // Hive nests
    for (let i = 0; i < (M.nests || 0); i++) {
      const c = pickCell(Math.max(14, maxD * 0.35), 340, 1);
      placed.push(c);
      this.nests.push(new Nest(c.x, c.y, M.nest || {}));
    }
    // Colonists in ruined outposts
    const nCol = M.colonists || 0;
    if (nCol) {
      const sites = Math.max(1, Math.ceil(nCol / 3));
      let left = nCol;
      for (let k = 0; k < sites; k++) {
        const c = pickCell(Math.max(16, maxD * 0.5), 300, 1);
        placed.push(c);
        map.paintRuin(c.x, c.y, rng, 80);
        const n = k === sites - 1 ? left : Math.min(3, left);
        left -= n;
        for (let j = 0; j < n; j++) {
          let x = c.x + rng.range(-22, 22), y = c.y + rng.range(-22, 22);
          if (map.circleBlocked(x, y, 7)) { x = c.x; y = c.y; }
          this.colonists.push(new Colonist(x, y));
        }
      }
    }
    // Boss
    if (M.boss) {
      const c = pickCell(maxD * 0.75, 200, 2);
      placed.push(c);
      this.boss = new Alien('mother', c.x, c.y);
      this.aliens.push(this.boss);
    }
    // Alien packs
    for (const [type, count] of Object.entries(M.aliens || {})) {
      let left = count;
      while (left > 0) {
        const n = type === 'brute' ? 1 : Math.min(left, rng.int(2, type === 'spitter' ? 3 : 5));
        left -= n;
        const c = pickCell(Math.max(10, maxD * 0.22), 90);
        placed.push({ x: c.x, y: c.y });
        for (let j = 0; j < n; j++) {
          let x = c.x + rng.range(-26, 26), y = c.y + rng.range(-26, 26);
          if (map.circleBlocked(x, y, 9)) { x = c.x; y = c.y; }
          this.aliens.push(new Alien(type, x, y));
        }
      }
    }
    // Crates
    for (const [kind, count] of Object.entries(M.crates || {})) {
      for (let i = 0; i < count; i++) {
        const c = pickCell(8, 120);
        this.pickups.push({ kind, x: c.x, y: c.y });
      }
    }
    // Fuel canisters near outposts
    for (let i = 0; i < (M.barrels || 0); i++) {
      const c = pickCell(8, 60);
      const n = rng.int(2, 3);
      for (let j = 0; j < n; j++) {
        const x = c.x + rng.range(-16, 16), y = c.y + rng.range(-16, 16);
        if (!map.circleBlocked(x, y, 9)) this.barrels.push({ x, y, r: 8, hp: 16, hitT: 0, alive: true });
      }
    }
    // Decorative ruins
    for (let i = 0; i < 2; i++) { const c = pickCell(8, 200, 1); map.paintRuin(c.x, c.y, rng, rng.range(50, 80)); }

    this.objectives = M.objectives.map((type) => ({ type, done: false }));
    this.rescueNeed = M.rescueNeed || nCol;
    this.initialAliens = this.aliens.length;
    this.initialNests = this.nests.length;
    this.updateLeader();
  }

  get leader() { return this.troopers[0] || null; }

  updateLeader() {
    this.troopers.forEach((t, i) => (t.leader = i === 0));
  }

  msg(text, kind = 'info') { if (!this.demo) this.onMessage(text, kind); }

  sound(name, x, y, vol = 1, extra) {
    if (this.demo) return;
    const cam = this.cam;
    let pan = 0, v = vol;
    if (cam) {
      const dx = x - cam.x, dy = y - cam.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      pan = clamp(dx / 500, -0.8, 0.8);
      v = vol * clamp(1.15 - d / 900, 0, 1);
      if (v <= 0.02) return;
    }
    Sfx[name](pan, v, extra);
  }

  // ------------------------------------------------------------ helpers
  moveEntity(e, dx, dy, r) {
    const m = this.map;
    r = r ?? e.r;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5));
    const sx = dx / steps, sy = dy / steps;
    let moved = false;
    for (let i = 0; i < steps; i++) {
      if (!m.circleBlocked(e.x + sx, e.y, r)) { e.x += sx; moved = true; }
      if (!m.circleBlocked(e.x, e.y + sy, r)) { e.y += sy; moved = true; }
    }
    return moved;
  }

  targets() {
    const out = this.troopers.slice();
    for (const c of this.colonists) if (c.state === 'following' || c.state === 'boarding') out.push(c);
    return out;
  }

  nearestTarget(x, y, range, needLos) {
    if (!this.deployed) return null;
    let best = null, bd = range * range;
    for (const t of this.troopers) {
      const d = dist2(x, y, t.x, t.y);
      if (d < bd && (!needLos || this.map.lineClear(x, y, t.x, t.y))) { bd = d; best = t; }
    }
    for (const c of this.colonists) {
      if (c.state !== 'following' && c.state !== 'boarding') continue;
      const d = dist2(x, y, c.x, c.y);
      if (d < bd && (!needLos || this.map.lineClear(x, y, c.x, c.y))) { bd = d; best = c; }
    }
    return best;
  }

  spawnAlien(type, x, y, hunting) {
    if (this.map.circleBlocked(x, y, ALIEN_TYPES[type].colR)) {
      const w = this.map.nearestWalkable(Math.floor(x / TILE), Math.floor(y / TILE), 2);
      if (!w) return null;
      x = (w.tx + 0.5) * TILE; y = (w.ty + 0.5) * TILE;
    }
    const a = new Alien(type, x, y);
    if (hunting) { a.state = 'hunt'; a.thinkT = 0; }
    this.aliens.push(a);
    for (let i = 0; i < 8; i++) {
      this.particles.add({ kind: 'chunk', x, y, z: 2, vz: rand(80, 200), vx: rand(-60, 60), vy: rand(-60, 60), size: rand(1, 2.2), color: this.biome.ground[2], life: 1.5, g: 500 });
    }
    return a;
  }

  // ------------------------------------------------------------ update
  update(dt, ctl) {
    this.time += dt;
    this.phaseT += dt;
    if (!this.demo && this.phase !== 'intro') this.stats.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.throwCd -= dt;
    this.lights.length = 0;

    if (this.phase === 'intro' && this.phaseT > 1.45 && !this.deployed) {
      this.deployed = true;
      for (const t of this.troopers) {
        for (let i = 0; i < 6; i++) this.particles.add({ kind: 'smoke', x: t.x + rand(-6, 6), y: t.y + rand(-6, 6), vx: rand(-40, 40), vy: rand(-40, 40), drag: 3, size: rand(8, 14), grow: 12, color: '#c8b8a0', alpha: 0.5, life: 0.8 });
      }
    }
    if (this.phase === 'intro' && this.phaseT > 2.6) { this.phase = 'play'; this.phaseT = 0; this.msg(this.mission.name + ': go, go, go!', 'good'); }

    if (this.phase === 'play' && ctl && !this.demo) this.handleControls(dt, ctl);

    this.flowT -= dt;
    if (this.flowT <= 0 && this.deployed) {
      this.flowT = 0.35;
      this.map.computeFlow(this.targets().map((t) => [Math.floor(t.x / TILE), Math.floor(t.y / TILE)]));
    }

    if (this.deployed && this.phase !== 'outro-done') this.updateSquad(dt, ctl);
    for (const a of this.aliens) a.update(dt, this);
    this.separateAliens();
    for (const n of this.nests) n.update(dt, this);
    this.updateBullets(dt);
    this.updateGlobs(dt);
    this.updateThrowables(dt);
    this.updateBarrels(dt);
    this.updatePickups();
    this.particles.update(dt);
    if (!this.demo) this.checkObjectives(dt);
  }

  handleControls(dt, ctl) {
    const L = this.leader;
    if (!L) return;
    if (ctl.move) {
      const changed = !this.goal || dist2(this.goal.x, this.goal.y, ctl.move.x, ctl.move.y) > 16 * 16;
      this.pathT -= dt;
      if ((ctl.moveNew || (changed && this.pathT <= 0))) {
        this.pathT = 0.12;
        const p = this.map.findPath(L.x, L.y, ctl.move.x, ctl.move.y);
        if (p) { this.path = p; this.goal = { x: ctl.move.x, y: ctl.move.y }; this.marker = { x: p[p.length - 1].x, y: p[p.length - 1].y, t: 0 }; }
      }
    }
    if (ctl.switchSpecial) {
      this.special = this.special === 'grenade' ? 'rocket' : 'grenade';
      Sfx.click();
    }
    if (ctl.selectSpecial) this.special = ctl.selectSpecial;
    if (ctl.throw && this.throwCd <= 0) {
      if (this.special === 'grenade' && this.grenades <= 0 && this.rockets > 0) this.special = 'rocket';
      else if (this.special === 'rocket' && this.rockets <= 0 && this.grenades > 0) this.special = 'grenade';
      if (this.special === 'grenade' && this.grenades > 0) { this.throwGrenade(L, ctl.aimX, ctl.aimY); this.grenades--; this.throwCd = 0.55; }
      else if (this.special === 'rocket' && this.rockets > 0) { this.fireRocket(L, ctl.aimX, ctl.aimY); this.rockets--; this.throwCd = 0.7; }
      else if (!this.tips.noAmmo) { this.tips.noAmmo = 1; this.msg('Out of explosives. Look for supply crates.', 'warn'); }
    }
  }

  updateSquad(dt, ctl) {
    const L = this.leader;
    const firing = ctl && ctl.fire && this.phase === 'play' && !this.demo;
    if (L) {
      // Leader follows path
      let moving = false;
      if (this.path && this.path.length && this.phase === 'play') {
        const wp = this.path[0];
        const d = dist(L.x, L.y, wp.x, wp.y);
        const sp = L.speed * (L.inWater ? 0.5 : 1) * dt;
        if (d < 3) this.path.shift();
        else {
          const f = Math.min(1, sp / d);
          const ox = L.x, oy = L.y;
          this.moveEntity(L, (wp.x - L.x) * f, (wp.y - L.y) * f);
          moving = dist2(ox, oy, L.x, L.y) > 0.01;
          if (!moving) this.path.shift();
          else if (!firing) L.face = turnToward(L.face, Math.atan2(wp.y - L.y, wp.x - L.x), 12 * dt);
          if (d <= sp) this.path.shift();
        }
        if (!this.path.length) this.path = null;
      }
      this.stepAnim(L, moving, dt);
      const last = this.trail[this.trail.length - 1];
      if (!last || dist2(last.x, last.y, L.x, L.y) > 25) {
        this.trail.push({ x: L.x, y: L.y });
        if (this.trail.length > 500) this.trail.splice(0, 100);
      }
    }
    // Followers: remaining troopers, then rescued colonists
    const followers = this.troopers.slice(1);
    for (const c of this.colonists) if (c.state === 'following') followers.push(c);
    followers.forEach((f, i) => {
      const tp = this.trailPoint((i + 1) * SPACING);
      const d = dist(f.x, f.y, tp.x, tp.y);
      let moving = false;
      if (d > 2.5) {
        const base = (f.speed || 95) * (f.inWater ? 0.5 : 1);
        const sp = base * (d > 60 ? 1.6 : d > 25 ? 1.2 : 1) * dt;
        const k = Math.min(1, sp / d);
        const ox = f.x, oy = f.y;
        this.moveEntity(f, (tp.x - f.x) * k, (tp.y - f.y) * k);
        moving = dist2(ox, oy, f.x, f.y) > 0.01;
        if (moving && !(firing && f instanceof Trooper)) f.face = turnToward(f.face, Math.atan2(tp.y - f.y, tp.x - f.x), 10 * dt);
      }
      this.stepAnim(f, moving && d > 2.5, dt);
    });
    // Keep the squad from stacking
    const sq = this.troopers.concat(followers.filter((f) => !(f instanceof Trooper)));
    for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
      const a = sq[i], b = sq[j];
      const d2 = dist2(a.x, a.y, b.x, b.y);
      if (d2 < 121 && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (11 - d) * 0.5;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        if (i > 0) this.moveEntity(a, -nx * push, -ny * push);
        this.moveEntity(b, nx * push, ny * push);
      }
    }
    // Troopers: environment, hit timers, shooting
    for (const t of this.troopers) {
      t.hitT = Math.max(0, t.hitT - dt);
      t.recoil = Math.max(0, t.recoil - dt * 20);
      const tile = this.map.tileAt(t.x, t.y);
      t.inWater = tile === T_WATER;
      if (t.inWater && this.biome.liquid.damage) {
        t.acidT -= dt;
        if (t.acidT <= 0) { t.acidT = 0.5; this.damageFriendly(t, this.biome.liquid.damage * 0.5, t.x, t.y, 0, true); }
      }
      t.fireCd -= dt;
      if (firing) {
        const a = Math.atan2(ctl.aimY - t.y, ctl.aimX - t.x);
        t.face = turnToward(t.face, a, 16 * dt);
        if (t.fireCd <= 0 && !t.inWater && Math.abs(angDiff(t.face, a)) < 0.5) this.fireBullet(t, ctl.aimX, ctl.aimY);
      }
      // Nests are solid to troopers
      for (const n of this.nests) {
        const d = dist(t.x, t.y, n.x, n.y), m = n.r + t.r - 4;
        if (d < m && d > 0.01) this.moveEntity(t, (t.x - n.x) / d * (m - d), (t.y - n.y) / d * (m - d));
      }
      if (this.deployed) {
        this.lights.push({ x: t.x, y: t.y, r: 95, c: '#ffe6c0', i: 0.7 });
        this.lights.push({ x: t.x + Math.cos(t.face) * 60, y: t.y + Math.sin(t.face) * 60, r: 75, c: '#e8f4ff', i: 0.55 });
      }
    }
    // Colonists
    for (const c of this.colonists) {
      c.hitT = Math.max(0, c.hitT - dt);
      if (c.state === 'waiting') {
        c.face += Math.sin(this.time + c.x) * dt;
        if (this.troopers.some((t) => dist2(t.x, t.y, c.x, c.y) < 38 * 38)) {
          c.state = 'following';
          this.msg('Colonist found. Escort them to the extraction beacon.', 'good');
          Sfx.pickup();
        }
      } else if (c.state === 'following' && this.beacon && this.troopers.some((t) => dist2(t.x, t.y, this.beacon.x, this.beacon.y) < this.beacon.r * this.beacon.r)) {
        c.state = 'boarding';
      } else if (c.state === 'boarding') {
        const d = dist(c.x, c.y, this.beacon.x, this.beacon.y);
        const k = Math.min(1, (110 * dt) / Math.max(d, 0.01));
        const ox = c.x, oy = c.y;
        this.moveEntity(c, (this.beacon.x - c.x) * k, (this.beacon.y - c.y) * k);
        c.face = Math.atan2(this.beacon.y - c.y, this.beacon.x - c.x);
        this.stepAnim(c, dist2(ox, oy, c.x, c.y) > 0.01, dt);
        if (d > 12 && dist2(ox, oy, c.x, c.y) < 0.0001) { c.x = lerp(c.x, this.beacon.x, 0.02); c.y = lerp(c.y, this.beacon.y, 0.02); }
      }
      if ((c.state === 'following' || c.state === 'boarding') && this.beacon && dist2(c.x, c.y, this.beacon.x, this.beacon.y) < (this.beacon.r * 0.6) ** 2) {
        c.state = 'rescued';
        this.stats.rescued++;
        this.msg(`Colonist rescued (${this.stats.rescued}/${this.rescueNeed})`, 'good');
        Sfx.fanfare();
        for (let i = 0; i < 20; i++) this.particles.add({ kind: 'glow', add: true, x: c.x + rand(-8, 8), y: c.y, vy: rand(-120, -40), size: rand(3, 6), color: '#7fffd0', life: rand(0.5, 1) });
      }
    }
  }

  stepAnim(e, moving, dt) {
    e.moving = moving;
    if (!moving) return;
    e.walk += dt * 13;
    e.stepAcc = (e.stepAcc || 0) + dt;
    if (e.stepAcc > 0.16) {
      e.stepAcc = 0;
      e.stepSide = -(e.stepSide || 1);
      Decals.footprint(this, e.x, e.y, e.face, e.stepSide);
      if (e.inWater) this.particles.add({ kind: 'ring', x: e.x, y: e.y, size: 3, size2: 12, color: this.biome.liquid.foam, alpha: 0.5, life: 0.6 });
    }
  }

  trailPoint(dd) {
    const L = this.leader;
    let px = L.x, py = L.y, rem = dd;
    for (let k = this.trail.length - 1; k >= 0; k--) {
      const q = this.trail[k];
      const seg = dist(px, py, q.x, q.y);
      if (seg >= rem) { const t = rem / seg; return { x: px + (q.x - px) * t, y: py + (q.y - py) * t }; }
      rem -= seg; px = q.x; py = q.y;
    }
    return { x: px, y: py };
  }

  // ------------------------------------------------------------ weapons
  fireBullet(t, ax, ay) {
    const a = Math.atan2(ay - t.y, ax - t.x) + gauss() * t.spread;
    const mx = t.x + Math.cos(a) * 17, my = t.y + Math.sin(a) * 17;
    const sp = 950;
    this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: t.range / sp, dmg: 12, src: t, px: mx, py: my });
    t.fireCd = t.fireRate * rand(0.85, 1.2);
    t.recoil = 2.5;
    this.stats.shots++;
    this.lights.push({ x: mx, y: my, r: 70, c: '#ffd890', i: 0.9 });
    this.particles.add({ kind: 'glow', add: true, x: mx, y: my, size: rand(6, 9), color: '#ffcf70', life: 0.05 });
    this.particles.add({ kind: 'casing', x: t.x, y: t.y, z: 8, vz: rand(90, 150), vx: Math.cos(a + 1.6) * rand(40, 80), vy: Math.sin(a + 1.6) * rand(40, 80), vr: rand(-20, 20), size: 1.3, color: '#d8a848', life: 1.5, bounce: 0.3, onLand: (p) => { if (Math.random() < 0.3) Decals.casing(this, p.x, p.y); }, dieOnLand: false });
    this.sound('shot', t.x, t.y, 0.9);
  }

  throwGrenade(t, ax, ay) {
    let dx = ax - t.x, dy = ay - t.y;
    const d = Math.hypot(dx, dy), maxR = 250;
    if (d > maxR) { dx *= maxR / d; dy *= maxR / d; }
    const T = 0.75;
    this.throwables.push({ kind: 'grenade', x: t.x, y: t.y, z: 10, vx: dx / T, vy: dy / T, vz: 300 * T / 2 - 10 / T, fuse: 1.3, rot: 0, src: t });
    this.sound('whoosh', t.x, t.y, 1);
  }

  fireRocket(t, ax, ay) {
    const a = Math.atan2(ay - t.y, ax - t.x);
    const d = Math.min(520, Math.max(40, dist(t.x, t.y, ax, ay)));
    this.throwables.push({ kind: 'rocket', x: t.x + Math.cos(a) * 14, y: t.y + Math.sin(a) * 14, vx: Math.cos(a) * 470, vy: Math.sin(a) * 470, a, travel: 0, maxD: d, src: t });
    this.sound('rocket', t.x, t.y, 1);
    for (let i = 0; i < 8; i++) this.particles.add({ kind: 'smoke', x: t.x - Math.cos(a) * 10, y: t.y - Math.sin(a) * 10, vx: -Math.cos(a) * rand(40, 120) + rand(-30, 30), vy: -Math.sin(a) * rand(40, 120) + rand(-30, 30), drag: 3, size: rand(6, 10), grow: 14, color: '#bbbbbb', alpha: 0.5, life: 0.9 });
  }

  spit(src, tg, dmg = 26) {
    const lead = 0.5;
    const tx = tg.x + (tg.vx || 0) * lead + rand(-14, 14), ty = tg.y + (tg.vy || 0) * lead + rand(-14, 14);
    const d = dist(src.x, src.y, tx, ty);
    const T = clamp(d / 240, 0.45, 1.3);
    const ox = src.x + Math.cos(src.face) * src.r, oy = src.y + Math.sin(src.face) * src.r;
    this.globs.push({ x: ox, y: oy, z: 6, vx: (tx - ox) / T, vy: (ty - oy) / T, vz: 500 * T / 2, dmg, t: 0 });
    this.sound('spit', src.x, src.y, 0.9);
  }

  updateBullets(dt) {
    const B = this.bullets;
    let j = 0;
    for (const b of B) {
      b.life -= dt;
      if (b.life <= 0) continue;
      b.px = b.x; b.py = b.y;
      const steps = Math.ceil((Math.abs(b.vx) + Math.abs(b.vy)) * dt / 9);
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
        const tile = this.map.tileAt(b.x, b.y);
        if (tile === T_ROCK || tile === T_FLORA) {
          this.impact(b.x, b.y, tile === T_FLORA ? this.biome.floraColors[1] : '#ffd9a0', b.vx, b.vy);
          dead = true; break;
        }
        for (const a of this.aliens) {
          const rr = a.r + 2;
          if (dist2(a.x, a.y, b.x, b.y) < rr * rr) {
            this.damageAlien(a, b.dmg, b.src, Math.atan2(b.vy, b.vx), 40);
            dead = true; break;
          }
        }
        if (dead) break;
        for (const n of this.nests) {
          if (dist2(n.x, n.y, b.x, b.y) < n.r * n.r) {
            this.impact(b.x, b.y, '#ffe0a0', b.vx, b.vy);
            this.sound('ping', b.x, b.y, 0.6);
            if (!this.tips.nest) { this.tips.nest = 1; this.msg('Nest hide is too thick for rifles. Use grenades or rockets.', 'warn'); }
            dead = true; break;
          }
        }
        if (dead) break;
        for (const br of this.barrels) {
          if (br.alive && dist2(br.x, br.y, b.x, b.y) < br.r * br.r) {
            br.hp -= b.dmg; br.hitT = 0.08;
            this.impact(b.x, b.y, '#ffd0a0', b.vx, b.vy);
            dead = true; break;
          }
        }
      }
      if (!dead) B[j++] = b;
    }
    B.length = j;
  }

  impact(x, y, color, vx, vy) {
    const a = Math.atan2(-vy, -vx);
    for (let i = 0; i < 4; i++) {
      const aa = a + rand(-0.9, 0.9), sp = rand(80, 220);
      this.particles.add({ kind: 'spark', add: true, x, y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, drag: 6, color, life: rand(0.1, 0.25) });
    }
    this.particles.add({ kind: 'smoke', x, y, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, size: 5, grow: 10, color: '#a09080', alpha: 0.35, life: 0.4 });
  }

  updateGlobs(dt) {
    const G = this.globs;
    let j = 0;
    for (const g of G) {
      g.t += dt;
      g.x += g.vx * dt; g.y += g.vy * dt;
      g.vz -= 500 * dt; g.z += g.vz * dt;
      if (Math.random() < 0.5) this.particles.add({ kind: 'glow', add: true, x: g.x, y: g.y, z: g.z, vz: 0, g: 0, size: 5, color: '#8dff6a', life: 0.25, alpha: 0.6 });
      this.lights.push({ x: g.x, y: g.y, r: 40, c: '#8dff6a', i: 0.5 });
      if (g.z <= 0) {
        const R = 24;
        for (const t of this.targets()) {
          const d = dist(t.x, t.y, g.x, g.y);
          if (d < R + t.r) this.damageFriendly(t, g.dmg * (1 - d / (R + t.r) * 0.5), g.x, g.y, 40);
        }
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * TAU, sp = rand(30, 120);
          this.particles.add({ kind: 'drop', x: g.x, y: g.y, z: 2, vz: rand(60, 160), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: rand(1, 2), color: '#9dff5a', life: 1, onLand: (p) => Decals.drop(this, p.x, p.y, 'rgba(120,200,40,0.6)', p.size) });
        }
        this.particles.add({ kind: 'glow', add: true, x: g.x, y: g.y, size: 26, color: '#7dff4a', life: 0.35 });
        Decals.splat(this, g.x, g.y, 'rgba(110,190,40,0.45)', 9, 6);
        this.sound('squish', g.x, g.y, 0.7);
        continue;
      }
      G[j++] = g;
    }
    G.length = j;
  }

  updateThrowables(dt) {
    const L = this.throwables;
    let j = 0;
    for (const p of L) {
      let boom = false;
      if (p.kind === 'grenade') {
        p.fuse -= dt;
        p.rot += dt * 12;
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
        if (p.z < 14 && this.map.blocksShotAt(nx, p.y)) p.vx *= -0.45; else p.x = nx;
        if (p.z < 14 && this.map.blocksShotAt(p.x, ny)) p.vy *= -0.45; else p.y = ny;
        p.vz -= 300 * dt; p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (Math.abs(p.vz) > 30) { p.vz = -p.vz * 0.3; p.vx *= 0.3; p.vy *= 0.3; }
          else { p.vz = 0; p.vx *= Math.max(0, 1 - 9 * dt); p.vy *= Math.max(0, 1 - 9 * dt); }
        }
        if (p.fuse <= 0) boom = true;
        if (Math.random() < 0.3) this.lights.push({ x: p.x, y: p.y, r: 25, c: '#ff4040', i: 0.8 });
      } else {
        const sx = p.vx * dt, sy = p.vy * dt;
        const steps = 3;
        for (let s = 0; s < steps && !boom; s++) {
          p.x += sx / steps; p.y += sy / steps;
          p.travel += Math.hypot(sx, sy) / steps;
          if (p.travel >= p.maxD || this.map.blocksShotAt(p.x, p.y)) boom = true;
          for (const a of this.aliens) if (dist2(a.x, a.y, p.x, p.y) < (a.r + 3) ** 2) boom = true;
          for (const n of this.nests) if (dist2(n.x, n.y, p.x, p.y) < n.r * n.r) boom = true;
          for (const b of this.barrels) if (b.alive && dist2(b.x, b.y, p.x, p.y) < b.r * b.r) boom = true;
        }
        this.particles.add({ kind: 'smoke', x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-15, 15), drag: 2, size: rand(4, 7), grow: 16, color: '#c8c8c8', alpha: 0.55, life: rand(0.6, 1.1) });
        this.particles.add({ kind: 'glow', add: true, x: p.x - Math.cos(p.a) * 6, y: p.y - Math.sin(p.a) * 6, size: rand(6, 9), color: '#ffb040', life: 0.08 });
        this.lights.push({ x: p.x, y: p.y, r: 70, c: '#ffb050', i: 0.9 });
      }
      if (boom) {
        if (p.kind === 'grenade') this.explode(p.x, p.y, 62, 170, p.src);
        else this.explode(p.x, p.y, 58, 190, p.src);
        continue;
      }
      L[j++] = p;
    }
    L.length = j;
  }

  updateBarrels(dt) {
    for (const b of this.barrels) {
      if (!b.alive) continue;
      b.hitT = Math.max(0, b.hitT - dt);
      if (b.fuse !== undefined) { b.fuse -= dt; if (b.fuse <= 0) b.hp = 0; }
      if (b.hp <= 0) {
        b.alive = false;
        this.explode(b.x, b.y, 72, 150, null);
      }
    }
    this.barrels = this.barrels.filter((b) => b.alive);
  }

  updatePickups() {
    for (const p of this.pickups) {
      if (p.taken) continue;
      const t = this.troopers.find((t) => dist2(t.x, t.y, p.x, p.y) < 20 * 20);
      if (!t) continue;
      p.taken = true;
      Sfx.pickup();
      if (p.kind === 'grenades') { this.grenades += 4; this.msg('+4 grenades', 'good'); }
      else if (p.kind === 'rockets') { this.rockets += 3; this.msg('+3 rockets', 'good'); }
      else { for (const s of this.troopers) s.hp = Math.min(s.maxHp, s.hp + 60); this.msg('Squad patched up', 'good'); }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  explode(x, y, R, dmg, src) {
    this.sound('boom', x, y, 1, R / 60);
    this.shake = Math.min(14, this.shake + R / 7);
    this.lights.push({ x, y, r: R * 4, c: '#ffb060', i: 1 });
    this.flash = { x, y, r: R * 4, t: 0.3 };
    // Damage
    for (const a of this.aliens) {
      const d = dist(a.x, a.y, x, y), rr = R + a.r;
      if (d < rr) this.damageAlien(a, dmg * (1 - (d / rr) * 0.6), src, Math.atan2(a.y - y, a.x - x), 380 / a.T.mass, true);
    }
    for (const n of this.nests) {
      const d = dist(n.x, n.y, x, y);
      if (d < R + n.r) { n.hp -= dmg * (1 - (d / (R + n.r)) * 0.4); n.hitT = 0.2; if (n.hp <= 0) this.destroyNest(n, src); }
    }
    for (const t of this.targets()) {
      const d = dist(t.x, t.y, x, y), rr = R * 0.85 + t.r;
      if (d < rr) this.damageFriendly(t, dmg * 0.9 * (1 - (d / rr) * 0.7), x, y, 300);
    }
    for (const b of this.barrels) {
      if (b.alive && b.fuse === undefined && dist2(b.x, b.y, x, y) < (R + b.r) ** 2) b.fuse = rand(0.08, 0.2);
    }
    // Flora burns
    const fr = R * 0.75;
    for (let ty = Math.floor((y - fr) / TILE); ty <= Math.floor((y + fr) / TILE); ty++) {
      for (let tx = Math.floor((x - fr) / TILE); tx <= Math.floor((x + fr) / TILE); tx++) {
        const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
        if (dist2(cx, cy, x, y) > (fr + 10) ** 2) continue;
        if (this.map.destroyFlora(tx, ty)) {
          Decals.scorch(this, cx, cy, 20);
          for (let i = 0; i < 10; i++) this.particles.add({ kind: 'chunk', x: cx, y: cy, z: 6, vz: rand(100, 300), vx: rand(-120, 120), vy: rand(-120, 120), vr: rand(-10, 10), size: rand(1.5, 3), color: pick(this.biome.floraColors), life: 2, g: 600, bounce: 0.3 });
          for (let i = 0; i < 4; i++) this.particles.add({ kind: 'glow', add: true, x: cx + rand(-8, 8), y: cy + rand(-8, 8), vy: rand(-30, -10), size: rand(6, 10), color: '#ff8030', life: rand(0.8, 1.6), alpha: 0.7 });
        }
      }
    }
    // Visuals
    Decals.scorch(this, x, y, R * 0.8);
    this.particles.add({ kind: 'glow', add: true, x, y, size: R * 1.6, color: '#fff2c0', life: 0.12, hard: 0.3 });
    this.particles.add({ kind: 'ring', x, y, size: R * 0.3, size2: R * 1.5, color: '#ffe8c8', life: 0.35, alpha: 0.7 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, sp = rand(20, 110);
      this.particles.add({ kind: 'glow', add: true, x: x + rand(-8, 8), y: y + rand(-8, 8), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, drag: 3, size: rand(10, 20), grow: 10, color: pick(['#ff9a30', '#ffcf60', '#ff6a20']), life: rand(0.3, 0.6) });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, sp = rand(10, 70);
      this.particles.add({ kind: 'smoke', x: x + rand(-10, 10), y: y + rand(-10, 10), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, drag: 1.5, size: rand(12, 20), grow: 22, color: pick(['#3a3430', '#524a44', '#2a2624']), alpha: 0.75, life: rand(1.2, 2.4) });
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * TAU, sp = rand(150, 420);
      this.particles.add({ kind: 'spark', add: true, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3, color: '#ffd080', size: 1.4, life: rand(0.2, 0.6) });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, sp = rand(60, 200);
      this.particles.add({ kind: 'chunk', x, y, z: 4, vz: rand(150, 350), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vr: rand(-15, 15), size: rand(1.2, 2.6), color: this.biome.ground[2], life: 2.5, g: 700, bounce: 0.3 });
    }
  }

  damageAlien(a, dmg, src, ang, kb, explosive) {
    if (a.hp <= 0) return;
    a.hp -= dmg;
    a.hitT = 0.1;
    if (kb) { a.kbx += Math.cos(ang) * kb / a.T.mass; a.kby += Math.sin(ang) * kb / a.T.mass; }
    for (let i = 0; i < (explosive ? 6 : 3); i++) {
      const aa = ang + rand(-0.8, 0.8), sp = rand(40, 160);
      this.particles.add({ kind: 'drop', x: a.x, y: a.y, z: 4, vz: rand(40, 140), vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, size: rand(0.8, 1.8), color: a.T.ichor, life: 1, onLand: (p) => Decals.drop(this, p.x, p.y, a.T.ichor, p.size * 1.2) });
    }
    if (a.state !== 'hunt') a.alert(this);
    if (a.hp <= 0) this.killAlien(a, src, ang);
  }

  killAlien(a, src, ang) {
    this.aliens = this.aliens.filter((o) => o !== a);
    if (a.nest) a.nest.children--;
    if (!this.demo) this.stats.kills++;
    if (src && src.alive) src.kills++;
    Decals.splat(this, a.x, a.y, a.T.ichor, a.r * 0.8, 9);
    Decals.corpse(this, ALIEN_DRAW[a.type], { ...a, face: a.face + rand(-0.3, 0.3) });
    for (let i = 0; i < 6 + a.r; i++) {
      const aa = Math.random() * TAU, sp = rand(40, 200);
      this.particles.add({ kind: 'drop', x: a.x, y: a.y, z: 4, vz: rand(60, 220), vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, size: rand(1, 2.4), color: a.T.ichor, life: 1.2, onLand: (p) => Decals.drop(this, p.x, p.y, a.T.ichor, p.size * 1.3) });
    }
    for (let i = 0; i < 5; i++) {
      const aa = ang + rand(-1, 1), sp = rand(60, 180);
      this.particles.add({ kind: 'chunk', x: a.x, y: a.y, z: 4, vz: rand(100, 250), vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, vr: rand(-12, 12), size: rand(1.2, 2.5), color: PAL[a.type].mid, life: 3, g: 600, bounce: 0.25 });
    }
    this.sound('squish', a.x, a.y, 1);
    if (a.type === 'mother') {
      this.msg('The brood mother is dead!', 'good');
      for (let i = 0; i < 5; i++) setTimeout(() => this.explode(a.x + rand(-40, 40), a.y + rand(-40, 40), 40, 0, null), i * 180);
    }
  }

  destroyNest(n, src) {
    if (!n.alive) return;
    n.alive = false;
    this.nests = this.nests.filter((o) => o !== n);
    this.stats.nests++;
    if (src && src.alive) src.kills += 3;
    Decals.splat(this, n.x, n.y, '#3a1030', 26, 14);
    Decals.scorch(this, n.x, n.y, 48);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU, sp = rand(60, 260);
      this.particles.add({ kind: 'chunk', x: n.x, y: n.y, z: 6, vz: rand(150, 380), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vr: rand(-10, 10), size: rand(1.5, 3.5), color: pick(['#6a3a58', '#2a1024', '#c090a8']), life: 3, g: 600, bounce: 0.3 });
      this.particles.add({ kind: 'drop', x: n.x, y: n.y, z: 6, vz: rand(100, 300), vx: Math.cos(a) * sp * 0.7, vy: Math.sin(a) * sp * 0.7, size: rand(1.2, 2.5), color: '#ffc050', life: 1.5, onLand: (p) => Decals.drop(this, p.x, p.y, 'rgba(230,170,60,0.7)', p.size) });
    }
    this.msg(`Hive nest destroyed (${this.initialNests - this.nests.length}/${this.initialNests})`, 'good');
    this.sound('screech', n.x, n.y, 1, 0.45);
  }

  damageFriendly(t, dmg, fx, fy, kb = 0, silent = false) {
    if (!t.alive || this.phase === 'outro') return;
    t.hp -= dmg;
    t.hitT = 0.15;
    if (kb) {
      const a = Math.atan2(t.y - fy, t.x - fx);
      this.moveEntity(t, Math.cos(a) * kb * 0.04, Math.sin(a) * kb * 0.04);
    }
    if (!silent) this.sound('hurt', t.x, t.y, 0.8);
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * TAU, sp = rand(30, 110);
      this.particles.add({ kind: 'drop', x: t.x, y: t.y, z: 5, vz: rand(40, 120), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: rand(0.8, 1.6), color: '#b3141a', life: 1, onLand: (p) => Decals.drop(this, p.x, p.y, '#7a0c10', p.size) });
    }
    if (t.hp <= 0) {
      t.alive = false;
      Decals.splat(this, t.x, t.y, '#6e0a0e', 7, 8);
      this.sound('die', t.x, t.y, 1);
      if (t instanceof Trooper) {
        Decals.corpse(this, drawTrooper, { ...t, leader: false, moving: false, inWater: false });
        this.troopers = this.troopers.filter((o) => o !== t);
        this.fallen.push(t);
        this.msg(`${RANKS[t.data.rank].short} ${t.data.name} is down!`, 'bad');
        this.updateLeader();
        if (t.leader === false && this.leader && this.goal) this.path = this.map.findPath(this.leader.x, this.leader.y, this.goal.x, this.goal.y);
      } else {
        this.msg('A colonist has been killed.', 'bad');
      }
    }
  }

  separateAliens() {
    const A = this.aliens;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      for (let j = i + 1; j < A.length; j++) {
        const b = A[j];
        const m = (a.T.colR + b.T.colR) * 0.9;
        const d2 = dist2(a.x, a.y, b.x, b.y);
        if (d2 < m * m && d2 > 0.0001) {
          const d = Math.sqrt(d2), push = (m - d) * 0.5;
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          const wa = b.T.mass / (a.T.mass + b.T.mass), wb = 1 - wa;
          this.moveEntity(a, -nx * push * wa * 2, -ny * push * wa * 2, a.T.colR);
          this.moveEntity(b, nx * push * wb * 2, ny * push * wb * 2, b.T.colR);
        }
      }
      // Keep aliens out of the squad's personal space
      for (const t of this.troopers) {
        const m = a.T.colR + t.r;
        const d2 = dist2(a.x, a.y, t.x, t.y);
        if (d2 < m * m && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          this.moveEntity(a, (a.x - t.x) / d * (m - d), (a.y - t.y) / d * (m - d), a.T.colR);
        }
      }
    }
  }

  // ------------------------------------------------------------ objectives
  checkObjectives(dt) {
    if (this.phase === 'outro') {
      if (this.phaseT > 3.4) this.result = { success: true };
      return;
    }
    if (this.phase === 'failed') {
      if (this.phaseT > 2.5) this.result = { success: false, reason: this.failReason };
      return;
    }
    if (this.phase !== 'play') return;
    if (!this.troopers.length) return this.fail('Your squad has been wiped out.');
    if (this.rescueNeed) {
      const possible = this.colonists.filter((c) => c.alive).length;
      if (possible < this.rescueNeed) return this.fail('Too many colonists were lost.');
    }
    let allOthers = true;
    for (const o of this.objectives) {
      if (o.type === 'killAll') o.done = this.aliens.length === 0 && this.nests.length === 0;
      else if (o.type === 'nests') o.done = this.nests.length === 0;
      else if (o.type === 'rescue') o.done = this.stats.rescued >= this.rescueNeed;
      else if (o.type === 'boss') o.done = !!this.boss && this.boss.hp <= 0;
      if (o.type !== 'extract' && !o.done) allOthers = false;
    }
    const ext = this.objectives.find((o) => o.type === 'extract');
    if (ext) {
      if (allOthers && !this.extractOpen) { this.extractOpen = true; this.msg('Objectives complete. Get to the extraction beacon!', 'good'); Sfx.alarm(); }
      if (this.extractOpen && this.beacon) {
        ext.done = this.troopers.some((t) => dist2(t.x, t.y, this.beacon.x, this.beacon.y) < this.beacon.r * this.beacon.r);
      }
    }
    if (this.objectives.every((o) => o.done)) {
      this.phase = 'outro'; this.phaseT = 0;
      this.path = null;
      this.msg('Mission accomplished. Dropship inbound.', 'good');
      Sfx.fanfare();
      Sfx.engine(3.2);
    }
  }

  fail(reason) {
    this.phase = 'failed'; this.phaseT = 0; this.failReason = reason;
    this.msg(reason, 'bad');
  }

  objectiveLines() {
    return this.objectives.map((o) => {
      let label = '';
      if (o.type === 'killAll') label = `Wipe out all hostiles (${this.aliens.length + this.nests.length} left)`;
      else if (o.type === 'nests') label = `Destroy hive nests (${this.initialNests - this.nests.length}/${this.initialNests})`;
      else if (o.type === 'rescue') label = `Rescue colonists (${this.stats.rescued}/${this.rescueNeed})`;
      else if (o.type === 'boss') label = 'Kill the brood mother';
      else if (o.type === 'extract') label = this.extractOpen ? 'Reach the extraction beacon' : 'Extract (after other objectives)';
      return { label, done: o.done };
    });
  }

  // ------------------------------------------------------------ rendering
  render(g, cam, viewW, viewH, dpr) {
    const z = cam.zoom;
    const sx = this.shake ? rand(-this.shake, this.shake) * 0.4 : 0, sy = this.shake ? rand(-this.shake, this.shake) * 0.4 : 0;
    const x0 = cam.x - viewW / 2 / z + sx, y0 = cam.y - viewH / 2 / z + sy;
    const x1 = x0 + viewW / z, y1 = y0 + viewH / z;
    const view = { x0, y0, x1, y1 };
    this.cam = cam;
    g.setTransform(dpr * z, 0, 0, dpr * z, -x0 * dpr * z, -y0 * dpr * z);
    g.fillStyle = '#000';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    const map = this.map;
    const cx0 = clamp(Math.floor(x0), 0, map.pw), cy0 = clamp(Math.floor(y0), 0, map.ph);
    const cx1 = clamp(Math.ceil(x1), 0, map.pw), cy1 = clamp(Math.ceil(y1), 0, map.ph);
    if (cx1 > cx0 && cy1 > cy0) {
      g.drawImage(map.canvas, cx0, cy0, cx1 - cx0, cy1 - cy0, cx0, cy0, cx1 - cx0, cy1 - cy0);
      this.renderLiquid(g, view);
      g.drawImage(map.decals, cx0, cy0, cx1 - cx0, cy1 - cy0, cx0, cy0, cx1 - cx0, cy1 - cy0);
    }
    const t = this.time;
    const inView = (e, m = 60) => e.x > x0 - m && e.x < x1 + m && e.y > y0 - m && e.y < y1 + m;

    if (this.beacon) {
      drawBeacon(g, this.beacon, t, this.extractOpen || (this.rescueNeed && this.colonists.some((c) => c.state === 'following' || c.state === 'boarding')));
      if (this.extractOpen || this.rescueNeed) this.lights.push({ x: this.beacon.x, y: this.beacon.y, r: 120, c: '#70ffb0', i: 0.6 });
    }
    if (this.marker && this.path) {
      this.marker.t += 1 / 60;
      const m = this.marker;
      g.strokeStyle = `rgba(255,190,80,${0.8 - (m.t % 0.8)})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(m.x, m.y, 4 + (m.t % 0.8) * 14, 0, TAU); g.stroke();
    }
    for (const p of this.pickups) if (inView(p)) drawCrate(g, p, t);
    for (const b of this.barrels) if (inView(b)) drawBarrel(g, b);

    // Shadows
    for (const a of this.aliens) if (inView(a)) drawShadow(g, a.x, a.y, a.r * 1.1, a.r * 0.8, 0.3);
    if (this.deployed) for (const tr of this.troopers) drawShadow(g, tr.x, tr.y, 8, 6, 0.3);

    // Depth-sorted units and flora
    const list = [];
    for (const a of this.aliens) if (inView(a)) list.push({ y: a.y, d: 1, e: a });
    for (const n of this.nests) if (inView(n, 90)) list.push({ y: n.y - 10, d: 2, e: n });
    if (this.deployed) for (const tr of this.troopers) list.push({ y: tr.y, d: 3, e: tr });
    for (const c of this.colonists) if (c.state !== 'rescued' && c.alive && inView(c)) list.push({ y: c.y, d: 4, e: c });
    const tx0 = Math.max(0, Math.floor(x0 / TILE) - 1), tx1 = Math.min(map.w - 1, Math.floor(x1 / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(y0 / TILE) - 1), ty1 = Math.min(map.h - 1, Math.floor(y1 / TILE) + 1);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const fi = map.floraAt[ty * map.w + tx];
      if (fi >= 0) list.push({ y: map.flora[fi].y + 6, d: 5, e: map.flora[fi] });
    }
    list.sort((a, b) => a.y - b.y);
    const glow = this.biome.floraGlow;
    for (const it of list) {
      const e = it.e;
      if (it.d === 1) {
        ALIEN_DRAW[e.type](g, e, t);
        if (e.hitT > 0) { g.fillStyle = `rgba(255,255,255,${e.hitT * 5})`; ellipse(g, e.x, e.y, e.r, e.r); g.fill(); }
        if ((e.type === 'brute' || e.type === 'mother') && e.hp < e.maxHp) this.healthBar(g, e.x, e.y - e.r - 8, e.r * 1.6, e.hp / e.maxHp, '#ff7a3a');
        if (e.type === 'spitter') this.lights.push({ x: e.x, y: e.y, r: 34, c: '#8dff6a', i: 0.45 });
        if (e.type === 'mother') this.lights.push({ x: e.x, y: e.y, r: 140, c: '#ff6ad5', i: 0.5 });
      } else if (it.d === 2) {
        drawNest(g, e, t);
        if (e.hitT > 0) { g.fillStyle = `rgba(255,255,255,${e.hitT * 2})`; ellipse(g, e.x, e.y, e.r, e.r * 0.9); g.fill(); }
        if (e.hp < e.maxHp) this.healthBar(g, e.x, e.y - 36, 40, e.hp / e.maxHp, '#ffb040');
        this.lights.push({ x: e.x, y: e.y, r: 70, c: '#ffb040', i: 0.55 + e.spawnAnim * 0.4 });
      } else if (it.d === 3) {
        drawTrooper(g, e, t);
        if (e.hp < e.maxHp) this.healthBar(g, e.x, e.y - 14, 16, e.hp / e.maxHp, e.hp / e.maxHp > 0.4 ? '#7dffb0' : '#ff5040');
      } else if (it.d === 4) {
        drawColonist(g, e, t);
        this.lights.push({ x: e.x, y: e.y, r: 50, c: '#7ff0ff', i: 0.4 });
      } else {
        const spr = map.floraSprites[e.v];
        const sw = 1 + Math.sin(t * 1.3 + e.phase) * 0.02;
        g.drawImage(spr.canvas, e.x - (spr.w / 2) * sw, e.y - spr.h / 2, spr.w * sw, spr.h);
        if (this.ambient) this.lights.push({ x: e.x, y: e.y, r: 44, c: glow, i: 0.35 });
      }
    }
    // Leader chevron
    const L = this.leader;
    if (L && this.deployed && this.phase !== 'outro') {
      const by = L.y - 22 + Math.sin(t * 5) * 1.5;
      g.fillStyle = '#ffb13a';
      g.beginPath(); g.moveTo(L.x - 4, by - 3); g.lineTo(L.x, by + 1); g.lineTo(L.x + 4, by - 3); g.lineTo(L.x + 4, by - 1); g.lineTo(L.x, by + 3); g.lineTo(L.x - 4, by - 1); g.closePath(); g.fill();
    }
    // Throwables and acid
    for (const p of this.throwables) {
      if (p.kind === 'grenade') {
        drawShadow(g, p.x, p.y, 3, 2, 0.35);
        g.save(); g.translate(p.x, p.y - p.z); g.rotate(p.rot);
        g.fillStyle = '#3c4a30'; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
        g.fillStyle = (t * 8) % 1 < 0.5 ? '#ff3030' : '#601010'; g.fillRect(-1, -4, 2, 2);
        g.restore();
      } else {
        g.save(); g.translate(p.x, p.y); g.rotate(p.a);
        g.fillStyle = '#d8d8d0'; g.fillRect(-6, -1.6, 10, 3.2);
        g.fillStyle = '#e04030'; g.beginPath(); g.moveTo(4, -1.6); g.lineTo(8, 0); g.lineTo(4, 1.6); g.fill();
        g.restore();
      }
    }
    for (const gl of this.globs) {
      drawShadow(g, gl.x, gl.y, 3, 2, 0.3);
      g.fillStyle = '#b8ff7a';
      g.beginPath(); g.arc(gl.x, gl.y - gl.z, 3, 0, TAU); g.fill();
    }
    this.particles.draw(g, false, view);

    // Additive layer: tracers, glows
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const b of this.bullets) {
      g.strokeStyle = 'rgba(255,220,140,0.9)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); g.lineTo(b.x, b.y); g.stroke();
    }
    this.particles.draw(g, true, view);
    g.globalCompositeOperation = 'source-over';

    // Dropship
    this.renderDropship(g);

    // Lighting
    if (this.ambient) this.renderLighting(g, view, z, viewW, viewH, dpr);
    this.renderWeather(g, view);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Vignette
    const vg = g.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.35, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg; g.fillRect(0, 0, viewW, viewH);
    const hurt = this.troopers.reduce((m, tr) => Math.max(m, tr.hitT), 0);
    if (hurt > 0) { g.fillStyle = `rgba(160,0,0,${hurt * 0.8})`; g.fillRect(0, 0, viewW, viewH); }
    return view;
  }

  healthBar(g, x, y, w, f, col) {
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 4);
    g.fillStyle = col; g.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 2);
  }

  renderLiquid(g, view) {
    const lava = this.biome.liquid.kind === 'lava', acid = this.biome.liquid.kind === 'acid';
    const t = this.time;
    for (const p of this.map.liquidTiles) {
      if (p.x < view.x0 - 40 || p.x > view.x1 + 40 || p.y < view.y0 - 40 || p.y > view.y1 + 40) continue;
      if (lava || acid) {
        const k = 0.5 + 0.5 * Math.sin(t * 1.5 + p.p);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (lava ? 0.25 : 0.12) * k;
        g.drawImage(glowSprite(this.biome.liquid.shallow), p.x - 26, p.y - 26, 52, 52);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        if (Math.random() < (lava ? 0.01 : 0.004)) this.particles.add({ kind: 'glow', add: true, x: p.x + rand(-10, 10), y: p.y + rand(-10, 10), vy: -15, size: rand(3, 6), color: this.biome.liquid.foam, life: 0.8 });
        this.lights.push({ x: p.x, y: p.y, r: lava ? 70 : 40, c: this.biome.liquid.shallow, i: lava ? 0.5 : 0.25 });
      } else {
        const k = Math.sin(t * 1.8 + p.p);
        g.strokeStyle = `rgba(255,255,255,${0.06 + 0.06 * k})`; g.lineWidth = 1;
        g.beginPath(); g.ellipse(p.x + Math.sin(t * 0.7 + p.p) * 6, p.y + Math.cos(t * 0.5 + p.p) * 4, 7, 1.6, 0, 0, TAU); g.stroke();
      }
    }
  }

  renderDropship(g) {
    if (this.demo) return;
    let x, y, sc, alpha = 1;
    const L = this.leader || { x: this.map.start.x, y: this.map.start.y };
    if (this.phase === 'intro') {
      const s = this.map.start;
      const p = this.phaseT;
      if (p < 1.2) { const k = 1 - p / 1.2; x = s.x; y = s.y + k * k * 500; sc = 1.4; }
      else if (p < 1.7) { x = s.x; y = s.y; sc = 1.4 - (p - 1.2) * 0.3; }
      else { const k = (p - 1.7) / 0.9; x = s.x; y = s.y - k * k * 600; sc = 1.25 + k * 0.3; alpha = 1 - k * 0.3; }
      if (p < 0.05) Sfx.engine(2.6);
    } else if (this.phase === 'outro') {
      const p = this.phaseT;
      const tx = this.beacon && this.extractOpen ? this.beacon.x : L.x, ty = this.beacon && this.extractOpen ? this.beacon.y : L.y;
      if (!this.outroPos) this.outroPos = { x: tx, y: ty };
      const o = this.outroPos;
      if (p < 1.2) { const k = 1 - p / 1.2; x = o.x; y = o.y + k * k * 500; sc = 1.4; }
      else if (p < 2.2) {
        x = o.x; y = o.y; sc = 1.35;
        // Beam up the squad
        for (const tr of this.troopers) {
          tr.x = lerp(tr.x, o.x, 0.04); tr.y = lerp(tr.y, o.y, 0.04);
          if (Math.random() < 0.3) this.particles.add({ kind: 'glow', add: true, x: tr.x + rand(-5, 5), y: tr.y, vy: -80, size: 4, color: '#9ae8ff', life: 0.5 });
        }
      } else {
        if (this.deployed) { this.deployed = false; }
        const k = (p - 2.2) / 1.2; x = o.x; y = o.y - k * k * 700; sc = 1.35 + k * 0.4;
      }
    } else return;
    // Shadow on the ground, offset by height
    const h = (sc - 1) * 120 + 30;
    const shadow = dropshipShadow(), ss = (256 / 1.6) * 0.9;
    g.save();
    g.globalAlpha = 0.4 * alpha;
    g.drawImage(shadow, x + h * 0.5 - ss / 2, y + h * 0.7 - ss / 2, ss, ss);
    g.restore();
    g.save();
    drawDropship(g, x, y, -Math.PI / 2, sc, this.time, alpha);
    g.restore();
    this.lights.push({ x, y, r: 200, c: '#bfe8ff', i: 0.7 });
  }

  renderLighting(g, view, z, viewW, viewH, dpr) {
    const lw = Math.ceil(viewW / 2), lh = Math.ceil(viewH / 2);
    if (!this.lightCanvas || this.lightCanvas.width !== lw || this.lightCanvas.height !== lh) this.lightCanvas = makeCanvas(lw, lh);
    const lg = this.lightCanvas.getContext('2d');
    const A = this.ambient;
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = `rgb(${A[0]},${A[1]},${A[2]})`;
    lg.fillRect(0, 0, lw, lh);
    lg.globalCompositeOperation = 'lighter';
    const k = z / 2;
    for (const L of this.lights) {
      const x = (L.x - view.x0) * k, y = (L.y - view.y0) * k, r = L.r * k;
      if (x < -r || y < -r || x > lw + r || y > lh + r) continue;
      lg.globalAlpha = clamp(L.i, 0, 1);
      lg.drawImage(glowSprite(L.c), x - r, y - r, r * 2, r * 2);
    }
    for (const p of this.particles.list) {
      if (!p.add || p.kind !== 'glow' || p.size < 8) continue;
      const x = (p.x - view.x0) * k, y = (p.y - view.y0) * k, r = p.size * 2.5 * k;
      lg.globalAlpha = clamp(p.life / p.max, 0, 1);
      lg.drawImage(glowSprite(p.color), x - r, y - r, r * 2, r * 2);
    }
    lg.globalAlpha = 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(this.lightCanvas, 0, 0, viewW, viewH);
    g.globalCompositeOperation = 'source-over';
    g.setTransform(dpr * z, 0, 0, dpr * z, -view.x0 * dpr * z, -view.y0 * dpr * z);
  }

  renderWeather(g, view) {
    const kind = this.biome.weather;
    const W = view.x1 - view.x0, H = view.y1 - view.y0;
    const t = this.time;
    for (const f of this.weather) {
      let x, y;
      if (kind === 'snow') {
        x = view.x0 + ((((f.x * W + t * (20 + f.z * 20) + Math.sin(t + f.p) * 10) % W) + W) % W);
        y = view.y0 + ((((f.y * H + t * (40 + f.z * 50)) % H) + H) % H);
        g.fillStyle = `rgba(255,255,255,${0.4 + f.z * 0.5})`;
        g.beginPath(); g.arc(x, y, 0.8 + f.z * 1.4, 0, TAU); g.fill();
      } else if (kind === 'dust') {
        x = view.x0 + ((((f.x * W + t * (120 + f.z * 160)) % W) + W) % W);
        y = view.y0 + ((((f.y * H + t * 20) % H) + H) % H);
        g.strokeStyle = `rgba(255,220,170,${0.1 + f.z * 0.15})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 10 - f.z * 12, y - 2); g.stroke();
      } else if (kind === 'ash') {
        x = view.x0 + ((((f.x * W + t * 15 + Math.sin(t * 0.7 + f.p) * 20) % W) + W) % W);
        y = view.y0 + ((((f.y * H - t * (20 + f.z * 30)) % H) + H) % H);
        const ember = f.p < 1.2;
        g.fillStyle = ember ? `rgba(255,${120 + f.z * 80},40,${0.5 + 0.4 * Math.sin(t * 4 + f.p)})` : 'rgba(160,150,150,0.4)';
        g.beginPath(); g.arc(x, y, ember ? 1.1 : 1.3, 0, TAU); g.fill();
      } else {
        x = view.x0 + ((((f.x * W + Math.sin(t * 0.3 + f.p) * 40) % W) + W) % W);
        y = view.y0 + ((((f.y * H - t * (6 + f.z * 8)) % H) + H) % H);
        g.fillStyle = this.biome === BIOMES.hive ? `rgba(255,170,90,${0.25 + 0.3 * Math.sin(t * 2 + f.p)})` : `rgba(140,255,200,${0.25 + 0.35 * Math.sin(t * 2 + f.p)})`;
        g.beginPath(); g.arc(x, y, 1 + f.z, 0, TAU); g.fill();
      }
    }
  }
}
