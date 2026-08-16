// backup.js — phone-reset insurance. Full locker (docs w/ pages + ledgers
// w/ receipt pages) into one .json; import restores v1 and v2 bundles.
import { db } from './db.js';
import { blobToBase64 } from './ai.js';

async function pagesOut(pages) {
  const out = [];
  for (const p of pages || []) out.push({
    blob: p.blob instanceof Blob ? await blobToBase64(p.blob) : p.blob,
    thumb: p.thumb instanceof Blob ? await blobToBase64(p.thumb) : p.thumb
  });
  return out;
}
function b64ToBlob(b64, type = 'image/jpeg') {
  if (!b64 || b64 instanceof Blob) return b64 || null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
function pagesIn(pages) {
  return (pages || []).map(p => ({ blob: b64ToBlob(p.blob), thumb: b64ToBlob(p.thumb) }));
}

export async function exportBackup() {
  const docs = await db.all();
  const ledgers = await db.allLedgers();
  const outDocs = [];
  for (const d of docs) outDocs.push({ ...d, pages: await pagesOut(d.pages) });
  const outLedgers = [];
  for (const l of ledgers) {
    const entries = [];
    for (const e of l.entries || []) entries.push({ ...e, pages: await pagesOut(e.pages) });
    outLedgers.push({ ...l, entries });
  }
  const bundle = { app: 'pettagam', version: 2, exported: new Date().toISOString(),
    count: outDocs.length + outLedgers.length, docs: outDocs, ledgers: outLedgers };
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pettagam-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  localStorage.setItem('pettagam.lastBackup', Date.now().toString());
  return bundle.count;
}

export async function importBackup(file) {
  const bundle = JSON.parse(await file.text());
  if (bundle.app !== 'pettagam') throw new Error('Not a Pettagam backup file');
  let n = 0;
  for (const d of bundle.docs || []) {
    if (Array.isArray(d.pages)) d.pages = pagesIn(d.pages);
    else { // v1 bundle
      d.pages = d.image ? [{ blob: b64ToBlob(d.image), thumb: b64ToBlob(d.thumb) }] : [];
      delete d.image; delete d.thumb;
    }
    await db.put(d); n++;
  }
  for (const l of bundle.ledgers || []) {
    l.entries = (l.entries || []).map(e => ({ ...e, pages: pagesIn(e.pages) }));
    await db.putLedger(l); n++;
  }
  return n;
}

export function backupNudgeDue() {
  const last = parseInt(localStorage.getItem('pettagam.lastBackup') || '0', 10);
  return !last || (Date.now() - last) > 30 * 86400000;
}
