// The Night colony lens: cinematic, dark and glowing. A deep shimmering river, pheromones as
// additive glows, gold bridges, ants as comets coloured by what they carry, and pulses of light for
// deliveries, bridges, the first crossing and drownings. A title card fades out, a ticker shows
// recent moments, a restart button appears on hover, and playback starts by itself and loops.
//
// Glows are `softField`s (blurred in JS, upscaled) drawn with additive blending; no `ctx.filter`.

import { WATER, ant, frame, numFrames } from '../episode.js';
import { fit, point } from '../hex.js';
import { antAt, derive, dockSpace, drawRock, hexPath, story, softField, style } from './common.js';

style('night-colony-css', `
  .nc { position:absolute; inset:0; background:#000; font-family:Inter, system-ui, sans-serif; font-weight:300; }
  .nc canvas.map { position:absolute; }
  .nc .title { position:absolute; inset:0; display:grid; place-items:center; pointer-events:none; text-align:center; transition:opacity 1.2s; }
  .nc .title h1 { font-weight:300; font-size:44px; letter-spacing:.04em; margin:0; color:#fff; }
  .nc .title p { color:#8fb7d6; letter-spacing:.3em; text-transform:uppercase; font-size:12px; }
  .nc .line { position:absolute; bottom:calc(var(--dock) + 4px); left:0; right:0; text-align:center; color:#9db2c4; letter-spacing:.12em; font-size:13px; }
  .nc .ticker { position:absolute; left:28px; bottom:calc(var(--dock) + 46px); color:#cfe3f2; font-size:13px; line-height:1.7; }
  .nc .ctl { position:absolute; top:20px; left:24px; opacity:0; transition:opacity .3s; }
  .nc:hover .ctl { opacity:1; }
  .nc .ctl button { all:unset; cursor:pointer; color:#cfe3f2; border:1px solid #cfe3f455; padding:4px 12px; border-radius:999px; font-size:13px; }
  .nc.empty canvas.map, .nc.empty .line, .nc.empty .ticker { display:none; }
`);

const ITEM_COLOUR = ['#bfe6ff', '#ffb347', '#ffe08a'];  // empty, food, plank
const PULSE = { delivered: [255, 200, 120], bridged: [255, 230, 150], died: [120, 170, 255], crossing: [255, 255, 255] };
const TICKER = { bridged: 'a plank becomes a bridge', crossing: 'the first ant crosses', died: 'an ant drowns', first: 'first food home' };

