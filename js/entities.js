'use strict';
// Units: troopers, aliens, hive nests and colonists.

class Trooper {
  constructor(data, x, y) {
    this.data = data;
    this.x = x; this.y = y;
    this.r = 6.5;
    this.maxHp = 100 + data.rank * 10;
    this.hp = this.maxHp;
    this.face = -Math.PI / 2;
    this.walk = 0; this.moving = false;
    this.fireCd = Math.random() * 0.2;
    this.hitT = 0; this.recoil = 0;
    this.inWater = false; this.leader = false; this.alive = true;
    this.kills = 0;
    this.stepAcc = 0; this.stepSide = 1;
    this.acidT = 0;
  }
  get spread() { return Math.max(0.03, 0.1 - this.data.rank * 0.009); }
  get fireRate() { return Math.max(0.1, 0.17 - this.data.rank * 0.008); }
  get speed() { return 92 + this.data.rank * 2.5; }
  get range() { return 380 + this.data.rank * 12; }
}

const ALIEN_TYPES = {
  skitter: { r: 9, hp: 12, speed: 120, dmg: 20, reach: 7, atkCd: 0.8, sight: 300, mass: 1, ichor: '#9ad42a', colR: 8 },
  spitter: { r: 12, hp: 38, speed: 70, dmg: 26, range: 300, atkCd: 2.3, sight: 340, mass: 1.6, ichor: '#3ad6a0', colR: 10 },
  brute: { r: 19, hp: 260, speed: 58, dmg: 55, reach: 10, atkCd: 1.3, sight: 280, mass: 6, ichor: '#e0a82a', colR: 13 },
  mother: { r: 44, hp: 2600, speed: 30, dmg: 70, reach: 16, atkCd: 1.6, sight: 520, mass: 40, ichor: '#d04ab0', colR: 15 },
};

class Alien {
  constructor(type, x, y) {
    const T = ALIEN_TYPES[type];
    this.type = type; this.T = T;
    this.x = x; this.y = y; this.homeX = x; this.homeY = y;
    this.r = T.r;
    this.hp = this.maxHp = T.hp;
    this.face = Math.random() * TAU;
    this.walk = Math.random() * TAU;
    this.state = 'idle';
    this.target = null;
    this.atkCd = rand(0.3, T.atkCd);
    this.atkAnim = 0; this.hitT = 0;
    this.thinkT = Math.random() * 0.3;
    this.wanderT = rand(0.5, 3); this.wx = x; this.wy = y;
    this.alertDelay = 0;
    this.seed = Math.random() * 100;
    this.kbx = 0; this.kby = 0;
    this.chargeT = 0; this.chargeCd = rand(1, 3);
    this.spawnT = 3; this.volleyT = 2;
    this.stuckT = 0; this.lx = x; this.ly = y; this.jx = 0; this.jy = 0;
    this.charge = 0;
    this.speedMul = rand(0.9, 1.12);
  }

  alert(W, delay = 0) {
    if (this.state === 'hunt') return;
    if (delay > 0) { this.alertDelay = delay; this.state = 'alerting'; return; }
    this.state = 'hunt';
    W.sound('screech', this.x, this.y, 0.8, this.type === 'brute' ? 0.6 : this.type === 'mother' ? 0.4 : 1);
    for (const o of W.aliens) {
      if (o !== this && o.state === 'idle' && dist2(o.x, o.y, this.x, this.y) < 220 * 220) o.alert(W, rand(0.15, 0.6));
    }
  }

  update(dt, W) {
    const T = this.T;
    this.hitT = Math.max(0, this.hitT - dt);
    this.atkAnim = Math.max(0, this.atkAnim - dt * 3);
    this.atkCd -= dt;
    if (this.kbx || this.kby) {
      W.moveEntity(this, this.kbx * dt, this.kby * dt, T.colR);
      this.kbx *= Math.max(0, 1 - 8 * dt); this.kby *= Math.max(0, 1 - 8 * dt);
      if (Math.abs(this.kbx) + Math.abs(this.kby) < 5) this.kbx = this.kby = 0;
    }
    if (this.state === 'alerting') {
      this.alertDelay -= dt;
      if (this.alertDelay <= 0) { this.state = 'idle'; this.alert(W); }
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = rand(0.25, 0.4);
      this.target = W.nearestTarget(this.x, this.y, this.state === 'hunt' ? 2000 : T.sight, this.state !== 'hunt');
      if (this.state === 'idle' && this.target) this.alert(W);
      if (this.state === 'hunt' && !this.target) this.state = 'idle';
    }
    if (this.state === 'idle') return this.wander(dt, W);
    const tg = this.target;
    if (!tg || !tg.alive) { this.thinkT = 0; return; }
    const d = dist(this.x, this.y, tg.x, tg.y);
    const ang = Math.atan2(tg.y - this.y, tg.x - this.x);

    if (this.type === 'spitter') {
      const los = d < T.range && W.map.lineClear(this.x, this.y, tg.x, tg.y);
      if (los) {
        this.face = turnToward(this.face, ang, 6 * dt);
        this.charge = clamp(1 - this.atkCd / 0.8, 0, 1);
        if (this.atkCd <= 0) { W.spit(this, tg); this.atkCd = T.atkCd * rand(0.85, 1.2); this.atkAnim = 1; }
        if (d < 140) this.steer(dt, W, this.x - (tg.x - this.x), this.y - (tg.y - this.y), 0.8);
        return;
      }
      this.charge = 0;
      return this.approach(dt, W, tg, d, 1);
    }

    if (this.type === 'mother') {
      this.spawnT -= dt; this.volleyT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = rand(4.5, 6.5);
        for (let i = 0; i < 3; i++) {
          const a = this.face + Math.PI + rand(-0.8, 0.8);
          W.spawnAlien('skitter', this.x + Math.cos(a) * 50, this.y + Math.sin(a) * 50, true);
        }
      }
      if (this.volleyT <= 0 && d < 420) {
        this.volleyT = rand(3, 4.2);
        for (let i = -2; i <= 2; i++) {
          const a = ang + i * 0.22;
          W.spit(this, { x: this.x + Math.cos(a) * d, y: this.y + Math.sin(a) * d, vx: 0, vy: 0 }, 34);
        }
      }
    }

