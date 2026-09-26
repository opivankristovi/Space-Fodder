'use strict';
// Mouse, keyboard and touch state with per-frame edge detection.

const Input = {
  mx: 0, my: 0, inside: false,
  left: false, right: false, middle: false,
  leftPressed: false, rightPressed: false, middlePressed: false,
  keys: new Set(),
  pressed: new Set(),
  touch: { enabled: false, tap: null, fire: false, throwPressed: false },
  canvas: null,

  init(canvas) {
    this.canvas = canvas;
    try { this.touch.enabled = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* no matchMedia */ }
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mx = e.clientX - r.left;
      this.my = e.clientY - r.top;
      this.inside = this.mx >= 0 && this.my >= 0 && this.mx <= r.width && this.my <= r.height;
    };
    canvas.addEventListener('mousedown', (e) => {
      pos(e);
      if (e.button === 0) {
        // Ctrl+click acts as right click for one-button trackpads.
        if (e.ctrlKey) { this.right = true; this.rightPressed = true; this._ctrlRight = true; }
        else { this.left = true; this.leftPressed = true; }
      } else if (e.button === 2) { this.right = true; this.rightPressed = true; }
      else if (e.button === 1) { this.middle = true; this.middlePressed = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.left = false;
        if (this._ctrlRight) { this.right = false; this._ctrlRight = false; }
      }
      if (e.button === 2) this.right = false;
      if (e.button === 1) this.middle = false;
    });
    window.addEventListener('mousemove', pos);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (Game && Game.state === 'playing' && ['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.reset());

    // Touch: tap to move; on-screen buttons handle firing and throwing.
    canvas.addEventListener('touchstart', (e) => {
      if (!this.touch.enabled) { this.touch.enabled = true; const tc = document.getElementById('touch'); if (tc && Game.state === 'playing') tc.hidden = false; }
      const t = e.changedTouches[0];
      const r = canvas.getBoundingClientRect();
      this.mx = t.clientX - r.left; this.my = t.clientY - r.top;
      this.touch.tap = { x: this.mx, y: this.my };
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      const r = canvas.getBoundingClientRect();
      this.mx = t.clientX - r.left; this.my = t.clientY - r.top;
      this.touch.tap = { x: this.mx, y: this.my };
      e.preventDefault();
    }, { passive: false });
  },

  reset() {
    this.left = this.right = this.middle = false;
    this._ctrlRight = false;
    this.keys.clear();
    this.touch.fire = false;
  },

  down(code) { return this.keys.has(code); },
  hit(code) { return this.pressed.has(code); },

  endFrame() {
    this.leftPressed = this.rightPressed = this.middlePressed = false;
    this.pressed.clear();
    this.touch.tap = null;
    this.touch.throwPressed = false;
  },
};
