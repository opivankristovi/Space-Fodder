'use strict';
// Vector sprite drawing for every unit and prop. All art is drawn in code.

const PAL = {
  armor: '#5f7890', armorHi: '#a9c0d2', armorLo: '#2a3a48', pack: '#3a4652', boot: '#1d2328', gun: '#1b2025', visor: '#7ff0ff',
  skitter: { lo: '#24121b', mid: '#5f2a3b', hi: '#c07466', eye: '#ffd23a', leg: '#1b0f14' },
  spitter: { lo: '#152a26', mid: '#2f5a4a', hi: '#79b58f', sac: '#8dff6a', sacLo: '#1f5a2a', eye: '#ff5a3a', leg: '#0e1a16' },
  brute: { lo: '#2e1d10', mid: '#6b4a2a', hi: '#d6a868', claw: '#efe2c4', eye: '#ff3a2a', leg: '#1e130a' },
  mother: { lo: '#1d0c24', mid: '#51235e', hi: '#b267c7', sac: '#ff6ad5', sacLo: '#4a1040', eye: '#ffe23a', leg: '#140818' },
};
const DEAD_PAL = {};
for (const k of ['skitter', 'spitter', 'brute', 'mother']) {
  DEAD_PAL[k] = {};
  for (const [n, v] of Object.entries(PAL[k])) DEAD_PAL[k][n] = shade(v, -0.45);
}

function ellipse(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); }
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function radial(g, x, y, r, c0, c1) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  return gr;
}

function drawShadow(g, x, y, rx, ry, a = 0.35) {
  g.fillStyle = `rgba(0,0,0,${a})`;
  ellipse(g, x + rx * 0.3, y + ry * 0.45, rx, ry);
  g.fill();
}

