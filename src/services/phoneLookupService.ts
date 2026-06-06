import { config } from '../config';
import { db } from '../store/db';
import { normalizePhoneToE164 } from '../utils/phone';
import type { Contact } from '../types';

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PhoneLookupResult {
  lineType: string;
  smsCapable: boolean | null;
  carrierName: string;
  phoneLookupAt: string;
  cached: boolean;
  source: 'telnyx' | 'cache' | 'unknown';
}

function normalizeLineType(raw?: string): string {
  const t = (raw || 'unknown').toLowerCase().trim();
  if (!t || t === 'unknown') return 'unknown';
  if (t.includes('mobile') || t === 'wireless') return 'mobile';
  if (t.includes('fixed') || t.includes('landline')) return 'fixed_line';
  if (t.includes('voip')) return 'voip';
  if (t.includes('toll')) return 'toll_free';
  if (t.includes('pager')) return 'pager';
  return t.replace(/\s+/g, '_');
}

export function smsCapableFromLineType(lineType: string): boolean | null {
  switch (lineType) {
    case 'mobile':
      return true;
    case 'fixed_line':
    case 'toll_free':
    case 'pager':
      return false;
    default:
      return null;
  }
}

function lookupFromContact(contact: Contact): PhoneLookupResult | null {
  if (!contact.phoneLookupAt) return null;
  const at = new Date(contact.phoneLookupAt).getTime();
  if (Number.isNaN(at) || Date.now() - at > CACHE_MS) return null;

  const lineType = contact.lineType || 'unknown';
  return {
    lineType,
    smsCapable: contact.smsCapable ?? smsCapableFromLineType(lineType),
    carrierName: contact.carrierName || '',
    phoneLookupAt: contact.phoneLookupAt,
    cached: true,
    source: 'cache',
  };
}

async function telnyxLookup(e164: string): Promise<PhoneLookupResult> {
  const telnyxApiKey = config.telnyx.apiKey;
  if (!telnyxApiKey) {
    return {
      lineType: 'unknown',
      smsCapable: null,
      carrierName: '',
      phoneLookupAt: new Date().toISOString(),
      cached: false,
      source: 'unknown',
    };
  }

  const encoded = encodeURIComponent(e164);
  const res = await fetch(`https://api.telnyx.com/v2/number_lookup/${encoded}?type=carrier`, {
    headers: { Authorization: `Bearer ${telnyxApiKey}` },
  });

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.trim() || 'Telnyx number lookup failed.');
  }

  if (!res.ok) {
    const err = (data as { errors?: { code?: string; title?: string; detail?: string }[] }).errors?.[0];
    const parts = [err?.code, err?.title, err?.detail].filter(Boolean);
    throw new Error(parts.join(': ') || 'Telnyx number lookup failed.');
  }

  const payload = (data as { data?: Record<string, unknown> }).data || {};
  const carrier = (payload.carrier as { name?: string; type?: string }) || {};
  const portability = (payload.portability as { line_type?: string }) || {};
  const lineType = normalizeLineType(portability.line_type || carrier.type);
  const smsCapable = smsCapableFromLineType(lineType);

  return {
    lineType,
    smsCapable,
    carrierName: String(carrier.name || '').trim(),
    phoneLookupAt: new Date().toISOString(),
    cached: false,
    source: 'telnyx',
  };
}

export async function getContactPhoneLookup(
  contactId: string,
  options?: { refresh?: boolean }
): Promise<{ contact: Contact; lookup: PhoneLookupResult } | null> {
  const contact = await db.getContactById(contactId);
  if (!contact?.phoneNumber?.trim()) return null;

  if (!options?.refresh) {
    const cached = lookupFromContact(contact);
    if (cached) return { contact, lookup: cached };
  }

  let e164: string;
  try {
    e164 = normalizePhoneToE164(contact.phoneNumber);
  } catch {
    return {
      contact,
      lookup: {
        lineType: 'unknown',
        smsCapable: null,
        carrierName: '',
        phoneLookupAt: contact.phoneLookupAt || '',
        cached: true,
        source: 'unknown',
      },
    };
  }

  try {
    const lookup = await telnyxLookup(e164);
    const updated = await db.updateContact(contactId, {
      lineType: lookup.lineType,
      smsCapable: lookup.smsCapable,
      carrierName: lookup.carrierName,
      phoneLookupAt: lookup.phoneLookupAt,
    });
    return { contact: updated || contact, lookup };
  } catch (err) {
    const cached = lookupFromContact(contact);
    if (cached) return { contact, lookup: cached };

    throw err;
  }
}

export async function ensureSmsCheck(contact: Contact): Promise<Contact> {
  if (lookupFromContact(contact)) {
    return (await db.getContactById(contact._id)) || contact;
  }
  const result = await getContactPhoneLookup(contact._id);
  return result?.contact || contact;
}

export function isNonMobileTelnyxError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('40021') || lower.includes('not a mobile') || lower.includes('mobile-only');
}
