// Hex geometry the lenses share (anthive/hex.py on the Python side): flat-top tiles in axial
// coordinates (q, r), on a hexagon map of some radius stored as a (2R+1)² array indexed
// [r + R, q + R]. Unit geometry has corner radius 1, so centres are √3 apart.

const SQRT3 = Math.sqrt(3);

// Neighbour offsets [dq, dr] by heading, clockwise from north: N, NE, SE, S, SW, NW.
export const HEADINGS = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];

// Steps between two cells [dq, dr] apart.
export const distance = (dq, dr) => (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;

// [q, r] turned k * 60° clockwise about the origin.
export function rotate(q, r, k) {
  for (let i = 0; i < ((k % 6) + 6) % 6; i++) [q, r] = [0 - r, q + r];  // 0 - r: never -0
  return [q, r];
}

// The Window's offsets for an ant facing north (ahead is up), in ring order: the centre, then
// each ring from the cell ahead, clockwise. Another heading h is rotate(..., h).
export function ringOffsets(radius) {
  const out = [[0, 0]];
  for (let d = 1; d <= radius; d++) {
    let q = 0, r = -d;
    for (let side = 0; side < 6; side++) {
      const [dq, dr] = HEADINGS[(side + 2) % 6];
      for (let k = 0; k < d; k++) { out.push([q, r]); q += dq; r += dr; }
    }
  }
  return out;
}

// Unit-geometry centre [x, y] of cell (q, r), y down.
export const center = (q, r) => [1.5 * q, SQRT3 * (r + q / 2)];

// The six unit-geometry corners of cell (q, r), clockwise from the east one.
export function corners(q, r) {
  const [x, y] = center(q, r);
  return Array.from({ length: 6 }, (_, k) => [x + Math.cos(k * Math.PI / 3), y + Math.sin(k * Math.PI / 3)]);
}

// The largest drawing of a hexagon map of `radius` that fits a stage of w × h: tile corner radius
// `size`, the canvas `width` × `height` it needs, and where the centre cell lands (x, y).
export function fit(radius, w, h) {
  const uw = 3 * radius + 2, uh = SQRT3 * (2 * radius + 1);
  const size = Math.min(w / uw, h / uh), width = uw * size, height = uh * size;
  return { radius, size, width, height, x: width / 2, y: height / 2 };
}

// Canvas point [x, y] of the centre of cell (q, r) under a fit.
export function point(f, q, r) {
  const [x, y] = center(q, r);
  return [f.x + f.size * x, f.y + f.size * y];
}

// The cell [q, r] under canvas point (x, y), or null off the map.
export function pick(f, x, y) {
  const ux = (x - f.x) / f.size, uy = (y - f.y) / f.size;
  const qf = 2 / 3 * ux, rf = -ux / 3 + uy / SQRT3, sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf), dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return distance(q, r) <= f.radius ? [q + 0, r + 0] : null;  // + 0: never -0
}

// The map an episode's `map` header block describes: its radius, storage side `size`, the cells
// [q, r] in storage order, the in-map `mask` over storage, and `index(q, r)` into storage (-1 off
// the stored square).
export function mapGeometry(map) {
  if (!map) throw new Error('episode has no map header');
  const want = { coords: 'axial', shape: 'hexagon', orientation: 'flat' };
  for (const [k, v] of Object.entries(want))
    if (map[k] !== v) throw new Error(`unsupported map ${k} ${map[k]} (want ${v})`);
  const R = map.radius, size = 2 * R + 1, mask = new Uint8Array(size * size), cells = [];
  const index = (q, r) => Math.abs(q) <= R && Math.abs(r) <= R ? (r + R) * size + q + R : -1;
  for (let r = -R; r <= R; r++) for (let q = -R; q <= R; q++)
    if (Math.abs(q + r) <= R) { cells.push([q, r]); mask[index(q, r)] = 1; }
  return { radius: R, size, cells, mask, index };
}

// ------------------------------------------------------------------ integer tile grids (pixel art)
// A pixel-art drawing of the map: cell (q, r) is centred on art pixel (ox + col·q, oy + row·r +
// row/2·q), and every art pixel belongs to its nearest centre, so every hex is the same pixel shape.
// A tile is [col, row]: the column step and the row step (even), e.g. [12, 14] for a 16-px tile.

// The tile and whole-number zoom (device pixels per art pixel) that fill a stage of w × h device
// pixels best, from a list of tiles; ties go to the larger tile. When no tile fits even at 1×, the
// smallest one is drawn at 1×.
export function pickTile(radius, tiles, w, h) {
  let best = null;
  for (const tile of tiles) {
    const g = tileSize(radius, tile), zoom = Math.max(1, Math.floor(Math.min(w / g.w, h / g.h)));
    const fill = g.w * zoom <= w && g.h * zoom <= h ? g.w * zoom * g.h * zoom / (w * h) : -g.w * g.h;
    if (!best || fill >= best.fill) best = { tile, zoom, fill };
  }
  return best;
}

// The art buffer w × h a hexagon map of `radius` takes with `tile`, and the centre cell's pixel
// (ox, oy): the cell centres' extent with a tile's width of margin all round.
function tileSize(radius, [col, row]) {
  const m = Math.ceil(col * 4 / 3);
  return { w: 2 * radius * col + 2 * m, h: 2 * radius * row + 2 * m, ox: radius * col + m, oy: radius * row + m };
}

// The grid of an episode map's `geo` (mapGeometry) under `tile`: the buffer size, the art pixel of
// a (fractional) cell `at(q, r)`, and `owner`, each art pixel's cell as a storage index (-1 off
// the map).
export function tileGrid(geo, tile) {
  const [col, row] = tile, off = row / 2, { w, h, ox, oy } = tileSize(geo.radius, tile);
  const owner = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const qf = (x + .5 - ox) / col, rf = (y + .5 - oy - off * qf) / row, sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf);
    const s = Math.round(sf), dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    owner[y * w + x] = distance(q, r) <= geo.radius ? geo.index(q, r) : -1;
  }
  return { tile, col, row, w, h, ox, oy, owner, at: (q, r) => [ox + col * q, oy + row * r + off * q] };
}
