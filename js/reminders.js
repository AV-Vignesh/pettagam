// reminders.js — expiry + freshness engine, and .ics export so the
// phone's native calendar does the reliable nagging.
import { getDocType } from './schemas.js';
import { ledgerStatus } from './ledger.js';

const DAY = 86400000;
const SOON_DAYS = 60;

export function docStatus(doc) {
  const type = getDocType(doc.docType);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 1. explicit expiry field
  const expiryKey = type?.fields.find(f => f.role === 'expiry')?.key;
  const expiryVal = expiryKey && doc.fields?.[expiryKey];
  if (expiryVal) {
    const exp = new Date(expiryVal);
    if (!isNaN(exp)) {
      const days = Math.round((exp - today) / DAY);
      if (days < 0) return { state: 'expired', days, date: expiryVal, label: `Expired ${Math.abs(days)}d ago` };
      if (days <= SOON_DAYS) return { state: 'soon', days, date: expiryVal, label: `Expires in ${days}d` };
      return { state: 'ok', days, date: expiryVal, label: `Valid till ${expiryVal}` };
    }
  }
  // 2. freshness window from issue date (EC, patta, tax receipts)
  if (type?.freshnessMonths) {
    const issueKey = type.fields.find(f => f.role === 'issue')?.key;
    const issueVal = issueKey && doc.fields?.[issueKey];
    if (issueVal) {
      const stale = new Date(issueVal);
      if (!isNaN(stale)) {
        stale.setMonth(stale.getMonth() + type.freshnessMonths);
        const days = Math.round((stale - today) / DAY);
        if (days < 0) return { state: 'stale', days, date: iso(stale), label: `Stale — refresh (${type.freshnessMonths}mo window)` };
        if (days <= SOON_DAYS) return { state: 'soon', days, date: iso(stale), label: `Goes stale in ${days}d` };
        return { state: 'ok', days, date: iso(stale), label: `Fresh till ${iso(stale)}` };
      }
    }
    return { state: 'none', label: 'Add issue date to track freshness' };
  }
  return { state: 'none', label: '' };
}

const iso = d => d.toISOString().slice(0, 10);

export function attention(docs) {
  return docs
    .map(d => ({ doc: d, status: docStatus(d) }))
    .filter(x => ['expired', 'stale', 'soon'].includes(x.status.state))
    .sort((a, b) => (a.status.days ?? 0) - (b.status.days ?? 0));
}

export function healthScore(docs, ledgers = []) {
  const tracked = docs.map(docStatus).filter(s => s.state !== 'none');
  const lstats = ledgers.map(ledgerStatus);
  const units = tracked.length + lstats.length;
  if (!units) return 100;
  let penalty = 0;
  penalty += tracked.filter(s => s.state === 'expired' || s.state === 'stale').length * 100;
  penalty += tracked.filter(s => s.state === 'soon').length * 40;
  penalty += lstats.filter(s => s.state === 'gap').length * 100;
  penalty += lstats.filter(s => s.state === 'due').length * 40;
  return Math.max(0, Math.round(100 - penalty / units));
}

/* ── .ics: one tap → native calendar reminder ── */
export function downloadICS(doc) {
  const status = docStatus(doc);
  if (!status.date) return false;
  const d = status.date.replace(/-/g, '');
  const uidStr = `${doc.id}@pettagam`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pettagam//EN',
    'BEGIN:VEVENT',
    `UID:${uidStr}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d}`,
    `SUMMARY:📄 ${(doc.title || 'Document')} — renew/refresh`,
    `DESCRIPTION:Pettagam reminder. Status: ${status.label}`,
    'BEGIN:VALARM', 'TRIGGER:-P14D', 'ACTION:DISPLAY',
    `DESCRIPTION:${doc.title || 'Document'} due in 2 weeks`,
    'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(doc.title || 'reminder').replace(/[^\w]+/g, '_')}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
