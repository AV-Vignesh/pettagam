// views.js — every screen. v2: multi-page documents, asset hub, ledgers.
import { db, uid } from './db.js';
import { getVaults, getVault, getDocTypes, getDocType, getLandChecklist, getLedgerTypes, getLedgerType, refreshRegistry, registryVersion } from './schemas.js';
import { compressImage, blobToBase64, decodeDocument, askAI, getAIConfig, saveAIConfig, aiReady } from './ai.js';
import { docStatus, attention, healthScore, downloadICS } from './reminders.js';
import { ledgerStatus, ledgerTimeline, ledgerAttention, periodOptions, periodLabel, currentIndex } from './ledger.js';
import { exportBackup, importBackup, backupNudgeDue } from './backup.js';
import { el, toast, sheet, confirmSheet, fmtBytes, fmtDate, blobURL } from './ui.js';

const statusChip = (s) => {
  if (s.state === 'expired' || s.state === 'stale' || s.state === 'gap') return el('span', { class: 'chip chip-red' }, s.state === 'stale' ? 'STALE' : s.state === 'gap' ? 'GAPS' : 'EXPIRED');
  if (s.state === 'soon' || s.state === 'due') return el('span', { class: 'chip chip-amber' }, s.state === 'due' ? 'DUE' : `${s.days}D LEFT`);
  if (s.state === 'ok') return el('span', { class: 'chip chip-green' }, s.due !== undefined ? 'UP TO DATE' : 'VALID');
  return null;
};

const firstThumb = (doc) => doc.pages?.[0]?.thumb || doc.pages?.[0]?.blob || null;

const docRow = (doc, nav) => {
  const type = getDocType(doc.docType);
  const s = docStatus(doc);
  const t = firstThumb(doc);
  const img = t ? el('img', { class: 'doc-thumb', src: blobURL(t), alt: '' })
              : el('div', { class: 'doc-thumb ph' }, type?.emoji || '📄');
  const pageCount = doc.pages?.length || 0;
  return el('button', { class: 'doc-row', onclick: () => nav('doc', { id: doc.id }) },
    img,
    el('div', { class: 'body' },
      el('b', {}, doc.title || type?.name || 'Document'),
      el('span', { class: 'sub' }, [type?.name, pageCount > 1 ? `${pageCount} pages` : null].filter(Boolean).join(' · '))
    ),
    statusChip(s)
  );
};

const ledgerRow = (l, nav) => {
  const type = getLedgerType(l.type);
  const s = ledgerStatus(l);
  return el('button', { class: 'doc-row', onclick: () => nav('ledger', { id: l.id }) },
    el('div', { class: 'doc-thumb ph' }, type?.emoji || '🔁'),
    el('div', { class: 'body' },
      el('b', {}, l.name),
      el('span', { class: 'sub' }, s.label)
    ),
    statusChip(s)
  );
};

/* ═══════════ HOME ═══════════ */
export async function homeView(root, nav) {
  const docs = await db.all();
  const ledgers = await db.allLedgers();
  const score = healthScore(docs, ledgers);
  const attn = attention(docs);
  const lAttn = ledgerAttention(ledgers);
  const trackable = docs.filter(d => docStatus(d).state !== 'none').length + ledgers.length;

  const C = 2 * Math.PI * 78;
  root.append(
    el('header', { class: 'greet' },
      el('h1', {}, 'Pettagam'),
      el('p', { class: 'muted' }, docs.length || ledgers.length ? `${docs.length} documents · ${ledgers.length} ledgers` : 'Your family document locker')
    ),
    el('div', { class: 'seal-wrap' },
      el('div', { class: 'seal' },
        el('div', { html: `<svg viewBox="0 0 172 172">
          <circle class="dashes" cx="86" cy="86" r="70" fill="none" stroke-width="1.5"/>
          <circle class="track" cx="86" cy="86" r="78" fill="none" stroke-width="7"/>
          <circle class="arc" cx="86" cy="86" r="78" fill="none" stroke-width="7"
            stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - score / 100)}"/>
        </svg>` }),
        el('div', { class: 'seal-center' },
          el('div', { class: 'seal-score mono' }, String(score)),
          el('div', { class: 'seal-label' }, 'Locker Health')
        )
      )
    ),
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('b', { class: 'mono' }, String(docs.length)), el('span', {}, 'Documents')),
      el('div', { class: 'stat' }, el('b', { class: 'mono' }, String(trackable)), el('span', {}, 'Tracked')),
      el('div', { class: 'stat' }, el('b', { class: 'mono', style: (attn.length + lAttn.length) ? 'color:var(--wax-red)' : '' }, String(attn.length + lAttn.length)), el('span', {}, 'Need action'))
    )
  );

  if (attn.length || lAttn.length) {
    const sec = el('section', { class: 'section' }, el('span', { class: 'eyebrow' }, 'Needs attention'));
    const stack = el('div', { class: 'stack' });
    for (const { ledger, status } of lAttn.slice(0, 4)) {
      stack.append(el('button', { class: 'attn', onclick: () => nav('ledger', { id: ledger.id }) },
        el('span', { class: 'dot', style: `background:${status.state === 'gap' ? 'var(--wax-red)' : 'var(--turmeric)'}` }),
        el('div', { class: 'body' }, el('b', {}, `${ledger.name} — ${ledger.asset}`), el('span', {}, status.label)),
        el('span', { class: 'muted' }, '›')
      ));
    }
    for (const { doc, status } of attn.slice(0, 5)) {
      stack.append(el('button', { class: 'attn', onclick: () => nav('doc', { id: doc.id }) },
        el('span', { class: 'dot', style: `background:${status.state === 'soon' ? 'var(--turmeric)' : 'var(--wax-red)'}` }),
        el('div', { class: 'body' }, el('b', {}, doc.title || 'Document'), el('span', {}, status.label)),
        el('span', { class: 'muted' }, '›')
      ));
    }
    sec.append(stack);
    root.append(sec);
  }

  if (docs.length) {
    const recent = [...docs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
    const sec = el('section', { class: 'section' }, el('span', { class: 'eyebrow' }, 'Recent'));
    const stack = el('div', { class: 'stack' });
    recent.forEach(d => stack.append(docRow(d, nav)));
    sec.append(stack);
    root.append(sec);
  } else {
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'big' }, '🗄️'),
      el('p', {}, 'The locker is empty. Tap the brass button — snap every page of a document and let AI fill the form.')
    ));
  }

  if ((docs.length || ledgers.length) && backupNudgeDue()) {
    root.append(el('section', { class: 'section' },
      el('div', { class: 'ai-note' }, '💾 It\'s been a while since your last backup. Export one from Settings — 5 seconds, survives a phone reset.')
    ));
  }
}

