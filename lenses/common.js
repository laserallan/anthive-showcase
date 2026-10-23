// Helpers the demo lenses share: smooth ant positions, per-episode derived data, noise, soft fields.

import { ROCK, WATER, ant, numAnts, numFrames } from '../episode.js';
import { HEADINGS, center, distance, fit, pick, point } from '../hex.js';

export const FOOD = 1, PLANK = 2;  // carried items

// Clockwise from "up", the direction a sprite drawn facing up must be turned to for heading `h`.
export const headingAngle = h => h * Math.PI / 3;

function lerpAngle(a, b, x) {
  let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * x;
}

// Ant `i` at fractional time `time` (frames): its (fractional) axial position q, r, angle, item,
// alpha (fading out over the step it drowns in), and whether it is moving during this step.
export function antAt(e, time, i) {
  const F = numFrames(e), f0 = Math.min(Math.floor(time), F - 1), f1 = Math.min(f0 + 1, F - 1), x = time - f0;
  const a = ant(e, f0, i), b = ant(e, f1, i);
  if (!a.alive) return { q: a.q, r: a.r, ang: headingAngle(a.heading), item: a.item, alpha: 0, dead: true, moving: false };
  const ease = x * x * (3 - 2 * x);
  return {
    q: a.q + (b.q - a.q) * ease, r: a.r + (b.r - a.r) * ease,
    ang: lerpAngle(headingAngle(a.heading), headingAngle(b.heading), Math.min(1, x * 2)),
    item: x < .5 ? a.item : b.item, alpha: b.alive ? 1 : 1 - x, dead: false,
    moving: a.q !== b.q || a.r !== b.r,
  };
}

// The flow angle canonical range: a direction and its reverse are one flow, so angles are kept
// in [-15°, 165°), away from the river directions the maps use most (0°, ±30°, ±60°, 90°).
const FLOW_FROM = -Math.PI / 12;

// Per episode, computed once: bridges and live ants per frame, and for every water cell the
// direction its water runs, `flow` (radians, x right and y down, over storage): the principal
// axis of the water cells within 3 steps of it. Lenses use it instead of assuming a straight or
// vertical river. `toLand` (over storage) is each water cell's steps to the nearest land cell
// (0 on land and off the map): the river's deep middle is where it is largest.
const derived = new WeakMap();
export function derive(e) {
  if (derived.has(e)) return derived.get(e);
  const geo = e.geo, SS = geo.size * geo.size, A = numAnts(e), F = numFrames(e), T = e.terrain;
  const bridges = e.bridgeCount, alive = new Int32Array(F), flow = new Float32Array(SS);
  for (let f = 0; f < F; f++) {
    let a = 0; for (let i = 0; i < A; i++) a += e.ants.alive[f * A + i];
    alive[f] = a;
  }
  const water = (q, r) => distance(q, r) <= geo.radius && T[geo.index(q, r)] === WATER;
  for (const [q, r] of geo.cells) {
    if (!water(q, r)) continue;
    const pts = [];
    for (let dq = -3; dq <= 3; dq++) for (let dr = -3; dr <= 3; dr++)
      if (distance(dq, dr) <= 3 && water(q + dq, r + dr)) pts.push(center(q + dq, r + dr));
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    let a = .5 * Math.atan2(2 * sxy, sxx - syy);
    while (a < FLOW_FROM) a += Math.PI; while (a >= FLOW_FROM + Math.PI) a -= Math.PI;
    flow[geo.index(q, r)] = a;
  }
  const toLand = new Uint8Array(SS), queue = [];  // a breadth-first search out from the land
  for (const [q, r] of geo.cells) if (!water(q, r)) queue.push([q, r]);
  const seen = new Uint8Array(SS); for (const [q, r] of queue) seen[geo.index(q, r)] = 1;
  for (let i = 0; i < queue.length; i++) {
    const [q, r] = queue[i], n = toLand[geo.index(q, r)] + 1;
    for (const [dq, dr] of HEADINGS) {
      const Q = q + dq, Rr = r + dr;
      if (distance(Q, Rr) > geo.radius || seen[geo.index(Q, Rr)]) continue;
      seen[geo.index(Q, Rr)] = 1; toLand[geo.index(Q, Rr)] = n; queue.push([Q, Rr]);
    }
  }
  const d = { bridges, alive, flow, toLand };
  derived.set(e, d);
  return d;
}

