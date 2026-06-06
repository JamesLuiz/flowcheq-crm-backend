import { config } from '../config';
import { db } from '../store/db';
import { ContactInsightModel } from '../store/schemas';
import type { Contact, ContactInsight, SuggestedMessage } from '../types';
import { triggerBusinessEnrich } from './n8nService';
import { resolveGoogleMapsUrl } from '../utils/googleMaps';

function toInsight(doc: Record<string, unknown>): ContactInsight {
  return {
    _id: String(doc._id),
    contactId: String(doc.contactId),
    status: (doc.status as ContactInsight['status']) || 'pending',
    googleRating: doc.googleRating != null ? Number(doc.googleRating) : undefined,
    reviewCount: doc.reviewCount != null ? Number(doc.reviewCount) : undefined,
    googleMapsUrl: doc.googleMapsUrl ? String(doc.googleMapsUrl) : '',
    scrapedSummary: doc.scrapedSummary ? String(doc.scrapedSummary) : '',
    needs: Array.isArray(doc.needs) ? (doc.needs as string[]) : [],
    weaknesses: Array.isArray(doc.weaknesses) ? (doc.weaknesses as string[]) : [],
    fixes: Array.isArray(doc.fixes) ? (doc.fixes as string[]) : [],
    recommendations: Array.isArray(doc.recommendations) ? (doc.recommendations as string[]) : [],
    suggestedMessages: Array.isArray(doc.suggestedMessages)
      ? (doc.suggestedMessages as SuggestedMessage[])
      : [],
    followUpMessage: doc.followUpMessage ? String(doc.followUpMessage) : '',
    error: doc.error ? String(doc.error) : undefined,
    createdAt: doc.createdAt ? new Date(String(doc.createdAt)).toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? new Date(String(doc.updatedAt)).toISOString() : new Date().toISOString(),
  };
}

export async function getInsightByContactId(contactId: string): Promise<ContactInsight | null> {
  const doc = await ContactInsightModel.findOne({ contactId }).lean();
  return doc ? toInsight(doc as Record<string, unknown>) : null;
}

export async function upsertInsightPending(contactId: string): Promise<ContactInsight> {
  const doc = await ContactInsightModel.findOneAndUpdate(
    { contactId },
    {
      $set: { status: 'pending', error: '', updatedAt: new Date() },
      $setOnInsert: { _id: `ins_${Math.random().toString(36).substring(2, 11)}`, contactId },
    },
    { upsert: true, new: true }
  ).lean();
  return toInsight(doc as Record<string, unknown>);
}

