import type { Contact } from '../types';

export type GoogleMapsUrlSource = 'places' | 'search';

export function buildGoogleMapsSearchUrl(query: string): string {
  const q = query.trim();
  if (!q) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

const MAPS_URL_PATTERN =
  /google\.(com|[a-z]{2,3})\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i;

export function normalizeGoogleMapsUrl(raw?: string): string {
  if (!raw?.trim()) return '';
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

export function isGoogleMapsUrl(url: string): boolean {
  return MAPS_URL_PATTERN.test(url);
}

function mapsQueryFromContact(contact: Contact): string {
  const parts = [contact.businessName, contact.name, contact.location]
    .map((p) => (p || '').trim())
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}

/** Prefer contact DB URL, then insight; fall back to Maps search from business + location. */
export function resolveGoogleMapsUrl(
  contact: Contact,
  insightMapsUrl?: string | null
): { url: string; source: GoogleMapsUrlSource; label: string } | null {
  const stored = contact.googleMapsUrl?.trim();
  const placesUrl = (stored || insightMapsUrl || '').trim();

  if (placesUrl && isGoogleMapsUrl(placesUrl)) {
    return { url: placesUrl, source: 'places', label: 'View map pin' };
  }

  const query = mapsQueryFromContact(contact);
  if (!query) return null;

  return {
    url: buildGoogleMapsSearchUrl(query),
    source: 'search',
    label: 'View on Google Maps',
  };
}
