// Episode files (format anthive-episode/4, written by anthive/record.py), decoded for the lenses.
// Only /4 is read.
//
// A file is gzip( header length ‖ header ‖ arrays ): a little-endian uint32, UTF-8 JSON, then raw
// little-endian arrays back to back, each listed in the header's `arrays` table by name
// (`terrain` or `<part>/<key>`), shape, dtype and byte offset from the end of the header. Each
// array's dtype is fixed by its name (DTYPES): the table's is checked, never branched on. Every
// array becomes a typed array (with `.shape`). A header part that also holds arrays (keyframes,
// annotations, lab) keeps its plain fields in the header; the arrays are merged into it.
//
// Frames: frame 0 is the reset state, frame t the state after step t. The ants are stored at every
// frame (`ants/*`, T + 1 rows), with the actions taken from each frame (`steps/actions`, T rows).
// The grids that change (food, planks, bridges, pheromones) are stored only at keyframes; `frame`
// rebuilds any other from the keyframe before it, replaying the events (every food, plank and
// bridge change) and re-running the sim's pheromone rule from the header. See anthive/record.py.
//
// The map: the header's `map` block, a flat-top hexagon of radius R in axial coordinates (hex.js).
// Per-cell arrays are the (2R+1)² axial storage, indexed [r + R, q + R]; `e.geo` is its geometry.
// Positions are stored as (q + R, r + R); `ant()` gives them back as axial q, r. Headings are
// absolute, 0-5 clockwise from north (HEADINGS). A move is relative to the heading of the frame
// it was taken from: 0-5 clockwise from ahead (MOVE_NAMES), 6 stay; its map heading is
// (heading + move) % 6.
//
// Observations and action probabilities are kept only for the Lab ants (`e.lab.ants`), and are
// absent from published episodes; `labIndex` says whether an ant has them.

import { mapGeometry } from './hex.js';
export { HEADINGS } from './hex.js';

// ------------------------------------------------------------------ constants (anthive/config.py)
export const WATER = 1, NEST = 2, ROCK = 4;
export const STAY = 6;
export const MOVE_NAMES = ['ahead', 'ahead-right', 'back-right', 'back', 'back-left', 'ahead-left', 'stay'];
export const INTERACT = ['noop','pick','drop'];
export const ITEM = ['—','food','plank'];

const FORMAT = 'anthive-episode/4';
const TYPED = { uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };
const u8 = 'uint8', u16 = 'uint16';
const DTYPES = {
  terrain: u8,
  'annotations/patch': u8, 'annotations/ridge': u8, 'annotations/pass': u8, 'annotations/beyond': u8,
  'keyframes/food': u16, 'keyframes/planks': u8, 'keyframes/bridges': u8,
  'keyframes/pheromone_food': u8, 'keyframes/pheromone_home': u8,
  'ants/pos': u16, 'ants/heading': u8, 'ants/item': u8, 'ants/alive': u8,
  'steps/actions': u8,
  'events/step': u16, 'events/ant': u16, 'events/kind': u8, 'events/q': u16, 'events/r': u16,
  'events/extra': u8, 'events/step_start': 'uint32',
  'moments/step': u16, 'moments/ant': u16, 'moments/kind': u8, 'moments/ref': u16,
  'lab/obs': u8, 'lab/probs': u8,
};

// The bytes of an episode file, as fetched or dropped. A host may have inflated it already
// (Content-Encoding), so it is only inflated when it starts with the gzip magic bytes.
export async function readEpisode(buf) {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b)
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (buf.byteLength < 4) throw new Error(`not an ${FORMAT} file (too short)`);
  const n = new DataView(buf).getUint32(0, true);
  let header;
  try { header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))); }
  catch { throw new Error(`not an ${FORMAT} file (no header)`); }
  if (header.format !== FORMAT) throw new Error(`not an ${FORMAT} file (${header.format})`);
  const { arrays, ...ep } = header;
  for (const a of arrays) {
    if (DTYPES[a.name] !== a.dtype || a.encoding !== 'raw') throw new Error(`${a.name}: unexpected ${a.dtype}/${a.encoding} array`);
    const T = TYPED[a.dtype], start = 4 + n + a.offset;
    // A wider array is copied out: its offset in the file need not be aligned to its width.
    const v = T === Uint8Array ? new Uint8Array(buf, start, a.length) : new T(buf.slice(start, start + a.length));
    v.shape = a.shape;
    const [part, key] = a.name.split('/');
    if (key) (ep[part] ??= {})[key] = v; else ep[part] = v;
  }
  // The arrays decide what was recorded: a layout without its array (as on publish) is off.
  if (!ep.lab?.obs) ep.obs_layout = null;
  if (!ep.lab?.probs) ep.probs_layout = null;
  return prepare(ep);
}

