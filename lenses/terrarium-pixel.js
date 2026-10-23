// The pixel-art terrarium lenses: one renderer, three looks.
//
//   terrarium         small hex tiles at a large zoom, speckled ground, pheromones as sparse dots, small ants
//   terrarium-hd      large hex tiles near 1 art pixel per CSS pixel, banded grass, sandy banks, a
//                     stepped pheromone tint
//   terrarium-simant  as terrarium-hd, on SimAnt-like ground: a flat colour textured only by small
//                     details lit from the top-left (specks, pebbles, weeds)
//
// The map is drawn into an art-pixel buffer on an integer hex tile grid (hex.js tileGrid): every
// art pixel belongs to its nearest cell centre, so every hex is the same pixel shape. The tile
// size is picked per screen, from the look's `tiles`, so that a whole-number zoom in device pixels
// fills the stage best. The static ground is drawn once per episode and tile, then water,
// pheromones, bridges, planks and food every frame, then the ant sprites, turned to the six
// headings with nearest-neighbour sampling. Water flow and bridge boards follow each water cell's
// own flow direction (common.js derive), so any river layout works.

import { WATER, NEST, ROCK, HEADINGS, ant, frame, numFrames } from '../episode.js';
import { tileGrid, pickTile } from '../hex.js';
import { FOOD, PLANK, headingAngle, antAt, derive, hash, vnoise, mix } from './common.js';
import { terrariumStage } from './terrarium-hud.js';

// Tiles are [column step, row step] in art pixels (hex.js).
const SMALL_TILES = [[9, 10], [12, 14]], LARGE_TILES = [[16, 18], [20, 24], [24, 28]];
const KINDS = {
  'terrarium':        { name: 'Terrarium',        tiles: SMALL_TILES, ground: 'speckle', banks: false, pheromones: 'dots', sprite: 'small' },
  'terrarium-hd':     { name: 'Terrarium HD',     tiles: LARGE_TILES, ground: 'bands',   banks: true,  pheromones: 'tint', sprite: 'hd' },
  'terrarium-simant': { name: 'Terrarium SimAnt', tiles: LARGE_TILES, ground: 'scatter', banks: true,  pheromones: 'tint', sprite: 'hd' },
};

// ------------------------------------------------------------------ sprites (drawn facing up)
const SMALL = [
  '...l....l...', '....l..l....', '.....hh.....', '....hhhh....', '.l...hh...l.', '..l.bbbb.l..',
  '...lbbbbl...', '..l.bbbb.l..', '.l..bbbb..l.', '...bbbbbb...', '...bbbbbb...', '....bbbb....',
];
const HD = [
  '....l......l....', '.....l....l.....', '......oooo......', '.....ohmmdo.....', '.....ommmdo.....',
  '..l...oddo...l..', '...l.ohmmdo.l...', '....lommmdol....', '...l.oommoo.l...', '..l.ohhmmmdo.l..',
  '....ohmmmmdo....', '....ommmmddo....', '....ommmmddo....', '.....ommddo.....', '......oooo......',
];
const HD_PAL = { o: [26, 14, 8], d: [58, 32, 16], m: [96, 54, 26], h: [158, 98, 52], l: [34, 20, 10] };
const BERRY = ['.rr.', 'Rrrr', 'rrrd', '.dd.'], BERRY_PAL = { R: [255, 150, 130], r: [214, 52, 44], d: [140, 28, 26] };

