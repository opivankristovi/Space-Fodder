'use strict';
// Drivable vehicles: stats and top-down sprites.

const VEHICLE_TYPES = {
  crawler: {
    name: 'Crawler', seats: 4, hp: 320, speed: 175, accel: 240, turn: 2.6, r: 16, colR: 12, mode: 'foot',
    weapon: 'gun', gun: { rate: 0.085, dmg: 14, range: 430, spread: 0.05, len: 15 }, crush: true, waterMul: 0.55, turretTurn: 9,
    blurb: 'fast six-wheel buggy with a roof autocannon',
  },
  tank: {
    name: 'Warden tank', seats: 3, hp: 850, speed: 88, accel: 150, turn: 1.5, r: 20, colR: 14, mode: 'foot',
    weapon: 'cannon', cannon: { cd: 1.05, dmg: 210, R: 58, range: 500, len: 28 }, crush: true, waterMul: 0.5, turretTurn: 2.6,
    blurb: 'slow heavy tank with an explosive cannon',
  },
  skimmer: {
    name: 'Skimmer', seats: 2, hp: 210, speed: 210, accel: 320, turn: 3.3, r: 14, colR: 11, mode: 'hover',
    weapon: 'gun', gun: { rate: 0.11, dmg: 11, range: 400, spread: 0.035, len: 14 }, crush: false, waterMul: 1, turretTurn: 12,
    blurb: 'hovercraft that crosses water, acid and lava',
  },
};

let _vehicleSeq = 0;
class Vehicle {
  constructor(type, x, y, face = -Math.PI / 2) {
    const T = VEHICLE_TYPES[type];
    this.id = ++_vehicleSeq;
    this.type = type; this.T = T;
    this.x = x; this.y = y; this.r = T.r;
    this.face = face; this.turret = face;
    this.vel = 0;
    this.hp = this.maxHp = T.hp;
    this.team = null;
    this.alive = true;
    this.fireCd = 0; this.hitT = 0; this.recoil = 0;
    this.roll = 0; this.stuckT = 0; this.autoT = 0; this.smokeT = 0; this.barrel = 1;
  }
}

function _wheel(g, x, y, w, h, roll) {
  g.fillStyle = '#16191c';
  rrect(g, x - w / 2, y - h / 2, w, h, 2); g.fill();
  g.strokeStyle = 'rgba(120,120,120,0.35)'; g.lineWidth = 0.8;
  const off = roll % 3;
  for (let k = -w / 2 + off; k < w / 2; k += 3) { g.beginPath(); g.moveTo(x + k, y - h / 2 + 0.5); g.lineTo(x + k, y + h / 2 - 0.5); g.stroke(); }
}

function drawCrawler(g, v, time, dead) {
  g.save(); g.translate(v.x, v.y); g.rotate(v.face);
  for (const wx of [-11, 0, 11]) for (const s of [-1, 1]) _wheel(g, wx, s * 10.5, 8, 5, v.roll);
  // Chassis
  g.fillStyle = dead ? '#2a2620' : radial(g, 0, -2, 22, '#c8b27a', '#4d4430');
  g.beginPath();
  g.moveTo(-17, -8); g.lineTo(11, -8.5); g.lineTo(18, -4); g.lineTo(18, 4); g.lineTo(11, 8.5); g.lineTo(-17, 8); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-8, -8); g.lineTo(-8, 8); g.moveTo(3, -8.3); g.lineTo(3, 8.3); g.stroke();
  // Hazard stripes on the tail
  g.fillStyle = dead ? '#3a3020' : '#e6a13a';
  for (let k = -7; k < 7; k += 4) g.fillRect(-17, k, 2.5, 2);
  // Canopy
  g.fillStyle = dead ? '#1a2024' : radial(g, 10, -2, 7, '#c8fbff', '#1d4a5a');
  g.beginPath(); g.moveTo(15, 0); g.lineTo(11, -5.5); g.lineTo(5, -5.5); g.lineTo(5, 5.5); g.lineTo(11, 5.5); g.closePath(); g.fill();
  // Roll bars
  g.strokeStyle = dead ? '#222' : '#39424a'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(-12, -7); g.lineTo(-12, 7); g.moveTo(-3, -7); g.lineTo(-3, 7); g.stroke();
  // Headlights
  if (!dead) {
    g.fillStyle = v.team ? '#fff6d0' : '#8a8a70';
    g.fillRect(17, -6, 1.6, 2.4); g.fillRect(17, 3.6, 1.6, 2.4);
  }
  // Autocannon turret
  g.rotate(v.turret - v.face);
  g.fillStyle = dead ? '#1a1a1a' : '#23292e';
  g.fillRect(-3 - v.recoil, -2.8, 15, 1.8); g.fillRect(-3 - v.recoil, 1, 15, 1.8);
  g.fillStyle = dead ? '#262626' : radial(g, -5, 0, 6, '#6a747c', '#1f2429');
  g.beginPath(); g.arc(-5, 0, 5, 0, TAU); g.fill();
  g.restore();
}