const MARKED = { deliver: 'delivered', bridge: 'bridged', drown: 'died' };  // the events the lenses mark

function prepare(ep) {
  const T = ep.num_steps, F = T + 1, lay = ep.obs_layout, R = ep.map.radius;
  ep.geo = mapGeometry(ep.map);
  ep.obsSize = lay ? lay.cells * lay.channels.length + lay.scalars.length : 0;
  // The event table stays as read (`eventTable`); `events` lists the deliveries, bridges and
  // drownings the lenses mark, {f, ant, kind, q, r}: f the frame the step made, q, r axial (a
  // bridge's own cell).
  const ev = ep.eventTable = ep.events, kinds = ep.event_kinds, SS = ep.geo.size ** 2;
  ep.events = [];
  ep.cumDelivered = new Int32Array(F);
  ep.bridgeCount = new Int32Array(F);  // bridges on the map at each frame
  let bridges = 0;
  for (let k = 0; k < SS; k++) bridges += ep.keyframes.bridges[k];
  ep.bridgeCount[0] = bridges;
  for (let t = 0; t < T; t++) {
    let n = 0;
    for (let j = ev.step_start[t]; j < ev.step_start[t + 1]; j++) {
      const kind = MARKED[kinds[ev.kind[j]]];
      if (!kind) continue;
      if (kind === 'delivered') n++;
      if (kind === 'bridged') bridges++;
      ep.events.push({ f: t + 1, ant: ev.ant[j], kind, q: ev.q[j] - R, r: ev.r[j] - R });
    }
    ep.cumDelivered[t + 1] = ep.cumDelivered[t] + n;
    ep.bridgeCount[t + 1] = bridges;
  }
  ep.frameAt = rebuilder(ep);
  return ep;
}

export const numAnts = e => e.config.num_ants;
export const numFrames = e => e.num_steps + 1;

// Ant `i` at frame `f`, at axial (q, r), with the actions it took from that frame (none at the
// last frame).
export function ant(e, f, i) {
  const s = e.ants, k = f * numAnts(e) + i, R = e.geo.radius;
  const a = { q: s.pos[k * 2] - R, r: s.pos[k * 2 + 1] - R, heading: s.heading[k], item: s.item[k], alive: !!s.alive[k] };
  if (f < e.num_steps) { const x = e.steps.actions; a.move = x[k * 3]; a.interact = x[k * 3 + 1]; a.pheromone = x[k * 3 + 2]; }
  return a;
}

// Ant `i`'s row in the Lab arrays (`e.lab.obs`, `e.lab.probs`: T × Lab ants × …), or -1 when its
// observations and probabilities were not kept.
export const labIndex = (e, i) => e.lab?.ants?.indexOf(i) ?? -1;

export function pheromoneName(e, p) {
  const L = e.config.pheromone_levels - 1;
  return p === 0 ? 'none' : p <= L ? `food ${p}` : `home ${p - L}`;
}

// The grids at frame `f`, over the axial storage: `food` (Uint16Array), `planks`, `bridges` and
// both pheromones as 0-255 of pheromone_max (Uint8Arrays), as the keyframes store them. The
// arrays are reused: they hold frame f until the next call.
export const frame = (e, f) => e.frameAt(f);