    const reach = this.r + tg.r + (T.reach || 6);
    if (d < reach) {
      this.face = turnToward(this.face, ang, 8 * dt);
      if (this.atkCd <= 0) {
        this.atkCd = T.atkCd * rand(0.85, 1.15);
        this.atkAnim = 1;
        W.damageFriendly(tg, T.dmg, this.x, this.y, this.type === 'brute' || this.type === 'mother' ? 260 : 60);
      }
      return;
    }
    if (this.type === 'brute') {
      this.chargeCd -= dt;
      if (this.chargeT > 0) this.chargeT -= dt;
      else if (this.chargeCd <= 0 && d < 220 && W.map.lineClear(this.x, this.y, tg.x, tg.y)) {
        this.chargeT = 0.9; this.chargeCd = rand(3, 5);
        W.sound('screech', this.x, this.y, 1, 0.5);
      }
    }
    this.approach(dt, W, tg, d, this.chargeT > 0 ? 2.6 : 1);
  }

  approach(dt, W, tg, d, mul) {
    let gx = tg.x, gy = tg.y;
    if (d > 200 || !W.map.lineClear(this.x, this.y, tg.x, tg.y)) {
      const s = W.map.flowStep(this.x, this.y);
      if (s) { gx = s.x; gy = s.y; }
    }
    if (this.type === 'skitter' && d > 40) {
      // Zig-zag approach
      const a = Math.atan2(gy - this.y, gx - this.x) + Math.PI / 2;
      const z = Math.sin(W.time * 6 + this.seed) * 14;
      gx += Math.cos(a) * z; gy += Math.sin(a) * z;
    }
    this.steer(dt, W, gx + this.jx, gy + this.jy, mul);
    // Unstick
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      const moved = dist(this.x, this.y, this.lx, this.ly);
      if (moved < 8) { this.jx = rand(-40, 40); this.jy = rand(-40, 40); }
      else { this.jx *= 0.3; this.jy *= 0.3; }
      this.lx = this.x; this.ly = this.y; this.stuckT = 0;
    }
  }

  steer(dt, W, gx, gy, mul = 1) {
    const a = Math.atan2(gy - this.y, gx - this.x);
    this.face = turnToward(this.face, a, (this.type === 'mother' ? 2 : 7) * dt);
    const inWater = W.map.tileAt(this.x, this.y) === T_WATER;
    const sp = this.T.speed * this.speedMul * mul * (inWater ? 0.55 : 1);
    const dx = Math.cos(this.face) * sp * dt, dy = Math.sin(this.face) * sp * dt;
    W.moveEntity(this, dx, dy, this.T.colR);
    this.walk += sp * dt * 0.28;
  }

  wander(dt, W) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = rand(1.5, 4);
      this.wx = this.homeX + rand(-70, 70); this.wy = this.homeY + rand(-70, 70);
    }
    if (dist2(this.x, this.y, this.wx, this.wy) > 100) this.steer(dt, W, this.wx, this.wy, 0.35);
  }
}

class Nest {
  constructor(x, y, cfg) {
    this.x = x; this.y = y;
    this.r = 24;
    this.hp = this.maxHp = cfg.hp || 120;
    this.types = cfg.types || ['skitter'];
    this.rate = cfg.rate || 4.5;
    this.maxChildren = cfg.max || 6;
    this.children = 0;
    this.spawnT = rand(1, 2.5);
    this.spawnAnim = 0; this.hitT = 0;
    this.active = false;
    this.alive = true;
    this.seed = Math.random() * 10;
    const rng = makeRng((x * 13 + y * 7) | 0);
    this.shape = [];
    for (let i = 0; i < 14; i++) this.shape.push(rng.range(24, 31));
    this.tendrils = [];
    for (let i = 0; i < 7; i++) {
      const a = rng() * TAU, L = rng.range(36, 64);
      this.tendrils.push({ x: Math.cos(a) * L, y: Math.sin(a) * L, cx: Math.cos(a + 0.5) * L * 0.5, cy: Math.sin(a + 0.5) * L * 0.5, w: rng.range(2, 4) });
    }
  }

  update(dt, W) {
    this.spawnAnim = Math.max(0, this.spawnAnim - dt * 2);
    this.hitT = Math.max(0, this.hitT - dt);
    const near = W.troopers.some((t) => dist2(t.x, t.y, this.x, this.y) < 480 * 480);
    if (!near) return;
    this.active = true;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = this.rate * rand(0.8, 1.2);
      if (this.children < this.maxChildren && W.aliens.length < 90) {
        const a = Math.random() * TAU;
        const al = W.spawnAlien(pick(this.types), this.x + Math.cos(a) * 18, this.y + Math.sin(a) * 18, true);
        if (al) { al.nest = this; this.children++; this.spawnAnim = 1; W.sound('squish', this.x, this.y, 0.7); }
      }
    }
  }
}

class Colonist {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 6;
    this.hp = this.maxHp = 70;
    this.state = 'waiting';
    this.face = Math.random() * TAU;
    this.walk = 0; this.moving = false; this.hitT = 0;
    this.alive = true;
    this.hair = pick(['#2a1a10', '#6a4020', '#c8a060', '#1a1a1a', '#8a3010', '#d8d0c0']);
  }
}