// The moments an episode's story is told by, computed once, in frame order:
//   bridged    an ant's plank became a bridge (nth: bridges so far; q, r: the new bridge's cell)
//   crossing   the first time any ant stands on a bridge
//   first      the first delivery
//   milestone  frac (¼, ½, ¾, all) of the food is home
//   died       an ant drowned (q, r: where)
const stories = new WeakMap();
export function story(e) {
  if (stories.has(e)) return stories.get(e);
  const geo = e.geo, A = numAnts(e), d = derive(e);
  const B = e.keyframes.bridges.slice(0, geo.size * geo.size);  // the bridges at frame f, kept up as f goes on
  const byFrame = new Map();
  for (const ev of e.events) { if (!byFrame.has(ev.f)) byFrame.set(ev.f, []); byFrame.get(ev.f).push(ev); }
  const out = [], milestones = [.25, .5, .75, 1];
  let crossed = false;
  for (let f = 1; f < numFrames(e); f++) {
    const evs = byFrame.get(f) || [];
    let nth = d.bridges[f - 1];
    for (const ev of evs) {
      if (ev.kind === 'bridged') {
        B[geo.index(ev.q, ev.r)] = 1;
        out.push({ f, kind: 'bridged', ant: ev.ant, nth: ++nth, q: ev.q, r: ev.r });
      } else if (ev.kind === 'died') out.push({ f, kind: 'died', ant: ev.ant, q: ev.q, r: ev.r });
    }
    if (!crossed) for (let i = 0; i < A; i++) {
      const a = ant(e, f, i);
      if (a.alive && B[geo.index(a.q, a.r)]) { crossed = true; out.push({ f, kind: 'crossing', ant: i, q: a.q, r: a.r }); break; }
    }
    if (e.cumDelivered[f] > 0 && e.cumDelivered[f - 1] === 0) out.push({ f, kind: 'first', ant: -1 });
    while (milestones.length && e.food_total && e.cumDelivered[f] >= milestones[0] * e.food_total) {
      out.push({ f, kind: 'milestone', frac: milestones.shift(), ant: -1 });
    }
  }
  stories.set(e, out);
  return out;
}

export function hash(a, b, c = 0) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise in [0, 1): smooth blobs about `s` pixels across.
export function vnoise(x, y, s, seed) {
  x /= s; y /= s;
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];

// A per-cell field softened without `ctx.filter` (Safari lacks it): each cell of the map `geo` is
// painted as a hex at `per` pixels per cell (centre to centre), box-blurred in JS (`passes` box
// passes approach a gaussian) and drawn into `out`, a small canvas the caller upscales with
// smoothing on over the box a `fit` of the map takes. `rgba(k)` is the colour of the cell at
// storage index k (alpha 0-255); `radius` is in cells. Off the map is transparent.
export function softField(geo, rgba, radius, { per = 4, passes = 2, out = document.createElement('canvas') } = {}) {
  const { w, h, data } = softPixels(geo, rgba, radius, { per, passes });
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
  const x = out.getContext('2d'), img = x.createImageData(w, h);
  img.data.set(data);
  x.putImageData(img, 0, 0);
  return out;
}

