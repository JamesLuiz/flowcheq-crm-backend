import * as XLSX from 'xlsx';
import type { LeadImportRow } from './leadImportService';

const HEADER_ALIASES: Record<string, string[]> = {
  businessName: ['business name', 'business', 'company', 'name'],
  phone: ['phone', 'phone number', 'mobile', 'tel'],
  website: ['website', 'url', 'web'],
  city: ['city'],
  state: ['state', 'region'],
  country: ['country'],
  address: ['address', 'street'],
  industry: ['industry', 'sector', 'category', 'business type', 'business category'],
};

function normHeader(h: string): string {
  return h.trim().toLowerCase();
}

function mapHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalized = headers.map(normHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

function normalizePhone(raw: string, country: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const c = (country || '').toUpperCase();
  if (c === 'NG' || c === 'NIGERIA') {
    let n = digits.startsWith('234') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
    if (n.length < 9) return null;
    return `+234${n}`;
  }
  if (c === 'US' || c === 'USA') {
    let n = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
    if (n.length !== 10) return null;
    return `+1${n}`;
  }
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

function buildLocation(parts: { city: string; state: string; country: string; address: string }): string {
  const loc = [parts.city, parts.state, parts.country].filter(Boolean).join(', ');
  return loc || parts.address.slice(0, 120);
}

export function rowsToLeads(rows: string[][]): LeadImportRow[] {
  if (rows.length < 2) return [];
  const headerRow = rows[0].map((c) => String(c));
  const map = mapHeaders(headerRow);
  const leads: LeadImportRow[] = [];

  for (const row of rows.slice(1)) {
    const business = cell(row, map.businessName);
    const phoneRaw = cell(row, map.phone);
    if (!business || !phoneRaw) continue;

    const country = cell(row, map.country);
    const phone = normalizePhone(phoneRaw, country);
    if (!phone) continue;

    const lead: LeadImportRow = {
      name: business,
      businessName: business,
      phoneNumber: phone,
      location: buildLocation({
        city: cell(row, map.city),
        state: cell(row, map.state),
        country,
        address: cell(row, map.address),
      }),
      tags: ['Imported'],
    };
    const website = cell(row, map.website);
    if (website) lead.website = website;
    const industry = cell(row, map.industry);
    if (industry) lead.industry = industry;
    leads.push(lead);
  }
  return leads;
}

export function parseCsvBuffer(buffer: Buffer): LeadImportRow[] {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.map((line) => {
    const parts: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        parts.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    parts.push(cur.trim());
    return parts;
  });
  return rowsToLeads(rows);
}

export function parseXlsxBuffer(buffer: Buffer): LeadImportRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
  return rowsToLeads(rows);
}
