// The Field notes lens: an editorial page, ink on paper. The map is a figure with a caption that
// writes itself from the episode's story; beside it, big numbers and a running list of notes;
// under it, the deliveries curve with the bridges and drownings marked. Click the curve to seek.

import { WATER, ant, frame, numFrames } from '../episode.js';
import { fit, point } from '../hex.js';
import { FOOD, PLANK, antAt, cellEdges, derive, drawRock, story, hash, hexPath, shoreline, softField, style } from './common.js';

style('field-notes-css', `
  .fn { position:absolute; inset:0; background:#f3eee2; color:#2a2620; font-family:'Source Serif 4', Georgia, serif;
    display:grid; grid-template-columns:minmax(0, 1fr) 340px; grid-template-rows:auto minmax(0, 1fr);
    gap:0 36px; padding:24px 40px calc(var(--dock) + 8px); }
  .fn header { grid-column:1 / 3; display:flex; justify-content:space-between; align-items:flex-end; gap:20px;
    border-bottom:1px solid #2a262044; padding:0 150px 10px 0; margin-bottom:16px; }  /* clear of the menu button */
  .fn h1 { font-weight:600; font-size:26px; margin:0; }
  .fn header p { margin:4px 0 0; font-style:italic; color:#6b6253; }
  .fn figure { margin:0; display:flex; flex-direction:column; align-items:center; min-height:0; }
  .fn canvas.map { display:block; image-rendering:auto; }
  .fn canvas.tl { display:block; cursor:pointer; margin-top:6px; }
  .fn figcaption { font-size:14px; color:#4b4436; margin-top:8px; line-height:1.4; }
  .fn aside { display:flex; flex-direction:column; min-height:0; }
  .fn .stats { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; margin-bottom:18px; }
  .fn .stats .n { font-size:40px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
  .fn .stats .l { font:500 11px Inter, sans-serif; color:#6b6253; text-transform:uppercase; letter-spacing:.08em; }
  .fn .notes { list-style:none; margin:0; padding:0; overflow:auto; flex:1; border-top:1px solid #2a262033; }
  .fn .notes li { padding:8px 4px; border-bottom:1px solid #2a262022; font-size:15px; line-height:1.35; }
  .fn .notes li.now { background:#fffaf0; }
  .fn .notes .s { font:500 11px Inter, sans-serif; color:#9a8f7c; display:block; }
  .fn .notes .empty { color:#9a8f7c; font-style:italic; }
  .fn.empty figure, .fn.empty aside { visibility:hidden; }
`);

const TL = 46;  // timeline height, CSS px

function text(ev) {
  const who = `<b>Ant ${ev.ant + 1}</b>`;
  switch (ev.kind) {
    case 'bridged': return ev.nth === 1 ? `${who} drops a plank into the river: the first bridge.` : `${who} lays bridge number ${ev.nth}.`;
    case 'crossing': return `${who} is the first to walk out onto a bridge.`;
    case 'first': return 'The first food reaches the nest.';
    case 'milestone': return ev.frac === 1 ? 'All the food is home.' : `${ev.frac * 100}% of the food is home.`;
    case 'died': return `${who} wanders into the water and drowns.`;
  }
}

function inkAnt(x, a, [X, Y], s) {
  x.save(); x.translate(X, Y); x.rotate(a.ang); x.globalAlpha = a.alpha;
  x.strokeStyle = '#1d1a16'; x.lineWidth = Math.max(.8, s * .06);
  for (const sy of [-.05, .1, .25]) for (const sx of [-1, 1]) {
    x.beginPath(); x.moveTo(0, sy * s); x.lineTo(sx * s * .32, sy * s + .12 * s * (sy > .05 ? 1 : -1)); x.stroke();
  }
  x.fillStyle = '#1d1a16';
  for (const [y, rx, ry] of [[-.3, .1, .1], [.03, .09, .13], [.3, .13, .18]]) { x.beginPath(); x.ellipse(0, y * s, rx * s, ry * s, 0, 0, 7); x.fill(); }
  if (a.item === FOOD) { x.fillStyle = '#5d8a3a'; x.beginPath(); x.arc(0, -.48 * s, .1 * s, 0, 7); x.fill(); }
  if (a.item === PLANK) { x.fillStyle = '#9a6a3a'; x.fillRect(-.35 * s, -.55 * s, .7 * s, .1 * s); }
  x.restore();
}

