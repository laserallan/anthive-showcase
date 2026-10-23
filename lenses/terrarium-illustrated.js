// The Terrarium illustrated lens: the terrarium drawn smoothly at device resolution. Grass with soft
// tonal patches and brush strokes, sandy banks, deeper water mid-river with drifting ripples, a
// rounded nest mound, glossy berries, wooden planks and bridges with shadows, and shaded ants whose
// legs swing as they walk.
//
// Soft edges come from `softField` (a small field blurred in JS and upscaled), never `ctx.filter`.
// The ground is painted on the hexagon only, a pale shoreline runs along the water's edges, and the
// river darkens with each water cell's distance to land. Ripples and bridge boards follow each
// water cell's flow, so any river layout works.

import { WATER, ant, frame } from '../episode.js';
import { fit, point } from '../hex.js';
import { FOOD, PLANK, antAt, derive, drawRock, hash, hexPath, shoreline, softField } from './common.js';
import { terrariumStage } from './terrarium-hud.js';

const canvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });

function wood(x, X, Y, w, h) {  // a rounded board, lit along its long side
  const across = w >= h;
  const gr = across ? x.createLinearGradient(0, Y, 0, Y + h) : x.createLinearGradient(X, 0, X + w, 0);
  gr.addColorStop(0, '#eab77a'); gr.addColorStop(.5, '#c48a4e'); gr.addColorStop(1, '#8c5a2c');
  x.fillStyle = gr; x.beginPath(); x.roundRect(X, Y, w, h, Math.min(w, h) * .3); x.fill();
  x.strokeStyle = 'rgba(90,56,24,.5)'; x.lineWidth = .8; x.beginPath();
  if (across) { x.moveTo(X + w * .15, Y + h * .5); x.lineTo(X + w * .6, Y + h * .5); }
  else { x.moveTo(X + w * .5, Y + h * .15); x.lineTo(X + w * .5, Y + h * .6); }
  x.stroke();
}

function berry(x, X, Y, s) {
  const gr = x.createRadialGradient(X - s * .35, Y - s * .35, s * .1, X, Y, s);
  gr.addColorStop(0, '#ffb3a0'); gr.addColorStop(.35, '#e0453a'); gr.addColorStop(1, '#8a1d16');
  x.fillStyle = gr; x.beginPath(); x.arc(X, Y, s, 0, 7); x.fill();
}

function drawAnt(x, a, [X, Y], s, phase) {
  x.save(); x.translate(X, Y); x.globalAlpha = a.alpha;
  x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(s * .06, s * .1, s * .26, s * .36, a.ang, 0, 7); x.fill();
  x.rotate(a.ang);
  x.strokeStyle = '#24140a'; x.lineWidth = Math.max(1, s * .045); x.lineCap = 'round'; x.lineJoin = 'round';
  for (let p = 0; p < 3; p++) for (const side of [-1, 1]) {  // hip, knee, foot; a tripod gait
    const swing = a.moving ? Math.sin(phase + (p % 2 ? Math.PI : 0) + (side > 0 ? Math.PI : 0)) * .35 : 0;
    const hy = (p - 1) * s * .07, ang = (p - 1) * .7 + swing;
    const kx = side * s * .2, ky = hy + Math.sin(ang) * s * .12 - s * .04, fx = side * s * .34, fy = hy + Math.sin(ang) * s * .3;
    x.beginPath(); x.moveTo(0, hy); x.lineTo(kx, ky); x.lineTo(fx, fy); x.stroke();
  }
  x.beginPath(); x.moveTo(0, -s * .3); x.quadraticCurveTo(-s * .12, -s * .45, -s * .16, -s * .5);
  x.moveTo(0, -s * .3); x.quadraticCurveTo(s * .12, -s * .45, s * .16, -s * .5); x.lineWidth = Math.max(.8, s * .03); x.stroke();
  for (const [y, rx, ry] of [[s * .25, s * .14, s * .19], [0, s * .08, s * .11], [-s * .24, s * .1, s * .095]]) {
    const gr = x.createRadialGradient(-rx * .4, y - ry * .4, 0, 0, y, Math.max(rx, ry));
    gr.addColorStop(0, '#a8683a'); gr.addColorStop(.5, '#5a3216'); gr.addColorStop(1, '#2a160a');
    x.fillStyle = gr; x.beginPath(); x.ellipse(0, y, rx, ry, 0, 0, 7); x.fill();
  }
  if (a.item === FOOD) berry(x, 0, -s * .42, s * .1);
  if (a.item === PLANK) wood(x, -s * .34, -s * .5, s * .68, s * .11);
  x.restore();
}