export async function saveInsightFromWebhook(
  contactId: string,
  payload: Record<string, unknown>
): Promise<ContactInsight> {
  const suggestedMessages = Array.isArray(payload.suggested_messages)
    ? (payload.suggested_messages as { id?: string; label?: string; text?: string }[]).map((m, i) => ({
        id: m.id || `msg_${i + 1}`,
        label: m.label || `Option ${i + 1}`,
        text: m.text || '',
      }))
    : [];

  const consultationUrl = config.campaign.consultationUrl;
  if (suggestedMessages.length === 0) {
    const contact = await db.getContactById(contactId);
    const name = contact?.name || 'there';
    suggestedMessages.push(
      {
        id: 'consultation',
        label: 'Book consultation',
        text: `Hi ${name}, Flowcheq helps businesses like yours grow with smarter outreach. Book a free consultation: ${consultationUrl}`,
      },
      {
        id: 'followup',
        label: 'Quick follow-up',
        text: `Hi ${name}, following up — we'd love to show how Flowcheq can help. Learn more: ${consultationUrl}`,
      }
    );
  }

  const doc = await ContactInsightModel.findOneAndUpdate(
    { contactId },
    {
      $set: {
        status: 'ready',
        googleRating: payload.google_rating != null ? Number(payload.google_rating) : undefined,
        reviewCount: payload.review_count != null ? Number(payload.review_count) : undefined,
        googleMapsUrl: String(payload.google_maps_url || ''),
        scrapedSummary: String(payload.scraped_summary || payload.summary || ''),
        needs: Array.isArray(payload.needs) ? payload.needs : [],
        weaknesses: Array.isArray(payload.weaknesses) ? payload.weaknesses : [],
        fixes: Array.isArray(payload.fixes) ? payload.fixes : [],
        recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
        suggestedMessages,
        followUpMessage: String(
          payload.follow_up_message ||
            suggestedMessages[0]?.text ||
            `Visit ${consultationUrl} to book your consultation.`
        ),
        error: '',
        raw: payload,
        updatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).lean();

  const mapsUrl = String(payload.google_maps_url || '').trim();
  if (mapsUrl) {
    const existingContact = await db.getContactById(contactId);
    if (!existingContact?.googleMapsUrl?.trim()) {
      await db.updateContact(contactId, { googleMapsUrl: mapsUrl });
    }
  }

  return toInsight(doc as Record<string, unknown>);
}

export async function markInsightFailed(contactId: string, error: string): Promise<void> {
  await ContactInsightModel.findOneAndUpdate(
    { contactId },
    { $set: { status: 'failed', error, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function enrichContact(contact: Contact): Promise<ContactInsight> {
  const insight = await upsertInsightPending(contact._id);
  const webhook = config.n8n.businessEnrichWebhook;
  if (!webhook) {
    await saveInsightFromWebhook(contact._id, buildLocalInsightPayload(contact));
    return (await getInsightByContactId(contact._id))!;
  }
  try {
    await triggerBusinessEnrich(contact);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Enrichment trigger failed';
    await markInsightFailed(contact._id, msg);
    throw e;
  }
  return insight;
}

function buildLocalInsightPayload(contact: Contact): Record<string, unknown> {
  const url = config.campaign.consultationUrl;
  return {
    scraped_summary: `${contact.businessName || contact.name} in ${contact.location || 'your area'}.`,
    needs: ['More online leads', 'Better customer follow-up', 'Stronger SMS outreach'],
    weaknesses: ['Inconsistent follow-up', 'Limited digital presence'],
    fixes: ['Automated SMS campaigns', 'Tracked consultation links', 'CRM inbox for replies'],
    recommendations: [
      'Offer a free Flowcheq consultation',
      'Highlight Google reviews and local presence',
      'Send a personalized SMS with tracked booking link',
    ],
    suggested_messages: [
      {
        id: 'intro',
        label: 'Introduction',
        text: `Hi ${contact.name}, I'm reaching out from Flowcheq — we help businesses like ${contact.businessName || contact.name} get more booked consultations. Details: ${url}`,
      },
      {
        id: 'reviews',
        label: 'Leverage reviews',
        text: `Hi ${contact.name}, your local reputation matters. Flowcheq can help you turn interest into booked calls. Start here: ${url}`,
      },
    ],
    follow_up_message: `Hi ${contact.name}, just checking in — ready to book your free consultation? ${url}`,
  };
}

export function buildFollowUpMessage(contact: Contact, insight?: ContactInsight | null): string {
  if (insight?.followUpMessage?.trim()) return insight.followUpMessage.trim();
  const url = config.campaign.consultationUrl;
  return `Hi ${contact.name}, following up from Flowcheq — we'd love to help ${contact.businessName || contact.name} get more consultation bookings. ${url}`;
}

export async function getOrCreateFollowUp(contactId: string): Promise<string> {
  const contact = await db.getContactById(contactId);
  if (!contact) throw new Error('Contact not found');
  const insight = await getInsightByContactId(contactId);
  const message = buildFollowUpMessage(contact, insight);
  if (insight) {
    await ContactInsightModel.updateOne(
      { contactId },
      { $set: { followUpMessage: message, updatedAt: new Date() } }
    );
  }
  return message;
}

export async function getGoogleMapsLinkForContact(contactId: string) {
  const contact = await db.getContactById(contactId);
  if (!contact) return null;
  const insight = await getInsightByContactId(contactId);
  return resolveGoogleMapsUrl(contact, insight?.googleMapsUrl);
}