// ------------------------------------------------------------------ trooper
function drawTrooper(g, t, time, dead = false) {
  g.save();
  g.translate(t.x, t.y);
  g.rotate(t.face);
  const walk = t.moving ? Math.sin(t.walk) * 4 : 0;
  const k = dead ? 0.55 : 1;
  const col = (c) => (dead ? shade(c, -0.4) : c);
  if (!t.inWater || dead) {
    g.fillStyle = col(PAL.boot);
    rrect(g, -3 + walk, -6.5, 7, 3.6, 1.5); g.fill();
    rrect(g, -3 - walk, 2.9, 7, 3.6, 1.5); g.fill();
  }
  // Backpack with antenna for the squad leader.
  g.fillStyle = col(PAL.pack);
  rrect(g, -10, -5, 6, 10, 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(-9, -4, 4, 1.5);
  if (t.leader && !dead) {
    g.strokeStyle = '#222'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-9, -4); g.lineTo(-15, -8); g.stroke();
    g.fillStyle = (time * 3) % 1 < 0.5 ? '#ff4040' : '#661010';
    g.beginPath(); g.arc(-15, -8, 1, 0, TAU); g.fill();
  }
  // Torso armour
  g.fillStyle = dead ? col(PAL.armor) : radial(g, 0, 0, 9, PAL.armorHi, PAL.armorLo);
  ellipse(g, -1, 0, 5.8, 8.2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(-4, -5); g.lineTo(2, 0); g.lineTo(-4, 5); g.stroke();
  // Rifle and arms
  const rc = t.recoil || 0;
  g.fillStyle = col(PAL.gun);
  g.fillRect(1 - rc, 1.4, 17, 2.6);
  g.fillRect(6 - rc, 3.6, 3, 2.4);
  g.fillStyle = '#39424a';
  g.fillRect(12 - rc, 1.0, 3, 3.4);
  g.fillStyle = col(PAL.armor);
  ellipse(g, 4 - rc * 0.5, 3.2, 2.4, 1.8); g.fill();
  ellipse(g, 10 - rc * 0.5, 2.7, 2.1, 1.7); g.fill();
  // Shoulder pads with rank colour
  const rcol = RANK_COLORS[Math.min(t.rank || 0, RANK_COLORS.length - 1)];
  for (const s of [-1, 1]) {
    g.fillStyle = dead ? col(PAL.armor) : radial(g, 0.5, s * 7, 3.6, PAL.armorHi, PAL.armor);
    ellipse(g, 0, s * 7, 3.3, 3); g.fill();
    g.fillStyle = col(rcol);
    g.fillRect(-1.6, s * 7 - (s > 0 ? -0.4 : 1.6), 3.2, 1.2);
  }
  // Helmet and visor
  g.fillStyle = dead ? col(PAL.armor) : radial(g, 1, 0, 5.4, '#b9cddd', '#2f3f4c');
  g.beginPath(); g.arc(1, 0, 5, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(-3.5, 0); g.lineTo(0, 0); g.stroke();
  if (!dead) {
    g.fillStyle = PAL.visor;
    g.shadowColor = PAL.visor; g.shadowBlur = 5;
    g.beginPath(); g.arc(1.2, 0, 4.2, -0.9, 0.9); g.arc(1.2, 0, 2.2, 0.9, -0.9, true); g.fill();
    g.shadowBlur = 0;
  }
  g.restore();
  if (t.hitT > 0 && !dead) {
    g.fillStyle = `rgba(255,80,60,${t.hitT * 2.2})`;
    ellipse(g, t.x, t.y, 9, 9); g.fill();
  }
  if (t.inWater && !dead) {
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    ellipse(g, t.x, t.y + 2, 10 + Math.sin(time * 6) * 1.5, 6); g.stroke();
  }
  void k;
}

// ------------------------------------------------------------------ aliens
function legPair(g, bx, side, reach, knee, swing, width) {
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(bx, side * 2.5);
  g.quadraticCurveTo(bx + swing * 0.3 + 2, side * knee, bx + swing + 1, side * reach);
  g.stroke();
}

function drawSkitter(g, e, time, dead = false) {
  const P = dead ? DEAD_PAL.skitter : PAL.skitter;
  g.save(); g.translate(e.x, e.y); g.rotate(e.face);
  const s = e.scale || 1; g.scale(s, s);
  g.strokeStyle = P.leg; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const phase = e.walk + ((i + (side > 0 ? 1 : 0)) % 2) * Math.PI;
      const sw = dead ? -3 : Math.sin(phase) * 3.5;
      const reach = dead ? 7 : 15 - i;
      legPair(g, 3 - i * 4, side, reach, dead ? 6 : 10, sw + (1 - i) * 2, 1.8);
    }
  }
  // Abdomen
  g.fillStyle = radial(g, -7, 0, 8, P.hi, P.lo);
  ellipse(g, -7, 0, 7.5, 5.8); g.fill();
  g.strokeStyle = P.lo; g.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(-4 - k * 3, 0, 5.2 - k * 0.8, 1.9, 4.4); g.stroke(); }
  // Thorax and head
  g.fillStyle = radial(g, 0, 0, 5, P.hi, P.mid);
  ellipse(g, 0, 0, 4.4, 4); g.fill();
  g.fillStyle = radial(g, 5, 0, 4, P.hi, P.lo);
  ellipse(g, 5, 0, 3.6, 3.3); g.fill();
  // Mandibles
  const open = dead ? 0.2 : 0.35 + (e.atkAnim || 0) * 0.8;
  g.strokeStyle = P.hi; g.lineWidth = 1.2;
  for (const side of [-1, 1]) {
    g.beginPath(); g.moveTo(7, side * 2);
    g.quadraticCurveTo(11, side * (2 + open * 4), 11.5, side * (0.5 + open * 1.5)); g.stroke();
  }
  if (!dead) {
    g.fillStyle = P.eye; g.shadowColor = P.eye; g.shadowBlur = 4;
    g.beginPath(); g.arc(6.5, -1.6, 0.9, 0, TAU); g.arc(6.5, 1.6, 0.9, 0, TAU); g.fill();
    g.shadowBlur = 0;
  }
  g.restore();
}