const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });
function turned(src, size, heading) {
  const out = canvas(size), o = out.getContext('2d');
  o.imageSmoothingEnabled = false; o.translate(size / 2, size / 2); o.rotate(headingAngle(heading));
  o.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

const sprites = {};
function smallSprite(heading, item) {
  const key = `s${heading}-${item}`;
  if (sprites[key]) return sprites[key];
  const b = canvas(12), x = b.getContext('2d');
  const col = { l: '#1a0f08', h: '#3b2210', b: '#4a2a12' };
  SMALL.forEach((row, y) => [...row].forEach((ch, X) => { if (col[ch]) { x.fillStyle = col[ch]; x.fillRect(X, y, 1, 1); } }));
  x.fillStyle = '#c87a3a'; x.fillRect(4, 9, 1, 1); x.fillRect(5, 3, 1, 1);
  if (item === FOOD) { x.fillStyle = '#e8402a'; x.fillRect(5, 0, 2, 2); x.fillStyle = '#ff9a7a'; x.fillRect(5, 0, 1, 1); }
  if (item === PLANK) { x.fillStyle = '#d8a35a'; x.fillRect(2, 0, 8, 2); x.fillStyle = '#8a5a2a'; x.fillRect(2, 1, 8, 1); }
  return sprites[key] = turned(b, 18, heading);
}
function hdSprite(heading, item, step) {
  const key = `h${heading}-${item}-${step}`;
  if (sprites[key]) return sprites[key];
  const b = canvas(24), x = b.getContext('2d'), px = (X, Y, c) => { x.fillStyle = `rgb(${c})`; x.fillRect(X, Y, 1, 1); };
  HD.forEach((row, y) => [...row].forEach((ch, X) => {
    if (!HD_PAL[ch]) return;
    const yy = ch === 'l' && step && y >= 5 && y <= 9 ? y + (X < 8 ? 1 : -1) * (y % 2 ? 1 : -1) : y;  // walk frame
    px(X + 4, yy + 5, HD_PAL[ch]);
  }));
  if (item === FOOD) BERRY.forEach((row, y) => [...row].forEach((ch, X) => BERRY_PAL[ch] && px(X + 10, y + 3, BERRY_PAL[ch])));
  if (item === PLANK) for (let X = 5; X < 19; X++) { px(X, 4, [232, 184, 116]); px(X, 5, [196, 140, 80]); px(X, 6, [124, 82, 40]); }
  return sprites[key] = turned(b, 30, heading);
}

// ------------------------------------------------------------------ art-pixel geometry
// Pixels to the nearest pixel `from` picks (0 there), stepping to all eight neighbours.
function spread(w, h, from) {
  const d = new Int32Array(w * h).fill(-1);
  let front = [];
  for (let p = 0; p < w * h; p++) if (from(p)) { d[p] = 0; front.push(p); }
  for (let n = 1; front.length; n++) {
    const next = [];
    for (const p of front) {
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, i = Y * w + X;
        if (X >= 0 && Y >= 0 && X < w && Y < h && d[i] < 0) { d[i] = n; next.push(i); }
      }
    }
    front = next;
  }
  for (let p = 0; p < w * h; p++) if (d[p] < 0) d[p] = 1e6;  // nothing to spread from
  return d;
}

// For the pheromone tint: each map pixel's value is its own cell's blended with the two
// neighbours whose centres bound the pixel's direction from its centre (barycentric weights over
// that triangle of centres; a neighbour off the map counts as 0).
function blendWeights(G, geo) {
  const { w, h, owner, col, row } = G, n = w * h;
  const nA = new Int32Array(n).fill(-1), nB = new Int32Array(n).fill(-1), wA = new Float32Array(n), wB = new Float32Array(n);
  const vec = HEADINGS.map(([dq, dr]) => [col * dq, row * dr + row / 2 * dq]);
  const R = geo.radius, S = geo.size;
  for (let p = 0; p < n; p++) {
    const k = owner[p]; if (k < 0) continue;
    const q = k % S - R, r = ((k / S) | 0) - R, [cx, cy] = G.at(q, r), dx = p % w + .5 - cx, dy = ((p / w) | 0) + .5 - cy;
    const j = Math.floor(((Math.atan2(dx, -dy) / (Math.PI / 3)) % 6 + 6) % 6) % 6, j1 = (j + 1) % 6;
    const [ax, ay] = vec[j], [bx, by] = vec[j1], det = ax * by - ay * bx;
    const a = Math.max(0, (dx * by - dy * bx) / det), b = Math.max(0, (ax * dy - ay * dx) / det);
    const nbr = ([dq, dr]) => { const Q = q + dq, Rr = r + dr; return Math.max(Math.abs(Q), Math.abs(Rr), Math.abs(Q + Rr)) <= R ? geo.index(Q, Rr) : -1; };
    nA[p] = nbr(HEADINGS[j]); nB[p] = nbr(HEADINGS[j1]); wA[p] = a; wB[p] = b;
  }
  return { nA, nB, wA, wB };
}