/* ═══════════ VAULTS ═══════════ */
export async function vaultsView(root, nav) {
  const docs = await db.all();
  root.append(el('h1', {}, 'Vaults'), el('p', { class: 'muted', style: 'margin-bottom:20px' }, 'Four lockers, one key.'));
  const grid = el('div', { class: 'locker-grid' });
  for (const v of getVaults()) {
    const count = docs.filter(d => d.vault === v.id).length;
    grid.append(el('button', { class: 'locker', onclick: () => nav('vault', { id: v.id }) },
      el('span', { class: 'emoji' }, v.emoji),
      el('div', {}, el('b', {}, v.name), el('span', {}, `${count} document${count === 1 ? '' : 's'}`))
    ));
  }
  root.append(grid);
}

export async function vaultView(root, nav, params) {
  const vault = getVault(params.id);
  const docs = (await db.byVault(params.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const ledgers = (await db.allLedgers()).filter(l => l.vault === params.id);

  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'back', onclick: () => nav('vaults') }, '‹'),
    el('h2', {}, `${vault.emoji} ${vault.name}`)
  ));

  const search = el('input', { class: 'searchbar', type: 'search', placeholder: `Search ${vault.name.toLowerCase()}…` });
  root.append(search);
  const listRoot = el('div', {});
  root.append(listRoot);

  const render = (q = '') => {
    listRoot.innerHTML = '';
    const ql = q.toLowerCase();
    const filtered = docs.filter(d => `${d.title} ${d.asset} ${JSON.stringify(d.fields)}`.toLowerCase().includes(ql));
    const fLedgers = ledgers.filter(l => `${l.name} ${l.asset}`.toLowerCase().includes(ql));
    if (!filtered.length && !fLedgers.length) {
      listRoot.append(el('div', { class: 'empty' }, el('span', { class: 'big' }, vault.emoji), el('p', {}, q ? 'No matches.' : `Nothing here yet. Add a document with the brass + button.`)));
      return;
    }
    const assets = [...new Set([...filtered.map(d => d.asset || 'Ungrouped'), ...fLedgers.map(l => l.asset || 'Ungrouped')])];
    for (const asset of assets) {
      const aDocs = filtered.filter(d => (d.asset || 'Ungrouped') === asset);
      const aLedgers = fLedgers.filter(l => (l.asset || 'Ungrouped') === asset);
      const head = el('div', { class: 'asset-head' },
        el('h3', {}, asset),
        asset !== 'Ungrouped'
          ? el('button', { class: 'small', style: 'color:var(--brass)', onclick: () => nav('asset', { vault: vault.id, name: asset }) }, 'Open hub ›')
          : el('span', { class: 'small muted mono' }, `${aDocs.length}`)
      );
      listRoot.append(head);
      const stack = el('div', { class: 'stack' });
      aLedgers.forEach(l => stack.append(ledgerRow(l, nav)));
      aDocs.forEach(d => stack.append(docRow(d, nav)));
      listRoot.append(stack);
    }
  };
  search.addEventListener('input', () => render(search.value));
  render();
}