function drawSpitter(g, e, time, dead = false) {
  const P = dead ? DEAD_PAL.spitter : PAL.spitter;
  g.save(); g.translate(e.x, e.y); g.rotate(e.face);
  g.strokeStyle = P.leg; g.lineCap = 'round';
  for (let i = 0; i < 2; i++) for (const side of [-1, 1]) {
    const phase = e.walk + ((i + (side > 0 ? 1 : 0)) % 2) * Math.PI;
    const sw = dead ? -3 : Math.sin(phase) * 3;
    legPair(g, 2 - i * 6, side, dead ? 8 : 16, dead ? 7 : 12, sw + (i ? -2 : 2), 2.2);
  }
  const pulse = dead ? 0.2 : 0.5 + 0.5 * Math.sin(time * 5 + e.seed);
  const swell = 1 + (e.charge || 0) * 0.25;
  // Acid sac
  const sg = g.createRadialGradient(-9, -2, 1, -9, 0, 11 * swell);
  sg.addColorStop(0, dead ? P.sacLo : P.sac); sg.addColorStop(0.55 - pulse * 0.15, P.sacLo); sg.addColorStop(1, P.lo);
  g.fillStyle = sg;
  ellipse(g, -9, 0, 10 * swell, 8 * swell); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8;
  for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(-16, k * 4); g.quadraticCurveTo(-9, k * 7, -2, k * 2); g.stroke(); }
  // Thorax / head with spout
  g.fillStyle = radial(g, 1, 0, 6, P.hi, P.mid);
  ellipse(g, 1, 0, 5.5, 5); g.fill();
  g.fillStyle = radial(g, 7, 0, 4, P.hi, P.lo);
  ellipse(g, 7, 0, 4, 3.4); g.fill();
  g.fillStyle = P.lo;
  g.fillRect(9, -1.4, 5, 2.8);
  if (!dead) {
    g.fillStyle = P.sac; g.shadowColor = P.sac; g.shadowBlur = 5;
    g.beginPath(); g.arc(14, 0, 1.3, 0, TAU); g.fill();
    g.fillStyle = P.eye; g.shadowColor = P.eye;
    g.beginPath(); g.arc(8, -2.3, 0.9, 0, TAU); g.arc(8, 2.3, 0.9, 0, TAU); g.fill();
    g.shadowBlur = 0;
  }
  g.restore();
}

function drawBrute(g, e, time, dead = false) {
  const P = dead ? DEAD_PAL.brute : PAL.brute;
  g.save(); g.translate(e.x, e.y); g.rotate(e.face);
  g.strokeStyle = P.leg; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
    const phase = e.walk + ((i + (side > 0 ? 1 : 0)) % 2) * Math.PI;
    const sw = dead ? -4 : Math.sin(phase) * 5;
    legPair(g, 4 - i * 9, side, dead ? 14 : 26, dead ? 12 : 20, sw, 4);
  }
  // Scythe claws
  const swing = (e.atkAnim || 0);
  for (const side of [-1, 1]) {
    g.save();
    g.translate(12, side * 9);
    g.rotate(side * (0.5 - swing * 0.9));
    g.fillStyle = P.lo;
    rrect(g, -2, -2.5, 12, 5, 2); g.fill();
    g.fillStyle = radial(g, 16, 0, 12, P.claw, shade(P.claw, -0.5));
    g.beginPath(); g.moveTo(8, -3); g.quadraticCurveTo(22, -6 * side, 26, 4 * side); g.quadraticCurveTo(18, -1 * side, 8, 3); g.closePath(); g.fill();
    g.restore();
  }
  // Armoured plates, back to front
  for (let k = 0; k < 4; k++) {
    const x = -14 + k * 7, r = 12 - Math.abs(k - 1.5) * 1.6;
    g.fillStyle = radial(g, x, 0, r + 2, P.hi, P.lo);
    ellipse(g, x, 0, r * 0.8, r * 1.25); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(x - 1, 0, r * 0.9, -1.2, 1.2); g.stroke();
  }
  // Spikes on back
  g.fillStyle = P.claw;
  for (let k = 0; k < 3; k++) {
    const x = -16 + k * 7;
    g.beginPath(); g.moveTo(x - 2, -1.5); g.lineTo(x - 7, 0); g.lineTo(x - 2, 1.5); g.fill();
  }
  // Head
  g.fillStyle = radial(g, 13, 0, 6, P.hi, P.lo);
  ellipse(g, 13, 0, 5.5, 6.5); g.fill();
  if (!dead) {
    g.fillStyle = P.eye; g.shadowColor = P.eye; g.shadowBlur = 6;
    for (const s of [-1, 1]) { g.beginPath(); g.arc(16, s * 2.5, 1.2, 0, TAU); g.fill(); }
    g.shadowBlur = 0;
  }
  // Damage cracks
  if (!dead && e.hp < e.maxHp * 0.6) {
    g.strokeStyle = 'rgba(255,200,80,0.6)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-10, -6); g.lineTo(-6, -2); g.lineTo(-8, 3); g.moveTo(2, 5); g.lineTo(5, 1); g.stroke();
  }
  g.restore();
}

