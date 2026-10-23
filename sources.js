// Where runs and episodes come from: the live server (`scripts/view.py`), or a published site's
// `manifest.json` (written by `scripts/publish.py`). Both have the same shape, so the shell doesn't
// care which it has; a static source also has `static: true` and its `manifest`.

import { readEpisode } from './episode.js';

const api = path => fetch(path, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });

export const liveSource = {
  runs: () => api('api/runs'),                                                 // [{name, latest, updated, episodes}], newest first
  episodes: run => api(`api/runs/${encodeURIComponent(run)}/episodes`),        // [{file, name, update, delivered, ...}]
  episodeUrl: (run, file) => `runs/${encodeURIComponent(run)}/${file}`,
};

export const MANIFEST = 'manifest.json', MANIFEST_FORMAT = 'anthive-manifest/1';

// A published site, from its manifest (already fetched from `url`). Entries are runs, in the
// showcase's order; each entry's `rows` are its episodes, whose `file` is relative to the manifest.
export function staticSource(manifest, url) {
  const entry = run => manifest.entries.find(e => e.name === run);
  return {
    static: true, manifest,
    runs: async () => manifest.entries,
    episodes: async run => entry(run)?.rows ?? [],
    episodeUrl: (run, file) => new URL(file, url).href,
  };
}

// The page's source: a published site if `manifest.json` sits beside the page, the live server if
// that is a 404 (`view.py` never serves one). Anything else (no answer, another status, a manifest
// that isn't one) is an error for the page to show, never a quiet fall back to live.
export async function findSource() {
  const url = new URL(MANIFEST, location.href);
  let r;
  try { r = await fetch(url, { cache: 'no-cache' }); }
  catch (err) { throw new Error(`could not fetch ${MANIFEST}: ${err.message}`); }
  if (r.status === 404) return liveSource;
  if (!r.ok) throw new Error(`could not fetch ${MANIFEST}: HTTP ${r.status}`);
  let manifest;
  try { manifest = await r.json(); }
  catch { throw new Error(`${MANIFEST} is not valid JSON`); }
  if (manifest?.format !== MANIFEST_FORMAT) throw new Error(`${MANIFEST} is not an ${MANIFEST_FORMAT} file`);
  return staticSource(manifest, url);
}

export async function fetchEpisode(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return readEpisode(await r.arrayBuffer());
}

export async function readEpisodeFile(file) {
  return readEpisode(await file.arrayBuffer());
}
