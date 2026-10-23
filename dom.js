export function el(tag, props = {}, ...kids) {
  const d = Object.assign(document.createElement(tag), props); d.append(...kids); return d;
}

export function button(text, onclick, on, title) {
  return el('button', { textContent: text, onclick, className: on ? 'on' : '', title: title || '' });
}
