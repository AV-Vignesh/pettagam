// views.js — every screen. Rendered into #view by the router in app.js.
import { db, uid } from './db.js';
import { getVaults, getVault, getDocTypes, getDocType, getLandChecklist, refreshRegistry, registryVersion } from './schemas.js';
import { compressImage, blobToBase64, decodeDocument, askAI, getAIConfig, saveAIConfig, aiReady } from './ai.js';
import { docStatus, attention, healthScore, downloadICS } from './reminders.js';
import { exportBackup, importBackup, backupNudgeDue } from './backup.js';
import { el, toast, sheet, confirmSheet, fmtBytes, fmtDate, blobURL } from './ui.js';

const statusChip = (s) => {
  if (s.state === 'expired' || s.state === 'stale') return el('span', { class: 'chip chip-red' }, s.state === 'stale' ? 'STALE' : 'EXPIRED');
  if (s.state === 'soon') return el('span', { class: 'chip chip-amber' }, `${s.days}D LEFT`);
  if (s.state === 'ok') return el('span', { class: 'chip chip-green' }, 'VALID');
  return null;
};

const docRow = (doc, nav) => {
  const type = getDocType(doc.docType);
  const s = docStatus(doc);
  const img = doc.thumb
    ? el('img', { class: 'doc-thumb', src: blobURL(doc.thumb), alt: '' })
    : el('div', { class: 'doc-thumb ph' }, type?.emoji || '📄');
  return el('button', { class: 'doc-row', onclick: () => nav('doc', { id: doc.id }) },
    img,
    el('div', { class: 'body' },
      el('b', {}, doc.title || type?.name || 'Document'),
      el('span', { class: 'sub' }, [type?.name, doc.asset].filter(Boolean).join(' · '))
    ),
    statusChip(s)
  );
};