export function createTerrariumIllustrated() {
  let shell, st, built = null;  // built: {e, f, cw, ch, cell, dpr, base}
  let pher = { f: -1, cv: canvas(1) };

  function build(e) {
    const geo = e.geo, dpr = devicePixelRatio || 1, room = st.room(), d = derive(e);
    const f = fit(geo.radius, room.w, room.h), cw = Math.floor(f.width), ch = Math.floor(f.height);
    const cell = f.size * Math.sqrt(3), n = geo.cells.length, P = (q, r) => point(f, q, r);  // cell: centre to centre
    st.cv.width = cw * dpr; st.cv.height = ch * dpr; st.place(cw, ch);
    const base = canvas(cw * dpr, ch * dpr), x = base.getContext('2d');
    x.scale(dpr, dpr); x.imageSmoothingEnabled = true;
    x.fillStyle = '#6e9c4a'; x.fillRect(0, 0, cw, ch);
    for (let i = 0; i < n / 3; i++) {  // large soft tone patches
      const px = hash(i, 1, 80) * cw, py = hash(i, 2, 80) * ch, rad = cell * (1 + hash(i, 3, 80) * 2.5);
      const gr = x.createRadialGradient(px, py, 0, px, py, rad), light = hash(i, 4, 80) < .5;
      gr.addColorStop(0, light ? 'rgba(160,200,100,.22)' : 'rgba(50,90,40,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    x.lineCap = 'round';
    for (let i = 0; i < n * 3; i++) {  // grass strokes
      const px = hash(i, 5, 81) * cw, py = hash(i, 6, 81) * ch, len = cell * (.12 + hash(i, 7, 81) * .14), lean = (hash(i, 8, 81) - .5) * len;
      x.strokeStyle = hash(i, 9, 81) < .5 ? 'rgba(40,78,30,.28)' : 'rgba(176,214,120,.3)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px, py - len * .6, px + lean, py - len); x.stroke();
    }
    for (let i = 0; i < n * .04; i++) {  // flowers
      const px = hash(i, 10, 82) * cw, py = hash(i, 11, 82) * ch, s = cell * .07;
      x.fillStyle = hash(i, 12, 82) < .5 ? '#f6f2e6' : '#f2c4de';
      for (let p = 0; p < 5; p++) { x.beginPath(); x.arc(px + Math.cos(p * 1.26) * s, py + Math.sin(p * 1.26) * s, s * .8, 0, 7); x.fill(); }
      x.fillStyle = '#f6c84a'; x.beginPath(); x.arc(px, py, s * .6, 0, 7); x.fill();
    }
    const wet = k => e.terrain[k] === WATER;
    // Sandy banks, then the water, then the deep middle (by distance to land) clipped to the water,
    // then a pale shoreline on the water's edges.
    x.drawImage(softField(geo, k => [205, 182, 126, wet(k) ? 255 : 0], .45, { per: 6 }), 0, 0, f.width, f.height);
    const water = softField(geo, k => [79, 155, 204, wet(k) ? 255 : 0], .12, { per: 6 });
    const river = canvas(water.width, water.height), rx = river.getContext('2d');
    rx.drawImage(water, 0, 0);
    rx.globalCompositeOperation = 'source-atop'; rx.globalAlpha = .75;
    rx.drawImage(softField(geo, k => [36, 95, 158, 255 * Math.min(1, Math.max(0, d.toLand[k] - 1) / 2)], .6, { per: 6, passes: 3 }), 0, 0);
    x.drawImage(river, 0, 0, f.width, f.height);
    x.strokeStyle = 'rgba(236,226,186,.55)'; x.lineWidth = Math.max(1, cell * .06); x.lineCap = 'round';
    shoreline(x, geo, f, wet); x.stroke();
    drawRock(x, e, f, '#857d6e');
    // The nest: a round mound over the nest disk with a dark hole in the centre cell.
    const [m, my] = P(0, 0), nr = (e.config.nest_radius + .55) * cell;
    x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = cell * .4; x.shadowOffsetY = cell * .1;
    const ng = x.createRadialGradient(m, my - nr * .3, nr * .1, m, my, nr * 1.1);
    ng.addColorStop(0, '#b58456'); ng.addColorStop(1, '#7c5432');
    x.fillStyle = ng; x.beginPath(); x.arc(m, my, nr, 0, 7); x.fill(); x.restore();
    for (let i = 0; i < 30; i++) {
      const pa = hash(i, 2, 83) * 2 * Math.PI, pr = Math.sqrt(hash(i, 3, 83)) * nr * .9;
      x.fillStyle = `rgba(${hash(i, 1, 83) < .5 ? '210,180,140' : '80,52,30'},.6)`;
      x.beginPath(); x.arc(m + Math.cos(pa) * pr, my + Math.sin(pa) * pr, cell * (.04 + hash(i, 4, 83) * .05), 0, 7); x.fill();
    }
    const hg = x.createRadialGradient(m, my - cell * .1, 0, m, my, cell * .55);
    hg.addColorStop(0, '#120a05'); hg.addColorStop(.75, '#2a1a0e'); hg.addColorStop(1, 'rgba(60,40,24,0)');
    x.fillStyle = hg; x.beginPath(); x.ellipse(m, my, cell * .6, cell * .45, 0, 0, 7); x.fill();
    // The ground only on the map: its cells, overlapping slightly so no grid shows.
    const mask = canvas(cw * dpr, ch * dpr), mx = mask.getContext('2d');
    mx.scale(dpr, dpr); mx.fillStyle = '#000';
    for (const [q, r] of geo.cells) { hexPath(mx, ...P(q, r), f.size * 1.04); mx.fill(); }
    x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0, cw, ch);
    x.globalCompositeOperation = 'source-over';
    built = { e, f, cw, ch, cell, dpr, base };
    pher.f = -1;
  }

  function draw() {
    const e = shell.episode;
    st.root.classList.toggle('empty', !e);
    if (!e) return;
    if (!built || built.e !== e) build(e);
    const { f: F, cw, ch, cell, dpr, base } = built, d = derive(e), geo = e.geo, P = (q, r) => point(F, q, r);
    const f = shell.clock.t, time = shell.clock.time, fr = frame(e, f);
    const now = performance.now() / 1000;
    const x = st.cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.drawImage(base, 0, 0, cw, ch);

    x.strokeStyle = 'rgba(230,246,255,.45)'; x.lineWidth = 1.2; x.lineCap = 'round';
    for (const [q, r] of geo.cells) {  // ripples drifting with the flow, each a little arc across it
      const k = geo.index(q, r);
      if (e.terrain[k] !== WATER || fr.bridges[k]) continue;
      const ph = (hash(q, r, 90) + now * .25) % 1, side = (hash(q, r, 91) - .5) * .6, w = cell * .12;
      const ux = Math.cos(d.flow[k]), uy = Math.sin(d.flow[k]), [X, Y] = P(q, r);
      const cx = X + ((ph - .5) * ux - side * uy) * cell, cy = Y + ((ph - .5) * uy + side * ux) * cell;
      x.globalAlpha = Math.sin(ph * Math.PI) * .8; x.beginPath();
      x.moveTo(cx - uy * w, cy + ux * w); x.quadraticCurveTo(cx + ux * cell * .08, cy + uy * cell * .08, cx + uy * w, cy - ux * w);
      x.stroke();
    }
    x.globalAlpha = 1;

    if (pher.f !== f) {  // the pheromone glow changes once per frame, not per animation frame
      softField(geo, k => {
        const pf = fr.pheromone_food[k], ph = fr.pheromone_home[k];
        return pf >= ph ? [255, 140, 205, pf * .55] : [150, 215, 255, ph * .55];
      }, .3, { per: 3, out: pher.cv });
      pher.f = f;
    }
    x.imageSmoothingEnabled = true; x.drawImage(pher.cv, 0, 0, F.width, F.height);

    for (const [q, r] of geo.cells) if (fr.bridges[geo.index(q, r)]) {  // bridge shadows first, then the boards
      const [X, Y] = P(q, r); x.fillStyle = 'rgba(0,20,50,.35)'; hexPath(x, X, Y + cell * .12, F.size); x.fill();
    }
    for (const [q, r] of geo.cells) {
      const k = geo.index(q, r), [X, Y] = P(q, r);
      if (fr.bridges[k]) {  // three boards along the flow, across the walking direction, each spanning the cell
        x.save(); x.translate(X, Y); x.rotate(d.flow[k]);
        for (let b = -1; b <= 1; b++) wood(x, -cell * .58, b * cell / 3 - cell / 6 + cell * .025, cell * 1.16, cell / 3 - cell * .05);
        x.restore();
      }
      if (fr.planks[k]) {
        x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = cell * .15; x.shadowOffsetY = cell * .06;
        wood(x, X - cell * .36, Y - cell * .1, cell * .72, cell * .2); x.restore();
      }
      const nf = Math.min(5, Math.ceil(fr.food[k] / e.config.food_per_cell * 5));
      for (let j = 0; j < nf; j++) {
        const bx = X + cell * (hash(k, j, 3) - .5) * .56, by = Y + cell * (hash(k, j, 4) - .5) * .56;
        x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.ellipse(bx + cell * .02, by + cell * .08, cell * .1, cell * .05, 0, 0, 7); x.fill();
        berry(x, bx, by, cell * .11);
        x.fillStyle = '#4f8a36'; x.beginPath(); x.ellipse(bx + cell * .05, by - cell * .1, cell * .06, cell * .03, -.6, 0, 7); x.fill();
      }
    }

    for (let i = 0; i < e.config.num_ants; i++) {
      const a = antAt(e, time, i);
      if (!a.dead) drawAnt(x, a, P(a.q, a.r), Math.max(cell * 1.05, 9), now * 14 + i);
    }
    for (const ev of e.events) if (ev.kind === 'died' && time >= ev.f && time < ev.f + 8) {  // ripples where an ant drowned
      const p = ant(e, ev.f, ev.ant), k = (time - ev.f) / 8;
      x.strokeStyle = `rgba(230,246,255,${1 - k})`; x.lineWidth = 1.5;
      for (const s of [1, .6]) { x.beginPath(); x.ellipse(...P(p.q, p.r), cell * (.2 + k) * s, cell * (.12 + k * .6) * s, 0, 0, 7); x.stroke(); }
    }
    st.hud();
  }

  return {
    id: 'terrarium-illustrated', name: 'Terrarium illustrated', animated: true, speed: 5,
    mount(stage, sh) { shell = sh; st = terrariumStage(stage, sh); st.cv.style.imageRendering = 'auto'; built = null; },
    unmount() { st.root.remove(); built = null; },
    draw, resize() { built = null; }, key: () => false, episodeChanged() { built = null; },
  };
}
