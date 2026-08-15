// backup.js — the phone-reset insurance. Exports the whole locker
// (metadata + images as base64) into one .json file; import restores it.
import { db } from './db.js';
import { blobToBase64 } from './ai.js';

export async function exportBackup() {
  const docs = await db.all();
  const out = [];
  for (const d of docs) {
    const copy = { ...d };
    if (d.image instanceof Blob) copy.image = await blobToBase64(d.image);
    if (d.thumb instanceof Blob) copy.thumb = await blobToBase64(d.thumb);
    out.push(copy);
  }
  const bundle = { app: 'pettagam', version: 1, exported: new Date().toISOString(), count: out.length, docs: out };
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pettagam-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  localStorage.setItem('pettagam.lastBackup', Date.now().toString());
  return out.length;
}

function b64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function importBackup(file) {
  const text = await file.text();
  const bundle = JSON.parse(text);
  if (bundle.app !== 'pettagam' || !Array.isArray(bundle.docs)) throw new Error('Not a Pettagam backup file');
  let n = 0;
  for (const d of bundle.docs) {
    if (typeof d.image === 'string') d.image = b64ToBlob(d.image);
    if (typeof d.thumb === 'string') d.thumb = b64ToBlob(d.thumb);
    await db.put(d);
    n++;
  }
  return n;
}

export function backupNudgeDue() {
  const last = parseInt(localStorage.getItem('pettagam.lastBackup') || '0', 10);
  return !last || (Date.now() - last) > 30 * 86400000;
}
