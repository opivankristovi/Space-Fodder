'use strict';
// Synthesised sound effects and a small step-sequencer for music. No audio files.

const Sfx = {
  ctx: null, master: null, sfxBus: null, musicBus: null, noiseBuf: null,
  muted: false, last: {},

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(comp);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.32; this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  },

  _ok(key, ms) {
    if (!this.ctx || this.muted) return false;
    const t = performance.now();
    if (key && this.last[key] && t - this.last[key] < ms) return false;
    if (key) this.last[key] = t;
    return true;
  },

  _out(pan = 0, vol = 1, bus) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p); p.connect(bus || this.sfxBus);
    } else g.connect(bus || this.sfxBus);
    return g;
  },

  _noise(dest, t, dur, type, f0, f1, q, v0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v0, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  },

  _tone(dest, t, dur, type, f0, f1, v0, attack = 0.002) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v0, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  },

  shot(pan, vol) {
    if (!this._ok('shot', 38)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.55 * vol);
    this._noise(o, t, 0.11, 'bandpass', 2600, 700, 0.9, 0.9);
    this._tone(o, t, 0.06, 'square', 220, 70, 0.35);
  },
  boom(pan, vol, size = 1) {
    if (!this._ok(null)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.9 * vol);
    this._noise(o, t, 0.9 * size, 'lowpass', 1400, 90, 0.7, 1.0);
    this._tone(o, t, 0.5 * size, 'sine', 95, 28, 0.9);
    this._noise(o, t + 0.02, 0.25, 'highpass', 3000, 1200, 0.5, 0.25);
  },
  screech(pan, vol, pitch = 1) {
    if (!this._ok('screech', 140)) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(pan, 0.22 * vol);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 * pitch; f.Q.value = 2; f.connect(o);
    const osc = this._tone(f, t, 0.32, 'sawtooth', 780 * pitch, 260 * pitch, 0.8, 0.01);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
    const lg = ctx.createGain(); lg.gain.value = 120 * pitch; lfo.connect(lg); lg.connect(osc.frequency);
    lfo.start(t); lfo.stop(t + 0.34);
  },
  squish(pan, vol) {
    if (!this._ok('squish', 50)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.5 * vol);
    this._noise(o, t, 0.18, 'lowpass', 900, 150, 1.5, 0.8);
    this._tone(o, t, 0.14, 'sine', 240, 60, 0.4);
  },
  hurt(pan, vol) {
    if (!this._ok('hurt', 90)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.35 * vol);
    this._tone(o, t, 0.16, 'square', 320, 140, 0.35);
  },
  die(pan, vol) {
    if (!this._ok('die', 120)) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(pan, 0.35 * vol);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; f.connect(o);
    const osc = this._tone(f, t, 0.6, 'sawtooth', 560, 150, 0.7, 0.02);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
    const lg = ctx.createGain(); lg.gain.value = 30; lfo.connect(lg); lg.connect(osc.frequency);
    lfo.start(t); lfo.stop(t + 0.62);
  },
  whoosh(pan, vol) {
    if (!this._ok('whoosh', 60)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.3 * vol);
    this._noise(o, t, 0.25, 'bandpass', 500, 2400, 2, 0.6);
  },
  rocket(pan, vol) {
    if (!this._ok('rocket', 60)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.5 * vol);
    this._noise(o, t, 0.55, 'bandpass', 300, 1600, 1.2, 0.9);
    this._tone(o, t, 0.4, 'sawtooth', 90, 220, 0.2);
  },
  spit(pan, vol) {
    if (!this._ok('spit', 80)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.35 * vol);
    this._noise(o, t, 0.2, 'bandpass', 1800, 400, 3, 0.7);
    this._tone(o, t, 0.12, 'sine', 500, 120, 0.3);
  },
  ping(pan, vol) {
    if (!this._ok('ping', 70)) return;
    const t = this.ctx.currentTime, o = this._out(pan, 0.14 * vol);
    this._tone(o, t, 0.09, 'triangle', 2400, 1600, 0.5);
  },
  pickup() {
    if (!this._ok('pickup', 80)) return;
    const t = this.ctx.currentTime, o = this._out(0, 0.3);
    this._tone(o, t, 0.12, 'triangle', 660, 660, 0.6);
    this._tone(o, t + 0.08, 0.2, 'triangle', 990, 990, 0.6);
  },
  click() {
    if (!this._ok('click', 30)) return;
    const t = this.ctx.currentTime, o = this._out(0, 0.2);
    this._tone(o, t, 0.05, 'square', 1200, 800, 0.3);
  },
  fanfare() {
    if (!this._ok('fanfare', 400)) return;
    const t = this.ctx.currentTime, o = this._out(0, 0.28);
    [523, 659, 784, 1046].forEach((f, i) => this._tone(o, t + i * 0.11, 0.35, 'triangle', f, f, 0.6, 0.01));
  },
  alarm() {
    if (!this._ok('alarm', 600)) return;
    const t = this.ctx.currentTime, o = this._out(0, 0.2);
    this._tone(o, t, 0.25, 'square', 440, 330, 0.4);
    this._tone(o, t + 0.28, 0.25, 'square', 440, 330, 0.4);
  },
  engine(dur = 3) {
    if (!this._ok('engine', 500)) return;
    const t = this.ctx.currentTime, o = this._out(0, 0.5);
    this._noise(o, t, dur, 'lowpass', 180, 900, 1, 0.9);
    this._tone(o, t, dur, 'sawtooth', 55, 80, 0.12, 0.4);
  },
};

