import { config } from '../config';
import type { Contact } from '../types';

export const CAMPAIGN_MERGE_FIELDS = [
  'name',
  'businessName',
  'business',
  'location',
  'website',
  'phone',
  'consultationUrl',
] as const;

export function consultationUrl(): string {
  return config.campaign.consultationUrl;
}

export function applyMergeFields(template: string, contact: Contact, consultUrl?: string): string {
  const url = consultUrl || consultationUrl();
  return template
    .replace(/\{\{name\}\}/gi, contact.name || '')
    .replace(/\{\{businessName\}\}/gi, contact.businessName || contact.name || '')
    .replace(/\{\{business\}\}/gi, contact.businessName || contact.name || '')
    .replace(/\{\{location\}\}/gi, contact.location || '')
    .replace(/\{\{website\}\}/gi, contact.website || '')
    .replace(/\{\{phone\}\}/gi, contact.phoneNumber || '')
    .replace(/\{\{consultationUrl\}\}/gi, url);
}

export function ensureConsultationLink(text: string, include: boolean, consultUrl?: string): string {
  if (!include) return text.trim();
  const url = consultUrl || consultationUrl();
  if (text.includes(url)) return text.trim();
  return `${text.trim()}\n\nBook your consultation: ${url}`;
}

export function smsSegmentInfo(text: string): { length: number; segments: number } {
  const len = text.length;
  const segments = len === 0 ? 0 : len <= 160 ? 1 : Math.ceil(len / 153);
  return { length: len, segments };
}

export const DEFAULT_CAMPAIGN_TEMPLATE = `Hi {{name}}, Flowcheq helps {{businessName}} turn conversations into booked consultations. Visit {{consultationUrl}} for a free consult.`;
