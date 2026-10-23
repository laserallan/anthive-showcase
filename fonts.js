// Web fonts the lenses use, pinned in deps.json as `cdn` + `fonts: [{family, path, integrity, weight?, style?}]`.
// In development they load from the CDN; `publish` downloads them and points `cdn` at the site's
// own vendor/. A font that fails to load falls back to the lens's next family.

export async function loadFonts() {
  try {
    const deps = await (await fetch('deps.json', { cache: 'no-store' })).json();
    for (const { family, path, weight = '400', style = 'normal' } of deps.fonts || []) {
      const face = new FontFace(family, `url(${deps.cdn}${path})`, { weight, style });
      document.fonts.add(face);
      face.load().catch(() => {});
    }
  } catch { /* no deps.json: system fonts */ }
}
