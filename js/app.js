// app.js — bootstrap + hash router.
import { loadRegistry } from './schemas.js';
import { db } from './db.js';
import { el } from './ui.js';
import { homeView, vaultsView, vaultView, assetView, addView, docView, ledgerView, askView, settingsView } from './views.js';

const routes = {
  home: homeView,
  vaults: vaultsView,
  vault: vaultView,
  asset: assetView,
  add: addView,
  doc: docView,
  ledger: ledgerView,
  ask: askView,
  settings: settingsView
};

const viewRoot = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

export function nav(route, params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `#/${route}${qs ? '?' + qs : ''}`;
}

async function render() {
  const hash = location.hash.replace(/^#\//, '') || 'home';
  const [routeName, qs] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const fn = routes[routeName] || homeView;

  // tab highlight (vault/doc belong under vaults)
  const tabRoute = { vault: 'vaults', doc: 'vaults', asset: 'vaults', ledger: 'vaults' }[routeName] || routeName;
  tabbar.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === tabRoute));

  viewRoot.innerHTML = '';
  try {
    await fn(viewRoot, nav, params);
  } catch (err) {
    console.error(err);
    viewRoot.append(el('div', { class: 'empty' },
      el('span', { class: 'big' }, '⚠️'),
      el('p', {}, 'Something broke: ' + err.message),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:16px', onclick: () => nav('home') }, 'Back to home')
    ));
  }
  window.scrollTo(0, 0);
}

tabbar.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab) nav(tab.dataset.route);
});
window.addEventListener('hashchange', render);

(async function init() {
  try { await loadRegistry(); } catch (err) { console.warn(err); }
  db.requestPersist();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  render();
})();