function drawMother(g, e, time, dead = false) {
  const P = dead ? DEAD_PAL.mother : PAL.mother;
  g.save(); g.translate(e.x, e.y); g.rotate(e.face);
  g.strokeStyle = P.leg; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
    const phase = e.walk + ((i + (side > 0 ? 1 : 0)) % 2) * Math.PI;
    const sw = dead ? -6 : Math.sin(phase) * 8;
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(12 - i * 12, side * 12);
    g.quadraticCurveTo(18 - i * 12 + sw * 0.3, side * 48, 10 - i * 13 + sw, side * 66); g.stroke();
    g.strokeStyle = P.mid; g.lineWidth = 2;
    g.beginPath(); g.moveTo(12 - i * 12, side * 12); g.quadraticCurveTo(18 - i * 12 + sw * 0.3, side * 48, 10 - i * 13 + sw, side * 66); g.stroke();
    g.strokeStyle = P.leg;
  }
  // Egg sac
  const pulse = dead ? 0 : 0.5 + 0.5 * Math.sin(time * 2.2);
  const sg = g.createRadialGradient(-40, -6, 4, -38, 0, 42);
  sg.addColorStop(0, dead ? P.sacLo : P.sac); sg.addColorStop(0.45 + pulse * 0.1, P.sacLo); sg.addColorStop(1, P.lo);
  g.fillStyle = sg;
  ellipse(g, -38, 0, 40, 30); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(-74, k * 8); g.quadraticCurveTo(-40, k * 16, -6, k * 4); g.stroke(); }
  if (!dead) {
    g.fillStyle = `rgba(255,150,230,${0.25 + pulse * 0.3})`;
    for (let k = 0; k < 6; k++) { ellipse(g, -30 - (k % 3) * 14, (k < 3 ? -1 : 1) * (8 + (k % 2) * 6), 5, 4); g.fill(); }
  }
  // Armoured thorax
  g.fillStyle = radial(g, 6, 0, 22, P.hi, P.lo);
  ellipse(g, 6, 0, 18, 22); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
  g.beginPath(); g.arc(2, 0, 16, -1.2, 1.2); g.stroke();
  // Crown of spikes
  g.fillStyle = '#e8d8f0';
  for (let k = -3; k <= 3; k++) {
    const a = k * 0.35;
    g.save(); g.translate(20, 0); g.rotate(a + Math.PI);
    g.beginPath(); g.moveTo(0, -3); g.lineTo(18, 0); g.lineTo(0, 3); g.fill();
    g.restore();
  }
  // Head and tusks
  g.fillStyle = radial(g, 28, 0, 12, P.hi, P.lo);
  ellipse(g, 28, 0, 11, 13); g.fill();
  const open = (e.atkAnim || 0);
  g.fillStyle = '#efe2c4';
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(34, s * 6);
    g.quadraticCurveTo(50, s * (10 + open * 8), 52, s * (2 + open * 4)); g.quadraticCurveTo(44, s * 4, 34, s * 2); g.fill();
  }
  if (!dead) {
    g.fillStyle = P.eye; g.shadowColor = P.eye; g.shadowBlur = 10;
    for (const [x, y] of [[33, -5], [33, 5], [36, -2], [36, 2]]) { g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.fill(); }
    g.shadowBlur = 0;
  }
  g.restore();
}

