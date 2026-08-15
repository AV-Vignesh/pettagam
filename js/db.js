// db.js — IndexedDB layer. This is what beats the 5MB localStorage limit:
// blobs go into IndexedDB (quota = a share of free disk, typically GBs).
const DB_NAME = 'pettagam';
const DB_VER = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('docs')) {
        const s = db.createObjectStore('docs', { keyPath: 'id' });
        s.createIndex('vault', 'vault');
        s.createIndex('asset', 'asset');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction('docs', mode);
    const out = fn(t.objectStore('docs'));
    t.oncomplete = () => resolve(out && out._val !== undefined ? out._val : out);
    t.onerror = () => reject(t.error);
  }));
}

export const db = {
  async put(doc) {
    doc.updatedAt = Date.now();
    await tx('readwrite', s => s.put(doc));
    return doc;
  },
  async get(id) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction('docs').objectStore('docs').get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  },
  async all() {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction('docs').objectStore('docs').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async byVault(vault) {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction('docs').objectStore('docs').index('vault').getAll(vault);
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  async remove(id) {
    return tx('readwrite', s => s.delete(id));
  },
  async requestPersist() {
    // Ask the browser to protect this data from eviction
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
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