// softField's pixels, w × h RGBA (straight alpha), without a canvas.
export function softPixels(geo, rgba, radius, { per = 4, passes = 2 } = {}) {
  const { w, h, owner } = hexBuffer(geo, per), cells = new Float32Array(geo.size * geo.size * 4);
  for (const [q, r] of geo.cells) {
    const k = geo.index(q, r), [R, G, B, a] = rgba(k), A = a / 255;
    cells[k * 4] = R * A; cells[k * 4 + 1] = G * A; cells[k * 4 + 2] = B * A; cells[k * 4 + 3] = a;  // premultiplied
  }
  const buf = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const k = owner[i]; if (k < 0) continue;
    for (let c = 0; c < 4; c++) buf[i * 4 + c] = cells[k * 4 + c];
  }
  const R = Math.round(radius * per);
  if (R > 0) {
    const line = new Float32Array(Math.max(w, h) * 4);
    const blur = (lines, n, stride, step) => {  // one box pass along every row (step 1) or column (step w)
      for (let l = 0; l < lines; l++) {
        const o = l * stride;
        for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) line[i * 4 + c] = buf[(o + i * step) * 4 + c];
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let i = -R; i <= R; i++) sum += i < 0 || i >= n ? 0 : line[i * 4 + c];
          for (let i = 0; i < n; i++) {
            buf[(o + i * step) * 4 + c] = sum / (2 * R + 1);
            const add = i + R + 1, drop = i - R;
            sum += (add < n ? line[add * 4 + c] : 0) - (drop >= 0 ? line[drop * 4 + c] : 0);
          }
        }
      }
    };
    for (let p = 0; p < passes; p++) { blur(h, w, w, 1); blur(w, h, 1, w); }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = buf[i * 4 + 3], A = a / 255 || 1;
    data[i * 4] = buf[i * 4] / A; data[i * 4 + 1] = buf[i * 4 + 1] / A; data[i * 4 + 2] = buf[i * 4 + 2] / A; data[i * 4 + 3] = a;
  }
  return { w, h, data };
}

// The hex buffer of a map at `per` pixels per cell, computed once per map and `per`: its size w ×
// h, the box a `fit` of the map takes, and `owner`, each pixel's cell as a storage index (-1 off
// the map).
const buffers = new WeakMap();
function hexBuffer(geo, per) {
  if (!buffers.has(geo)) buffers.set(geo, new Map());
  const byPer = buffers.get(geo);
  if (byPer.has(per)) return byPer.get(per);
  const s = per / Math.sqrt(3), probe = fit(geo.radius, 1, 1);  // pixels per unit; the box in units
  const w = Math.max(1, Math.round(probe.width / probe.size * s)), h = Math.max(1, Math.round(probe.height / probe.size * s));
  const f = fit(geo.radius, w, h), owner = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pick(f, x + .5, y + .5);
    owner[y * w + x] = c ? geo.index(c[0], c[1]) : -1;
  }
  const b = { w, h, owner };
  byPer.set(per, b);
  return b;
}

// Trace a flat-top hex of corner radius `s` centred on (x, y), for the painted lenses to fill.
// Rock: plain impassable cells, each filled with `colour` on `ctx` at fit `f`.
export function drawRock(ctx, e, f, colour) {
  ctx.fillStyle = colour;
  for (const [q, r] of e.geo.cells) if (e.terrain[e.geo.index(q, r)] === ROCK) { hexPath(ctx, ...point(f, q, r), f.size * 1.04); ctx.fill(); }
}

export function hexPath(ctx, x, y, s) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx[k ? 'lineTo' : 'moveTo'](x + s * Math.cos(a), y + s * Math.sin(a)); }
  ctx.closePath();
}

// Trace edges of map `geo` drawn under fit `f`, for the painted lenses to stroke: the edge between
// cell k and its neighbour n (storage indices; n is -1 off the map) when `edge(k, n)` says so.
export function cellEdges(ctx, geo, f, edge) {
  ctx.beginPath();
  for (const [q, r] of geo.cells) {
    const k = geo.index(q, r), [x, y] = point(f, q, r);
    HEADINGS.forEach(([dq, dr], h) => {
      if (!edge(k, distance(q + dq, r + dr) <= geo.radius ? geo.index(q + dq, r + dr) : -1)) return;
      const a = (h - 1.5) * Math.PI / 3, s = f.size;  // the bearing of heading h; its edge spans the corners 30° either side
      ctx.moveTo(x + s * Math.cos(a - Math.PI / 6), y + s * Math.sin(a - Math.PI / 6));
      ctx.lineTo(x + s * Math.cos(a + Math.PI / 6), y + s * Math.sin(a + Math.PI / 6));
    });
  }
}

// Trace the shoreline: every edge between a cell `wet(k)` picks and a dry neighbour on the map.
export const shoreline = (ctx, geo, f, wet) => cellEdges(ctx, geo, f, (k, n) => n >= 0 && wet(k) && !wet(n));

// Add a <style> once per id.
// The band at the bottom of the stage the shell's playback dock covers while shown (`--dock`).
export const dockSpace = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock')) || 0;

export function style(id, css) {
  if (document.getElementById(id)) return;
  document.head.append(Object.assign(document.createElement('style'), { id, textContent: css }));
}
