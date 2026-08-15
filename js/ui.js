// ui.js — tiny DOM helpers, toast, bottom sheet.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function toast(msg, ms = 2400) {
  const root = document.getElementById('toast-root');
  root.innerHTML = '';
  const t = el('div', { class: 'toast' }, msg);
  root.append(t);
  setTimeout(() => t.remove(), ms);
}

export function sheet(contentNode) {
  const root = document.getElementById('sheet-root');
  const close = () => { root.innerHTML = ''; };
  const backdrop = el('div', { class: 'sheet-backdrop', onclick: close });
  const panel = el('div', { class: 'sheet' }, contentNode);
  root.innerHTML = '';
  root.append(backdrop, panel);
  return close;
}

export function confirmSheet(title, message, actionLabel, onConfirm) {
  const close = sheet(el('div', { class: 'stack' },
    el('h3', {}, title),
    el('p', { class: 'muted' }, message),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn btn-danger', onclick: () => { close(); onConfirm(); } }, actionLabel)
    )
  ));
}

export function fmtBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n > 1e3) return (n / 1e3).toFixed(0) + ' KB';
  return n + ' B';
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function blobURL(blob) {
  return blob instanceof Blob ? URL.createObjectURL(blob) : '';
}
