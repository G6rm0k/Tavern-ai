// ── FX ENGINE ──────────────────────────────────────────────────────────────────
const FX = {
  canvas: null, ctx: null, pts: [], raf: null,
  enabled: true,

  init() {
    this.canvas = document.getElementById('fx-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this._make();
    this._loop();
  },

  resize() {
    if (!this.canvas) return;
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  _accentRGB() {
    // Try to read the custom --accent color from inline styles
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (hex && hex.startsWith('#')) {
      const r = parseInt(hex.slice(1,3), 16) || 140;
      const g = parseInt(hex.slice(3,5), 16) || 90;
      const b = parseInt(hex.slice(5,7), 16) || 255;
      return [r, g, b];
    }
    return [140, 90, 255]; // fallback purple
  },

  _make() {
    const n = Math.min(35, Math.floor(window.innerWidth / 32));
    this.pts = Array.from({ length: n }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.8 + .4,
      vx: (Math.random() - .5) * .25,
      vy: (Math.random() - .5) * .25,
      op: Math.random() * .45 + .08,
      ph: Math.random() * Math.PI * 2,
      ps: Math.random() * .015 + .004,
    }));
  },

  _loop() {
    if (!this.ctx || !this.enabled) return;
    const { width: W, height: H } = this.canvas;
    this.ctx.clearRect(0, 0, W, H);
    const t = Date.now() * .001;
    const [r,g,b] = this._accentRGB();
    for (const p of this.pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -4) p.x = W + 4; if (p.x > W + 4) p.x = -4;
      if (p.y < -4) p.y = H + 4; if (p.y > H + 4) p.y = -4;
      const op = p.op * (.7 + .3 * Math.sin(t * p.ps * 60 + p.ph));
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${r},${g},${b},${op})`;
      this.ctx.fill();
    }
    this.raf = requestAnimationFrame(() => this._loop());
  },

  refreshAccent() { /* pts already use live DOM attribute */ },
  destroy() { if (this.raf) cancelAnimationFrame(this.raf); }
};

// ── ANIMATIONS ─────────────────────────────────────────────────────────────────
const Anim = {
  enabled: true,
  speedFactor: 1, // 0.2 = slow, 1 = normal, 3 = fast

  _dur(ms) { return Math.max(30, Math.round(ms / this.speedFactor)); },

  in(el, { delay = 0, from = 'bottom', d = 14 } = {}) {
    if (!this.enabled || !el) return;
    const t = { bottom:`translateY(${d}px) scale(.97)`, top:`translateY(-${d}px) scale(.97)`,
                left:`translateX(-${d}px)`, right:`translateX(${d}px)`, scale:`scale(.88)` };
    const dl = Math.round(delay / this.speedFactor);
    el.style.cssText += `opacity:0;transform:${t[from]||t.bottom};transition:none`;
    requestAnimationFrame(() => setTimeout(() => {
      el.style.transition = `opacity ${this._dur(320)}ms cubic-bezier(.16,1,.3,1) ${dl}ms, transform ${this._dur(440)}ms cubic-bezier(.34,1.56,.64,1) ${dl}ms`;
      el.style.opacity = '1'; el.style.transform = 'none';
    }, 10));
  },

  stagger(parent, sel = ':scope > *', gap = 45) {
    if (!this.enabled || !parent) return;
    const g = Math.round(gap / this.speedFactor);
    parent.querySelectorAll(sel).forEach((c, i) => this.in(c, { delay: i * g }));
  },

  bounce(el) {
    if (!el) return;
    el.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(.95)' }, { transform: 'scale(1)' }
    ], { duration: this._dur(380), easing: 'cubic-bezier(.34,1.56,.64,1)' });
  },

  shake(el) {
    if (!el) return;
    el.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' },
      { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }
    ], { duration: this._dur(400), easing: 'ease-out' });
  },

  msgIn(el) {
    if (!this.enabled || !el) return;
    el.style.opacity = '0'; el.style.transform = 'translateY(12px) scale(.96)';
    el.style.transition = 'none';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = `opacity ${this._dur(240)}ms cubic-bezier(.16,1,.3,1), transform ${this._dur(360)}ms cubic-bezier(.34,1.56,.64,1)`;
      el.style.opacity = '1'; el.style.transform = 'none';
    }));
  }
};

// ── SOUNDS ─────────────────────────────────────────────────────────────────────
const Sounds = {
  enabled: false, ctx: null,
  init() {
    document.addEventListener('touchend', () => {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }, { once: true, passive: true });
    document.addEventListener('click', () => {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }, { once: true });
  },
  play(type = 'msg') {
    if (!this.enabled || !this.ctx) return;
    const cfg = { msg:{f:900,t:'sine',d:.09,v:.04}, send:{f:1100,t:'sine',d:.07,v:.035}, error:{f:180,t:'sawtooth',d:.18,v:.04} };
    const c = cfg[type] || cfg.msg;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.connect(g); g.connect(this.ctx.destination);
    o.type = c.t; o.frequency.setValueAtTime(c.f, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(c.f * .75, this.ctx.currentTime + c.d);
    g.gain.setValueAtTime(c.v, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, this.ctx.currentTime + c.d);
    o.start(); o.stop(this.ctx.currentTime + c.d);
  }
};

// ── ZOOM LOCK ─────────────────────────────────────────────────────────────────
// Prevent pinch-zoom globally — especially in chat view
(function() {
  // Block gesture events (Safari iOS)
  document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });

  // Block pinch touchmove (all browsers)
  document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  // Double-tap zoom prevention via fast click tracking
  let lastTap = 0;
  document.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastTap < 300) {
      e.preventDefault();
    }
    lastTap = now;
  }, { passive: false });
})();

// ── ELASTIC PILL NAV ───────────────────────────────────────────────────────────
const ElasticNav = {
  pill: null,
  startY: 0, startX: 0,
  curX: 0, curY: 0,
  dragging: false,
  LIMIT: 80, // max drag distance

  init() {
    // Wait for DOM
    const tryInit = () => {
      this.pill = document.querySelector('.mob-nav-pill');
      if (!this.pill) return setTimeout(() => tryInit(), 300);
      this._bind();
    };
    setTimeout(() => tryInit(), 600);
    // Re-init when navigating (new DOM)
    document.addEventListener('click', () => setTimeout(() => {
      const p = document.querySelector('.mob-nav-pill');
      if (p && p !== this.pill) { this.pill = p; this._bind(); }
    }, 400));
  },

  _bind() {
    const pill = this.pill;
    pill.addEventListener('touchstart', e => {
      this.dragging = true;
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
      this.curX = 0; this.curY = 0;
      pill.classList.add('dragging');
      pill.style.transition = 'box-shadow 300ms ease';
    }, { passive: true });

    pill.addEventListener('touchmove', e => {
      if (!this.dragging) return;
      const dx = e.touches[0].clientX - this.startX;
      const dy = e.touches[0].clientY - this.startY;
      // Rubber-band resistance — gets harder the further you pull
      const resistance = 0.28;
      const rx = this._resist(dx, this.LIMIT) * resistance;
      const ry = this._resist(dy, this.LIMIT) * resistance;
      this.curX = rx; this.curY = Math.min(ry, 0); // only up
      pill.style.transform = `translate(${rx}px, ${Math.min(ry, 0)}px) scale(${1 + Math.abs(ry) * 0.002})`;
    }, { passive: true });

    const release = () => {
      if (!this.dragging) return;
      this.dragging = false;
      pill.classList.remove('dragging');
      // Spring back
      pill.style.transition = 'transform 600ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 300ms ease';
      pill.style.transform = 'translate(0,0) scale(1)';
    };
    pill.addEventListener('touchend',    release, { passive: true });
    pill.addEventListener('touchcancel', release, { passive: true });
  },

  // Exponential rubber-band resistance
  _resist(delta, limit) {
    const sign = delta > 0 ? 1 : -1;
    const abs = Math.abs(delta);
    return sign * limit * (1 - Math.exp(-abs / limit));
  }
};
