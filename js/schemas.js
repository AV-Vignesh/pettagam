// schemas.js — the dynamic framework.
// Doc types live in schemas/registry.json. Edit that file on GitHub,
// hit "Refresh registry" in Settings (or just reload), and the app
// learns new document types with zero code changes.
const CACHE_KEY = 'pettagam.registry';
let registry = null;

export async function loadRegistry() {
  if (registry) return registry;
  // 1. cached copy (works fully offline)
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) registry = JSON.parse(cached);
  } catch (_) {}
  // 2. bundled/remote copy — network wins if newer
  try {
    const url = localStorage.getItem('pettagam.registryUrl') || 'schemas/registry.json';
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) {
      const fresh = await res.json();
      if (!registry || (fresh.version || 0) >= (registry.version || 0)) {
        registry = fresh;
        localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
      }
    }
  } catch (_) { /* offline — cached copy carries us */ }
  if (!registry) throw new Error('No schema registry available. Go online once.');
  return registry;
}

export async function refreshRegistry() {
  registry = null;
  localStorage.removeItem(CACHE_KEY);
  return loadRegistry();
}

export function getVaults() { return registry?.vaults || []; }
export function getVault(id) { return getVaults().find(v => v.id === id); }
export function getDocTypes(vault) {
  const all = registry?.docTypes || [];
  return vault ? all.filter(t => t.vault === vault) : all;
}
export function getDocType(id) { return (registry?.docTypes || []).find(t => t.id === id); }
export function getLandChecklist() { return registry?.landChecklist || []; }
export function registryVersion() { return registry?.version || 0; }