export function createNightColony() {
  let shell, root, cv, built = null, pher = { f: -1, cv: document.createElement('canvas') }, shimmer = document.createElement('canvas');
  let started = 0, wasPlaying = false, autoplayFor = null;
  const $ = k => root.querySelector(`[data-k="${k}"]`);

  function mount(stage, sh) {
    shell = sh;
    root = document.createElement('div'); root.className = 'nc';
    root.innerHTML = `<canvas class="map"></canvas>
      <div class="title"><div><h1 data-k="title"></h1><p>no instructions, only rewards</p></div></div>
      <div class="ticker"></div><div class="line" data-k="line"></div>
      <div class="ctl"><button data-k="restart">restart</button></div>`;
    cv = root.querySelector('canvas.map');
    $('restart').onclick = () => { shell.clock.setT(0); if (!shell.clock.playing) shell.clock.toggle(); started = performance.now(); };
    stage.append(root);
    built = null; started = performance.now(); autoplayFor = null;
  }

  function build(e) {
    const geo = e.geo, dpr = devicePixelRatio || 1;
    const W = root.clientWidth, H = root.clientHeight - dockSpace();
    const f = fit(geo.radius, W * .86, (H - 60) * .86), cw = Math.floor(f.width), ch = Math.floor(f.height);
    const cell = f.size * Math.sqrt(3);  // centre to centre
    cv.width = cw * dpr; cv.height = ch * dpr; cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    cv.style.left = (W - cw) / 2 + 'px'; cv.style.top = Math.max(0, (H - ch) / 2 - 24) + 'px';
    const base = document.createElement('canvas'); base.width = cw * dpr; base.height = ch * dpr;
    const x = base.getContext('2d'); x.scale(dpr, dpr); x.imageSmoothingEnabled = true;
    x.fillStyle = '#05070a';  // the ground, only on the map: the hexagon shows against the black
    for (const [q, r] of geo.cells) { hexPath(x, ...point(f, q, r), f.size * 1.04); x.fill(); }
    x.fillStyle = '#1a2230';
    for (const [q, r] of geo.cells) { const [cx, cy] = point(f, q, r); x.fillRect(cx - .6, cy - .6, 1.2, 1.2); }
    x.drawImage(softField(geo, k => [14, 40, 90, e.terrain[k] === WATER ? 255 : 0], .45, { per: 8 }), 0, 0, f.width, f.height);
    drawRock(x, e, f, '#1f232b');
    built = { e, f, cw, ch, cell, dpr, base };
    pher.f = -1;
  }

  function draw() {
    const e = shell.episode, clock = shell.clock;
    root.classList.toggle('empty', !e);
    if (!e) { $('title').textContent = 'Night colony'; return; }
    if (!built || built.e !== e) {
      build(e);
      $('title').textContent = e.river_width > 0 ? `${e.config.num_ants} ants. One river.` : `${e.config.num_ants} ants. One nest.`;
    }
    if (autoplayFor !== e) {  // start by itself, once per episode
      autoplayFor = e; started = performance.now();
      if (!clock.playing && shell.autoplay) clock.toggle();  // from where the clock is: switching lens keeps the time
    }
    if (wasPlaying && !clock.playing && clock.t >= numFrames(e) - 1) { clock.setT(0); clock.toggle(); started = performance.now(); }  // loop
    wasPlaying = clock.playing;

    const { f: F, cw, ch, cell, dpr, base } = built, geo = e.geo, f = clock.t, time = clock.time, fr = frame(e, f);
    const P = (q, r) => point(F, q, r), now = performance.now() / 1000, d = derive(e);
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.drawImage(base, 0, 0, cw, ch);

    // The river's shimmer: a per-cell brightness, waves running along the flow, upscaled smoothly.
    softField(geo, k => {
      if (e.terrain[k] !== WATER) return [0, 0, 0, 0];
      const q = k % geo.size - geo.radius, r = Math.floor(k / geo.size) - geo.radius, [cx, cy] = P(q, r);
      const along = (cx * Math.cos(d.flow[k]) + cy * Math.sin(d.flow[k])) / cell, s = .5 + .5 * Math.sin(now * 1.3 + along * .7 + (q - r) * .2);
      return [10 + 20 * s, 40 + 40 * s, 90 + 70 * s, 90 + 80 * s];
    }, .4, { per: 4, out: shimmer });
    x.globalCompositeOperation = 'lighter'; x.imageSmoothingEnabled = true;
    x.drawImage(shimmer, 0, 0, F.width, F.height);

    if (pher.f !== f) {  // pheromones: an additive glow, recomputed once per frame
      softField(geo, k => {
        const pf = fr.pheromone_food[k] / 255, ph = fr.pheromone_home[k] / 255;
        return [255 * pf * .9 + 40 * ph, 90 * pf + 200 * ph, 120 * pf + 255 * ph, 255 * Math.min(1, pf + ph) * .55];
      }, .6, { per: 3, passes: 3, out: pher.cv });
      pher.f = f;
    }
    x.drawImage(pher.cv, 0, 0, F.width, F.height);

    const [mx, my] = P(0, 0);  // a warm ring around the nest, a disk about the centre cell
    const ng = x.createRadialGradient(mx, my, 0, mx, my, (2 * e.config.nest_radius + 1) * cell * .8);
    ng.addColorStop(0, 'rgba(255,200,120,.25)'); ng.addColorStop(1, 'rgba(255,200,120,0)');
    x.fillStyle = ng; x.fillRect(0, 0, cw, ch);

    for (const [q, r] of geo.cells) {
      const k = geo.index(q, r), [cx, cy] = P(q, r);
      if (fr.bridges[k]) {
        x.shadowColor = '#ffcc66'; x.shadowBlur = cell * .8; x.fillStyle = '#ffd98a';
        hexPath(x, cx, cy, F.size * .8); x.fill(); x.shadowBlur = 0;
      }
      if (fr.planks[k]) {
        x.save(); x.translate(cx, cy); x.rotate(e.terrain[k] === WATER ? d.flow[k] : 0);
        x.fillStyle = 'rgba(255,224,138,.6)'; x.fillRect(-cell * .3, -cell * .08, cell * .6, cell * .16); x.restore();
      }
      const food = fr.food[k];
      if (food) {
        const rad = cell * (.25 + .35 * Math.min(1, food / e.config.food_per_cell));
        const fg = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        fg.addColorStop(0, 'rgba(140,255,170,.9)'); fg.addColorStop(1, 'rgba(140,255,170,0)');
        x.fillStyle = fg; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    }

    x.lineCap = 'round';
    for (let i = 0; i < e.config.num_ants; i++) {  // comets: a fading tail over the last step and a half
      const a = antAt(e, time, i); if (a.dead) continue;
      const col = ITEM_COLOUR[a.item];
      x.strokeStyle = col;
      for (let s = 1; s <= 8; s++) {
        const p0 = antAt(e, Math.max(0, time - (s - 1) * .2), i), p1 = antAt(e, Math.max(0, time - s * .2), i);
        if (p1.dead) break;
        x.globalAlpha = a.alpha * (1 - s / 9) * .7; x.lineWidth = Math.max(1, cell * .3 * (1 - s / 10));
        x.beginPath(); x.moveTo(...P(p0.q, p0.r)); x.lineTo(...P(p1.q, p1.r)); x.stroke();
      }
      x.globalAlpha = a.alpha;
      const [ax, ay] = P(a.q, a.r), R = Math.max(cell * .7, 5), hg = x.createRadialGradient(ax, ay, 0, ax, ay, R);
      hg.addColorStop(0, col); hg.addColorStop(.3, col + 'aa'); hg.addColorStop(1, col + '00');
      x.fillStyle = hg; x.fillRect(ax - R, ay - R, R * 2, R * 2);
    }
    x.globalAlpha = 1;

    const pulses = story(e).filter(ev => PULSE[ev.kind] && time >= ev.f && time < ev.f + 10);
    for (const ev of e.events) if (ev.kind === 'delivered' && time >= ev.f && time < ev.f + 10) {
      const p = ant(e, ev.f, ev.ant); pulses.push({ ...ev, q: p.q, r: p.r });
    }
    x.lineWidth = 2;
    for (const ev of pulses) {
      const k = (time - ev.f) / 10, wide = ev.kind === 'bridged' || ev.kind === 'crossing';
      x.strokeStyle = `rgba(${PULSE[ev.kind]},${(1 - k) * .9})`;
      x.beginPath(); x.arc(...P(ev.q, ev.r), cell * (.4 + k * (wide ? 4 : 1.6)), 0, 7); x.stroke();
    }
    x.globalCompositeOperation = 'source-over';

    root.querySelector('.title').style.opacity = performance.now() - started < 3000 && f < 25 ? 1 : 0;
    $('line').textContent = `${e.cumDelivered[f]} of ${e.food_total} food home   ·   ${d.bridges[f]} bridge${d.bridges[f] === 1 ? '' : 's'}   ·   step ${f}`;
    root.querySelector('.ticker').innerHTML = story(e)
      .filter(ev => TICKER[ev.kind] && ev.f <= f && ev.f > f - 60).slice(-4)
      .map(ev => `<div style="opacity:${1 - (f - ev.f) / 60}">${TICKER[ev.kind]}</div>`).join('');
  }

  return {
    id: 'night-colony', name: 'Night colony', animated: true, speed: 10,
    mount, unmount() { root.remove(); built = null; }, draw,
    resize() { built = null; }, key: () => false, episodeChanged() { built = null; },
  };
}