/* ═══════════ HOME ═══════════ */
export async function homeView(root, nav) {
  const docs = await db.all();
  const score = healthScore(docs);
  const attn = attention(docs);
  const trackable = docs.filter(d => docStatus(d).state !== 'none').length;

  const C = 2 * Math.PI * 78;
  const ring = el('div', { class: 'seal-wrap' },
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
  );

  root.append(
    el('header', { class: 'greet' },
      el('h1', {}, 'Pettagam'),
      el('p', { class: 'muted' }, docs.length ? `${docs.length} documents in your locker` : 'Your family document locker')
    ),
    ring,
    el('div', { class: 'stat-row' },
      el('div', { class: 'stat' }, el('b', { class: 'mono' }, String(docs.length)), el('span', {}, 'Documents')),
      el('div', { class: 'stat' }, el('b', { class: 'mono' }, String(trackable)), el('span', {}, 'Tracked')),
      el('div', { class: 'stat' }, el('b', { class: 'mono', style: attn.length ? 'color:var(--wax-red)' : '' }, String(attn.length)), el('span', {}, 'Need action'))
    )
  );

  if (attn.length) {
    const sec = el('section', { class: 'section' }, el('span', { class: 'eyebrow' }, 'Needs attention'));
    const stack = el('div', { class: 'stack' });
    for (const { doc, status } of attn.slice(0, 6)) {
      const color = status.state === 'soon' ? 'var(--turmeric)' : 'var(--wax-red)';
      stack.append(el('button', { class: 'attn', onclick: () => nav('doc', { id: doc.id }) },
        el('span', { class: 'dot', style: `background:${color}` }),
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
      el('p', {}, 'The locker is empty. Tap the brass button below to add your first document — snap a photo and let AI fill the form.')
    ));
  }

  if (docs.length && backupNudgeDue()) {
    root.append(el('section', { class: 'section' },
      el('div', { class: 'ai-note' }, '💾 It\'s been a while since your last backup. Export one from Settings — takes 5 seconds, survives a phone reset.')
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
    const filtered = docs.filter(d => {
      const hay = `${d.title} ${d.asset} ${JSON.stringify(d.fields)}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
    if (!filtered.length) {
      listRoot.append(el('div', { class: 'empty' }, el('span', { class: 'big' }, vault.emoji), el('p', {}, q ? 'No matches.' : `Nothing here yet. Add a ${vault.name.toLowerCase()} document with the brass + button.`)));
      return;
    }
    // group by asset
    const groups = {};
    for (const d of filtered) (groups[d.asset || 'Ungrouped'] ||= []).push(d);
    for (const [asset, list] of Object.entries(groups)) {
      listRoot.append(el('div', { class: 'asset-head' },
        el('h3', {}, asset),
        el('span', { class: 'small muted mono' }, `${list.length}`)
      ));
      // land readiness per asset
      if (vault.id === 'land' && asset !== 'Ungrouped') listRoot.append(readinessCard(list));
      const stack = el('div', { class: 'stack' });
      list.forEach(d => stack.append(docRow(d, nav)));
      listRoot.append(stack);
    }
  };
  search.addEventListener('input', () => render(search.value));
  render();
}

function readinessCard(assetDocs) {
  const have = new Set(assetDocs.map(d => d.docType));
  const items = getLandChecklist();
  const critMissing = items.filter(i => i.critical && !have.has(i.docType)).length;
  const staleCrit = assetDocs.filter(d => {
    const s = docStatus(d);
    return (s.state === 'stale' || s.state === 'expired');
  }).length;
  const ready = critMissing === 0 && staleCrit === 0;

  const body = el('div', { class: 'card', style: 'margin-bottom:12px' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
      el('span', { class: 'eyebrow' }, 'Sale readiness'),
      ready ? el('span', { class: 'chip chip-green' }, 'READY') : el('span', { class: 'chip chip-red' }, `${critMissing + staleCrit} GAP${critMissing + staleCrit === 1 ? '' : 'S'}`)
    )
  );
  for (const item of items) {
    const has = have.has(item.docType);
    const doc = assetDocs.find(d => d.docType === item.docType);
    const st = doc ? docStatus(doc) : null;
    const bad = st && (st.state === 'stale' || st.state === 'expired');
    let markCls = 'opt', mark = '·';
    if (has && !bad) { markCls = 'ok'; mark = '✓'; }
    else if (item.critical || bad) { markCls = 'no'; mark = '✕'; }
    body.append(el('div', { class: 'check' },
      el('span', { class: `mark ${markCls}` }, mark),
      el('span', { style: has && !bad ? '' : 'color:var(--paper-3)' }, item.label + (bad ? ' — needs refresh' : ''))
    ));
  }
  return body;
}

/* ═══════════ ADD FLOW ═══════════ */
export async function addView(root, nav) {
  root.append(el('h1', {}, 'Add document'));
  const state = { file: null, blob: null, thumb: null, vault: 'land', decoded: null };

  const step1 = el('div', { class: 'section' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  const drop = el('button', { class: 'drop', onclick: () => fileInput.click() },
    el('span', { class: 'big' }, '📸'),
    el('b', {}, 'Snap or pick a photo'),
    el('span', { class: 'small' }, 'Camera or gallery · compressed to ~300KB automatically')
  );
  const previewWrap = el('div', { class: 'stack', style: 'display:none' });
  step1.append(drop, fileInput, previewWrap);

  const step2 = el('div', { class: 'section', style: 'display:none' });
  root.append(step1, step2);

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    toast('Compressing…');
    const { blob, thumb } = await compressImage(f);
    state.blob = blob; state.thumb = thumb;
    drop.style.display = 'none';
    previewWrap.style.display = 'flex';
    previewWrap.innerHTML = '';
    previewWrap.append(
      el('img', { class: 'preview-img', src: blobURL(blob), alt: 'Document preview' }),
      el('span', { class: 'small muted' }, `Stored size: ${fmtBytes(blob.size)} (original ${fmtBytes(f.size)})`),
      el('button', { class: 'btn btn-ghost', onclick: () => { drop.style.display = 'flex'; previewWrap.style.display = 'none'; step2.style.display = 'none'; fileInput.value = ''; } }, 'Retake')
    );
    buildStep2();
  });

  function buildStep2() {
    step2.style.display = 'block';
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
      decodeBtn.innerHTML = ''; decodeBtn.append(el('span', { class: 'spinner' }), ' Reading document…'); decodeBtn.disabled = true;
      try {
        const b64 = await blobToBase64(state.blob);
        const result = await decodeDocument(b64, vaultSel.value, typeSel.value || null);
        state.decoded = result;
        toast(`Identified: ${getDocType(result.docType)?.name || result.docType}`);
        renderForm(formRoot, vaultSel.value, result.docType, result, nav, state);
      } catch (err) {
        toast('Decode failed — ' + err.message.slice(0, 60), 4000);
      }
      decodeBtn.textContent = '✨ Decode again'; decodeBtn.disabled = false;
    });
    manualBtn.addEventListener('click', () => {
      const t = typeSel.value || getDocTypes(vaultSel.value)[0]?.id;
      renderForm(formRoot, vaultSel.value, t, null, nav, state);
    });

    step2.append(
      el('div', { class: 'field-grid' },
        el('div', {}, el('label', {}, 'Vault'), vaultSel),
        el('div', {}, el('label', {}, 'Document type'), typeSel)
      ),
      el('div', { class: 'btn-row', style: 'margin-top:16px' }, decodeBtn, manualBtn),
      formRoot
    );
  }
}

function renderForm(formRoot, vaultId, docTypeId, decoded, nav, state) {
  const type = getDocType(docTypeId);
  if (!type) { toast('Unknown document type'); return; }
  const vault = getVault(type.vault) || getVault(vaultId);
  formRoot.innerHTML = '';
  const wrap = el('div', { class: 'section' });

  if (decoded?.notes) wrap.append(el('div', { class: 'ai-note', style: 'margin-bottom:12px' }, `🤖 ${decoded.notes} (confidence ${Math.round((decoded.confidence || 0) * 100)}%)`));

  const titleInput = el('input', { type: 'text', value: decoded?.title || type.name, placeholder: 'e.g. Sale Deed – Salem plot' });
  const assetInput = el('input', { type: 'text', value: '', placeholder: vault?.hasAssets ? `e.g. Salem Plot / Appa / Activa` : 'Optional group' });

  const grid = el('div', { class: 'field-grid' },
    el('div', {}, el('label', {}, 'Title'), titleInput),
    el('div', {}, el('label', {}, vault?.assetLabel || 'Group'), assetInput)
  );

  const inputs = {};
  for (const f of type.fields) {
    const val = decoded?.fields?.[f.key] || '';
    let input;
    if (f.type === 'textarea') input = el('textarea', { rows: 2 }, val);
    else input = el('input', { type: f.type === 'date' ? 'date' : 'text', value: val, class: f.mono ? 'mono' : '' });
    inputs[f.key] = input;
    grid.append(el('div', {}, el('label', {}, f.label), input));
  }
  if (type.freshnessNote || type.expiryNote) grid.append(el('div', { class: 'ai-note' }, `ℹ️ ${type.freshnessNote || type.expiryNote}`));

  const saveBtn = el('button', { class: 'btn btn-brass', style: 'margin-top:16px' }, '🔐 Lock it in');
  saveBtn.addEventListener('click', async () => {
    const fields = {};
    for (const [k, node] of Object.entries(inputs)) {
      const v = node.value.trim();
      if (v) fields[k] = v;
    }
    const doc = {
      id: uid(), vault: type.vault, docType: type.id,
      title: titleInput.value.trim() || type.name,
      asset: assetInput.value.trim() || '',
      fields, image: state.blob, thumb: state.thumb,
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

/* ═══════════ DOC DETAIL ═══════════ */
export async function docView(root, nav, params) {
  const doc = await db.get(params.id);
  if (!doc) { root.append(el('p', {}, 'Document not found.')); return; }
  const type = getDocType(doc.docType);
  const s = docStatus(doc);

  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'back', onclick: () => nav('vault', { id: doc.vault }) }, '‹'),
    el('h2', {}, doc.title)
  ));

  if (doc.image) {
    const img = el('img', { class: 'preview-img', src: blobURL(doc.image), alt: doc.title });
    img.addEventListener('click', () => {
      const full = el('img', { src: img.src, style: 'width:100%;border-radius:12px' });
      sheet(el('div', {}, full));
    });
    root.append(img);
  }

  const meta = el('div', { style: 'display:flex;gap:8px;align-items:center;margin:14px 0' },
    el('span', { class: 'chip chip-mute' }, `${type?.emoji || ''} ${type?.name || doc.docType}`),
    doc.asset ? el('span', { class: 'chip chip-mute' }, doc.asset) : null,
    statusChip(s)
  );
  root.append(meta);
  if (s.label) root.append(el('p', { class: 'small muted', style: 'margin-bottom:14px' }, s.label));

  const kv = el('div', { class: 'kv' });
  for (const f of (type?.fields || [])) {
    const v = doc.fields?.[f.key];
    if (!v) continue;
    kv.append(el('div', { class: 'k' }, f.label), el('div', { class: `v ${f.mono ? 'mono' : ''}` }, f.type === 'date' ? fmtDate(v) : v));
  }
  root.append(kv);

  const actions = el('div', { class: 'stack', style: 'margin-top:20px' });
  if (s.date) actions.append(el('button', { class: 'btn btn-ghost', onclick: () => { downloadICS(doc) ? toast('Calendar reminder downloaded 📅') : toast('No date to remind on'); } }, '📅 Add reminder to calendar'));
  actions.append(
    el('button', { class: 'btn btn-ghost', onclick: () => editDoc(doc, nav) }, '✏️ Edit details'),
    el('button', { class: 'btn btn-danger', onclick: () => confirmSheet('Delete document?', `“${doc.title}” and its photo will be removed from this phone permanently.`, 'Delete', async () => { await db.remove(doc.id); toast('Deleted'); nav('vault', { id: doc.vault }); }) }, '🗑️ Delete')
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

/* ═══════════ ASK AI ═══════════ */
const chatHistory = [];
export async function askView(root, nav) {
  root.append(el('h1', {}, 'Ask'), el('p', { class: 'muted', style: 'margin-bottom:16px' }, 'Answers grounded on your own locker.'));

  const log = el('div', { class: 'chat-log' });
  if (!chatHistory.length) {
    log.append(el('div', { class: 'msg ai' }, 'Vanakkam 🙏 Ask me anything — “Is my Salem plot ready to sell?”, “What documents am I missing?”, “Explain what an EC is”, “When does my health policy renew?”'));
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
      const ctx = docs.map(d => ({
        title: d.title, vault: d.vault, type: d.docType, asset: d.asset,
        fields: d.fields, status: docStatus(d).label
      }));
      const reply = await askAI(chatHistory, JSON.stringify(ctx).slice(0, 12000) || 'Locker is empty.');
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

  /* AI */
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

  /* Registry */
  const regUrl = el('input', { type: 'text', value: localStorage.getItem('pettagam.registryUrl') || '', placeholder: 'raw.githubusercontent.com/…/registry.json (optional)' });
  const regBtn = el('button', { class: 'btn btn-ghost' }, `Refresh registry (v${registryVersion()})`);
  regBtn.addEventListener('click', async () => {
    if (regUrl.value.trim()) localStorage.setItem('pettagam.registryUrl', regUrl.value.trim());
    else localStorage.removeItem('pettagam.registryUrl');
    try { const r = await refreshRegistry(); toast(`Registry v${r.version} · ${r.docTypes.length} doc types`); }
    catch (err) { toast('❌ ' + err.message); }
  });
  root.append(el('section', { class: 'section' },
    el('span', { class: 'eyebrow' }, 'Schema registry'),
    el('p', { class: 'small muted', style: 'margin:8px 0 12px' }, 'Document types & land checklist live in one JSON file. Edit it on GitHub, refresh here — the app learns new document types with no code change.'),
    el('div', { class: 'field-grid' }, el('div', {}, el('label', {}, 'Custom registry URL'), regUrl)),
    el('div', { style: 'margin-top:12px' }, regBtn)
  ));

  /* Storage & backup */
  const { usage, quota } = await db.usage();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  const importInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    if (!f) return;
    try { const n = await importBackup(f); toast(`Restored ${n} documents ✅`); nav('home'); }
    catch (err) { toast('❌ ' + err.message); }
  });
  root.append(el('section', { class: 'section' },
    el('span', { class: 'eyebrow' }, 'Storage & backup'),
    el('p', { class: 'small muted mono', style: 'margin:8px 0 12px' }, `Using ${fmtBytes(usage)} of ~${fmtBytes(quota)} · persistence ${persisted ? 'granted 🔒' : 'not granted'}`),
    el('div', { class: 'stack' },
      el('button', { class: 'btn btn-brass', onclick: async () => { const n = await exportBackup(); toast(`Exported ${n} documents 💾`); } }, '💾 Export backup file'),
      el('button', { class: 'btn btn-ghost', onclick: () => importInput.click() }, '📥 Import backup'),
      importInput,
      el('button', { class: 'btn btn-ghost', onclick: async () => { const ok = await db.requestPersist(); toast(ok ? 'Storage persistence granted 🔒' : 'Browser declined — install as PWA & retry'); } }, '🔒 Request persistent storage')
    )
  ));

  root.append(el('p', { class: 'small muted', style: 'margin-top:32px;text-align:center' }, 'Pettagam · everything stays on this phone · v1.0'));
}
