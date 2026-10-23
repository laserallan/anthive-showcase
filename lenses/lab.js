// The Lab lens: for inspecting a policy. The hex map with toggleable layers, the timeline, the ant
// table, and the selected ant's Window (in its own frame, ahead up, with ring-order indices),
// scalars and action probabilities (moves relative to its heading). The Window is outlined on the
// map with a dashed line.
//
// Keys (besides the shell's): Tab / Shift-Tab next ant · f follow · 1-6 layers.

import { WATER, NEST, ROCK, STAY, HEADINGS, MOVE_NAMES, INTERACT, ITEM, ant, frame, labIndex, numAnts, numFrames, pheromoneName } from '../episode.js';
import { distance, rotate, ringOffsets, center, corners, fit, point, pick } from '../hex.js';
import { el, button } from '../dom.js';

const LAYERS = { food:'Food', pheromone_food:'Food pheromone', pheromone_home:'Home pheromone',
                 planks:'Loose planks', bridges:'Bridges', window:'Window' };
const FOLLOW_RADIUS = 7;
// A heading clockwise from north, or a move clockwise from ahead (6: stay), as an arrow.
const ARROWS = ['↑', '↗', '↘', '↓', '↙', '↖', '·'];

// The cells [q, r] within `radius` steps of the centre.
const disk = radius => {
  const out = [];
  for (let r = -radius; r <= radius; r++) for (let q = -radius; q <= radius; q++) if (distance(q, r) <= radius) out.push([q, r]);
  return out;
};
// A flat-top hexagon of corner radius `s` centred on (x, y), as the current path.
function hexPath(ctx, x, y, s) {
  ctx.beginPath();
  for (const [cx, cy] of corners(0, 0)) ctx.lineTo(x + cx * s, y + cy * s);
  ctx.closePath();
}
// A canvas for a hex disk of `radius` drawn at tile corner radius `scale`: [canvas, context, centre].
function hexCanvas(radius, scale) {
  const side = Math.ceil(2 * scale * (Math.sqrt(3) * radius + 1)), dpr = devicePixelRatio || 1;
  const cv = el('canvas', { width: side * dpr, height: side * dpr });
  cv.style.width = cv.style.height = `${side}px`;
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [cv, x, side / 2];
}
// The Window's cells [q, r] on the map for ant `a`, in ring order.
const windowCells = (e, a) => ringOffsets(e.obs_layout?.radius ?? e.config.obs_radius)
  .map(([q, r]) => { const [dq, dr] = rotate(q, r, a.heading); return [a.q + dq, a.r + dr]; });