// ------------------------------------------------------------------ the lens
export function createTerrariumPixel(id) {
  const K = KINDS[id];
  let shell, st, built = null, placed = null;  // built: per episode and tile; placed: the zoom it is shown at

  function build(e, tile) {
    const geo = e.geo, T = e.terrain, G = tileGrid(geo, tile), { w, h, owner, row: PX } = G, d = derive(e);
    const off = canvas(w, h), img = off.getContext('2d').createImageData(w, h), base = new Uint8ClampedArray(w * h * 4);
    const terr = p => owner[p] < 0 ? -1 : T[owner[p]];
    const set = (X, Y, col, k = -2) => {
      if (X < 0 || Y < 0 || X >= w || Y >= h) return;
      const p = Y * w + X; if (k > -2 && owner[p] !== k) return;  // a cell's details stay inside it
      base[p * 4] = col[0]; base[p * 4 + 1] = col[1]; base[p * 4 + 2] = col[2]; base[p * 4 + 3] = 255;
    };
    const centre = k => G.at(k % geo.size - geo.radius, ((k / geo.size) | 0) - geo.radius);
    // Pixels to the edge of the water (from land), of the land (from water; the map edge is not
    // land) and of the nest; 0 on the edge pixel itself, as from the old square cell's edge.
    const toWater = spread(w, h, p => terr(p) === WATER), toLand = spread(w, h, p => terr(p) >= 0 && terr(p) !== WATER);
    const toRim = spread(w, h, p => terr(p) !== NEST);

    // Each cell's pixels, as runs of `pixels` from `first[k]` (storage index k).
    const SS = geo.size * geo.size, first = new Int32Array(SS + 1), pixels = new Int32Array(w * h);
    for (let p = 0; p < w * h; p++) if (owner[p] >= 0) first[owner[p] + 1]++;
    for (let k = 0; k < SS; k++) first[k + 1] += first[k];
    const fill = first.slice(0, SS);
    for (let p = 0; p < w * h; p++) if (owner[p] >= 0) pixels[fill[owner[p]]++] = p;

    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
      const p = Y * w + X, k = owner[p], t = terr(p), hs = hash(X, Y);
      let col;
      if (k < 0) col = [36, 51, 28];  // the stage's ground, beyond the map
      else if (t === ROCK) col = hs < .1 ? [92, 88, 80] : [118, 112, 102];
      else if (t === WATER) {
        if (!K.banks) col = hs < .1 ? [40, 95, 170] : [46, 110, 185];
        else { const dl = toLand[p] - 1; col = dl < 2 ? [176, 216, 232] : mix([78, 158, 206], [40, 102, 176], Math.min(2, Math.floor(dl / (PX * .45))) / 2); }
      } else {
        const dw = toWater[p] - 1, rim = toRim[p] - 1;
        if (t === NEST) {
          col = K.ground === 'speckle' ? (hs < .08 ? [170, 130, 90] : hs < .16 ? [90, 60, 35] : [128, 88, 52])
            : K.ground === 'scatter' ? (rim < 2 ? [118, 82, 46] : [146, 104, 60])
            : rim < 2 ? [104, 70, 40] : mix([150, 108, 64], [124, 86, 50], Math.floor(vnoise(X, Y, PX * .7, 5) * 3) / 2);
        } else if (K.banks && dw < 4) {
          col = dw < 1 ? [138, 120, 84] : mix([206, 186, 132], [188, 166, 112], Math.floor(vnoise(X, Y, 6, 6) * 2));
        } else if (K.ground === 'speckle') {
          col = hs < .05 ? [120, 170, 70] : hs < .12 ? [70, 112, 44] : [88, 138, 56];
          const [cx, cy] = centre(k);
          if (hash(cx, cy, 7) < .08 && X === cx - 1 && Y > cy - 3 && Y < cy + 2) col = [140, 190, 80];  // tuft
        } else if (K.ground === 'scatter') {
          col = [92, 142, 58];
        } else {
          const tone = .6 * vnoise(X, Y, PX * 2.5, 1) + .4 * vnoise(X, Y, PX * .8, 2);
          col = mix([80, 130, 54], [116, 166, 74], Math.min(3, Math.floor(tone * 4)) / 3);
        }
      }
      set(X, Y, col);
    }

    // Per-cell details, in a box of side PX about the centre and clipped to the cell.
    for (const [q, r] of geo.cells) {
      const k = geo.index(q, r), t = T[k], [cx, cy] = G.at(q, r), X0 = cx - (PX >> 1), Y0 = cy - (PX >> 1);
      const nearWater = HEADINGS.some(([dq, dr]) => { const j = geo.index(q + dq, r + dr); return j >= 0 && geo.mask[j] && T[j] === WATER; });
      if (t === WATER || t === ROCK || nearWater && K.banks) continue;
      const c = q, rr = r;  // detail hashes are keyed by the cell
      if (K.ground === 'scatter') {  // specks, lit pebbles, small x-shaped weeds
        const dirt = t === NEST;
        const SPECK = dirt ? [118, 82, 44] : [68, 112, 42], HI = dirt ? [214, 188, 148] : [206, 214, 172];
        const MID = dirt ? [176, 146, 104] : [158, 170, 128], SHD = dirt ? [100, 68, 36] : [54, 90, 34];
        const spot = (j, m) => [X0 + 2 + ((hash(c, rr, 100 + j) * (PX - 4 - m)) | 0), Y0 + 2 + ((hash(c, rr, 200 + j) * (PX - 4 - m)) | 0)];
        const ns = 3 + ((hash(c, rr, 1) * 4) | 0);
        for (let j = 0; j < ns; j++) { const [x, y] = spot(j, 0); set(x, y, SPECK, k); }
        for (let j = 0; j < 2; j++) if (hash(c, rr, 2 + j) < .55) { const [x, y] = spot(10 + j, 1); set(x, y, HI, k); set(x + 1, y + 1, SHD, k); }
        if (hash(c, rr, 5) < .22) {
          const [x, y] = spot(20, 3);
          set(x, y, HI, k); set(x + 1, y, MID, k); set(x, y + 1, MID, k); set(x + 1, y + 1, MID, k);
          set(x + 2, y + 1, SHD, k); set(x + 1, y + 2, SHD, k); set(x + 2, y + 2, SHD, k);
        }
        if (!dirt && hash(c, rr, 6) < .18) {
          const [x, y] = spot(30, 5);
          for (const [dx, dy] of [[0, 0], [4, 0], [1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [0, 4], [4, 4], [2, 1]]) set(x + dx, y + dy, [44, 82, 30], k);
          set(x + 4, y, [126, 176, 78], k);
        }
      } else if (K.ground === 'bands') {  // a few grass blades and the odd flower; pebbles on the nest
        if (t === NEST) {
          if (hash(c, rr, 50) < .35) {
            const px = X0 + 3 + ((hash(c, rr, 51) * (PX - 6)) | 0), py = Y0 + 3 + ((hash(c, rr, 52) * (PX - 6)) | 0);
            set(px, py, [184, 158, 126], k); set(px + 1, py, [164, 138, 108], k); set(px, py + 1, [120, 98, 76], k); set(px + 1, py + 1, [104, 84, 64], k);
          }
          continue;
        }
        for (let j = 0; j < 3; j++) {
          const bx = X0 + 2 + ((hash(c, rr, 10 + j) * (PX - 4)) | 0), by = Y0 + 5 + ((hash(c, rr, 20 + j) * (PX - 7)) | 0);
          const len = 2 + ((hash(c, rr, 30 + j) * 3) | 0);
          set(bx, by, [62, 104, 42], k); for (let i = 1; i <= len; i++) set(bx + (i === len && j % 2 ? 1 : 0), by - i, [138, 188, 92], k);
        }
        if (hash(c, rr, 40) < .05) {
          const fx = X0 + 4 + ((hash(c, rr, 41) * (PX - 8)) | 0), fy = Y0 + 4 + ((hash(c, rr, 42) * (PX - 8)) | 0);
          const petal = hash(c, rr, 43) < .5 ? [244, 240, 226] : [240, 190, 220];
          set(fx - 1, fy, petal, k); set(fx + 1, fy, petal, k); set(fx, fy - 1, petal, k); set(fx, fy + 1, petal, k); set(fx, fy, [250, 206, 80], k);
        }
      }
    }

    // The nest hole at the nest's centre, the centre cell.
    const [mx, my] = G.at(0, 0), rx = PX * (K.ground === 'speckle' ? .42 : .55), ry = PX * (K.ground === 'speckle' ? .33 : .4);
    for (let y = -ry - 2; y <= ry + 2; y++) for (let x = -rx - 2; x <= rx + 2; x++) {
      const q = x * x / (rx * rx) + y * y / (ry * ry), X = Math.round(mx + x), Y = Math.round(my + y);
      if (q < 1) set(X, Y, K.ground === 'speckle' ? [30, 18, 10] : y < -ry * .3 ? [22, 12, 6] : [40, 24, 14]);
      else if (q < 1.35 && y > 0 && K.ground !== 'speckle') set(X, Y, [168, 124, 78]);  // lit lip
    }
    if (K.ground === 'scatter') {  // excavated soil around the hole, thinning outwards
      const R = 2.6;
      for (let y = -ry * 1.7; y <= ry * 1.7; y++) for (let x = -rx * 1.7; x <= rx * 1.7; x++) {
        const q = x * x / (rx * rx) + y * y / (ry * ry), X = Math.round(mx + x), Y = Math.round(my + y);
        if (q >= 1.35 && q < R && hash(X, Y, 99) < (R - q) / (R - 1.35) * .85) set(X, Y, hash(X, Y, 98) < .7 ? [178, 136, 88] : [198, 160, 110]);
      }
    }
    // Each map pixel's flow (unit vector along the water) from its cell's.
    const fx = new Float32Array(SS), fy = new Float32Array(SS);
    for (let k = 0; k < SS; k++) { fx[k] = Math.cos(d.flow[k]); fy[k] = Math.sin(d.flow[k]); }
    built = { e, tile, G, off, img, buf: img.data, base, first, pixels, fx, fy, blend: K.pheromones === 'tint' ? blendWeights(G, geo) : null };
  }

  // Pick the tile and zoom for the stage, (re)build for them, and size and place the canvas.
  function layout(e) {
    const dpr = devicePixelRatio || 1, room = st.room();
    const { tile, zoom } = pickTile(e.geo.radius, K.tiles, Math.max(1, room.w * dpr), Math.max(1, room.h * dpr));
    if (!built || built.e !== e || built.tile !== tile) build(e, tile);
    const { w, h } = built.G;
    if (st.cv.width !== w || st.cv.height !== h) { st.cv.width = w; st.cv.height = h; }
    st.place(w * zoom / dpr, h * zoom / dpr);
    placed = { e, zoom };
  }

  function draw() {
    const e = shell.episode;
    st.root.classList.toggle('empty', !e);
    if (!e) return;
    if (!placed || placed.e !== e) layout(e);
    const { G, off, img, buf, base, first, pixels, fx, fy, blend: B } = built, { w, h, owner, row: PX } = G;
    const geo = e.geo, SS = geo.size * geo.size, f = shell.clock.t, time = shell.clock.time, fr = frame(e, f);
    const PF = fr.pheromone_food, PH = fr.pheromone_home, now = performance.now() / 1000;
    const blend = (X, Y, col, a) => {
      if (X < 0 || Y < 0 || X >= w || Y >= h) return;
      const i = (Y * w + X) * 4; buf[i] += (col[0] - buf[i]) * a; buf[i + 1] += (col[1] - buf[i + 1]) * a; buf[i + 2] += (col[2] - buf[i + 2]) * a;
    };
    const put = (X, Y, col) => blend(X, Y, col, 1);
    const val = (F, k) => k < 0 ? 0 : F[k] / 255;
    const open = k => k >= 0 && e.terrain[k] === WATER && !fr.bridges[k];  // water without a bridge
    buf.set(base);

    for (const [q, r] of geo.cells) {
      const k = geo.index(q, r), [cx, cy] = G.at(q, r), br = fr.bridges[k], ux = fx[k], uy = fy[k];
      const from = first[k], to = first[k + 1];
      if (open(k)) {
        if (K.ground === 'speckle') {  // crests across the flow, drifting along it
          const wave = Math.floor(now * 3);
          for (let i = from; i < to; i++) {
            const p = pixels[i], X = p % w, Y = (p / w) | 0;
            if (((Math.round(X * ux + Y * uy) - wave) % 11 + 11) % 11 === 0 && hash(X, Y) < .5) put(X, Y, [150, 200, 240]);
          }
        } else for (let j = 0; j < 2; j++) {  // slow streaks drifting along the flow
          const a = Math.round((hash(q, r, 60 + j) - .5) * (PX - 4)), b = (hash(q, r, 70 + j) * PX + now * 7) % PX - PX / 2;
          for (let i = 0; i < 3; i++) {
            const X = Math.round(cx + (b + i) * ux - a * uy), Y = Math.round(cy + (b + i) * uy + a * ux);
            if (X >= 0 && Y >= 0 && X < w && Y < h && owner[Y * w + X] === k) blend(X, Y, [196, 228, 246], .55);
          }
        }
      }
      if (K.pheromones === 'dots') {
        const pf = val(PF, k), ph = val(PH, k);
        if (pf > 0 || ph > 0) for (let i = from; i < to; i++) {
          const p = pixels[i], X = p % w, Y = (p / w) | 0;
          if (pf > 0 && hash(X, Y, 1) < pf * .22) put(X, Y, [255, 150, 210]);
          else if (ph > 0 && hash(X, Y, 2) < ph * .22) put(X, Y, [170, 225, 255]);
        }
      } else if (!open(k)) {  // the field blended over the cells, in four steps, as a tint over land and bridges
        for (let i = from; i < to; i++) {
          const p = pixels[i], a = B.wA[p], b = B.wB[p], c = 1 - a - b;
          const vf = c * val(PF, k) + a * val(PF, B.nA[p]) + b * val(PF, B.nB[p]);
          const vh = c * val(PH, k) + a * val(PH, B.nA[p]) + b * val(PH, B.nB[p]);
          if (vf <= 0 && vh <= 0) continue;
          const sf = Math.floor(vf * 4) / 4, sh = Math.floor(vh * 4) / 4, X = p % w, Y = (p / w) | 0;
          if (sf >= sh && sf > 0) blend(X, Y, [255, 150, 205], .5 * sf);
          else if (sh > 0) blend(X, Y, [160, 220, 255], .5 * sh);
        }
      }
      if (br) {  // boards across the walking direction (across the flow), rails along open water
        const bh = Math.max(3, Math.floor(PX / 3));
        for (let i = from; i < to; i++) {
          const p = pixels[i], X = p % w, Y = (p / w) | 0;
          const walk = X * -uy + Y * ux, across = X * ux + Y * uy, bi = Math.floor(walk / bh), aa = Math.floor(walk - bi * bh);
          let col = aa === 0 ? [228, 178, 110] : aa === bh - 1 ? [30, 66, 116] : aa === bh - 2 ? [132, 88, 44] : [190, 136, 76];
          if (aa === (bh >> 1) && hash(bi, k, Math.floor(across) >> 2) < .3) col = [160, 110, 58];  // grain
          const rail = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const x = X + dx, y = Y + dy; return x >= 0 && y >= 0 && x < w && y < h && open(owner[y * w + x]);
          });
          if (rail && aa < bh - 1) col = [116, 76, 38];
          put(X, Y, col);
        }
      }
      if (fr.planks[k]) {
        const pw = Math.round(PX * .72), ph = Math.max(4, Math.round(PX * .24)), x0 = cx - (pw >> 1), y0 = cy - (ph >> 1);
        for (let x = 0; x < pw; x++) blend(x0 + x + 1, y0 + ph, [0, 0, 0], .3);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++)
          put(x0 + x, y0 + y, y === 0 || x === 0 || x === pw - 1 || y === ph - 1 ? [96, 62, 30] : y === 1 ? [236, 188, 120] : [200, 146, 84]);
      }
      const nf = Math.min(5, Math.ceil(fr.food[k] / e.config.food_per_cell * 5)), X0 = cx - (PX >> 1), Y0 = cy - (PX >> 1);
      for (let j = 0; j < nf; j++) {
        if (K.sprite === 'small') {
          const bx = X0 + 2 + Math.floor(hash(k, j, 3) * (PX - 5)), by = Y0 + 2 + Math.floor(hash(k, j, 4) * (PX - 5));
          put(bx, by, [255, 140, 120]); put(bx + 1, by, [200, 40, 35]); put(bx, by + 1, [180, 30, 30]); put(bx + 1, by + 1, [150, 25, 25]);
        } else {
          const bx = X0 + 2 + ((hash(k, j, 3) * (PX - 7)) | 0), by = Y0 + 2 + ((hash(k, j, 4) * (PX - 7)) | 0);
          for (let x = 0; x < 4; x++) blend(bx + x, by + 4, [0, 0, 0], .2);
          BERRY.forEach((row, y) => [...row].forEach((ch, x) => BERRY_PAL[ch] && put(bx + x, by + y, BERRY_PAL[ch])));
          put(bx + 1, by - 1, [70, 130, 50]);
        }
      }
    }

    const ctx = off.getContext('2d'); ctx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false;
    const fh = Math.min(Math.round(time), numFrames(e) - 1);
    for (let i = 0; i < e.config.num_ants; i++) {
      const a = antAt(e, time, i); if (a.dead) continue;
      const heading = ant(e, fh, i).heading, [x, y] = G.at(a.q, a.r), X = Math.round(x), Y = Math.round(y);
      if (K.sprite === 'small') {
        ctx.globalAlpha = a.alpha; ctx.drawImage(smallSprite(heading, a.item), X - 9, Y - 9);
      } else {
        const step = a.moving ? Math.floor(now * 8 + i) % 2 : 0;
        ctx.globalAlpha = a.alpha * .25; ctx.fillStyle = '#000';
        ctx.fillRect(X - 5, Y + 3, 11, 4); ctx.fillRect(X - 3, Y + 2, 7, 6);
        ctx.globalAlpha = a.alpha; ctx.drawImage(hdSprite(heading, a.item, step), X - 15, Y - 15);
      }
    }
    ctx.globalAlpha = 1;
    for (const ev of e.events) if (ev.kind === 'died' && time >= ev.f && time < ev.f + 8) {  // splash
      const p = ant(e, ev.f, ev.ant), k = (time - ev.f) / 8, R = Math.round(2 + k * PX * .8), [X, Y] = G.at(p.q, p.r);
      ctx.fillStyle = `rgba(220,240,255,${1 - k})`;
      ctx.fillRect(X - R, Y - 1, R * 2, 2); ctx.fillRect(X - 1, Y - R, 2, R * 2);
    }
    st.cv.getContext('2d').drawImage(off, 0, 0);
    st.hud();
  }

  return {
    id, name: K.name, animated: true, speed: 5,
    mount(stage, sh) { shell = sh; st = terrariumStage(stage, sh); built = placed = null; },
    unmount() { st.root.remove(); built = placed = null; },
    draw, resize() { placed = null; }, key: () => false, episodeChanged() { placed = null; },
  };
}