/* ═══════════ ASSET HUB ═══════════ */
export async function assetView(root, nav, params) {
  const vault = getVault(params.vault);
  const name = params.name;
  const docs = (await db.byVault(params.vault)).filter(d => d.asset === name);
  const ledgers = (await db.allLedgers()).filter(l => l.asset === name && l.vault === params.vault);

  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'back', onclick: () => nav('vault', { id: params.vault }) }, '‹'),
    el('h2', {}, `${vault.emoji} ${name}`)
  ));

  if (params.vault === 'land') root.append(readinessCard(docs, ledgers));

  const lSec = el('section', { class: 'section' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px' },
      el('span', { class: 'eyebrow' }, 'Payment ledgers'),
      el('button', { class: 'small', style: 'color:var(--brass)', onclick: () => newLedgerSheet(params.vault, name, nav) }, '＋ New ledger')
    )
  );
  const lStack = el('div', { class: 'stack' });
  if (ledgers.length) ledgers.forEach(l => lStack.append(ledgerRow(l, nav)));
  else lStack.append(el('p', { class: 'small muted' }, 'Track kanthayam, property tax, EB… year on year. Missing years show up in red.'));
  lSec.append(lStack);
  root.append(lSec);

  const dSec = el('section', { class: 'section' }, el('span', { class: 'eyebrow' }, `Documents (${docs.length})`));
  const dStack = el('div', { class: 'stack' });
  if (docs.length) docs.forEach(d => dStack.append(docRow(d, nav)));
  else dStack.append(el('p', { class: 'small muted' }, 'No documents yet — add with the brass + button.'));
  dSec.append(dStack);
  root.append(dSec);
}

function readinessCard(assetDocs, assetLedgers = []) {
  const have = new Set(assetDocs.map(d => d.docType));
  const items = getLandChecklist();
  const critMissing = items.filter(i => i.critical && !have.has(i.docType)).length;
  const staleCrit = assetDocs.filter(d => ['stale', 'expired'].includes(docStatus(d).state)).length;
  const ledgerGaps = assetLedgers.reduce((n, l) => n + ledgerStatus(l).gaps, 0);
  const gaps = critMissing + staleCrit + (ledgerGaps ? 1 : 0);

  const body = el('div', { class: 'card', style: 'margin-bottom:12px' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
      el('span', { class: 'eyebrow' }, 'Sale readiness'),
      gaps === 0 ? el('span', { class: 'chip chip-green' }, 'READY') : el('span', { class: 'chip chip-red' }, `${gaps} GAP${gaps === 1 ? '' : 'S'}`)
    )
  );
  for (const item of items) {
    const has = have.has(item.docType);
    const doc = assetDocs.find(d => d.docType === item.docType);
    const bad = doc && ['stale', 'expired'].includes(docStatus(doc).state);
    let markCls = 'opt', mark = '·';
    if (has && !bad) { markCls = 'ok'; mark = '✓'; }
    else if (item.critical || bad) { markCls = 'no'; mark = '✕'; }
    body.append(el('div', { class: 'check' },
      el('span', { class: `mark ${markCls}` }, mark),
      el('span', { style: has && !bad ? '' : 'color:var(--paper-3)' }, item.label + (bad ? ' — needs refresh' : ''))
    ));
  }
  if (assetLedgers.length) {
    body.append(el('div', { class: 'check' },
      el('span', { class: `mark ${ledgerGaps ? 'no' : 'ok'}` }, ledgerGaps ? '✕' : '✓'),
      el('span', { style: ledgerGaps ? 'color:var(--paper-3)' : '' }, ledgerGaps ? `Payment ledgers — ${ledgerGaps} unpaid period(s)` : 'Payment ledgers up to date')
    ));
  }
  return body;
}

