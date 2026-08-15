// ai.js — image prep + AI decode + chat.
// Providers:
//  - anthropic: works directly from the browser (CORS supported)
//  - azure: Azure OpenAI — must be fronted by APIM with a CORS policy
//    (Azure OpenAI itself doesn't send CORS headers to browsers)
import { getDocTypes, getDocType } from './schemas.js';

export function getAIConfig() {
  try { return JSON.parse(localStorage.getItem('pettagam.ai') || '{}'); }
  catch { return {}; }
}
export function saveAIConfig(cfg) {
  localStorage.setItem('pettagam.ai', JSON.stringify(cfg));
}
export function aiReady() {
  const c = getAIConfig();
  if (c.provider === 'anthropic') return !!c.key;
  if (c.provider === 'azure') return !!(c.endpoint && c.deployment && c.key);
  return false;
}

/* ── image prep: kill the megabytes before storing/sending ── */
export async function compressImage(file, maxDim = 1600, quality = 0.8) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  // thumbnail
  const ts = Math.min(1, 300 / Math.max(w, h));
  const tc = document.createElement('canvas');
  tc.width = Math.round(w * ts); tc.height = Math.round(h * ts);
  tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
  const thumb = await new Promise(r => tc.toBlob(r, 'image/jpeg', 0.7));
  bmp.close?.();
  return { blob, thumb, width: w, height: h };
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/* ── provider calls ── */
async function callAnthropic(cfg, messages, system) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: cfg.model || 'claude-sonnet-4-6', max_tokens: 2000, system, messages })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function callAzure(cfg, messages, system) {
  const url = `${cfg.endpoint.replace(/\/$/, '')}/openai/deployments/${cfg.deployment}/chat/completions?api-version=${cfg.apiVersion || '2024-06-01'}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': cfg.key },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, ...messages], max_tokens: 2000, temperature: 0.1 })
  });
  if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function imageMessage(provider, b64, prompt) {
  if (provider === 'anthropic') {
    return [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: prompt }
    ]}];
  }
  return [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
    { type: 'text', text: prompt }
  ]}];
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1) throw new Error('AI did not return JSON');
  return JSON.parse(clean.slice(start, end + 1));
}

/* ── decode a document photo into structured fields ── */
export async function decodeDocument(b64, vault, forcedTypeId) {
  const cfg = getAIConfig();
  if (!aiReady()) throw new Error('AI not configured — set it up in Settings.');

  const candidates = forcedTypeId
    ? [getDocType(forcedTypeId)]
    : getDocTypes(vault);
  const catalog = candidates.map(t => ({
    id: t.id, name: t.name,
    fields: t.fields.map(f => ({ key: f.key, label: f.label, type: f.type }))
  }));

  const system = 'You extract structured data from photos of Indian documents (land records, IDs, medical, vehicle). Respond ONLY with a single JSON object, no markdown, no preamble.';
  const prompt =
`Identify which document type this image is from the catalog below, then extract every field you can read.

Catalog: ${JSON.stringify(catalog)}

Rules:
- Return: {"docType":"<id from catalog>","title":"<short human title e.g. 'Sale Deed – S.No 142/2B Salem'>","fields":{"<key>":"<value>"},"confidence":<0-1>,"notes":"<anything odd: unclear text, mismatches, warnings>"}
- Dates in YYYY-MM-DD. Amounts as plain numbers with no commas.
- Tamil/Hindi text: transliterate names, translate labels.
- If a field isn't visible, omit it. Never invent values.
- If nothing in the catalog fits, use the closest one and say so in notes.`;

  const messages = imageMessage(cfg.provider, b64, prompt);
  const text = cfg.provider === 'anthropic'
    ? await callAnthropic(cfg, messages, system)
    : await callAzure(cfg, messages, system);
  return parseJSON(text);
}

/* ── chat grounded on the user's stored documents ── */
export async function askAI(history, docsContext) {
  const cfg = getAIConfig();
  if (!aiReady()) throw new Error('AI not configured — set it up in Settings.');
  const system =
`You are Pettagam's assistant — an expert on Indian document management: land/property records (deeds, patta, EC, mutation, registration), identity documents, insurance, and vehicles. Tamil Nadu processes are especially relevant.
The user's stored documents (metadata only) are below. Use them to give specific, personal answers — flag missing documents, stale ECs, upcoming expiries, and next steps. Be concise and practical. You are not a lawyer; for sale/purchase decisions recommend a legal opinion as the final step.

USER'S LOCKER:
${docsContext}`;
  const messages = history.map(m => ({ role: m.role, content: m.text }));
  return cfg.provider === 'anthropic'
    ? callAnthropic(cfg, messages, system)
    : callAzure(cfg, messages, system);
}
