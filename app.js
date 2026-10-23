// The viewer shell. It owns everything the lenses share: the runs and their episodes (from a
// source), the open episode, the playback clock, the run/episode picker, live-follow, file drop
// and the playback keys. A lens draws the episode; the shell switches between lenses (`?lens=<id>`,
// default Lab) and keeps the playback time across a switch.
//
// The source is chosen at startup: a published site if `manifest.json` sits beside the page (its
// entries are the runs, in order), else the live server (`view.py`, with `?watch=1`). Links are
// the same in both: `?run=<run>&ep=<episode name>&t=<step>&lens=<lens id>`. The address follows
// what is open; `t` is in it only while paused, and a link with `t` opens paused there. A link to
// a run or episode that isn't there opens the default (a site's first entry's first episode, the
// newest run's latest episode live), with a notice.
//
// The shell's controls look and sit the same in every lens: a ☰ menu button top right opens the
// lens / run / episode dropdowns and live-follow (a popover, or a bottom sheet on a phone), and the
// playback dock at the bottom holds play/step/speed. While playing, the dock hides after a moment
// without pointer, touch or key activity; in Lab it stays and the stage ends above it.
//
// On a small screen (narrower than 900px or shorter than 500px, checked live) lenses marked `large`
// are left out of the lens list. A link to one opens the first lens that is left, with a short
// notice, and keeps `lens=` in the address, so the requested lens opens once the screen is big
// enough. A click or tap on a lens's `canvas.map` plays or pauses.
//
// A lens is `{id, name, animated, speed, large?, mount(stage, shell), unmount(), draw(), resize(),
// key(ev), episodeChanged(ep)}`. It owns its whole stage (`#stage`) and sizes itself from it, never from the
// window. It keeps clear of the menu button (top right, about 50px) and keeps its own content above
// the dock's band at the bottom (the `--dock` CSS variable; `dockSpace()` in lenses/common.js), which
// the dock covers only while shown. `draw()` redraws at `shell.clock.t` (whole frames) or
// `shell.clock.time` (smoothed); an `animated` lens is drawn on every animation frame, others on
// every change. `speed` (steps/s) is set when the lens is switched to. `key` returns true when it
// handled the key.
//
// Keys: space play/pause · , . step · Home End · [ ] speed · ← → lens · s smoothing; the lens adds
// its own.

import { numFrames } from './episode.js';
import { liveSource, findSource, fetchEpisode, readEpisodeFile } from './sources.js';
import { createClock } from './clock.js';
import { el, button } from './dom.js';
import { createLab } from './lenses/lab.js';
import { createTerrariumPixel } from './lenses/terrarium-pixel.js';
import { createTerrariumIllustrated } from './lenses/terrarium-illustrated.js';
import { createFieldNotes } from './lenses/field-notes.js';
import { createNightColony } from './lenses/night-colony.js';
import { loadFonts } from './fonts.js';

let source = liveSource;  // until findSource() answers
const S = {
  runs: [],        // [{name, latest, updated, episodes}] from the source: newest first live, a site's order static
  run: null,       // the run whose episodes are listed; null for dropped files
  entries: [],     // {name, src, ep, summary, update}: src is fetched lazily, null if dropped
  cur: -1,
  watch: { on: false, pointer: null, jump: true, note: '' },
};
const ep = () => S.entries[S.cur]?.ep;

const picker = el('div', { className: 'row' },
  el('select', { id: 'lens', title: 'Lens (← →)' }), el('select', { id: 'runs', title: 'Run' }), el('select', { id: 'episodes', title: 'Episode' }),
  el('span', { id: 'watch', className: 'dim' }));

// A playback step redraws only the lens and the dock, never the picker.
const clock = createClock(() => ep() ? numFrames(ep()) : 0, () => drawLens());

// U+FE0E asks for text, not emoji, glyphs: iOS Safari draws ⏮ ⏭ ⏸ as emoji tiles otherwise.
const glyph = s => s + '\uFE0E';
const playButton = button(glyph('▶'), () => clock.toggle(), false, 'space');
const speedLabel = el('span', { className: 'dim' });
// The speed controls are `.speed`: a phone hides them so the rest fits at thumb size.
const speed = el('span', { className: 'speed' },
  button('−', () => clock.setSpeed(-1), false, '['), speedLabel, button('+', () => clock.setSpeed(1), false, ']'));
const transport = el('span', { style: 'display:contents' },
  button(glyph('⏮'), () => clock.setT(0), false, 'Home'), button('‹', () => clock.setT(clock.t - 1), false, ','),
  playButton, button('›', () => clock.setT(clock.t + 1), false, '.'),
  button(glyph('⏭'), () => ep() && clock.setT(numFrames(ep()) - 1), false, 'End'), speed);