/* ═══════════ ADD FLOW (multi-page) ═══════════ */
export async function addView(root, nav, params) {
  root.append(el('h1', {}, 'Add document'));
  const state = { pages: [], vault: params.vault || 'land', decoded: null };

  const fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, style: 'display:none' });
  const drop = el('button', { class: 'drop', onclick: () => fileInput.click() },
    el('span', { class: 'big' }, '📸'),
    el('b', {}, 'Snap or pick pages'),
    el('span', { class: 'small' }, 'Multi-select works · each page compressed to ~300KB')
  );
  const strip = el('div', { class: 'page-strip', style: 'display:none' });
  const addMore = el('button', { class: 'btn btn-ghost', style: 'display:none', onclick: () => fileInput.click() }, '＋ Add more pages');
  const step1 = el('div', { class: 'section' }, drop, fileInput, strip, addMore);
  const step2 = el('div', { class: 'section', style: 'display:none' });
  root.append(step1, step2);

  const renderStrip = () => {
    strip.innerHTML = '';
    strip.style.display = state.pages.length ? 'flex' : 'none';
    addMore.style.display = state.pages.length ? 'flex' : 'none';
    drop.style.display = state.pages.length ? 'none' : 'flex';
    state.pages.forEach((p, i) => {
      const cell = el('div', { class: 'page-cell' },
        el('img', { src: blobURL(p.thumb || p.blob), alt: `Page ${i + 1}` }),
        el('span', { class: 'page-num mono' }, String(i + 1)),
        el('button', { class: `page-ai ${p.forAI ? 'on' : ''}`, title: 'Send to AI', onclick: () => { p.forAI = !p.forAI; renderStrip(); } }, 'AI'),
        el('button', { class: 'page-x', onclick: () => { state.pages.splice(i, 1); renderStrip(); } }, '✕')
      );
      strip.append(cell);
    });
    step2.style.display = state.pages.length ? 'block' : 'none';
  };

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    if (!files.length) return;
    toast(`Compressing ${files.length} page${files.length > 1 ? 's' : ''}…`);
    for (const f of files) {
      const { blob, thumb } = await compressImage(f);
      state.pages.push({ blob, thumb, forAI: state.pages.length === 0 }); // page 1 → AI by default
    }
    fileInput.value = '';
    renderStrip();
    if (!step2.dataset.built) buildStep2();
  });

  function buildStep2() {
    step2.dataset.built = '1';
    step2.innerHTML = '';
    step2.append(el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:12px' }, 'Which locker?'));

    const vaultSel = el('select', {});
    getVaults().forEach(v => vaultSel.append(el('option', { value: v.id, selected: v.id === state.vault }, `${v.emoji} ${v.name}`)));
    const typeSel = el('select', {});
    const fillTypes = () => {
      typeSel.innerHTML = '';
      typeSel.append(el('option', { value: '' }, 'Let AI identify it'));
      getDocTypes(vaultSel.value).forEach(t => typeSel.append(el('option', { value: t.id }, `${t.emoji} ${t.name}`)));
    };
    fillTypes();
    vaultSel.addEventListener('change', fillTypes);

    const decodeBtn = el('button', { class: 'btn btn-brass' }, '✨ Decode with AI');
    const manualBtn = el('button', { class: 'btn btn-ghost' }, 'Fill manually');
    const formRoot = el('div', {});

    decodeBtn.addEventListener('click', async () => {
      if (!aiReady()) { toast('Set up AI in Settings first'); nav('settings'); return; }
      const aiPages = state.pages.filter(p => p.forAI);
      if (!aiPages.length) { toast('Mark at least one page with the AI badge'); return; }
      decodeBtn.innerHTML = ''; decodeBtn.append(el('span', { class: 'spinner' }), ` Reading ${aiPages.length} page${aiPages.length > 1 ? 's' : ''}…`); decodeBtn.disabled = true;
      try {
        const b64s = [];
        for (const p of aiPages) b64s.push(await blobToBase64(p.blob));
        const result = await decodeDocument(b64s, vaultSel.value, typeSel.value || null);
        state.decoded = result;
        toast(`Identified: ${getDocType(result.docType)?.name || result.docType}`);
        renderForm(formRoot, vaultSel.value, result.docType, result, nav, state, params.asset);
      } catch (err) { toast('Decode failed — ' + err.message.slice(0, 60), 4000); }
      decodeBtn.textContent = '✨ Decode again'; decodeBtn.disabled = false;
    });
    manualBtn.addEventListener('click', () => {
      const t = typeSel.value || getDocTypes(vaultSel.value)[0]?.id;
      renderForm(formRoot, vaultSel.value, t, null, nav, state, params.asset);
    });

    step2.append(
      el('div', { class: 'field-grid' },
        el('div', {}, el('label', {}, 'Vault'), vaultSel),
        el('div', {}, el('label', {}, 'Document type'), typeSel)
      ),
      el('div', { class: 'ai-note', style: 'margin-top:10px' }, 'Toggle the AI badge on the pages that carry the details (usually page 1 + the schedule page). Fewer pages = cheaper, faster decode.'),
      el('div', { class: 'btn-row', style: 'margin-top:16px' }, decodeBtn, manualBtn),
      formRoot
    );
  }
}

