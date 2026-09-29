// Regenerates the images used in README.md from the game itself.
//
//   npm install --no-save playwright   (or use a global install)
//   node tools/readme-images.js
//
// Screenshots are staged by scripting game state (placing the squad, aliens
// and vehicles) so each shot shows a specific feature. Unit portraits are drawn
// with the game's own sprite functions on each world's ground texture.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const W = 1280, H = 720;

async function main() {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(PAGE);
  await page.waitForTimeout(1200);

  const shot = async (name) => {
    await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
    await page.screenshot({ path: path.join(OUT, name), type: 'jpeg', quality: 86 });
    console.log('wrote', name);
  };
  const toScreen = (x, y) => page.evaluate(([x, y]) => {
    const r = Game.canvas.getBoundingClientRect();
    return { x: r.left + (x - Game.cam.x) * Game.cam.zoom + Game.viewW / 2, y: r.top + (y - Game.cam.y) * Game.cam.zoom + Game.viewH / 2 };
  }, [x, y]);
  const deploy = async (mission, squadRank = 2) => {
    await page.evaluate(([m, rank]) => {
      Game.world = null;
      Game.campaign = Game.freshCampaign();
      Game.campaign.mission = m;
      for (let i = 0; i < 8; i++) Game.campaign.roster.push(Object.assign(Game.recruit(), { rank: Math.max(0, rank - (i % 3)), missions: rank, kills: 3 * rank + i }));
      Game.showBriefing();
    }, [mission, squadRank]);
    await page.click('#btn-deploy');
    await page.waitForFunction(() => Game.state === 'playing' && Game.world && Game.world.phase === 'play', null, { timeout: 30000 });
    await page.evaluate(() => { Game.world.checkObjectives = () => {}; });
  };
  // Find an open spot near the drop zone with room around it.
  const openSpot = () => page.evaluate(() => {
    const w = Game.world, m = w.map, s = m.start;
    let best = null, bd = 1e12;
    for (let ty = 3; ty < m.h - 3; ty++) for (let tx = 3; tx < m.w - 3; tx++) {
      let ok = true;
      for (let a = -3; a <= 3 && ok; a++) for (let b = -2; b <= 2 && ok; b++) if (m.get(tx + a, ty + b) !== T_GROUND) ok = false;
      if (!ok) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE, d = dist2(x, y, s.x, s.y);
      if (d < bd && d > 200 * 200) { bd = d; best = { x, y }; }
    }
    return best || { x: s.x, y: s.y };
  });
  const placeSquad = (x, y, face = 0) => page.evaluate(([x, y, face]) => {
    const w = Game.world;
    for (const T of w.teams) {
      T.members.forEach((m, i) => { m.x = x - i * 17 * Math.cos(face); m.y = y - i * 17 * Math.sin(face) + (i % 2) * 3; m.face = face; });
      T.trail = T.members.slice().reverse().map((m) => ({ x: m.x, y: m.y }));
      T.path = null;
    }
    Game.cam.x = x + 80; Game.cam.y = y;
  }, [x, y, face]);
  const spawnPack = (x, y, types) => page.evaluate(([x, y, types]) => {
    const w = Game.world;
    types.forEach((t, i) => {
      const a = w.spawnAlien(t, x + Math.cos(i * 2.4) * 18 * Math.sqrt(i), y + Math.sin(i * 2.4) * 18 * Math.sqrt(i), true);
      if (a) a.face = Math.PI;
    });
  }, [x, y, types]);
  const holdFire = async (x, y, ms) => {
    const s = await toScreen(x, y);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(ms);
  };
  const release = () => page.mouse.up({ button: 'right' });

  // 1. Title screen
  await page.evaluate(() => Game.showScreen('title'));
  await page.waitForTimeout(1500);
  await shot('title.jpg');

  // 2. Night firefight in the jungle with a grenade going off
  await deploy(4);
  let p = await openSpot();
  await placeSquad(p.x - 60, p.y, 0);
  await page.waitForTimeout(300);
  await spawnPack(p.x + 170, p.y - 20, ['skitter', 'skitter', 'skitter', 'spitter', 'skitter', 'skitter']);
  await holdFire(p.x + 150, p.y - 10, 500);
  await page.evaluate(([x, y]) => { const w = Game.world; w.throwGrenade(w.leader, x, y); }, [p.x + 175, p.y - 25]);
  await page.waitForTimeout(1330);
  await shot('firefight.jpg');
  await release();

  // 3. Split teams: Alpha in the Warden tank, Bravo on foot (daylight dust world)
  await deploy(1);
  p = await openSpot();
  await placeSquad(p.x - 40, p.y + 40, -0.3);
  await page.evaluate(([x, y]) => {
    const w = Game.world;
    const T = w.team;
    T.members.slice(3).forEach((m) => (m.marked = true));
    w.splitTeam();
    const v = w.vehicles.find((v) => v.type === 'tank') || (() => { const n = new Vehicle('tank', x, y); w.vehicles.push(n); return n; })();
    v.x = x + 10; v.y = y - 40; v.face = -0.2; v.turret = -0.2;
    w.boardVehicle(w.teams[0], v);
    const B = w.teams[1];
    B.members.forEach((m, i) => { m.x = x - 70 - i * 17; m.y = y + 50 + (i % 2) * 4; m.face = -0.2; });
    B.trail = B.members.slice().reverse().map((m) => ({ x: m.x, y: m.y }));
    w.active = 0;
  }, [p.x, p.y]);
  await page.waitForTimeout(400);
  await spawnPack(p.x + 200, p.y - 70, ['brute', 'skitter', 'skitter', 'spitter', 'skitter']);
  await holdFire(p.x + 190, p.y - 65, 1250);
  await shot('teams-tank.jpg');
  await release();

  // 4. Skimmer on lava, second team waiting on the shore
  await deploy(8);
  const lava = await page.evaluate(() => {
    const w = Game.world, m = w.map;
    let best = null;
    for (let ty = 2; ty < m.h - 2 && !best; ty++) for (let tx = 2; tx < m.w - 2 && !best; tx++) {
      if (m.get(tx, ty) !== T_LAVA) continue;
      let n = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (m.get(tx + a, ty + b) === T_LAVA) n++;
      if (n >= 8) best = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    return best;
  });
  if (lava) {
    await page.evaluate(([x, y]) => {
      const w = Game.world;
      const T = w.team;
      T.members.slice(2).forEach((m) => (m.marked = true));
      w.splitTeam();
      const v = w.vehicles.find((v) => v.type === 'skimmer') || (() => { const n = new Vehicle('skimmer', x, y); w.vehicles.push(n); return n; })();
      v.x = x; v.y = y; v.face = 0.4; v.turret = 0.4;
      w.boardVehicle(w.teams[0], v);
      const shore = w.map.nearestWalkable(Math.floor(x / TILE) - 3, Math.floor(y / TILE) + 2, 8);
      const B = w.teams[1];
      B.members.forEach((m, i) => { m.x = (shore.tx + 0.5) * TILE - i * 15; m.y = (shore.ty + 0.5) * TILE + (i % 2) * 5; m.face = -0.4; });
      B.trail = B.members.slice().reverse().map((m) => ({ x: m.x, y: m.y }));
      Game.cam.x = x; Game.cam.y = y;
    }, [lava.x, lava.y]);
    const s = await toScreen(lava.x + 90, lava.y + 10);
    await page.mouse.move(s.x, s.y);
    await page.waitForTimeout(900);
    await shot('skimmer-lava.jpg');
  }

  // 5. Dusk rescue: colonists following the squad to the beacon
  await deploy(2);
  await page.evaluate(() => {
    const w = Game.world, b = w.beacon;
    const T = w.team;
    const dir = { x: 1, y: 0 };
    // Stop just outside the beacon ring so the colonists are still in the line.
    const x0 = b.x - b.r - 20;
    T.members.forEach((m, i) => { m.x = x0 - 40 - i * 17; m.y = b.y + 10; m.face = 0; });
    T.trail = [];
    for (let k = 24; k >= 0; k--) T.trail.push({ x: x0 - 40 - k * 12, y: b.y + 10 });
    w.colonists.forEach((c, i) => { c.state = 'following'; c.team = T; c.x = x0 - 40 - (T.members.length + i + 1) * 17; c.y = b.y + 10; });
    T.path = [{ x: x0, y: b.y + 10 }];
    w.aliens.forEach((a) => { a.state = 'idle'; });
    Game.cam.x = b.x - 140; Game.cam.y = b.y;
    void dir;
  });
  const bpos = await page.evaluate(() => ({ x: Game.world.beacon.x, y: Game.world.beacon.y }));
  const bs = await toScreen(bpos.x + 30, bpos.y - 20);
  await page.mouse.move(bs.x, bs.y);
  await page.waitForTimeout(700);
  await shot('rescue.jpg');

  // 6. Brood mother on the hive world
  await deploy(11, 5);
  p = await openSpot();
  await placeSquad(p.x - 80, p.y + 20, -0.1);
  await page.evaluate(([x, y]) => {
    const w = Game.world, m = w.boss;
    m.x = x + 190; m.y = y - 30; m.face = Math.PI; m.state = 'hunt'; m.spawnT = 0.1;
  }, [p.x, p.y]);
  await page.waitForTimeout(300);
  await holdFire(p.x + 180, p.y - 30, 1500);
  await shot('brood-mother.jpg');
  await release();

  // 7. Briefing and memorial screens
  await page.evaluate(() => {
    Game.world = null;
    Game.campaign = Game.freshCampaign();
    Game.campaign.mission = 6;
    Game.campaign.reserve = 41;
    for (let i = 0; i < 4; i++) Game.campaign.roster.push(Object.assign(Game.recruit(), { rank: 5 - i, missions: 6 - i, kills: 40 - i * 7 }));
    const fallenMissions = ['First Drop', 'Hatchery Row', 'Hatchery Row', 'Dead Air', 'Glowroot', 'Glowroot', 'Canopy Burn', 'Pilgrim Station', 'Pilgrim Station'];
    fallenMissions.forEach((mn, i) => { const r = Game.recruit(); Game.campaign.fallen.push({ name: r.name, rank: (i * 3) % 5, kills: (i * 7) % 23, mission: mn }); });
    Game.showBriefing();
  });
  await page.waitForTimeout(600);
  await shot('briefing.jpg');
  await page.evaluate(() => Game.showMemorial('briefing'));
  await page.waitForTimeout(400);
  await shot('memorial.jpg');

  // 8. Unit portraits and world swatches, drawn by the game's own code
  const images = await page.evaluate(() => {
    const out = {};
    const S = 240;
    const ground = {};
    const groundFor = (biome) => {
      if (!ground[biome]) { const m = new GameMap(12, 12, biome, 77); ground[biome] = m._groundTexture(); }
      return ground[biome];
    };
    const card = (name, biome, scale, draw, ambient) => {
      const c = makeCanvas(S, S), g = c.getContext('2d');
      g.fillStyle = g.createPattern(groundFor(biome), 'repeat');
      g.fillRect(0, 0, S, S);
      const vg = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg; g.fillRect(0, 0, S, S);
      g.save();
      g.translate(S / 2, S / 2);
      g.scale(scale, scale);
      draw(g);
      g.restore();
      if (ambient) { g.fillStyle = ambient; g.fillRect(0, 0, S, S); }
      out[name] = c.toDataURL('image/png');
    };
    const T0 = 1.3;
    const trooper = (extra = {}) => Object.assign({ x: 0, y: 0, face: -Math.PI / 4, walk: 1.2, moving: true, rank: 4, leader: true, hitT: 0, recoil: 0, inWater: false, data: { rank: 4 } }, extra);
    card('trooper', 'dust', 5, (g) => { drawShadow(g, 0, 0, 8, 6, 0.3); drawTrooper(g, trooper(), T0); });
    card('squad', 'dust', 2.6, (g) => {
      for (let i = 4; i >= 0; i--) {
        const t = trooper({ x: 26 - i * 13, y: -14 + i * 13, face: -Math.PI / 4, leader: i === 0, rank: [5, 3, 2, 1, 0][i], walk: i * 1.7 });
        drawShadow(g, t.x, t.y, 8, 6, 0.3); drawTrooper(g, t, T0);
      }
      g.fillStyle = '#ffb13a';
      const x = 26, by = -14 - 22;
      g.beginPath(); g.moveTo(x - 4, by - 3); g.lineTo(x, by + 1); g.lineTo(x + 4, by - 3); g.lineTo(x + 4, by - 1); g.lineTo(x, by + 3); g.lineTo(x - 4, by - 1); g.closePath(); g.fill();
    });
    const alien = (type, extra = {}) => Object.assign(new Alien(type, 0, 0), { face: -Math.PI / 2 + 0.35, walk: 0.8 }, extra);
    card('skitter', 'dust', 5.5, (g) => { const a = alien('skitter', { atkAnim: 0.6 }); drawShadow(g, 0, 0, a.r * 1.1, a.r * 0.8, 0.3); drawSkitter(g, a, T0); });
    card('spitter', 'jungle', 4.2, (g) => { const a = alien('spitter', { charge: 0.7 }); drawShadow(g, 0, 0, a.r * 1.1, a.r * 0.8, 0.3); drawSpitter(g, a, T0); });
    card('brute', 'ice', 3.1, (g) => { const a = alien('brute', { atkAnim: 0.5 }); drawShadow(g, 0, 0, a.r * 1.1, a.r * 0.8, 0.3); drawBrute(g, a, T0); });
    card('mother', 'hive', 1.35, (g) => { const a = alien('mother', { face: -Math.PI / 2 + 0.3 }); g.translate(10, 18); drawShadow(g, 0, 0, a.r * 1.4, a.r, 0.3); drawMother(g, a, T0); });
    card('nest', 'volcanic', 2.6, (g) => { const n = new Nest(0, 0, {}); n.spawnAnim = 0.6; drawNest(g, n, T0); });
    card('colonist', 'ice', 5, (g) => { const c = new Colonist(0, 0); c.hair = '#6a4020'; drawShadow(g, 0, 0, 7, 5, 0.3); drawColonist(g, c, T0); });
    const veh = (type, extra = {}) => Object.assign(new Vehicle(type, 0, 0, -Math.PI / 4), { team: {} }, extra);
    card('crawler', 'dust', 3.4, (g) => { const v = veh('crawler', { turret: -0.2 }); drawShadow(g, 0, 0, v.r * 1.15, v.r * 0.85, 0.35); drawVehicle(g, v, T0); });
    card('tank', 'jungle', 2.9, (g) => { const v = veh('tank', { turret: -1.2 }); drawShadow(g, 0, 0, v.r * 1.15, v.r * 0.85, 0.35); drawVehicle(g, v, T0); });
    card('skimmer', 'volcanic', 3.6, (g) => { const v = veh('skimmer'); drawShadow(g, 0, 0, v.r * 1.15, v.r * 0.85, 0.35); drawVehicle(g, v, T0); });
    card('crates', 'dust', 2.7, (g) => {
      drawCrate(g, { kind: 'grenades', x: -28, y: 14 }, T0);
      drawCrate(g, { kind: 'rockets', x: 0, y: 14 }, T0);
      drawCrate(g, { kind: 'medkit', x: 28, y: 14 }, T0);
    });
    card('barrels', 'ice', 4, (g) => { drawBarrel(g, { x: -9, y: -4, hitT: 0 }); drawBarrel(g, { x: 8, y: 2, hitT: 0 }); drawBarrel(g, { x: -3, y: 12, hitT: 0 }); });
    card('beacon', 'dust', 2.4, (g) => { drawBeacon(g, { x: 0, y: 0, r: 40 }, T0, true); });
    // World swatches: crops of real generated maps
    for (const [biome, mi] of [['dust', 1], ['jungle', 3], ['ice', 6], ['volcanic', 8], ['hive', 10]]) {
      const M = CAMPAIGN[mi];
      const m = new GameMap(M.size[0], M.size[1], biome, M.seed, M.terrain);
      m.render();
      const c = makeCanvas(360, 220), g = c.getContext('2d');
      // pick the crop with the most variety of tile types
      let best = null, bs = -1;
      for (let ty = 2; ty < m.h - 9; ty += 3) for (let tx = 2; tx < m.w - 13; tx += 3) {
        const cnt = [0, 0, 0, 0, 0];
        for (let y = 0; y < 7; y++) for (let x = 0; x < 11; x++) cnt[m.get(tx + x, ty + y)]++;
        const sc = cnt.filter((n) => n > 4).length * 100 - Math.abs(cnt[0] - 40);
        if (sc > bs) { bs = sc; best = { tx, ty }; }
      }
      g.drawImage(m.canvas, best.tx * TILE, best.ty * TILE, 360, 220, 0, 0, 360, 220);
      for (const f of m.flora) {
        const x = f.x - best.tx * TILE, y = f.y - best.ty * TILE;
        if (x < -40 || y < -40 || x > 400 || y > 260) continue;
        const spr = m.floraSprites[f.v];
        g.drawImage(spr.canvas, x - spr.w / 2, y - spr.h / 2, spr.w, spr.h);
      }
      out['world-' + biome] = c.toDataURL('image/png');
    }
    return out;
  });
  for (const [name, url] of Object.entries(images)) {
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', name + '.png');
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
