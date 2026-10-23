// The stage the terrarium lenses share: a centred map canvas (taller than wide on the hex map) on a dark green ground, a pixel-font
// score box, and a bottom bar with the event ribbon and the step, above the shell's dock.

import { numFrames } from '../episode.js';
import { derive, dockSpace, style } from './common.js';

const BAR = 56;  // the bottom bar and its gap

style('terrarium-css', `
  .terr { position:absolute; inset:0; background:#24331c; }
  .terr canvas.map { position:absolute; image-rendering:pixelated; }
  .terr .hud { position:absolute; font:12px 'Press Start 2P', monospace; color:#fff6d5; text-shadow:2px 2px 0 #000; }
  .terr .hud.top { top:16px; left:16px; display:grid; gap:10px; background:#0009; padding:12px 14px; border:3px solid #fff6d5; }
  .terr .hud.top .big { font-size:20px; color:#ffcf4a; }
  .terr .hud.bottom { left:50%; transform:translateX(-50%); bottom:calc(var(--dock) + 4px); display:flex; gap:12px; align-items:center;
    background:#0009; padding:8px 12px; border:3px solid #fff6d5; max-width:calc(100% - 16px); }
  .terr canvas.ribbon { image-rendering:pixelated; cursor:pointer; width:520px; height:24px; min-width:0; flex:1 1 auto; }
  .terr.empty .hud, .terr.empty canvas.map { display:none; }
  @media (max-width: 1100px) { .terr canvas.ribbon { width:260px; } }
`);

export function terrariumStage(stage, shell) {
  const root = document.createElement('div');
  root.className = 'terr';
  root.innerHTML = `<canvas class="map"></canvas>
    <div class="hud top"><div>FOOD HOME</div><div class="big" data-k="delivered"></div>
      <div data-k="bridges"></div><div data-k="ants"></div></div>
    <div class="hud bottom"><canvas class="ribbon" width="260" height="12"></canvas><span data-k="step"></span></div>`;
  const $ = k => root.querySelector(`[data-k="${k}"]`);
  const cv = root.querySelector('canvas.map'), ribbon = root.querySelector('.ribbon');
  ribbon.onclick = ev => { const e = shell.episode; if (e) shell.clock.setT(Math.round(ev.offsetX / ribbon.clientWidth * (numFrames(e) - 1))); };
  stage.append(root);

  // The space the map gets: the stage above the bottom bar and the dock's band.
  const area = () => ({ w: root.clientWidth, h: root.clientHeight - dockSpace() - BAR });
  // The space for the map itself, with a margin; and the largest square map that fits.
  const room = () => { const a = area(); return { w: a.w - 40, h: a.h - 20 }; };
  const avail = () => { const r = room(); return Math.min(r.w, r.h); };
  // Centre the map, `w`×`h` CSS pixels, in that space, on whole device pixels.
  function place(w, h) {
    const a = area(), dpr = devicePixelRatio || 1, snap = v => Math.round(v * dpr) / dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.style.left = snap((a.w - w) / 2) + 'px'; cv.style.top = snap(Math.max(0, (a.h - h) / 2)) + 'px';
  }

  function hud() {
    const e = shell.episode, f = shell.clock.t, d = derive(e), T = e.num_steps;
    $('delivered').textContent = `${e.cumDelivered[f]}/${e.food_total}`;
    $('bridges').textContent = `BRIDGES ${d.bridges[f]}`;
    $('ants').textContent = `ANTS ${d.alive[f]}/${e.config.num_ants}`;
    $('step').textContent = `${String(f).padStart(3, '0')}/${T}`;
    const rx = ribbon.getContext('2d'), W = ribbon.width;
    rx.fillStyle = '#3a2a1a'; rx.fillRect(0, 0, W, 12);
    rx.fillStyle = '#6a8a3a'; rx.fillRect(0, 0, f / T * W, 12);
    const col = { delivered: '#ffcf4a', bridged: '#d8a35a', died: '#9ad0ff' }, row = { delivered: 0, bridged: 4, died: 8 };
    for (const ev of e.events) { rx.fillStyle = col[ev.kind]; rx.fillRect(Math.floor(ev.f / T * (W - 1)), row[ev.kind], 1, 4); }
    rx.fillStyle = '#fff'; rx.fillRect(Math.floor(f / T * (W - 1)), 0, 1, 12);
  }

  return { root, cv, room, avail, place, hud };
}
