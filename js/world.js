'use strict';
// One mission in progress: map, units, projectiles, objectives and rendering.

const SPACING = 17;
const TEAM_DEFS = [{ name: 'Alpha', color: '#ffb13a' }, { name: 'Bravo', color: '#5fd8ff' }, { name: 'Charlie', color: '#ff7ad0' }];

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
    this.teams = []; this.active = 0;
    this.vehicles = []; this.wrecks = 0;
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
    if (this.troopers.length) {
      const T = this.makeTeam(this.troopers.slice(), M.grenades || 0, M.rockets || 0);
      T.trail = [{ x: s.x, y: s.y + 60 }, { x: s.x, y: s.y + 30 }];
      this.teams.push(T);
    }

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
    // Vehicles, parked within reach of the drop zone
    for (const [type, count] of Object.entries(M.vehicles || {})) {
      for (let i = 0; i < count; i++) {
        const c = pickCell(4, 110, 1, Math.max(14, maxD * 0.45));
        placed.push(c);
        this.vehicles.push(new Vehicle(type, c.x, c.y, rng.range(0, TAU)));
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

  // ------------------------------------------------------------ teams
  makeTeam(members, grenades, rockets) {
    const used = new Set(this.teams.map((t) => t.name));
    const def = TEAM_DEFS.find((d) => !used.has(d.name)) || TEAM_DEFS[0];
    const L = members[0];
    const T = {
      name: def.name, color: def.color, members, trail: L ? [{ x: L.x, y: L.y }] : [],
      path: null, goal: null, marker: null, pathT: 0, throwCd: 0,
      grenades, rockets, special: grenades > 0 || rockets === 0 ? 'grenade' : 'rocket',
      vehicle: null, boardTarget: null,
    };
    for (const m of members) m.team = T;
    return T;
  }

  get team() { return this.teams[this.active] || this.teams[0] || null; }
  get leader() { const T = this.team; return T ? T.members[0] : null; }
  get focus() { const T = this.team; return T ? T.vehicle || T.members[0] : null; }
  get grenades() { return this.team ? this.team.grenades : 0; }
  get rockets() { return this.team ? this.team.rockets : 0; }
  get special() { return this.team ? this.team.special : 'grenade'; }
  set special(v) { if (this.team) this.team.special = v; }

  updateLeader() {
    for (const T of this.teams) T.members.forEach((t, i) => (t.leader = i === 0));
  }

  removeTeam(T) {
    const i = this.teams.indexOf(T);
    if (i < 0) return;
    const wasActive = this.team === T;
    if (T.vehicle) { T.vehicle.team = null; T.vehicle.vel = 0; T.vehicle = null; }
    this.teams.splice(i, 1);
    if (i < this.active || this.active >= this.teams.length) this.active = Math.max(0, this.active - 1);
    for (const c of this.colonists) if (c.team === T) c.team = this.teams[0] || null;
    if (wasActive && this.teams.length) this.msg(`${this.team.name} team now has command.`, 'info');
  }

  splitTeam() {
    const T = this.team;
    if (!T) return;
    if (T.vehicle) return this.msg('Get out of the vehicle before splitting the team.', 'warn');
    if (this.teams.length >= TEAM_DEFS.length) return this.msg(`${TEAM_DEFS.length} teams is the limit. Join two teams first.`, 'warn');
    let out = T.members.filter((m) => m.marked);
    if (out.length >= T.members.length) out = out.filter((m) => m !== T.members[0]);
    if (!out.length) out = T.members.slice(Math.ceil(T.members.length / 2));
    if (!out.length) return this.msg('A team of one cannot split.', 'warn');
    T.members = T.members.filter((m) => !out.includes(m));
    const share = out.length / (out.length + T.members.length);
    const g = Math.floor(T.grenades * share), r = Math.floor(T.rockets * share);
    T.grenades -= g; T.rockets -= r;
    const N = this.makeTeam(out, g, r);
    for (const m of this.troopers) m.marked = false;
    this.teams.push(N);
    this.updateLeader();
    if (T.goal && T.members[0]) T.path = this.map.findPath(T.members[0].x, T.members[0].y, T.goal.x, T.goal.y);
    this.msg(`${N.name} team splits off with ${out.length}. Press C to switch teams.`, 'good');
    Sfx.click();
  }

  joinTeams() {
    const T = this.team;
    if (!T || this.teams.length < 2) return;
    if (T.vehicle) return this.msg('Get out of the vehicle to join another team.', 'warn');
    let best = null, bd = 120 * 120;
    for (const O of this.teams) {
      if (O === T || O.vehicle) continue;
      for (const m of O.members) for (const n of T.members) {
        const d = dist2(m.x, m.y, n.x, n.y);
        if (d < bd) { bd = d; best = O; }
      }
    }
    if (!best) return this.msg('Walk up to another team on foot to join it.', 'warn');
    T.members.push(...best.members);
    for (const m of best.members) m.team = T;
    T.grenades += best.grenades; T.rockets += best.rockets;
    for (const c of this.colonists) if (c.team === best) c.team = T;
    best.members = [];
    const keep = T;
    this.teams.splice(this.teams.indexOf(best), 1);
    this.active = this.teams.indexOf(keep);
    this.updateLeader();
    this.msg(`${best.name} joins ${T.name}: ${T.members.length} troopers.`, 'good');
    Sfx.click();
  }

  boardVehicle(T, v) {
    T.boardTarget = null;
    if (T.members.length > v.T.seats) {
      this.msg(`The ${v.T.name} seats ${v.T.seats}. Mark troopers and split (X) to send a smaller team.`, 'warn');
      return;
    }
    T.vehicle = v; v.team = T;
    for (const m of T.members) { m.inVehicle = v; m.moving = false; m.marked = false; }
    T.path = null; v.vel = 0; v.turret = v.face;
    T.trail = [{ x: v.x, y: v.y }];
    this.msg(`${T.name} team takes the ${v.T.name}. R to get out.`, 'good');
    Sfx.engine(0.9);
  }

  exitVehicle(T, forced = false) {
    const v = T.vehicle;
    if (!v) return false;
    const spots = [];
    for (const rad of [v.r + 10, v.r + 24, v.r + 40]) {
      for (let k = 0; k < 12; k++) {
        const a = v.face + Math.PI + (k / 12) * TAU;
        const x = v.x + Math.cos(a) * rad, y = v.y + Math.sin(a) * rad;
        if (!this.map.circleBlocked(x, y, 7)) spots.push({ x, y });
      }
      if (spots.length >= T.members.length) break;
    }
    if (!spots.length && !forced) { this.msg('Nowhere to get out here. Drive to solid ground.', 'warn'); return false; }
    T.members.forEach((m, i) => {
      const p = spots[i % Math.max(1, spots.length)] || { x: v.x, y: v.y };
      m.x = p.x; m.y = p.y; m.inVehicle = null; m.face = v.face;
    });
    T.vehicle = null; v.team = null; v.vel = 0;
    T.path = null; T.trail = [{ x: T.members[0].x, y: T.members[0].y }];
    if (!spots.length) for (const m of T.members.slice()) this.damageFriendly(m, 999, m.x, m.y);
    return true;
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
  moveEntity(e, dx, dy, r, mode) {
    const m = this.map;
    r = r ?? e.r;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5));
    const sx = dx / steps, sy = dy / steps;
    let moved = false;
    for (let i = 0; i < steps; i++) {
      if (!m.circleBlocked(e.x + sx, e.y, r, mode)) { e.x += sx; moved = true; }
      if (!m.circleBlocked(e.x, e.y + sy, r, mode)) { e.y += sy; moved = true; }
    }
    return moved;
  }

  targets() {
    const out = this.troopers.filter((t) => !t.inVehicle);
    for (const v of this.vehicles) if (v.team) out.push(v);
    for (const c of this.colonists) if (c.state === 'following' || c.state === 'boarding') out.push(c);
    return out;
  }

  nearestTarget(x, y, range, needLos) {
    if (!this.deployed) return null;
    let best = null, bd = range * range;
    for (const t of this.troopers) {
      if (t.inVehicle) continue;
      const d = dist2(x, y, t.x, t.y);
      if (d < bd && (!needLos || this.map.lineClear(x, y, t.x, t.y))) { bd = d; best = t; }
    }
    for (const v of this.vehicles) {
      if (!v.team) continue;
      const d = dist2(x, y, v.x, v.y);
      if (d < bd && (!needLos || this.map.lineClear(x, y, v.x, v.y))) { bd = d; best = v; }
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
    for (const T of this.teams) T.throwCd -= dt;
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

    if (this.deployed) this.updateTeams(dt, ctl);
    this.updateVehicles(dt);
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
    if (ctl.switchTeam && this.teams.length > 1) {
      this.active = (this.active + 1) % this.teams.length;
      this.msg(`${this.team.name} team selected`, 'info');
      Sfx.click();
    }
    if (ctl.selectTeam != null && this.teams[ctl.selectTeam]) this.active = ctl.selectTeam;
    if (ctl.split) this.splitTeam();
    if (ctl.join) this.joinTeams();
    const T = this.team;
    if (!T) return;
    if (ctl.exit) {
      if (T.vehicle) { if (this.exitVehicle(T)) Sfx.click(); }
      else this.msg('This team is on foot. Click a vehicle to climb in.', 'info');
    }
    const L = T.members[0];
    const mover = T.vehicle || L;
    if (ctl.move && mover) {
      const changed = !T.goal || dist2(T.goal.x, T.goal.y, ctl.move.x, ctl.move.y) > 16 * 16;
      T.pathT -= dt;
      if (ctl.moveNew || (changed && T.pathT <= 0)) {
        T.pathT = 0.12;
        if (!T.vehicle) {
          const v = this.vehicles.find((v) => v.alive && !v.team && dist2(v.x, v.y, ctl.move.x, ctl.move.y) < (v.r + 10) ** 2);
          if (v || ctl.moveNew) T.boardTarget = v || null;
        }
        const mode = T.vehicle ? T.vehicle.T.mode : 'foot';
        const r = T.vehicle ? T.vehicle.T.colR : 7;
        const p = this.map.findPath(mover.x, mover.y, ctl.move.x, ctl.move.y, r, mode);
        if (p && p.length) { T.path = p; T.goal = { x: ctl.move.x, y: ctl.move.y }; T.marker = { x: p[p.length - 1].x, y: p[p.length - 1].y, t: 0 }; }
      }
    }
    if (ctl.switchSpecial) { T.special = T.special === 'grenade' ? 'rocket' : 'grenade'; Sfx.click(); }
    if (ctl.selectSpecial) T.special = ctl.selectSpecial;
    if (ctl.throw && T.throwCd <= 0 && L && !T.vehicle) {
      if (T.special === 'grenade' && T.grenades <= 0 && T.rockets > 0) T.special = 'rocket';
      else if (T.special === 'rocket' && T.rockets <= 0 && T.grenades > 0) T.special = 'grenade';
      if (T.special === 'grenade' && T.grenades > 0) { this.throwGrenade(L, ctl.aimX, ctl.aimY); T.grenades--; T.throwCd = 0.55; }
      else if (T.special === 'rocket' && T.rockets > 0) { this.fireRocket(L, ctl.aimX, ctl.aimY); T.rockets--; T.throwCd = 0.7; }
      else if (!this.tips.noAmmo) { this.tips.noAmmo = 1; this.msg('Out of explosives. Look for supply crates.', 'warn'); }
    }
  }

  updateTeams(dt, ctl) {
    const playing = this.phase === 'play' && !this.demo;
    const firingActive = !!(ctl && ctl.fire && playing);
    for (const T of this.teams) {
      if (T.vehicle) this.driveVehicle(T, dt, ctl, T === this.team);
      else this.walkTeam(T, dt, firingActive && T === this.team);
      this.updateFollowers(T, dt, firingActive && T === this.team);
    }
    // Keep people on foot from stacking
    const sq = this.troopers.filter((t) => !t.inVehicle);
    for (const c of this.colonists) if (c.state === 'following') sq.push(c);
    for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
      const a = sq[i], b = sq[j];
      const d2 = dist2(a.x, a.y, b.x, b.y);
      if (d2 < 121 && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (11 - d) * 0.5;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        if (!a.leader) this.moveEntity(a, -nx * push, -ny * push);
        if (!b.leader) this.moveEntity(b, nx * push, ny * push);
      }
    }
    // Troopers: environment, hit timers, shooting
    for (const t of this.troopers) {
      t.hitT = Math.max(0, t.hitT - dt);
      t.recoil = Math.max(0, t.recoil - dt * 20);
      t.fireCd -= dt;
      if (t.inVehicle) { t.x = t.inVehicle.x; t.y = t.inVehicle.y; t.inWater = false; continue; }
      const tile = this.map.tileAt(t.x, t.y);
      t.inWater = tile === T_WATER;
      if (t.inWater && this.biome.liquid.damage) {
        t.acidT -= dt;
        if (t.acidT <= 0) { t.acidT = 0.5; this.damageFriendly(t, this.biome.liquid.damage * 0.5, t.x, t.y, 0, true); }
      }
      if (t.team === this.team) {
        if (firingActive) {
          const a = Math.atan2(ctl.aimY - t.y, ctl.aimX - t.x);
          t.face = turnToward(t.face, a, 16 * dt);
          if (t.fireCd <= 0 && !t.inWater && Math.abs(angDiff(t.face, a)) < 0.5) this.fireBullet(t, ctl.aimX, ctl.aimY);
        }
      } else if (playing) {
        // Teams you are not commanding hold their ground and defend themselves.
        t.autoT = (t.autoT || 0) - dt;
        if (t.autoT <= 0) { t.autoT = rand(0.2, 0.35); t.autoTarget = this.nearestAlien(t.x, t.y, 260); }
        const a0 = t.autoTarget;
        if (a0 && a0.hp > 0) {
          const a = Math.atan2(a0.y - t.y, a0.x - t.x);
          t.face = turnToward(t.face, a, 12 * dt);
          if (t.fireCd <= 0 && !t.inWater && Math.abs(angDiff(t.face, a)) < 0.4) { this.fireBullet(t, a0.x, a0.y); t.fireCd *= 1.4; }
        }
      }
      // Nests are solid to troopers
      for (const n of this.nests) {
        const d = dist(t.x, t.y, n.x, n.y), m = n.r + t.r - 4;
        if (d < m && d > 0.01) this.moveEntity(t, (t.x - n.x) / d * (m - d), (t.y - n.y) / d * (m - d));
      }
      // Parked vehicles are solid too
      for (const v of this.vehicles) {
        if (v.team === t.team && t.team.boardTarget === v) continue;
        const d = dist(t.x, t.y, v.x, v.y), m = v.T.colR + t.r;
        if (d < m && d > 0.01) this.moveEntity(t, (t.x - v.x) / d * (m - d), (t.y - v.y) / d * (m - d));
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
        const finder = this.troopers.find((t) => dist2(t.x, t.y, c.x, c.y) < (t.inVehicle ? 48 : 38) ** 2);
        if (finder) {
          c.state = 'following';
          c.team = finder.team;
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
      if (c.state === 'following' && (!c.team || !this.teams.includes(c.team))) c.team = this.team;
      if ((c.state === 'following' || c.state === 'boarding') && this.beacon && dist2(c.x, c.y, this.beacon.x, this.beacon.y) < (this.beacon.r * 0.6) ** 2) {
        c.state = 'rescued';
        this.stats.rescued++;
        this.msg(`Colonist rescued (${this.stats.rescued}/${this.rescueNeed})`, 'good');
        Sfx.fanfare();
        for (let i = 0; i < 20; i++) this.particles.add({ kind: 'glow', add: true, x: c.x + rand(-8, 8), y: c.y, vy: rand(-120, -40), size: rand(3, 6), color: '#7fffd0', life: rand(0.5, 1) });
      }
    }
  }

  nearestAlien(x, y, range) {
    let best = null, bd = range * range;
    for (const a of this.aliens) {
      const d = dist2(x, y, a.x, a.y);
      if (d < bd && this.map.lineClear(x, y, a.x, a.y)) { bd = d; best = a; }
    }
    return best;
  }

  walkTeam(T, dt, firing) {
    const L = T.members[0];
    if (!L) return;
    let moving = false;
    if (T.path && T.path.length && this.phase === 'play') {
      const wp = T.path[0];
      const d = dist(L.x, L.y, wp.x, wp.y);
      const sp = L.speed * (L.inWater ? 0.5 : 1) * dt;
      if (d < 3) T.path.shift();
      else {
        const f = Math.min(1, sp / d);
        const ox = L.x, oy = L.y;
        this.moveEntity(L, (wp.x - L.x) * f, (wp.y - L.y) * f);
        moving = dist2(ox, oy, L.x, L.y) > 0.01;
        if (!moving) T.path.shift();
        else if (!firing) L.face = turnToward(L.face, Math.atan2(wp.y - L.y, wp.x - L.x), 12 * dt);
        if (d <= sp) T.path.shift();
      }
      if (!T.path.length) T.path = null;
    }
    this.stepAnim(L, moving, dt);
    const bt = T.boardTarget;
    if (bt && bt.alive && !bt.team && dist2(L.x, L.y, bt.x, bt.y) < (bt.r + 18) ** 2) this.boardVehicle(T, bt);
    else if (bt && (!bt.alive || bt.team)) T.boardTarget = null;
    const last = T.trail[T.trail.length - 1];
    if (!last || dist2(last.x, last.y, L.x, L.y) > 25) {
      T.trail.push({ x: L.x, y: L.y });
      if (T.trail.length > 500) T.trail.splice(0, 100);
    }
  }

  updateFollowers(T, dt, firing) {
    const followers = T.vehicle ? [] : T.members.slice(1);
    for (const c of this.colonists) if (c.state === 'following' && c.team === T) followers.push(c);
    const base = T.vehicle ? T.vehicle.r + 6 : 0;
    followers.forEach((f, i) => {
      const tp = this.trailPoint(T, base + (i + 1) * SPACING);
      const d = dist(f.x, f.y, tp.x, tp.y);
      let moving = false;
      if (d > 2.5) {
        const sp0 = (f.speed || 95) * (f.inWater ? 0.5 : 1);
        const sp = sp0 * (d > 60 ? 1.6 : d > 25 ? 1.2 : 1) * dt;
        const k = Math.min(1, sp / d);
        const ox = f.x, oy = f.y;
        this.moveEntity(f, (tp.x - f.x) * k, (tp.y - f.y) * k);
        moving = dist2(ox, oy, f.x, f.y) > 0.01;
        if (moving && !(firing && f instanceof Trooper)) f.face = turnToward(f.face, Math.atan2(tp.y - f.y, tp.x - f.x), 10 * dt);
      }
      this.stepAnim(f, moving && d > 2.5, dt);
    });
  }

  driveVehicle(T, dt, ctl, active) {
    const v = T.vehicle, VT = v.T;
    let target = 0;
    if (T.path && T.path.length && this.phase === 'play') {
      const wp = T.path[0];
      const d = dist(v.x, v.y, wp.x, wp.y);
      if (d < 12 || (T.path.length > 1 && d < 24)) T.path.shift();
      else {
        const a = Math.atan2(wp.y - v.y, wp.x - v.x);
        const diff = Math.abs(angDiff(v.face, a));
        v.face = turnToward(v.face, a, VT.turn * dt * (0.85 + 0.15 * Math.min(1, Math.abs(v.vel) / VT.speed)));
        target = VT.speed * (diff > 1.2 ? 0.12 : diff > 0.5 ? 0.5 : 1);
        if (T.path.length === 1) target = Math.min(target, d * 2.4 + 20);
      }
      if (!T.path.length) T.path = null;
    }
    const tile = this.map.tileAt(v.x, v.y);
    if (tile === T_WATER && VT.mode === 'foot') target *= VT.waterMul;
    v.vel += clamp(target - v.vel, -VT.accel * 1.6 * dt, VT.accel * dt);
    const ox = v.x, oy = v.y;
    this.moveEntity(v, Math.cos(v.face) * v.vel * dt, Math.sin(v.face) * v.vel * dt, VT.colR, VT.mode);
    const moved = dist(ox, oy, v.x, v.y);
    if (v.vel > 20 && moved < v.vel * dt * 0.3) {
      v.vel *= 0.5; v.stuckT += dt;
      if (v.stuckT > 0.5 && T.path) { T.path.shift(); v.stuckT = 0; if (!T.path.length) T.path = null; }
    } else v.stuckT = 0;
    v.roll += moved;
    // Dust, spray and wake
    if (moved > 0.5 && Math.random() < 0.5) {
      const bx = v.x - Math.cos(v.face) * v.r, by = v.y - Math.sin(v.face) * v.r;
      const wet = tile === T_WATER || tile === T_LAVA;
      this.particles.add({ kind: wet ? 'ring' : 'smoke', x: bx + rand(-5, 5), y: by + rand(-5, 5), vx: rand(-15, 15), vy: rand(-15, 15), drag: 2, size: wet ? 4 : rand(4, 7), size2: 16, grow: 14, color: wet ? this.biome.liquid.foam : this.biome.ground[3], alpha: 0.35, life: 0.8 });
      if (VT.mode === 'foot' && tile === T_GROUND && Math.random() < 0.3) Decals.footprint(this, bx, by, v.face, Math.random() < 0.5 ? -3 : 3);
    }
    const last = T.trail[T.trail.length - 1];
    if (!last || dist2(last.x, last.y, v.x, v.y) > 25) { T.trail.push({ x: v.x, y: v.y }); if (T.trail.length > 500) T.trail.splice(0, 100); }
    // Running aliens over
    if (VT.crush && Math.abs(v.vel) > 45) {
      for (const a of this.aliens.slice()) {
        if (dist2(a.x, a.y, v.x, v.y) > (v.r + a.r * 0.6) ** 2) continue;
        if (a.type === 'skitter' || a.type === 'spitter') this.damageAlien(a, 999, T.members[0], v.face, 0, true);
        else if ((a.crushCd || 0) < this.time) { a.crushCd = this.time + 0.5; this.damageAlien(a, 35, T.members[0], v.face, 200, true); v.vel *= 0.3; this.damageVehicle(v, 10); }
      }
    }
    // Guns
    v.fireCd -= dt;
    v.recoil = Math.max(0, v.recoil - dt * 6);
    let aim = null;
    if (active && ctl && this.phase === 'play') {
      aim = { x: ctl.aimX, y: ctl.aimY };
      v.turret = turnToward(v.turret, Math.atan2(aim.y - v.y, aim.x - v.x), VT.turretTurn * dt);
      if (!ctl.fire) aim = null;
    } else if (this.phase === 'play') {
      v.autoT -= dt;
      if (v.autoT <= 0) { v.autoT = 0.3; v.autoTarget = this.nearestAlien(v.x, v.y, VT.weapon === 'cannon' ? 360 : 300); }
      if (v.autoTarget && v.autoTarget.hp > 0) aim = { x: v.autoTarget.x, y: v.autoTarget.y };
      if (aim) v.turret = turnToward(v.turret, Math.atan2(aim.y - v.y, aim.x - v.x), VT.turretTurn * dt);
    } else v.turret = turnToward(v.turret, v.face, VT.turretTurn * dt);
    if (aim && v.fireCd <= 0) {
      const a = Math.atan2(aim.y - v.y, aim.x - v.x);
      if (Math.abs(angDiff(v.turret, a)) < (VT.weapon === 'cannon' ? 0.12 : 0.3)) this.fireVehicle(v, aim, T.members[0]);
    }
    // Headlights
    this.lights.push({ x: v.x, y: v.y, r: 110, c: '#ffe6c0', i: 0.6 });
    this.lights.push({ x: v.x + Math.cos(v.face) * 70, y: v.y + Math.sin(v.face) * 70, r: 90, c: '#fff4d8', i: 0.7 });
  }

  fireVehicle(v, aim, crew) {
    const VT = v.T;
    const tx = v.x, ty = v.y;
    if (VT.weapon === 'cannon') {
      const C = VT.cannon;
      const mx = tx + Math.cos(v.turret) * C.len, my = ty + Math.sin(v.turret) * C.len;
      const d = clamp(dist(tx, ty, aim.x, aim.y), 60, C.range);
      this.throwables.push({ kind: 'shell', x: mx, y: my, vx: Math.cos(v.turret) * 640, vy: Math.sin(v.turret) * 640, a: v.turret, travel: 0, maxD: d - C.len, src: crew, R: C.R, dmg: C.dmg, owner: v });
      v.fireCd = C.cd; v.recoil = 1;
      this.shake = Math.min(14, this.shake + 3);
      this.sound('boom', v.x, v.y, 0.6, 0.4);
      this.lights.push({ x: mx, y: my, r: 140, c: '#ffd890', i: 1 });
      this.particles.add({ kind: 'glow', add: true, x: mx, y: my, size: 16, color: '#ffcf70', life: 0.08 });
      for (let i = 0; i < 8; i++) this.particles.add({ kind: 'smoke', x: mx, y: my, vx: Math.cos(v.turret + rand(-0.8, 0.8)) * rand(30, 120), vy: Math.sin(v.turret + rand(-0.8, 0.8)) * rand(30, 120), drag: 3, size: rand(6, 10), grow: 18, color: '#a8a8a0', alpha: 0.55, life: rand(0.6, 1.1) });
      return;
    }
    const G = VT.gun;
    v.barrel = -v.barrel;
    const px = -Math.sin(v.turret) * 1.8 * v.barrel, py = Math.cos(v.turret) * 1.8 * v.barrel;
    const a = Math.atan2(aim.y - ty, aim.x - tx) + gauss() * G.spread;
    const mx = tx + Math.cos(v.turret) * G.len + px, my = ty + Math.sin(v.turret) * G.len + py;
    const sp = 1000;
    this.bullets.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: G.range / sp, dmg: G.dmg, src: crew, px: mx, py: my });
    v.fireCd = G.rate * rand(0.9, 1.1); v.recoil = 1.5;
    this.stats.shots++;
    this.lights.push({ x: mx, y: my, r: 70, c: '#ffd890', i: 0.9 });
    this.particles.add({ kind: 'glow', add: true, x: mx, y: my, size: rand(6, 9), color: '#ffcf70', life: 0.05 });
    this.sound('shot', v.x, v.y, 0.9);
  }

  updateVehicles(dt) {
    for (const v of this.vehicles) {
      v.hitT = Math.max(0, v.hitT - dt);
      if (!v.team) {
        v.vel *= Math.max(0, 1 - 4 * dt);
        if (Math.abs(v.vel) > 1) this.moveEntity(v, Math.cos(v.face) * v.vel * dt, Math.sin(v.face) * v.vel * dt, v.T.colR, v.T.mode);
      }
      // Nests are solid to vehicles
      for (const n of this.nests) {
        const d = dist(v.x, v.y, n.x, n.y), m = n.r + v.T.colR;
        if (d < m && d > 0.01) { this.moveEntity(v, (v.x - n.x) / d * (m - d), (v.y - n.y) / d * (m - d), v.T.colR, v.T.mode); v.vel *= 0.5; }
      }
      if (v.hp < v.maxHp * 0.4) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = 0.08;
          this.particles.add({ kind: 'smoke', x: v.x + rand(-4, 4), y: v.y + rand(-4, 4), vx: rand(-10, 10), vy: rand(-30, -10), drag: 1, size: rand(4, 7), grow: 14, color: '#2a2624', alpha: 0.6, life: rand(0.8, 1.4) });
          if (v.hp < v.maxHp * 0.2 && Math.random() < 0.4) this.particles.add({ kind: 'glow', add: true, x: v.x + rand(-5, 5), y: v.y + rand(-5, 5), vy: -20, size: rand(3, 6), color: '#ff7a20', life: 0.4 });
        }
      }
    }
  }

  damageVehicle(v, dmg) {
    if (!v.alive) return;
    v.hp -= dmg * 0.6;
    v.hitT = 0.12;
    this.sound('ping', v.x, v.y, 0.8);
    for (let i = 0; i < 3; i++) this.particles.add({ kind: 'spark', add: true, x: v.x + rand(-v.r, v.r) * 0.6, y: v.y + rand(-v.r, v.r) * 0.6, vx: rand(-160, 160), vy: rand(-160, 160), drag: 6, color: '#ffd9a0', life: rand(0.1, 0.25) });
    if (v.hp <= 0) this.destroyVehicle(v);
  }

  destroyVehicle(v) {
    if (!v.alive) return;
    v.alive = false;
    this.vehicles = this.vehicles.filter((o) => o !== v);
    const T = v.team;
    if (T) {
      this.msg(`The ${v.T.name} is destroyed! ${T.name} team bails out.`, 'bad');
      this.exitVehicle(T, true);
    }
    Decals.scorch(this, v.x, v.y, v.r * 2.2);
    Decals.corpse(this, drawVehicle, v);
    this.explode(v.x, v.y, 70, 120, null);
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

  trailPoint(T, dd) {
    const H = T.vehicle || T.members[0];
    let px = H.x, py = H.y, rem = dd;
    for (let k = T.trail.length - 1; k >= 0; k--) {
      const q = T.trail[k];
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
        if (p.kind === 'rocket' || Math.random() < 0.35) this.particles.add({ kind: 'smoke', x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-15, 15), drag: 2, size: rand(4, 7), grow: 16, color: '#c8c8c8', alpha: p.kind === 'rocket' ? 0.55 : 0.3, life: rand(0.6, 1.1) });
        this.particles.add({ kind: 'glow', add: true, x: p.x - Math.cos(p.a) * 6, y: p.y - Math.sin(p.a) * 6, size: rand(6, 9), color: '#ffb040', life: 0.08 });
        this.lights.push({ x: p.x, y: p.y, r: 70, c: '#ffb050', i: 0.9 });
      }
      if (boom) {
        if (p.kind === 'grenade') this.explode(p.x, p.y, 62, 170, p.src);
        else this.explode(p.x, p.y, p.R || 58, p.dmg || 190, p.src, p.owner);
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
      const t = this.troopers.find((t) => dist2(t.x, t.y, p.x, p.y) < (t.inVehicle ? 28 : 20) ** 2);
      if (!t) continue;
      p.taken = true;
      Sfx.pickup();
      const T = t.team, who = this.teams.length > 1 ? `${T.name}: ` : '';
      if (p.kind === 'grenades') { T.grenades += 4; this.msg(`${who}+4 grenades`, 'good'); }
      else if (p.kind === 'rockets') { T.rockets += 3; this.msg(`${who}+3 rockets`, 'good'); }
      else {
        for (const s of T.members) s.hp = Math.min(s.maxHp, s.hp + 60);
        if (T.vehicle) T.vehicle.hp = Math.min(T.vehicle.maxHp, T.vehicle.hp + T.vehicle.maxHp * 0.35);
        this.msg(`${who}patched up${T.vehicle ? ' and vehicle repaired' : ''}`, 'good');
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  explode(x, y, R, dmg, src, owner = null) {
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
      if (t === owner) continue;
      const d = dist(t.x, t.y, x, y), rr = R * 0.85 + t.r;
      if (d < rr) this.damageFriendly(t, dmg * 0.9 * (1 - (d / rr) * 0.7), x, y, 300);
    }
    for (const v of this.vehicles.slice()) {
      if (v.team) continue;
      const d = dist(v.x, v.y, x, y);
      if (d < R + v.r) this.damageVehicle(v, dmg * (1 - (d / (R + v.r)) * 0.6));
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
    if (t instanceof Vehicle) return this.damageVehicle(t, dmg);
    if (t.inVehicle) return;
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
        const T = t.team;
        if (T) {
          const wasLeader = T.members[0] === t;
          T.members = T.members.filter((o) => o !== t);
          if (!T.members.length) this.removeTeam(T);
          else if (wasLeader && T.goal && !T.vehicle) T.path = this.map.findPath(T.members[0].x, T.members[0].y, T.goal.x, T.goal.y);
        }
        this.updateLeader();
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
      // Keep aliens out of the squad's personal space and out of vehicles
      for (const t of this.troopers) {
        if (t.inVehicle) continue;
        const m = a.T.colR + t.r;
        const d2 = dist2(a.x, a.y, t.x, t.y);
        if (d2 < m * m && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          this.moveEntity(a, (a.x - t.x) / d * (m - d), (a.y - t.y) / d * (m - d), a.T.colR);
        }
      }
      for (const v of this.vehicles) {
        const m = a.T.colR + v.T.colR + 2;
        const d2 = dist2(a.x, a.y, v.x, v.y);
        if (d2 < m * m && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          this.moveEntity(a, (a.x - v.x) / d * (m - d), (a.y - v.y) / d * (m - d), a.T.colR);
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
      for (const T of this.teams) { if (T.vehicle) this.exitVehicle(T, true); T.path = null; }
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
    const AT = this.team;
    if (AT && AT.marker && AT.path) {
      AT.marker.t += 1 / 60;
      const m = AT.marker;
      g.strokeStyle = `rgba(255,190,80,${0.8 - (m.t % 0.8)})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(m.x, m.y, 4 + (m.t % 0.8) * 14, 0, TAU); g.stroke();
    }
    for (const p of this.pickups) if (inView(p)) drawCrate(g, p, t);
    for (const b of this.barrels) if (inView(b)) drawBarrel(g, b);

    // Shadows
    for (const a of this.aliens) if (inView(a)) drawShadow(g, a.x, a.y, a.r * 1.1, a.r * 0.8, 0.3);
    const multi = this.teams.length > 1;
    if (this.deployed) {
      for (const tr of this.troopers) {
        if (tr.inVehicle) continue;
        drawShadow(g, tr.x, tr.y, 8, 6, 0.3);
        if (multi && tr.team) { g.strokeStyle = tr.team.color; g.globalAlpha = tr.team === AT ? 0.75 : 0.4; g.lineWidth = 1.2; ellipse(g, tr.x, tr.y + 2, 10, 7); g.stroke(); g.globalAlpha = 1; }
        if (tr.marked) { g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.setLineDash([3, 3]); ellipse(g, tr.x, tr.y + 1, 13, 10); g.stroke(); g.setLineDash([]); }
      }
    }
    for (const v of this.vehicles) if (inView(v, 80)) drawShadow(g, v.x, v.y, v.r * 1.15, v.r * 0.85, 0.35);

    // Depth-sorted units and flora
    const list = [];
    for (const a of this.aliens) if (inView(a)) list.push({ y: a.y, d: 1, e: a });
    for (const n of this.nests) if (inView(n, 90)) list.push({ y: n.y - 10, d: 2, e: n });
    if (this.deployed) for (const tr of this.troopers) if (!tr.inVehicle) list.push({ y: tr.y, d: 3, e: tr });
    for (const v of this.vehicles) if (inView(v, 80)) list.push({ y: v.y, d: 6, e: v });
    for (const c of this.colonists) if (c.state !== 'rescued' && c.alive && inView(c)) list.push({ y: c.y, d: 4, e: c });
    const tx0 = Math.max(0, Math.floor(x0 / TILE) - 1), tx1 = Math.min(map.w - 1, Math.floor(x1 / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(y0 / TILE) - 1), ty1 = Math.min(map.h - 1, Math.floor(y1 / TILE) + 1);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const fi = map.floraAt[ty * map.w + tx];
      if (fi >= 0) list.push({ y: map.flora[fi].y + 6, d: 5, e: map.flora[fi] });
    }
    list.sort((a, b) => a.y - b.y);
    const glow = this.biome.floraGlow;
    const L0 = this.focus;
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
      } else if (it.d === 6) {
        drawVehicle(g, e, t);
        if (e.hp < e.maxHp) this.healthBar(g, e.x, e.y - e.r - 10, e.r * 1.6, e.hp / e.maxHp, e.hp / e.maxHp > 0.4 ? '#7dffb0' : '#ff5040');
        if (!e.team && this.deployed && L0 && dist2(L0.x, L0.y, e.x, e.y) < 320 * 320) this.vehicleLabel(g, e, t);
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
    // Team leader chevrons: bright and bobbing for the team you command
    if (this.deployed && this.phase !== 'outro') {
      for (const T of this.teams) {
        const H = T.vehicle || T.members[0];
        if (!H) continue;
        const act = T === AT;
        if (!act && !multi) continue;
        const by = H.y - (T.vehicle ? T.vehicle.r + 16 : 22) + (act ? Math.sin(t * 5) * 1.5 : 0);
        const k = act ? 1 : 0.75;
        g.globalAlpha = act ? 1 : 0.7;
        g.fillStyle = T.color;
        g.beginPath(); g.moveTo(H.x - 4 * k, by - 3 * k); g.lineTo(H.x, by + k); g.lineTo(H.x + 4 * k, by - 3 * k); g.lineTo(H.x + 4 * k, by - k); g.lineTo(H.x, by + 3 * k); g.lineTo(H.x - 4 * k, by - k); g.closePath(); g.fill();
        if (multi) {
          g.font = `600 ${act ? 7 : 6}px "Chakra Petch", sans-serif`; g.textAlign = 'center';
          g.fillText(T.name, H.x, by - 5);
        }
        g.globalAlpha = 1;
      }
    }
    // Throwables and acid
    for (const p of this.throwables) {
      if (p.kind === 'grenade') {
        drawShadow(g, p.x, p.y, 3, 2, 0.35);
        g.save(); g.translate(p.x, p.y - p.z); g.rotate(p.rot);
        g.fillStyle = '#3c4a30'; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
        g.fillStyle = (t * 8) % 1 < 0.5 ? '#ff3030' : '#601010'; g.fillRect(-1, -4, 2, 2);
        g.restore();
      } else if (p.kind === 'shell') {
        g.fillStyle = '#ffe2a0';
        g.beginPath(); g.arc(p.x, p.y, 2.2, 0, TAU); g.fill();
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

  vehicleLabel(g, v, t) {
    const pulse = 0.55 + 0.35 * Math.sin(t * 4);
    const r = v.r + 6;
    g.strokeStyle = `rgba(255,177,58,${pulse})`; g.lineWidth = 1.2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.beginPath(); g.moveTo(v.x + sx * r, v.y + sy * (r - 5)); g.lineTo(v.x + sx * r, v.y + sy * r); g.lineTo(v.x + sx * (r - 5), v.y + sy * r); g.stroke();
    }
    g.font = '600 7px "Chakra Petch", sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.6)';
    const label = `${v.T.name} · ${v.T.seats} seats`;
    const w = g.measureText(label).width + 6;
    g.fillRect(v.x - w / 2, v.y + r + 3, w, 10);
    g.fillStyle = '#ffd08a';
    g.fillText(label, v.x, v.y + r + 11);
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
    const L = this.focus || { x: this.map.start.x, y: this.map.start.y };
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
