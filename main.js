/* Timeline + DOM glue. The whole scene is a pure function of T (seconds
   since the Confirm press), so play, scrub and screenshots all agree. */
(function () {
  'use strict';
  const DW = window.DW;
  const { clamp, smooth, cubicBezier, easeOut } = DW;

  // ───────────── geometry (same maths as the original's measure()) ─────────────
  const CARD = DW.CARD, BUTTON = DW.BUTTON;
  const style = DW.createStyle();
  style.palette = DW.PALETTES.siri;
  const k = clamp(Math.sqrt((CARD.w * CARD.h) / (393 * 852)), 0.6, 2.2); // view scale
  const vw = CARD.w / k, vh = CARD.h / k;
  style.cornerRadius = CARD.radius / k;
  style.hairlineWidth /= Math.sqrt(k);
  style.particleSize /= Math.sqrt(k);
  const src = { x: BUTTON.x / k, y: BUTTON.y / k, w: BUTTON.w / k, h: BUTTON.h / k };
  const bs = Math.min(window.devicePixelRatio || 1, Math.sqrt(9e6 / (CARD.w * CARD.h)));
  const PX_W = Math.round(CARD.w * bs), PX_H = Math.round(CARD.h * bs);

  // ───────────── timeline (from the playground component) ─────────────
  const TOTAL = DW.duration(style);                          // 3.62 s
  const SWAP_AT = style.anticipation + style.travel * 0.18;  // badge → check, Confirm → Done
  const GULP_END = style.anticipation;                       // button squeeze
  const BEAM_OFF = style.anticipation + style.travel * 0.8;  // button border beam
  const HOLD = 2;      // rest on "Done" before resetting
  const LEAD_IN = 0.9; // delay before an autoplayed press

  // ───────────── DOM ─────────────
  const $ = (id) => document.getElementById(id);
  const canvas = $('wave'), action = $('action'), title = $('ctaTitle'), cta = $('cta');
  const beamIn = $('beamInner'), beamOut = $('beamOuter'), playBtn = $('play');
  const scrub = $('scrub'), scrubOut = $('scrubOut');
  scrub.max = (TOTAL + HOLD).toFixed(2);

  const renderer = new DW.Renderer(canvas);
  renderer.setSize(PX_W, PX_H, vw, vh);

  const badge = new DW.Badge();
  const contentCv = document.createElement('canvas');
  const revealedCv = document.createElement('canvas');
  const particles = DW.createParticles(style);
  const dots = { data: new Float32Array(particles.length * 3), count: 0 };
  const spot = { x: 0, y: 0, a: 0 };
  const front = {};

  const timeLabel = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  let arrived = timeLabel();

  // ───────────── state ─────────────
  let mode = 'idle';   // idle | run | scrub
  let startedAt = 0;   // performance.now() of T = 0
  let fixedT = -1;
  let playing = false;
  let screensKey = '';
  let lastT = NaN;

  function currentT(now) {
    if (mode === 'run') return (now - startedAt) / 1000;
    if (mode === 'scrub') return fixedT;
    return -1;
  }

  function updateScreens(T, force) {
    const l = T >= SWAP_AT ? T - SWAP_AT : null;
    const key = l == null ? 'avatar' : l > DW.BADGE_ANIM ? 'done' : 'anim';
    if (!force && key !== 'anim' && key === screensKey) return;
    screensKey = key;
    const b = badge.draw(l, bs);
    DW.drawScreen(contentCv, bs, { done: false, badge: b });
    DW.drawScreen(revealedCv, bs, { done: true, arrived, badge: b });
    renderer.setScreen('content', contentCv, style.blur);
    renderer.setScreen('revealed', revealedCv, style.blur);
  }

  function renderWave(T) {
    const p = T / TOTAL;
    if (p <= 0 || p >= 1) {
      renderer.render(null, style, null, null, p >= 1);
      return;
    }
    DW.waveFront(p, src, vw, vh, style, front);
    const lumps = DW.rimLumps(p * TOTAL, vw, vh, style.cornerRadius, style.rimPulse);
    let n = 0;
    if (front.time > 0) {
      for (const pt of particles) {
        DW.particleAt(pt, front, src, style, spot);
        if (spot.a <= 0.002) continue;
        dots.data[n * 3] = spot.x;
        dots.data[n * 3 + 1] = spot.y;
        dots.data[n * 3 + 2] = Math.floor(pt.size * 10) + Math.min(spot.a, 0.999);
        n++;
      }
    }
    dots.count = n;
    renderer.render(front, style, lumps, dots, false);
  }

  // button: squeeze while the wave gathers, spring back, swap label, beam
  const squeeze = cubicBezier(0.4, 0, 0.6, 1);
  const spring = cubicBezier(0.34, 1.35, 0.64, 1);
  let shownLabel = '';
  function renderButton(T) {
    let s = 1;
    if (T >= 0 && T < GULP_END) s = 1 - 0.03 * squeeze(T / GULP_END);
    else if (T >= GULP_END) s = 0.97 + 0.03 * spring(Math.min((T - GULP_END) / 0.28, 1));
    action.style.transform = `scale(${s.toFixed(4)})`;

    const done = T >= SWAP_AT;
    const label = done ? 'Done' : 'Install Now';
    if (label !== shownLabel) { title.textContent = label; shownLabel = label; }
    if (done) {
      const q = easeOut(clamp((T - SWAP_AT) / 0.38, 0, 1));
      title.style.opacity = q.toFixed(3);
      title.style.filter = q < 1 ? `blur(${(6 * (1 - q)).toFixed(2)}px)` : 'none';
      title.style.transform = `scale(${(0.9 + 0.1 * q).toFixed(4)})`;
    } else {
      title.style.opacity = '1';
      title.style.filter = 'none';
      title.style.transform = 'none';
    }

    const beam = T < 0 ? 0 : smooth(0, 0.45, T) * (1 - smooth(BEAM_OFF, BEAM_OFF + 0.6, T));
    const hue = (Math.max(T, 0) * 40) % 360;
    beamIn.style.opacity = (beam * 0.38).toFixed(3);
    beamOut.style.opacity = (beam * 0.3).toFixed(3);
    beamIn.style.filter = `blur(8px) saturate(1.4) hue-rotate(${hue.toFixed(1)}deg)`;
    beamOut.style.filter = `blur(9px) saturate(1.3) hue-rotate(${hue.toFixed(1)}deg)`;
  }

  function frame(now) {
    let T = currentT(now);
    if (mode === 'run' && T >= TOTAL + HOLD) {
      // reset, like the playground does after landing
      if (playing) {
        startedAt = now + LEAD_IN * 1000;
        arrived = timeLabel();
      } else {
        mode = 'idle';
      }
      screensKey = '';
      T = currentT(now);
    }
    if (T !== lastT || screensKey === '') {
      updateScreens(T, screensKey === '');
      renderWave(T);
      renderButton(T);
      lastT = T;
    }
    if (mode !== 'scrub') {
      scrub.value = Math.max(T, 0).toFixed(2);
      scrubOut.textContent = `${Math.max(T, 0).toFixed(2)} s`;
    }
    requestAnimationFrame(frame);
  }

  // ───────────── controls ─────────────
  function setPlaying(on) {
    playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
    const now = performance.now();
    if (on && mode !== 'run') {
      mode = 'run';
      startedAt = now + LEAD_IN * 1000;
      arrived = timeLabel();
      screensKey = '';
    } else if (!on && mode === 'run' && currentT(now) < 0) {
      mode = 'idle';
    }
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));

  cta.addEventListener('click', () => {
    const now = performance.now();
    const T = currentT(now);
    if (mode !== 'run' || T < 0) {
      mode = 'run';
      startedAt = now;
      arrived = timeLabel();
      screensKey = '';
    } else if (T >= TOTAL) {
      startedAt = now - (TOTAL + HOLD) * 1000; // jump to the reset
    }
  });

  scrub.addEventListener('input', () => {
    setPlaying(false);
    mode = 'scrub';
    fixedT = parseFloat(scrub.value);
    scrubOut.textContent = `${fixedT.toFixed(2)} s`;
  });

  DW.seek = (t) => {
    playing = false;
    playBtn.textContent = 'Play';
    mode = 'scrub';
    fixedT = t;
    screensKey = '';
    scrub.value = t;
    scrubOut.textContent = `${t.toFixed(2)} s`;
  };
  DW.timeline = { TOTAL, SWAP_AT, GULP_END, BEAM_OFF, HOLD, LEAD_IN };

  // ───────────── boot ─────────────
  document.fonts.ready.then(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('t')) DW.seek(parseFloat(q.get('t')));
    else if (q.has('autoplay')) setPlaying(true);
    document.documentElement.classList.add('ready');
    requestAnimationFrame(frame);
  });
})();