function drawTransport() {
  playButton.textContent = glyph(clock.playing ? '⏸' : '▶');
  speedLabel.textContent = `${clock.speed} steps/s`;
  updateDock();
}

const shell = {
  get episode() { return ep(); },
  clock,
  watch: S.watch,
  autoplay: true,  // false while the episode was opened paused by a link: lenses that start by themselves wait
};

// ------------------------------------------------------------------ menu and dock
const menuButton = document.getElementById('menu'), menuPanel = document.getElementById('menu-panel');
const dock = document.getElementById('dock');
menuPanel.append(picker);
dock.append(transport);
function setMenu(open) { menuPanel.classList.toggle('open', open); menuButton.setAttribute('aria-expanded', open); }
menuButton.onclick = () => setMenu(!menuPanel.classList.contains('open'));
addEventListener('pointerdown', ev => { if (!menuPanel.contains(ev.target) && !menuButton.contains(ev.target)) setMenu(false); });
picker.addEventListener('change', ev => { if (ev.target.tagName === 'SELECT') setMenu(false); });

const DOCK_IDLE_MS = 2500;
let lastActivity = performance.now();
for (const type of ['pointermove', 'pointerdown', 'touchstart', 'keydown'])
  addEventListener(type, () => { lastActivity = performance.now(); updateDock(); }, { passive: true });
function updateDock() {
  document.body.classList.toggle('has-episode', !!ep());
  const pinned = !clock.playing || lens.id === 'lab' || dock.matches(':hover') || dock.contains(document.activeElement);
  dock.classList.toggle('hidden', !pinned && performance.now() - lastActivity > DOCK_IDLE_MS);
}
setInterval(updateDock, 250);

const LENSES = [createLab(), ...['terrarium', 'terrarium-hd', 'terrarium-simant'].map(createTerrariumPixel),
  createTerrariumIllustrated(), createFieldNotes(), createNightColony()];
const stage = document.getElementById('stage');
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ small screens
const SMALL = matchMedia('(max-width: 899px), (max-height: 499px)');
// Every lens is left in when none would be.
const available = () => { const ls = LENSES.filter(l => !(l.large && SMALL.matches)); return ls.length ? ls : LENSES; };
let wanted = LENSES.find(l => l.id === params.get('lens')) || LENSES[0];  // what the address asks for
const usable = l => available().includes(l) ? l : available()[0];
const noticeEl = document.getElementById('notice');
function notice(text) {
  noticeEl.textContent = text; noticeEl.classList.add('shown');
  clearTimeout(notice.timer); notice.timer = setTimeout(() => noticeEl.classList.remove('shown'), 3500);
}
// A persistent error, in the notice's place: the page can't go on.
function fail(text) { clearTimeout(notice.timer); noticeEl.textContent = text; noticeEl.classList.add('shown', 'error'); }
function hiddenNotice() {
  if (usable(wanted) === wanted) noticeEl.classList.remove('shown');
  else if (params.has('lens')) notice(`${wanted.name} needs a larger screen`);
}
SMALL.addEventListener('change', () => { switchLens(usable(wanted), false); hiddenNotice(); drawPicker(); });

let lens = usable(wanted);
function mountLens() {
  document.body.dataset.lens = lens.id;  // before mount: Lab's stage ends above the dock
  menuButton.textContent = `☰  ${lens.name}`;
  lens.mount(stage, shell);
}
mountLens();
if (lens.speed) clock.speed = lens.speed;
hiddenNotice();
stage.addEventListener('click', ev => { if (ev.target.matches('canvas.map') && ep()) clock.toggle(); });

function drawLens() { drawTransport(); syncUrl(); if (!lens.animated || !ep()) lens.draw(); }
function redraw() { drawPicker(); drawLens(); }

// `chosen`: the viewer picked it, so the address follows; a small-screen fallback leaves it alone.
function switchLens(next, chosen = true) {
  if (chosen) { wanted = next; const url = new URL(location); url.searchParams.set('lens', next.id); history.replaceState(null, '', url); }
  if (next === lens) return;
  lens.unmount(); lens = next; mountLens();
  if (lens.speed) clock.speed = lens.speed;
  redraw();
}
const cycleLens = d => { const ls = available(); switchLens(ls[(ls.indexOf(lens) + d + ls.length) % ls.length]); };

function animate() {
  requestAnimationFrame(animate);
  if (!lens.animated || !ep()) return;
  try { lens.draw(); }
  catch (err) { console.error(err); }  // a failed frame must not stop the loop
}

