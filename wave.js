/* Distortion wave engine: physics of the wave front, rim lumps, particles
   and the WebGL2 renderer (lens + progressive blur + chromatic split +
   OKLab colour band + perimeter rim + hairline + sparks). */
(function () {
  'use strict';
  const DW = (window.DW = window.DW || {});

  // ───────────────────────── helpers ─────────────────────────
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function cubicBezier(x1, y1, x2, y2) {
    const B = (t, p1, p2) => {
      const m = 1 - t;
      return 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t;
    };
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (B(mid, x1, x2) < x) lo = mid; else hi = mid;
      }
      return B((lo + hi) / 2, y1, y2);
    };
  }
  const easeOut = cubicBezier(0.22, 1, 0.36, 1);
  const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

  // ───────────────────────── style ─────────────────────────
  const PALETTES = {
    colorful: {
      colors: [[255, 201, 21], [126, 196, 255], [180, 40, 230], [235, 100, 160], [255, 176, 122], [154, 160, 255], [127, 217, 238]],
      ahead: [255, 122, 182],
      behind: [90, 190, 255],
    },
    // Apple Intelligence / Siri glow
    siri: {
      colors: [[255, 186, 113], [255, 103, 120], [245, 185, 234], [188, 130, 243], [141, 159, 255], [170, 110, 238], [198, 134, 255]],
      ahead: [255, 140, 170],
      behind: [120, 140, 255],
    },
    green: {
      colors: [[53, 186, 0], [140, 235, 90], [0, 196, 110], [190, 250, 130], [40, 160, 60], [110, 225, 160], [90, 210, 40]],
      ahead: [196, 255, 120],
      behind: [0, 150, 70],
    },
  };

  function createStyle() {
    return {
      anticipation: 0.5, travel: 2.28, launchGap: 0, linger: -0.35, rimFade: 3.03,
      pull: 24, inhale: 56, gatherGlow: 0.33, gatherDots: 1,
      amplitude: 34, lensWidth: 150, aberration: 0.78, swell: 22,
      blur: 18, blurAhead: 90, blurBehind: 240,
      lead: 130, tail: 300, strength: 0.92,
      rimWidth: 14, rimUnevenness: 1, rimStrength: 0.82, rimSoftness: 343, cornerRadius: 62, rimPulse: 0.6,
      hairlineWidth: 1.5, hairlineOpacity: 0.9, hairlineWhite: 0.95, hairlineLinger: 0.47, hairlineFade: 3,
      particleCount: 64, particleSize: 1.8, particleReach: 150, particleFlight: 30, particleGap: 24,
      particleLife: 2.19, particleSpread: 1,
      palette: PALETTES.colorful,
    };
  }
  const duration = (s) =>
    s.anticipation +
    Math.max(s.travel * 0.6, s.linger + s.rimFade, s.linger + s.hairlineLinger + s.hairlineFade, s.particleLife);

  // ───────────────────────── wave front ─────────────────────────
  const COVER_ZONE = 60;
  const SQUASH = 1.4;

  /* progress 0..1 over the whole effect; src = the element the wave leaves
     from (in view points); W,H = view size in points. */
  function waveFront(progress, src, W, H, s, o = {}) {
    const total = duration(s);
    const time = clamp(progress, 0, 1) * total;
    const flight = time - s.anticipation;
    const inhaled = smooth(0, Math.max(s.anticipation, 0.001), time);
    const c = clamp(flight / s.travel, 0, 1);
    const moved = easeOut(c);

    const cx = src.x + src.w / 2, cy = src.y + src.h / 2;
    const half = Math.min(src.w, src.h) / 2;
    const spine0 = Math.max(0, src.w / 2 - half);

    let reach = 0;
    for (let i = 0; i < 4; i++) {
      const dx = (i & 1 ? W : 0) - cx, dy = (i & 2 ? H : 0) - cy;
      reach = Math.max(reach, Math.hypot(dx * SQUASH, dy));
    }
    const exitR = reach + (s.swell + COVER_ZONE) * SQUASH;
    const fade = 1 - smooth(0.2, 0.55, c);
    const start = half + Math.max(s.launchGap, 0);
    const radius = flight < 0 ? start + s.inhale * (1 - inhaled) : start + (exitR + 100 - start) * moved;
    const gather = Math.min(0.5 * Math.max(s.gatherGlow, 0), 1);
    const rimFrom = half - s.rimSoftness;
    const rimTo = reach + (s.rimSoftness + s.swell) * SQUASH;

    o.ox = cx; o.oy = cy; o.tilt = 0;
    o.spine = spine0 * (1 - smooth(0, 0.45, moved));
    o.radius = radius;
    o.moved = moved;
    o.squash = 1 + (SQUASH - 1) * smooth(0, 0.5, moved);
    o.time = time;
    o.energy = smooth(0, 0.05, c) * fade;
    o.swell = s.swell * smooth(0, 0.3, moved);
    o.gravity = s.pull * inhaled * (1 - smooth(0, 0.22, flight));
    o.glow = flight < 0 ? gather * inhaled : (gather + (1 - gather) * smooth(0, 0.07, c)) * fade;
    o.clearRadius = rimFrom + (rimTo - rimFrom) * easeInOut((flight - s.linger) / Math.max(s.rimFade, 0.01));
    o.hairClearRadius =
      rimFrom + (rimTo - rimFrom) * easeInOut((flight - s.linger - s.hairlineLinger) / Math.max(s.hairlineFade, 0.01));
    o.rim = s.rimStrength * smooth(0, 0.1, c) * (1 - smooth(0.9, 1, time / total));
    o.sparkle = smooth(0, Math.max(s.anticipation, 0.001) * 0.35, time);
    o.flying = Math.max(flight, 0);
    o.launched = flight > 0;
    o.hasCleared = radius > exitR;
    return o;
  }

  // ───────────────────────── rim lumps ─────────────────────────
  const LUMPS = 7;
  const lumpData = new Float32Array(LUMPS * 3);
  const hash1 = (i, a, b) => {
    const v = Math.sin(i * a + b) * 43758.5453;
    return v - Math.floor(v);
  };
  function rimLumps(t, w, h, r, pulse) {
    const ex = Math.max(w / 2 - r, 0), ey = Math.max(h / 2 - r, 0);
    const P = 4 * (ex + ey + 0.5 * Math.PI * r);
    for (let i = 0; i < LUMPS; i++) {
      const u = hash1(i, 12.9898, 1.3), c = hash1(i, 78.233, 4.1), d = hash1(i, 39.425, 2.7);
      const m = (0.25 + 0.3 * pulse) * Math.sin(t * (1.1 + 1.2 * u) * (1 + pulse) + i * 2.4);
      lumpData[i * 3] = (P * (i + 0.35 * u)) / LUMPS + t * (-22 + 44 * c) * (1 + 2 * pulse);
      lumpData[i * 3 + 1] = (P / LUMPS) * (0.2 + 0.25 * d);
      lumpData[i * 3 + 2] = (0.2 + 2.6 * c) * (1 + m);
    }
    return lumpData;
  }

  // ───────────────────────── particles ─────────────────────────
  const hash3 = (i, e, t) => {
    const v = Math.sin(i * 12.9898 + e * 78.233 + t * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  function createParticles(s) {
    const list = [];
    for (let k = 0; k < Math.round(s.particleCount); k++) {
      const n = k + 1, r = (g) => (n * g) % 1, sz = r(0.5497004779);
      list.push({
        index: n,
        column: (r(0.7548776662) * 2 - 1) * 0.92,
        pace: 0.35 + 0.72 * Math.sqrt(r(0.8191725134)),
        drift: 15 + 50 * r(0.6710436067),
        sway: 3 + 11 * r(0.4142135624),
        swayRate: 2.5 + 3.5 * r(0.7320508076),
        twinkleRate: 8 + 12 * r(0.2360679775),
        phase: r(0.6180339887) * 2 * Math.PI,
        life: s.particleLife * (0.4 + 0.6 * r(0.6457513111)),
        size: s.particleSize * (0.55 + 0.45 * sz * sz),
        brightness: 0.3 + 0.7 * r(0.6055512755),
        hop: 0.16 + 0.14 * r(0.1231056256),
        hopOffset: r(0.472135955),
      });
    }
    return list;
  }

  function particleAt(pt, f, src, s, out) {
    const tw = 0.5 + 0.5 * Math.sin(f.time * pt.twinkleRate + pt.phase);
    const bright = pt.brightness * (0.7 + 0.3 * tw);
    const spread = clamp(s.particleSpread, 0, 1);
    const cx = src.x + src.w / 2, cy = src.y + src.h / 2;

    if (!f.launched) {
      // sparks hopping in towards the button during the anticipation
      const k = f.time / pt.hop + pt.hopOffset, b = Math.floor(k), g = k - b;
      const hopA = smooth(0, 0.25, g) * (1 - smooth(0.55, 1, g));
      const out1 = 1 - smooth(s.anticipation * 0.75, s.anticipation, f.time);
      const a = f.sparkle * hopA * out1 * bright * s.gatherDots;
      const hw = src.w / 2, hh = src.h / 2;
      const j = (hash3(pt.index, b, 1) * 2 - 1) * (hw + 24);
      const D = s.particleGap + s.particleFlight;
      const M = D + Math.max(s.particleReach - D, 0) * hash3(pt.index, b, 2);
      const N = Math.min(src.w, src.h) / 2;
      const I = hh + M;
      const Wc = Math.min(Math.max(j, -hw + N), hw - N);
      const px = cx + j, py = cy - I;
      const dx = cx + Wc - px, dy = cy - hh - py;
      const L = Math.max(Math.hypot(dx, dy), 1);
      const S = s.particleFlight * g * g;
      out.x = px + (dx / L) * S;
      out.y = py + (dy / L) * S;
      out.a = a;
      return out;
    }
    const a = (1 - smooth(pt.life * 0.55, pt.life, f.flying)) * bright;
    const sway = pt.sway * Math.sin(pt.swayRate * f.flying + pt.phase) * Math.min(f.flying / 0.25, 1);
    const d = Math.min(src.w, src.h) / 2;
    const widen = 1 + 0.22 * f.moved * pt.pace * spread;
    const x = ((pt.column * src.w) / 2) * widen + sway;
    const m = (d + (f.radius - d) * pt.pace * spread) * (1 - 0.3 * pt.column * pt.column) + pt.drift * f.flying * spread;
    out.x = f.ox + x;
    out.y = f.oy - m;
    out.a = a;
    return out;
  }

  // sRGB 0..255 → OKLab
  function toOklab(c) {
    const lin = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  // ───────────────────────── shaders ─────────────────────────
  const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSigma;
out vec4 outColor;
void main() {
  float r = ceil(uSigma * 3.0);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (float i = -48.0; i <= 48.0; i += 1.0) {
    if (abs(i) > r) continue;
    float w = exp(-0.5 * i * i / (uSigma * uSigma));
    acc += texture(uTex, vUv + uStep * i) * w;
    wsum += w;
  }
  outColor = acc / wsum;
}`;

  const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uLod;
out vec4 outColor;
void main() { outColor = textureLod(uTex, vUv, uLod); }`;

  const MAIN_FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform vec2 uPx;
uniform float uF[19];
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC2;
uniform sampler2D uR0;
uniform sampler2D uR1;
uniform sampler2D uR2;
uniform int uContent;
uniform int uRevealed;
uniform int uLens;
uniform int uLive;
uniform float uAmplitude;
uniform float uLensWidth;
uniform float uAberration;
uniform float uBlur;
uniform float uBlurAhead;
uniform float uBlurBehind;
uniform float uNear;
uniform vec3 uPal[9];
uniform int uPalCount;
uniform vec3 uAhead;
uniform vec3 uBehind;
uniform float uLead;
uniform float uTail;
uniform float uStrength;
uniform float uRimWidth;
uniform float uRimSoftness;
uniform float uCorner;
uniform float uUneven;
uniform float uPulse;
uniform float uHairW;
uniform float uHairO;
uniform float uHairWhite;
uniform vec3 uLumps[${LUMPS}];
out vec4 outColor;

const float coverZone = ${COVER_ZONE.toFixed(1)};
const float PI = 3.14159265;

struct Field { float d; vec2 n; vec2 q; vec2 raw; float g; };

/* Signed distance to the travelling front: a capsule (the button) that grows
   into a squashed ellipse, its edge bent by two travelling sines. */
Field fieldAt(vec2 p) {
  vec2 raw = p - vec2(uF[0], uF[1]);
  float cs = cos(uF[14]), sn = sin(uF[14]);
  vec2 q = vec2(cs * raw.x + sn * raw.y, -sn * raw.x + cs * raw.y);
  float spine = uF[2], radius = uF[3], squash = uF[4], time = uF[5], swell = uF[7];
  float mx = q.x * squash;
  vec2 v = vec2(max(abs(mx) - spine, 0.0), q.y);
  float l = max(length(v), 1e-3);
  vec2 grad = vec2(v.x * sign(q.x) * squash, v.y) / l;
  float g = max(length(grad), 1e-3);
  float s = mx * 0.0058;
  float bend = 0.62 * sin(s + time * 1.1) + 0.38 * sin(s * 2.1 - time * 1.5 + 1.7);
  vec2 n = grad / g;
  Field o;
  o.d = (l - radius) / g + swell * bend;
  o.n = vec2(cs * n.x - sn * n.y, sn * n.x + cs * n.y);
  o.q = q;
  o.raw = raw;
  o.g = g;
  return o;
}

// Progressive blur: sharp → near → far copies, read at an explicit level.
vec3 side(sampler2D a, sampler2D b, sampler2D c, vec2 s, float tn, float tf) {
  vec2 uv = clamp(s, vec2(0.5), uSize - 0.5) / uSize;
  vec3 col = textureLod(a, uv, 0.0).rgb;
  if (tn > 0.0) col = mix(col, textureLod(b, uv, 0.0).rgb, tn);
  if (tf > 0.0) col = mix(col, textureLod(c, uv, 0.0).rgb, tf);
  return col;
}

const vec3 spectrum[5] = vec3[5](
  vec3(0.571, 0.0, 0.0), vec3(0.343, 0.206, 0.0), vec3(0.086, 0.588, 0.086),
  vec3(0.0, 0.206, 0.343), vec3(0.0, 0.0, 0.571)
);

// Chromatic aberration: 5 taps along the split, each weighted by a spectrum band.
vec3 lensed(int which, vec2 s, vec2 split, float tn, float tf) {
  if (dot(split, split) < 0.0625) {
    return which == 0 ? side(uC0, uC1, uC2, s, tn, tf) : side(uR0, uR1, uR2, s, tn, tf);
  }
  vec3 o = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float along = float(i) / 4.0 * 2.0 - 1.0;
    vec3 c = which == 0 ? side(uC0, uC1, uC2, s + split * along, tn, tf)
                        : side(uR0, uR1, uR2, s + split * along, tn, tf);
    o += c * spectrum[i];
  }
  return o;
}

float edgeSDF(vec2 p, vec2 halfSize, float radius) {
  float r = min(radius, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - (halfSize - r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Arc-length position of p projected on the rounded-rect perimeter.
vec2 perimeterAt(vec2 p, vec2 halfSize, float r) {
  float ex = max(halfSize.x - r, 0.0);
  float ey = max(halfSize.y - r, 0.0);
  float arc = 0.5 * PI * r;
  float P = 4.0 * (ex + ey + arc);
  float ax = abs(p.x), ay = abs(p.y);
  if (ax > ex && ay > ey) {
    vec2 v = p - vec2(sign(p.x) * ex, sign(p.y) * ey);
    float a, base;
    if (p.x >= 0.0 && p.y < 0.0) { a = atan(v.x, -v.y); base = ex; }
    else if (p.x >= 0.0) { a = atan(v.y, v.x); base = ex + arc + 2.0 * ey; }
    else if (p.y >= 0.0) { a = atan(-v.x, v.y); base = 3.0 * ex + 2.0 * arc + 2.0 * ey; }
    else { a = atan(-v.y, -v.x); base = 3.0 * ex + 3.0 * arc + 4.0 * ey; }
    return vec2(base + r * clamp(a, 0.0, 0.5 * PI), P);
  }
  bool sideHit = ax > ex ? true : (ay > ey ? false : (halfSize.x - ax) < (halfSize.y - ay));
  if (sideHit) return vec2(p.x >= 0.0 ? ex + arc + (p.y + ey) : 3.0 * ex + 3.0 * arc + 2.0 * ey + (ey - p.y), P);
  return vec2(p.y < 0.0 ? (p.x >= 0.0 ? p.x : P + p.x) : ex + 2.0 * arc + 2.0 * ey + (ex - p.x), P);
}

float rimThickness(float s, float P) {
  float t = 0.08;
  for (int i = 0; i < ${LUMPS}; i++) {
    float ds = s - uLumps[i].x;
    ds -= P * floor(ds / P + 0.5);
    float k = ds / uLumps[i].y;
    t += uLumps[i].z * exp(-k * k);
  }
  return t / 1.0498;
}

float dither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5; }

vec3 paletteAt(float u) {
  float x = fract(u) * float(uPalCount);
  int i = min(int(x), uPalCount - 1);
  int j = i + 1 == uPalCount ? 0 : i + 1;
  float m = fract(x);
  m = m * m * (3.0 - 2.0 * m);
  return mix(uPal[i], uPal[j], m);
}

vec3 oklabToSRGB(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = clamp(vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ), 0.0, 1.0);
  return mix(12.92 * lin, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uPx.y - gl_FragCoord.y) * (uSize.x / uPx.x);

  if (uLive == 0) {
    outColor = vec4(uRevealed == 1 ? textureLod(uR0, p / uSize, 0.0).rgb : textureLod(uC0, p / uSize, 0.0).rgb, 1.0);
    return;
  }

  Field w = fieldAt(p);
  float energy = uF[6], gravity = uF[10];

  // ─── the two screens, through the swell ───
  vec2 s = p;
  vec2 split = vec2(0.0);
  if (uLens == 1) {
    float u = w.d / (uLensWidth * (w.d > 0.0 ? 0.85 : 1.5));
    float lift = exp(-u * u);
    float r = max(length(w.raw), 1.0);
    vec2 swollen = w.n * energy * uAmplitude * lift;
    vec2 inward = w.raw / r;
    s = p - swollen + inward * gravity * exp(-r / 900.0);
    split = (swollen - inward * gravity * exp(-r / 240.0)) * uAberration;
  }
  float bu = w.d / (w.d > 0.0 ? uBlurAhead : uBlurBehind);
  float radius = energy * uBlur * exp(-bu * bu);
  float tn = clamp(radius / max(uNear, 1e-3), 0.0, 1.0);
  tn = tn * tn * (3.0 - 2.0 * tn);
  float tf = clamp((radius - uNear) / max(uBlur - uNear, 1e-3), 0.0, 1.0);
  tf = tf * tf * (3.0 - 2.0 * tf);

  float cover = 1.0;
  if (uContent == 1 && uF[17] > 0.5) cover = smoothstep(-coverZone, coverZone, w.d);
  if (uContent == 0) cover = 0.0;

  vec3 col = vec3(0.0);
  bool showRevealed = uRevealed == 1 && w.d <= coverZone + 6.0 && cover < 1.0;
  if (showRevealed) col = lensed(1, s, split, tn, tf);
  if (cover > 0.0) col = mix(col, lensed(0, s, split, tn, tf), cover);

  // ─── the colour band ───
  float d = w.d, time = uF[5], glow = uF[11], rim = uF[13];
  vec2 c = p - uSize * 0.5;
  float inset = max(-edgeSDF(c, uSize * 0.5, uCorner), 0.0);
  bool nearEdge = rim > 0.0 && inset < max(uRimWidth * 2.2 * (1.0 + 1.9 * uUneven), uHairW * 0.5 + 0.75);
  if (glow <= 0.0 && !nearEdge) {
    outColor = vec4(col + dither(gl_FragCoord.xy) / 255.0, 1.0);
    return;
  }
  float along = w.q.x * 0.0068;
  float lobes = 0.5 + 0.5 * sin(along * 1.3 + time * 1.4) * cos(along * 0.6 - time * 0.7 + 1.2);
  float bandA = 0.0;
  if (glow > 0.0 && d < uLead) {
    if (d >= 0.0) {
      float k = 1.0 - d / uLead;
      bandA = k * k * k * (k * (k * 6.0 - 15.0) + 10.0);
    } else {
      bandA = pow(1.0 - clamp(-d / (uTail * mix(0.6, 1.3, lobes)), 0.0, 1.0), 2.3);
    }
    bandA *= glow * uStrength * mix(0.6, 1.0, exp(-inset / 140.0));
  }
  float aroundA = atan(c.y / uSize.y, c.x / uSize.x);
  float rimA = 0.0;
  float hairA = 0.0;
  float shimmer = 0.5;
  if (nearEdge) {
    vec2 edge = perimeterAt(c, uSize * 0.5, uCorner);
    float thickness = 1.0;
    if (uUneven > 0.0) thickness = max(1.0 + (rimThickness(edge.x, edge.y) - 1.0) * uUneven, 0.04);
    float hk = inset / (uRimWidth * thickness);
    float hug = exp(-hk * hk);
    float reached = 1.0 - smoothstep(-uLead * 0.7, uLead * 0.5, d);
    float kept = smoothstep(-uRimSoftness, uRimSoftness, d + (uF[3] - uF[12]) / w.g);
    shimmer = 0.5 + 0.5 * sin(time * 3.4 - edge.x / edge.y * 4.0 * PI);
    rimA = hug * reached * kept * rim * mix(1.0, 0.7 + 0.3 * shimmer, uPulse);
    if (uHairW > 0.0) {
      float line = 1.0 - smoothstep(uHairW * 0.5, uHairW * 0.5 + 0.75, inset);
      float hairKept = smoothstep(-uRimSoftness, uRimSoftness, d + (uF[3] - uF[18]) / w.g);
      hairA = line * reached * hairKept * rim * uHairO
        * mix(0.5, 1.0, smoothstep(0.1, 1.5, thickness))
        * mix(1.0, 0.55 + 0.45 * shimmer, uPulse);
    }
  }
  float a = 1.0 - (1.0 - bandA) * (1.0 - rimA);
  float total = 1.0 - (1.0 - a) * (1.0 - hairA);
  if (total <= 0.0005) {
    outColor = vec4(col + dither(gl_FragCoord.xy) / 255.0, 1.0);
    return;
  }
  float flow = 0.62 + along * 0.2 + time * 0.13 + d * 0.0015 + 0.05 * sin(w.q.y * 0.009 + time);
  vec3 lab = paletteAt(flow);
  lab = mix(lab, uAhead, 0.5 * exp(-pow((d - 30.0) / 50.0, 2.0)));
  lab = mix(lab, uBehind, 0.5 * exp(-pow((d + 84.0) / 72.0, 2.0)));
  lab.yz *= 1.22;
  lab = mix(lab, vec3(0.99, 0.0, 0.0), 0.7 * exp(-pow((d + 8.0) / 26.0, 2.0)));
  vec3 rimLab = paletteAt(aroundA / (2.0 * PI) + time * (0.12 + 0.25 * uPulse) + inset * 0.0012);
  rimLab.yz *= 1.1;
  lab = mix(lab, rimLab, rimA / (rimA + bandA + 1e-4));
  vec3 rgb = oklabToSRGB(lab);
  if (hairA > 0.0) {
    vec3 hair = mix(oklabToSRGB(rimLab), vec3(1.0), uHairWhite * (0.5 + 0.5 * shimmer));
    rgb = (rgb * a * (1.0 - hairA) + hair * hairA) / total;
  }
  float noise = dither(gl_FragCoord.xy) * 2.0 / 255.0;
  float over = clamp(total + noise, 0.0, 1.0);
  outColor = vec4(col * (1.0 - over) + clamp(rgb + noise, 0.0, 1.0) * over, 1.0);
}`;

  const DOT_VS = `#version 300 es
in vec3 aDot;
uniform vec2 uSize;
uniform float uPoint;
out float vA;
void main() {
  vec2 clip = vec2(aDot.x / uSize.x * 2.0 - 1.0, 1.0 - aDot.y / uSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPoint;
  vA = aDot.z;
}`;

  const DOT_FS = `#version 300 es
precision highp float;
in float vA;
uniform float uScale;
uniform float uPoint;
out vec4 outColor;
void main() {
  float a = fract(vA);
  float size = floor(vA) / 10.0;
  float r = length(gl_PointCoord - 0.5) * uPoint;
  float edge = size * uScale * 0.5;
  float cov = clamp(edge - r + 0.5, 0.0, 1.0);
  outColor = vec4(vec3(1.0) * a * cov, a * cov);
}`;

  // ───────────────────────── renderer ─────────────────────────
  const NEAR_BLUR = 7;
  const SAMPLERS = ['uC0', 'uC1', 'uC2', 'uR0', 'uR1', 'uR2'];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', {
        antialias: false, premultipliedAlpha: true, alpha: true, depth: false, stencil: false,
        preserveDrawingBuffer: true,
      });
      if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl;
      this.pt = { w: 1, h: 1 };
      this.screens = { content: null, revealed: null };
      this.scratches = new Map();
      this.field = new Float32Array(19);
      this.dotsCap = 0;
      this.main = this.program(QUAD_VS, MAIN_FS);
      this.blurP = this.program(QUAD_VS, BLUR_FS);
      this.copyP = this.program(QUAD_VS, COPY_FS);
      this.dotP = this.program(DOT_VS, DOT_FS);
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.dots = gl.createBuffer();
    }

    program(vs, fs) {
      const gl = this.gl;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.bindAttribLocation(p, 0, 'aDot');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const cache = new Map();
      return {
        p,
        loc: (n) => {
          if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n));
          return cache.get(n);
        },
      };
    }

    texture(w, h, source, mips) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    }

    target(w, h) {
      const gl = this.gl;
      const tex = this.texture(w, h);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb, w, h };
    }

    scratch(w, h) {
      const key = w + 'x' + h;
      if (!this.scratches.has(key)) this.scratches.set(key, this.target(w, h));
      return this.scratches.get(key);
    }

    drawQuad(prog) {
      const gl = this.gl;
      gl.useProgram(prog.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /* A blurred copy: downsample through the mip chain, then a separable
       gaussian at the reduced size. sigma is in view points. */
    blurred(tex, w, h, sigmaPt, prev) {
      const gl = this.gl;
      const sigmaPx = sigmaPt * (w / this.pt.w);
      const down = Math.max(1, Math.round(sigmaPx / 5));
      const bw = Math.max(1, Math.round(w / down)), bh = Math.max(1, Math.round(h / down));
      let t = prev;
      if (!t || t.w !== bw || t.h !== bh) t = this.target(bw, bh);
      const tmp = this.scratch(bw, bh);
      gl.viewport(0, 0, bw, bh);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.useProgram(this.copyP.p);
      gl.uniform1i(this.copyP.loc('uTex'), 0);
      gl.uniform1f(this.copyP.loc('uLod'), Math.log2(down));
      this.drawQuad(this.copyP);
      gl.useProgram(this.blurP.p);
      gl.uniform1i(this.blurP.loc('uTex'), 0);
      gl.uniform1f(this.blurP.loc('uSigma'), Math.max(sigmaPx / down, 0.01));
      gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fb);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform2f(this.blurP.loc('uStep'), 1 / bw, 0);
      this.drawQuad(this.blurP);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
      gl.uniform2f(this.blurP.loc('uStep'), 0, 1 / bh);
      this.drawQuad(this.blurP);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return t;
    }

    setSize(pxW, pxH, ptW, ptH) {
      if (this.canvas.width !== pxW) this.canvas.width = pxW;
      if (this.canvas.height !== pxH) this.canvas.height = pxH;
      this.pt.w = ptW;
      this.pt.h = ptH;
    }

    /* Upload a rasterised screen (a 2D canvas) plus its near/far blurs. */
    setScreen(name, source, farBlur) {
      const gl = this.gl;
      const w = source.width, h = source.height;
      let sc = this.screens[name];
      if (!sc || sc.w !== w || sc.h !== h) {
        sc = { sharp: this.texture(w, h, source, true), near: null, far: null, w, h };
      } else {
        gl.bindTexture(gl.TEXTURE_2D, sc.sharp);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      sc.near = this.blurred(sc.sharp, w, h, NEAR_BLUR, sc.near);
      sc.far = this.blurred(sc.sharp, w, h, Math.max(farBlur, NEAR_BLUR), sc.far);
      this.screens[name] = sc;
    }

    render(front, s, lumps, dots, showRevealed) {
      const gl = this.gl;
      const C = this.screens.content, R = this.screens.revealed || C;
      if (!C) return;
      const W = this.canvas.width, H = this.canvas.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      const m = this.main;
      gl.useProgram(m.p);
      for (let i = 0; i < 6; i++) {
        const sc = i < 3 ? C : R;
        const tex = i % 3 === 0 ? sc.sharp : i % 3 === 1 ? sc.near.tex : sc.far.tex;
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(m.loc(SAMPLERS[i]), i);
      }
      gl.uniform2f(m.loc('uSize'), this.pt.w, this.pt.h);
      gl.uniform2f(m.loc('uPx'), W, H);
      gl.uniform1i(m.loc('uLive'), front ? 1 : 0);
      if (!front) {
        gl.uniform1i(m.loc('uRevealed'), showRevealed ? 1 : 0);
        this.drawQuad(m);
        return;
      }
      const f = this.field;
      f[0] = front.ox; f[1] = front.oy; f[2] = front.spine; f[3] = front.radius;
      f[4] = front.squash; f[5] = front.time; f[6] = front.energy; f[7] = front.swell;
      f[8] = this.pt.w; f[9] = this.pt.h; f[10] = front.gravity; f[11] = front.glow;
      f[12] = front.clearRadius; f[13] = front.rim; f[14] = front.tilt; f[15] = 0;
      f[16] = 0; f[17] = front.launched ? 1 : 0; f[18] = front.hairClearRadius;
      gl.uniform1fv(m.loc('uF'), f);
      const lens = front.energy > 0;
      gl.uniform1i(m.loc('uContent'), front.hasCleared ? 0 : 1);
      gl.uniform1i(m.loc('uRevealed'), front.launched ? 1 : 0);
      gl.uniform1i(m.loc('uLens'), lens || front.gravity > 0 ? 1 : 0);
      gl.uniform1f(m.loc('uAmplitude'), s.amplitude);
      gl.uniform1f(m.loc('uLensWidth'), s.lensWidth);
      gl.uniform1f(m.loc('uAberration'), s.aberration);
      gl.uniform1f(m.loc('uBlur'), lens ? Math.max(s.blur, NEAR_BLUR) : 0);
      gl.uniform1f(m.loc('uBlurAhead'), s.blurAhead);
      gl.uniform1f(m.loc('uBlurBehind'), s.blurBehind);
      gl.uniform1f(m.loc('uNear'), NEAR_BLUR);
      if (this.palKey !== s.palette) {
        this.palKey = s.palette;
        this.pal = new Float32Array(27);
        const n = Math.min(s.palette.colors.length, 9);
        for (let i = 0; i < n; i++) this.pal.set(toOklab(s.palette.colors[i]), i * 3);
        this.palCount = n;
        this.ahead = new Float32Array(toOklab(s.palette.ahead));
        this.behind = new Float32Array(toOklab(s.palette.behind));
      }
      gl.uniform3fv(m.loc('uPal'), this.pal);
      gl.uniform1i(m.loc('uPalCount'), this.palCount);
      gl.uniform3fv(m.loc('uAhead'), this.ahead);
      gl.uniform3fv(m.loc('uBehind'), this.behind);
      gl.uniform1f(m.loc('uLead'), s.lead);
      gl.uniform1f(m.loc('uTail'), s.tail);
      gl.uniform1f(m.loc('uStrength'), s.strength);
      gl.uniform1f(m.loc('uRimWidth'), s.rimWidth);
      gl.uniform1f(m.loc('uRimSoftness'), s.rimSoftness);
      gl.uniform1f(m.loc('uCorner'), s.cornerRadius);
      gl.uniform1f(m.loc('uUneven'), s.rimUnevenness);
      gl.uniform1f(m.loc('uPulse'), s.rimPulse);
      gl.uniform1f(m.loc('uHairW'), s.hairlineWidth);
      gl.uniform1f(m.loc('uHairO'), s.hairlineOpacity);
      gl.uniform1f(m.loc('uHairWhite'), s.hairlineWhite);
      gl.uniform3fv(m.loc('uLumps'), lumps);
      this.drawQuad(m);

      if (dots && dots.count > 0) {
        const d = this.dotP;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(d.p);
        gl.uniform2f(d.loc('uSize'), this.pt.w, this.pt.h);
        const scale = W / this.pt.w;
        gl.uniform1f(d.loc('uScale'), scale);
        gl.uniform1f(d.loc('uPoint'), Math.ceil((s.particleSize + 1) * scale) + 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dots);
        if (this.dotsCap < dots.data.length) {
          gl.bufferData(gl.ARRAY_BUFFER, dots.data.byteLength, gl.DYNAMIC_DRAW);
          this.dotsCap = dots.data.length;
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, dots.data, 0, dots.count * 3);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, dots.count);
        gl.disable(gl.BLEND);
      }
    }
  }

  Object.assign(DW, {
    clamp, smooth, cubicBezier, easeOut, PALETTES, createStyle, duration,
    waveFront, rimLumps, createParticles, particleAt, Renderer,
  });
})();