// Tiny pattern sequencer. Patterns are original, written for this game.
const Music = {
  current: null, timer: null, step: 0, next: 0,
  tracks: {
    title: {
      bpm: 116, len: 32,
      kick:  'x...x...x...x...x...x...x...x.x.',
      snare: '....x.......x.x.....x.......x.xx',
      hat:   '..x...x...x...x...x...x...x...x.',
      bass: [45,0,45,0,52,0,45,0,48,0,48,0,50,0,52,0, 45,0,45,0,52,0,55,0,53,0,52,0,50,0,48,0],
      lead: [69,0,0,0,72,0,76,0,0,0,74,0,72,0,0,0, 69,0,0,0,72,0,79,0,0,0,77,0,76,0,74,0],
      leadWave: 'square', leadVol: 0.1,
    },
    battle: {
      bpm: 100, len: 32,
      kick:  'x.....x...x.....x.....x...x..x..',
      snare: '........x...............x.......',
      hat:   'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.',
      bass: [38,0,0,38,0,0,41,0,38,0,0,38,0,0,36,0, 38,0,0,38,0,0,41,0,43,0,0,41,0,0,40,0],
      lead: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 62,0,0,0,65,0,0,0,64,0,0,0,0,0,0,0],
      leadWave: 'triangle', leadVol: 0.06, hatVol: 0.04,
    },
    somber: {
      bpm: 72, len: 32,
      kick:  'x...............x...............',
      snare: '................................',
      hat:   '................................',
      bass: [45,0,0,0,0,0,0,0,41,0,0,0,0,0,0,0, 43,0,0,0,0,0,0,0,40,0,0,0,0,0,0,0],
      lead: [69,0,0,0,72,0,71,0,69,0,0,0,65,0,0,0, 67,0,0,0,71,0,69,0,67,0,0,0,64,0,0,0],
      leadWave: 'triangle', leadVol: 0.12,
    },
  },

  play(name) {
    if (!Sfx.ctx || this.current === name) return;
    this.stop();
    this.current = name;
    this.step = 0;
    this.next = Sfx.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._tick(), 25);
  },
  stop() { clearInterval(this.timer); this.timer = null; this.current = null; },

  _tick() {
    const tr = this.tracks[this.current];
    if (!tr || !Sfx.ctx) return;
    const spb = 60 / tr.bpm / 4;
    while (this.next < Sfx.ctx.currentTime + 0.15) {
      this._playStep(tr, this.step % tr.len, this.next, spb);
      this.next += spb; this.step++;
    }
  },

  _playStep(tr, i, t, spb) {
    const bus = Sfx.musicBus;
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    if (tr.kick[i] === 'x') Sfx._tone(bus, t, 0.28, 'sine', 140, 38, 0.9);
    if (tr.snare[i] === 'x') { Sfx._noise(bus, t, 0.16, 'highpass', 1600, 900, 0.7, 0.35); Sfx._tone(bus, t, 0.08, 'triangle', 200, 150, 0.25); }
    if (tr.hat[i] === 'x') Sfx._noise(bus, t, 0.04, 'highpass', 8000, 7000, 0.7, tr.hatVol || 0.08);
    if (tr.bass[i]) {
      const f = Sfx.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 4; f.connect(bus);
      Sfx._tone(f, t, spb * 1.8, 'sawtooth', midi(tr.bass[i]), midi(tr.bass[i]), 0.35, 0.005);
    }
    if (tr.lead[i]) {
      const f = Sfx.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200; f.connect(bus);
      Sfx._tone(f, t, spb * 3.5, tr.leadWave, midi(tr.lead[i]), midi(tr.lead[i]), tr.leadVol, 0.01);
    }
  },
};