export function createLab() {
  let shell, root, follow, layerButtons;
  const S = { ant: 0, follow: false, layers: Object.fromEntries(Object.keys(LAYERS).map(k => [k, true])) };
  const ep = () => shell.episode, T = () => shell.clock.t;
  const A = () => numAnts(ep()), F = () => numFrames(ep());
  const antAt = (f, i) => ant(ep(), f, i);
  const $ = id => root.querySelector(`#${id}`);

  function mount(stage, sh) {
    shell = sh;
    root = el('div', { id: 'app' });
    root.innerHTML = `
      <div id="left"><h3>Ants</h3><table><thead><tr><th>#</th><th>item</th><th>move</th><th>act</th></tr></thead><tbody id="ants"></tbody></table></div>
      <div id="mid">
        <div id="status"></div>
        <canvas id="map"></canvas>
        <canvas id="timeline" height="36" title="Deliveries (top), bridges (middle), deaths (bottom). Click or drag to seek."></canvas>
        <div class="row" id="transport"></div>
        <div class="row" id="layers"></div>
      </div>
      <div id="right"></div>`;
    // Controls and ant rows are built once and updated in place: an element rebuilt between a
    // mousedown and its mouseup loses the click, and Lab redraws on every playback step.
    follow = button('Follow ant', () => { S.follow = !S.follow; draw(); }, S.follow, 'f');
    $('transport').append(follow);
    layerButtons = Object.keys(LAYERS).map((k, i) =>
      button(`${i + 1} ${LAYERS[k]}`, () => { S.layers[k] = !S.layers[k]; draw(); }, S.layers[k]));
    $('layers').append(...layerButtons);
    $('ants').onclick = ev => { const tr = ev.target.closest('tr'); if (tr) { S.ant = +tr.dataset.ant; draw(); } };
    stage.append(root);
  }

  function unmount() { root.remove(); }

  // ---------------------------------------------------------------- map
  // The whole map, or in follow mode the cells within FOLLOW_RADIUS of the selected ant.
  function mapView() {
    if (!S.follow) return { q0: 0, r0: 0, radius: ep().geo.radius };
    const a = antAt(T(), S.ant);
    return { q0: a.q, r0: a.r, radius: FOLLOW_RADIUS };
  }
  function drawMap() {
    const e = ep(), geo = e.geo, f = T(), L = S.layers, fr = frame(e, f);
    const view = mapView(), cv = $('map');
    // Whatever room the other rows of the centre column leave (gap 8px, padding 10px).
    const mid = $('mid'), rows = [...mid.children].filter(c => c.id !== 'map');
    const used = rows.reduce((h, c) => h + c.offsetHeight + 8, 20);
    const fitted = fit(view.radius, Math.max(40, mid.clientWidth - 20), Math.max(40, mid.clientHeight - used));
    const dpr = devicePixelRatio || 1, s = fitted.size;
    cv.width = Math.round(fitted.width * dpr); cv.height = Math.round(fitted.height * dpr);
    cv.style.width = `${fitted.width}px`; cv.style.height = `${fitted.height}px`;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, fitted.width, fitted.height);
    const P = (q, r) => point(fitted, q - view.q0, r - view.r0);
    const fpc = e.config.food_per_cell;
    for (const [dq, dr] of disk(view.radius)) {
      const q = view.q0 + dq, r = view.r0 + dr, [x, y] = P(q, r), k = geo.index(q, r);
      hexPath(ctx, x, y, s * .96);
      if (k < 0 || !geo.mask[k]) { ctx.fillStyle = '#050608'; ctx.fill(); continue; }
      const terr = e.terrain[k], bridge = fr.bridges[k] && L.bridges;
      let col = terr === WATER ? [38, 77, 190] : terr === NEST ? [140, 97, 51] : terr === ROCK ? [104, 100, 94] : [30, 36, 32];
      if (bridge) col = [150, 110, 60];
      const pf = L.pheromone_food ? fr.pheromone_food[k] / 255 : 0;
      const ph = L.pheromone_home ? fr.pheromone_home[k] / 255 : 0;
      col = col.map((v, j) => v * (1 - 0.6 * pf) + [190, 80, 220][j] * 0.6 * pf);
      col = col.map((v, j) => v * (1 - 0.6 * ph) + [70, 200, 220][j] * 0.6 * ph);
      const food = L.food ? Math.min(fr.food[k] / fpc, 1) : 0;
      if (food > 0) col = col.map((v, j) => v * (1 - food) + [50, 230, 80][j] * food);
      ctx.fillStyle = `rgb(${col.map(Math.round)})`; ctx.fill();
      if (bridge && s >= 5) { ctx.strokeStyle = '#5a3d1c'; ctx.lineWidth = 1; hexPath(ctx, x, y, s * .55); ctx.stroke(); }
      if (L.planks && fr.planks[k]) { ctx.fillStyle = '#d9a35b'; ctx.fillRect(x - s * .55, y - s * .16, s * 1.1, s * .32); }
    }
    const sel = antAt(f, S.ant);
    if (L.window && sel.alive) {
      // The Window's boundary: every edge of a Window cell whose neighbour is outside it.
      const inside = new Set(windowCells(e, sel).map(([q, r]) => `${q},${r}`));
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath();
      for (const key of inside) {
        const [q, r] = key.split(',').map(Number), [x, y] = P(q, r), cs = corners(0, 0);
        HEADINGS.forEach(([hq, hr], h) => {
          if (inside.has(`${q + hq},${r + hr}`)) return;
          const [ax, ay] = cs[(4 + h) % 6], [bx, by] = cs[(5 + h) % 6];
          ctx.moveTo(x + ax * s, y + ay * s); ctx.lineTo(x + bx * s, y + by * s);
        });
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (let i = 0; i < A(); i++) {
      const a = antAt(f, i);
      if (distance(a.q - view.q0, a.r - view.r0) > view.radius) continue;
      const [x, y] = P(a.q, a.r);
      if (!a.alive) {
        const d = s * .45; ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); ctx.stroke();
        continue;
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(a.heading * Math.PI / 3);  // pointing along its heading
      ctx.fillStyle = a.item === 1 ? '#ffd23f' : a.item === 2 ? '#d9a35b' : '#ff4d4d';
      ctx.beginPath(); ctx.moveTo(0, -s * .8); ctx.lineTo(s * .45, s * .55); ctx.lineTo(0, s * .25); ctx.lineTo(-s * .45, s * .55); ctx.closePath(); ctx.fill();  // a dart: its notch shows which way it points
      ctx.restore();
      if (i === S.ant) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * .85, 0, 7); ctx.stroke(); }
    }
    cv.onclick = ev => {
      const c = pick(fitted, ev.offsetX, ev.offsetY);
      if (!c) return;
      const q = c[0] + view.q0, r = c[1] + view.r0;
      let best = -1, bd = 2;
      for (let i = 0; i < A(); i++) { const a = antAt(f, i), d = distance(a.q - q, a.r - r); if (d < bd) { bd = d; best = i; } }
      if (best >= 0) { S.ant = best; draw(); }
    };
    return Math.round(fitted.width);
  }

  // ---------------------------------------------------------------- timeline
  function drawTimeline(width) {
    const e = ep(), n = F(), h = 36, cv = $('timeline');
    cv.width = width; cv.height = h;
    const x = cv.getContext('2d'), px = f => f / Math.max(1, n - 1) * (width - 2) + 1;
    x.fillStyle = '#1b2027'; x.fillRect(0, 0, width, h);
    const tot = Math.max(1, e.cumDelivered[n - 1]);
    x.strokeStyle = '#ffd23f66'; x.beginPath();
    for (let f = 0; f < n; f++) { const y = h - 2 - e.cumDelivered[f] / tot * (h - 4); f ? x.lineTo(px(f), y) : x.moveTo(px(f), y); }
    x.stroke();
    const mark = { delivered: ['#ffd23f', 0], bridged: ['#d9a35b', h / 2 - 3], died: ['#aaa', h - 6] };
    for (const ev of e.events) { const [col, y] = mark[ev.kind]; x.fillStyle = ev.ant === S.ant ? '#fff' : col; x.fillRect(px(ev.f) - 1, y, 2, 6); }
    x.fillStyle = '#fff'; x.fillRect(px(T()) - 1, 0, 2, h);
    const seek = ev => shell.clock.setT(Math.round((ev.offsetX - 1) / (width - 2) * (n - 1)));
    cv.onmousedown = ev => { seek(ev); cv.onmousemove = m => m.buttons && seek(m); };
  }

  // ---------------------------------------------------------------- panels
  function drawAnts() {
    const body = $('ants');
    if (body.rows.length !== A())
      body.replaceChildren(...[...Array(A()).keys()].map(i => {
        const tr = el('tr', {}, el('td'), el('td'), el('td'), el('td')); tr.dataset.ant = i; return tr;
      }));
    for (let i = 0; i < A(); i++) {
      const a = antAt(T(), i), tr = body.rows[i], [id, item, move, act] = tr.cells;
      tr.className = i === S.ant ? 'sel' : '';
      id.textContent = i;
      item.className = a.alive ? '' : 'dim';
      item.textContent = a.alive ? ITEM[a.item] : 'drowned';
      move.textContent = a.alive && a.move !== undefined ? ARROWS[a.move] : '';
      act.textContent = a.alive && a.interact !== undefined ? INTERACT[a.interact] : '';
    }
  }

  // The Window as the ant sees it: ahead is up, each cell labelled with its ring-order index.
  // `cell(j, ch)` is channel `ch` of Window cell j, in [0, 1].
  function windowCanvas(lay, cell, scale) {
    const offs = ringOffsets(lay.radius), ch = Object.fromEntries(lay.channels.map((n, j) => [n, j]));
    const [cv, x, half] = hexCanvas(lay.radius, scale);
    offs.forEach(([q, r], j) => {
      const [cx, cy] = center(q, r), X = half + cx * scale, Y = half + cy * scale, v = n => ch[n] == null ? 0 : cell(j, ch[n]);
      let col = v('wall') > .5 ? [0, 0, 0] : v('water') > .5 ? [38, 77, 190] : v('bridge') > .5 ? [150, 110, 60]
        : v('nest') > .5 ? [140, 97, 51] : [30, 36, 32];
      col = col.map((c, k) => c * (1 - 0.6 * v('pheromone_food')) + [190, 80, 220][k] * 0.6 * v('pheromone_food'));
      col = col.map((c, k) => c * (1 - 0.6 * v('pheromone_home')) + [70, 200, 220][k] * 0.6 * v('pheromone_home'));
      const food = Math.min(1, v('food'));
      col = col.map((c, k) => c * (1 - food) + [50, 230, 80][k] * food);
      x.fillStyle = `rgb(${col.map(Math.round)})`; hexPath(x, X, Y, scale * .96); x.fill();
      if (v('wall') > .5) { x.strokeStyle = '#ff4d4d55'; x.lineWidth = 1; x.stroke(); }
      if (v('plank') > .5) { x.fillStyle = '#d9a35b'; x.fillRect(X - scale * .55, Y + scale * .25, scale * 1.1, scale * .22); }
      if (v('ants') > 0) { x.strokeStyle = '#ff4d4d'; x.lineWidth = 1.5; x.beginPath(); x.arc(X, Y, scale * .6, 0, 7); x.stroke(); }
      x.fillStyle = j === 0 ? '#fff' : r === -distance(q, r) && q === 0 ? '#ffd23f' : '#cfd8e3';  // the ant, and each ring's start
      x.font = `${Math.round(scale * .6)}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(j, X, Y);
    });
    return cv;
  }

  function obsPanel(base) {
    const e = ep(), lay = e.obs_layout, N = lay.cells, C = lay.channels.length, obs = e.lab.obs;
    const cell = (j, ch) => obs[base + j * C + ch] / 255;
    const offs = ringOffsets(lay.radius), scale = 6;
    const grid = el('div', { className: 'obsgrid' });
    lay.channels.forEach((name, ch) => {
      const [cv, x, half] = hexCanvas(lay.radius, scale);
      offs.forEach(([q, r], j) => {
        const [cx, cy] = center(q, r), v = Math.round(cell(j, ch) * 255);
        x.fillStyle = `rgb(${v},${v},${Math.min(255, v + 30)})`; hexPath(x, half + cx * scale, half + cy * scale, scale * .95); x.fill();
      });
      x.strokeStyle = '#ffd23f'; x.lineWidth = 1; hexPath(x, half, half, scale * .95); x.stroke();
      grid.append(el('figure', {}, cv, el('figcaption', { textContent: name.replace('pheromone_', 'pher. ') })));
    });
    const sc = el('div', { className: 'scalars' });
    lay.scalars.forEach((name, j) => {
      const v = obs[base + N * C + j] / 255 * 2 - 1;
      sc.append(el('span', { className: 'dim', textContent: name }), el('span', { textContent: v.toFixed(2) }));
    });
    return [el('h3', { textContent: 'Window · ahead is up' }), windowCanvas(lay, cell, 15),
            el('div', { className: 'dim', style: 'font-size:11px', textContent: 'Ring order: 0 is the ant; each ring starts straight ahead and runs clockwise.' }),
            el('h3', { textContent: 'Channels' }), grid, el('h3', { textContent: 'Scalars' }), sc];
  }

  // The move distribution as the ant sees it: the six moves on the ring around it (ahead is up),
  // stay in the middle.
  function moveRosette(p, chosen) {
    const scale = 22, [cv, x, half] = hexCanvas(1, scale);
    ringOffsets(1).forEach(([q, r], j) => {
      const m = j === 0 ? STAY : j - 1, v = p(m), [cx, cy] = center(q, r), X = half + cx * scale, Y = half + cy * scale;
      x.fillStyle = `rgba(255,210,63,${v})`; hexPath(x, X, Y, scale * .94); x.fill();
      x.strokeStyle = m === chosen ? '#fff' : '#2c333d'; x.lineWidth = m === chosen ? 2 : 1; x.stroke();
      x.fillStyle = v > .5 ? '#000' : '#ccc'; x.font = '10px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(`${(v * 100).toFixed(0)}%`, X, Y);
    });
    cv.title = MOVE_NAMES.map((n, m) => `${n} ${(p(m) * 100).toFixed(0)}%`).join(' · ');
    return cv;
  }

  function policyPanel(f, i, kept = true) {
    const e = ep(), L = kept ? e.probs_layout : null, a = antAt(f, i);
    const chosen = el('div', { className: 'dim', textContent: `chose ${MOVE_NAMES[a.move]} · ${INTERACT[a.interact]} · pheromone ${pheromoneName(e, a.pheromone)}` });
    if (!L) return [el('h3', { textContent: 'Policy' }), chosen, ...(kept ? [el('div', { className: 'dim', textContent: 'No probabilities recorded for this policy.' })] : [])];
    const K = L.move + L.interact + L.pheromone, base = (f * e.lab.ants.length + labIndex(e, i)) * K, p = j => e.lab.probs[base + j] / 255;
    const bars = el('div', { className: 'bars' });
    const bar = (lbl, v, on) => el('div', {}, el('span', { className: 'lbl', textContent: lbl }),
      el('span', { className: 'b', style: `width:${v * 80}px` }), el('span', { className: 'dim', textContent: `${(v * 100).toFixed(0)}%${on ? ' ◀' : ''}` }));
    INTERACT.forEach((n, j) => bars.append(bar(n, p(L.move + j), j === a.interact)));
    for (let j = 0; j < L.pheromone; j++) bars.append(bar(pheromoneName(e, j), p(L.move + L.interact + j), j === a.pheromone));
    return [el('h3', { textContent: 'Policy · moves relative to the heading' }), chosen, el('div', { className: 'policy' }, moveRosette(p, a.move), bars)];
  }

  function drawRight() {
    const right = $('right'), e = ep(), a = antAt(T(), S.ant);
    right.innerHTML = '';
    right.append(el('h3', { textContent: `Ant ${S.ant} · ${a.alive ? ITEM[a.item] : 'drowned'} · heading ${ARROWS[a.heading]} · (${a.q}, ${a.r})` }));
    if (!a.alive) {
      const death = e.events.find(ev => ev.kind === 'died' && ev.ant === S.ant);
      right.append(el('div', { className: 'dim', textContent: `Drowned at frame ${death ? death.f : '?'}; a dead ant's observation and actions are ignored.` }));
      return;
    }
    if (T() >= e.num_steps) { right.append(el('div', { className: 'dim', textContent: 'Final frame: no action taken from here.' })); return; }
    // Observations and probabilities are kept for the Lab ants only (the cast, and any named).
    const j = labIndex(e, S.ant);
    if (j < 0 && e.lab?.ants?.length) {
      right.append(el('div', { className: 'dim', textContent: `Observations and probabilities were kept for ants ${e.lab.ants.join(', ')} only.` }));
      right.append(...policyPanel(T(), S.ant, false));
      return;
    }
    if (e.obs_layout) right.append(...obsPanel((T() * e.lab.ants.length + j) * e.obsSize));
    else right.append(el('div', { className: 'dim', textContent: 'No observations recorded.' }));
    right.append(...policyPanel(T(), S.ant));
  }

  function drawControls() {
    follow.className = S.follow ? 'on' : '';
    Object.keys(LAYERS).forEach((k, i) => { layerButtons[i].className = S.layers[k] ? 'on' : ''; });
  }

  function showEmpty() {
    $('right').innerHTML = '';
    $('status').textContent = '';
    if (!$('empty')) $('mid').prepend(el('div', { id: 'empty' }));
    $('empty').innerHTML = shell.watch.on
      ? `<p>Watching for runs; no episode yet. ${shell.watch.note}</p>`
      : `<p>No episode loaded. Drop an <code>.episode.gz</code> file here, or record one:</p>
         <p><code>python scripts/record.py --policy scripted</code></p>
         <p>and watch runs with <code>python scripts/view.py --watch runs</code>.</p>`;
    drawControls();
  }

  function draw() {
    if (!ep()) { showEmpty(); return; }
    $('empty')?.remove();
    const e = ep();
    const alive = [...Array(A()).keys()].filter(i => antAt(T(), i).alive).length;
    $('status').textContent =
      `${e.policy}${e.seed == null ? '' : ` · seed ${e.seed}`} · frame ${T()}/${F() - 1} · delivered ${e.cumDelivered[T()]}/${e.food_total} · ${alive}/${A()} alive`;
    drawControls();  // first: the map takes the height the control rows leave
    drawTimeline(drawMap());
    drawAnts(); drawRight();
  }

  function key(ev) {
    const k = ev.key;
    if (k === 'Tab') { ev.preventDefault(); S.ant = (S.ant + (ev.shiftKey ? A() - 1 : 1)) % A(); draw(); }
    else if (k === 'f') { S.follow = !S.follow; draw(); }
    else if (k >= '1' && k <= '6') { const key = Object.keys(LAYERS)[k - 1]; S.layers[key] = !S.layers[key]; draw(); }
    else return false;
    return true;
  }

  function episodeChanged(e) { S.ant = Math.min(S.ant, numAnts(e) - 1); }

  return { id: 'lab', name: 'Lab', animated: false, speed: 30, large: true, mount, unmount, draw, resize: () => ep() && draw(), key, episodeChanged };
}
