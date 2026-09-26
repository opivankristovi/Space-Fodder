'use strict';
// Particles and permanent decals (blood, scorch marks, casings, footprints).

class Particles {
  constructor(world) { this.world = world; this.list = []; }

  add(p) {
    if (this.list.length > 2200) this.list.splice(0, 200);
    p.life = p.life ?? 1;
    p.max = p.life;
    p.vx = p.vx || 0; p.vy = p.vy || 0;
    p.drag = p.drag ?? 0;
    p.rot = p.rot ?? Math.random() * TAU;
    this.list.push(p);
    return p;
  }

  update(dt) {
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.z !== undefined) {
        p.vz -= (p.g ?? 600) * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.onLand) { p.onLand(p); if (p.dieOnLand !== false) continue; }
          if (p.bounce && Math.abs(p.vz) > 40) { p.vz = -p.vz * p.bounce; p.vx *= 0.6; p.vy *= 0.6; }
          else { p.vz = 0; p.vx *= 0.8; p.vy *= 0.8; p.vr = 0; }
        }
      }
      if (p.grow) p.size += p.grow * dt;
      L[j++] = p;
    }
    L.length = j;
  }

  draw(g, additive, view) {
    for (const p of this.list) {
      if (!!p.add !== additive) continue;
      if (p.x < view.x0 - 80 || p.x > view.x1 + 80 || p.y < view.y0 - 80 || p.y > view.y1 + 80) continue;
      const t = p.life / p.max;
      const y = p.y - (p.z || 0);
      switch (p.kind) {
        case 'glow': case 'smoke': {
          const s = p.size;
          g.globalAlpha = (p.alpha ?? 1) * (p.kind === 'smoke' ? t * t : t);
          g.drawImage(glowSprite(p.color, p.hard || 0), p.x - s, y - s, s * 2, s * 2);
          break;
        }
        case 'spark': {
          g.globalAlpha = t;
          g.strokeStyle = p.color; g.lineWidth = p.size || 1.2;
          g.beginPath(); g.moveTo(p.x, y); g.lineTo(p.x - p.vx * 0.03, y - p.vy * 0.03); g.stroke();
          break;
        }
        case 'drop': {
          g.globalAlpha = 1;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, y, p.size, 0, TAU); g.fill();
          break;
        }
        case 'chunk': case 'casing': {
          g.globalAlpha = Math.min(1, t * 3);
          g.save(); g.translate(p.x, y); g.rotate(p.rot);
          g.fillStyle = p.color;
          g.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          g.restore();
          break;
        }
        case 'ring': {
          g.globalAlpha = t * (p.alpha ?? 0.8);
          g.strokeStyle = p.color; g.lineWidth = 2 + 4 * t;
          g.beginPath(); g.arc(p.x, y, p.size2 + (p.size - p.size2) * t, 0, TAU); g.stroke();
          break;
        }
      }
    }
    g.globalAlpha = 1;
  }
}

// Decal painting helpers (draw into the map's permanent decal canvas).
const Decals = {
  splat(world, x, y, color, size, count = 7) {
    const g = world.map.decals.getContext('2d');
    g.save();
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    g.beginPath(); g.ellipse(x, y, size, size * 0.8, Math.random() * TAU, 0, TAU); g.fill();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, d = size * rand(0.6, 2.2), r = size * rand(0.12, 0.4);
      g.globalAlpha = rand(0.5, 0.85);
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r, 0, TAU); g.fill();
    }
    g.restore();
  },
  drop(world, x, y, color, r) {
    const g = world.map.decals.getContext('2d');
    g.globalAlpha = 0.75; g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.globalAlpha = 1;
  },
  scorch(world, x, y, r) {
    const g = world.map.decals.getContext('2d');
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(8,6,6,0.75)'); gr.addColorStop(0.55, 'rgba(15,10,8,0.45)'); gr.addColorStop(1, 'rgba(20,12,8,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * TAU;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2);
      g.lineTo(x + Math.cos(a) * r * rand(0.6, 1.1), y + Math.sin(a) * r * rand(0.6, 1.1)); g.stroke();
    }
  },
  casing(world, x, y) {
    const g = world.map.decals.getContext('2d');
    g.save(); g.translate(x, y); g.rotate(Math.random() * TAU);
    g.fillStyle = '#b8903a'; g.fillRect(-1.3, -0.6, 2.6, 1.2);
    g.restore();
  },
  footprint(world, x, y, a, side) {
    const b = world.map.biome;
    const t = world.map.tileAt(x, y);
    if (t !== T_GROUND) return;
    const g = world.map.decals.getContext('2d');
    const px = x + Math.cos(a + Math.PI / 2) * side * 3, py = y + Math.sin(a + Math.PI / 2) * side * 3;
    g.save(); g.translate(px, py); g.rotate(a);
    g.fillStyle = b.footprint;
    g.beginPath(); g.ellipse(0, 0, 2.6, 1.4, 0, 0, TAU); g.fill();
    g.restore();
  },
  corpse(world, drawFn, e) {
    const g = world.map.decals.getContext('2d');
    g.save();
    g.globalAlpha = 0.95;
    drawFn(g, e, world.time, true);
    g.restore();
  },
};
