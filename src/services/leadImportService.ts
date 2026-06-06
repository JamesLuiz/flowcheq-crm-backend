import { db } from '../store/db';
import { normalizeWebsiteUrl } from '../utils/url';
import { normalizeGoogleMapsUrl } from '../utils/googleMaps';

export interface LeadImportRow {
  name: string;
  businessName: string;
  phoneNumber: string;
  location: string;
  website?: string;
  industry?: string;
  googleMapsUrl?: string;
  tags?: string[];
}

export interface LeadImportOptions {
  /** When true, update matching contacts by phone instead of skipping them */
  updateExisting?: boolean;
}

export interface LeadImportStats {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { phoneNumber: string; error: string }[];
}

function normalizeWebsite(raw?: string): string {
  if (!raw?.trim()) return '';
  return normalizeWebsiteUrl(raw) || raw.trim();
}

export async function importLeads(
  leads: LeadImportRow[],
  options: LeadImportOptions = {}
): Promise<LeadImportStats> {
  const updateExisting = Boolean(options.updateExisting);
  const stats: LeadImportStats = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const lead of leads) {
    try {
      if (!lead.name?.trim() || !lead.phoneNumber?.trim()) {
        stats.failed++;
        stats.errors.push({
          phoneNumber: lead.phoneNumber || '',
          error: 'Name and phone number are required.',
        });
        continue;
      }

      const existing = await db.getContactByPhoneNumber(lead.phoneNumber);
      const website = normalizeWebsite(lead.website);
      const googleMapsUrl = normalizeGoogleMapsUrl(lead.googleMapsUrl);

      if (existing) {
        if (!updateExisting) {
          stats.skipped++;
          continue;
        }

        const updates: {
          name: string;
          businessName: string;
          location: string;
          website?: string;
          industry?: string;
          googleMapsUrl?: string;
        } = {
          name: lead.name.trim(),
          businessName: (lead.businessName || lead.name).trim(),
          location: (lead.location || '').trim(),
        };

        if (website) {
          updates.website = website;
        }
        if (lead.industry?.trim()) {
          updates.industry = lead.industry.trim();
        }
        if (googleMapsUrl) {
          updates.googleMapsUrl = googleMapsUrl;
        }

        await db.updateContact(existing._id, updates);
        stats.updated++;
        continue;
      }

      await db.createContact({
        name: lead.name.trim(),
        businessName: (lead.businessName || lead.name).trim(),
        phoneNumber: lead.phoneNumber,
        location: (lead.location || '').trim(),
        website,
        industry: (lead.industry || '').trim(),
        googleMapsUrl,
        tags: lead.tags?.length ? lead.tags : ['Imported'],
      });
      stats.created++;
    } catch (e) {
      stats.failed++;
      stats.errors.push({
        phoneNumber: lead.phoneNumber,
        error: e instanceof Error ? e.message : 'Import failed',
      });
    }
  }

  return stats;
}
