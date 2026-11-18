/* Apple-style "Software Update" sheet, rasterised into 2D canvases (the two
   screens the wave travels between) + the icon → check badge animation. */
(function () {
  'use strict';
  const DW = (window.DW = window.DW || {});
  const { cubicBezier } = DW;

  const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
  const COLORS = {
    surface: '#1c1c1e',
    group: '#2c2c2e',
    separator: 'rgba(84, 84, 88, 0.65)',
    label: '#ffffff',
    secondary: 'rgba(235, 235, 245, 0.6)',
    tertiary: 'rgba(235, 235, 245, 0.3)',
    green: '#30d158',
  };
  const CARD = { w: 360, h: 462, radius: 36, pad: 20 };
  const BADGE = { size: 64, pad: 8, x: 148, y: 28 };
  const BUTTON = { x: 20, y: 392, w: 320, h: 50 };

  // ───────────────────────── text helpers ─────────────────────────
  const metricsCache = new Map();
  function lineBaseline(ctx, size, lineTop, lineH) {
    let m = metricsCache.get(ctx.font);
    if (!m) {
      const t = ctx.measureText('Hg');
      m = { asc: t.fontBoundingBoxAscent ?? size * 0.95, desc: t.fontBoundingBoxDescent ?? size * 0.24 };
      metricsCache.set(ctx.font, m);
    }
    return lineTop + (lineH - (m.asc + m.desc)) / 2 + m.asc;
  }
  function text(ctx, str, x, lineTop, opt) {
    const size = opt.size || 17, lh = opt.lh || 22;
    ctx.font = `${opt.weight || 400} ${size}px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = opt.spacing || '0px';
    ctx.fillStyle = opt.color || COLORS.label;
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, lineBaseline(ctx, size, lineTop, lh));
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  // ───────────────────────── badge ─────────────────────────
  const X = cubicBezier(0.34, 1.35, 0.64, 1);
  const M = cubicBezier(0.22, 1, 0.36, 1);
  const POP = cubicBezier(0.14, 2.56, 0.94, 1);
  const BOUNCE = cubicBezier(0.34, 1.96, 0.94, 1);
  const EASE_OUT_IN = cubicBezier(0, 0, 0.58, 1);
  const F = (s) => (s <= 0 ? 0 : s >= 1 ? 1 : s);
  const CHECK = new Path2D('M4.6 10.6L8.3 14.2L15.4 6.2');
  const BADGE_ANIM = 0.85; // seconds

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  function topHighlight(ctx, t, alpha) {
    const a = t / 2;
    ctx.save();
    circle(ctx, a, a, a);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(a, a, a, 0, Math.PI * 2);
    ctx.arc(a, a + 1, a, 0, Math.PI * 2, true);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fill('evenodd');
    ctx.restore();
  }

  // Settings-like app icon: graphite squircle with a gear.
  function drawIcon(ctx, p) {
    const c = p / 2;
    const bg = ctx.createLinearGradient(0, 0, 0, p);
    bg.addColorStop(0, '#9a9aa1');
    bg.addColorStop(1, '#5c5c62');
    roundRect(ctx, 0, 0, p, p, p * 0.225);
    ctx.fillStyle = bg;
    ctx.fill();
    const s = p / 64;
    ctx.save();
    ctx.translate(c, c);
    const gear = ctx.createLinearGradient(0, -22 * s, 0, 22 * s);
    gear.addColorStop(0, '#f2f2f7');
    gear.addColorStop(1, '#c7c7cc');
    ctx.fillStyle = gear;
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.rotate((i / 12) * Math.PI * 2);
      roundRect(ctx, -3.4 * s, -23 * s, 6.8 * s, 9 * s, 1.6 * s);
      ctx.fill();
      ctx.restore();
    }
    circle(ctx, 0, 0, 17.5 * s);
    ctx.fill();
    circle(ctx, 0, 0, 12.5 * s);
    ctx.fillStyle = '#6e6e74';
    ctx.fill();
    circle(ctx, 0, 0, 7 * s);
    ctx.fillStyle = gear;
    ctx.fill();
    circle(ctx, 0, 0, 3 * s);
    ctx.fillStyle = '#6e6e74';
    ctx.fill();
    ctx.restore();
    roundRect(ctx, 0.5, 0.5, p - 1, p - 1, p * 0.225);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.stroke();
  }

  function drawSuccess(ctx, t, reveal) {
    const i = t / 2;
    circle(ctx, i, i, i);
    ctx.fillStyle = COLORS.green;
    ctx.fill();
    topHighlight(ctx, t, 0.3);
    const c = t / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(t / 4, t / 4, c * reveal, c);
    ctx.clip();
    ctx.translate(t / 4, t / 4);
    ctx.scale(c / 20, c / 20);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    ctx.stroke(CHECK);
    ctx.restore();
  }

  class Badge {
    constructor() {
      this.a = document.createElement('canvas');
      this.b = document.createElement('canvas');
    }
    /* l = seconds since the badge was told it's done (null / <0 = not yet). */
    draw(l, f) {
      const p = BADGE.size, u = p + BADGE.pad * 2, o = Math.round(u * f);
      for (const c of [this.a, this.b]) if (c.width !== o) { c.width = o; c.height = o; }
      let m = 1, j = 0, g = 0, b = 0, y = 1, N = 0.17;
      if (l != null && l >= 0) {
        const S = (1.5 * p) / 62, x = (6 * p) / 62;
        m = 1 - EASE_OUT_IN(F(l / 0.245));
        j = Math.min(1, X(F(l / 0.35)));
        g = l < 0.1575 ? S * X(l / 0.1575) : l < 0.4075 ? S * (1 - M((l - 0.1575) / 0.25)) : 0;
        b = l < 0.25 ? -x * X(l / 0.25) : l < 0.55 ? -x * (1 - POP((l - 0.25) / 0.3)) : 0;
        y = l < 0.15 ? 1 - 0.1 * M(l / 0.15) : l < 0.5 ? 0.9 + 0.1 * BOUNCE((l - 0.15) / 0.35) : 1;
        N = 0.17 + 0.68 * M(F((l - 0.23) / 0.6));
      }
      const r = this.a.getContext('2d'), v = this.b.getContext('2d');
      r.setTransform(1, 0, 0, 1, 0, 0);
      r.clearRect(0, 0, o, o);
      r.setTransform(f * y, 0, 0, f * y, f * (u / 2), f * (u / 2 + b));
      r.translate(-p / 2, -p / 2);
      if (m > 0.001) { r.globalAlpha = m; drawIcon(r, p); }
      if (j > 0.001) { r.globalAlpha = j; drawSuccess(r, p, N); }
      r.globalAlpha = 1;
      v.setTransform(1, 0, 0, 1, 0, 0);
      v.clearRect(0, 0, o, o);
      if (g > 0.01) v.filter = `blur(${g * f}px)`;
      v.drawImage(this.a, 0, 0);
      v.filter = 'none';
      return this.b;
    }
  }

  // ───────────────────────── screen ─────────────────────────
  /* Draws one state of the sheet at `scale` device px per CSS px. */
  function drawScreen(canvas, scale, state) {
    const W = Math.round(CARD.w * scale), H = Math.round(CARD.h * scale);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(W / CARD.w, 0, 0, H / CARD.h, 0, 0);
    const cx = CARD.w / 2;

    if (state.badge) {
      const s = BADGE.size + BADGE.pad * 2;
      ctx.drawImage(state.badge, BADGE.x - BADGE.pad, BADGE.y - BADGE.pad, s, s);
    }

    // title + subtitle
    text(ctx, 'iOS 26.2', cx, 108, { weight: 700, size: 22, lh: 28, align: 'center', spacing: '-0.26px' });
    text(ctx, state.done ? `Installed today, ${state.arrived}` : 'Apple Inc. · 3.41 GB', cx, 138, {
      size: 15, lh: 20, align: 'center', color: COLORS.secondary,
    });

    // description
    const lines = state.done
      ? ['Your iPhone is up to date.', 'Everything is ready to go.']
      : ['Bug fixes and important security', 'updates for your iPhone.'];
    lines.forEach((l, i) => text(ctx, l, cx, 176 + i * 20, { size: 15, lh: 20, align: 'center', color: COLORS.secondary }));

    // inset grouped list
    const gx = CARD.pad, gy = 238, gw = CARD.w - CARD.pad * 2, rowH = 44;
    const rows = [
      ['Version', '26.2 (23C71)'],
      ['Security', '14 fixes'],
      ['Restart', state.done ? 'Not needed' : 'Required'],
    ];
    roundRect(ctx, gx, gy, gw, rowH * rows.length, 22);
    ctx.fillStyle = COLORS.group;
    ctx.fill();
    rows.forEach(([label, value], i) => {
      const y = gy + i * rowH;
      if (i > 0) {
        ctx.fillStyle = COLORS.separator;
        ctx.fillRect(gx + 16, y, gw - 16, 0.5);
      }
      text(ctx, label, gx + 16, y + 11, { size: 17, lh: 22 });
      text(ctx, value, gx + gw - 16, y + 11, { size: 17, lh: 22, align: 'right', color: COLORS.secondary });
    });
    return canvas;
  }

  Object.assign(DW, { CARD, BUTTON, COLORS, Badge, BADGE_ANIM, drawScreen });
})();