// From the keyframe at or before f, step forward: events change food, planks and bridges; each
// step's pheromone deposits go to the ants' new cells, then the grid decays and is capped. Decay
// is lazy: a cell keeps its value and the frame it held it at (`at`), and is decayed the rest of
// the way only when an ant lays on it or the frame is drawn. Stepping on from the frame before
// reuses that state, so playback costs one step per frame.
function rebuilder(e) {
  const kf = e.keyframes, steps = kf.steps, SS = e.geo.size ** 2, A = numAnts(e), S = e.geo.size;
  const ev = e.eventTable, kinds = e.event_kinds, pos = e.ants.pos, alive = e.ants.alive, act = e.steps.actions;
  const top = e.pheromone_max, keep = 1 - e.pheromone_decay, levels = e.pheromone_levels - 1;
  const deposit = e.pheromones ? e.pheromone_deposit : 0;
  let gap = 1; for (let i = 1; i < steps.length; i++) gap = Math.max(gap, steps[i] - steps[i - 1]);
  const pow = new Float64Array(gap + 1); pow[0] = 1; for (let i = 1; i <= gap; i++) pow[i] = pow[i - 1] * keep;
  const PICK_FOOD = kinds.indexOf('pick_food'), DROP_FOOD = kinds.indexOf('drop_food'),
        PICK_PLANK = kinds.indexOf('pick_plank'), DROP_PLANK = kinds.indexOf('drop_plank'), BRIDGE = kinds.indexOf('bridge');
  const names = ['pheromone_food', 'pheromone_home'];
  const food = new Uint16Array(SS), planks = new Uint8Array(SS), bridges = new Uint8Array(SS);
  const val = [new Float32Array(SS), new Float32Array(SS)], at = [new Int32Array(SS), new Int32Array(SS)], laid = [[], []];
  const out = { food, planks, bridges, pheromone_food: new Uint8Array(SS), pheromone_home: new Uint8Array(SS) };
  let now = -1, segment = -1, drawn = -1;

  function load(i) {
    const o = i * SS;
    food.set(kf.food.subarray(o, o + SS)); planks.set(kf.planks.subarray(o, o + SS)); bridges.set(kf.bridges.subarray(o, o + SS));
    for (let g = 0; g < 2; g++) {
      const src = kf[names[g]], v = val[g];
      for (let k = 0; k < SS; k++) v[k] = src[o + k] / 255 * top;
      at[g].fill(steps[i]);
    }
    now = steps[i]; segment = i;
  }

  function step(s) {
    for (let j = ev.step_start[s]; j < ev.step_start[s + 1]; j++) {
      const k = ev.r[j] * S + ev.q[j], kind = ev.kind[j];
      if (kind === PICK_FOOD) food[k]--; else if (kind === DROP_FOOD) food[k]++;
      else if (kind === PICK_PLANK) planks[k]--; else if (kind === DROP_PLANK) planks[k]++;
      else if (kind === BRIDGE) bridges[k] = 1;
    }
    if (deposit) {
      const row = (s + 1) * A;  // the ants after the step: alive, and on the cell they lay on
      for (let i = 0; i < A; i++) {
        const a = act[(s * A + i) * 3 + 2];
        if (!a || !alive[row + i]) continue;
        const g = a <= levels ? 0 : 1, k = pos[(row + i) * 2 + 1] * S + pos[(row + i) * 2], v = val[g], t = at[g];
        if (t[k] !== s + 1) { v[k] *= pow[s - t[k]]; t[k] = s + 1; laid[g].push(k); }  // decayed to frame s
        v[k] += ((a - 1) % levels + 1) / levels * deposit;
      }
      for (let g = 0; g < 2; g++) {
        const v = val[g];
        for (const k of laid[g]) v[k] = Math.min(v[k] * keep, top);
        laid[g].length = 0;
      }
    }
    now = s + 1;
  }

  return f => {
    if (f === drawn) return out;
    let i = steps.length - 1; while (steps[i] > f) i--;
    if (segment !== i || now > f) load(i);
    while (now < f) step(now);
    for (let g = 0; g < 2; g++) {
      const v = val[g], t = at[g], o = out[names[g]];
      for (let k = 0; k < SS; k++) o[k] = Math.round(Math.min(v[k] * pow[f - t[k]], top) / top * 255);
    }
    drawn = f;
    return out;
  };
}