function renderForm(formRoot, vaultId, docTypeId, decoded, nav, state, presetAsset) {
  const type = getDocType(docTypeId);
  if (!type) { toast('Unknown document type'); return; }
  const vault = getVault(type.vault) || getVault(vaultId);
  formRoot.innerHTML = '';
  const wrap = el('div', { class: 'section' });

  if (decoded?.notes) wrap.append(el('div', { class: 'ai-note', style: 'margin-bottom:12px' }, `🤖 ${decoded.notes} (confidence ${Math.round((decoded.confidence || 0) * 100)}%)`));

  const titleInput = el('input', { type: 'text', value: decoded?.title || type.name });
  const assetInput = el('input', { type: 'text', value: presetAsset || '', placeholder: 'e.g. Salem Plot / Appa / Activa' });
  const grid = el('div', { class: 'field-grid' },
    el('div', {}, el('label', {}, 'Title'), titleInput),
    el('div', {}, el('label', {}, vault?.assetLabel || 'Group'), assetInput)
  );

  const inputs = {};
  for (const f of type.fields) {
    const val = decoded?.fields?.[f.key] || '';
    const input = f.type === 'textarea' ? el('textarea', { rows: 2 }, val)
      : el('input', { type: f.type === 'date' ? 'date' : 'text', value: val, class: f.mono ? 'mono' : '' });
    inputs[f.key] = input;
    grid.append(el('div', {}, el('label', {}, f.label), input));
  }
  if (type.freshnessNote || type.expiryNote) grid.append(el('div', { class: 'ai-note' }, `ℹ️ ${type.freshnessNote || type.expiryNote}`));

  const saveBtn = el('button', { class: 'btn btn-brass', style: 'margin-top:16px' }, `🔐 Lock in ${state.pages.length} page${state.pages.length > 1 ? 's' : ''}`);
  saveBtn.addEventListener('click', async () => {
    const fields = {};
    for (const [k, node] of Object.entries(inputs)) { const v = node.value.trim(); if (v) fields[k] = v; }
    const doc = {
      id: uid(), vault: type.vault, docType: type.id,
      title: titleInput.value.trim() || type.name,
      asset: assetInput.value.trim() || '',
      fields,
      pages: state.pages.map(p => ({ blob: p.blob, thumb: p.thumb })),
      createdAt: Date.now(), updatedAt: Date.now(),
      ai: decoded ? { confidence: decoded.confidence, notes: decoded.notes } : null
    };
    await db.put(doc);
    await db.requestPersist();
    toast('Locked into the pettagam 🔐');
    nav('doc', { id: doc.id });
  });
  wrap.append(grid, saveBtn);
  formRoot.append(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══════════ DOC DETAIL (page carousel) ═══════════ */
export async function docView(root, nav, params) {
  const doc = await db.get(params.id);
  if (!doc) { root.append(el('p', {}, 'Document not found.')); return; }
  const type = getDocType(doc.docType);
  const s = docStatus(doc);

  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'back', onclick: () => doc.asset ? nav('asset', { vault: doc.vault, name: doc.asset }) : nav('vault', { id: doc.vault }) }, '‹'),
    el('h2', {}, doc.title)
  ));

  if (doc.pages?.length) {
    const counter = el('span', { class: 'chip chip-mute mono page-counter' }, `1 / ${doc.pages.length}`);
    const carousel = el('div', { class: 'carousel' });
    doc.pages.forEach((p, i) => {
      const img = el('img', { src: blobURL(p.blob), alt: `Page ${i + 1}`, loading: 'lazy' });
      img.addEventListener('click', () => sheet(el('div', {}, el('img', { src: img.src, style: 'width:100%;border-radius:12px' }))));
      carousel.append(el('div', { class: 'carousel-cell' }, img));
    });
    carousel.addEventListener('scroll', () => {
      const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
      counter.textContent = `${Math.min(i + 1, doc.pages.length)} / ${doc.pages.length}`;
    }, { passive: true });
    root.append(el('div', { class: 'carousel-wrap' }, carousel, doc.pages.length > 1 ? counter : null));
  }

  root.append(el('div', { style: 'display:flex;gap:8px;align-items:center;margin:14px 0;flex-wrap:wrap' },
    el('span', { class: 'chip chip-mute' }, `${type?.emoji || ''} ${type?.name || doc.docType}`),
    doc.asset ? el('span', { class: 'chip chip-mute' }, doc.asset) : null,
    statusChip(s)
  ));
  if (s.label) root.append(el('p', { class: 'small muted', style: 'margin-bottom:14px' }, s.label));

  const kv = el('div', { class: 'kv' });
  for (const f of (type?.fields || [])) {
    const v = doc.fields?.[f.key];
    if (!v) continue;
    kv.append(el('div', { class: 'k' }, f.label), el('div', { class: `v ${f.mono ? 'mono' : ''}` }, f.type === 'date' ? fmtDate(v) : v));
  }
  root.append(kv);

  const addPagesInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, style: 'display:none' });
  addPagesInput.addEventListener('change', async () => {
    const files = [...addPagesInput.files];
    if (!files.length) return;
    toast(`Adding ${files.length} page${files.length > 1 ? 's' : ''}…`);
    for (const f of files) {
      const { blob, thumb } = await compressImage(f);
      doc.pages.push({ blob, thumb });
    }
    await db.put(doc);
    toast('Pages added');
    nav('doc', { id: doc.id }); location.reload();
  });

  const actions = el('div', { class: 'stack', style: 'margin-top:20px' });
  actions.append(el('button', { class: 'btn btn-ghost', onclick: () => addPagesInput.click() }, '📎 Add pages'), addPagesInput);
  if (s.date) actions.append(el('button', { class: 'btn btn-ghost', onclick: () => { downloadICS(doc) ? toast('Calendar reminder downloaded 📅') : toast('No date to remind on'); } }, '📅 Add reminder to calendar'));
  actions.append(
    el('button', { class: 'btn btn-ghost', onclick: () => editDoc(doc, nav) }, '✏️ Edit details'),
    el('button', { class: 'btn btn-danger', onclick: () => confirmSheet('Delete document?', `“${doc.title}” and all ${doc.pages?.length || 0} pages will be removed from this phone permanently.`, 'Delete', async () => { await db.remove(doc.id); toast('Deleted'); nav('vault', { id: doc.vault }); }) }, '🗑️ Delete')
  );
  root.append(actions);
}

function editDoc(doc, nav) {
  const type = getDocType(doc.docType);
  const inputs = {};
  const titleInput = el('input', { type: 'text', value: doc.title });
  const assetInput = el('input', { type: 'text', value: doc.asset || '' });
  const grid = el('div', { class: 'field-grid' },
    el('div', {}, el('label', {}, 'Title'), titleInput),
    el('div', {}, el('label', {}, 'Group / Asset'), assetInput)
  );
  for (const f of (type?.fields || [])) {
    const val = doc.fields?.[f.key] || '';
    const input = f.type === 'textarea' ? el('textarea', { rows: 2 }, val) : el('input', { type: f.type === 'date' ? 'date' : 'text', value: val });
    inputs[f.key] = input;
    grid.append(el('div', {}, el('label', {}, f.label), input));
  }
  const save = el('button', { class: 'btn btn-brass', style: 'margin-top:14px' }, 'Save changes');
  const close = sheet(el('div', {}, el('h3', { style: 'margin-bottom:14px' }, 'Edit document'), grid, save));
  save.addEventListener('click', async () => {
    doc.title = titleInput.value.trim() || doc.title;
    doc.asset = assetInput.value.trim();
    for (const [k, node] of Object.entries(inputs)) {
      const v = node.value.trim();
      if (v) doc.fields[k] = v; else delete doc.fields[k];
    }
    await db.put(doc);
    close(); toast('Saved'); nav('doc', { id: doc.id });
  });
}