export function createFieldNotes() {
  let shell, root, cv, tl, built = null, shown = -1, pher = { f: -1, cv: document.createElement('canvas') };
  const $ = k => root.querySelector(`[data-k="${k}"]`);

  function mount(stage, sh) {
    shell = sh;
    root = document.createElement('div'); root.className = 'fn';
    root.innerHTML = `
      <header><div><h1 data-k="title"></h1><p data-k="sub"></p></div></header>
      <figure><canvas class="map"></canvas><canvas class="tl"></canvas><figcaption data-k="cap"></figcaption></figure>
      <aside>
        <div class="stats">
          <div><div class="n" data-k="delivered"></div><div class="l">food home</div></div>
          <div><div class="n" data-k="bridges"></div><div class="l">bridges</div></div>
          <div><div class="n" data-k="ants"></div><div class="l">ants alive</div></div>
          <div><div class="n" data-k="step"></div><div class="l">step</div></div>
        </div>
        <ul class="notes"></ul>
      </aside>`;
    cv = root.querySelector('canvas.map'); tl = root.querySelector('canvas.tl');
    tl.onclick = ev => { const e = shell.episode; if (e && built) shell.clock.setT(Math.round(ev.offsetX / built.cw * (numFrames(e) - 1))); };
    stage.append(root);
    built = null; shown = -1;
  }

  function build(e) {
    const geo = e.geo, dpr = devicePixelRatio || 1, fig = root.querySelector('figure');
    const f = fit(geo.radius, Math.max(200, fig.clientWidth), Math.max(200, fig.clientHeight - TL - 60));
    const cw = Math.floor(f.width), ch = Math.floor(f.height), cell = f.size * Math.sqrt(3);  // cell: centre to centre
    cv.width = cw * dpr; cv.height = ch * dpr; cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    tl.width = cw * dpr; tl.height = TL * dpr; tl.style.width = cw + 'px'; tl.style.height = TL + 'px';
    const base = document.createElement('canvas'); base.width = cw * dpr; base.height = ch * dpr;
    const x = base.getContext('2d'); x.scale(dpr, dpr); x.imageSmoothingEnabled = true;
    x.fillStyle = '#efe8d8';  // the paper of the map, on its cells only
    for (const [q, r] of geo.cells) { hexPath(x, ...point(f, q, r), f.size * 1.04); x.fill(); }
    x.globalCompositeOperation = 'source-atop';  // speckle and watercolour stay on that paper
    for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(90,70,40,${hash(i, 9) * .06})`; x.fillRect(hash(i, 1) * cw, hash(i, 2) * ch, 1.5, 1.5); }
    const wet = k => e.terrain[k] === WATER;
    x.drawImage(softField(geo, k => [92, 140, 190, wet(k) ? 255 : 0], .35, { per: 6 }), 0, 0, f.width, f.height);  // watercolour bleed
    x.globalAlpha = .5; x.drawImage(softField(geo, k => [92, 140, 190, wet(k) ? 255 : 0], .08, { per: 6 }), 0, 0, f.width, f.height); x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.lineCap = 'round';
    x.strokeStyle = 'rgba(60,96,140,.55)'; x.lineWidth = 1; shoreline(x, geo, f, wet); x.stroke();  // the banks, inked
    drawRock(x, e, f, '#8c8476');
    x.strokeStyle = '#2a262088'; x.lineWidth = 1; cellEdges(x, geo, f, (k, n) => n < 0); x.stroke();  // the map's border
    const [m, my] = point(f, 0, 0), nr = (e.config.nest_radius + .5) * cell;  // the nest: a hatched disk
    x.strokeStyle = '#7a5a36'; x.lineWidth = 1;
    x.save(); x.beginPath(); x.arc(m, my, nr, 0, 7); x.clip();
    for (let dd = -2 * nr; dd < 2 * nr; dd += 5) { x.beginPath(); x.moveTo(m - nr + dd, my - nr); x.lineTo(m + nr + dd, my + nr); x.stroke(); }
    x.restore();
    x.beginPath(); x.arc(m, my, nr, 0, 7); x.stroke();
    x.font = 'italic 13px "Source Serif 4", Georgia, serif'; x.fillStyle = '#5a4a36'; x.fillText('nest', m + nr * .75, my - nr * .75);
    built = { e, f, cw, ch, cell, dpr, base };
    pher.f = -1;
  }

  function drawMap(e, t, time) {
    const { f: F, cw, ch, cell, dpr, base } = built, d = derive(e), geo = e.geo, fr = frame(e, t);
    const P = (q, r) => point(F, q, r);
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, cw, ch); x.drawImage(base, 0, 0, cw, ch);
    if (pher.f !== t) {  // pheromones as a faint wash
      softField(geo, k => {
        const pf = fr.pheromone_food[k], ph = fr.pheromone_home[k];
        return pf >= ph ? [196, 140, 60, pf * .7] : [90, 110, 160, ph * .7];
      }, .25, { per: 3, out: pher.cv });
      pher.f = t;
    }
    x.save(); x.globalCompositeOperation = 'multiply'; x.imageSmoothingEnabled = true; x.drawImage(pher.cv, 0, 0, F.width, F.height); x.restore();
    for (const [q, r] of geo.cells) {
      const k = geo.index(q, r), [X, Y] = P(q, r);
      if (fr.bridges[k]) {  // four inked boards along the flow, across the walking direction
        x.save(); x.translate(X, Y); x.rotate(d.flow[k]);
        x.strokeStyle = '#6b4a2a'; x.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) {
          const a = ((i + .5) / 4 - .5) * cell, wob = (hash(k, i) - .5) * 1.5;
          x.beginPath(); x.moveTo(-cell * .5, a); x.lineTo(cell * .5, a + wob); x.stroke();
        }
        x.restore();
      }
      if (fr.planks[k]) { x.strokeStyle = '#6b4a2a'; x.lineWidth = 1; x.strokeRect(X - cell * .35, Y - cell * .1, cell * .7, cell * .2); }
      const food = fr.food[k];
      if (food) {
        x.fillStyle = '#4f6b2a';
        const n = Math.min(6, Math.ceil(food / e.config.food_per_cell * 6));
        for (let j = 0; j < n; j++) { x.beginPath(); x.arc(X + cell * (hash(k, j, 3) - .5) * .6, Y + cell * (hash(k, j, 4) - .5) * .6, cell * .07, 0, 7); x.fill(); }
      }
    }
    const A = e.config.num_ants;
    x.strokeStyle = 'rgba(40,30,20,.18)'; x.lineWidth = 1.5;
    for (let i = 0; i < A; i++) {  // ink trails: where each ant was over the last 12 steps
      x.beginPath(); let on = false;
      for (let s = Math.max(0, time - 12); s <= time; s += .5) {
        const a = antAt(e, s, i); if (a.dead) { on = false; continue; }
        on ? x.lineTo(...P(a.q, a.r)) : x.moveTo(...P(a.q, a.r)); on = true;
      }
      x.stroke();
    }
    for (let i = 0; i < A; i++) {
      const a = antAt(e, time, i);
      if (!a.dead) { inkAnt(x, a, P(a.q, a.r), Math.max(cell * 1.1, 8)); continue; }
      const p = ant(e, t, i), dd = cell * .2, [cx, cy] = P(p.q, p.r);  // where it drowned
      x.strokeStyle = '#a33'; x.lineWidth = 1.5; x.beginPath();
      x.moveTo(cx - dd, cy - dd); x.lineTo(cx + dd, cy + dd); x.moveTo(cx + dd, cy - dd); x.lineTo(cx - dd, cy + dd); x.stroke();
    }
  }

  function drawTimeline(e, t, time) {
    const { cw: size, dpr } = built, T = e.num_steps, x = tl.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, size, TL);
    const px = s => s / T * size;
    x.strokeStyle = '#2a262055'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, 40); x.lineTo(size, 40); x.stroke();
    x.strokeStyle = '#4f6b2a'; x.lineWidth = 1.5; x.beginPath();
    for (let s = 0; s <= T; s++) { const y = 40 - e.cumDelivered[s] / Math.max(1, e.food_total) * 32; s ? x.lineTo(px(s), y) : x.moveTo(px(s), y); }
    x.stroke();
    for (const ev of story(e)) {
      if (ev.kind !== 'bridged' && ev.kind !== 'died') continue;
      x.fillStyle = ev.kind === 'bridged' ? '#6b4a2a' : '#a33';
      x.beginPath(); x.moveTo(px(ev.f), 41); x.lineTo(px(ev.f) - 3, 46); x.lineTo(px(ev.f) + 3, 46); x.fill();
    }
    x.fillStyle = '#2a2620'; x.fillRect(px(time) - .75, 2, 1.5, 38);
  }

  function drawAside(e, t) {
    const d = derive(e);
    $('delivered').textContent = e.cumDelivered[t]; $('bridges').textContent = d.bridges[t];
    $('ants').textContent = d.alive[t]; $('step').textContent = t;
    const seen = story(e).filter(ev => ev.f <= t);
    if (seen.length === shown) return;  // rebuilt only when a note appears or (seeking back) disappears
    shown = seen.length;
    root.querySelector('.notes').innerHTML = seen.length
      ? seen.slice().reverse().map((ev, j) => `<li class="${j === 0 ? 'now' : ''}"><span class="s">step ${ev.f}</span>${text(ev)}</li>`).join('')
      : '<li class="empty">Nothing has happened yet.</li>';
    const latest = seen[seen.length - 1], river = e.river_width > 0;
    $('cap').innerHTML = '<b>Fig. 1.</b> ' + (latest ? `Step ${latest.f}: ${text(latest)}`
      : river ? 'The colony at the start. Food lies beyond the river; planks wait on the near bank.' : 'The colony at the start, with food scattered around the nest.');
  }

  function draw() {
    const e = shell.episode;
    root.classList.toggle('empty', !e);
    if (!e) { $('title').textContent = 'Field notes'; $('sub').textContent = 'No episode open.'; return; }
    if (!built || built.e !== e) {
      build(e); shown = -1;
      $('title').textContent = e.river_width > 0 ? 'An ant colony learns to bridge a river' : 'An ant colony forages';
      $('sub').textContent = `${e.policy}: a hex map of radius ${e.geo.radius}, ${e.config.num_ants} ants, ${e.num_steps} steps.`;
    }
    const t = shell.clock.t, time = shell.clock.time;
    drawMap(e, t, time); drawTimeline(e, t, time); drawAside(e, t);
  }

  return {
    id: 'field-notes', name: 'Field notes', animated: true, speed: 5, large: true,
    mount, unmount() { root.remove(); built = null; }, draw,
    resize() { built = null; }, key: () => false, episodeChanged() { built = null; },
  };
}