const ALIEN_DRAW = { skitter: drawSkitter, spitter: drawSpitter, brute: drawBrute, mother: drawMother };

function drawNest(g, n, time) {
  g.save(); g.translate(n.x, n.y);
  const pulse = 0.5 + 0.5 * Math.sin(time * 3 + n.seed);
  const open = n.spawnAnim || 0;
  // Tendrils creeping across the ground
  g.strokeStyle = '#3a1830'; g.lineCap = 'round';
  for (const t of n.tendrils) {
    g.lineWidth = t.w;
    g.beginPath(); g.moveTo(0, 0);
    g.quadraticCurveTo(t.cx, t.cy, t.x, t.y); g.stroke();
  }
  // Mound
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath();
  n.shape.forEach((r, i) => { const a = (i / n.shape.length) * TAU; const x = Math.cos(a) * r + 5, y = Math.sin(a) * r * 0.9 + 7; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.fill();
  g.fillStyle = radial(g, 0, 0, 34, '#8a5a78', '#2a1024');
  g.beginPath();
  n.shape.forEach((r, i) => { const a = (i / n.shape.length) * TAU; const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.9; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.fill();
  // Ridges
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + n.seed;
    g.beginPath(); g.moveTo(Math.cos(a) * 10, Math.sin(a) * 9); g.quadraticCurveTo(Math.cos(a + 0.3) * 20, Math.sin(a + 0.3) * 18, Math.cos(a) * 26, Math.sin(a) * 23); g.stroke();
  }
  g.strokeStyle = 'rgba(255,200,230,0.15)'; g.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + n.seed - 0.1;
    g.beginPath(); g.moveTo(Math.cos(a) * 10, Math.sin(a) * 9 - 1); g.quadraticCurveTo(Math.cos(a + 0.3) * 20, Math.sin(a + 0.3) * 18 - 1, Math.cos(a) * 26, Math.sin(a) * 23 - 1); g.stroke();
  }
  // Orifice
  const or = 8 + open * 5;
  const og = g.createRadialGradient(0, 0, 0, 0, 0, or + 3);
  og.addColorStop(0, `rgba(255,${190 + pulse * 50},80,1)`);
  og.addColorStop(0.5, '#6a1a10');
  og.addColorStop(1, '#1a0610');
  g.fillStyle = og;
  ellipse(g, 0, 0, or + 3, (or + 3) * 0.8); g.fill();
  g.strokeStyle = '#c090a8'; g.lineWidth = 1.5;
  ellipse(g, 0, 0, or + 3, (or + 3) * 0.8); g.stroke();
  // Damage
  if (n.hp < n.maxHp) {
    const d = 1 - n.hp / n.maxHp;
    g.strokeStyle = `rgba(255,180,60,${0.4 + d * 0.5})`; g.lineWidth = 1;
    for (let k = 0; k < Math.ceil(d * 6); k++) {
      const a = k * 1.1 + n.seed;
      g.beginPath(); g.moveTo(Math.cos(a) * 12, Math.sin(a) * 10); g.lineTo(Math.cos(a + 0.2) * 20, Math.sin(a + 0.2) * 17); g.lineTo(Math.cos(a - 0.1) * 26, Math.sin(a - 0.1) * 22); g.stroke();
    }
  }
  g.restore();
}

function drawColonist(g, c, time) {
  g.save(); g.translate(c.x, c.y);
  if (c.state === 'waiting') {
    // Holo marker
    const bob = Math.sin(time * 4) * 2;
    g.strokeStyle = `rgba(120,240,255,${0.5 + 0.3 * Math.sin(time * 5)})`; g.lineWidth = 1.2;
    ellipse(g, 0, 2, 14, 8); g.stroke();
    g.fillStyle = '#7ff0ff';
    g.font = 'bold 12px "Chakra Petch", sans-serif'; g.textAlign = 'center';
    g.fillText('!', 0, -16 + bob);
  }
  g.rotate(c.face);
  const walk = c.moving ? Math.sin(c.walk) * 3.5 : 0;
  g.fillStyle = '#2b2b30';
  rrect(g, -2 + walk, -5, 5, 3, 1.2); g.fill();
  rrect(g, -2 - walk, 2, 5, 3, 1.2); g.fill();
  g.fillStyle = radial(g, 0, 0, 7, '#ffb060', '#b3561a');
  ellipse(g, -1, 0, 4.5, 6.5); g.fill();
  // Arms: waving when waiting
  g.strokeStyle = '#e07a2a'; g.lineWidth = 2.2; g.lineCap = 'round';
  if (c.state === 'waiting') {
    const w = Math.sin(time * 9) * 0.6;
    g.beginPath(); g.moveTo(0, -5); g.lineTo(6 + w * 3, -9); g.moveTo(0, 5); g.lineTo(6 - w * 3, 9); g.stroke();
  } else {
    g.beginPath(); g.moveTo(0, -5); g.lineTo(3 - walk, -7); g.moveTo(0, 5); g.lineTo(3 + walk, 7); g.stroke();
  }
  g.fillStyle = radial(g, 1, 0, 4, '#e8b890', '#8a5a40');
  g.beginPath(); g.arc(1, 0, 3.6, 0, TAU); g.fill();
  g.fillStyle = c.hair;
  g.beginPath(); g.arc(0, 0, 3.7, Math.PI * 0.55, Math.PI * 1.45); g.fill();
  g.restore();
  if (c.hitT > 0) { g.fillStyle = `rgba(255,80,60,${c.hitT * 2})`; ellipse(g, c.x, c.y, 8, 8); g.fill(); }
}

function drawCrate(g, p, time) {
  const bob = Math.sin(time * 3 + p.x) * 1.5;
  g.save(); g.translate(p.x, p.y);
  g.fillStyle = 'rgba(0,0,0,0.35)'; rrect(g, -8, -6, 19, 17, 2); g.fill();
  g.fillStyle = radial(g, -2, -3, 16, '#8e9a6a', '#39402a');
  rrect(g, -10, -9, 20, 18, 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
  rrect(g, -10, -9, 20, 18, 2); g.stroke();
  g.fillStyle = '#e6b13a';
  g.fillRect(-10, -2, 20, 3);
  // Hologram icon
  const col = p.kind === 'medkit' ? '#ff6a6a' : p.kind === 'rockets' ? '#ffb13a' : '#9dff6a';
  g.translate(0, -22 + bob);
  g.globalAlpha = 0.85;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6;
  g.shadowColor = col; g.shadowBlur = 8;
  if (p.kind === 'medkit') { g.fillRect(-1.5, -5, 3, 10); g.fillRect(-5, -1.5, 10, 3); }
  else if (p.kind === 'rockets') { g.beginPath(); g.moveTo(-6, 3); g.lineTo(4, -3); g.lineTo(6, -5); g.lineTo(5, -1); g.closePath(); g.fill(); g.fillRect(-7, 2, 3, 3); }
  else { g.beginPath(); g.arc(0, 1, 4.5, 0, TAU); g.fill(); g.fillRect(-1.5, -6, 3, 3); g.beginPath(); g.arc(3, -5, 2, 0, TAU); g.stroke(); }
  g.shadowBlur = 0;
  g.globalAlpha = 0.35;
  g.beginPath(); g.moveTo(-6, 9); g.lineTo(6, 9); g.lineTo(2, 20 - bob); g.lineTo(-2, 20 - bob); g.fill();
  g.restore();
}

function drawBarrel(g, b) {
  g.save(); g.translate(b.x, b.y);
  g.fillStyle = 'rgba(0,0,0,0.35)'; ellipse(g, 3, 4, 9, 8); g.fill();
  g.fillStyle = radial(g, 0, 0, 10, '#ff6a4a', '#6a1208');
  g.beginPath(); g.arc(0, 0, 8.5, 0, TAU); g.fill();
  g.strokeStyle = '#f2c230'; g.lineWidth = 2;
  g.setLineDash([3, 2]);
  g.beginPath(); g.arc(0, 0, 6.5, 0, TAU); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(2, -2, 2, 0, TAU); g.fill();
  g.restore();
  if (b.hitT > 0) { g.fillStyle = `rgba(255,255,255,${b.hitT * 3})`; ellipse(g, b.x, b.y, 9, 9); g.fill(); }
}

function drawDropship(g, x, y, a, scale, time, alpha = 1) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(scale, scale);
  g.globalAlpha = alpha;
  // Wings
  g.fillStyle = radial(g, -10, 0, 60, '#8a98a4', '#2c353e');
  g.beginPath();
  g.moveTo(10, -10); g.lineTo(-30, -52); g.lineTo(-46, -50); g.lineTo(-30, -12);
  g.lineTo(-30, 12); g.lineTo(-46, 50); g.lineTo(-30, 52); g.lineTo(10, 10); g.closePath(); g.fill();
  g.fillStyle = '#e6a13a';
  g.fillRect(-40, -48, 8, 4); g.fillRect(-40, 44, 8, 4);
  // Engine pods
  for (const s of [-1, 1]) {
    g.fillStyle = '#39424c'; rrect(g, -44, s * 26 - 7, 30, 14, 5); g.fill();
    const eg = g.createRadialGradient(-46, s * 26, 0, -46, s * 26, 14);
    eg.addColorStop(0, 'rgba(160,230,255,1)'); eg.addColorStop(1, 'rgba(60,140,255,0)');
    g.fillStyle = eg; g.beginPath(); g.arc(-46, s * 26, 14 + Math.sin(time * 40) * 2, 0, TAU); g.fill();
  }
  // Fuselage
  g.fillStyle = radial(g, 0, -6, 50, '#b8c4ce', '#3a4550');
  g.beginPath();
  g.moveTo(58, 0); g.lineTo(40, -12); g.lineTo(-40, -15); g.lineTo(-52, -8); g.lineTo(-52, 8); g.lineTo(-40, 15); g.lineTo(40, 12); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
  for (const px of [-30, -12, 8, 24]) { g.beginPath(); g.moveTo(px, -13); g.lineTo(px, 13); g.stroke(); }
  // Canopy
  g.fillStyle = radial(g, 40, -3, 12, '#bff6ff', '#1b4a66');
  g.beginPath(); g.moveTo(54, 0); g.lineTo(38, -8); g.lineTo(30, -6); g.lineTo(30, 6); g.lineTo(38, 8); g.closePath(); g.fill();
  g.fillStyle = '#e6a13a'; g.fillRect(-20, -3, 30, 6);
  g.restore();
}

function drawBeacon(g, e, time, active) {
  g.save(); g.translate(e.x, e.y);
  g.strokeStyle = active ? 'rgba(120,255,190,0.9)' : 'rgba(220,220,220,0.35)';
  g.lineWidth = 2;
  g.setLineDash([10, 8]);
  g.lineDashOffset = -time * 30;
  g.beginPath(); g.arc(0, 0, e.r, 0, TAU); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#3d4247';
  g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
  g.fillStyle = active ? ((time * 2) % 1 < 0.5 ? '#6fffb0' : '#1a8050') : '#555';
  g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.fill();
  g.restore();
}

// Pre-blurred dropship silhouette for its ground shadow (blur filters are slow per frame).
let _shipShadow = null;
function dropshipShadow() {
  if (_shipShadow) return _shipShadow;
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
  drawDropship(g, S / 2, S / 2, -Math.PI / 2, 1.6, 0, 1);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  let s = c;
  for (let i = 0; i < 2; i++) {
    const n = makeCanvas(s.width / 2, s.height / 2), ng = n.getContext('2d');
    ng.drawImage(s, 0, 0, n.width, n.height);
    s = n;
  }
  _shipShadow = s;
  return s;
}