/* ═══════════ LEDGERS ═══════════ */
function newLedgerSheet(vaultId, asset, nav) {
  const types = getLedgerTypes();
  const typeSel = el('select', {});
  types.forEach(t => typeSel.append(el('option', { value: t.id }, `${t.emoji} ${t.name}`)));
  const nameInput = el('input', { type: 'text', placeholder: 'auto from type' });
  const freqSel = el('select', {},
    el('option', { value: 'yearly' }, 'Yearly (FY Apr–Mar)'),
    el('option', { value: 'halfyearly' }, 'Half-yearly'),
    el('option', { value: 'monthly' }, 'Monthly')
  );
  const note = el('p', { class: 'small muted' }, '');
  const sync = () => {
    const t = getLedgerType(typeSel.value);
    freqSel.value = t?.frequency || 'yearly';
    nameInput.placeholder = t?.name || 'Name';
    note.textContent = t?.note || '';
  };
  typeSel.addEventListener('change', sync); sync();

  const create = el('button', { class: 'btn btn-brass', style: 'margin-top:14px' }, 'Create ledger');
  const close = sheet(el('div', {},
    el('h3', { style: 'margin-bottom:14px' }, `New ledger — ${asset}`),
    el('div', { class: 'field-grid' },
      el('div', {}, el('label', {}, 'Type'), typeSel),
      el('div', {}, el('label', {}, 'Name'), nameInput),
      el('div', {}, el('label', {}, 'Frequency'), freqSel)
    ),
    note, create
  ));
  create.addEventListener('click', async () => {
    const t = getLedgerType(typeSel.value);
    const l = {
      id: uid(), vault: vaultId, asset,
      type: typeSel.value, name: nameInput.value.trim() || t?.name || 'Ledger',
      frequency: freqSel.value, entries: [],
      createdAt: Date.now(), updatedAt: Date.now()
    };
    await db.putLedger(l);
    close(); toast('Ledger created'); nav('ledger', { id: l.id });
  });
}

export async function ledgerView(root, nav, params) {
  const l = await db.getLedger(params.id);
  if (!l) { root.append(el('p', {}, 'Ledger not found.')); return; }
  const type = getLedgerType(l.type);
  const s = ledgerStatus(l);
  const tl = ledgerTimeline(l);

  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'back', onclick: () => nav('asset', { vault: l.vault, name: l.asset }) }, '‹'),
    el('h2', {}, `${type?.emoji || '🔁'} ${l.name}`)
  ));
  root.append(el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' },
    el('span', { class: 'chip chip-mute' }, l.asset), statusChip(s)
  ));
  root.append(el('p', { class: 'small muted', style: 'margin-bottom:16px' }, s.label));

  const addBtn = el('button', { class: 'btn btn-brass' }, '＋ Record payment');
  addBtn.addEventListener('click', () => addEntrySheet(l, nav));
  root.append(addBtn);

  const sec = el('section', { class: 'section' }, el('span', { class: 'eyebrow' }, 'Timeline'));
  const stack = el('div', { class: 'stack' });
  if (!tl.length || (tl.length === 1 && tl[0].state === 'due' && !l.entries.length)) {
    stack.append(el('p', { class: 'small muted' }, 'No payments recorded yet. Add your oldest receipt first — the timeline builds from there and flags any missing year in red.'));
  }
  for (const t of tl) {
    const e = t.entry;
    const row = el('div', { class: `ledger-row ${t.state}` },
      el('span', { class: `mark ${t.state === 'paid' ? 'ok' : t.state === 'due' ? 'due' : 'no'}` }, t.state === 'paid' ? '✓' : t.state === 'due' ? '⏳' : '✕'),
      el('div', { class: 'body' },
        el('b', { class: 'mono' }, t.label),
        el('span', { class: 'small muted' },
          e ? `Paid ${fmtDate(e.paidOn)}${e.amount ? ` · ₹${e.amount}` : ''}${e.pages?.length ? ` · ${e.pages.length} receipt pg` : ''}`
            : t.state === 'due' ? 'Current period — payment pending' : 'No receipt — unpaid or missing')
      ),
      e?.pages?.[0] ? el('img', { class: 'doc-thumb', style: 'width:40px;height:40px', src: blobURL(e.pages[0].thumb || e.pages[0].blob) }) : null,
      e ? el('button', { class: 'page-x', style: 'position:static', onclick: () => confirmSheet('Remove entry?', `${t.label} payment record will be deleted.`, 'Remove', async () => { l.entries = l.entries.filter(x => x.id !== e.id); await db.putLedger(l); nav('ledger', { id: l.id }); location.reload(); }) }, '✕') : null
    );
    if (e?.pages?.length) row.style.cursor = 'pointer';
    if (e?.pages?.length) row.addEventListener('click', (ev) => {
      if (ev.target.closest('.page-x')) return;
      const imgs = e.pages.map(p => el('img', { src: blobURL(p.blob), style: 'width:100%;border-radius:12px;margin-bottom:8px' }));
      sheet(el('div', {}, el('h3', { style: 'margin-bottom:12px' }, `${l.name} · ${t.label}`), ...imgs));
    });
    stack.append(row);
  }
  sec.append(stack);
  root.append(sec);

  root.append(el('section', { class: 'section' },
    el('button', { class: 'btn btn-danger', onclick: () => confirmSheet('Delete ledger?', `“${l.name}” and all its payment records will be removed permanently.`, 'Delete', async () => { await db.removeLedger(l.id); toast('Deleted'); nav('asset', { vault: l.vault, name: l.asset }); }) }, '🗑️ Delete ledger')
  ));
}

