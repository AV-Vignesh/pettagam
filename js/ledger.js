// ledger.js — recurring payment series (kanthayam, property tax, EB…).
// Periods follow the Indian financial year (Apr–Mar).
// yearly      → "2026-27"
// halfyearly  → "2026-27 H1" (Apr–Sep) / "H2" (Oct–Mar)
// monthly     → "2026-08"

function fyStartYear(d) { return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1; }

export function currentIndex(freq, d = new Date()) {
  if (freq === 'monthly') return d.getFullYear() * 12 + d.getMonth();
  const fy = fyStartYear(d);
  if (freq === 'halfyearly') return fy * 2 + ((d.getMonth() + 1 >= 4 && d.getMonth() + 1 <= 9) ? 0 : 1);
  return fy; // yearly
}

export function periodLabel(freq, idx) {
  if (freq === 'monthly') {
    const y = Math.floor(idx / 12), m = idx % 12;
    return `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  if (freq === 'halfyearly') {
    const fy = Math.floor(idx / 2);
    return `${fy}-${String((fy + 1) % 100).padStart(2, '0')} H${(idx % 2) + 1}`;
  }
  return `${idx}-${String((idx + 1) % 100).padStart(2, '0')}`;
}

// Options for the "add entry" period picker: a window around now,
// extended back to the earliest recorded entry.
export function periodOptions(ledger) {
  const now = currentIndex(ledger.frequency);
  const have = (ledger.entries || []).map(e => e.periodIndex);
  const earliest = have.length ? Math.min(...have) : now - backSpan(ledger.frequency);
  const opts = [];
  for (let i = now + 1; i >= Math.min(earliest, now - backSpan(ledger.frequency)); i--) {
    opts.push({ index: i, label: periodLabel(ledger.frequency, i), taken: have.includes(i) });
  }
  return opts;
}
function backSpan(freq) { return freq === 'monthly' ? 24 : freq === 'halfyearly' ? 10 : 6; }

// Timeline from first entry → current period, with paid / gap / due states.
export function ledgerTimeline(ledger) {
  const now = currentIndex(ledger.frequency);
  const entries = ledger.entries || [];
  const byIdx = Object.fromEntries(entries.map(e => [e.periodIndex, e]));
  const start = entries.length ? Math.min(...entries.map(e => e.periodIndex)) : now;
  const out = [];
  for (let i = start; i <= now; i++) {
    const e = byIdx[i];
    out.push({
      index: i,
      label: periodLabel(ledger.frequency, i),
      entry: e || null,
      state: e ? 'paid' : (i === now ? 'due' : 'gap')
    });
  }
  return out.reverse(); // latest first
}

export function ledgerStatus(ledger) {
  const tl = ledgerTimeline(ledger);
  const gaps = tl.filter(t => t.state === 'gap').length;
  const due = tl.some(t => t.state === 'due');
  if (gaps) return { state: 'gap', gaps, due, label: `${gaps} unpaid period${gaps === 1 ? '' : 's'}${due ? ' + current due' : ''}` };
  if (due) return { state: 'due', gaps: 0, due: true, label: `${periodLabel(ledger.frequency, currentIndex(ledger.frequency))} due` };
  return { state: 'ok', gaps: 0, due: false, label: 'Up to date' };
}

// Attention items for the home screen
export function ledgerAttention(ledgers) {
  return ledgers
    .map(l => ({ ledger: l, status: ledgerStatus(l) }))
    .filter(x => x.status.state !== 'ok')
    .sort((a, b) => b.status.gaps - a.status.gaps);
}
