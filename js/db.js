// db.js — IndexedDB layer (v2): multi-page docs + ledgers.
// Blobs live in IndexedDB (quota = share of free disk, GBs) — not localStorage (5MB).
const DB_NAME = 'pettagam';
const DB_VER = 2;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('docs')) {
        const s = d.createObjectStore('docs', { keyPath: 'id' });
        s.createIndex('vault', 'vault');
        s.createIndex('asset', 'asset');
      }
      if (!d.objectStoreNames.contains('ledgers')) {
        const l = d.createObjectStore('ledgers', { keyPath: 'id' });
        l.createIndex('asset', 'asset');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function reqP(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}
async function store(name, mode = 'readonly') {
  const d = await open();
  return d.transaction(name, mode).objectStore(name);
}

// v1 docs had {image, thumb}; v2 uses pages:[{blob, thumb}]. Normalize lazily.
export function ensurePages(doc) {
  if (!doc) return doc;
  if (!Array.isArray(doc.pages)) {
    doc.pages = doc.image ? [{ blob: doc.image, thumb: doc.thumb || null }] : [];
    delete doc.image; delete doc.thumb;
  }
  return doc;
}

export const db = {
  async put(doc) { doc.updatedAt = Date.now(); await reqP((await store('docs', 'readwrite')).put(doc)); return doc; },
  async get(id) { return ensurePages(await reqP((await store('docs')).get(id)) || null); },
  async all() { return (await reqP((await store('docs')).getAll()) || []).map(ensurePages); },
  async byVault(v) { return (await reqP((await store('docs')).index('vault').getAll(v)) || []).map(ensurePages); },
  async remove(id) { return reqP((await store('docs', 'readwrite')).delete(id)); },

  async putLedger(l) { l.updatedAt = Date.now(); await reqP((await store('ledgers', 'readwrite')).put(l)); return l; },
  async getLedger(id) { return await reqP((await store('ledgers')).get(id)) || null; },
  async allLedgers() { return await reqP((await store('ledgers')).getAll()) || []; },
  async removeLedger(id) { return reqP((await store('ledgers', 'readwrite')).delete(id)); },

  async requestPersist() {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return navigator.storage.persist();
    }
    return false;
  },
  async usage() {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
    return { usage: 0, quota: 0 };
  }
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