function addEntrySheet(l, nav) {
  const opts = periodOptions(l);
  const periodSel = el('select', {});
  opts.forEach(o => periodSel.append(el('option', { value: String(o.index), disabled: o.taken, selected: !o.taken && o.index === currentIndex(l.frequency) }, o.label + (o.taken ? ' ✓ recorded' : ''))));
  const paidInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const amtInput = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'e.g. 380', class: 'mono' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true });
  const save = el('button', { class: 'btn btn-brass', style: 'margin-top:14px' }, 'Save payment');

  const close = sheet(el('div', {},
    el('h3', { style: 'margin-bottom:14px' }, `Record payment — ${l.name}`),
    el('div', { class: 'field-grid' },
      el('div', {}, el('label', {}, 'Period'), periodSel),
      el('div', {}, el('label', {}, 'Paid on'), paidInput),
      el('div', {}, el('label', {}, 'Amount (₹)'), amtInput),
      el('div', {}, el('label', {}, 'Receipt photo(s)'), fileInput)
    ),
    save
  ));

  save.addEventListener('click', async () => {
    save.disabled = true;
    const pages = [];
    for (const f of [...fileInput.files]) {
      const { blob, thumb } = await compressImage(f);
      pages.push({ blob, thumb });
    }
    l.entries.push({
      id: uid(),
      periodIndex: parseInt(periodSel.value, 10),
      periodLabel: periodLabel(l.frequency, parseInt(periodSel.value, 10)),
      paidOn: paidInput.value,
      amount: amtInput.value.trim(),
      pages
    });
    await db.putLedger(l);
    close(); toast('Payment recorded ✓');
    nav('ledger', { id: l.id }); location.reload();
  });
}

/* ═══════════ ASK AI ═══════════ */
const chatHistory = [];
export async function askView(root, nav) {
  root.append(el('h1', {}, 'Ask'), el('p', { class: 'muted', style: 'margin-bottom:16px' }, 'Answers grounded on your own locker.'));

  const log = el('div', { class: 'chat-log' });
  if (!chatHistory.length) {
    log.append(el('div', { class: 'msg ai' }, 'Vanakkam 🙏 Ask me anything — “Is my Salem plot ready to sell?”, “Which kanthayam years am I missing?”, “Explain what an EC is”, “When does my health policy renew?”'));
  }
  chatHistory.forEach(m => log.append(el('div', { class: `msg ${m.role === 'user' ? 'user' : 'ai'}` }, m.text)));

  const input = el('input', { type: 'text', placeholder: 'Ask about your documents…' });
  const send = el('button', { onclick: submit }, '➤');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

  async function submit() {
    const q = input.value.trim();
    if (!q) return;
    if (!aiReady()) { toast('Set up AI in Settings first'); nav('settings'); return; }
    input.value = '';
    chatHistory.push({ role: 'user', text: q });
    log.append(el('div', { class: 'msg user' }, q));
    const thinking = el('div', { class: 'msg ai' }, el('span', { class: 'spinner on-dark' }));
    log.append(thinking);
    thinking.scrollIntoView({ behavior: 'smooth' });
    try {
      const docs = await db.all();
      const ledgers = await db.allLedgers();
      const ctx = {
        documents: docs.map(d => ({ title: d.title, vault: d.vault, type: d.docType, asset: d.asset, pages: d.pages?.length || 0, fields: d.fields, status: docStatus(d).label })),
        paymentLedgers: ledgers.map(l => ({ name: l.name, asset: l.asset, frequency: l.frequency, status: ledgerStatus(l).label, timeline: ledgerTimeline(l).map(t => `${t.label}:${t.state}`).join(' ') }))
      };
      const reply = await askAI(chatHistory, JSON.stringify(ctx).slice(0, 12000));
      chatHistory.push({ role: 'assistant', text: reply });
      thinking.textContent = reply;
    } catch (err) {
      thinking.textContent = '⚠️ ' + err.message;
    }
    thinking.scrollIntoView({ behavior: 'smooth' });
  }

  root.append(log, el('div', { class: 'chat-input' }, input, send));
}