function drawTank(g, v, time, dead) {
  g.save(); g.translate(v.x, v.y); g.rotate(v.face);
  // Tracks
  for (const s of [-1, 1]) {
    g.fillStyle = '#15181a';
    rrect(g, -23, s * 13 - 5, 46, 10, 3); g.fill();
    g.strokeStyle = 'rgba(140,140,140,0.3)'; g.lineWidth = 1;
    const off = v.roll % 4;
    for (let k = -22 + off; k < 22; k += 4) { g.beginPath(); g.moveTo(k, s * 13 - 4.5); g.lineTo(k, s * 13 + 4.5); g.stroke(); }
  }
  // Hull
  g.fillStyle = dead ? '#262a22' : radial(g, 0, -4, 28, '#8a957a', '#2b3226');
  g.beginPath();
  g.moveTo(-21, -10); g.lineTo(15, -10); g.lineTo(22, -5); g.lineTo(22, 5); g.lineTo(15, 10); g.lineTo(-21, 10); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.8;
  for (let k = -19; k < -10; k += 2) { g.beginPath(); g.moveTo(k, -7); g.lineTo(k, 7); g.stroke(); }
  g.strokeRect(-8, -9, 20, 18);
  g.fillStyle = dead ? '#302a20' : '#e6a13a';
  g.fillRect(18, -9, 3, 2); g.fillRect(18, 7, 3, 2);
  if (!dead && v.team) { g.fillStyle = '#fff6d0'; g.fillRect(21, -7, 1.5, 2.5); g.fillRect(21, 4.5, 1.5, 2.5); }
  // Turret
  g.rotate(v.turret - v.face);
  g.translate(-2, 0);
  g.fillStyle = dead ? '#161616' : '#2a2f2a';
  g.fillRect(6 - v.recoil * 4, -2.2, 26, 4.4);
  g.fillStyle = dead ? '#161616' : '#1d211d';
  g.fillRect(28 - v.recoil * 4, -3.2, 5, 6.4);
  g.fillStyle = dead ? '#2a2c26' : radial(g, -2, -3, 14, '#a4af92', '#39412f');
  g.beginPath();
  g.moveTo(10, -6); g.lineTo(4, -10); g.lineTo(-8, -10); g.lineTo(-12, -5); g.lineTo(-12, 5); g.lineTo(-8, 10); g.lineTo(4, 10); g.lineTo(10, 6); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
  g.fillStyle = dead ? '#1d1d1d' : '#4a5242';
  g.beginPath(); g.arc(-4, -3, 3.2, 0, TAU); g.fill();
  g.restore();
}

function drawSkimmer(g, v, time, dead) {
  g.save(); g.translate(v.x, v.y); g.rotate(v.face);
  if (!dead) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 14);
    g.fillStyle = `rgba(120,230,255,${0.18 + pulse * 0.1})`;
    ellipse(g, -1, 0, 20, 15); g.fill();
  }
  // Fan pods
  for (const s of [-1, 1]) {
    g.fillStyle = dead ? '#1f2326' : '#2e363c';
    g.beginPath(); g.arc(-8, s * 11, 6.5, 0, TAU); g.fill();
    g.save(); g.translate(-8, s * 11); g.rotate(dead ? 0.4 : time * 30 * s);
    g.strokeStyle = dead ? '#444' : 'rgba(210,230,240,0.8)'; g.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) { g.rotate(TAU / 3); g.beginPath(); g.moveTo(0, 0); g.lineTo(5.5, 0); g.stroke(); }
    g.restore();
  }
  // Hull
  g.fillStyle = dead ? '#2a2e30' : radial(g, 2, -3, 20, '#e6eff3', '#43535e');
  g.beginPath();
  g.moveTo(19, 0);
  g.quadraticCurveTo(14, -7.5, 0, -7.5);
  g.lineTo(-14, -6); g.lineTo(-15, 6); g.lineTo(0, 7.5);
  g.quadraticCurveTo(14, 7.5, 19, 0); g.fill();
  g.fillStyle = dead ? '#302a20' : '#e6a13a';
  g.fillRect(-12, -1.2, 18, 2.4);
  g.fillStyle = dead ? '#1a2024' : radial(g, 10, -1, 6, '#d0fbff', '#1c4658');
  ellipse(g, 9, 0, 5, 3.6); g.fill();
  // Twin guns
  g.rotate(v.turret - v.face);
  g.fillStyle = dead ? '#1a1a1a' : '#1f252a';
  g.fillRect(2 - v.recoil, -4.2, 14, 1.6); g.fillRect(2 - v.recoil, 2.6, 14, 1.6);
  g.restore();
}

const VEHICLE_DRAW = { crawler: drawCrawler, tank: drawTank, skimmer: drawSkimmer };

function drawVehicle(g, v, time, dead = false) {
  VEHICLE_DRAW[v.type](g, v, time, dead);
  if (v.hitT > 0 && !dead) { g.fillStyle = `rgba(255,255,255,${v.hitT * 3})`; ellipse(g, v.x, v.y, v.r, v.r * 0.8); g.fill(); }
}