// ------------------------------------------------------------------ picker
// A dropdown's options are rebuilt only when they change, and never while it has focus: rebuilding
// an open <select> closes it and loses the choice. The update it skipped runs when it loses focus.
// After a choice, focus goes back to the page, so space and the arrow keys drive playback again.
const lensSel = picker.querySelector('#lens'), runSel = picker.querySelector('#runs'), epSel = picker.querySelector('#episodes');
function onPick(sel, act) {
  sel.onchange = () => { const v = sel.value; sel.blur(); act(v); };
  sel.addEventListener('blur', () => drawPicker());
}
onPick(lensSel, v => switchLens(LENSES.find(l => l.id === v)));
onPick(runSel, v => v && openRun(v, true));
onPick(epSel, v => select(+v));

// `options` is [[value, label]].
function setOptions(sel, options, value) {
  if (document.activeElement === sel) return;
  const key = JSON.stringify(options);
  if (sel.dataset.options !== key) {
    sel.replaceChildren(...options.map(([v, label]) => el('option', { value: v, textContent: label })));
    sel.dataset.options = key;
  }
  if (sel.value !== String(value)) sel.value = value;
}

function drawPicker() {
  setOptions(lensSel, available().map(l => [l.id, l.name]), lens.id);
  runSel.style.display = S.runs.length ? '' : 'none';
  const runs = S.runs.map(r => [r.name, `${r.title ?? r.name} · ${r.episodes} episode${r.episodes === 1 ? '' : 's'}`]);
  if (S.run === null && S.runs.length) runs.unshift(['', 'dropped files']);
  setOptions(runSel, runs, S.run ?? '');
  const best = bestEntry();
  setOptions(epSel, S.entries.map((en, i) => [i, (en === best ? '★ ' : '') + entryLabel(en)]), S.cur);
  const note = S.watch.on ? S.watch.note : '', watch = picker.querySelector('#watch');
  if (watch.textContent !== note) watch.textContent = note;
  if (S.watch.on && !picker.querySelector('#jump')) {
    const box = el('input', { type: 'checkbox', id: 'jump', checked: S.watch.jump, onchange: () => { S.watch.jump = box.checked; } });
    picker.append(el('label', { className: 'dim', title: 'Switch to each new episode as the run writes it' }, box, ' jump to latest'));
  }
}
// After the run or episode lists changed: the picker, and the lens too while it shows no episode.
function listsChanged() { ep() ? drawPicker() : redraw(); }

function entryLabel(en) {
  const s = en.summary || {}, parts = [en.update != null ? `update ${en.update}` : en.name];
  if (s.caption) parts.push(s.caption);  // a published episode's caption adds to the label
  if (s.delivered != null) parts.push(`${s.delivered}/${s.food_total} delivered`);
  if (s.num_ants > 1 && s.survived != null) parts.push(`${s.survived}/${s.num_ants} alive`);
  if (s.bridges_built) parts.push(`${s.bridges_built} bridge${s.bridges_built === 1 ? '' : 's'}`);
  if (s.river_width) parts.push(`river ${s.river_width}, bridged ${s.crossing_depth}/${s.river_width}`);
  return parts.join(' · ');
}
function bestEntry() {  // most deliveries; the later episode wins a tie
  let best = null;
  for (const en of S.entries) if (en.summary?.delivered != null && (!best || en.summary.delivered >= best.summary.delivered)) best = en;
  return best;
}

// ------------------------------------------------------------------ episodes
// Open entry `i` at step `t`: paused there, with autoplay held, when `t` is given (a link).
async function select(i, t = null) {
  const en = S.entries[i];
  if (!en.ep) {
    try { en.ep = await fetchEpisode(en.src); }
    catch (err) { S.watch.note = `could not load ${en.name}: ${err.message}`; notice(S.watch.note); drawPicker(); return; }
  }
  S.cur = i; shell.autoplay = t == null;
  clock.t = t == null ? 0 : Math.min(t, numFrames(en.ep) - 1);
  lens.episodeChanged(en.ep); redraw();
}
function addEntry(name, src, e, summary = {}, update = null) {
  let i = S.entries.findIndex(en => en.name === name);
  if (i < 0) { S.entries.push({ name, src, ep: e, summary, update }); i = S.entries.length - 1; }
  else { if (e) S.entries[i].ep = e; S.entries[i].summary = summary; }
  return i;
}

// List a run's episodes. `open` picks one: `want` (by name) if given, else the default (live, the
// run's latest; on a site, its first); otherwise the current one stays. Returns false, picking
// nothing, when `want` isn't in the run.
async function openRun(name, open, want = null, t = null) {
  const rows = await source.episodes(name);
  const keep = S.run === name ? S.entries : [];
  const current = S.entries[S.cur];
  S.run = name;
  S.entries = keep.filter(en => rows.some(r => r.name === en.name));
  for (const r of rows) addEntry(r.name, source.episodeUrl(name, r.file), null, r, r.update);
  S.cur = current && S.run === name ? S.entries.indexOf(current) : -1;
  const run = S.runs.find(r => r.name === name);
  S.watch.pointer = run?.latest ?? null;
  if (open || S.cur < 0) {
    let i;
    if (want != null) {
      i = S.entries.findIndex(en => en.name === want);
      if (i < 0) { listsChanged(); return false; }
    } else {
      const latest = run?.latest ? S.entries.findIndex(en => en.src === source.episodeUrl(name, run.latest)) : -1;
      i = latest >= 0 ? latest : source.static ? 0 : S.entries.length - 1;
    }
    if (i >= 0) { clock.playing = false; await select(i, t); }
  }
  listsChanged();
  return true;
}

