import { config } from '../config';
import type { Contact } from '../types';

export async function triggerBusinessEnrich(contact: Contact): Promise<void> {
  const url = config.n8n.businessEnrichWebhook;
  if (!url) throw new Error('N8N_BUSINESS_ENRICH_WEBHOOK is not configured');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'contact.conversation.opened',
      contact_id: contact._id,
      name: contact.name,
      business_name: contact.businessName,
      phone_number: contact.phoneNumber,
      website: contact.website,
      location: contact.location,
      tags: contact.tags,
      callback_url: `${config.appUrl.replace(/\/$/, '')}/api/webhook/insights`,
      consultation_url: config.campaign.consultationUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`n8n enrich webhook failed: ${res.status} ${text}`.trim());
  }
}