/* ═══════════ SETTINGS ═══════════ */
export async function settingsView(root, nav) {
  root.append(el('h1', {}, 'Settings'));
  const cfg = getAIConfig();

  const providerSel = el('select', {},
    el('option', { value: '' }, 'Choose provider…'),
    el('option', { value: 'anthropic', selected: cfg.provider === 'anthropic' }, 'Anthropic (Claude) — works directly'),
    el('option', { value: 'azure', selected: cfg.provider === 'azure' }, 'Azure OpenAI — via APIM (CORS)')
  );
  const keyInput = el('input', { type: 'password', value: cfg.key || '', placeholder: 'API key' });
  const endpointInput = el('input', { type: 'text', value: cfg.endpoint || '', placeholder: 'https://your-apim.azure-api.net' });
  const deployInput = el('input', { type: 'text', value: cfg.deployment || '', placeholder: 'gpt-4o-mini' });
  const azureRows = el('div', { class: 'field-grid', style: cfg.provider === 'azure' ? '' : 'display:none' },
    el('div', {}, el('label', {}, 'Endpoint (APIM base URL)'), endpointInput),
    el('div', {}, el('label', {}, 'Deployment name'), deployInput),
    el('div', { class: 'ai-note' }, 'Azure OpenAI blocks browser calls (no CORS). Front it with your APIM and add a cors policy allowing this site\'s origin.')
  );
  providerSel.addEventListener('change', () => { azureRows.style.display = providerSel.value === 'azure' ? '' : 'none'; });

  const testBtn = el('button', { class: 'btn btn-ghost' }, 'Save & test connection');
  testBtn.addEventListener('click', async () => {
    saveAIConfig({ provider: providerSel.value, key: keyInput.value.trim(), endpoint: endpointInput.value.trim(), deployment: deployInput.value.trim() });
    if (!aiReady()) { toast('Fill in the required fields'); return; }
    testBtn.innerHTML = ''; testBtn.append(el('span', { class: 'spinner on-dark' }), ' Testing…');
    try {
      const reply = await askAI([{ role: 'user', text: 'Reply with exactly: OK' }], 'empty');
      toast(reply.includes('OK') ? '✅ AI connected' : '✅ Connected: ' + reply.slice(0, 40));
    } catch (err) { toast('❌ ' + err.message.slice(0, 80), 5000); }
    testBtn.textContent = 'Save & test connection';
  });

  root.append(el('section', { class: 'section' },
    el('span', { class: 'eyebrow' }, 'AI connection'),
    el('div', { class: 'field-grid', style: 'margin-top:12px' },
      el('div', {}, el('label', {}, 'Provider'), providerSel),
      azureRows,
      el('div', {}, el('label', {}, 'API key (stays on this phone)'), keyInput)
    ),
    el('div', { style: 'margin-top:12px' }, testBtn)
  ));

  const regUrl = el('input', { type: 'text', value: localStorage.getItem('pettagam.registryUrl') || '', placeholder: 'raw.githubusercontent.com/…/registry.json (optional)' });
  const regBtn = el('button', { class: 'btn btn-ghost' }, `Refresh registry (v${registryVersion()})`);
  regBtn.addEventListener('click', async () => {
    if (regUrl.value.trim()) localStorage.setItem('pettagam.registryUrl', regUrl.value.trim());
    else localStorage.removeItem('pettagam.registryUrl');
    try { const r = await refreshRegistry(); toast(`Registry v${r.version} · ${r.docTypes.length} doc types · ${(r.ledgerTypes || []).length} ledger types`); }
    catch (err) { toast('❌ ' + err.message); }
  });
  root.append(el('section', { class: 'section' },
    el('span', { class: 'eyebrow' }, 'Schema registry'),
    el('p', { class: 'small muted', style: 'margin:8px 0 12px' }, 'Document types, ledger types & the land checklist live in one JSON file. Edit it on GitHub, refresh here — the app learns new types with no code change.'),
    el('div', { class: 'field-grid' }, el('div', {}, el('label', {}, 'Custom registry URL'), regUrl)),
    el('div', { style: 'margin-top:12px' }, regBtn)
  ));

  const { usage, quota } = await db.usage();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const importInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    if (!f) return;
    try { const n = await importBackup(f); toast(`Restored ${n} items ✅`); nav('home'); }
    catch (err) { toast('❌ ' + err.message); }
  });
  root.append(el('section', { class: 'section' },
    el('span', { class: 'eyebrow' }, 'Storage & backup'),
    el('p', { class: 'small muted mono', style: 'margin:8px 0 12px' }, `Using ${fmtBytes(usage)} of ~${fmtBytes(quota)} · persistence ${persisted ? 'granted 🔒' : 'not granted'}`),
    el('div', { class: 'stack' },
      el('button', { class: 'btn btn-brass', onclick: async () => { const n = await exportBackup(); toast(`Exported ${n} items 💾`); } }, '💾 Export backup file'),
      el('button', { class: 'btn btn-ghost', onclick: () => importInput.click() }, '📥 Import backup'),
      importInput,
      el('button', { class: 'btn btn-ghost', onclick: async () => { const ok = await db.requestPersist(); toast(ok ? 'Storage persistence granted 🔒' : 'Browser declined — install as PWA & retry'); } }, '🔒 Request persistent storage')
    )
  ));

  root.append(el('p', { class: 'small muted', style: 'margin-top:32px;text-align:center' }, 'Pettagam · everything stays on this phone · v2.0'));
}
