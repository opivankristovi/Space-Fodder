'use strict';
// Game shell: campaign state, screens, HUD, camera and the main loop.

const SAVE_KEY = 'space-fodder.save.v1';
const $ = (id) => document.getElementById(id);

const Game = {
  state: 'title',
  world: null, demo: null, campaign: null,
  cam: { x: 0, y: 0, zoom: 2 },
  hudT: 0, lastT: 0, acc: 0,
  squad: [],

  init() {
    this.canvas = $('game');
    this.g = this.canvas.getContext('2d');
    Input.init(this.canvas);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.campaign = this.load();
    this.bindUi();
    this.demo = new World(DEMO_MISSION, [], { demo: true });
    this.cam.x = this.demo.map.pw / 2; this.cam.y = this.demo.map.ph / 2;
    this.showScreen('title');
    requestAnimationFrame((t) => this.frame(t));
  },

  resize() {
    const stage = $('stage');
    const r = stage.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = Math.max(1, r.width); this.viewH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.cam.zoom = clamp(Math.min(this.viewW / 700, this.viewH / 440), this.viewW < 600 ? 1.25 : 0.9, 2.8);
  },

  // ------------------------------------------------------------ persistence
  load() {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.campaign)); } catch (e) { /* storage unavailable */ }
  },
  freshCampaign() {
    return { mission: 0, reserve: 60, roster: [], fallen: [], nextId: 1, kills: 0, attempts: 0 };
  },
  recruit() {
    const c = this.campaign;
    const names = new Set(c.roster.map((r) => r.name).concat(c.fallen.map((f) => f.name)));
    let name = randomName();
    for (let i = 0; i < 20 && names.has(name); i++) name = randomName();
    return { id: c.nextId++, name, rank: 0, kills: 0, missions: 0 };
  },
  buildSquad() {
    const c = this.campaign, M = CAMPAIGN[c.mission];
    c.roster.sort((a, b) => b.rank - a.rank || b.kills - a.kills);
    const squad = c.roster.slice(0, M.squad);
    squad.forEach((s) => (s.isNew = false));
    while (squad.length < M.squad && c.reserve > 0) {
      const r = this.recruit();
      r.isNew = true;
      c.reserve--;
      c.roster.push(r);
      squad.push(r);
    }
    this.save();
    return squad;
  },

  // ------------------------------------------------------------ screens
  showScreen(name) {
    this.state = name;
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.dataset.screen !== name;
    const playing = name === 'playing' || name === 'paused';
    if (!playing) $('toasts').innerHTML = '';
    $('hud').hidden = !playing;
    document.body.classList.toggle('in-game', playing);
    $('touch').hidden = !(playing && Input.touch.enabled);
    requestAnimationFrame(() => this.resize());
    if (name === 'title') this.renderTitle();
    if (Sfx.ctx) {
      if (name === 'playing') Music.play('battle');
      else if (name === 'memorial' || name === 'gameover') Music.play('somber');
      else if (name !== 'paused') Music.play('title');
    }
  },

  bindUi() {
    const click = (id, fn) => $(id).addEventListener('click', () => { Sfx.init(); Sfx.click(); fn(); });
    click('btn-continue', () => this.showBriefing());
    click('btn-new', () => {
      const btn = $('btn-new');
      if (this.campaign && this.campaign.mission + this.campaign.fallen.length > 0 && !btn.dataset.confirm) {
        btn.dataset.confirm = '1';
        btn.textContent = 'Erase progress? Click again';
        setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'New campaign'; }, 3500);
        return;
      }
      delete btn.dataset.confirm; btn.textContent = 'New campaign';
      this.campaign = this.freshCampaign();
      this.save();
      this.showBriefing();
    });
    click('btn-howto', () => this.showScreen('help'));
    click('btn-help-back', () => this.showScreen('title'));
    click('btn-memorial', () => this.showMemorial('title'));
    click('btn-memorial-back', () => this.showScreen(this.memorialReturn || 'title'));
    click('btn-deploy', () => this.deploy());
    click('btn-brief-back', () => this.showScreen('title'));
    click('btn-brief-memorial', () => this.showMemorial('briefing'));
    click('btn-debrief-next', () => this.afterDebrief());
    click('btn-debrief-memorial', () => this.showMemorial('debrief'));
    click('btn-resume', () => this.showScreen('playing'));
    click('btn-abort', () => this.endMission({ success: false, reason: 'Mission aborted.' }));
    click('btn-over-new', () => { this.campaign = this.freshCampaign(); this.save(); this.showBriefing(); });
    click('btn-win-title', () => this.showScreen('title'));
    click('btn-mute', () => { Sfx.setMuted(!Sfx.muted); this.updateMute(); });
    const queue = (k, v = true) => { this.queued = this.queued || {}; this.queued[k] = v; Sfx.click(); };
    $('btn-split').addEventListener('click', () => queue('split'));
    $('btn-join').addEventListener('click', () => queue('join'));
    $('btn-exit').addEventListener('click', () => queue('exit'));
    $('btn-team').addEventListener('click', () => queue('switchTeam'));
    $('hud-squad').addEventListener('pointerdown', (e) => {
      const w = this.world;
      if (!w) return;
      const head = e.target.closest('[data-team]');
      if (head) return queue('selectTeam', Number(head.dataset.team));
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const t = w.troopers.find((t) => String(t.data.id) === row.dataset.id);
      if (!t) return;
      if (t.team !== w.team) { for (const o of w.troopers) o.marked = false; queue('selectTeam', w.teams.indexOf(t.team)); }
      t.marked = !t.marked;
      this.updateHud(true);
    });
    for (const [id, k] of [['t-team', 'switchTeam'], ['t-split', 'split'], ['t-exit', 'exit']]) {
      $(id).addEventListener('touchstart', (e) => { queue(k); e.preventDefault(); }, { passive: false });
    }
    $('w-grenade').addEventListener('click', () => { if (this.world) this.world.special = 'grenade'; Sfx.click(); });
    $('w-rocket').addEventListener('click', () => { if (this.world) this.world.special = 'rocket'; Sfx.click(); });
    // Touch buttons
    const fire = $('t-fire');
    fire.addEventListener('touchstart', (e) => { Input.touch.fire = true; e.preventDefault(); }, { passive: false });
    fire.addEventListener('touchend', (e) => { Input.touch.fire = false; e.preventDefault(); });
    $('t-throw').addEventListener('touchstart', (e) => { Input.touch.throwPressed = true; e.preventDefault(); }, { passive: false });
    $('t-swap').addEventListener('touchstart', (e) => { if (this.world) this.world.special = this.world.special === 'grenade' ? 'rocket' : 'grenade'; e.preventDefault(); }, { passive: false });
    $('t-pause').addEventListener('touchstart', (e) => { this.showScreen('paused'); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerdown', () => Sfx.init(), { once: true });
    document.addEventListener('keydown', () => Sfx.init(), { once: true });
    this.updateMute();
  },

  updateMute() {
    $('btn-mute').textContent = Sfx.muted ? 'Sound off' : 'Sound on';
    $('btn-mute').setAttribute('aria-pressed', String(!Sfx.muted));
  },

  renderTitle() {
    const has = !!this.campaign && this.campaign.mission < CAMPAIGN.length && (this.campaign.roster.length > 0 || this.campaign.reserve > 0);
    $('btn-continue').hidden = !has || (this.campaign.mission === 0 && this.campaign.fallen.length === 0 && this.campaign.roster.length === 0);
    if (has) $('btn-continue').textContent = `Continue: mission ${this.campaign.mission + 1}`;
  },

  showBriefing() {
    if (!this.campaign) this.campaign = this.freshCampaign();
    const c = this.campaign;
    if (c.mission >= CAMPAIGN.length) return this.showScreen('victory');
    if (!c.roster.length && c.reserve <= 0) return this.gameOver();
    const M = CAMPAIGN[c.mission];
    this.squad = this.buildSquad();
    $('brief-eyebrow').textContent = `Mission ${c.mission + 1} of ${CAMPAIGN.length} · ${M.world}`;
    $('brief-title').textContent = M.name;
    $('brief-world').textContent = `${BIOMES[M.biome].label}${M.ambient ? ', night drop' : ''}`;
    $('brief-text').textContent = M.brief;
    $('brief-obj').innerHTML = this.objectivePreview(M).map((o) => `<li>${escapeHtml(o)}</li>`).join('');
    $('brief-load').innerHTML = `<span><b>${M.grenades}</b> grenades</span><span><b>${M.rockets}</b> rockets</span>`;
    $('brief-squad').innerHTML = this.squad.map((s) => this.trooperCard(s, s.isNew ? '<em class="tag-new">New recruit</em>' : `<span class="muted">${s.missions} missions · ${s.kills} kills</span>`)).join('');
    $('brief-reserve').textContent = `${c.reserve} recruits in reserve · ${c.fallen.length} fallen`;
    drawPlanet($('planet'), M, c.mission);
    this.showScreen('briefing');
  },

  objectivePreview(M) {
    return M.objectives.map((o) => ({
      killAll: 'Wipe out every alien and nest in the area',
      nests: `Destroy all ${M.nests} hive nests`,
      rescue: `Find ${M.colonists} colonists and escort them to the beacon`,
      extract: 'Reach the extraction beacon',
      boss: 'Kill the brood mother',
    }[o]));
  },

  trooperCard(s, extra) {
    const rk = RANKS[s.rank];
    return `<li class="trooper-card"><span class="insignia" style="--rank:${RANK_COLORS[s.rank]}">${rankBars(rk.bars)}</span><span class="tc-name"><b>${escapeHtml(rk.short)} ${escapeHtml(s.name)}</b>${extra}</span></li>`;
  },

  deploy() {
    const M = CAMPAIGN[this.campaign.mission];
    $('loading').hidden = false;
    setTimeout(() => {
      this.world = new World(M, this.squad, { onMessage: (t, k) => this.toast(t, k) });
      const s = this.world.map.start;
      this.cam.x = s.x; this.cam.y = s.y;
      $('toasts').innerHTML = '';
      $('hud-mission').textContent = M.name;
      const mm = $('hud-mini');
      mm.width = this.world.map.w * 3; mm.height = this.world.map.h * 3;
      $('loading').hidden = true;
      this.showScreen('playing');
      this.updateHud(true);
      if (this.campaign.mission === 0 && !this.campaign.attempts) this.toast(Input.touch.enabled ? 'Tap to move. Hold Fire to shoot. Bomb throws a grenade.' : 'Left click to move. Right click to fire. Space throws a grenade.', 'info', 7000);
    }, 30);
  },

  endMission(result) {
    const w = this.world, c = this.campaign;
    if (!w) return;
    const M = CAMPAIGN[c.mission];
    const lines = [];
    for (const t of w.fallen) {
      c.roster = c.roster.filter((r) => r.id !== t.data.id);
      c.fallen.push({ name: t.data.name, rank: t.data.rank, kills: t.data.kills + t.kills, mission: M.name, world: M.world });
      lines.push({ s: t.data, status: 'kia', kills: t.kills });
    }
    for (const t of w.troopers) {
      t.data.kills += t.kills;
      const promoted = result.success && t.data.rank < RANKS.length - 1;
      if (result.success) { t.data.missions++; if (promoted) t.data.rank++; }
      lines.push({ s: t.data, status: promoted ? 'promoted' : 'survived', kills: t.kills });
    }
    c.kills += w.stats.kills;
    c.attempts = (c.attempts || 0) + 1;
    if (result.success) { c.mission++; c.attempts = 0; }
    this.save();
    const mins = Math.floor(w.stats.time / 60), secs = Math.floor(w.stats.time % 60);
    $('debrief-eyebrow').textContent = `Mission ${M.index + 1} · ${M.world}`;
    $('debrief-title').textContent = result.success ? `${M.name}: accomplished` : `${M.name}: failed`;
    $('debrief-title').className = result.success ? 'ok' : 'bad';
    $('debrief-reason').textContent = result.success ? 'The squad made it out. Survivors are promoted one rank.' : `${result.reason} Survivors return to the barracks. The dead stay dead.`;
    $('debrief-stats').innerHTML = [
      ['Aliens killed', w.stats.kills], ['Nests destroyed', w.stats.nests], ['Colonists saved', w.stats.rescued],
      ['Troopers lost', w.fallen.length], ['Time', `${mins}:${String(secs).padStart(2, '0')}`], ['Reserve left', c.reserve],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    lines.sort((a, b) => (a.status === 'kia') - (b.status === 'kia'));
    $('debrief-squad').innerHTML = lines.map((l) => {
      const label = l.status === 'kia' ? '<em class="tag-kia">Killed in action</em>' : l.status === 'promoted' ? `<em class="tag-up">Promoted to ${escapeHtml(RANKS[l.s.rank].name)}</em>` : '<span class="muted">Survived</span>';
      return this.trooperCard(l.s, `${label}<span class="muted">${l.kills} kills this mission</span>`).replace('trooper-card', `trooper-card ${l.status}`);
    }).join('');
    $('btn-debrief-next').textContent = result.success ? (c.mission >= CAMPAIGN.length ? 'Finish campaign' : 'Next mission') : 'Try again';
    this.world = null;
    Input.reset();
    this.showScreen('debrief');
    if (result.success) Sfx.fanfare();
  },

  afterDebrief() {
    const c = this.campaign;
    if (c.mission >= CAMPAIGN.length) {
      $('win-stats').textContent = `${c.kills} aliens killed. ${c.fallen.length} troopers gave their lives. ${c.roster.length} came home.`;
      return this.showScreen('victory');
    }
    if (!c.roster.length && c.reserve <= 0) return this.gameOver();
    this.showBriefing();
  },

  gameOver() {
    const c = this.campaign;
    $('over-stats').textContent = `You reached mission ${c.mission + 1}. ${c.fallen.length} troopers fell. ${c.kills} aliens killed.`;
    this.showScreen('gameover');
  },

  showMemorial(ret) {
    this.memorialReturn = ret;
    const f = (this.campaign && this.campaign.fallen) || [];
    $('memorial-count').textContent = f.length ? `${f.length} troopers have fallen.` : 'No one has fallen yet. Keep it that way.';
    $('memorial-list').innerHTML = f.slice().reverse().map((d) => `<li class="stone"><span class="stone-rank">${escapeHtml(RANKS[d.rank].short)}</span><b>${escapeHtml(d.name)}</b><span>${escapeHtml(d.mission)}</span><span class="muted">${d.kills} kills</span></li>`).join('');
    this.showScreen('memorial');
  },

  toast(text, kind = 'info', ms = 3500) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  },

  // ------------------------------------------------------------ HUD
  updateHud(force) {
    const w = this.world;
    if (!w) return;
    $('hud-obj').innerHTML = w.objectiveLines().map((o) => `<li class="${o.done ? 'done' : ''}">${escapeHtml(o.label)}</li>`).join('');
    $('w-grenade').querySelector('b').textContent = w.grenades;
    $('w-rocket').querySelector('b').textContent = w.rockets;
    $('w-grenade').classList.toggle('active', w.special === 'grenade');
    $('w-rocket').classList.toggle('active', w.special === 'rocket');
    $('w-grenade').setAttribute('aria-pressed', String(w.special === 'grenade'));
    $('w-rocket').setAttribute('aria-pressed', String(w.special === 'rocket'));
    const rows = [];
    const bar = (f) => `<span class="hp"><i style="width:${(clamp(f, 0, 1) * 100).toFixed(0)}%;background:${f > 0.4 ? 'var(--good)' : 'var(--bad)'}"></i></span>`;
    w.teams.forEach((T, i) => {
      const act = T === w.team;
      const v = T.vehicle;
      const detail = v ? `${escapeHtml(v.T.name)}` : `${T.grenades}g · ${T.rockets}r`;
      rows.push(`<li class="team-head${act ? ' active' : ''}" data-team="${i}" style="--team:${T.color}" title="Command ${T.name} team"><b>${T.name}</b><span>${detail}</span>${v ? bar(v.hp / v.maxHp) : ''}</li>`);
      for (const t of T.members) {
        const cls = [t.leader ? 'leader' : '', t.marked ? 'marked' : '', t.inVehicle ? 'riding' : ''].join(' ');
        rows.push(`<li class="${cls}" data-id="${t.data.id}" style="--team:${T.color}" title="Mark for splitting"><span class="insignia sm" style="--rank:${RANK_COLORS[t.data.rank]}">${rankBars(RANKS[t.data.rank].bars)}</span><span class="sq-name">${escapeHtml(t.data.name)}</span><span class="sq-k">${t.kills}</span>${bar(t.hp / t.maxHp)}</li>`);
      }
    });
    for (const t of w.fallen) rows.push(`<li class="dead"><span class="insignia sm" style="--rank:#555">✕</span><span class="sq-name">${escapeHtml(t.data.name)}</span><span class="sq-k">KIA</span></li>`);
    const html = rows.join('');
    if (force || html !== this._sqHtml) { $('hud-squad').innerHTML = html; this._sqHtml = html; }
    const T = w.team;
    $('btn-split').disabled = !T || !!T.vehicle || w.teams.length >= TEAM_DEFS.length || T.members.length < 2;
    $('btn-join').disabled = !T || w.teams.length < 2;
    $('btn-exit').disabled = !T || !T.vehicle;
    $('btn-team').disabled = w.teams.length < 2;
    $('hud-kills').textContent = w.stats.kills;
    $('hud-reserve').textContent = this.campaign.reserve;
    this.drawMinimap();
  },

  drawMinimap() {
    const w = this.world, mm = $('hud-mini'), g = mm.getContext('2d');
    const k = mm.width / w.map.w;
    g.imageSmoothingEnabled = false;
    g.drawImage(w.map.minimap, 0, 0, mm.width, mm.height);
    const dot = (x, y, c, r = 2) => { g.fillStyle = c; g.fillRect((x / TILE) * k - r / 2, (y / TILE) * k - r / 2, r, r); };
    if (w.beacon) dot(w.beacon.x, w.beacon.y, (w.time * 2) % 1 < 0.5 ? '#6fffb0' : '#1a8050', 6);
    for (const n of w.nests) dot(n.x, n.y, '#ffb040', 5);
    for (const c of w.colonists) if (c.alive && c.state !== 'rescued') dot(c.x, c.y, '#7ff0ff', 4);
    for (const p of w.pickups) dot(p.x, p.y, '#e6e0a0', 3);
    const L = w.leader;
    for (const a of w.aliens) {
      if (a.state === 'hunt' || (L && dist2(a.x, a.y, L.x, L.y) < 420 * 420)) dot(a.x, a.y, '#ff4a3a', a.r > 15 ? 4 : 2);
    }
    for (const v of w.vehicles) dot(v.x, v.y, v.team ? v.team.color : '#9aa4ad', 5);
    for (const t of w.troopers) if (!t.inVehicle) dot(t.x, t.y, w.teams.length > 1 && t.team ? t.team.color : '#ffffff', 3);
    const vw = this.viewW / this.cam.zoom, vh = this.viewH / this.cam.zoom;
    g.strokeStyle = 'rgba(255,177,58,0.8)'; g.lineWidth = 1;
    g.strokeRect(((this.cam.x - vw / 2) / TILE) * k, ((this.cam.y - vh / 2) / TILE) * k, (vw / TILE) * k, (vh / TILE) * k);
  },

  // ------------------------------------------------------------ loop
  frame(t) {
    const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000);
    this.lastT = t;
    try { this.tick(dt); } catch (e) { console.error(e); }
    Input.endFrame();
    requestAnimationFrame((tt) => this.frame(tt));
  },

  tick(dt) {
    const g = this.g;
    if (this.state === 'playing' || this.state === 'paused') {
      const w = this.world;
      if (!w) return;
      if (this.state === 'playing') {
        if (Input.hit('Escape') || Input.hit('KeyP')) { this.showScreen('paused'); return; }
        if (Input.hit('KeyM')) { Sfx.setMuted(!Sfx.muted); this.updateMute(); }
        const ctl = this.controls();
        // Fixed-step simulation for stable physics.
        this.acc += dt;
        let first = true;
        while (this.acc >= 1 / 120) {
          w.update(1 / 120, first ? ctl : Object.assign({}, ctl, { moveNew: false, throw: false, switchSpecial: false, selectSpecial: null, split: false, join: false, exit: false, switchTeam: false, selectTeam: null }));
          first = false;
          this.acc -= 1 / 120;
        }
        this.updateCamera(dt, w, true);
        this.hudT -= dt;
        if (this.hudT <= 0) { this.hudT = 0.12; this.updateHud(); }
        if (w.result) { this.endMission(w.result); return; }
      } else if (Input.hit('Escape') || Input.hit('KeyP')) { this.showScreen('playing'); }
      w.render(g, this.cam, this.viewW, this.viewH, this.dpr);
      if (this.state === 'playing') this.drawCursor(g, w);
      return;
    }
    // Menu background: the demo battlefield drifts by.
    const d = this.demo;
    d.update(dt, null);
    this.demoT = (this.demoT || 0) + dt * 0.05;
    this.cam.x = d.map.pw / 2 + Math.cos(this.demoT) * d.map.pw * 0.28;
    this.cam.y = d.map.ph / 2 + Math.sin(this.demoT * 1.3) * d.map.ph * 0.25;
    if (d.aliens.length < 8) {
      const t = pick(['skitter', 'skitter', 'spitter']);
      const cell = Math.floor(Math.random() * d.map.tiles.length);
      if (d.map.tiles[cell] === T_GROUND) d.spawnAlien(t, (cell % d.map.w + 0.5) * TILE, ((cell / d.map.w | 0) + 0.5) * TILE, false);
    }
    const zoom = this.cam.zoom;
    const z = Math.max(zoom * 0.8, this.viewW / d.map.pw, this.viewH / d.map.ph);
    const hw = this.viewW / 2 / z, hh = this.viewH / 2 / z;
    const cam = { x: clamp(this.cam.x, hw, d.map.pw - hw), y: clamp(this.cam.y, hh, d.map.ph - hh), zoom: z };
    d.render(g, cam, this.viewW, this.viewH, this.dpr);
  },

  screenToWorld(sx, sy) {
    return { x: this.cam.x + (sx - this.viewW / 2) / this.cam.zoom, y: this.cam.y + (sy - this.viewH / 2) / this.cam.zoom };
  },

  controls() {
    const w = this.world;
    const m = this.screenToWorld(Input.mx, Input.my);
    const both = Input.left && Input.right;
    const ctl = {
      move: null, moveNew: false,
      fire: (Input.right && !both) || Input.down('KeyF') || Input.touch.fire,
      aimX: m.x, aimY: m.y,
      throw: Input.middlePressed || Input.hit('Space') || Input.hit('KeyE') || (Input.right && Input.leftPressed) || (Input.left && Input.rightPressed) || Input.touch.throwPressed,
      switchSpecial: Input.hit('Tab') || Input.hit('KeyQ'),
      selectSpecial: Input.hit('Digit1') ? 'grenade' : Input.hit('Digit2') ? 'rocket' : null,
      split: Input.hit('KeyX'), join: Input.hit('KeyJ'), exit: Input.hit('KeyR'),
      switchTeam: Input.hit('KeyC'), selectTeam: null,
    };
    // Actions queued from HUD and touch buttons
    const q = this.queued || {};
    this.queued = {};
    for (const k of ['split', 'join', 'exit', 'switchTeam']) if (q[k]) ctl[k] = true;
    if (q.selectTeam != null) ctl.selectTeam = q.selectTeam;
    if ((Input.left || Input.leftPressed) && !both && Input.inside) { ctl.move = m; ctl.moveNew = Input.leftPressed; }
    if (Input.touch.tap) { ctl.move = this.screenToWorld(Input.touch.tap.x, Input.touch.tap.y); ctl.moveNew = true; }
    if (Input.touch.enabled && (ctl.fire || ctl.throw) && w.focus) {
      // Touch aims automatically at the nearest visible threat.
      const L = w.focus;
      let best = null, bd = 420 * 420;
      for (const a of w.aliens.concat(ctl.throw ? w.nests : [])) {
        const d = dist2(a.x, a.y, L.x, L.y);
        if (d < bd && w.map.lineClear(L.x, L.y, a.x, a.y)) { bd = d; best = a; }
      }
      if (best) { ctl.aimX = best.x; ctl.aimY = best.y; }
    }
    return ctl;
  },

  updateCamera(dt, w, follow) {
    const L = w.focus || w.map.start;
    let tx = L.x, ty = L.y;
    if (follow && Input.inside && !Input.touch.enabled) {
      const m = this.screenToWorld(Input.mx, Input.my);
      const dx = clamp((m.x - L.x) * 0.3, -170, 170), dy = clamp((m.y - L.y) * 0.3, -120, 120);
      tx += dx; ty += dy;
    }
    const k = 1 - Math.exp(-5 * dt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    const hw = this.viewW / 2 / this.cam.zoom, hh = this.viewH / 2 / this.cam.zoom;
    this.cam.x = w.map.pw > hw * 2 ? clamp(this.cam.x, hw, w.map.pw - hw) : w.map.pw / 2;
    this.cam.y = w.map.ph > hh * 2 ? clamp(this.cam.y, hh, w.map.ph - hh) : w.map.ph / 2;
  },

  drawCursor(g, w) {
    if (!Input.inside || Input.touch.enabled) return;
    const x = Input.mx, y = Input.my;
    const m = this.screenToWorld(x, y);
    const hot = w.aliens.some((a) => dist2(a.x, a.y, m.x, m.y) < (a.r + 6) ** 2) || w.nests.some((n) => dist2(n.x, n.y, m.x, m.y) < n.r * n.r);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const col = hot ? '#ff4a3a' : '#ffc14d';
    // Firing kicks the ticks outward a little each shot cycle.
    const kick = Input.right ? 2 + Math.sin(performance.now() / 45) * 1.5 : 0;
    const R = 12, t0 = 8 + kick, t1 = 21 + kick;
    const shape = () => {
      g.beginPath();
      g.arc(x, y, R, 0, TAU);
      for (const [a, b] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) { g.moveTo(x + a * t0, y + b * t0); g.lineTo(x + a * t1, y + b * t1); }
    };
    g.lineCap = 'round';
    // Dark halo so the reticle reads on snow, sand and hive alike.
    g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 7.5;
    shape(); g.stroke();
    g.strokeStyle = col; g.lineWidth = 3.5;
    shape(); g.stroke();
    // Centre dot
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.beginPath(); g.arc(x, y, 3.6, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill();
    g.lineCap = 'butt';
  },
};

function rankBars(n) {
  if (!n) return '<i class="dot"></i>';
  let s = '';
  for (let i = 0; i < Math.min(n, 4); i++) s += '<i></i>';
  if (n > 4) s += `<i class="star">${n > 6 ? '★★' : '★'}</i>`;
  return s;
}

// Procedural planet for the briefing screen.
function drawPlanet(canvas, M, idx) {
  const g = canvas.getContext('2d');
  const S = canvas.width, R = S * 0.42, cx = S / 2, cy = S / 2;
  g.clearRect(0, 0, S, S);
  const cols = BIOMES[M.biome].planet.map(hexToRgb);
  const nz = new Noise2D(77 + idx * 3);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy;
    if (d2 > 1) continue;
    const dz = Math.sqrt(1 - d2);
    const u = Math.atan2(dx, dz) * 2 + 3, v = dy * 2.4;
    const n = nz.fbm(u * 1.6, v * 1.6 + 5, 5);
    let c = n < 0.45 ? mixRgb(cols[1], cols[0], n / 0.45) : mixRgb(cols[0], cols[2], (n - 0.45) * 1.6);
    const light = clamp(dx * -0.6 + dy * -0.45 + dz * 0.75, 0, 1);
    const k = 0.08 + light * 1.05;
    const o = (y * S + x) * 4;
    img.data[o] = clamp(c[0] * k, 0, 255); img.data[o + 1] = clamp(c[1] * k, 0, 255); img.data[o + 2] = clamp(c[2] * k, 0, 255);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const atm = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.15);
  atm.addColorStop(0, 'rgba(0,0,0,0)');
  atm.addColorStop(0.35, rgbStr(cols[2], 0.35));
  atm.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = atm; g.fillRect(0, 0, S, S);
  // Drop marker
  const a = -0.6 + idx * 0.4;
  const mx = cx + Math.cos(a) * R * 0.45, my = cy + Math.sin(a) * R * 0.35;
  g.strokeStyle = '#ffb13a'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(mx, my, 6, 0, TAU); g.moveTo(mx - 11, my); g.lineTo(mx - 3, my); g.moveTo(mx + 3, my); g.lineTo(mx + 11, my); g.stroke();
}

window.addEventListener('load', () => Game.init());