// ------------------------------------------------------------------ links
const link = { run: params.get('run'), ep: params.get('ep'), t: /^\d+$/.test(params.get('t') ?? '') ? +params.get('t') : null };
let linked = false;  // the address is kept current only once the linked episode is open

// The first episode to open: the one the address names, else the default.
async function openLinked() {
  const run = link.run != null ? S.runs.find(r => r.name === link.run) : null;
  if (!(run && await openRun(run.name, true, link.ep, link.t))) {
    if (link.run != null) notice(run ? `No episode “${link.ep}” in ${run.title ?? run.name}; showing the default`
                                     : `No run “${link.run}” here; showing the default`);
    await openRun(S.runs[0].name, true);  // a site's first entry, or the newest run
  }
  linked = true; syncUrl();
}

// Keep the address a shareable link to what is open, at most a few times a second (Safari limits
// replaceState). `lens` is written only when the viewer picks one (switchLens).
let syncTimer = null;
function syncUrl() {
  if (!linked || syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const url = new URL(location), q = url.searchParams, en = S.entries[S.cur];
    const set = (k, v) => v == null ? q.delete(k) : q.set(k, v);
    set('run', S.run); set('ep', S.run != null && en ? en.name : null);
    set('t', en && !clock.playing && clock.t > 0 ? clock.t : null);
    if (url.href !== location.href) history.replaceState(null, '', url);
  }, 300);
}

async function poll() {
  try {
    S.runs = await source.runs();
    if (!S.runs.length) S.watch.note = 'watching · no runs yet';
    else {
      if (S.run === null && S.cur < 0) await openLinked();  // start: the linked episode, or the newest run's latest
      const run = S.runs.find(r => r.name === S.run);
      if (run && run.latest !== S.watch.pointer) await openRun(run.name, S.watch.jump);
      S.watch.note = `watching · ${new Date().toLocaleTimeString()}`;
    }
  } catch (err) { S.watch.note = `watch failed: ${err.message}`; }
  listsChanged();
}

async function startWatch() {
  S.watch.on = true;
  await poll();
  setInterval(poll, 2000);
}

// ------------------------------------------------------------------ input
addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { setMenu(false); return; }
  if (ev.target.matches('input,textarea,select')) return;
  const k = ev.key;
  if (k === 'ArrowLeft' || k === 'ArrowRight') { ev.preventDefault(); cycleLens(k === 'ArrowLeft' ? -1 : 1); return; }
  if (!ep()) return;
  if (k === ' ') { ev.preventDefault(); clock.toggle(); }
  else if (k === ',') clock.setT(clock.t - 1); else if (k === '.') clock.setT(clock.t + 1);
  else if (k === 'Home') clock.setT(0); else if (k === 'End') clock.setT(numFrames(ep()) - 1);
  else if (k === '[') clock.setSpeed(-1); else if (k === ']') clock.setSpeed(1);
  else if (k === 's') clock.toggleSmooth();
  else lens.key(ev);
});
addEventListener('resize', () => lens.resize());
const dropEl = document.getElementById('drop');
addEventListener('dragover', ev => { ev.preventDefault(); dropEl.style.display = 'grid'; });
addEventListener('dragleave', ev => { if (!ev.relatedTarget) dropEl.style.display = 'none'; });
addEventListener('drop', async ev => {
  ev.preventDefault(); dropEl.style.display = 'none';
  let i = -1;
  if (S.run !== null) { S.run = null; S.entries = []; S.cur = -1; }
  for (const f of ev.dataTransfer.files) {
    try { i = addEntry(f.name.replace(/\.episode\.gz$/, ''), null, await readEpisodeFile(f)); }
    catch (err) { alert(`${f.name}: ${err.message}`); }
  }
  if (i >= 0) select(i);
});

// A published site: its entries, once (there is nothing to follow).
async function startStatic() {
  S.runs = await source.runs();
  if (!S.runs.length) { fail('This site has no entries.'); return; }
  await openLinked();
}

async function start() {
  try { source = await findSource(); }
  catch (err) { fail(`Can't load this site: ${err.message}`); return; }
  if (source.static) {
    document.title = source.manifest.title || document.title;
    await startStatic();
  } else if (params.has('watch')) await startWatch();
}

loadFonts();
redraw();
requestAnimationFrame(animate);
start();
