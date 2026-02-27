// ── LIQUID DROP NAV ────────────────────────────────────────────────────────────
// Morphing blob that slides between nav items.
// Close items: smooth roll. Far items: stretch like taffy then snap.
const LiquidDrop = {
  canvas: null, ctx: null,
  pill:   null,
  raf:    null,

  // Current blob state (canvas pixel coords)
  cx: 0, cy: 0,
  tx: 0, ty: 0,
  r:  30,           // base radius

  // Stretch / wobble
  stretchX: 0, stretchY: 0,
  _wobble: false, _wobbleStart: 0,

  // Loop guard — incrementing token; stale loops self-terminate
  _loopId: 0,

  // Color — initialised to purple so it's never null
  color: [139, 92, 246],

  // ── init ──────────────────────────────────────────────────
  init() {
    const tryInit = () => {
      this.canvas = document.getElementById('drop-canvas');
      this.pill   = document.getElementById('mob-pill');
      if (!this.canvas || !this.pill) return setTimeout(tryInit, 300);

      this._resize();
      this._updateColor();
      this.ctx = this.canvas.getContext('2d');

      // MutationObserver for accent changes
      new MutationObserver(() => this._updateColor())
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });

      // Snap to active item then start drawing loop
      setTimeout(() => {
        const active = this.pill && this.pill.querySelector('.mob-nav-item.on');
        if (active) this.snap(active);
        this._startLoop();
      }, 100);
    };
    setTimeout(tryInit, 700);
  },

  // ── sizing ────────────────────────────────────────────────
  _resize() {
    if (!this.canvas || !this.pill) return;
    // Use getBoundingClientRect; fall back to offsetWidth so we always get a real size
    const rect = this.pill.getBoundingClientRect();
    const w = rect.width  || this.pill.offsetWidth  || 320;
    const h = rect.height || this.pill.offsetHeight || 72;
    this.canvas.width  = Math.round(w);
    this.canvas.height = Math.round(h);
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
  },

  // ── color ─────────────────────────────────────────────────
  _updateColor() {
    const map = {
      purple: [139, 92, 246],
      blue:   [59, 130, 246],
      pink:   [236, 72, 153],
      green:  [34, 197, 94],
      orange: [249, 115, 22],
      red:    [239, 68, 68],
      cyan:   [6, 182, 212],
    };
    this.color = map[document.documentElement.getAttribute('data-accent') || 'purple'] || [139, 92, 246];
  },

  // ── helpers ───────────────────────────────────────────────
  _itemCenter(el) {
    if (!this.canvas || !el) return { x: 0, y: 0 };
    const cr = this.canvas.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return {
      x: er.left + er.width  / 2 - cr.left,
      y: er.top  + er.height / 2 - cr.top,
    };
  },

  snap(el) {
    const c = this._itemCenter(el);
    this.cx = this.tx = c.x;
    this.cy = this.ty = c.y;
    this.stretchX = this.stretchY = 0;
  },

  // ── animated move ─────────────────────────────────────────
  moveTo(fromEl, toEl) {
    const from = this._itemCenter(fromEl);
    const to   = this._itemCenter(toEl);
    const dist = Math.abs(to.x - from.x);

    this.cx = from.x; this.cy = from.y;
    this.tx = to.x;   this.ty = to.y;

    const maxStretch = Math.min(dist * 0.55, 80);
    const duration   = 120 + dist * 0.8;
    const startTime  = performance.now();
    const startCx    = from.x;

    const animate = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.cx = startCx + (this.tx - startCx) * eased;

      const stretchT = Math.sin(t * Math.PI);
      const sign     = this.tx > startCx ? 1 : -1;
      this.stretchX  = sign * maxStretch * stretchT;
      this.stretchY  = -maxStretch * 0.25 * stretchT;

      if (t >= 1) {
        this.stretchX = this.stretchY = 0;
        this.cx = this.tx; this.cy = this.ty;
        this._wobble = true;
        this._wobbleStart = performance.now();
        return;
      }
      this.raf = requestAnimationFrame(animate);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(animate);
  },

  // ── draw loop ─────────────────────────────────────────────
  // Incrementing _loopId ensures previous loops stop when a new one starts.
  _startLoop() {
    this._loopId++;
    const id = this._loopId;
    const step = () => {
      if (this._loopId !== id) return;   // stale — exit cleanly
      requestAnimationFrame(step);        // schedule BEFORE drawing so errors can't kill the loop
      this._draw();
    };
    requestAnimationFrame(step);
  },

  _draw() {
    if (!this.ctx || !this.canvas) return;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Canvas not sized yet — try to recover
    if (!W || !H) { this._resize(); return; }

    try {
      this.ctx.clearRect(0, 0, W, H);

      // Wobble decay after arrival
      let extraX = 0, extraY = 0;
      if (this._wobble) {
        const age = performance.now() - this._wobbleStart;
        if (age < 600) {
          const decay  = 1 - age / 600;
          const wobble = Math.sin(age * 0.04) * 8 * decay;
          extraX = wobble; extraY = -wobble * 0.4;
        } else {
          this._wobble = false;
        }
      }

      const [r, g, b] = this.color;
      const rx = this.r + Math.abs(this.stretchX) + Math.abs(extraX);
      const ry = Math.max(this.r + this.stretchY + extraY, 8);
      const cx = this.cx, cy = this.cy;

      // Outer glow
      const grd = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, rx * 1.8);
      grd.addColorStop(0,   `rgba(${r},${g},${b},0.35)`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},0.15)`);
      grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      this.ctx.fillStyle = grd;
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, Math.max(rx * 1.8, 4), Math.max(ry * 1.8, 4), 0, 0, Math.PI * 2);
      this.ctx.fill();

      // Main blob — rounded ellipse via bezier curves
      this.ctx.save();
      this.ctx.translate(cx, cy);
      const hw  = Math.max(rx, 4);
      const hh  = Math.max(ry, 4);
      const cp  = 0.552 * hw;
      const cpY = 0.552 * hh;
      this.ctx.beginPath();
      this.ctx.moveTo( hw,  0);
      this.ctx.bezierCurveTo( hw, -cpY,  cp, -hh,  0, -hh);
      this.ctx.bezierCurveTo(-cp, -hh, -hw, -cpY, -hw,  0);
      this.ctx.bezierCurveTo(-hw,  cpY, -cp,  hh,   0,  hh);
      this.ctx.bezierCurveTo( cp,  hh,  hw,  cpY,  hw,  0);
      this.ctx.closePath();

      this.ctx.fillStyle   = `rgba(${r},${g},${b},0.90)`;
      this.ctx.shadowColor = `rgba(${r},${g},${b},0.7)`;
      this.ctx.shadowBlur  = 18;
      this.ctx.fill();

      // Inner highlight — top-left shimmer
      const hlGrd = this.ctx.createRadialGradient(-hw * 0.25, -hh * 0.35, 0, 0, 0, hw);
      hlGrd.addColorStop(0,   'rgba(255,255,255,0.40)');
      hlGrd.addColorStop(0.5, 'rgba(255,255,255,0.10)');
      hlGrd.addColorStop(1,   'rgba(255,255,255,0)');
      this.ctx.fillStyle = hlGrd;
      this.ctx.fill();

      this.ctx.restore();
    } catch (_) {
      // Drawing error — silently swallowed; the loop continues uninterrupted.
    }
  },
};

// Re-init when nav re-renders (e.g. after login or page change)
document.addEventListener('click', () => {
  setTimeout(() => {
    const newCanvas = document.getElementById('drop-canvas');
    if (newCanvas && newCanvas !== LiquidDrop.canvas) {
      LiquidDrop.canvas = newCanvas;
      LiquidDrop.pill   = document.getElementById('mob-pill');
      LiquidDrop._resize();
      LiquidDrop.ctx = newCanvas.getContext('2d');
      const active = LiquidDrop.pill?.querySelector('.mob-nav-item.on');
      if (active) LiquidDrop.snap(active);
      LiquidDrop._startLoop();   // replaces any previous loop via _loopId guard
    }
  }, 350);
});

window.addEventListener('resize', () => {
  LiquidDrop._resize();
  const active = LiquidDrop.pill?.querySelector('.mob-nav-item.on');
  if (active) LiquidDrop.snap(active);
});
